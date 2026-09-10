/**
 * Running effects.
 *
 * Two entry points, because the rulebook has two kinds of timing. Passives are folded
 * into the character's derived data, phase by phase, and are recomputed from scratch on
 * every pass. Reactives are gathered at a named Moment during an exchange.
 *
 * Nothing here knows about Foundry. It is handed a list of compiled programs with the
 * Priority of whatever granted them, and it hands back what each Slot came to.
 */

import { getSlot, CONFLICTING, KINDS, PHASES } from "./slots.mjs";
import { resolveAmount, resolveDice } from "./amounts.mjs";
import { evaluate } from "./conditions.mjs";

/**
 * The Priority ladder, ascending, exactly as the rulebook lists it.
 *
 * It only breaks ties. Two effects that add to the same Slot both apply and the numbers
 * add up; Priority decides between two that *contradict* - two that set a value, two
 * that impose a floor, one that forbids against one that allows.
 */
export const PRIORITY = Object.freeze({
  base: 0,
  aspect: 1,
  state: 2,
  coreTransformation: 3,
  transformation: 4,
  racial: 5,
  talent: 6,
  condition: 7,
  unique: 8
});

/**
 * Fold every passive of one phase into a bag of Slot values.
 *
 * @param {Array} entries  {program, priority, level, sourceId, sourceName}
 * @param {string} phase   which Slots to resolve now
 * @param {object} scope   {data, errors, benefitsFrom, rulings}
 * @returns {{slots: object, active: Array}}
 */
export function applyPassives(entries, phase, scope) {
  const contributions = new Map();
  const active = [];

  for (const entry of entries) {
    for (const b of entry.program?.blocks ?? []) {
      if (b.mode !== "passive") continue;
      if (!levelReached(b, entry)) continue;

      const blockScope = { ...scope, level: entry.level ?? 0, stacks: entry.stacks ?? 1 };

      // A block repeated per stack applies once for each one, so "for each Stack,
      // halve your Max Capacity" needs no exponent written into the amount.
      const times = b.modifiers?.perStack ? (entry.stacks ?? 0) : 1;
      if (times <= 0) continue;

      // Counted as active only if it actually contributed something: a block whose
      // condition did not hold has run without doing anything, and reporting it as
      // active would make `explain` say the opposite of what happened.
      let contributed = false;
      for (let i = 0; i < times; i++) {
        run(b.statements, {
          ...blockScope,
          collect: (slot, op, value, kind) => {
            contributed = true;
            gather(contributions, slot, op, value, kind, entry, b, phase, scope);
          }
        });
      }

      if (contributed) active.push({ sourceId: entry.sourceId, sourceName: entry.sourceName,
        block: b.index, text: b.text });
    }
  }

  return { slots: resolveAll(contributions, scope), active };
}

/**
 * Gather everything that answers a Moment.
 *
 * Returns the Slot values the same way passives do, plus the parts and flags the
 * exchange needs, so a caller adds them to a roll without knowing where they came from.
 */
export function collectReactive(entries, moment, scope) {
  const contributions = new Map();
  const parts = [];
  const spent = [];

  for (const entry of entries) {
    for (const b of entry.program?.blocks ?? []) {
      if ((b.mode !== "triggered") && (b.mode !== "automatic")) continue;
      if (!matchesMoment(b, moment)) continue;
      if (!levelReached(b, entry)) continue;

      // A triggered effect is offered; an automatic one is not. Whoever called this
      // decides which of the two it is asking for.
      if ((b.mode === "triggered") && !entry.armed) continue;
      if (!entry.available) continue;

      const blockScope = { ...scope, level: entry.level ?? 0, stacks: entry.stacks ?? 1 };
      if (b.requires && !evaluate(b.requires, blockScope)) continue;

      // Repeated per stack, exactly as a passive is: Slowed taking an Action away for
      // each stack gained is written once and applied as many times as it was gained.
      const times = b.modifiers?.perStack ? (entry.stacks ?? 0) : 1;
      if (times <= 0) continue;

      for (let i = 0; i < times; i++) {
        run(b.statements, {
          ...blockScope,
          collect: (slot, op, value, kind) =>
            gather(contributions, slot, op, value, kind, entry, b, PHASES.REACTIVE, scope)
        });
      }

      // The effect's own label carries into the roll's breakdown, so a player can see
      // which Trait moved the number without anyone building a UI for it.
      parts.push({ label: entry.sourceName, block: b.index });
      spent.push({ sourceId: entry.sourceId, block: b.index });
    }
  }

  return { slots: resolveAll(contributions, scope), parts, spent };
}

/** Whether a block waiting on a level has reached it. */
function levelReached(b, entry) {
  const from = b.modifiers?.fromLevel;
  if (!from) return true;
  return (entry.level ?? 0) >= from;
}

