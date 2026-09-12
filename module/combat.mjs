/**
 * Rounds, turns and the Action economy.
 *
 * Foundry already tracks a Combat's rounds and turns, so this does not invent a second
 * notion of them - it listens to the one that exists and turns it into the things the
 * rules talk about: when a round turns over, whose turn it is, and what that costs.
 *
 * Half the Combat Conditions need this. Poisoned and Suffocating lose Life "at the end
 * of each of your turns", Prone is stood up from by spending an Action, Slowed takes
 * Actions away. None of them have anywhere to happen without it.
 */

import DBUCharacterData from "./data/actor-character.mjs";
import { fireMoment } from "./effects/moments-runtime.mjs";
import { replaceObject, setCondition } from "./conditions.mjs";

/**
 * Announce a Moment in chat, so the table can answer it.
 *
 * Automatic effects fire on their own and always did; what had nowhere to happen was a
 * triggered one. Every place this system offers an effect hangs off a card, and these
 * Moments had no card - so a Talent written "when the Combat Round begins, you may..."
 * was waiting for a button that did not exist anywhere.
 *
 * Imported when it is used rather than at the top: chat.mjs imports this module for the
 * Action economy, and two modules importing each other as they load is how one of them
 * ends up half-built. The same dance use-maneuver.mjs already does.
 */
async function announce(moment, options) {
  const { postMoment } = await import("./chat.mjs");
  return postMoment(moment, options);
}

/** Whether anybody here holds something that answers this Moment. */
async function anybodyAnswers(moment, uuids) {
  const { anyoneAnswers } = await import("./chat.mjs");
  return anyoneAnswers(moment, uuids);
}

/** Every character taking part, as Actors. */
function combatants(combat) {
  return (combat?.combatants ?? [])
    .map(c => c.actor)
    .filter(actor => actor?.type === "character");
}

/**
 * What a Combat Round turning over clears.
 *
 * Diminishing Offense counts attacks made this round; Diminishing Defense counts
 * attacks aimed at you and resets at the *start* of a round rather than the end, which
 * is the same moment from here.
 */
async function startRound(combat) {
  for (const actor of combatants(combat)) {
    await actor.update(newRoundFor(actor));
    await fireMoment(actor, "start-of-round");
  }

  await announce("start-of-round", {
    title: `Start of Combat Round ${combat.round}`,
    subjects: combatants(combat).map(actor => actor.uuid)
  });
}

/**
 * Everything a character gets back when a Combat Round turns over.
 *
 * One list, because two places clear it: the round itself, and the button on the sheet
 * for a table not running a formal Encounter. They had already drifted - the button was
 * leaving Actions spent - and a rule that is written twice is a rule that will.
 */
/**
 * What a character holds when they are not charging anything.
 *
 * Written out here because two places clear it and they had drifted: both wiped the
 * Maneuver and the count and left the Profile behind, so the character carried a
 * declaration for an attack they were no longer charging.
 */
export const NOT_CHARGING = Object.freeze({
  "system.charging.maneuverId": "",
  "system.charging.profile": "",
  "system.charging.charges": 0
});

/**
 * And the Combat Condition that came with it.
 *
 * Guard Down lasts exactly as long as the charging does, so throwing the charge away
 * has to take it too. Leaving an Encounter mid-charge used to clear the charge and
 * leave the Condition on the character for good.
 */
export async function stopCharging(actor) {
  if (actor.system.conditions?.["guard-down"]) await setCondition(actor, "guard-down", 0);
}

export function newRoundFor(actor) {
  return {
    "system.attacksThisRound": 0,
    // "You can't do more than 2 Absolute Attacks during a single Combat Round", so the
    // count belongs to the round exactly as the Diminishing ones do.
    "system.absoluteAttacksThisRound": 0,
    "system.diminishingDefense": 0,
    "system.actionsSpent.standard": 0,
    "system.actionsSpent.counter": 0,
    // Capacity is spent within a round and comes back with the next one.
    "system.capacity.spent": 0,
    "system.talentUses.round": [],
    "system.usedManeuvers": (actor.system.usedManeuvers ?? [])
      .filter(entry => !entry.startsWith("round:"))
  };
}

