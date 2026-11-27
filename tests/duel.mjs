// The Duel Maneuver: the requirement, the Duel Clash rows, the sequence of Clashes, and the wiring.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
const APP = (process.env.FOUNDRY_APP || String.raw`C:\Program Files\Foundry Virtual Tabletop\resources\app`);
const appUrl = p => pathToFileURL(path.join(APP, p)).href;
const modUrl = p => pathToFileURL(path.join(ROOT, "module", p)).href;
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

globalThis.CONST = {};
globalThis.foundry = {};
await import(appUrl("common/primitives/_module.mjs"));
globalThis.foundry.utils = { ...await import(appUrl("common/utils/_module.mjs")) };
globalThis.ui = { notifications: { warn: () => {}, error: () => {}, info: () => {} } };
globalThis.Handlebars = { escapeExpression: text => String(text) };
const TRAITS = path.join(ROOT, "traits");
globalThis.foundry.utils.fetchJsonWithTimeout = async () => JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));
globalThis.fetch = async url => {
  const file = path.join(TRAITS, String(url).replace("systems/dbu-ttrpg/traits/", ""));
  return fs.existsSync(file) ? { ok: true, text: async () => fs.readFileSync(file, "utf8") } : { ok: false };
};

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

const traits = await import(modUrl("effects/traits.mjs"));
await traits.loadTraits();
const D = await import(modUrl("duel.mjs"));
const U = await import(modUrl("united-attack.mjs"));

// --- The file ----------------------------------------------------------------------------------------
{
  const trait = traits.getTrait("duel");
  check("the Maneuver is loaded: a Counter, handed to the code", [trait?.name, trait?.type, trait?.duel],
    ["Duel", "counter", true]);
  check("its text as given", String(trait?.text ?? "").includes("Whoever wins at least 2 Duel Clashes wins the Duel Maneuver"),
    true);
}

// --- Who may enter -----------------------------------------------------------------------------------
{
  const who = (uuid, baseTier = 2) => ({ uuid, name: uuid, system: { baseTierOfPower: baseTier } });
  const attack = (over = {}) => ({ attackerUuid: "a", attackerName: "Goku", targets: [{ uuid: "v" }, { uuid: "p" }],
    energyCharges: 0, kiWager: 0, result: null, ...over });
  check("2+ Energy Charges let anyone in", D.duelRequirement(attack({ energyCharges: 2 }), who("v", 9)), "");
  check("one Charge and no wager do not", Boolean(D.duelRequirement(attack({ energyCharges: 1 }), who("v"))), true);
  check("a Ki Wager of 10(bT) of whoever enters", [D.duelRequirement(attack({ kiWager: 20 }), who("v", 2)),
    Boolean(D.duelRequirement(attack({ kiWager: 20 }), who("p", 3)))], ["", true]);
  check("the wager it was declared with, once the Duel has given it back",
    D.duelRequirement(attack({ kiWager: 0, duel: { originalWager: 20 } }), who("p", 2)), "");
  check("a target may", D.whyNotDuel(who("v"), attack({ energyCharges: 3 })), "");
  check("somebody else may not", Boolean(D.whyNotDuel(who("x"), attack({ energyCharges: 3 }))), true);
  check("nor after it resolved", Boolean(D.whyNotDuel(who("v"), attack({ energyCharges: 3, result: {} }))), true);
  check("nor a Fake Out loser", Boolean(D.whyNotDuel(who("v"), attack({ energyCharges: 3, fakeOutLosers: ["v"] }))), true);
  check("nor without a Counter Action", Boolean(D.whyNotDuel(who("v"), attack({ energyCharges: 3 }), { counterLeft: 0 })),
    true);
  const running = attack({ energyCharges: 3, duel: { initiatorUuid: "v", initiatorName: "Vegeta", joined: [], united: [],
    clashes: [], wagers: [], outcome: null } });
  check("another target may join it", D.whyNotDuel(who("p"), running), "");
  check("but not twice", Boolean(D.whyNotDuel(who("v"), running)), true);
  check("and not once the Clashes have begun",
    Boolean(D.whyNotDuel(who("p"), { ...running, duel: { ...running.duel, wagers: [{ uuid: "v", amount: 0 }] } })), true);
  check("Energy and Magic are one Foundation", [D.duelFoundations("magic"), D.duelFoundations("physical")],
    [["energy", "magic"], ["physical"]]);
}

