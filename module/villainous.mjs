/**
 * Villainous Maneuvers (the Adversaries page): "a form of Special Maneuver that all Adversaries have access to" - each its
 * file in traits/maneuvers/villainous/, used as any Maneuver is (use-maneuver.mjs), and what each does here: asked before
 * anything is paid (villainousBefore), done once its card is made (villainousAfter). "For Villainous Maneuvers, you may use
 * your Adversary Actions as if they were Actions for their Action Cost" - adversaryActionsFor.
 */

import { isAdversary, isPlayerCharacter, isMinion } from "./actor-types.mjs";

/** The source their files name. */
export const VILLAINOUS_SOURCE = "Villainous Maneuver";

/** Whether a Maneuver is a Villainous Maneuver. */
export function isVillainousManeuver(maneuver) {
  return maneuver?.source === VILLAINOUS_SOURCE;
}

/** Those waiting for the Transformations (the user's: written, and left for when they are built). */
const WAITING = new Set(["face-me-at-full-power", "stop-wasting-my-time"]);

/**
 * Its Action Cost paid in Adversary Actions - the Counter Actions One-Man Army gives in their place: whether it may be, and
 * whether it is. Asked where both would do; Adversary Actions alone where only they would.
 */
export async function adversaryActionsFor(actor, maneuver, amount, standardLeft) {
  if (!isVillainousManeuver(maneuver) || !actor?.system?.adversaryNarrative || (amount <= 0)) return false;
  const left = Number(actor.system.actions?.counterLeft) || 0;
  if (left < amount) return false;
  if (standardLeft < amount) return true;
  return Boolean(await foundry.applications.api.DialogV2.confirm({ classes: ["dbu-dialog"],
    window: { title: `${actor.name} - ${maneuver.name}` },
    content: `<p>Pay its ${amount} Action${(amount === 1) ? "" : "s"} with Adversary Actions (${left} left)?</p>`, rejectClose: false }));
}

/** Whom the user has targeted, other than the one using it. */
function targeted(actor) {
  return Array.from(game.user?.targets ?? []).map(token => token.actor).filter(other => other && (other.uuid !== actor.uuid));
}

/**
 * Before anything is paid: what it needs, asked, or why it cannot be - a plan for after, or null to stop.
 */