/** What entering a Combat Encounter clears, and what it announces. */
async function startEncounter(combat) {
  for (const actor of combatants(combat)) {
    await actor.update({
      "system.talentUses.encounter": [],
      "system.armedTalents": [],
      "system.usedManeuvers": [],
      "system.defeatsEscaped": 0,
      // Standing in it when it begins is one way of entering it, and it is this one -
      // so the button that offers the same thing to somebody who walks in later has
      // nothing left to offer these.
      "system.enteredEncounter": true,
      ...NOT_CHARGING,
      // Every Resource is lost when an Encounter ends, so one starts with none.
      "system.resources": replaceObject({})
    });
    await stopCharging(actor);
    await fireMoment(actor, "start-of-encounter");
  }

  await announce("start-of-encounter", {
    title: "Start of the Combat Encounter",
    subjects: combatants(combat).map(actor => actor.uuid)
  });
}

/**
 * Register the hooks that drive all of this.
 *
 * Only one client may act, or every change happens once per connected player. The GM's
 * client is that one, the same way relayed chat edits work.
 */
/** A turn beginning, said in chat. Its Moment is the turn-taker's own. */
async function announceTurn(actor, { skipped = false } = {}) {
  return announce("start-of-turn", {
    title: skipped
      ? `${actor.name}'s turn is skipped`
      : `Start of ${actor.name}'s turn`,
    subjectUuid: actor.uuid,
    subjectName: actor.name,
    subjects: [actor.uuid],
    detail: skipped ? "The turn still began and still ends - only the acting is lost." : ""
  });
}

/**
 * Begin a character's turn, and say whether the turn itself is theirs to take.
 *
 * **A skipped turn is still your turn.** You lost it; it did not stop existing. So both
 * of its edges arrive - the Moment fires as the turn begins, and `end-of-turn` fires
 * when the Order moves off them - and a duration written "until the start of your turn"
 * ends on one of them rather than outliving the character it was put on.
 *
 * That is what settles an asymmetry this function used to hold three ways at once. A
 * turn skipped for being Defeated fired no `start-of-turn` at all but fired `end-of-turn`
 * anyway; a turn skipped by the Determined State fired both; and the first turn of an
 * Encounter checked nothing, so a Defeated character standing first in the Order simply
 * took a turn. Written once, they cannot disagree.
 *
 * @returns {Promise<boolean>} Whether the character may act. False means pass the turn on.
 */
async function beginTurn(actor) {
  // Fired before anything is decided, because something may skip the turn as it begins
  // rather than for as long as it lasts - the Determined State ends and costs you the
  // turn in the same breath - so the answer has to be read after the Moment, not before.
  const { slots } = await fireMoment(actor, "start-of-turn");

  // Defeated keeps its place in the Initiative Order and is only skipped, so that
  // getting back up puts the character straight back into the round. Slowed at three
  // stacks skips it the same way.
  const skipped = Boolean(actor.system.defeated)
    || (actor.system.effects?.slots?.skipTurn === true)
    || (slots["turn.skip"] === true);

  await announceTurn(actor, { skipped });

  if (skipped) ui.notifications.info(`${actor.name} is skipped this round.`);
  return !skipped;
}

