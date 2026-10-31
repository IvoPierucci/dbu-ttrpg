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

/**
 * Whether the two are Allies: two Characters, not one, either named on the other's list - or a Minion and its Master. But a
 * Duplicate (Minion Rules): "While Minions are usually treated as Allies, a Duplicate is not considered their Master's Ally nor
 * vice-versa" - whatever a list says.
 */
export function areAllies(one, other) {
  const a = allyKey(one);
  const b = allyKey(other);
  if (!a || !b || (a === b)) return false;
  const duplicate = who => (actorOf(who)?.type === "minion") && Boolean(actorOf(who)?.system?.duplicate);
  if ((duplicate(one) && (masterOf(one) === b)) || (duplicate(other) && (masterOf(other) === a))) return false;
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
 * What a Master's effects give their Minions ("your Minions"), read off the Master's Slots: Combat Rolls (Leader's 1(T), Leader's
 * Insignia's 1(bT), God of Many's 1(T) in the Spectator State), Soak Value (Marauding Captain (2)'s 1(T)), Maximum Life Points
 * (Leader's 5(bT)) and Maximum Life Points for each Power Level reached (Spiritual Leadership (3)'s 2, Battle Goo (2)'s 2 for a
 * Goop) - the last two "after all other calculations". Each at the Master's own Tiers, their effects being theirs.
 */
export function minionGifts(who) {
  const actor = actorOf(who);
  const master = globalThis.game?.actors?.get?.(masterOf(actor));
  const slots = master?.system?.effects?.slots;
  const add = key => Number(slots?.[key]?.add) || 0;
  const kind = actor?.getFlag?.("dbu-ttrpg", "minionKind") ?? "";
  // Yaki Swarm (3): "While a Yaki is a Bonded Ally, they have their Combat Rolls increased by 1(T)" - Bonded to their Master; Yaki
  // Master (1): "While you are not Bonded, all of your Yaki are considered Bonded for the 3rd effect of Yaki Swarm."
  const bonded = master?.getFlag?.("dbu-ttrpg", "bonded")?.uuid ?? "";
  const yakiBonded = (kind === "yaki") && (bonded ? ((bonded === actor?.uuid) || (globalThis.fromUuidSync?.(bonded)?.id === actor?.id))
    : (slots?.["yakiMaster.allBonded"] === true));
  return { combatRolls: add("minions.combatRolls") + (yakiBonded ? add("yaki.bondedRolls") : 0), soakValue: add("minions.soakValue"),
    lifeMax: add("minions.lifeMax"), lifePerLevel: add("minions.lifePerLevel") + ((kind === "goop") ? add("goops.lifePerLevel") : 0),
    // Draining Minions: "Your Minions created through the first effect of Brood Parent gain access to the Power Drain Maneuver."
    allows: ((kind === "brood") && (slots?.["brood.drain"] === true)) ? ["maneuver.power-drain"] : [] };
}

/**
 * A Minion with its Act Phase whether Commanded or not: a Goop - From Goop (5): "they may always take their Act Phase, even if you
 * do not use the Command Maneuver" - and one its Master is Bonded to with Spiritual Leadership (2): "While you are Bonded to one of
 * your Minions, they do not skip their Act Phase."
 */
export function actsFreely(who) {
  const actor = actorOf(who);
  if (actor?.type !== "minion") return false;
  if (actor.getFlag?.("dbu-ttrpg", "minionKind") === "goop") return true;
  const master = globalThis.game?.actors?.get?.(masterOf(actor));
  if (master?.system?.effects?.slots?.["leadership.minionActs"] !== true) return false;
  const bonded = master.getFlag?.("dbu-ttrpg", "bonded")?.uuid ?? "";
  return Boolean(bonded) && ((bonded === actor.uuid) || (globalThis.fromUuidSync?.(bonded)?.id === actor.id));
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
