/**
 * Making a Moment happen.
 *
 * A passive is folded into derived data and recomputed forever; a reactive effect
 * *occurs*. It changes what a character has, once, and that has to be written down. So
 * this is the half of the engine that touches the world, and it is deliberately the only
 * part that does - the interpreter stays a pure function of the character's data, which
 * is what makes it checkable and what keeps `prepareDerivedData` free of side effects.
 *
 * An Automatic effect fires on its own and says so in chat, because a number moving with
 * no explanation is worse than no automation at all. A Triggered one only fires if it was
 * armed beforehand, which is the player's decision and belongs to the roll dialog.
 */

import { reactiveFor } from "./registry.mjs";
import { collectReactive, applySlot } from "./interpreter.mjs";
import { getMoment } from "./moments.mjs";

/**
 * Slots that name something stored rather than something derived.
 *
 * A passive writing to `life.max` is recomputed from nothing every time the sheet is
 * prepared. A reactive effect taking Life Points away has to actually take them, or the
 * next preparation puts them straight back.
 */
const STATEFUL = {
  "life.value": { path: "system.life.value", read: a => a.system.life.value },
  "ki.value": { path: "system.ki.value", read: a => a.system.ki.value },
  "capacity.spent": { path: "system.capacity.spent", read: a => a.system.capacity.spent }
};

/**
 * Fire one Moment for one character.
 *
 * @param {Actor} actor
 * @param {string} moment   a key from moments.mjs, parameter and all
 * @param {object} context  what this Moment puts within reach
 * @returns {Promise<object>} the slots that were collected, for a caller that needs them
 */
export async function fireMoment(actor, moment, context = {}, { only = null, stacks = null } = {}) {
  if (!actor) return {};

  const definition = getMoment(moment);
  if (!definition) {
    console.warn(`DBU TTRPG | Nothing in this system knows the moment "${moment}".`);
    return {};
  }

  // A Moment can carry a limit of its own, which belongs to the trigger rather than to
  // any effect using it: Threshold fires once per Threshold per Encounter however many
  // effects are waiting on it.
  if (definition.limit && !momentAvailable(actor, definition, context)) return {};

  let entries = reactiveFor(actor).filter(entry => entry.available && entry.armed);

  // `on applied` is about the thing being applied, not about everything the character
  // happens to be carrying, so a Moment can be narrowed to one source.
  if (only) entries = entries.filter(entry => entry.sourceId === only);

  // And how many stacks it is about can differ from how many are held: what an effect
  // does on being applied is done for the stacks just gained.
  if (stacks !== null) entries = entries.map(entry => ({ ...entry, stacks }));

  if (!entries.length) return {};

  const scope = { data: actor.system, errors: [], context, queue: [] };
  const { slots, spent } = collectReactive(entries, moment, scope);

  for (const message of scope.errors) {
    console.warn(`DBU TTRPG | ${actor.name}: ${message}`);
  }
  if (!spent.length) return slots;

  await writeStateful(actor, slots);
  for (const call of scope.queue) await runVerb(actor, call, context);

  await recordUses(actor, spent, definition, context);
  await announce(actor, entries, spent, moment);

  return slots;
}

/** Put what the Moment changed onto the character. */
async function writeStateful(actor, slots) {
  const updates = {};

  for (const [key, { path, read }] of Object.entries(STATEFUL)) {
    if (!(key in slots)) continue;

    const settled = applySlot(slots, key, read(actor));
    // Life Points are the one value with a stated exception to the floor, and even that
    // has to be granted by something - the Undying State.
    const negative = (key === "life.value")
      && !!actor.system.effects?.slots?.["life.allowNegative"];
    updates[path] = negative ? Math.round(settled) : Math.max(0, Math.round(settled));
  }

  if (!foundry.utils.isEmpty(updates)) await actor.update(updates);
}

/**
 * Verbs act on the world, which is why the interpreter only queues them.
 *
 * Adding one costs a case here and a line in the author's guide, and nothing else.
 */
