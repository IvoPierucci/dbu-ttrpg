/**
 * The Energy Synchronize Special Maneuver and the Fusion of Ki Special State.
 *
 * Energy Synchronize: "Target an Ally; they become your Linked Character until the end of the Combat Encounter. In response, your
 * Linked Character can spend 2 Standard Actions to use the Energy Synchronize Maneuver if they have access to it as an
 * Out-of-Sequence Maneuver. Once both you and your Ally have used the Energy Synchronize Maneuver with each other as your Linked
 * Characters, the two of you enter the Fusion of Ki Special State for 3 Combat Rounds or until the Linked Ki Points are reduced to 0."
 *
 * Your Linked Character kept on you (flag kiLink) till the Encounter ends (combat.mjs endEncounterFor). Their answer: a button on the
 * card for whoever plays them. Both linked to each other: the State entered for both - and left by both - by the GM, who may change
 * both Characters (chat.mjs requestKiFusion). While in it, one Ki pool: its Maximum kept on each (flag fusionOfKi, read by
 * actor-character.mjs), every change to one's Ki Points written on the other's by the GM (registerKiFusionHooks).
 */

const SCOPE = "dbu-ttrpg";

/** On a Character: their Linked Character, till the Encounter ends - { uuid, name }. */
export const KI_LINK = "kiLink";

/** On each of the two in the Fusion of Ki: the other, the Maximum Linked Ki Points, and whether (6) entered them into God Ki. */
export const KI_FUSION = "fusionOfKi";

/** On the card of an Energy Synchronize not yet answered: who used it, on whom. */
export const KI_SYNC_CARD = "kiSyncCard";

export const FUSION_OF_KI = "fusion-of-ki";
export const ENERGY_SYNCHRONIZE = "energy-synchronize";

/** "For 3 Combat Rounds": the Round it is entered in the first (as Limited's Rounds count, the user's) - two more Round starts. */
export const FUSION_OF_KI_EXTRA_ROUNDS = 2;

const ATTRIBUTES = ["agility", "force", "tenacity", "scholarship", "insight", "magic", "personality"];

export function inKiFusion(actor) {
  return (Number(actor?.system?.states?.[FUSION_OF_KI]) || 0) > 0;
}

function inGodKi(actor) {
  return (Number(actor?.system?.states?.["god-ki"]) || 0) > 0;
}

/** Your Linked Character while in the Fusion of Ki - the Actor, or null. */
export function kiFusionPartner(actor) {
  const link = actor?.getFlag?.(SCOPE, KI_FUSION);
  return link?.uuid ? (globalThis.fromUuidSync?.(link.uuid) ?? null) : null;
}

/** (1) "Add together the Maximum Ki Point Pool and current Ki Point Pool of both Linked Characters." */
export function linkedPools(a, b) {
  const max = (Number(a?.system?.ki?.max) || 0) + (Number(b?.system?.ki?.max) || 0);
  const value = (Number(a?.system?.ki?.value) || 0) + (Number(b?.system?.ki?.value) || 0);
  return { max, value: Math.min(value, max) };
}

/** (2) "Upon leaving this State, halve the Linked Ki Points" - rounded down. */
export function kiAfterFusion(linked) {
  return Math.floor(Math.max(0, Number(linked) || 0) / 2);
}

/**
 * (3) "Increase your Attribute Modifiers by 1/4 (rounded up) of the Attribute Scores of those same Attributes from your Linked
 * Character" - by Attribute.
 */
export function attributeShares(partner) {
  const shares = {};
  for (const key of ATTRIBUTES) {
    const score = Math.max(0, Number(partner?.system?.attributes?.[key]?.score) || 0);
    if (score) shares[key] = Math.ceil(score / 4);
  }
  return shares;
}

/** (3) As a script, read off the Linked Character at every preparation (registry.mjs kiFusionPrograms). */
export function attributeShareScript(partner) {
  const lines = Object.entries(attributeShares(partner)).map(([key, value]) => `${key}.mod += ${value};`);
  return lines.length ? `[passive]\n${lines.join("\n")}` : "";
}

/** Why this one may not be your Linked Character, or null. */
export function whyNotSync(actor, target, { areAllies = () => true, isCharacter = () => true, name = "Energy Synchronize" } = {}) {
  if (!target) return `${name}: target the Ally to synchronize with first.`;
  if (target.uuid === actor?.uuid) return `${name}: target an Ally, not yourself.`;
  if (!isCharacter(target)) return `${name}: ${target.name} is not a Character.`;
  if (!areAllies(actor, target)) return `${name}: ${target.name} is not your Ally.`;
  if (inKiFusion(actor)) return `${name}: ${actor.name} is in the Fusion of Ki already.`;
  if (inKiFusion(target)) return `${name}: ${target.name} is in the Fusion of Ki already.`;
  return null;
}

