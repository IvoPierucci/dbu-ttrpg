/**
 * How long something lasts.
 *
 * Four wordings come up constantly, and they are really three:
 *
 *   until the end of your turn
 *   until the end of your next turn
 *   until the start of your turn
 *   until the start of your next turn
 *
 * One rule covers all four: **"your turn" and "your next turn" both mean the next turn
 * of yours that still has that edge ahead of it.** The start of your turn is never ahead
 * of you while you are standing in it - it already happened - so the two start-of
 * durations are the same duration written two ways, always. The two end-of ones differ
 * only for something gained during your own turn, and then by a whole Combat Round.
 *
 * So the wording is turned into a count of edges the moment the clock is set, rather
 * than kept as words and interpreted later. The question "is it my turn right now" has
 * an answer then and only then.
 *
 * A skipped turn is still your turn: you lost it, it did not stop existing. Both of its
 * edges arrive, which is what stops a Defeated character lying in the Initiative Order
 * from keeping every buff on them for the rest of the Encounter.
 */

import { setState, setCondition, replaceObject } from "./conditions.mjs";

/** The edges a duration can end on. */
export const EDGES = Object.freeze({
  START: "start",
  END: "end",
  /** The whole Combat Encounter, which ends when the Encounter does. */
  ENCOUNTER: "encounter"
});

/** What kinds of thing can be put on a clock. */
export const KINDS = Object.freeze({
  STATE: "state",
  CONDITION: "condition",
  RESOURCE: "resource"
});

/**
 * How many edges of that kind have to pass before this runs out.
 *
 * The whole of the rule, in one place. `next` is whether the wording said "your *next*
 * turn"; `theirTurn` is whether they are standing in their own turn as it is set.
 *
 *   - a start edge is never ahead of you during your own turn, so it is always one:
 *     the start of the turn you are in has already happened
 *   - an end edge is ahead of you during your own turn, so "your turn" means this one
 *     and "your next turn" means the one after it
 *   - outside your turn both mean the turn that is coming, and are the same
 */
export function edgesToWait(edge, { next = false, theirTurn = false } = {}) {
  if (edge === EDGES.ENCOUNTER) return 0;
  if (edge === EDGES.START) return 1;
  return (next && theirTurn) ? 2 : 1;
}

/**
 * Put something on a clock.
 *
 * Whatever it is has to be applied separately - this records when it comes off, not what
 * it does. Two clocks on the same thing are two entries: one effect's Superior running
 * out must not take away another's.
 */
export async function lasting(actor, { kind, key, edge, next = false, source = "",
                                       on = "", until = "" }) {
  if (!actor || !kind || !key) return false;

  const entry = {
    kind,
    key,
    edge,
    edges: edgesToWait(edge, { next, theirTurn: isTheirTurnNow(actor) }),
    source,
    // A second way for this clock to run out, beside the edge it is counting: "until the
    // end of your turn or until they are hit by an Attacking Maneuver (whichever comes
    // first)". The edge goes on counting either way - this is only the other half of the
    // "whichever", and whichever arrives first is the one that ends it.
    ...(until ? { until } : {}),
    // Whose thing this is, where that is not the character keeping the clock. "They
    // suffer from Guard Down until the end of your turn" is one rule split across two
    // characters: the edges counted are yours and the Condition is theirs.
    ...(on && (on !== actor.uuid) ? { on } : {})
  };

  await actor.update({ "system.timed": [...(actor.system.timed ?? []), entry] });
  return true;
}

/**
 * Whether it is this character's turn right now.
 *
 * The one question the wording cannot answer for itself, and the reason a duration is
 * turned into a count when it is set rather than when it is read.
 */
function isTheirTurnNow(actor) {
  const combatant = game.combat?.combatant;
  if (!game.combat?.started || !combatant) return false;
  return combatant.actor?.uuid === actor.uuid;
}

/**
 * A turn edge has arrived for this character: take a step off every clock waiting on it,
 * and take away whatever ran out.
 *
 * @returns {Promise<string[]>} what ran out, named, so the table can be told.
 */