// --- Sides and the attack's fate ---------------------------------------------------------------------
{
  const attack = { attackerUuid: "a", attackerName: "Goku", united: [{ uuid: "k", name: "Krillin" }],
    duel: { initiatorUuid: "v", initiatorName: "Vegeta", joined: [{ uuid: "n", name: "Nappa" }],
      united: [{ uuid: "r", name: "Raditz" }], wagers: [{ uuid: "a" }, { uuid: "n" }], outcome: null } };
  const sides = D.duelSides(attack);
  check("the attacker and their United Attack joiners on one side", sides.attacker.map(e => e.uuid), ["a", "k"]);
  check("the initiator, who joined, and who United-Attacked them on the other", sides.defender.map(e => e.uuid),
    ["v", "n", "r"]);
  check("each side's primary", [sides.attacker[0].primary, sides.defender[0].primary], [true, true]);
  check("the wagers still owed", D.duelWaitingOn(attack).map(e => e.uuid), ["k", "v", "r"]);
  check("running until it has an outcome", [D.duelRunning(attack), D.endedByDuel(attack)], [true, false]);
  check("the attack goes on when the attacker wins",
    D.endedByDuel({ ...attack, duel: { ...attack.duel, outcome: "attacker" } }), false);
  check("and is over when the initiator wins or it ties",
    ["defender", "tie"].map(outcome => D.endedByDuel({ ...attack, duel: { ...attack.duel, outcome } })), [true, true]);
}

// --- Wagers ------------------------------------------------------------------------------------------
{
  const actor = (max, ki) => ({ system: { capacity: { max }, ki: { value: ki } } });
  check("a primary: 1/3 of Max Capacity, whatever is left of it", D.duelWagerCap(actor(45, 100), { primary: true }), 15);
  check("the Duel Wager on top", D.duelWagerCap(actor(45, 100), { primary: true, bonus: 6 }), 21);
  check("everyone else: 1/10", D.duelWagerCap(actor(45, 100)), 4);
  check("never more Ki than they have", D.duelWagerCap(actor(45, 9), { primary: true }), 9);
  check("a joiner doubled (Teamwork), and doubled by two effects each its own (Teamwork and the Fusion of Ki): 2 and 4 times", [D.duelWagerCap(actor(45, 100), { doubled: true }), D.duelWagerCap(actor(45, 100), { doubled: 4 })], [8, 16]);
}

// --- A primary's roll --------------------------------------------------------------------------------
{
  const actor = { system: { tierOfPower: 3, superStacks: 2, states: { raging: 1, mindful: 0, surging: 1 },
    attributes: { force: { mod: 6 }, magic: { mod: 9 } }, resources: { power: { stacks: 2 } } } };
  check("the higher of Force or Magic", D.duelAttribute(actor), { label: "Magic", value: 9 });
  check("Power's passive raises the Wound, so its stacks count", D.woundResources().includes("power"), true);
  check("and one whose passive only takes away is left out (Arrogance, Holding Back)",
    D.woundResources(), ["overwhelm", "heroicstyle", "calculatingstyle", "battlebornwound", "power", "grudge", "battlecreation", "warriorblood", "concentratedki", "bloodlust", "progresswound", "allout", "bottomlesswound"]);
  const rows = D.duelWagerRows({ ...actor, system: { ...actor.system, states: { raging: 2, mindful: 1, surging: 1 } } },
    { charges: 3, powerShotRanks: 1, allies: 2, resourceStacks: D.woundResourceStacks(actor, ["power"]) });
  check("Duel Wager: 1(T) more to wager for each ally, Power Shot, Energy Charge, Super Stack, Level of Raging or Mindful, Wound stack",
    rows.map(row => [row.label, row.value]),
    [["United Duel allies 2", 6], ["Power Shot 1", 3], ["Energy Charges 3", 9],
     ["Super Stacks 2", 6], ["Raging 2, Mindful 1", 9], ["Wound stacks 2", 6]]);
  check("and the Clash itself only the Modifier", D.duelClashRows(actor).map(row => [row.label, row.value]), [["Magic Modifier", 9]]);
  check("nothing extra is nothing but the Modifier", D.duelClashRows({ system: { tierOfPower: 1,
    attributes: { force: { mod: 4 } } } }).map(row => row.value), [4]);
}