/** Whoever made this one their Linked Character, and has not been answered: answering, they are the one targeted. */
function pendingLinker(actor) {
  const pool = [...(globalThis.canvas?.tokens?.placeables ?? []).map(token => token.actor), ...(globalThis.game?.actors ?? [])];
  const own = actor.getFlag?.(SCOPE, KI_LINK)?.uuid;
  return pool.find(other => other && (other.uuid !== actor.uuid) && (other.getFlag?.(SCOPE, KI_LINK)?.uuid === actor.uuid)
    && (own !== other.uuid)) ?? null;
}

/**
 * Whom, before anything is paid: the one answered (from the card), else your one targeted token, else the one who made you
 * theirs. Null where none, or where they may not be.
 */
export async function askSync(actor, maneuver, options = {}) {
  const { areAllies } = await import("./allies.mjs");
  const { isCharacter } = await import("./actor-types.mjs");
  const targeted = [...new Map(Array.from(globalThis.game?.user?.targets ?? []).map(token => token.actor)
    .filter(other => other && (other.uuid !== actor.uuid)).map(other => [other.uuid, other])).values()];
  if (!options.kiLinkTo && (targeted.length > 1)) return void ui.notifications.warn(`${maneuver.name}: target one Ally.`) ?? null;
  const target = (options.kiLinkTo ? fromUuidSync(options.kiLinkTo) : null) ?? targeted[0] ?? pendingLinker(actor);
  const why = whyNotSync(actor, target, { areAllies, isCharacter, name: maneuver.name });
  if (why) return void ui.notifications.warn(why) ?? null;
  return { targetUuid: target.uuid };
}

/**
 * Used: the one targeted your Linked Character. Where they had made you theirs already, the two enter the Fusion of Ki (by the GM);
 * otherwise a card with their answer's button on it.
 */
export async function postSync(actor, maneuver, plan) {
  const escape = foundry.utils.escapeHTML;
  const target = fromUuidSync(plan.targetUuid);
  if (!target) return null;
  await actor.setFlag(SCOPE, KI_LINK, { uuid: target.uuid, name: target.name });
  const speaker = ChatMessage.getSpeaker({ actor });
  if (target.getFlag?.(SCOPE, KI_LINK)?.uuid === actor.uuid) {
    const message = await ChatMessage.create({ speaker, content: `<p>${escape(maneuver.name)}</p><div class="dbu-settled-note">${
      escape(actor.name)} and ${escape(target.name)} synchronize: the Fusion of Ki Special State, for 3 Combat Rounds or until the Linked Ki Points are reduced to 0.</div>` });
    const { requestKiFusion } = await import("./chat.mjs");
    await requestKiFusion("enter", target.uuid, actor.uuid);
    return message;
  }
  return ChatMessage.create({ speaker,
    content: `<p>${escape(maneuver.name)}</p><div class="dbu-settled-note">${escape(target.name)} is ${escape(actor.name)}'s Linked Character until the end of the Combat Encounter. ${
      escape(target.name)} may answer with Energy Synchronize as an Out-of-Sequence Maneuver, spending 2 Standard Actions.</div>`,
    flags: { [SCOPE]: { [KI_SYNC_CARD]: { from: actor.uuid, fromName: actor.name, to: target.uuid, toName: target.name } } } });
}

/** Whether the card's answer is still open: the one who used it still linked to them, and they not yet to the one who did. */
function syncOpen(card) {
  const from = card ? fromUuidSync(card.from) : null;
  const to = card ? fromUuidSync(card.to) : null;
  if (!from || !to) return null;
  if (from.getFlag?.(SCOPE, KI_LINK)?.uuid !== to.uuid) return null;
  if (to.getFlag?.(SCOPE, KI_LINK)?.uuid === from.uuid) return null;
  return { from, to };
}

/** The answer's button, for whoever plays the one targeted. */
export function renderKiSync(message, html) {
  const card = message.getFlag?.(SCOPE, KI_SYNC_CARD);
  const open = syncOpen(card);
  if (!open?.to.isOwner) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "dbu-clash-button";
  button.textContent = `${open.to.name}: Energy Synchronize`;
  button.dataset.tooltip = "Out of sequence, spending 2 Standard Actions - if you have access to the Energy Synchronize Maneuver.";
  button.addEventListener("click", () => answerSync(message));
  (html.querySelector(".message-content") ?? html).append(button);
}

