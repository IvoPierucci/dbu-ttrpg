/**
 * Using a Maneuver.
 *
 * Lifted out of the character sheet so that the button on the sheet and a macro dragged
 * to the hotbar do **the same thing** rather than two things that drift apart. Two code
 * paths for one action is how a rule ends up enforced in one place and not the other,
 * and this system has already been bitten by that once.
 */

import DBUCharacterData from "./data/actor-character.mjs";
import {
  allManeuvers,
  declareAttack,
  whyNotInReach,
  maneuverKiCost,
  maneuverUsesLeft,
  pickProfileOnly,
  recordManeuverUse,
  spendManeuverCost
} from "./maneuvers.mjs";
import {
  answeredLatestManeuver,
  postAttack,
  postManeuver,
  postSkillClash,
  takeSurge
} from "./chat.mjs";
import { actionsLeft, spendActions } from "./combat.mjs";
import { permits } from "./effects/interpreter.mjs";
import { refundActions } from "./combat.mjs";
import { fireMoment } from "./effects/moments-runtime.mjs";

/**
 * What a Maneuver costs from the Action economy, and out of which pool.
 *
 * An Instant Maneuver costs no Action - that is what makes it Instant - and one played
 * Out of Sequence is paid for by whatever granted it rather than by the Actions of a
 * turn that is not yours.
 */
function actionCostOf(maneuver) {
  if ((maneuver.type === "instant") || (maneuver.type === "outOfSequence")) {
    return { kind: "standard", amount: 0 };
  }
  return {
    kind: (maneuver.type === "counter") ? "counter" : "standard",
    amount: maneuver.actionCost ?? 1
  };
}

/**
 * Whether the Action economy allows this yet.
 *
 * Only inside a Combat Encounter: there are no rounds outside one, so there is nothing
 * to have spent and refusing would make every Maneuver unusable out of combat.
 */
function canAffordActions(actor, maneuver) {
  if (!game.combat?.started) return true;

  const { kind, amount } = actionCostOf(maneuver);
  if (amount <= 0) return true;
  if (actionsLeft(actor, kind) >= amount) return true;

  ui.notifications.warn(
    `${actor.name} has no ${kind} Actions left this round for ${maneuver.name}.`
  );
  return false;
}

/**
 * Whether anything the character is suffering from forbids this outright.
 *
 * Sleeping and Slowed at three stacks stop every Maneuver; Pinned and Transfigured stop
 * the Attacking ones. Refused by name, because "nothing happened" with no reason given
 * is how a table concludes the system is broken.
 */
function permitted(actor, maneuver) {
  const slots = actor.system.effects?.slots;

  if (actor.system.defeated) {
    ui.notifications.warn(`${actor.name} is Defeated and cannot act.`);
    return false;
  }

  // "Until you use the chosen Attacking Maneuver, you cannot use any other Attacking
  // Maneuver or Standard Maneuver." Two exceptions, both in the rule itself: the
  // declared attack, which is the whole point, and the Energy Charge Maneuver, which is
  // what "any use of the Energy Charge Maneuver instead grants an additional charge"
  // takes for granted.
  const charging = actor.system.charging;
  if (charging?.maneuverId && !maneuver.charge
    && (maneuver.itemId !== charging.maneuverId)
    && (maneuver.attacking || (maneuver.type === "standard"))) {
    const held = actor.items.get(charging.maneuverId);
    ui.notifications.warn(
      `${actor.name} is charging ${held?.name ?? "an Attacking Maneuver"} and cannot use `
      + "another Attacking or Standard Maneuver until it is thrown."
    );
    return false;
  }

  if (!permits(slots, "maneuvers")) {
    ui.notifications.warn(`${actor.name} cannot use any Maneuver right now.`);
    return false;
  }
  if (maneuver.attacking && !permits(slots, "attackingManeuvers")) {
    ui.notifications.warn(`${actor.name} cannot use Attacking Maneuvers right now.`);
    return false;
  }
  return true;
}

/** Take the Actions, once the Maneuver has actually committed. */
async function payActions(actor, maneuver) {
  const { kind, amount } = actionCostOf(maneuver);
  await spendActions(actor, amount, kind);
}

