// United Attack: the Maneuver that joins an Ally's attack, and the Disadvantage that needs it.
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

let U;
try {
  const traits = await import(modUrl("effects/traits.mjs"));
  await traits.loadTraits();
  U = await import(modUrl("united-attack.mjs"));
  const M = await import(modUrl("maneuvers.mjs"));
  await M.loadManeuvers();
} catch (error) {
  console.log(`FAIL  the module loads: ${error.message}`);
  process.exit(1);
}
const { getTrait } = await import(modUrl("effects/traits.mjs"));

// --- The file ----------------------------------------------------------------------------------------
{
  const trait = getTrait("united-attack-maneuver");
  check("the Maneuver is loaded under an id of its own", [trait?.name, trait?.type], ["United Attack", "instant"]);
  check("1/Round, and handed to the code", [String(trait?.usageLimit), trait?.united], ["1/round", true]);
  check("its text as given", String(trait?.text ?? "").includes("you may spend 1 Action and the Ki Points as if making the same Profile"),
    true);
  check("and the Disadvantage keeps its own id", getTrait("united-attack")?.name, "United Attack");
}

// --- The numbers -------------------------------------------------------------------------------------
{
  const joiner = { system: { capacity: { max: 43 }, attributes: { force: { mod: 9 }, magic: { mod: 5 } } } };
  check("the wager: 1/4 of Max Capacity, rounded down", U.unitedWagerCap(joiner), 10);
  check("1/2 Force for a Physical or Energy Attack", [U.unitedWoundBonus(joiner, "physical").value,
    U.unitedWoundBonus(joiner, "energy").value], [4, 4]);
  check("1/2 Magic for a Magic Attack", U.unitedWoundBonus(joiner, "magic"), { attribute: "magic", value: 2, modifier: 5 });
  check("one Wound row for each who joined",
    U.unitedWoundParts({ united: [{ name: "Krillin", wound: 4, attributeLabel: "Force" }, { name: "Yamcha", wound: 0 }] }),
    [{ label: "United Attack (Krillin, 1/2 Force)", value: 4 }]);
}

// --- The Advantages brought --------------------------------------------------------------------------
{
  const offer = U.unitedOfferable({ advantages: ["accurate", "accurate", "power-shot", "inaccurate", "backlash"] });
  check("only the Technique's Advantages, with their ranks",
    offer.map(entry => [entry.id, entry.ranks]), [["accurate", 2], ["power-shot", 1]]);
  check("up to 1(bT) ranks in all", U.unitedAdditions([], { accurate: 2, "power-shot": 1 }, 2), ["accurate", "accurate"]);
  check("added to what the attack has, but never past the Advantage's most ranks",
    U.unitedAdditions(["power-shot", "power-shot"], { "power-shot": 3 }, 3), ["power-shot"]);
  check("nothing asked is nothing added", U.unitedAdditions([], {}, 3), []);
}

// --- Whom the Disadvantage may ask -------------------------------------------------------------------
{
  const item = (name, signature = true) => ({ type: "maneuver", name, system: { tags: signature ? ["signature"] : [] } });
  const who = (uuid, items, type = "character") => ({ uuid, name: uuid, type, items });
  const me = who("goku", [item("Father-Son Kamehameha")]);
  const pool = [me, who("gohan", [item("father-son kamehameha ")]), who("piccolo", [item("Special Beam Cannon")]),
    who("vegeta", [item("Father-Son Kamehameha", false)]), who("gohan", [item("Father-Son Kamehameha")])];
  check("someone else with a Signature Technique of the same name, once each",
    U.unitedPartners(me, "Father-Son Kamehameha", pool).map(actor => actor.uuid), ["gohan"]);
}

// --- Pending, and the card ---------------------------------------------------------------------------
{
  check("waiting until the one asked joins", U.unitedPending({ unitedWith: { uuid: "gohan" }, united: [] }), true);
  check("and not after", U.unitedPending({ unitedWith: { uuid: "gohan" }, united: [{ uuid: "gohan" }] }), false);
  check("nor once it has failed", U.unitedPending({ unitedWith: { uuid: "gohan" }, unitedFailed: true }), false);
  check("an attack that asked nobody waits on nobody", U.unitedPending({ united: [] }), false);
}

