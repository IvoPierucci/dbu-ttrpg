/**
 * Battle Weather: the frame, ahead of the Weathers.
 *
 * Nothing is applied to a character here, so most of what can be checked is that the words
 * are the rulebook's and that the page reads the one list. Which is worth doing anyway -
 * this is the reference the Weathers will be written against, and a clause lost in the
 * wrapping is a rule that is quietly not in the game.
 *
 * Two things are more than text. `(WT)` is a multiplication the effects language will need
 * the moment a Weather arrives, and it is settled here rather than a sixth time later. And
 * `weather.tiers` has been in the Slot table since the Brace Maneuver, written and said
 * and never applied because there was nothing to apply it to - so what is pinned is that
 * it is still exactly that, and has not quietly grown a reader that does nothing.
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

const { loadTraits, getTrait, traitsOfKind } = await import(modUrl("effects/traits.mjs"));
await loadTraits();

const { default: DBUCharacterData } = await import(modUrl("data/actor-character.mjs"));
class ActorStub extends DataModel { static defineSchema() { return {}; } }

const TAB = fs.readFileSync(
  path.join(ROOT, "templates", "parts", "actor-battlefields.hbs"), "utf8");
const SHEET = fs.readFileSync(
  path.join(ROOT, "module", "sheets", "actor-character-sheet.mjs"), "utf8");
const SLOTS = fs.readFileSync(path.join(ROOT, "module", "effects", "slots.mjs"), "utf8");
const BRACED = fs.readFileSync(
  path.join(ROOT, "traits", "conditions", "braced.dbu"), "utf8");

const { WEATHER_TIERS, WEATHER_RULES, MAX_WEATHER_TIER, weatherTier, perWeatherTier,
        weatherEffectsUpTo } = await import(modUrl("weather.mjs"));
const { reactiveFor } = await import(modUrl("effects/registry.mjs"));
const { collectReactive } = await import(modUrl("effects/interpreter.mjs"));

/**
 * A Progression long enough to reach this Power Level, spending every choice on
 * Attributes.
 *
 * Attribute Scores are not stored - they are 1 plus every Addition taken up to the
 * character's Power Level - so a Progression with nothing chosen on it is a character
 * whose every Score is 1. Which made the first Cold Weather check pass by measuring a
 * floor: a Saving Throw worth 1 cannot go down by 3, so Tiers 1, 2 and 3 all looked like
 * "1 off" and three different numbers read as one.
 */
function progressionTo(powerLevel) {
  const ATTRIBUTES = ["agility", "force", "tenacity", "scholarship", "insight", "magic",
                      "personality"];
  const rows = [{ lvl: 1, choice: "Skill Improvement", locked: true, attributes: {},
                  skillRanks: [], notes: "" }];
  for (let lvl = 2; lvl <= powerLevel; lvl += 1) {
    rows.push({ lvl, choice: "Attribute Addition", locked: false,
                attributes: Object.fromEntries(ATTRIBUTES.map(key => [key, 2])),
                skillRanks: [], notes: "" });
  }
  return rows;
}

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

// --- The three Tiers ---------------------------------------------------------------------------
{
  check("three Weather Tiers, in order", WEATHER_TIERS.map(entry => entry.tier), [1, 2, 3]);
  check("named", WEATHER_TIERS.map(entry => entry.name),
    ["Natural", "Unnatural", "Cataclysmic"]);
  check("and the highest is the last of them", MAX_WEATHER_TIER, 3);

  const says = (tier, phrase) => weatherTier(tier).text.includes(phrase);
  check("Natural, whole",
    says(1, "weather of an elevated degree, but nothing beyond what is normal for a planet like Earth"),
    true);
  check("Unnatural, whole", [
    says(2, "may be supernatural in origin"),
    says(2, "harsher weather patterns that may not seem natural to a planet")
  ], [true, true]);
  check("Cataclysmic, whole", [
    says(3, "if not controlled, could lead to planet-wide disasters"),
    says(3, "may occur when a planet is being destroyed")
  ], [true, true]);

  check("and nothing is looked up that does not exist",
    [weatherTier(0), weatherTier(4)], [null, null]);
}

// --- (WT), which is the one piece of machinery here ----------------------------------------------
{
  // "If an effect has a number with (WT) after it, this means that the number is
  // multiplied by the Weather Tier." The same shape as (T) and (bT), against a different
  // number - and the Tiers are numbered rather than only named so that this works at all.
  check("1(WT) is the Tier", [1, 2, 3].map(tier => perWeatherTier(1, tier)), [1, 2, 3]);
  check("2(WT) is twice it", [1, 2, 3].map(tier => perWeatherTier(2, tier)), [2, 4, 6]);
  check("and no Tier is nothing", perWeatherTier(5, 0), 0);
}

// --- The rules that hold whichever Weather is in play --------------------------------------------
{
  check("the rules kept, in the order they are written",
    WEATHER_RULES.map(rule => rule.key),
    ["combining", "scale", "tier", "replacing", "created", "profiles"]);
  check("named", WEATHER_RULES.map(rule => rule.name),
    ["Combining", "Scale", "Tier", "Replacing Weathers", "Created Weather",
     "Connected Profiles"]);

  const rule = key => WEATHER_RULES.find(entry => entry.key === key).text;

  check("Combining, whole",
    rule("combining").includes("can be combined in any fashion; you could have it raining "
      + "while a thick fog rolls in"), true);

  check("Scale, whole", [
    rule("scale").includes("can affect the whole area or just part of it"),
    rule("scale").includes("created by the ARC will be used across the entire Battlefield"),
    rule("scale").includes("will specify how many Squares it covers, typically through an AoE"),
    // The sentence that decides whether any of this reaches a character at all, which is
    // why it is kept with Scale rather than dropped as scene-setting.
    rule("scale").includes("only apply if you are in the Squares that they influence")
  ], [true, true, true, true]);

  check("Tier, whole", [
    rule("tier").includes("known as the Weather Tiers"),
    rule("tier").includes("Each Tier gains the effects of the earlier Tiers"),
    rule("tier").includes("a number with (WT) after it, this means that the number is "
      + "multiplied by the Weather Tier")
  ], [true, true, true]);

  check("Replacing Weathers, whole", [
    rule("replacing").includes("only have a single Battle Weather applied to it"),
    rule("replacing").includes("must have a Weather Tier that matches or exceeds the "
      + "Weather Tier of the Battle Weather already present")
  ], [true, true]);

  check("Created Weather, whole", [
    rule("created").includes("you may remove it from the Battlefield as an Instant Maneuver"),
    rule("created").includes("choose which squares to remove it from affecting"),
    rule("created").includes("remove all instances of that Battle Weather you have created")
  ], [true, true, true]);

  check("Connected Profiles, whole", [
    rule("profiles").includes("connected to a Profile with Elemental in the name"),
    rule("profiles").includes("Several Transformations and effects in the system will refer "
      + "to this connection")
  ], [true, true]);
}

// A character standing in a Weather, at a Tier. Everything below is run rather than read:
// the Tiers stack, and "each Tier gains the effects of the earlier Tiers" is a claim about
// what three blocks do together rather than about what any one of them says.
const standing = ({ weather = "", tier = 1, powerLevel = 10 } = {}) => {
  const parent = new ActorStub({}, { strict: false });
  parent.items = [];
  const model = new DBUCharacterData(
    { powerLevel, progression: progressionTo(powerLevel),
      battlefield: { lightLevel: 0, weather: { id: weather, tier },
                     cover: { active: false, rank: 0 } } },
    { parent, strict: false });
  parent.system = model;
  model.prepareBaseData?.();
  model.prepareDerivedData();
  return model;
};

/** What a Moment brings this character, by Slot. */
const bagAt = (model, moment) =>
  collectReactive(reactiveFor(model.parent), moment, { data: model, errors: [] }).slots;