export async function edgeReached(actor, edge) {
  const held = actor.system.timed ?? [];
  if (!held.length) return [];

  const kept = [];
  const done = [];
  // Whether this edge changed anything at all - a step taken off a clock counts, not only
  // a clock running out. Without this the step was computed and thrown away, so a
  // duration of two edges never became one and never ended: "until the end of your next
  // turn" lasted for ever.
  let moved = false;

  for (const entry of held) {
    if (entry.edge !== edge) {
      kept.push(entry);
      continue;
    }

    moved = true;
    const left = Math.max(0, (entry.edges ?? 1) - 1);
    if (left > 0) kept.push({ ...entry, edges: left });
    else done.push(entry);
  }

  if (!moved) return [];

  // The list is written first. Taking the thing off can re-derive the character and fire
  // Moments of its own, and an entry still sitting on the clock while that happens is an
  // entry that can be counted down twice.
  await actor.update({ "system.timed": kept });

  // A step was taken and nothing ran out, which is the ordinary case for anything with
  // more than one edge to wait.
  if (!done.length) return [];

  const ran = [];
  for (const entry of done) {
    await takeOff(actor, entry);
    ran.push(entry.source || entry.key);
  }
  return ran;
}

/**
 * Take off everything that was set to end when this happens to this character.
 *
 * The other half of "whichever comes first". The edge is still counted by `edgeReached`
 * and is untouched by this - a duration with both simply ends at whichever arrives.
 *
 * The clock is not always kept by the character it is about: Dirty Trick's Guard Down is
 * counted by whoever played it and sits on whoever it was played on, because the turn the
 * entry names is the player's. So this looks at the character's own list and then at
 * everybody on the scene for an entry naming them.
 *
 * @returns {Promise<string[]>} what ran out, named, so the table can be told
 */
export async function endedBy(actor, moment) {
  if (!actor || !moment) return [];

  const others = (canvas?.tokens?.placeables ?? [])
    .map(token => token.actor)
    .filter(other => other && (other.uuid !== actor.uuid));

  const ran = [];
  const seen = new Set();

  for (const owner of [actor, ...others]) {
    if (seen.has(owner.uuid)) continue;
    seen.add(owner.uuid);

    const held = owner.system.timed ?? [];
    // Theirs to end: an entry with no `on` is about whoever is keeping it, and one with
    // an `on` is about whoever it names.
    const done = held.filter(entry =>
      (entry.until === moment) && ((entry.on || owner.uuid) === actor.uuid));
    if (!done.length) continue;

    // Written first, as `edgeReached` writes first: taking the thing off re-derives the
    // character and can fire Moments of its own, and an entry still on the list while
    // that happens is an entry that can be ended twice.
    await owner.update({ "system.timed": held.filter(entry => !done.includes(entry)) });

    for (const entry of done) {
      await takeOff(owner, entry);
      ran.push(entry.source || entry.key);
    }
  }

  return ran;
}

/** Everything on a clock that ends with the Encounter, taken off as it ends. */
export async function encounterEnded(actor) {
  const held = actor.system.timed ?? [];
  if (!held.length) return [];

  const done = held.filter(entry => entry.edge === EDGES.ENCOUNTER);

  // Every clock stops with the Encounter, not only the ones counting it: a turn edge
  // that never arrives is a duration that never ends, and there are no more turns.
  await actor.update({ "system.timed": [] });

  const ran = [];
  for (const entry of done) {
    await takeOff(actor, entry);
    ran.push(entry.source || entry.key);
  }
  return ran;
}

/**
 * Take one thing off, whatever kind of thing it is.
 *
 * Off whoever it was about, which is usually the character whose clock it was and is not
 * always: an entry naming somebody else is a duration one character keeps over another.
 * A named character who is no longer here leaves nothing to take off - the clock still
 * ran out, and the entry has already been dropped by whoever was counting it.
 */
async function takeOff(owner, entry) {
  const actor = entry.on ? fromUuidSync(entry.on) : owner;
  if (!actor) return false;

  if (entry.kind === KINDS.STATE) return setState(actor, entry.key, 0);
  if (entry.kind === KINDS.CONDITION) return setCondition(actor, entry.key, 0);

  if (entry.kind === KINDS.RESOURCE) {
    const resources = { ...(actor.system.resources ?? {}) };
    const held = resources[entry.key];
    if (!held) return false;

    // One stack, not the whole Resource. Each stack is put on a clock of its own where
    // the rule gives it one - "gain a stack of Power until the end of your next turn" -
    // and a stack gained this turn taking away one gained last turn is the bug this
    // avoids. The key goes when the last stack does, because a Resource at nothing is
    // one nobody has.
    const left = Math.max(0, (held.stacks ?? 0) - 1);
    if (left > 0) resources[entry.key] = { ...held, stacks: left };
    else delete resources[entry.key];

    return actor.update({ "system.resources": replaceObject(resources) });
  }

  console.warn(`DBU TTRPG | Nothing knows how to take off a "${entry.kind}".`);
  return false;
}

/** Whether this character is holding this thing on a clock. */
export function lastingOn(actor, kind, key) {
  return (actor.system.timed ?? []).some(entry => (entry.kind === kind) && (entry.key === key));
}
