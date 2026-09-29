/**
 * The Duel Maneuver: the rules of it that are arithmetic, kept apart from the card that runs it.
 *
 * "If you are the target of an Attacking Maneuver that has 2+ Energy Charges, or has a Ki Wager of
 * 10(bT) or more, you may initiate the Duel Maneuver." Three Duel Clashes follow, each with a Ki
 * Wager told to nobody until it is rolled; whoever wins two rolls their Initiating Attack's Wound
 * with every wager of the Duel on it.
 *
 * Who is who, as the user put it: the *attacker* made the incoming attack; the *initiator* is the
 * target who answered it with the Duel Maneuver. Each side has a primary who rolls - the attacker,
 * and the initiator - and secondaries who only wager: the attacker's United Attack joiners, and the
 * other targets who joined the Duel (United Duel) or United-Attacked the initiator's Initiating Attack.
 */

import { getTrait, resourceDefinitions } from "./effects/traits.mjs";
import { compile } from "./effects/parser.mjs";

/** The Maneuver's own id, as its file names it. */
export const DUEL_MANEUVER = "duel";

/** The Duel Escape Maneuver's id. */
export const DUEL_ESCAPE_MANEUVER = "duel-escape";

/** "Whoever wins at least 2 Duel Clashes wins the Duel Maneuver" - of 3. */
export const DUEL_WINS_NEEDED = 2;

/** "An Attacking Maneuver that has 2+ Energy Charges". */
export const DUEL_REQUIRED_CHARGES = 2;

/** "Or has a Ki Wager of 10(bT) or more" - the bT of whoever enters the Duel (the user's ruling). */
export const DUEL_REQUIRED_WAGER_PER_BT = 10;

/** "Energy and Magic both count as a single Foundation for a Duel Maneuver." */
export function duelFoundations(foundation) {
  return (foundation === "physical") ? ["physical"] : ["energy", "magic"];
}

/** A Duel is running on this attack: begun, and nobody has won it yet. */
export function duelRunning(attack) {
  return Boolean(attack?.duel && !attack.duel.outcome);
}

/**
 * The attack is over because of its Duel: the initiator won it, or the third Clash tied. The user's
 * ruling - the attack no longer exists, and nobody else answers it.
 */
export function endedByDuel(attack) {
  return Boolean(attack?.duel?.outcome && (attack.duel.outcome !== "attacker"));
}

/**
 * The attacker has not yet said whether they escape. "When an Opponent attempts to initiate a Duel
 * Maneuver with you as the target, you may attempt to escape" - then, and only then (the user's
 * ruling), so nothing is wagered until they have answered, or while their Impulsive Clash is out.
 */
export function duelEscapeOpen(duel) {
  return ["pending", "clash"].includes(duel?.escape);
}

/**
 * What a successful Duel Escape undoes and takes, for the attacker and those who put a wager on
 * their attack: "your Attacking Maneuver is nullified and you regain the Action Cost spent (you still
 * lose the Ki Point Cost of your Maneuver)". The user's rulings: the wager the Duel had given back is
 * lost again, and the nullified attack comes off their Diminishing Offense.
 */
export function duelEscapeUndo(attack) {
  return {
    actions: attack?.outOfSequence ? 0 : Math.max(0, Number(attack?.actionCost) || 0),
    attacksCounted: Math.max(0, Number(attack?.attacksCounted ?? 1) || 0),
    wagers: (attack?.duel?.returned ?? []).filter(entry => (Number(entry.amount) || 0) > 0)
  };
}

/** Whether the first Duel Clash has been rolled or wagered on: nobody joins after that. */
export function duelUnderway(duel) {
  return Boolean(duel && ((duel.clashes ?? []).length || (duel.wagers ?? []).length));
}

/** Everyone on each side of the Duel, primaries first. */
export function duelSides(attack) {
  const duel = attack?.duel;
  if (!duel) return { attacker: [], defender: [] };
  return {
    attacker: [{ uuid: attack.attackerUuid, name: attack.attackerName, primary: true },
      ...(attack.united ?? []).map(entry => ({ uuid: entry.uuid, name: entry.name, united: true }))],
    defender: [{ uuid: duel.initiatorUuid, name: duel.initiatorName, primary: true },
      ...(duel.joined ?? []).map(entry => ({ uuid: entry.uuid, name: entry.name })),
      ...(duel.united ?? []).map(entry => ({ uuid: entry.uuid, name: entry.name, united: true }))]
  };
}

/** Everyone in the Duel, whichever side. */
export function duelParticipants(attack) {
  const { attacker, defender } = duelSides(attack);
  return [...attacker, ...defender];
}

