/**
 * The kinds of Actor that are Characters: a Character, and a Minion - "Minions are classified as Characters that are
 * controlled by another Character, known as that Minion's Master" (the rulebook's Minion Rules; the user's: an Actor type of
 * its own). Everything a Character does a Minion does, but where its own rules say otherwise. No imports, so it is read from
 * anywhere.
 */

/** The Actor types that are Characters. */
export const CHARACTER_TYPES = Object.freeze(["character", "minion"]);

/** Whether an Actor - or what a token stands for - is a Character, a Minion included. */
export function isCharacter(actor) {
  return CHARACTER_TYPES.includes(actor?.type);
}

/** Whether an Actor is a Minion. */
export function isMinion(actor) {
  return actor?.type === "minion";
}

/**
 * Whether a Minion has its Act Phase this Combat Round: "Minions skip the Act Phase of their Turn ... unless they have been
 * targeted by the Command Maneuver by their Master" - the Round its Master's Command was for (chat.mjs commandMinions).
 */
export function commandedNow(actor) {
  const now = `${globalThis.game?.combat?.id ?? "none"}:${globalThis.game?.combat?.round ?? 0}`;
  return actor?.getFlag?.("dbu-ttrpg", "commanded") === now;
}