/**
 * A Maneuver Item, read as the plain shape the rest of the system expects.
 *
 * The engine, the chat cards and the cost rules all predate Maneuvers being documents
 * and speak in terms of a definition object. Converting here keeps that from having to
 * change everywhere at once.
 */
export function definitionOf(item) {
  return {
    id: item.system.maneuverId || item.id,
    itemId: item.id,
    name: item.name,
    type: item.system.type,
    actionCost: item.system.actionCost,
    kiCost: item.system.kiCost,
    kiCostPerBaseTier: item.system.kiCostPerBaseTier,
    attacking: item.system.attacking,
    requiresTarget: item.system.requiresTarget,
    defend: item.system.defend,
    surge: item.system.surge,
    charge: item.system.charge,
    cancelCharge: item.system.cancelCharge,
    profile: item.system.profile,
    tags: item.system.tags ?? [],
    source: item.system.source,
    description: item.system.description,
    usageLimit: item.system.limit,
    clash: item.system.clashSkill ? { skill: item.system.clashSkill } : null
  };
}

/**
 * Record whether this Maneuver leaves the character having just played an Instant.
 *
 * An Out-of-Sequence Maneuver deliberately leaves the flag alone: one played off the
 * back of an Instant does not count as a Maneuver in its place, so it cannot launder an
 * Instant into a legal follow-up.
 */
async function trackInstant(actor, type) {
  if (type === "outOfSequence") return;
  const wasInstant = type === "instant";
  if (actor.system.lastManeuverWasInstant === wasInstant) return;
  return actor.update({ "system.lastManeuverWasInstant": wasInstant });
}

/**
 * Use a Maneuver: check it is allowed, pay for it, and announce it.
 *
 * @param {Actor} actor
 * @param {object} maneuver  a definition, from definitionOf() or the core table
 * @returns {Promise<boolean>} False when nothing happened, for any reason.
 */
