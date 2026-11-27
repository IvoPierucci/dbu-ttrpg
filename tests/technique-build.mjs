// Signature Techniques as built: TP, KP, ranks, Requirements, the area, the Energy Charge die.
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
globalThis.foundry.utils.fetchJsonWithTimeout = async () =>
  JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));
globalThis.fetch = async url => {
  const file = path.join(TRAITS, String(url).replace("systems/dbu-ttrpg/traits/", ""));
  if (!fs.existsSync(file)) return { ok: false, status: 404, statusText: "missing" };
  return { ok: true, text: async () => fs.readFileSync(file, "utf8") };
};

const { loadTraits, traitsOfKind } = await import(modUrl("effects/traits.mjs"));
await loadTraits();
const T = await import(modUrl("technique.mjs"));
const { SUPER_PROFILES, PROFILES, areaLabel, finalMagnitude, squaresAway, flatSquaresAway } =
  await import(modUrl("maneuvers.mjs"));

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};
const sig = (over = {}) => ({ level: "super", foundation: "energy", profile: "beam", secondProfile: "",
  superProfile: "", fromTransformation: false, features: [], ...over });
const f = (id, ranks = 1, choice = "") => ({ id, ranks, choice });

// --- The files -------------------------------------------------------------------------------
const adv = traitsOfKind("signature", "advantages");
const dis = traitsOfKind("signature", "disadvantages");
check("every Advantage file loads (65)", adv.length, 65);
check("every Disadvantage file loads (41)", dis.length, 41);
check("every Disadvantage is priced below nothing", dis.every(t => T.featureTP(t, 1) < 0), true);
check("every Advantage above", adv.every(t => T.featureTP(t, 1) > 0), true);
check("every feature carries its summary", [...adv, ...dis].filter(t => !t.summary).map(t => t.id), []);
check("and its printed Requirement", [...adv, ...dis].filter(t => !t.requirement).map(t => t.id), []);
// Every requires: atom is one the reader knows - an unknown one would silently hold.
const KNOWN = /^!?(aoe(:\w+)?|profile-aoe|magnitude<=\w+|profile:\w+|elemental-weather|foundation:\w+|level:(ultimate|super)|has:[\w-]+|ranks:[\w-]+>=\d|same-roll:[\w-]+|chose:[\w-]+=\w+|skill:\w+>=\d|choice-skill>=\d|maneuver:[\w-]+|alignment|threshold:\w+|charges>=\d)$/;
const atoms = [...adv, ...dis].flatMap(t => [].concat(t.requires ?? []).flatMap(term =>
  String(term).split("|").flatMap(alt => alt.split("+").map(a => a.trim()))).filter(Boolean)
  .map(atom => ({ id: t.id, atom })));
check("every Requirement atom is one the reader knows",
  atoms.filter(({ atom }) => !KNOWN.test(atom)).map(({ id, atom }) => `${id}: ${atom}`), []);
// Every has:/ranks:/same-roll: names a feature that exists.
const ids = new Set([...adv, ...dis].map(t => t.id));
check("and every feature a Requirement names exists",
  atoms.map(({ atom }) => atom.replace(/^!/, "").match(/^(?:has|ranks|same-roll|chose):([\w-]+?)(?:>=\d|=\w+)?$/)?.[1])
    .filter(Boolean).filter(id => !ids.has(id)), []);
check("and every Profile it names exists",
  atoms.map(({ atom }) => atom.replace(/^!/, "").match(/^profile:(\w+)$/)?.[1]).filter(Boolean)
    .filter(id => !PROFILES[id]), []);

// --- TP -----------------------------------------------------------------------------------------
check("a bare Technique is 8 TP", T.techniqueTP(sig()), 8);
check("ranks add up: Power Shot 3 is 4+6+8", T.featureTP(T.featureDef("power-shot"), 3), 18);
check("Terrain Destruction 2 is 3+5", T.featureTP(T.featureDef("terrain-destruction"), 2), 8);
check("Backlash 5 is -2-3-3-3-3", T.featureTP(T.featureDef("backlash"), 5), -14);
check("never more ranks than priced", T.featureTP(T.featureDef("power-shot"), 9), 18);
check("8 + Power Shot 2 (10) = 18", T.techniqueTP(sig({ features: [f("power-shot", 2)] })), 18);
check("Disadvantages cannot take it under 8",
  T.techniqueTP(sig({ features: [f("stat-drain", 3)] })), 8);
