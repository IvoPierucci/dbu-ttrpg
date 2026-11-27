/**
 * A Resource you are holding says so on the sheet.
 *
 * The other half of the bug that was fixed last version. `system.resources` was written
 * by nobody, and once it was written it was still read by nothing a player could see:
 * the stacks of Power raised your Combat Rolls and your Max Capacity, ran out on their
 * own clocks, and never appeared anywhere on the character sheet.
 *
 * So this checks the whole chain rather than the row: what the library declares, what
 * the sheet builds out of it, and that the template reads every field the sheet builds.
 * That last one is the check with teeth - "declared in one place and read in none" is
 * the shape of every one of these bugs so far.
 */

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
globalThis.foundry.data = { ...await import(appUrl("common/data/_module.mjs")) };
globalThis.foundry.data.operators = { ForcedReplacement: { create: value => value } };
const { default: DataModel } = await import(appUrl("common/abstract/data.mjs"));
globalThis.foundry.abstract = { DataModel, TypeDataModel: DataModel };
globalThis.ui = { notifications: { warn: () => {}, error: () => {}, info: () => {} } };
globalThis.game = { combat: null };

const TRAITS = path.join(ROOT, "traits");
globalThis.foundry.utils.fetchJsonWithTimeout = async () =>
  JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));
globalThis.fetch = async url => {
  const file = path.join(TRAITS, String(url).replace("systems/dbu-ttrpg/traits/", ""));
  if (!fs.existsSync(file)) return { ok: false, status: 404, statusText: "missing" };
  return { ok: true, status: 200, text: async () => fs.readFileSync(file, "utf8") };
};

const { loadTraits, resourceLimits, resourceDefinitions, resourceCeiling, getTrait } =
  await import(modUrl("effects/traits.mjs"));
const { EDGES, KINDS } = await import(modUrl("durations.mjs"));
await loadTraits();

const SHEET = fs.readFileSync(
  path.join(ROOT, "module", "sheets", "actor-character-sheet.mjs"), "utf8");
const COMBAT = fs.readFileSync(
  path.join(ROOT, "templates", "parts", "actor-combat.hbs"), "utf8");

// The sheet's builders, cut out and run, so what is checked is what they build.
const from = SHEET.indexOf("function resourceRows(");
const to = SHEET.indexOf("export default class DBUCharacterSheet");
const built = new Function("resourceDefinitions", "resourceCeiling", "KINDS", "EDGES", "getTrait", "signatureOfTechnique",
  "featureDefOf", `${SHEET.slice(from, to)}\nreturn { resourceRows, clockNotes, stackRows, traitsOwned };`);
const { resourceRows, stackRows, traitsOwned } =
  built(resourceDefinitions, resourceCeiling, KINDS, EDGES, getTrait, () => ({ features: [] }), () => null);
// What a character holds, of the rows: the rest are what they could come to have (the Manage window's).
const held = rows => rows.filter(row => row.stacks > 0);

/** The Traits a character carries, as the sheet reads them off their Maneuver Items. */
const owning = (...ids) => new Set(ids);

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

const MIDDOT = "\u00b7";

