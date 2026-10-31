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

/** Whether the two are Allies: two Characters, not one, either named on the other's list - or a Minion and its Master. */
export function areAllies(one, other) {
  const a = allyKey(one);
  const b = allyKey(other);
  if (!a || !b || (a === b)) return false;
  return listedAllies(one).includes(b) || listedAllies(other).includes(a)
    || (masterOf(one) === b) || (masterOf(other) === a);
}

/**
 * A Minion's Master, by the world Actor's id (the user's): the one its own Settings name, or the Character whose Minions list
 * names it - either is enough, as with Allies. "" for no Master, and for anybody who is not a Minion.
 */
export function masterOf(who) {
  const actor = actorOf(who);
  if (actor?.type !== "minion") return "";
  const own = String(actor.system?.master ?? "");
  if (own) return own;
  const lister = (globalThis.game?.actors?.contents ?? [])
    .find(other => (other.type === "character") && Array.from(other.system?.minions ?? []).includes(actor.id));
  return lister?.id ?? "";
}

/** A Character's Minions, by id: its own list's and every Minion naming it as its Master. None for a Minion - it has none. */
export function minionsOf(who) {
  const actor = actorOf(who);
  if (!actor || (actor.type === "minion")) return [];
  const own = Array.from(actor.system?.minions ?? []).filter(Boolean);
  const theirs = (globalThis.game?.actors?.contents ?? [])
    .filter(other => (other.type === "minion") && (other.system?.master === actor.id)).map(other => other.id);
  return [...new Set([...own, ...theirs])];
}

/**
 * The Combat Tracker's order (the rulebook's Minion Rules): highest Initiative first - but a Minion "directly after their
 * Master, in the order among Initiative, of their Initiative Value", where its Master is in the same Combat and has rolled.
 */
export function initiativeOrder(a, b) {
  const rolled = value => Number.isFinite(Number(value)) && (value !== null) && (value !== "");
  const place = combatant => {
    const own = rolled(combatant?.initiative) ? Number(combatant.initiative) : -Infinity;
    const masterId = masterOf(combatant?.actor);
    const master = masterId ? (combatant?.parent?.combatants?.contents ?? []).find(other => other.actor?.id === masterId) : null;
    return (master && rolled(master.initiative))
      ? { at: Number(master.initiative), group: master.id, after: 1, own }
      : { at: own, group: combatant?.id ?? "", after: 0, own };
  };
  const x = place(a);
  const y = place(b);
  const by = (p, q) => ((p === q) ? 0 : ((p > q) ? 1 : -1));
  return ((y.at === x.at) ? 0 : ((y.at > x.at) ? 1 : -1)) || by(x.group, y.group) || (x.after - y.after)
    || ((y.own === x.own) ? 0 : ((y.own > x.own) ? 1 : -1)) || by(a?.id, b?.id);
}
