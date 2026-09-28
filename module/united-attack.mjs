/**
 * The United Attack Maneuver, and the Signature Technique Disadvantage that needs it.
 *
 * "When an Ally uses an Attacking Maneuver or Duel Maneuver while you are on an adjacent Square,
 * you may spend 1 Action and the Ki Points as if making the same Profile of Attacking Maneuver as
 * your Ally." An Instant, played on the attack's card while it is still open - before the attacker
 * applies their effects, which is the moment the Strike stops waiting on anybody.
 *
 * Whether the one joining is an Ally is the table's: the system never assumes it. Only the
 * adjacency is measured, and only when there is a scene to measure it on.
 *
 * The Duel parts (1/4 of the Modifier, 1/10 of Capacity a roll, "also considered a target if the
 * Duel is lost") wait for the Duel Maneuver.
 */

import {
  getManeuver, maneuverKiCost, maneuverUsesLeft, recordManeuverUse, spendManeuverCost, squaresAway,
  whyNotAnotherInstant
} from "./maneuvers.mjs";
import { featureDef, maxRanks } from "./technique.mjs";
import { featureRanks, POWER_SHOT_MAX_RANKS } from "./signature.mjs";
import { techniqueUseEntries, whyNotTechnique } from "./technique-use.mjs";
import { techniqueAttack } from "./technique-attack.mjs";

const escape = text => Handlebars.escapeExpression(String(text ?? ""));

/** The Maneuver's own id, as its file names it. */
export const UNITED_ATTACK = "united-attack-maneuver";

/** "1/4 of your Max Capacity": the most a joiner may wager. */
export function unitedWagerCap(joiner) {
  return Math.floor((Number(joiner?.system?.capacity?.max) || 0) / 4);
}

/**
 * "Increase their Wound Roll by 1/2 of your relevant Attribute Modifier (Force for if they made a
 * Physical or Energy Attack and Magic for if they made a Magic Attack)." Rounded down.
 */
export function unitedWoundBonus(joiner, foundation) {
  const key = (foundation === "magic") ? "magic" : "force";
  const mod = Number(joiner?.system?.attributes?.[key]?.mod) || 0;
  return { attribute: key, value: Math.floor(mod / 2) };
}

/**
 * The Advantages a joiner may bring from their Technique: its Advantages (not its Disadvantages),
 * each as many ranks as it has there.
 */
export function unitedOfferable(technique) {
  const counts = new Map();
  for (const id of technique?.advantages ?? []) {
    const def = featureDef(id);
    if (def && (def.owner === "disadvantages")) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()].map(([id, ranks]) => ({ id, ranks, name: featureDef(id)?.name ?? id }));
}

/**
 * "Up to 1(bT) ranks of Advantages you possess on your Signature Technique", added to what the
 * attack already has - each held to that Advantage's own most ranks.
 *
 * @param {string[]} existing  the attack's features, one entry a rank
 * @param {Record<string, number>} picked  ranks asked for, by id
 * @param {number} allowance  the joiner's base Tier of Power
 * @returns {string[]} the ids to add, one entry a rank
 */
export function unitedAdditions(existing, picked, allowance) {
  const added = [];
  let left = Math.max(0, allowance);
  for (const [id, wanted] of Object.entries(picked)) {
    const room = Math.max(0, maxRanks(featureDef(id)) - featureRanks([...existing, ...added], id));
    const take = Math.min(Math.max(0, Number(wanted) || 0), room, left);
    for (let i = 0; i < take; i++) added.push(id);
    left -= take;
  }
  return added;
}

/** The rows a United Attack adds to the attack's Wound Roll: one for each who joined. */
export function unitedWoundParts(attack) {
  return (attack?.united ?? []).filter(entry => entry.wound)
    .map(entry => ({ label: `United Attack (${entry.name}, 1/2 ${entry.attributeLabel})`, value: entry.wound }));
}

/** Characters with a Signature Technique of this name, not this one: whom United Attack may ask. */
export function unitedPartners(actor, name, pool) {
  const wanted = String(name ?? "").trim().toLowerCase();
  const seen = new Set();
  return pool.filter(other => {
    if (!other || (other.type !== "character") || (other.uuid === actor.uuid) || seen.has(other.uuid)) return false;
    seen.add(other.uuid);
    return Array.from(other.items ?? []).some(item => (item.type === "maneuver")
      && (item.system?.tags ?? []).includes("signature")
      && (String(item.name ?? "").trim().toLowerCase() === wanted));
  });
}