export async function useManeuver(actor, maneuver) {
  if (!actor || !maneuver) return false;

  // The sheet does not offer these, but a stale render should not be a way past the
  // rules either.
  if ((maneuver.type === "instant")
    && (actor.system.lastManeuverWasInstant || answeredLatestManeuver(actor))) {
    ui.notifications.warn(
      `${actor.name} just played an Instant Maneuver and cannot play another.`
    );
    return false;
  }

  if (maneuverUsesLeft(actor, maneuver) <= 0) {
    ui.notifications.warn(`${actor.name} has no uses of ${maneuver.name} left.`);
    return false;
  }

  if (!permitted(actor, maneuver)) return false;

  // Checked here and spent further down, so that a Maneuver abandoned at the target or
  // Profile prompt costs nothing - the same way its Ki Point Cost is handled.
  if (!canAffordActions(actor, maneuver)) return false;

  // A Surge is what the Maneuver does, and it can be declined once opened - so nothing
  // is spent or recorded until it has actually been taken.
  // Cancelling throws the charge away. Refused when there is none, because paying an
  // Action to undo nothing is not a choice anyone means to make.
  if (maneuver.cancelCharge) {
    if (!actor.system.charging?.maneuverId) {
      ui.notifications.warn(`${actor.name} is not charging anything.`);
      return false;
    }

    await payActions(actor, maneuver);
    await recordManeuverUse(actor, maneuver);
    await trackInstant(actor, maneuver.type);
    await cancelCharge(actor);
    await postManeuver(actor, maneuver);
    return true;
  }

  // Charging feeds an attack rather than being one. The first use declares which
  // Attacking Maneuver is being fed; every use after that only adds to the same one,
  // which is why it is settled before anything is paid for.
  if (maneuver.charge) {
    const declared = await declareCharge(actor);
    if (!declared) return false;

    await payActions(actor, maneuver);
    if (!await spendManeuverCost(actor, maneuver, maneuverKiCost(maneuver, null, actor))) {
      await refundActions(actor, actionCostOf(maneuver).amount, actionCostOf(maneuver).kind);
      return false;
    }

    await recordManeuverUse(actor, maneuver);
    await trackInstant(actor, maneuver.type);
    await postManeuver(actor, maneuver, { foundation: null });
    return true;
  }

  if (maneuver.surge) {
    // takeSurge announces the outcome itself, naming the Maneuver; announcing the
    // Maneuver separately would put the same event in chat twice.
    if (!await takeSurge(actor, { source: maneuver.name })) return false;
    await payActions(actor, maneuver);
    await recordManeuverUse(actor, maneuver);
    await trackInstant(actor, maneuver.type);
    return true;
  }

  // The target is resolved before anything is paid, so a Maneuver that cannot be aimed
  // does not cost Ki.
  let targetActor = null;
  if (maneuver.requiresTarget) {
    targetActor = game.user.targets.first()?.actor ?? null;
    if (!targetActor) {
      ui.notifications.warn(`${maneuver.name} needs a target. Target a token first.`);
      return false;
    }
    if (targetActor.uuid === actor.uuid) {
      ui.notifications.warn(`${maneuver.name} cannot target its own user.`);
      return false;
    }
  }

  // The Profile and its Foundation are declared before anything is paid, since both
  // choices can still be aborted - and the Profile is what sets the price.
  let declared = null;
  // Opened for an Attacking Maneuver even when it names no Profile: the Ki Wager
  // belongs to the attack rather than to the Profile, and Compelled sets a floor under
  // it that has to be asked for somewhere.
  if (maneuver.profile || maneuver.attacking) {
    // A charged attack was declared with a Profile, and that is the one it is made
    // with. Handed over as a Maneuver that names its own Profile, which is a shape the
    // picker already understands - it shows it rather than offering a choice.
    const charging = actor.system.charging;
    const locked = (charging?.maneuverId === maneuver.itemId) && charging.profile
      ? { ...maneuver, profile: charging.profile }
      : maneuver;

    declared = await declareAttack(locked, DBUCharacterData.FOUNDATIONS, actor);
    if (!declared) return false;
  }

    // A Physical Attack only reaches your Melee Range. Checked once the Profile and
    // Foundation are settled, since that is what decides whether the rule applies, and
    // before anything is paid - the declaration can still be taken back here.
    const outOfReach = targetActor && whyNotInReach(actor, targetActor, declared ?? {});
    if (outOfReach) {
      ui.notifications.warn(outOfReach);
      return false;
    }

  if (!await spendManeuverCost(actor, maneuver, maneuverKiCost(maneuver, declared, actor))) {
    return false;
  }

  await payActions(actor, maneuver);
  await recordManeuverUse(actor, maneuver);
  await trackInstant(actor, maneuver.type);

  // Whatever was charged into this one comes with it, and the charging ends here -
  // Guard Down with it. Only for the Maneuver that was actually declared: throwing a
  // different attack cannot collect somebody else's charges, and cannot happen anyway.
  const charges = (maneuver.itemId && (maneuver.itemId === actor.system.charging?.maneuverId))
    ? await collectCharges(actor)
    : 0;

  // Declared, now that it is certain to happen. An effect answering this reads the
  // Maneuver and who it is aimed at.
  await fireMoment(actor, "declare-maneuver", {
    maneuver,
    targets: targetActor ? [targetActor] : []
  });

  if (maneuver.clash) await postSkillClash(actor, targetActor, maneuver);
  else if (declared) await postAttack(actor, targetActor, maneuver, { ...declared, charges });
  else await postManeuver(actor, maneuver);

  return true;
}

/**
 * Declare what is being charged, or add to what already is.
 *
 * "Each time you would use the Energy Charge Maneuver after declaring an Attacking
 * Maneuver but before using the declared Attacking Maneuver, any use instead only
 * grants an additional Energy Charge to the originally declared Attacking Maneuver."
 * So the choice is offered once and never again until the attack is thrown.
 *
 * @returns {Promise<boolean>} False when nothing was declared and nothing should be paid.
 */
