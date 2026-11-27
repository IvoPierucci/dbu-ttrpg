// What a Technique's features do on the attack: which hold, the Area, the Charges, the rows.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
const APP = (process.env.FOUNDRY_APP || String.raw`C:\Program Files\Foundry Virtual Tabletop\resources\app`);
const appUrl = p => pathToFileURL(path.join(APP, p)).href;
const modUrl = p => pathToFileURL(path.join(ROOT, "module", p)).href;

globalThis.CONST = {};
globalThis.foundry = {};
await import(appUrl("common/primitives/_module.mjs"));
globalThis.foundry.utils = { ...await import(appUrl("common/utils/_module.mjs")) };
globalThis.ui = { notifications: { warn: () => {}, error: () => {}, info: () => {} } };
const TRAITS = path.join(ROOT, "traits");
globalThis.foundry.utils.fetchJsonWithTimeout = async () => JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));
globalThis.fetch = async url => {
  const file = path.join(TRAITS, String(url).replace("systems/dbu-ttrpg/traits/", ""));
  return fs.existsSync(file) ? { ok: true, text: async () => fs.readFileSync(file, "utf8") } : { ok: false };
};
await (await import(modUrl("effects/traits.mjs"))).loadTraits();
const A = await import(modUrl("technique-attack.mjs"));
const { areaLabel } = await import(modUrl("maneuvers.mjs"));

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};
const actor = (over = {}) => ({ name: "Goku", system: { tierOfPower: 3, baseTierOfPower: 2, might: 9,
  threshold: { key: "healthy" }, attributes: { force: { mod: 8 }, magic: { mod: 4 }, insight: { mod: 7 } },
  alignment: 1, ...over } });
const tech = (advantages, over = {}) => ({ name: "T", advantages, featureChoices: {}, ultimate: false,
  superProfile: "", secondProfile: "", ...over });
const run = (who, t, declared, extra = {}) => A.techniqueAttack(who, t,
  { profile: "beam", foundation: "energy", charges: 0, ...declared }, { targets: [{}], shaken: [], ...extra });

// --- Elemental (Dark) and (Light) together ---------------------------------------------------------
{
  const who = actor();
  const pair = { profile: "elementalDark", technique: { features: [], choices: {}, secondProfile: "elementalLight" } };
  const alone = { profile: "elementalDark", technique: { features: [], choices: {}, secondProfile: "" } };
  const labels = parts => parts.map(part => [part.label, part.value]);
  check("Light's +1(T) Strike when Dark is on the attack too",
    labels(A.techniqueStrikeParts(who, pair)), [["Elemental (Light) with (Dark)", 3]]);
  check("Dark's +2(T) Wound when Light is",
    labels(A.techniqueWoundParts(who, pair)), [["Elemental (Dark) with (Light)", 6]]);
  check("either way round", A.darkAndLight({ profile: "elementalLight", technique: { secondProfile: "elementalDark" } }), true);
  check("and nothing with one of them alone", [A.techniqueStrikeParts(who, alone), A.techniqueWoundParts(who, alone)], [[], []]);
}

// --- Which features hold ---------------------------------------------------------------------------
{
  const block = run(actor(), tech(["pinpoint-precision", "terrain-destruction"]), { profile: "blast", advantages: ["pinpoint-precision", "terrain-destruction"] });
  check("Pinpoint's Magnitude read on the final attack: Large, so it is off", block.off.map(o => o.id), ["pinpoint-precision"]);
  check("and the card says so", block.notes, ["Pinpoint Precision: Requirement not met"]);
  check("the Area is the one built", areaLabel(block.area), "Large Cone");
  const dis = run(actor(), tech(["drop-down"]), { advantages: ["drop-down"] });
  check("a Disadvantage stays whatever happens", [dis.features, dis.off], [["drop-down"], []]);
}

