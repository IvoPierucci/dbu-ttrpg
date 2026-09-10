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

import { fireMoment } from "./effects/moments-runtime.mjs";
import { replaceObject } from "./conditions.mjs";

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
}

/**
 * Everything a character gets back when a Combat Round turns over.
 *
 * One list, because two places clear it: the round itself, and the button on the sheet
 * for a table not running a formal Encounter. They had already drifted - the button was
 * leaving Actions spent - and a rule that is written twice is a rule that will.
 */
export function newRoundFor(actor) {
  return {
    "system.attacksThisRound": 0,
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
      "system.charging.maneuverId": "",
      "system.charging.charges": 0,
      // Every Resource is lost when an Encounter ends, so one starts with none.
      "system.resources": replaceObject({})
    });
    await fireMoment(actor, "start-of-encounter");
  }
}

/**
 * Register the hooks that drive all of this.
 *
 * Only one client may act, or every change happens once per connected player. The GM's
 * client is that one, the same way relayed chat edits work.
 */
export function registerCombatHooks() {
  Hooks.on("combatStart", async combat => {
    if (!game.users.activeGM || (game.users.activeGM !== game.user)) return;
    await startEncounter(combat);
    await startRound(combat);
    const first = combat.combatant?.actor;
    if (first?.type === "character") await fireMoment(first, "start-of-turn");
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

    // Through the Combatant rather than by actor id, so an unlinked token gets its own
    // Actor rather than the one in the sidebar it was made from.
    const leaving = previous?.combatantId
      ? combat.combatants.get(previous.combatantId)?.actor : null;
    if (leaving?.type === "character") await fireMoment(leaving, "end-of-turn");

    const arriving = combat.combatant?.actor;
    if (arriving?.type === "character") {
      // Slowed at three stacks skips your turn entirely, so the turn is passed on
      // rather than begun.
      // Defeated keeps its place in the Initiative Order - it is only skipped - so that
      // getting back up puts the character straight back into the round.
      if (arriving.system.defeated || arriving.system.effects?.slots?.skipTurn) {
        ui.notifications.info(`${arriving.name} is skipped this round.`);
        return combat.nextTurn();
      }

      // Something may skip the turn as it begins rather than for as long as it lasts -
      // Determined ends and costs you the turn in the same breath - so the moment is
      // fired first and its answer read after.
      const fired = await fireMoment(arriving, "start-of-turn");
      if (fired?.["turn.skip"] === true) {
        ui.notifications.info(`${arriving.name} is skipped this round.`);
        return combat.nextTurn();
      }
    }
  });

  Hooks.on("deleteCombat", async combat => {
    if (!game.users.activeGM || (game.users.activeGM !== game.user)) return;
    // Leaving an Encounter clears what only lasted for it.
    for (const actor of combatants(combat)) {
      await actor.update({
        "system.talentUses.encounter": [],
        "system.armedTalents": [],
        "system.usedManeuvers": [],
        "system.resources": replaceObject({}),
        "system.defeatsEscaped": 0,
        // A charge that was never thrown does not follow you out of the Encounter.
        "system.charging.maneuverId": "",
        "system.charging.charges": 0
      });
    }
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
export function registerDefeatHooks() {
  Hooks.on("preUpdateActor", (actor, changes, options) => {
    if (actor.type !== "character") return;
    if (foundry.utils.getProperty(changes, "system.life.value") === undefined) return;
    options.dbuWasDefeated = actor.system.defeated;
  });

  Hooks.on("updateActor", async (actor, changes, options) => {
    if (actor.type !== "character") return;
    if (options.dbuWasDefeated === undefined) return;
    if (!game.users.activeGM || (game.users.activeGM !== game.user)) return;

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

    await fireMoment(actor, "defeat-resolved");
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="dbu-check"><div class="dbu-check-parts">Defeated</div></div>`
    });
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