export async function villainousBefore(actor, maneuver) {
  const escape = Handlebars.escapeExpression;
  if (WAITING.has(maneuver.id)) {
    ui.notifications.warn(`${maneuver.name} waits for the Transformations.`);
    return null;
  }
  if (!isAdversary(actor)) {
    ui.notifications.warn(`${maneuver.name} is an Adversary's.`);
    return null;
  }
  if (maneuver.id === "one-man-army") {
    if (!actor.system.adversaryNarrative) return void ui.notifications.warn(`${actor.name} has no Adversary Actions - an Elite's or a Villain's, not in a 1-on-1 Duel.`) ?? null;
    const left = Number(actor.system.actions?.counterLeft) || 0;
    if (left < 2) return void ui.notifications.warn(`${actor.name} has ${left} Adversary Action${(left === 1) ? "" : "s"} left; One-Man Army spends 2.`) ?? null;
    const { definitionOf } = await import("./use-maneuver.mjs");
    const offered = Array.from(actor.items).filter(item => item.type === "maneuver").map(definitionOf)
      .filter(entry => (entry.type === "standard") && ((Number(entry.actionCost) || 1) === 1) && !entry.actionCostOpen && (entry.id !== maneuver.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!offered.length) return void ui.notifications.warn(`${actor.name} has no Standard Maneuver of 1 Action.`) ?? null;
    const picked = await foundry.applications.api.DialogV2.wait({ classes: ["dbu-dialog"],
      window: { title: `${actor.name} - One-Man Army` },
      content: `<label class="dbu-respond-option" data-tooltip="Used as an Instant Maneuver, for 2 Adversary Actions">
        <span class="dbu-respond-name">Standard Maneuver</span><select name="maneuver">${offered.map(entry =>
          `<option value="${escape(entry.itemId)}">${escape(entry.name)}</option>`).join("")}</select></label>`,
      buttons: [{ action: "use", label: "Use it", default: true, callback: (ev, button, dialog) => dialog.element.querySelector('[name="maneuver"]').value },
        { action: "cancel", label: "Cancel" }], rejectClose: false });
    const chosen = offered.find(entry => entry.itemId === picked);
    return chosen ? { chosen } : null;
  }
  if (maneuver.id === "one-on-one-duel") {
    const [who] = targeted(actor);
    if (!who || !isPlayerCharacter(who)) return void ui.notifications.warn("1-on-1 Duel: target a Player Character.") ?? null;
    const agreed = await foundry.applications.api.DialogV2.confirm({ classes: ["dbu-dialog"], window: { title: `${actor.name} - 1-on-1 Duel` },
      content: `<p>Does ${escape(who.name)} agree to a 1-on-1 Battle?</p>`, rejectClose: false });
    return agreed ? { who } : null;
  }
  if (maneuver.id === "insta-kill") {
    // "Target a Minion (except a Special Minion that is not a Duplicate Minion) or Buddy": the Minion targeted; or else a Buddy -
    // an Item of another's in the Combat, not a token - picked.
    const [who] = targeted(actor);
    if (who && isMinion(who)) {
      if (who.system?.specialMinion && !who.system?.duplicate) {
        return void ui.notifications.warn(`Insta-Kill: ${who.name} is a Special Minion that is not a Duplicate.`) ?? null;
      }
      return { name: who.name };
    }
    const buddies = (game.combat?.combatants?.contents ?? []).map(combatant => combatant.actor)
      .filter(other => other && (other.uuid !== actor.uuid))
      .flatMap(other => Array.from(other.items ?? []).filter(item => (item.type === "gear") && (item.system?.itemType === "buddy"))
        .map(item => ({ id: item.uuid, name: `${item.name} (${other.name}'s)` })));
    if (!buddies.length) return void ui.notifications.warn("Insta-Kill: target a Minion - nobody in the Combat has a Buddy.") ?? null;
    const picked = await foundry.applications.api.DialogV2.wait({ classes: ["dbu-dialog"], window: { title: `${actor.name} - Insta-Kill` },
      content: `<label class="dbu-respond-option"><span class="dbu-respond-name">Buddy</span><select name="buddy">${buddies.map(entry =>
        `<option value="${escape(entry.id)}">${escape(entry.name)}</option>`).join("")}</select></label>`,
      buttons: [{ action: "kill", label: "Insta-Kill", default: true, callback: (ev, button, dialog) => dialog.element.querySelector('[name="buddy"]').value },
        { action: "cancel", label: "Cancel" }], rejectClose: false });
    const buddy = buddies.find(entry => entry.id === picked);
    return buddy ? { name: buddy.name } : null;
  }
  if (maneuver.id === "time-to-get-serious") {
    if (!((Number(actor.system.karma) || 0) > 0)) return void ui.notifications.warn(`${actor.name} has no Karma Point to spend.`) ?? null;
    return {};
  }
  if (maneuver.id === "get-up") {
    const [who] = targeted(actor);
    if (!who?.system?.defeated) return void ui.notifications.warn("Get Up!: target a Defeated Opponent.") ?? null;
    return { who };
  }
  if (maneuver.id === "planet-burst") {
    const why = planetBurstRefused(actor);
    if (why) return void ui.notifications.warn(why) ?? null;
    return { stamina: Number(actor.system.narrativeStamina?.value) || 0 };
  }
  if (maneuver.id === "act-again") {
    const combat = game.combat;
    const ended = combat?.previous?.combatantId ? combat.combatants.get(combat.previous.combatantId) : null;
    if (!combat?.started || !ended) return void ui.notifications.warn("Act Again: only as another Character's turn ends.") ?? null;
    if (ended.actor?.uuid === actor.uuid) return void ui.notifications.warn("Act Again: in response to another Character ending their turn.") ?? null;
    return { ended };
  }
  return {};
}

/** Once its card is made: what it does. `card`, its chat card where it has one. */
export async function villainousAfter(actor, maneuver, plan = {}, card = null) {
  const escape = Handlebars.escapeExpression;
  const say = text => ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<div class="dbu-settled-note">${text}</div>` });
  if (maneuver.id === "planet-burst") {
    // "KP Cost: Equal to your Narrative Stamina" - all of this Round's, paid; and its "1/2 of PCC number of Power Shot stacks",
    // each 2(T) on its Wound Roll, put on its attack (its PCC Energy Charges came with it, use-maneuver.mjs).
    await actor.update({ "system.narrativeStamina.value": 0 });
    const attack = card?.getFlag?.("dbu-ttrpg", "attack");
    if (!attack) return;
    const stacks = Math.floor((Number(actor.system.adversaryGains?.pcc) || 1) / 2);
    const tier = Math.max(1, Number(actor.system.tierOfPower) || 1);
    const { requestEdit } = await import("./chat.mjs");
    return requestEdit(card, { type: "attack", attack: { ...attack, planetBurst: true, powerShotRanks: stacks,
      woundExtra: [...(attack.woundExtra ?? []), ...(stacks ? [{ label: "Power Shot", written: `+${2 * stacks}(T)`, value: 2 * stacks * tier }] : [])] } });
  }
  if (maneuver.id === "one-man-army") {
    const { useManeuver } = await import("./use-maneuver.mjs");
    // "use a Standard Maneuver with an Action Cost of 1 Action as an Instant Maneuver" - the 2 Adversary Actions spent once it is.
    const used = await useManeuver(actor, { ...plan.chosen, type: "instant", actionCost: 0 });
    if (used === false) return;
    const { spendActions } = await import("./combat.mjs");
    await spendActions(actor, 2, "counter");
    return;
  }
  if (maneuver.id === "one-on-one-duel") {
    await actor.update({ "system.adversary.duel": true });
    await actor.setFlag("dbu-ttrpg", "duelWith", plan.who.uuid);
    return say(`<b>1-on-1 Duel</b> - ${escape(plan.who.name)} agreed. No Narrative Stamina and one Counter Action for ${escape(actor.name)} until another
      Character targets either of them, or ${escape(plan.who.name)} is Defeated. Defeating them: Life and Ki Points equal to 1/4 (rounded up) of their
      Maximums, and this Maneuver's use again.`);
  }
  if (maneuver.id === "insta-kill") {
    return say(`<b>Insta-Kill</b> - ${escape(plan.name)} dies, unless an Exploit's Attacking Maneuver in answer dealt ${escape(actor.name)} Damage.`);
  }
  if (maneuver.id === "time-to-get-serious") {
    const { conditionsFor, setCondition } = await import("./conditions.mjs");
    await actor.update({ "system.karma": Math.max(0, (Number(actor.system.karma) || 0) - 1) });
    for (const condition of conditionsFor(actor).filter(each => each.combatCondition && each.active && (each.key !== "suffocating"))) {
      await setCondition(actor, condition.key, 0);
    }
    if (actor.system.grapple?.role === "grappled") {
      const { endGrapple } = await import("./chat.mjs");
      await endGrapple(fromUuidSync(actor.system.grapple.partner ?? ""), actor);
    }
    const { legendRealized } = await import("./chat.mjs");
    return legendRealized(actor);
  }
  if (maneuver.id === "get-up") {
    const who = plan.who;
    const life = Math.floor((Number(who.system.life?.max) || 0) / 10);
    // "This effect counts for Will to Survive": its once an Encounter spent with it.
    const changes = { "system.life.value": life, "system.defeatsEscaped": (Number(who.system.defeatsEscaped) || 0) + 1 };
    if (who.isOwner) await who.update(changes, { dbuForceUp: true });
    else await (await import("./chat.mjs")).requestActorUpdate(who, changes);
    return say(`<b>Get Up!</b> - ${escape(who.name)} stops being Defeated, at ${life} Life Points. ${escape(actor.name)} cannot target them with an
      Attacking Maneuver until the end of their next turn.`);
  }
  if (maneuver.id === "act-again") {
    // "Take an additional turn, its place in the Initiative Order being right after the turn of the Character that ended their turn" -
    // a turn of its own put there, and gone once it ends (combat.mjs).
    const combat = game.combat;
    const ended = plan.ended;
    const token = actor.token ?? actor.getActiveTokens?.()?.[0]?.document;
    const after = Number(ended.initiative) || 0;
    const next = combat.turns[combat.turns.findIndex(turn => turn.id === ended.id) + 1];
    const initiative = (next && Number.isFinite(Number(next.initiative))) ? (after + Number(next.initiative)) / 2 : after - 0.5;
    const current = combat.combatant;
    const [made] = await combat.createEmbeddedDocuments("Combatant", [{ actorId: actor.id, tokenId: token?.id ?? null,
      sceneId: token?.parent?.id ?? canvas?.scene?.id ?? null, initiative, flags: { "dbu-ttrpg": { actAgain: true } } }]);
    if (made) {
      // As Jump Start's turn is put in (chat.mjs applyJumpStart): the turn it cuts into - begun already, its card out - is not
      // ended by it, and is taken up again after it, not begun a second time (`turnResumed`, combat.mjs). Moved to it with no
      // turn change told, and begun here.
      if (current && (current.id !== made.id)) await combat.setFlag("dbu-ttrpg", "turnResumed", current.id);
      const { keepTurnWith, beginTurnOf } = await import("./combat.mjs");
      await keepTurnWith(combat, made.id);
      await beginTurnOf(combat, actor);
    }
    return say(`<b>Act Again</b> - ${escape(actor.name)} takes a turn more, after ${escape(ended.name)}'s: no normal Actions in it, its Adversary
      Actions spent as Actions.`);
  }
}

