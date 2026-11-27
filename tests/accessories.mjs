/**
 * Accessories: each one's file, and its effect run through the whole engine while worn.
 *
 * "Accessories are Basic Items that can be equipped and apply benefits while equipped." So
 * every effect is checked three ways: worn, not worn, and worn twice over - which must come
 * out as once.
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
// What chat.mjs imports from actor-types.mjs, for the functions cut out of it (the Minion Actor type).
globalThis.isMinion = actor => actor?.type === "minion";
globalThis.typicalMinion = actor => (actor?.type === "minion") && !actor.system?.specialMinion && !actor.system?.duplicate;
globalThis.isCharacter = actor => ["character", "minion"].includes(actor?.type);
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
    { powerLevel, progression: progressionTo(powerLevel), conditions, states,
      // Debug's ToP Mod is gone (the user's): a Custom Buff's ToP (Breakthrough) pushes it instead.
      customBuffs: tierOfPowerModifier ? [{ id: "top", name: "ToP", group: "", active: true, effect: "tierOfPower", flat: tierOfPowerModifier, perBase: 0, perTier: 0 }] : [] },
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

// --- Armored Gloves -------------------------------------------------------------------------------
{
  const gloves = getTrait("armored-gloves");
  check("the Armored Gloves are there, an Accessory in basic/, Craft DC Expert",
    [gloves?.owner, typeOf(gloves), gloves?.special ?? false, gloves?.craftDC],
    ["basic", "accessory", false, "Expert"]);
  check("the entry, as printed", printedLines(gloves?.text), [
    "Armored Gloves: These gloves contain metal plates that provide wrist and forearm "
      + "protection.",
    "\u2013Craft DC: Expert",
    "\u2013Effects: Increase your Damage Reduction by 1(bT)."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/armored-gloves.dbu"), true);

  const errors = [];
  const worn = given("armored-gloves");
  const programs = programsFor({ items: [worn] }, { report: m => errors.push(m) });
  check("its script compiles, and is gathered while worn",
    [errors, programs.filter(entry => entry.sourceId === worn.id).length], [[], 1]);

  const bare = holding([]);
  const bT = bare.baseTierOfPower;
  check("a base Tier above 1, so (bT) is measured", bT > 1, true);
  check("worn: Damage Reduction 1(bT) higher",
    holding([given("armored-gloves")]).damageReduction - bare.damageReduction, bT);
  check("not worn: nothing",
    holding([given("armored-gloves", { equipped: false })]).damageReduction
      - bare.damageReduction, 0);
  check("two pairs worn somehow: still once",
    holding([given("armored-gloves"), given("armored-gloves")]).damageReduction
      - bare.damageReduction, bT);
  const renamed = { ...given("armored-gloves"), name: "Grandpa's Gloves" };
  check("renamed, still the gloves",
    holding([renamed]).damageReduction - bare.damageReduction, bT);
}

// --- Bunny Ears -----------------------------------------------------------------------------------
{
  const ears = getTrait("bunny-ears");
  check("the Bunny Ears are there, an Accessory in basic/, Craft DC Apprentice",
    [ears?.owner, typeOf(ears), ears?.special ?? false, ears?.craftDC],
    ["basic", "accessory", false, "Apprentice"]);
  check("the entry, as printed", printedLines(ears?.text), [
    "Bunny Ears: This bunny-eared headband makes you look cool, and you feel faster somehow.",
    "\u2013Craft DC: Apprentice",
    "\u2013Effects: Increase the wearer\u2019s Normal Speed by 1(bT) and their Boosted Speed "
      + "by 2(bT)."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/bunny-ears.dbu"), true);

  const errors = [];
  programsFor({ items: [given("bunny-ears")] }, { report: m => errors.push(m) });
  check("its script compiles", errors, []);

  const bare = holding([]);
  const bT = bare.baseTierOfPower;
  const speeds = model => [model.speed.normal - bare.speed.normal,
    model.speed.boosted - bare.speed.boosted];
  check("worn: Speed 1(bT) higher, Boosted Speed 2(bT)",
    speeds(holding([given("bunny-ears")])), [bT, 2 * bT]);
  check("not worn: nothing", speeds(holding([given("bunny-ears", { equipped: false })])), [0, 0]);
  check("worn with the Armored Gloves: both apply, neither touching the other's",
    [...speeds(holding([given("bunny-ears"), given("armored-gloves")])),
     holding([given("bunny-ears"), given("armored-gloves")]).damageReduction
       - bare.damageReduction], [bT, 2 * bT, bT]);
}

// --- Champion Belt --------------------------------------------------------------------------------
{
  const belt = getTrait("champion-belt");
  check("the Champion Belt is there, an Accessory in basic/, Craft DC Master",
    [belt?.owner, typeOf(belt), belt?.special ?? false, belt?.craftDC],
    ["basic", "accessory", false, "Master"]);
  check("the entry, as printed", printedLines(belt?.text), [
    "Champion Belt: A belt of leather and gold indicating a win in a tournament of some kind, "
      + "marking your martial prowess.",
    "\u2013Craft DC: Master",
    "\u2013Effects: Increase your Morale Saving Throw by 1(bT) and increase all Skill Checks "
      + "that use your Personality Score by 2."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/champion-belt.dbu"), true);

  const errors = [];
  programsFor({ items: [given("champion-belt")] }, { report: m => errors.push(m) });
  check("its script compiles", errors, []);

  const bare = holding([]);
  const bT = bare.baseTierOfPower;
  const worn = holding([given("champion-belt")]);
  const saves = model => Object.fromEntries(Object.entries(model.savingThrows)
    .map(([key, save]) => [key, save.value - bare.savingThrows[key].value]));
  check("worn: Morale 1(bT) higher, and no other Saving Throw",
    saves(worn), { impulsive: 0, corporeal: 0, cognitive: 0, morale: bT });

  const personal = Object.entries(bare.skills)
    .filter(([, skill]) => skill.attribute === "personality").map(([key]) => key).sort();
  check("the Personality Skills there are", personal,
    ["bluff", "cooking", "intimidation", "performance", "persuasion"]);
  const rolls = model => Object.fromEntries(Object.entries(model.skills)
    .map(([key, skill]) => [key, skill.roll - bare.skills[key].roll])
    .filter(([, change]) => change !== 0));
  check("worn: every Personality Skill Check 2 higher, and nothing else",
    rolls(worn), Object.fromEntries(personal.map(key => [key, 2])));
  check("on the roll, not the Skill Bonus",
    worn.skills.persuasion.bonus - bare.skills.persuasion.bonus, 0);
  const off = holding([given("champion-belt", { equipped: false })]);
  check("not worn: nothing", [saves(off).morale, rolls(off)], [0, {}]);

  // Named where the value is explained, and alongside what the inner Slot already had.
  const named = (model, key) => (model.effects.workings[key]?.contributions ?? [])
    .map(part => part.source);
  check("the Morale hover names the Belt", named(worn, "save.morale").includes(belt.name), true);
  const beautified = holding([given("champion-belt")], { conditions: { beautified: 1 } });
  check("Persuasion with Beautified too: 4 higher, and the hover names both",
    [beautified.skills.persuasion.roll - bare.skills.persuasion.roll,
     named(beautified, "skill.persuasion").length,
     named(beautified, "skill.persuasion").includes(belt.name)], [4, 2, true]);
  // The same fix reaches the Wound Rolls, filed as "wound.physical" and run through
  // "wound": read by the filing key, no Wound Roll had ever named what raised it.
  const raging = holding([], { states: { raging: 1 } });
  check("and each Wound Roll names its effects now, read from the Slot it went through",
    ["physical", "energy", "magic"].map(key => named(raging, `wound.${key}`)),
    [["Raging"], ["Raging"], ["Raging"]]);
}

// --- Eyeglasses -----------------------------------------------------------------------------------
{
  const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");
  const CHAT = read("module", "chat.mjs");
  const SHEET = read("module", "sheets", "actor-character-sheet.mjs");
  const ITEM_SHEET = read("module", "sheets", "item-gear-sheet.mjs");
  const ITEM_PAGE = ["gear-header", "gear-sheet", "gear-description", "gear-crafted", "gear-qualities"].map(name => read("templates", "parts", `${name}.hbs`)).join("\n");
  const TAB = read("templates", "parts", "actor-gear.hbs");
  const source = (text, name) => {
    const at = text.search(new RegExp(`(async )?function ${name}\\(`));
    if (at < 0) return "";
    const next = text.slice(at + 1).search(/\n(export )?(async )?function /);
    return next < 0 ? text.slice(at) : text.slice(at, at + 1 + next);
  };

  const glasses = getTrait("eyeglasses");
  check("the Eyeglasses are there, an Accessory in basic/, Craft DC Apprentice",
    [glasses?.owner, typeOf(glasses), glasses?.special ?? false, glasses?.craftDC],
    ["basic", "accessory", false, "Apprentice"]);
  check("the entry, as printed", printedLines(glasses?.text), [
    "Eyeglasses: A piece of eye-wear designed to correct poor vision.",
    "–Craft DC: Apprentice",
    "–Effects: When you gain or create this Accessory, you must declare an Intended "
      + "Character. If you’re the Intended Character, increase the Natural Result of any "
      + "Perception Skill Check by 1 while wearing this Accessory.",
    "",
    "If you’re not the Intended Character, reduce the Natural Result on any Perception "
      + "Skill check made relying on sight by 1 while wearing this Accessory."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/eyeglasses.dbu"), true);

  const errors = [];
  programsFor({ uuid: "Actor.me", items: [given("eyeglasses")] }, { report: m => errors.push(m) });
  check("its script compiles", errors, []);

  // The Item: declared when given, kept by the schema.
  const made = gearItemFrom(glasses, null);
  check("an Intended Character to declare, none yet",
    [made.system.declaresIntended, made.system.intended], [true, { uuid: "", name: "" }]);
  const kept = new DBUGearData(structuredClone(made.system), { strict: false }).toObject();
  check("which the schema keeps", [kept.declaresIntended, kept.intended],
    [true, { uuid: "", name: "" }]);

  // Worn, by whom they were made for and by somebody else.
  const forWhom = (uuid, extra = {}) => {
    const item = given("eyeglasses", extra);
    item.system.intended = { uuid, name: uuid };
    return item;
  };
  const natural = model => Object.fromEntries(Object.entries(model.skills)
    .filter(([, skill]) => skill.natural || skill.naturalBy.sight)
    .map(([key, skill]) => [key, [skill.natural, skill.naturalBy.sight]]));
  check("nothing moves a Natural Result bare", natural(holding([])), {});
  check("worn by the Intended Character: Perception's Natural Result 1 higher, always",
    natural(holding([forWhom(ME)])), { perception: [1, 0] });
  check("worn by anyone else: 1 lower, relying on sight only",
    natural(holding([forWhom("Actor.someoneElse")])), { perception: [0, -1] });
  check("nobody declared is nobody it was made for",
    natural(holding([forWhom("")])), { perception: [0, -1] });
  check("not worn: nothing", natural(holding([forWhom(ME, { equipped: false })])), {});
  check("the total and the Skill Bonus untouched: it is the die",
    [holding([forWhom(ME)]).skills.perception.roll, holding([forWhom(ME)]).skills.perception.bonus],
    [holding([]).skills.perception.roll, holding([]).skills.perception.bonus]);

  // Reading it: the Skill's own move, and the sight half only where the Check relies on it.
  const skillNatural = new Function(`${source(CHAT, "skillNatural")}\nreturn skillNatural;`)();
  const sensesAsked = new Function("DBUCharacterData",
    `${source(CHAT, "sensesAsked")}\nreturn sensesAsked;`)(DBUCharacterData);
  check("asked about sight only where something moves it by sight",
    [sensesAsked({ system: holding([forWhom("Actor.someoneElse")]) }, "perception"),
     sensesAsked({ system: holding([forWhom(ME)]) }, "perception"),
     sensesAsked({ system: holding([]) }, "perception")], [["sight"], [], []]);
  const stranger = { system: holding([forWhom("Actor.someoneElse")]) };
  const owner = { system: holding([forWhom(ME)]) };
  check("the move a Check reads: by sight, not by sight, and the owner either way",
    [skillNatural(stranger, "perception", ["sight"]), skillNatural(stranger, "perception", []),
     skillNatural(owner, "perception", ["sight"]), skillNatural(owner, "perception", []),
     skillNatural(owner, "stealth", ["sight"])], [-1, 0, 1, 1, 0]);

  // The die itself, run: a 9 moved to 10 is a Critical; a 2 moved to 1 is a Botch.
  let face = 9;
  class FakeRoll {
    constructor(formula, data = {}) { this.formula = formula; this.data = data; }
    async evaluate() {
      this.dice = [{ total: face, expression: "1d10" }];
      this.total = face + (this.data.bonus ?? 0);
      return this;
    }
  }
  const { applySlot } = await import(modUrl("effects/interpreter.mjs"));
  const evaluateCheck = new Function("Roll", "DBUCharacterData", "applySlot", "botchRangeFor",
    `${source(CHAT, "evaluateCheck")}\nreturn evaluateCheck;`)(
      FakeRoll, DBUCharacterData, applySlot, (actor) => actor.system.botchRange ?? 1);
  const who = { system: { criticalTarget: 10, botchRange: 1 } };
  const up = await evaluateCheck(who, 5, "", null, { naturalAdd: 1 });
  check("a 9 moved up is a 10, and a Critical",
    [up.natural, up.naturalShift, up.critical, up.roll.total + up.naturalShift], [10, 1, true, 15]);
  face = 2;
  const down = await evaluateCheck(who, 5, "", null, { naturalAdd: -1 });
  check("a 2 moved down is a 1, and a Botch",
    [down.natural, down.naturalShift, down.botch, down.roll.total + down.naturalShift],
    [1, -1, true, 6]);
  face = 5;
  const still = await evaluateCheck(who, 5, "", null, {});
  check("and nothing moved is the die as rolled", [still.natural, still.naturalShift], [5, 0]);

  // Karmic Chance: the new die moved as the old one was, and the total right.
  const rerollBaseDie = new Function("Roll", "DBUCharacterData", "keepTheFirstRoll", "partLine",
    "noteLine", "fromOutcome", "diceLine", "floored",
    `${source(CHAT, "rerollBaseDie")}\nreturn rerollBaseDie;`)(
      FakeRoll, DBUCharacterData, async () => false, part => part, note => note, line => line,
      () => null, null);
  face = 6;
  const again = await rerollBaseDie(who, {
    natural: 4, beforeOutcome: 9, total: 9, rules: { naturalAdd: -1 }, botchPenalty: 2 });
  // First: a 5 moved to 4, +5 bonus = 9. Again: a 6 moved to 5, +5 = 10.
  check("rerolled, the new die is moved as the old one was", again.total, 10);

  // Where it is wired.
  check("the sheet's Check asks about sight only where it moves something, and passes the move",
    [SHEET.includes("difficulties: true, senses: sensesAsked(this.actor, target.dataset.skill),"),
     SHEET.includes("naturalAdd: skillNatural(this.actor, target.dataset.skill, ready.senses ?? [])")],
    [true, true]);
  check("the total carries the moved die, and Karmic Chance is told the move",
    [SHEET.includes("const rolledTotal = roll.total + naturalShift;"),
     SHEET.includes("beforeOutcome: rolledTotal,"), SHEET.includes("rules: { naturalAdd }")],
    [true, true, true]);
  check("a Skill Clash moves each side's die by its own Skill, sight asked as it confirms",
    [CHAT.includes(".filter(([, who]) => (who ?? []).includes(uuid)).map(([sense]) => sense))"),
     CHAT.includes("{ urgent: Boolean(opened.urgent), senses,\n")], [true, true]);
  check("declared at Add Item among every character, the holder first",
    SHEET.includes("const offered = holderToo ? [holder, ...others] : others;"), true);
  check("changeable on the Item, the name kept with it",
    [ITEM_PAGE.includes('<select name="system.intended.uuid">'),
     ITEM_SHEET.includes('for (const field of ["assigned", "intended"]) {')], [true, true]);
  check("the row says who they are for", TAB.includes("for {{row.intendedName}}"), true);
}

// --- Eyepatch -------------------------------------------------------------------------------------
{
  const patch = getTrait("eyepatch");
  check("the Eyepatch is there, an Accessory in basic/, Craft DC Apprentice",
    [patch?.owner, typeOf(patch), patch?.special ?? false, patch?.craftDC],
    ["basic", "accessory", false, "Apprentice"]);
  check("the entry, as printed", printedLines(patch?.text), [
    "Eyepatch: Created with the intention of hiding a damaged eye, these are often worn by "
      + "fierce warriors or cutthroats; either way, they indicate that the wearer is quite "
      + "dangerous.",
    "–Craft DC: Apprentice",
    "–Effects: Decrease the Natural Result of any Perception checks made that rely on "
      + "sight by 1, but in return increase the Natural Result of any Intimidation checks by 1."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/eyepatch.dbu"), true);

  const errors = [];
  programsFor({ uuid: ME, items: [given("eyepatch")] }, { report: m => errors.push(m) });
  check("its script compiles", errors, []);

  const natural = model => Object.fromEntries(Object.entries(model.skills)
    .filter(([, skill]) => skill.natural || skill.naturalBy.sight)
    .map(([key, skill]) => [key, [skill.natural, skill.naturalBy.sight]]));
  check("worn: Perception 1 lower relying on sight, Intimidation 1 higher always",
    natural(holding([given("eyepatch")])), { perception: [0, -1], intimidation: [1, 0] });
  check("not worn: nothing", natural(holding([given("eyepatch", { equipped: false })])), {});
  check("the totals untouched: it is the die",
    ["perception", "intimidation"].map(key => holding([given("eyepatch")]).skills[key].roll),
    ["perception", "intimidation"].map(key => holding([]).skills[key].roll));

  // Beside Eyeglasses made for somebody else, the two sight penalties add up.
  const theirs = given("eyeglasses");
  theirs.system.intended = { uuid: "Actor.someoneElse", name: "Someone" };
  check("with somebody else's Eyeglasses: 2 lower relying on sight",
    natural(holding([given("eyepatch"), theirs])).perception, [0, -2]);
}

// --- Fashionable Accessories ----------------------------------------------------------------------
{
  const fashion = getTrait("fashionable-accessories");
  check("the Fashionable Accessories are there, an Accessory in basic/, Craft DC Qualified",
    [fashion?.owner, typeOf(fashion), fashion?.special ?? false, fashion?.craftDC],
    ["basic", "accessory", false, "Qualified"]);
  check("the entry, as printed", printedLines(fashion?.text), [
    "Fashionable Accessories: This collection of pins, jewelry, sashes, and other assorted "
      + "wearable items is the perfect accent to your everyday wear, making you feel like a "
      + "million zeni.",
    "–Craft DC: Qualified",
    "–Effects: Increase your Morale Saving Throws by 1(bT) while wearing Standard "
      + "Clothing in addition to this Accessory."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/fashionable-accessories.dbu"), true);

  const errors = [];
  programsFor({ uuid: ME, items: [given("fashionable-accessories")] },
    { report: m => errors.push(m) });
  check("its script compiles", errors, []);

  // Standard Clothing is Apparel, which has not arrived: stood in for by an Item of that id.
  const clothing = (equipped = true, extra = {}) => ({ id: `cloth${++made}`, name: "Clothes",
    type: "gear", system: { itemType: "apparel", gearId: "standard-clothing", equipped, ...extra } });
  const bare = holding([]);
  const bT = bare.baseTierOfPower;
  const morale = items => holding(items).savingThrows.morale.value - bare.savingThrows.morale.value;
  check("worn with Standard Clothing: Morale 1(bT) higher",
    morale([given("fashionable-accessories"), clothing()]), bT);
  check("without it: nothing", morale([given("fashionable-accessories")]), 0);
  check("with it owned but not worn: nothing",
    morale([given("fashionable-accessories"), clothing(false)]), 0);
  check("with it on but these not worn: nothing",
    morale([given("fashionable-accessories", { equipped: false }), clothing()]), 0);
  check("renamed clothing still counts",
    morale([given("fashionable-accessories"), { ...clothing(), name: "Gi" }]), bT);
  check("and no other Saving Throw",
    Object.entries(holding([given("fashionable-accessories"), clothing()]).savingThrows)
      .filter(([key, save]) => save.value !== bare.savingThrows[key].value).map(([key]) => key),
    ["morale"]);
  check("with the Champion Belt too: both apply",
    morale([given("fashionable-accessories"), given("champion-belt"), clothing()]), 2 * bT);
}

// --- Flowing Fashion ------------------------------------------------------------------------------
{
  const flowing = getTrait("flowing-fashion");
  check("the Flowing Fashion is there, an Accessory in basic/, Craft DC Expert",
    [flowing?.owner, typeOf(flowing), flowing?.special ?? false, flowing?.craftDC],
    ["basic", "accessory", false, "Expert"]);
  check("the entry, as printed", printedLines(flowing?.text), [
    "Flowing Fashion: You wear a scarf or cape, making you look like a true hero!",
    "–Craft DC: Expert",
    "–Effects: Increase the Dice Score for any Skill Checks with your Performance Skill "
      + "by 2. Increase your Combat Rolls by 1(bT) while Hyped."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/flowing-fashion.dbu"), true);

  const errors = [];
  programsFor({ uuid: ME, items: [given("flowing-fashion")] }, { report: m => errors.push(m) });
  check("its script compiles", errors, []);

  const bare = holding([]);
  const bT = bare.baseTierOfPower;
  const rolls = model => Object.fromEntries(Object.entries(model.skills)
    .map(([key, skill]) => [key, skill.roll - bare.skills[key].roll])
    .filter(([, change]) => change !== 0));
  const worn = holding([given("flowing-fashion")]);
  check("worn: Performance Checks 2 higher, and no other Skill", rolls(worn), { performance: 2 });
  check("on the roll, not the Skill Bonus",
    worn.skills.performance.bonus - bare.skills.performance.bonus, 0);

  const combat = model => [model.combat.strike, model.combat.dodge,
    ...Object.values(model.combat.wound)];
  const minus = (a, b) => a.map((value, i) => value - b[i]);
  check("not Hyped: no Combat Roll moves", minus(combat(worn), combat(bare)), [0, 0, 0, 0, 0]);
  const hyped = holding([], { conditions: { hyped: 1 } });
  const hypedWorn = holding([given("flowing-fashion")], { conditions: { hyped: 1 } });
  check("Hyped: every Combat Roll 1(bT) higher than Hyped alone gives",
    minus(combat(hypedWorn), combat(hyped)), [bT, bT, bT, bT, bT]);
  check("not worn, Hyped: nothing more",
    minus(combat(holding([given("flowing-fashion", { equipped: false })],
      { conditions: { hyped: 1 } })), combat(hyped)), [0, 0, 0, 0, 0]);
}

// --- Galactic Receiver ----------------------------------------------------------------------------
{
  const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");
  const CHAT = read("module", "chat.mjs");
  const source = (text, name) => {
    const at = text.search(new RegExp(`(async )?function ${name}\\(`));
    if (at < 0) return "";
    const next = text.slice(at + 1).search(/\n(export )?(async )?function /);
    return next < 0 ? text.slice(at) : text.slice(at, at + 1 + next);
  };

  const receiver = getTrait("galactic-receiver");
  check("the Galactic Receiver is there, an Accessory in basic/, [Tech], Craft DC Qualified",
    [receiver?.owner, typeOf(receiver), receiver?.special ?? false, receiver?.craftDC,
     gearItemFrom(receiver, null).system.tags],
    ["basic", "accessory", false, "Qualified", ["tech"]]);
  check("the entry, as printed", printedLines(receiver?.text), [
    "Galactic Receiver [Tech]: A specialized Communicator worn on the ear, this device serves "
      + "as an aid to hearing as well.",
    "–Craft DC: Qualified",
    "–Effects: When you roll a Perception Skill Check related to your hearing, increase "
      + "the Natural Result by 2. This Accessory also serves as a Communicator."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/galactic-receiver.dbu"), true);

  const errors = [];
  programsFor({ uuid: ME, items: [given("galactic-receiver")] }, { report: m => errors.push(m) });
  check("its script compiles", errors, []);

  const moved = model => Object.fromEntries(Object.entries(model.skills)
    .filter(([, skill]) => skill.natural || Object.values(skill.naturalBy).some(Boolean))
    .map(([key, skill]) => [key, { always: skill.natural, ...skill.naturalBy }]));
  check("worn: Perception 2 higher relying on hearing, and nothing else",
    moved(holding([given("galactic-receiver")])),
    { perception: { always: 0, sight: 0, hearing: 2 } });
  check("not worn: nothing", moved(holding([given("galactic-receiver", { equipped: false })])), {});
  check("with the Eyepatch: each sense its own",
    moved(holding([given("galactic-receiver"), given("eyepatch")])).perception,
    { always: 0, sight: -1, hearing: 2 });
  check("no sense but the two there are", Object.keys(DBUCharacterData.SENSES), ["sight", "hearing"]);
  check("and sight starts ticked where hearing does not",
    [DBUCharacterData.SENSES.sight.checked, DBUCharacterData.SENSES.hearing.checked], [true, false]);

  const skillNatural = new Function(`${source(CHAT, "skillNatural")}\nreturn skillNatural;`)();
  const sensesAsked = new Function("DBUCharacterData",
    `${source(CHAT, "sensesAsked")}\nreturn sensesAsked;`)(DBUCharacterData);
  const both = { system: holding([given("galactic-receiver"), given("eyepatch")]) };
  check("asked about both, where both move it", sensesAsked(both, "perception"), ["sight", "hearing"]);
  check("the move read per sense relied on",
    [skillNatural(both, "perception", []), skillNatural(both, "perception", ["hearing"]),
     skillNatural(both, "perception", ["sight"]), skillNatural(both, "perception", ["sight", "hearing"])],
    [0, 2, -1, 1]);
  check("a Skill Clash keeps who relied on what per sense, as lists",
    CHAT.includes("(clash.sensesBy?.[sense] ?? []).filter(uuid => uuid !== actor.uuid)"), true);
}

// --- Helmet ---------------------------------------------------------------------------------------
{
  const helmet = getTrait("helmet");
  check("the Helmet is there, an Accessory in basic/, Craft DC Expert",
    [helmet?.owner, typeOf(helmet), helmet?.special ?? false, helmet?.craftDC],
    ["basic", "accessory", false, "Expert"]);
  check("the entry, as printed", printedLines(helmet?.text), [
    "Helmet: Protective headgear that reduces the risk of injury.",
    "–Craft DC: Expert",
    "–Effects: Increase your Damage Reduction by 1(bT). Additionally, increase your Bluff "
      + "Skill Checks by 2."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/helmet.dbu"), true);

  const errors = [];
  programsFor({ uuid: ME, items: [given("helmet")] }, { report: m => errors.push(m) });
  check("its script compiles", errors, []);

  const bare = holding([]);
  const bT = bare.baseTierOfPower;
  const worn = holding([given("helmet")]);
  const rolls = model => Object.fromEntries(Object.entries(model.skills)
    .map(([key, skill]) => [key, skill.roll - bare.skills[key].roll])
    .filter(([, change]) => change !== 0));
  check("worn: Damage Reduction 1(bT) higher", worn.damageReduction - bare.damageReduction, bT);
  check("and Bluff Checks 2 higher, no other Skill", rolls(worn), { bluff: 2 });
  check("on the roll, not the Skill Bonus", worn.skills.bluff.bonus - bare.skills.bluff.bonus, 0);
  const off = holding([given("helmet", { equipped: false })]);
  check("not worn: nothing", [off.damageReduction - bare.damageReduction, rolls(off)], [0, {}]);
  check("with the Armored Gloves: Damage Reduction 2(bT) higher",
    holding([given("helmet"), given("armored-gloves")]).damageReduction - bare.damageReduction,
    2 * bT);
}

// --- Hologram Projector ---------------------------------------------------------------------------
{
  const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");
  const CHAT = read("module", "chat.mjs");
  const USE = read("module", "use-maneuver.mjs");
  const source = (text, name) => {
    const at = text.search(new RegExp(`(async )?function ${name}\\(`));
    if (at < 0) return "";
    const next = text.slice(at + 1).search(/\n(export )?(async )?function /);
    return next < 0 ? text.slice(at) : text.slice(at, at + 1 + next);
  };
  const { damageAttributeOffers } = await import(modUrl("gear.mjs"));

  const projector = getTrait("hologram-projector");
  check("the Hologram Projector is there, an Accessory in basic/, [Tech], Craft DC Expert",
    [projector?.owner, typeOf(projector), projector?.special ?? false, projector?.craftDC,
     gearItemFrom(projector, null).system.tags],
    ["basic", "accessory", false, "Expert", ["tech"]]);
  check("the entry, as printed", printedLines(projector?.text), [
    "Hologram Projector [Tech]: Large, comic book letters appear when you strike your opponent!",
    "–Craft DC: Expert",
    "–Effects: When using the Signature Technique Maneuver, you may use your Personality "
      + "Modifier for the Damage Attribute of that Attacking Maneuver."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/hologram-projector.dbu"), true);

  const made = gearItemFrom(projector, null);
  check("Personality, on a Signature Technique", made.system.damageAttribute,
    { attribute: "personality", when: "signature" });
  const kept = new DBUGearData(structuredClone(made.system), { strict: false }).toObject();
  check("which the schema keeps", kept.damageAttribute, made.system.damageAttribute);
  check("and nothing else in the library offers one",
    INDEX.traits.filter(file => file.startsWith("gear/"))
      .map(file => getTrait(path.basename(file, ".dbu")))
      .filter(trait => trait?.damageAttribute).map(trait => trait.id), ["hologram-projector"]);

  // Offered while worn, on an attack made through the Signature Technique Maneuver only.
  const signature = { signature: true };
  const basic = { signature: false };
  check("worn, on a Signature Technique: Personality offered",
    damageAttributeOffers([given("hologram-projector")], signature),
    [{ attribute: "personality", source: "Hologram Projector" }]);
  check("on any other attack: nothing",
    damageAttributeOffers([given("hologram-projector")], basic), []);
  check("not worn: nothing",
    damageAttributeOffers([given("hologram-projector", { equipped: false })], signature), []);
  check("an Accessory that offers none: nothing",
    damageAttributeOffers([given("helmet")], signature), []);

  // The Wound Roll with it: the Attribute swapped, everything else kept - and Powered
  // applying the one swapped in.
  const attacker = { system: {
    combat: { wound: { physical: 10 } },
    attributes: { force: { mod: 4 }, personality: { mod: 7 } }
  } };
  const personality = { label: "Personality Modifier", value: 7 };
  const NAMED = source(read("module", "technique-attack.mjs"), "namedDamageAttribute");
  const woundBase = new Function("DBUCharacterData",
    `${NAMED}\n${source(CHAT, "woundBase")}\nreturn woundBase;`)(DBUCharacterData);
  check("the Wound Roll: Force taken out, Personality put in",
    woundBase(attacker, { foundation: "physical", damageAttribute: personality }),
    { label: "Wound (Personality Modifier)", value: 13 });
  check("and the Foundation's own where nothing stands in",
    woundBase(attacker, { foundation: "physical" }), { label: "Wound", value: 10 });
  const powered = Object.entries(PROFILES_ALL).find(([, profile]) => profile.extraDamageAttribute);
  const profileWoundParts = new Function("DBUCharacterData", "PROFILES", "profileFor",
    `${NAMED}\n${source(CHAT, "profileWoundParts")}\nreturn profileWoundParts;`)(DBUCharacterData, PROFILES_ALL,
      attack => PROFILES_ALL[attack?.profile]);
  check("Powered applies the one standing in again",
    profileWoundParts(attacker, { foundation: "physical", profile: powered[0],
      damageAttribute: personality }).map(part => part.value), [7]);
  check("and the Foundation's own where nothing stands in",
    profileWoundParts(attacker, { foundation: "physical", profile: powered[0] })
      .map(part => part.value), [4]);

  // Asked with the declaration, before anything is paid, and backing out stops the attack.
  const at = USE.indexOf("...damageAttributeOffers(Array.from(actor.items ?? []), maneuver),");
  check("asked after the attack is declared and before anything is checked or paid",
    [at > USE.indexOf("declared = await declareAttack(locked, DBUCharacterData.FOUNDATIONS, actor,"),
     at < USE.indexOf("let outOfReach = targetActor && !maneuver.throws")], [true, true]);
  check("backing out stops it; the Foundation's own leaves the declaration as it was",
    [USE.includes("      if (chosen === null) return false;\n      if (chosen) declared = { ...declared, damageAttribute: chosen };")],
    [true]);
}

// --- Jetpack --------------------------------------------------------------------------------------
{
  const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");
  const CHAT = read("module", "chat.mjs");
  const USE = read("module", "use-maneuver.mjs");
  const { movementPayment, inEffect, gearGranting } = await import(modUrl("gear.mjs"));
  const { whyNotSpecial, getManeuver, loadManeuvers } = await import(modUrl("maneuvers.mjs"));
  await loadManeuvers();

  const jetpack = getTrait("jetpack");
  check("the Jetpack is there, an Accessory in basic/, [Tech], Craft DC Qualified",
    [jetpack?.owner, typeOf(jetpack), jetpack?.special ?? false, jetpack?.craftDC,
     gearItemFrom(jetpack, null).system.tags],
    ["basic", "accessory", false, "Qualified", ["tech"]]);
  check("the entry, as printed", printedLines(jetpack?.text), [
    "Jetpack [Tech]: This is a wearable device that allows flight to characters who cannot "
      + "otherwise fly.",
    "–Craft DC: Qualified",
    "–Effects: A Jetpack has a Ki Point Pool of 30(bT), based on the creator’s Tier of "
      + "Power at the time of creation. When you would spend Ki Points through the Movement "
      + "Maneuver, remove them from the Jetpack instead. You gain access to the Soar Maneuver."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/jetpack.dbu"), true);

  // Made at 30 per base Tier of whoever it is given to.
  const maker = { system: { baseTierOfPower: 3 } };
  const made = gearItemFrom(jetpack, maker);
  check("a pool of 30(bT) of its maker's, kept as its most, paying for Movement, opening Soar",
    [made.system.charges, made.system.chargesMax, made.system.chargesLabel,
     made.system.paysMovement, made.system.grantsManeuver], [90, 90, "Ki", true, "soar"]);
  check("at a base Tier of 1, 30", gearItemFrom(jetpack, { system: { baseTierOfPower: 1 } })
    .system.charges, 30);
  const kept = new DBUGearData(structuredClone(made.system), { strict: false }).toObject();
  check("which the schema keeps",
    [kept.charges, kept.chargesMax, kept.chargesPerBaseTier, kept.paysMovement],
    [90, 90, 30, true]);

  // Who pays a Movement.
  const pack = (charges, equipped = true) => {
    const item = given("jetpack", { equipped });
    item.system.charges = charges;
    return item;
  };
  const paid = (items, price) => {
    const { store, fromStore, fromSelf } = movementPayment(items, price);
    return [Boolean(store), fromStore, fromSelf];
  };
  check("enough in it: all from the Jetpack", paid([pack(20)], 9), [true, 9, 0]);
  check("not enough: what it has, and the character the rest", paid([pack(5)], 9), [true, 5, 4]);
  check("empty: all from the character", paid([pack(0)], 9), [false, 0, 9]);
  check("not worn: all from the character", paid([pack(20, false)], 9), [false, 0, 9]);
  check("nothing to pay: nothing from either", paid([pack(20)], 0), [false, 0, 0]);

  // Soar, while it is worn.
  const soar = getManeuver("soar");
  const flier = items => ({ name: "Flier", items,
    system: { effects: { slots: {} }, specialManeuvers: [] } });
  check("Soar opened while it is worn",
    whyNotSpecial(flier([pack(10)]), soar), null);
  check("and not while it is only carried",
    typeof whyNotSpecial(flier([pack(10, false)]), soar), "string");
  check("a Basic Item still opens its Maneuver just by being held",
    [inEffect({ type: "gear", system: { itemType: "basic" } }),
     inEffect({ type: "gear", system: { itemType: "accessory", equipped: false } })],
    [true, false]);
  check("and the granting Item is found only while it is in effect",
    [Boolean(gearGranting([pack(10)], "soar")), Boolean(gearGranting([pack(10, false)], "soar"))],
    [true, false]);

  // Paid in that order, said on the card, and handed back to each by a Blockade.
  const self = USE.indexOf("!await spendManeuverCost(actor, maneuver, moving.fromSelf)");
  check("the character's part is paid first, then the Jetpack's",
    (self > 0) && (self < USE.indexOf('"system.charges": (Number(moving.store.system.charges) || 0) - moving.fromStore')),
    true);
  check("the card says what the Jetpack paid",
    USE.includes("moving.store ? `${moving.fromStore} Ki from the ${moving.store.name}.` : \"\""), true);
  check("a Blockade gives the character their part and the Jetpack its own, never past its most",
    [CHAT.includes('await refundManeuverCost(mover, { name: "Movement", kiCost: spent.ki });'),
     CHAT.includes('await store.update({ "system.charges": most ? Math.min(most, held) : held });')],
    [true, true]);
}

// --- Ki-Sealing Handcuff --------------------------------------------------------------------------
{
  const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");
  const CHAT = read("module", "chat.mjs");
  const SHEET = read("module", "sheets", "actor-character-sheet.mjs");
  const CONDITIONS = read("module", "conditions.mjs");
  const TAB = read("templates", "parts", "actor-gear.hbs");
  const source = (text, name) => {
    const at = text.search(new RegExp(`(async )?function ${name}\\(`));
    if (at < 0) return "";
    const next = text.slice(at + 1).search(/\n(export )?(async )?function /);
    return next < 0 ? text.slice(at) : text.slice(at, at + 1 + next);
  };
  const { lockedOn, lockedBy, keyItemFor, sealedConditions } = await import(modUrl("gear.mjs"));
  const { maxKiWager, maxLifeWager, whyNotThisProfile, onlySimple } =
    await import(modUrl("maneuvers.mjs"));

  const cuff = getTrait("ki-sealing-handcuff");
  check("the Ki-Sealing Handcuff is there, an Accessory in basic/, [Tech], Craft DC Grandmaster",
    [cuff?.owner, typeOf(cuff), cuff?.special ?? false, cuff?.craftDC,
     gearItemFrom(cuff, null).system.tags],
    ["basic", "accessory", false, "Grandmaster", ["tech"]]);
  check("the entry, as printed", printedLines(cuff?.text), [
    "Ki-Sealing Handcuff [Tech]: These handcuffs are designed for super-powered fighters, "
      + "allowing them to be restrained even by weaker foes.",
    "–Craft DC: Grandmaster",
    "–Effects: When this Accessory is created, you must create a Key Basic Item for this "
      + "instance of the Accessory. You may spend 3 Actions to place this Accessory on a Defeated "
      + "Opponent or a Character with the Oblivious Combat Condition, even if they are already "
      + "wearing an Accessory. In the case of the latter, you must make a Skill Check "
      + "(Stealth/Thievery vs Perception) to put the Ki-Sealing Handcuff on them.",
    "",
    "While wearing this Accessory, you suffer from a stack of the Fatigued Combat Condition "
      + "(that cannot be removed while you’re wearing this Accessory) and you cannot use any "
      + "Transformation Maneuvers, Signature Techniques, Unique Abilities, Ki Wagers, or any "
      + "Profile aside from Simple (Physical).",
    "",
    "While wearing this Accessory, you cannot remove this Accessory and you cannot target this "
      + "Accessory with a Called Shot.",
    "",
    "If you possess the correct Key, you may remove this Accessory by spending 1 Action."
  ]);
  check("in the index, with its mark",
    [INDEX.traits.includes("gear/basic/ki-sealing-handcuff.dbu"),
     INDEX.traits.includes("conditions/ki-sealed.dbu")], [true, true]);
  const sealed = getTrait("ki-sealed");
  check("the mark: not a Combat Condition, holding one stack of Fatigued",
    [sealed?.kind, sealed?.combatCondition, sealed?.holds, sealed?.holdsStacks],
    ["conditions", false, "fatigued", 1]);

  const errors = [];
  programsFor({ uuid: ME, items: [given("ki-sealing-handcuff")] }, { report: m => errors.push(m) });
  check("its script compiles", errors, []);

  const made = gearItemFrom(cuff, null);
  check("3 Actions on, 1 off with the Key, Stealth or Thievery against Perception, Fatigued held",
    made.system.lock, { locks: true, cost: 3, unlockCost: 1, skills: ["stealth", "thievery"],
      against: "perception", condition: "fatigued", mark: "ki-sealed", id: "", gave: false });
  const kept = new DBUGearData(structuredClone(made.system), { strict: false }).toObject();
  check("which the schema keeps", [kept.lock, kept.keyFor], [made.system.lock, ""]);

  // The Key: made with it, and fitting that one only.
  const key = keyItemFor("Ki-Sealing Handcuff", "abc", getTrait("key"));
  check("a Key made with it, a Basic Item naming it",
    [key.name, key.system.itemType, key.system.keyFor], ["Key (Ki-Sealing Handcuff)", "basic", "abc"]);
  // The Key Basic Item's own entry: "This Key only works on that chosen target."
  check("made from the Key's entry, which is there",
    [key.system.gearId, key.system.craftDC, String(key.system.text).includes("This Key only works on that chosen target.")],
    ["key", "Qualified", true]);
  check("and without the entry, still a Key", keyItemFor("Ki-Sealing Handcuff", "abc").system.keyFor, "abc");
  const SHEET_KEY = fs.readFileSync(path.join(ROOT, "module", "sheets", "actor-character-sheet.mjs"), "utf8");
  check("given alone, it asks what it opens: one of their locks, or a Base's Door",
    [SHEET_KEY.includes("if (definition.key === true) {"),
     SHEET_KEY.includes('data.system.keyFor = lock ? lock.system.lock.id : "";')], [true, true]);
  check("and the Key's fields kept by the schema",
    new DBUGearData(structuredClone(key.system), { strict: false }).toObject().keyFor, "abc");
  const on = (id, equipped = true) => {
    const item = given("ki-sealing-handcuff", { equipped });
    item.system.lock = { ...item.system.lock, id };
    return item;
  };
  check("locked on only while worn", [lockedOn(on("abc")), lockedOn(on("abc", false))], [true, false]);
  check("the correct Key opens it, another does not, nor one not locked on",
    [lockedBy([on("abc")], key)?.system.lock.id ?? null,
     lockedBy([on("xyz")], key), lockedBy([on("abc", false)], key)], ["abc", null, null]);

  // The hold: a stack of Fatigued and the mark, on together and off together.
  const lock = made.system.lock;
  check("on: a stack of Fatigued added, and the mark",
    [sealedConditions({}, lock, true, 2), sealedConditions({ fatigued: 1 }, lock, true, 2),
     sealedConditions({ fatigued: 2 }, lock, true, 2)],
    [{ fatigued: 1, "ki-sealed": 1 }, { fatigued: 2, "ki-sealed": 1 }, { fatigued: 2, "ki-sealed": 1 }]);
  const gave = { ...lock, gave: true };
  check("off: the mark and the stack it gave come off together",
    [sealedConditions({ fatigued: 1, "ki-sealed": 1 }, gave, false),
     sealedConditions({ fatigued: 2, "ki-sealed": 1, prone: 1 }, gave, false)],
    [{}, { fatigued: 1, prone: 1 }]);
  check("and a stack it found already there stays",
    sealedConditions({ fatigued: 2, "ki-sealed": 1 }, { ...lock, gave: false }, false),
    { fatigued: 2 });
  check("put on, it remembers whether it gave one",
    [source(CHAT, "lockOn").includes("data.system.lock.gave = had < most;"),
     source(CHAT, "lockOn").indexOf("data.system.lock.gave")
       < source(CHAT, "lockOn").indexOf("await requestCreateItem(target, data);")], [true, true]);

  // Held: one stack, never the rest.
  const heldInPlace = new Function("getTrait",
    `${source(CONDITIONS, "heldInPlace")}\nreturn heldInPlace;`)(getTrait);
  const wearer = { name: "Them", system: { conditions: { fatigued: 2, "ki-sealed": 1 } } };
  check("Fatigued can come down to the one stack held, not below",
    [heldInPlace(wearer, "fatigued", 1), Boolean(heldInPlace(wearer, "fatigued", 0))], ["", true]);
  check("and Tased still holds Prone outright",
    Boolean(heldInPlace({ name: "X", system: { conditions: { tased: 1, prone: 1 } } }, "prone", 0)),
    true);

  // Worn, what it closes - through the whole engine.
  const worn = holding([on("abc")]);
  const loose = holding([on("abc", false)]);
  const closed = model => ["transformations", "signatureTechniques", "uniqueAbilities", "kiWagers",
    "nonPhysicalAttacks", "profiles.nonSimple"].filter(key => model.effects.slots?.[key] === false);
  check("worn: Transformations, Signature Techniques, Unique Abilities, Ki Wagers, and all but "
    + "Simple (Physical) closed", closed(worn),
    ["transformations", "signatureTechniques", "uniqueAbilities", "kiWagers", "nonPhysicalAttacks",
     "profiles.nonSimple"]);
  check("carried and not worn: nothing closed", closed(loose), []);

  const who = model => ({ name: "Them", system: model });
  check("no Ki Wager, in Ki or in Life", [maxKiWager(who(worn)), maxLifeWager(who(worn))], [0, 0]);
  check("where one could wager without it", maxKiWager(who(loose)) > 0, true);
  const other = Object.keys(PROFILES_ALL).find(id => id !== "simple");
  check("Simple is the only Profile left, on any Maneuver",
    [whyNotThisProfile(who(worn), { id: "signature" }, "simple"),
     Boolean(whyNotThisProfile(who(worn), { id: "signature" }, other)),
     whyNotThisProfile(who(loose), { id: "signature" }, other)], ["", true, ""]);
  check("and the picker says so on the row", onlySimple(who(worn), other), true);

  // Putting it on, and taking it off.
  const lockOnGear = SHEET.slice(SHEET.indexOf("static async _onLockGear("),
    SHEET.indexOf("static async _onUnlockGear("));
  check("Oblivious asked with the Skill, before any Action; Defeated goes straight on",
    [lockOnGear.indexOf("if (!onto.system.defeated) {") < lockOnGear.indexOf("spendActions("),
     lockOnGear.includes("if (!skill) return lockOn(this.actor, item, onto);")], [true, true]);
  check("the Clash is Stealth or Thievery against Perception, and settles by putting it on",
    [lockOnGear.includes("{ name: item.name, clash: { skill, defenderSkills: [lock.against] } }"),
     CHAT.includes("  if (clash.handcuff && clash.result && !clash.handcuff.applied) {"),
     source(CHAT, "settleHandcuff").includes("await lockOn(placer, item, target);")],
    [true, true, true]);
  const lockOnSource = source(CHAT, "lockOn");
  check("on: worn past the two, theirs, and the hold written in one go",
    [lockOnSource.includes("data.system.equipped = true;"),
     lockOnSource.includes("await requestCreateItem(target, data);"),
     lockOnSource.includes("sealedConditions(target.system.conditions, lock, true,")],
    [true, true, true]);
  check("made with its Key at Add Item",
    SHEET.includes('[data, keyItemFor(definition.name, data.system.lock.id, getTrait("key"))]);'), true);
  check("not taken off or thrown away while locked on",
    [SHEET.slice(SHEET.indexOf("static async _onEquipGear(")).indexOf("if (lockedOn(item)) {") < 400,
     SHEET.slice(SHEET.indexOf("static async _onDeleteItem(")).indexOf("if (lockedOn(item)) {") < 300],
    [true, true]);
  const unlock = source(CHAT, "unlockFrom");
  check("the Key takes it off, back to its holder, and the hold with it",
    [unlock.includes("sealedConditions(wearer.system.conditions, item.system.lock, false)"),
     unlock.includes("await requestDeleteItem(wearer, item.id);"),
     unlock.includes("data.system.equipped = false;")], [true, true, true]);
  check("the rows: Locked on, Lock on, Unlock",
    [TAB.includes('<span class="gear-type">Locked on</span>'),
     TAB.includes('data-action="lockGear"'), TAB.includes('data-action="unlockGear"')],
    [true, true, true]);
  check("an Item given to a character the player does not own goes through the GM",
    [CHAT.includes('case "createItem": return fromUuidSync(request.actorUuid)'),
     CHAT.includes('case "deleteItem": return fromUuidSync(request.actorUuid)?.items.get(request.itemId)?.delete();')],
    [true, true]);
}

// --- Mask -----------------------------------------------------------------------------------------
{
  const mask = getTrait("mask");
  check("the Mask is there, an Accessory in basic/, Craft DC Qualified",
    [mask?.owner, typeOf(mask), mask?.special ?? false, mask?.craftDC],
    ["basic", "accessory", false, "Qualified"]);
  check("the entry, as printed", printedLines(mask?.text), [
    "Mask: A false face that can be worn over your real face to protect your identity.",
    "–Craft DC: Qualified",
    "–Effects: Increase your Bluff Skill Checks by 2."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/mask.dbu"), true);

  const errors = [];
  programsFor({ uuid: ME, items: [given("mask")] }, { report: m => errors.push(m) });
  check("its script compiles", errors, []);

  const bare = holding([]);
  const rolls = model => Object.fromEntries(Object.entries(model.skills)
    .map(([key, skill]) => [key, skill.roll - bare.skills[key].roll])
    .filter(([, change]) => change !== 0));
  const worn = holding([given("mask")]);
  check("worn: Bluff Checks 2 higher, and no other Skill", rolls(worn), { bluff: 2 });
  check("on the roll, not the Skill Bonus", worn.skills.bluff.bonus - bare.skills.bluff.bonus, 0);
  check("not worn: nothing", rolls(holding([given("mask", { equipped: false })])), {});
  check("with the Helmet: Bluff 4 higher, each its own",
    rolls(holding([given("mask"), given("helmet")])), { bluff: 4 });
}

// --- Micro Band -----------------------------------------------------------------------------------
{
  const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");
  const SHEET = read("module", "sheets", "actor-character-sheet.mjs");
  const { shrunkSize, shrinkChoices } = await import(modUrl("gear.mjs"));

  const band = getTrait("micro-band");
  check("the Micro Band is there, an Accessory in basic/, [Tech], Craft DC Master",
    [band?.owner, typeOf(band), band?.special ?? false, band?.craftDC,
     gearItemFrom(band, null).system.tags],
    ["basic", "accessory", false, "Master", ["tech"]]);
  check("the entry, as printed", printedLines(band?.text), [
    "Micro Band [Tech]: A watch that allows you to shrink.",
    "–Craft DC: Master",
    "–Effects: At the cost of 1 Action, you may reduce your Size Category to the Tiny or "
      + "Nano Size Category. You can spend 1 Action to return to your base Size Category."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/micro-band.dbu"), true);

  const made = gearItemFrom(band, null);
  check("Tiny or Nano, an Action each way, at their own Size to begin",
    made.system.shrink, { to: ["tiny", "nano"], cost: 1, now: "" });
  const kept = new DBUGearData(structuredClone(made.system), { strict: false }).toObject();
  check("which the schema keeps", kept.shrink, made.system.shrink);

  const shrunk = (now, equipped = true) => {
    const item = given("micro-band", { equipped });
    item.system.shrink = { ...item.system.shrink, now };
    return item;
  };
  check("the Size it has them at, only while worn",
    [shrunkSize([shrunk("nano")]), shrunkSize([shrunk("nano", false)]), shrunkSize([shrunk("")])],
    ["nano", "", ""]);

  const order = Object.keys(DBUCharacterData.SIZES);
  check("offered only what is smaller than they were built as",
    [shrinkChoices(made, "medium", order), shrinkChoices(made, "tiny", order),
     shrinkChoices(made, "nano", order)], [["tiny", "nano"], ["nano"], []]);

  // Through the whole engine: the Size, and what a Size changes.
  const built = holding([]);
  const tiny = holding([shrunk("tiny")]);
  const nano = holding([shrunk("nano")]);
  check("shrunk to Tiny, and to Nano; built as they were",
    [built.size.key, tiny.size.key, nano.size.key, tiny.size.chosen], ["medium", "tiny", "nano", "medium"]);
  check("and what a Size changes follows it",
    [tiny.size.steps, nano.size.steps, tiny.size.speedModifier, nano.size.speedModifier],
    [-2, -3, DBUCharacterData.SIZES.tiny.speed, DBUCharacterData.SIZES.nano.speed]);
  check("Speed with it", tiny.speed.normal - built.speed.normal,
    Math.floor(0) + DBUCharacterData.SIZES.tiny.speed);
  check("taken off: their own Size", holding([shrunk("tiny", false)]).size.key, "medium");
  check("Liquid's step down moves them from the Tiny it named",
    holding([shrunk("tiny")], { states: { liquid: 1 } }).size.key, "nano");

  // The row, and the sheet's own choice of Size.
  const shrink = SHEET.slice(SHEET.indexOf("static async _onShrinkGear("),
    SHEET.indexOf("static async _onUnlockGear("));
  check("Return an Action back; Shrink asks which, then spends the Action",
    [shrink.indexOf('if (shrink.now) {') < shrink.indexOf('return item.update({ "system.shrink.now": "" });'),
     shrink.indexOf("await foundry.applications.api.DialogV2.wait(") < shrink.lastIndexOf("spendActions(")],
    [true, true]);
  check("taking it off takes its Size with it",
    SHEET.includes('...(wearing && item.system.shrink?.now ? { "system.shrink.now": "" } : {}) });'), true);
  check("the sheet's Size choice is the one they made, not where an effect put them",
    // The one they made - and Medium where the sheet cannot read one (the user's: new characters came out Small).
    [SHEET.includes('const built = (read in DBUCharacterData.SIZES) ? read : DBUCharacterData.DEFAULT_SIZE;'),
     SHEET.includes("selected: key === built")], [true, true]);
}

// --- Sash -----------------------------------------------------------------------------------------
{
  const sash = getTrait("sash");
  check("the Sash is there, an Accessory in basic/, Craft DC Qualified",
    [sash?.owner, typeOf(sash), sash?.special ?? false, sash?.craftDC],
    ["basic", "accessory", false, "Qualified"]);
  check("the entry, as printed", printedLines(sash?.text), [
    "Sash: A flowing piece of fabric, typically worn hanging free from the waist or around one "
      + "shoulder.",
    "–Craft DC: Qualified",
    "–Effects: Increase your Impulsive Saving Throws by 1(bT)."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/sash.dbu"), true);

  const errors = [];
  programsFor({ uuid: ME, items: [given("sash")] }, { report: m => errors.push(m) });
  check("its script compiles", errors, []);

  const bare = holding([]);
  const bT = bare.baseTierOfPower;
  const saves = items => Object.fromEntries(Object.entries(holding(items).savingThrows)
    .map(([key, save]) => [key, save.value - bare.savingThrows[key].value]));
  check("worn: Impulsive 1(bT) higher, and no other Saving Throw", saves([given("sash")]),
    { impulsive: bT, corporeal: 0, cognitive: 0, morale: 0 });
  check("not worn: nothing", saves([given("sash", { equipped: false })]),
    { impulsive: 0, corporeal: 0, cognitive: 0, morale: 0 });
  check("named on the Impulsive hover",
    (holding([given("sash")]).effects.workings["save.impulsive"]?.contributions ?? [])
      .map(part => part.source).includes("Sash"), true);
}

// --- Scouter --------------------------------------------------------------------------------------
{
  const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");
  const CHAT = read("module", "chat.mjs");
  const SHEET = read("module", "sheets", "actor-character-sheet.mjs");
  const USE = read("module", "use-maneuver.mjs");
  const TAB = read("templates", "parts", "actor-gear.hbs");
  const source = (text, name) => {
    const at = text.search(new RegExp(`(async )?function ${name}\\(`));
    if (at < 0) return "";
    const next = text.slice(at + 1).search(/\n(export )?(async )?function /);
    return next < 0 ? text.slice(at) : text.slice(at, at + 1 + next);
  };
  const { atCraftDC, brokenByPowerUp, stillHidden, hiddenKey, inEffect } =
    await import(modUrl("gear.mjs"));

  const scouter = getTrait("scouter");
  check("the Scouter is there, an Accessory in basic/, [Tech], Craft DC Variable",
    [scouter?.owner, typeOf(scouter), scouter?.special ?? false, scouter?.craftDC,
     gearItemFrom(scouter, null).system.tags],
    ["basic", "accessory", false, "Variable (Qualified ~ Grandmaster)", ["tech"]]);
  check("the entry, as printed", printedLines(scouter?.text), [
    "Scouter [Tech]: A more advanced, wearable version of the Scout Scope, this one functions as "
      + "a Communicator as well.",
    "–Craft DC: Variable (Qualified ~ Grandmaster)",
    "–Effects: During a Combat Encounter, you can spend 1 Action to attempt to scan the "
      + "strength of another Character. Characters may attempt a Concealment Skill Check equal "
      + "to the Craft DC of this Scouter to try and avoid being scanned. If they succeed, nothing "
      + "happens and they automatically succeed on any further Concealment Skill Checks to avoid "
      + "being spotted by a Scouter for the remainder of the Combat Encounter. If their current "
      + "Tier of Power is the same as their base Tier of Power, you also learn of their Power "
      + "Level.",
    "",
    "If the Craft DC of a Scouter is Expert or lower, it can be destroyed when a Character of "
      + "Tier of Power 2+ (Qualified) or 3+ (Expert) uses the Power Up Maneuver within 15 Squares "
      + "of you, or when within several hundred miles while Adventuring.",
    "",
    "While you have this Accessory equipped, you have access to the Scan Adventuring Maneuver. "
      + "The Scouter also functions as a Communicator."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/scouter.dbu"), true);

  const made = gearItemFrom(scouter, null);
  check("an Action, Concealment, in combat only, hidden for the Encounter whatever Holding Back does",
    [made.system.placeCost, made.system.scan.skill, made.system.scan.combatOnly,
     made.system.scan.holdingBack], [1, "concealment", true, false]);
  check("four Craft DCs to be made at; two of them fragile",
    [made.system.craftDCChoices, made.system.breaksAt],
    [["qualified", "expert", "master", "grandmaster"], { qualified: 2, expert: 3 }]);
  const kept = new DBUGearData(structuredClone(made.system), { strict: false }).toObject();
  check("which the schema keeps",
    [kept.scan, kept.craftDCChoices, kept.breaksAt],
    [made.system.scan, made.system.craftDCChoices, made.system.breaksAt]);

  // Made at a Craft DC: the Check it asks for, and what destroys it.
  const labels = DBUCharacterData.DIFFICULTIES;
  const at = key => atCraftDC(made.system, key, labels);
  check("made at each: the DC, the Concealment asked, the Tier that breaks it",
    ["qualified", "expert", "master", "grandmaster"].map(key => {
      const { craftDC, scan } = at(key);
      return [craftDC, scan.difficulty, scan.breaksAt];
    }),
    [["Qualified", "qualified", 2], ["Expert", "expert", 3], ["Master", "master", 0],
     ["Grandmaster", "grandmaster", 0]]);
  check("and the Scout Scope keeps its own", gearItemFrom(getTrait("scout-scope"), null).system.scan,
    { skill: "concealment", difficulty: "qualified", combatOnly: false, holdingBack: true, breaksAt: 0 });

  // Hidden for the Encounter, whatever the Holding Back stacks do.
  const hider = stacks => ({ system: { resources: { holdingback: { stacks } },
    usedManeuvers: [hiddenKey("scouter", 0)] } });
  check("hidden from Scouters with no stacks, and still hidden with none",
    [stillHidden(hider(0), "scouter"), stillHidden(hider(3), "scouter")], [true, true]);
  check("the scan card carries which it is, and remembers 0 stacks for the Scouter",
    [source(CHAT, "postScan").includes("holdingBack: item.system.scan.holdingBack !== false,"),
     source(CHAT, "settleScan").includes("(scan.holdingBack !== false) ? holdingBackStacks(scanned) : 0")],
    [true, true]);

  // Worn, and in combat.
  const scanOn = (equipped) => ({ ...made, system: { ...made.system, equipped } });
  check("scans only while worn", [inEffect(scanOn(true)), inEffect(scanOn(false))], [true, false]);
  check("the row says so, and scans need a Combat Encounter when the Item says",
    [SHEET.includes("scans: Boolean(item.system.scan?.skill) && inEffect(item),"),
     SHEET.includes("if (item.system.scan.combatOnly && !game.combat?.started) {")], [true, true]);
  check("the Craft DC asked when it is given",
    SHEET.includes("const made = atCraftDC(data.system, chosen, labels);"), true);

  // What a Power Up destroys.
  const owner = (name, items) => ({ name, items });
  const q = { ...made, name: "Scouter Q", system: { ...made.system, scan: at("qualified").scan } };
  const e = { ...made, name: "Scouter E", system: { ...made.system, scan: at("expert").scan } };
  const m = { ...made, name: "Scouter M", system: { ...made.system, scan: at("master").scan } };
  const world = [owner("A", [q]), owner("B", [e, m])];
  const names = tier => brokenByPowerUp(world, tier).map(entry => entry.item.name);
  check("a Power Up at Tier 1 breaks nothing, 2 the Qualified, 3 the Expert too, Master never",
    [names(1), names(2), names(3), names(9)],
    [[], ["Scouter Q"], ["Scouter Q", "Scouter E"], ["Scouter Q", "Scouter E"]]);
  check("the Power Up card names them, and the row says Fragile",
    [USE.includes("soarNote(maneuver, soarTo), powerUpBreaks(actor, maneuver),"),
     source(USE, "powerUpBreaks").includes("if (!maneuver.powerUp) return \"\";"),
     TAB.includes("Fragile</span>")], [true, true, true]);
}

// --- Sheath/Holster -------------------------------------------------------------------------------
{
  const sheath = getTrait("sheath-holster");
  check("the Sheath/Holster is there, an Accessory in basic/, Craft DC Qualified",
    [sheath?.owner, typeOf(sheath), sheath?.special ?? false, sheath?.craftDC],
    ["basic", "accessory", false, "Qualified"]);
  check("the entry, as printed", printedLines(sheath?.text), [
    "Sheath/Holster: You can store a Weapon in this Accessory for ease of travel.",
    "–Craft DC: Qualified",
    "–Effects: When you sheathe a Weapon, you may store it within this Accessory. When you "
      + "unsheathe your Weapon from this Accessory for the first time in a Combat Encounter, "
      + "increase your next Strike Roll made for an Armed Attack with that Weapon during this "
      + "Combat Round by 2(T).",
    "",
    "At the end of each Combat Encounter, if you sheathe your Weapon into this Accessory, that "
      + "Weapon regains 1/4 of its Life Points. This effect does not apply if the Weapon is "
      + "destroyed.",
    "",
    "If this Item is stolen or lost while a Weapon is sheathed inside of it, the Weapon remains "
      + "in the Item and is stolen/lost as well."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/sheath-holster.dbu"), true);

  // What it does is done off the Weapon put in it - see the weapons harness - and the file says so.
  const errors = [];
  programsFor({ uuid: ME, items: [given("sheath-holster")] }, { report: m => errors.push(m) });
  check("no script of its own to fail", errors, []);
  check("what it does with a Weapon is written down",
    [/putting a Weapon away \(Sheathe, on its row\) asks whether it goes in/.test((sheath?.script ?? "").replace(/\s*#\s*/g, " ")),
     /regains a quarter of its Life Points/.test((sheath?.script ?? "").replace(/\s*#\s*/g, " "))], [true, true]);
  const bare = holding([]);
  const worn = holding([given("sheath-holster")]);
  check("and worn, it changes nothing on the sheet yet",
    [worn.combat.strike - bare.combat.strike, worn.damageReduction - bare.damageReduction],
    [0, 0]);
}

// --- Shock Collar ---------------------------------------------------------------------------------
{
  const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");
  const CHAT = read("module", "chat.mjs");
  const SHEET = read("module", "sheets", "actor-character-sheet.mjs");
  const ITEM_SHEET = read("module", "sheets", "item-gear-sheet.mjs");
  const source = (text, name) => {
    const at = text.search(new RegExp(`(async )?function ${name}\\(`));
    if (at < 0) return "";
    const next = text.slice(at + 1).search(/\n(export )?(async )?function /);
    return next < 0 ? text.slice(at) : text.slice(at, at + 1 + next);
  };
  const { connectable, connectedTarget, canTrigger, shockAmount } = await import(modUrl("gear.mjs"));

  const collar = getTrait("shock-collar");
  check("the Shock Collar is there, an Accessory in basic/, [Tech], Craft DC Expert",
    [collar?.owner, typeOf(collar), collar?.special ?? false, collar?.craftDC,
     gearItemFrom(collar, null).system.tags],
    ["basic", "accessory", false, "Expert", ["tech"]]);
  check("the entry, as printed", printedLines(collar?.text), [
    "Shock Collar [Tech]: This collar is designed to emit an electric shock when the "
      + "corresponding remote is triggered.",
    "–Craft DC: Expert",
    "–Effects: This Accessory is connected to a Remote Control. If the Remote Control "
      + "triggers the effects of a Shock Collar, reduce your Life Points by 1/5 of your Maximum "
      + "Life Points. If you are knocked through a Health Threshold by this effect, you are "
      + "knocked Prone."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/shock-collar.dbu"), true);

  const made = gearItemFrom(collar, null);
  check("paired, 1/5 of Maximum Life, Prone through a Threshold",
    [made.system.paired, made.system.pairId, made.system.shock], [true, "", { part: 5, prone: true }]);
  const kept = new DBUGearData(structuredClone(made.system), { strict: false }).toObject();
  check("which the schema keeps", [kept.paired, kept.shock, kept.pairId, kept.connectedPair],
    [true, { part: 5, prone: true }, "", ""]);

  // Connected from a Remote Control, and found wherever it is worn.
  const remote = gearItemFrom(getTrait("remote-control"), null);
  const mine = { ...made, id: "c1", name: "Shock Collar",
    system: { ...made.system, pairId: "pair1", equipped: false } };
  check("a Remote Control may be connected to it", connectable([mine], { id: "r", ...remote })
    .map(item => item.id), ["c1"]);
  const linked = { id: "r", system: { ...remote.system, connectedTo: "c1", connectedPair: "pair1" } };
  const onThem = { ...mine, id: "c2", system: { ...mine.system, equipped: true } };
  const them = { name: "Them", items: [onThem] };
  const reached = connectedTarget(linked, [], [them]);
  check("found on whoever wears it, and named with them",
    [reached?.item.id, reached?.wearer?.name, canTrigger(reached?.item)], ["c2", "Them", true]);
  const idle = connectedTarget(linked, [mine], [{ name: "Me", items: [mine] }]);
  check("carried and not worn: found, and nothing to set off",
    [idle?.item.id, canTrigger(idle?.item)], ["c1", false]);
  check("of two copies about, the one worn",
    connectedTarget(linked, [mine], [{ name: "Me", items: [mine] }, them])?.item.id, "c2");
  const bomb = { id: "b1", system: { placed: true, trigger: "remote", detonation: { profile: "simple" } } };
  check("and a Bomb still found among the holder's own, by its id",
    connectedTarget({ system: { connectedTo: "b1", connectedPair: "" } }, [bomb], [])?.item.id, "b1");

  // The shock.
  check("1/5 of their Maximum Life Points, rounded down",
    [shockAmount(made, { system: { life: { max: 300 } } }),
     shockAmount(made, { system: { life: { max: 123 } } })], [60, 24]);

  // reduceLifePoints says whether it knocked them through a Health Threshold.
  const writes = [];
  const broke = [];
  const reduce = new Function("DBUCharacterData", "requestActorUpdate", "ChatMessage", "Handlebars",
    "sayApparelBreak", `${source(CHAT, "reduceLifePoints")}\nreturn reduceLifePoints;`)(
      DBUCharacterData, async (actor, changes) => writes.push(changes),
      { create: async () => null, getSpeaker: () => ({}) }, { escapeExpression: String },
      async target => broke.push(target));
  const max = 300;
  const key = value => DBUCharacterData.thresholdKey(value, max);
  let crossing = null;
  let staying = null;
  for (let value = max; value > 60; value--) {
    if ((key(value - 60) !== key(value)) && (crossing === null)) crossing = value;
    if ((key(value - 60) === key(value)) && (staying === null)) staying = value;
  }
  const at = value => ({ system: { life: { value, max }, effects: { slots: {} } } });
  check("a reduction that crosses a Health Threshold says so",
    (await reduce(at(crossing), 60)).knockedThrough, true);
  check("and one that stays inside it does not",
    (await reduce(at(staying), 60)).knockedThrough, false);
  check("through a Threshold, what they wear on top loses Break Value; inside one, nothing does",
    [broke.length, (await reduce(at(staying), 60)) && broke.length], [1, 1]);
  check("the Prone only through a Threshold, and only for a Collar that says so",
    source(CHAT, "shockCollar").includes("if (!(collar.system.shock?.prone && knockedThrough)) return;"),
    true);

  // Wired: Trigger on the Remote's row, the pair kept wherever the connection is set.
  const fire = SHEET.slice(SHEET.indexOf("static async _onRemoteGear("),
    SHEET.indexOf("static async _onDetonateGear("));
  check("Trigger sets off a Collar on its wearer, for the Remote's Action",
    [fire.includes("if (reached.item.system.shock?.part) {"),
     fire.includes("return shockCollar(this.actor, reached.item, reached.wearer ?? this.actor);")],
    [true, true]);
  check("the pair set when it is given, and carried with the connection both ways",
    [SHEET.includes("if (data.system.paired) data.system.pairId = foundry.utils.randomID();"),
     SHEET.includes("data.system.connectedPair = offered.find(item => item.id === chosen)?.system.pairId ?? \"\";"),
     ITEM_SHEET.includes("foundry.utils.setProperty(submitData, \"system.connectedPair\",")],
    [true, true, true]);
}

// --- Space Helmet ---------------------------------------------------------------------------------
{
  const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");
  const COMBAT = read("module", "combat.mjs");
  const INIT = read("module", "dbu-ttrpg.mjs");
  const { isUnbreathable } = await import(modUrl("breath.mjs"));

  const helmet = getTrait("space-helmet");
  check("the Space Helmet is there, an Accessory in basic/, [Tech], Craft DC Expert",
    [helmet?.owner, typeOf(helmet), helmet?.special ?? false, helmet?.craftDC,
     gearItemFrom(helmet, null).system.tags],
    ["basic", "accessory", false, "Expert", ["tech"]]);
  check("the entry, as printed", printedLines(helmet?.text), [
    "Space Helmet [Tech]: An airtight helmet that offers you breathable air.",
    "–Craft DC: Expert",
    "–Effects: While you are wearing this Accessory, ignore Unbreathable Environments."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/space-helmet.dbu"), true);

  const errors = [];
  programsFor({ uuid: ME, items: [given("space-helmet")] }, { report: m => errors.push(m) });
  check("its script compiles", errors, []);

  // Standing in an Unbreathable Environment, through the whole engine.
  const vacuum = getTrait("unbreathable-environment");
  check("the Unbreathable Environment is one there is, and says so", vacuum?.unbreathable, true);
  const standing = items => {
    const parent = new ActorStub({}, { strict: false });
    parent.items = items;
    parent.uuid = ME;
    const model = new DBUCharacterData({ powerLevel: 10, progression: progressionTo(10),
      battlefield: { environment: "unbreathable-environment" } }, { parent, strict: false });
    parent.system = model;
    model.prepareBaseData?.();
    model.prepareDerivedData();
    return { system: model, items };
  };
  check("bare, it is Unbreathable", isUnbreathable(standing([])), true);
  check("with the helmet on, it is not", isUnbreathable(standing([given("space-helmet")])), false);
  check("carried and not worn, it still is",
    isUnbreathable(standing([given("space-helmet", { equipped: false })])), true);
  check("and any other Accessory worn leaves it Unbreathable",
    isUnbreathable(standing([given("helmet")])), true);

  // Putting it on or taking it off in the middle of one is entering or leaving it.
  check("wearing, taking off, giving worn and throwing away worn are all asked",
    ["preUpdateItem", "preCreateItem", "preDeleteItem", "updateItem", "createItem", "deleteItem"]
      .map(hook => COMBAT.includes(`Hooks.on("${hook}"`)), [true, true, true, true, true, true]);
  check("each settling as the move does: entered or left",
    [COMBAT.includes("if (now) await enteredUnbreathable(actor);\n    else await leftUnbreathable(actor);\n  };"),
     INIT.includes("registerWornBreathHooks();")], [true, true]);
}

// --- Bloodstained Accessory -----------------------------------------------------------------------
{
  const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");
  const CONDITIONS = read("module", "conditions.mjs");
  const { statesOffered } = await import(modUrl("gear.mjs"));

  const blood = getTrait("bloodstained-accessory");
  check("the Bloodstained Accessory is there, a Special Accessory in basic/, no Craft DC",
    [blood?.owner, typeOf(blood), blood?.special, blood?.craftDC ?? ""],
    ["basic", "accessory", true, ""]);
  check("the entry, as printed", printedLines(blood?.text), [
    "Bloodstained Accessory: A piece of cloth or keepsake stained with the blood of a fallen "
      + "comrade used to remind you what you’re fighting for.",
    "–Effects: This Accessory has multiple effects that apply while it is equipped:",
    "",
    "* Increase the Dice Score of your Steadfast Checks by 1.",
    "* Increase your Morale Saves by 1(bT).",
    "* While in the Raging State, increase your Wound Rolls by 1(T).",
    "* If you enter the Raging State, you may enter the Determined State until the end of your "
      + "turn. This effect can only be used once for this Accessory.",
    "",
    "When an Ally dies, you may take an Accessory they possess or tear off a piece of their "
      + "Apparel by spending 2 Actions beside them. If you do, that Accessory or piece of Apparel "
      + "becomes a Bloodstained Accessory."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/bloodstained-accessory.dbu"), true);

  const errors = [];
  programsFor({ uuid: ME, items: [given("bloodstained-accessory")] }, { report: m => errors.push(m) });
  check("its script compiles", errors, []);

  const bare = holding([]);
  const bT = bare.baseTierOfPower;
  const worn = holding([given("bloodstained-accessory")]);
  check("worn: Steadfast Checks 1 higher, Morale 1(bT) higher",
    [worn.steadfast.bonus - bare.steadfast.bonus,
     worn.savingThrows.morale.value - bare.savingThrows.morale.value], [1, bT]);
  const wounds = model => Object.values(model.combat.wound);
  const minus = (a, b) => a.map((value, i) => value - b[i]);
  check("not Raging: no Wound Roll moves", minus(wounds(worn), wounds(bare)), [0, 0, 0]);
  const raging = holding([], { states: { raging: 1 } });
  const ragingWorn = holding([given("bloodstained-accessory")], { states: { raging: 1 } });
  const T = raging.tierOfPower;
  check("Raging: every Wound Roll 1(T) higher than Raging alone gives",
    minus(wounds(ragingWorn), wounds(raging)), [T, T, T]);
  // Above their base Tier, so a (T) read as (bT) shows.
  const lifted = { states: { raging: 1 }, tierOfPowerModifier: 1 };
  const liftedBare = holding([], lifted);
  const liftedWorn = holding([given("bloodstained-accessory")], lifted);
  check("(T), the current Tier, not the base one",
    [liftedBare.tierOfPower > liftedBare.baseTierOfPower,
     ...minus(wounds(liftedWorn), wounds(liftedBare))],
    [true, liftedBare.tierOfPower, liftedBare.tierOfPower, liftedBare.tierOfPower]);
  const off = holding([given("bloodstained-accessory", { equipped: false })], { states: { raging: 1 } });
  check("not worn: nothing", [off.steadfast.bonus - bare.steadfast.bonus,
    ...minus(wounds(off), wounds(raging))], [0, 0, 0, 0]);

  // Determined on entering Raging, once for this Accessory.
  const made = gearItemFrom(blood, null);
  check("Determined on entering Raging, until the end of the turn, not yet used",
    made.system.entersOn, { from: "raging", state: "determined", edge: "end", spent: false });
  const kept = new DBUGearData(structuredClone(made.system), { strict: false }).toObject();
  check("which the schema keeps", kept.entersOn, made.system.entersOn);
  const spent = () => {
    const item = given("bloodstained-accessory");
    item.system.entersOn = { ...item.system.entersOn, spent: true };
    return item;
  };
  check("offered on entering Raging, while worn and unused, and on nothing else",
    [statesOffered([given("bloodstained-accessory")], "raging").length,
     statesOffered([given("bloodstained-accessory")], "mindful").length,
     statesOffered([given("bloodstained-accessory", { equipped: false })], "raging").length,
     statesOffered([spent()], "raging").length], [1, 0, 0, 0]);
  const offer = CONDITIONS.slice(CONDITIONS.indexOf("export async function offerStatesOnEntering("),
    CONDITIONS.indexOf("export function registerConditionHooks("));
  check("taken: the State, a clock to the end of the turn, and this Accessory's once used",
    [offer.indexOf('if (chosen !== "take") continue;') < offer.indexOf("const added = await raiseState(actor, on.state, 1);"),
     offer.includes("edge: (on.edge === \"start\") ? EDGES.START : EDGES.END, source: item.name });") && offer.includes("levels: added,"),
     offer.includes('await item.update({ "system.entersOn.spent": true });')], [true, true, true]);
  check("asked of whoever entered the State, on their own client, on entering only",
    [CONDITIONS.includes("if ((userId !== game.user.id) || !actor.isOwner) return;"),
     CONDITIONS.includes("if (!((Number(options.dbuStatesBefore[key]) || 0) > 0) && ((Number(now[key]) || 0) > 0)) {")],
    [true, true]);
}

// --- A raised Dice Score is shown where the Skill's number is --------------------------------------
{
  // "Increase the Dice Score of your Skill Checks" is, to the player, the Skill's number going
  // up: the sheet's Skill column is the roll - Bonus and every increase to the Dice Score - and
  // its hover names each increase.
  const MAIN = fs.readFileSync(path.join(ROOT, "templates", "parts", "actor-main.hbs"), "utf8");
  check("the Skill column shows the roll, not the bare Skill Bonus",
    [MAIN.includes('<span class="skill-bonus dbu-main-bonus" data-tooltip-html="{{skill.workings}}">{{numberFormat skill.roll decimals=0 sign=true}}</span>'),
     /\{\{numberFormat skill\.bonus/.test(MAIN)], [true, false]);
  const bare = holding([]);
  const worn = holding([given("champion-belt"), given("mask")]);
  check("so a Dice Score raised shows there: Bluff with the Belt and the Mask, 4 higher",
    worn.skills.bluff.roll - bare.skills.bluff.roll, 4);
  check("and its hover names both",
    (worn.effects.workings["skill.bluff"]?.contributions ?? []).map(part => part.source).sort(),
    ["Champion Belt", "Mask"]);
}

console.log(`${failed} failing`);
process.exit(failed ? 1 : 0);