check("an Ultimate adds 4 after the floor",
  T.techniqueTP(sig({ level: "ultimate", features: [f("stat-drain", 3)] })), 12);
check("a Dramatic Finisher is an Ultimate", T.techniqueTP(sig({ level: "dramatic" })), 12);
check("the Tier caps", [1, 2, 3, 4, 7].map(T.tierTpCap), [25, 30, 40, 50, 50]);

// Simple: "Reduce the starting TP Cost of a Signature Technique made with this Profile from 8 to 4" -
// its floor too, specific over general (the user's ruling).
check("a bare Simple Technique is 4 TP", T.techniqueTP(sig({ profile: "simple" })), 4);
check("its Advantages count from 4", T.techniqueTP(sig({ profile: "simple", features: [f("power-shot", 2)] })), 14);
check("its Disadvantages cannot take it under 4",
  T.techniqueTP(sig({ profile: "simple", features: [f("stat-drain", 3)] })), 4);
check("an Ultimate still adds 4 after", T.techniqueTP(sig({ profile: "simple", level: "ultimate" })), 8);
check("and its KP follows its TP", T.techniqueKiPerTier(sig({ profile: "simple" })), 1);
check("every other Profile starts at 8", [T.techniqueStartTP(sig({ profile: "beam" })), T.techniqueStartTP(sig({ profile: "" }))],
  [8, 8]);

// Free TP: Power Level 1's "20 TP to spend on one Signature Technique". Less taken from the
// character; the Technique's own TP, and so its KP, unchanged (the user's ruling).
{
  const shot = sig({ features: [f("power-shot", 3)], freeTP: 20 });
  check("Free TP comes off what the character pays", [T.techniqueTP(shot), T.techniqueTPCharged(shot)], [26, 6]);
  check("never below nothing", T.techniqueTPCharged(sig({ freeTP: 20 })), 0);
  check("and the KP is the Technique's full TP's",
    T.techniqueKiPerTier(shot), T.techniqueKiPerTier(sig({ features: [f("power-shot", 3)] })));
  check("read off the Item, whole numbers, never negative",
    [T.signatureOf({ system: { signature: { freeTP: 7.6 } } }).freeTP,
     T.signatureOf({ system: { signature: { freeTP: -3 } } }).freeTP,
     T.signatureOf({ system: { signature: {} } }).freeTP], [7, 0, 0]);
  const SHEET = fs.readFileSync(path.join(ROOT, "module", "sheets", "actor-character-sheet.mjs"), "utf8");
  check("the character's TP spent counts what they paid",
    SHEET.includes("const spent = built.reduce((sum, sig) => sum + techniqueTPChargedOf(sig, this.actor.system.effects?.slots), 0);"), true);
  const CREATION = fs.readFileSync(path.join(ROOT, "templates", "parts", "technique-creation.hbs"), "utf8");
  check("a Free TP field on Sig Creation", CREATION.includes('name="system.signature.freeTP"'), true);
  const MODEL = fs.readFileSync(path.join(ROOT, "module", "data", "item-maneuver.mjs"), "utf8");
  check("stored on the Technique", MODEL.includes("freeTP: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),"),
    true);
}

// --- KP -----------------------------------------------------------------------------------------
check("KP: ceil(8/5) = 2(T) over the Profile", T.techniqueKiPerTier(sig()), 2);
check("17 TP is ceil(3.4) = 4(T)",
  T.techniqueKiPerTier(sig({ level: "ultimate", features: [f("full-wager"), f("all-or-nothing")] })), 4);
check("Efficiency takes 4(T) a rank, never below the Profile",
  T.techniqueKiPerTier(sig({ features: [f("efficiency", 2)] })), 0);
check("Efficiency 1 on 16 TP: ceil(3.2)=4 - 4 = 0",
  T.techniqueKiPerTier(sig({ features: [f("efficiency", 1)] })), 0);