// --- Hot Weather, standing in it -----------------------------------------------------------------
{
  const clear = standing();
  check("the file is there and is a Battle Weather",
    [getTrait("hot-weather")?.kind, getTrait("hot-weather")?.weather],
    ["battlefields", true]);
  // Every Weather there is, named. A Weather that stops being one, or a Light Level that
  // starts being one, is a thing somebody decided rather than something that happened.
  check("and these are the Battle Weathers there are",
    traitsOfKind("battlefields").filter(t => t.weather === true).map(t => t.id).sort(),
    ["cold-weather", "earthquake-weather", "hot-weather", "storm-weather",
     "tornado-weather", "vile-weather"]);

  // The entry, whole. The three Tiers and the Profile it is connected to.
  const entry = getTrait("hot-weather").text;
  check("the entry is there whole", [
    entry.includes("The extreme heat is enough to make even powerful warriors sweat!"),
    entry.includes("Connected Profile: Elemental (Fire)"),
    entry.includes("Reduce the Dice Score of your Steadfast Checks by 1(WT)."),
    entry.includes("Halve your Soak Value."),
    entry.includes("At the start of each Combat Round, reduce your Life Points by 10(bT).")
  ], [true, true, true, true, true]);

  // --- Natural (1): the Steadfast Check -------------------------------------------------------
  //
  // 1(WT), so it is 1 at Natural and 3 at Cataclysmic. Which is the whole reason (WT)
  // exists, and the thing a flat -1 would look identical to at Tier 1.
  check("clear weather takes nothing off a Steadfast Check", clear.steadfast.bonus, 0);
  check("Natural takes one off",
    standing({ weather: "hot-weather", tier: 1 }).steadfast.bonus, -1);
  check("Unnatural takes two",
    standing({ weather: "hot-weather", tier: 2 }).steadfast.bonus, -2);
  check("and Cataclysmic takes three",
    standing({ weather: "hot-weather", tier: 3 }).steadfast.bonus, -3);

  // The target is untouched: the rule names the Dice Score, which is what the roll comes
  // to, and not what it has to meet.
  check("and the target it has to meet is untouched",
    [1, 2, 3].map(tier => standing({ weather: "hot-weather", tier }).steadfast.target),
    [6, 6, 6]);

  // --- Unnatural (2): the Soak Value ------------------------------------------------------------
  {
    const dry = clear.soakValue;
    check("clear weather leaves the Soak Value alone", dry > 0, true);
    check("and so does Natural, which does not reach it",
      standing({ weather: "hot-weather", tier: 1 }).soakValue, dry);

    // "Halve your Soak Value." Straight in half, floored at zero and not at the Tier of
    // Power: that floor is on the Soak a character provides for themselves, and this is
    // weather. The comment on soakValue says so - "external effects can reduce the result
    // further, down to a floor of 0" - and Hot Weather is about as external as it gets.
    const hot = standing({ weather: "hot-weather", tier: 2 });
    // Exactly half, which is also what says where the floor is: the Tier-of-Power floor is
    // on the Soak a character provides for themselves and this lands outside it, so the
    // answer is the half and not whichever of the two is larger.
    check("Unnatural halves it", hot.soakValue, Math.floor(dry / 2));
    check("which is less than it was", hot.soakValue < dry, true);
    check("and Cataclysmic halves it too, being every Tier below it as well",
      standing({ weather: "hot-weather", tier: 3 }).soakValue,
      hot.soakValue);
  }

  // --- Cataclysmic (3): the Life Points -----------------------------------------------------------
  {
    // A Moment rather than a derived value, so it is gathered the way a Moment is.
    const bagFor = model => bagAt(model, "start-of-round");

    check("nothing answers the start of the Round in clear weather",
      bagFor(clear)["life.value"] ?? null, null);
    check("nor at Natural",
      bagFor(standing({ weather: "hot-weather", tier: 1 }))["life.value"] ?? null, null);
    check("nor at Unnatural, which stops at the Soak",
      bagFor(standing({ weather: "hot-weather", tier: 2 }))["life.value"] ?? null, null);

    const burning = standing({ weather: "hot-weather", tier: 3 });
    const taken = bagFor(burning)["life.value"];
    check("and at Cataclysmic something does", Boolean(taken), true);
    // 10(bT). Read off the character rather than written here, so this is the rule.
    check("taking 10 a base Tier of Power off their Life",
      taken?.add, -10 * burning.baseTierOfPower);
  }

  // --- All three at once ----------------------------------------------------------------------------
  //
  // "Each Tier gains the effects of the earlier Tiers." Not three alternatives: at
  // Cataclysmic the Weather is doing everything it does at Natural and Unnatural too.
  {
    const worst = standing({ weather: "hot-weather", tier: 3 });
    check("at Cataclysmic all three are true at once", [
      worst.steadfast.bonus === -3,
      worst.soakValue < clear.soakValue,
      Boolean(bagAt(worst, "start-of-round")["life.value"])
    ], [true, true, true]);
  }
}


// --- Cold Weather, standing in it ------------------------------------------------------------------
{
  const clear = standing();

  check("the file is there and is a Battle Weather",
    [getTrait("cold-weather")?.kind, getTrait("cold-weather")?.weather],
    ["battlefields", true]);

  const entry = getTrait("cold-weather").text;
  check("the entry is there whole", [
    entry.includes("The chilling cold seeps into your bones, freezing you to the core."),
    entry.includes("Connected Profile: Elemental (Ice)"),
    entry.includes("Reduce the Dice Score of your Saving Throws by 1(WT)."),
    entry.includes("Halve your Surgency."),
    entry.includes("At the start of each Combat Round, reduce your Ki Points by 10(bT).")
  ], [true, true, true, true, true]);

  // --- Natural (1): every Saving Throw ---------------------------------------------------------
  //
  // "Your Saving Throws" is all four of them, so all four are checked - a file that had
  // listed them by name would pass a check that looked at one.
  const saves = model =>
    Object.fromEntries(Object.entries(model.savingThrows)
      .map(([key, save]) => [key, save.value]));

  const warm = saves(clear);
  check("there are four Saving Throws to take it off",
    Object.keys(warm).sort(), ["cognitive", "corporeal", "impulsive", "morale"]);
  check("and they are worth something to begin with",
    Object.values(warm).every(value => value > 3), true);

  for (const [tier, off] of [[1, 1], [2, 2], [3, 3]]) {
    const cold = saves(standing({ weather: "cold-weather", tier }));
    check(`Tier ${tier} takes ${off} off every one of them`,
      Object.keys(warm).map(key => warm[key] - cold[key]),
      Object.keys(warm).map(() => off));
  }

  // Not the Steadfast Check, which is Hot Weather's. Two Weathers reducing "the Dice Score
  // of your X" is exactly the pair that would end up sharing one Slot by accident.
  check("and the Steadfast Check is untouched by the cold",
    standing({ weather: "cold-weather", tier: 3 }).steadfast.bonus, 0);
  check("as the Saving Throws are by the heat",
    saves(standing({ weather: "hot-weather", tier: 3 })), warm);

  // --- Unnatural (2): the Surgency --------------------------------------------------------------
  {
    const full = clear.surgency;
    check("clear weather leaves the Surgency alone", full > 0, true);
    check("and so does Natural, which does not reach it",
      standing({ weather: "cold-weather", tier: 1 }).surgency, full);

    const cold = standing({ weather: "cold-weather", tier: 2 });
    check("Unnatural halves it", cold.surgency, Math.floor(full / 2));
    check("which is less than it was", cold.surgency < full, true);
    check("and Cataclysmic halves it too, being every Tier below it as well",
      standing({ weather: "cold-weather", tier: 3 }).surgency, cold.surgency);
  }

  // --- Cataclysmic (3): the Ki Points -------------------------------------------------------------
  {
    check("nothing answers the start of the Round in clear weather",
      bagAt(clear, "start-of-round")["ki.value"] ?? null, null);
    check("nor below Cataclysmic", [
      bagAt(standing({ weather: "cold-weather", tier: 1 }), "start-of-round")["ki.value"] ?? null,
      bagAt(standing({ weather: "cold-weather", tier: 2 }), "start-of-round")["ki.value"] ?? null
    ], [null, null]);

    const freezing = standing({ weather: "cold-weather", tier: 3 });
    const taken = bagAt(freezing, "start-of-round")["ki.value"];
    check("and at Cataclysmic something does", Boolean(taken), true);
    check("taking 10 a base Tier of Power off their Ki",
      taken?.add, -10 * freezing.baseTierOfPower);

    // Ki, not Life. The only thing that separates this Tier from Hot Weather's, and the
    // one a copied file would get wrong.
    check("and nothing off their Life",
      bagAt(freezing, "start-of-round")["life.value"] ?? null, null);
    check("while the heat takes Life and not Ki",
      bagAt(standing({ weather: "hot-weather", tier: 3 }), "start-of-round")["ki.value"] ?? null,
      null);
  }

  // --- All three at once ----------------------------------------------------------------------------
  {
    const worst = standing({ weather: "cold-weather", tier: 3 });
    check("at Cataclysmic all three are true at once", [
      worst.savingThrows.morale.value === (warm.morale - 3),
      worst.surgency < clear.surgency,
      Boolean(bagAt(worst, "start-of-round")["ki.value"])
    ], [true, true, true]);
  }
}

