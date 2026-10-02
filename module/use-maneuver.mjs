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
  MANEUVER_TYPES,
  PROFILES,
  allManeuvers,
  getManeuver,
  declareAttack,
  tailProfiles,
  TAIL_VARIANTS,
  TAIL_BASE_PROFILE,
  whyNotInReach,
  maxEnergyCharges,
  maneuverKiCost,
  sizeDifference,
  lifeWagerProblem,
  spendLifeWager,
  maneuverUsesLeft,
  pickProfileOnly,
  recordManeuverType,
  recordManeuverUse,
  spendManeuverCost,
  squaresAway,
  whyNotAnotherAbsolute,
  whyNotAnotherGrapple,
  whyNotAnotherInstant,
  whyNotLaunch,
  whyNotDrain,
  whyNotPin,
  MOVEMENT_SPEEDS,
  RAPID_MOVEMENT_PER_TIER,
  movementKiCost,
  movementSquares,
  whyNotWithinMelee,
  whyNotThisFoundation,
  whyNotModify,
  whyNotSpecial,
  whyNotThisProfile,
  recordProfileUse
} from "./maneuvers.mjs";
import {
  postAttack,
  postGrappleCheck,
  postManeuver,
  postSaveClash,
  postFeatureAttack,
  postSkillClash,
  postTransfiguration,
  offerDelayed,
  postThrust,
  takeSurge
} from "./chat.mjs";
import { actionsLeft, isTheirTurn, spendActions, NOT_CHARGING, stopCharging } from "./combat.mjs";
import { granted, permits } from "./effects/interpreter.mjs";
import { refundActions } from "./combat.mjs";
import { fireMoment } from "./effects/moments-runtime.mjs";
import { brokenByPowerUp, damageAttributeOffers, movementPayment, thrownAs,
  throwables, weaponAttack, weaponsFor, wieldedWeapons, MULTI_STORAGE_THROWS,
  throwsAllowed, throwsCopies, thrownWeaponAttack, weaponForms, activeForm,
  drawnBonuses, borrowedCategory, withBorrowed, buddyOnlyTechniques, activeBuddy, buddyHeader,
  buddyAttribute, targetableBuddy } from "./gear.mjs";
import { getTrait } from "./effects/traits.mjs";
import { emptiesCapacity } from "./signature.mjs";
import { ULTIMATES_PER_ENCOUNTER, buildArea, choicesOf, isBuilt, isUltimate, signatureOf,
  techniqueKiPerTier } from "./technique.mjs";
import { MAGNITUDES, atLongRange, magnitudeIndex } from "./maneuvers.mjs";
import { techniqueUseEntries, ultimatesUsed, whyNotTechnique, whyNotTechniqueAgainst }
  from "./technique-use.mjs";
// Imported as a bag rather than by name: `soarNote` is not async and cannot wait for a
// dynamic import, and use-maneuver.mjs already imports enough at the top.
import * as soarNames from "./environments.mjs";
import { featureDef as signatureFeature, requirementHolds, superProfileKiPerTier } from "./technique.mjs";
import { withGranted } from "./signature.mjs";
import * as gearReadingModule from "./gear.mjs";
import { SUPER_PROFILES, askFeatures, forcedFullWager, maxKiWager, maxLifeWager, minimumKiWager } from "./maneuvers.mjs";
import { askUnitedPartner } from "./united-attack.mjs";

/**
 * What a Maneuver costs from the Action economy, and out of which pool.
 *
 * An Instant Maneuver costs no Action - that is what makes it Instant - and one played
 * Out of Sequence is paid for by whatever granted it rather than by the Actions of a
 * turn that is not yours.
 */
function actionCostOf(maneuver, spent = null) {
  if ((maneuver.type === "instant") || (maneuver.type === "outOfSequence")) {
    return { kind: "standard", amount: 0 };
  }
  return {
    kind: (maneuver.type === "counter") ? "counter" : "standard",
    amount: spent ?? maneuver.actionCost ?? 1
  };
}

/**
 * How many Actions a Maneuver priced in a range is being given.
 *
 * "Action Cost: Variable (2~3 Actions)" - so the player says, between the two. Asked
 * before anything is paid, and the answer travels to the Maneuver's own script as
 * `actionsSpent`, since a Maneuver priced in a range is always one that does more for
 * more and has to know which.
 *
 * @returns {Promise<number|null>} the count, or null if the player backed out
 */
async function askActionsSpent(actor, maneuver) {
  const least = maneuver.actionCost ?? 1;
  const kind = (maneuver.type === "counter") ? "counter" : "standard";

  // "All of your remaining Actions (Min. 2)": nothing to ask - every one left, if that is enough.
  if (maneuver.spendsAllActions) {
    const left = game.combat?.started ? actionsLeft(actor, kind) : least;
    if (left < least) {
      ui.notifications.warn(`${maneuver.name} needs at least ${least} Actions.`);
      return null;
    }
    return left;
  }

  // Only what they can actually afford. Offering four Actions to somebody holding two is
  // offering a choice that ends in a refusal two steps later.
  const affordable = game.combat?.started
    ? actionsLeft(actor, kind)
    : (maneuver.actionCostMax || least);

  // "Action Cost: Variable", with no number after it - what you have left is the
  // ceiling. Which is a different thing from a Maneuver that names one and happens to be
  // unaffordable today, and reads differently to the player: one is a limit of the rule
  // and the other is a limit of the moment.
  const most = maneuver.actionCostOpen
    ? Math.max(least, affordable)
    : (maneuver.actionCostMax ?? 0);

  if (most <= least) return least;

  const ceiling = Math.min(most, Math.max(least, affordable));

  const options = [];
  for (let n = least; n <= ceiling; n++) {
    options.push({ action: String(n), label: `${n} Action${(n === 1) ? "" : "s"}` });
  }

  if (!options.length) {
    ui.notifications.warn(
      `${actor.name} needs at least ${least} ${kind} Action(s) for ${maneuver.name}.`);
    return null;
  }
  if (options.length === 1) return Number(options[0].action);

  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: `${maneuver.name} - Actions` },
    content: `<p>How many Actions is ${Handlebars.escapeExpression(actor.name)} giving
      this? Each one is worth more, and costs more.</p>`,
    buttons: [...options, { action: "cancel", label: "Cancel" }],
    rejectClose: false
  });

  return (chosen && (chosen !== "cancel")) ? Number(chosen) : null;
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
  // Finish Sign: "Until you use your declared Signature Technique, you cannot use the Energy Charge Maneuver".
  const finishing = maneuver.charge ? Array.from(actor.items ?? []).find(each => (each.type === "maneuver")
    && each.system?.unique?.finishSign && each.system.unique.finishTechnique) : null;
  const declaredFor = finishing ? actor.items.get(finishing.system.unique.finishTechnique) : null;
  if (declaredFor) {
    ui.notifications.warn(`${actor.name} declared ${declaredFor.name} through Finish Sign: no Energy Charge until it is used.`);
    return false;
  }

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

  // The rest of the family, which was declared and read by nobody. Six of the nine
  // things an effect could forbid had no reader at all, so Transfigured forbade
  // Signature Techniques and Unique Abilities and neither noticed, Stress Exhaustion
  // forbade Transformations and none were stopped, and Pinned and Staggered forbade
  // movement - which the system does not model, and is the one that still has nowhere
  // to be read.
  //
  // A tag rather than a list of names: "any Maneuver tagged uniqueAbility" is how the
  // rulebook writes it, and it is what the tags on a Maneuver are for.
  const refused = [
    [maneuver.attacking, "attackingManeuvers", "Attacking Maneuvers"],
    [(maneuver.tags ?? []).includes("signature"), "signatureTechniques", "Signature Techniques"],
    [(maneuver.tags ?? []).includes("uniqueAbility"), "uniqueAbilities", "Unique Abilities"],
    [(maneuver.tags ?? []).includes("transformation"), "transformations", "Transformations"]
  ].find(([applies, flag]) => applies && !permits(slots, flag));

  if (refused) {
    ui.notifications.warn(`${actor.name} cannot use ${refused[2]} right now.`);
    return false;
  }

  // And one named outright, for a rule that lists Maneuvers rather than describing them.
  if (maneuver.id && !permits(slots, `maneuver.${maneuver.id}`)) {
    ui.notifications.warn(`${actor.name} cannot use ${maneuver.name} right now.`);
    return false;
  }

  // "You cannot use any Special Maneuvers until you have gained access to them through an
  // effect." The other five kinds are yours naturally; this one is nobody's until
  // something says otherwise, so the question is asked the other way round - not "has
  // anything forbidden it" but "has anything granted it".
  //
  // The same Slot answers both, which is why the forbid above still applies: an effect can
  // grant access and another can take it away, and a Special Maneuver has to pass both.
  // Asked in one place, because there are two ways in - an effect that wrote `allow`, and
  // a Skill with the Ranks for it - and the refusal is more use than a no: what a player
  // wants to know is what would open it.
  const closed = whyNotSpecial(actor, maneuver);
  if (closed) {
    ui.notifications.warn(closed);
    return false;
  }

  return true;
}

/**
 * Hand Ki Points to somebody else.
 *
 * "For each Action spent on this Maneuver, you can transfer a number of Ki Points up to
 * twice your Might to the declared Ally. If the declared Ally is within your Melee
 * Range, double the amount of Ki Points you can transfer to them. Transferring Ki Points
 * does not reduce your Capacity."
 *
 * Written here rather than in the Maneuver's own file because what it does is ask two
 * questions and move a number between two characters, and a script changes values on the
 * character carrying it - there is no way for a file to reach somebody else.
 *
 * The last sentence is the one worth being careful about: Capacity is what caps your
 * spending within a round, and this deliberately does not touch it. So the Ki comes off
 * the pool and nothing else.
 *
 * @returns {Promise<boolean>} false if the player backed out, and nothing was moved.
 */
async function transferKi(actor, ally, actionsSpent) {
  if (!ally) {
    ui.notifications.warn(`${actor.name} needs an Ally to Empower. Target a token first.`);
    return false;
  }

  const might = actor.system.might ?? 0;

  // Within Melee Range doubles it. Unmeasurable is not within - out of combat there are
  // no Squares, and a rule about them is not enforced where there are none, which is the
  // same answer the Melee Range gives everywhere else.
  const squares = squaresAway(actor, ally);
  const reach = Math.max(0, actor.system.meleeRange ?? 0) + 1;
  const close = (squares !== null) && (squares <= reach);

  const cap = Math.max(0, Math.min(
    actionsSpent * 2 * might * (close ? 2 : 1),
    actor.system.ki.value
  ));

  if (cap <= 0) {
    ui.notifications.warn(`${actor.name} has no Ki Points to send.`);
    return false;
  }

  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: `Empower - ${ally.name}` },
    content: `<p>${Handlebars.escapeExpression(actor.name)} is sending Ki Points to
        ${Handlebars.escapeExpression(ally.name)}.</p>
      <label class="dbu-wager">
        <span>Ki Points</span>
        <input type="number" name="ki" value="${cap}" min="0" max="${cap}"/>
        <em>${actionsSpent} Action(s) &middot; twice your Might${close ? ", doubled for Melee Range" : ""}
          &middot; max ${cap}</em>
      </label>`,
    buttons: [
      {
        action: "send",
        label: "Send",
        callback: (event, button, dialog) =>
          Number(dialog.element.querySelector('input[name="ki"]')?.value)
      },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });

  const sent = Math.max(0, Math.min(cap, Math.floor(Number(chosen) || 0)));
  if (!sent) return false;

  // Off the pool and nothing else: "transferring Ki Points does not reduce your
  // Capacity", so what caps your spending for the round is left exactly where it was.
  await actor.update({ "system.ki.value": Math.max(0, actor.system.ki.value - sent) });

  // Theirs is written through the relay: the Ally is very often somebody else's.
  const { requestActorUpdate } = await import("./chat.mjs");
  // Genki: "While you have declared an Attacking Maneuver with this Super Profile for the effects of
  // Energy Charge, if an Ally would give you Ki Points through the Empower Maneuver, instead of gaining
  // those Ki points, you gain an additional Ki Wager that does not count towards your Capacity equal
  // to 1/2 of those Ki Points."
  const charged = ally.items?.get(ally.system.charging?.maneuverId ?? "");
  if (charged?.system?.signature?.superProfile === "genki") {
    const bonus = Math.floor(sent / 2);
    await requestActorUpdate(ally, { "system.charging.bonusWager": (Number(ally.system.charging.bonusWager) || 0) + bonus });
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="dbu-settled-note">Genki: ${Handlebars.escapeExpression(ally.name)} takes no Ki - `
        + `+${bonus} Ki Wager on ${Handlebars.escapeExpression(charged.name)} instead.</div>` });
    return true;
  }
  await requestActorUpdate(ally, {
    "system.ki.value": Math.min(ally.system.ki.max, ally.system.ki.value + sent)
  });

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="dbu-settled-note">${Handlebars.escapeExpression(actor.name)}
      sends <strong>${sent}</strong> Ki Points to
      ${Handlebars.escapeExpression(ally.name)}
      <em>Capacity untouched</em></div>`
  });

  return true;
}

/**
 * The Grappler lets go: "the Grappler can end a Grapple as an Instant Maneuver on their
 * turn."
 *
 * An Instant Maneuver, so it is bound by the rule that governs those - one cannot follow
 * another - and recorded as one afterwards, which is what holds the next.
 */
export async function releaseGrapple(actor) {
  const partner = fromUuidSync(actor.system.grapple?.partner ?? "");
  if (!partner) {
    ui.notifications.warn(`${actor.name} is not in a Grapple.`);
    return false;
  }
  if (actor.system.grapple.role !== "grappler") {
    ui.notifications.warn(
      `Only the Grappler can end a Grapple. ${actor.name} is the Grappled, and has to `
      + "escape it.");
    return false;
  }
  if (!isTheirTurn(actor)) {
    ui.notifications.warn(`${actor.name} can only end a Grapple on their own turn.`);
    return false;
  }

  const blocked = whyNotAnotherInstant(actor);
  if (blocked) {
    ui.notifications.warn(`${actor.name}: ${blocked}`);
    return false;
  }

  const { endGrapple } = await import("./chat.mjs");
  await endGrapple(actor, partner);

  const card = await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="dbu-settled-note">${Handlebars.escapeExpression(actor.name)}
      lets go of ${Handlebars.escapeExpression(partner.name)}
      <em>Grapple ended &middot; Instant Maneuver</em></div>`
  });

  await recordManeuverType(actor, "instant", { messageId: card?.id });
  return true;
}

/**
 * The Grappled tries to break free: "by spending 1 Action, the Grappled can make a
 * Grapple Check against the Grappler. If they win, they escape the Grapple. For each
 * Action spent after the first, increase the Dice Score of their Grapple Check by 1(T)
 * until the end of their turn."
 *
 * Not a Maneuver - Actions spent, and nothing else - so the Instant rule does not touch
 * it and neither does a usage limit.
 *
 * The Check is opened with the Grappler as challenger however it was started, because
 * the roles in a Grapple do not swap. Which is also what settles a tie: the Defender
 * takes one, and within a Grapple the Defender is always the Grappled.
 */
export async function escapeGrapple(actor) {
  const grappler = fromUuidSync(actor.system.grapple?.partner ?? "");
  if (!grappler) {
    ui.notifications.warn(`${actor.name} is not in a Grapple.`);
    return false;
  }
  if (actor.system.grapple.role !== "grappled") {
    ui.notifications.warn(
      `Only the Grappled escapes a Grapple. ${actor.name} is the Grappler, and can end `
      + "it instead.");
    return false;
  }

  if (game.combat?.started && (actionsLeft(actor, "standard") < 1)) {
    ui.notifications.warn(`${actor.name} has no Actions left this round.`);
    return false;
  }

  // One Action, one Check. Not a number bought in advance: the Actions after the first
  // buy a bonus on the attempts that follow, and you only make a second because the
  // first one lost - which a player cannot know until they have made it.
  if (!await spendActions(actor, 1, "standard")) return false;

  // What the earlier attempts this turn are worth to this one, read before this attempt
  // is counted: the first is made at no bonus, which is what "each Action spent after the
  // first" means.
  const already = actor.system.grapple.escapeActions ?? 0;
  await actor.update({ "system.grapple.escapeActions": already + 1 });

  const { postGrappleCheck } = await import("./chat.mjs");
  await postGrappleCheck(grappler, actor, {
    maneuverName: "Escaping a Grapple",
    kind: "escape",
    earlierAttempts: already,
    // The Grappled is the one doing something, so the card speaks for them even though
    // the Grappler is its challenger.
    speaker: ChatMessage.getSpeaker({ actor }),
    reason: already
      ? `${actor.name} tries again - attempt ${already + 1} this turn`
      : `${actor.name} spends an Action to break free`
  });

  return true;
}



/**
 * Whether to drop a stack of Power before gaining one.
 *
 * "You may remove a stack of Power before applying this effect." It looks like giving
 * something away and is not: two is the ceiling, so at two the gain would do nothing, and
 * what dropping one buys is a fresh clock on the stack you take back.
 *
 * @returns {Promise<?boolean>} true to drop one, false to keep them, null if the Maneuver
 *                              was backed out of
 */
async function askDropPower(actor) {
  const { stacks = 0, max = 0 } = actor.system.resources?.power ?? {};
  const full = max && (stacks >= max);

  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: "Power Up" },
    content: `<p>${Handlebars.escapeExpression(actor.name)} holds
        <strong>${stacks}</strong> stack(s) of Power.</p>
      <p class="dbu-respond-hint">${full
        ? "You are at the most Power you can hold, so gaining a stack does nothing on its "
          + "own. Drop the oldest and the one you take back starts its clock again."
        : "Dropping the oldest and taking a fresh stack back leaves you with as many as "
          + "you have now, on a clock that runs from this turn."}</p>`,
    buttons: [
      { action: "drop", label: "Drop the oldest first" },
      { action: "keep", label: "Keep them all" },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });

  if (!chosen || (chosen === "cancel")) return null;
  return chosen === "drop";
}

/**
 * Which Damage Attribute an attack is made with: the Foundation's own, or one something
 * worn offers in its place.
 *
 * @returns {Promise<?object|false>} `{label, value}` for the Wound Roll to use, false for
 *                                    the Foundation's own, null if backed out of
 */
/**
 * What a Signature Technique asks at Attack Declaration, all in one dialog where it can be: the
 * answers its features need that are the table's or the player's to give.
 *
 *   Transformation Boost  "if you are in a Form or Transcended Enhancement" - there are no
 *                         Transformations here yet, so it is asked
 *   Giga Flare            "Spend up to 2 Actions", 2(T) Ki and 2 Energy Charges each
 *   Super Combination     "any number of additional Actions", a rank of Alotta Lotta Attacks and
 *                         Peppering Blows and an Energy Charge each
 *   Powerbomb             whether to end the Grapple after, for its Wound
 *   Splitting             the other Opponents it is aimed at: those targeted, up to its limit
 *   two Areas             Multi-Profile with two AoEs: "the player picks"
 *
 * @returns {Promise<?object>} the answers to add to the declaration, or null if cancelled
 */
async function askTechniqueDeclaration(actor, technique, declared, target) {
  const has = id => (declared.advantages ?? []).includes(id);
  const ranks = id => (declared.advantages ?? []).filter(entry => entry === id).length;
  const answers = {};
  const fields = [];
  const tier = actor.system.tierOfPower ?? 1;
  const left = actionsLeft(actor, "standard");

  // Final Chance: "if you are below the Injured Health Threshold, you may reduce your Life Points to
  // 0 at Attack Declaration to increase the Ki Wager by an equal amount" - outside every limit on the
  // wager, and no Capacity spent on it (the user's rulings).
  const life = Number(actor.system.life?.value) || 0;
  if (has("final-chance") && technique.ultimate && ["injured", "critical"].includes(actor.system.threshold?.key)
    && (life > 0)) {
    fields.push(`<label class="dbu-respond-option"><input type="checkbox" name="finalChance"/>
      <span class="dbu-respond-name">Final Chance: Life Points to 0, +${life} Ki Wager</span>
      <span class="dbu-respond-source">not Defeated until this attack is done</span></label>`);
  }
  if (has("transformation-boost") && technique.ultimate) {
    fields.push(`<label class="dbu-respond-option"><input type="checkbox" name="transformed"/>
      <span class="dbu-respond-name">In a Form or Transcended Enhancement</span>
      <span class="dbu-respond-source">Transformation Boost: +1 Energy Charge</span></label>`);
  }
  const superProfile = technique.superProfile ?? "";
  if (superProfile === "giga-flare") {
    const most = Math.min(2, left - (technique.actionCost ?? 1));
    fields.push(`<label class="dbu-respond-option"><span class="dbu-respond-name">Giga Flare: extra Actions</span>
      <input type="number" name="gigaFlare" value="0" min="0" max="${Math.max(0, most)}"/>
      <span class="dbu-respond-source">each 2(T) KP and 2 Energy Charges</span></label>`);
  }
  if (superProfile === "super-combination") {
    const most = Math.max(0, left - (technique.actionCost ?? 1));
    fields.push(`<label class="dbu-respond-option"><span class="dbu-respond-name">Super Combination: extra Actions</span>
      <input type="number" name="superCombination" value="0" min="0" max="${most}"/>
      <span class="dbu-respond-source">each a rank of Alotta Lotta Attacks and Peppering Blows, and an Energy Charge</span></label>`);
  }
  const grapple = actor.system.grapple ?? {};
  if (has("powerbomb") && target && (grapple.role === "grappler") && (grapple.partner === target.uuid)) {
    fields.push(`<label class="dbu-respond-option"><input type="checkbox" name="powerbomb"/>
      <span class="dbu-respond-name">Powerbomb: end the Grapple after this attack</span>
      <span class="dbu-respond-source">+1/2 Might Wound per rank; no Grapple until your next turn</span></label>`);
  }
  const areaProfiles = [declared.profile, technique.secondProfile].filter(id => PROFILES[id]?.area);
  if (areaProfiles.length > 1) {
    fields.push(`<label class="dbu-respond-option"><span class="dbu-respond-name">Area of Effect</span>
      <select name="areaFrom">${areaProfiles.map(id =>
        `<option value="${id}">${Handlebars.escapeExpression(PROFILES[id].label)}</option>`).join("")}</select></label>`);
  }

  // Splitting: "select up to 2 Opponents (First Rank) or up to 4 Opponents (Second Rank)" - the
  // tokens targeted. Who is an Opponent is the player's to say by targeting them.
  if (has("splitting") && target) {
    const most = (ranks("splitting") >= 2) ? 4 : 2;
    const others = [...new Set(Array.from(game.user.targets ?? []).map(token => token.actor)
      .filter(other => other && (other.uuid !== target.uuid) && (other.uuid !== actor.uuid)))];
    if ((others.length + 1) > most) {
      ui.notifications.warn(`${technique.name}: Splitting reaches up to ${most} Opponents; ${others.length + 1} are targeted.`);
      return null;
    }
    answers.extraTargets = others.map(other => ({ uuid: other.uuid, name: other.name }));
  }

  if (fields.length) {
    const got = await foundry.applications.api.DialogV2.wait({
      classes: ["dbu-dialog"],
      window: { title: technique.name },
      content: `<div class="dbu-respond-options">${fields.join("")}</div>`,
      buttons: [
        { action: "confirm", label: "Declare", callback: (event, button, dialog) => {
          const form = dialog.element;
          const num = name => Math.max(0, Number(form.querySelector(`[name="${name}"]`)?.value) || 0);
          const box = name => Boolean(form.querySelector(`[name="${name}"]`)?.checked);
          return { transformed: box("transformed"), finalChance: box("finalChance"),
            gigaFlare: Math.min(2, num("gigaFlare")),
            superCombination: num("superCombination"), powerbomb: box("powerbomb"),
            areaFrom: form.querySelector('[name="areaFrom"]')?.value ?? "" };
        } },
        { action: "cancel", label: "Cancel" }
      ],
      rejectClose: false
    });
    if (!got || (got === "cancel")) return null;
    Object.assign(answers, got);
  }

  if (answers.finalChance) answers.finalChanceLife = life;
  const extraActions = (answers.gigaFlare ?? 0) + (answers.superCombination ?? 0);
  if (extraActions) {
    answers.extraActions = extraActions;
    // Giga Flare's own price: "2(T) per Action spent through its effects".
    if (answers.gigaFlare) answers.kiSurcharge = 2 * answers.gigaFlare * tier;
  }
  return answers;
}

async function askDamageAttribute(actor, foundationKey, offers) {
  const attributes = actor.system.attributes ?? {};
  const named = key => `${key.charAt(0).toUpperCase()}${key.slice(1)}`;
  const own = DBUCharacterData.FOUNDATIONS[foundationKey]?.attribute;
  const signed = value => (value >= 0 ? `+${value}` : String(value));

  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: "Damage Attribute" },
    content: "",
    buttons: [
      ...(own ? [{ action: "own",
        label: `${named(own)} ${signed(attributes[own]?.mod ?? 0)}` }] : []),
      ...offers.map(offer => ({
        action: offer.attribute,
        label: `${named(offer.attribute)} ${signed(attributes[offer.attribute]?.mod ?? 0)}`
      })),
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });

  if (!chosen || (chosen === "cancel")) return null;
  if (chosen === "own") return false;
  const offer = offers.find(entry => entry.attribute === chosen);
  if (!offer) return null;
  return { label: `${named(offer.attribute)} Modifier`,
    value: attributes[offer.attribute]?.mod ?? 0 };
}

/**
 * Drop one stack of Power, and the clock that was holding it.
 *
 * The oldest clock, which is the one that would have run out first: dropping a stack and
 * keeping the clock that was about to end it would be giving the stack away twice.
 */
async function dropPowerStack(actor) {
  const { replaceObject } = await import("./conditions.mjs");

  const resources = { ...(actor.system.resources ?? {}) };
  const held = resources.power;
  if (!held?.stacks) return;

  const left = held.stacks - 1;
  if (left > 0) resources.power = { ...held, stacks: left };
  else delete resources.power;

  // The entry with the fewest edges left to wait is the one nearest running out.
  const timed = [...(actor.system.timed ?? [])];
  let soonest = -1;
  for (let i = 0; i < timed.length; i++) {
    const entry = timed[i];
    if ((entry.kind !== "resource") || (entry.key !== "power")) continue;
    if ((soonest < 0) || ((entry.edges ?? 1) < (timed[soonest].edges ?? 1))) soonest = i;
  }
  if (soonest >= 0) timed.splice(soonest, 1);

  await actor.update({
    "system.resources": replaceObject(resources),
    "system.timed": timed
  });
}

/**
 * Every Signature Technique this character has access to.
 *
 * A Technique is a Maneuver Item of their own tagged `signature`. The Maneuver that
 * throws them carries the tag too - a rule forbidding Signature Techniques has to stop
 * the only door to one - so the door is kept out of its own list.
 */
export function signatureTechniquesOf(actor) {
  // Not a Warrior Buddy's: that one is thrown through the Buddy alone.
  const buddys = new Set(buddyOnlyTechniques(actor.items.contents ?? Array.from(actor.items), getTrait));
  return actor.items
    .filter(item => (item.type === "maneuver")
      && (item.system.tags ?? []).includes("signature")
      && !item.system.signatureTechnique && !buddys.has(item.id))
    .map(definitionOf)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The two Disadvantages that are the table's word, asked as the Technique is used.
 *
 * Concentration: "You cannot use this Signature Technique through the Signature Technique
 * Maneuver if you are within an Opponent's Melee Range." Who has the user in their Melee Range is
 * measured; who is an Opponent is not something this system assumes, so it asks about them.
 *
 * Sneak Attack: "You can only use this Signature Technique when Hidden, and all of your target(s)
 * ... must be your Oblivious Characters." Neither exists here yet, so it is the player's word.
 */
async function techniqueTableQuestions(actor, technique) {
  const has = id => (technique.advantages ?? []).includes(id);
  const ask = async (title, content) => foundry.applications.api.DialogV2.confirm({
    classes: ["dbu-dialog"], window: { title }, content, rejectClose: false });
  if (has("concentration")) {
    const near = [...new Map((canvas?.tokens?.placeables ?? [])
      .map(token => token.actor)
      .filter(other => other && (other.uuid !== actor.uuid) && (other.type === "character")
        && (squaresAway(other, actor) !== null) && !whyNotWithinMelee(other, actor, ""))
      .map(other => [other.uuid, other])).values()];
    if (near.length) {
      const names = near.map(other => Handlebars.escapeExpression(other.name)).join(", ");
      const opponent = await ask(`${technique.name} - Concentration`,
        `<p>${names} ${(near.length === 1) ? "has" : "have"} ${Handlebars.escapeExpression(actor.name)} `
        + "in Melee Range. Is any of them an Opponent? If so, this Technique cannot be used.</p>");
      if (opponent) {
        ui.notifications.warn(`${technique.name}: Concentration - an Opponent is too close.`);
        return false;
      }
    }
  }
  // Sneak Attack: "You can only use this Signature Technique when Hidden, and all of your target(s) for this Attacking
  // Maneuver must be your Oblivious Characters" - Hidden from every one of them.
  if (has("sneak-attack")) {
    const { isHiddenFrom } = await import("./hidden.mjs");
    const aimed = Array.from(game.user.targets ?? []).map(token => token.actor).filter(Boolean);
    const seen = aimed.filter(target => !isHiddenFrom(actor, target));
    if (!aimed.length || seen.length) {
      ui.notifications.warn(`${technique.name}: Sneak Attack - ${actor.name} is not Hidden from ${
        seen.map(target => target.name).join(", ") || "anyone targeted"}.`);
      return false;
    }
  }
  return true;
}

/**
 * Which Signature Technique is being thrown.
 *
 * Asked before anything is paid, like every other question this Maneuver could still be
 * abandoned at. What each one costs is shown beside it, because that cost is this
 * Maneuver's cost - "each Signature Technique will have their own KP Cost, that is the
 * KP Cost you pay for this Maneuver" - and it is the only thing that differs between the
 * options at the moment of choosing.
 *
 * @returns {Promise<?object>} the Technique's definition, or null if nothing was chosen
 */
async function pickSignatureTechnique(actor, maneuver) {
  const techniques = signatureTechniquesOf(actor);

  if (!techniques.length) {
    ui.notifications.warn(
      `${actor.name} has no Signature Techniques. Build one on the Signature Techniques tab.`);
    return null;
  }

  let checked = false;

  const options = techniques.map(technique => {
    const cost = maneuverKiCost(technique, null, actor);
    // Its own limit, if it was given one. The door's [1/Round] is a limit across all of
    // them; this is a limit on this one, and the two are different statements.
    // Refused for a reason of its own - an Ultimate spent this Encounter, a Restricted one out of
    // its place - is shown and cannot be picked, with the reason beside it.
    const refused = whyNotTechnique(actor, technique);
    const spent = (maneuverUsesLeft(actor, technique) <= 0) || Boolean(refused);
    const first = !spent && !checked;
    if (first) checked = true;
    // The Profile's own cost is not in that number - it is added once the Profile is
    // declared, which happens after this - so a Technique that names one says which
    // rather than a price that would be wrong.
    const profile = technique.profile && (technique.profile !== "any")
      ? PROFILES[technique.profile]?.label ?? technique.profile
      : "";
    const note = [
      cost ? `${cost} KP` : "",
      profile,
      refused || (spent ? `no uses left this ${technique.usageLimit?.per ?? "encounter"}` : "")
    ].filter(Boolean).join(" \u00b7 ");

    return `<label class="dbu-technique${spent ? " dbu-technique-spent" : ""}">
        <input type="radio" name="technique" value="${technique.itemId}"
               ${first ? "checked" : ""} ${spent ? "disabled" : ""}/>
        <span class="dbu-technique-name">${Handlebars.escapeExpression(technique.name)}</span>
        ${note ? `<span class="dbu-technique-note">${note}</span>` : ""}
      </label>`;
  }).join("");

  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: maneuver.name },
    content: `<p class="dbu-respond-hint">Which Signature Technique? This Maneuver costs
        1 Action and may be used once a Combat Round, whichever you pick.</p>
      <div class="dbu-technique-picker">${options}</div>`,
    buttons: [
      {
        action: "confirm",
        label: "Confirm",
        callback: (event, button, dialog) =>
          dialog.element.querySelector('input[name="technique"]:checked')?.value ?? null
      },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });

  return (typeof chosen === "string")
    ? techniques.find(technique => technique.itemId === chosen) ?? null
    : null;
}

/**
 * The Technique, used through the door.
 *
 * Which half wins is the whole of the rule. The door keeps what it charges and what it
 * limits: 1 Action, once a Combat Round, and the id the use is recorded against - that
 * last one is what makes [1/Round] a limit across every Technique rather than one
 * apiece. The Technique keeps everything about the attack, its own Item id included, so
 * its script fires and a charge declared on it is collected by it.
 *
 * `requiresTarget` is the door's: "Blast an Opponent away" is an Opponent whatever the
 * Technique's own header was left set to.
 */
function throughSignatureTechnique(door, technique) {
  return {
    ...technique,
    id: door.id,
    type: door.type,
    actionCost: door.actionCost,
    actionCostMax: 0,
    actionCostOpen: false,
    usageLimit: door.usageLimit,
    requiresTarget: true,
    // The union, so a Technique carrying a tag of its own keeps it and the door's
    // `signature` is there however the Technique was built.
    tags: [...new Set([...(door.tags ?? []), ...(technique.tags ?? [])])],
    signature: true,
    // Not a door itself, or using it would ask which Technique again.
    signatureTechnique: false,
    // What is left of the Technique to count separately. Only its limit: everything else
    // about it is what this definition already is.
    through: technique.usageLimit
      ? { id: technique.id, name: technique.name, usageLimit: technique.usageLimit }
      : null
  };
}


/**
 * The Modifier Maneuvers this character could apply to the one they are doing.
 *
 * Theirs, applicable, and with a use left - a Modifier limited to once a round is out of
 * uses like anything else. What it would cost is worked out here too, since that is the
 * whole of what a player weighs when they are offered one.
 */
export function modifiersFor(actor, base) {
  return actor.items
    .filter(item => (item.type === "maneuver") && (item.system.type === "modifier"))
    .map(definitionOf)
    .filter(modifier => !whyNotModify(modifier, base))
    .map(modifier => ({
      modifier,
      // The Base Maneuver's currency: a Modifier is part of doing that Maneuver rather
      // than a second thing done beside it, so a Modifier on a Counter costs Counter
      // Actions.
      actions: modifier.actionCost ?? 0,
      kind: (base.type === "counter") ? "counter" : "standard",
      ki: maneuverKiCost(modifier, null, actor),
      left: maneuverUsesLeft(actor, modifier)
    }))
    .sort((a, b) => a.modifier.name.localeCompare(b.modifier.name));
}

/**
 * Which Modifier Maneuvers are being applied to this one.
 *
 * Asked before anything is paid, with the rest of what can still be taken back: a
 * Modifier costs Actions and Ki, and a player who sees the price and changes their mind
 * has to be able to change it.
 *
 * Several at once, because nothing in the rule says one - "certain Maneuvers that can be
 * applied onto other Maneuvers" is a list, not a choice between them.
 *
 * @returns {Promise<?object[]>} the chosen entries, or null if the Maneuver was dropped
 */
async function askModifiers(actor, base, target = null) {
  const offered = modifiersFor(actor, base);
  if (!offered.length) return [];

  const rows = offered.map(entry => {
    const price = [
      entry.actions ? `${entry.actions} ${entry.kind} Action(s)` : "",
      entry.ki ? `${entry.ki} KP` : ""
    ].filter(Boolean).join(" \u00b7 ") || "free";
    const spent = entry.left <= 0;

    return `<label class="dbu-respond-option${spent ? " dbu-respond-blocked" : ""}"
             ${spent ? `data-tooltip="No uses of this left."` : ""}>
        <input type="checkbox" name="modifier" value="${entry.modifier.itemId}"
               ${spent ? "disabled" : ""}/>
        <span class="dbu-respond-name">${Handlebars.escapeExpression(entry.modifier.name)}</span>
        <span class="dbu-respond-source">${Handlebars.escapeExpression(price)}</span>
      </label>`;
  }).join("");

  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: `${base.name} - Modifier Maneuvers` },
    content: `<p class="dbu-respond-hint">Applied onto this ${
        Handlebars.escapeExpression(base.name)}. What each costs is on top of what the
        Maneuver itself costs.</p>
      <div class="dbu-respond-dialog">${rows}</div>`,
    buttons: [
      {
        action: "confirm",
        label: "Confirm",
        callback: (event, button, dialog) =>
          [...dialog.element.querySelectorAll('input[name="modifier"]:checked')]
            .map(input => input.value)
      },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });

  if (!Array.isArray(chosen)) return null;

  const taken = offered.filter(entry => chosen.includes(entry.modifier.itemId));

  // "State the area you targeted with this Attacking Maneuver." Asked once each, after
  // they have been chosen and before anything is paid - the answer is for the table to
  // read rather than for the system to act on, so an empty one is an answer too.
  for (const entry of taken) {
    if (!entry.modifier.asks) continue;
    const said = await askModifierNote(entry.modifier, target);
    if (said === null) return null;
    entry.note = said.note;
    entry.atApparel = said.atApparel;
    entry.atWeapon = said.atWeapon;
    entry.atBuddy = said.atBuddy;
  }

  return taken;
}

/**
 * What the card keeps of what was applied to an attack.
 *
 * The numbers and the words, and nothing else: an attack is settled minutes later and
 * often on another client, so what was applied has to be on the card rather than looked
 * up from the Item - which may have been edited in between, or belong to somebody whose
 * Actor that client cannot reach.
 *
 * A Modifier Maneuver is the usual source and no longer the only one: the Feint Maneuver
 * hands its Basic Attack an entry of the same shape, because what the list holds is "a
 * named thing that changed this attack" and that is what a Feint is to the attack it
 * bought.
 */
export function appliedModifiers(entries) {
  return (entries ?? []).map(entry => ({
    id: entry.modifier.id,
    name: entry.modifier.name,
    damageCategoryShift: entry.modifier.damageCategoryShift ?? 0,
    strikePerTier: entry.modifier.strikePerTier ?? 0,
    woundPerTier: entry.modifier.woundPerTier ?? 0,
    note: entry.note ?? "",
    // A Called Shot at a piece of Apparel: its Break Value on a hit, and half the Damage.
    atApparel: Boolean(entry.atApparel),
    // Or at one of the target's Weapons: its Life Points on a hit, and nothing to them.
    atWeapon: entry.atWeapon ?? null,
    // Or at their Active Buddy: destroyed on a hit, and nothing to them.
    atBuddy: entry.atBuddy ?? null
  }));
}

/**
 * The one question a Modifier Maneuver asks as it is applied.
 *
 * In the rulebook's own words, because the words are the question - "state the area you
 * targeted with this Attacking Maneuver" is not a list to choose from, and Called Shot's
 * five examples are examples rather than options. What is typed goes on the attack's card
 * for the ARC and the table to rule on.
 *
 * Where it may be aimed at a piece of Apparel - the Called Shot - that is asked beside it.
 *
 * @returns {Promise<?{note: string, atApparel: boolean}>} what was said, or null if the whole
 *   thing was dropped
 */
async function askModifierNote(modifier, target = null) {
  const escape = Handlebars.escapeExpression;
  // "An Opponent can use a Called Shot to target a Weapon with an Attacking Maneuver, reducing
  // its Life Points if it hits" - one of the target's, in hand.
  const weapons = (modifier.targetsApparel && target) ? wieldedWeapons(target.items.contents) : [];
  // "Make a Called Shot against a Character with an Active Buddy, claiming the Buddy as the target."
  const buddy = (modifier.targetsApparel && target) ? targetableBuddy(target.items.contents, getTrait) : null;
  const aim = (value, label, tip) => `
      <label class="dbu-wager" data-tooltip="${escape(tip)}">
        <input type="radio" name="aim" value="${escape(value)}" ${value ? "" : "checked"}/>
        <span>${escape(label)}</span>
      </label>`;
  const said = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: modifier.name },
    content: `
      <label class="dbu-wager">
        <span>${escape(modifier.asks)}</span>
        <input type="text" name="note" value=""/>
        <em>Written on the card in your own words. What it comes to is the ARC's.</em>
      </label>${modifier.targetsApparel ? [
        aim("", "Them", "The Damage is theirs, as any attack's."),
        aim("apparel", "A piece of Apparel",
          "On a hit, its Break Value is 1 lower - the Top Layer's - and they take half the Damage."),
        ...weapons.map(item => aim(`weapon:${item.id}`, item.name,
          "On a hit, the Weapon takes the blow, less its Damage Reduction - and they take nothing.")),
        ...(buddy ? [aim("buddy", `Their ${buddy.name}`,
          "On a hit, the Buddy is destroyed - and they take nothing. Not if they Guard or take a Direct Hit.")] : [])
      ].join("") : ""}`,
    buttons: [
      {
        action: "confirm",
        label: "Confirm",
        callback: (event, button, dialog) => {
          const chosen = String(dialog.element.querySelector('input[name="aim"]:checked')?.value ?? "");
          const item = chosen.startsWith("weapon:") ? weapons.find(each => `weapon:${each.id}` === chosen) : null;
          return {
            note: String(dialog.element.querySelector('input[name="note"]').value ?? "").trim(),
            atApparel: chosen === "apparel",
            atWeapon: item ? { itemId: item.id, name: item.name, ownerUuid: target.uuid } : null,
            atBuddy: ((chosen === "buddy") && buddy)
              ? { itemId: buddy.id, name: buddy.name, ownerUuid: target.uuid } : null
          };
        }
      },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });

  return (said && (typeof said === "object")) ? said : null;
}

/**
 * Pay for the Modifiers, and let each of them do what it does.
 *
 * Everything is checked before anything is spent: a character who can afford the first of
 * two and not the second must not be left having paid for the first. Anything that fires
 * afterwards is in place before the Base Maneuver is declared, which is what "applied onto
 * the Maneuver you are doing" means for a roll.
 *
 * @returns {Promise<boolean>} false when nothing was paid and nothing should happen
 */
async function applyModifiers(actor, applied) {
  if (!applied.length) return true;

  const actions = { standard: 0, counter: 0 };
  let ki = 0;
  for (const entry of applied) {
    actions[entry.kind] += entry.actions;
    ki += entry.ki;
  }

  for (const [kind, amount] of Object.entries(actions)) {
    if (amount && (actionsLeft(actor, kind) < amount)) {
      ui.notifications.warn(
        `${actor.name} needs ${amount} ${kind} Action(s) for those Modifier Maneuvers.`);
      return false;
    }
  }

  // One price for all of them, so the Capacity check is made against the whole of what is
  // being spent rather than against each piece of it.
  if (ki && !await spendManeuverCost(actor, { name: "those Modifier Maneuvers" }, ki)) {
    return false;
  }

  for (const [kind, amount] of Object.entries(actions)) {
    if (amount) await spendActions(actor, amount, kind);
  }

  for (const entry of applied) {
    await recordManeuverUse(actor, entry.modifier);
    // Scoped to its own Item, like every `on used`: what a Modifier does is its own
    // business, and the Base Maneuver's script is fired separately when that is used.
    await fireMoment(actor, "on-used", { maneuver: entry.modifier, actionsSpent: entry.actions },
      { only: entry.modifier.itemId });
  }

  return true;
}


/**
 * What a Clash of Saving Throws says it is for, in the words of the Maneuver that opened it.
 *
 * The reason line is what the two players read before they decide whether to spend anything
 * on the roll, so it says what winning buys rather than only who is rolling.
 */
function saveClashReason(actor, target, maneuver) {
  if (maneuver.internalAttack) {
    return `${actor.name} goes for the inside of ${target.name}. Win and ${actor.name} `
      + `leaves the Encounter, ${target.name} loses 2(T) of Soak Value and Defense Value, `
      + `and ${actor.name} comes back out when they choose to.`;
  }
  return `${actor.name} goes at ${target.name} where it hurts. Win and they are Impaired, `
    + `and Compelled against ${actor.name} until the end of ${actor.name}'s next turn.`;
}