// --- Energy Charges ---------------------------------------------------------------------------------
{
  const single = run(actor(), tech(["concentrated-strike"]), { profile: "blast", advantages: ["concentrated-strike"] });
  check("Concentrated Strike: +1 against one target", single.bonusCharges, [{ label: "Concentrated Strike", amount: 1 }]);
  const two = run(actor(), tech(["concentrated-strike"]), { profile: "blast", advantages: ["concentrated-strike"] }, { targets: [{}, {}] });
  check("and nothing against two", two.bonusCharges, []);
  const ult = run(actor({ threshold: { key: "injured" } }), tech([], { ultimate: true }), { advantages: [] });
  check("an Ultimate: a Charge per Threshold below, and one more over the ceiling",
    [ult.bonusCharges, ult.chargeCeilingBonus], [[{ label: "Ultimate (Thresholds)", amount: 2 }], 1]);
  const terrifier = { ...actor(), items: [{ type: "maneuver", id: "x", system: { maneuverId: "terrify" } }] };
  const terror = run(terrifier, tech(["overwhelming-terror"]), { advantages: ["overwhelming-terror"] },
    { targets: [{ a: 1 }, { b: 2 }], shaken: [{ a: 1 }, { b: 2 }] });
  check("Overwhelming Terror when every target is Shaken", terror.bonusCharges.map(e => e.label), ["Overwhelming Terror"]);
  const noTerrify = run(actor(), tech(["overwhelming-terror"]), { advantages: ["overwhelming-terror"] },
    { targets: [{ a: 1 }], shaken: [{ a: 1 }] });
  check("and switched off for somebody without Terrify", noTerrify.off.map(o => o.id), ["overwhelming-terror"]);
  const boost = run(actor(), tech(["transformation-boost"], { ultimate: true }), { advantages: ["transformation-boost"], transformed: true });
  check("Transformation Boost when asked yes", boost.bonusCharges.map(e => e.label), ["Transformation Boost"]);
  const giga = run(actor(), tech([], { superProfile: "giga-flare" }), { profile: "megaFlare", advantages: [], gigaFlare: 2 });
  check("Giga Flare: 2 Charges an Action", giga.bonusCharges, [{ label: "Giga Flare", amount: 4 }]);
  const max = run(actor(), tech(["maximum-charge"], { ultimate: true }), { advantages: ["maximum-charge"] });
  check("Maximum Charge: +1 Dice Category", max.chargeCategories, 1);
}

// --- Super Profiles ---------------------------------------------------------------------------------
{
  const beam = run(actor(), tech([], { superProfile: "super-beam" }), { advantages: [], charges: 4 });
  check("Super Beam: a Line, +1 Magnitude per 2 Charges, +1 Dice Category",
    [areaLabel(beam.area), beam.chargeCategories], ["Huge Line", 1]);
  const blast = run(actor(), tech([], { superProfile: "super-beam" }), { profile: "blast", advantages: [] });
  check("Super Beam needs Beam: not applied, and said", [blast.superProfile, blast.notes], ["", ["Super Beam: Prerequisite not met"]]);
  const annihilation = run(actor(), tech([], { superProfile: "complete-annihilation" }), { advantages: [], charges: 3 });
  check("Complete Annihilation with 3 Charges: the Damage Attribute again", annihilation.extraDamageAttribute, true);
  const short = run(actor(), tech([], { superProfile: "complete-annihilation" }), { advantages: [], charges: 2 });
  check("and not with 2", short.extraDamageAttribute, false);
  const multi = run(actor(), tech(["hurricane-assault"], { superProfile: "multi-profile", secondProfile: "sweeping" }),
    { profile: "simple", foundation: "physical", advantages: ["hurricane-assault"] });
  check("Multi-Profile: the second Profile counts for Hurricane Assault and brings its Area",
    [multi.off, areaLabel(multi.area)], [[], "Standard Sphere (centred on you)"]);
  check("Karmic: one step against the other side, two against Pure",
    [A.karmicSteps(actor(), { technique: { superProfile: "karmic" } }, { system: { alignment: -1 } }),
     A.karmicSteps(actor(), { technique: { superProfile: "karmic" } }, { system: { alignment: -2 } }),
     A.karmicSteps(actor(), { technique: { superProfile: "karmic" } }, { system: { alignment: 2 } })], [1, 2, 0]);
}

// --- Rows ---------------------------------------------------------------------------------------------
{
  const attack = (features, over = {}) => ({ technique: { features, choices: {}, thresholdsBelow: 0,
    targetsCount: 1, ...over } });
  check("Accurate 2 and Inaccurate on the Strike",
    A.techniqueStrikeParts(actor(), attack(["accurate", "accurate"])).map(p => [p.label, p.value]), [["Accurate 2", 6]]);
  check("Super Advantage doubles Accurate",
    A.techniqueStrikeParts(actor(), attack(["accurate", "super-advantage"], { choices: { "super-advantage": "accurate" } }))
      .map(p => p.value), [6]);
  check("Last Legs: +1(T) per Threshold on Strike and Wound",
    [A.techniqueStrikeParts(actor(), attack(["last-legs"], { thresholdsBelow: 2 }))[0].value,
     A.techniqueWoundParts(actor(), attack(["last-legs"], { thresholdsBelow: 2 }))[0].value], [6, 6]);
  check("Splitting: -1(T) per target after the first",
    A.techniqueWoundParts(actor(), attack(["splitting"], { targetsCount: 3 })).map(p => p.value), [-6]);
  check("Low Penetration 2", A.techniqueWoundParts(actor(), attack(["low-penetration", "low-penetration"]))[0].value, -6);
  check("Powerbomb 2: 1/2 Might each rank",
    A.techniqueWoundParts(actor(), attack(["powerbomb", "powerbomb"], { powerbomb: true })).map(p => p.value), [8]);
  check("Long Shot 2 against a far target, doubled by Super Advantage",
    [A.techniqueStrikeAgainst(actor(), attack(["long-shot", "long-shot"]), { longRange: true }),
     A.techniqueStrikeAgainst(actor(), attack(["long-shot", "long-shot", "super-advantage"], { choices: { "super-advantage": "long-shot" } }), { longRange: true }),
     A.techniqueStrikeAgainst(actor(), attack(["long-shot"]), { longRange: false })], [6, 12, 0]);
  check("Short Range 1: -2(bT) outside Melee Range", A.techniqueStrikeAgainst(actor(), attack(["short-range"]), { outsideMelee: true }), -4);
  check("Trick Attack won: +2(bT)", A.techniqueStrikeAgainst(actor(), attack([]), { tricked: true }), 4);
  check("Condition already on them: +3(T) Wound", A.techniqueWoundAgainst(actor(), attack(["condition"]), { alreadyConditioned: true }), 9);
}