// --- save.all, which is the Slot Cold Weather needed ------------------------------------------------
{
  const SLOTS_TEXT = fs.readFileSync(
    path.join(ROOT, "module", "effects", "slots.mjs"), "utf8");
  const DATA = fs.readFileSync(
    path.join(ROOT, "module", "data", "actor-character.mjs"), "utf8");

  check("the Slot is declared", SLOTS_TEXT.includes('{ key: "save.all"'), true);
  // The half that keeps being the bug: a Slot declared and read by nobody. Read outside
  // the one named for a single Throw, so a blanket halving lands on the finished value.
  check("and read where the Saving Throws are worked out",
    DATA.includes('value: withEffects(this, "save.all",'), true);
  check("outside the one named for a single Throw",
    DATA.includes('withEffects(this, `save.${save}`,'), true);
  // Filed under the Throw's own name, or the sheet would show one set of workings against
  // all four numbers.
  check("with its workings filed under each Throw",
    DATA.includes("{ as: `save.${save}`, wraps: true }"), true);
}


// --- Tornado Weather, standing in it ---------------------------------------------------------------
{
  const clear = standing();

  check("the file is there and is a Battle Weather",
    [getTrait("tornado-weather")?.kind, getTrait("tornado-weather")?.weather],
    ["battlefields", true]);

  const entry = getTrait("tornado-weather").text;
  check("the entry is there whole", [
    entry.includes("Strong, cyclical winds lift the terrain and block visibility"),
    entry.includes("Connected Profile: Elemental (Wind)"),
    entry.includes("Reduce your Speeds and Defense Value by 2(WT)."),
    entry.includes("Halve your Haste."),
    entry.includes("will select a point within the Battle Weather to be the epicenter"),
    entry.includes("you are moved 3 Squares towards the epicenter in the most direct path"),
    entry.includes("proceed to follow the typical rules for Collision")
  ], [true, true, true, true, true, true, true]);

  // --- Natural (1): both Speeds, and the Defense Value ------------------------------------------
  //
  // Both. A file naming one would pass a check that looked at one, which is the whole
  // reason `speed.all` exists.
  const calm = { normal: clear.speed.normal, boosted: clear.speed.boosted,
                 defense: clear.defenseValue };
  check("a Speed and a Defense Value to take it off",
    [calm.normal > 6, calm.boosted > 6, calm.defense > 6], [true, true, true]);

  for (const [tier, off] of [[1, 2], [2, 4], [3, 6]]) {
    const blown = standing({ weather: "tornado-weather", tier });
    check(`Tier ${tier} takes ${off} off both Speeds and the Defense Value`, [
      calm.normal - blown.speed.normal,
      calm.boosted - blown.speed.boosted,
      calm.defense - blown.defenseValue
    ], [off, off, off]);
  }

  // And into the Dodge Roll, which is where a Defense Value is actually felt. Derived
  // after it, so this is the change arriving somewhere rather than sitting on a field.
  check("and the Dodge Roll goes down with it",
    clear.combat.dodge - standing({ weather: "tornado-weather", tier: 1 }).combat.dodge, 2);

  // --- Unnatural (2): the Haste -------------------------------------------------------------------
  {
    const quick = clear.haste;
    check("clear weather leaves the Haste alone", quick > 0, true);
    check("and so does Natural, which does not reach it",
      standing({ weather: "tornado-weather", tier: 1 }).haste, quick);

    const blown = standing({ weather: "tornado-weather", tier: 2 });
    check("Unnatural halves it", blown.haste, Math.floor(quick / 2));
    check("and Cataclysmic halves it too, being every Tier below it as well",
      standing({ weather: "tornado-weather", tier: 3 }).haste, blown.haste);

    // Haste feeds the Strike Roll: the wind takes the Defense at Natural and the Strike
    // at Unnatural, which is the shape of the Weather rather than two unrelated numbers.
    check("and the Strike Roll goes down with it",
      blown.combat.strike < clear.combat.strike, true);
  }

  // --- Cataclysmic (3): the epicenter, which is the table's ------------------------------------------
  {
    // Every noun in that Tier is one this system does not have: a point on a map, a
    // distance, a direction, a route through whatever is standing in it. So nothing fires
    // at the start of the Round - and that is the decision, not an omission.
    const blown = standing({ weather: "tornado-weather", tier: 3 });
    check("nothing answers the start of the Round at any Tier", [
      Object.keys(bagAt(standing({ weather: "tornado-weather", tier: 1 }), "start-of-round")).length,
      Object.keys(bagAt(standing({ weather: "tornado-weather", tier: 2 }), "start-of-round")).length,
      Object.keys(bagAt(blown, "start-of-round")).length
    ], [0, 0, 0]);

    // Deliberately not an empty block. One that fires and changes nothing is
    // indistinguishable from a broken one.
    check("and there is no start-of-round block in the file at all",
      getTrait("tornado-weather").script.includes("[automatic/start-of-round]"), false);

    // The one part of it that does reach a character is already built, and the file says
    // where: "proceed to follow the typical rules for Collision".
    const TAB = fs.readFileSync(
      path.join(ROOT, "templates", "parts", "actor-battlefields.hbs"), "utf8");
    check("the Collision it causes has a button waiting for it",
      TAB.includes('data-action="takeCollision"'), true);
    check("and the file points at it rather than leaving the Tier unexplained",
      getTrait("tornado-weather").script.includes("Receive Collision Damage button"), true);
  }
}