// --- The Clashes -------------------------------------------------------------------------------------
{
  const start = { wins: { attacker: 0, defender: 0 }, clashes: [], wagers: [], total: 0, outcome: null };
  const w = (a, d) => [{ uuid: "a", side: "attacker", amount: a }, { uuid: "v", side: "defender", amount: d }];
  let step = D.settleDuelClash(start, { attacker: 30, defender: 25, wagers: w(5, 3) });
  check("a Clash won: a win, and its wagers kept", [step.winner, step.duel.wins, step.duel.total, step.duel.outcome],
    ["attacker", { attacker: 1, defender: 0 }, 8, null]);
  step = D.settleDuelClash(step.duel, { attacker: 20, defender: 20, wagers: w(4, 6) });
  check("a tie before the third: wagers back, redone", [step.winner, step.refund.length, step.duel.total,
    step.duel.wins], ["tie", 2, 8, { attacker: 1, defender: 0 }]);
  step = D.settleDuelClash(step.duel, { attacker: 20, defender: 22, wagers: w(0, 2) });
  check("one each", [step.duel.wins, step.duel.outcome], [{ attacker: 1, defender: 1 }, null]);
  const third = D.settleDuelClash(step.duel, { attacker: 18, defender: 18, wagers: w(10, 12) });
  check("a tie on the third: over, nothing given back, every wager counted",
    [third.duel.outcome, third.refund, third.duel.total], ["tie", [], 32]);
  check("and everyone loses half of it, rounded down", D.duelTieLoss({ total: 33 }), 16);
  const won = D.settleDuelClash(step.duel, { attacker: 30, defender: 18, wagers: w(1, 0) });
  check("two wins take it", [won.duel.outcome, won.duel.total], ["attacker", 11]);
  const sweep = D.settleDuelClash(D.settleDuelClash(start, { attacker: 1, defender: 2, wagers: [] }).duel,
    { attacker: 1, defender: 2, wagers: [] });
  check("two straight and there is no third", [sweep.duel.outcome, sweep.duel.clashes.length], ["defender", 2]);
  check("Power Duel: Might plus every wager", D.powerDuelWound({ system: { might: 12 } }, { total: 30 }), 42);
}

// --- United Attack in a Duel -------------------------------------------------------------------------
{
  const entry = { name: "Krillin", wound: 4, modifier: 9, attributeLabel: "Force" };
  check("1/2 of the Modifier on an attack", U.unitedWoundParts({ united: [entry] }).map(part => part.value), [4]);
  check("1/4 once it went through a Duel", U.unitedWoundParts({ united: [entry], duel: {} }).map(part => [part.label, part.value]),
    [["United Attack (Krillin, 1/4 Force)", 2]]);
  check("and on the card its winner rolls", U.unitedWoundParts({ united: [entry], fromDuel: true }).map(part => part.value), [2]);
}