/** Everyone on the scene with a character sheet, or every character when there is no scene. */
function scenePool() {
  const tokens = (globalThis.canvas?.tokens?.placeables ?? []).map(token => token.actor).filter(Boolean);
  return tokens.length ? tokens : Array.from(game.actors ?? []);
}

/**
 * The United Attack Disadvantage, as the Technique is declared: "you must first ask consent from one
 * of your Allies who possesses this Signature Technique." Who is asked is picked here; the asking is
 * the card's, where they join or refuse.
 *
 * @returns {Promise<?{uuid: string, name: string}>} null when there is nobody, or it was cancelled
 */
export async function askUnitedPartner(actor, maneuver) {
  const partners = unitedPartners(actor, maneuver.name, scenePool());
  if (!partners.length) {
    ui.notifications.warn(`${maneuver.name}: United Attack - nobody here has a Signature Technique `
      + `named ${maneuver.name}.`);
    return null;
  }
  const options = partners.map((other, index) => `
      <label class="dbu-technique">
        <input type="radio" name="partner" value="${other.uuid}" ${index ? "" : "checked"}/>
        <span class="dbu-technique-name">${escape(other.name)}</span>
      </label>`).join("");
  const picked = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: `${maneuver.name} - United Attack` },
    content: `<p class="dbu-respond-hint">Which Ally do you ask? They join with the United Attack
        Maneuver on the card, or the Technique fails and you regain its Action and Ki.</p>
      <div class="dbu-technique-picker">${options}</div>`,
    buttons: [
      { action: "confirm", label: "Ask",
        callback: (event, button, dialog) => dialog.element.querySelector('input[name="partner"]:checked')?.value ?? null },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });
  const partner = partners.find(other => other.uuid === picked);
  return partner ? { uuid: partner.uuid, name: partner.name } : null;
}

/** Whether the partner a Technique asked for has yet to answer. */
export function unitedPending(attack) {
  const asked = attack?.unitedWith;
  if (!asked || attack.unitedFailed) return false;
  return !(attack.united ?? []).some(entry => entry.uuid === asked.uuid);
}

/** Who this user could join with: characters they own, not the attacker, not already in. */
export function unitedJoiners(attack) {
  const already = new Set([attack.attackerUuid, ...(attack.united ?? []).map(entry => entry.uuid)]);
  const seen = new Set();
  return scenePool().filter(actor => {
    if (!actor?.isOwner || (actor.type !== "character") || already.has(actor.uuid) || seen.has(actor.uuid)) return false;
    seen.add(actor.uuid);
    return true;
  });
}

/**
 * Why this character cannot use the United Attack Maneuver on this attack, or "" when they can.
 * The price is checked where it is paid.
 */
export function whyNotUnite(joiner, attack, attacker, { actionsLeft = () => 1 } = {}) {
  const united = getManeuver(UNITED_ATTACK);
  if (!united) return "The United Attack Maneuver is not loaded.";
  if (maneuverUsesLeft(joiner, united) <= 0) return `${joiner.name} has used United Attack this Combat Round.`;
  const instant = whyNotAnotherInstant(joiner);
  if (instant) return instant;
  // Instant Assault: "your Opponents cannot use Instant Maneuvers in response" - and this is one.
  if ((attack.technique?.features ?? []).includes("instant-assault")) {
    return `${attack.maneuverName} has Instant Assault: no Instant Maneuver answers it.`;
  }
  if (globalThis.game?.combat?.started && (actionsLeft(joiner) < 1)) return `${joiner.name} has no Actions left this round.`;
  // "While you are on an adjacent Square" - 1 Square away. Not measurable is not a refusal.
  const away = attacker ? squaresAway(joiner, attacker) : null;
  if ((away !== null) && (away > 1)) return `${joiner.name} is not on a Square adjacent to ${attack.attackerName}.`;
  return "";
}

/**
 * The United Attack Maneuver, played on an attack's card by one of the user's characters.
 *
 * @returns {Promise<?object>} the joiner's entry for the card, or null if nothing happened
 */