async function runVerb(actor, call, context) {
  const verb = call?.verb;
  const args = call?.args ?? [];

  switch (verb) {
    case "remove":
      return removeCondition(actor, args[0] ?? context.condition);

    case "gain":
      return gainCondition(actor, args[0], args[1] ?? 1);

    case "surge": {
      // The kind is forced when the effect names one: "use a Ki Surge" is not an offer
      // of either Surge.
      const { takeSurge } = await import("../chat.mjs");
      return takeSurge(actor, { source: "an effect", kind: args[0] ?? null });
    }

    case "leaveState":
      return leaveState(actor, args[0] ?? context.state);

    case "mightClash":
      // Offered, not rolled: the Pinned Character may repeat it as often as they like,
      // so which turn they spend the Action on is theirs to decide.
      ui.notifications?.info(
        `${actor.name} may make a Might Clash to break free.`
      );
      return;

    case "grantOutOfSequence":
      // Offered rather than taken: an Out-of-Sequence Maneuver is still the player's to
      // play, and there is no dialog here to make them play it.
      ui.notifications?.info(`${actor.name} may act out of sequence.`);
      return;

    default:
      console.warn(`DBU TTRPG | Nothing in this system knows the verb "${verb}".`);
  }
}

/**
 * Take a Combat Condition off a character.
 *
 * Imported late rather than at the top, because conditions.mjs imports this module for
 * fireMoment - and a verb runs long after both are loaded, so there is nothing to gain
 * by tying the two together at parse time.
 */
export async function removeCondition(actor, name) {
  if (!name) return;
  const { setCondition } = await import("../conditions.mjs");
  return setCondition(actor, String(name).toLowerCase(), 0);
}

/** Put one on, at a number of stacks. */
export async function gainCondition(actor, name, stacks = 1) {
  if (!name) return;
  const { setCondition } = await import("../conditions.mjs");
  return setCondition(actor, String(name).toLowerCase(), stacks);
}

/** Leave a State - named, or all of them, which is what Defeat does. */
export async function leaveState(actor, name) {
  const { clearStates, setState } = await import("../conditions.mjs");
  if (!name) return clearStates(actor);
  return setState(actor, String(name).toLowerCase(), 0);
}

/**
 * Record that these effects were used, and disarm them.
 *
 * The two lists have the lifetimes their names say: `round` is emptied when a Combat
 * Round turns over and `encounter` when one ends, so a limit needs nothing here beyond
 * writing the id into the right one.
 */
async function recordUses(actor, spent, definition, context) {
  const ids = spent.map(use => `${use.sourceId}#${use.block}`);
  const armed = (actor.system.armedTalents ?? []).filter(id => !ids.includes(id));

  const round = [...(actor.system.talentUses?.round ?? []), ...ids];
  const encounter = [...(actor.system.talentUses?.encounter ?? []), ...ids];

  // A Moment with a limit of its own records that it fired, separately from the effects
  // that answered it.
  if (definition.limit) {
    const key = momentKey(definition, context);
    if (definition.limit.per === "round") round.push(key);
    else encounter.push(key);
  }

  return actor.update({
    "system.talentUses.round": round,
    "system.talentUses.encounter": encounter,
    "system.armedTalents": armed
  });
}

/** The id a Moment's own limit is counted under. */
function momentKey(definition, context) {
  const each = definition.limit.each ? `:${context[definition.limit.each] ?? ""}` : "";
  return `moment:${definition.key}${each}`;
}

function momentAvailable(actor, definition, context) {
  const list = (definition.limit.per === "round")
    ? actor.system.talentUses?.round : actor.system.talentUses?.encounter;
  const key = momentKey(definition, context);
  const used = (list ?? []).filter(entry => entry === key).length;
  return used < (definition.limit.amount ?? 1);
}

/**
 * Say that an Automatic effect fired.
 *
 * Nobody pressed anything, so without this the table sees a number change and has to
 * guess which Trait did it. Triggered effects are left out: the player armed those, and
 * the roll they belong to already names them in its breakdown.
 */
async function announce(actor, entries, spent, moment) {
  const byId = new Map(entries.map(entry => [entry.blockId, entry]));

  const fired = spent
    .map(use => byId.get(`${use.sourceId}#${use.block}`))
    .filter(entry => entry?.program?.blocks?.[0]?.mode === "automatic");
  if (!fired.length) return;

  const lines = fired
    .map(entry => `<li>${Handlebars.escapeExpression(entry.sourceName)}</li>`)
    .join("");
  const label = getMoment(moment)?.label ?? moment;

  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="dbu-check">`
      + `<div class="dbu-check-parts">Automatic &middot; ${Handlebars.escapeExpression(label)}</div>`
      + `<ul class="dbu-auto-list">${lines}</ul></div>`
  });
}