// --- Damage -------------------------------------------------------------------------------------------
{
  const attack = features => ({ foundation: "energy", technique: { features, choices: {}, superProfile: "" } });
  check("Minion Destroyer: the Damage Attribute on a Minion",
    A.techniqueDamageParts(actor(), attack(["minion-destroyer"]), { system: { minion: true } }, 10).map(p => p.value), [8]);
  check("not on somebody else, and not on no Damage",
    [A.techniqueDamageParts(actor(), attack(["minion-destroyer"]), { system: {} }, 10),
     A.techniqueDamageParts(actor(), attack(["minion-destroyer"]), { system: { minion: true } }, 0)], [[], []]);
  check("Shattering Blow 3 on Soak 10: 2+2+2",
    A.techniqueDamageParts(actor(), attack(["shattering-blow", "shattering-blow", "shattering-blow"]),
      { system: { soakValue: 10 } }, 5).map(p => p.value), [6]);
  check("Complete Annihilation: half more on the Undying",
    A.techniqueDamageParts(actor(), { foundation: "energy", technique: { features: [], superProfile: "complete-annihilation" } },
      { system: { states: { undying: 1 } } }, 11).map(p => p.value), [5]);
  check("Low-Power Crush halves the Damage Attribute Minion Destroyer adds",
    A.damageAttributeOf(actor(), { foundation: "energy", technique: { halfDamageAttribute: true } }), 4);
  check("Armor-Piercing: 1/2 Insight, doubled on Pinpoint's Critical",
    [A.armorPiercing(actor(), { technique: { features: ["armor-piercing"] } }),
     A.armorPiercing(actor(), { technique: { features: ["armor-piercing"] } }, { insightDoubled: true })], [3, 7]);
  check("Twin-Linked keeps the higher, Dead-Link the lower",
    [A.linkedPick({ total: 5 }, { total: 9 }, "high").kept.total, A.linkedPick({ total: 5 }, { total: 9 }, "low").kept.total],
    [9, 5]);
}

// --- Wiring ---------------------------------------------------------------------------------------------
const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
check("postAttack carries the block, its Area, its Charges and their Dice Categories",
  ["techniqueAttack(actor, maneuver, { profile, foundation, advantages, weapon, thrown, charges,",
   "area: greedArea(overwhelmedArea(sizedArea(actor, target, technique ? (technique.area ?? (areaAdded ? area : null)) : (area ?? PROFILES[profile]?.area ?? null),", "+ (technique?.chargeCeilingBonus ?? 0)",
   "chargeCategories: reflecting ? (reflecting.chargeCategories ?? 0)",
   "const counts = maneuver.outsideDiminishing ? 0 : (technique?.attacksCounted ?? 1);"].every(bit => CHAT.includes(bit)), true);
check("the Strike and Wound read the rows, Power Burst, Last Legs, Twin/Dead-Link",
  ["...techniqueStrikeParts(attacker, attack),", "attack.technique?.noMusclePenalty ? [] : musclePenalty(attacker)",
   "linked: attack.technique?.linked?.strike", "...techniqueWoundParts(attacker, attack),",
   "linked: attack.technique?.linked?.wound"].every(bit => CHAT.includes(bit)), true);
check("per target: Long Shot, Short Range, Trick Attack, Sky Assault, Condition, Karmic",
  ["techniqueStrikePartsAgainst(attacker, attack,", "{ longRange: atLongRange(attacker, target), outsideMelee: Boolean(whyNotWithinMelee(attacker, target, \"\")),",
   "weapon.ignoresLongRange || skyWaived", "alreadyConditioned: conditionAlreadyOn(attack, target)",
   "+ karmicSteps(attacker, attack, target)"].every(bit => CHAT.includes(bit)), true);
check("the Damage: the Technique's parts, Armor-Piercing, Broken at the hit, Peppering Blows",
  ["const extra = techniqueDamageParts(attacker, attack, target, taken);", "+ armorPiercing(attacker, attack,",
   "const onHit = await techniqueOnHit(attacker, attack, target);",
   "* (attack.technique?.diminishingDefenseTimes ?? 1)"].every(bit => CHAT.includes(bit)), true);
check("every Profile read sees Multi-Profile's second", [CHAT.includes("PROFILES[attack.profile]"),
  CHAT.includes("function profileFor(attack) {")], [false, true]);

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
