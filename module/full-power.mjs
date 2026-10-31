/**
 * Nameless Horde (4)'s 'Full Power' Signature Techniques (the Aliens'): "You have access to the 'Full Power' Signature Techniques
 * (detailed below). These Signature Techniques are considered to have been used through the Basic Attack Maneuver as well for all
 * of your effects and, if an effect allows you to use the Basic Attack Maneuver, you may instead use the Signature Technique
 * Maneuver to use a 'Full Power' Signature Technique."
 *
 * Made as the Trait is added (racial.mjs `grantsTechniques: full-power`), each a built Technique marked `fullPower` - no Technique
 * Points taken for it (technique.mjs techniqueTPCharged) - and gone with the Trait (`grantedBy`). Their Ki Point Costs are what the
 * Signature rules make of them, but High Power Rush's: its listed 7(T), not the 12(T) the rules would make of it (the user's).
 */

import { composeTechniqueEffects } from "./technique.mjs";

const SCOPE = "dbu-ttrpg";

/** The six, as listed: level, Foundation and Profile, and each feature as [id, ranks, choice]. */
export const FULL_POWER = Object.freeze([
  { name: "Full Power Energy Wave", level: "super", foundation: "energy", profile: "beam",
    features: [["power-shot", 1], ["ascended-signature", 1], ["full-wager", 1], ["stat-drain", 1]] },
  { name: "Full Power Energy Ball", level: "super", foundation: "energy", profile: "simple",
    features: [["accurate", 2], ["homing", 1]] },
  { name: "Full Power Energy Volley", level: "ultimate", foundation: "energy", profile: "combination",
    features: [["alotta-lotta-attacks", 2], ["peppering-blows", 1], ["inaccurate", 1], ["shoot-and-pray", 2]] },
  { name: "Super Explosive Wave", level: "super", foundation: "energy", profile: "clearing",
    features: [["knockback", 1], ["counter", 1], ["terrain-destruction", 1], ["sudden-blast", 1], ["self-explosion", 1]] },
  // "Lead Up (Combination: Physical)" - the Profile is what Lead Up keeps.
  { name: "High Power Rush", level: "super", foundation: "physical", profile: "powered", fixedKiPerTier: 7,
    features: [["knockback", 1], ["power-shot", 2], ["lead-up", 1, "combination"]] },
  { name: "High Speed Rush", level: "super", foundation: "physical", profile: "combination",
    features: [["twin-linked", 1, "wound"], ["lead-up", 1, "blitz"]] }
]);

/** The Signature Technique Items for a Trait's Item - each its build, its effects composed, marked as given by it. */
export function fullPowerItems(grantedBy = "") {
  return FULL_POWER.map(entry => {
    const signature = { level: entry.level, foundation: entry.foundation, profile: entry.profile, fullPower: true,
      fixedKiPerTier: Number(entry.fixedKiPerTier) || 0,
      features: entry.features.map(([id, ranks, choice = ""]) => ({ id, ranks, choice })) };
    return {
      name: entry.name,
      type: "maneuver",
      img: "icons/magic/lightning/bolt-strike-blue.webp",
      flags: { [SCOPE]: { ...(grantedBy ? { grantedBy } : {}), fullPower: true } },
      system: { type: "standard", attacking: true, requiresTarget: true, tags: ["signature"], signature,
        script: composeTechniqueEffects(signature, "") }
    };
  });
}

/**
 * Nameless Horde (2): "You cannot create or otherwise gain Signature Techniques, except through the effects of Transformation Traits" -
 * refused (the user's), its 'Full Power' ones and a Transformation's aside. Why a new one may not be had, or "".
 */
export function whyNoNewTechnique(actor, data = null) {
  if (actor?.system?.effects?.slots?.["namelessHorde.noSignature"] !== true) return "";
  const sig = data?.system?.signature;
  if (sig?.fullPower || sig?.fromTransformation) return "";
  return `${actor.name} cannot create or gain Signature Techniques - Nameless Horde (2): only through a Transformation Trait's effects.`;
}

/** Whether Item data is a Signature Technique's. */
export function isTechniqueData(data) {
  return (data?.type === "maneuver") && ((data.system?.tags ?? []).includes("signature") || Boolean(data.system?.signature?.profile));
}

/**
 * Seedling Biology (1)'s: "You gain access to ... the Saibaman Bomb and Acid Spit Signature Techniques (see - Signature Examples)" - built as
 * listed, no Technique Points taken for them (the whole of them free).
 */
export const SAIBAMAN = Object.freeze([
  { name: "Acid Spit", level: "super", foundation: "energy", profile: "blast",
    features: [["sustained", 4], ["inaccurate", 2]] },
  // "Energy (Explosion)" - the Clearing Profile's former name (the user's). Its Ki Point Cost the 9(T) the rules make of it, not the listed
  // 10(T) (the user's); "If this Character is a Minion, it may still use the Saibaman Bomb Signature Technique" (technique-use.mjs).
  { name: "Saibaman Bomb", level: "ultimate", foundation: "energy", profile: "clearing", minionUltimate: true,
    features: [["final-chance", 1], ["power-shot", 3], ["grappling", 1], ["all-or-nothing", 1], ["self-explosion", 1], ["volatile-explosion", 1]] }
]);

/** The Technique Items a Trait's `grantsTechniques` names, given by its Item: Nameless Horde's 'Full Power' ones, the Saibamen's. */
export function grantedTechniqueItems(set, grantedBy = "") {
  if (set === "full-power") return fullPowerItems(grantedBy);
  if (set !== "saibaman") return [];
  return SAIBAMAN.map(entry => {
    const signature = { level: entry.level, foundation: entry.foundation, profile: entry.profile, freeTP: 999,
      fixedKiPerTier: Number(entry.fixedKiPerTier) || 0,
      features: entry.features.map(([id, ranks, choice = ""]) => ({ id, ranks, choice })) };
    return { name: entry.name, type: "maneuver", img: "icons/magic/lightning/bolt-strike-blue.webp",
      flags: { [SCOPE]: { ...(grantedBy ? { grantedBy } : {}), ...(entry.minionUltimate ? { minionUltimate: true } : {}) } },
      system: { type: "standard", attacking: true, requiresTarget: true, tags: ["signature"], signature,
        script: composeTechniqueEffects(signature, "") } };
  });
}

/** Whether an Item is one of them. */
export function isFullPower(item) {
  return Boolean(item?.system?.signature?.fullPower);
}