check("Inefficiency puts 4(T) a rank on",
  T.techniqueKiPerTier(sig({ features: [f("inefficiency", 1)] })), 6);
check("a Super Profile's cost is added on top of the floor",
  T.techniqueKiPerTier(sig({ level: "dramatic", superProfile: "super-beam", features: [f("efficiency", 2)] })), 2);
check("Multi-Profile's price follows the other Profile: Simple (<=4) 1(T)",
  T.superProfileKiPerTier("multi-profile", "simple"), 1);
check("... Beam (8) 3(T)", T.superProfileKiPerTier("multi-profile", "beam"), 3);
check("... a 6(T) Profile 2(T)", T.superProfileKiPerTier("multi-profile",
  Object.keys(PROFILES).find(id => PROFILES[id].kiCostPerTier === 6)), 2);

// --- Requirements ---------------------------------------------------------------------------------
const problem = (id, s, o) => T.featureProblem(id, s, o);
check("Hurricane Assault needs Sweeping", [problem("hurricane-assault", sig({ profile: "sweeping", foundation: "physical" })),
  Boolean(problem("hurricane-assault", sig()))], ["", true]);
check("Splitting: Energy, no AoE", [problem("splitting", sig()), Boolean(problem("splitting", sig({ profile: "blast" })))],
  ["", true]);
check("Widespread needs no AoE from the Profile - and does not refuse itself",
  [problem("widespread-assault", sig({ features: [f("widespread-assault", 1, "cone")] })),
   Boolean(problem("widespread-assault", sig({ profile: "blast" })))], ["", true]);
check("once Widespread gives a Cone, Controlled Blast holds",
  problem("controlled-blast", sig({ features: [f("widespread-assault", 1, "cone"), f("controlled-blast")] })), "");
check("Pinpoint Precision: Standard holds, Large does not",
  [problem("pinpoint-precision", sig({ profile: "blast" })),
   Boolean(problem("pinpoint-precision", sig({ profile: "blast", features: [f("terrain-destruction", 1)] })))],
  ["", true]);
check("Power Shot and Low Penetration exclude each other",
  [Boolean(problem("power-shot", sig({ features: [f("low-penetration")] }))),
   Boolean(problem("low-penetration", sig({ features: [f("power-shot")] })))], [true, true]);
check("Twin-Linked and Dead-Link only clash on the same roll",
  [Boolean(problem("dead-link", sig({ features: [f("twin-linked", 1, "strike"), f("dead-link", 1, "strike")] }))),
   problem("dead-link", sig({ features: [f("twin-linked", 1, "strike"), f("dead-link", 1, "wound")] }))],
  [true, ""]);
check("Maximum Charge needs an Ultimate",
  [Boolean(problem("maximum-charge", sig())), problem("maximum-charge", sig({ level: "dramatic" }))], [true, ""]);
check("Back Flip: Hit and Run and a ranged attack, or Physical with Charging Assault",
  [problem("back-flip", sig({ features: [f("hit-and-run")] })),
   Boolean(problem("back-flip", sig({ profile: "simple", foundation: "physical", features: [f("hit-and-run")] }))),
   problem("back-flip", sig({ profile: "simple", foundation: "physical", features: [f("hit-and-run"), f("charging-assault")] }))],
  ["", true, ""]);
check("Deadly Drop wants Restricted - Environment with High",
  [Boolean(problem("deadly-drop", sig({ profile: "simple", foundation: "physical",
    features: [f("grappling"), f("restricted-environment", 1, "lava-environment")] }))),
   problem("deadly-drop", sig({ profile: "simple", foundation: "physical",
    features: [f("grappling"), f("restricted-environment", 1, "high")] }))], [true, ""]);
check("Hostile Chase needs 2 ranks of Homing",
  [Boolean(problem("hostile-chase", sig({ features: [f("homing", 1)] }))),
   problem("hostile-chase", sig({ features: [f("homing", 2)] }))], [true, ""]);
check("Weather Calling needs an Elemental Profile with a Connected Weather",
  [problem("weather-calling", sig({ profile: "elementalFire", foundation: "magic" })),
   Boolean(problem("weather-calling", sig({ profile: "elementalPlantlife", foundation: "magic" })))], ["", true]);