/** "Spend 2 Standard Actions to use the Energy Synchronize Maneuver ... as an Out-of-Sequence Maneuver" - those Actions given back if it is not used. */
export async function answerSync(message) {
  const open = syncOpen(message?.getFlag?.(SCOPE, KI_SYNC_CARD));
  if (!open) return ui.notifications.warn("That Energy Synchronize has been answered, or is no longer there to answer.");
  const actor = open.to;
  const { actionsLeft, spendActions, refundActions } = await import("./combat.mjs");
  if (globalThis.game?.combat?.started && (actionsLeft(actor) < 2)) {
    return ui.notifications.warn(`${actor.name}: 2 Standard Actions are needed to answer.`);
  }
  const { useManeuver, definitionOf } = await import("./use-maneuver.mjs");
  const { getManeuver } = await import("./maneuvers.mjs");
  const own = Array.from(actor.items ?? []).find(item => (item.type === "maneuver") && (item.flags?.[SCOPE]?.sourceId === ENERGY_SYNCHRONIZE));
  const maneuver = own ? definitionOf(own) : getManeuver(ENERGY_SYNCHRONIZE);
  if (!maneuver) return null;
  if (!await spendActions(actor, 2)) return null;
  const used = await useManeuver(actor, maneuver, { outOfSequence: true, kiLinkTo: open.from.uuid });
  if (!used) await refundActions(actor, 2);
  return used;
}

/** Ends being carried out, by uuid: a second call while one runs does nothing. */
const ENDING = new Set();

/**
 * (1), (6): both enter it - the State on a clock, the summed pools kept on each, and God Ki for one whose Linked Character is in it.
 * The GM's (chat.mjs requestKiFusion).
 */
export async function enterKiFusion(a, b) {
  if (!a || !b || (a.uuid === b.uuid) || inKiFusion(a) || inKiFusion(b)) return false;
  const { max, value } = linkedPools(a, b);
  const godKi = { [a.uuid]: inGodKi(b) && !inGodKi(a), [b.uuid]: inGodKi(a) && !inGodKi(b) };
  const { raiseState } = await import("./conditions.mjs");
  const { lasting, EDGES, KINDS } = await import("./durations.mjs");
  for (const [self, other] of [[a, b], [b, a]]) {
    const added = await raiseState(self, FUSION_OF_KI);
    if (!added) continue;
    if (globalThis.game?.combat?.started) {
      await lasting(self, { kind: KINDS.STATE, key: FUSION_OF_KI, edge: EDGES.ROUND, extra: FUSION_OF_KI_EXTRA_ROUNDS,
        levels: added, source: "Fusion of Ki" });
    }
    await self.update({ [`flags.${SCOPE}.${KI_FUSION}`]: { uuid: other.uuid, name: other.name, max, godKi: godKi[self.uuid] },
      "system.ki.value": value }, { dbuKiLink: true });
  }
  for (const self of [a, b]) {
    if (godKi[self.uuid]) await raiseState(self, "god-ki");
  }
  return true;
}

/**
 * (2): both leave it - half the Linked Ki Points each, the God Ki it entered left with it. The Stress Test of one in a
 * Transformation said on the card: Transformations are not in this system yet. The GM's.
 */
export async function endKiFusion(actor) {
  const link = actor?.getFlag?.(SCOPE, KI_FUSION);
  if (!link || ENDING.has(actor.uuid)) return false;
  const partner = fromUuidSync(link.uuid);
  const pair = [actor, partner].filter(Boolean);
  pair.forEach(each => ENDING.add(each.uuid));
  try {
    const kept = kiAfterFusion(actor.system?.ki?.value);
    const { setState } = await import("./conditions.mjs");
    for (const self of pair) {
      const own = self.getFlag?.(SCOPE, KI_FUSION);
      await self.update({ [`flags.${SCOPE}.-=${KI_FUSION}`]: null, "system.ki.value": kept }, { dbuKiLink: true });
      if (inKiFusion(self)) await setState(self, FUSION_OF_KI, 0);
      if (own?.godKi && inGodKi(self)) await setState(self, "god-ki", 0);
    }
    const escape = foundry.utils.escapeHTML;
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p>Fusion of Ki ends</p><div class="dbu-settled-note">${escape(pair.map(each => each.name).join(" and "))}: ${kept} Ki Points each (half of the Linked Ki Points). Either of them in a Transformation makes a Stress Test - failed, Stress Exhaustion until the end of their next turn.</div>` });
    return true;
  }
  finally {
    pair.forEach(each => ENDING.delete(each.uuid));
  }
}

/**
 * The GM keeps the pool one: a change to one's Ki Points written on the other's; the Linked Ki Points at 0, or the State left any
 * way at all (its clock, Defeat, Stress Exhaustion, by hand), both leave it.
 */
export function registerKiFusionHooks() {
  Hooks.on("updateActor", (actor, changes, options) => {
    if (!globalThis.game?.users?.activeGM?.isSelf) return;
    const link = actor.getFlag?.(SCOPE, KI_FUSION);
    if (!link || ENDING.has(actor.uuid)) return;
    if (!inKiFusion(actor)) return void endKiFusion(actor);
    if (options?.dbuKiLink) return;
    const value = foundry.utils.getProperty(changes ?? {}, "system.ki.value");
    if (value === undefined) return;
    if ((Number(value) || 0) <= 0) return void endKiFusion(actor);
    const partner = fromUuidSync(link.uuid);
    if (partner && ((Number(partner.system?.ki?.value) || 0) !== Number(value))) {
      partner.update({ "system.ki.value": Number(value) }, { dbuKiLink: true });
    }
  });
}