// --- What the library declares ------------------------------------------------------------
{
  const declared = resourceDefinitions();

  // A ceiling is a number the file states, or a value about the character where the rule
  // states that instead: "the maximum you can possess is equal to your base Tier of Power".
  // Every Resource has one of the two, and none has neither.
  // But one whose rule names no most: Comfortable Count's Comfort.
  check("every Resource in the library is bounded - but Comfort, Demonic Power and Fatigue, Armory Points, whose rules name no most",
    Object.entries(declared).filter(([name]) => !["comfort", "demonicpower", "demonicfatigue", "armory", "swagger", "lightstacks", "grudge"].includes(name))
      .every(([, d]) => (d.max > 0) || d.maxFrom || d.maxOf), true);
  // Greed of the Hera's Greed: Power's ceiling, whatever it is.
  check("and one by another Resource's - Greed by Power's", [declared.greed?.maxOf,
    resourceCeiling(declared.greed, { system: {} }), resourceCeiling(declared.greed,
      { system: { effects: { slots: { "power.max": { add: 1 } } } } })], ["power", 2, 3]);
  check("three of them by something about the character - Lifeforce's three times it, Evil Points ten times the base Tier (Power of Evil)",
    Object.fromEntries(Object.entries(declared).filter(([, d]) => d.maxFrom)
      .map(([name, d]) => [name, `${d.maxFrom} x${d.maxTimes}`])),
    { holdingback: "baseTierOfPower x1", lifeforce: "skills.clairvoyance.ranks x3", evilpoints: "baseTierOfPower x10" });

  const tiered = { system: { baseTierOfPower: 3 } };
  const ceilings = Object.fromEntries(Object.entries(declared)
    .map(([name, d]) => [name, resourceCeiling(d, tiered)]));

  // The old function is the new one narrowed, so the runtime that caps a Resource and the
  // sheet that shows it can never be looking at different ceilings.
  check("and the ceilings the runtime caps against are those ones",
    resourceLimits(tiered), ceilings);
  check("which for that one is the character's own base Tier of Power",
    ceilings.holdingback, 3);
  check("and follows it as they grow",
    [resourceCeiling(declared.holdingback, { system: { baseTierOfPower: 1 } }),
     resourceCeiling(declared.holdingback, { system: { baseTierOfPower: 5 } })],
    [1, 5]);
  check("with no character to ask, it is unbounded rather than bounded at nothing",
    resourceCeiling(declared.holdingback, null), 0);
  check("and a Resource the file gives a number is that number, character or not",
    [resourceCeiling(declared.power, tiered), resourceCeiling(declared.power, null)],
    [2, 2]);

  // Each named with what declared it, so a Resource that loses its file is noticed. The
  // list grows with the library, which is why what is checked is the pairing rather than
  // a count - a check that fails for being out of date teaches nobody anything.
  // A Transformation's own Resources (Combat Imprinting's Progress, Super Weapon's Reserved Energy) checked in transformations.mjs.
  const outside = Object.fromEntries(Object.entries(declared).filter(([, d]) => !getTrait(d.id)?.transformation));
  check("each says which Trait declared it",
    Object.fromEntries(Object.entries(outside).map(([name, d]) => [name, d.source])),
    { arrogance: "Arrogant Declaration", blockaded: "Blockade", lifemodifier: "Savagery", adaptation: "Artificial Warrior", spite: "Need for Revenge", focusfatigue: "Nice Shooting", comfort: "Comfortable Count", overwhelm: "Overwhelming Fighter", criticaleye: "Evolved Right Eye", demonicpower: "Demonic Pressure", demonicfatigue: "Demonic Pressure", greed: "Greed of the Hera", tension: "Battle Tension", revengepoints: "Energy of Revenge", negativeenergy: "Negative Ki", dragonslime: "Regenerative Dragon", heroicstyle: "Heroic Style", calculatingstyle: "Calculating Style",
      battlebornstrike: "Born for Battle", battleborndodge: "Born for Battle", battlebornwound: "Born for Battle", warriorsblood: "Blood of the Warrior", quicksleep: "Quick Sleep",
      recovery: "Combat Recovery", holdingback: "Holding Back", rapid: "Movement",
      power: "Power Up", anitem: "Transfiguration", inheritedtension: "Konatsian-Raised", grudge: "Tuffle-Raised", battlecreation: "Saiyan Genes", evenrounds: "Genetic Focus: Saiyan", warriorblood: "Dormant Saiya Power", patience: "Reserved Combatant", armory: "Technique Armory", concentratedki: "Concentrated Energy", swagger: "Swaggering Wager", humbled: "Arrogance", reservedforce: "Reserved Tail", riskaversion: "Hedge Your Bets", sunlight: "Arboreal", bloodlust: "Bloodlust", lightstacks: "Light Consumption", plate: "Petrification Plating", dauntless: "Dauntless", biofusion: "Bio-Fusion", maximetamorese: "Maximum Metamorese", unfamiliar: "Body Change", lifeforce: "Energy Gathering",
      finisher: "Finish Sign" });
  check("and every one of them names a Trait that exists",
    Object.values(declared).every(d => d.source), true);

  // "Power is a Resource", says the entry - so the key names it and nothing is needed.
  // "rapid" names nothing, so its file says what to call it.
  check("a Resource its key does not name is named by its file",
    [declared.power.label, declared.rapid.label, declared.recovery.label,
     declared.arrogance.label, declared.blockaded.label, declared.holdingback.label],
    ["Power", "Rapid Movement", "Recovery", "Arrogance", "Blockaded", "Holding Back"]);
}