async function declareCharge(actor) {
  const charging = actor.system.charging;

  if (charging.maneuverId) {
    if (charging.charges >= DBUCharacterData.MAX_ENERGY_CHARGES) {
      ui.notifications.warn(
        `That Attacking Maneuver already carries ${DBUCharacterData.MAX_ENERGY_CHARGES} `
        + "Energy Charges, which is as many as one can hold."
      );
      return false;
    }
    await actor.update({ "system.charging.charges": charging.charges + 1 });
    return true;
  }

  // Only an Attacking Maneuver can be fed, and only one the character actually has.
  const options = actor.items
    .filter(item => (item.type === "maneuver") && item.system.attacking)
    .map(item => ({ id: item.id, name: item.name }));

  if (!options.length) {
    ui.notifications.warn(`${actor.name} has no Attacking Maneuver to charge.`);
    return false;
  }

  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: "Energy Charge" },
    content: `<div class="dbu-respond-dialog">
      <p class="dbu-respond-hint">Which Attacking Maneuver are you charging?</p>
      ${options.map((option, i) => `
        <label class="dbu-respond-option">
          <input type="radio" name="maneuver" value="${option.id}" ${i === 0 ? "checked" : ""}/>
          <span class="dbu-respond-name">${Handlebars.escapeExpression(option.name)}</span>
        </label>`).join("")}
    </div>`,
    buttons: [
      {
        action: "confirm",
        label: "Charge",
        callback: (event, button, dialog) =>
          dialog.element.querySelector('input[name="maneuver"]:checked')?.value ?? null
      },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });

  if (!chosen || (typeof chosen !== "string")) return false;

  // The Profile is part of the declaration: the attack has to be made with it when it
  // finally comes. Asked here rather than when it is thrown, which is the whole point
  // of declaring - by then it is settled.
  const held = actor.items.get(chosen);
  const profile = await pickProfileOnly(
    definitionOf(held),
    DBUCharacterData.FOUNDATIONS,
    `Which Profile is ${Handlebars.escapeExpression(held.name)} being charged for?`,
    actor
  );
  if (!profile) return false;

  await actor.update({
    "system.charging.maneuverId": chosen,
    "system.charging.profile": profile,
    "system.charging.charges": 1
  });

  // "Until you use the chosen Attacking Maneuver, you suffer from the Guard Down Combat
  // Condition" - applied here rather than written into the Maneuver's script, because
  // it lasts past the Maneuver that caused it.
  const { setCondition } = await import("./conditions.mjs");
  await setCondition(actor, "guard-down", 1);

  return true;
}

/**
 * Let go of a charge without throwing it.
 *
 * The Energy Charges are lost - that is what it costs - and everything the charging was
 * imposing goes with them: the Guard Down, and the hold on your other Attacking and
 * Standard Maneuvers.
 */
export async function cancelCharge(actor) {
  const held = actor.items.get(actor.system.charging?.maneuverId);
  const lost = actor.system.charging?.charges ?? 0;

  await clearCharging(actor);

  ui.notifications.info(
    `${actor.name} lets go of ${held?.name ?? "the charge"}, losing `
    + `${lost} Energy Charge${lost === 1 ? "" : "s"}.`
  );
}

/** Put the declaration down, and take Guard Down off with it. */
async function clearCharging(actor) {
  await actor.update({
    "system.charging.maneuverId": "",
    "system.charging.profile": "",
    "system.charging.charges": 0
  });

  const { setCondition } = await import("./conditions.mjs");
  await setCondition(actor, "guard-down", 0);
}

/** Everything the charge was holding, handed to the attack and let go of. */
export async function collectCharges(actor) {
  const { maneuverId, charges } = actor.system.charging;
  if (!maneuverId) return 0;

  await clearCharging(actor);
  return charges;
}

/** Use a Maneuver the character owns, by the Item's id. */
export async function useOwnedManeuver(actor, itemId) {
  const item = actor?.items?.get(itemId);
  if (!item || (item.type !== "maneuver")) {
    ui.notifications.warn("That Maneuver is not on this character any more.");
    return false;
  }
  return useManeuver(actor, definitionOf(item));
}

/**
 * Put a Maneuver on the hotbar as a macro.
 *
 * Dropping an Item on the hotbar normally opens its sheet; a Maneuver is something you
 * do, so the macro uses it instead - the same call the sheet's own button makes.
 */
export function registerHotbarDrop() {
  Hooks.on("hotbarDrop", (bar, data, slot) => {
    if (data?.type !== "Item") return;

    const item = fromUuidSync(data.uuid);
    if (!item || (item.type !== "maneuver") || !item.actor) return;

    // Returning false stops Foundry making its own macro for the drop.
    createManeuverMacro(item, slot);
    return false;
  });
}