/** Which side a character is on, or "" when they are not in it. */
export function duelSideOf(attack, uuid) {
  const { attacker, defender } = duelSides(attack);
  if (attacker.some(entry => entry.uuid === uuid)) return "attacker";
  if (defender.some(entry => entry.uuid === uuid)) return "defender";
  return "";
}

/**
 * Whether the incoming attack lets this character into a Duel. The Charges are the attack's alone;
 * the Ki Wager is measured against the entrant's own 10(bT). The wager is the one it was declared
 * with - once a Duel runs, the attacker has it back, and that is not a reason to shut anyone out.
 */
export function duelRequirement(attack, actor) {
  const charges = Number(attack?.energyCharges) || 0;
  if (charges >= DUEL_REQUIRED_CHARGES) return "";
  const wager = Number(attack?.duel?.originalWager ?? attack?.kiWager) || 0;
  const baseTier = Math.max(1, Number(actor?.system?.baseTierOfPower) || 1);
  const needed = DUEL_REQUIRED_WAGER_PER_BT * baseTier;
  if (wager >= needed) return "";
  return `only against 2+ Energy Charges or a Ki Wager of ${needed} (10(bT)) or more`;
}

/**
 * Why this character cannot enter a Duel on this attack, or "" when they can. The Counter Action is
 * judged by the caller, which has the combat to ask.
 */
export function whyNotDuel(actor, attack, { counterLeft = 1 } = {}) {
  if (!attack) return "only against an Attacking Maneuver";
  const uuid = actor?.uuid;
  if (!(attack.targets ?? []).some(target => target.uuid === uuid)) return "only a target of this attack";
  if (attack.result) return "only before the attack resolves";
  if (endedByDuel(attack)) return "this attack is over";
  if (attack.duel?.outcome) return "the Duel is over";
  if (duelSideOf(attack, uuid)) return "already in the Duel";
  if (duelUnderway(attack.duel)) return "the Duel Clashes have begun";
  // Fake Out, lost: "must either use the Guard option of the Defend Maneuver or make a typical Dodge".
  if ((attack.fakeOutLosers ?? []).includes(uuid)) return "Fake Out: only Guard or a Dodge";
  const requirement = duelRequirement(attack, actor);
  if (requirement) return requirement;
  if (counterLeft < 1) return "no Counter Actions left";
  return "";
}

/**
 * The most one character may wager on one Duel Clash: "up to 1/2 of their Max Capacity (ignoring
 * their current Capacity)" for a primary, "up to 1/10th of their Max Capacity" for everyone else -
 * and never Ki they have not got.
 */
export function duelWagerCap(actor, { primary = false } = {}) {
  const max = Number(actor?.system?.capacity?.max) || 0;
  const cap = Math.floor(max / (primary ? 2 : 10));
  return Math.max(0, Math.min(cap, Number(actor?.system?.ki?.value) || 0));
}

/** "The higher of each Character's Force or Magic Modifier". */
export function duelAttribute(actor) {
  const force = Number(actor?.system?.attributes?.force?.mod) || 0;
  const magic = Number(actor?.system?.attributes?.magic?.mod) || 0;
  return (magic > force) ? { label: "Magic", value: magic } : { label: "Force", value: force };
}

/**
 * Whether a script's passive raises the Wound Roll: a `+=` to `wound` or `combatRolls`. The parser
 * writes both `+=` and `-=` as "add", the second as `0 - amount` - which is a penalty, not a raise
 * (Arrogant Declaration's, Holding Back's).
 */
function raisesWound(statements) {
  const lowers = amount => (amount?.type === "binary") && (amount.op === "-")
    && (amount.left?.type === "flat") && (Number(amount.left.value) === 0);
  return (statements ?? []).some(statement => {
    if (statement.type === "assign") {
      return ["wound", "combatRolls"].includes(statement.slot) && (statement.op === "add") && !lowers(statement.amount);
    }
    if (statement.type === "if") return raisesWound(statement.then) || raisesWound(statement.else);
    return false;
  });
}

/** Resource names whose passive raises the Wound Roll, read off the Traits that declare them. */
export function woundResources() {
  const found = [];
  for (const [name, definition] of Object.entries(resourceDefinitions())) {
    const trait = getTrait(definition.id);
    if (!trait?.script) continue;
    const { program } = compile(trait.script);
    if ((program?.blocks ?? []).some(block => (block.mode === "passive") && raisesWound(block.statements))) {
      found.push(name);
    }
  }
  return found;
}

/**
 * "Every stack of a resource they possess that has the passive effect of increasing the Dice Score
 * of their Wound Rolls (for example, Power stacks ...)".
 */