// --- The rows the sheet builds ---------------------------------------------------------------
{
  check("holding nothing is no rows held", held(resourceRows({ resources: {}, timed: [] })), []);
  check("and a character with no bag at all holds none either", held(resourceRows({})), []);
  // Power is everybody's through Power Up, and Unfamiliar anybody's, since an Opponent inflicts it (the user's).
  check("but Power and Unfamiliar are anybody's to have",
    resourceRows({ resources: {}, timed: [] }).map(r => r.name), ["Power", "Unfamiliar"]);

  // The runtime deletes a Resource at nothing rather than leaving a zero, but a zero left
  // by anything else is still not a Resource anybody has.
  check("a zero is not a Resource you have",
    held(resourceRows({ resources: { power: { stacks: 0, max: 2 } }, timed: [] })), []);

  const one = resourceRows({
    resources: { power: { stacks: 2, max: 2 } },
    timed: [{ kind: "resource", key: "power", edge: "end", edges: 2, source: "power" }]
  });
  check("holding Power is a row that says so",
    held(one).map(r => [r.name, r.stacks, r.max]), [["Power", 2, 2]]);
  check("and the row names where it came from",
    one[0].tooltip.startsWith("From Power Up."), true);

  // The file is where the rule lives. A character carrying an older copy of the ceiling
  // should not go on being measured against that one.
  check("the file's ceiling wins over the one written on the character",
    resourceRows({ resources: { power: { stacks: 1, max: 9 } }, timed: [] })[0].max, 2);

  // Only the ones the rules name. Recovery, Rapid Movement, Arrogance and Blockaded are
  // this system's own bookkeeping - they are held as Resources because that is what takes
  // a clock here, and the rulebook calls exactly one thing a Resource.
  check("the bookkeeping ones are not shown",
    resourceRows({
      resources: {
        recovery: { stacks: 2, max: 3 },
        power: { stacks: 1, max: 2 },
        arrogance: { stacks: 1, max: 1 },
        rapid: { stacks: 1, max: 1 },
        blockaded: { stacks: 1, max: 1 }
      },
      timed: []
    }).map(r => r.name),
    ["Power", "Unfamiliar"]);

  check("and the library says which are which",
    Object.fromEntries(Object.entries(resourceDefinitions()).filter(([, d]) => !getTrait(d.id)?.transformation)
      .map(([name, d]) => [name, Boolean(d.internal)])),
    { arrogance: true, blockaded: true, lifemodifier: false, adaptation: false, spite: false, focusfatigue: false, comfort: false, overwhelm: false, criticaleye: false, demonicpower: false, demonicfatigue: false, greed: false, tension: false, revengepoints: false, negativeenergy: false, dragonslime: false, heroicstyle: true, calculatingstyle: true, battlebornstrike: false, battleborndodge: false, battlebornwound: false, warriorsblood: true, quicksleep: true,
      recovery: true, holdingback: false, rapid: true,
      power: false, anitem: true, inheritedtension: false, grudge: false, battlecreation: false, evenrounds: true, warriorblood: false, patience: false, armory: false, concentratedki: false, swagger: false, humbled: false, reservedforce: false, riskaversion: false, sunlight: false, bloodlust: false, lightstacks: false, plate: false, dauntless: true, biofusion: true, maximetamorese: true, unfamiliar: false, lifeforce: false, finisher: false });

  check("rows come out in name order",
    resourceRows({
      resources: {
        zenkai: { stacks: 1, max: 0 },
        power: { stacks: 1, max: 2 },
        ember: { stacks: 1, max: 0 }
      },
      timed: []
    }).map(r => r.name),
    ["Ember", "Power", "Unfamiliar", "Zenkai"]);

  // A Resource nothing in the library declares still shows, rather than being dropped for
  // not being recognised: it is on the character, so the character has it.
  const stray = resourceRows({ resources: { ember: { stacks: 3, max: 0 } }, timed: [] });
  check("a Resource no file declares is still shown",
    held(stray).map(r => [r.name, r.stacks, r.max]), [["Ember", 3, 0]]);
}