const bluffer = ranks => ({ system: { skills: { bluff: { ranks }, acrobatics: { ranks: 0 } } }, items: [] });
check("Fake Out reads the character's Bluff Ranks",
  [problem("fake-out", sig(), { actor: bluffer(2) }), Boolean(problem("fake-out", sig(), { actor: bluffer(1) }))],
  ["", true]);
check("with no character to ask, a character Requirement does not refuse", problem("fake-out", sig()), "");
check("Multi-Profile's second Profile counts for a Requirement",
  problem("hurricane-assault", sig({ level: "dramatic", superProfile: "multi-profile", secondProfile: "sweeping" })), "");

// --- Super Profiles -----------------------------------------------------------------------------
check("eleven Super Profiles", Object.keys(SUPER_PROFILES).length, 11);
check("each carries its entry's text", Object.values(SUPER_PROFILES).every(s => s.text.includes(s.label)), true);
check("Super Beam's Prerequisite: Beam",
  [T.superProfileProblem("super-beam", sig()), Boolean(T.superProfileProblem("super-beam", sig({ profile: "blast" })))],
  ["", true]);
check("Complete Annihilation reads the Charges on the attack",
  [Boolean(T.superProfileProblem("complete-annihilation", sig(), { charges: 2 })),
   T.superProfileProblem("complete-annihilation", sig(), { charges: 3 })], [true, ""]);
check("Genki does not refuse while Energy Gathering does not exist",
  T.superProfileProblem("genki", sig()), "");

// --- The area -----------------------------------------------------------------------------------
const area = o => T.buildArea(o).area;
check("Blast: a Standard Cone", areaLabel(area({ profiles: ["blast"] })), "Standard Cone");
check("Sweeping + Hurricane: a Standard Sphere, centred on you",
  areaLabel(area({ profiles: ["sweeping"], features: ["hurricane-assault"] })), "Standard Sphere (centred on you)");
check("Terrain Destruction 2 and a Weapon's step: Standard -> Destructive at most",
  finalMagnitude(area({ profiles: ["blast"], features: ["terrain-destruction", "terrain-destruction"], weaponSteps: 3 })),
  "destructive");
check("Small Scale Blast makes it Minor, a Weapon's step lands on top",
  finalMagnitude(area({ profiles: ["clearing"], features: ["small-scale-blast"], weaponSteps: 1 })), "standard");
check("Widespread: a Sphere on any Square",
  areaLabel(area({ profiles: ["beam"], features: ["widespread-assault"], choices: { "widespread-assault": "sphere" } })),
  "Standard Sphere (any Square)");
check("Self-Explosion centres it on you",
  areaLabel(area({ profiles: ["clearing"], features: ["self-explosion"] })), "Standard Sphere (centred on you)");
check("Super Beam: a Line, +1 Magnitude per 2 Charges",
  areaLabel(area({ profiles: ["beam"], superProfile: "super-beam", charges: 5 })), "Huge Line");
check("Concentrated holds its Line at Standard",
  areaLabel(area({ profiles: ["concentrated"], features: ["terrain-destruction"] })), "Standard Line");
check("Limited Line 2: 4 Squares", areaLabel(area({ profiles: ["wave"], features: ["limited-line", "limited-line"] })),
  "Standard Line (4 Squares)");
check("Cataclysmic: the whole Battlefield, Magnitude untouched",
  areaLabel(area({ profiles: ["blast"], superProfile: "cataclysmic-attack" })), "Standard Cone - entire Battlefield");
check("no Area without one", area({ profiles: ["beam"] }), null);

// --- Height and the Energy Charge die ----------------------------------------------------------
const at = (x, rank) => ({ system: { battlefield: { highEnvironment: rank } },
  getActiveTokens: () => [{ x: x * 100, y: 0, width: 1, height: 1, parent: { id: "s", grid: { size: 100 } } }] });
check("flat distance", flatSquaresAway(at(0, 0), at(2, 0)), 2);
check("each rank of height is 8 Squares more", squaresAway(at(0, 0), at(2, 1)), 10);
const { categoryFormula } = await import(modUrl("dice.mjs"));
check("an Energy Charge: d6 (2), a Technique d8, Maximum Charge d10, one more 1d10+1d4",
  [2, 3, 4, 5].map(categoryFormula), ["1d6", "1d8", "1d10", "1d10+1d4"]);
