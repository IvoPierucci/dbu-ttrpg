/**
 * The kinds of Actor that are Characters: a Character, and a Minion - "Minions are classified as Characters that are
 * controlled by another Character, known as that Minion's Master" (the rulebook's Minion Rules; the user's: an Actor type of
 * its own). Everything a Character does a Minion does, but where its own rules say otherwise. And an Adversary (the
 * rulebook's Adversaries page; the user's: an Actor type of its own too) - the opponents the ARC plays, made as a Character is
 * and then given what adversary.mjs holds. No imports, so it is read from anywhere.
 */

/** The Actor types that are Characters. */
export const CHARACTER_TYPES = Object.freeze(["character", "minion", "adversary", "fusion"]);

/** Whether an Actor - or what a token stands for - is a Character, a Minion included. */
export function isCharacter(actor) {
  return CHARACTER_TYPES.includes(actor?.type);
}

/** Whether an Actor is a Minion - a Fusion of Minions too ("the resultant Fusion is also a Minion"). */
export function isMinion(actor) {
  return (actor?.type === "minion") || ((actor?.type === "fusion") && Boolean(actor.system?.fusion?.minion));
}

/**
 * Special Minions (Minion Rules): "Special Minions ignore the Weakness, Single Attack, Thresholds, and Ki Points & Capacity
 * rules for Minions." A Minion that is not one - the Settings tab's Special Minion box off, and not a Duplicate ("Duplicates ...
 * are Special Minions") - which is what those four rules ask.
 */
export function typicalMinion(actor) {
  return isMinion(actor) && !actor.system?.specialMinion && !actor.system?.duplicate;
}

/** A Duplicate Minion (Minion Rules): the Settings tab's Duplicate box - what From Goop's kind of effect makes. */
export function isDuplicate(actor) {
  return isMinion(actor) && Boolean(actor.system?.duplicate);
}

/**
 * Whether a Minion has its Act Phase this Combat Round: "Minions skip the Act Phase of their Turn ... unless they have been
 * targeted by the Command Maneuver by their Master" - the Round its Master's Command was for (chat.mjs commandMinions).
 */
export function commandedNow(actor) {
  const now = `${globalThis.game?.combat?.id ?? "none"}:${globalThis.game?.combat?.round ?? 0}`;
  return actor?.getFlag?.("dbu-ttrpg", "commanded") === now;
}

/** Whether an Actor is an Adversary (the Adversaries page): the ARC's, with a Category and a PCC of its own. */
export function isAdversary(actor) {
  return actor?.type === "adversary";
}

/**
 * Whether an Actor is a Fusion (the Fusion page; the user's: an Actor type of its own) - a Character made of two or more others, on
 * the Character's model and sheet (fusion.mjs).
 */
export function isFusion(actor) {
  return actor?.type === "fusion";
}

/**
 * A Player Character (Adversary Categories): "Player Characters refer to any non-Minion Characters controlled by a player" -
 * a Character that is neither a Minion nor an Adversary (the user's). A Fusion of Player Characters too - not one of Minions.
 */
export function isPlayerCharacter(actor) {
  return (actor?.type === "character") || ((actor?.type === "fusion") && !isMinion(actor));
}

/**
 * Whether an Actor may be a Master of Minions: a Character - not a Minion ("Minions cannot create or be the Master of a Minion"), a
 * Fusion of Minions neither - an Adversary or a Fusion.
 */
export function mayBeMaster(actor) {
  return ["character", "adversary", "fusion"].includes(actor?.type) && !isMinion(actor);
}

/**
 * Whether an Actor is a Vehicle (the Vehicles page; the user's: an Actor type of its own, made from nothing a Character has). No
 * Character: "A Vehicle is a member of the Battlefield, and can thus be targeted by Attacking Maneuvers as if it was another
 * Character. Otherwise, it functions similarly to a Feature."
 */
export function isVehicle(actor) {
  return actor?.type === "vehicle";
}