// --- Duel Escape -------------------------------------------------------------------------------------
{
  const trait = traits.getTrait("duel-escape");
  check("the Maneuver is loaded: a Counter, handed to the code", [trait?.name, trait?.type, trait?.duelEscape],
    ["Duel Escape", "counter", true]);
  check("its text as given", String(trait?.text ?? "").includes("you still lose the Ki Point Cost of your Maneuver"), true);
  check("asked first, and nothing is wagered while it is open",
    ["pending", "clash", "declined", "failed", undefined].map(escape => D.duelEscapeOpen({ escape })),
    [true, true, false, false, false]);
  const attack = { actionCost: 1, attacksCounted: 2, outOfSequence: false,
    duel: { returned: [{ uuid: "a", amount: 12, life: false }, { uuid: "k", amount: 0 }] } };
  check("won: the Action Cost back, its Diminishing Offense off, and the wagers given back taken again",
    D.duelEscapeUndo(attack), { actions: 1, attacksCounted: 2, wagers: [{ uuid: "a", amount: 12, life: false }] });
  check("an Out-of-Sequence attack spent no Action to give back",
    D.duelEscapeUndo({ ...attack, outOfSequence: true }).actions, 0);
  check("an escaped Duel is an attack that is over",
    D.endedByDuel({ duel: { outcome: "escaped" } }), true);
  const CHAT = read("module", "chat.mjs");
  check("an Impulsive Clash against the initiator", CHAT.includes('saves: ["impulsive"],\n    duelEscape: { attackMessageId: message.id, applied: false }'),
    true);
  check("settled where every Clash is", CHAT.includes("if (clash.duelEscape && clash.result && !clash.duelEscape.applied) {"), true);
  check("a tie is the defender's: only a win for the challenger escapes",
    CHAT.includes('const won = whoWonClash(clash.result) === "challenger";\n  if (!won) {'), true);
  check("the attack records what it spent", CHAT.includes("outOfSequence: Boolean(asOutOfSequence),\n          attacksCounted: counts,"),
    true);
  check("no wager button while the attacker has not answered",
    CHAT.includes("if (!duelRunning(attack) || duelEscapeOpen(attack.duel)) return;"), true);
}

// --- Where it is wired -------------------------------------------------------------------------------
{
  const CHAT = read("module", "chat.mjs");
  const USE = read("module", "use-maneuver.mjs");
  const COMBAT = read("module", "combat.mjs");
  check("played from the Respond dialog", CHAT.includes("if (maneuver.duel) return enterDuel(message, actor);"), true);
  check("nothing resolves while it runs",
    CHAT.includes("if (!attackIsReady(attack) || (attack.pending ?? []).length || duelRunning(attack) || endedByDuel(attack) || attack.sacrifice?.pending\n"), true);
  check("the others wait for its winner",
    CHAT.includes("const waiting = unresolved && (duelRunning(attack) || Boolean(duelSideOf(attack, actor.uuid)));"), true);
  check("the attacker gets their wager back", CHAT.includes("await giveBack(attacker, own, Boolean(attack.wagerFromLife));"), true);
  check("both kinds of Diminishing for the initiator",
    /"system\.attacksThisRound": \(Number\(actor\.system\.attacksThisRound\) \|\| 0\) \+ 1,\s*"system\.diminishingDefense"/.test(CHAT),
    true);
  check("Capacity to 0 for everyone in it",
    CHAT.includes('for (const who of everyone) await requestActorUpdate(who, { "system.capacity.spent": who.system.capacity.max });'),
    true);
  check("the losing side is hit with no roll", CHAT.includes('? "Lost the Duel"') && CHAT.includes('defence: "duel"'), true);
  check("the attack carries every wager", CHAT.includes("kiWager: duelTotal(duel),"), true);
  check("Power Duel's Shaken, until the winner is knocked through a Threshold",
    CHAT.includes("until: `threshold:${winner.uuid}`") && COMBAT.includes("await endedBy(other, `threshold:${actor.uuid}`);"),
    true);
  check("Power Duel at Standard", CHAT.includes('{ profile: "simple", foundation: attack.foundation, kiWager: 0'), true);
  check("not played from the sheet", USE.includes("if (maneuver.duel) {"), true);
  check("Transformation Flare's Duel half is said", CHAT.includes("Transformation Flare: ${attack.attackerName} may Transform out of sequence before any Duel roll."),
    true);
}

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