async function createManeuverMacro(item, slot) {
  const command = `game.dbu.useManeuver("${item.actor.uuid}", "${item.id}");`;
  const existing = game.macros.find(m => (m.name === item.name) && (m.command === command));

  const macro = existing ?? await Macro.implementation.create({
    name: item.name,
    type: "script",
    img: item.img,
    command,
    flags: { "dbu-ttrpg": { maneuverId: item.id } }
  });

  return game.user.assignHotbarMacro(macro, slot);
}

/** Reachable from a macro, which cannot import anything. */
export function registerMacroApi() {
  game.dbu ??= {};
  game.dbu.useManeuver = async (actorUuid, itemId) => {
    const actor = fromUuidSync(actorUuid);
    if (!actor) {
      ui.notifications.warn("That character no longer exists.");
      return false;
    }
    if (!actor.isOwner) {
      ui.notifications.warn(`You do not control ${actor.name}.`);
      return false;
    }
    return useOwnedManeuver(actor, itemId);
  };
}

/** Where the published Maneuvers live once imported. */
const PACK = "dbu-ttrpg.maneuvers";

/** What a Maneuver definition becomes as an Item. */
export function maneuverItemFrom(definition) {
  return {
    name: definition.name,
    type: "maneuver",
    flags: { "dbu-ttrpg": { sourceId: definition.id } },
    system: {
      maneuverId: definition.id,
      type: definition.type,
      description: definition.description ?? "",
      source: definition.source ?? "",
      actionCost: definition.actionCost ?? 1,
      kiCost: definition.kiCost ?? 0,
      kiCostPerBaseTier: definition.kiCostPerBaseTier ?? 0,
      attacking: Boolean(definition.attacking),
      requiresTarget: Boolean(definition.requiresTarget),
      defend: Boolean(definition.defend),
      surge: Boolean(definition.surge),
      charge: Boolean(definition.charge),
      cancelCharge: Boolean(definition.cancelCharge),
      profile: definition.profile ?? "",
      clashSkill: definition.clash?.skill ?? definition.clashSkill ?? "",
      tags: definition.tags ?? [],
      usageLimit: definition.usageLimit
        ? `${definition.usageLimit.amount}/${definition.usageLimit.per}`
        : "",
      script: definition.script ?? "",
      text: definition.text ?? ""
    }
  };
}

/** Fill the Maneuvers compendium from the files, so there is something to drag. */
export async function importCoreManeuvers() {
  const pack = game.packs.get(PACK);
  if (!pack) {
    ui.notifications.error("The DBU Maneuvers compendium is missing.");
    return;
  }
  if (pack.locked) {
    ui.notifications.warn("The DBU Maneuvers compendium is locked. Unlock it and try again.");
    return;
  }

  const index = await pack.getIndex({ fields: ["flags.dbu-ttrpg.sourceId"] });
  // getIndex returns a Collection, which is not an Array: it has map and filter but
  // not flatMap, so it is spread before being treated as one.
  const existing = new Set([...index].flatMap(entry =>
    [entry.flags?.["dbu-ttrpg"]?.sourceId, entry.name].filter(Boolean)));

  const available = allManeuvers();
  // An empty source is not the same as nothing being missing, and saying "already
  // imported" when no file was read sends you looking in the wrong place entirely.
  if (!available.length) {
    ui.notifications.error(
      "No Maneuvers were read from traits/maneuvers/. Check the console for why."
    );
    return;
  }

  const missing = available.filter(m => !existing.has(m.id) && !existing.has(m.name));
  if (!missing.length) {
    ui.notifications.info("Every core maneuver is already in the compendium.");
    return;
  }

  await Item.implementation.createDocuments(missing.map(maneuverItemFrom), { pack: PACK });
  ui.notifications.info(`Imported ${missing.length} core maneuver(s) into the compendium.`);
}

/**
 * The Maneuvers every character starts with.
 *
 * Copied onto each one rather than shared, because that is what makes them draggable
 * and lets Signature Techniques and Unique Abilities sit in the same list. The cost is
 * that updating a Core Maneuver has to reach every character - which is what the reload
 * button is for.
 */
export function coreManeuverItems() {
  return allManeuvers()
    .filter(m => (m.source === "Core Rule") || !m.source)
    .map(maneuverItemFrom);
}
