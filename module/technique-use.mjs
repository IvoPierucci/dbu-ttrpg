/**
 * Whether a Signature Technique may be used right now, and against whom.
 *
 * The questions a Technique's own Disadvantages and its level ask at the Signature Technique
 * Maneuver: an Ultimate once per Combat Encounter and three Ultimates in all, Fake Out once a
 * Round, the Restricted family, Climax Attack's Thresholds, the chains of Lead Up and Special
 * Set Up, Mandatory Charge, a Delayed Technique still waiting to go off. Each answers with the
 * reason it refuses, or "" - said where the player clicks, never a silent no.
 *
 * Nothing here asks the player anything; the two Disadvantages that are the table's word
 * (Concentration, Sneak Attack) are asked where the Technique is used.
 */

import { environmentIdOf } from "./environments.mjs";
import { featureRanks } from "./signature.mjs";
import { ULTIMATES_PER_ENCOUNTER } from "./technique.mjs";

/** The entry that counts one Ultimate used this Combat Encounter, across every Technique. */
export const ULTIMATE_USE = "encounter:ultimate-technique";

/** The entry Fake Out leaves for the rest of the Round. */
export const FAKE_OUT_USE = "round:fake-out";

const has = (technique, id) => (technique?.advantages ?? []).includes(id);
const ranks = (technique, id) => featureRanks(technique?.advantages ?? [], id);
const choice = (technique, id) => technique?.featureChoices?.[id] ?? "";

/** How many Ultimates this character has used this Combat Encounter. */
export function ultimatesUsed(actor) {
  return (actor?.system?.usedManeuvers ?? []).filter(entry => entry === ULTIMATE_USE).length;
}

/** "Refers to each Signature Technique individually": one use of this one, this Encounter. */
function usedThisEncounter(actor, technique) {
  return (actor?.system?.usedManeuvers ?? []).includes(`encounter:${technique.id}`);
}

/** Where a character stands in their Health Thresholds, as a rank: Healthy 0 ... Critical 3. */
const THRESHOLDS = ["healthy", "bruised", "injured", "critical"];
export function thresholdRank(actor) {
  return Math.max(0, THRESHOLDS.indexOf(actor?.system?.threshold?.key ?? "healthy"));
}

/**
 * Why this Technique cannot be used now, whoever it is aimed at, or "".
 *
 * @param {object} technique  its definition (definitionOf, through the door or not)
 * @param {{via?: string, ascended?: boolean, round?: number}} context
 *   `via` is how it is being reached: "counter" (Cross Counter), "exploit", "throw", or "" for
 *   the Signature Technique Maneuver itself.
 */
