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
  declareAttack,
  tailProfiles,
  TAIL_VARIANTS,
  TAIL_BASE_PROFILE,
  whyNotInReach,
  maxEnergyCharges,
  maneuverKiCost,
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
// Imported as a bag rather than by name: `soarNote` is not async and cannot wait for a
// dynamic import, and use-maneuver.mjs already imports enough at the top.
import * as soarNames from "./environments.mjs";

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
  return actor.items
    .filter(item => (item.type === "maneuver")
      && (item.system.tags ?? []).includes("signature")
      && !item.system.signatureTechnique)
    .map(definitionOf)
    .sort((a, b) => a.name.localeCompare(b.name));
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
      `${actor.name} has no Signature Techniques. Build one as a Maneuver and mark it a `
      + "Signature Technique on its Rules tab.");
    return null;
  }

  let checked = false;

  const options = techniques.map(technique => {
    const cost = maneuverKiCost(technique, null, actor);
    // Its own limit, if it was given one. The door's [1/Round] is a limit across all of
    // them; this is a limit on this one, and the two are different statements.
    const spent = maneuverUsesLeft(actor, technique) <= 0;
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
      spent ? `no uses left this ${technique.usageLimit?.per ?? "encounter"}` : ""
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
async function askModifiers(actor, base) {
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
    const said = await askModifierNote(entry.modifier);
    if (said === null) return null;
    entry.note = said;
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
    note: entry.note ?? ""
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
 * @returns {Promise<?string>} what was said, or null if the whole thing was dropped
 */
async function askModifierNote(modifier) {
  const said = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: modifier.name },
    content: `
      <label class="dbu-wager">
        <span>${Handlebars.escapeExpression(modifier.asks)}</span>
        <input type="text" name="note" value=""/>
        <em>Written on the card in your own words. What it comes to is the ARC's.</em>
      </label>`,
    buttons: [
      {
        action: "confirm",
        label: "Confirm",
        callback: (event, button, dialog) =>
          String(dialog.element.querySelector('input[name="note"]').value ?? "").trim()
      },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });

  return (typeof said === "string") ? said : null;
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

async function askHoldingBack(actor, maneuver) {
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
async function drainFrom(actor, grappled, maneuver, actionsSpent) {
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
    delays: item.system.delays,
    special: item.system.special,
    analysis: item.system.analysis,
    intuit: item.system.intuit,
    powerDrain: item.system.powerDrain,
    sense: item.system.sense,
    terrify: item.system.terrify,
    transfiguration: item.system.transfiguration,
    treatment: item.system.treatment,
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
      : null
  };
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
        + "and it comes out. Their side may answer with Medicine or with Craft - whether "
        + "their Craft is Basic Items is the table's to say.",
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

export async function useManeuver(actor, maneuver, { atFeature = false } = {}) {
  if (!actor || !maneuver) return false;

  // "Applied onto other Maneuvers you are doing", so there is no using one on its own.
  // The sheet does not offer it either, and this is the same refusal said where the rule
  // is rather than only where the button is.
  if (maneuver.type === "modifier") {
    ui.notifications.warn(
      `${maneuver.name} is a Modifier Maneuver. It is applied to another Maneuver as you `
      + "use that one, not played on its own.");
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

  if (maneuverUsesLeft(actor, maneuver) <= 0) {
    ui.notifications.warn(`${actor.name} has no uses of ${maneuver.name} left.`);
    return false;
  }

  if (!permitted(actor, maneuver)) return false;

  // Checked here and spent further down, so that a Maneuver abandoned at the target or
  // Profile prompt costs nothing - the same way its Ki Point Cost is handled.
  if (!canAffordActions(actor, maneuver)) return false;

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
    const technique = await pickSignatureTechnique(actor, maneuver);
    if (!technique) return false;
    maneuver = throughSignatureTechnique(maneuver, technique);
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
      { messageId: (await postManeuver(actor, maneuver, { foundation: null }))?.id });
    return true;
  }

  if (maneuver.powerDrain) {
    // "Target the Grappled" aims itself: the one being held is the only answer. Known to
    // be there, since the guard above refused a Grapple with nobody in it.
    const grappled = fromUuidSync(actor.system.grapple?.partner ?? "");
    if (!grappled) {
      ui.notifications.warn(
        `${actor.name} is holding somebody who is no longer here.`);
      return false;
    }

    if (!await drainFrom(actor, grappled, maneuver, actionsSpent)) return false;

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
  // Which rank a Soar is taking them to, or `false` for staying put. `null` is the
  // question closed, which is not an answer and stops the Maneuver.
  let soarTo = false;
  // What a Movement was declared as: which Speed bounds it, and whether Rapid Movement
  // was paid for. Both settled before anything is spent, for the same reason.
  let crossing = null;
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
    const outOfGrasp = maneuver.grapple && targetActor
      && whyNotWithinMelee(actor, targetActor, "The Grapple Maneuver");
    if (outOfGrasp) {
      ui.notifications.warn(outOfGrasp);
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
  const modifiers = await askModifiers(actor, maneuver);
  if (!modifiers) return false;

  // One Maneuver held at a time: the character has one place to keep it, and a second
  // holding would quietly throw the first away.
  const held = modifiers.find(entry => entry.modifier.delays);
  if (held && delayedManeuver(actor)) {
    ui.notifications.warn(
      `${actor.name} is already holding ${actor.system.delayed.name}. Use it or let their `
      + "turn come round before holding another.");
    return false;
  }

  // A Movement's price is what was chosen rather than what the file lists: "N/A", until
  // you decide to go faster. Everything else pays what its Profile and its effects say.
  const price = crossing
    ? movementKiCost(actor, crossing)
    : maneuverKiCost(maneuver, declared, actor);

  // A wager paid in Life shares the Capacity with the Ki, so both are checked before
  // either is spent.
  const lifeProblem = crossing ? null : lifeWagerProblem(actor, declared, price);
  if (lifeProblem) {
    ui.notifications.warn(lifeProblem);
    return false;
  }

  if (!await applyModifiers(actor, modifiers)) return false;

  if (!await spendManeuverCost(actor, maneuver, price)) return false;
  if (!crossing) await spendLifeWager(actor, declared);

  // Empower hands Ki over before anything is recorded, so backing out of the amount
  // leaves the Maneuver unused rather than spent on nothing.
  if (maneuver.empower && !await transferKi(actor, targetActor, actionsSpent)) return false;

  await payActions(actor, maneuver, actionsSpent);
  await recordManeuverUse(actor, maneuver);

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

  // And the Profile it was made with, if this is the Maneuver that limit is about. Only
  // inside a Combat Round: there are no rounds outside an Encounter, so nothing would
  // clear the tally and a Profile used once would be spent for ever.
  if (game.combat?.started) await recordProfileUse(actor, maneuver, declared?.profile);

  // Whatever was charged into this one comes with it, and the charging ends here -
  // Guard Down with it. Only for the Maneuver that was actually declared: throwing a
  // different attack cannot collect somebody else's charges, and cannot happen anyway.
  const charges = (maneuver.itemId && (maneuver.itemId === actor.system.charging?.maneuverId))
    ? await collectCharges(actor)
    : 0;

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
        ...(maneuver.internalAttack ? { internalAttack: { applied: false, inside: false } } : {})
      })
    // Thrown at a Feature: no Strike Roll and no Wound Roll, because the entry settles
    // both before the dice - "you always automatically hit a Feature and only inflict
    // Damage equal to your Tier of Power".
    : (atFeature && declared)
    ? await postFeatureAttack(actor, maneuver, declared, charges)
    : declared
    ? await postAttack(actor, targetActor, maneuver, { ...declared, charges },
        { modifiers: appliedModifiers(modifiers) })
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
               soarNote(maneuver, soarTo)]
          .filter(Boolean).join(" "),
        spent: {
          actions: actionCostOf(maneuver, actionsSpent).amount,
          kind: actionCostOf(maneuver, actionsSpent).kind,
          ki: price
        }
      });

  // Recorded once the card exists, since which card an Instant was played on is part
  // of the rule: an Out-of-Sequence Maneuver this one offers is not a way out from
  // under it.
  await recordManeuverType(actor, maneuver.type, { messageId: card?.id });

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
  return useManeuver(actor, definitionOf(item), { atFeature });
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
      delays: Boolean(definition.delays),
      special: Boolean(definition.special),
      analysis: Boolean(definition.analysis),
      intuit: Boolean(definition.intuit),
      powerDrain: Boolean(definition.powerDrain),
      sense: Boolean(definition.sense),
      terrify: Boolean(definition.terrify),
      transfiguration: Boolean(definition.transfiguration),
      treatment: Boolean(definition.treatment),
      outsideDiminishing: Boolean(definition.outsideDiminishing),
      tailAttack: Boolean(definition.tailAttack),
      kiCostCoversProfile: Boolean(definition.kiCostCoversProfile),
      tailVariant: definition.tailVariant ?? "",
      kiCostPerTier: definition.kiCostPerTier ?? 0,
      exploitable: definition.exploitable ?? "",
      surge: Boolean(definition.surge),
      charge: Boolean(definition.charge),
      cancelCharge: Boolean(definition.cancelCharge),
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