/**
 * How many stacks of its own Resource to hold, asked as a total rather than a change.
 *
 * "Gain any number of Holding Back Stacks (the maximum you can possess is equal to your
 * base Tier of Power)", and "you can instead choose to remove any number of them or gain
 * more up to your maximum". Two sentences, one number: where the field ends up is what you
 * hold, whether that is more than before or less.
 *
 * The field starts where you already are, so confirming without touching it changes
 * nothing - which is the safe answer to a question the player may have opened by accident.
 *
 * Which Resource it is about is asked of the library rather than carried on the Maneuver:
 * every Resource records which Trait hands it out, and that is this Maneuver.
 *
 * @returns {Promise<?{name: string, stacks: number}>} the Resource and its new total, or
 *   null if the question was dropped
 */
/**
 * Where is this Soar taking them?
 *
 * Offered rather than taken: "can", both times in the entry, so the list always ends with
 * staying where they are. The Defense Value is the Maneuver's whatever they pick.
 *
 * @returns {Promise<number|false|null>} the rank to move to, `false` for staying, `null`
 *   if the question was closed.
 */
async function askSoar(actor, maneuver) {
  const { soarOptions } = await import("./environments.mjs");
  const options = soarOptions(actor.system);

  const rows = [
    ...options.map(option => `
      <label class="dbu-respond-option">
        <input type="radio" name="soar" value="${option.rank}"/>
        <span class="dbu-respond-name">${Handlebars.escapeExpression(option.label)}</span>
      </label>`),
    `<label class="dbu-respond-option">
        <input type="radio" name="soar" value="stay" checked/>
        <span class="dbu-respond-name">Stay where you are</span>
        <span class="dbu-respond-source">the Defense Value either way</span>
      </label>`
  ].join("");

  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: maneuver.name },
    content: rows,
    buttons: [
      {
        action: "confirm",
        label: "Soar",
        callback: (event, button, dialog) =>
          dialog.element.querySelector('input[name="soar"]:checked')?.value ?? "stay"
      },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });

  if (!chosen) return null;
  return (chosen === "stay") ? false : Number(chosen);
}

export async function askHoldingBack(actor, maneuver) {
  const { resourceCeiling, resourceDefinitions } = await import("./effects/traits.mjs");

  const found = Object.entries(resourceDefinitions())
    .find(([, definition]) => definition.id === maneuver.id);
  if (!found) return null;

  const [name, definition] = found;
  const most = resourceCeiling(definition, actor);
  const now = actor.system.resources?.[name]?.stacks ?? 0;
  const label = definition?.label ?? maneuver.name;

  const typed = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: maneuver.name },
    content: `
      <label class="dbu-wager">
        <span>${Handlebars.escapeExpression(label)} stacks</span>
        <input type="number" name="stacks" value="${now}" min="0" max="${most}"/>
        <em>Up to ${most} - your base Tier of Power. You have ${now}. Each one takes a Tier
          of Power off and adds 1 to your Concealment (up to 3); all ${most} sets your Tier
          of Power to 1 and costs 1(bT) on every Combat Roll.</em>
      </label>`,
    buttons: [
      {
        action: "confirm",
        label: "Confirm",
        callback: (event, button, dialog) => {
          const value = Math.floor(
            Number(dialog.element.querySelector('input[name="stacks"]').value));
          // Clamped here as well as on the input: `max` on a number field is advice to the
          // browser and a typed number gets through it.
          return Number.isFinite(value) ? Math.min(Math.max(0, value), most) : now;
        }
      },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });

  return (typeof typed === "number") ? { name, stacks: typed } : null;
}

/**
 * What the Magic Trick's chosen effect is, in a sentence for the card.
 *
 * The number is the same for two of the three and is read off the character when the
 * Maneuver is used, so a Rank gained mid-Encounter counts.
 */
function magicTrickNote(actor, maneuver, trick, target) {
  const ranks = actor.system.skills?.[maneuver.moveSkill]?.ranks ?? 0;
  const squares = (maneuver.movePerRank ?? 1) * ranks;
  const many = `${squares} Square${squares === 1 ? "" : "s"}`;
  const them = target?.name ?? "them";

  if (trick === "impair") {
    return `${actor.name} works a trick on ${them}. Win and they are Impaired until the `
      + `start of ${actor.name}'s next turn; lose and ${them} may Exploit.`;
  }
  if (trick === "shove") {
    return `${actor.name} works a trick on ${them}. Win and ${them} moves ${many} - `
      + `${actor.name}'s Use Magic Ranks; lose and ${them} may Exploit.`;
  }
  return `Move up to ${many} - ${actor.name}'s Use Magic Ranks. This movement does not `
    + "trigger the Exploit Maneuver.";
}

/**
 * Which of the Magic Trick's three effects is being used.
 *
 * Asked before anything is paid for. The first two need somebody to aim at and the third
 * does not, so aiming is checked here rather than by the Maneuver's own `requiresTarget` -
 * which would have demanded a target for the one effect that has none.
 *
 * @returns {Promise<string>} "impair", "shove", "move", or "" if the question was dropped
 */
/**
 * Which of the No Effort Maneuver's effects this use is.
 *
 * Its file lists them, `key=Label` each. Cancel Energy Charge is offered only while there is
 * a charge to cancel - "you lose all gathered Energy Charges" is nothing to lose otherwise.
 *
 * @returns {Promise<?{key: string, label: string}>}
 */
export function effortsOf(maneuver, charging = false) {
  return (maneuver?.efforts ?? []).map(entry => {
    const [key, ...label] = String(entry).split("=");
    return { key: key.trim(), label: (label.join("=") || key).trim() };
  }).filter(effort => effort.key && ((effort.key !== "cancel-charge") || charging));
}

async function askEffort(actor, maneuver) {
  const offered = effortsOf(maneuver, Boolean(actor.system.charging?.maneuverId));
  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: maneuver.name },
    content: "",
    buttons: [
      ...offered.map(effort => ({ action: effort.key, label: effort.label })),
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });
  return offered.find(effort => effort.key === chosen) ?? null;
}

async function askMagicTrick(actor, maneuver, target) {
  const ranks = actor.system.skills?.[maneuver.moveSkill]?.ranks ?? 0;
  const squares = (maneuver.movePerRank ?? 1) * ranks;
  const aimed = target ? target.name : "";

  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: maneuver.name },
    content: `
      <div class="dbu-defend-list">
        <label class="dbu-defend-option">
          <input type="radio" name="trick" value="impair" checked/>
          <span class="dbu-defend-body">
            <span class="dbu-defend-head"><strong>Impair them</strong></span>
            <span class="dbu-defend-summary">An Opponent in your Melee Range. A Clash of
              Use Magic against their Intuition or Use Magic; win and they are Impaired
              until the start of your next turn.${aimed ? ` Aimed at ${aimed}.` : ""}</span>
          </span>
        </label>
        <label class="dbu-defend-option">
          <input type="radio" name="trick" value="shove"/>
          <span class="dbu-defend-body">
            <span class="dbu-defend-head"><strong>Move them</strong></span>
            <span class="dbu-defend-summary">Any Character in your Melee Range, the same
              Clash; win and they move ${squares} Square${squares === 1 ? "" : "s"} - your
              Use Magic Ranks.${aimed ? ` Aimed at ${aimed}.` : ""}</span>
          </span>
        </label>
        <label class="dbu-defend-option">
          <input type="radio" name="trick" value="move"/>
          <span class="dbu-defend-body">
            <span class="dbu-defend-head"><strong>Move yourself</strong></span>
            <span class="dbu-defend-summary">${squares}
              Square${squares === 1 ? "" : "s"}, no Clash, and nothing to Exploit.</span>
          </span>
        </label>
      </div>`,
    buttons: [
      {
        action: "confirm",
        label: "Confirm",
        callback: (event, button, dialog) =>
          dialog.element.querySelector('input[name="trick"]:checked')?.value ?? ""
      },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });

  if ((typeof chosen !== "string") || !chosen || (chosen === "cancel")) return "";

  // The two that open a Clash need somebody to open it against. Refused here rather than
  // by the Maneuver asking for a target outright, since the third effect needs none.
  if ((chosen !== "move") && !target) {
    ui.notifications.warn(`${maneuver.name} needs a target for that. Target a token first.`);
    return "";
  }

  return chosen;
}

/**
 * Which way a Maneuver that throws a State went, said on its card.
 *
 * The one thing about it a reader cannot work out for themselves: the Maneuver is the same
 * either way and the card would otherwise look identical whether somebody had just gone
 * liquid or just come back.
 */
/**
 * Where a Soar took them, for the card.
 *
 * Said rather than left to the sheet: a height change is a thing the other players want
 * to know about, and the Battlefields tab is one character's own.
 */
function soarNote(maneuver, soarTo) {
  if (!maneuver.soars) return "";
  if (soarTo === false) return "Stays where they are.";
  if (soarTo === 0) return "Comes down to the ground.";

  const { HIGH_ENVIRONMENTS } = soarNames;
  const name = HIGH_ENVIRONMENTS.find(sky => sky.rank === soarTo)?.name ?? "";
  return name ? `Now in the ${name}.` : "";
}

function stateNote(maneuver, toggled) {
  if (!maneuver.togglesState || !toggled) return "";
  const name = maneuver.togglesState.charAt(0).toUpperCase() + maneuver.togglesState.slice(1);
  return (toggled === "in")
    ? `Now in the ${name} Special State.`
    : `Out of the ${name} Special State.`;
}

/**
 * What this Maneuver's card says at the table, beyond its own name.
 *
 * For the Maneuvers whose effect this system deliberately does not carry out. The Flip
 * Maneuver is the first of them: "move a number of Squares up to twice your number of
 * Skill Ranks in Acrobatics" - and this system moves nobody, so the number is what the
 * card can give, and the rest of the rule goes with it in the entry's own words.
 *
 * The number is read when the Maneuver is used rather than when the Item was made, so a
 * Rank gained mid-Encounter counts. At no Ranks there is no allowance, and it says so
 * rather than offering a zero dressed up as one.
 *
 * @returns {string} what to print under the Maneuver's name, or "" for most of them
 */
/**
 * What a Power Up destroys: every Scouter of a low enough Craft DC in the world, named, for
 * the table to say which were within 15 Squares. "If the Craft DC of a Scouter is Expert or
 * lower, it can be destroyed when a Character of Tier of Power 2+ (Qualified) or 3+ (Expert)
 * uses the Power Up Maneuver within 15 Squares of you."
 */
function powerUpBreaks(actor, maneuver) {
  if (!maneuver.powerUp) return "";
  const broken = brokenByPowerUp(game.actors?.contents ?? [], actor.system.tierOfPower ?? 1);
  if (!broken.length) return "";
  const named = broken.map(entry => `${entry.item.name} (${entry.actor.name})`);
  return `Destroyed if within 15 Squares: ${named.join(", ")}.`;
}

function maneuverNote(actor, maneuver) {
  const said = String(maneuver.says ?? "").trim();
  if (!maneuver.moveSkill || !maneuver.movePerRank) return said;

  const skill = actor.system.skills?.[maneuver.moveSkill];
  const ranks = skill?.ranks ?? 0;
  const squares = maneuver.movePerRank * ranks;
  const name = skill?.label ?? maneuver.moveSkill;

  const far = squares
    ? `Move up to ${squares} Square${squares === 1 ? "" : "s"} - `
      + `${maneuver.movePerRank} per Rank of ${name}, and you have ${ranks}.`
    : `No Ranks in ${name}, so this moves you nowhere.`;

  return said ? `${far} ${said}` : far;
}

/**
 * Hold a Maneuver back instead of using it.
 *
 * "You may use this Maneuver to delay its use but pay the Action Cost and KP Cost
 * immediately." So everything up to the payment has already happened by the time this is
 * reached, and everything after it does not: no script, no Profile spent, no card for the
 * Maneuver itself. What is posted is the holding.
 *
 * The Maneuver is offered straight back on that card as an Out-of-Sequence Maneuver
 * marked free, which is the whole of "you may use that Maneuver without paying the Action
 * Cost or KP Cost": out of sequence waives the Action for everything, and `free` waives
 * the Ki for this.
 *
 * @returns {Promise<boolean>} true, because the Maneuver was declared and paid for even
 *                             though it has not happened
 */
async function holdManeuver(actor, maneuver, held, actionsSpent) {
  const cost = actionCostOf(maneuver, actionsSpent);

  // The Triggered Maneuver's own card: its name, its Exploitable line, and a line saying
  // what is being held and on what.
  const card = await postManeuver(actor, held.modifier, {
    note: `Holding ${maneuver.name} - ${held.note || "no trigger stated"}`
  });

  await actor.update({
    "system.delayed": {
      itemId: maneuver.itemId ?? "",
      maneuverId: maneuver.id ?? "",
      name: maneuver.name,
      trigger: held.note ?? "",
      actions: cost.amount,
      actionKind: cost.kind,
      messageId: card?.id ?? ""
    }
  });

  // Offered on that card, to this character, free. One offer, taken once - which is what
  // the offer machinery already enforces.
  if (card) {
    offerDelayed(card, actor, maneuver, held.note ?? "");
  }

  return true;
}

/**
 * Whether this character is holding a Maneuver back, as the sheet wants to say it.
 *
 * Read rather than worked out: the trigger is in the player's own words and the Actions
 * are what they actually paid, and neither can be derived from anything else.
 */
export function delayedManeuver(actor) {
  const held = actor.system.delayed;
  if (!held?.itemId && !held?.maneuverId) return null;
  return {
    ...held,
    // Said on the sheet, since a holding with no trigger written on it is one nobody can
    // rule on.
    trigger: held.trigger || "no trigger stated"
  };
}

/**
 * Let go of what was being held, without using it.
 *
 * Two things end a holding early: the start of your next turn, which is where the entry
 * puts it, and an Exploit provoked by the holding taking Damage off you.
 */
export async function dropDelayed(actor) {
  if (!delayedManeuver(actor)) return false;
  await actor.update({
    "system.delayed": {
      itemId: "", maneuverId: "", name: "", trigger: "", actions: 0,
      actionKind: "standard", messageId: ""
    }
  });
  return true;
}

/**
 * Mark an Opponent as Analyzed, with the clock on whoever did it.
 *
 * "They become Analyzed until the end of your next turn." Two characters and one rule:
 * the Condition is theirs and the turn is yours, which is what a duration `on` somebody
 * else is for. Keeping the clock on the analyser is also what makes "your Combat Rolls
 * against Analyzed Opponents" answerable - the entry naming them is the record of who it
 * was, so nothing has to be written down twice.
 */
