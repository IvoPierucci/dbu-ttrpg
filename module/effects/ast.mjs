/**
 * The shape of a compiled effect, and the checks it has to pass.
 *
 * This is the public contract of the engine. The parser produces it and the interpreter
 * consumes it; neither ever sees the other's business. That separation is what lets the
 * engine ship before the language does - the first programs come from migrating the old
 * data rows, and the parser lands later against a target that already works.
 */

import { getSlot, allowsOperation, PHASES, KINDS } from "./slots.mjs";
import { getMoment, provides } from "./moments.mjs";
import { PREDICATES } from "./conditions.mjs";
import { FUNCTIONS } from "./amounts.mjs";
import { checkVerb } from "./verbs.mjs";

/** Bumped when the shape changes in a way a stored program would not survive. */
export const EFFECT_SCHEMA = 1;

/**
 * A program is a list of blocks. A block is one numbered effect of its Trait - the
 * rulebook lets effects refer to each other by number ("ignore the first effect of the
 * Superior State"), so the index is the book's number and not an internal counter.
 */
export function program(blocks) {
  return { schema: EFFECT_SCHEMA, blocks };
}

export function block({
  index, mode = "passive", moment = null, budget = null,
  modifiers = {}, requires = null, statements = [], text = ""
}) {
  return { index, mode, moment, budget, modifiers, requires, statements, text };
}

// --- Amounts -------------------------------------------------------------------

export const flat = value => ({ type: "flat", value });
// A flag is set with a word, not a number. Without this, `skipTurn = true` read `true`
// as the name of something on the character, found nothing, and resolved to zero -
// which is to say every flag in the system was being set to false.
export const boolean = value => ({ type: "boolean", value });
export const perTier = value => ({ type: "perTier", value });
export const perBaseTier = value => ({ type: "perBaseTier", value });
export const level = (scale = null) => ({ type: "level", scale });
export const dice = (formula, scale = null, from = null) =>
  ({ type: "dice", formula, scale, from });
export const path = p => ({ type: "path", path: p });
export const binary = (op, left, right) => ({ type: "binary", op, left, right });
export const ternary = (condition, then, otherwise) =>
  ({ type: "ternary", condition, then, else: otherwise });
export const call = (fn, args) => ({ type: "call", fn, args });
// A bare piece of text, as the argument of a verb: gain("Prone", 2). Not a number, so
// it is only ever legal where a verb takes it.
export const name = value => ({ type: "name", value });

// --- Statements ----------------------------------------------------------------

export const assign = (slot, op, amount, target = "self") =>
  ({ type: "assign", slot, op, amount, target });
export const branch = (condition, then, otherwise = []) =>
  ({ type: "if", condition, then, else: otherwise });
export const invoke = (verb, args = []) => ({ type: "call", verb, args });
export const forbid = (what, options = {}) => ({ type: "forbid", what, ...options });

// --- Conditions ----------------------------------------------------------------

export const compare = (op, left, right) => ({ type: "compare", op, left, right });
export const logical = (op, left, right) => ({ type: "logical", op, left, right });
export const not = operand => ({ type: "not", operand });
export const predicate = (name, args = []) => ({ type: "predicate", name, args });

// --- Validation ----------------------------------------------------------------

/**
 * Check a program against what the system actually knows.
 *
 * Returns a list of problems rather than throwing on the first, so an author sees
 * everything wrong with their file at once instead of one thing per save.
 *
 * `data` is a character's system data when there is one, which is what makes it
 * possible to reject `skill.stelth` - the name has to be a Skill that exists, not just
 * something shaped like one.
 */
export function validateProgram(prog, data = null) {
  const errors = [];

  if (prog?.schema !== EFFECT_SCHEMA) {
    errors.push({ message: `Unknown effect schema ${prog?.schema}; expected ${EFFECT_SCHEMA}.` });
    return errors;
  }

  for (const b of prog.blocks ?? []) validateBlock(b, data, errors);
  return errors;
}

