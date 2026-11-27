/**
 * Apparel: built rather than picked.
 *
 * An Apparel is an Item the player builds and changes: its Category, Craftsmanship Grade and
 * Size, and any number of Qualities - over its Slots is said, never refused. What those come
 * to is read off one table, and checked against the rulebook's.
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
globalThis.Handlebars = { escapeExpression: String };
globalThis.game = { combat: null, users: { activeGM: null } };

const TRAITS = path.join(ROOT, "traits");
globalThis.foundry.utils.fetchJsonWithTimeout = async () =>
  JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));
globalThis.fetch = async url => {
  const file = path.join(TRAITS, String(url).replace("systems/dbu-ttrpg/traits/", ""));
  if (!fs.existsSync(file)) return { ok: false, status: 404, statusText: "missing" };
  return { ok: true, status: 200, text: async () => fs.readFileSync(file, "utf8") };
};

const { loadTraits, getTrait, printedLines } = await import(modUrl("effects/traits.mjs"));
const { default: DBUCharacterData } = await import(modUrl("data/actor-character.mjs"));
const { programsFor } = await import(modUrl("effects/registry.mjs"));
const { gearItemFrom, typeOf } = await import(modUrl("gear.mjs"));
const { default: DBUGearData } = await import(modUrl("data/item-gear.mjs"));
const { PROFILES: PROFILES_ALL } = await import(modUrl("maneuvers.mjs"));
await loadTraits();
const GEAR_MODULE = await import(modUrl("gear.mjs"));

const INDEX = JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

/** The least a parent can be and still be one the base class accepts. */
class ActorStub extends DataModel {
  static defineSchema() { return {}; }
}

// Built up past Power Level 1, so the base Tier is more than 1 and a (bT) that was read as
// a flat 1 shows.
function progressionTo(powerLevel) {
  const rows = [
    { lvl: 1, choice: "Skill Improvement", locked: true, attributes: {},
      skillRanks: ["perception", "perception"] }
  ];
  for (let lvl = 2; lvl <= powerLevel; lvl++) {
    rows.push({ lvl, choice: "Attribute Addition", locked: false,
      attributes: { insight: 1, agility: 1 }, skillRanks: [] });
  }
  return rows;
}

/** The character every check here is about. */
const ME = "Actor.me";

/** A character holding these Items, run through every phase. */
function holding(items, { powerLevel = 30, conditions = {}, states = {}, tierOfPowerModifier = 0 } = {}) {
  const parent = new ActorStub({}, { strict: false });
  parent.items = items;
  // Whose it is, for an Item made for somebody - the Eyeglasses.
  parent.uuid = ME;
  const model = new DBUCharacterData(
    { powerLevel, progression: progressionTo(powerLevel), conditions, states, tierOfPowerModifier },
    { parent, strict: false });
  parent.system = model;
  model.prepareBaseData?.();
  model.prepareDerivedData();
  return model;
}

/** A character's copy of a file, worn or not. */
let made = 0;
function given(id, { equipped = true, storedIn = "" } = {}) {
  const data = gearItemFrom(getTrait(id), null);
  made++;
  return { ...data, id: `item${made}`, uuid: `Actor.a.Item.item${made}`,
    system: { ...data.system, equipped, storedIn } };
}

// =================================================================================================
// Apparel: built rather than picked. Its pieces, the Grade table, the Item, and the two sheets.
// =================================================================================================
const { CRAFTED, GEAR_TYPES, craftedReading, craftedItemFrom } = await import(modUrl("gear.mjs"));
const { KINDS, traitsOfKind } = await import(modUrl("effects/traits.mjs"));
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");
const SHEET = read("module", "sheets", "actor-character-sheet.mjs");
const ITEM_SHEET = read("module", "sheets", "item-gear-sheet.mjs");
const REGISTRY = read("module", "effects", "registry.mjs");
const ITEM_PAGE = ["gear-header", "gear-sheet", "gear-description", "gear-crafted", "gear-qualities"].map(name => read("templates", "parts", `${name}.hbs`)).join("\n");

/** What a piece carrying one Quality says about itself, from its own Effects, on a Category that
 * takes it. */
function saysOf(id) {
  const trait = getTrait(id);
  const category = ["armor", "weights", "combat-clothing", "standard-clothing"]
    .find(each => GEAR_MODULE.qualityFits(trait, each));
  return GEAR_MODULE.craftedReading({ kind: "apparel", category, grade: 5,
    qualities: [{ id, slots: 1 }] }, { getTrait, difficulties: {} });
}