async function analyze(actor, target) {
  const { setCondition } = await import("./conditions.mjs");
  const { lasting, EDGES, KINDS } = await import("./durations.mjs");

  await setCondition(target, "analyzed", 1);
  return lasting(actor, {
    kind: KINDS.CONDITION,
    key: "analyzed",
    edge: EDGES.END,
    next: true,
    on: target.uuid,
    source: "Analysis"
  });
}

/**
 * Take Life and Ki off the one being held, and keep the Ki.
 *
 * "For each Action you spend, reduce their Life and Ki Points by 1/2 (rounded up) of your
 * Might and regain Ki Points equal to the total amount of Ki Points lost by the target."
 *
 * Rounded up per Action rather than once at the end: the sentence prices one Action and
 * says to do it for each, and on an odd Might the two differ - three Actions at half of 5
 * is nine, where half of fifteen is eight.
 *
 * What comes back is what they actually lost, which is not always what was taken off the
 * top: a Grappled with three Ki left against a drain of ten loses three and hands over
 * three. And it is capped again on the way in by the drainer's own maximum, because that is
 * what regaining Ki Points means everywhere else in this system.
 *
 * @returns {Promise<boolean>} false if nothing could be drained, so the Maneuver is unused
 */
/**
 * Where a Power Drain's Ki goes from a Grapple, with an Energy-Suction Device in hand.
 *
 * By the table's ruling: into the Device when the Device is the only thing giving them Power
 * Drain; their choice when they had it already. Without a Device, to them.
 *
 * @returns {Promise<object|false|null>} the Device, `false` for themselves, null if closed
 */
async function drainDestination(actor, maneuver, store) {
  if (!store) return false;
  const { openedWithoutGear } = await import("./maneuvers.mjs");
  if (!openedWithoutGear(actor, maneuver)) return store;

  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: maneuver.name },
    content: `<p>Where does the Ki go?</p>`,
    buttons: [
      { action: "self", label: actor.name },
      { action: "store", label: store.name },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });
  if (chosen === "store") return store;
  if (chosen === "self") return false;
  return null;
}

/**
 * Pay for an attack with the Ki an Item stores, where it can and the player says so.
 *
 * The Energy-Suction Device: "when making an Unarmed Energy or Magic Attacking Maneuver, you
 * may instead spend the Ki Points stored in the Energy-Suction Device." All or nothing, and
 * off the character's Capacity, by the table's ruling.
 *
 * @returns {Promise<boolean|null>} true if paid from the Item, false if not, null if closed
 */
export async function payFromStore(actor, maneuver, declared, price) {
  if (!maneuver?.attacking || !declared?.foundation) return false;
  const { canPayAttack, drainStore } = await import("./gear.mjs");
  const store = drainStore(actor.items);
  if (!canPayAttack(store, declared.foundation, price)) return false;

  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: maneuver.name },
    content: `<p>Pay ${price} KP from the ${Handlebars.escapeExpression(store.name)} `
      + `(${store.system.charges} stored)?</p>`,
    buttons: [
      { action: "store", label: store.name },
      { action: "self", label: "My Ki" },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });
  if (chosen === "self") return false;
  if (chosen !== "store") return null;

  await store.update({ "system.charges": (Number(store.system.charges) || 0) - price });
  return true;
}

export async function drainFrom(actor, grappled, maneuver, actionsSpent, into = null) {
  const { reduceKiPoints, reduceLifePoints } = await import("./chat.mjs");

  const actions = Math.max(1, actionsSpent || actionCostOf(maneuver, actionsSpent).amount);
  const each = Math.ceil(Math.max(0, actor.system.might ?? 0) / 2);
  const total = each * actions;

  if (total <= 0) {
    ui.notifications.warn(
      `${actor.name} has no Might to drain with, so there is nothing to take.`);
    return false;
  }

  const reason = `${maneuver.name} - half of ${actor.name}'s Might, ${actions} time`
    + `${actions === 1 ? "" : "s"}`;

  await reduceLifePoints(grappled, total, { reason });
  const lost = await reduceKiPoints(grappled, total, { reason });

  // Into an Item instead, where it goes there: the Energy-Suction Device - "You do not
  // regain any Ki Points ... but they are instead stored inside the Energy-Suction Device."
  if (into) {
    await into.update({ "system.charges": (Number(into.system.charges) || 0) + lost });
    await postManeuver(actor, maneuver, {
      note: `${grappled.name} loses ${total} Life and ${lost} Ki, stored in the ${into.name}.`
    });
    return true;
  }

  // "Regain Ki Points equal to the total amount of Ki Points lost by the target", and
  // regaining is bounded by your own maximum like every other regain here.
  const { value, max } = actor.system.ki;
  const regained = Math.min(max, value + lost) - value;
  if (regained > 0) {
    const { requestActorUpdate } = await import("./chat.mjs");
    await requestActorUpdate(actor, { "system.ki.value": value + regained });
  }

  await postManeuver(actor, maneuver, {
    note: `${grappled.name} loses ${total} Life and ${lost} Ki. `
      + (regained > 0
        ? `${actor.name} takes ${regained} of it back.`
        : `${actor.name} had no room for any of it.`)
  });

  return true;
}

/**
 * Mark an Opponent as Seen, with the clock on whoever read them.
 *
 * "That Opponent becomes 'Seen' until the end of your next turn." Two characters and one
 * rule, the same way Analysis splits it: the Condition is theirs and the turn is yours, and
 * the entry timing it is also the record of who read whom.
 */
async function markSeen(actor, target) {
  const { setCondition } = await import("./conditions.mjs");
  const { lasting, EDGES, KINDS } = await import("./durations.mjs");

  await setCondition(target, "seen", 1);
  return lasting(actor, {
    kind: KINDS.CONDITION,
    key: "seen",
    edge: EDGES.END,
    next: true,
    on: target.uuid,
    source: "Intuit"
  });
}

/**
 * How far this Movement goes, and whether it is a Rapid one.
 *
 * One dialog, because it is one decision. The Squares are on it: "up to your Boosted
 * Speed" is not a number, and the two numbers it stands for are ones the character has
 * been carrying all along.
 *
 * @returns {Promise<?{speed: string, rapid: boolean}>} null if it was backed out of
 */
export async function askMovement(actor) {
  const tier = Math.max(1, actor.system.tierOfPower ?? 1);

  const options = Object.entries(MOVEMENT_SPEEDS).map(([key, speed], index) => {
    const cost = movementKiCost(actor, { speed: key });
    return `<label class="dbu-profile-option">
      <input type="radio" name="speed" value="${key}" ${index ? "" : "checked"}/>
      <span class="dbu-profile-name">${Handlebars.escapeExpression(speed.label)}</span>
      <span class="dbu-profile-category">up to ${movementSquares(actor, key)} Squares</span>
      <span class="dbu-profile-cost">${cost} KP</span>
    </label>`;
  }).join("");

  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: "Movement" },
    content: `<div class="dbu-profile-picker">${options}</div>
      <label class="dbu-wager">
        <span>Rapid Movement</span>
        <input type="checkbox" name="rapid"/>
        <em>+${RAPID_MOVEMENT_PER_TIER * tier} KP &middot; increase your Strike Rolls by
          1(T) until the end of your turn</em>
      </label>
      <p class="dbu-respond-hint">Move on the map yourself. Leaving an Opponent's Melee
        Range hands them the Exploit Maneuver.</p>`,
    buttons: [
      {
        action: "confirm",
        label: "Move",
        callback: (event, button, dialog) => ({
          speed: dialog.element.querySelector('input[name="speed"]:checked')?.value ?? "normal",
          rapid: Boolean(dialog.element.querySelector('input[name="rapid"]')?.checked)
        })
      },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });

  return (chosen && (typeof chosen === "object")) ? chosen : null;
}

/**
 * Take Rapid Movement: one stack of the Resource the Maneuver's passive reads, on a clock
 * that runs out at the end of this turn.
 *
 * Written through the same two calls a script would make, so there is one way a Resource
 * is granted and one way it is put on a clock.
 */
export async function takeRapidMovement(actor) {
  const { expiresAt } = await import("./effects/moments-runtime.mjs");
  const held = { ...(actor.system.resources ?? {}) };
  const { replaceObject } = await import("./conditions.mjs");

  held.rapid = { stacks: 1, max: 1 };
  await actor.update({ "system.resources": replaceObject(held) });

  // "Until the end of your turn", which is what this system calls "turn".
  await expiresAt(actor, "rapid", "turn");
}

/** Take the Actions, once the Maneuver has actually committed. */
async function payActions(actor, maneuver, spent = null) {
  const { kind, amount } = actionCostOf(maneuver, spent);
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
    actionCostMax: item.system.actionCostMax,
    actionCostOpen: item.system.actionCostOpen,
    kiCost: item.system.kiCost,
    kiCostPerBaseTier: item.system.kiCostPerBaseTier,
    attacking: item.system.attacking,
    absolute: item.system.absolute,
    requiresTarget: item.system.requiresTarget,
    defend: item.system.defend,
    intervene: item.system.intervene,
    united: item.system.united,
    duel: item.system.duel,
    duelEscape: item.system.duelEscape,
    exploit: item.system.exploit,
    empower: item.system.empower,
    grapple: item.system.grapple,
    launch: item.system.launch,
    movement: item.system.movement,
    pin: item.system.pin,
    powerUp: item.system.powerUp,
    signatureTechnique: item.system.signatureTechnique,
    thrust: item.system.thrust,
    blockade: item.system.blockade,
    suddenStop: item.system.suddenStop,
    reflect: item.system.reflect,
    absorb: item.system.absorb,
    dirtyTrick: item.system.dirtyTrick,
    feint: item.system.feint,
    holdingBack: item.system.holdingBack,
    insult: item.system.insult,
    internalAttack: item.system.internalAttack,
    togglesState: item.system.togglesState,
    fromTrait: item.system.fromTrait,
    fromEffect: item.system.fromEffect,
    surgeKind: item.system.surgeKind,
    magicTrick: item.system.magicTrick,
    exploitOnLoss: item.system.exploitOnLoss,
    clashSaves: [...(item.system.clashSaves ?? [])],
    clashDefenderSaves: [...(item.system.clashDefenderSaves ?? [])],
    moveSkill: item.system.moveSkill,
    movePerRank: item.system.movePerRank,
    says: item.system.says,
    baseManeuver: item.system.baseManeuver ?? [],
    baseForbids: item.system.baseForbids ?? [],
    damageCategoryShift: item.system.damageCategoryShift ?? 0,
    strikePerTier: item.system.strikePerTier ?? 0,
    woundPerTier: item.system.woundPerTier ?? 0,
    asks: item.system.asks ?? "",
    targetsApparel: item.system.targetsApparel,
    delays: item.system.delays,
    special: item.system.special,
    analysis: item.system.analysis,
    intuit: item.system.intuit,
    powerDrain: item.system.powerDrain,
    sense: item.system.sense,
    terrify: item.system.terrify,
    transfiguration: item.system.transfiguration,
    treatment: item.system.treatment,
    repair: item.system.repair,
    // Magical Materialization's Effect: what to make, asked before it is paid for.
    materialize: item.system.unique?.materialize === true,
    // Precognition's Effect: which Opponent moves up, asked before it is used.
    precognition: item.system.unique?.precognition === true,
    // Applied until it is not paid for - the Atmospheric Bubble.
    sustained: item.system.unique?.sustained === true,
    // Pins somebody and holds them - Binding.
    binds: item.system.unique?.binds === true,
    downBurst: item.system.unique?.downBurst === true,
    gathers: item.system.unique?.gathers === true,
    shiftsEnvironment: item.system.unique?.shiftsEnvironment === true,
    kiPerAction: item.system.unique?.kiPerAction === true,
    explodes: item.system.unique?.explodes === true,
    waves: item.system.unique?.waves === true,
    fakesDeath: item.system.unique?.fakesDeath === true,
    fakeMoon: item.system.unique?.fakeMoon === true,
    finishSign: item.system.unique?.finishSign === true,
    meteor: item.system.unique?.meteor === true,
    heals: item.system.unique?.heals === true,
    selfShock: item.system.unique?.selfShock === true,
    illusion: item.system.unique?.illusion === true,
    smashes: item.system.unique?.smashes === true,
    debilitates: item.system.unique?.debilitates === true,
    lullaby: item.system.unique?.lullaby === true,
    enhances: item.system.unique?.enhances === true,
    mindControl: item.system.unique?.mindControl === true,
    requiresState: item.system.unique?.requiresState ?? "",
    // "All of your remaining Actions (Min. 2)" - Cage of Light.
    spendsAllActions: item.system.unique?.spendsAllActions === true,
    bluffs: item.system.unique?.bluffs === true,
    devilmite: item.system.unique?.devilmite === true,
    kiCostPerTierChange: Number(item.system.unique?.kiCostPerTierChange) || 0,
    outsideDiminishing: item.system.outsideDiminishing,
    tailAttack: item.system.tailAttack,
    kiCostCoversProfile: item.system.kiCostCoversProfile,
    tailVariant: item.system.tailVariant ?? "",
    // Derived from the variant rather than stored beside it: which Profiles this Maneuver
    // offers, what the second of them adds to the price, and the Foundation the entry pins
    // for one of them. Derived here so every reader gets them - the row on the sheet that
    // prices it, the picker, and the payment - rather than only the path that asks.
    ...(item.system.tailAttack ? tailProfiles(item.system.tailVariant ?? "") : {}),
    kiCostPerTier: item.system.kiCostPerTier,
    /**
     * Whether this Maneuver *is* a Signature Technique, which is a different question
     * from whether it throws one.
     *
     * Read off the tag, because the tag is what the rules match on - "any Maneuver tagged
     * signature". Carried here because `profileKiCost` has always asked a definition for
     * it and no definition has ever had it: Blitz's "reduce the KP Cost by 2(T) if this
     * Attacking Maneuver is a Signature Technique" has never once been applied.
     */
    signature: (item.system.tags ?? []).includes("signature"),
    advantages: item.system.advantages ?? [],
    exploitable: item.system.exploitable,
    surge: item.system.surge,
    charge: item.system.charge,
    cancelCharge: item.system.cancelCharge,
    noEffort: item.system.noEffort,
    throws: item.system.throws,
    efforts: item.system.efforts ?? [],
    profile: item.system.profile,
    tags: item.system.tags ?? [],
    source: item.system.source,
    description: item.system.description,
    // The published entry, which is what the sheet shows on hover. Carried here because
    // it had been reaching the Item and stopping: written in the file, stored on the
    // document, and read by nothing that a player ever looked at.
    text: item.system.text,
    usageLimit: item.system.limit,
    clash: item.system.clashSkill
      ? {
          skill: item.system.clashSkill,
          // "Bluff vs Intuition/Perception". Empty on every Clash that names one Skill,
          // and read there as "the same one on both sides"; more than one is a choice the
          // defender makes.
          defenderSkills: [...(item.system.clashDefenderSkills ?? [])]
        }
      : null,
    // A Technique built on its sheet: what its build makes of it.
    ...(isBuilt(item) ? techniqueDefinition(item) : {})
  };
}

/**
 * What a built Technique is, over and above an ordinary Maneuver Item: its Profile and the
 * Foundation that Profile is used with, what it adds to the Profile's price, and whether it is
 * an Ultimate - which also makes it once per Combat Encounter, "this refers to each Signature
 * Technique individually".
 */
export function techniqueDefinition(item) {
  const sig = signatureOf(item);
  const ultimate = isUltimate(sig.level);
  return {
    attacking: true,
    profile: sig.profile,
    profileFoundation: sig.foundation ? { [sig.profile]: sig.foundation } : {},
    kiCost: 0,
    kiCostPerBaseTier: 0,
    kiCostPerTier: techniqueKiPerTier(sig),
    level: sig.level,
    ultimate,
    superProfile: sig.superProfile,
    secondProfile: (sig.superProfile === "multi-profile") ? sig.secondProfile : "",
    featureChoices: choicesOf(sig),
    fromTransformation: sig.fromTransformation,
    ...(ultimate ? { usageLimit: { amount: 1, per: "encounter" } } : {})
  };
}

/**
 * Karmic Assault (2 Karma): "If you use an Ultimate Signature Technique, you may apply a Super
 * Profile of your choice to that Attacking Maneuver."
 *
 * The user's rulings: asked at declaration; an Ascended Super is an Ultimate for it; not for an attack
 * that already has a Super Profile (a Dramatic Finisher's, an Elemental Blade's) - one is the most an
 * attack carries; and the Super Profile's KP is paid. Its Prerequisites are read on the final attack,
 * as every Super Profile's are. Multi-Profile asks for its second Profile.
 *
 * @returns {Promise<?{maneuver: object, declared: object}>} null when the question was put away
 */
export async function karmicAssault(actor, maneuver, declared) {
  const unchanged = { maneuver, declared };
  if (!declared || !maneuver.signature || maneuver.signatureTechnique) return unchanged;
  if (!(maneuver.ultimate || maneuver.ascended) || maneuver.superProfile) return unchanged;
  const { allKarmicEffects } = await import("./karma.mjs");
  const effect = allKarmicEffects().find(entry => entry.key === "karmic-assault");
  if (!effect || ((Number(actor.system.karma) || 0) < (effect.cost ?? 0))) return unchanged;

  const escape = Handlebars.escapeExpression;
  const supers = Object.entries(SUPER_PROFILES).map(([id, entry]) =>
    `<option value="${id}">${escape(entry.label)} (${entry.kiCostPerTier ?? 0}(T))</option>`).join("");
  const seconds = Object.entries(PROFILES).filter(([id]) => id !== declared.profile)
    .map(([id, profile]) => `<option value="${id}">${escape(profile.label)}</option>`).join("");
  const answer = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: `${maneuver.name} - Karmic Assault` },
    content: `<p class="dbu-respond-hint" data-tooltip="${escape(effect.text)}">Karmic Assault: ${effect.cost} Karma for a
        Super Profile on this Ultimate. Its KP is paid; its Prerequisites still apply.</p>
      <label class="dbu-wager"><span>Super Profile</span>
        <select name="super"><option value="">None</option>${supers}</select></label>
      <label class="dbu-wager" data-tooltip="Only for Multi-Profile"><span>Second Profile</span>
        <select name="second">${seconds}</select></label>`,
    buttons: [
      { action: "confirm", label: "Confirm", callback: (event, button, dialog) => ({
        id: dialog.element.querySelector('select[name="super"]')?.value ?? "",
        second: dialog.element.querySelector('select[name="second"]')?.value ?? "" }) },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });
  if (!answer || (answer === "cancel")) return null;
  if (!answer.id || !SUPER_PROFILES[answer.id]) return unchanged;

  // Paid once the attack is made, not now (the user's ruling): an attack put away after this costs
  // no Karma. `payKarmicAssault` settles it when the card exists.
  const second = (answer.id === "multi-profile") ? answer.second : (maneuver.secondProfile ?? "");
  const tier = Math.max(1, Number(actor.system.tierOfPower) || 1);
  const ki = superProfileKiPerTier(answer.id, second) * tier;
  const next = { ...maneuver, superProfile: answer.id, secondProfile: second };
  const out = { ...declared, superProfileKi: (Number(declared.superProfileKi) || 0) + ki, karmicAssault: answer.id,
    // "Considered to be of that Profile": Multi-Profile's second hands out what it hands out.
    advantages: (answer.id === "multi-profile")
      ? withGranted(declared.advantages ?? [], PROFILES[second]?.grantsAdvantage) : (declared.advantages ?? []) };
  return { maneuver: next, declared: (answer.id === "multi-profile") ? await wagerAgain(actor, next, declared, out, second) : out };
}

/**
 * Karmic Assault, paid: its Karma spent once the attack has been made - "if it completed, the Karma
 * Points are spent; if not, not" (the user's ruling). Said on the chat as it is paid.
 */