export async function joinUnitedAttack(attack, joiner, { attacker = null, techniques = [] } = {}) {
  // Imported here: the combat module brings the data models with it, which a harness has not got.
  const { actionsLeft, refundActions, spendActions } = await import("./combat.mjs");
  const refused = whyNotUnite(joiner, attack, attacker, { actionsLeft });
  if (refused) {
    ui.notifications.warn(refused);
    return null;
  }
  const united = getManeuver(UNITED_ATTACK);
  const baseTier = Math.max(1, Number(joiner.system?.baseTierOfPower) || 1);

  // "The Ki Points as if making the same Profile of Attacking Maneuver as your Ally" - or, with a
  // Signature Technique, that Technique's own (the ruling: it is a use of it).
  const door = getManeuver("signature-technique");
  const profileCost = maneuverKiCost({ ...united, attacking: true },
    { profile: attack.profile, foundation: attack.foundation }, joiner);
  const choices = techniques.map(technique => {
    const lowStakes = (technique.advantages ?? []).includes("low-stakes-attack");
    const why = whyNotTechnique(joiner, technique, { via: "united" })
      || ((!lowStakes && door && (maneuverUsesLeft(joiner, door) <= 0))
        ? "the Signature Technique Maneuver has been used this Combat Round" : "")
      || ((maneuverUsesLeft(joiner, technique) <= 0) ? "no uses left" : "");
    const cost = maneuverKiCost(technique, { profile: technique.profile || attack.profile,
      foundation: technique.profileFoundation?.[technique.profile] ?? attack.foundation,
      advantages: technique.advantages ?? [] }, joiner);
    return { technique, why, cost, lowStakes, offer: unitedOfferable(technique) };
  });

  const answer = await askUnite(attack, joiner, { profileCost, choices, baseTier });
  if (!answer) return null;

  const choice = answer.itemId ? choices.find(entry => entry.technique.itemId === answer.itemId) : null;
  if (choice?.why) {
    ui.notifications.warn(`${choice.technique.name}: ${choice.why}.`);
    return null;
  }
  const cost = choice ? choice.cost : profileCost;
  const wager = Math.max(0, Math.min(Number(answer.wager) || 0, unitedWagerCap(joiner)));

  // Paid: 1 Action, then the Ki and the wager together - both come out of Capacity.
  if (!await spendActions(joiner, 1)) return null;
  if (!await spendManeuverCost(joiner, { name: united.name }, cost + wager)) {
    await refundActions(joiner, 1);
    return null;
  }
  await recordManeuverUse(joiner, united);
  if (choice) {
    if (!choice.lowStakes && door) await recordManeuverUse(joiner, door);
    await recordManeuverUse(joiner, choice.technique);
    const entries = techniqueUseEntries(choice.technique);
    if (entries.length) {
      await joiner.update({ "system.usedManeuvers": [...(joiner.system.usedManeuvers ?? []), ...entries] });
    }
  }
  // Counted for the joiner's Diminishing Offense (the ruling): it is an Attacking Maneuver of theirs.
  await joiner.update({ "system.attacksThisRound": (Number(joiner.system.attacksThisRound) || 0) + 1 });

  const bonus = unitedWoundBonus(joiner, attack.foundation);
  const existing = [...(attack.technique?.features ?? attack.advantages ?? [])];
  const added = choice ? unitedAdditions(existing, answer.picked ?? {}, baseTier) : [];
  return {
    uuid: joiner.uuid,
    name: joiner.name,
    techniqueName: choice?.technique.name ?? "",
    choices: choice?.technique.featureChoices ?? {},
    cost,
    wager,
    wound: bonus.value,
    attributeLabel: (bonus.attribute === "magic") ? "Magic" : "Force",
    advantages: added
  };
}