export function woundResourceStacks(actor, names = woundResources()) {
  const held = actor?.system?.resources ?? {};
  return names.reduce((sum, name) => sum + Math.max(0, Number(held[name]?.stacks) || 0), 0);
}

/**
 * A primary's Duel Clash rows, before any wager.
 *
 * "2(T) for every Energy Charge applied to their Initiating Attack", and 1(T) for every "Allied
 * Character participating as part of a United Duel ..., Power Shot applied to the attack, Super
 * Stack they possess, every State (Raging or Mindful) they are currently in, and every stack of a
 * resource" that raises their Wound. T is the roller's.
 */
export function duelClashRows(actor, { charges = 0, powerShotRanks = 0, allies = 0, resourceStacks = 0 } = {}) {
  const tier = Math.max(1, Number(actor?.system?.tierOfPower) || 1);
  const attribute = duelAttribute(actor);
  const rows = [{ label: `${attribute.label} Modifier`, value: attribute.value }];
  const add = (count, per, label) => {
    if (count > 0) rows.push({ label, written: `+${count * per}(T)`, value: count * per * tier });
  };
  add(Number(charges) || 0, 2, `Energy Charges ${charges}`);
  add(Number(allies) || 0, 1, `United Duel allies ${allies}`);
  add(Number(powerShotRanks) || 0, 1, `Power Shot ${powerShotRanks}`);
  const stacks = Math.max(0, Number(actor?.system?.superStacks) || 0);
  add(stacks, 1, `Super Stacks ${stacks}`);
  const states = ["raging", "mindful"].filter(key => (Number(actor?.system?.states?.[key]) || 0) > 0);
  add(states.length, 1, states.map(key => key.charAt(0).toUpperCase() + key.slice(1)).join(", "));
  add(Number(resourceStacks) || 0, 1, `Wound stacks ${resourceStacks}`);
  return rows;
}

/** Every wager the Duel has kept so far: what the winner's Wound Roll carries. */
export function duelTotal(duel) {
  return Math.max(0, Number(duel?.total) || 0);
}

/**
 * One Duel Clash, settled.
 *
 * "If a Duel Clash results in a tie, refund any Ki Wagers and redo the Duel Clash if it is not the
 * third Duel Clash. If it was the third Duel Clash, instead of redoing the Duel Clash or refunding
 * any Ki Wagers, the Duel Maneuver ends in a tie." The third is the one after a win each.
 *
 * @param {object} duel
 * @param {{attacker: number, defender: number, wagers: {uuid: string, amount: number}[]}} rolled
 * @returns {{duel: object, winner: "attacker"|"defender"|"tie", refund: {uuid: string, amount: number}[]}}
 */
export function settleDuelClash(duel, { attacker, defender, wagers = [] }) {
  const wins = { attacker: 0, defender: 0, ...(duel.wins ?? {}) };
  const third = (wins.attacker + wins.defender) === (DUEL_WINS_NEEDED * 2 - 2);
  const winner = (attacker > defender) ? "attacker" : (defender > attacker) ? "defender" : "tie";
  const staked = wagers.reduce((sum, entry) => sum + Math.max(0, Number(entry.amount) || 0), 0);
  const redone = (winner === "tie") && !third;

  const clash = { attacker, defender, wagers, winner, redone };
  const next = { ...duel, wins, clashes: [...(duel.clashes ?? []), clash], wagers: [] };
  if (redone) return { duel: next, winner, refund: wagers.filter(entry => entry.amount > 0) };

  next.total = duelTotal(duel) + staked;
  if (winner === "tie") next.outcome = "tie";
  else {
    next.wins = { ...wins, [winner]: wins[winner] + 1 };
    if (next.wins[winner] >= DUEL_WINS_NEEDED) next.outcome = winner;
  }
  return { duel: next, winner, refund: [] };
}

/** "All participating Characters have their Life Points reduced by 1/2 of the total Ki Wagered". */
export function duelTieLoss(duel) {
  return Math.floor(duelTotal(duel) / 2);
}

/** Power Duel's Wound: "a Dice Score for a Wound Roll equal to your Might plus the total Ki Wagers". */
export function powerDuelWound(actor, duel) {
  return (Number(actor?.system?.might) || 0) + duelTotal(duel);
}

/** Who still owes a wager on the Clash being set up. */
export function duelWaitingOn(attack) {
  const given = new Set((attack?.duel?.wagers ?? []).map(entry => entry.uuid));
  return duelParticipants(attack).filter(entry => !given.has(entry.uuid));
}