function validateBlock(b, data, errors) {
  const at = what => ({ block: b.index, message: what });

  // A Moment is required for the two modes that answer something, and meaningless
  // for the one that does not.
  let moment = null;
  if ((b.mode === "triggered") || (b.mode === "automatic")) {
    if (!b.moment) {
      errors.push(at(`A ${b.mode} effect needs a moment, written after the slash.`));
    }
    else {
      moment = getMoment(b.moment);
      if (!moment) errors.push(at(`Unknown moment "${b.moment}".`));
    }
  }
  else if (b.moment) {
    errors.push(at(`A ${b.mode} effect cannot name a moment.`));
  }

  // A passive is resolved during the derived-data pass, so its phase decides which
  // amounts are legal. A reactive one runs at a Moment, where everything is settled.
  const phaseOf = slot => (b.mode === "passive") ? slot.phase : PHASES.REACTIVE;

  for (const statement of b.statements ?? []) {
    validateStatement(statement, { b, data, moment, phaseOf, errors, at });
  }

  if (b.requires) validateExpression(b.requires, { b, data, moment, errors, at });
}

function validateStatement(s, ctx) {
  const { data, errors, at, phaseOf } = ctx;

  switch (s?.type) {
    case "assign": {
      const slot = getSlot(s.slot, data);
      if (!slot) {
        errors.push(at(`Unknown slot "${s.slot}".`));
        return;
      }
      if (!allowsOperation(slot, s.op)) {
        errors.push(at(`"${s.slot}" does not accept ${s.op}.`));
      }
      if ((slot.kind === KINDS.DICE) && (s.op !== "add-dice")) {
        errors.push(at(`"${s.slot}" holds dice; only add-dice makes sense on it.`));
      }

      // A dice amount on a number Slot is rolled and the total used, which is how the
      // rulebook writes half its recoveries: "regain 1d10(bT) Life and Ki Points". It
      // used to be refused twice over - here, and again where the amount was resolved -
      // so every such line had to be written in code rather than in its own file.

      // A block only ever lands on Slots of its own phase - a passive is folded into
      // derived data, a reactive one is collected at a Moment - and anything else was
      // being quietly discarded when the two were gathered. That is the failure this
      // whole language exists to prevent, so it is an error rather than a shrug.
      // A reactive block may name any Slot: by the time a Moment happens they are all
      // settled. The reverse is not true - a Slot that only exists during an exchange
      // has nothing to change while the character is being prepared, and writing one
      // from a passive was being discarded without a word.
      if ((ctx.b.mode === "passive") && (slot.phase === PHASES.REACTIVE)) {
        errors.push(at(`"${s.slot}" only exists during an exchange, so a passive cannot `
          + `change it. Write it as [triggered/<moment>] or [automatic/<moment>].`));
      }
      validateAmount(s.amount, slot, phaseOf(slot), ctx);
      return;
    }

    case "if":
      validateExpression(s.condition, ctx);
      for (const inner of s.then ?? []) validateStatement(inner, ctx);
      for (const inner of s.else ?? []) validateStatement(inner, ctx);
      return;

    case "call": {
      const problem = checkVerb(s.verb, (s.args ?? []).length);
      if (problem) errors.push(at(problem));
      for (const arg of s.args ?? []) {
        if (typeof arg === "string") continue;
        validateAmount(arg, null, PHASES.REACTIVE, ctx);
      }
      return;
    }

    case "forbid": {
      // Forbidding something nothing reads is an effect that silently does nothing,
      // which is the exact failure this whole language was built to stop.
      const slot = getSlot(s.what, data);
      if (!slot) errors.push(at(`"${s.what}" is not something that can be forbidden.`));
      else if (!allowsOperation(slot, s.allow ? "allow" : "forbid")) {
        errors.push(at(`"${s.what}" cannot be forbidden.`));
      }
      return;
    }

    default:
      errors.push(at(`Unknown statement "${s?.type}".`));
  }
}

/**
 * An amount may not read a value that is not settled yet.
 *
 * (bT) follows from Power Level alone, so it is legal even in the earliest phase. (T)
 * is itself derived and can be changed by effects, so a Slot resolved before the Tiers
 * cannot use it. That single check is what makes the phase system honest rather than
 * hopeful.
 */