export function registerCombatHooks() {
  Hooks.on("combatStart", async combat => {
    if (!game.users.activeGM || (game.users.activeGM !== game.user)) return;
    await startEncounter(combat);
    await startRound(combat);
    // Through the same door as every other turn: a Defeated character standing first in
    // the Initiative Order used to be handed one, because this path checked nothing.
    const first = combat.combatant?.actor;
    if ((first?.type === "character") && !await beginTurn(first)) return combat.nextTurn();
  });

  // Foundry has a hook of its own for this, and it says which way the round moved.
  // Inferring it from a turn change worked but missed the case the tracker offers most
  // readily - stepping a round back, which must not hand out a fresh set of Actions.
  Hooks.on("combatRound", async (combat, updateData, options) => {
    if (!game.users.activeGM || (game.users.activeGM !== game.user)) return;
    if (options?.direction !== 1) return;
    await startRound(combat);
  });

  Hooks.on("combatTurnChange", async (combat, previous, current) => {
    if (!game.users.activeGM || (game.users.activeGM !== game.user)) return;

    // Nothing before the Encounter has begun. Pressing Begin Combat moves the turn from
    // nowhere to the first combatant, and Foundry reports that as a turn change - which
    // arrives before `combatStart` does, so the first thing in the log was somebody's
    // turn starting above the Encounter that had not started yet. There are no turns
    // before an Encounter, because there is no Encounter for them to be turns of.
    if (!combat.started) return;

    // Through the Combatant rather than by actor id, so an unlinked token gets its own
    // Actor rather than the one in the sidebar it was made from.
    const leaving = previous?.combatantId
      ? combat.combatants.get(previous.combatantId)?.actor : null;
    if (leaving?.type === "character") {
      await fireMoment(leaving, "end-of-turn");
      // Zeroed after the moment and not before it, since the moment is what reads it:
      // Compelled's Life Point loss asks how many Actions went into attacking during
      // the turn that just ended. "Since the last check" is what the counter means, and
      // this is the check - so it is reset for every character, Compelled or not.
      if (leaving.system.attackActionsThisTurn) {
        await leaving.update({ "system.attackActionsThisTurn": 0 });
      }
    }

    const arriving = combat.combatant?.actor;
    if ((arriving?.type === "character") && !await beginTurn(arriving)) {
      return combat.nextTurn();
    }
  });

  Hooks.on("deleteCombat", async combat => {
    if (!game.users.activeGM || (game.users.activeGM !== game.user)) return;

    // Read before the Combat is gone, and said after the clearing below: what is being
    // announced is that it is over, and it is not over until that has happened.
    const rounds = combat.round ?? 0;

    // Leaving an Encounter clears what only lasted for it.
    for (const actor of combatants(combat)) {
      await actor.update({
        "system.talentUses.encounter": [],
        "system.armedTalents": [],
        "system.usedManeuvers": [],
        "system.resources": replaceObject({}),
        "system.defeatsEscaped": 0,
        // The next Encounter is a different one, and begins for them again.
        "system.enteredEncounter": false,
        // A charge that was never thrown does not follow you out of the Encounter.
        ...NOT_CHARGING
      });
      await stopCharging(actor);
    }

    await announceEncounterEnd(rounds);
  });
}

/**
 * A line closing the Encounter.
 *
 * Nothing in the rules happens at the end of one, so this is not a Moment and carries
 * nobody to answer it - it is a marker, so that a log scrolled back through has an end to
 * each Encounter as well as a beginning. The day something does happen there, it becomes
 * a Moment like the rest and this grows the subjects to go with it.
 */
async function announceEncounterEnd(rounds) {
  return announce("end-of-encounter", {
    title: "End of the Combat Encounter",
    detail: rounds ? `${rounds} round${(rounds === 1) ? "" : "s"}` : "",
    subjects: []
  });
}

/**
 * The two moments around falling, which are deliberately not the same one.
 *
 * `defeated` fires *before* the defeat stands - that is the gap Undying reaches through
 * to set Life back to 1. `defeat-resolved` fires once it does, and is when you leave
 * every Transformation and State. Using one Moment for both would pull you out of a
 * Transformation on the way to a defeat that never happened.
 */
/**
 * Everyone who might answer something that happened to one character.
 *
 * The character themselves, and everyone else in the Encounter - both Moments here are
 * written so that somebody else can answer them: `defeated` says "name a character to
 * answer their defeat instead of your own", and being knocked through a Threshold is as
 * often worth something to whoever did the knocking.
 *
 * Outside an Encounter it is just the one character. There is no Initiative Order to
 * read, and announcing a defeat to a scene full of bystanders is not the same thing.
 */
function witnesses(actor) {
  const others = game.combat?.started ? combatants(game.combat) : [];
  return [...new Set([actor.uuid, ...others.map(other => other.uuid)])];
}

