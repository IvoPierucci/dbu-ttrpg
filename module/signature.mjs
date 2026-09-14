/**
 * The Advantages and Disadvantages a Signature Technique is built out of.
 *
 * A Signature Technique is not handed to a character, it is designed by them: they
 * spend TP on Advantages that make it do more and take TP back from Disadvantages that
 * make it do less. The features themselves live in `traits/signature/`, one file each,
 * and are named by the Techniques that bought them rather than copied into them.
 *
 * Most of a feature is its rules text and its price, and that is all this needs to
 * know. A few of them ask the table for something at the moment the attack is declared
 * and then do arithmetic with the answer - that is what `ASKS` and `woundBonus` are
 * for, and it is deliberately a small list rather than a hook every feature pays for.
 *
 * Nothing here knows which Profile or Maneuver handed the feature out. Blitz grants
 * Charging Assault, a Signature Technique can buy it for 10 TP, and neither of those
 * routes appears in this file - a feature is the same feature however it was reached.
 */

import { getSignatureFeature } from "./effects/traits.mjs";

/**
 * What a feature needs from the table before an attack carrying it can be rolled.
 *
 * Each entry is one number, asked once, at Attack Declaration - which is when the
 * rules that use them say their thing happens. Anything a feature needs that is a
 * question about the map is not here: where you may move, what is in the way and
 * whether the line is straight are all answered by the player moving the token.
 */
const ASKS = Object.freeze({
  "charging-assault": {
    field: "squaresCharged",
    label: "Squares charged",
    // Short enough to read at a glance. The full rule is in the Trait file and on the
    // Profile's own hover; a field hint is there to say what number goes in the box.
    hint: "Squares moved towards them. Each one past the third adds to the Wound Roll."
  }
});

/** Every feature on an attack that wants a number before it is rolled. */
export function featureAsks(advantages = []) {
  return advantages.map(id => ASKS[id] ? { id, ...ASKS[id] } : null).filter(Boolean);
}

/** A feature's rules text and price, for the sheet and the dialogs. */
export function featureSummary(id) {
  const trait = getSignatureFeature(id);
  if (!trait) return null;
  return {
    id,
    name: trait.name,
    side: trait.owner,
    tpCost: Number(trait.tpCost) || 0,
    requirement: trait.requirement ?? "N/A",
    description: trait.description ?? "",
    text: trait.text ?? ""
  };
}

/**
 * What the Advantages on an attack add to its Wound Roll.
 *
 * Charging Assault: "if you move more than 3 Squares through this effect, increase
 * your Wound Roll by 1 for each Square you moved after the third. This bonus cannot
 * exceed 2(T)."
 *
 * The cap is on this Advantage's bonus alone, not on the Wound Roll and not on what
 * anything else adds - so a long charge stops paying at 2(T) while everything else on
 * the attack goes on counting.
 *
 * Power Shot: "increase your Wound Rolls for this Signature Technique by 2(T) for each
 * rank of this Advantage." Held to the three ranks the entry prices, so a list that
 * somehow carries four is worth three - the ceiling is the rule rather than an accident
 * of how the feature was written down.
 */
export function advantageWoundParts(attacker, attack) {
  const parts = [];
  const tier = attacker.system.tierOfPower ?? 1;

  if ((attack.advantages ?? []).includes("charging-assault")) {
    const squares = Math.max(0, attack.squaresCharged ?? 0);
    const bonus = Math.min(Math.max(0, squares - CHARGING_FREE_SQUARES), 2 * tier);
    if (bonus) parts.push({ label: "Charging Assault", value: bonus });
  }

  const powerShot = Math.min(
    featureRanks(attack.advantages, "power-shot"), POWER_SHOT_MAX_RANKS);
  if (powerShot) {
    const per = powerShot * POWER_SHOT_PER_RANK;
    parts.push({
      label: `Power Shot ${powerShot}`,
      written: `+${per}(T)`,
      value: per * tier
    });
  }

  return parts;
}

/** The Squares a charge covers before any of them are worth anything. */
export const CHARGING_FREE_SQUARES = 3;

/**
 * How many ranks of one feature an attack carries.
 *
 * Every feature but Power Shot is had or not had, and a list of ids says that perfectly
 * well. A ranked one is in the list once per rank, so the rank is the count - which
 * leaves `advantages.includes(id)` answering "does it have it" for everything that only
 * wants to know that, and adds nothing to any feature that has no ranks.
 */
export function featureRanks(advantages, id) {
  return (advantages ?? []).filter(entry => entry === id).length;
}

/** "2(T) for each rank of this Advantage." */
export const POWER_SHOT_PER_RANK = 2;

/** Three prices are listed and no fourth, which is where the ranks stop. */
export const POWER_SHOT_MAX_RANKS = 3;

/**
 * Features that push a character around, and so can cause Collision Damage.
 *
 * Named here rather than asked of each feature, because what makes Collision Damage
 * possible is movement somebody did not choose, and only a handful of things cause
 * that. A feature in this list earns the attack a button after the Wound Roll.
 */
const PUSHES = Object.freeze(["knockback"]);

/** Whether anything on this attack could have thrown the target around. */
export function pushes(attack) {
  return (attack.advantages ?? []).some(id => PUSHES.includes(id));
}