function validateAmount(a, slot, phase, ctx) {
  const { b, data, moment, errors, at } = ctx;
  if (!a) return;

  switch (a.type) {
    case "flat":
    case "perBaseTier":
      return;

    case "boolean":
      // Only where a flag is expected: a true added to a number is a mistake worth
      // catching, not a quiet one.
      if (slot && (slot.kind !== KINDS.FLAG)) {
        errors.push(at(`"${slot.key}" holds a number, not true or false.`));
      }
      return;

    case "name":
      // Text is meaningless as a quantity, so it is allowed only as a verb argument -
      // which is the one call that passes no slot.
      if (slot) errors.push(at(`"${slot.key}" holds a number, not text.`));
      return;

    case "perTier":
      if (phase === PHASES.TIER) {
        errors.push(at(`"${slot?.key}" is resolved before the Tier of Power is known, `
          + `so it cannot use (T). Use (bT), which follows from Power Level alone.`));
      }
      return;

    case "level":
      // The same rule (T) obeys: a Slot settled before the Tiers cannot scale by one.
      if ((a.scale === "T") && (phase === PHASES.TIER)) {
        errors.push(at(`"${slot?.key}" is resolved before the Tier of Power is known, `
          + `so L(T) cannot be used here. Use L(bT).`));
      }
      if (!b.modifiers?.fromLevel && !b.modifiers?.levelled) {
        // Harmless on a levelled source and meaningless anywhere else, so it is worth
        // saying rather than resolving to 1 and looking like it worked.
        errors.push(at("L is the level of a State or Aspect; this effect has no level."));
      }
      return;

    case "dice":
      // A number Slot takes dice: they are rolled and the total is the number, which is
      // how the rulebook writes half its recoveries. Only a Slot that takes neither is
      // an error - a flag, say.
      if (slot && (slot.kind !== KINDS.DICE) && (slot.kind !== KINDS.NUMBER)) {
        errors.push(at(`"${slot.key}" holds a number, not dice.`));
      }
      return;

    case "path":
      validatePath(a.path, ctx);
      return;

    case "binary":
      validateAmount(a.left, slot, phase, ctx);
      validateAmount(a.right, slot, phase, ctx);
      return;

    case "ternary":
      validateExpression(a.condition, ctx);
      validateAmount(a.then, slot, phase, ctx);
      validateAmount(a.else, slot, phase, ctx);
      return;

    case "call":
      // A name that is neither a function nor a predicate is a typo, and at runtime it
      // reads as zero - indistinguishable from an effect that does not apply.
      if (!(a.fn in FUNCTIONS) && !(a.fn in PREDICATES)) {
        errors.push(at(`"${a.fn}" is not a function or a condition this system knows.`));
      }
      for (const arg of a.args ?? []) {
        if (typeof arg === "string") continue;
        validateAmount(arg, slot, phase, ctx);
      }
      return;

    default:
      errors.push(at(`Unknown amount "${a.type}".`));
  }
}

/**
 * A path reads either the character or the Moment's own context. Reading context a
 * Moment does not offer is the error this whole arrangement exists to catch.
 */
function validatePath(p, { moment, errors, at }) {
  const root = String(p).split(".")[0];
  const CONTEXTUAL = ["attack", "attacker", "target", "incoming", "clash", "roll",
                      "damage", "burst", "proc"];

  if (!CONTEXTUAL.includes(root)) return;
  if (!moment) {
    errors.push(at(`"${p}" reads something only available at a moment, but this effect `
      + `is passive.`));
    return;
  }
  if (!provides(moment, root)) {
    errors.push(at(`"${moment.key}" does not provide "${root}", so "${p}" cannot be read there.`));
  }
}

function validateExpression(e, ctx) {
  const { errors, at } = ctx;
  if (!e) return;

  switch (e.type) {
    case "compare":
      validateAmount(e.left, null, PHASES.REACTIVE, ctx);
      validateAmount(e.right, null, PHASES.REACTIVE, ctx);
      return;
    case "logical":
      validateExpression(e.left, ctx);
      validateExpression(e.right, ctx);
      return;
    case "not":
      validateExpression(e.operand, ctx);
      return;
    case "predicate":
      // A predicate that does not exist reads as false at runtime, which looks exactly
      // like a Trait that simply does not apply - so a misspelling has to be caught here
      // or it is never caught at all.
      if (!(e.name in PREDICATES)) errors.push(at(`Unknown condition "${e.name}".`));
      // Arguments are usually the name of something - a Trait, a State, a Condition -
      // and the parser leaves those as plain text. Only a real amount is checked.
      for (const arg of e.args ?? []) {
        if (typeof arg === "string") continue;
        validateAmount(arg, null, PHASES.REACTIVE, ctx);
      }
      return;
    default:
      errors.push(at(`Unknown condition "${e.type}".`));
  }
}