export function registerDefeatHooks() {
  Hooks.on("preUpdateActor", (actor, changes, options) => {
    if (actor.type !== "character") return;
    if (foundry.utils.getProperty(changes, "system.life.value") === undefined) return;
    options.dbuWasDefeated = actor.system.defeated;
    // Where they stood before the Life changed. A Health Threshold is derived from Life,
    // so crossing one leaves no record of its own - the only way to know it happened is
    // to have looked just before.
    options.dbuThreshold = actor.system.threshold.key;
  });

  Hooks.on("updateActor", async (actor, changes, options) => {
    if (actor.type !== "character") return;
    if (options.dbuWasDefeated === undefined) return;
    if (!game.users.activeGM || (game.users.activeGM !== game.user)) return;

    await announceThreshold(actor, options.dbuThreshold);

    const was = options.dbuWasDefeated;
    const now = actor.system.defeated;
    if (was === now) return;

    if (!now) {
      // Healed back above zero. Nothing to announce: the sheet already shows it, and
      // getting up under your own steam is not the once-per-Encounter rescue.
      return;
    }

    // Something may still catch them. Whatever answers this writes Life Points, and
    // the character is re-derived before the second Moment is even considered.
    await fireMoment(actor, "defeated", { damage: 0 });
    if (!actor.system.defeated) {
      // The rescue counts against the one allowed per Encounter.
      await actor.update({ "system.defeatsEscaped": (actor.system.defeatsEscaped ?? 0) + 1 });
      return;
    }

    // Whether anything is still coming decides what the card says, and whether the
    // defeat waits for it. Nothing to wait for is the common case, and then it is
    // settled here and announced as settled - a card saying "incoming defeat" that
    // nobody can answer is a step the table has to click past for no reason.
    const who = witnesses(actor);
    const pending = await anybodyAnswers("defeated", who);

    if (!pending) {
      await fireMoment(actor, "defeat-resolved");
    }

    await announce("defeated", {
      title: pending ? `${actor.name} - incoming defeat` : `${actor.name} is Defeated`,
      subjectUuid: actor.uuid,
      subjectName: actor.name,
      subjects: who,
      pending,
      detail: pending
        ? "Not settled yet - something here can still answer it."
        : ""
    });
  });
}

/**
 * Announce a Health Threshold somebody has been knocked through.
 *
 * Nothing fired this Moment before, and nothing announced it: the Threshold is derived
 * from Life Points, so crossing one left no trace and the Steadfast Check it calls for
 * was something a player had to notice on their own sheet.
 *
 * Only downward. Healing back up through a Threshold is not being knocked through one,
 * and it clears the Checks recorded below by itself.
 */
async function announceThreshold(actor, before) {
  if (!before) return;

  const { THRESHOLDS } = DBUCharacterData;
  const keys = Object.keys(THRESHOLDS);
  const now = actor.system.threshold.key;
  if (keys.indexOf(now) <= keys.indexOf(before)) return;

  // The Moment says it "fires after the Maneuver that pushed you through finishes",
  // and this is that: Life Points are written when the Damage is applied, which is the
  // last step of the Maneuver and a deliberate one.
  await fireMoment(actor, "threshold", { threshold: now });

  await announce("threshold", {
    title: `${actor.name} is knocked through a Health Threshold`,
    subjectUuid: actor.uuid,
    subjectName: actor.name,
    subjects: witnesses(actor),
    detail: `${THRESHOLDS[before].label} to ${THRESHOLDS[now].label}`
  });
}

// --- Actions -------------------------------------------------------------------

/** How many Actions of one kind a character has left this round. */
export function actionsLeft(actor, kind = "standard") {
  const available = actor.system.actions?.[kind] ?? 0;
  const spent = actor.system.actionsSpent?.[kind] ?? 0;
  return Math.max(0, available - spent);
}

/**
 * Spend Actions, refusing when there are not enough.
 *
 * @returns {Promise<boolean>} False when nothing was spent.
 */
export async function spendActions(actor, amount, kind = "standard") {
  if (amount <= 0) return true;

  // Only inside a Combat Encounter. Outside one there are no rounds, so nothing hands
  // the Actions back - spending them there would take them away for good. The guard
  // lives here, on the write, so a caller cannot forget it: one of them already had.
  if (!game.combat?.started) return true;

  if (actionsLeft(actor, kind) < amount) {
    ui.notifications.warn(
      `${actor.name} has no ${kind} Actions left this round.`
    );
    return false;
  }

  await actor.update({
    [`system.actionsSpent.${kind}`]: (actor.system.actionsSpent?.[kind] ?? 0) + amount
  });
  return true;
}

/** Hand Actions back, as winning free of Pinned does. */
export async function refundActions(actor, amount, kind = "standard") {
  if (amount <= 0) return;
  const spent = actor.system.actionsSpent?.[kind] ?? 0;
  return actor.update({
    [`system.actionsSpent.${kind}`]: Math.max(0, spent - amount)
  });
}

/** Whether it is this character's turn right now. */
export function isTheirTurn(actor) {
  const combat = game.combat;
  if (!combat?.started) return false;
  return combat.combatant?.actor?.uuid === actor.uuid;
}