/** A parameterised Moment answers its own name; the parameter says about whom. */
function matchesMoment(b, moment) {
  if (!b.moment) return false;
  const bare = String(b.moment).split(/[(/]/)[0];
  return bare === String(moment).split(/[(/]/)[0];
}

// --- Statements ----------------------------------------------------------------

function run(statements, scope) {
  for (const s of statements ?? []) {
    switch (s.type) {
      case "assign": {
        const slot = getSlot(s.slot, scope.data);
        if (!slot) {
          scope.errors?.push(`Unknown slot "${s.slot}".`);
          break;
        }
        const value = (slot.kind === KINDS.DICE)
          ? resolveDice(s.amount, scope)
          : resolveAmount(s.amount, scope);
        scope.collect(slot, s.op, value, slot.kind);
        break;
      }

      case "if":
        run(evaluate(s.condition, scope) ? s.then : s.else, scope);
        break;

      case "forbid":
        scope.collect(getSlot(s.what, scope.data) ?? { key: s.what, kind: KINDS.FLAG, ops: ["forbid"] },
          "forbid", true, KINDS.FLAG);
        break;

      case "call":
        // Verbs act on the world rather than on a Slot, so they are queued for whoever
        // asked - the interpreter has no business applying damage or removing a State.
        scope.queue?.push({ verb: s.verb, args: (s.args ?? []).map(a => resolveAmount(a, scope)) });
        break;

      default:
        scope.errors?.push(`Unknown statement "${s.type}".`);
    }
  }
}

function gather(contributions, slot, op, value, kind, entry, b, phase, scope) {
  // During the derived pass a Slot only lands in its own phase, which is what keeps the
  // ordering honest. At a Moment there is no ordering left to protect - every value is
  // settled - so a reactive block may name any Slot, and the caller decides which of
  // them it reads.
  if ((phase !== PHASES.REACTIVE) && slot.phase && (slot.phase !== phase)) return;

  const targets = slot.fanOut?.length ? slot.fanOut : [slot.key];
  for (const key of targets) {
    if (!contributions.has(key)) contributions.set(key, { kind, entries: [] });
    contributions.get(key).entries.push({
      op, value,
      priority: entry.priority ?? PRIORITY.base,
      source: entry.sourceName,
      block: b.index,
      clamp: slot.clamp
    });
  }
}

// --- Resolution ----------------------------------------------------------------

function resolveAll(contributions, scope) {
  const out = {};
  for (const [key, { kind, entries }] of contributions) {
    out[key] = (kind === KINDS.DICE) ? resolveDiceSlot(entries)
      : (key === "diceAdvantage") ? resolveAdvantage(entries)
      : (kind === KINDS.FLAG) ? resolveFlag(entries, scope)
      : resolveNumber(entries, scope);
  }
  return out;
}

/**
 * A numeric Slot, in the order the rulebook lays down.
 *
 * Everything additive first, then whichever contradicting operation won on Priority,
 * then the multiplications - Calculation Priority says a multiply or divide "is applied
 * after all other modifications to said value". Doing it any other way changes results
 * silently, which is why it is a rule of the engine rather than a decision per effect.
 */
function resolveNumber(entries, scope) {
  const conflicting = entries.filter(e => CONFLICTING.includes(e.op));

  return {
    add: entries.filter(e => e.op === "add").reduce((total, e) => total + e.value, 0),
    // Multiplications are kept apart rather than folded in, because they have to land
    // on the finished value: "when an effect multiplies or divides a value, that is
    // applied after all other modifications to said value". Halving a Soak Value means
    // halving the whole thing, not halving what one effect added to it.
    multiply: entries.filter(e => e.op === "multiply").reduce((total, e) => total * e.value, 1),
    // Only the highest-Priority contradiction applies; among equals, the last one in.
    set: highest(conflicting.filter(e => e.op === "set"))?.value ?? null,
    min: highest(conflicting.filter(e => e.op === "min"))?.value ?? null,
    max: highest(conflicting.filter(e => e.op === "max"))?.value ?? null,
    clamp: entries.find(e => e.clamp)?.clamp ?? null
  };
}

/**
 * Put a Slot's contributions onto the value the pipeline worked out.
 *
 * The order is the rulebook's: everything additive, then whichever contradiction won,
 * then the multiplications, then the Slot's own hard limits.
 */
/**
 * Whether something an effect can take away is still allowed.
 *
 * A permission is absent until some effect has an opinion about it, so "not mentioned"
 * and "allowed" are the same answer - only an explicit forbid says no.
 */
export function permits(slots, key) {
  return slots?.[key] !== false;
}

export function applySlot(slots, key, base) {
  const c = slots?.[key];
  if (!c || (typeof c !== "object") || Array.isArray(c)) return base;

  let value = base + (c.add ?? 0);
  if (c.set !== null && c.set !== undefined) value = c.set;
  if (c.min !== null && c.min !== undefined) value = Math.max(value, c.min);
  if (c.max !== null && c.max !== undefined) value = Math.min(value, c.max);
  value *= (c.multiply ?? 1);

  // Rounded down, which is what the rulebook does everywhere it does not say otherwise -
  // and it says "(rounded up)" explicitly on the one Ki Wager that goes the other way.
  // Only after the multiply, since that is the only thing here that makes a fraction.
  if (!Number.isInteger(value)) value = Math.floor(value);

  if (c.clamp) value = Math.min(Math.max(value, c.clamp[0]), c.clamp[1]);

  return value;
}

function highest(entries) {
  if (!entries.length) return null;
  return entries.reduce((best, e) => (e.priority >= best.priority) ? e : best);
}

/** Dice are appended, never summed: two effects adding 1d6 give you two dice. */
function resolveDiceSlot(entries) {
  return entries.map(e => e.value).filter(Boolean);
}

/**
 * Dice Priority, which is its own rule and not a sum.
 *
 * Several effects granting the better of two dice do not stack, and effects pulling in
 * opposite directions cancel out entirely - "regardless of the amount of effects in
 * either direction". So this is a sign, not a total.
 */
function resolveAdvantage(entries) {
  const up = entries.some(e => e.op === "dice-up");
  const down = entries.some(e => e.op === "dice-down");
  if (up && down) return 0;
  return up ? 1 : down ? -1 : 0;
}

/** A flag is decided by Priority alone: forbid and allow are contradictions. */
function resolveFlag(entries, scope) {
  const decided = highest(entries.filter(e => CONFLICTING.includes(e.op)));
  if (!decided) return entries.some(e => e.value);
  if (decided.op === "forbid") return false;
  if (decided.op === "allow") return true;
  return Boolean(decided.value);
}