/** The question: how they join, what they bring, what they wager. */
async function askUnite(attack, joiner, { profileCost, choices, baseTier }) {
  const cap = unitedWagerCap(joiner);
  const ways = [
    `<label class="dbu-technique"><input type="radio" name="way" value="" checked/>
      <span class="dbu-technique-name">${escape(attack.profileLabel ?? "Same Profile")}</span>
      <span class="dbu-technique-note">${profileCost} KP</span></label>`,
    ...choices.map(entry => `<label class="dbu-technique${entry.why ? " dbu-technique-spent" : ""}"
        ${entry.why ? `data-tooltip="${escape(entry.why)}"` : ""}>
      <input type="radio" name="way" value="${entry.technique.itemId}" ${entry.why ? "disabled" : ""}/>
      <span class="dbu-technique-name">${escape(entry.technique.name)}</span>
      <span class="dbu-technique-note">${entry.cost} KP</span></label>`)
  ].join("");
  const advantages = choices.filter(entry => !entry.why && entry.offer.length).map(entry => `
      <fieldset class="dbu-united-advantages" data-technique="${entry.technique.itemId}">
        <legend>${escape(entry.technique.name)}</legend>
        ${entry.offer.map(offer => `<label class="dbu-wager">
          <span>${escape(offer.name)}</span>
          <input type="number" name="rank-${offer.id}" value="0" min="0" max="${Math.min(offer.ranks, baseTier)}"/>
        </label>`).join("")}
      </fieldset>`).join("");

  return foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: `${joiner.name} - United Attack` },
    content: `<p class="dbu-respond-hint" data-tooltip="Instant, 1/Round. 1 Action, and the Ki of the
        same Profile at your Tier or of the Signature Technique you use (a use of it). Adds 1/2 of your
        Force or Magic Modifier to their Wound Roll.">${escape(attack.attackerName)}'s ${escape(attack.maneuverName)}</p>
      <div class="dbu-technique-picker">${ways}</div>
      ${advantages ? `<p class="dbu-respond-hint dbu-list-label"
        data-tooltip="Only those of the Technique you use.">Advantages (up to ${baseTier} ranks)</p>${advantages}` : ""}
      <label class="dbu-wager"><span>Ki Wager (max ${cap})</span>
        <input type="number" name="wager" value="0" min="0" max="${cap}"/></label>`,
    buttons: [
      { action: "confirm", label: "Join",
        callback: (event, button, dialog) => {
          const root = dialog.element;
          const itemId = root.querySelector('input[name="way"]:checked')?.value ?? "";
          const picked = {};
          const box = itemId ? root.querySelector(`fieldset[data-technique="${itemId}"]`) : null;
          for (const input of box?.querySelectorAll('input[type="number"]') ?? []) {
            picked[input.name.replace(/^rank-/, "")] = Number(input.value) || 0;
          }
          return { itemId, picked, wager: Number(root.querySelector('input[name="wager"]')?.value) || 0 };
        } },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });
}

/**
 * The attack with a joiner in it: their wager on top of the attack's (outside the attacker's own
 * limit, the ruling), and the Advantages they brought on its features - read on the final attack,
 * so one whose Requirement fails there is carried but does nothing.
 */
export function withJoiner(attack, entry, attacker) {
  const united = [...(attack.united ?? []), entry];
  const next = { ...attack, united, kiWager: (Number(attack.kiWager) || 0) + entry.wager };
  if (!entry.advantages.length) return next;

  const features = [...(attack.technique?.features ?? attack.advantages ?? []), ...entry.advantages];
  const choices = { ...entry.choices, ...(attack.technique?.choices ?? {}) };
  const rebuilt = techniqueAttack(attacker, {
    itemId: attack.technique?.itemId ?? "",
    level: attack.technique?.level ?? "super",
    ultimate: Boolean(attack.technique?.ultimate),
    ascended: Boolean(attack.technique?.ascended),
    superProfile: attack.technique?.superProfile ?? "",
    secondProfile: attack.technique?.secondProfile ?? "",
    featureChoices: choices
  }, { profile: attack.profile, foundation: attack.foundation, advantages: [...features, ...(attack.technique?.off ?? []).map(off => off.id)],
    charges: Number(attack.energyCharges) || 0, squaresCharged: attack.squaresCharged ?? 0 },
  { targets: (attack.targets ?? []).map(target => ({ uuid: target.uuid })), shaken: [] });

  // What was settled at declaration stays settled: the Charges already counted and their sources,
  // the area's notes. A joined Advantage's own Charges are the table's.
  const technique = attack.technique
    ? { ...rebuilt, bonusCharges: attack.technique.bonusCharges, thresholdsBelow: attack.technique.thresholdsBelow,
        powerbomb: attack.technique.powerbomb, notes: [...(attack.technique.notes ?? []), ...rebuilt.notes] }
    : { ...rebuilt, bonusCharges: [], chargeCeilingBonus: 0 };
  return {
    ...next,
    technique,
    advantages: [...(attack.advantages ?? []), ...entry.advantages],
    powerShotRanks: Math.min(featureRanks(technique.features, "power-shot"), POWER_SHOT_MAX_RANKS),
    area: technique.area ?? attack.area ?? null
  };
}

