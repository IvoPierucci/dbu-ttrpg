/**
 * Who is whose Ally (the user's ruling): the Allies list on each character's Settings tab - either one's list is enough, both
 * ways; nobody else, whatever their token's disposition. Every other Character is an Opponent. No imports, so it is read from
 * anywhere - the effects' own conditions among them.
 */

/** A Character as an Actor: an Actor itself, or what a token - its document or its placeable - stands for. */
function actorOf(who) {
  return (who?.documentName === "Actor") ? who : (who?.actor ?? null);
}

/** What a list holds of a Character: the world Actor's id - a token's own copy of it carries the same one. */
export function allyKey(who) {
  return actorOf(who)?.id ?? "";
}

/** The ids a Character's own Allies list holds. */
export function listedAllies(who) {
  return Array.from(actorOf(who)?.system?.allies ?? []).filter(Boolean);
}

/** Whether the two are Allies: two Characters, not one, either named on the other's list. */
export function areAllies(one, other) {
  const a = allyKey(one);
  const b = allyKey(other);
  if (!a || !b || (a === b)) return false;
  return listedAllies(one).includes(b) || listedAllies(other).includes(a);
}