export async function payKarmicAssault(actor, maneuver, declared) {
  if (!declared?.karmicAssault) return false;
  const { allKarmicEffects, spendKarma } = await import("./karma.mjs");
  const effect = allKarmicEffects().find(entry => entry.key === "karmic-assault");
  if (!effect || !await spendKarma(actor, effect)) return false;
  const label = SUPER_PROFILES[declared.karmicAssault]?.label ?? declared.karmicAssault;
  const second = (declared.karmicAssault === "multi-profile") ? (PROFILES[maneuver.secondProfile]?.label ?? "") : "";
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="dbu-settled-note">${Handlebars.escapeExpression(`${actor.name} spends ${effect.cost} Karma: `
      + `Karmic Assault puts ${label}${second ? ` (${second})` : ""} on ${maneuver.name}`
      + ` (+${Number(declared.superProfileKi) || 0} KP).`)}</div>` });
  return true;
}

/**
 * The wager, asked again when a second Profile added after it was asked brings Full Wager (Elemental
 * (Light)) or the Life wager (Elemental (Dark)): the table's ruling - asked again with the new ceiling,
 * from the one already given. Put away, the wager stays as it was.
 */
async function wagerAgain(actor, maneuver, before, declared, second) {
  const full = PROFILES[second]?.grantsAdvantage === "full-wager" && !(before.advantages ?? []).includes("full-wager");
  const lifeNow = Boolean(PROFILES[second]?.wagerFromLife) && !PROFILES[declared.profile]?.wagerFromLife;
  if (!full && !lifeNow) return declared;
  const advantages = declared.advantages ?? [];
  const life = Boolean(PROFILES[second]?.wagerFromLife || PROFILES[declared.profile]?.wagerFromLife);
  const kiMax = maxKiWager(actor, advantages);
  const lifeMax = life ? maxLifeWager(actor, advantages) : 0;
  const floor = forcedFullWager(advantages) ? kiMax : minimumKiWager(actor, maneuver);
  const current = Number(declared.kiWager) || 0;
  const answer = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: `${maneuver.name} - Ki Wager` },
    content: `<p class="dbu-respond-hint">${Handlebars.escapeExpression(PROFILES[second].label)} changes what you may
        wager.</p>
      <label class="dbu-wager"><span>Ki Wager</span>
        <input type="number" name="kiWager" value="${current}" min="0" max="${Math.max(kiMax, lifeMax)}"/>
        <em>max ${kiMax}${life ? `, ${lifeMax} in Life Points` : ""}</em></label>${life ? `
      <label class="dbu-wager"><input type="checkbox" name="wagerFromLife" ${declared.wagerFromLife ? "checked" : ""}/>
        <span>Wager Life Points</span></label>` : ""}`,
    buttons: [
      { action: "confirm", label: "Confirm", callback: (event, button, dialog) => ({
        amount: Math.floor(Number(dialog.element.querySelector('input[name="kiWager"]')?.value) || 0),
        fromLife: Boolean(dialog.element.querySelector('input[name="wagerFromLife"]')?.checked) }) },
      { action: "cancel", label: "Keep it" }
    ],
    rejectClose: false
  });
  if (!answer || (answer === "cancel")) return declared;
  const fromLife = life && answer.fromLife;
  const ceiling = fromLife ? lifeMax : kiMax;
  const wager = Math.max(Math.min(floor, ceiling), Math.min(Math.max(0, answer.amount), ceiling));
  return { ...declared, kiWager: wager, wagerFromLife: fromLife };
}

/**
 * The questions an Advantage brought by United Attack asks, put to the one who brought it (the table's
 * ruling): Transformation Boost's Form, Powerbomb's Grapple, Final Chance's Life, Charging Assault's
 * Squares. Splitting's targets are the attacker's, and not asked.
 *
 * @returns {Promise<?object>} the answers, or null when put away
 */
export async function askJoinedDeclaration(joiner, attack, added) {
  const asked = added.filter(id => id !== "splitting");
  if (!asked.length) return {};
  const target = fromUuidSync(attack.targetUuid ?? "") ?? null;
  const technique = { name: `United Attack - ${attack.maneuverName}`, ultimate: Boolean(attack.technique?.ultimate),
    superProfile: "", secondProfile: "", actionCost: 1 };
  const answers = await askTechniqueDeclaration(joiner, technique, { profile: attack.profile, advantages: asked }, target);
  if (!answers) return null;
  const charged = await askFeatures(technique, joiner, asked);
  if (charged === null) return null;
  return { transformed: Boolean(answers.transformed), powerbomb: Boolean(answers.powerbomb),
    finalChanceLife: answers.finalChance ? (Number(answers.finalChanceLife) || 0) : 0, ...charged };
}

/**
 * Elemental Blade: "Apply the Multi-Profile Super Profile to any Attacking Maneuvers you use, with
 * the Profile selected for the Multi-Profile Super Profile being the Elemental Profile you selected.
 * If it meets the Prerequisites, also apply the Compressed Element Disadvantage".
 *
 * The table's rulings: only on attacks made with the Weapon; its Multi-Profile's KP is paid; an
 * attack that has a Super Profile already asks which one it keeps; the same Profile as the attack's
 * still counts. Then, for any attack with two Profiles that each mark Squares, the player picks
 * whose mark it leaves (both Threshold effects apply).
 *
 * @returns {Promise<?{maneuver: object, declared: object}>} null when a question was put away
 */
export async function elementalBlade(actor, maneuver, declared) {
  if (!declared) return { maneuver, declared };
  const blade = declared.weapon?.elementalBlade ?? "";
  let next = maneuver;
  let out = declared;
  if (blade && PROFILES[blade]) {
    const own = maneuver.superProfile ?? "";
    let take = true;
    if (own) {
      const keep = await foundry.applications.api.DialogV2.wait({
        classes: ["dbu-dialog"],
        window: { title: `${maneuver.name} - one Super Profile` },
        content: `<p class="dbu-respond-hint">An attack has one Super Profile. ${Handlebars.escapeExpression(
          declared.weapon.name)}'s Elemental Blade would make it Multi-Profile (${Handlebars.escapeExpression(
          PROFILES[blade].label)}).</p>`,
        buttons: [
          { action: "own", label: `Keep ${SUPER_PROFILES[own]?.label ?? own}` },
          { action: "blade", label: "Elemental Blade" },
          { action: "cancel", label: "Cancel" }
        ],
        rejectClose: false
      });
      if (!keep || (keep === "cancel")) return null;
      take = keep === "blade";
    }
    if (take) {
      const tier = Math.max(1, Number(actor.system.tierOfPower) || 1);
      const was = own ? superProfileKiPerTier(own, maneuver.secondProfile ?? "") : 0;
      next = { ...maneuver, superProfile: "multi-profile", secondProfile: blade };
      const before = out;
      out = { ...out,
        multiProfileKi: (superProfileKiPerTier("multi-profile", blade) - was) * tier,
        // "Considered to be of that Profile": what it hands out comes with it.
        advantages: withGranted(out.advantages ?? [], PROFILES[blade].grantsAdvantage) };
      out = await wagerAgain(actor, next, before, out, blade);
    }
    // "If it meets the Prerequisites, also apply the Compressed Element Disadvantage".
    const compressed = signatureFeature("compressed-element");
    if (compressed && requirementHolds(compressed.requires ?? "", { profiles: [out.profile, next.secondProfile ?? ""] })) {
      out = { ...out, compressedElement: true };
    }
  }

  // Two Profiles that each mark the Squares: the player picks whose (the table's ruling).
  const marking = [out.profile, next.secondProfile ?? ""]
    .filter(id => PROFILES[id]?.squareMark || PROFILES[id]?.squareQuality);
  if ((marking.length === 2) && (marking[0] !== marking[1]) && !out.markFrom) {
    const pick = await foundry.applications.api.DialogV2.wait({
      classes: ["dbu-dialog"],
      window: { title: `${next.name} - the Squares` },
      content: `<p class="dbu-respond-hint">Two Profiles mark the Squares. Which one does this attack leave?</p>`,
      buttons: [...marking.map(id => ({ action: id, label: PROFILES[id].label })),
        { action: "cancel", label: "Cancel" }],
      rejectClose: false
    });
    if (!pick || (pick === "cancel")) return null;
    out = { ...out, markFrom: pick };
  }
  return { maneuver: next, declared: out };
}

/**
 * Use a Maneuver: check it is allowed, pay for it, and announce it.
 *
 * @param {Actor} actor
 * @param {object} maneuver  a definition, from definitionOf() or the core table
 * @returns {Promise<boolean>} False when nothing happened, for any reason.
 */
/**
 * The Tail Attack's one-time choice: which additional effect this character's tail has.
 *
 * "When you first gain access to this Special Maneuver, you may select one of these
 * additional effects to have access to while you have access to this Maneuver." Asked once
 * and kept on the Item, so it survives the Maneuver leaving the list and coming back.
 *
 * Every option is priced at this character's own Tier of Power, through the same function
 * that will charge for it - a choice kept for the rest of a campaign should not be made
 * against a notation the player has to work out.
 *
 * Declining is one of the answers: the entry says "you may select", and "none" is recorded
 * so the question is not put again every round.
 *
 * @returns {Promise<string>} a variant key, "none", or "" if the player backed out
 */
async function askTailVariant(actor, maneuver) {
  const priceOf = (key) => {
    const variant = TAIL_VARIANTS[key];
    const shaped = { ...maneuver, tailVariant: key, ...tailProfiles(key) };
    return maneuverKiCost(shaped, { profile: variant.profile }, actor);
  };
  const basePrice = maneuverKiCost(
    { ...maneuver, tailVariant: "none", ...tailProfiles("none") },
    { profile: TAIL_BASE_PROFILE }, actor);

  const options = Object.entries(TAIL_VARIANTS).map(([key, variant]) => `
    <label class="dbu-defend-option">
      <input type="radio" name="variant" value="${key}"/>
      <span class="dbu-defend-body">
        <span class="dbu-defend-head"><strong>${Handlebars.escapeExpression(variant.label)}</strong></span>
        <span class="dbu-defend-summary">${Handlebars.escapeExpression(variant.tip)}
          ${priceOf(key)} KP at your Tier of Power, against ${basePrice} for the Simple
          Profile.</span>
      </span>
    </label>`).join("");

  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: `${maneuver.name} - your tail` },
    content: `
      <p>Chosen once, and kept for as long as you have this Maneuver. You can change it
        later on the Maneuver's own sheet.</p>
      <div class="dbu-defend-list">
        ${options}
        <label class="dbu-defend-option">
          <input type="radio" name="variant" value="none" checked/>
          <span class="dbu-defend-body">
            <span class="dbu-defend-head"><strong>None</strong></span>
            <span class="dbu-defend-summary">The Simple Profile only, for ${basePrice} KP.</span>
          </span>
        </label>
      </div>`,
    buttons: [
      {
        action: "confirm",
        label: "Confirm",
        callback: (event, button, dialog) =>
          dialog.element.querySelector('input[name="variant"]:checked')?.value ?? ""
      },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });

  if ((typeof chosen !== "string") || !chosen || (chosen === "cancel")) return "";
  return chosen;
}

/**
 * Write the choice onto the character's own copy of the Maneuver.
 *
 * The Item and not the character: a second Tail Attack, renamed and kept beside the first,
 * is a different tail. And the Item is where every other change a player makes to their
 * copy of a Maneuver already lives.
 */
async function recordTailVariant(actor, maneuver, variant) {
  const item = actor.items.get(maneuver.itemId);
  if (!item) return;
  await item.update({ "system.tailVariant": variant });
}

/**
 * The Treatment Maneuver: Life Points onto an Ally, and a choice about their poison.
 *
 * Both halves reach somebody else, which is why none of this is a script - a script writes
 * Slots onto the character running it, and the Empower Maneuver's Ki Points are answered
 * the same way.
 *
 * The choice comes first because it is what the healing is halved for: "you can reduce the
 * amount of Life Points they gain by 1/2 to make a Skill Clash". Asked while the whole
 * thing can still be taken back.
 */
/**
 * What the Repair Maneuver can mend: each Weapon and piece of Apparel the character has, with the
 * Craft DC it is checked at, and refused - with the reason - where they have no Ranks in its Craft (the
 * user's ruling: Craft (Weapons) for a Weapon, Craft (Apparel) for Apparel) or there is nothing to mend.
 */
export function repairables(actor) {
  const { craftedReading } = gearReadingModule;
  return Array.from(actor.items ?? []).filter(item => ["weapon", "apparel"].includes(item.system?.crafted?.kind))
    .map(item => {
      const kind = item.system.crafted.kind;
      const reading = craftedReading(item.system.crafted, { getTrait, difficulties: DBUCharacterData.DIFFICULTIES,
        data: actor.system }) ?? {};
      const specialty = (kind === "weapon") ? "craftWeapons" : "craftApparel";
      const worn = (kind === "weapon")
        ? (item.system.crafted.destroyed || ((Number(item.system.crafted.lifeLost) || 0) > 0))
        : (item.system.crafted.destroyed || ((reading.breakLeft ?? 0) < (reading.breakValue ?? 0)));
      const why = !((Number(actor.system.skills?.[specialty]?.ranks) || 0) > 0)
        ? `needs Ranks in ${DBUCharacterData.SKILLS[specialty].label}`
        : !worn ? "nothing to repair" : "";
      return { item, kind, specialty, craftDC: reading.craftDC ?? "", why };
    });
}

/**
 * Magical Materialization, used: "Select either a Basic Item that does not have the [Tech] or [Food] tag, a
 * piece of Apparel, or a Weapon" - what its Advancements allow and its Limited Creation leaves - and the Check
 * at its Craft DC one Category higher. With Restrictive Weights, Weights at the Opponent targeted; with
 * Projectile Materialization, into the targeted Ally's hands; with Dematerialize, an Item marked Materialized
 * destroyed instead. Null if nothing is picked.
 */
async function askMaterialize(actor, maneuver) {
  const item = actor.items?.get(maneuver.itemId);
  const unique = item?.system?.unique;
  if (!unique) return null;
  const { boughtTraits, materializable, materializeHarder, harderBy1 } = await import("./unique.mjs");
  const { gearOfList, gearItemFrom, tagsOf, typeOf } = await import("./gear.mjs");
  const { traitsOfKind } = await import("./effects/traits.mjs");
  const escape = Handlebars.escapeExpression;
  const labels = DBUCharacterData.DIFFICULTIES;
  const order = ["novice", "apprentice", "qualified", "expert", "master", "grandmaster"];
  const keyOf = label => order.find(key => labels[key]?.label.toLowerCase() === String(label ?? "").trim().toLowerCase()) ?? "";

  const bought = boughtTraits(unique, getTrait);
  const has = flag => bought.some(trait => trait[flag] === true);
  // Limited Creation: "You can only create your selected Item."
  const limited = (unique.restrictions ?? []).find(entry => entry.applied && entry.choice)?.choice ?? "";
  const allows = kind => !limited || (limited === kind);
  const target = Array.from(game.user.targets ?? []).map(token => token.actor)
    .find(other => other && (other.uuid !== actor.uuid)) ?? null;

  const basics = allows("basic")
    ? gearOfList(traitsOfKind("gear"), "basic").filter(def => materializable(def, tagsOf(def), typeOf(def), bought)) : [];
  const materialized = owner => Array.from(owner?.items ?? []).filter(each => each.system?.materialized)
    .map(each => ({ owner, item: each }));
  const demats = has("dematerialize") ? [...materialized(actor), ...(target ? materialized(target) : [])] : [];

  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: `${actor.name} - ${maneuver.name}` },
    content: `<label class="dbu-wager"><span>Make</span><select name="what" class="dbu-gear-pick">
        ${basics.length ? `<optgroup label="Basic Items">${basics.map(def =>
          `<option value="basic:${escape(def.id)}">${escape(def.name)} (${escape(def.materializeDC || def.craftDC)})</option>`).join("")}</optgroup>` : ""}
        ${allows("weapon") ? `<option value="weapon">A Weapon</option>` : ""}
        ${allows("apparel") ? `<option value="apparel">A piece of Apparel</option>` : ""}
        ${(has("weights") && target) ? `<option value="weights">Weights, at ${escape(target.name)} (Restrictive Weights)</option>` : ""}
        ${demats.length ? `<optgroup label="Dematerialize">${demats.map(({ owner, item: made }) =>
          `<option value="demat:${escape(owner.uuid)}|${escape(made.id)}">${escape(made.name)} (${escape(owner.name)})</option>`).join("")}</optgroup>` : ""}
      </select></label>
      <label class="dbu-wager"><span>Craft DC</span><select name="difficulty">${order.map(key =>
        `<option value="${key}">${escape(labels[key]?.label ?? key)}</option>`).join("")}</select>
        <em>A Weapon's, Apparel's or Weights' - or a Variable one; one Category harder is added</em></label>
      ${(has("projectile") && target) ? `<label class="dbu-respond-option"><input type="checkbox" name="projectile"/>
        <span class="dbu-respond-name">Into ${escape(target.name)}'s hands (Projectile Materialization)</span></label>` : ""}`,
    buttons: [
      { action: "make", label: "Materialize", default: true, callback: (event, button, dialog) => ({
        what: dialog.element.querySelector('select[name="what"]')?.value ?? "",
        difficulty: dialog.element.querySelector('select[name="difficulty"]')?.value ?? "apprentice",
        projectile: Boolean(dialog.element.querySelector('input[name="projectile"]')?.checked)
      }) },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });
  if (!chosen || (typeof chosen !== "object") || !chosen.what) return null;

  // "You may forgo Magical Materialization's effect to target an item created through Magical Materialization
  // within your Melee Range and destroy it."
  if (chosen.what.startsWith("demat:")) {
    const [ownerUuid, itemId] = chosen.what.slice(6).split("|");
    const found = demats.find(({ owner, item: made }) => (owner.uuid === ownerUuid) && (made.id === itemId));
    return found ? { demat: { ownerUuid, itemId, name: found.item.name, ownerName: found.owner.name } } : null;
  }

  const basic = chosen.what.startsWith("basic:") ? basics.find(def => `basic:${def.id}` === chosen.what) : null;
  const kind = basic ? "basic" : chosen.what;
  const tags = basic ? tagsOf(basic) : [];
  let difficulty = chosen.difficulty;
  if (basic) {
    const choices = gearItemFrom(basic, actor).system.craftDCChoices ?? [];
    // The Crystal Ball's: "If attempted to be created through Magical Materialization, the Craft DC for this item is
    // Qualified."
    difficulty = choices.length ? (choices.includes(chosen.difficulty) ? chosen.difficulty : choices[0])
      : keyOf(basic.materializeDC || basic.craftDC);
  }
  // "Increase the Difficulty Category by 1" - unless Magic Crafter, or Tech or Food Materialization with 4+ Ranks.
  const harder = materializeHarder(tags, bought, actor.system) ? harderBy1(difficulty) : { difficulty, diceMinus: 0 };
  // The Check: Use Magic in place of Craft; a [Med] Basic Item's Medicine and a [Food] one's Cooking stay theirs
  // (the user's ruling).
  const skill = tags.includes("med") ? "medicine" : tags.includes("food") ? "cooking" : "useMagic";
  const notes = [];
  if (has("powerBuilder") && (skill === "useMagic")) {
    notes.push("Power Builder: Force may stand in for Magic.");
  }
  if (has("summonsWeapons") && (kind === "weapon")) {
    notes.push(`Weapon Summoner: auto-success up to Grade ${Number(actor.system.skills?.useMagic?.ranks) || 0}.`);
  }
  // Projectile Materialization: "the targeted Ally gains that item" - an Accessory, Apparel or Weapon. Restrictive
  // Weights' Opponent is the one targeted.
  const accessory = basic && (typeOf(basic) === "accessory");
  const recipient = ((kind === "weights") || (chosen.projectile && (accessory || ["weapon", "apparel"].includes(kind)))) ? target : null;
  return {
    kind, id: basic?.id ?? "", name: basic?.name ?? { weapon: "a Weapon", apparel: "a piece of Apparel", weights: "Weights" }[kind],
    difficulty: harder.difficulty, diceMinus: harder.diceMinus, skill, notes,
    recipientUuid: recipient?.uuid ?? "", recipientName: recipient?.name ?? ""
  };
}

/** Magical Materialization's card, or - Dematerialized - the Item destroyed and said. */
async function postMaterialize(actor, maneuver, plan) {
  const chat = await import("./chat.mjs");
  if (plan.demat) {
    const owner = fromUuidSync(plan.demat.ownerUuid);
    if (owner) await chat.requestDeleteItem(owner, plan.demat.itemId);
    return chat.postManeuver(actor, maneuver, { note: `${actor.name} dematerializes ${plan.demat.name} (${plan.demat.ownerName}).` });
  }
  return chat.postMaterialize(actor, maneuver, plan);
}

/**
 * Precognition: "Target an Opponent who hasn't done their turn yet" - one after the current turn in the
 * Initiative Order, the one targeted picked first. Null if there is none, or nothing is picked.
 */
async function askPrecognition(actor, maneuver) {
  const combat = game.combat;
  if (!combat?.started) {
    ui.notifications.warn(`${maneuver.name} needs a Combat Encounter.`);
    return null;
  }
  const later = combat.turns.slice((combat.turn ?? 0) + 1)
    .filter(combatant => combatant.actor && (combatant.actor.uuid !== actor.uuid) && !combatant.defeated);
  if (!later.length) {
    ui.notifications.warn("Nobody is left to act this Combat Round.");
    return null;
  }
  const targeted = new Set(Array.from(game.user.targets ?? []).map(token => token.actor?.uuid));
  const escape = Handlebars.escapeExpression;
  const picked = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: `${actor.name} - ${maneuver.name}` },
    content: `<select name="opponent" class="dbu-gear-pick">${later.map(combatant =>
      `<option value="${combatant.id}" ${targeted.has(combatant.actor.uuid) ? "selected" : ""}>${escape(combatant.name)}</option>`).join("")}</select>`,
    buttons: [
      { action: "foresee", label: "Foresee", default: true, callback: (event, button, dialog) =>
        dialog.element.querySelector('select[name="opponent"]')?.value ?? null },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });
  const combatant = (picked && (picked !== "cancel")) ? combat.combatants.get(picked) : null;
  return combatant ? { combatantId: combatant.id, uuid: combatant.actor.uuid, name: combatant.name } : null;
}

/**
 * "For this Combat Round, move their place in the Initiative Order to the next turn after the current one" -
 * their Initiative set between the current turn's and the next one's, and put back when the Round ends
 * (combat.mjs). What it gives is held on the character until that turn is over.
 */
async function postPrecognition(actor, maneuver, foreseen) {
  const combat = game.combat;
  const turns = combat?.turns ?? [];
  const current = turns[combat?.turn ?? 0];
  const next = turns[(combat?.turn ?? 0) + 1];
  const chat = await import("./chat.mjs");
  if (current && next && (next.id !== foreseen.combatantId)) {
    const high = Number(current.initiative) || 0;
    const low = Number(next.initiative) || 0;
    await chat.requestForesee(combat, foreseen.combatantId, (high + low) / 2);
  }
  await actor.update({ "system.foresight": { opponentUuid: foreseen.uuid, opponentName: foreseen.name, active: false } });
  return chat.postManeuver(actor, maneuver, { note: `${foreseen.name} goes next.` });
}

/**
 * A Unique Ability applied until it is not paid for - the Atmospheric Bubble. Refused while it already is. With Big
 * Bubble: "you may apply the effects of this Unique Ability within a Sphere AoE" - Standard, no Magnitude named -
 * "For every Skill Rank in Use Magic you possess past the second, you can increase the Ki Point Cost of this Unique
 * Ability by 2(T) to increase the Magnitude of this Sphere AoE by 1 Magnitude." Null if backed out of.
 */
async function askSustain(actor, maneuver) {
  const unique = actor.items?.get(maneuver.itemId)?.system?.unique;
  if (!unique) return null;
  if (unique.applied) {
    ui.notifications.warn(`${maneuver.name} is already applied.`);
    return null;
  }
  const { boughtTraits } = await import("./unique.mjs");
  const bought = boughtTraits(unique, getTrait);
  const label = key => key.charAt(0).toUpperCase() + key.slice(1);
  // Bound Battlefield's Destructive Sphere - and, with Variable Battlefield, "any Magnitude between Standard and
  // Destructive", asked.
  const named = String(unique.sphereMagnitude ?? "");
  if (named && bought.some(trait => trait.variableMagnitude === true)) {
    const keys = MAGNITUDES.slice(MAGNITUDES.indexOf("standard"));
    const size = await foundry.applications.api.DialogV2.wait({
      classes: ["dbu-dialog"],
      window: { title: `${actor.name} - ${maneuver.name}` },
      content: `<select name="area" class="dbu-gear-pick">${keys.map(key =>
        `<option value="${key}" ${(key === named) ? "selected" : ""}>${label(key)} Sphere</option>`).join("")}</select>`,
      buttons: [
        { action: "apply", label: "Apply", default: true, callback: (event, button, dialog) =>
          dialog.element.querySelector('select[name="area"]')?.value ?? named },
        { action: "cancel", label: "Cancel" }
      ],
      rejectClose: false
    });
    if (!size || !keys.includes(size)) return null;
    return { extraKi: 0, area: label(size) };
  }
  if (named) return { extraKi: 0, area: label(named) };
  const sphere = bought.find(trait => trait.sphere === true);
  if (!sphere) return { extraKi: 0, area: "" };
  const from = MAGNITUDES.indexOf("standard");
  const ranks = Number(actor.system.skills?.[sphere.sphereStepsSkill]?.ranks) || 0;
  const steps = Math.max(0, Math.min(ranks - (Number(sphere.sphereStepsPast) || 0), MAGNITUDES.length - 1 - from));
  const perStep = (Number(sphere.sphereStepKiPerTier) || 0) * Math.max(1, actor.system.tierOfPower ?? 1);
  const options = [{ value: "", text: "Only you" },
    ...Array.from({ length: steps + 1 }, (_, step) => ({ value: String(step),
      text: `${label(MAGNITUDES[from + step])} Sphere${step ? ` (+${step * perStep} KP)` : ""}` }))];
  const picked = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: `${actor.name} - ${maneuver.name}` },
    content: `<select name="area" class="dbu-gear-pick">${options.map(option =>
      `<option value="${option.value}">${Handlebars.escapeExpression(option.text)}</option>`).join("")}</select>`,
    buttons: [
      { action: "apply", label: "Apply", default: true, callback: (event, button, dialog) =>
        ({ area: dialog.element.querySelector('select[name="area"]')?.value ?? "" }) },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });
  if (!picked || (typeof picked !== "object")) return null;
  if (picked.area === "") return { extraKi: 0, area: "" };
  const step = Number(picked.area) || 0;
  return { extraKi: step * perStep, area: label(MAGNITUDES[from + step]) };
}

/**
 * Binding: "Target a Character who is not at Long Range" - the one targeted. "You cannot use this Unique Ability
 * again if an Opponent is currently Pinned due to the effects of your use of Binding." Null, and said, if not.
 */
function askBinding(actor, maneuver) {
  const unique = actor.items?.get(maneuver.itemId)?.system?.unique;
  if (!unique) return null;
  if (unique.applied) {
    const held = fromUuidSync(unique.boundUuid ?? "");
    ui.notifications.warn(`${maneuver.name} already holds ${held?.name ?? "somebody"}.`);
    return null;
  }
  const target = Array.from(game.user.targets ?? []).map(token => token.actor)
    .find(other => other && (other.uuid !== actor.uuid)) ?? null;
  if (!target) {
    ui.notifications.warn(`${maneuver.name} needs a target. Target a token first.`);
    return null;
  }
  if ((target.system?.hiddenFrom ?? []).some(entry => entry.uuid === actor.uuid)) {
    ui.notifications.warn(`${target.name} is Hidden from ${actor.name}.`);
    return null;
  }
  if (atLongRange(actor, target)) {
    ui.notifications.warn(`${target.name} is at Long Range.`);
    return null;
  }
  return { targetUuid: target.uuid };
}

/**
 * Hide: "Make a Skill Clash (Stealth vs Perception) against all of your Opponents (except those you are in the Melee Range
 * of)." Who is an Opponent is asked - everyone in the Combat Encounter (or the targeted, outside one), ticked but for
 * whose Melee Range you stand in and whom you are already Hidden from. Null if nobody is picked.
 */
/**
 * Healing Hands: whom, and what its Advancements add - asked, then its roll's window, before anything is paid. "Target
 * another Character within your Melee Range"; with Energy Zone, "all Allies within a Large Sphere AoE" instead, ticked.
 * Overexertion's 4(T), Desperate Heal's Capacity (one target), Patch-Up's Apparel: boxes. Natural Healing Hands refuses
 * the Unnatural. Null if it was dropped.
 */
async function askHeal(actor, maneuver) {
  const unique = actor.items?.get(maneuver.itemId)?.system?.unique;
  if (!unique) return null;
  const { boughtTraits, appliedTraits } = await import("./unique.mjs");
  const bought = boughtTraits(unique, getTrait);
  const applied = appliedTraits(unique, getTrait);
  const find = key => bought.find(trait => trait[key]) ?? null;
  const zone = find("healZone");
  const might = find("healMightKiPerTier");
  const desperate = find("healCapacity");
  const patch = find("healPatch");
  const natural = applied.find(trait => trait.healNatural) ?? null;
  const noModifier = applied.some(trait => trait.healNoModifier);
  const extraDice = bought.reduce((sum, trait) => sum + (Number(trait.healDice) || 0), 0);
  const tier = Math.max(1, actor.system.tierOfPower ?? 1);
  const baseTier = Math.max(1, actor.system.baseTierOfPower ?? 1);
  const unnatural = who => who?.system?.effects?.slots?.unnatural === false;
  const escape = Handlebars.escapeExpression;

  const targeted = Array.from(game.user.targets ?? []).map(token => token.actor)
    .find(other => other && (other.uuid !== actor.uuid)) ?? null;
  const pool = zone ? [...new Map((game.combat?.started
    ? (game.combat.combatants ?? []).map(combatant => combatant.actor)
    : Array.from(game.user.targets ?? []).map(token => token.actor))
    .filter(other => other && (other.type === "character") && (other.uuid !== actor.uuid))
    .map(other => [other.uuid, other])).values()] : [];
  if (!targeted && !pool.length) {
    ui.notifications.warn(`${maneuver.name}: target the Character to heal first.`);
    return null;
  }

  const mightKi = might ? (Number(might.healMightKiPerTier) || 0) * tier : 0;
  const own = maneuverKiCost(maneuver, null, actor);
  const capacityNow = Math.max(0, Number(actor.system.capacity?.remaining) || 0);
  const rows = pool.map(other => {
    const closed = natural && unnatural(other) ? `${natural.name}: Unnatural` : "";
    return `<label class="dbu-respond-option" ${closed ? `data-tooltip="${escape(closed)}"` : ""}>
      <input type="checkbox" name="${escape(other.uuid)}" ${closed ? "disabled" : ""}/>
      <span class="dbu-respond-name">${escape(other.name)}</span></label>`;
  }).join("");
  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: `${actor.name} - ${maneuver.name}` },
    content: `${zone ? `<label class="dbu-wager"><span>Heal</span><select name="mode">
        ${targeted ? `<option value="one">${escape(targeted.name)} (Melee Range)</option>` : ""}
        <option value="zone">${escape(zone.name)}: Allies in a ${escape(String(zone.healZone))} Sphere</option></select></label>
        <p class="dbu-respond-hint">Who is within it</p>${rows}`
        : `<p class="dbu-respond-hint">${escape(targeted.name)}</p>`}
      ${might ? `<label class="dbu-respond-option"><input type="checkbox" name="might"/>
        <span class="dbu-respond-name">${escape(might.name)}</span>
        <span class="dbu-respond-source">${mightKi} KP more: their Might on top</span></label>` : ""}
      ${desperate ? `<label class="dbu-respond-option"><input type="checkbox" name="desperate"/>
        <span class="dbu-respond-name">${escape(desperate.name)}</span>
        <span class="dbu-respond-source">Your Capacity in KP: that much on top</span></label>
        ${zone ? `<label class="dbu-wager"><span>For</span><select name="desperateFor">${[targeted, ...pool]
          .filter(Boolean).map(other => `<option value="${escape(other.uuid)}">${escape(other.name)}</option>`)
          .join("")}</select></label>` : ""}` : ""}
      ${patch ? `<label class="dbu-respond-option"><input type="checkbox" name="patch"/>
        <span class="dbu-respond-name">${escape(patch.name)}</span>
        <span class="dbu-respond-source">A damaged piece of their Apparel, whole again</span></label>` : ""}`,
    buttons: [
      { action: "heal", label: "Next", default: true, callback: (event, button, dialog) => {
        const el = dialog.element;
        return {
          mode: el.querySelector('select[name="mode"]')?.value ?? "one",
          ticked: pool.filter(other => el.querySelector(`input[name="${CSS.escape(other.uuid)}"]`)?.checked).map(other => other.uuid),
          might: Boolean(el.querySelector('input[name="might"]')?.checked),
          desperate: Boolean(el.querySelector('input[name="desperate"]')?.checked),
          desperateFor: el.querySelector('select[name="desperateFor"]')?.value ?? targeted?.uuid ?? "",
          patch: Boolean(el.querySelector('input[name="patch"]')?.checked)
        };
      } },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });
  if (!chosen || (typeof chosen !== "object")) return null;

  // Whom: one within the Melee Range, or the Allies ticked.
  let uuids;
  if (chosen.mode === "zone") {
    uuids = chosen.ticked;
    if (!uuids.length) {
      ui.notifications.warn(`${maneuver.name}: tick who is within it.`);
      return null;
    }
  }
  else {
    if (!targeted) return null;
    const far = whyNotWithinMelee(actor, targeted, maneuver.name);
    if (far) {
      ui.notifications.warn(far);
      return null;
    }
    if (natural && unnatural(targeted)) {
      ui.notifications.warn(`${natural.name}: ${targeted.name} is Unnatural.`);
      return null;
    }
    uuids = [targeted.uuid];
  }

  // Desperate Heal: "a number of Ki Points equal to your current Capacity" - what is left of it once this use and
  // Overexertion are paid, which is what it will be.
  const desperateKi = chosen.desperate ? Math.max(0, capacityNow - own - (chosen.might ? mightKi : 0)) : 0;
  const extraKi = (chosen.might ? mightKi : 0) + desperateKi;
  if (extraKi && ((Number(actor.system.ki?.value) || 0) < (own + extraKi))) {
    ui.notifications.warn(`${actor.name} has not the Ki Points for that.`);
    return null;
  }
  const desperateFor = chosen.desperate ? ((chosen.mode === "zone") ? chosen.desperateFor : uuids[0]) : "";

  // The roll, from its window.
  const modifier = noModifier ? 0 : (Number(actor.system.attributes?.magic?.mod) || 0);
  const dice = `${baseTier}d10`;
  const moreDice = extraDice ? `${extraDice * baseTier}d10` : "";
  const { prepareRoll } = await import("./chat.mjs");
  const ready = await prepareRoll(actor, [], maneuver.name, chosen.might ? "And each one's Might" : "", {
    offerWilling: false, formula: { base: dice,
      dice: moreDice ? [{ label: find("healDice")?.name ?? "Dice", formula: moreDice }] : [],
      parts: [...(modifier ? [{ label: "Magic Modifier", value: modifier }] : []),
        ...(desperateKi ? [{ label: desperate.name, value: desperateKi }] : [])] } });
  if (!ready) return null;

  return { uuids, dice: [dice, moreDice].filter(Boolean).join(" + "), modifier,
    mightKi: chosen.might ? mightKi : 0, desperateKi, desperateFor, patch: chosen.patch };
}

/**
 * Illusion: "Target a Square within 8 Squares of you. Create a Sphere AoE centered on that Square" - Destructive with
 * Expanded Illusion, on you with Close Range Illusions - who is inside it, ticked, and which of Use Magic or Bluff is
 * rolled. Null if it was dropped.
 */
async function askIllusion(actor, maneuver) {
  const unique = actor.items?.get(maneuver.itemId)?.system?.unique;
  if (!unique) return null;
  const { boughtTraits, appliedTraits } = await import("./unique.mjs");
  const magnitude = boughtTraits(unique, getTrait).find(trait => trait.illusionMagnitude)?.illusionMagnitude
    ?? getTrait(unique.libraryId)?.illusionMagnitude ?? "standard";
  const onSelf = appliedTraits(unique, getTrait).some(trait => trait.illusionOnSelf);
  const pool = game.combat?.started
    ? (game.combat.combatants ?? []).map(combatant => combatant.actor)
    : Array.from(game.user.targets ?? []).map(token => token.actor);
  const others = [...new Map(pool.filter(other => other && (other.type === "character") && (other.uuid !== actor.uuid))
    .map(other => [other.uuid, other])).values()];
  if (!others.length) {
    ui.notifications.warn(`${maneuver.name}: nobody to deceive${game.combat?.started ? "" : " - target them first"}.`);
    return null;
  }
  const escape = Handlebars.escapeExpression;
  const label = `${magnitude.charAt(0).toUpperCase()}${magnitude.slice(1)} Sphere`;
  const skills = ["useMagic", "bluff"].map(key => ({ key, label: actor.system.skills?.[key]?.label ?? key,
    roll: actor.system.skills?.[key]?.roll ?? 0 }));
  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: `${actor.name} - ${maneuver.name}` },
    content: `<label class="dbu-wager"><span>Roll</span><select name="skill">${skills.map(skill =>
        `<option value="${skill.key}">${escape(skill.label)} ${skill.roll}</option>`).join("")}</select></label>
      <p class="dbu-respond-hint">${onSelf ? `Your Opponents in a ${escape(label)} around you`
        : `Your Opponents in a ${escape(label)} on a Square within 8 Squares`}</p>${others.map(other =>
        `<label class="dbu-respond-option"><input type="checkbox" name="${escape(other.uuid)}"/>
          <span class="dbu-respond-name">${escape(other.name)}</span></label>`).join("")}`,
    buttons: [
      { action: "cast", label: maneuver.name, default: true, callback: (event, button, dialog) => ({
        skill: dialog.element.querySelector('select[name="skill"]')?.value ?? "useMagic",
        uuids: others.filter(other => dialog.element.querySelector(`input[name="${CSS.escape(other.uuid)}"]`)?.checked)
          .map(other => other.uuid)
      }) },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });
  if (!chosen || (typeof chosen !== "object") || !chosen.uuids.length) return null;
  return { ...chosen, area: label };
}

/**
 * Illusion Smash: whom, and with what. "Target an Opponent" - your targeted token; Smash Barrage's "up to 3 Opponents"
 * for its Basic Attack; Portal Control's "any Character" and "any Maneuver with an Action Cost of 1 that targets another
 * Character" instead; Combo Portal's one moved, alone, with "the Knockback Advantage" a box. Null if it was dropped.
 */
async function askSmash(actor, maneuver, { targetUuid = "", combo = false } = {}) {
  const unique = actor.items?.get(maneuver.itemId)?.system?.unique;
  if (!unique) return null;
  const { boughtTraits } = await import("./unique.mjs");
  const bought = boughtTraits(unique, getTrait);
  const barrage = Number(bought.find(trait => trait.smashBarrage)?.smashBarrage) || 0;
  const control = bought.find(trait => trait.portalControl) ?? null;
  const targets = combo
    ? [fromUuidSync(targetUuid)].filter(Boolean)
    : Array.from(game.user.targets ?? []).map(token => token.actor).filter(other => other && (other.uuid !== actor.uuid));
  if (!targets.length) {
    ui.notifications.warn(`${maneuver.name}: target who it reaches first.`);
    return null;
  }
  const { whyHidden } = await import("./hidden.mjs");
  const unseen = targets.map(other => whyHidden(actor, other)).find(Boolean);
  if (unseen) {
    ui.notifications.warn(unseen);
    return null;
  }
  // Portal Control's: the Maneuvers of 1 Action aimed at another - not the Basic Attack, offered on its own, nor this.
  const others = (control && !combo) ? actor.items.filter(item => (item.type === "maneuver") && (item.id !== actor.items.get(maneuver.itemId)?.id))
    .map(definitionOf).filter(entry => entry.requiresTarget && ((entry.actionCost ?? 1) === 1) && (entry.type === "standard")
      && (entry.id !== "basic-attack") && !entry.signatureTechnique && !(entry.tags ?? []).includes("signature"))
    .sort((a, b) => a.name.localeCompare(b.name)) : [];
  const escape = Handlebars.escapeExpression;
  const most = barrage || 1;
  const names = targets.map(other => other.name);
  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: `${actor.name} - ${maneuver.name}` },
    content: `<p class="dbu-respond-hint">${escape(names.join(", "))}${(targets.length > most)
        ? ` - the Basic Attack reaches the first ${most}` : ""}</p>
      ${others.length ? `<label class="dbu-wager"><span>Use</span><select name="use">
        <option value="basic">Basic Attack</option>${others.map(entry =>
          `<option value="${escape(entry.itemId)}">${escape(entry.name)} (${escape(control.name)})</option>`).join("")}
        </select></label>` : ""}
      ${combo ? `<label class="dbu-respond-option"><input type="checkbox" name="knockback"/>
        <span class="dbu-respond-name">Knockback Advantage</span></label>` : ""}`,
    buttons: [
      { action: "smash", label: maneuver.name, default: true, callback: (event, button, dialog) => ({
        use: dialog.element.querySelector('select[name="use"]')?.value ?? "basic",
        knockback: Boolean(dialog.element.querySelector('input[name="knockback"]')?.checked)
      }) },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });
  if (!chosen || (typeof chosen !== "object")) return null;
  const uuids = targets.map(other => other.uuid).slice(0, (chosen.use === "basic") ? most : 1);
  return { use: chosen.use, uuids, knockback: chosen.knockback };
}

/**
 * Lullaby Fist: "Target a Character within a Large Sphere AoE (centered on you)" - your targeted tokens, as many as it
 * may (Multi-Sleep: "an additional Character"); "You can only target a Character once per Combat Encounter".
 */
async function askLullaby(actor, maneuver) {
  const unique = actor.items?.get(maneuver.itemId)?.system?.unique;
  if (!unique) return null;
  const { boughtTraits } = await import("./unique.mjs");
  const most = (Number(getTrait(unique.libraryId)?.lullabyTargets) || 1)
    + boughtTraits(unique, getTrait).reduce((sum, trait) => sum + (Number(trait.lullabyMore) || 0), 0);
  const targets = Array.from(game.user.targets ?? []).map(token => token.actor)
    .filter(other => other && (other.uuid !== actor.uuid));
  if (!targets.length) {
    ui.notifications.warn(`${maneuver.name}: target who it is aimed at first.`);
    return null;
  }
  if (targets.length > most) {
    ui.notifications.warn(`${maneuver.name} targets ${most} Character${(most === 1) ? "" : "s"} at most.`);
    return null;
  }
  const done = (actor.system.usedManeuvers ?? []).filter(entry => entry.startsWith("encounter:lullaby."))
    .map(entry => entry.slice("encounter:lullaby.".length));
  const again = targets.find(other => done.includes(other.uuid));
  if (again) {
    ui.notifications.warn(`${maneuver.name} has already targeted ${again.name} this Combat Encounter.`);
    return null;
  }
  const { whyHidden } = await import("./hidden.mjs");
  const unseen = targets.map(other => whyHidden(actor, other)).find(Boolean);
  if (unseen) {
    ui.notifications.warn(unseen);
    return null;
  }
  return { uuids: targets.map(other => other.uuid) };
}

/** Unleash Dormant Power's four effects, as its window offers them. */
const UNLEASH_EFFECTS = Object.freeze({
  awakening: "Unlocked Potential: a Level 2 Temporary Awakening",
  transformation: "The Transformation Maneuver, Out-of-Sequence",
  enhancement: "An Enhancement (the ARC's approval)",
  form: "A Form (the ARC's approval)"
});

/**
 * Magical Enhancement: "Target an Ally within 8 Squares of you" - your targeted token, measured where there are tokens;
 * Deeper Enhancement's Actions more and Unleash Dormant Power's effect, asked; what it all costs, checked before anything
 * is paid. Null if it was dropped.
 */
async function askEnhance(actor, maneuver) {
  const unique = actor.items?.get(maneuver.itemId)?.system?.unique;
  if (!unique) return null;
  const ally = Array.from(game.user.targets ?? []).map(token => token.actor).find(other => other && (other.uuid !== actor.uuid));
  if (!ally) {
    ui.notifications.warn(`${maneuver.name}: target the Ally first.`);
    return null;
  }
  const away = squaresAway(actor, ally);
  if ((away !== null) && (away > 8)) {
    ui.notifications.warn(`${ally.name} is more than 8 Squares away.`);
    return null;
  }
  const { boughtTraits } = await import("./unique.mjs");
  const bought = boughtTraits(unique, getTrait);
  const deeper = Number(bought.find(trait => trait.enhanceDeeper)?.enhanceDeeper) || 0;
  const unleash = bought.find(trait => trait.enhanceUnleash) ?? null;
  const used = actor.system.usedManeuvers ?? [];
  const unleashes = used.filter(entry => entry === "encounter:unleash").length;
  const why = !unleash ? "" : (unleashes >= 2) ? "twice this Combat Encounter already"
    : used.includes(`encounter:unleash.${ally.uuid}`) ? `already used on ${ally.name} this Encounter` : "";
  const escape = Handlebars.escapeExpression;
  const tier = Math.max(1, actor.system.tierOfPower ?? 1);
  let chosen = { extra: 0, unleash: "" };
  if (deeper || unleash) {
    const picked = await foundry.applications.api.DialogV2.wait({
      classes: ["dbu-dialog"],
      window: { title: `${actor.name} - ${maneuver.name}` },
      content: `<p class="dbu-respond-hint">${escape(ally.name)}</p>
        ${deeper ? `<label class="dbu-wager"><span>Actions more</span><select name="extra">${[0, 1, 2].slice(0, deeper + 1)
          .map(n => `<option value="${n}">${n}${n ? ` (+${n * tier} KP)` : ""}</option>`).join("")}</select></label>` : ""}
        ${unleash ? `<label class="dbu-wager" ${why ? `data-tooltip="${escape(why)}"` : ""}><span>${escape(unleash.name)}</span>
          <select name="unleash" ${why ? "disabled" : ""}><option value="">None</option>${Object.entries(UNLEASH_EFFECTS).map(([key, label]) =>
            `<option value="${key}">${escape(label)}</option>`).join("")}</select></label>
          <p class="dbu-respond-hint">2 Actions and ${Math.floor((Number(actor.system.ki?.max) || 0) / 2)} KP more${why ? ` - ${escape(why)}` : ""}</p>` : ""}`,
      buttons: [
        { action: "enhance", label: maneuver.name, default: true, callback: (event, button, dialog) => ({
          extra: Number(dialog.element.querySelector('select[name="extra"]')?.value) || 0,
          unleash: dialog.element.querySelector('select[name="unleash"]:not([disabled])')?.value ?? ""
        }) },
        { action: "cancel", label: "Cancel" }
      ],
      rejectClose: false
    });
    if (!picked || (typeof picked !== "object")) return null;
    chosen = picked;
  }
  // What it all comes to: the Actions beside its own, the Ki beside its own - Unleash's half of the Maximum off the Ki
  // alone, "this does not affect your Capacity".
  const moreActions = chosen.extra + (chosen.unleash ? 2 : 0);
  const moreKi = chosen.extra * tier;
  const unleashKi = chosen.unleash ? Math.floor((Number(actor.system.ki?.max) || 0) / 2) : 0;
  if (game.combat?.started && (actionsLeft(actor, "standard") < ((maneuver.actionCost ?? 1) + moreActions))) {
    ui.notifications.warn(`${actor.name} has not the Actions for that.`);
    return null;
  }
  if ((Number(actor.system.ki?.value) || 0) < (maneuverKiCost(maneuver, null, actor) + moreKi + unleashKi)) {
    ui.notifications.warn(`${actor.name} has not the Ki Points for that.`);
    return null;
  }
  return { allyUuid: ally.uuid, extra: chosen.extra, unleash: chosen.unleash, moreActions, moreKi, unleashKi };
}

/** God Meteor: who is inside the Destructive Sphere around the Square it falls on - ticked by the player. */
async function askMeteor(actor, maneuver) {
  const pool = game.combat?.started
    ? (game.combat.combatants ?? []).map(combatant => combatant.actor)
    : Array.from(game.user.targets ?? []).map(token => token.actor);
  const others = [...new Map(pool.filter(other => other && (other.type === "character") && (other.uuid !== actor.uuid))
    .map(other => [other.uuid, other])).values()];
  if (!others.length) {
    ui.notifications.warn(`${maneuver.name}: nobody for it to fall on${game.combat?.started ? "" : " - target them first"}.`);
    return null;
  }
  const escape = Handlebars.escapeExpression;
  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: `${actor.name} - ${maneuver.name}` },
    content: `<p class="dbu-respond-hint">Who is within its Destructive Sphere</p>${others.map(other =>
      `<label class="dbu-respond-option"><input type="checkbox" name="${escape(other.uuid)}"/>
        <span class="dbu-respond-name">${escape(other.name)}</span></label>`).join("")}`,
    buttons: [
      { action: "fall", label: maneuver.name, default: true, callback: (event, button, dialog) =>
        others.filter(other => dialog.element.querySelector(`input[name="${CSS.escape(other.uuid)}"]`)?.checked)
          .map(other => other.uuid) },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });
  if (!Array.isArray(chosen) || !chosen.length) return null;
  return { uuids: chosen };
}

/**
 * Finish Sign's Signature Technique: the one declared, while one is - "nor can you declare a different Signature
 * Technique" - or one picked from those held. Null if there is none, or none was picked.
 */
async function askFinishSign(actor, maneuver) {
  const unique = actor.items?.get(maneuver.itemId)?.system?.unique;
  if (!unique) return null;
  const held = signatureTechniquesOf(actor);
  if (unique.finishTechnique && held.some(entry => entry.itemId === unique.finishTechnique)) {
    return { itemId: unique.finishTechnique };
  }
  if (!held.length) {
    ui.notifications.warn(`${actor.name} has no Signature Technique to declare.`);
    return null;
  }
  const escape = Handlebars.escapeExpression;
  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: `${actor.name} - ${maneuver.name}` },
    content: `<select name="technique" class="dbu-gear-pick">${held.map(entry =>
      `<option value="${escape(entry.itemId)}">${escape(entry.name)}</option>`).join("")}</select>`,
    buttons: [
      { action: "declare", label: "Declare", default: true, callback: (event, button, dialog) =>
        dialog.element.querySelector('select[name="technique"]')?.value ?? "" },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });
  return (chosen && (chosen !== "cancel")) ? { itemId: chosen } : null;
}

async function askHide(actor, maneuver, { burst = false, area = "Minor Sphere", all = false } = {}) {
  const { isHiddenFrom } = await import("./hidden.mjs");
  const pool = game.combat?.started
    ? (game.combat.combatants ?? []).map(combatant => combatant.actor)
    : Array.from(game.user.targets ?? []).map(token => token.actor);
  const others = [...new Map(pool.filter(other => other && (other.type === "character") && (other.uuid !== actor.uuid))
    .map(other => [other.uuid, other])).values()];
  if (!others.length) {
    ui.notifications.warn(`${maneuver.name}: nobody to hide from${game.combat?.started ? "" : " - target them first"}.`);
    return null;
  }
  const escape = Handlebars.escapeExpression;
  const rows = others.map(other => {
    const close = (squaresAway(other, actor) !== null) && !whyNotWithinMelee(other, actor, "");
    const already = isHiddenFrom(actor, other);
    // Down Burst: "all Opponents within a Minor Sphere AoE (centered on you)" - the ones beside you ticked, the rest the
    // table's to tick.
    if (burst) {
      const near = (squaresAway(actor, other) !== null) && !whyNotWithinMelee(actor, other, "");
      return `<label class="dbu-respond-option">
        <input type="checkbox" name="${escape(other.uuid)}" ${near ? "checked" : ""}/>
        <span class="dbu-respond-name">${escape(other.name)}</span></label>`;
    }
    // Fake Death's "all Opponents": the Melee Range is no exception there.
    const why = (close && !all) ? "you are in their Melee Range" : already ? "already Hidden from them" : "";
    return `<label class="dbu-respond-option" ${why ? `data-tooltip="${escape(why)}"` : ""}>
      <input type="checkbox" name="${escape(other.uuid)}" ${why ? "disabled" : "checked"}/>
      <span class="dbu-respond-name">${escape(other.name)}</span>
      ${why ? `<span class="dbu-respond-source">${escape(why)}</span>` : ""}</label>`;
  }).join("");
  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: `${actor.name} - ${maneuver.name}` },
    content: `<p class="dbu-respond-hint">${burst ? `Who is within its ${escape(area)}` : "Your Opponents"}</p>${rows}`,
    buttons: [
      { action: "hide", label: maneuver.name, default: true, callback: (event, button, dialog) =>
        others.filter(other => dialog.element.querySelector(`input[name="${CSS.escape(other.uuid)}"]`)?.checked)
          .map(other => other.uuid) },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });
  if (!Array.isArray(chosen) || !chosen.length) return null;
  return { uuids: chosen };
}

/** Hide, paid for: a Skill Clash (Stealth vs Perception) against each; won, Hidden from them. */
async function postHide(actor, maneuver, { uuids }) {
  const chat = await import("./chat.mjs");
  const others = uuids.map(uuid => fromUuidSync(uuid)).filter(Boolean);
  const card = await chat.postManeuver(actor, maneuver, { note: `Hiding from ${others.map(other => other.name).join(", ")}.` });
  for (const other of others) {
    await chat.postSkillClash(actor, other, { ...maneuver, clash: { skill: "stealth", defenderSkills: ["perception"] } },
      { hides: { applied: false } });
  }
  return card;
}

/** Explosion Sorcery: the Characters targeted, one for each Action spent at most - none Hidden from you. */
async function askExplosion(actor, maneuver, actionsSpent) {
  const { whyHidden } = await import("./hidden.mjs");
  const aimed = [...new Map(Array.from(game.user.targets ?? []).map(token => token.actor)
    .filter(other => other && (other.uuid !== actor.uuid)).map(other => [other.uuid, other])).values()];
  const most = Math.max(1, Number(actionsSpent) || 1);
  if (!aimed.length) {
    ui.notifications.warn(`${maneuver.name}: target a Character for each Action spent.`);
    return null;
  }
  if (aimed.length > most) {
    ui.notifications.warn(`${maneuver.name}: ${most} Action${(most === 1) ? "" : "s"}, so ${most} target${(most === 1) ? "" : "s"} at most.`);
    return null;
  }
  const unseen = aimed.map(other => whyHidden(actor, other)).find(Boolean);
  if (unseen) {
    ui.notifications.warn(unseen);
    return null;
  }
  return { uuids: aimed.map(other => other.uuid) };
}

/**
 * Talk: "Target a Character who is suffering from the Compelled Combat Condition or is in a Transformation with the
 * Rampaging Aspect, or has been made an Ally of one of your Opponents through the effects of Manipulation Sorcery ... or
 * Mystic Talisman" - which, asked, and for the second whoever turned them. Refused at someone a lost Talk has shut off
 * this Combat Encounter.
 */
async function askTalk(actor, target, maneuver) {
  const barred = actor.getFlag?.("dbu-ttrpg", "talkBarred");
  if (barred && (barred.combatId === (game.combat?.id ?? "none")) && (barred.uuids ?? []).includes(target.uuid)) {
    ui.notifications.warn(`${actor.name} cannot Talk to ${target.name} again this Combat Encounter.`);
    return null;
  }
  const escape = Handlebars.escapeExpression;
  const compelled = (Number(target.system?.conditions?.compelled) || 0) > 0;
  const pool = game.combat?.started ? (game.combat.combatants ?? []).map(combatant => combatant.actor)
    : (canvas?.tokens?.placeables ?? []).map(token => token.actor);
  const turners = [...new Map(pool.filter(other => other && (other.type === "character")
    && (other.uuid !== actor.uuid) && (other.uuid !== target.uuid)).map(other => [other.uuid, other])).values()];
  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: `${actor.name} - ${maneuver.name}` },
    content: `<label class="dbu-respond-option"><input type="radio" name="mode" value="free" ${compelled || !turners.length ? "checked" : ""}/>
        <span class="dbu-respond-name">Compelled or Rampaging</span>
        <span class="dbu-respond-source">Urgent Clash (Morale)</span></label>
      ${turners.length ? `<label class="dbu-respond-option"><input type="radio" name="mode" value="ally" ${compelled ? "" : "checked"}/>
        <span class="dbu-respond-name">Turned into an Ally by</span>
        <select name="turner">${turners.map(other => `<option value="${escape(other.uuid)}">${escape(other.name)}</option>`).join("")}</select>
        <span class="dbu-respond-source">Clash (Cognitive/Morale)</span></label>` : ""}`,
    buttons: [
      { action: "talk", label: maneuver.name, default: true, callback: (event, button, dialog) => ({
        mode: dialog.element.querySelector('input[name="mode"]:checked')?.value ?? "free",
        turnerUuid: dialog.element.querySelector('select[name="turner"]')?.value ?? ""
      }) },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });
  if (!chosen || (typeof chosen !== "object")) return null;
  if ((chosen.mode === "ally") && !chosen.turnerUuid) return null;
  return chosen;
}

/** Snatch: which of their Basic Items - "who you know possesses a certain Basic Item". Null if they have none, or none is named. */
async function askSnatch(actor, target, maneuver) {
  const items = Array.from(target.items ?? []).filter(item => (item.type === "gear") && (item.system.itemType === "basic"));
  if (!items.length) {
    ui.notifications.warn(`${target.name} has no Basic Item to take.`);
    return null;
  }
  const escape = Handlebars.escapeExpression;
  const picked = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: `${actor.name} - ${maneuver.name}` },
    content: `<select name="item" class="dbu-gear-pick">${items.map(item =>
      `<option value="${item.id}">${escape(item.name)}</option>`).join("")}</select>`,
    buttons: [
      { action: "snatch", label: maneuver.name, default: true, callback: (event, button, dialog) =>
        dialog.element.querySelector('select[name="item"]')?.value ?? null },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });
  const item = (picked && (picked !== "cancel")) ? target.items.get(picked) : null;
  return item ? { itemId: item.id, itemName: item.name } : null;
}

/**
 * Environment Shift: "one of the following Environmental Qualities: Aflame, Bouncy, Dangerous, Electrified, Frozen, or
 * Poisonous" - and who else stands "within the Sphere AoE (centered on you)": everyone in the Encounter (or targeted,
 * outside one), the ones beside you ticked and the rest the table's. Null if backed out of.
 */
async function askShift(actor, maneuver) {
  const file = getTrait(actor.items?.get(maneuver.itemId)?.system?.unique?.libraryId ?? "");
  const QUALITIES = [].concat(file?.shiftQualities ?? []).map(String).filter(Boolean);
  const escape = Handlebars.escapeExpression;
  const pool = game.combat?.started
    ? (game.combat.combatants ?? []).map(combatant => combatant.actor)
    : Array.from(game.user.targets ?? []).map(token => token.actor);
  const others = [...new Map(pool.filter(other => other && (other.type === "character") && (other.uuid !== actor.uuid))
    .map(other => [other.uuid, other])).values()];
  const rows = others.map(other => {
    const near = (squaresAway(actor, other) !== null) && !whyNotWithinMelee(actor, other, "");
    return `<label class="dbu-respond-option"><input type="checkbox" name="${escape(other.uuid)}" ${near ? "checked" : ""}/>
      <span class="dbu-respond-name">${escape(other.name)}</span></label>`;
  }).join("");
  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: `${actor.name} - ${maneuver.name}` },
    content: `<label class="dbu-wager"><span>Quality</span><select name="quality">${QUALITIES.map(key =>
      `<option value="${key}">${escape(getTrait(key)?.name ?? key)}</option>`).join("")}</select></label>
      ${others.length ? `<p class="dbu-respond-hint">Who else is within its Sphere</p>${rows}` : ""}`,
    buttons: [
      { action: "shift", label: maneuver.name, default: true, callback: (event, button, dialog) => ({
        quality: dialog.element.querySelector('select[name="quality"]')?.value ?? "",
        uuids: others.filter(other => dialog.element.querySelector(`input[name="${CSS.escape(other.uuid)}"]`)?.checked)
          .map(other => other.uuid)
      }) },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });
  if (!chosen || (typeof chosen !== "object") || !QUALITIES.includes(chosen.quality)) return null;
  return chosen;
}

/**
 * Energy Gathering: "For each Action spent, gain a stack of Lifeforce from the planet you are on" - held to its ceiling.
 * With a Dramatic Finisher of the Genki Super Profile, the Energy Charge Maneuver offered out of sequence for it, its
 * Charges "1 less than the amount of Lifeforce stacks you gained".
 */
async function postGathering(actor, maneuver, actionsSpent) {
  const chat = await import("./chat.mjs");
  const before = Number(actor.system.resources?.lifeforce?.stacks) || 0;
  await chat.setResource(actor, "lifeforce", before + Math.max(1, Number(actionsSpent) || 1));
  const gained = Math.max(0, (Number(actor.system.resources?.lifeforce?.stacks) || 0) - before);
  const card = await chat.postManeuver(actor, maneuver, { note: `+${gained} Lifeforce.` });
  const genki = actor.items.some(item => (item.type === "maneuver") && (item.system.signature?.level === "dramatic")
    && (item.system.signature?.superProfile === "genki"));
  if (card && genki) await chat.offerGenkiCharge(card, actor, Math.max(0, gained - 1));
  return card;
}

/** Applied: on the Item, with what keeping it costs on top and its Sphere; the card says the Sphere. */
async function postSustain(actor, maneuver, sustaining) {
  const item = actor.items?.get(maneuver.itemId);
  await item?.update({ "system.unique.applied": true, "system.unique.upkeepKi": sustaining.extraKi,
    "system.unique.area": sustaining.area });
  // Flooding Technique: "the Battle Environment becomes Underwater" - theirs, the one they had kept to give back.
  const floods = item?.system?.unique?.floods;
  if (floods) {
    await item.update({ "system.unique.floodedFrom": actor.system.battlefield?.environment ?? "" });
    await actor.update({ "system.battlefield.environment": floods });
  }
  const { postManeuver } = await import("./chat.mjs");
  return postManeuver(actor, maneuver, { note: sustaining.area ? `${sustaining.area} Sphere.` : "" });
}

/** Repair: which Weapon or piece of Apparel. */
async function askRepair(actor) {
  const options = repairables(actor);
  if (!options.length) {
    ui.notifications.warn(`${actor.name} has no Weapon or Apparel to repair.`);
    return null;
  }
  const escape = Handlebars.escapeExpression;
  const rows = options.map((entry, index) => {
    const dc = DBUCharacterData.DIFFICULTIES[entry.craftDC];
    return `<label class="dbu-technique${entry.why ? " dbu-technique-spent" : ""}" ${entry.why ? `data-tooltip="${escape(entry.why)}"` : ""}>
      <input type="radio" name="item" value="${entry.item.id}" ${entry.why ? "disabled" : ""}/>
      <span class="dbu-technique-name">${escape(entry.item.name)}</span>
      <span class="dbu-technique-note">${dc ? `${dc.label} ${dc.tn}` : ""}${entry.why ? ` &middot; ${escape(entry.why)}` : ""}</span></label>`;
  }).join("");
  const picked = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: `${actor.name} - Repair` },
    content: `<div class="dbu-technique-picker">${rows}</div>`,
    buttons: [
      { action: "confirm", label: "Repair", callback: (event, button, dialog) =>
        dialog.element.querySelector('input[name="item"]:checked')?.value ?? null },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });
  const entry = options.find(option => option.item.id === picked);
  return (entry && !entry.why) ? entry : null;
}

/** The Repair card: the Check it owes, at its Difficulty; the card's button mends the Item. */
async function postRepair(actor, maneuver, entry) {
  const { postManeuver } = await import("./chat.mjs");
  const dc = DBUCharacterData.DIFFICULTIES[entry.craftDC];
  const skill = DBUCharacterData.SKILLS[entry.specialty]?.label ?? "Craft";
  return postManeuver(actor, maneuver, {
    note: `${actor.name} repairs ${entry.item.name}: a ${skill} Skill Check${dc
      ? ` at the ${dc.label} Difficulty - Target Number ${dc.tn}, matched or exceeded` : ""}. Roll it from the sheet and `
      + "pick that Difficulty there; the card will say whether it was met.",
    repair: { actorUuid: actor.uuid, itemId: entry.item.id, itemName: entry.item.name, kind: entry.kind,
      skill: entry.specialty, applied: false }
  });
}

async function treatAlly(actor, ally, maneuver) {
  if (!ally) {
    ui.notifications.warn(
      `${actor.name} needs an Ally to treat. Target a token first.`);
    return false;
  }

  const poisoned = (Number(ally.system.conditions?.poisoned) || 0) > 0;
  const chosen = poisoned ? await askTreatment(actor, ally) : { cure: false };
  if (!chosen) return false;

  const healed = await healAlly(actor, ally, maneuver, chosen.cure);

  if (!chosen.cure) return healed;

  // "Against the Character who gave that character the Poisoned Combat Condition." Which
  // this system does not record, so it was asked - and "nobody did" is one of the answers,
  // and the one the entry gives a different rule for.
  const { postSkillClash, postManeuver } = await import("./chat.mjs");
  const culprit = chosen.byUuid ? fromUuidSync(chosen.byUuid) : null;

  if (culprit) {
    return postSkillClash(actor, culprit, maneuver, {
      clashLabel: "Treatment",
      reason: `${actor.name} works against ${culprit.name}'s poison in ${ally.name}. Win `
        + "and it comes out. Their side may answer with Medicine or with Craft (Basic Item).",
      treatment: { applied: false, allyUuid: ally.uuid, allyName: ally.name }
    });
  }

  // "Simply make an Medicine Skill Check with the Apprentice Difficulty to remove the
  // poison." Rolled from the sheet rather than here, where the Base Die, the critical, the
  // Botch and the Karmic Effects already live - and the sheet's roll window is what offers
  // the Difficulty, so it can be picked there and the card says whether it was met.
  //
  // The two cards stay separate: this one owes a Check, the Check is its own card, and
  // nothing joins them. So the poison still comes off by the button here, now with the
  // number it is being judged against stated rather than left to the table.
  const apprentice = DBUCharacterData.DIFFICULTIES.apprentice;
  return postManeuver(actor, maneuver, {
    note: `Nothing gave ${ally.name} that poison, so there is nobody to Clash with: `
      + `${actor.name} makes a Medicine Skill Check at the ${apprentice.label} Difficulty `
      + `- Target Number ${apprentice.tn}, matched or exceeded. Roll it from the sheet and `
      + "pick that Difficulty there; the card will say whether it was met.",
    curePoison: {
      allyUuid: ally.uuid,
      allyName: ally.name,
      // Whoever is owed the Check, since they are the one whose button it is.
      treaterUuid: actor.uuid,
      applied: false
    }
  });
}

