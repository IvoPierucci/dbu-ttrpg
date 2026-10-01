/**
 * Hidden and Oblivious - the user's rulings (2026-09-30), there being no rule text any more.
 *
 * One relation between two characters, seen from each end: A is Hidden from B when B does not know where A is, and B
 * is then Oblivious of A. Never a state of its own - being Hidden from B says nothing about C.
 *
 *   - B cannot target A with any Maneuver or effect.
 *   - A stops being Hidden from B once A has hit B with an attack, or made 2 attacks aimed at B, or ends their turn
 *     within B's Melee Range.
 *
 * Kept on the Hidden one, as `system.hiddenFrom`: whom from, and how many attacks they have aimed at them since.
 */

import { squaresBetween } from "./maneuvers.mjs";

/** The Hide and Search Maneuvers, by their files. */
export const HIDE_MANEUVER = "hide";
export const SEARCH_MANEUVER = "search";

/** "Made 2 attacks" at them: the second one ends it. */
export const HIDDEN_ATTACKS = 2;

/** Whom this character is Hidden from. */
export function hiddenEntries(actor) {
  return Array.from(actor?.system?.hiddenFrom ?? []).filter(entry => entry?.uuid);
}

/** Whether `hider` is Hidden from `seeker` - and so `seeker` is Oblivious of them. */
export function isHiddenFrom(hider, seeker) {
  if (!hider || !seeker) return false;
  return hiddenEntries(hider).some(entry => entry.uuid === seeker.uuid);
}

/** Why `actor` cannot aim at `target`, or "": "that enemy cannot target you with any Maneuver or effect". */
export function whyHidden(actor, target) {
  return isHiddenFrom(target, actor) ? `${target.name} is Hidden from ${actor.name}.` : "";
}

/** Everyone on the scene Hidden from this character - whom they are Oblivious of. */
export function obliviousOf(seeker) {
  if (!seeker) return [];
  const found = new Map();
  for (const token of globalThis.canvas?.tokens?.placeables ?? []) {
    const other = token.actor;
    if (other && (other.uuid !== seeker.uuid) && isHiddenFrom(other, seeker)) found.set(other.uuid, other);
  }
  return [...found.values()];
}

async function write(actor, entries) {
  const { requestActorUpdate } = await import("./chat.mjs");
  return requestActorUpdate(actor, { "system.hiddenFrom": entries });
}

async function say(actor, text) {
  return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="dbu-settled-note">${Handlebars.escapeExpression(text)}</div>` });
}

/**
 * `hider` becomes Hidden from `seeker`. Compelled's "If your target becomes Hidden to you, change your target" is said
 * to a Compelled seeker - whom they were told to attack is the table's.
 */
export async function hideFrom(hider, seeker, { quiet = false } = {}) {
  if (!hider || !seeker || (hider.uuid === seeker.uuid) || isHiddenFrom(hider, seeker)) return;
  await write(hider, [...hiddenEntries(hider), { uuid: seeker.uuid, name: seeker.name, attacks: 0 }]);
  if (quiet) return;
  const compelled = (Number(seeker.system?.conditions?.compelled) || 0) > 0;
  await say(hider, `${hider.name} is Hidden from ${seeker.name}.${compelled
    ? ` ${seeker.name} is Compelled: if ${hider.name} was their target, they change it.` : ""}`);
}

/** `hider` is no longer Hidden from `seeker`. */
export async function revealTo(hider, seeker, reason = "") {
  if (!isHiddenFrom(hider, seeker)) return;
  await write(hider, hiddenEntries(hider).filter(entry => entry.uuid !== seeker.uuid));
  await say(hider, `${hider.name} is no longer Hidden from ${seeker.name}${reason ? ` - ${reason}` : ""}.`);
}

/** An attack aimed at someone you are Hidden from: the second one ends it. */
export async function countHiddenAttack(attacker, target) {
  if (!isHiddenFrom(attacker, target)) return;
  const entries = hiddenEntries(attacker);
  const entry = entries.find(each => each.uuid === target.uuid);
  const attacks = (Number(entry.attacks) || 0) + 1;
  if (attacks >= HIDDEN_ATTACKS) return revealTo(attacker, target, `${attacks} attacks at them`);
  return write(attacker, entries.map(each => (each.uuid === target.uuid) ? { ...each, attacks } : each));
}

/** An attack that hit someone you are Hidden from ends it. */
export async function revealOnHit(attacker, target) {
  return revealTo(attacker, target, "hit by an attack");
}

/**
 * The end of this character's turn: Hidden from nobody whose Melee Range they end it within. Measured on the scene's
 * tokens; where either has none, nothing is measured and nothing ends.
 */
export async function revealAtTurnEnd(actor) {
  for (const entry of hiddenEntries(actor)) {
    const seeker = globalThis.fromUuidSync?.(entry.uuid);
    if (!seeker) continue;
    const squares = squaresBetween(seeker.getActiveTokens?.(false, true)?.[0], actor.getActiveTokens?.(false, true)?.[0]);
    if (squares === null) continue;
    if (squares <= Math.max(0, Number(seeker.system?.meleeRange) || 0)) {
      await revealTo(actor, seeker, `ended the turn within their Melee Range`);
    }
  }
}