const ACTOR = fs.readFileSync(path.join(ROOT, "module", "data", "actor-character.mjs"), "utf8");
check("and the Energy Charge die is that Category, Charged Up and the extras added",
  [ACTOR.includes("return categoryFormula(DBUCharacterData.energyChargeCategory(signature, extraCategories));"),
   ACTOR.includes("static ENERGY_CHARGE_CATEGORY = 2;"),
   ACTOR.includes("DBUCharacterData.ENERGY_CHARGE_CATEGORY + (signature ? 1 : 0)")], [true, true, true]);
const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
check("and a charge's dice past d10 are each multiplied",
  CHAT.includes("return `${(Number(count) || 1) * times}d${faces}`;"), true);

// --- A feature's TP Cost written over (the user's, 2026-11-16: as a Unique Ability's TP Cost Change; Favored Technique's at 0) ---
{
  check("written over: Trick Attack at 0 and Power Shot 2 at 3 - 8 + 0 + 3; blank (null) costs what it lists; kept through signatureOf, blank or not a number dropped",
    [T.techniqueTP(sig({ features: [{ ...f("trick-attack", 1, "bluff"), tpCost: 0 }, { ...f("power-shot", 2), tpCost: 3 }] })),
     T.featureEntryTP({ ...f("power-shot", 2), tpCost: null }), T.featureEntryTP(f("power-shot", 2)),
     T.signatureOf({ system: { signature: { features: [{ id: "trick-attack", ranks: 1, choice: "", tpCost: 0 }, { id: "power-shot", ranks: 2, choice: "", tpCost: null },
       { id: "boom", ranks: 1, choice: "", tpCost: "" }] } } }).features.map(entry => entry.tpCost)],
    [11, 10, 10, [0, undefined, undefined]]);
  const HB = fs.readFileSync(path.join(ROOT, "templates", "parts", "technique-features.hbs"), "utf8");
  const SHEET = fs.readFileSync(path.join(ROOT, "module", "sheets", "item-maneuver-sheet.mjs"), "utf8");
  const DATA = fs.readFileSync(path.join(ROOT, "module", "data", "item-maneuver.mjs"), "utf8");
  check("the box between its TP and its cross, blank showing what it lists; Favored Technique's Advantage on the list, no TP, no box nor cross; the field kept on the entry",
    [HB.includes('data-feature-tp="{{row.index}}" value="{{row.tpCost}}" placeholder="{{row.listedTp}}"'), HB.includes("{{#if row.given}}"),
     SHEET.includes('const tpCost = (written === "") || !Number.isFinite(Number(written)) ? null : Math.trunc(Number(written));'),
     fs.readFileSync(path.join(ROOT, "module", "technique.mjs"), "utf8").includes('given: "Favored Technique"'), DATA.includes("tpCost: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null })")],
    [true, true, true, true, true]);

  // Favored Technique (2)'s Efficiency, on the build: its KP 4(T) off, no TP; the stored list written without it.
  const talent = { type: "talent", flags: { "dbu-ttrpg": { sourceId: "favored-technique" } }, system: { chosen: [
    { key: "favored-technique", value: "T1" }, { key: "favored-technique#2", value: "efficiency" }] } };
  const item = id => ({ id, parent: { items: [talent] }, system: { signature: { level: "super", foundation: "energy", profile: "beam",
    features: [{ id: "power-shot", ranks: 3, choice: "" }] } } });
  const favored = T.signatureOf(item("T1")), other = T.signatureOf(item("T2"));
  check("Favored Technique's Efficiency on its build: given, no TP, its KP 4(T) off - not on another Technique",
    [favored.features.map(entry => [entry.id, entry.given ?? "", entry.tpCost ?? null]), T.techniqueTP(favored), T.techniqueTP(other),
     T.techniqueKiPerTier(other) - T.techniqueKiPerTier(favored), SHEET.includes(".filter(entry => !entry.given).map(({ given, ...entry }) => entry)")],
    [[["power-shot", "", null], ["efficiency", "Favored Technique", 0]], 26, 26, 4, true]);
}

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