/**
 * "Increase their Life Points by 2d10(bT) plus your Skill Bonus in Medicine."
 *
 * Two dice per Base Tier of Power, which is how every (bT) handful of dice here is read -
 * and the Base Tier, so a Transformation does not make a doctor better at medicine.
 *
 * The Skill Bonus and not a roll of it, so an untrained Medicine still adds something: the
 * Bonus is the governing Score plus 2 a Rank, and no Ranks leaves the Score.
 *
 * Halved when the poison is being gone after. Rounded down, which the entry does not say -
 * the halvings here that round up say so.
 *
 * Capped at their maximum like every other regain, and what the card reports is what
 * actually went on rather than what was rolled.
 */
async function healAlly(actor, ally, maneuver, halved) {
  const dice = 2 * Math.max(1, actor.system.baseTierOfPower ?? 1);
  const bonus = actor.system.skills?.medicine?.bonus ?? 0;

  const roll = new Roll(`${dice}d10 + @bonus`, { bonus });
  await roll.evaluate();

  const rolled = halved ? Math.floor(roll.total / 2) : roll.total;

  const { requestActorUpdate } = await import("./chat.mjs");
  const { value, max } = ally.system.life;
  const given = Math.min(max, value + rolled) - value;
  if (given > 0) await requestActorUpdate(ally, { "system.life.value": value + given });

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `${maneuver.name} - ${ally.name} regains ${given} Life Point`
      + `${given === 1 ? "" : "s"}`
      + (halved ? ` (half of ${roll.total}, to go after the poison)` : "")
      + (given < rolled ? " - the rest had nowhere to go" : "")
  });

  return true;
}