// --- A Resource you can get is on the list at nothing -------------------------------------------
{
  // Everybody has the Power Up Maneuver, so everybody can hold Power. A row that appeared
  // only once you had some could never tell you the Resource was there - which is the
  // whole reason the two checklists above this one list what you could have.
  const none = { resources: {}, timed: [] };

  check("holding no Power but having the Maneuver is still a row",
    resourceRows(none, owning("power-up")).map(r => [r.name, r.stacks, r.max]),
    [["Power", 0, 2], ["Unfamiliar", 0, 3]]);

  check("and the row still says where it comes from",
    resourceRows(none, owning("power-up"))[0].tooltip.startsWith("From Power Up."), true);

  // Nothing to say about a clock that is not running.
  check("with nothing claimed about when it leaves",
    resourceRows(none, owning("power-up"))[0].note, "");

  // Power is everybody's, the Maneuver on the character or not (the user's) - and nothing else is theirs without its Trait.
  check("Power is there without the Maneuver too",
    resourceRows(none, owning("basic-attack")).map(r => r.name), ["Power", "Unfamiliar"]);
  check("and with no answer at all", resourceRows(none).map(r => r.name), ["Power", "Unfamiliar"]);

  // Whatever kind of Trait declares it (the user's): a Racial Trait's once the Trait is carried.
  check("a Racial Trait's Resources once the Trait is carried",
    resourceRows(none, owning("demonic-pressure")).map(r => r.name),
    ["Demonic Fatigue", "Demonic Power", "Power", "Unfamiliar"]);
  // A Special Maneuver's once a Skill has opened it - Holding Back at 2 Ranks of Concealment (the user's).
  check("Holding Back not while no Skill has opened it",
    resourceRows({ ...none, specialManeuvers: [{ maneuver: "holding-back", open: false }] }, owning("holding-back"))
      .map(r => r.name).includes("Holding Back"), false);
  check("and once one has",
    resourceRows({ ...none, specialManeuvers: [{ maneuver: "holding-back", open: true }] })
      .map(r => r.name).includes("Holding Back"), true);
  check("each saying what gives it - not Power, everybody's",
    resourceRows(none, owning("demonic-pressure")).map(r => r.source),
    ["from Demonic Pressure", "from Demonic Pressure", "", "can be inflicted on you"]);

  // Having it and holding some is one row, not two.
  check("having the Maneuver and holding stacks is one row",
    resourceRows({ resources: { power: { stacks: 2, max: 2 } }, timed: [] },
      owning("power-up")).map(r => [r.name, r.stacks]),
    [["Power", 2], ["Unfamiliar", 0]]);

  // The bookkeeping ones stay off it however they are reached: owning the Maneuver that
  // declares one is not a reason to name a word the rulebook does not use.
  check("owning Combat Recovery does not put Recovery on the list",
    resourceRows(none, owning("combat-recovery", "movement", "blockade",
      "arrogant-declaration")).map(r => r.name), ["Power", "Unfamiliar"]);

  // And it reaches the section through stackRows, behind the three that are always there.
  check("the section shows it behind the three that are always there",
    stackRows(none, owning("power-up")).map(row => row.name),
    ["Diminishing Offense", "Diminishing Defense", "Power", "Unfamiliar"]);

  // The sheet reads the ids off the Maneuver Items, and a Maneuver built by hand has
  // none - which is right, since one somebody wrote declares no Resource.
  const actor = { items: [
    { type: "maneuver", system: { maneuverId: "power-up" } },
    { type: "maneuver", system: { maneuverId: "" } },
    { type: "talent", system: { maneuverId: "power-up" } }
  ] };
  check("the ids come off the Maneuver Items", [...traitsOwned(actor)], ["power-up"]);
  // And off every other kind (the user's): a Racial Trait or a Talent by its source, a Gear Item by its own.
  check("and off a Racial Trait, a Talent and a Gear Item",
    [...traitsOwned({ items: [{ type: "racial", system: {}, flags: { "dbu-ttrpg": { sourceId: "demonic-pressure" } } },
      { type: "talent", system: {}, flags: { "dbu-ttrpg": { sourceId: "swaggering-wager" } } },
      { type: "gear", system: { gearId: "sake-bottle" } }] })],
    ["demonic-pressure", "swaggering-wager", "sake-bottle"]);
  // A real actor's Items are a Foundry Collection - a Map iterating its values, with no flatMap (the user's sheet threw
  // "actor.items.flatMap is not a function" when this was tested on arrays alone).
  class Collection extends Map { [Symbol.iterator]() { return this.values(); } }
  const collected = new Collection([["a", { type: "maneuver", system: { maneuverId: "power-up" } }],
    ["b", { type: "racial", system: {}, flags: { "dbu-ttrpg": { sourceId: "demonic-pressure" } } }]]);
  let thrown = "";
  try { traitsOwned({ items: collected }); } catch (error) { thrown = error.message; }
  check("and off a Foundry Collection, which has no flatMap", thrown || [...traitsOwned({ items: collected })],
    ["power-up", "demonic-pressure"]);
}

