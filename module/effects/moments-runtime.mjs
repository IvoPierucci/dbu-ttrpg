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
 * @returns {Promise<{slots: object, fired: number}>} what was collected, and how many
 *   effects answered. The count matters on its own: an effect whose whole body is a
 *   verb - Prone standing you up - changes no Slot at all, and judging it by the Slots
 *   alone reads as nothing having happened.
 */
export async function fireMoment(actor, moment, context = {}, { only = null, stacks = null } = {}) {
  if (!actor) return {};

  const nothing = { slots: {}, fired: 0 };

  const definition = getMoment(moment);
  if (!definition) {
    console.warn(`DBU TTRPG | Nothing in this system knows the moment "${moment}".`);
    return nothing;
  }

  // A Moment can carry a limit of its own, which belongs to the trigger rather than to
  // any effect using it: Threshold fires once per Threshold per Encounter however many
  // effects are waiting on it.
  if (definition.limit && !momentAvailable(actor, definition, context)) return nothing;

  let entries = reactiveFor(actor).filter(entry => entry.available && entry.armed);

  // `on applied` is about the thing being applied, not about everything the character
  // happens to be carrying, so a Moment can be narrowed to one source.
  if (only) entries = entries.filter(entry => entry.sourceId === only);

  // And how many stacks it is about can differ from how many are held: what an effect
  // does on being applied is done for the stacks just gained.
  if (stacks !== null) entries = entries.map(entry => ({ ...entry, stacks }));

  if (!entries.length) return nothing;

  const scope = { data: actor.system, errors: [], context, queue: [] };
  const { slots, spent } = collectReactive(entries, moment, scope);

  for (const message of scope.errors) {
    console.warn(`DBU TTRPG | ${actor.name}: ${message}`);
  }
  if (!spent.length) return nothing;

  await writeStateful(actor, slots);
  for (const call of scope.queue) await runVerb(actor, call, context);

  await recordUses(actor, spent, definition, context);
  await announce(actor, entries, spent, moment);

  return { slots, fired: spent.length };
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
/** A character an effect named, by uuid or by name, or nothing. */
function named(who) {
  if (!who) return null;
  return fromUuidSync(String(who))
    ?? game.actors?.find(a => a.name === String(who))
    ?? null;
}

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

    case "expires":
      return expiresAt(actor, args[0], args[1]);

    case "enterState":
      // No source name to hand it: a verb is run from a queue and the entry that queued
      // it is not carried here. The State's own name is what the card will say ran out,
      // which is the thing a reader wants anyway.
      return enterState(actor, args[0], args[1], args[2]);

    case "mightClash": {
      // Opened for real now that the system has Might Clashes. It used to print a line
      // saying one could be made and do nothing, so Pinned spent an Action on a
      // notification - the verb was declared, called, and had no clash behind it.
      //
      // Who it is against: whoever the effect names, and otherwise whoever the player
      // has targeted. Who pinned you is not recorded - a Combat Condition is a name and
      // a number of stacks and nothing else - and it is a thing the table knows, so it
      // is asked for by targeting rather than tracked.
      const against = named(args[0]) ?? game.user?.targets?.first()?.actor ?? null;
      if (!against) {
        ui.notifications?.warn(
          `${actor.name} needs an opponent for the Might Clash. Target a token first.`
        );
        return;
      }

      const { postMightClash } = await import("../chat.mjs");
      return postMightClash(actor, against, {
        maneuverName: "Might Clash",
        reason: `${actor.name} against ${against.name}`
      });
    }

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

/** The wordings a duration can be written in, and the edges they come to. */
async function clockFor(duration) {
  const { EDGES } = await import("../durations.mjs");
  return {
    "turn": { edge: EDGES.END, next: false },
    "next-turn": { edge: EDGES.END, next: true },
    "start-of-turn": { edge: EDGES.START, next: false },
    "start-of-next-turn": { edge: EDGES.START, next: true },
    "encounter": { edge: EDGES.ENCOUNTER, next: false }
  }[String(duration).toLowerCase()] ?? null;
}

/**
 * Put something the character already holds on a clock.
 *
 * The kind is worked out from what they are holding rather than named, because an effect
 * saying "this lasts until the start of your next turn" is not also saying what sort of
 * thing it is - the file already said that when it granted it.
 */
export async function expiresAt(actor, name, duration) {
  if (!actor || !name) return false;

  const clock = await clockFor(duration);
  if (!clock) {
    console.warn(`DBU TTRPG | "${duration}" is not a duration this system knows.`);
    return false;
  }

  const key = String(name).toLowerCase();
  const { KINDS, lasting } = await import("../durations.mjs");

  // States first, then Conditions, then Resources - the order they are checked in makes
  // no practical difference, since a name is one of the three and not two of them.
  const kind = actor.system.states?.[key] ? KINDS.STATE
    : actor.system.conditions?.[key] ? KINDS.CONDITION
    : actor.system.resources?.[name] ? KINDS.RESOURCE
    : null;

  if (!kind) {
    console.warn(`DBU TTRPG | ${actor.name} is not holding "${name}", so nothing was put on a clock.`);
    return false;
  }

  return lasting(actor, { kind, key: (kind === KINDS.RESOURCE) ? name : key, ...clock, source: name });
}

/**
 * Enter a State, optionally on a clock.
 *
 * The counterpart of leaveState, which had no counterpart: nothing could put a State on
 * a character, so every State in the system arrived by somebody ticking a box. The
 * duration is named in the rulebook's own words and turned into edges where that rule
 * lives, rather than being counted here.
 */
export async function enterState(actor, name, level, duration, source = "") {
  if (!name) return false;

  const { setState } = await import("../conditions.mjs");
  const key = String(name).toLowerCase();

  // Already in it, and nothing happens: you cannot enter a State you are standing in,
  // and an effect that would put you in it again cannot lengthen your stay either. So
  // this is refused outright rather than quietly resetting the clock - a second
  // Arrogant Declaration must not buy another turn of Superior.
  if (Number(actor.system.states?.[key]) > 0) return false;

  const wanted = Number.isFinite(Number(level)) && (Number(level) > 0) ? Number(level) : 1;
  if (!await setState(actor, key, wanted)) return false;

  if (!duration) return true;

  const { lasting, EDGES, KINDS } = await import("../durations.mjs");
  const clocks = {
    "turn": { edge: EDGES.END, next: false },
    "next-turn": { edge: EDGES.END, next: true },
    "start-of-turn": { edge: EDGES.START, next: false },
    "start-of-next-turn": { edge: EDGES.START, next: true },
    "encounter": { edge: EDGES.ENCOUNTER, next: false }
  };

  const clock = clocks[String(duration).toLowerCase()];
  if (!clock) {
    console.warn(`DBU TTRPG | "${duration}" is not a duration this system knows.`);
    return true;
  }

  return lasting(actor, { kind: KINDS.STATE, key, ...clock, source: source || key });
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