export function whyNotTechnique(actor, technique, { via = "", ascended = false } = {}) {
  if (!actor || !technique) return "";
  const name = technique.name;

  // A Delayed Technique's Imminent is still on somebody: "you cannot use this Signature Technique".
  const delayed = actor.items?.get?.(technique.itemId)?.system?.signature?.delayed;
  if (delayed?.messageId) return `${name}'s Imminent has not gone off yet.`;

  // Ultimates: "once per each Combat Encounter ... and only up to 3 ... during the entire Combat
  // Encounter". An Ascended Super counts as one.
  if (technique.ultimate || ascended) {
    if (technique.ultimate && usedThisEncounter(actor, technique)) {
      return `${name} has been used this Combat Encounter.`;
    }
    if (ultimatesUsed(actor) >= ULTIMATES_PER_ENCOUNTER) {
      return `${actor.name} has used ${ULTIMATES_PER_ENCOUNTER} Ultimate Signature Techniques this Combat Encounter.`;
    }
  }
  // Ascended Signature: "you cannot use this Signature Technique for the remainder of the Combat
  // Encounter" once it has become an Ultimate.
  if ((actor.system?.usedManeuvers ?? []).includes(`encounter:${technique.id}.ascended`)) {
    return `${name} ascended this Combat Encounter.`;
  }

  // Fake Out: "you cannot use a Signature Technique with the Fake Out Advantage if you've already
  // used one during this Combat Round."
  if (has(technique, "fake-out") && (actor.system?.usedManeuvers ?? []).includes(FAKE_OUT_USE)) {
    return `${actor.name} has used a Fake Out Technique this Round.`;
  }

  // Required Counter: "You cannot use this Signature Technique Maneuver except through the effects
  // of the Counter Advantage."
  if (has(technique, "required-counter") && (via !== "counter")) {
    return `${name} is only used through Counter.`;
  }

  // Climax Attack: below Bruised, Injured or Critical by rank.
  const climax = ranks(technique, "climax-attack");
  if (climax && (thresholdRank(actor) < climax)) {
    return `${name} needs ${actor.name} at ${["Bruised", "Injured", "Critical"][Math.min(climax, 3) - 1]} or worse.`;
  }

  // Restricted - Environment / State / Weather.
  if (has(technique, "restricted-environment")) {
    const wanted = choice(technique, "restricted-environment");
    const high = Number(actor.system?.battlefield?.highEnvironment) || 0;
    const ok = (wanted === "high") ? (high > 0)
      : (!high && (environmentIdOf(actor.system) === wanted));
    if (wanted && !ok) return `${name} is only used in its chosen Environment.`;
  }
  if (has(technique, "restricted-state")) {
    const wanted = choice(technique, "restricted-state");
    if (wanted && !((Number(actor.system?.states?.[wanted]) || 0) > 0)) {
      return `${name} is only used in its chosen State.`;
    }
  }
  if (has(technique, "restricted-weather")) {
    const wanted = choice(technique, "restricted-weather");
    if (wanted && (actor.system?.battlefield?.weather?.id !== wanted)) {
      return `${name} is only used in its chosen Battle Weather.`;
    }
  }

  // Mandatory Charge: "use the Energy Charge Maneuver on this Technique two times for each rank".
  const mandatory = ranks(technique, "mandatory-charge");
  if (mandatory) {
    const charging = actor.system?.charging ?? {};
    const uses = (charging.maneuverId === technique.itemId) ? (Number(charging.charges) || 0) : 0;
    if (uses < (2 * mandatory)) return `${name} needs ${2 * mandatory} uses of Energy Charge first (${uses} so far).`;
  }

  // Special Set Up: "if you didn't use your selected Special Maneuver as your last Maneuver this
  // Combat Round".
  if (has(technique, "special-set-up")) {
    const wanted = choice(technique, "special-set-up");
    const last = actor.system?.lastManeuver ?? {};
    const round = game?.combat?.started ? (game.combat.round ?? 0) : 0;
    if (wanted && ((last.maneuverId !== wanted) || (Number(last.round) !== round))) {
      return `${name} needs its Special Maneuver used just before it this Round.`;
    }
  }

  return "";
}

/**
 * Why this Technique cannot be aimed at this target, or "". The Disadvantages that are about who
 * it is aimed at: Grappling, Drop Down, Skyward Strike, Short Range at two ranks, Lead Up, and
 * the Restricted - Weapon one never, since that is about what is in hand.
 */
export function whyNotTechniqueAgainst(actor, technique, target, { reach = null } = {}) {
  if (!actor || !technique || !target) return "";
  const name = technique.name;
  const rank = who => Math.max(0, Number(who?.system?.battlefield?.highEnvironment) || 0);

  if (has(technique, "grappling")) {
    const grapple = actor.system?.grapple ?? {};
    if ((grapple.role !== "grappler") || (grapple.partner !== target.uuid)) {
      return `${name} is only used on somebody ${actor.name} is Grappling.`;
    }
  }
  if (has(technique, "drop-down")) {
    if (!(rank(actor) > 0) || !(rank(target) < rank(actor))) {
      return `${name} is only used from a High Environment against a target below it.`;
    }
  }
  if (has(technique, "skyward-strike")) {
    const deepSpace = rank(actor) && (rank(actor) === rank(target)) && (rank(actor) === DEEP_SPACE_RANK);
    if (!deepSpace && !(rank(target) > rank(actor)) && (rank(actor) > 0)) {
      return `${name} is only used against a higher target, or from the ground.`;
    }
  }
  if ((ranks(technique, "short-range") >= 2) && reach) {
    return `${name} only reaches its user's Melee Range: ${reach}`;
  }
  if (has(technique, "lead-up")) {
    const wanted = choice(technique, "lead-up");
    const last = actor.system?.lastManeuver ?? {};
    if (wanted && ((last.profile !== wanted) || !(last.hit ?? []).includes(target.uuid))) {
      return `${name} needs ${target.name} hit by your last Maneuver, made with its chosen Profile.`;
    }
  }
  return "";
}

/** Deep Space is the highest rank of High Environment. */
export const DEEP_SPACE_RANK = 4;

/**
 * What using this Technique writes down: the Ultimate count, the Encounter's use of an Ascended
 * one, the Round's Fake Out. The Technique's own once-per-Encounter is recorded by the door, as
 * its `through` limit.
 */
export function techniqueUseEntries(technique, { ascended = false } = {}) {
  const entries = [];
  if (technique.ultimate || ascended) entries.push(ULTIMATE_USE);
  if (ascended) entries.push(`encounter:${technique.id}.ascended`);
  if (has(technique, "fake-out")) entries.push(FAKE_OUT_USE);
  return entries;
}
