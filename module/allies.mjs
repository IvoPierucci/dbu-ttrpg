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

/** Who may hold a Minions list: a Character, an Adversary or a Fusion - not a Fusion of Minions (actor-types.mjs mayBeMaster). */
function listsMinions(actor) {
  return ["character", "adversary", "fusion"].includes(actor?.type) && !((actor.type === "fusion") && actor.system?.fusion?.minion);
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
  // A Fusion of Minions: each of its Masters' (masterIds).
  const mastersFor = who => masterIds(who).map(id => globalThis.game?.actors?.get?.(id) ?? null).filter(Boolean);
  const mine = mastersFor(one);
  const theirs = mastersFor(other);
  return mine.some(master => directAllies(master, other)) || theirs.some(master => directAllies(one, master))
    || mine.some(master => theirs.some(their => directAllies(master, their)));
}

/**
 * A Minion's Master's id, as a list - a Fusion of Minions' every one: "if they had separate Masters, then both Masters may serve as the
 * Master for the Fusion". None for anybody who is not a Minion.
 */
function masterIds(who) {
  const actor = actorOf(who);
  if ((actor?.type === "fusion") && actor.system?.fusion?.minion) return Array.from(actor.system.fusion.masters ?? []).filter(Boolean);
  const one = masterOf(who);
  return one ? [one] : [];
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
    || masterIds(one).includes(b) || masterIds(other).includes(a);
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
  // Each one's side: their Master's - a Fusion of Minions', any of its Masters' - or their own.
  const mine = masterIds(one).length ? masterIds(one) : [a];
  const theirs = masterIds(other).length ? masterIds(other) : [b];
  return !mine.some(id => theirs.includes(id));
}

/**
 * Whether an Ally of theirs, not Defeated, stands on a Square adjacent to them - by their tokens on the scene (Difference in Shell's "while
 * you have an adjacent Ally"). Nobody off a scene.
 */