// --- What a character's Traits say, by name (the Combat tab's "from ...") ---------------------------------------------
{
  const SHEET_TEXT = SHEET;
  const owf = SHEET_TEXT.indexOf("function ownWords(actor) {");
  // Whether a Trait is on them, and a Special Maneuver opened, as the real ones say - here by the lists given.
  const held = new Set();
  const opened = new Set();
  const ownWords = new Function("getTrait", "signatureOfTechnique", "featureDefOf", "traitActive", "whyNotSpecial",
    `${SHEET_TEXT.slice(owf, SHEET_TEXT.indexOf("\n}\n", owf) + 2)}\nreturn ownWords;`)(getTrait, () => ({ features: [] }), () => null,
    (actor, id) => held.has(id), (actor, maneuver) => ((maneuver?.special && !opened.has(maneuver.id)) ? "closed" : null));
  const maneuver = (name, id) => ({ type: "maneuver", name, system: { maneuverId: id } });
  // A Racial Trait's effect kept as a Maneuver of its own is named by its Trait (the user's: "3rd effect of Majin
  // Regeneration" said nothing); a Maneuver of its own keeps its name.
  held.add("majin-regeneration");
  opened.add("liquid-form");
  check("an effect kept as a Maneuver is named by the Trait it is an effect of",
    ownWords({ items: [maneuver("3rd effect of Majin Regeneration", "majin-regeneration-third-effect"), maneuver("Liquid Form", "liquid-form")] })
      .map(entry => entry.name),
    ["Majin Regeneration", "Liquid Form"]);
  // The user's Majin with Dangerous Liquid alone: the Maneuvers every character carries name nothing they have - a Trait's own
  // effect while that Trait is not on them (Minion Coordinator's), a Special Maneuver nothing opened.
  held.clear();
  opened.clear();
  check("not theirs to use, not named: a Trait's Maneuver without the Trait, a Special Maneuver not opened; a Core one still is",
    ownWords({ items: [maneuver("3rd effect of Majin Regeneration", "majin-regeneration-third-effect"),
      maneuver("Minion Coordinator", "minion-coordinator-second-effect"), maneuver("Liquid Form", "liquid-form"), maneuver("Empower", "empower")] })
      .map(entry => entry.name),
    ["Empower"]);
}

// --- The clocks, counted rather than summed -------------------------------------------------
{
  // Two stacks taken a turn apart leave a turn apart. A row saying only "2" would hide
  // the half of it that matters next turn.
  const apart = resourceRows({
    resources: { power: { stacks: 2, max: 2 } },
    timed: [
      { kind: "resource", key: "power", edge: "end", edges: 1, source: "power" },
      { kind: "resource", key: "power", edge: "end", edges: 2, source: "power" }
    ]
  });
  check("stacks on different clocks are said separately", apart[0].note,
    `1 at the end of your turn ${MIDDOT} 1 at the end of your next turn`);

  const together = resourceRows({
    resources: { power: { stacks: 2, max: 2 } },
    timed: [
      { kind: "resource", key: "power", edge: "end", edges: 1, source: "power" },
      { kind: "resource", key: "power", edge: "end", edges: 1, source: "power" }
    ]
  });
  check("stacks on the same clock are counted together", together[0].note,
    "2 at the end of your turn");

  check("a start edge says start",
    resourceRows({
      resources: { power: { stacks: 2, max: 2 } },
      timed: [
        { kind: "resource", key: "power", edge: "start", edges: 1, source: "power" },
        { kind: "resource", key: "power", edge: "start", edges: 1, source: "power" }
      ]
    })[0].note,
    "2 at the start of your turn");

  check("and one that runs to the end of the Encounter says that",
    resourceRows({
      resources: { power: { stacks: 1, max: 2 } },
      timed: [{ kind: "resource", key: "power", edge: EDGES.ENCOUNTER, edges: 0,
                source: "power" }]
    })[0].note,
    "1 when the Encounter ends");

  // Somebody else's clock is somebody else's.
  check("another Resource's clock is not counted here",
    resourceRows({
      resources: { power: { stacks: 1, max: 2 } },
      timed: [
        { kind: "resource", key: "rapid", edge: "end", edges: 1, source: "rapid" },
        { kind: "condition", key: "power", edge: "end", edges: 1, source: "shaken" }
      ]
    })[0].note,
    "");

  // A stack a GM put there by hand has no clock, and the row says nothing rather than
  // claiming a turn it has not got.
  check("a stack with no clock claims no turn",
    resourceRows({ resources: { power: { stacks: 1, max: 2 } }, timed: [] })[0].note, "");
}