function DBUGearSheetTabs() {
  const text = ITEM_SHEET.slice(ITEM_SHEET.indexOf("static TABS = {"));
  const body = text.slice(0, text.indexOf("};"));
  return Object.fromEntries([...body.matchAll(/^\s{4}(\w+): \{ id:/gm)].map(match => [match[1], true]));
}
const TAB = read("templates", "parts", "actor-gear.hbs");
const DIFFICULTIES = DBUCharacterData.DIFFICULTIES;

// --- The pieces: a folder of their own, the four Categories ---------------------------------------
{
  check("the pieces have a kind of their own", KINDS.crafting?.label, "Crafting Option");
  const categories = traitsOfKind("crafting", "apparel-categories");
  check("the four Apparel Categories", categories.map(trait => trait.id).sort(),
    ["armor", "combat-clothing", "standard-clothing", "weights"]);
  check("every one in the index", categories.every(trait =>
    INDEX.traits.includes(`crafting/apparel-categories/${trait.id}.dbu`)), true);
  check("each entry as printed", Object.fromEntries(categories.map(trait =>
    [trait.id, printedLines(trait.text).join(" ")])), {
    "armor": "Armor. Gain Damage Reduction equal to the Apparel Bonus. Armor must be the Top "
      + "Layer of your Apparel and you cannot equip any piece of Apparel while wearing Armor.",
    "combat-clothing": "Combat Clothing. While this is the Top Layer of Apparel, increase your "
      + "Defense Value by 1/2 (rounded up) of the Apparel Bonus.",
    "standard-clothing": "Standard Clothing. Standard Clothing does not inflict Apparel "
      + "Penalties and reduces the Craft DC by 1 Difficulty Category.",
    "weights": "Weights. Reduce your Combat Rolls by the Apparel Bonus. When you remove this "
      + "piece of Apparel after the 3rd Combat Round of a Combat Encounter, increase the Doff "
      + "Bonus by 1/2 (rounded up)."
  });
  check("only Standard Clothing moves the Craft DC, one lower",
    categories.filter(trait => trait.craftDCShift).map(trait => [trait.id, trait.craftDCShift]),
    [["standard-clothing", -1]]);
  check("the Qualities given so far, each in the index",
    traitsOfKind("crafting", "apparel-qualities").map(trait =>
      [trait.id, INDEX.traits.includes(`crafting/apparel-qualities/${trait.id}.dbu`)
        || INDEX.traits.some(file => file.endsWith(`/crafting/apparel-qualities/${trait.id}.dbu`))])
      .sort((x, y) => x[0].localeCompare(y[0])),
    [["armed", true], ["beautiful-attire", true], ["class-mark", true], ["combat-ready", true], ["dense-armor", true],
     ["divine-apparel", true],
     ["durable", true], ["dynamic-quality", true], ["enchanted", true], ["environmental-protection", true], ["focal", true], ["free-flowing", true],
     ["hefty-plating", true], ["jacket", true], ["joint-protection", true], ["lab-coat", true],
     ["leaders-insignia", true], ["legacy", true], ["lightweight", true], ["loose", true], ["mystical", true],
     ["parrying-armor", true], ["rejuvenating-light", true], ["resolute-belief", true], ["segmented-weight", true], ["sleek-design", true],
     ["spiked", true], ["stretching", true], ["team-outfit", true], ["terrifying-design", true],
     ["training-support", true], ["unbreakable", true], ["weather-resistant", true]]);
}

// --- The Craftsmanship Grade table, as printed ----------------------------------------------------
{
  const apparel = CRAFTED.apparel;
  check("the table: Craft DC, Apparel Grade, Quality Slots for Grades 1 to 5",
    Object.entries(apparel.grades).map(([grade, row]) => [Number(grade), row.craftDC, row.grade, row.slots]),
    [[1, "apprentice", "low", 0], [2, "qualified", "low", 1], [3, "expert", "standard", 2],
     [4, "master", "standard", 3], [5, "grandmaster", "high", 4]]);
  check("and the Apparel Bonus of each Apparel Grade, per base Tier",
    Object.fromEntries(Object.entries(apparel.bonus).map(([key, band]) => [key, band.perBaseTier])),
    { low: 1, standard: 2, high: 3 });

  const at = (category, grade, qualities = [], baseTier = 3) => craftedReading(
    { kind: "apparel", category, grade, qualities }, { getTrait, difficulties: DIFFICULTIES, baseTier });
  check("Combat Clothing at each Grade: its Craft DC, Grade, Bonus at base Tier 3, and Slots",
    [1, 2, 3, 4, 5].map(grade => {
      const r = at("combat-clothing", grade);
      return [r.craftDCLabel, r.gradeLabel, r.bonus, r.slots];
    }),
    [["Apprentice", "Low", 3, 0], ["Qualified", "Low", 3, 1], ["Expert", "Standard", 6, 2],
     ["Master", "Standard", 6, 3], ["Grandmaster", "High", 9, 4]]);
  check("Standard Clothing one Difficulty lower at every Grade",
    [1, 2, 3, 4, 5].map(grade => at("standard-clothing", grade).craftDCLabel),
    ["Novice", "Apprentice", "Qualified", "Expert", "Master"]);
  check("more Qualities than Slots: counted as over, and nothing else changes",
    [at("armor", 2, ["a", "b", "c"]).over, at("armor", 2, ["a"]).over, at("armor", 5, ["a"]).over,
     at("armor", 2, ["a", "b", "c"]).bonus], [2, 0, 0, 3]);
}

// --- The Item: Standard Clothing, Grade 1, at their Size ----------------------------------------
{
  const character = { system: { size: { key: "tiny", chosen: "large" } } };
  const made = craftedItemFrom("apparel", character, getTrait);
  check("Add Apparel starts as Standard Clothing, Grade 1, at the Size they chose, with nothing on it",
    [made.name, made.type, made.system.itemType, made.system.crafted],
    ["Standard Clothing", "gear", "apparel",
     { kind: "apparel", category: "standard-clothing", grade: 1, size: "large", qualities: [],
       effects: "#@ category standard-clothing | Standard Clothing\n[passive]\n"
         + "piece.countsForPenalty = false;\n#@ end", breakLost: 0, destroyed: false }]);
  check("and it is drawn in the Apparel list", GEAR_TYPES[made.system.itemType].list, "apparel");
  const kept = new DBUGearData(structuredClone(made.system), { strict: false }).toObject();
  check("which the schema keeps - a Weapon's own fields at nothing",
    kept.crafted, { ...made.system.crafted, weaponType: "", weaponSize: "", lifeLost: 0,
      activeCategory: "", activeSize: "", lifeFixed: 0, fromBuddy: "", poisoned: false, sheathedIn: "",
      drawn: { quick: false, sheath: false, round: 0, sheathedWound: false } });
  const loaded = new DBUGearData({ ...structuredClone(made.system),
    crafted: { ...made.system.crafted, effects: null, qualities: ["a", "b", "c", "d", "e", "f"] } },
    { strict: false }).toObject();
  check("any number of Qualities is kept, however few Slots it has",
    loaded.crafted.qualities.length, 6);
  check("an Item from a file is built from nothing",
    gearItemFrom(getTrait("mask"), null).system.crafted ?? null, null);
}

// --- Wearing Standard Clothing is wearing any Apparel of that Category ---------------------------
{
  const apparel = (category, equipped = true) => {
    const data = craftedItemFrom("apparel", null, getTrait);
    made++;
    return { ...data, id: `apparel${made}`, uuid: `Actor.a.Item.apparel${made}`,
      system: { ...data.system, crafted: { ...data.system.crafted, effects: null, category }, equipped } };
  };
  const bare = holding([]);
  const morale = items => holding(items).savingThrows.morale.value - bare.savingThrows.morale.value;
  check("Fashionable Accessories with Standard Clothing worn: Morale 1(bT) higher",
    morale([given("fashionable-accessories"), apparel("standard-clothing")]), bare.baseTierOfPower);
  check("with Combat Clothing worn instead: nothing",
    morale([given("fashionable-accessories"), apparel("combat-clothing")]), 0);
  check("with Standard Clothing owned and not worn: nothing",
    morale([given("fashionable-accessories"), apparel("standard-clothing", false)]), 0);
}

// --- Qualities: the Slots each takes, a range to pick from, the Categories it goes on -----------
{
  const { qualityEntries, qualitySlotRange, slotsTaken, qualityFits } = await import(modUrl("gear.mjs"));
  // Made up for the purpose: the library has no Qualities yet.
  const made = {
    padded: { id: "padded", name: "Padded", slots: "2", categories: "armor, combat-clothing" },
    layered: { id: "layered", name: "Layered", slots: "1-3" },
    plain: { id: "plain", name: "Plain" }
  };
  const lookup = id => made[id] ?? getTrait(id);

  check("the Slots a Quality takes: as written, a range, or one when it says nothing",
    [qualitySlotRange(made.padded), qualitySlotRange(made.layered), qualitySlotRange(made.plain),
     qualitySlotRange({ slots: "1~2" })],
    [{ min: 2, max: 2, ranged: false }, { min: 1, max: 3, ranged: true },
     { min: 1, max: 1, ranged: false }, { min: 1, max: 2, ranged: true }]);
  check("what a range was given, held to it; its least when nothing was",
    [slotsTaken({ slots: 2 }, made.layered), slotsTaken({ slots: 9 }, made.layered),
     slotsTaken({ slots: 0 }, made.layered), slotsTaken({ slots: 0 }, made.padded)], [2, 3, 1, 2]);
  check("the Categories it goes on, or any",
    [qualityFits(made.padded, "armor"), qualityFits(made.padded, "weights"),
     qualityFits(made.plain, "weights")], [true, false, true]);

  const reading = (category, grade, qualities) => craftedReading(
    { kind: "apparel", category, grade, qualities }, { getTrait: lookup, difficulties: DIFFICULTIES });
  const r = reading("armor", 3, [{ id: "padded", slots: 0 }, { id: "layered", slots: 3 }]);
  check("Slots used are summed, not Qualities counted: 2 + 3 on a Grade of 2 Slots is 3 over",
    [r.qualities, r.used, r.slots, r.over], [2, 5, 2, 3]);
  check("a Quality its Category does not take is named as one",
    [reading("weights", 5, [{ id: "padded", slots: 0 }]).misfits,
     reading("armor", 5, [{ id: "padded", slots: 0 }]).misfits], [["padded"], []]);

  // Entries written before a Quality carried its Slots were only its id.
  check("an old entry reads as the Quality at its least",
    qualityEntries({ qualities: ["plain", { id: "layered", slots: 2 }] }),
    [{ id: "plain", slots: 0, choice: "", on: false, name: "", free: false, granted: false }, { id: "layered", slots: 2, choice: "", on: false, name: "", free: false, granted: false }]);
  const old = craftedItemFrom("apparel", null, getTrait).system;
  old.crafted.qualities = ["plain", "layered"];
  check("and the schema carries an old Item's forward",
    new DBUGearData(structuredClone(old), { strict: false }).toObject().crafted.qualities,
    [{ id: "plain", slots: 0, choice: "", on: false, name: "", free: false, granted: false }, { id: "layered", slots: 0, choice: "", on: false, name: "", free: false, granted: false }]);

  // The sheet: offered by Category, asked the Slots of a range, the Slots on each row.
  check("only the Qualities its Category takes are offered, with their Slots",
    [ITEM_SHEET.includes(".filter(trait => qualityFitsPiece(trait, crafted))"),
     ITEM_SHEET.includes("label: `${trait.name} (${ranged ? `${min}-${max}` : min})`")], [true, true]);
  const adding = ITEM_SHEET.slice(ITEM_SHEET.indexOf("static async _onAddQuality("),
    ITEM_SHEET.indexOf("static async _onRemoveQuality("));
  check("a range is asked when it is added, and the choice kept with it",
    [adding.includes("if (ranged) {"),
     adding.includes("[...qualityEntries(this.item.system.crafted), { id: pick, slots, choice }]")], [true, true]);
  check("each row says its Slots, and a misfit says it is inactive",
    [ITEM_PAGE.includes("{{quality.slotsLabel}}"), ITEM_PAGE.includes("{{quality.misfit}}"),
     ITEM_SHEET.includes("return `Not for ${categoryName}: inactive.`;")], [true, true, true]);
}

// --- Armed ----------------------------------------------------------------------------------------
{
  const { qualitySlotRange, qualityFits } = await import(modUrl("gear.mjs"));
  const armed = getTrait("armed");
  check("Armed is there, an Apparel Quality", [armed?.kind, armed?.owner],
    ["crafting", "apparel-qualities"]);
  check("the entry, as printed", printedLines(armed?.text), [
    "Armed: This outfit has a built-in weapon of some kind.",
    "–Apparel Category: All (except Weights)",
    "–Prerequisites: N/A",
    "–Quality Slots: 1",
    "–Effects: While you wear this piece of Apparel, you possess an Integrated Weapon. When "
      + "this piece of Apparel is created, create a Weapon with a Craftsmanship Grade equal to that "
      + "of this piece of Apparel – that Weapon is the Integrated Weapon."
  ]);
  check("in the index", INDEX.traits.includes("crafting/apparel-qualities/armed.dbu"), true);
  check("1 Quality Slot", qualitySlotRange(armed), { min: 1, max: 1, ranged: false });
  check("every Category but Weights",
    ["armor", "weights", "combat-clothing", "standard-clothing"].map(category => qualityFits(armed, category)),
    [true, false, true, true]);
  check("its Integrated Weapon is said where it is made (integrated.mjs)",
    /makes its Integrated Weapon at the piece.s Craftsmanship/.test(armed?.script ?? ""), true);
}

// --- Beautiful Attire -----------------------------------------------------------------------------
{
  const { qualityChoices, scriptWithChoice, apparelQualitiesInEffect } = await import(modUrl("gear.mjs"));
  const attire = getTrait("beautiful-attire");
  check("Beautiful Attire is there, an Apparel Quality", [attire?.kind, attire?.owner],
    ["crafting", "apparel-qualities"]);
  check("the entry, as printed", printedLines(attire?.text), [
    "Beautiful Attire: This outfit is visually appealing, enhancing your performance in social "
      + "situations.",
    "–Apparel Category: All",
    "–Prerequisites: Personality Score of 4+",
    "–Quality Slots: 1",
    "–Effects: Increase your Dice Score on Skill Checks with a Skill of your choice (when "
      + "creating this piece of Apparel) by 2. The Skill must use your Personality Score to be chosen."
  ]);
  check("in the index", INDEX.traits.includes("crafting/apparel-qualities/beautiful-attire.dbu"), true);
  check("chosen among the Skills that use Personality, and nothing else",
    qualityChoices(attire, DBUCharacterData.SKILLS).sort(),
    ["bluff", "cooking", "intimidation", "performance", "persuasion"]);
  check("and a Quality that asks nothing offers nothing", qualityChoices(getTrait("armed"),
    DBUCharacterData.SKILLS), []);
  check("the choice written into its script; with none chosen, nothing to run",
    [scriptWithChoice(attire.script, "persuasion").includes("skill.persuasion += 2;"),
     scriptWithChoice(attire.script, ""), scriptWithChoice("strike += 1;", "")],
    [true, "", "strike += 1;"]);

  // Worn, through the whole engine - Personality Score raised or not.
  const piece = ({ category = "standard-clothing", equipped = true, qualities } = {}) => {
    const data = craftedItemFrom("apparel", null, getTrait);
    made++;
    return { ...data, id: `attire${made}`, uuid: `Actor.a.Item.attire${made}`,
      system: { ...data.system, equipped,
        crafted: { ...data.system.crafted, effects: null, category, qualities } } };
  };
  const chosen = [{ id: "beautiful-attire", slots: 1, choice: "persuasion" }];
  // Personality Score through the progression: raised on every row past the first.
  const wearer = (items, personality) => {
    const parent = new ActorStub({}, { strict: false });
    parent.items = items;
    parent.uuid = ME;
    const rows = [{ lvl: 1, choice: "Skill Improvement", locked: true, attributes: {},
      skillRanks: ["perception", "perception"] }];
    for (let lvl = 2; lvl <= 6; lvl++) {
      rows.push({ lvl, choice: "Attribute Addition", locked: false,
        attributes: (lvl <= personality) ? { personality: 1, insight: 1 } : { insight: 1, agility: 1 },
        skillRanks: [] });
    }
    const model = new DBUCharacterData({ powerLevel: 6, progression: rows },
      { parent, strict: false });
    parent.system = model;
    model.prepareBaseData?.();
    model.prepareDerivedData();
    return model;
  };
  const rolls = (model, bare) => Object.fromEntries(Object.entries(model.skills)
    .map(([key, skill]) => [key, skill.roll - bare.skills[key].roll]).filter(([, change]) => change));
  const strong = wearer([], 6);
  check("a wearer with Personality 4+ to measure against", strong.attributes.personality.score >= 4, true);
  check("worn by them: the chosen Skill's Checks 2 higher, and no other",
    rolls(wearer([piece({ qualities: chosen })], 6), strong), { persuasion: 2 });
  const weak = wearer([], 1);
  check("and a wearer below it, to measure against", weak.attributes.personality.score < 4, true);
  check("worn by someone below the Prerequisite: nothing",
    rolls(wearer([piece({ qualities: chosen })], 1), weak), {});
  check("not worn: nothing",
    rolls(wearer([piece({ qualities: chosen, equipped: false })], 6), strong), {});
  check("its Category is any, so it works on each",
    ["armor", "weights", "combat-clothing"].map(category =>
      rolls(wearer([piece({ category, qualities: chosen })], 6), strong).persuasion ?? 0), [2, 2, 2]);
  check("with nothing chosen: nothing",
    rolls(wearer([piece({ qualities: [{ id: "beautiful-attire", slots: 1, choice: "" }] })], 6), strong), {});
  check("worn and read as in effect with its entries",
    apparelQualitiesInEffect([piece({ qualities: chosen })]).map(entry => entry.entries[0].choice),
    ["persuasion"]);
  check("named on the Skill's hover, with the Apparel it is on",
    (wearer([piece({ qualities: chosen })], 6).effects.workings["skill.persuasion"]?.contributions ?? [])
      .map(part => part.source), ["Beautiful Attire (Standard Clothing)"]);
  // No Quality with effects is held to certain Categories yet, so this is read off the code;
  // the first one that is gets run through the engine on a Category it refuses.
  check("a Quality its Category does not take writes nothing into the piece's Effects",
    (await import(modUrl("gear.mjs"))).effectParts((await import(modUrl("gear.mjs"))).composeEffects(
      { kind: "apparel", category: "weights", qualities: [{ id: "dense-armor", slots: 1 }] }, "",
      { getTrait })).map(part => part.key), ["category:weights"]);
  check("the Skill asked when it is added, and shown on its row",
    [ITEM_SHEET.includes("const offered = qualityChoices(trait, DBUCharacterData.SKILLS, DBUGearSheet.#weathers(),"),
     ITEM_PAGE.includes("{{quality.choiceLabel}}")], [true, true]);
}

// --- Dense Armor ----------------------------------------------------------------------------------
{
  const { qualityFits, qualitySlotRange } = await import(modUrl("gear.mjs"));
  const dense = getTrait("dense-armor");
  check("Dense Armor is there, an Apparel Quality", [dense?.kind, dense?.owner],
    ["crafting", "apparel-qualities"]);
  check("the entry, as printed", printedLines(dense?.text), [
    "Dense Armor: Particularly protective armor, this bulky gear restricts your movements.",
    "–Apparel Category: Armor",
    "–Prerequisites: N/A",
    "–Quality Slots: 1",
    "–Effects: Increase your Apparel Bonus by 1(bT) but reduce your Combat Rolls by an equal "
      + "amount."
  ]);
  check("in the index", INDEX.traits.includes("crafting/apparel-qualities/dense-armor.dbu"), true);
  check("1 Quality Slot, on Armor alone",
    [qualitySlotRange(dense), ["armor", "weights", "combat-clothing", "standard-clothing"]
      .map(category => qualityFits(dense, category))],
    [{ min: 1, max: 1, ranged: false }, [true, false, false, false]]);

  // The Apparel's own Bonus: 1(bT) more on Armor, and nothing on a Category that refuses it.
  const reading = (category, grade) => craftedReading({ kind: "apparel", category, grade,
    qualities: [{ id: "dense-armor", slots: 1, choice: "" }] },
    { getTrait, difficulties: DIFFICULTIES, baseTier: 3 });
  check("Armor at Grade 3: Standard's 2(bT), and 1(bT) more - 9 at base Tier 3",
    [reading("armor", 3).perBaseTier, reading("armor", 3).fromQualities, reading("armor", 3).bonus],
    [3, 1, 9]);
  check("on Weights, where it does not go: the Grade's Bonus alone",
    [reading("weights", 3).perBaseTier, reading("weights", 3).bonus], [2, 6]);

  // Worn, the wearer's Combat Rolls 1(bT) lower - and not on a Category that refuses it.
  const piece = (category, equipped = true) => {
    const data = craftedItemFrom("apparel", null, getTrait);
    made++;
    return { ...data, id: `dense${made}`, uuid: `Actor.a.Item.dense${made}`,
      system: { ...data.system, equipped, crafted: { ...data.system.crafted, effects: null, category,
        qualities: [{ id: "dense-armor", slots: 1, choice: "" }] } } };
  };
  const combat = model => [model.combat.strike, model.combat.dodge, ...Object.values(model.combat.wound)];
  const minus = (a, b) => a.map((value, i) => value - b[i]);
  const bare = holding([]);
  const bT = bare.baseTierOfPower;
  // Down to nothing and no further: nothing the system derives goes below zero, and this
  // character's Wound Rolls are smaller than the penalty.
  check("worn as Armor: every Combat Roll 1(bT) lower, none below zero",
    minus(combat(holding([piece("armor")])), combat(bare)),
    combat(bare).map(value => Math.max(-value, -bT)));
  check("and the penalty is the whole 1(bT) where there is room for it",
    [combat(bare)[0] >= bT, combat(holding([piece("armor")]))[0] - combat(bare)[0]], [true, -bT]);
  const plainWeights = (() => {
    const data = craftedItemFrom("apparel", null, getTrait);
    return { ...data, id: "plainweights", uuid: "Actor.a.Item.plainweights",
      system: { ...data.system, equipped: true, crafted: { ...data.system.crafted, effects: null,
        category: "weights", qualities: [] } } };
  })();
  check("worn as Weights, which does not take it: nothing past the Weights' own - the Category's refusal, run",
    minus(combat(holding([piece("weights")])), combat(holding([plainWeights]))), [0, 0, 0, 0, 0]);
  check("not worn: nothing", minus(combat(holding([piece("armor", false)])), combat(bare)),
    [0, 0, 0, 0, 0]);
}

// --- Durable --------------------------------------------------------------------------------------
{
  const { qualityInactive, qualitySlotRange, qualityFits } = await import(modUrl("gear.mjs"));
  const durable = getTrait("durable");
  check("Durable is there, an Apparel Quality", [durable?.kind, durable?.owner],
    ["crafting", "apparel-qualities"]);
  check("the entry, as printed", printedLines(durable?.text), [
    "Durable: This particular piece of apparel is extremely hard to damage.",
    "–Apparel Category: All",
    "–Prerequisites: This piece of Apparel does not have the Lightweight Apparel Quality",
    "–Quality Slots: 1",
    "–Effects: Increase the maximum Break Value for this piece of Apparel by 3."
  ]);
  check("in the index", INDEX.traits.includes("crafting/apparel-qualities/durable.dbu"), true);
  check("1 Quality Slot, on any Category",
    [qualitySlotRange(durable), ["armor", "weights", "combat-clothing", "standard-clothing"]
      .map(category => qualityFits(durable, category))],
    [{ min: 1, max: 1, ranged: false }, [true, true, true, true]]);

  const crafted = qualities => ({ kind: "apparel", category: "combat-clothing", grade: 2, qualities });
  const read = qualities => craftedReading(crafted(qualities),
    { getTrait, difficulties: DIFFICULTIES, baseTier: 2 });
  check("every piece of Apparel starts at a Break Value of 3", read([]).breakValue, 3);
  check("with Durable, 6", read([{ id: "durable", slots: 1, choice: "" }]).breakValue, 6);
  const both = [{ id: "durable", slots: 1, choice: "" }, { id: "lightweight", slots: 1, choice: "" }];
  check("with Lightweight on the same piece, Durable does not apply at all",
    [read(both).breakValue, qualityInactive(both[0], crafted(both), getTrait).startsWith("has "),
     read(both).inactive.includes("durable")], [3, true, true]);
  check("and a Quality needing another is off without it",
    qualityInactive({ id: "needy" }, crafted([]), id => (id === "needy")
      ? { id, name: "Needy", requiresQualities: "armed" } : getTrait(id)), "needs Armed");
  check("the row says why, and the sheet shows the Break Value",
    [ITEM_SHEET.includes("return `This ${kindLabel} ${why}: inactive.`;"),
     ITEM_PAGE.includes('value="{{crafted.reading.breakLeft}}"') && ITEM_PAGE.includes("/{{crafted.reading.breakValue}}</span>")], [true, true]);
}

// --- Environmental Protection ---------------------------------------------------------------------
{
  const { qualityFits, qualitySlotRange, groundIgnored } = await import(modUrl("gear.mjs"));
  const { isUnbreathable } = await import(modUrl("breath.mjs"));
  const CHAT = read("module", "chat.mjs");
  const protection = getTrait("environmental-protection");
  check("Environmental Protection is there, an Apparel Quality", [protection?.kind, protection?.owner],
    ["crafting", "apparel-qualities"]);
  check("the entry, as printed", printedLines(protection?.text), [
    "Environmental Protection: Intended to preserve one’s life for exploration into a hostile "
      + "environment, this outfit is airtight.",
    "–Apparel Category: Standard Clothing",
    "–Prerequisites: N/A",
    "–Quality Slots: 2",
    "–Effects: Ignore the effects of Battle Environments, Environmental Qualities, and "
      + "Unbreathable Atmosphere."
  ]);
  check("in the index", INDEX.traits.includes("crafting/apparel-qualities/environmental-protection.dbu"), true);
  check("2 Quality Slots, on Standard Clothing alone",
    [qualitySlotRange(protection), ["armor", "weights", "combat-clothing", "standard-clothing"]
      .map(category => qualityFits(protection, category))],
    [{ min: 2, max: 2, ranged: false }, [false, false, false, true]]);

  const piece = (category = "standard-clothing", equipped = true) => {
    const data = craftedItemFrom("apparel", null, getTrait);
    made++;
    return { ...data, id: `protect${made}`, uuid: `Actor.a.Item.protect${made}`,
      system: { ...data.system, equipped, crafted: { ...data.system.crafted, effects: null, category,
        qualities: [{ id: "environmental-protection", slots: 2, choice: "" }] } } };
  };
  check("worn: the Environment and its Qualities ignored",
    groundIgnored([piece()], getTrait), { environments: true, qualities: true });
  check("not worn, or on a Category that refuses it: nothing ignored",
    [groundIgnored([piece("standard-clothing", false)], getTrait), groundIgnored([piece("armor")], getTrait)],
    [{ environments: false, qualities: false }, { environments: false, qualities: false }]);

  // Standing in Lava - an Environment with Aflame of its own - and on Glass, through the engine.
  const standing = (items, battlefield) => {
    const parent = new ActorStub({}, { strict: false });
    parent.items = items;
    parent.uuid = ME;
    const model = new DBUCharacterData({ powerLevel: 10, progression: progressionTo(10), battlefield },
      { parent, strict: false });
    parent.system = model;
    model.prepareBaseData?.();
    model.prepareDerivedData();
    return { system: model, items, uuid: ME };
  };
  const lava = { environment: "lava-environment", groundHardness: 3 };
  const sources = actor => programsFor(actor).map(entry => entry.sourceId)
    .filter(id => id.startsWith("battlefield:lava") || id.startsWith("quality:"));
  check("bare in Lava: the Environment and its Aflame are gathered",
    ["quality:aflame", "battlefield:lava-environment"].map(id => sources(standing([], lava)).includes(id)),
    [true, true]);
  check("protected in Lava: neither is", sources(standing([piece()], lava)), []);
  check("carried and not worn: both still are",
    sources(standing([piece("standard-clothing", false)], lava)).length, 2);

  const glass = { environment: "standard-environment", groundHardness: 2, qualities: ["glass"] };
  check("on Glass the ground is harder, and not for one who ignores its Qualities",
    [standing([], glass).system.battlefield.groundRank > 2,
     standing([piece()], glass).system.battlefield.groundRank], [true, 2]);

  const magma = { environment: "magma-environment", groundHardness: 4 };
  check("Unbreathable Atmosphere ignored: Magma is breathable for them",
    [isUnbreathable(standing([], magma)), isUnbreathable(standing([piece()], magma))], [true, false]);

  check("a Ground Collision: no Bouncy or Dangerous, and no Soft knock-down, for them",
    [CHAT.includes("const groundQualities = ignoring.qualities ? [] : qualitiesOf(target.system, standing, getTrait)"),
     CHAT.includes("const knocksDown = !ignoring.environments && Boolean(standing?.collisionCondition);"),
     CHAT.includes("if (hitGround && knocksDown) {")], [true, true, true]);
}

// --- Focal ----------------------------------------------------------------------------------------
{
  const { qualityFits, qualitySlotRange, qualityChoices, qualityChoiceLabel, narrowedRoll } =
    await import(modUrl("gear.mjs"));
  const focal = getTrait("focal");
  check("Focal is there, an Apparel Quality", [focal?.kind, focal?.owner],
    ["crafting", "apparel-qualities"]);
  check("the entry, as printed", printedLines(focal?.text), [
    "Focal: Designed to improve a single aspect of combat, these weights aren’t as heavy, but "
      + "are placed on specific areas of the body.",
    "–Apparel Category: Weights",
    "–Prerequisites: N/A",
    "–Quality Slots: 1",
    "–Effects: Upon creating this piece of Apparel, select either your Strike or Dodge Rolls. "
      + "The chosen Combat Roll is the only Combat Roll reduced by the effects of the Weight Apparel "
      + "Category, but only that Combat Roll benefits from this piece of Apparel’s Doff Bonus."
  ]);
  check("in the index", INDEX.traits.includes("crafting/apparel-qualities/focal.dbu"), true);
  check("1 Quality Slot, on Weights alone",
    [qualitySlotRange(focal), ["armor", "weights", "combat-clothing", "standard-clothing"]
      .map(category => qualityFits(focal, category))],
    [{ min: 1, max: 1, ranged: false }, [false, true, false, false]]);
  check("Strike or Dodge to choose, each by name",
    [qualityChoices(focal, DBUCharacterData.SKILLS),
     qualityChoiceLabel(focal, "strike", DBUCharacterData.SKILLS),
     qualityChoiceLabel(focal, "dodge", DBUCharacterData.SKILLS)],
    [["strike", "dodge"], "Strike Rolls", "Dodge Rolls"]);
  check("and Beautiful Attire's Skills still named as Skills",
    qualityChoiceLabel(getTrait("beautiful-attire"), "persuasion", DBUCharacterData.SKILLS), "Persuasion");

  // What the Weights will read: the one Roll a piece's Focal narrows it to.
  const weights = (qualities, category = "weights") => ({ system: { crafted:
    { kind: "apparel", category, grade: 2, qualities } } });
  check("Weights with Focal on Dodge reach the Dodge alone; without it, every Roll",
    [narrowedRoll(weights([{ id: "focal", slots: 1, choice: "dodge" }]), getTrait),
     narrowedRoll(weights([]), getTrait)], ["dodge", ""]);
  check("and Focal on a Category that refuses it narrows nothing",
    narrowedRoll(weights([{ id: "focal", slots: 1, choice: "dodge" }], "armor"), getTrait), "");
  check("the Weights read it: each Combat Roll reached, or not, by what Focal narrows",
    [/piece\.narrows\.\$choice = true;/.test(focal?.script ?? ""),
     ["strike -= $apparelBonus(bT) * $reachesStrike;", "dodge -= $apparelBonus(bT) * $reachesDodge;",
      "wound -= $apparelBonus(bT) * $reachesWound;"].every(line => getTrait("weights")?.script.includes(line))],
    [true, true]);
  check("the choice asked with its own labels, and shown on its row by them",
    [ITEM_SHEET.includes("label: qualityChoiceLabel(trait, key, DBUCharacterData.SKILLS,\n"
       + "                DBUGearSheet.#weathers(), getTrait) })),"),
     ITEM_SHEET.includes("choiceLabel: qualityChoiceLabel(trait, entry.choice, DBUCharacterData.SKILLS,\n"
       + "            DBUGearSheet.#weathers(), getTrait),")],
    [true, true]);
}

// --- Hefty Plating --------------------------------------------------------------------------------
{
  const { qualityFits, qualitySlotRange } = await import(modUrl("gear.mjs"));
  const hefty = getTrait("hefty-plating");
  check("Hefty Plating is there, an Apparel Quality", [hefty?.kind, hefty?.owner],
    ["crafting", "apparel-qualities"]);
  check("the entry, as printed", printedLines(hefty?.text), [
    "Hefty Plating: The sturdy weights in this outfit can be weaponized.",
    "–Apparel Category: Weights",
    "–Prerequisites: Force Score of 6+",
    "–Quality Slots: 1",
    "–Effects: The Hardness Value of this piece of Apparel is set to 4. If you hit an Opponent "
      + "with this piece of Apparel through the Throw Maneuver, make a Might Clash against them. If "
      + "you win, they are knocked Prone."
  ]);
  check("in the index", INDEX.traits.includes("crafting/apparel-qualities/hefty-plating.dbu"), true);
  check("1 Quality Slot, on Weights alone",
    [qualitySlotRange(hefty), ["armor", "weights", "combat-clothing", "standard-clothing"]
      .map(category => qualityFits(hefty, category))],
    [{ min: 1, max: 1, ranged: false }, [false, true, false, false]]);

  const reading = (category, qualities) => craftedReading({ kind: "apparel", category, grade: 2,
    qualities }, { getTrait, difficulties: DIFFICULTIES });
  const on = [{ id: "hefty-plating", slots: 1, choice: "" }];
  check("its piece's Hardness Value is 4; a piece without it has none set",
    [reading("weights", on).hardnessValue, reading("weights", []).hardnessValue], [4, null]);
  check("and on a Category that refuses it, none", reading("armor", on).hardnessValue, null);
  check("shown on the sheet when set",
    ITEM_PAGE.includes("{{#if crafted.reading.hardnessValue}}<span>Hardness Value: {{crafted.reading.hardnessValue}}</span>{{/if}}"),
    true);
  // Thrown with the Throw Maneuver: its own Hardness Value is the Collision Damage, and a hit
  // opens a Might Clash - for a thrower with the Force Score of 6+ its Prerequisite asks.
  const { thrownAs } = GEAR_MODULE;
  const heftyPiece = { id: "h1", name: "Heavy Gi", system: { ...craftedItemFrom("apparel", null, getTrait).system,
    crafted: { kind: "apparel", category: "weights", grade: 3, qualities: [{ id: "hefty-plating", slots: 1 }],
      effects: null } } };
  const thrower = force => ({ system: { attributes: { force: { score: force } } } });
  check("thrown: its Hardness Value of 4, and a Might Clash for a thrower of Force 6+",
    [thrownAs(heftyPiece, thrower(6), getTrait), thrownAs(heftyPiece, thrower(5), getTrait)]
      .map(({ value, mightClash }) => [value, mightClash]), [[4, true], [4, false]]);
}

// --- Jacket ---------------------------------------------------------------------------------------
{
  const { qualityFits, qualitySlotRange } = await import(modUrl("gear.mjs"));
  const jacket = getTrait("jacket");
  check("the Jacket is there, an Apparel Quality", [jacket?.kind, jacket?.owner],
    ["crafting", "apparel-qualities"]);
  check("the entry, as printed", printedLines(jacket?.text), [
    "Jacket: A piece of clothing designed to protect another piece of clothing underneath.",
    "–Apparel Category: Standard Clothing",
    "–Prerequisites: N/A",
    "–Quality Slots: 1~3",
    "–Effects: Increase your Soak Value by x(bT), where x is equal to the number of Quality Slots this "
      + "Apparel Quality is occupying. Additionally, this piece of Apparel can be worn over Armor."
  ]);
  check("in the index", INDEX.traits.includes("crafting/apparel-qualities/jacket.dbu"), true);
  check("1 to 3 Quality Slots, on Standard Clothing alone",
    [qualitySlotRange(jacket), ["armor", "weights", "combat-clothing", "standard-clothing"]
      .map(category => qualityFits(jacket, category))],
    [{ min: 1, max: 3, ranged: true }, [false, false, false, true]]);
  check("it can go on over Armor, for the Layers to read", saysOf("jacket").wornOverArmor, true);

  const piece = (category = "standard-clothing", equipped = true, slots = 1) => {
    const data = craftedItemFrom("apparel", null, getTrait);
    made++;
    return { ...data, id: `jacket${made}`, uuid: `Actor.a.Item.jacket${made}`,
      system: { ...data.system, equipped, crafted: { ...data.system.crafted, effects: null, category,
        qualities: [{ id: "jacket", slots, choice: "" }] } } };
  };
  const bare = holding([]);
  const bT = bare.baseTierOfPower;
  check("worn: Soak Value 1(bT) higher for each Slot",
    [1, 2, 3].map(slots => holding([piece("standard-clothing", true, slots)]).soakValue - bare.soakValue),
    [bT, 2 * bT, 3 * bT]);
  check("not worn, or on a Category that refuses it: nothing",
    [holding([piece("standard-clothing", false)]).soakValue - bare.soakValue,
     holding([piece("armor")]).soakValue - bare.soakValue], [0, 0]);
}

// --- Joint Protection -----------------------------------------------------------------------------
{
  const { qualityFits, qualitySlotRange } = await import(modUrl("gear.mjs"));
  const joint = getTrait("joint-protection");
  check("Joint Protection is there, an Apparel Quality", [joint?.kind, joint?.owner],
    ["crafting", "apparel-qualities"]);
  check("the entry, as printed", printedLines(joint?.text), [
    "Joint Protection: This armor covers your joints, reducing the chances of them being injured.",
    "–Apparel Category: Armor",
    "–Prerequisites: N/A",
    "–Quality Slots: 1",
    "–Effects: The first time in a Combat Encounter that your Break Value would be lowered "
      + "while being at its maximum Break Value, your Break Value is not lowered."
  ]);
  check("in the index", INDEX.traits.includes("crafting/apparel-qualities/joint-protection.dbu"), true);
  check("1 Quality Slot, on Armor alone",
    [qualitySlotRange(joint), ["armor", "weights", "combat-clothing", "standard-clothing"]
      .map(category => qualityFits(joint, category))],
    [{ min: 1, max: 1, ranged: false }, [true, false, false, false]]);
  check("marked for the Break Value to read, and what waits on it written down",
    [saysOf("joint-protection").sparesFirstBreak, /it loses\s*#?\s*none - kept with the other once-per-Encounter uses/.test(joint?.script ?? "")],
    [true, true]);
}

// --- Lab Coat -------------------------------------------------------------------------------------
{
  const { qualityFits, qualitySlotRange, qualityChoices } = await import(modUrl("gear.mjs"));
  const coat = getTrait("lab-coat");
  check("the Lab Coat is there, an Apparel Quality", [coat?.kind, coat?.owner],
    ["crafting", "apparel-qualities"]);
  check("the entry, as printed", printedLines(coat?.text), [
    "Lab Coat: This type of clothing is intended to protect you from chemical spills and other "
      + "scientific mishaps.",
    "–Apparel Category: Standard Clothing",
    "–Prerequisites: Scholarship Score of 4+",
    "–Quality Slots: 1",
    "–Effects: Increase your Dice Score on Skill Checks with a Skill of your choice (when "
      + "creating this piece of Apparel) by 2. The Skill must use your Scholarship Score to be chosen."
  ]);
  check("in the index", INDEX.traits.includes("crafting/apparel-qualities/lab-coat.dbu"), true);
  check("1 Quality Slot, on Standard Clothing alone",
    [qualitySlotRange(coat), ["armor", "weights", "combat-clothing", "standard-clothing"]
      .map(category => qualityFits(coat, category))],
    [{ min: 1, max: 1, ranged: false }, [false, false, false, true]]);
  const scholarly = Object.entries(DBUCharacterData.SKILLS)
    .filter(([, skill]) => skill.attribute === "scholarship").map(([key]) => key).sort();
  check("chosen among the Skills that use Scholarship, and nothing else",
    qualityChoices(coat, DBUCharacterData.SKILLS).sort(), scholarly);
  check("which are some", scholarly.length > 0, true);

  // Worn, through the engine, with Scholarship raised through the progression or not.
  const piece = (qualities, category = "standard-clothing") => {
    const data = craftedItemFrom("apparel", null, getTrait);
    made++;
    return { ...data, id: `coat${made}`, uuid: `Actor.a.Item.coat${made}`,
      system: { ...data.system, equipped: true, crafted: { ...data.system.crafted, effects: null, category, qualities } } };
  };
  const wearer = (items, raised) => {
    const parent = new ActorStub({}, { strict: false });
    parent.items = items;
    parent.uuid = ME;
    const rows = [{ lvl: 1, choice: "Skill Improvement", locked: true, attributes: {},
      skillRanks: ["perception", "perception"] }];
    for (let lvl = 2; lvl <= 6; lvl++) {
      rows.push({ lvl, choice: "Attribute Addition", locked: false,
        attributes: raised ? { scholarship: 1, insight: 1 } : { insight: 1, agility: 1 }, skillRanks: [] });
    }
    const model = new DBUCharacterData({ powerLevel: 6, progression: rows }, { parent, strict: false });
    parent.system = model;
    model.prepareBaseData?.();
    model.prepareDerivedData();
    return model;
  };
  const rolls = (model, bare) => Object.fromEntries(Object.entries(model.skills)
    .map(([key, skill]) => [key, skill.roll - bare.skills[key].roll]).filter(([, change]) => change));
  const chosen = [{ id: "lab-coat", slots: 1, choice: "investigation" }];
  const learned = wearer([], true);
  check("a wearer with Scholarship 4+, and one below it",
    [learned.attributes.scholarship.score >= 4, wearer([], false).attributes.scholarship.score < 4],
    [true, true]);
  check("worn by the one with it: the chosen Skill's Checks 2 higher, and no other",
    rolls(wearer([piece(chosen)], true), learned), { investigation: 2 });
  check("worn by the one without it: nothing",
    rolls(wearer([piece(chosen)], false), wearer([], false)), {});
  check("on a Category that refuses it: nothing",
    rolls(wearer([piece(chosen, "armor")], true), learned), {});
}

// --- Leader's Insignia ----------------------------------------------------------------------------
{
  const { qualityFits, qualitySlotRange } = await import(modUrl("gear.mjs"));
  const insignia = getTrait("leaders-insignia");
  check("Leader's Insignia is there, an Apparel Quality", [insignia?.kind, insignia?.owner, insignia?.name],
    ["crafting", "apparel-qualities", "Leader\u2019s Insignia"]);
  check("the entry, as printed", printedLines(insignia?.text), [
    "Leader\u2019s Insignia: A symbol of your authority, those who follow you respect and recognize "
      + "you as their leader.",
    "\u2013Apparel Category: All (Except Weights)",
    "\u2013Prerequisites: Personality or Scholarship Score of 6+",
    "\u2013Quality Slots: 1",
    "\u2013Effects: Increase the Combat Rolls of your Minions by 1(bT). If this piece of Apparel has "
      + "the Team Outfit Quality, increase the Wound Roll of all Allies with the same team name by "
      + "1(bT) \u2013 this bonus does not stack if multiple Characters possess this Quality."
  ]);
  check("in the index", INDEX.traits.includes("crafting/apparel-qualities/leaders-insignia.dbu"), true);
  check("1 Quality Slot, on every Category but Weights",
    [qualitySlotRange(insignia), ["armor", "weights", "combat-clothing", "standard-clothing"]
      .map(category => qualityFits(insignia, category))],
    [{ min: 1, max: 1, ranged: false }, [true, false, true, true]]);
  // Worn: given to your Minions as each is prepared (allies.mjs minionGifts); the Team Outfit's Wound Roll the table's.
  check("its Minions' Combat Rolls, and nothing else to run", (insignia?.script ?? "").replace(/#.*$/gm, "").trim(),
    "[passive]\nminions.combatRolls += 1(bT);");
}

// --- Lightweight ----------------------------------------------------------------------------------
{
  const { qualityFits, qualitySlotRange, qualityInactive } = await import(modUrl("gear.mjs"));
  const light = getTrait("lightweight");
  check("Lightweight is there, an Apparel Quality", [light?.kind, light?.owner],
    ["crafting", "apparel-qualities"]);
  check("the entry, as printed", printedLines(light?.text), [
    "Lightweight: This article of clothing is especially light.",
    "\u2013Apparel Category: All (Except Weights)",
    "\u2013Prerequisites: This piece of Apparel does not have the Durable Apparel Quality.",
    "\u2013Quality Slots: 1",
    "\u2013Effects: This piece of Apparel does not count towards the Apparel Penalty."
  ]);
  check("in the index", INDEX.traits.includes("crafting/apparel-qualities/lightweight.dbu"), true);
  check("1 Quality Slot, on every Category but Weights",
    [qualitySlotRange(light), ["armor", "weights", "combat-clothing", "standard-clothing"]
      .map(category => qualityFits(light, category))],
    [{ min: 1, max: 1, ranged: false }, [true, false, true, true]]);
  check("marked for the Apparel Penalty to read", saysOf("lightweight").countsForPenalty, false);

  const crafted = qualities => ({ kind: "apparel", category: "combat-clothing", grade: 3, qualities });
  const alone = [{ id: "lightweight", slots: 1, choice: "" }];
  const both = [...alone, { id: "durable", slots: 1, choice: "" }];
  check("alone, it applies", qualityInactive(alone[0], crafted(alone), getTrait), "");
  check("with Durable on the same piece, neither applies - each is the other's missing Prerequisite",
    [qualityInactive(both[0], crafted(both), getTrait), qualityInactive(both[1], crafted(both), getTrait)],
    ["has Durable", "has Lightweight"]);
  check("and Durable's 3 Break Value is not added",
    craftedReading(crafted(both), { getTrait, difficulties: DIFFICULTIES }).breakValue, 3);
}

// --- Loose ----------------------------------------------------------------------------------------
{
  const { qualityFits, qualitySlotRange } = await import(modUrl("gear.mjs"));
  const loose = getTrait("loose");
  check("Loose is there, an Apparel Quality", [loose?.kind, loose?.owner],
    ["crafting", "apparel-qualities"]);
  check("the entry, as printed", printedLines(loose?.text), [
    "Loose: This item of clothing comes off quite easily.",
    "\u2013Apparel Category: Combat Clothing/Standard Clothing",
    "\u2013Prerequisites: N/A",
    "\u2013Quality Slots: 1",
    "\u2013Effects: You can Doff this piece of Apparel through the No-Effort Maneuver."
  ]);
  check("in the index", INDEX.traits.includes("crafting/apparel-qualities/loose.dbu"), true);
  check("1 Quality Slot, on Combat Clothing and Standard Clothing",
    [qualitySlotRange(loose), ["armor", "weights", "combat-clothing", "standard-clothing"]
      .map(category => qualityFits(loose, category))],
    [{ min: 1, max: 1, ranged: false }, [false, false, true, true]]);
  check("marked for removing Apparel to read, and what waits written down",
    [saysOf("loose").doffsWithNoEffort, /the No-Effort Maneuver instead of its Actions/.test(loose?.script ?? "")],
    [true, true]);
}

// --- Mystical -------------------------------------------------------------------------------------
{
  const { qualityFits, qualitySlotRange } = await import(modUrl("gear.mjs"));
  const mystical = getTrait("mystical");
  check("Mystical is there, an Apparel Quality", [mystical?.kind, mystical?.owner],
    ["crafting", "apparel-qualities"]);
  check("the entry, as printed", printedLines(mystical?.text), [
    "Mystical: This item of clothing is great for magically focused characters.",
    "–Apparel Category: Combat Clothing/Standard Clothing",
    "–Prerequisites: 2+ Skill Ranks in Clairvoyance and Use Magic",
    "–Quality Slots: 1",
    "–Effects: Increase the Dice Score of your Use Magic and Clairvoyance Skill Checks by 1."
  ]);
  check("in the index", INDEX.traits.includes("crafting/apparel-qualities/mystical.dbu"), true);
  check("1 Quality Slot, on Combat Clothing and Standard Clothing",
    [qualitySlotRange(mystical), ["armor", "weights", "combat-clothing", "standard-clothing"]
      .map(category => qualityFits(mystical, category))],
    [{ min: 1, max: 1, ranged: false }, [false, false, true, true]]);

  // Worn, through the engine, by one with the Ranks in both, in one, and in neither.
  const piece = (category = "combat-clothing") => {
    const data = craftedItemFrom("apparel", null, getTrait);
    made++;
    return { ...data, id: `mystic${made}`, uuid: `Actor.a.Item.mystic${made}`,
      system: { ...data.system, equipped: true, crafted: { ...data.system.crafted, effects: null, category,
        qualities: [{ id: "mystical", slots: 1, choice: "" }] } } };
  };
  const trained = (items, ranks) => {
    const parent = new ActorStub({}, { strict: false });
    parent.items = items;
    parent.uuid = ME;
    const rows = [
      { lvl: 1, choice: "Skill Improvement", locked: true, attributes: {}, skillRanks: ranks[0] },
      { lvl: 2, choice: "Skill Improvement", locked: false, attributes: {}, skillRanks: ranks[1] }
    ];
    const model = new DBUCharacterData({ powerLevel: 2, progression: rows }, { parent, strict: false });
    parent.system = model;
    model.prepareBaseData?.();
    model.prepareDerivedData();
    return model;
  };
  const both = [["clairvoyance", "clairvoyance"], ["useMagic", "useMagic"]];
  const one = [["clairvoyance", "clairvoyance"], ["perception", "perception"]];
  const rolls = (model, bare) => Object.fromEntries(Object.entries(model.skills)
    .map(([key, skill]) => [key, skill.roll - bare.skills[key].roll]).filter(([, change]) => change));
  const bareBoth = trained([], both);
  check("the wearer to measure against has the Ranks in both",
    [bareBoth.skills.clairvoyance.ranks, bareBoth.skills.useMagic.ranks], [2, 2]);
  check("worn by them: Use Magic and Clairvoyance Checks 1 higher, and no other",
    rolls(trained([piece()], both), bareBoth), { clairvoyance: 1, useMagic: 1 });
  check("worn by one with Ranks in Clairvoyance alone: nothing",
    rolls(trained([piece()], one), trained([], one)), {});
  check("on Armor, which refuses it: nothing", rolls(trained([piece("armor")], both), bareBoth), {});
}

// --- Parrying Armor -------------------------------------------------------------------------------
{
  const { qualityFits, qualitySlotRange, scriptWithPiece } = await import(modUrl("gear.mjs"));
  const parrying = getTrait("parrying-armor");
  check("Parrying Armor is there, an Apparel Quality", [parrying?.kind, parrying?.owner],
    ["crafting", "apparel-qualities"]);
  check("the entry, as printed", printedLines(parrying?.text), [
    "Parrying Armor: This set of armor includes firm bracers used for blocking incoming attacks.",
    "–Apparel Category: Armor",
    "–Prerequisites: N/A",
    "–Quality Slots: 1",
    "–Effects: While you do not have a Weapon equipped, increase your Strike Rolls when using "
      + "the Parry effect of the Defend Maneuver by 1/2 (rounded up) of the Apparel Bonus."
  ]);
  check("in the index", INDEX.traits.includes("crafting/apparel-qualities/parrying-armor.dbu"), true);
  check("1 Quality Slot, on Armor alone",
    [qualitySlotRange(parrying), ["armor", "weights", "combat-clothing", "standard-clothing"]
      .map(category => qualityFits(parrying, category))],
    [{ min: 1, max: 1, ranged: false }, [true, false, false, false]]);
  check("its piece's Apparel Bonus written in, per base Tier",
    scriptWithPiece("parry += ceil($apparelBonus(bT) / 2);", { perBaseTier: 3 }),
    "parry += ceil(3(bT) / 2);");

  const piece = (grade, qualities, category = "armor", equipped = true) => {
    const data = craftedItemFrom("apparel", null, getTrait);
    made++;
    return { ...data, id: `parry${made}`, uuid: `Actor.a.Item.parry${made}`,
      system: { ...data.system, equipped, crafted: { ...data.system.crafted, effects: null, category, grade, qualities } } };
  };
  const on = [{ id: "parrying-armor", slots: 1, choice: "" }];
  const bare = holding([]);
  const bT = bare.baseTierOfPower;
  const parry = model => model.combat.parry - bare.combat.parry;
  check("a base Tier where halves round, to measure with", bT % 2, 1);
  check("Grade 1, a Low Bonus of 1(bT): the Parry half of it, rounded up",
    parry(holding([piece(1, on)])), Math.ceil(bT / 2));
  check("Grade 3, a Standard Bonus of 2(bT): half of it",
    parry(holding([piece(3, on)])), Math.ceil(2 * bT / 2));
  // Dense Armor's own 1(bT) off every Combat Roll lands on the Strike a Parry is made of, so
  // the Parry comes to half the raised Bonus, less that.
  check("with Dense Armor on the piece too: half of the 3(bT) it raises the Bonus to, less its 1(bT)",
    parry(holding([piece(3, [...on, { id: "dense-armor", slots: 1, choice: "" }])])),
    Math.ceil(3 * bT / 2) - bT);
  check("the Parry alone: not the Strike, not the Dodge",
    [holding([piece(3, on)]).combat.strike - bare.combat.strike,
     holding([piece(3, on)]).combat.dodge - bare.combat.dodge], [0, 0]);
  check("not worn, or on Weights: nothing - past what the Weights take off themselves",
    [parry(holding([piece(3, on, "armor", false)])),
     holding([piece(3, on, "weights")]).combat.parry - holding([piece(3, [], "weights")]).combat.parry],
    [0, 0]);
  check("only with no Weapon in hand",
    /if \(!wieldingWeapon\) \{/.test(parrying?.script ?? ""), true);
}

// --- Segmented Weight -----------------------------------------------------------------------------
{
  const { qualityFits, qualitySlotRange, doffRounds } = await import(modUrl("gear.mjs"));
  const segmented = getTrait("segmented-weight");
  check("Segmented Weight is there, an Apparel Quality", [segmented?.kind, segmented?.owner],
    ["crafting", "apparel-qualities"]);
  check("the entry, as printed", printedLines(segmented?.text), [
    "Segmented Weight: You can remove these weights in increments, or all at once.",
    "–Apparel Category: Weights",
    "–Prerequisites: N/A",
    "–Quality Slots: 1~2",
    "–Effects: For each Quality Slot this Quality occupies, increase the duration of the Doff "
      + "Bonus for doffing this piece of Apparel for the first time in a Combat Encounter by 1 "
      + "Combat Round."
  ]);
  check("in the index", INDEX.traits.includes("crafting/apparel-qualities/segmented-weight.dbu"), true);
  check("1 or 2 Quality Slots, asked, on Weights alone",
    [qualitySlotRange(segmented), ["armor", "weights", "combat-clothing", "standard-clothing"]
      .map(category => qualityFits(segmented, category))],
    [{ min: 1, max: 2, ranged: true }, [false, true, false, false]]);

  const piece = (slots, category = "weights") => ({ system: { crafted: { kind: "apparel", category,
    grade: 3, qualities: [{ id: "segmented-weight", slots, choice: "" }] } } });
  check("a Round longer for each Slot it takes: 1, or 2",
    [doffRounds(piece(1), getTrait), doffRounds(piece(2), getTrait)], [1, 2]);
  check("never past its range, and nothing on a Category that refuses it",
    [doffRounds(piece(5), getTrait), doffRounds(piece(2, "armor"), getTrait),
     doffRounds({ system: { crafted: { kind: "apparel", category: "weights", grade: 3, qualities: [] } } }, getTrait)],
    [2, 0, 0]);
  check("two Slots of it count towards the piece's Slots used",
    craftedReading({ kind: "apparel", category: "weights", grade: 2,
      qualities: [{ id: "segmented-weight", slots: 2, choice: "" }] },
      { getTrait, difficulties: DIFFICULTIES }).used, 2);
}

// --- Sleek Design ---------------------------------------------------------------------------------
{
  const { qualityFits, qualitySlotRange } = await import(modUrl("gear.mjs"));
  const sleek = getTrait("sleek-design");
  check("Sleek Design is there, an Apparel Quality", [sleek?.kind, sleek?.owner],
    ["crafting", "apparel-qualities"]);
  check("the entry, as printed", printedLines(sleek?.text), [
    "Sleek Design: Light and flexible, this armor allows for a freer range of motion, but provides "
      + "less protection.",
    "–Apparel Category: Armor",
    "–Prerequisites: N/A",
    "–Quality Slots: 1",
    "–Effects: Halve the Damage Reduction gained from this Armor. This Armor does not count "
      + "towards your Apparel Penalty."
  ]);
  check("in the index", INDEX.traits.includes("crafting/apparel-qualities/sleek-design.dbu"), true);
  check("1 Quality Slot, on Armor alone",
    [qualitySlotRange(sleek), ["armor", "weights", "combat-clothing", "standard-clothing"]
      .map(category => qualityFits(sleek, category))],
    [{ min: 1, max: 1, ranged: false }, [true, false, false, false]]);

  const reading = (category, qualities) => craftedReading({ kind: "apparel", category, grade: 3,
    qualities }, { getTrait, difficulties: DIFFICULTIES });
  const on = [{ id: "sleek-design", slots: 1, choice: "" }];
  check("its Armor's Damage Reduction halved, and out of the Apparel Penalty",
    [reading("armor", on).armorDamageReduction, reading("armor", on).countsForPenalty], [0.5, false]);
  check("an Armor without it: whole, and counted",
    [reading("armor", []).armorDamageReduction, reading("armor", []).countsForPenalty], [1, true]);
  check("Lightweight takes it out of the Penalty the same way",
    reading("combat-clothing", [{ id: "lightweight", slots: 1, choice: "" }]).countsForPenalty, false);
  check("on a Category that refuses it: nothing",
    [reading("weights", on).armorDamageReduction, reading("weights", on).countsForPenalty], [1, true]);
}

// --- Spiked ---------------------------------------------------------------------------------------
{
  const { qualityFits, qualitySlotRange, spikesOf } = await import(modUrl("gear.mjs"));
  const CHAT = read("module", "chat.mjs");
  const spiked = getTrait("spiked");
  check("Spiked is there, an Apparel Quality", [spiked?.kind, spiked?.owner],
    ["crafting", "apparel-qualities"]);
  check("the entry, as printed", printedLines(spiked?.text), [
    "Spiked: This armor is covered in sharpened spikes to retaliate against anyone who tries to "
      + "strike you.",
    "–Apparel Category: Armor",
    "–Prerequisites: N/A",
    "–Quality Slots: 1",
    "–Effects: When you are struck by an Unarmed Physical Attack from an Opponent on an "
      + "adjacent Square to you, reduce their Life Points by the Apparel Bonus for this piece of Armor."
  ]);
  check("in the index", INDEX.traits.includes("crafting/apparel-qualities/spiked.dbu"), true);
  check("1 Quality Slot, on Armor alone",
    [qualitySlotRange(spiked), ["armor", "weights", "combat-clothing", "standard-clothing"]
      .map(category => qualityFits(spiked, category))],
    [{ min: 1, max: 1, ranged: false }, [true, false, false, false]]);

  const piece = (grade, qualities, category = "armor", equipped = true) => {
    const data = craftedItemFrom("apparel", null, getTrait);
    made++;
    return { ...data, id: `spike${made}`, uuid: `Actor.a.Item.spike${made}`,
      system: { ...data.system, equipped, crafted: { ...data.system.crafted, effects: null, category, grade, qualities } } };
  };
  const on = [{ id: "spiked", slots: 1, choice: "" }];
  const amounts = (items, baseTier) => spikesOf(items, getTrait, baseTier).map(entry => entry.amount);
  check("its piece's Apparel Bonus at the wearer's base Tier: Grade 3's 2(bT), at 3 is 6",
    amounts([piece(3, on)], 3), [6]);
  check("Dense Armor on the piece raises what it takes: 3(bT), 9",
    amounts([piece(3, [...on, { id: "dense-armor", slots: 1, choice: "" }])], 3), [9]);
  check("not worn, on Weights, or a piece without it: no spikes",
    [amounts([piece(3, on, "armor", false)], 3), amounts([piece(3, on, "weights")], 3),
     amounts([piece(3, [])], 3)], [[], [], []]);

  check("posted when an Unarmed Physical Attack hits the one wearing it - Damage or not",
    CHAT.includes('if (attacker && own.hit && !isAbsoluteMiss(own) && (attack.foundation === "physical")\n'
      + "    && (!attack.weapon || attack.weapon.unarmed)) {\n    await postGearSpikes(target, attacker);"), true);
  check("the button for the GM and whoever plays the wearer, gone once pressed",
    [CHAT.includes("if (!spikes || spikes.applied) return;"),
     CHAT.includes("if (!game.user.isGM && !wearer?.isOwner) return;"),
     CHAT.includes('requestEdit(message, { type: "spikes", spikes: { ...spikes, applied: true } });')],
    [true, true, true]);
  check("pressed, the one who struck loses that many Life Points",
    CHAT.includes("await reduceLifePoints(attacker, spikes.amount, { reason: spikes.itemName });"), true);
  check("and it is drawn and recorded like every other card",
    [CHAT.includes("  renderGearSpikes(message, html);"),
     CHAT.includes('case "spikes": return game.messages.get(request.messageId)')], [true, true]);
}

// --- Stretching -----------------------------------------------------------------------------------
{
  const { qualityFits, qualitySlotRange, apparelSize } = await import(modUrl("gear.mjs"));
  const stretching = getTrait("stretching");
  check("Stretching is there, an Apparel Quality", [stretching?.kind, stretching?.owner],
    ["crafting", "apparel-qualities"]);
  check("the entry, as printed", printedLines(stretching?.text), [
    "Stretching: It expands to almost ANY size.",
    "–Apparel Category: All",
    "–Prerequisites: N/A",
    "–Quality Slots: 1",
    "–Effects: This piece of Apparel’s Size Category is the current Size Category of this "
      + "piece of Apparel’s wearer."
  ]);
  check("in the index", INDEX.traits.includes("crafting/apparel-qualities/stretching.dbu"), true);
  check("1 Quality Slot, on any Category",
    [qualitySlotRange(stretching), ["armor", "weights", "combat-clothing", "standard-clothing"]
      .map(category => qualityFits(stretching, category))],
    [{ min: 1, max: 1, ranged: false }, [true, true, true, true]]);

  const piece = qualities => ({ system: { crafted: { kind: "apparel", category: "combat-clothing",
    grade: 2, size: "medium", qualities } } });
  const giant = { system: { size: { key: "gigantic", chosen: "large" } } };
  check("made for Medium, it is Medium on anyone",
    apparelSize(piece([]), giant, getTrait), "medium");
  check("Stretching, it is its wearer's current Size - not the one they chose",
    apparelSize(piece([{ id: "stretching", slots: 1, choice: "" }]), giant, getTrait), "gigantic");
  check("and with nobody wearing it, the Size it was made for",
    apparelSize(piece([{ id: "stretching", slots: 1, choice: "" }]), null, getTrait), "medium");
  check("its sheet says the Size is its wearer's",
    [ITEM_PAGE.includes("{{#if crafted.stretches}}"), ITEM_SHEET.includes("stretches: reading.sizeIsWearers,")],
    [true, true]);
}

// --- Team Outfit ----------------------------------------------------------------------------------
{
  const { qualityFits, qualitySlotRange } = await import(modUrl("gear.mjs"));
  const team = getTrait("team-outfit");
  check("Team Outfit is there, an Apparel Quality", [team?.kind, team?.owner],
    ["crafting", "apparel-qualities"]);
  check("the entry, as printed", printedLines(team?.text), [
    "Team Outfit: Bearing an emblem synonymous with the team you are part of, this outfit shows "
      + "your team pride!",
    "–Apparel Category: All",
    "–Prerequisites: N/A",
    "–Quality Slots: 2",
    "–Effects: When you select this Apparel Quality, choose a Team Name. Each Ally wearing a "
      + "piece of Apparel with this Apparel Quality and the same Team Name increases their Stress "
      + "Bonus by 1 (this bonus does not stack)."
  ]);
  check("in the index", INDEX.traits.includes("crafting/apparel-qualities/team-outfit.dbu"), true);
  check("2 Quality Slots, on any Category",
    [qualitySlotRange(team), ["armor", "weights", "combat-clothing", "standard-clothing"]
      .map(category => qualityFits(team, category))],
    [{ min: 2, max: 2, ranged: false }, [true, true, true, true]]);
  check("a switch of its own, and it does not stack", [team?.toggle, team?.noStack],
    ["With my team", true]);

  const piece = (on, equipped = true) => {
    const data = craftedItemFrom("apparel", null, getTrait);
    made++;
    return { ...data, id: `team${made}`, uuid: `Actor.a.Item.team${made}`,
      system: { ...data.system, equipped, crafted: { ...data.system.crafted, effects: null,
        qualities: [{ id: "team-outfit", slots: 2, choice: "", on }] } } };
  };
  const bare = holding([]);
  const stress = items => holding(items).stressBonus - bare.stressBonus;
  check("worn and switched on: Stress Bonus 1 higher", stress([piece(true)]), 1);
  check("worn and switched off: nothing", stress([piece(false)]), 0);
  check("switched on and not worn: nothing", stress([piece(true, false)]), 0);
  check("two pieces of it switched on: still 1 - it does not stack",
    stress([piece(true), piece(true)]), 1);

  check("the switch drawn on its row, and flipped on the Item",
    [ITEM_PAGE.includes('data-action="toggleQuality"'),
     ITEM_SHEET.includes("toggleQuality: DBUGearSheet._onToggleQuality"),
     ITEM_SHEET.includes(".map((entry, at) => (at === index) ? { ...entry, on: !entry.on } : entry);")],
    [true, true, true]);
}

// --- Terrifying Design ----------------------------------------------------------------------------
{
  const { qualityFits, qualitySlotRange } = await import(modUrl("gear.mjs"));
  const terrifying = getTrait("terrifying-design");
  check("Terrifying Design is there, an Apparel Quality", [terrifying?.kind, terrifying?.owner],
    ["crafting", "apparel-qualities"]);
  check("the entry, as printed", printedLines(terrifying?.text), [
    "Terrifying Design: Thanks to the sinister design of this outfit, you look even more menacing.",
    "\u2013Apparel Category: Armor/Combat Clothing/Standard Clothing",
    "\u2013Prerequisites: 2+ Skill Ranks in Intimidation",
    "\u2013Quality Slots: 1",
    "\u2013Effects: Increase the Dice Score of your Intimidation Skill Checks by 2."
  ]);
  check("in the index", INDEX.traits.includes("crafting/apparel-qualities/terrifying-design.dbu"), true);
  check("1 Quality Slot, on every Category but Weights",
    [qualitySlotRange(terrifying), ["armor", "weights", "combat-clothing", "standard-clothing"]
      .map(category => qualityFits(terrifying, category))],
    [{ min: 1, max: 1, ranged: false }, [true, false, true, true]]);

  const piece = (category = "armor") => {
    const data = craftedItemFrom("apparel", null, getTrait);
    made++;
    return { ...data, id: `terror${made}`, uuid: `Actor.a.Item.terror${made}`,
      system: { ...data.system, equipped: true, crafted: { ...data.system.crafted, effects: null, category,
        qualities: [{ id: "terrifying-design", slots: 1, choice: "" }] } } };
  };
  const trained = (items, ranks) => {
    const parent = new ActorStub({}, { strict: false });
    parent.items = items;
    parent.uuid = ME;
    const model = new DBUCharacterData({ powerLevel: 1, progression: [
      { lvl: 1, choice: "Skill Improvement", locked: true, attributes: {}, skillRanks: ranks }] },
      { parent, strict: false });
    parent.system = model;
    model.prepareBaseData?.();
    model.prepareDerivedData();
    return model;
  };
  const rolls = (model, bare) => Object.fromEntries(Object.entries(model.skills)
    .map(([key, skill]) => [key, skill.roll - bare.skills[key].roll]).filter(([, change]) => change));
  const two = ["intimidation", "intimidation"];
  const one = ["intimidation", "perception"];
  check("the wearer to measure against has 2 Ranks", trained([], two).skills.intimidation.ranks, 2);
  check("worn by them: Intimidation Checks 2 higher, and no other",
    rolls(trained([piece()], two), trained([], two)), { intimidation: 2 });
  check("worn by one with a single Rank: nothing", rolls(trained([piece()], one), trained([], one)), {});
  check("on Weights, which refuses it: nothing", rolls(trained([piece("weights")], two), trained([], two)), {});
}

// --- Training Support -----------------------------------------------------------------------------
{
  const { qualityFits, qualitySlotRange, weightsPenaltyWaived } = await import(modUrl("gear.mjs"));
  const training = getTrait("training-support");
  check("Training Support is there, an Apparel Quality", [training?.kind, training?.owner],
    ["crafting", "apparel-qualities"]);
  check("the entry, as printed", printedLines(training?.text), [
    "Training Support: This outfit is heavy, but doesn\u2019t restrict your movement.",
    "\u2013Apparel Category: Weights",
    "\u2013Prerequisites: 2+ Skill Ranks in the Concealment Skill",
    "\u2013Quality Slots: 2",
    "\u2013Effects: If you possess any stacks of Holding Back while wearing this Apparel, you may "
      + "ignore the reduction to your Combat Rolls from the effects of the Weight Apparel Category."
  ]);
  check("in the index", INDEX.traits.includes("crafting/apparel-qualities/training-support.dbu"), true);
  check("2 Quality Slots, on Weights alone",
    [qualitySlotRange(training), ["armor", "weights", "combat-clothing", "standard-clothing"]
      .map(category => qualityFits(training, category))],
    [{ min: 2, max: 2, ranged: false }, [false, true, false, false]]);

  const piece = (qualities, category = "weights") => ({ system: { crafted: { kind: "apparel",
    category, grade: 3, qualities } } });
  const on = [{ id: "training-support", slots: 2, choice: "" }];
  const wearer = (ranks, stacks) => ({ system: { skills: { concealment: { ranks } },
    resources: { holdingback: { stacks } } } });
  check("Holding Back with 2+ Ranks in Concealment: the Weights' reduction left off",
    weightsPenaltyWaived(piece(on), wearer(2, 1), getTrait), true);
  check("not Holding Back, or with a single Rank: kept",
    [weightsPenaltyWaived(piece(on), wearer(2, 0), getTrait),
     weightsPenaltyWaived(piece(on), wearer(1, 3), getTrait)], [false, false]);
  check("a piece without it, or on a Category that refuses it: kept",
    [weightsPenaltyWaived(piece([]), wearer(4, 3), getTrait),
     weightsPenaltyWaived(piece(on, "armor"), wearer(4, 3), getTrait)], [false, false]);
}

// --- Weather Resistant ----------------------------------------------------------------------------
{
  const { qualityFits, qualitySlotRange, qualityChoices, qualityChoiceLabel, weatherResisted } =
    await import(modUrl("gear.mjs"));
  const resistant = getTrait("weather-resistant");
  check("Weather Resistant is there, an Apparel Quality", [resistant?.kind, resistant?.owner],
    ["crafting", "apparel-qualities"]);
  check("the entry, as printed", printedLines(resistant?.text), [
    "Weather Resistant: Built to withstand extreme weather, this clothing protects you from one "
      + "specific weather type.",
    "–Apparel Category: All",
    "–Prerequisites: 2+ Skill Ranks in the Survival Skill",
    "–Quality Slots: 1~3",
    "–Effects: When you gain this Quality, choose any type of Battle Weather. Treat the Weather "
      + "Tier as if it was x Weather Tiers lower, where x is equal to the number of Quality Slots "
      + "occupied by this Apparel Quality. If this would treat the Weather Tier as if it was 0 or "
      + "less, completely ignore the effects of that Battle Weather."
  ]);
  check("in the index", INDEX.traits.includes("crafting/apparel-qualities/weather-resistant.dbu"), true);
  check("1 to 3 Quality Slots, asked, on any Category",
    [qualitySlotRange(resistant), ["armor", "weights", "combat-clothing", "standard-clothing"]
      .map(category => qualityFits(resistant, category))],
    [{ min: 1, max: 3, ranged: true }, [true, true, true, true]]);
  const weathers = Object.fromEntries(traitsOfKind("battlefields").filter(trait => trait.weather === true)
    .map(trait => [trait.id, { label: trait.name }]));
  check("chosen among the Battle Weathers there are, each by name",
    [qualityChoices(resistant, DBUCharacterData.SKILLS, weathers).sort(), Object.keys(weathers).sort(),
     qualityChoiceLabel(resistant, "cold-weather", DBUCharacterData.SKILLS, weathers)],
    [Object.keys(weathers).sort(), Object.keys(weathers).sort(), getTrait("cold-weather").name]);

  const piece = (slots, choice = "cold-weather") => {
    const data = craftedItemFrom("apparel", null, getTrait);
    made++;
    return { ...data, id: `wres${made}`, uuid: `Actor.a.Item.wres${made}`,
      system: { ...data.system, equipped: true, crafted: { ...data.system.crafted, effects: null,
        qualities: [{ id: "weather-resistant", slots, choice }] } } };
  };
  // The wearer, as the piece's own `if (survival.ranks >= 2)` reads them.
  const survivalOf = ranks => ({ skills: { survival: { ranks } } });
  check("a Tier lower for each Slot, for the chosen Weather alone, with 2+ Ranks in Survival",
    [weatherResisted([piece(2)], "cold-weather", getTrait, survivalOf(2)),
     weatherResisted([piece(2)], "hot-weather", getTrait, survivalOf(2)),
     weatherResisted([piece(2)], "cold-weather", getTrait, survivalOf(1))], [2, 0, 0]);

  // Standing in Cataclysmic Cold Weather, through the whole engine: Saving Throws 1(WT) lower,
  // and Surgency halved at Tier 2 and up.
  const inCold = (items, survival) => {
    const parent = new ActorStub({}, { strict: false });
    parent.items = items;
    parent.uuid = ME;
    const model = new DBUCharacterData({ powerLevel: 10, progression: [
      { lvl: 1, choice: "Skill Improvement", locked: true, attributes: {}, skillRanks: survival },
      ...progressionTo(10).slice(1)],
      battlefield: { weather: { id: "cold-weather", tier: 3 } } }, { parent, strict: false });
    parent.system = model;
    model.prepareBaseData?.();
    model.prepareDerivedData();
    return model;
  };
  const skilled = ["survival", "survival"];
  const clear = (() => {
    const parent = new ActorStub({}, { strict: false });
    parent.items = [];
    parent.uuid = ME;
    const model = new DBUCharacterData({ powerLevel: 10, progression: [
      { lvl: 1, choice: "Skill Improvement", locked: true, attributes: {}, skillRanks: skilled },
      ...progressionTo(10).slice(1)] }, { parent, strict: false });
    parent.system = model;
    model.prepareBaseData?.();
    model.prepareDerivedData();
    return model;
  })();
  const felt = model => [model.battlefield.weather.felt,
    // Impulsive, which this character's Agility keeps well above what the Weather takes off.
    model.savingThrows.impulsive.value - clear.savingThrows.impulsive.value,
    model.surgency < clear.surgency];
  check("bare in Cataclysmic Cold: felt at 3, Saving Throws 3 lower, Surgency halved",
    felt(inCold([], skilled)), [3, -3, true]);
  check("with 1 Slot of it: felt at 2 - Saving Throws 2 lower, Surgency still halved",
    felt(inCold([piece(1)], skilled)), [2, -2, true]);
  check("with 2 Slots: felt at 1 - 1 lower, and Surgency whole",
    felt(inCold([piece(2)], skilled)), [1, -1, false]);
  check("with 3 Slots: felt at 0 - the Weather ignored altogether",
    felt(inCold([piece(3)], skilled)), [0, 0, false]);
  // Ignored is not gathered at all: some Weathers do things that are not written in (WT), and
  // those have to go too.
  const weatherSources = model => model.effects.programs.map(entry => entry.sourceId)
    .filter(id => id === "battlefield:cold-weather");
  check("at 0 the Weather's effects are not gathered at all; above it they are",
    [weatherSources(inCold([piece(3)], skilled)), weatherSources(inCold([piece(2)], skilled))],
    [[], ["battlefield:cold-weather"]]);
  check("for a wearer without the Ranks in Survival: nothing lowered",
    felt(inCold([piece(3)], ["perception", "perception"])).slice(0, 1), [3]);
  check("the Tier set on the Battlefield stays as set",
    inCold([piece(3)], skilled).battlefield.weather.tier, 3);
}

// --- Combat Ready ---------------------------------------------------------------------------------
{
  const { qualityFits, qualitySlotRange } = await import(modUrl("gear.mjs"));
  const ready = getTrait("combat-ready");
  check("Combat Ready is there, a Special Apparel Quality", [ready?.kind, ready?.owner, ready?.special],
    ["crafting", "apparel-qualities", true]);
  check("the entry, as printed", printedLines(ready?.text), [
    "Combat Ready: This set of clothing gives you such wonderful freedom of movement, it\u2019s like "
      + "you\u2019re wearing nothing at all.",
    "\u2013Apparel Category: All (Except Weights)",
    "\u2013Prerequisites: N/A",
    "\u2013Quality Slots: 1",
    "\u2013Effects: Increase your Strike and Dodge Rolls by 1/2 (rounded up) of your Apparel Bonus."
  ]);
  check("in the index", INDEX.traits.includes("crafting/apparel-qualities/combat-ready.dbu"), true);
  check("1 Quality Slot, on every Category but Weights",
    [qualitySlotRange(ready), ["armor", "weights", "combat-clothing", "standard-clothing"]
      .map(category => qualityFits(ready, category))],
    [{ min: 1, max: 1, ranged: false }, [true, false, true, true]]);

  const piece = (grade, category = "combat-clothing", equipped = true) => {
    const data = craftedItemFrom("apparel", null, getTrait);
    made++;
    return { ...data, id: `ready${made}`, uuid: `Actor.a.Item.ready${made}`,
      system: { ...data.system, equipped, crafted: { ...data.system.crafted, effects: null, category, grade,
        qualities: [{ id: "combat-ready", slots: 1, choice: "", on: false }] } } };
  };
  const bare = holding([]);
  const bT = bare.baseTierOfPower;
  const without = (grade, category = "combat-clothing") => {
    const made_ = piece(grade, category);
    return { ...made_, system: { ...made_.system, crafted: { ...made_.system.crafted, qualities: [] } } };
  };
  const rollsOver = (model, baseline) => [model.combat.strike - baseline.combat.strike,
    model.combat.dodge - baseline.combat.dodge];
  check("Grade 3, a Standard Bonus of 2(bT): Strike and Dodge higher by half of it",
    rollsOver(holding([piece(3)]), holding([without(3)])), [bT, bT]);
  check("Grade 5, a High Bonus of 3(bT): half, rounded up",
    rollsOver(holding([piece(5)]), holding([without(5)])), [Math.ceil(3 * bT / 2), Math.ceil(3 * bT / 2)]);
  const rolls = model => [model.combat.strike - bare.combat.strike, model.combat.dodge - bare.combat.dodge];
  check("not worn, or on Weights: nothing - past what the Weights take off themselves",
    [rolls(holding([piece(3, "combat-clothing", false)])),
     rollsOver(holding([piece(3, "weights")]), holding([without(3, "weights")]))],
    [[0, 0], [0, 0]]);
  check("offered with the Special Apparel Qualities",
    craftedReading({ kind: "apparel", category: "armor", grade: 5,
      qualities: [{ id: "combat-ready", slots: 1 }] }, { getTrait, difficulties: DIFFICULTIES }).specials, 1);
}

// --- Divine Apparel -------------------------------------------------------------------------------
{
  const { qualityFits, qualitySlotRange } = await import(modUrl("gear.mjs"));
  const divine = getTrait("divine-apparel");
  check("Divine Apparel is there, a Special Apparel Quality", [divine?.kind, divine?.owner, divine?.special],
    ["crafting", "apparel-qualities", true]);
  check("the entry, as printed", printedLines(divine?.text), [
    "Divine Apparel: This article of clothing is empowered by a divine entity.",
    "\u2013Apparel Category: All",
    "\u2013Prerequisites: N/A",
    "\u2013Quality Slots: 1",
    "\u2013Effects: Increase your Apparel Bonus by 1(bT)."
  ]);
  check("in the index", INDEX.traits.includes("crafting/apparel-qualities/divine-apparel.dbu"), true);
  check("1 Quality Slot, on any Category",
    [qualitySlotRange(divine), ["armor", "weights", "combat-clothing", "standard-clothing"]
      .map(category => qualityFits(divine, category))],
    [{ min: 1, max: 1, ranged: false }, [true, true, true, true]]);

  const reading = qualities => craftedReading({ kind: "apparel", category: "weights", grade: 1,
    qualities }, { getTrait, difficulties: DIFFICULTIES, baseTier: 3 });
  check("the piece's Apparel Bonus 1(bT) higher: Low's 1(bT) to 2(bT), 6 at base Tier 3",
    [reading([{ id: "divine-apparel", slots: 1 }]).perBaseTier, reading([{ id: "divine-apparel", slots: 1 }]).bonus],
    [2, 6]);
  check("and what reads the Bonus reads it raised: Combat Ready on the same piece",
    (() => {
      const data = craftedItemFrom("apparel", null, getTrait);
      made++;
      const item = { ...data, id: `divine${made}`, uuid: `Actor.a.Item.divine${made}`,
        system: { ...data.system, equipped: true, crafted: { ...data.system.crafted, effects: null,
          category: "combat-clothing", grade: 1,
          qualities: [{ id: "combat-ready", slots: 1 }, { id: "divine-apparel", slots: 1 }] } } };
      const bare = holding([]);
      return holding([item]).combat.strike - bare.combat.strike;
    })(), Math.ceil(2 * holding([]).baseTierOfPower / 2));
}

// --- Legacy ---------------------------------------------------------------------------------------
{
  const { qualityFits, qualitySlotRange } = await import(modUrl("gear.mjs"));
  const CHAT = read("module", "chat.mjs");
  const legacy = getTrait("legacy");
  check("Legacy is there, a Special Apparel Quality", [legacy?.kind, legacy?.owner, legacy?.special],
    ["crafting", "apparel-qualities", true]);
  check("the entry, as printed", printedLines(legacy?.text), [
    "Legacy: Passed down from parent to child or master to student, this outfit helps you remember "
      + "those who have placed their hopes and faith in you.",
    "–Apparel Category: All (except Weights)",
    "–Prerequisites: N/A",
    "–Quality Slots: 1",
    "–Effects: Increase the Natural Result for all Steadfast Checks and Saving Throws by 2."
  ]);
  check("in the index", INDEX.traits.includes("crafting/apparel-qualities/legacy.dbu"), true);
  check("1 Quality Slot, on every Category but Weights",
    [qualitySlotRange(legacy), ["armor", "weights", "combat-clothing", "standard-clothing"]
      .map(category => qualityFits(legacy, category))],
    [{ min: 1, max: 1, ranged: false }, [true, false, true, true]]);

  const piece = (category = "combat-clothing", equipped = true) => {
    const data = craftedItemFrom("apparel", null, getTrait);
    made++;
    return { ...data, id: `legacy${made}`, uuid: `Actor.a.Item.legacy${made}`,
      system: { ...data.system, equipped, crafted: { ...data.system.crafted, effects: null, category,
        qualities: [{ id: "legacy", slots: 1 }] } } };
  };
  const moved = model => [model.saveNatural, model.steadfast.natural];
  check("bare: nothing moves either die", moved(holding([])), [0, 0]);
  check("worn: the Saving Throws' and the Steadfast Check's Natural Result 2 higher",
    moved(holding([piece()])), [2, 2]);
  check("not worn, or on Weights: nothing", [moved(holding([piece("combat-clothing", false)])),
    moved(holding([piece("weights")]))], [[0, 0], [0, 0]]);
  check("the totals themselves untouched: it is the die",
    [holding([piece()]).savingThrows.morale.value, holding([piece()]).steadfast.bonus],
    [holding([]).savingThrows.morale.value, holding([]).steadfast.bonus]);

  // Rolled with it wherever one is rolled.
  const SHEET_TEXT = read("module", "sheets", "actor-character-sheet.mjs");
  check("a Saving Throw off the sheet, and one in a Clash, move their die by it",
    [SHEET_TEXT.includes("naturalAdd: Number(this.actor.system.saveNatural) || 0"),
     CHAT.includes("naturalAdd: (Number(actor.system.saveNatural) || 0) + uniqueNatural(actor, clash, uuid),")], [true, true]);
  check("a Steadfast Check carries it as a term of its own, named",
    [CHAT.includes("const { die, bonus, target, natural = 0 } = actor.system.steadfast;"),
     CHAT.includes('natural ? `${natural}[Natural Result]` : ""')], [true, true]);
}

// --- Resolute Belief ------------------------------------------------------------------------------
{
  const { qualityFits, qualitySlotRange } = await import(modUrl("gear.mjs"));
  const resolute = getTrait("resolute-belief");
  check("Resolute Belief is there, a Special Apparel Quality",
    [resolute?.kind, resolute?.owner, resolute?.special], ["crafting", "apparel-qualities", true]);
  check("the entry, as printed", printedLines(resolute?.text), [
    "Resolute Belief: These clothes contribute to your morale, allowing you to draw on memories of "
      + "the cause you fight for.",
    "\u2013Apparel Category: All",
    "\u2013Prerequisites: N/A",
    "\u2013Quality Slots: 1",
    "\u2013Effects: Increase your Stress Bonus by 2."
  ]);
  check("in the index", INDEX.traits.includes("crafting/apparel-qualities/resolute-belief.dbu"), true);
  check("1 Quality Slot, on any Category",
    [qualitySlotRange(resolute), ["armor", "weights", "combat-clothing", "standard-clothing"]
      .map(category => qualityFits(resolute, category))],
    [{ min: 1, max: 1, ranged: false }, [true, true, true, true]]);

  const piece = (qualities, equipped = true) => {
    const data = craftedItemFrom("apparel", null, getTrait);
    made++;
    return { ...data, id: `resolute${made}`, uuid: `Actor.a.Item.resolute${made}`,
      system: { ...data.system, equipped, crafted: { ...data.system.crafted, effects: null, qualities } } };
  };
  const bare = holding([]);
  const stress = items => holding(items).stressBonus - bare.stressBonus;
  check("worn: Stress Bonus 2 higher", stress([piece([{ id: "resolute-belief", slots: 1 }])]), 2);
  check("not worn: nothing", stress([piece([{ id: "resolute-belief", slots: 1 }], false)]), 0);
  check("beside a switched-on Team Outfit on the same piece: 3",
    stress([piece([{ id: "resolute-belief", slots: 1 }, { id: "team-outfit", slots: 2, on: true }])]), 3);
}

// --- Unbreakable ----------------------------------------------------------------------------------
{
  const { qualityFits, qualitySlotRange, qualityInactive } = await import(modUrl("gear.mjs"));
  const unbreakable = getTrait("unbreakable");
  check("Unbreakable is there, a Special Apparel Quality",
    [unbreakable?.kind, unbreakable?.owner, unbreakable?.special], ["crafting", "apparel-qualities", true]);
  check("the entry, as printed", printedLines(unbreakable?.text), [
    "Unbreakable: This outfit is somehow indestructible.",
    "\u2013Apparel Category: All",
    "\u2013Prerequisites: Durable Apparel Quality",
    "\u2013Quality Slots: 1",
    "\u2013Effects: This piece of Apparel cannot have its Break Value reduced."
  ]);
  check("in the index", INDEX.traits.includes("crafting/apparel-qualities/unbreakable.dbu"), true);
  check("1 Quality Slot, on any Category",
    [qualitySlotRange(unbreakable), ["armor", "weights", "combat-clothing", "standard-clothing"]
      .map(category => qualityFits(unbreakable, category))],
    [{ min: 1, max: 1, ranged: false }, [true, true, true, true]]);

  const crafted = qualities => ({ kind: "apparel", category: "armor", grade: 5, qualities });
  const read = qualities => craftedReading(crafted(qualities), { getTrait, difficulties: DIFFICULTIES });
  const alone = [{ id: "unbreakable", slots: 1 }];
  const withDurable = [...alone, { id: "durable", slots: 1 }];
  check("with Durable on the piece: it applies, and its Break Value cannot be reduced",
    [qualityInactive(withDurable[0], crafted(withDurable), getTrait), read(withDurable).unbreakable],
    ["", true]);
  check("without Durable: inactive, and nothing said of its Break Value",
    [qualityInactive(alone[0], crafted(alone), getTrait), read(alone).unbreakable], ["needs Durable", false]);
  check("and a piece with neither can have its Break Value reduced", read([]).unbreakable, false);
}

// --- Special Apparel Qualities -------------------------------------------------------------------
{
  // "These cannot typically be gained through Crafting Apparel ... your ARC should be wary of
  // giving any piece of Apparel more than one Special Apparel Quality." None is given yet, so
  // two are made up for the purpose.
  const special = { plain: { id: "plain", name: "Plain" },
    shiny: { id: "shiny", name: "Shiny", special: true },
    grand: { id: "grand", name: "Grand", special: true } };
  const lookup = id => special[id] ?? getTrait(id);
  const count = qualities => craftedReading({ kind: "apparel", category: "armor", grade: 5,
    qualities }, { getTrait: lookup, difficulties: DIFFICULTIES }).specials;
  check("the Special ones on a piece are counted",
    [count([{ id: "plain" }]), count([{ id: "shiny" }]), count([{ id: "shiny" }, { id: "grand" }])],
    [0, 1, 2]);
  check("more than one is said, and nothing is refused",
    [ITEM_SHEET.includes("specialNote: (reading.specials > 1)"),
     ITEM_PAGE.includes("{{#if crafted.specialNote}}<p class=\"gear-warning\">{{crafted.specialNote}}</p>{{/if}}")],
    [true, true]);
  check("Add Quality offers them apart, as Add Item offers the Special Basic Items",
    [ITEM_SHEET.includes("{ label: `Special ${label} Quality`, choices: offered.filter(choice => choice.special) }"),
     ITEM_PAGE.includes('<li class="gear-quality-group" data-quality-group="{{group.label}}">')],
    [true, true]);
}

// --- A built Item's tabs --------------------------------------------------------------------------
{
  const part = name => read("templates", "parts", `${name}.hbs`);
  const tabOf = text => (text.match(/data-tab="([^"]+)"/) ?? [])[1] ?? "";
  check("four tabs, in the order asked: Description, the piece itself, Qualities, Effects",
    [Object.keys(DBUGearSheetTabs()).join(","), ITEM_SHEET.includes('label: "Description"'),
     ITEM_SHEET.includes('label: "Qualities"'), ITEM_SHEET.includes('label: "Effects"')],
    ["description,crafted,qualities,effects", true, true, true]);
  check("each tab's template is that tab",
    [tabOf(part("gear-description")), tabOf(part("gear-crafted")), tabOf(part("gear-qualities"))],
    ["description", "crafted", "qualities"]);
  check("the middle tab named for what was built, and opened first",
    [ITEM_SHEET.includes('label: tab.label || (context.crafted?.label ?? "")'),
     ITEM_SHEET.includes('tabGroups = { primary: "crafted" };')], [true, true]);
  check("a built Item gets the tabs; any other keeps its one page",
    [ITEM_SHEET.includes('? ["header", "tabs", "description", "crafted", "qualities", "effects"]'),
     ITEM_SHEET.includes(': ["header", "body"];')], [true, true]);
  check("Category, Grade and Size on the piece's tab; Qualities on theirs; the editor on its own",
    [part("gear-crafted").includes('name="system.crafted.category"'),
     part("gear-crafted").includes('name="system.crafted.grade"'),
     part("gear-crafted").includes('name="system.crafted.size"'),
     part("gear-qualities").includes('data-action="addQuality"'),
     part("gear-description").includes("formInput fields.description"),
     /system\.crafted|addQuality/.test(part("gear-description"))],
    [true, true, true, true, true, false]);
  const CSS = read("styles", "dbu-ttrpg.css");
  check("Category, Grade and Size one under the other, each as wide as the tab",
    [part("gear-crafted").includes('<div class="stat-grid gear-stacked">'),
     /\.stat-grid\.gear-stacked \{\s*grid-template-columns: 1fr;/.test(CSS),
     /\.stat-grid\.gear-stacked select \{\s*width: 100%;/.test(CSS)], [true, true, true]);
  // The search: typed into, and the list keeps the Qualities whose name starts with it.
  const { namePrefixMatches } = await import(modUrl("gear.mjs"));
  check("a name matches what has been typed so far, from its first letter",
    ["", "s", "St", "stretch", "Stretching", "tretch", "stretching!", "strex"]
      .map(typed => namePrefixMatches("Stretching", typed)),
    [true, true, true, true, true, false, true, false]);
  check("case, apostrophes and spacing aside",
    [namePrefixMatches("Leader's Insignia", "leaders"), namePrefixMatches("Leader's Insignia", "LEADER'S I"),
     namePrefixMatches("Weather Resistant", "weather  res"), namePrefixMatches("Weather Resistant", "resist")],
    [true, true, true, false]);
  const qualitiesPart = part("gear-qualities");
  check("the button says Add, and the search takes the row",
    [qualitiesPart.includes('data-action="addQuality">Add</button>'), qualitiesPart.includes("Add Quality</button>"),
     /\.gear-quality-search \{\s*flex: 1 1 auto;/.test(CSS),
     /\.gear-quality-search-row \.dbu-clash-button \{\s*flex: 0 0 auto;\s*width: auto;/.test(CSS)],
    [true, false, true, true]);
  check("each option carries its name, and its group's",
    qualitiesPart.includes('data-name="{{choice.name}}" data-group="{{group.label}}"'), true);
  check("the list filtered by the same test, groups with nothing left hidden",
    [ITEM_SHEET.includes("option.hidden = !namePrefixMatches(option.dataset.name, input.value);"),
     ITEM_SHEET.includes("group.hidden = !options.some(option => !option.hidden")], [true, true]);
  check("Add takes the one picked, or the first that starts with what was typed",
    [ITEM_SHEET.includes("const pick = this.#pickedQuality();"),
     ITEM_SHEET.includes(".find(option => namePrefixMatches(option.dataset.name, input.value))")], [true, true]);
  check("Enter never sends the form, and Escape closes the list rather than the sheet",
    [/event\.key === "Enter"\) \{\s*\/\/ Never the form's own Enter\.\s*event\.preventDefault\(\);/.test(ITEM_SHEET),
     /\/\/ Closes the list, not the sheet\.\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);/.test(ITEM_SHEET)],
    [true, true]);
  check("the groups the sheet hands the list carry each Quality's plain name",
    ITEM_SHEET.includes("return { value: trait.id, name: trait.name,"), true);
  check("over its Slots: Insufficient Quality Slots, in the chat's yellow and bold",
    /\.gear-insufficient \{[^}]*color: var\(--dbu-chat-accent, #dfe288\);\s*font-weight: bold;/.test(CSS), true);
  check("the search on top of the tab, the Qualities added under it",
    [qualitiesPart.indexOf('<div class="gear-add-quality">') < qualitiesPart.indexOf("{{#each crafted.qualities as |quality|}}"),
     qualitiesPart.indexOf('<div class="gear-add-quality">') > 0], [true, true]);
  check("its list opens over the Qualities, not pushing them down",
    [/\.gear-add-quality \{\s*position: relative;/.test(CSS),
     /\.gear-quality-list \{\s*position: absolute;\s*top: 100%;/.test(CSS)], [true, true]);
  check("and moving through it scrolls the list alone, never the tab",
    [ITEM_SHEET.includes("scrollIntoView("), ITEM_SHEET.includes("list.scrollTop = top;")], [false, true]);
  check("and the plain page holds none of it", /crafted|addQuality/.test(part("gear-sheet")), false);
  check("the window says Item, not TYPES.Item.gear",
    JSON.parse(read("lang", "en.json"))["TYPES.Item.gear"], "Item");
}

// --- The Qualities tab's Effects ----------------------------------------------------------------
{
  const { qualitySummary, EFFECT_TYPES } = await import(modUrl("gear.mjs"));
  const { traitsOfKind } = await import(modUrl("effects/traits.mjs"));
  const qualities = traitsOfKind("crafting", "apparel-qualities");
  const effects = trait => qualitySummary(trait).filter(line => line.type !== "prerequisite");
  // Bar Dynamic, which is the player's own and says nothing until they write it.
  check("every Apparel Quality says what it does, a tagged line at a time",
    qualities.filter(trait => !effects(trait).length && (trait.renameable !== true))
      .map(trait => trait.id), []);
  check("and every line of every summary carries a tag it knows - none dropped",
    qualities.filter(trait => String(trait.summary ?? "").split("\n").filter(Boolean).length
      !== effects(trait).length).map(trait => trait.id), []);
  check("the types, by label, as the rulebook's tags open",
    Object.values(EFFECT_TYPES).map(type => type.label),
    ["Prerequisite", "Passive", "Automatic", "Triggered"]);

  const summary = id => qualitySummary(getTrait(id)).map(line => [line.type, line.label, line.text]);
  check("Hefty Plating: its Prerequisite first as printed, then a Passive and an Automatic",
    summary("hefty-plating"), [
      ["prerequisite", "Prerequisite", "Force Score of 6+"],
      ["passive", "Passive", "The Hardness Value of this piece of Apparel is set to 4."],
      ["automatic", "Automatic", "If you hit an Opponent with this piece of Apparel through the Throw "
        + "Maneuver, make a Might Clash against them. If you win, they are knocked Prone."]]);
  check("Joint Protection happens once an Encounter, and cannot be said no to - the badge the whole tag",
    summary("joint-protection"), [["automatic", "Automatic, 1/Encounter",
      "The first time in a Combat Encounter that your Break Value would be lowered while being at "
        + "its maximum Break Value, your Break Value is not lowered."]]);
  // The words are the rulebook's: every summary, its lines joined back, is its Effects line.
  check("every summary is its Quality's Effects line as printed, word for word",
    qualities.filter(trait => effects(trait).map(line => line.text).join(" ")
      !== (printedLines(trait.text).find(line => line.startsWith("–Effects:")) ?? "")
        .replace("–Effects:", "").trim()).map(trait => trait.id), []);
  check("so do Segmented Weight's first Doff, and Spiked",
    [summary("segmented-weight")[0].slice(0, 2), summary("spiked")[0].slice(0, 2)],
    [["automatic", "Automatic, 1/Encounter"], ["automatic", "Automatic"]]);
  check("the rest Passive", qualities.filter(trait => !["hefty-plating", "joint-protection",
    "segmented-weight", "spiked", "rejuvenating-light"].includes(trait.id))
    .filter(trait => effects(trait).some(line => line.label !== "Passive")).map(trait => trait.id), []);
  check("a Quality with no Prerequisites has no such line",
    summary("combat-ready").map(([type]) => type), ["passive"]);
  check("a Prerequisite is the file's own, word for word, and the first line",
    qualities.filter(trait => trait.prerequisites).every(trait =>
      qualitySummary(trait)[0].text === [].concat(trait.prerequisites).join(", ")), true);
  check("a tag it does not know, a line with none, or one calling itself a Prerequisite: not shown",
    qualitySummary({ summary: "[Passive]: One.\n\n[Magic]: Two.\n\nThree.\n\n[Prerequisite]: Four."
      + "\n\n[Triggered/Start of Turn]: Five." })
      .map(line => [line.label, line.text]), [["Passive", "One."], ["Triggered/Start of Turn", "Five."]]);

  const qualitiesPart = read("templates", "parts", "gear-qualities.hbs");
  const at = text => qualitiesPart.indexOf(text);
  check("between the search and the list",
    [at('<div class="gear-add-quality">') < at('<div class="gear-effects">'),
     at('<div class="gear-effects">') < at("{{#each crafted.qualities as |quality|}}")], [true, true]);
  check("a block to each Quality, named with its choice, a badge to each line",
    [qualitiesPart.includes("{{block.name}}{{#if block.choiceLabel}} &middot; {{block.choiceLabel}}{{/if}}"),
     qualitiesPart.includes('<span class="gear-effect-badge {{line.type}}">{{line.label}}</span>'),
     qualitiesPart.includes('<h4 class="gear-effects-title">Effects</h4>')], [true, true, true]);
  check("held off or switched off: faded, and said",
    [ITEM_SHEET.includes("off: Boolean(inactive) || switchedOff,"),
     ITEM_SHEET.includes('offNote: inactive ? "Inactive" : (switchedOff ? "Switched off" : ""),'),
     qualitiesPart.includes('<div class="gear-effect{{#if block.off}} off{{/if}}">')], [true, true, true]);
  const CSS_TEXT = read("styles", "dbu-ttrpg.css");
  check("each type its own colour",
    ["passive", "automatic", "triggered", "prerequisite"].map(type =>
      new RegExp(`\\.gear-effect-badge\\.${type} \\{`).test(CSS_TEXT)), [true, true, true, true]);
}

// --- A piece's own Effects -------------------------------------------------------------------------
{
  const { composeEffects, effectParts, effectsOf } = GEAR_MODULE;
  const bare = holding([]);
  const bT = bare.baseTierOfPower;
  let at = 0;
  const worn = (qualities, effects, category = "standard-clothing") => {
    const data = craftedItemFrom("apparel", null, getTrait);
    at++;
    return { ...data, id: `own${at}`, uuid: `Actor.a.Item.own${at}`, name: `Piece ${at}`,
      system: { ...data.system, equipped: true, crafted: { ...data.system.crafted, category,
        qualities, effects } } };
  };
  const jacket = [{ id: "jacket", slots: 1, choice: "", on: false }];
  const written = composeEffects({ kind: "apparel", category: "standard-clothing", qualities: jacket },
    "", { getTrait });

  // What is written there is what the piece does - its Qualities' files are not read at all.
  check("its Effects as written: the Jacket's part gives Soak 1(bT)",
    holding([worn(jacket, written)]).soakValue - bare.soakValue, bT);
  check("changed in its part, it does what it says now: 2(bT)",
    holding([worn(jacket, written.replace("soakValue += 1(bT) * 1;", "soakValue += 2(bT);"))]).soakValue
      - bare.soakValue, 2 * bT);
  check("emptied, the Jacket on its list does nothing - the file is not read",
    holding([worn(jacket, "")]).soakValue - bare.soakValue, 0);
  check("a line of its own, with no Quality at all, is as much the piece's",
    holding([worn([], "[passive]\nsoakValue += 3;")]).soakValue - bare.soakValue, 3);
  check("not worn: none of it",
    holding([{ ...worn([], "[passive]\nsoakValue += 3;"), system: { ...worn([], "").system,
      equipped: false, crafted: { ...worn([], "").system.crafted, effects: "[passive]\nsoakValue += 3;" } } }])
      .soakValue - bare.soakValue, 0);
  check("a piece made before Items had Effects reads as its Category and Qualities would write",
    effectsOf({ kind: "apparel", category: "standard-clothing", qualities: jacket, effects: null }, getTrait),
    written);

  // The piece itself, from its own lines.
  const says = effects => craftedReading({ kind: "apparel", category: "armor", grade: 3, qualities: [],
    effects }, { getTrait, difficulties: {} });
  check("what the piece is, from its piece. lines alone",
    (({ breakValue, hardnessValue, perBaseTier, armorDamageReduction, countsForPenalty, unbreakable }) =>
      ({ breakValue, hardnessValue, perBaseTier, armorDamageReduction, countsForPenalty, unbreakable }))(
      says("[passive]\npiece.breakValue += 4;\npiece.hardnessValue = 7;\npiece.apparelBonus += 2;\n"
        + "piece.armorDamageReduction *= 1/2;\npiece.countsForPenalty = false;\npiece.unbreakable = true;")),
    { breakValue: 7, hardnessValue: 7, perBaseTier: 4, armorDamageReduction: 0.5,
      countsForPenalty: false, unbreakable: true });
  check("and with none: as its Grade leaves it",
    [says("").breakValue, says("").hardnessValue, says("").perBaseTier, says("").countsForPenalty],
    [3, null, 2, true]);
  check("a piece. line reaches only the piece, never its wearer's numbers",
    holding([worn([], "[passive]\npiece.breakValue += 4;")]).soakValue, bare.soakValue);

  // Written by its Category and Qualities, between markers.
  const crafted = qualities => ({ kind: "apparel", category: "armor", qualities });
  const both = [{ id: "dense-armor", slots: 1, choice: "", on: false },
    { id: "durable", slots: 1, choice: "", on: false }];
  const first = composeEffects(crafted(both), "", { getTrait });
  check("its Category's part, then each Quality's, in order",
    effectParts(first).map(part => part.key), ["category:armor", "quality:dense-armor", "quality:durable"]);
  check("each part is its file's code, its notes left in the file",
    effectParts(first).find(part => part.id === "durable").body, "[passive]\npiece.breakValue += 3;");
  const edited = first.replace("piece.breakValue += 3;", "piece.breakValue += 9;")
    + "\n\n# mine\n[passive]\nstrike += 1;";
  const removed = composeEffects(crafted(both.slice(1)), edited, { getTrait });
  check("taking a Quality off takes its part out, and leaves every other word as written",
    [effectParts(removed).map(part => part.key ?? "own"), removed.includes("piece.breakValue += 9;"),
     removed.includes("# mine\n[passive]\nstrike += 1;")],
    [["category:armor", "quality:durable", "own"], true, true]);
  const added = composeEffects(crafted([...both.slice(1),
    { id: "joint-protection", slots: 1, choice: "", on: false }]), removed, { getTrait });
  check("a Quality added writes its part after the last part, before the owner's own lines",
    effectParts(added).map(part => part.key ?? "own"),
    ["category:armor", "quality:durable", "quality:joint-protection", "own"]);
  check("Re-sync: all of it replaced by what the Category and Qualities write - edits and own lines gone",
    (text => [text.includes("piece.breakValue += 3;"), text.includes("piece.breakValue += 9;"),
      text.includes("strike += 1;")])(composeEffects(crafted(both.slice(1)), "", { getTrait })),
    [true, false, false]);
  const moved = composeEffects({ kind: "apparel", category: "weights", qualities: both }, first, { getTrait });
  check("a new Category writes its part in place of the old one's, and takes out what it does not take",
    effectParts(moved).map(part => part.key), ["category:weights", "quality:durable"]);
  check("what was chosen, and the Slots given, written in",
    [effectParts(composeEffects({ kind: "apparel", category: "combat-clothing",
      qualities: [{ id: "beautiful-attire", slots: 1, choice: "persuasion" }] }, "", { getTrait }))[1].body
      .includes("skill.persuasion += 2;"),
     effectParts(composeEffects({ kind: "apparel", category: "weights",
      qualities: [{ id: "segmented-weight", slots: 2, choice: "" }] }, "", { getTrait }))[1].body
      .includes("piece.doffRounds += 2;")], [true, true]);
  const team = on => composeEffects({ kind: "apparel", category: "combat-clothing",
    qualities: [{ id: "team-outfit", slots: 2, choice: "", on }] }, "", { getTrait });
  check("a switch keeps its lines as comments while off, and gives them back on",
    [effectParts(team(false))[1].body, effectParts(team(true))[1].body],
    ["#off [passive]\n#off stressBonus += 1;", "[passive]\nstressBonus += 1;"]);
  check("and its part is marked not to stack",
    effectParts(team(true))[1].flags, ["nostack"]);
  const stress = holding([worn([], team(true)), worn([], team(true))]).stressBonus - bare.stressBonus;
  check("two pieces with the same nostack part: once", stress, 1);
  check("the markers are comments to the language: the whole text compiles, its piece's own numbers written in",
    (await import(modUrl("effects/parser.mjs"))).compile(GEAR_MODULE.scriptWithPiece(first, { perBaseTier: 2 })).errors,
    []);

  // On the sheet.
  const EFFECTS_PART = read("templates", "parts", "gear-effects.hbs");
  check("the Effects tab: the text, written to the piece, and whether it compiles",
    [EFFECTS_PART.includes('name="system.crafted.effects"'), EFFECTS_PART.includes("{{crafted.effectsText}}"),
     EFFECTS_PART.includes("{{#each crafted.effectErrors as |problem|}}"),
     EFFECTS_PART.includes('data-action="resyncEffects"') && EFFECTS_PART.includes(">Re-sync</button>")],
    [true, true, true, true]);
  check("adding, removing, switching, freeing and renaming a Quality write the Effects with it",
    (ITEM_SHEET.match(/this\.item\.update\(this\.#withQualities\(qualities\)\)/g) ?? []).length, 5);
  check("a Category changed on the page writes its part, into what the page sent",
    ITEM_SHEET.includes("composeEffects({ ...crafted, category: category ?? crafted.category,"),
    true);
  check("Re-sync asks first, then writes from nothing",
    /_onResyncEffects[\s\S]*?DialogV2\.confirm[\s\S]*?composeEffects\(crafted, "", \{ getTrait \}\)/
      .test(ITEM_SHEET), true);
  check("the registry runs the piece's Effects, never a Quality's file",
    [REGISTRY.includes("const parts = effectParts(effectsOf(item.system.crafted, getTrait))"),
     /function apparelPrograms[\s\S]*?\n}\n/.exec(REGISTRY)?.[0].includes("getTrait(quality.id)")],
    [true, false]);
}

// --- Dynamic ---------------------------------------------------------------------------------------
{
  const { composeEffects, effectParts, qualityName, qualitySlotRange: range, qualityFits: fits } = GEAR_MODULE;
  const dynamic = getTrait("dynamic-quality");
  check("Dynamic is there: an Apparel Quality of the player's own, not a Special one",
    [dynamic?.kind, dynamic?.owner, dynamic?.special === true, dynamic?.renameable,
     INDEX.traits.includes("crafting/apparel-qualities/dynamic-quality.dbu")],
    ["crafting", "apparel-qualities", false, true, true]);
  check("1~3 Quality Slots, the player's to pick, on every Category",
    [range(dynamic), ["armor", "weights", "combat-clothing", "standard-clothing"].map(c => fits(dynamic, c))],
    [{ min: 1, max: 3, ranged: true }, [true, true, true, true]]);
  check("its file writes nothing into a piece", String(dynamic?.script ?? "").split("\n")
    .filter(line => line.trim() && !line.trim().startsWith("#")), []);

  const entry = (name, slots = 2) => ({ id: "dynamic-quality", slots, choice: "", on: false, name });
  check("named by its owner, and called Dynamic until it is",
    [qualityName(entry("Saiyan Pride"), dynamic), qualityName(entry(""), dynamic),
     qualityName(entry("  "), dynamic), qualityName({ id: "durable", name: "Nope" }, getTrait("durable"))],
    ["Saiyan Pride", "Dynamic", "Dynamic", "Durable"]);

  const crafted = (qualities, category = "combat-clothing") => ({ kind: "apparel", category, qualities });
  const empty = composeEffects(crafted([entry("Saiyan Pride")]), "", { getTrait });
  check("its part: under its owner's name, and empty - room to write it",
    effectParts(empty).find(part => part.id === "dynamic-quality"),
    { type: "quality", id: "dynamic-quality", key: "quality:dynamic-quality", flags: [], name: "Saiyan Pride", body: "" });
  const mine = empty.replace("#@ quality dynamic-quality | Saiyan Pride\n#@ end",
    "#@ quality dynamic-quality | Saiyan Pride\n[passive]\nstrike += 2;\n#@ end");
  const renamed = composeEffects(crafted([entry("Blue Aura")]), mine, { getTrait });
  check("renamed: the part goes by the new name, and keeps what was written in it",
    effectParts(renamed).find(part => part.id === "dynamic-quality"),
    { type: "quality", id: "dynamic-quality", key: "quality:dynamic-quality", flags: [], name: "Blue Aura",
      body: "[passive]\nstrike += 2;" });
  check("two of them: a part each",
    effectParts(composeEffects(crafted([entry("One"), entry("Two", 1)]), "", { getTrait }))
      .filter(part => part.id === "dynamic-quality").map(part => [part.key, part.name]),
    [["quality:dynamic-quality", "One"], ["quality:dynamic-quality:2", "Two"]]);

  // Worn: what was written in it applies, under its name.
  const data = craftedItemFrom("apparel", null, getTrait);
  const piece = { ...data, id: "dyn1", uuid: "Actor.a.Item.dyn1", name: "Gi",
    system: { ...data.system, equipped: true, crafted: { ...data.system.crafted, category: "combat-clothing",
      qualities: [entry("Blue Aura")], effects: renamed } } };
  const bare = holding([]);
  check("worn: its Strike 2 higher, from the part the player wrote",
    holding([piece]).combat.strike - bare.combat.strike, 2);
  check("and the workings name it as its owner did",
    programsFor({ items: [piece] }).some(entry => entry.sourceName === "Blue Aura (Gi)"), true);

  // On its row.
  const QUALITIES_PART = read("templates", "parts", "gear-qualities.hbs");
  check("renamed on its own row, the part in the Effects with it",
    [QUALITIES_PART.includes('{{#if quality.renameable}}'),
     QUALITIES_PART.includes('data-quality-rename'),
     /#renameQuality\(index, name\)[\s\S]*?this\.item\.update\(this\.#withQualities\(qualities\)\)/.test(ITEM_SHEET),
     ITEM_SHEET.includes("event.stopPropagation();\n        this.#renameQuality(Number(input.dataset.index), input.value);")],
    [true, true, true, true]);
  check("and the name kept with the Quality on the piece",
    read("module", "data", "item-gear.mjs").includes(
      "name: new fields.StringField({ required: true, blank: true, initial: \"\" })"), true);
}

// --- Layers ----------------------------------------------------------------------------------------
{
  const { APPAREL_LAYERS, onLayer } = GEAR_MODULE;
  check("three Layers, top down: Top, Middle, Bottom",
    Object.entries(APPAREL_LAYERS).map(([key, { label }]) => [key, label]),
    [["top", "Top"], ["middle", "Middle"], ["bottom", "Bottom"]]);
  const schema = read("module", "data", "item-gear.mjs");
  check("a piece keeps the Layer it is worn on",
    schema.includes('layer: new fields.StringField({ required: true, blank: true, initial: "",\n'
      + '        choices: ["", "top", "middle", "bottom"] }),'), true);

  const data = craftedItemFrom("apparel", null, getTrait);
  const piece = (id, layer, equipped = true) => ({ ...data, id, name: id, type: "gear",
    system: { ...data.system, equipped, layer } });
  const shirt = piece("shirt", "top");
  const vest = piece("vest", "middle");
  const coat = piece("coat", "", false);
  const items = [shirt, vest, coat];
  check("who is on each Layer, and nobody on a free one",
    [onLayer(items, "top")?.id, onLayer(items, "middle")?.id, onLayer(items, "bottom")], ["shirt", "vest", null]);
  check("a piece is not in its own way", onLayer(items, "top", shirt), null);
  check("taken off, it is on no Layer", onLayer([piece("shirt", "top", false)], "top"), null);
  check("an Accessory is on no Layer", onLayer([{ ...given("helmet"), system: { ...given("helmet").system,
    equipped: true, layer: "top" } }], "top"), null);
  check("worn on a Layer, its Effects run - off it, they do not",
    [holding([{ ...piece("jkt", "top"), system: { ...piece("jkt", "top").system,
      crafted: { ...data.system.crafted, category: "standard-clothing",
        qualities: [{ id: "jacket", slots: 1, choice: "", on: false }], effects: null } } }]).soakValue
      - holding([]).soakValue > 0,
     holding([{ ...piece("jkt", "", false), system: { ...piece("jkt", "", false).system,
      crafted: { ...data.system.crafted, category: "standard-clothing",
        qualities: [{ id: "jacket", slots: 1, choice: "", on: false }], effects: null } } }]).soakValue
      - holding([]).soakValue], [true, 0]);

  // The row and its buttons.
  const SHEET_TEXT = read("module", "sheets", "actor-character-sheet.mjs");
  const TAB = read("templates", "parts", "actor-gear.hbs");
  const action = SHEET_TEXT.slice(SHEET_TEXT.indexOf("static async _onLayerGear("),
    SHEET_TEXT.indexOf("  /**\n   * Put a locking Item on somebody"));
  check("worn: taken off whatever Layer it is on - paid for first, in a Combat Encounter",
    [action.includes('await item.update({ "system.equipped": false, "system.layer": "" });'),
     action.includes("await DBUCharacterSheet.#payToDoff(this.actor, item, unequipCost(items, item));")],
    [true, true]);
  check("not worn: put where the plan says, every piece it moves with it - or refused, and said",
    [action.includes("const { moves, problem } = equipPlan(items, item, layer,"),
     /if \(problem\) \{\s*ui\.notifications\.warn\(problem\);\s*return;\s*\}/.test(action),
     action.includes("if (inCombat && !await spendActions(this.actor, APPAREL_EQUIP_COST)) return;"),
     action.includes('({ _id: id, "system.equipped": true, "system.layer": to })')],
    [true, true, true, true]);
  check("a button for each Layer, closed with the reason; worn, the one Unequip, its cost on hover",
    [TAB.includes('{{#if layer.blocked}}disabled data-tooltip="{{layer.blocked}}"{{else}}'),
     TAB.includes('Unequip{{#if row.layerLabel}} {{row.layerLabel}}{{/if}}</button>'),
     TAB.includes('{{#if row.offCost}}data-tooltip="{{row.offCost}}"{{/if}}'),
     SHEET_TEXT.includes("layerGear: DBUCharacterSheet._onLayerGear,")], [true, true, true, true]);

  // Putting it on, run.
  const { equipPlan, unequipCost, APPAREL_EQUIP_COST } = GEAR_MODULE;
  let n = 0;
  const made = (category, layer = "", qualities = [], size = "medium") => {
    const data = craftedItemFrom("apparel", null, getTrait);
    n++;
    return { ...data, id: `eq${n}`, name: `${category} ${n}`, type: "gear",
      system: { ...data.system, equipped: Boolean(layer), layer,
        crafted: { ...data.system.crafted, category, size, qualities, effects: null } } };
  };
  const wearer = { system: { size: { key: "medium" } } };
  const plan = (items, item, layer, inCombat = false) =>
    equipPlan(items, item, layer, { inCombat, wearer, getTrait });
  const gi = made("combat-clothing");
  check("free: on the Layer asked, alone", plan([gi], gi, "middle"), { moves: [{ id: gi.id, layer: "middle" }], problem: "" });
  const top = made("combat-clothing", "top");
  check("outside a Combat Encounter, a Layer taken is closed",
    plan([top, gi], gi, "top").problem, `${top.name} is on it.`);
  check("in one: 2 Actions, the Top alone, and every piece moved down as far as it has to",
    [APPAREL_EQUIP_COST, plan([top, gi], gi, "middle", true).problem, plan([top, gi], gi, "top", true).moves],
    [2, "In a Combat Encounter it goes on the Top Layer.",
     [{ id: gi.id, layer: "top" }, { id: top.id, layer: "middle" }]]);
  const mid = made("standard-clothing", "middle");
  const bottom = made("standard-clothing", "bottom");
  check("and not at all with no Layer left under the Bottom",
    plan([top, mid, bottom, gi], gi, "top", true).problem, "No Layer is left under the Bottom.");
  check("a gap stops the push: only what is in the way moves",
    plan([top, bottom, gi], gi, "top", true).moves, [{ id: gi.id, layer: "top" }, { id: top.id, layer: "middle" }]);

  const armor = made("armor");
  check("Armor goes on the Top Layer, and whatever is there goes down under it",
    [plan([armor], armor, "middle").problem, plan([top, armor], armor, "top").moves],
    ["Armor must be the Top Layer.", [{ id: armor.id, layer: "top" }, { id: top.id, layer: "middle" }]]);
  const armorOn = made("armor", "top");
  const jacket = made("standard-clothing", "", [{ id: "jacket", slots: 1 }]);
  check("while wearing Armor nothing goes on - but a piece worn over it, which goes on top of it",
    [plan([armorOn, gi], gi, "bottom").problem, plan([armorOn, jacket], jacket, "middle").problem,
     plan([armorOn, jacket], jacket, "top").moves],
    [`Nothing goes on while wearing ${armorOn.name}.`, "It goes on over the Armor.",
     [{ id: jacket.id, layer: "top" }, { id: armorOn.id, layer: "middle" }]]);
  const large = made("combat-clothing", "", [], "large");
  const stretchy = made("combat-clothing", "", [{ id: "stretching", slots: 1 }], "large");
  check("only on a Character of the Size it was made for - or any, Stretching",
    [plan([large], large, "top").problem, plan([stretchy], stretchy, "top").problem],
    ["Made for a Large Character.", ""]);

  check("taken off: 1 Action, and 1 for each Layer worn above it",
    [unequipCost([top, mid, bottom], top), unequipCost([top, mid, bottom], mid),
     unequipCost([top, mid, bottom], bottom), unequipCost([top, bottom], bottom)], [1, 2, 3, 2]);
  const doff = SHEET_TEXT.slice(SHEET_TEXT.indexOf("static async #payToDoff("),
    SHEET_TEXT.indexOf("  /**\n   * Put a locking Item on somebody"));
  check("Loose: the No-Effort Maneuver instead, on their turn, while they have its use - asked, and spent",
    [doff.includes('pieceSlots(item.system.crafted, { getTrait })["piece.doffsWithNoEffort"] === true'),
     doff.includes("isTheirTurn(actor)") && doff.includes("(maneuverUsesLeft(actor, noEffort) > 0)"),
     doff.includes("await recordManeuverUse(actor, noEffort);")], [true, true, true]);
  check("worn Apparel listed first, top down",
    SHEET_TEXT.includes('const worn = row => ((row.wielded || row.active) ? 0 : ["top", "middle", "bottom"].indexOf(row.layer ?? ""));'),
    true);
  check("the pencil opens it, on the Apparel, Weapon and Buddy lists too; the name opens nothing",
    [(TAB.match(/class="gear-control" data-action="editItem"/g) ?? []).length,
     (TAB.match(/<a class="gear-name"/g) ?? []).length], [4, 0]);
}

// --- The Top Layer: the only Category that applies ---------------------------------------------------
{
  const { topLayerPiece, groundIgnored: ignoredBy } = GEAR_MODULE;
  const data = craftedItemFrom("apparel", null, getTrait);
  // A Category part with something measurable in it - homebrew, since no Category's own code
  // reaches its wearer yet - and a Quality part beside it.
  const effects = "#@ category combat-clothing | Combat Clothing\n[passive]\nsoakValue += 5;\n"
    + "piece.ignoresEnvironments = true;\n#@ end\n\n"
    + "#@ quality legacy | Legacy\n[passive]\nsaves.natural += 2;\n#@ end";
  let at = 0;
  const piece = (layer, equipped = true) => {
    at++;
    return { ...data, id: `lay${at}`, uuid: `Actor.a.Item.lay${at}`, name: `Layer ${at}`,
      system: { ...data.system, equipped, layer,
        crafted: { ...data.system.crafted, category: "combat-clothing", qualities: [], effects } } };
  };
  const [top, middle, bottom, off] = [piece("top"), piece("middle"), piece("bottom"), piece("", false)];
  check("the Top Layer is the Top; with none, the Middle; with neither, the Bottom",
    [topLayerPiece([bottom, middle, top])?.id, topLayerPiece([bottom, middle])?.id,
     topLayerPiece([bottom])?.id, topLayerPiece([off]), topLayerPiece([])],
    [top.id, middle.id, bottom.id, null, null]);

  const bare = holding([]);
  const soak = items => holding(items).soakValue - bare.soakValue;
  const natural = items => holding(items).saveNatural - bare.saveNatural;
  check("its Category's benefit from the Top Layer alone - not once for each piece",
    [soak([top]), soak([top, middle, bottom])], [5, 5]);
  check("a Middle piece under an empty Top: its Category applies",
    [soak([middle]), soak([middle, bottom])], [5, 5]);
  check("under a Top piece, a Middle or Bottom piece's Category does nothing",
    soak([piece("top", true), piece("bottom")].map((item, index) => index
      ? item : { ...item, system: { ...item.system, crafted: { ...item.system.crafted,
        effects: "#@ category standard-clothing | Standard Clothing\n#@ end" } } })), 0);
  const own = (item, id) => ({ ...item, system: { ...item.system, crafted: { ...item.system.crafted,
    effects: effects.replace("quality legacy", `quality ${id}`) } } });
  check("its Qualities apply from every Layer - each its own Quality",
    natural([top, own(middle, "legacy-two"), own(bottom, "legacy-three")]), 6);
  check("the same Quality on every Layer, gained once: Double Dip", natural([top, middle, bottom]), 2);
  check("and the Category's piece. lines as well: only the Top Layer's count",
    [ignoredBy([bottom], getTrait).environments,
     ignoredBy([{ ...top, system: { ...top.system, crafted: { ...top.system.crafted,
       effects: "#@ category standard-clothing | Standard Clothing\n#@ end" } } }, bottom], getTrait)
       .environments], [true, false]);

  const SHEET_TEXT = read("module", "sheets", "actor-character-sheet.mjs");
  check("a piece acting as the Top says so on its row",
    [SHEET_TEXT.includes('actsAsTop: Boolean(layer) && (layer !== "top") && (topLayerPiece(items) === item),'),
     read("templates", "parts", "actor-gear.hbs").includes("{{#if row.actsAsTop}}")], [true, true]);
}

// --- The Categories, and the Apparel Penalty -----------------------------------------------------
{
  let at = 0;
  const piece = (category, layer, qualities = [], grade = 3) => {
    const data = craftedItemFrom("apparel", null, getTrait);
    at++;
    return { ...data, id: `cat${at}`, uuid: `Actor.a.Item.cat${at}`, name: `${category} ${at}`,
      system: { ...data.system, equipped: true, layer,
        crafted: { ...data.system.crafted, category, grade, qualities, effects: null } } };
  };
  const bare = holding([]);
  const bT = bare.baseTierOfPower;
  const reads = items => {
    const model = holding(items);
    return { dr: model.damageReduction - bare.damageReduction, dv: model.defenseValue - bare.defenseValue,
      strike: model.combat.strike - bare.combat.strike, dodge: model.combat.dodge - bare.combat.dodge,
      errors: model.effects.errors };
  };
  const bonus = 2 * bT;
  check("Armor, on top: Damage Reduction equal to the Apparel Bonus",
    reads([piece("armor", "top")]), { dr: bonus, dv: 0, strike: 0, dodge: 0, errors: [] });
  check("halved by Sleek Design", reads([piece("armor", "top", [{ id: "sleek-design", slots: 1 }])]).dr,
    Math.floor(bonus / 2));
  check("Combat Clothing, on top: Defense Value higher by half the Apparel Bonus, rounded up",
    reads([piece("combat-clothing", "top")]).dv, Math.ceil(bonus / 2));
  check("Weights, on top: every Combat Roll lower by the Apparel Bonus",
    [reads([piece("weights", "top")]).strike, reads([piece("weights", "top")]).dodge], [-bonus, -bonus]);
  check("with Focal on Strike: the Strike alone",
    [reads([piece("weights", "top", [{ id: "focal", slots: 1, choice: "strike" }])]).strike,
     reads([piece("weights", "top", [{ id: "focal", slots: 1, choice: "strike" }])]).dodge], [-bonus, 0]);

  // Training Support: "If you possess any stacks of Holding Back ... you may ignore the
  // reduction" - with the 2+ Ranks in Concealment it asks, read before the Skills are worked out.
  const training = [{ id: "training-support", slots: 1 }];
  const wearing = ({ ranks, stacks }) => {
    const parent = new ActorStub({}, { strict: false });
    parent.items = [piece("weights", "top", training)];
    parent.uuid = ME;
    const progression = progressionTo(30);
    progression[0] = { ...progression[0], skillRanks: Array(ranks).fill("concealment") };
    const model = new DBUCharacterData({ powerLevel: 30, progression,
      resources: stacks ? { holdingback: { stacks } } : {} }, { parent, strict: false });
    parent.system = model;
    model.prepareBaseData?.();
    model.prepareDerivedData();
    const plain = new ActorStub({}, { strict: false });
    plain.items = [];
    plain.uuid = ME;
    const baseline = new DBUCharacterData({ powerLevel: 30, progression,
      resources: stacks ? { holdingback: { stacks } } : {} }, { parent: plain, strict: false });
    plain.system = baseline;
    baseline.prepareBaseData?.();
    baseline.prepareDerivedData();
    return [model.combat.strike - baseline.combat.strike, model.effects.errors];
  };
  check("Training Support, Holding Back with 2+ Ranks in Concealment: the Weights take nothing off",
    wearing({ ranks: 2, stacks: 1 }), [0, []]);
  check("not Holding Back, or 1 Rank: they do",
    [wearing({ ranks: 2, stacks: 0 })[0], wearing({ ranks: 1, stacks: 1 })[0]], [-bonus, -bonus]);

  check("a Category under the Top Layer does nothing",
    reads([piece("combat-clothing", "top"), piece("armor", "middle")]).dr, 0);

  // "For each piece of Apparel you are wearing after the first, reduce your Combat Rolls by
  // 1/2 of your base Tier of Power (rounded up)."
  const penalty = Math.ceil(bT / 2);
  const strikeOf = items => holding(items).combat.strike - bare.combat.strike;
  check("one piece: no Apparel Penalty",
    strikeOf([piece("armor", "top")]), 0);
  check("two: 1/2 base Tier, rounded up, off every Combat Roll; three: twice that",
    [strikeOf([piece("armor", "top"), piece("combat-clothing", "middle")]),
     strikeOf([piece("armor", "top"), piece("combat-clothing", "middle"), piece("combat-clothing", "bottom")])],
    [-penalty, -2 * penalty]);
  check("named in the workings", holding([piece("armor", "top"), piece("combat-clothing", "middle")])
    .effects.programs.some(entry => entry.sourceName === "Apparel Penalty"), true);
  check("a piece that does not count is not there for it: Lightweight, on any Layer",
    strikeOf([piece("armor", "top"), piece("combat-clothing", "middle", [{ id: "lightweight", slots: 1 }])]), 0);
  // A Category applies on any Layer now (the user's, the rules as they are), but Armor's and Combat Clothing's: Standard Clothing
  // inflicts no Apparel Penalty on top or under another.
  check("Standard Clothing does not count, on top or under another piece",
    [strikeOf([piece("standard-clothing", "top"), piece("armor", "middle")]),
     strikeOf([piece("armor", "top"), piece("standard-clothing", "middle")])], [0, 0]);

  // What a Category part names about its piece, written in where it runs.
  const { scriptWithPiece, PIECE_TOKENS } = GEAR_MODULE;
  check("the piece's own numbers: each named one written in, at its default where nothing says",
    [scriptWithPiece("x $apparelBonus $armorFactor $reachesStrike $reachesDodge $reachesWound $waived",
      { perBaseTier: 3 }), scriptWithPiece("$armorFactor $waived", { perBaseTier: 3 },
      { armorFactor: 0.5, waived: 1 }), Object.keys(PIECE_TOKENS)],
    ["x 3 1 1 1 1 0", "0.5 1", ["armorFactor", "reachesStrike", "reachesDodge", "reachesWound", "waived"]]);
}

// --- The Doff Bonus -------------------------------------------------------------------------------
{
  const { doffBonusFor, doffKey } = GEAR_MODULE;
  let n = 0;
  const made = (category, qualities = [], grade = 3) => {
    const data = craftedItemFrom("apparel", null, getTrait);
    n++;
    return { ...data, id: `doff${n}`, name: `${category} ${n}`, type: "gear",
      system: { ...data.system, crafted: { ...data.system.crafted, category, grade, qualities, effects: null } } };
  };
  const wearer = { system: { baseTierOfPower: 3 } };
  const bonus = 2 * 3;
  check("its Apparel Bonus at their base Tier, on every Combat Roll, for as long as the rule says",
    doffBonusFor(made("combat-clothing"), wearer, { round: 5, getTrait }),
    { amount: bonus, strike: bonus, dodge: bonus, wound: bonus, rounds: 0 });
  check("Weights after the 3rd Combat Round: half as much again, rounded up - not in the 3rd",
    [doffBonusFor(made("weights"), wearer, { round: 4, getTrait }).amount,
     doffBonusFor(made("weights"), wearer, { round: 3, getTrait }).amount,
     doffBonusFor(made("weights", [], 1), wearer, { round: 4, getTrait }).amount],
    [bonus + Math.ceil(bonus / 2), bonus, 3 + 2]);
  check("Focal: only the Roll it chose",
    doffBonusFor(made("weights", [{ id: "focal", slots: 1, choice: "dodge" }]), wearer, { round: 1, getTrait }),
    { amount: bonus, strike: 0, dodge: bonus, wound: 0, rounds: 0 });
  check("Segmented Weight: a Combat Round longer for each of its Slots",
    doffBonusFor(made("weights", [{ id: "segmented-weight", slots: 2 }]), wearer, { round: 1, getTrait }).rounds, 2);

  // Given, run with the Condition and the clock stubbed where they would reach Foundry.
  const GEAR_TEXT = read("module", "gear.mjs");
  const from = GEAR_TEXT.indexOf("export async function grantDoffBonus(");
  const to = GEAR_TEXT.indexOf("\n}\n", from) + 2;
  const cut = GEAR_TEXT.slice(from, to).replace("export async function", "async function")
    .replace('const { setCondition } = await import("./conditions.mjs");', "")
    .replace('const { lasting, clockOff, EDGES, KINDS } = await import("./durations.mjs");', "");
  check("cut out, it imports nothing that would resolve here", /\bimport\(/.test(cut), false);
  const calls = [];
  const grant = (...args) => new Function("game", "doffBonusFor", "doffKey", "setCondition", "lasting",
    "clockOff", "EDGES", "KINDS", "writeActor", `${cut}\nreturn grantDoffBonus;`)(...args,
    async (actor, changes) => actor.update(changes));
  const actorWith = ({ used = [], held = 0, amount = 0 } = {}) => ({
    system: { usedManeuvers: used, conditions: held ? { "doff-bonus": 1 } : {}, doffBonus: { amount },
      baseTierOfPower: 3 },
    update: async changes => { calls.push(["update", changes]); }
  });
  const run = async (actor, item, combat = { started: true, round: 2 }) => {
    calls.length = 0;
    const said = await grant({ combat }, doffBonusFor, doffKey,
      async (a, key, stacks) => { calls.push(["condition", key, stacks]); },
      async (a, spec) => { calls.push(["clock", spec.key, spec.edge, spec.next, spec.extra]); },
      async (a, kind, keys) => { calls.push(["clockOff", keys]); },
      { END: "end" }, { CONDITION: "condition" })(actor, item, getTrait);
    return [said, [...calls]];
  };
  const gi = made("combat-clothing");
  const [said, did] = await run(actorWith(), gi);
  check("taken off in a Combat Encounter: the amount kept, the mark on, its clock to the end of their next turn",
    [said, did], [`Doff Bonus: Combat Rolls +${bonus} until the end of their next turn.`,
      [["update", { "system.usedManeuvers": [doffKey(gi)], "system.doffBonus": { amount: bonus, strike: bonus,
        dodge: bonus, wound: bonus, source: gi.name } }], ["condition", "doff-bonus", 1],
       ["clock", "doff-bonus", "end", true, 0]]]);
  check("outside one: nothing", (await run(actorWith(), gi, { started: false }))[1], []);
  check("from each piece once an Encounter",
    (await run(actorWith({ used: [doffKey(gi)] }), gi))[0], `${gi.name} has given its Doff Bonus this Combat Encounter.`);
  check("they do not stack: one no larger than the one held is not gained",
    [(await run(actorWith({ held: 1, amount: bonus }), gi))[1], (await run(actorWith({ held: 1, amount: 2 }), gi))[1][1]],
    [[], ["clockOff", ["doff-bonus"]]]);
  const seg = made("weights", [{ id: "segmented-weight", slots: 2 }]);
  check("Segmented Weight's Rounds on its clock", (await run(actorWith(), seg))[1].at(-1), ["clock", "doff-bonus", "end", true, 2]);

  // The mark reads what is kept.
  const markModel = ({ held, strike = 0, dodge = 0 }) => {
    const parent = new ActorStub({}, { strict: false });
    parent.items = [];
    parent.uuid = ME;
    const model = new DBUCharacterData({ powerLevel: 30, progression: progressionTo(30),
      conditions: held ? { "doff-bonus": 1 } : {}, doffBonus: { amount: Math.max(strike, dodge), strike, dodge,
        wound: 0, source: "Gi" } }, { parent, strict: false });
    parent.system = model;
    model.prepareBaseData?.();
    model.prepareDerivedData();
    return model;
  };
  const none = markModel({ held: false, strike: 6, dodge: 6 });
  const on = markModel({ held: true, strike: 6, dodge: 0 });
  check("while the mark is on: the kept amount on each Roll it names; off, nothing",
    [on.combat.strike - none.combat.strike, on.combat.dodge - none.combat.dodge], [6, 0]);

  const SHEET_TEXT = read("module", "sheets", "actor-character-sheet.mjs");
  check("given when a piece is taken off, and said", SHEET_TEXT.includes(
    "const said = await grantDoffBonus(this.actor, item, getTrait);"), true);
  check("its clock can run longer than the wording counts", read("module", "durations.mjs").includes(
    "+ Math.max(0, Number(extra) || 0),"), true);
}

// --- Break Value ---------------------------------------------------------------------------------
{
  const { craftedReading: reading, equipPlan, topLayerPiece } = GEAR_MODULE;
  let n = 0;
  const made = (category, layer, qualities = [], { lost = 0, destroyed = false } = {}) => {
    const data = craftedItemFrom("apparel", null, getTrait);
    n++;
    return { ...data, id: `bv${n}`, name: `${category} ${n}`, type: "gear",
      system: { ...data.system, equipped: Boolean(layer), layer,
        crafted: { ...data.system.crafted, category, qualities, effects: null, breakLost: lost, destroyed } } };
  };
  check("what is left: the most it can be, less what it lost - Durable's 6 with 2 lost is 4",
    [reading(made("armor", "", [{ id: "durable", slots: 1 }], { lost: 2 }).system.crafted,
      { getTrait, difficulties: {} }).breakLeft,
     reading(made("armor", "", [], { destroyed: true }).system.crafted, { getTrait, difficulties: {} }).breakLeft],
    [4, 0]);
  const wearer = { system: { size: { key: "medium" } } };
  // Destroyed is broken, for Apparel (the user's): one refusal, and repaired as any.
  check("broken, or destroyed: it does not go on until repaired - both the same",
    [equipPlan([made("armor", "", [], { lost: 3 })], made("armor", "", [], { lost: 3 }), "top", { wearer, getTrait }).problem,
     equipPlan([made("armor", "", [], { destroyed: true })], made("armor", "", [], { destroyed: true }), "top",
       { wearer, getTrait }).problem], ["Broken: repair it first.", "Broken: repair it first."]);

  // Lowered, run with the writes and the Doff Bonus stubbed.
  const GEAR_TEXT = read("module", "gear.mjs");
  const from = GEAR_TEXT.indexOf("export async function breakApparel(");
  const to = GEAR_TEXT.indexOf("\n}\n", from) + 2;
  const cut = GEAR_TEXT.slice(from, to).replace("export async function", "async function");
  check("cut out, it imports nothing that would resolve here", /\bimport\(/.test(cut), false);
  const writes = [];
  const doffed = [];
  const lower = (items, { combat = false, used = [] } = {}) => new Function("game", "topLayerPiece",
    "craftedReading", "writeActor", "grantDoffBonus", `${cut}\nreturn breakApparel;`)(
      { combat: { started: combat } }, topLayerPiece, reading,
      async (actor, changes) => { writes.push(changes); },
      async (actor, item) => { doffed.push(item.id); return "Doff Bonus!"; })(
      { items, system: { usedManeuvers: used } }, getTrait);
  const run = async (items, options) => {
    writes.length = 0;
    doffed.length = 0;
    const said = await lower(items, options);
    return [said, [...writes], [...doffed]];
  };
  const topPiece = made("combat-clothing", "top");
  const under = made("armor", "middle");
  check("the Top Layer's alone loses 1",
    await run([under, topPiece]),
    [`${topPiece.name} loses 1 Break Value: 2/3.`,
     [{ items: [{ _id: topPiece.id, "system.crafted.breakLost": 1 }] }], []]);
  const middleOnly = made("combat-clothing", "middle");
  check("with nothing on top, the highest Layer worn", (await run([middleOnly]))[1][0].items[0]._id, middleOnly.id);
  check("nothing worn: nothing", await run([]), ["", [], []]);
  const last = made("combat-clothing", "top", [], { lost: 2 });
  check("brought to 0 it breaks, and is taken off",
    await run([last]), [`${last.name} breaks, and is taken off.`,
      [{ items: [{ _id: last.id, "system.crafted.breakLost": 3, "system.equipped": false, "system.layer": "" }] }], []]);
  const weights = made("weights", "top", [], { lost: 2 });
  check("Weights broken count as removed for the Doff Bonus",
    [(await run([weights]))[0], (await run([weights]))[2]], [`${weights.name} breaks, and is taken off. Doff Bonus!`, [weights.id]]);
  const unbreakable = made("armor", "top", [{ id: "durable", slots: 1 }, { id: "unbreakable", slots: 1 }]);
  check("Unbreakable: never reduced", await run([unbreakable]),
    [`${unbreakable.name} cannot have its Break Value reduced.`, [], []]);
  const joint = made("armor", "top", [{ id: "joint-protection", slots: 1 }]);
  check("Joint Protection: the first time in a Combat Encounter, from its most, not lowered",
    await run([joint], { combat: true }), [`${joint.name} keeps its Break Value: Joint Protection.`,
      [{ "system.usedManeuvers": [`encounter:spare.${joint.id}`] }], []]);
  check("the second time, or out of a Combat Encounter, it is",
    [(await run([joint], { combat: true, used: [`encounter:spare.${joint.id}`] }))[0],
     (await run([joint], { combat: false }))[0]],
    [`${joint.name} loses 1 Break Value: 2/3.`, `${joint.name} loses 1 Break Value: 2/3.`]);

  // What lowers it.
  const CHAT = read("module", "chat.mjs");
  const damageAt = CHAT.slice(CHAT.indexOf("async function applyAttackDamage("),
    CHAT.indexOf("async function applyAttackDamage(") + 27500);
  check("knocked through a Health Threshold - by an attack, or by any Life Point reduction",
    [damageAt.includes("if (knockedThrough) await sayApparelBreak(target, breaks);"),
     /if \(knockedThrough\) await sayApparelBreak\(target\);\n[^]{0,200}return \{ taken, knockedThrough \};/.test(CHAT)],
    [true, true]);
  check("a Called Shot at a piece of Apparel that hit: half the Damage, and 1 off the Top Layer's",
    [damageAt.includes("const settledDamage = (damageOverride !== null) ? damageOverride : (atApparel ? Math.floor(own.damage / 2) : own.damage);"),
     damageAt.includes("if (atApparel) await sayApparelBreak(target, breaks);"),
     /targetsApparel: true/.test(read("traits", "maneuvers", "called-shot.dbu")),
     read("module", "use-maneuver.mjs").includes('aim("apparel", "A piece of Apparel",'),
     read("module", "use-maneuver.mjs").includes("atApparel: Boolean(entry.atApparel)")],
    [true, true, true, true, true]);

  const SHEET_TEXT = read("module", "sheets", "actor-character-sheet.mjs");
  const TAB = read("templates", "parts", "actor-gear.hbs");
  check("its row: what is left, or Broken - destroyed among it - and Repair, out of a Combat Encounter",
    [SHEET_TEXT.includes("repairable: Boolean(lost) && !inCombat"),
     TAB.includes('data-action="repairGear"'),
     SHEET_TEXT.includes('await item.update({ "system.crafted.breakLost": 0, "system.crafted.destroyed": false });')], [true, true, true]);
}

// --- Grown out of -----------------------------------------------------------------------------------
{
  const { outgrown } = GEAR_MODULE;
  const sizes = Object.keys(DBUCharacterData.SIZES);
  let n = 0;
  const made = (size, equipped = true, qualities = []) => {
    const data = craftedItemFrom("apparel", null, getTrait);
    n++;
    return { ...data, id: `og${n}`, name: `Gi ${n}`, type: "gear",
      system: { ...data.system, equipped, layer: equipped ? "top" : "",
        crafted: { ...data.system.crafted, category: "combat-clothing", size, qualities, effects: null } } };
  };
  const at = key => ({ system: { size: { key } } });
  const medium = made("medium");
  check("one Size Category larger: still worn; two: destroyed",
    [outgrown([medium], at("large"), sizes, getTrait).length, outgrown([medium], at("enormous"), sizes, getTrait)
      .map(item => item.id)], [0, [medium.id]]);
  check("smaller never destroys it", outgrown([medium], at("nano"), sizes, getTrait).length, 0);
  check("a stretching piece is always its wearer's Size: never",
    outgrown([made("medium", true, [{ id: "stretching", slots: 1 }])], at("colossal"), sizes, getTrait).length, 0);
  check("only what is worn", outgrown([made("medium", false)], at("gigantic"), sizes, getTrait).length, 0);
  const ENTRY = read("module", "dbu-ttrpg.mjs");
  check("asked whenever the character or what they carry changes, by the client that changed it",
    [ENTRY.includes('Hooks.on("updateActor", (actor, changes, options, userId) => outgrowing(actor, userId));'),
     ENTRY.includes('Hooks.on("updateItem", (item, changes, options, userId) => outgrowing(item.parent, userId));'),
     ENTRY.includes("if ((userId !== game.user.id) || (!isCharacter(actor))) return;")],
    [true, true, true]);
  check("destroyed: taken off and broken, kept on the sheet", read("module", "gear.mjs").includes(
    '...brokenChanges(item, getTrait), "system.equipped": false, "system.layer": ""'), true);
}

// --- Double Dip ---------------------------------------------------------------------------------
{
  const { doubleDipped, dipKey } = await import(modUrl("effects/registry.mjs"));
  let n = 0;
  const made = (layer, qualities, effects = null) => {
    const data = craftedItemFrom("apparel", null, getTrait);
    n++;
    return { ...data, id: `dd${n}`, uuid: `Actor.a.Item.dd${n}`, name: `Piece ${n}`, type: "gear",
      system: { ...data.system, equipped: true, layer,
        crafted: { ...data.system.crafted, category: "standard-clothing", qualities, effects } } };
  };
  const jacket = [{ id: "jacket", slots: 1 }];
  const bare = holding([]).soakValue;
  check("one Quality on two pieces worn is gained once: two Jackets, 1(bT) of Soak Value",
    [holding([made("top", jacket)]).soakValue - bare,
     holding([made("top", jacket), made("middle", jacket)]).soakValue - bare],
    [holding([]).baseTierOfPower, holding([]).baseTierOfPower]);
  check("what it makes of each piece stays each piece's: both go on over Armor",
    [made("top", jacket), made("middle", jacket)].map(item => GEAR_MODULE.craftedReading(item.system.crafted,
      { getTrait, difficulties: {} }).wornOverArmor), [true, true]);

  const part = (id, name, key = `quality:${id}`) => ({ type: "quality", id, key, name, body: "" });
  const small = { item: { system: { crafted: { qualities: [{ id: "artisan", slots: 1 }] } } },
    parts: [part("artisan", "Artisan")] };
  const large = { item: { system: { crafted: { qualities: [{ id: "artisan", slots: 2 }] } } },
    parts: [part("artisan", "Artisan")] };
  check("of several, the one taking the most Quality Slots - the first where they tie",
    [doubleDipped([small, large]).get("artisan") === large.parts[0],
     doubleDipped([small, { ...small, parts: [part("artisan", "Artisan")] }]).get("artisan") === small.parts[0]],
    [true, true]);
  const second = { item: { system: { crafted: { qualities: [{ id: "dynamic-quality", slots: 1 },
    { id: "dynamic-quality", slots: 3 }] } } },
    parts: [part("dynamic-quality", "Wings"), part("dynamic-quality", "Wings", "quality:dynamic-quality:2")] };
  check("the nth part of an id reads the nth entry's Slots", doubleDipped([second]).get("dynamic-quality|Wings"),
    second.parts[1]);
  check("each Dynamic Quality its own, by name",
    [dipKey(part("dynamic-quality", "Wings")) === dipKey(part("dynamic-quality", "Horns")),
     dipKey(part("jacket", "Jacket")) === dipKey(part("jacket", "Hood"))], [false, true]);
  const own = "#@ quality dynamic-quality | Plate\n[passive]\nsoakValue += 2;\n#@ end";
  check("two Dynamic Qualities named alike, once; named apart, each",
    [holding([made("top", [{ id: "dynamic-quality", slots: 1 }], own),
      made("middle", [{ id: "dynamic-quality", slots: 1 }], own)]).soakValue - bare,
     holding([made("top", [{ id: "dynamic-quality", slots: 1 }], own),
      made("middle", [{ id: "dynamic-quality", slots: 1 }], own.replace("Plate", "Scale"))]).soakValue - bare],
    [2, 4]);
}

// --- The sheets -----------------------------------------------------------------------------------
{
  check("the Apparel list: its rows, Add Apparel, and a row over its Slots says so",
    [TAB.includes("{{#each gear.apparel as |row|}}"), TAB.includes('data-action="addApparel"'),
     TAB.includes("+{{row.overSlots}} over")], [true, true, true]);
  check("Add Apparel makes one and opens it",
    [SHEET.includes('const data = craftedItemFrom("apparel", this.actor, getTrait);'),
     SHEET.includes("return made?.sheet?.render(true);")], [true, true]);
  check("a built Item's row names its Category and Grade",
    SHEET.includes("return `${name} · Grade ${crafted.grade}${item.getFlag?.(\"dbu-ttrpg\", \"defaultCostume\") ? \" · Default Costume\" : \"\"}`;"), true);
  check("its sheet changes the Category, the Grade and the Size",
    ['name="system.crafted.category"', 'name="system.crafted.grade"', 'name="system.crafted.size"']
      .map(field => ITEM_PAGE.includes(field)), [true, true, true]);
  check("and says what they come to", ["Apparel Grade: {{crafted.reading.gradeLabel}}",
    "Apparel Bonus: {{crafted.bonusLabel}}", "Quality Slots: {{crafted.reading.used}}/{{crafted.reading.slots}}"]
    .map(text => ITEM_PAGE.includes(text)), [true, true, true]);
  check("Qualities added and taken off on the Item itself",
    [ITEM_PAGE.includes('data-action="addQuality"'), ITEM_PAGE.includes('data-action="removeQuality"'),
     ITEM_SHEET.includes("addQuality: DBUGearSheet._onAddQuality,")], [true, true, true]);
  const adding = ITEM_SHEET.slice(ITEM_SHEET.indexOf("static async _onAddQuality("),
    ITEM_SHEET.indexOf("static async _onRemoveQuality("));
  check("never refused for being over its Slots - only said",
    // Nothing about what it already holds: not its count, its Slots used, nor its Grade's.
    [/\.over\b|craftedReading|crafted\??\.grade|grades|\.length\s*[<>]=?|\.used\b/.test(
      adding.replace(/\/\*\*[\s\S]*?\*\//, "")),
     ITEM_PAGE.includes('{{#if crafted.overNote}}<p class="gear-insufficient" data-tooltip="{{crafted.overNote}}">Insufficient Quality Slots</p>{{/if}}'),
     ITEM_SHEET.includes("It still works.")], [false, true, true]);
  check("the search beside the button is not a field of the Item",
    [/<input type="text" class="gear-quality-search" data-quality-search autocomplete="off"\s+placeholder="Type a Quality"\/>/.test(ITEM_PAGE),
     /name="newQuality"|name="quality"/.test(ITEM_PAGE),
     ITEM_SHEET.includes('input.addEventListener("change", event => event.stopPropagation());')],
    [true, false, true]);
  check("the entry shown is its Category's",
    ITEM_SHEET.includes("|| (context.crafted ? getTrait(system.crafted.category)?.text : \"\")"), true);
}

console.log(`${failed} failing`);
process.exit(failed ? 1 : 0);
