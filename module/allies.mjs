/**
 * Who is whose Ally (the user's ruling): the Allies list on each character's Settings tab - either one's list is enough, both
 * ways; nobody else, whatever their token's disposition. Every other Character is an Opponent - but a Minion's side
 * (areOpponents). No imports, so it is read from
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
 * vice-versa" - whatever a list says. And a Minion has its Master's Allies for its own (the user's default), read as they stand:
 * their Master's listed Allies and other Minions, and those Allies' Minions - never, for a Duplicate, that Master.
 */
export function areAllies(one, other) {
  if (directAllies(one, other)) return true;
  const a = allyKey(one);
  const b = allyKey(other);
  if (!a || !b || (a === b) || masterPair(one, other)) return false;
  const masterFor = who => (masterOf(who) ? (globalThis.game?.actors?.get?.(masterOf(who)) ?? null) : null);
  const mine = masterFor(one);
  const theirs = masterFor(other);
  return Boolean((mine && directAllies(mine, other)) || (theirs && directAllies(one, theirs))
    || (mine && theirs && directAllies(mine, theirs)));
}

/** A Duplicate and its own Master, either way round - never Allies. */
function masterPair(one, other) {
  const duplicate = who => (actorOf(who)?.type === "minion") && Boolean(actorOf(who)?.system?.duplicate);
  return (duplicate(one) && (masterOf(one) === allyKey(other))) || (duplicate(other) && (masterOf(other) === allyKey(one)));
}

/** Allies by themselves: either named on the other's list, or a Minion and its Master - a Duplicate and its own not. */
function directAllies(one, other) {
  const a = allyKey(one);
  const b = allyKey(other);
  if (!a || !b || (a === b) || masterPair(one, other)) return false;
  return listedAllies(one).includes(b) || listedAllies(other).includes(a)
    || (masterOf(one) === b) || (masterOf(other) === a);
}

/**
 * Whether the two are Opponents: "Every other Character is an Opponent" - but a Minion stands on its Master's side (the user's: a
 * Duplicate is no Ally of theirs for any effect, yet on their side all the same). So a Master and their Minions, Duplicates
 * included, and the Minions of one Master, are never each other's Opponents - nor each other's Allies where no rule makes them so.
 * Anybody with themselves, or with nobody, is read as before: not an Ally.
 */
export function areOpponents(one, other) {
  if (areAllies(one, other)) return false;
  const a = allyKey(one);
  const b = allyKey(other);
  if (!a || !b || (a === b)) return true;
  return (masterOf(one) || a) !== (masterOf(other) || b);
}

/**
 * Whether an Ally of theirs, not Defeated, stands on a Square adjacent to them - by their tokens on the scene (Difference in Shell's "while
 * you have an adjacent Ally"). Nobody off a scene.
 */
export function besideAnAlly(who) {
  const actor = actorOf(who);
  if (!actor) return false;
  // Caste Combat's Rook: "You can treat your Opponents as if they were your Allies for the effects of any Arlian Racial Traits" - every
  // reader of this is one.
  const anyone = opponentsCountAsAllies(actor);
  return (globalThis.canvas?.tokens?.placeables ?? []).some(token => {
    const other = token.actor;
    if (!other || (other.uuid === actor.uuid) || other.system?.defeated || (!anyone && !areAllies(other, actor))) return false;
    return adjacent(actor, token);
  });
}

/** Whether two stand on adjacent Squares - by their tokens on one scene (an Actor's first, or the token given). */
export function adjacent(one, other) {
  const tokenOf = who => (who?.documentName === "Actor") ? (who.getActiveTokens?.(false, true)?.[0] ?? null) : who;
  const a = tokenOf(one);
  const b = tokenOf(other);
  const docA = a?.document ?? a;
  const docB = b?.document ?? b;
  const grid = globalThis.canvas?.grid?.size;
  if (!docA || !docB || !grid || (docA === docB) || (docA.parent?.id !== docB.parent?.id)) return false;
  const box = t => ({ x: t.x / grid, y: t.y / grid, w: t.width ?? 1, h: t.height ?? 1 });
  const gap = (p, q, pSize, qSize) => Math.max(0, Math.max(p - (q + qSize), q - (p + pSize)));
  const one_ = box(docA);
  const two = box(docB);
  return Math.max(Math.ceil(gap(one_.x, two.x, one_.w, two.w)), Math.ceil(gap(one_.y, two.y, one_.h, two.h))) === 0;
}

/**
 * Caste Combat's Rook chosen: "You can treat your Opponents as if they were your Allies for the effects of any Arlian Racial Traits" - read
 * off the Item, so a character's own preparation may ask it.
 */
export function opponentsCountAsAllies(who) {
  return Array.from(actorOf(who)?.items ?? []).some(item => (item.type === "racial")
    && (item.flags?.["dbu-ttrpg"]?.sourceId === "caste-combat")
    && (item.system?.chosen ?? []).some(entry => (entry?.key === "option") && (entry.value === "rook-caste")));
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