/**
 * The Treatment's one question: heal in full, or halve it and go after the poison.
 *
 * Both routes are a Medicine roll, and Medicine is a Required Skill - no Rank, no roll. So
 * a character with no Rank in it is told here rather than two steps later, and the healing
 * is offered on its own. This does not fix the wider gap: a Clash still never asks whether
 * the Skill it names can be rolled, which the Sense Maneuver's file records.
 *
 * Who gave them the poison is asked, because nothing records it. Whatever a clock does
 * know is offered first - a Condition given on a clock names whoever keeps it, which is
 * how the Terrify's Shaken works - and "nobody did" is one of the answers, since the entry
 * gives it a rule of its own.
 *
 * @returns {Promise<?{cure: boolean, byUuid: string}>} null if the player backed out
 */
async function askTreatment(actor, ally) {
  const untrained = Boolean(actor.system.skills?.medicine?.untrained);

  const { whoInflicted, KINDS } = await import("./durations.mjs");
  const recorded = whoInflicted(ally, KINDS.CONDITION, "poisoned");

  const others = (canvas?.tokens?.placeables ?? [])
    .map(token => token.actor)
    .filter(other => other && (other.uuid !== ally.uuid))
    .filter((other, at, all) => all.findIndex(o => o.uuid === other.uuid) === at);

  const options = others.map(other => `
    <option value="${other.uuid}" ${(other.uuid === recorded) ? "selected" : ""}>
      ${Handlebars.escapeExpression(other.name)}</option>`).join("");

  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: `Treatment - ${ally.name}` },
    content: `
      <div class="dbu-defend-list">
        <label class="dbu-defend-option">
          <input type="radio" name="route" value="heal" checked/>
          <span class="dbu-defend-body">
            <span class="dbu-defend-head"><strong>Heal them</strong></span>
            <span class="dbu-defend-summary">2d10(bT) plus your Medicine Skill Bonus, and
              leave the poison where it is.</span>
          </span>
        </label>
        <label class="dbu-defend-option">
          <input type="radio" name="route" value="cure" ${untrained ? "disabled" : ""}/>
          <span class="dbu-defend-body">
            <span class="dbu-defend-head"><strong>Halve it and go after the poison</strong></span>
            <span class="dbu-defend-summary">${untrained
              ? "Medicine is a Required Skill and cannot be rolled without at least one "
                + "Rank, and both routes are a Medicine roll."
              : "Half the Life Points, and a Clash of your Medicine against whoever gave "
                + "it to them - or a Medicine Check at the Apprentice Difficulty where "
                + "nobody did."}</span>
          </span>
        </label>
      </div>
      <label class="dbu-wager">
        <span>Who poisoned them</span>
        <select name="by" ${untrained ? "disabled" : ""}>
          <option value="">Nobody did - a Medicine Check instead</option>
          ${options}
        </select>
        <em>Nothing here records who inflicted a Condition unless it was put on a clock,
          so this is yours to say.</em>
      </label>`,
    buttons: [
      {
        action: "confirm",
        label: "Confirm",
        callback: (event, button, dialog) => ({
          route: dialog.element.querySelector('input[name="route"]:checked')?.value ?? "heal",
          by: dialog.element.querySelector('select[name="by"]').value
        })
      },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });

  if (!chosen || (typeof chosen !== "object")) return null;
  return { cure: chosen.route === "cure", byUuid: chosen.by || "" };
}

/**
 * Whether this Character has been turned into an Item - the second Clash, not the first.
 *
 * Read off the Resource that holds it rather than off the Transfigured Combat Condition: a
 * Transfigured Character who only lost the first Clash is still in the fight, and this
 * asks about the one who is a teacup.
 */
function isAnItem(target) {
  return (Number(target?.system?.resources?.anitem?.stacks) || 0) > 0;
}

/**
 * Turn a Character who is an Item back to normal.
 *
 * Both halves come off: the Resource that stops them acting and the Transfigured Combat
 * Condition, which the same use put on them.
 *
 * And both clocks, which is the part worth doing rather than leaving. A clock that runs out
 * is announced by name whether or not the thing was still there, so one left behind by
 * something undone early says "Transfiguration ran out" at the end of the Encounter for a
 * Character who was turned back rounds ago. The clocks are kept by whoever cast it and name
 * the one who was turned, so dropping them means looking somewhere other than at the
 * target - which is what `clockOff` sweeps for.
 *
 * Whose Transfiguration it was does not matter: the entry says "a Character turned into an
 * Item", not one you turned.
 */
async function revertTransfiguration(actor, target, maneuver) {
  const { setCondition } = await import("./conditions.mjs");
  const { setResource, postManeuver } = await import("./chat.mjs");
  const { clockOff, KINDS } = await import("./durations.mjs");

  const was = target.system.transfigured?.item || "an object";

  await setResource(target, "anitem", 0);
  await setCondition(target, "transfigured", 0);
  await clockOff(target, KINDS.RESOURCE, ["anitem"]);
  await clockOff(target, KINDS.CONDITION, ["transfigured"]);
  await target.update({
    "system.transfigured.item": "",
    "system.transfigured.byName": ""
  });

  return postManeuver(actor, maneuver, {
    note: `${target.name} was ${was}, and is back to normal. No Clash: the entry turns `
      + "them back rather than rolling for it."
  });
}

