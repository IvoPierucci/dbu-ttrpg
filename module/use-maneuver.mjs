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
  maxEnergyCharges,
  maneuverKiCost,
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
  whyNotWithinMelee,
  whyNotThisFoundation,
  whyNotThisProfile,
  recordProfileUse
} from "./maneuvers.mjs";
import {
  postAttack,
  postGrappleCheck,
  postManeuver,
  postSkillClash,
  takeSurge
} from "./chat.mjs";
import { actionsLeft, isTheirTurn, spendActions, NOT_CHARGING, stopCharging } from "./combat.mjs";
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

  const most = game.combat?.started ? actionsLeft(actor, "standard") : 3;
  if (most < 1) {
    ui.notifications.warn(`${actor.name} has no Actions left this round.`);
    return false;
  }

  const spent = await askEscapeActions(actor, most);
  if (spent === null) return false;

  if (!await spendActions(actor, spent, "standard")) return false;

  const { postGrappleCheck } = await import("./chat.mjs");
  await postGrappleCheck(grappler, actor, {
    maneuverName: "Escaping a Grapple",
    kind: "escape",
    defenderActions: spent,
    // The Grappled is the one doing something, so the card speaks for them even though
    // the Grappler is its challenger.
    speaker: ChatMessage.getSpeaker({ actor }),
    reason: `${actor.name} spends ${spent} Action${spent === 1 ? "" : "s"} to break free`
  });

  return true;
}

/** How many Actions to put into an escape. One is the rule's floor; the rest buy dice. */
async function askEscapeActions(actor, most) {
  if (most <= 1) return 1;

  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: "Escaping a Grapple" },
    content: `<label class="dbu-wager">
        <span>Actions</span>
        <input type="number" name="actions" value="1" min="1" max="${most}"/>
        <em>1 Action makes the Grapple Check. Each one after that raises your Dice Score
          by 1(T).</em>
      </label>`,
    buttons: [
      {
        action: "confirm",
        label: "Confirm",
        callback: (event, button, dialog) =>
          Number(dialog.element.querySelector('input[name="actions"]')?.value)
      },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });

  const typed = Math.floor(Number(chosen));
  return Number.isFinite(typed) ? Math.max(1, Math.min(most, typed)) : null;
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
    clash: item.system.clashSkill ? { skill: item.system.clashSkill } : null
  };
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

  if (maneuver.surge) {
    // takeSurge announces the outcome itself, naming the Maneuver; announcing the
    // Maneuver separately would put the same event in chat twice.
    if (!await takeSurge(actor, { source: maneuver.name })) return false;
    await payActions(actor, maneuver);
    await recordManeuverUse(actor, maneuver);
    await recordManeuverType(actor, maneuver.type);
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

    // "Against an Opponent you are currently in a Grapple with as the Grappler."
    const nobodyToThrow = whyNotLaunch(actor, maneuver);
    if (nobodyToThrow) {
      ui.notifications.warn(nobodyToThrow);
      return false;
    }

    // Who that is, resolved here rather than when the card is built: a uuid can outlive
    // the Actor it names, and a Grapple with nobody in it has nobody to throw. Found
    // before anything is paid, so the Maneuver can still be taken back.
    if (maneuver.launch && !fromUuidSync(actor.system.grapple?.partner ?? "")) {
      ui.notifications.warn(
        `${actor.name} is holding somebody who is no longer here. Let go and start again.`);
      return false;
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

    // Two Absolute Attacks a Combat Round. Checked here for the same reason the reach
    // is: before anything is paid, so the declaration can still be taken back.
    const noMoreAbsolute = whyNotAnotherAbsolute(actor, maneuver);
    if (noMoreAbsolute) {
      ui.notifications.warn(noMoreAbsolute);
      return false;
    }

  if (!await spendManeuverCost(actor, maneuver, maneuverKiCost(maneuver, declared, actor))) {
    return false;
  }

  // Empower hands Ki over before anything is recorded, so backing out of the amount
  // leaves the Maneuver unused rather than spent on nothing.
  if (maneuver.empower && !await transferKi(actor, targetActor, actionsSpent)) return false;

  await payActions(actor, maneuver, actionsSpent);
  await recordManeuverUse(actor, maneuver);

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
  const card = maneuver.launch
    ? await postGrappleCheck(actor, fromUuidSync(actor.system.grapple.partner), {
        maneuverName: maneuver.name,
        maneuver,
        kind: "launch"
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
    : maneuver.clash
    ? await postSkillClash(actor, targetActor, maneuver)
    : declared
    ? await postAttack(actor, targetActor, maneuver, { ...declared, charges })
    : await postManeuver(actor, maneuver);

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
      exploitable: definition.exploitable ?? "",
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