/**
 * Act Again: "This Villainous Maneuver can only be used in response to another Character ending their turn" - offered on the
 * card of the turn beginning as theirs ends (the user's: there is no card for a turn's end), to each Adversary in the Combat the
 * reader plays who has it and a use left this Round. Not on an older card, and not to the one whose turn just ended.
 */
export async function actAgainOffers(card) {
  const combat = game.combat;
  if (!combat?.started || (card?.moment !== "start-of-turn") || (card.subjectUuid !== combat.combatant?.actor?.uuid)) return [];
  const ended = combat.previous?.combatantId ? combat.combatants.get(combat.previous.combatantId)?.actor : null;
  if (!ended) return [];
  const { maneuverUsesLeft } = await import("./maneuvers.mjs");
  const { definitionOf } = await import("./use-maneuver.mjs");
  const seen = new Set();
  const offers = [];
  for (const combatant of combat.combatants) {
    const actor = combatant.actor;
    if (!actor || seen.has(actor.uuid) || !isAdversary(actor) || !actor.isOwner || (actor.uuid === ended.uuid)) continue;
    seen.add(actor.uuid);
    const item = Array.from(actor.items).find(each => (each.type === "maneuver") && (each.system?.maneuverId === "act-again"));
    if (!item) continue;
    const maneuver = definitionOf(item);
    if (maneuverUsesLeft(actor, maneuver) === 0) continue;
    offers.push({ actor, maneuver });
  }
  return offers;
}