// --- The attack, joined ------------------------------------------------------------------------------
{
  const attacker = { name: "Goku", system: { tierOfPower: 3, baseTierOfPower: 2, threshold: { key: "healthy" },
    attributes: { force: { mod: 8 } }, alignment: 0 } };
  const attack = { profile: "beam", foundation: "energy", kiWager: 5, advantages: [], technique: null, energyCharges: 0,
    targets: [{ uuid: "t" }], area: null };
  const plain = U.withJoiner(attack, { uuid: "k", wager: 3, advantages: [], choices: {} }, attacker);
  check("the wager goes on top, outside the attacker's limit", plain.kiWager, 8);
  check("and nothing else changes with no Advantage brought", [plain.technique, plain.united.length], [null, 1]);
  const joined = U.withJoiner(attack, { uuid: "k", wager: 0, advantages: ["accurate", "power-shot"], choices: {} }, attacker);
  check("an Advantage brought is on the attack's features", joined.technique.features, ["accurate", "power-shot"]);
  check("Power Shot's ranks are carried for Parry and Deflect", joined.powerShotRanks, 1);
  // What a joined Advantage asks, answered by the one who brought it; and the Charges it brings.
  const boosted = U.withJoiner({ ...attack, energyCharges: 3, technique: { ultimate: true, features: [], choices: {},
    bonusCharges: [], chargeCeilingBonus: 1, off: [] } },
    { uuid: "k", wager: 0, advantages: ["transformation-boost"], choices: {}, answers: { transformed: true } },
    { ...attacker, system: { ...attacker.system } }, { ceiling: 7 });
  check("Transformation Boost's answer counts, and its Charge is added",
    [boosted.energyCharges, boosted.technique.bonusCharges.map(entry => entry.label)], [4, ["Transformation Boost"]]);
  const capped = U.withJoiner({ ...attack, energyCharges: 8, technique: { ultimate: true, features: [], choices: {},
    bonusCharges: [], chargeCeilingBonus: 1, off: [] } },
    { uuid: "k", wager: 0, advantages: ["transformation-boost"], choices: {}, answers: { transformed: true } },
    attacker, { ceiling: 7 });
  check("held to the attack's most Charges (7, and the Ultimate's one more)",
    [capped.technique.bonusCharges.map(entry => entry.label), capped.energyCharges], [["Transformation Boost"], 8]);
  const bombed = U.withJoiner(attack, { uuid: "k", wager: 2, lifeWager: 30, advantages: [], choices: {} }, attacker);
  check("Final Chance's Life goes on the wager", bombed.kiWager, 5 + 2 + 30);
  const off = U.withJoiner(attack, { uuid: "k", wager: 0, advantages: ["terrain-destruction"], choices: {} }, attacker);
  check("one whose Requirement fails on the final attack is carried but off",
    [off.technique.features, off.technique.off.map(entry => entry.id)], [[], ["terrain-destruction"]]);
}

// --- Who may join ------------------------------------------------------------------------------------
{
  const joiner = (over = {}) => ({ name: "Krillin", system: { usedManeuvers: [], instantPlayed: { held: false },
    ...over } });
  const attack = { attackerName: "Goku", maneuverName: "Kamehameha", technique: null };
  check("a fresh character may", U.whyNotUnite(joiner(), attack, null), "");
  check("once a Combat Round", Boolean(U.whyNotUnite(joiner({ usedManeuvers: ["round:united-attack-maneuver"] }),
    attack, null)), true);
  check("not straight after another Instant", Boolean(U.whyNotUnite(joiner({ instantPlayed: { held: true } }), attack, null)),
    true);
  check("nor against Instant Assault", Boolean(U.whyNotUnite(joiner(),
    { ...attack, technique: { features: ["instant-assault"] } }, null)), true);
  globalThis.game = { combat: { started: true } };
  check("nor with no Action left, in a Combat Encounter",
    Boolean(U.whyNotUnite(joiner(), attack, null, { actionsLeft: () => 0 })), true);
  delete globalThis.game;
}

// --- Where it is wired -------------------------------------------------------------------------------
{
  const CHAT = read("module", "chat.mjs");
  const USE = read("module", "use-maneuver.mjs");
  const UNITED = read("module", "united-attack.mjs");
  check("the Wound Roll reads it", CHAT.includes("...unitedWoundParts(attack),"), true);
  check("offered while the attack is open, before the attacker commits",
    CHAT.includes("if (!result && !committed && !attack.reflectedFrom && !duelUnderway(attack.duel)) {"), true);
  check("the attacker waits on the Ally asked",
    CHAT.includes("if (attacker?.isOwner && (unitedPending(attack) || duelRunning(attack))) return;"), true);
  check("a failed one stops the card", CHAT.includes("  if (attack.unitedFailed || attack.punished || attack.divineCancelled || attack.godBindCancelled\n    || attack.disarmingSwapped || attack.icCancelled || attack.planetGone) return;"), true);
  check("and gives back what was paid",
    /system\.ki\.value": Math\.min\(attacker\.system\.ki\.max, attacker\.system\.ki\.value \+ \(Number\(paid\.ki\) \|\| 0\)\)/.test(CHAT),
    true);
  check("joining is an Instant, on this card", CHAT.includes('await recordManeuverType(joiner, "instant", { messageId: message.id });'),
    true);
  check("the Ally is asked for before anything is paid",
    USE.indexOf("const partner = await askUnitedPartner(actor, maneuver);")
      < USE.indexOf("if (!fromStore && !await spendManeuverCost(actor, maneuver, moving.fromSelf)) return false;"), true);
  check("what was paid is recorded for the refund", USE.includes("declared = { ...declared, unitedWith: { ...declared.unitedWith, paid: {"),
    true);
  check("Instant Assault keeps it out", UNITED.includes('includes("instant-assault")'), true);
  check("it counts for the joiner's Diminishing Offense",
    UNITED.includes('"system.attacksThisRound": (Number(joiner.system.attacksThisRound) || 0) + 1'), true);
  check("a Technique used to join is a use of the Signature Technique Maneuver",
    UNITED.includes("if (!choice.lowStakes && door) await recordManeuverUse(joiner, door);"), true);
  check("not played from the sheet", USE.includes("if (maneuver.united) {"), true);
  check("its Advantages' questions asked before anything is paid",
    UNITED.indexOf("answers = await askJoinedDeclaration(joiner, attack, added);")
      < UNITED.indexOf("if (!noAction && !await spendActions(joiner, 1)) return null;"), true);
  check("and the attack's most Charges handed over",
    CHAT.includes("{ ceiling: maxEnergyCharges(attack.profile, DBUCharacterData.MAX_ENERGY_CHARGES, attacker) }"), true);
}

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