// --- speed.all, which is the Slot Tornado Weather needed --------------------------------------------
{
  const SLOTS_TEXT = fs.readFileSync(
    path.join(ROOT, "module", "effects", "slots.mjs"), "utf8");
  const DATA = fs.readFileSync(
    path.join(ROOT, "module", "data", "actor-character.mjs"), "utf8");

  check("the Slot is declared", SLOTS_TEXT.includes('{ key: "speed.all"'), true);
  check("and read on both Speeds",
    (DATA.match(/withEffects\(this, "speed\.all",/g) ?? []).length, 2);
  check("outside the one named for a single Speed", [
    DATA.includes('withEffects(this, "speed.normal",'),
    DATA.includes('withEffects(this, "speed.boosted",')
  ], [true, true]);
  check("with its workings filed under each Speed", [
    DATA.includes('{ as: "speed.normal", wraps: true }'),
    DATA.includes('{ as: "speed.boosted", wraps: true }')
  ], [true, true]);
}


// --- Storm Weather, standing in it -----------------------------------------------------------------
{
  const clear = standing();

  check("the file is there and is a Battle Weather",
    [getTrait("storm-weather")?.kind, getTrait("storm-weather")?.weather],
    ["battlefields", true]);

  const entry = getTrait("storm-weather").text;
  check("the entry is there whole", [
    entry.includes("A flash of lightning illuminates the sky as a crash of thunder"),
    entry.includes("Connected Profile: Elemental (Lightning)"),
    entry.includes("At the start of each Combat Round, roll a 1d10"),
    entry.includes("If the result is a 1(WT) or lower, you are struck by Lightning"),
    entry.includes("Reduce your Life Points by 6(WT)."),
    entry.includes("Halve your Awareness."),
    entry.includes("you suffer from the Impediment Combat Condition until the end of the "
      + "Combat Round")
  ], [true, true, true, true, true, true, true]);

  // --- Unnatural (2): the Awareness, which is the half that is an effect --------------------------
  {
    const sharp = clear.awareness;
    check("clear weather leaves the Awareness alone", sharp > 0, true);
    check("and so does Natural, which does not reach it",
      standing({ weather: "storm-weather", tier: 1 }).awareness, sharp);

    const blind = standing({ weather: "storm-weather", tier: 2 });
    check("Unnatural halves it", blind.awareness, Math.floor(sharp / 2));
    check("and Cataclysmic halves it too, being every Tier below it as well",
      standing({ weather: "storm-weather", tier: 3 }).awareness, blind.awareness);

    // Awareness feeds the Strike Roll: the storm blinds you before it slows you.
    check("and the Strike Roll goes down with it",
      blind.combat.strike < clear.combat.strike, true);
  }

  // The strike is not an effect and must not become one. A script that rolled would come
  // out differently every time the sheet was opened.
  // Asked of the statements, not of the file: everything after the `---` is the script,
  // comments included, and the comments quote the rule the strike is not built from.
  const statements = getTrait("storm-weather").script
    .split(/\r?\n/).filter(line => !line.trim().startsWith("#")).join(" ");
  check("nothing in the file rolls anything",
    /d10|life\.value/.test(statements), false);
  check("and the statements are the one halving",
    statements.replace(/\s+/g, " ").trim(),
    "[passive] if (battlefield.weather.tier >= 2) { awareness *= 0.5; }");
  check("and it has no start-of-round block",
    getTrait("storm-weather").script.includes("[automatic/start-of-round]"), false);
  check("while the file says where the strike lives instead",
    getTrait("storm-weather").script.includes("combat.mjs"), true);
}

// --- The strike, run -------------------------------------------------------------------------------
{
  // Cut out and run against a fixed die, because "a 1(WT) or lower" is three different
  // thresholds and a random one would only ever test whichever it happened to roll.
  const COMBAT = fs.readFileSync(path.join(ROOT, "module", "combat.mjs"), "utf8");
  const from = COMBAT.indexOf("async function strikeLightning(");
  const to = COMBAT.indexOf("\n}\n", from);
  check("the strike was found to cut out", (from > 0) && (to > from), true);

  let rolled = 0;
  let flavour = "";
  const taken = [];
  const conditions = [];
  const clocks = [];

  class Roll {
    constructor() { this.total = rolled; }
    async evaluate() {}
    async toMessage({ flavor }) { flavour = flavor; }
  }

  // The dynamic imports cannot survive being cut out of their file, so they are handed in.
  const body = COMBAT.slice(from, to + 2)
    .replace("export async function", "async function")
    .replace('const { reduceLifePoints } = await import("./chat.mjs");', "")
    .replace('const { KINDS, lasting } = await import("./durations.mjs");', "");

  const { EDGES, KINDS } = await import(modUrl("durations.mjs"));

  // The real one, cut out with it: which Weathers have something to roll is a header on a
  // file, and a stub here would be a second answer to that.
  const wFrom = COMBAT.indexOf("export function weatherToRoll(");
  const wTo = COMBAT.indexOf("\n}\n", wFrom);
  check("weatherToRoll was found to cut out", (wFrom > 0) && (wTo > wFrom), true);
  const weatherToRoll = new Function("getTrait",
    `${COMBAT.slice(wFrom, wTo + 2).replace("export function", "function")}
     return weatherToRoll;`)(getTrait);

  const strikeLightning = new Function("Roll", "ChatMessage", "reduceLifePoints",
    "setCondition", "lasting", "EDGES", "KINDS", "weatherToRoll",
    `${body}\nreturn strikeLightning;`)(
      Roll, { getSpeaker: () => ({}) },
      async (actor, amount, { reason }) => { taken.push([amount, reason]); },
      async (actor, key, stacks) => { conditions.push([key, stacks]); return true; },
      async (actor, entry) => { clocks.push(entry); },
      EDGES, KINDS, weatherToRoll);

  // Which Weathers the button is offered for, by their own headers. Storm is the only one
  // with anything to roll; the others do everything they do as effects.
  check("only a Weather whose file says so has something to roll",
    traitsOfKind("battlefields").filter(t => t.rolls === true).map(t => t.id),
    ["storm-weather"]);
  check("and it is asked of the file rather than of an id in the code",
    COMBAT.includes('(trait?.weather === true) && (trait?.rolls === true)'), true);
  check("so no Weather is named in there",
    /"storm-weather"|'storm-weather'/.test(COMBAT), false);

  const caught = ({ weather = "storm-weather", tier = 1, die = 1 } = {}) => {
    rolled = die;
    taken.length = 0; conditions.length = 0; clocks.length = 0; flavour = "";
    return { uuid: "Actor.kale", name: "Kale",
             system: { baseTierOfPower: 3,
                       battlefield: { weather: { id: weather, tier } } } };
  };

  // Standing in something else, or in nothing: no roll, no card.
  await strikeLightning(caught({ weather: "" }));
  check("no Weather, no lightning", [taken.length, flavour], [0, ""]);
  await strikeLightning(caught({ weather: "hot-weather" }));
  check("and another Weather is not this one", [taken.length, flavour], [0, ""]);

  // "A 1(WT) or lower." One face in ten at Natural, two at Unnatural, three at
  // Cataclysmic - the storm is three times likelier to find you at the top.
  for (const [tier, hits] of [[1, [1]], [2, [1, 2]], [3, [1, 2, 3]]]) {
    const struck = [];
    for (let die = 1; die <= 10; die += 1) {
      await strikeLightning(caught({ tier, die }));
      if (taken.length) struck.push(die);
    }
    check(`at Tier ${tier} the strike lands on ${hits.join(", ")}`, struck, hits);
  }

  // 6(WT), against a base Tier of 3.
  await strikeLightning(caught({ tier: 1, die: 1 }));
  check("Natural takes 6(WT) - six a base Tier", taken[0]?.[0], 6 * 1 * 3);
  await strikeLightning(caught({ tier: 3, die: 1 }));
  check("and Cataclysmic takes three times that", taken[0]?.[0], 6 * 3 * 3);
  check("straight off their Life Points",
    (taken[0]?.[1] ?? "").includes("Struck by Lightning"), true);

  // The card is posted whether it lands or not: "the lightning passes" is worth seeing,
  // and a roll nobody is shown is a roll nobody trusts.
  await strikeLightning(caught({ tier: 1, die: 9 }));
  check("a miss still posts the roll",
    flavour.includes("the lightning passes"), true);
  check("saying what would have hit", flavour.includes("1 or lower is a strike"), true);
  await strikeLightning(caught({ tier: 3, die: 2 }));
  check("and a hit says so", flavour.includes("struck by Lightning"), true);
  check("with the Tier's own threshold on it",
    flavour.includes("3 or lower is a strike"), true);

  // --- Cataclysmic (3): the Impediment --------------------------------------------------------------
  //
  // On a strike, and only at Cataclysmic. Three ways to get this wrong and all three are
  // checked: the wrong Tier, a miss, and a duration that is not the Round.
  await strikeLightning(caught({ tier: 1, die: 1 }));
  check("Natural leaves nothing behind", [conditions.length, clocks.length], [0, 0]);
  await strikeLightning(caught({ tier: 2, die: 1 }));
  check("nor does Unnatural", [conditions.length, clocks.length], [0, 0]);

  await strikeLightning(caught({ tier: 3, die: 9 }));
  check("and a Cataclysmic storm that missed leaves nothing either",
    [taken.length, conditions.length], [0, 0]);

  await strikeLightning(caught({ tier: 3, die: 1 }));
  check("a Cataclysmic strike leaves Impediment", conditions, [["impediment", 1]]);
  check("on a clock", clocks.length, 1);
  check("that counts Rounds rather than turns", clocks[0]?.edge, EDGES.ROUND);
  check("as a Condition, named for what did it",
    [clocks[0]?.kind, clocks[0]?.source], [KINDS.CONDITION, "Struck by Lightning"]);
}


// --- The button that rolls it ------------------------------------------------------------------------
{
  // The Round used to roll the storm for you. A number that arrives without anybody
  // touching it is one nobody feels they had any part in, so it is offered instead - which
  // means the Round must not still be doing it.
  const COMBAT = fs.readFileSync(path.join(ROOT, "module", "combat.mjs"), "utf8");
  const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");

  const roundFrom = COMBAT.indexOf("async function startRound(");
  const round = COMBAT.slice(roundFrom, COMBAT.indexOf("\n}\n", roundFrom));
  check("the Round no longer rolls it for you",
    round.includes("strikeLightning"), false);
  check("though it still counts the Round edge",
    round.includes("await edgeReached(actor, EDGES.ROUND);"), true);

  // Offered on the Round's own card and nowhere else: a Weather that rolls does it once a
  // Round, and any other Moment card would be a second chance at the same roll.
  check("the button is offered on the start-of-round card",
    CHAT.includes('if (card.moment !== "start-of-round") return [];'), true);
  check("to whoever plays the character",
    CHAT.includes("actor?.isOwner\n      && !(card.weathered ?? []).includes(actor.uuid)\n"
      + "      && weatherToRoll(actor)"), true);
  check("and it says what it does", CHAT.includes('"Apply Battle Weather"'), true);
  check("naming the character when there is more than one",
    CHAT.includes("`Apply Battle Weather - ${actor.name}`"), true);

  // Its own list, not the one that tracks answering the Moment. A character with no Talent
  // to answer with must still get their roll, and answering with one must not spend it.
  check("who has rolled is kept apart from who has answered",
    CHAT.includes("weathered: []") && CHAT.includes("applied: [],"), true);
  check("and the card carries it from the moment it is posted",
    CHAT.slice(CHAT.indexOf("export async function postMoment(")).includes("weathered: []"),
    true);

  // Marked before it is rolled. A second click while the first is still resolving is one
  // character struck twice by the same storm.
  const rollFrom = CHAT.indexOf("async function rollWeatherFor(");
  const rollBody = CHAT.slice(rollFrom, CHAT.indexOf("\n}\n", rollFrom));
  check("the card is marked before the roll, not after",
    rollBody.indexOf("weathered: [...new Set(") < rollBody.indexOf("strikeLightning(actor)"),
    true);
  check("and awaited, so the mark is written before the die is thrown",
    rollBody.includes("await requestEdit(message, {"), true);
}

// --- The Round edge, which "until the end of the Combat Round" needed --------------------------------
{
  const DURATIONS = fs.readFileSync(path.join(ROOT, "module", "durations.mjs"), "utf8");
  const COMBAT = fs.readFileSync(path.join(ROOT, "module", "combat.mjs"), "utf8");
  const { EDGES, edgesToWait } = await import(modUrl("durations.mjs"));

  check("there is a Round edge", EDGES.ROUND, "round");

  // A Round edge is ahead of you whoever you are - it is not your turn that ends it - so
  // standing in your own turn changes nothing about it. That is the whole difference from
  // an end-of-turn edge, and the thing a copied branch would get wrong.
  check("one Round to wait, whoever's turn it is", [
    edgesToWait(EDGES.ROUND, { theirTurn: false }),
    edgesToWait(EDGES.ROUND, { theirTurn: true })
  ], [1, 1]);
  check("and two for the next Round", [
    edgesToWait(EDGES.ROUND, { next: true, theirTurn: false }),
    edgesToWait(EDGES.ROUND, { next: true, theirTurn: true })
  ], [2, 2]);
  // Where an end-of-turn edge does depend on it, which is what this is not.
  check("unlike an end-of-turn edge, which does depend on whose turn it is",
    edgesToWait(EDGES.END, { next: true, theirTurn: true })
      !== edgesToWait(EDGES.END, { next: true, theirTurn: false }), true);

  // A Condition's clock takes one stack off now rather than clearing it, which is
  // `environments.mjs`'s to check - Magma is what needed it. What is pinned here is only
  // that a Condition is still what `takeOff` reaches for.
  check("taken off by takeOff like any other clock",
    DURATIONS.includes("if (entry.kind === KINDS.CONDITION) {"), true);

  // Counted when the Round turns over, and before anything this Round hands out - or the
  // new helping would come off with the old one.
  check("the Round edge is counted at the start of each Round",
    COMBAT.includes("await edgeReached(actor, EDGES.ROUND);"), true);
  check("before the Round's own effects fire",
    COMBAT.indexOf("await edgeReached(actor, EDGES.ROUND);")
      < COMBAT.indexOf('await fireMoment(actor, "start-of-round");'), true);
  // The lightning is not in the Round any more, so what has to be true is only that the
  // edge is counted before the Round's own effects fire.
  check("and nothing in the Round hands one out before the edge is counted",
    COMBAT.slice(COMBAT.indexOf("async function startRound("),
      COMBAT.indexOf("await edgeReached(actor, EDGES.ROUND);")).includes("lasting("),
    false);
}


// --- Vile Weather, standing in it ------------------------------------------------------------------
{
  const clear = standing();

  check("the file is there and is a Battle Weather",
    [getTrait("vile-weather")?.kind, getTrait("vile-weather")?.weather],
    ["battlefields", true]);

  const entry = getTrait("vile-weather").text;
  check("the entry is there whole", [
    entry.includes("Poison rains down from the skies or bubbles up from below the surface"),
    entry.includes("Connected Profile: Elemental (Poison)"),
    entry.includes("You score a Botch Result for a Combat Roll on a Natural Result of "
      + "2(WT) or lower."),
    entry.includes("Reduce the Dice Score of your Stress Tests by 1(WT)."),
    entry.includes("Reduce all of your Combat Rolls by 1(bT).")
  ], [true, true, true, true, true]);

  // --- Natural (1): the Botch Range, and only for Combat Rolls ----------------------------------
  {
    check("a character in clean air botches on a 1",
      [clear.botchRange, clear.botchRangeCombat], [1, 1]);

    // 2(WT). Held under the Critical Target, so it can never reach a Natural Result that
    // is already a Critical - which is why the top Tier is 6 rather than 6-and-rising.
    for (const [tier, range] of [[1, 2], [2, 4], [3, 6]]) {
      const vile = standing({ weather: "vile-weather", tier });
      check(`Tier ${tier} botches a Combat Roll on ${range} or lower`,
        vile.botchRangeCombat, range);
      // The rule says Combat Roll, and a Skill Check made in the poison is no likelier to
      // go wrong. This is the whole reason the second range exists.
      check(`and Tier ${tier} leaves every other roll botching on a 1`,
        vile.botchRange, 1);
      check(`with the two never overlapping a Critical at Tier ${tier}`,
        vile.botchRangeCombat < vile.criticalTarget, true);
    }
  }

  // --- Unnatural (2): the Stress Bonus, which is the Dice Score ------------------------------------
  {
    // A Stress Test is 1d10 plus the Stress Bonus, so the Bonus is the Dice Score above
    // the die: reducing one is reducing the other. This had a Slot of its own for a while,
    // `stress.dice`, said on the sheet and applied by the table - a number invented beside
    // one that already existed and did the job. Gone.
    const steady = clear.stressBonus;
    check("clear weather leaves the Stress Bonus alone", steady > 0, true);
    check("and so does Natural, which does not reach it",
      standing({ weather: "vile-weather", tier: 1 }).stressBonus, steady);

    check("Unnatural takes two off it - 1(WT) at Tier 2",
      steady - standing({ weather: "vile-weather", tier: 2 }).stressBonus, 2);
    check("and Cataclysmic takes three",
      steady - standing({ weather: "vile-weather", tier: 3 }).stressBonus, 3);

    // Applied rather than said, which is the point of the correction: a Stress Test
    // belongs to Transformations and there are none yet, but whenever one is rolled the
    // Bonus it uses is the one on the sheet and the poison is already in it.
    const SLOTS_TEXT = fs.readFileSync(
      path.join(ROOT, "module", "effects", "slots.mjs"), "utf8");
    check("no second number was invented for the roll",
      SLOTS_TEXT.includes("stress.dice"), false);
    check("nor derived on the character",
      /stressDice/.test(fs.readFileSync(
        path.join(ROOT, "module", "data", "actor-character.mjs"), "utf8")), false);
    check("nor built for the sheet", /stressDice/.test(SHEET), false);

    // On the Progression tab, beside the Power Level it is mostly made of (the user's, 2026-11-15).
    const MAIN_TAB = fs.readFileSync(
      path.join(ROOT, "templates", "parts", "actor-progression.hbs"), "utf8");
    check("and the sheet shows the one number there is",
      MAIN_TAB.includes("{{system.stressBonus}}"), true);
    check("saying what a Stress Test is",
      MAIN_TAB.includes("A Stress Test is 1d10 plus this"), true);
  }

  // --- Cataclysmic (3): every Combat Roll ------------------------------------------------------------
  {
    const rolls = model => [model.combat.strike, model.combat.dodge];
    const clean = rolls(clear);

    check("clear weather leaves the Combat Rolls alone", clean.every(v => v > 0), true);
    check("and so do the first two Tiers", [
      rolls(standing({ weather: "vile-weather", tier: 1 })),
      rolls(standing({ weather: "vile-weather", tier: 2 }))
    ], [clean, clean]);

    // "All of your Combat Rolls" - which is what `combatRolls` fans out to, so one line
    // reaches the Strike, the Dodge and the Wound.
    const rotting = standing({ weather: "vile-weather", tier: 3 });
    check("Cataclysmic takes 1(bT) off all of them",
      clean.map((value, at) => value - rolls(rotting)[at]),
      clean.map(() => rotting.baseTierOfPower));
    check("the Wound Rolls among them",
      Object.values(rotting.combat.wound).every((value, at) =>
        value < Object.values(clear.combat.wound)[at]), true);
  }
}

// --- The Botch Range a Combat Roll is measured against ------------------------------------------------
{
  const SLOTS_TEXT = fs.readFileSync(
    path.join(ROOT, "module", "effects", "slots.mjs"), "utf8");
  const DATA = fs.readFileSync(
    path.join(ROOT, "module", "data", "actor-character.mjs"), "utf8");
  const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");

  check("the Slot is declared", SLOTS_TEXT.includes('{ key: "botchRange.combat"'), true);
  check("and the file floors it rather than capping it",
    getTrait("vile-weather").script.includes("botchRange.combat min= 2(WT);"), true);
  check("and derived from the ordinary range rather than beside it",
    DATA.includes('withEffects(this, "botchRange.combat", this.botchRange)'), true);

  // Read once, where a roll is classified, and only when the caller says this is a Combat
  // Roll. A Slot declared and read by nobody is the bug; a Slot read by everybody is the
  // rule applied where it does not belong.
  check("read by the roll that says which kind it is",
    CHAT.includes("botch: natural <= botchRangeFor(actor, combatRoll, wound),"), true);
  check("and the combat path says so",
    CHAT.includes("{ minimumNatural, criticalTarget: aimed, combatRoll: true, naturalAdd: naturalAdd + ownNatural, wound: slot === \"wound\","), true);
  check("while a Skill Check does not",
    SHEET.includes('await evaluateCheck(this.actor, bonus, "", null, { criticalTarget, naturalAdd,') && !SHEET.includes('combatRoll: true, minimumNatural: skillRoll'),
    true);

  // Cut out and run, because "which of two ranges" is one line with two answers.
  const from = CHAT.indexOf("function botchRangeFor(");
  const to = CHAT.indexOf("\n}\n", from);
  const botchRangeFor = new Function(
    `${CHAT.slice(from, to + 2)}\nreturn botchRangeFor;`)();

  const inPoison = { system: { botchRange: 1, botchRangeCombat: 6 } };
  check("a Combat Roll gets the wider range", botchRangeFor(inPoison, true), 6);
  check("and everything else the ordinary one", botchRangeFor(inPoison, false), 1);
  // A character nothing has touched is measured against the same number either way, so
  // the second range costs nobody anything until a Weather widens it.
  const plain = { system: { botchRange: 1, botchRangeCombat: 1 } };
  check("and a character in clean air sees no difference",
    [botchRangeFor(plain, true), botchRangeFor(plain, false)], [1, 1]);

  // Karmic Chance rolls the replacement under the range the first roll was made under,
  // carried on the card rather than worked out again - which would have used the combat
  // range for a Skill Check being rerolled.
  check("the range is carried on the card for a reroll",
    CHAT.includes("botchRange: botchRangeFor(actor, true) },"), true);
  check("and the reroll reads it",
    CHAT.includes("(natural <= (rules.botchRange ?? actor.system.botchRange ?? 1))"), true);
}


// --- Earthquake Weather, and the ground it cannot leave -----------------------------------------------
{
  const quake = getTrait("earthquake-weather");

  check("the file is there and is a Battle Weather",
    [quake?.kind, quake?.weather], ["battlefields", true]);
  check("the entry is there whole", [
    quake.text.includes("The ground beneath your feet rumbles, shakes, and splits open, "
      + "endangering everyone for miles around"),
    quake.text.includes("Connected Profile: Elemental (Earth)"),
    quake.text.includes("While you are not in a High Environment, reduce your Might by 1(WT)"),
    quake.text.includes("While you are not in a High Environment, halve your Defense Value"),
    quake.text.includes("At the start of each Combat Round, if you are not in a High "
      + "Environment, you are knocked Prone")
  ], [true, true, true, true, true]);

  // Every one of its effects asks the same question, which is the whole of what makes this
  // Weather different from the five before it.
  // Asked of the statements: the comment above them names the test, because explaining
  // why it is there is the point of the comment.
  const statements = quake.script
    .split("\n").filter(line => !line.trim().startsWith("#")).join(" ");
  check("both blocks ask whether they are on the ground",
    (statements.match(/highEnvironment == 0/g) ?? []).length, 2);
  check("and the Tier tests sit inside that one",
    statements.indexOf("highEnvironment == 0")
      < statements.indexOf("weather.tier >= 2"), true);

  // A character in this Weather, at a Tier, at a height.
  const shaken = ({ tier = 1, high = 0 } = {}) => {
    const parent = new ActorStub({}, { strict: false });
    parent.items = [];
    const model = new DBUCharacterData(
      { powerLevel: 10, progression: progressionTo(10),
        battlefield: { lightLevel: 0, highEnvironment: high,
                       environment: "standard-environment", qualities: [],
                       weather: { id: "earthquake-weather", tier },
                       cover: { active: false, rank: 0 } } },
      { parent, strict: false });
    parent.system = model;
    model.prepareBaseData?.();
    model.prepareDerivedData();
    return model;
  };

  const calm = standing();

  // --- Natural (1): the Might ----------------------------------------------------------------------
  check("on the ground it takes Might",
    [1, 2, 3].map(tier => calm.might - shaken({ tier }).might), [1, 2, 3]);
  // Which is also how far a Knockback throws and what it rolls, Might being one number -
  // a second effect the entry does not mention and does not have to.
  check("and nothing off it in the Low Sky",
    shaken({ tier: 3, high: 1 }).might, calm.might);
  check("at every rank", [1, 2, 3, 4].map(high => shaken({ tier: 3, high }).might),
    [calm.might, calm.might, calm.might, calm.might]);

  // --- Unnatural (2): the Defense Value --------------------------------------------------------------
  check("Natural leaves the Defense Value alone",
    shaken({ tier: 1 }).defenseValue, calm.defenseValue);
  check("Unnatural halves it",
    shaken({ tier: 2 }).defenseValue, Math.floor(calm.defenseValue / 2));
  check("and the Dodge Roll goes with it",
    shaken({ tier: 2 }).combat.dodge < calm.combat.dodge, true);
  check("while the Low Sky keeps both",
    [shaken({ tier: 3, high: 1 }).defenseValue, shaken({ tier: 3, high: 1 }).combat.dodge],
    [calm.defenseValue, calm.combat.dodge]);

  // --- Cataclysmic (3): knocked Prone every Round -----------------------------------------------------
  {
    const verbsAt = (model) => {
      const scope = { data: model, errors: [], context: {}, queue: [] };
      collectReactive(reactiveFor(model.parent), "start-of-round", scope);
      return scope.queue;
    };

    check("nothing knocks anybody down below Cataclysmic",
      [verbsAt(shaken({ tier: 1 })).length, verbsAt(shaken({ tier: 2 })).length], [0, 0]);
    check("and at Cataclysmic it does",
      verbsAt(shaken({ tier: 3 })).map(call => [call.verb, call.args[0]]),
      [["gain", "prone"]]);
    // No clock: the entry gives none, so Prone comes off the way Prone always comes off -
    // by getting up, which is then a thing to do every Round.
    check("with no clock on it",
      verbsAt(shaken({ tier: 3 })).some(call => call.verb === "expires"), false);
    check("and nobody off the ground is knocked down",
      [1, 2, 3, 4].map(high => verbsAt(shaken({ tier: 3, high })).length), [0, 0, 0, 0]);
  }

  // --- Why the question is asked at all ----------------------------------------------------------------
  {
    // Three of the four High Environments forbid Battle Weather outright, and a forbidden
    // Weather is not gathered - so up there these effects would never run whether they
    // asked or not. The Low Sky forbids none, which is the whole reason the test exists.
    const highs = traitsOfKind("high");
    check("the Low Sky forbids no Weather",
      highs.find(sky => Number(sky.highRank) === 1)?.noWeather, undefined);
    check("while the three above it do",
      highs.filter(sky => sky.noWeather === true).map(sky => Number(sky.highRank)).sort(),
      [2, 3, 4]);

    // So in the Low Sky the Weather IS gathered and the test is what stops it. Proved by
    // a Weather that does not ask: Hot Weather reaches somebody in the Low Sky.
    const hovering = ({ id, tier = 3 }) => {
      const parent = new ActorStub({}, { strict: false });
      parent.items = [];
      const model = new DBUCharacterData(
        { powerLevel: 10, progression: progressionTo(10),
          battlefield: { lightLevel: 0, highEnvironment: 1,
                         environment: "standard-environment", qualities: [],
                         weather: { id, tier },
                         cover: { active: false, rank: 0 } } },
        { parent, strict: false });
      parent.system = model;
      model.prepareBaseData?.();
      model.prepareDerivedData();
      return model;
    };

    check("a Weather that does not ask still reaches the Low Sky",
      hovering({ id: "hot-weather" }).steadfast.bonus, -3);
    check("so the earthquake is gathered up there and stops itself",
      hovering({ id: "earthquake-weather" }).might, calm.might);
    // And above the clouds neither reaches anybody, for the other reason.
    const above = ({ id }) => {
      const parent = new ActorStub({}, { strict: false });
      parent.items = [];
      const model = new DBUCharacterData(
        { powerLevel: 10, progression: progressionTo(10),
          battlefield: { lightLevel: 0, highEnvironment: 2,
                         environment: "standard-environment", qualities: [],
                         weather: { id, tier: 3 },
                         cover: { active: false, rank: 0 } } },
        { parent, strict: false });
      parent.system = model;
      model.prepareBaseData?.();
      model.prepareDerivedData();
      return model;
    };
    check("above the clouds nothing does",
      above({ id: "hot-weather" }).steadfast.bonus, 0);
  }
}

// --- What gathers it, and what must not --------------------------------------------------------
{
  const REGISTRY = fs.readFileSync(
    path.join(ROOT, "module", "effects", "registry.mjs"), "utf8");

  check("a Weather is gathered by its id", REGISTRY.includes("function weatherPrograms("), true);
  check("and only when the character is standing in one",
    REGISTRY.includes('const id = String(actor.system?.battlefield?.weather?.id ?? "");')
      && REGISTRY.includes("if (!id) return [];"), true);
  check("an id naming nothing is reported rather than ignored",
    REGISTRY.includes("is not a Battle Weather this system has a file for"), true);
  check("and a Battlefield file that is not a Weather is refused",
    REGISTRY.includes("if (trait.weather !== true) {"), true);

  // The Light Level search and the Weather search are over the same folder, so each has to
  // say which files are its own. Without the second test a Weather with no `lightLevel`
  // would have coerced to Level 0 and fought Normal for the slot.
  // Three searches over one folder now, and the Environments joined the list of what the
  // Light Level search has to leave alone. `environments.mjs` owns that check; what is
  // pinned here is only that the Weathers are still among the excluded.
  check("the Light Level search leaves the Weathers out",
    REGISTRY.includes("&& (candidate.weather !== true)"), true);

  // Three gates, none of them alternatives: you can be behind a rock, in the dark, in a
  // storm. Gathered as three entries rather than one choice.
  check("all three Battlefield gathers are called",
    ["battlefieldPrograms(actor, report)", "coverPrograms(actor, report)",
     "weatherPrograms(actor, report)"].every(call => REGISTRY.includes(call)), true);
}

// --- What is still not built, named ---------------------------------------------------------------
{
  // The three rules that are about an area, and the one that points at a Profile which is
  // not in the system. Named so the gaps are a list rather than something to rediscover.
  const ELSEWHERE = fs.readdirSync(path.join(ROOT, "module"))
    .filter(name => name.endsWith(".mjs"))
    .map(name => fs.readFileSync(path.join(ROOT, "module", name), "utf8"))
    .join("\n");

  check("nothing counts Squares for a Weather",
    /weatherSquares|weatherArea|weatherAoe/i.test(ELSEWHERE), false);
  check("nothing decides whether one Weather replaces another",
    /replaceWeather|canReplaceWeather/.test(ELSEWHERE), false);
  check("and nothing removes one somebody created",
    /removeWeather|createdWeather/.test(ELSEWHERE), false);

  // "Each Battle Weather is connected to a Profile with Elemental in the name." The
  // Elemental Profiles are arriving now, but not one a Weather names - Dark is the first,
  // and no Weather is Dark - so the id is still carried on the file and read by nobody.
  check("the connection is carried on the file",
    getTrait("hot-weather").profile, "elemental-fire");
  const MANEUVERS = fs.readFileSync(path.join(ROOT, "module", "maneuvers.mjs"), "utf8");
  const { PROFILES: ALL_PROFILES } = await import(modUrl("maneuvers.mjs"));
  const named = traitsOfKind("battlefields").filter(trait => trait.weather === true)
    .map(trait => trait.profile);
  // The Profiles are keyed `elementalEarth` and the Weathers name `elemental-earth`: one
  // spelling apart, and the check that they meet is the only thing that keeps them so.
  const keyOf = id => String(id).replace(/-(\w)/g, (m, c) => c.toUpperCase());
  check("the Weathers whose Profile is built are the ones given so far",
    named.filter(id => ALL_PROFILES[keyOf(id)]).sort(),
    ["elemental-earth", "elemental-fire", "elemental-ice", "elemental-lightning",
     "elemental-poison", "elemental-wind"]);
  check("and each one is the Profile of that element",
    named.filter(id => ALL_PROFILES[keyOf(id)])
      .map(id => ALL_PROFILES[keyOf(id)].label).sort(),
    ["Elemental (Earth)", "Elemental (Fire)", "Elemental (Ice)", "Elemental (Lightning)",
     "Elemental (Poison)", "Elemental (Wind)"]);
  // Every Weather now names a Profile that exists.
  check("no Weather names a Profile that is not built",
    named.filter(id => !ALL_PROFILES[keyOf(id)]), []);
  check("the Elemental Profiles have begun",
    /Elemental \(Dark\)/.test(MANEUVERS), true);
  check("so nothing reads it", /trait\.profile|\.profile ===/.test(ELSEWHERE), false);
}

// --- Brace: the Weather felt a Tier lower, applied -------------------------------------------------
{
  // "Until the start of your next turn, treat all Battle Weathers as if they were 1 Weather
  // Tier lower. If this would reduce the Weather Tier to 0, ignore the effects of that Battle
  // Weather. If you have 4+ Skill Ranks in Survival, you may treat it as 2 Weather Tiers lower
  // instead." Run through the whole engine: Braced as the mark, the Ranks from progression.
  check("Braced writes it: a Tier, and another at 4+ Ranks in Survival",
    [BRACED.includes("weather.tiers += 1;"), BRACED.includes("if (survival.ranks >= 4) {")], [true, true]);
  const braced = ({ tier = 3, survival = 0, bracedNow = true } = {}) => {
    const parent = new ActorStub({}, { strict: false });
    parent.items = [];
    const progression = progressionTo(10);
    progression[0] = { ...progression[0], skillRanks: Array(survival).fill("survival") };
    const model = new DBUCharacterData(
      { powerLevel: 10, progression, conditions: bracedNow ? { braced: 1 } : {},
        battlefield: { lightLevel: 0, weather: { id: "cold-weather", tier },
                       cover: { active: false, rank: 0 } } },
      { parent, strict: false });
    parent.system = model;
    model.prepareBaseData?.();
    model.prepareDerivedData();
    return model;
  };
  const felt = model => model.battlefield.weather.felt;
  const gathered = model => model.effects.programs.some(entry => entry.sourceId === "battlefield:cold-weather");
  const saves = model => model.savingThrows.corporeal.value;
  const bare = braced({ bracedNow: false });
  check("not Braced: felt as set", felt(bare), 3);
  check("Braced: a Tier lower - and the (WT) reads it", [felt(braced()), saves(braced()) - saves(bare)],
    [2, 1]);
  check("with 4+ Ranks in Survival, two lower; 3 Ranks is still one",
    [felt(braced({ survival: 4 })), felt(braced({ survival: 3 }))], [1, 2]);
  check("brought to 0: the Weather's effects not gathered at all",
    [felt(braced({ tier: 1 })), gathered(braced({ tier: 1 })), gathered(braced({ tier: 2 }))],
    [0, false, true]);
  check("never below 0", felt(braced({ tier: 1, survival: 4 })), 0);
  check("said on the Combat tab as applied", [
    SHEET.includes("this system has no Battle Weathers to take it off"),
    SHEET.includes('+ "Battle Weather whose effects you ignore."')], [false, true]);
  check("and beside the Tier on the Battlefields tab, when it is felt lower",
    [SHEET.includes('? (feltNow ? `Felt at Tier ${feltNow}` : "Ignored")'),
     TAB.includes("{{#if weatherNow.feltNote}}")], [true, true]);
}


// --- What the tab lists under the picker --------------------------------------------------------------
{
  // Every Weather, at every Tier: that Tier's effects and the ones under it, never above.
  const weathers = traitsOfKind("battlefields").filter(trait => trait.weather === true);
  check("there are Weathers to read", weathers.length >= 6, true);

  for (const weather of weathers) {
    for (const tierNow of [1, 2, 3]) {
      const effects = weatherEffectsUpTo(weather.text, tierNow);
      check(`${weather.id} at Tier ${tierNow} lists one effect a Tier up to it`,
        effects.map(effect => effect.tier),
        [1, 2, 3].filter(tier => tier <= tierNow));
    }
  }

  // Named by the Tier each came from, in the rules' own words.
  const hot = weatherEffectsUpTo(getTrait("hot-weather").text, 2);
  check("each effect says which Tier it is from",
    hot.map(effect => effect.name), ["Natural", "Unnatural"]);
  check("and is the entry's own bullet, without the marker", hot.map(effect => effect.text), [
    "Reduce the Dice Score of your Steadfast Checks by 1(WT).",
    "Halve your Soak Value."
  ]);

  // A bullet wrapped over several lines in the file is one effect, not three.
  const tornado = weatherEffectsUpTo(getTrait("tornado-weather").text, 3);
  check("a wrapped bullet comes out whole",
    [tornado.length, tornado[2]?.text.startsWith("Upon the creation of this Battle Weather"),
     /epicenter in the most direct path possible/.test(tornado[2]?.text ?? "")],
    [3, true, true]);

  // Nothing to list for Clear, and nothing is invented for a Tier the entry does not have.
  check("no entry, no effects", weatherEffectsUpTo("", 3), []);
  check("a Tier past the last lists them all and no more",
    weatherEffectsUpTo(getTrait("hot-weather").text, 9).length, 3);

  // The sheet hands it the Tier that is set, and the tab draws the list, not a paragraph.
  check("the sheet builds the list from the Tier they feel",
    SHEET.includes("effects: weatherEffectsUpTo(weatherTrait?.text, feltNow)"), true);
  check("the tab draws it as a list",
    TAB.includes("{{#each weatherNow.effects as |effect|}}"), true);
  check("and the one-line summary is on hover",
    [TAB.includes('data-tooltip="{{weatherNow.effect}}"'),
     TAB.includes('<p class="tab-placeholder">{{weatherNow.effect}}</p>')], [true, false]);
}

// --- The tab lists it, collapsed ------------------------------------------------------------------
{
  check("the tab has a Battle Weather section",
    TAB.includes("Battle Weather"), true);
  // The reading list of Tiers and rules was taken off the tab on request. What is left is
  // the picker, and nothing may still hand the page a list that nobody draws.
  check("the reading list is gone",
    [TAB.includes('data-section="weather"'), TAB.includes("{{#each weatherRules"),
     SHEET.includes("context.weatherRules")], [false, false, false]);
  check("the picker still walks the Tiers",
    TAB.includes("{{#each weatherTiers as |tier|}}"), true);
  check("the sheet hands the page the Tiers",
    SHEET.includes("context.weatherTiers = WEATHER_TIERS.map("), true);
  // The Tiers are one list serving two things: the picker, which needs to know which one
  // is set, and the reference below, which does not care. Marked rather than rebuilt.
  check("with the Tier that is set marked on it",
    SHEET.includes("chosen: tier.tier === tierNow"), true);
  check("from the one file that has them",
    SHEET.includes('import { WEATHER_TIERS, weatherEffectsUpTo } from "../weather.mjs";'), true);
  check("and copies no rule out by hand",
    /combined in any fashion/.test(SHEET) || /combined in any fashion/.test(TAB), false);

  // `context.weather` is the Brace reduction on the Combat tab and has been for a while.
  // Two different things called the same thing is how one of them ends up drawn where the
  // other belongs.
  check("and the Brace reduction is still its own key",
    SHEET.includes("context.weather = weatherTiers"), true);
  check("read by the Combat tab and not this one",
    [fs.readFileSync(path.join(ROOT, "templates", "parts", "actor-combat.hbs"), "utf8")
      .includes("{{#if weather}}"),
     TAB.includes("{{#if weather}}")], [true, false]);

}


// --- The Check that reads it, run -----------------------------------------------------------------
{
  // The reason this is run rather than read: `steadfast.target` had been in the Slot table
  // with nothing reading it, because the Check rolled a bare die against a bare 6 with
  // both written into the function. A derived `steadfast.bonus` that nothing rolls is the
  // same bug wearing a different name, and it looks exactly like a working one.
  const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
  const from = CHAT.indexOf("export async function rollSteadfastCheck(");
  const to = CHAT.indexOf("\n}\n", from);
  check("the Check was found to cut out", (from > 0) && (to > from), true);

  let formula = "";
  let flavour = "";
  class Roll {
    constructor(f) { formula = f; this.total = 5; }
    async evaluate() {}
    async toMessage({ flavor }) { flavour = flavor; }
  }

  // Its window answered Roll: what is checked is the roll it makes.
  const rollSteadfastCheck = new Function("DBUCharacterData", "Roll", "ChatMessage", "prepareRoll",
    `async function endShapeshift() {}
     async function rescueSteadfast() { return ""; }
     async function heartOfEvilAgainst() { return 0; }
     async function steadfastPassed() {}
     async function steadfastFailed() {}
     function steadfastCheckFlag() { return null; }
     const SCOPE = "dbu-ttrpg", CHECK_FLAG = "check";
     ${CHAT.slice(from, to + 2).replace("export async function", "async function")}
     return rollSteadfastCheck;`)(
      DBUCharacterData, Roll, { getSpeaker: () => ({}) }, async () => true);

  const checker = (model) => ({
    system: { ...model, threshold: { pending: ["injured"] },
              steadfast: model.steadfast },
    async update() {}
  });

  const standingIn = ({ weather = "", tier = 1 } = {}) => {
    const parent = new ActorStub({}, { strict: false });
    parent.items = [];
    const model = new DBUCharacterData(
      { powerLevel: 10, progression: progressionTo(10),
        battlefield: { lightLevel: 0, weather: { id: weather, tier },
                       cover: { active: false, rank: 0 } } },
      { parent, strict: false });
    parent.system = model;
    model.prepareBaseData?.();
    model.prepareDerivedData();
    return model;
  };

  // Clear weather: the die alone, because a bonus of nothing added to a formula is noise
  // on every card for the sake of one Weather.
  await rollSteadfastCheck(checker(standingIn()));
  check("in clear weather the Check rolls the die alone", formula, "1d10");
  check("needing the target it has always needed", flavour.includes("needing 6"), true);

  // In the heat, the penalty is in the formula rather than added afterwards, so the card
  // shows the whole sum - a Check that failed by one is a thing somebody wants to see.
  await rollSteadfastCheck(checker(standingIn({ weather: "hot-weather", tier: 1 })));
  check("Natural Hot Weather puts the penalty in the formula", formula, "1d10 + -1");

  await rollSteadfastCheck(checker(standingIn({ weather: "hot-weather", tier: 3 })));
  check("and Cataclysmic puts three in it", formula, "1d10 + -3");

  // And the target is the one that is derived, not the 6 that used to be written in. The
  // Slot that sets it has no writer yet - Hot Weather names the Dice Score - so this is
  // asked of the function directly rather than through a character.
  const withTarget = target => ({
    system: { threshold: { pending: ["injured"] },
              steadfast: { die: "1d10", bonus: 0, target } },
    async update() {}
  });
  check("a Check that rolls under the target fails",
    await rollSteadfastCheck(withTarget(9)), false);
  check("and one that clears it passes",
    await rollSteadfastCheck(withTarget(3)), true);
  check("with the card naming the target it was rolled against",
    flavour.includes("needing 3"), true);

  // Neither the die nor the target is written into the roll any more.
  const body = CHAT.slice(from, to);
  check("the die is read off the character",
    body.includes("const { die, bonus, target, natural = 0 } = actor.system.steadfast;"), true);
  check("and neither constant is reached for in here",
    /STEADFAST_DIE|STEADFAST_TARGET/.test(body), false);
}

console.log(`${failed} failing`);
process.exit(failed ? 1 : 0);