// --- Everything with stacks, in one list -----------------------------------------------------
{
  // Three of them are not Resources - two Diminishing counters and the Super Stacks - but
  // all three stack, and the section is about what you are carrying stacks of.
  const empty = stackRows({ resources: {}, timed: [], diminishing: {}, superStack: {} });
  // The Super Stacks a box in the Turn State now (the user's), not a row here.
  check("the two that are always there lead the list",
    empty.slice(0, 2).map(row => row.name),
    ["Diminishing Offense", "Diminishing Defense"]);
  check("neither Diminishing counter has a ceiling",
    empty.slice(0, 2).map(row => row.max), [0, 0]);
  check("and none of them has a note while it is at nothing",
    empty.slice(0, 3).map(row => row.note), ["", "", ""]);

  const wearing = stackRows({
    resources: { power: { stacks: 2, max: 2 } },
    timed: [],
    diminishing: { offense: { stacks: 2, penalty: 4 }, defense: { stacks: 3, penalty: 3 } },
    superStack: { stacks: 2, max: 3, musclePenalty: 4, solidBulk: 4, massivePower: 6 }
  });
  check("the Resources follow them",
    wearing.map(row => row.name),
    ["Diminishing Offense", "Diminishing Defense", "Power", "Unfamiliar"]);
  check("each with what it is worth",
    wearing.map(row => [row.stacks, row.max]), [[2, 0], [3, 0], [2, 2], [0, 3]]);
  check("and what each is costing or buying",
    wearing.slice(0, 2).map(row => row.note),
    ["Strike -4", "Dodge -3"]);
  check("the Diminishing pair carry no ceiling, and no Super Stacks row", [wearing.slice(0, 2).map(row => Boolean(row.max)),
    wearing.some(row => row.name === "Super Stacks"), MIDDOT.length], [[false, false], false, 1]);

  // A character with none of those blocks - which is what a stub reads as - is still
  // three rows rather than a crash.
  check("a character mid-derivation is still a list", stackRows({}).length, 4);
}

// --- And the sheet actually shows them -----------------------------------------------------------
{
  check("the sheet puts the rows in the context",
    SHEET.includes("context.stacks = stackRows(this.actor.system, traitsOwned(this.actor));"),
    true);

  // A list of its own with a Manage window (the user's): what Manage chose and whatever is held besides.
  check("the list shows what Manage chose and what is held",
    SHEET.includes("context.resourceRows = resources.filter(row => row.shown);")
      && SHEET.includes("context.resourcePicks = resources.filter(row => row.reachable || (row.stacks > 0));"), true);
  check("the template loops the key the sheet set",
    /\{\{#each resourceRows as \|row\|\}\}/.test(COMBAT) && /\{\{#each resourcePicks as \|row\|\}\}/.test(COMBAT), true);
  check("between the States and the Combat Conditions, none of the three folding",
    (COMBAT.indexOf('data-window="states"') < COMBAT.indexOf('data-window="resources"'))
      && (COMBAT.indexOf('data-window="resources"') < COMBAT.indexOf('data-window="conditions"'))
      && !COMBAT.includes("<details"), true);

  // The check with teeth: every field a row carries is read - by the template, or (whether it is offered) by the sheet.
  const fields = Object.keys(Object.assign({}, ...stackRows({
    resources: { power: { stacks: 1, max: 2 } }, timed: [], diminishing: {}
  }))).filter(key => key !== "key").sort();
  const rendered = [...new Set(
    [...COMBAT.matchAll(/\{\{#?if\s+row\.(\w+)\}\}|\{\{row\.(\w+)\}\}/g)]
      .map(m => m[1] ?? m[2])
  )].filter(key => key !== "key").sort();
  check("every field a row carries is one the template reads, or the Manage window's filter",
    fields.filter(field => !rendered.includes(field)), ["reachable"]);

  // "Si un resource no tiene maximo, en vez de x/y pone simplemente x." Drawn as a
  // condition rather than as a slash with nothing after it: a maximum of zero is a
  // maximum of nothing, which is not the same as having none.
  check("a row with no ceiling prints the count alone",
    COMBAT.includes("{{row.stacks}}{{#if row.max}}/{{row.max}}{{/if}}"), true);
}

console.log(failed ? `\n${failed} failing` : "\nall good");
process.exit(failed ? 1 : 0);