export function besideAnAlly(who, rook = true) {
  const actor = actorOf(who);
  if (!actor) return false;
  // Caste Combat's Rook: "You can treat your Opponents as if they were your Allies for the effects of any Arlian Racial Traits" - every
  // Arlian reader of this is one; the others (Petite Genius's) pass `rook` false.
  const anyone = rook && opponentsCountAsAllies(actor);
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
 * Whether two stand within this many Squares of each other (0: adjacent, as `adjacent`) - by their tokens on one scene; a
 * Sphere AoE centred on one reaches the other when it is within the Sphere's radius less 1 (guidance.mjs SPHERE_RADIUS).
 */
export function withinSquares(one, other, squares) {
  const tokenOf = who => (who?.documentName === "Actor") ? (who.getActiveTokens?.(false, true)?.[0] ?? null) : who;
  const docA = tokenOf(one)?.document ?? tokenOf(one);
  const docB = tokenOf(other)?.document ?? tokenOf(other);
  const grid = globalThis.canvas?.grid?.size;
  if (!docA || !docB || !grid || (docA === docB) || (docA.parent?.id !== docB.parent?.id)) return false;
  const box = t => ({ x: t.x / grid, y: t.y / grid, w: t.width ?? 1, h: t.height ?? 1 });
  const gap = (p, q, pSize, qSize) => Math.max(0, Math.max(p - (q + qSize), q - (p + pSize)));
  const a = box(docA);
  const b = box(docB);
  return Math.max(Math.ceil(gap(a.x, b.x, a.w, b.w)), Math.ceil(gap(a.y, b.y, a.h, b.h))) <= Math.max(0, Number(squares) || 0);
}

/** The characters on the scene who are Opponents of this one, not Defeated - each once, however many tokens. */
export function opponentsOnScene(who) {
  const actor = actorOf(who);
  if (!actor) return [];
  return [...new Map((globalThis.canvas?.tokens?.placeables ?? [])
    .filter(token => token.actor && (token.actor.uuid !== actor.uuid) && !token.actor.system?.defeated && areOpponents(token.actor, actor))
    .map(token => [token.actor.uuid, token.actor])).values()];
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
  // Minion Fusion: "both Masters may serve as the Master for the Fusion" - the first of them, where one is asked for.
  if ((actor?.type === "fusion") && actor.system?.fusion?.minion) return String(actor.system.fusion.masters?.[0] ?? "");
  if (actor?.type !== "minion") return "";
  const own = String(actor.system?.master ?? "");
  if (own) return own;
  const lister = (globalThis.game?.actors?.contents ?? [])
    .find(other => listsMinions(other) && Array.from(other.system?.minions ?? []).includes(actor.id));
  if (lister) return lister.id;
  // An Adversary Minion with no Master named: the first of the Adversaries, all of whom are its Master (mastersOf).
  return mastersOf(actor)[0] ?? "";
}

/** Whether a Minion is an Adversary Minion (the Adversaries page): its Settings' box - a Duplicate never, for its Master. */
export function isAdversaryMinion(who) {
  const actor = actorOf(who);
  return (actor?.type === "minion") && Boolean(actor.system?.adversaryMinion) && !actor.system?.duplicate;
}

/**
 * Every Master a Minion has, by id: its own - or, an Adversary Minion's, "For any effects, Adversary Minions (except Duplicate
 * Minions) consider all non-Minion Adversaries to be their Master": every Adversary in the world, its named one first.
 */
export function mastersOf(who) {
  const actor = actorOf(who);
  // A Fusion of Minions: both of its Fused Characters' Masters.
  if ((actor?.type === "fusion") && actor.system?.fusion?.minion) return masterIds(actor);
  if (actor?.type !== "minion") return [];
  const named = String(actor.system?.master ?? "");
  if (!isAdversaryMinion(actor)) {
    const one = named || (globalThis.game?.actors?.contents ?? [])
      .find(other => listsMinions(other) && Array.from(other.system?.minions ?? []).includes(actor.id))?.id;
    return one ? [one] : [];
  }
  const adversaries = (globalThis.game?.actors?.contents ?? []).filter(other => other.type === "adversary").map(other => other.id);
  return [...new Set([named, ...adversaries].filter(Boolean))];
}

/** A Character's Minions, by id: its own list's and every Minion naming it as its Master. None for a Minion - it has none - a Fusion of Minions neither. */
export function minionsOf(who) {
  const actor = actorOf(who);
  if (!actor || (actor.type === "minion") || ((actor.type === "fusion") && actor.system?.fusion?.minion)) return [];
  const own = Array.from(actor.system?.minions ?? []).filter(Boolean);
  const theirs = (globalThis.game?.actors?.contents ?? [])
    .filter(other => ((other.type === "minion") && (other.system?.master === actor.id))
      // A Fusion of Minions: each of its Masters' ("both Masters may serve as the Master for the Fusion").
      || ((other.type === "fusion") && other.system?.fusion?.minion && Array.from(other.system.fusion.masters ?? []).includes(actor.id)))
    .map(other => other.id);
  // An Adversary's: every Adversary Minion besides, each of them considering every Adversary its Master.
  const adversaryMinions = (actor.type === "adversary") ? (globalThis.game?.actors?.contents ?? [])
    .filter(other => isAdversaryMinion(other)).map(other => other.id) : [];
  return [...new Set([...own, ...theirs, ...adversaryMinions])];
}

/**
 * What a Master's effects give their Minions ("your Minions"), read off the Master's Slots: Combat Rolls (Leader's 1(T), Leader's
 * Insignia's 1(bT), God of Many's 1(T) in the Spectator State), Soak Value (Marauding Captain (2)'s 1(T)), Maximum Life Points
 * (Leader's 5(bT)) and Maximum Life Points for each Power Level reached (Spiritual Leadership (3)'s 2, Battle Goo (2)'s 2 for a
 * Goop) - the last two "after all other calculations". Each at the Master's own Tiers, their effects being theirs.
 */
export function minionGifts(who) {
  const actor = actorOf(who);
  // An Adversary Minion's: every Adversary's, added together - each is its Master "for any effects".
  if (isAdversaryMinion(actor) && (mastersOf(actor).length > 1)) {
    const each = mastersOf(actor).map(id => minionGiftsFrom(actor, globalThis.game?.actors?.get?.(id)));
    return each.reduce((sum, gift) => ({ combatRolls: sum.combatRolls + gift.combatRolls, soakValue: sum.soakValue + gift.soakValue,
      wound: sum.wound + gift.wound, lifeMax: sum.lifeMax + gift.lifeMax, lifePerLevel: sum.lifePerLevel + gift.lifePerLevel,
      allows: [...new Set([...sum.allows, ...gift.allows])] }));
  }
  return minionGiftsFrom(actor, globalThis.game?.actors?.get?.(masterOf(actor)));
}

/** What one Master's effects give a Minion of theirs. */
function minionGiftsFrom(actor, master) {
  const slots = master?.system?.effects?.slots;
  const add = key => Number(slots?.[key]?.add) || 0;
  const kind = actor?.getFlag?.("dbu-ttrpg", "minionKind") ?? "";
  // Yaki Swarm (3): "While a Yaki is a Bonded Ally, they have their Combat Rolls increased by 1(T)" - Bonded to their Master; Yaki
  // Master (1): "While you are not Bonded, all of your Yaki are considered Bonded for the 3rd effect of Yaki Swarm."
  const bonded = master?.getFlag?.("dbu-ttrpg", "bonded")?.uuid ?? "";
  const yakiBonded = (kind === "yaki") && (bonded ? ((bonded === actor?.uuid) || (globalThis.fromUuidSync?.(bonded)?.id === actor?.id))
    : (slots?.["yakiMaster.allBonded"] === true));
  return { combatRolls: add("minions.combatRolls") + (yakiBonded ? add("yaki.bondedRolls") : 0), soakValue: add("minions.soakValue"),
    // Master of Minions (2): their Wound Rolls.
    wound: add("minions.wound"),
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
  if ((actor?.type !== "minion") && !((actor?.type === "fusion") && actor.system?.fusion?.minion)) return false;
  // Adversary Masters: "Adversary Minions always have access to their Act Phase and do not need to be targeted by the Command
  // Maneuver."
  if (isAdversaryMinion(actor)) return true;
  if (actor.getFlag?.("dbu-ttrpg", "minionKind") === "goop") return true;
  // Any of its Masters' Bond - a Fusion of Minions has more than one.
  return masterIds(actor).some(id => {
    const master = globalThis.game?.actors?.get?.(id);
    if (master?.system?.effects?.slots?.["leadership.minionActs"] !== true) return false;
    const bonded = master.getFlag?.("dbu-ttrpg", "bonded")?.uuid ?? "";
    return Boolean(bonded) && ((bonded === actor.uuid) || (globalThis.fromUuidSync?.(bonded)?.id === actor.id));
  });
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