export async function useManeuver(actor, maneuver, { atFeature = false, techniqueId = "", via = "",
                                                    outOfSequence = false, targetUuid = "",
                                                    presetThrown = null, volleyball = null, meteor = "",
                                                    portal = false, combo = false } = {}) {
  if (!actor || !maneuver) return false;
  // Whether this use is an Ultimate that began as a Super - Ascended Signature. Set when the
  // Technique is picked.
  let ascended = false;

  // "Applied onto other Maneuvers you are doing", so there is no using one on its own.
  // The sheet does not offer it either, and this is the same refusal said where the rule
  // is rather than only where the button is.
  if (maneuver.type === "modifier") {
    ui.notifications.warn(
      `${maneuver.name} is a Modifier Maneuver. It is applied to another Maneuver as you `
      + "use that one, not played on its own.");
    return false;
  }

  // United Attack joins somebody else's attack, so it is played from that attack's card.
  if (maneuver.united) {
    ui.notifications.warn(`${maneuver.name} is played from an Ally's attack card, with its United Attack button.`);
    return false;
  }
  // A Counter Unique Ability answers an attack aimed at you - the Afterimage Technique - so it is played from
  // that attack's Respond, never from the sheet or the hotbar.
  if ((maneuver.type === "counter") && (maneuver.tags ?? []).includes("uniqueAbility")) {
    ui.notifications.warn(`${maneuver.name} is a Counter Maneuver: use Respond on the card of the attack aimed at you.`);
    return false;
  }
  // The Duel answers an attack aimed at you, so it is played from that attack's Respond.
  if (maneuver.duel) {
    ui.notifications.warn(`${maneuver.name} answers an attack aimed at you: use Respond on that attack's card.`);
    return false;
  }
  // Duel Escape answers a Duel begun against your attack, from that attack's card.
  if (maneuver.duelEscape) {
    ui.notifications.warn(`${maneuver.name} is played from your attack's card, when a Duel is begun against it.`);
    return false;
  }

  // The sheet does not offer these, but a stale render should not be a way past the
  // rules either.
  if (maneuver.type === "instant") {
    const blocked = whyNotAnotherInstant(actor);
    if (blocked) {
      ui.notifications.warn(`${actor.name}: ${blocked}`);
      return false;
    }
  }

  // The Throw's once a Round is three with a Multi-Storage Weapon to throw - three in all, by the
  // table's ruling - so a spent Throw is refused here only when there is none; what is thrown is
  // held to its own count once it is chosen.
  const copiesLeft = maneuver.throws && throwsCopies(actor.items.contents, getTrait)
    && (throwsThisRound(actor, maneuver) < MULTI_STORAGE_THROWS);
  // The Signature Technique Maneuver's own [1/Round] is judged once the Technique is picked: Low
  // Stakes Attack "does not count towards your uses of the Signature Technique Maneuver".
  const doorSpent = maneuver.signatureTechnique && (maneuverUsesLeft(actor, maneuver) <= 0);
  if ((maneuverUsesLeft(actor, maneuver) <= 0) && !copiesLeft && !maneuver.signatureTechnique) {
    ui.notifications.warn(`${actor.name} has no uses of ${maneuver.name} left.`);
    return false;
  }

  if (!permitted(actor, maneuver)) return false;

  // Checked here and spent further down, so that a Maneuver abandoned at the target or
  // Profile prompt costs nothing - the same way its Ki Point Cost is handled.
  // Out of sequence - a Technique through Counter or Exploit - its Action Cost is waived.
  // "You can only use this Unique Ability while you are in the God Ki Special State" - God Meteor's.
  if (maneuver.requiresState && !((Number(actor.system.states?.[maneuver.requiresState]) || 0) > 0)) {
    const state = getTrait(maneuver.requiresState)?.name ?? maneuver.requiresState;
    ui.notifications.warn(`${maneuver.name} is only used in the ${state} State.`);
    return false;
  }

  // Debilitated: "cannot use the Combat Recovery Maneuver".
  if ((maneuver.id === "combat-recovery") && actor.getFlag?.("dbu-ttrpg", "debilitatedBy")) {
    ui.notifications.warn(`${actor.name} is Debilitated and cannot use ${maneuver.name}.`);
    return false;
  }

  // Aggressive Taunt: "If you have dealt Damage to an Opponent with 2+ Attacking Maneuvers on your turn, lower the
  // Action Cost of this Unique Ability to 1 until the end of your turn."
  if (maneuver.finishSign) {
    const { tauntsNow } = await import("./chat.mjs");
    if (tauntsNow(actor, maneuver)) maneuver = { ...maneuver, actionCost: 1 };
  }

  if (!outOfSequence && !canAffordActions(actor, maneuver)) return false;

  // "Action Cost: Variable (2~3 Actions)" - so the player says how many, before anything
  // is paid and while the whole thing can still be dropped. One for a Maneuver that costs
  // what it costs, which is every other one.
  const actionsSpent = await askActionsSpent(actor, maneuver);
  if (actionsSpent === null) return false;

  // "Make an Attacking Maneuver using a Signature Technique you have access to." Asked
  // here, after this Maneuver's own limits have been checked against it and before
  // anything is paid: the door is what costs an Action and what may be used once a
  // Combat Round, and the Technique is what the attack then is.
  if (maneuver.signatureTechnique) {
    const technique = techniqueId
      ? signatureTechniquesOf(actor).find(entry => entry.itemId === techniqueId) ?? null
      : await pickSignatureTechnique(actor, maneuver);
    if (!technique) return false;
    const lowStakes = (technique.advantages ?? []).includes("low-stakes-attack");
    if (doorSpent && !lowStakes) {
      ui.notifications.warn(`${actor.name} has no uses of ${maneuver.name} left.`);
      return false;
    }
    const refused = whyNotTechnique(actor, technique, { via });
    if (refused) {
      ui.notifications.warn(refused);
      return false;
    }
    // Ascended Signature: "At Attack Declaration, this Signature Technique can become an Ultimate
    // Signature Technique" - offered while one of the three Ultimates is left.
    if ((technique.advantages ?? []).includes("ascended-signature") && !technique.ultimate
      && (ultimatesUsed(actor) < ULTIMATES_PER_ENCOUNTER)) {
      const ascend = await foundry.applications.api.DialogV2.wait({
        classes: ["dbu-dialog"], window: { title: `${technique.name} - Ascended Signature` },
        content: "<p>Use it as an Ultimate Signature Technique? It cannot be used again this Combat Encounter.</p>",
        buttons: [{ action: "ascend", label: "Ascend" }, { action: "super", label: "As a Super" },
          { action: "cancel", label: "Cancel" }],
        rejectClose: false
      });
      if (!["ascend", "super"].includes(ascend)) return false;
      ascended = (ascend === "ascend");
    }
    maneuver = throughSignatureTechnique(maneuver, technique);
    if (ascended) maneuver = { ...maneuver, ultimate: true, ascended: true };
    // Low Stakes: the door's use is neither needed nor spent.
    if (lowStakes) maneuver = { ...maneuver, usageLimit: null };
    if (via) maneuver = { ...maneuver, via };
    if (presetThrown) maneuver = { ...maneuver, throws: true };
  }

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
    await cancelCharge(actor);
    await recordManeuverType(actor, maneuver.type,
      { messageId: (await postManeuver(actor, maneuver))?.id });
    return true;
  }

  // "This Maneuver covers a lot of different effects which can only be used during your
  // turn." Which one, asked first; only Cancel Energy Charge is something this system can do
  // for itself, and the card says the rest.
  if (maneuver.noEffort) {
    if (game.combat?.started && !isTheirTurn(actor)) {
      ui.notifications.warn(`${actor.name} can only use the ${maneuver.name} Maneuver during `
        + "their turn.");
      return false;
    }
    const effort = await askEffort(actor, maneuver);
    if (!effort) return false;

    await payActions(actor, maneuver);
    await recordManeuverUse(actor, maneuver);
    if (effort.key === "cancel-charge") await cancelCharge(actor);
    await recordManeuverType(actor, maneuver.type,
      { messageId: (await postManeuver(actor, maneuver, { note: `${effort.label}.` }))?.id });
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
    await recordManeuverType(actor, maneuver.type,
      { messageId: (await postManeuver(actor, maneuver, { foundation: null }))?.id, maneuverId: maneuver.id });
    return true;
  }

  if (maneuver.powerDrain) {
    const { drainStore } = await import("./gear.mjs");
    const store = drainStore(actor.items);
    const holding = actor.system.grapple?.partner && (actor.system.grapple?.role === "grappler");

    // The Energy-Suction Device, used without a Grapple: at the one targeted, and a Clash
    // (Physical Strike vs Strike/Dodge) first. The Actions go on the attempt; the drain lands
    // on a win, and what it takes goes into the Device.
    if (!holding) {
      const aimed = game.user.targets.first()?.actor;
      if (!aimed || (aimed.uuid === actor.uuid)) {
        ui.notifications.warn(`Target the one to drain first.`);
        return false;
      }
      await payActions(actor, maneuver, actionsSpent);
      await recordManeuverUse(actor, maneuver);
      await recordManeuverType(actor, maneuver.type);
      const { postDrainClash } = await import("./chat.mjs");
      await postDrainClash(actor, aimed, maneuver, actionsSpent, store);
      return true;
    }

    // "Target the Grappled" aims itself: the one being held is the only answer. Known to
    // be there, since the guard above refused a Grapple with nobody in it.
    const grappled = fromUuidSync(actor.system.grapple?.partner ?? "");
    if (!grappled) {
      ui.notifications.warn(
        `${actor.name} is holding somebody who is no longer here.`);
      return false;
    }

    // Where the Ki goes, from a Grapple: into the Device when it is what gives them Power
    // Drain; theirs to choose when they had it already.
    const into = await drainDestination(actor, maneuver, store);
    if (into === null) return false;

    if (!await drainFrom(actor, grappled, maneuver, actionsSpent, into || null)) return false;

    await payActions(actor, maneuver, actionsSpent);
    await recordManeuverUse(actor, maneuver);
    await recordManeuverType(actor, maneuver.type);
    return true;
  }

  if (maneuver.surge) {
    // takeSurge announces the outcome itself, naming the Maneuver; announcing the
    // Maneuver separately would put the same event in chat twice.
    //
    // A Maneuver that names its Surge is not offering a choice between the two: the
    // Liquid State's sixth effect is a Healing Surge and nothing else, and asking which
    // would be asking a question the rule already answered.
    if (!await takeSurge(actor, {
      source: maneuver.name,
      kind: maneuver.surgeKind || null
    })) return false;
    await payActions(actor, maneuver);
    await recordManeuverUse(actor, maneuver);
    await recordManeuverType(actor, maneuver.type);
    return true;
  }

  // The target is resolved before anything is paid, so a Maneuver that cannot be aimed
  // does not cost Ki.
  let targetActor = null;
  // "Features can be targets for any Attacking Maneuver, just like Characters can." So a
  // Maneuver aimed at one needs no Character to aim at, and the door that would refuse it
  // for having no target steps aside. Everything else about the Maneuver still applies:
  // the cost, the Profile, the limit, the Instant rule.
  if (maneuver.requiresTarget && !atFeature) {
    targetActor = (targetUuid ? fromUuidSync(targetUuid) : null) ?? game.user.targets.first()?.actor ?? null;
    if (!targetActor) {
      ui.notifications.warn(`${maneuver.name} needs a target. Target a token first.`);
      return false;
    }
    if (targetActor.uuid === actor.uuid) {
      ui.notifications.warn(`${maneuver.name} cannot target its own user.`);
      return false;
    }
    // Hidden: "that enemy cannot target you with any Maneuver or effect" - but for the Search Maneuver, which targets
    // nobody else: "Target an Opponent that is Hidden from you".
    const { whyHidden, isHiddenFrom, SEARCH_MANEUVER } = await import("./hidden.mjs");
    const searching = maneuver.id === SEARCH_MANEUVER;
    const unseen = searching
      ? (isHiddenFrom(targetActor, actor) ? "" : `${targetActor.name} is not Hidden from ${actor.name}.`)
      : whyHidden(actor, targetActor);
    if (unseen) {
      ui.notifications.warn(unseen);
      return false;
    }
  }

  // A Signature Technique's Disadvantages about whom it is aimed at, and the two that are the
  // table's word - asked now, while nothing is paid.
  if (maneuver.signature && !maneuver.signatureTechnique && targetActor) {
    const aimedAt = [...new Set([targetActor, ...Array.from(game.user.targets ?? []).map(token => token.actor)]
      .filter(Boolean))];
    for (const target of aimedAt) {
      const reach = whyNotWithinMelee(actor, target, maneuver.name);
      const refused = whyNotTechniqueAgainst(actor, maneuver, target, { reach });
      if (refused) {
        ui.notifications.warn(refused);
        return false;
      }
    }
    if (!await techniqueTableQuestions(actor, maneuver)) return false;

    // Two-Step Strike: "If you would use this Attacking Maneuver with an Opponent within your Melee
    // Range, before Attack Declaration, you may target that Opponent with the Push Back option of the
    // Thrust Maneuver as an Out-of-Sequence Maneuver." It spends the Thrust's 1/Round (the user's
    // ruling), and whether they are in Melee Range is the table's.
    if ((maneuver.advantages ?? []).includes("two-step-strike")) {
      const thrustItem = actor.items.find(item => (item.type === "maneuver") && item.system.thrust);
      const thrust = thrustItem ? definitionOf(thrustItem) : null;
      if (thrust && (maneuverUsesLeft(actor, thrust) > 0)) {
        const push = await foundry.applications.api.DialogV2.confirm({
          classes: ["dbu-dialog"], window: { title: `${maneuver.name} - Two-Step Strike` },
          content: `<p>Push ${Handlebars.escapeExpression(targetActor.name)} Back first, with the Thrust Maneuver out of `
            + "sequence? It uses the Thrust's once a Round.</p>",
          rejectClose: false
        });
        if (push) {
          await recordManeuverUse(actor, thrust);
          await recordManeuverType(actor, "outOfSequence");
          await postThrust(actor, targetActor, { ...thrust, name: `${thrust.name} (Two-Step Strike)` },
            { pushOnly: true });
        }
      }
    }
  }

  // "When you first gain access to this Special Maneuver, you may select one of these
  // additional effects." Asked here because the answer decides which Profiles the picker
  // offers three lines down, and because this is still a point where the whole thing can
  // be called off with nothing spent.
  //
  // `maneuver` is reassigned rather than shadowed: after the choice, the Maneuver being
  // used IS the one with that variant on it, and everything below - the picker, the price,
  // the card - has to be looking at the same one. Threading a second name through all of
  // them is how two copies of one Maneuver come to disagree.
  if (maneuver.tailAttack && !maneuver.tailVariant) {
    const variant = await askTailVariant(actor, maneuver);
    if (!variant) return false;
    await recordTailVariant(actor, maneuver, variant);
    maneuver = { ...maneuver, tailVariant: variant, ...tailProfiles(variant) };
  }

  // The Profile and its Foundation are declared before anything is paid, since both
  // choices can still be aborted - and the Profile is what sets the price.
  let declared = null;
  // Which way a Maneuver that throws a State went, so the card can say it. Blank on
  // everything that throws none, which is all of them but one.
  let toggled = "";
  // Which of a Maneuver's own effects the player picked, where it has several and the
  // choice comes before the dice rather than after them.
  let trick = "";
  let repairing = null;
  let materializing = null;
  let foreseen = null;
  let sustaining = null;
  let binding = null;
  let hiding = null;
  let bursting = null;
  let shifting = null;
  let snatching = null;
  let talking = null;
  let exploding = null;
  let waving = null;
  let faking = null;
  let finishing = null;
  let meteorTargets = null;
  let healing = null;
  let shocking = null;
  let illusioning = null;
  let smashing = null;
  let lulling = null;
  let enhancing = null;
  // Which rank a Soar is taking them to, or `false` for staying put. `null` is the
  // question closed, which is not an answer and stops the Maneuver.
  let soarTo = false;
  // What a Movement was declared as: which Speed bounds it, and whether Rapid Movement
  // was paid for. Both settled before anything is spent, for the same reason.
  let crossing = null;
  // What the Throw Maneuver throws: "whatever you are holding". Asked before the attack is
  // declared, since the Grenade changes what the attack is.
  let thrown = null;
  // The Weapon the attack is made with, where it is made with one, and as what.
  let weaponItem = null;
  let weaponForm = null;
  // Burst Fire's Actions, paid with the Maneuver's own.
  let burstActions = 0;
  if (maneuver.throws) {
    thrown = presetThrown ?? await askThrown(actor, maneuver);
    if (!thrown) return false;
    // Throwing Technique: "When you use the Throw Maneuver, you may use this Signature Technique
    // instead" - with a Throwing Weapon, and a Barrage one for a Combination Technique. The Signature
    // Technique Maneuver's limits are the ones that count.
    if (!presetThrown && thrown.throwing) {
      const techniques = actor.items.filter(item => (item.type === "maneuver")
        && (item.system.advantages ?? []).includes("throwing-technique")
        && ((item.system.signature?.profile !== "combination") || thrown.barrage));
      if (techniques.length) {
        const pick = await foundry.applications.api.DialogV2.wait({
          classes: ["dbu-dialog"], window: { title: `${thrown.name} - Throwing Technique` }, content: "",
          buttons: [{ action: "throw", label: "An ordinary Throw" },
            ...techniques.map(item => ({ action: item.id, label: `As ${item.name}` })),
            { action: "cancel", label: "Cancel" }],
          rejectClose: false
        });
        if (!pick || (pick === "cancel")) return false;
        if (pick !== "throw") return useTechnique(actor, pick, { via: "throw", presetThrown: thrown });
      }
    }
    if (throwsThisRound(actor, maneuver) >= throwsAllowed(thrown)) {
      ui.notifications.warn(`${actor.name} has thrown ${throwsAllowed(thrown)} time`
        + `${(throwsAllowed(thrown) === 1) ? "" : "s"} this Round already.`);
      return false;
    }
    // Barrage Weapon: "you may use the Combination Profile (Physical) instead of the Simple
    // Profile." Asked here, and the Maneuver then names the one chosen.
    if (thrown.barrage) {
      const profile = await foundry.applications.api.DialogV2.wait({
        classes: ["dbu-dialog"], window: { title: `${thrown.name} - Profile` }, content: "",
        buttons: [{ action: "simple", label: "Simple" }, { action: "combination", label: "Combination" },
          { action: "cancel", label: "Cancel" }],
        rejectClose: false
      });
      if (!["simple", "combination"].includes(profile)) return false;
      maneuver = { ...maneuver, profile };
    }
  }
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

    // "You cannot Ki Wager more than 1/4 (rounded up) of your Ki Points on an Attacking
    // Maneuver made through the Throw Maneuver" - the Ki Points they have, not their Capacity.
    // A Buddy's attack is made with the Foundation assigned with its Profile, where it was.
    const foundationsOffered = maneuver.buddyAttack?.foundation
      ? { [maneuver.buddyAttack.foundation]: DBUCharacterData.FOUNDATIONS[maneuver.buddyAttack.foundation] }
      : DBUCharacterData.FOUNDATIONS;
    declared = await declareAttack(locked, foundationsOffered, actor,
      maneuver.throws ? { wagerCap: Math.ceil((actor.system.ki?.value ?? 0) / 4) } : {});
    if (!declared) return false;
    // What is thrown travels with the attack, and what it brings of its own - the Grenade's
    // Sphere and recorded Damage Attribute - stands in for what the Simple Profile has.
    if (thrown) {
      declared = { ...declared, thrown,
        ...(thrown.area ? { area: thrown.area } : {}),
        ...(thrown.damageAttribute ? { damageAttribute: thrown.damageAttribute } : {}) };
      // A Throwing Weapon brings its Category and Qualities - only to what happens once it hits.
      const item = thrown.throwing ? actor.items.get(thrown.itemId) : null;
      if (item) {
        declared = { ...declared,
          weapon: thrownWeaponAttack(armedWith(actor, item, declared, [], targetActor)) };
      }
    }

    // An Assault Buddy's: "The Damage Attribute for this Attacking Maneuver is your Buddy
    // Attribute." It is the Buddy's attack, and no Weapon of the owner's is asked for.
    if (maneuver.buddyAttack) {
      declared = { ...declared, damageAttribute: { label: maneuver.buddyAttack.label,
        value: maneuver.buddyAttack.value } };
    }

    // "When making an Attacking Maneuver, you must choose which Weapon (if any) you are using
    // for that Attacking Maneuver" - among the ones in hand this Attack Type may be made with.
    // Not for a Throw: what is thrown is not what the attack is made with. Nor for one tagged
    // `unarmed` - the Tail Attack's "Unarmed Attacking Maneuver". Nor for a Signature Technique
    // without the Weapon Assisted Advantage: "You cannot use a Signature Technique with an
    // Armed Attack unless it has the 'Weapon Assisted' Advantage."
    const unassisted = (maneuver.tags ?? []).includes("signature")
      && !(declared.advantages ?? []).includes("weapon-assisted");
    if (!thrown && !(maneuver.tags ?? []).includes("unarmed") && !unassisted && !maneuver.buddyAttack) {
      const chosen = await askWeapon(actor, declared);
      if (chosen === null) return false;
      weaponItem = chosen?.item ?? null;
      weaponForm = chosen?.form ?? null;
      if (weaponItem) {
        declared = { ...declared, weapon: armedWith(actor, weaponItem, declared, [], targetActor, weaponForm) };
      }
      // High-Tech: "Your Damage Attribute for any Attacking Maneuver made with this Weapon is
      // Scholarship" - what stands in for the Foundation's, as a Bomb's recorded one does.
      if (declared.weapon?.scholarshipDamage) {
        declared = { ...declared, damageAttribute: { label: "Scholarship Modifier",
          value: actor.system.attributes?.scholarship?.mod ?? 0 } };
      }
    }

    // Elemental Blade, and whose Square effect a two-Profile attack carries.
    const bladed = await elementalBlade(actor, maneuver, declared);
    if (!bladed) return false;
    ({ maneuver, declared } = bladed);
    // Karmic Assault: a Super Profile on an Ultimate, for 2 Karma - asked before the Technique's own
    // questions, so what the Super Profile asks for (Giga Flare's Actions...) is asked with them.
    const assaulted = await karmicAssault(actor, maneuver, declared);
    if (!assaulted) return false;
    ({ maneuver, declared } = assaulted);

    // "You may use your Personality Modifier for the Damage Attribute" - a choice, asked
    // with the declaration, and only where something worn offers one for this attack.
    // Genki's wager, gathered while charging: on the attack, outside the price and the Capacity.
    const genki = ((charging?.maneuverId === maneuver.itemId) && (maneuver.superProfile === "genki"))
      ? (Number(charging.bonusWager) || 0) : 0;
    if (genki) declared = { ...declared, freeWager: genki };
    // And "lose all stacks of Lifeforce. For each stack of Lifeforce lost through this effect, increase your Wound Roll
    // by 2(bT)" - the stacks carried to the Wound Roll.
    if (maneuver.superProfile === "genki") {
      const lifeforce = Number(actor.system.resources?.lifeforce?.stacks) || 0;
      if (lifeforce) {
        declared = { ...declared, genkiLifeforce: lifeforce };
        const { setResource } = await import("./chat.mjs");
        await setResource(actor, "lifeforce", 0);
      }
    }

    // What a Signature Technique asks at Attack Declaration: the table's answers its features need.
    if (maneuver.signature && !maneuver.signatureTechnique) {
      const asked = await askTechniqueDeclaration(actor, maneuver, declared, targetActor);
      if (!asked) return false;
      declared = { ...declared, ...asked };
    }

    const offers = [
      ...damageAttributeOffers(Array.from(actor.items ?? []), maneuver),
      // Brutal Blitz: "If you move a number of Squares equal to your Boosted Speed through the
      // effects of Charging Assault, you may use your Agility as the Damage Attribute."
      ...(((declared.advantages ?? []).includes("brutal-blitz")
        && ((Number(declared.squaresCharged) || 0) >= (Number(actor.system.speed?.boosted) || Infinity)))
        ? [{ attribute: "agility", source: "Brutal Blitz" }] : [])
    ];
    if (offers.length) {
      const chosen = await askDamageAttribute(actor, declared.foundation, offers);
      if (chosen === null) return false;
      if (chosen) declared = { ...declared, damageAttribute: chosen };
    }
  }

    // A Physical Attack only reaches your Melee Range. Checked once the Profile and
    // Foundation are settled, since that is what decides whether the rule applies, and
    // before anything is paid - the declaration can still be taken back here.
    // Not a thrown one: "any number of Squares ... despite its different range".
    // Not with a Weapon whose reach is the whole Battlefield - Elongation - or one held by the
    // mind, whose attack may come from anywhere around its wielder: which Square, the table's.
    const unbounded = declared?.weapon?.wholeBattlefield || declared?.weapon?.telekinetic;
    const outOfReach = targetActor && !maneuver.throws && !unbounded
      && whyNotInReach(actor, targetActor, declared ?? {}, declared?.weapon?.meleeRange ?? 0);
    if (outOfReach) {
      ui.notifications.warn(outOfReach);
      return false;
    }

    // What the Foundation asks of the attacker, which is a different question from where
    // the target is standing: an Energy Attack needs a Force Score of 3 whoever it is
    // aimed at, and whether it is aimed at anybody.
    const wrongFoundation = declared && whyNotThisFoundation(actor, declared.foundation,
      DBUCharacterData.FOUNDATIONS[declared.foundation]?.label);
    if (wrongFoundation) {
      ui.notifications.warn(wrongFoundation);
      return false;
    }

    // "Attacking Maneuvers of any Attack Type other than Physical." Judged here rather
    // than with the rest, because it is about the Foundation and nothing knows which one
    // until it has been declared - which is also why it was the one flag in the family
    // that could not simply be read at the gate.
    if (declared && (declared.foundation !== "physical")
      && !permits(actor.system.effects?.slots, "nonPhysicalAttacks")) {
      ui.notifications.warn(
        `${actor.name} can only make Physical Attacks right now.`);
      return false;
    }

    // "You can only use each Profile once per Combat Round when using a Basic Attack
    // Maneuver, except for the Simple Profile." The picker will not offer a spent one,
    // so this catches the route that does not go through it: the Energy Charge Maneuver
    // declares the Profile in advance, and what it declared can be spent in between by
    // a Cross Counter's Out-of-Sequence Basic Attack.
    const profileSpent = declared && whyNotThisProfile(actor, maneuver, declared.profile);
    if (profileSpent) {
      ui.notifications.warn(profileSpent);
      return false;
    }

    // "You may remove a stack of Power before applying this effect." Asked here, with
    // the rest of what can still be taken back, and only when there is one to drop.
    if (maneuver.powerUp && ((actor.system.resources?.power?.stacks ?? 0) > 0)) {
      const dropped = await askDropPower(actor);
      if (dropped === null) return false;
      if (dropped) await dropPowerStack(actor);
    }

    // "Apply one of the following effects." Asked before anything is paid for, because two
    // of the three open a Clash and the third does not - the answer decides what the rest
    // of this function does, so it cannot wait until after it.
    if (maneuver.magicTrick) {
      trick = await askMagicTrick(actor, maneuver, targetActor);
      if (!trick) return false;
    }

    // Repair: which Item, asked before the Actions are paid.
    if (maneuver.repair) {
      repairing = await askRepair(actor);
      if (!repairing) return false;
    }

    // Magical Materialization: what to make - or, with Dematerialize, what to destroy - asked before it is
    // paid for.
    if (maneuver.materialize) {
      materializing = await askMaterialize(actor, maneuver);
      if (!materializing) return false;
    }

    // Precognition: which Opponent yet to act moves up.
    if (maneuver.precognition) {
      foreseen = await askPrecognition(actor, maneuver);
      if (!foreseen) return false;
    }

    // Applied until it is not paid for: not while it already is, and Big Bubble's Sphere asked.
    // Mind Control: "If you lose, you can't target this Character again ... for the rest of the Combat Encounter."
    if (maneuver.mindControl && targetActor
      && (actor.system.usedManeuvers ?? []).includes(`encounter:mind-control.${targetActor.uuid}`)) {
      ui.notifications.warn(`${maneuver.name} lost against ${targetActor.name} this Combat Encounter.`);
      return false;
    }

    // Magical Enhancement: the Ally, and what its Advancements add.
    if (maneuver.enhances) {
      enhancing = await askEnhance(actor, maneuver);
      if (!enhancing) return false;
    }

    // Lullaby Fist: your targeted tokens - one, or more with Multi-Sleep - none already lulled this Encounter.
    if (maneuver.lullaby) {
      lulling = await askLullaby(actor, maneuver);
      if (!lulling) return false;
    }

    // Internal Assault: "your Debilitated Opponent" - one at a time.
    if (maneuver.debilitates && actor.items?.get(maneuver.itemId)?.system?.unique?.applied) {
      ui.notifications.warn(`${maneuver.name} already holds someone Debilitated.`);
      return false;
    }

    // Illusion Smash: whom, and with what - Combo Portal's one moved, by itself.
    if (maneuver.smashes) {
      smashing = await askSmash(actor, maneuver, { targetUuid, combo });
      if (!smashing) return false;
    }

    // Illusion: who is inside its Sphere, and which Skill is rolled.
    if (maneuver.illusion) {
      illusioning = await askIllusion(actor, maneuver);
      if (!illusioning) return false;
    }

    // Holstein Shock: the Foundation, and its Wound Roll's window.
    if (maneuver.selfShock) {
      shocking = await (await import("./chat.mjs")).askShock(actor, maneuver);
      if (!shocking) return false;
    }

    // Healing Hands: whom, what its Advancements add, and its roll's window.
    if (maneuver.heals) {
      healing = await askHeal(actor, maneuver);
      if (!healing) return false;
    }

    // God Meteor: "Every Character (except the user of this Unique Ability) within a Destructive Sphere AoE centered on
    // your targeted Square" - who they are, asked.
    if (maneuver.meteor) {
      meteorTargets = await askMeteor(actor, maneuver);
      if (!meteorTargets) return false;
    }

    // Finish Sign: the Signature Technique declared - asked the first time, the same one every time after.
    if (maneuver.finishSign) {
      finishing = await askFinishSign(actor, maneuver);
      if (!finishing) return false;
    }

    // Fake Moon: "Only one False Moon can exist on a Battlefield at a time" - yours, at least, while it stands.
    if (maneuver.fakeMoon && actor.items?.get(maneuver.itemId)?.system?.unique?.applied) {
      ui.notifications.warn(`${actor.name}'s False Moon still stands.`);
      return false;
    }

    // Fake Death: "a Clash (Bluff vs Intuition) against all Opponents" - who they are, asked.
    if (maneuver.fakesDeath) {
      faking = await askHide(actor, maneuver, { all: true });
      if (!faking) return false;
    }

    // Explosive Wave: who is within its Sphere - a Minor one, a Large one with Super Explosive Wave.
    if (maneuver.waves) {
      const { boughtTraits } = await import("./unique.mjs");
      const unique = actor.items?.get(maneuver.itemId)?.system?.unique;
      const larger = boughtTraits(unique, getTrait).find(trait => trait.waveMagnitude)?.waveMagnitude ?? "";
      const size = larger || unique?.sphereMagnitude || "minor";
      waving = await askHide(actor, maneuver, { burst: true, area: `${size.charAt(0).toUpperCase()}${size.slice(1)} Sphere` });
      if (!waving) return false;
    }

    // Explosion Sorcery: "Target a Character for each Action spent" - the ones targeted.
    if (maneuver.explodes) {
      exploding = await askExplosion(actor, maneuver, actionsSpent);
      if (!exploding) return false;
    }

    // Environment Shift: which Quality, and who stands in its Sphere.
    if (maneuver.shiftsEnvironment) {
      shifting = await askShift(actor, maneuver);
      if (!shifting) return false;
    }

    // Down Burst: which Opponents are within its Minor Sphere.
    if (maneuver.downBurst) {
      bursting = await askHide(actor, maneuver, { burst: true });
      if (!bursting) return false;
    }

    // Hide: from which Opponents.
    if (maneuver.id === "hide") {
      hiding = await askHide(actor, maneuver);
      if (!hiding) return false;
    }

    // Binding: who, not at Long Range - and never while it already holds somebody.
    if (maneuver.binds) {
      binding = askBinding(actor, maneuver);
      if (!binding) return false;
    }
    else if (maneuver.sustained && !maneuver.togglesState && !maneuver.debilitates) {
      sustaining = await askSustain(actor, maneuver);
      if (!sustaining) return false;
    }

    // "Additionally, if not in a High Environment, you can enter the Low Sky Environment.
    // If in a High Environment, you can increase your rank of High Environment by +/- 1
    // Rank." Which way, and whether at all - "can", so staying where you are is an answer
    // and the Defense Value is bought with the Action either way.
    //
    // Asked here, before anything is paid for, because the question depends on where the
    // character is standing and not on anything this Maneuver does.
    if (maneuver.soars) {
      soarTo = await askSoar(actor, maneuver);
      if (soarTo === null) return false;
    }

    // "You enter the Liquid Special State. If you use this Maneuver while in the Liquid
    // Special State, you exit." Read now rather than written in the file: one Maneuver
    // with two outcomes, and which it is depends on where the character already stands.
    if (maneuver.togglesState) {
      const { setState } = await import("./conditions.mjs");
      const wasIn = (Number(actor.system.states?.[maneuver.togglesState]) || 0) > 0;
      if (!await setState(actor, maneuver.togglesState, wasIn ? 0 : 1)) return false;
      toggled = wasIn ? "out" : "in";
      // Extra Arms: applied while it is what put you there, which is what its upkeep and Faked Extra Arms read.
      const toggler = actor.items?.get(maneuver.itemId);
      if (toggler?.system?.unique?.sustained) await toggler.update({ "system.unique.applied": toggled === "in" });
    }

    // "Gain any number of Holding Back Stacks... you can instead choose to remove any
    // number of them or gain more up to your maximum." One question, because both halves
    // of it come to the same thing: a new total, between nothing and your ceiling.
    if (maneuver.holdingBack) {
      const chosen = await askHoldingBack(actor, maneuver);
      if (!chosen) return false;
      // Written through the one place that clamps a Resource, rather than a second copy of
      // the clamping here.
      const { setResource } = await import("./chat.mjs");
      await setResource(actor, chosen.name, chosen.stacks);
    }

    // "You can only use this Maneuver if you are in a Grapple Maneuver as the Grappler."
    // Refused here, with the rest of what can still be taken back - before the Actions are
    // paid and before anything is asked about how many.
    const nobodyToDrain = whyNotDrain(actor, maneuver);
    if (nobodyToDrain) {
      ui.notifications.warn(nobodyToDrain);
      return false;
    }

    // "If you are the Grappler in a Grapple", which the entry then says again on a line
    // of its own.
    const nobodyToPin = whyNotPin(actor, maneuver);
    if (nobodyToPin) {
      ui.notifications.warn(nobodyToPin);
      return false;
    }

    // Both of these aim themselves, so a partner whose Actor is gone is a refusal here
    // rather than a card that reads a Tier of Power off nothing.
    if ((maneuver.launch || maneuver.pin)
      && !fromUuidSync(actor.system.grapple?.partner ?? "")) {
      ui.notifications.warn(
        `${actor.name} is holding somebody who is no longer here. Let go and start again.`);
      return false;
    }

    // "Against an Opponent you are currently in a Grapple with as the Grappler."
    const nobodyToThrow = whyNotLaunch(actor, maneuver);
    if (nobodyToThrow) {
      ui.notifications.warn(nobodyToThrow);
      return false;
    }

    // How far, and how hard. Asked here because the answer is what the Maneuver costs,
    // and because backing out of it has to leave the Maneuver unused.
    if (maneuver.movement) {
      crossing = await askMovement(actor);
      if (!crossing) return false;
    }

    // "You cannot use the Grapple Maneuver if you are already in a Grapple."
    const alreadyGrappling = whyNotAnotherGrapple(actor, maneuver);
    if (alreadyGrappling) {
      ui.notifications.warn(alreadyGrappling);
      return false;
    }

    // "Target a Character within your Melee Range." The same measurement a Physical
    // Attack makes, with a different sentence around it.
    // Gigantic Grip: "If you are 3+ Size Categories larger than another Character, you cannot be targeted by their use of
    // the Grapple or Pin Maneuvers."
    if ((maneuver.grapple || maneuver.pin) && targetActor && (sizeDifference(targetActor, actor) >= 3)) {
      ui.notifications.warn(`${targetActor.name} is too large for ${actor.name} to ${maneuver.pin ? "Pin" : "Grapple"}.`);
      return false;
    }
    const outOfGrasp = maneuver.grapple && targetActor
      && whyNotWithinMelee(actor, targetActor, "The Grapple Maneuver");
    if (outOfGrasp) {
      ui.notifications.warn(outOfGrasp);
      return false;
    }

    // Talk: which of its two, and against whom.
    if ((maneuver.id === "talk") && targetActor) {
      talking = await askTalk(actor, targetActor, maneuver);
      if (!talking) return false;
    }

    // Snatch: "Target an Opponent within your Melee Range who you know possesses a certain Basic Item."
    if ((maneuver.id === "snatch") && targetActor) {
      const reach = whyNotWithinMelee(actor, targetActor, maneuver.name);
      if (reach) {
        ui.notifications.warn(reach);
        return false;
      }
      snatching = await askSnatch(actor, targetActor, maneuver);
      if (!snatching) return false;
    }

    // Bluff Attack: "Target an Opponent within your Melee Range".
    const outOfBluff = maneuver.bluffs && targetActor && whyNotWithinMelee(actor, targetActor, maneuver.name);
    if (outOfBluff) {
      ui.notifications.warn(outOfBluff);
      return false;
    }

    // "Target an Opponent within your Melee Range" - the same sentence again, for the
    // Maneuver that shoves rather than grabs.
    const outOfShove = maneuver.thrust && targetActor
      && whyNotWithinMelee(actor, targetActor, "The Thrust Maneuver");
    if (outOfShove) {
      ui.notifications.warn(outOfShove);
      return false;
    }

    // Two Absolute Attacks a Combat Round. Checked here for the same reason the reach
    // is: before anything is paid, so the declaration can still be taken back.
    const noMoreAbsolute = whyNotAnotherAbsolute(actor, maneuver);
    if (noMoreAbsolute) {
      ui.notifications.warn(noMoreAbsolute);
      return false;
    }

  // "Certain Maneuvers that can be applied onto other Maneuvers you are doing." Asked
  // last of the questions that can still be walked away from, and paid first of the
  // things that are paid - so whatever a Modifier does is in place before the Maneuver it
  // was applied to is declared.
  // A Technique's Area is what its features build, and Pinpoint Precision opens the Called Shot to
  // it against one target - both decide what the Modifiers below may be.
  if (maneuver.signature && !maneuver.signatureTechnique && declared) {
    const built = buildArea({ profiles: [declared.profile, maneuver.secondProfile].filter(Boolean),
      features: declared.advantages ?? [], choices: maneuver.featureChoices ?? {},
      weaponSteps: Number(declared.weapon?.magnitude) || 0, superProfile: maneuver.superProfile ?? "" }).area;
    const aimed = 1 + (declared.extraTargets?.length ?? 0);
    const pinpoint = (declared.advantages ?? []).includes("pinpoint-precision")
      && !(declared.advantages ?? []).includes("concentrated-strike")
      && built && (magnitudeIndex(built) <= MAGNITUDES.indexOf("standard")) && (aimed === 1);
    maneuver = { ...maneuver, area: built, pinpointCalledShot: Boolean(pinpoint) };
  }

  const modifiers = await askModifiers(actor, maneuver, targetActor);
  if (!modifiers) return false;
  // Consolidated Strike: "To use this Signature Technique, you must apply the Called Shot Modifier
  // Maneuver to this Attacking Maneuver. If you cannot ... then you cannot use this Signature
  // Technique." Nothing has been paid yet, so refusing here costs nothing.
  if ((maneuver.advantages ?? []).includes("consolidated-strike")
    && !modifiers.some(entry => (entry.modifier?.id ?? entry.id) === "called-shot")) {
    ui.notifications.warn(`${maneuver.name}: Consolidated Strike - it must be made with Called Shot.`);
    return false;
  }
  // United Attack (the Disadvantage): "you must first ask consent from one of your Allies who possesses
  // this Signature Technique." Whom is asked now, before anything is paid; they answer on the card.
  if (declared && maneuver.signature && !maneuver.signatureTechnique
    && (maneuver.advantages ?? []).includes("united-attack")) {
    const partner = await askUnitedPartner(actor, maneuver);
    if (!partner) return false;
    declared = { ...declared, unitedWith: partner };
  }

  // What the Weapon does, again with what was applied to the attack - Precision's "any Called
  // Shot made using this Weapon".
  if (weaponItem) {
    declared = { ...declared, weapon: armedWith(actor, weaponItem, declared, modifiers, targetActor, weaponForm) };
    // Burst Fire: "you may spend any number of Actions, this Attacking Maneuver gains an Energy
    // Charge for each Action spent" - asked now, spent with the rest below.
    if (declared.weapon.burstFire) {
      burstActions = await askBurstFire(actor, maneuver, actionsSpent, declared.weapon.name);
      if (burstActions === null) return false;
      if (burstActions) {
        declared = { ...declared, weapon: { ...declared.weapon,
          energyCharges: (declared.weapon.energyCharges ?? 0) + burstActions } };
      }
    }
  }

  // A Profile that borrows a Weapon Category - Elemental (Earth)'s Bludgeoning, (Wind)'s Slashing -
  // as though made with a Weapon. With a Weapon of a Category of its own as well: "you must choose
  // which Weapon Category's effects are applied at Attack Declaration".
  const lends = declared && PROFILES[declared.profile]?.borrowsCategory;
  if (lends) {
    const context = { profile: declared.profile, kiWager: declared.kiWager ?? 0, target: targetActor,
      area: declared.area ?? PROFILES[declared.profile]?.area ?? null,
      sizes: Object.keys(DBUCharacterData.SIZES), getTrait, source: PROFILES[declared.profile].label };
    const lent = borrowedCategory(lends, actor, context);
    let takeLent = true;
    if (weaponItem && declared.weapon?.category && (declared.weapon.category !== lends)) {
      const which = await foundry.applications.api.DialogV2.wait({
        classes: ["dbu-dialog"], window: { title: "Weapon Category" }, content: "",
        buttons: [{ action: "weapon", label: declared.weapon.categoryName },
          { action: "lent", label: lent?.categoryName ?? lends }, { action: "cancel", label: "Cancel" }],
        rejectClose: false
      });
      if (!["weapon", "lent"].includes(which)) return false;
      takeLent = (which === "lent");
    }
    if (takeLent) {
      // The Weapon's own Category put aside for the one borrowed; its Qualities stay.
      const own = weaponItem ? armedWith(actor, weaponItem, declared, modifiers, targetActor,
        { ...(weaponForm ?? activeForm(weaponItem.system.crafted)), category: "" }) : null;
      declared = { ...declared, weapon: withBorrowed(own && { ...own,
        energyCharges: (own.energyCharges ?? 0) + burstActions }, lent) };
    }
  }

  if (declared?.weapon) {
    // Its Area, however many Magnitudes larger the Weapon makes it.
    const area = declared.area ?? PROFILES[declared.profile]?.area ?? null;
    if (area && declared.weapon.magnitude) {
      declared = { ...declared, area: { ...area,
        magnitudeSteps: (Number(area.magnitudeSteps) || 0) + declared.weapon.magnitude } };
    }
  }

  // One Maneuver held at a time: the character has one place to keep it, and a second
  // holding would quietly throw the first away.
  const held = modifiers.find(entry => entry.modifier.delays);
  if (held && delayedManeuver(actor)) {
    ui.notifications.warn(
      `${actor.name} is already holding ${actor.system.delayed.name}. Use it or let their `
      + "turn come round before holding another.");
    return false;
  }

  // All Out: "You must Ki Wager all of your Ki Points on this Attacking Maneuver. This Ki Wager ignores
  // your Capacity, but the amount of Ki Points spent cannot exceed your Max Capacity." What is left
  // once the Technique's own cost is paid, held to the Max Capacity, and only the cost is taken off
  // what Capacity is left. Its Prerequisite - Injured or worse - is the Super Profile's own.
  if (declared && (maneuver.superProfile === "all-out")
    && ["injured", "critical"].includes(actor.system.threshold?.key)) {
    const cost = maneuverKiCost(maneuver, { ...declared, kiWager: 0 }, actor);
    const wager = Math.max(0, Math.min((Number(actor.system.ki?.value) || 0) - cost,
      (Number(actor.system.capacity?.max) || 0) - cost));
    declared = { ...declared, kiWager: wager, wagerFromLife: false };
    maneuver = { ...maneuver, capacityCost: cost };
  }

  // A Movement's price is what was chosen rather than what the file lists: "N/A", until
  // you decide to go faster. Everything else pays what its Profile and its effects say.
  const price = crossing
    ? movementKiCost(actor, crossing)
    : maneuverKiCost(maneuver, declared, actor) + (Number(sustaining?.extraKi) || 0)
      // "6(T) for each Action spent" - Explosion Sorcery's.
      + (maneuver.kiPerAction ? (Math.max(1, Number(actionsSpent) || 1) - 1) * maneuverKiCost(maneuver, null, actor) : 0);

  // A wager paid in Life shares the Capacity with the Ki, so both are checked before
  // either is spent.
  const lifeProblem = crossing ? null : lifeWagerProblem(actor, declared, price);
  if (lifeProblem) {
    ui.notifications.warn(lifeProblem);
    return false;
  }

  if (!await applyModifiers(actor, modifiers)) return false;

  // The Ki an Energy-Suction Device stores may pay for the whole of an Energy or Magic
  // attack instead, off the character's Capacity.
  const fromStore = crossing ? false : await payFromStore(actor, maneuver, declared, price);
  if (fromStore === null) return false;

  // A Movement's Ki taken from a worn Jetpack as far as it goes, and the rest from the
  // character - whose part alone counts against their Capacity. The character's part is
  // paid first, since that is the half that can be refused.
  const moving = crossing ? movementPayment(Array.from(actor.items ?? []), price)
    : { store: null, fromStore: 0, fromSelf: price };
  // Perfect Strike: the full Ki Cost is paid, and Capacity takes half of it - the wager as usual.
  const perfect = !crossing && maneuver.ultimate && ["simple"].includes(declared?.profile)
    && (declared?.advantages ?? []).includes("perfect-strike");
  const wagered = declared?.wagerFromLife ? 0 : (Number(declared?.kiWager) || 0);
  if (perfect) maneuver = { ...maneuver, capacityCost: moving.fromSelf - Math.ceil((moving.fromSelf - wagered) / 2) };
  if (!fromStore && !await spendManeuverCost(actor, maneuver, moving.fromSelf)) return false;
  if (moving.store) {
    await moving.store.update({
      "system.charges": (Number(moving.store.system.charges) || 0) - moving.fromStore });
  }
  if (!crossing) await spendLifeWager(actor, declared);
  if (declared?.finalChanceLife) {
    await actor.update({ "system.life.value": 0 }, { dbuDefeatHeld: true });
    await actor.setFlag("dbu-ttrpg", "finalChance", "pending");
    declared = { ...declared, kiWager: (Number(declared.kiWager) || 0) + declared.finalChanceLife };
  }

  // Empower hands Ki over before anything is recorded, so backing out of the amount
  // leaves the Maneuver unused rather than spent on nothing.
  if (maneuver.empower && !await transferKi(actor, targetActor, actionsSpent)) return false;

  if (!outOfSequence) await payActions(actor, maneuver, actionsSpent);
  if (burstActions) await spendActions(actor, burstActions);
  // Giga Flare's and Super Combination's own Actions, asked at declaration.
  if (declared?.extraActions) await spendActions(actor, declared.extraActions);
  await recordManeuverUse(actor, maneuver);
  // A Signature Technique's own bookkeeping: the Ultimate count, an Ascended one's Encounter, the
  // Round's Fake Out.
  if (maneuver.signature && !maneuver.signatureTechnique) {
    const entries = techniqueUseEntries(maneuver, { ascended: Boolean(maneuver.ascended) });
    if (entries.length) {
      await actor.update({ "system.usedManeuvers": [...(actor.system.usedManeuvers ?? []), ...entries] });
    }
  }

  // What drawing a Weapon, or putting one away, left for this Maneuver - Quick Draw's and the
  // Sheath/Holster's - taken now, whether this is an attack or not: Quick Draw's Strike is only
  // for "your next Maneuver".
  const drawn = drawnBonuses(actor.items.contents, { attacking: Boolean(declared),
    weaponId: weaponItem?.id ?? "", round: game.combat?.started ? (game.combat.round ?? 0) : 0 });
  if (drawn.spent.length) await actor.updateEmbeddedDocuments("Item", drawn.spent);
  // A Technique Hermit, Active, with the Signature Technique chosen for it: "double the benefits
  // from Mentor Buddy for the duration of that Attacking Maneuver" - its Combat Rolls' 1(bT) again.
  const hermit = activeBuddy(actor.items.contents);
  if (declared && hermit && (buddyHeader(hermit, getTrait, "hermit") === true)
    && hermit.system.buddy?.technique && (hermit.system.buddy.technique === maneuver.itemId)) {
    drawn.rows.push({ id: "technique-hermit", name: hermit.name, strikePerTier: 0, woundPerTier: 0,
      strikePerBaseTier: 1, woundPerBaseTier: 1, damageCategoryShift: 0, note: "", atApparel: false,
      atWeapon: null });
  }

  // "Delay its use but pay the Action Cost and KP Cost immediately." Everything that
  // costs has been paid by here and nothing below it has happened yet, which is exactly
  // where a held Maneuver stops: no script, no Profile spent, no card of its own.
  if (held) return holdManeuver(actor, maneuver, held, actionsSpent);
  // A Signature Technique thrown through its Maneuver spends a use of both, where it has
  // one of its own: the Maneuver's limit is across every Technique, and the Technique's
  // is on that Technique.
  if (maneuver.through) await recordManeuverUse(actor, maneuver.through);

  // "Target an Opponent. They become Analyzed until the end of your next turn." The mark
  // sits on them and the clock sits on you, because the turn the entry names is yours -
  // and that clock is also the record of who Analyzed whom.
  if (maneuver.analysis && targetActor) await analyze(actor, targetActor);

  // "Target an Opponent, that Opponent becomes 'Seen' until the end of your next turn."
  // The same split Analysis uses: the mark is theirs and the clock is yours.
  if (maneuver.intuit && targetActor) await markSeen(actor, targetActor);

  // "Increase your Strike Rolls by 1(T) until the end of your turn." Granted here rather
  // than from the Maneuver's own script, because what grants it is a choice made at this
  // moment and a script has no way to be told which options were taken. The bonus itself
  // is in the file, as a passive reading the Resource - which is where a reader looks for
  // the rule.
  if (crossing?.rapid) await takeRapidMovement(actor);
  // Tiny Target: an Opponent 2+ Size Categories larger, whose Melee Range you were in.
  if (crossing?.rapid) await (await import("./chat.mjs")).tinyTarget(actor);
  // "If you use the Movement Maneuver while Hidden through the effect of Fake Death, you stop being Hidden."
  if (crossing) await (await import("./hidden.mjs")).endFakeDeath(actor, "used the Movement Maneuver");

  // And the Profile it was made with, if this is the Maneuver that limit is about. Only
  // inside a Combat Round: there are no rounds outside an Encounter, so nothing would
  // clear the tally and a Profile used once would be spent for ever.
  if (game.combat?.started) await recordProfileUse(actor, maneuver, declared?.profile);

  // Whatever was charged into this one comes with it, and the charging ends here -
  // Guard Down with it. Only for the Maneuver that was actually declared: throwing a
  // different attack cannot collect somebody else's charges, and cannot happen anyway.
  const charges = ((maneuver.itemId && (maneuver.itemId === actor.system.charging?.maneuverId))
    ? await collectCharges(actor)
    : 0)
    // Finish Sign: "When you use your declared Signature Technique, you must convert all of your Finisher stacks into
    // Energy Charges for that Signature Technique."
    + (maneuver.signature ? await (await import("./chat.mjs")).spendFinisher(actor, maneuver.itemId) : 0);

  // The height, now that it is certain to happen. The mark is the file's - `[on used]`
  // gains it and clocks it - and this is the half a script cannot do: a rank is a field,
  // and which one it becomes was answered before anything was paid for.
  //
  // "Where if it would become 0 then you enter the normal Battle Environment for the
  // Square you are occupying" needs nothing of its own: Rank 0 is the ground, and the
  // Battle Environment on the character is the one they have been over the whole time.
  if (maneuver.soars && (soarTo !== false)) {
    await actor.update({ "system.battlefield.highEnvironment": soarTo });
  }

  // Declared, now that it is certain to happen. An effect answering this reads the
  // Maneuver and who it is aimed at.
  await fireMoment(actor, "declare-maneuver", {
    maneuver,
    targets: targetActor ? [targetActor] : []
  });

  // And what this Maneuver itself does, which is a different question: `declare-maneuver`
  // is heard by everything the character holds, and this is heard only by the Maneuver
  // being used. Scoped by the Item's own id, which is what `only` is for.
  await fireMoment(actor, "on-used", {
    maneuver,
    // What the player gave it, for a Maneuver that asked. Readable in its own script as
    // `actionsSpent`, and one everywhere else.
    actionsSpent,
    targets: targetActor ? [targetActor] : []
  }, { only: maneuver.itemId });

  // A Launch aims itself: the Character being thrown is the one already being held, and
  // asking for a target would be asking a question with one answer. Known to be there,
  // since a Grapple with nobody in it was refused above.
  // What the United Attack Disadvantage gives back if the Ally asked does not join: "regain your Action
  // and Ki Points spent on this Signature Technique Maneuver".
  if (declared?.unitedWith) {
    declared = { ...declared, unitedWith: { ...declared.unitedWith, paid: {
      ki: fromStore ? 0 : moving.fromSelf,
      capacity: fromStore ? 0 : (Number.isFinite(maneuver.capacityCost) ? maneuver.capacityCost : moving.fromSelf),
      actions: outOfSequence ? 0 : actionCostOf(maneuver, actionsSpent).amount,
      kind: actionCostOf(maneuver, actionsSpent).kind,
      extraActions: (Number(declared.extraActions) || 0) + (Number(burstActions) || 0)
    } } };
  }
  const card = (maneuver.launch || maneuver.pin)
    ? await postGrappleCheck(actor, fromUuidSync(actor.system.grapple.partner), {
        maneuverName: maneuver.name,
        maneuver,
        kind: maneuver.pin ? "pin" : "launch"
      })
    : maneuver.grapple
    ? await postGrappleCheck(actor, targetActor, {
        maneuverName: maneuver.name,
        // The Maneuver itself, so the card knows whether an Instant can answer it.
        maneuver,
        // Said where the table will be looking rather than refused: "Grappling a Grapple"
        // allows this, after a Might Clash against the Grappler, and that Clash is one of
        // the parts this system leaves to the table.
        reason: targetActor?.system?.grapple?.partner
          ? `${targetActor.name} is already in a Grapple - Grappling a Grapple asks for a `
            + "Might Clash against their Grappler first."
          : ""
      })
    : maneuver.thrust
    ? await postThrust(actor, targetActor, maneuver)
    // "If you target a Character turned into an Item with the Transfiguration Maneuver,
    // turn them back to normal." No Clash, no Item named, nothing rolled - and the Actions
    // and the Ki are already paid, because the entry describes a use of the Maneuver and
    // takes nothing off its cost.
    //
    // "A Character turned into an Item" is one who has been through the second Clash, not
    // one who is merely Transfigured: that is the phrase the entry uses three paragraphs
    // earlier, and it is the only reading where this is worth an Action.
    : (maneuver.transfiguration && isAnItem(targetActor))
    ? await revertTransfiguration(actor, targetActor, maneuver)
    : maneuver.transfiguration
    ? await postTransfiguration(actor, targetActor, maneuver)
    // Asked above the generic Clash branch: the Clash this Maneuver declares is only ever
    // opened for the poison half, and every other use of it opens none at all.
    : maneuver.treatment
    ? await treatAlly(actor, targetActor, maneuver)
    : (maneuver.repair && repairing)
    ? await postRepair(actor, maneuver, repairing)
    : (maneuver.materialize && materializing)
    ? await postMaterialize(actor, maneuver, materializing)
    : (maneuver.precognition && foreseen)
    ? await postPrecognition(actor, maneuver, foreseen)
    : (maneuver.sustained && sustaining)
    ? await postSustain(actor, maneuver, sustaining)
    : ((maneuver.id === "hide") && hiding)
    ? await postHide(actor, maneuver, hiding)
    : maneuver.gathers
    ? await postGathering(actor, maneuver, actionsSpent)
    : maneuver.fakeMoon
    ? await (await import("./chat.mjs")).postFakeMoon(actor, maneuver)
    : (maneuver.mindControl && targetActor)
    ? await (await import("./chat.mjs")).postMindControl(actor, maneuver, targetActor)
    : (maneuver.enhances && enhancing)
    ? await (await import("./chat.mjs")).postEnhance(actor, maneuver, enhancing)
    : (maneuver.lullaby && lulling)
    ? await (await import("./chat.mjs")).postLullaby(actor, maneuver, lulling)
    : (maneuver.debilitates && targetActor)
    ? await (await import("./chat.mjs")).postInternalAssault(actor, maneuver, targetActor)
    : (maneuver.smashes && smashing)
    ? await (await import("./chat.mjs")).postSmash(actor, maneuver, smashing)
    : (maneuver.illusion && illusioning)
    ? await (await import("./chat.mjs")).postIllusion(actor, maneuver, illusioning)
    : (maneuver.selfShock && shocking)
    ? await (await import("./chat.mjs")).postShock(actor, maneuver, shocking)
    : (maneuver.heals && healing)
    ? await (await import("./chat.mjs")).postHealing(actor, maneuver, healing)
    : (maneuver.meteor && meteorTargets)
    ? await (await import("./chat.mjs")).postMeteor(actor, maneuver, meteorTargets.uuids)
    : (maneuver.finishSign && finishing)
    ? await (await import("./chat.mjs")).postFinishSign(actor, maneuver, finishing.itemId)
    : (maneuver.fakesDeath && faking)
    ? await (await import("./chat.mjs")).postFakeDeath(actor, maneuver, faking.uuids)
    : (maneuver.waves && waving)
    ? await (await import("./chat.mjs")).postWave(actor, maneuver, waving.uuids)
    : (maneuver.explodes && exploding)
    ? await (await import("./chat.mjs")).postExplosion(actor, maneuver, exploding.uuids)
    : ((maneuver.id === "talk") && talking)
    ? await (await import("./chat.mjs")).postTalk(actor, targetActor, maneuver, talking)
    : (maneuver.shiftsEnvironment && shifting)
    ? await (await import("./chat.mjs")).postEnvironmentShift(actor, maneuver, shifting)
    : (maneuver.downBurst && bursting)
    ? await (await import("./chat.mjs")).postDownBurst(actor, maneuver, bursting.uuids)
    : (maneuver.binds && binding)
    ? await (await import("./chat.mjs")).postBinding(actor, maneuver, binding)
    // Two of the Magic Trick's three effects open its Clash and the third opens nothing.
    // Asked before the Clash routes below, so the third does not fall into one.
    : (maneuver.magicTrick && (trick === "move"))
    ? await postManeuver(actor, maneuver, {
        note: magicTrickNote(actor, maneuver, trick, null)
      })
    : maneuver.clash
    ? await postSkillClash(actor, targetActor, maneuver, {
        ...(maneuver.magicTrick
          ? { magicTrick: { option: trick, applied: false },
              reason: magicTrickNote(actor, maneuver, trick, targetActor) }
          : {}),
        // Winning reads something off the other side, and the reading goes to one side
        // rather than to the room. Nothing is decided here: what is known is what they
        // hold when the Clash settles, not what they held when it opened.
        ...(maneuver.sense ? { sense: { applied: false } } : {}),
        // Bluff Attack's: Staggered and Shaken won, their Exploit lost.
        ...(maneuver.bluffs ? { bluffAttack: { applied: false } } : {}),
        // Snatch's: won, the Basic Item named is taken.
        ...(snatching ? { pickpocket: { applied: false, steals: "basic", itemId: snatching.itemId } } : {}),
        // Search's: won, no longer Oblivious of them.
        ...((maneuver.id === "search") ? { search: { applied: false } } : {}),
        // Winning leaves a Condition, and whether it leaves a second one depends on what
        // the target was carrying when it settles - so nothing about that is decided here
        // either. The flag is on the card because the Clash's own roll needs it: the
        // penalty for aiming above your Tier is a row on the challenger's side.
        ...(maneuver.terrify ? { terrify: { applied: false } } : {})
      })
    // "Make a Morale Clash against them." A Clash of Saving Throws opened from the sheet
    // rather than out of a card, which is what every other one in these rules comes from.
    : maneuver.clashSaves?.length
    ? await postSaveClash(actor, targetActor, {
        maneuverName: maneuver.name,
        saves: maneuver.clashSaves,
        defenderSaves: maneuver.clashDefenderSaves ?? [],
        reason: saveClashReason(actor, targetActor, maneuver),
        ...(maneuver.insult ? { insult: { applied: false } } : {}),
        ...(maneuver.internalAttack ? { internalAttack: { applied: false, inside: false } } : {}),
        // Devilmite Beam's: won, read off their alignment.
        ...(maneuver.devilmite ? { devilmite: { applied: false } } : {})
      })
    // Thrown at a Feature: no Strike Roll and no Wound Roll, because the entry settles
    // both before the dice - "you always automatically hit a Feature and only inflict
    // Damage equal to your Tier of Power".
    : (atFeature && declared && meteor)
    ? await (await import("./chat.mjs")).postMeteorAttack(actor, maneuver, declared, charges, meteor)
    : (atFeature && declared)
    ? await postFeatureAttack(actor, maneuver, declared, charges)
    : declared
    ? await postAttack(actor, targetActor, maneuver, { ...declared, charges, ...(volleyball ? { volleyball } : {}),
        ...(portal ? { portal: true } : {}) },
        { modifiers: [...appliedModifiers(modifiers), ...drawn.rows], asOutOfSequence: outOfSequence })
    // A Movement card carries whether Rapid Movement was paid for, because the Dodge
    // bonus it buys is against "an Exploit Maneuver provoked by this instance" - and this
    // card is that instance. It carries what was paid for the same reason: a Blockade
    // that wins hands it all back, and by then there is nothing on the character that
    // says what this particular Movement took.
    : await postManeuver(actor, maneuver, {
        rapidMovement: Boolean(crossing?.rapid),
        // What a Maneuver whose whole effect is a number and a sentence says at the table,
        // and which way one that throws a State went. Blank on everything that does
        // something the system can do for itself and says so by doing it.
        note: [maneuverNote(actor, maneuver), stateNote(maneuver, toggled),
               soarNote(maneuver, soarTo), powerUpBreaks(actor, maneuver),
               moving.store ? `${moving.fromStore} Ki from the ${moving.store.name}.` : ""]
          .filter(Boolean).join(" "),
        // The character's Ki and the Item's apart, so a Blockade that wins hands each back
        // to where it came from.
        spent: {
          actions: actionCostOf(maneuver, actionsSpent).amount,
          kind: actionCostOf(maneuver, actionsSpent).kind,
          ki: moving.fromSelf,
          store: moving.store ? { itemId: moving.store.id, ki: moving.fromStore } : null
        }
      });

  // Recorded once the card exists, since which card an Instant was played on is part
  // of the rule: an Out-of-Sequence Maneuver this one offers is not a way out from
  // under it.
  await recordManeuverType(actor, outOfSequence ? "outOfSequence" : maneuver.type, { messageId: card?.id,
    maneuverId: maneuver.through?.id ?? maneuver.id, profile: declared?.profile ?? "" });

  // Final Chance's held Defeat belongs to this card now.
  if (card && (actor.getFlag?.("dbu-ttrpg", "finalChance") === "pending")) {
    await actor.setFlag("dbu-ttrpg", "finalChance", card.id);
  }
  // Karmic Assault's Karma: the attack has been made, so now it is paid.
  if (card) await payKarmicAssault(actor, maneuver, declared);

  // What the Technique does to its user once the card is done: Backlash, Exhaustive, Stat Drain,
  // Powerbomb, All Out.
  if (card && declared && maneuver.signature && !maneuver.signatureTechnique) {
    const { techniqueAfterCard } = await import("./chat.mjs");
    await techniqueAfterCard(actor, card.getFlag?.("dbu-ttrpg", "attack") ?? null);
  }

  // All or Nothing: once the Technique is used, whatever Capacity the round had left is gone.
  if (card && declared && emptiesCapacity(declared.advantages)
      && actor.system.capacity.remaining > 0) {
    await actor.update({ "system.capacity.spent": actor.system.capacity.max });
  }

  // The Grenade: "destroyed after concluding the Maneuver" - thrown, and gone.
  if (thrown?.destroyed && card) await actor.items.get(thrown.itemId)?.delete();

  // A Weapon in hand, thrown, is out of hand - unless a copy went, Multi-Storage's, or it comes
  // back, Boomerang's "you may equip it again immediately, ignoring the distance".
  if (card && thrown?.wielded && !thrown.copies) {
    const back = thrown.returns ? await foundry.applications.api.DialogV2.confirm({
      window: { title: thrown.name }, content: `<p>Take ${Handlebars.escapeExpression(thrown.name)} `
        + "in hand again?</p>", rejectClose: false }) : false;
    if (!back) await actor.items.get(thrown.itemId)?.update({ "system.equipped": false });
  }

  // Fake Out and Trick Attack: a Clash against each target as the attack is declared, settled onto
  // the attack before it is answered.
  if (card && declared && maneuver.signature && !maneuver.signatureTechnique) {
    const features = card.getFlag?.("dbu-ttrpg", "attack")?.technique?.features ?? [];
    const aimed = (card.getFlag?.("dbu-ttrpg", "attack")?.targets ?? []).map(entry => fromUuidSync(entry.uuid))
      .filter(Boolean);
    const trickSkill = maneuver.featureChoices?.["trick-attack"] || "bluff";
    for (const target of aimed) {
      if (features.includes("fake-out")) {
        await postSkillClash(actor, target, { name: `${maneuver.name} (Fake Out)`, type: "instant",
          clash: { skill: "bluff", defenderSkills: ["intuition"] } },
          { techniqueClash: { kind: "fake-out", attackMessageId: card.id, applied: false } });
      }
      if (features.includes("trick-attack")) {
        await postSkillClash(actor, target, { name: `${maneuver.name} (Trick Attack)`, type: "instant",
          clash: { skill: trickSkill, defenderSkills: ["intuition", "perception"] } },
          { techniqueClash: { kind: "trick-attack", attackMessageId: card.id, applied: false } });
      }
    }
  }

  // Concealed: "The first Armed Attack you make with this Weapon each Combat Round, make a Clash
  // (Stealth vs Perception) against the target(s) of that Attacking Maneuver. If you win, they have
  // the Guard Down Combat Condition against this Attacking Maneuver." Opened beside the attack,
  // to be settled before it is answered - against the one it was aimed at.
  const concealedKey = `round:concealed.${weaponItem?.id ?? ""}`;
  if (card && targetActor && declared?.weapon?.concealed
    && !(actor.system.usedManeuvers ?? []).includes(concealedKey)) {
    if (game.combat?.started) {
      await actor.update({ "system.usedManeuvers": [...(actor.system.usedManeuvers ?? []), concealedKey] });
    }
    await postSkillClash(actor, targetActor, {
      name: `${declared.weapon.name} (Concealed)`, type: "instant",
      clash: { skill: "stealth", defenderSkills: ["perception"] }
    }, { concealed: { applied: false, attack: maneuver.name } });
  }


  return true;
}