/** Act Again's turn, once it is over: gone from the Initiative Order (combat.mjs). */
export async function actAgainEnded(combat, combatantId) {
  const extra = combatantId ? combat?.combatants?.get(combatantId) : null;
  if (extra?.getFlag?.("dbu-ttrpg", "actAgain")) await extra.delete();
}

/**
 * Area Wipe: "an Attacking Maneuver of the Simple Profile (any Foundation) that targets all other Characters on the Battlefield
 * regardless of if they are Hidden or no matter how many Squares they are away from you" - every other one in the Combat, once
 * each, as targets an attack is given (use-maneuver.mjs useManeuver).
 */
export function areaWipeTargets(actor) {
  const seen = new Set([actor?.uuid]);
  const others = [];
  for (const combatant of game.combat?.combatants ?? []) {
    const other = combatant.actor;
    if (!other || seen.has(other.uuid)) continue;
    seen.add(other.uuid);
    others.push(other);
  }
  return others;
}

/**
 * Area Wipe, concluded: "Regardless of the results of the Attacking Maneuver, after concluding that Attacking Maneuver, destroy
 * all Features in the Battlefield, and remove all Environmental Qualities from all Squares in the Battlefield." The Qualities
 * ticked on each one's Battlefields tab taken off (the user's); the Features the ARC's, said destroyed.
 */
export async function areaWipeConcluded(attack) {
  const attacker = fromUuidSync(attack?.attackerUuid ?? "");
  if (!attacker?.isOwner) return;
  const { requestActorUpdate } = await import("./chat.mjs");
  for (const actor of [attacker, ...areaWipeTargets(attacker)]) {
    if (!(actor.system?.battlefield?.qualities ?? []).length) continue;
    if (actor.isOwner) await actor.update({ "system.battlefield.qualities": [] });
    else await requestActorUpdate(actor, { "system.battlefield.qualities": [] });
  }
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: attacker }),
    content: `<div class="dbu-settled-note"><b>Area Wipe</b> - every Feature in the Battlefield destroyed, and every Environmental Quality
      removed from every Square.</div>` });
}

/**
 * Planet Burst: why it cannot be used now, or "" - an Elite's or a Villain's, with this Round's Narrative Stamina whole (the user's:
 * its price is all the Stamina gained as the Round started, and none of it may have been spent).
 */
export function planetBurstRefused(actor) {
  const stamina = Number(actor?.system?.narrativeStamina?.value) || 0;
  const most = Number(actor?.system?.narrativeStamina?.max) || 0;
  if (!actor?.system?.adversaryNarrative || !most) return "Planet Burst: its price is Narrative Stamina - an Elite's or a Villain's, not in a 1-on-1 Duel.";
  if (stamina < most) return `Planet Burst: its price is this Round's whole Narrative Stamina, ${most} - ${most - stamina} of it spent already.`;
  return "";
}

/** Planet Burst's targets: "as if you made an Attacking Maneuver that targeted all of them" - every Player Character in the Combat. */
export function planetBurstTargets() {
  const seen = new Set();
  return (game.combat?.combatants?.contents ?? []).map(combatant => combatant.actor)
    .filter(actor => actor && isPlayerCharacter(actor) && !seen.has(actor.uuid) && seen.add(actor.uuid));
}