/**
 * Which Weapon an Attacking Maneuver is made with: "you must choose which Weapon (if any)". Asked
 * only where one in hand may make it - a Physical Weapon a Physical Attack, and so on.
 *
 * @returns {Promise<?(object|false)>} the Weapon, false for none - Unarmed - or null when the
 *   whole thing was put away
 */
async function askWeapon(actor, declared) {
  // Each Weapon in hand, in each form this Attack Type may be made with: as it is, and - a
  // Transforming Weapon - as the Category of another Type it may be used as.
  const offered = weaponsFor(actor.items.contents, declared?.foundation, getTrait)
    .flatMap(item => weaponForms(item, getTrait).filter(form => form.weaponType === declared?.foundation)
      .map((form, at) => ({ key: `${item.id}:${at}`, item, form,
        label: (form.category === activeForm(item.system.crafted).category) ? item.name
          : `${item.name} (as ${getTrait(form.category)?.name ?? form.category})` })));
  if (!offered.length) return false;
  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: "Weapon" },
    content: "",
    buttons: [
      { action: "unarmed", label: "Unarmed" },
      ...offered.map(entry => ({ action: entry.key, label: entry.label })),
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });
  if (!chosen || (chosen === "cancel")) return null;
  if (chosen === "unarmed") return false;
  return offered.find(entry => entry.key === chosen) ?? null;
}

/**
 * Burst Fire's Actions: any number, as many as are left after the Maneuver's own in a Combat
 * Encounter, and up to the most Energy Charges an attack carries out of one.
 *
 * @returns {Promise<?number>} how many, or null when the whole thing was put away
 */
async function askBurstFire(actor, maneuver, actionsSpent, name) {
  const most = game.combat?.started
    ? Math.max(0, actionsLeft(actor) - actionCostOf(maneuver, actionsSpent).amount)
    : DBUCharacterData.MAX_ENERGY_CHARGES;
  if (!most) return 0;
  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"], window: { title: `${name} - Burst Fire` },
    content: "<p>Actions to spend, an Energy Charge for each.</p>",
    buttons: [...Array.from({ length: most + 1 }, (_, at) => ({ action: String(at), label: String(at) })),
      { action: "cancel", label: "Cancel" }],
    rejectClose: false
  });
  const actions = Number(chosen);
  return (Number.isInteger(actions) && (actions >= 0) && (actions <= most)) ? actions : null;
}

/** How many times the Throw Maneuver has been used this Combat Round. */
function throwsThisRound(actor, maneuver) {
  return (actor.system.usedManeuvers ?? []).filter(entry =>
    (entry === maneuver.id) || (entry === `round:${maneuver.id}`)).length;
}

/**
 * A Buddy's attack: the Assault Buddy's "make an Attacking Maneuver of the assigned Profile" - or a
 * Warrior Buddy's Signature Technique in its place - for the Buddy Effect's Action, its Damage
 * Attribute the Buddy Attribute. The owner's attack in every other way, by the table's ruling:
 * their Strike, their Ki, and it counts towards Diminishing Offense.
 *
 * @returns {Promise<boolean>} whether it was made
 */
export async function useBuddyAttack(actor, buddy, { profile = "", foundation = "", techniqueId = "" } = {}) {
  const value = buddyAttribute(actor.system.baseTierOfPower ?? 1);
  const technique = techniqueId ? actor.items.get(techniqueId) : null;
  const base = technique ? definitionOf(technique) : getManeuver("basic-attack");
  if (!base) return false;
  const maneuver = {
    ...base,
    name: `${buddy.name}: ${base.name}`,
    type: "standard",
    actionCost: 1,
    actionCostMax: 0,
    actionCostOpen: false,
    usageLimit: null,
    requiresTarget: true,
    signatureTechnique: false,
    ...(technique ? { signature: true, tags: [...new Set([...(base.tags ?? []), "signature"])] } : {}),
    ...(profile ? { profile } : {}),
    buddyAttack: { itemId: buddy.id, label: `Buddy Attribute (${buddy.name})`, value, foundation }
  };
  return useManeuver(actor, maneuver);
}

/**
 * The Weapon an Attacking Maneuver played out of sequence is made with - the same question an
 * attack in sequence asks, and the same answers: not for one tagged `unarmed`, nor a Signature
 * Technique without Weapon Assisted. What High-Tech makes of the Damage Attribute comes with it.
 *
 * @returns {Promise<?object>} the declaration with its Weapon, as it was when made Unarmed, or null
 *   when it was put away
 */
export async function armOutOfSequence(actor, maneuver, declared, target = null, modifiers = []) {
  const unassisted = (maneuver.tags ?? []).includes("signature")
    && !(declared.advantages ?? []).includes("weapon-assisted");
  if ((maneuver.tags ?? []).includes("unarmed") || unassisted) return declared;
  const chosen = await askWeapon(actor, declared);
  if (chosen === null) return null;
  if (!chosen?.item) return declared;
  const weapon = weaponAttack(chosen.item, actor, { profile: declared.profile, target, form: chosen.form,
    calledShot: (modifiers ?? []).some(entry => entry.id === "called-shot"),
    area: declared.area ?? PROFILES[declared.profile]?.area ?? null, kiWager: declared.kiWager ?? 0,
    sizes: Object.keys(DBUCharacterData.SIZES), getTrait });
  return { ...declared, weapon,
    ...(weapon?.scholarshipDamage ? { damageAttribute: { label: "Scholarship Modifier",
      value: actor.system.attributes?.scholarship?.mod ?? 0 } } : {}) };
}

/** What an attack made with this Weapon carries - see weaponAttack() in gear.mjs. */
function armedWith(actor, item, declared, modifiers, target = null, form = null) {
  return weaponAttack(item, actor, {
    target,
    form,
    profile: declared.profile,
    calledShot: (modifiers ?? []).some(entry => entry.modifier?.id === "called-shot"),
    area: declared.area ?? PROFILES[declared.profile]?.area ?? null,
    kiWager: declared.kiWager ?? 0,
    sizes: Object.keys(DBUCharacterData.SIZES),
    getTrait
  });
}

/**
 * What the Throw Maneuver throws: an Item the character is not wearing, or a Feature and its
 * Hardness Rank - "If it was already a Feature, use the Hardness Rank of that Feature."
 *
 * @returns {Promise<?object>} what `thrownAs` makes of it, or null when put away.
 */
async function askThrown(actor, maneuver) {
  const { HARDNESS_RANKS } = await import("./features.mjs");
  const escape = Handlebars.escapeExpression;
  const items = throwables(actor.items.contents);
  const options = items.map((item, index) => `
      <label class="dbu-technique">
        <input type="radio" name="thrown" value="${item.id}" ${index ? "" : "checked"}/>
        <span class="dbu-technique-name">${escape(item.name)}</span>
      </label>`).join("");
  // "Features cannot have a Hardness value of 0."
  const ranks = HARDNESS_RANKS.filter(hardness => hardness.rank > 0).map(hardness =>
    `<option value="${hardness.rank}">Hardness Rank ${hardness.rank} - ${escape(hardness.material)}</option>`)
    .join("");
  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: maneuver.name },
    content: `<div class="dbu-technique-picker">${options}
      <label class="dbu-technique">
        <input type="radio" name="thrown" value="feature" ${items.length ? "" : "checked"}/>
        <span class="dbu-technique-name">A Feature</span>
        <select name="rank">${ranks}</select>
      </label></div>`,
    buttons: [
      {
        action: "confirm",
        label: "Throw",
        callback: (event, button, dialog) => ({
          pick: dialog.element.querySelector('input[name="thrown"]:checked')?.value ?? "",
          rank: Number(dialog.element.querySelector('select[name="rank"]')?.value) || 1
        })
      },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });
  if (!chosen?.pick) return null;
  if (chosen.pick === "feature") {
    return { itemId: "", name: "Feature", rank: chosen.rank, value: null, mightClash: false };
  }
  const item = actor.items.get(chosen.pick);
  return item ? thrownAs(item, actor, getTrait) : null;
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
export async function declareCharge(actor) {
  const charging = actor.system.charging;

  if (charging.maneuverId) {
    // The ceiling is the declared Profile's, not one number for everything: Mega Flare
    // is built to hold ten, and the Profile was settled when the charging began.
    const ceiling = maxEnergyCharges(charging.profile, DBUCharacterData.MAX_ENERGY_CHARGES);
    if (charging.charges >= ceiling) {
      ui.notifications.warn(
        `That Attacking Maneuver already carries ${ceiling} `
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
  // The same two steps leaving an Encounter takes, from the same place: three fields
  // and the Condition that came with them. Written out twice, they drifted - one copy
  // kept clearing the Profile and the other did not, and only one took Guard Down off.
  await actor.update({ ...NOT_CHARGING });
  await stopCharging(actor);
}

/** Everything the charge was holding, handed to the attack and let go of. */
export async function collectCharges(actor) {
  const { maneuverId, charges } = actor.system.charging;
  if (!maneuverId) return 0;

  await clearCharging(actor);
  return charges;
}

/**
 * Use a Maneuver the character owns, by the Item's id.
 *
 * `atFeature` throws it at a Feature instead of at a Character - one door, so a Maneuver
 * aimed at a wall is bound by everything a Maneuver aimed at somebody is bound by.
 */
export async function useOwnedManeuver(actor, itemId, { atFeature = false } = {}) {
  const item = actor?.items?.get(itemId);
  if (!item || (item.type !== "maneuver")) {
    ui.notifications.warn("That Maneuver is not on this character any more.");
    return false;
  }
  // A Signature Technique is used through the Signature Technique Maneuver, which is what costs
  // the Action and carries the [1/Round] - with this one already picked.
  if ((item.system.tags ?? []).includes("signature") && !item.system.signatureTechnique) {
    return useTechnique(actor, item.id, { atFeature });
  }
  return useManeuver(actor, definitionOf(item), { atFeature });
}

/**
 * Use one Signature Technique, through the character's Signature Technique Maneuver.
 *
 * @param {{via?: string}} options  how it is reached: "counter", "exploit", "throw", or "" for the
 *   Maneuver itself - what Required Counter and the like read.
 */
export async function useTechnique(actor, itemId, { atFeature = false, via = "", outOfSequence = false,
                                                  targetUuid = "", presetThrown = null, volleyball = null,
                                                  meteor = "" } = {}) {
  const door = actor?.items?.find(item => (item.type === "maneuver") && item.system.signatureTechnique);
  if (!door) {
    ui.notifications.warn(`${actor?.name ?? "This character"} has no Signature Technique Maneuver. `
      + "Add the core Maneuvers on the Maneuvers tab.");
    return false;
  }
  return useManeuver(actor, definitionOf(door), { atFeature, techniqueId: itemId, via, outOfSequence,
    targetUuid, presetThrown, volleyball, meteor });
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
      actionCostMax: definition.actionCostMax ?? 0,
      actionCostOpen: Boolean(definition.actionCostOpen),
      kiCost: definition.kiCost ?? 0,
      kiCostPerBaseTier: definition.kiCostPerBaseTier ?? 0,
      attacking: Boolean(definition.attacking),
      absolute: Boolean(definition.absolute),
      requiresTarget: Boolean(definition.requiresTarget),
      defend: Boolean(definition.defend),
      intervene: Boolean(definition.intervene),
      united: Boolean(definition.united),
      duel: Boolean(definition.duel),
      duelEscape: Boolean(definition.duelEscape),
      exploit: Boolean(definition.exploit),
      empower: Boolean(definition.empower),
      grapple: Boolean(definition.grapple),
      launch: Boolean(definition.launch),
      movement: Boolean(definition.movement),
      pin: Boolean(definition.pin),
      powerUp: Boolean(definition.powerUp),
      signatureTechnique: Boolean(definition.signatureTechnique),
      thrust: Boolean(definition.thrust),
      blockade: Boolean(definition.blockade),
      suddenStop: Boolean(definition.suddenStop),
      reflect: Boolean(definition.reflect),
      absorb: Boolean(definition.absorb),
      dirtyTrick: Boolean(definition.dirtyTrick),
      feint: Boolean(definition.feint),
      holdingBack: Boolean(definition.holdingBack),
      insult: Boolean(definition.insult),
      internalAttack: Boolean(definition.internalAttack),
      togglesState: definition.togglesState ?? "",
      fromTrait: definition.fromTrait ?? "",
      fromEffect: definition.fromEffect ?? 0,
      surgeKind: definition.surgeKind ?? "",
      magicTrick: Boolean(definition.magicTrick),
      exploitOnLoss: Boolean(definition.exploitOnLoss),
      clashSaves: [].concat(definition.clashSaves ?? []),
      clashDefenderSaves: [].concat(definition.clashDefenderSaves ?? []),
      moveSkill: definition.moveSkill ?? "",
      movePerRank: definition.movePerRank ?? 0,
      says: definition.says ?? "",
      clashDefenderSkills: [].concat(
        definition.clash?.defenderSkills ?? definition.clashDefenderSkills ?? []),
      baseManeuver: [].concat(definition.baseManeuver ?? []),
      baseForbids: [].concat(definition.baseForbids ?? []),
      damageCategoryShift: definition.damageCategoryShift ?? 0,
      strikePerTier: definition.strikePerTier ?? 0,
      woundPerTier: definition.woundPerTier ?? 0,
      asks: definition.asks ?? "",
      targetsApparel: Boolean(definition.targetsApparel),
      delays: Boolean(definition.delays),
      special: Boolean(definition.special),
      analysis: Boolean(definition.analysis),
      intuit: Boolean(definition.intuit),
      powerDrain: Boolean(definition.powerDrain),
      sense: Boolean(definition.sense),
      terrify: Boolean(definition.terrify),
      transfiguration: Boolean(definition.transfiguration),
      treatment: Boolean(definition.treatment),
      repair: Boolean(definition.repair),
      outsideDiminishing: Boolean(definition.outsideDiminishing),
      tailAttack: Boolean(definition.tailAttack),
      kiCostCoversProfile: Boolean(definition.kiCostCoversProfile),
      tailVariant: definition.tailVariant ?? "",
      kiCostPerTier: definition.kiCostPerTier ?? 0,
      exploitable: definition.exploitable ?? "",
      surge: Boolean(definition.surge),
      charge: Boolean(definition.charge),
      cancelCharge: Boolean(definition.cancelCharge),
      noEffort: Boolean(definition.noEffort),
      throws: Boolean(definition.throws),
      efforts: [].concat(definition.efforts ?? []),
      profile: definition.profile ?? "",
      clashSkill: definition.clash?.skill ?? definition.clashSkill ?? "",
      tags: [].concat(definition.tags ?? []),
      advantages: [].concat(definition.advantages ?? []),
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
