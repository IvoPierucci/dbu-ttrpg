/**
 * Elemental (Dark): the first Magic Profile.
 *
 * A Ki Wager paid in Life Points and still taken out of Capacity, and a Light Level taken
 * away from whoever it Damages until the start of the attacker's next turn. The Level is
 * run through the real engine: a character at Normal with a stack of Darkened has to come
 * out exactly as one standing in Dark.
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

const { loadTraits, traitsOfKind, getTrait, KINDS, printedLines } =
  await import(modUrl("effects/traits.mjs"));
const { default: DBUCharacterData } = await import(modUrl("data/actor-character.mjs"));
await loadTraits();

const INDEX = JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));
const REGISTRY = fs.readFileSync(path.join(ROOT, "module", "effects", "registry.mjs"), "utf8");
const SHEET = fs.readFileSync(
  path.join(ROOT, "module", "sheets", "actor-character-sheet.mjs"), "utf8");
const TAB = fs.readFileSync(
  path.join(ROOT, "templates", "parts", "actor-battlefields.hbs"), "utf8");
const BLINDED = fs.readFileSync(path.join(TRAITS, "conditions", "blinded.dbu"), "utf8");

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

/**
 * A character standing in a given Light Level, run through the whole engine.
 *
 * Built the way every other harness here builds one, with the Light Level set before the
 * phases run - which is the only thing that differs between the calls below.
 */
// Built up rather than left at the minimum. A character with an Awareness of 1 has every
// one of these effects clamped at nothing, and a check that passes because both sides
// bottomed out is a check that measured nothing.
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

function standing(lightLevel, { powerLevel = 10, conditions = {} } = {}) {
  // A parent, because that is where the effects engine looks: `programsFor(this.parent)`
  // reads the Items, the Conditions and - now - the Light Level off the Actor, not off
  // the model. A model with no parent has no effects at all, which would make every check
  // below pass by measuring nothing.
  //
  // A DataModel rather than a plain object, which is what the base class insists on - and
  // the Actor it stands in for is one too.
  const parent = new ActorStub({}, { strict: false });
  parent.items = [];
  const model = new DBUCharacterData(
    { powerLevel, progression: progressionTo(powerLevel), battlefield: { lightLevel }, conditions },
    { parent, strict: false });
  parent.system = model;
  model.prepareBaseData?.();
  model.prepareDerivedData();
  return model;
}


const { PROFILES, maxKiWager, maxLifeWager, lifeWagerProblem, spendLifeWager, maneuverKiCost,
        getManeuver, loadManeuvers } = await import(modUrl("maneuvers.mjs"));
const { lightLevelOf, LIGHT_LEVEL_MIN, LIGHT_LEVEL_MAX } = await import(modUrl("light.mjs"));
await loadManeuvers();

const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");
const CHAT = read("module", "chat.mjs");
const MANEUVERS = read("module", "maneuvers.mjs");
const USE = read("module", "use-maneuver.mjs");
const DURATIONS = read("module", "durations.mjs");

/** The body of one function in a source file, from its signature to the next top-level one. */
function source(text, name) {
  const at = text.search(new RegExp(`(async )?function ${name}\\(`));
  if (at < 0) return "";
  const next = text.slice(at + 1).search(/\n(export )?(async )?function /);
  return next < 0 ? text.slice(at) : text.slice(at, at + 1 + next);
}

// --- The Profile ----------------------------------------------------------------------------------
const dark = PROFILES.elementalDark;
{
  check("it is there", Boolean(dark), true);
  check("named as printed", dark.label, "Elemental (Dark)");
  check("a Magic Profile", dark.foundations, ["magic"]);
  check("Standard, at 2(T)", [dark.damageCategory, dark.kiCostPerTier], ["standard", 2]);
  check("it may wager Life", dark.wagerFromLife, true);
  check("and darkens one Level", dark.squareMark, { condition: "darkened", stacks: 1 });
  // The Light half is reachable now: a Multi-Profile Technique carries both.
  check("nothing about it waits any more", dark.needs ?? "", "");
  // Nothing else in the library may wager Life.
  check("no other Profile wagers Life",
    Object.entries(PROFILES).filter(([id, p]) => p.wagerFromLife && id !== "elementalDark")
      .map(([id]) => id), []);
}

// --- The Level a character is in ----------------------------------------------------------------
{
  const at = (set, darkened) =>
    lightLevelOf({ battlefield: { lightLevel: set }, conditions: darkened ? { darkened } : {} },
      getTrait);
  check("nothing darkened, the Level set", [at(-2, 0), at(0, 0), at(2, 0)], [-2, 0, 2]);
  check("a stack of Darkened is a Level down", [at(0, 1), at(2, 1), at(1, 2)], [-1, 1, -1]);
  check("never past Pitch Black", [at(-2, 1), at(-1, 3), at(2, 4)], [-2, -2, -2]);
  check("the ends are the field's", [LIGHT_LEVEL_MIN, LIGHT_LEVEL_MAX],
    [DBUCharacterData.LIGHT_LEVEL_MIN, DBUCharacterData.LIGHT_LEVEL_MAX]);

  // Run through the engine: Normal and one stack of Darkened is Dark, effects and all.
  const plain = standing(0);
  const inDark = standing(-1);
  const darkened = standing(0, { conditions: { darkened: 1 } });
  check("the test character has something to lose",
    plain.awareness > inDark.awareness, true);
  check("Darkened at Normal is Dark to the engine",
    [darkened.awareness, darkened.defenseValue, darkened.skills.perception.bonus],
    [inDark.awareness, inDark.defenseValue, inDark.skills.perception.bonus]);
  check("and the Level they set is left alone", darkened.battlefield.lightLevel, 0);

  check("the registry reads the Level through it",
    REGISTRY.includes("const level = lightLevelOf(actor.system, getTrait);"), true);
  check("the sheet names the Level they are really in",
    [SHEET.includes("const inNow = lightLevelOf(system, getTrait);"),
     TAB.includes("{{lightLevel.darkened}}")], [true, true]);
}

// --- The mark ----------------------------------------------------------------------------------
{
  const mark = getTrait("darkened");
  check("the mark is there, not a Combat Condition",
    [mark?.kind, mark?.combatCondition], ["conditions", false]);
  check("four stacks, which is as far as the table goes",
    Number(mark.maxStacks), LIGHT_LEVEL_MAX - LIGHT_LEVEL_MIN);
  check("with no effects of its own",
    mark.script.split("\n").filter(line => line.trim() && !line.trim().startsWith("#")), []);
  check("in the index", INDEX.traits.includes("conditions/darkened.dbu"), true);
}

// --- On whoever took the Damage, on the attacker's clock --------------------------------------------
{
  const apply = source(CHAT, "applyAttackDamage");
  check("only when Damage was dealt, and not off an Absolute miss",
    apply.includes("if (attacker && (damage > 0) && !isAbsoluteMiss(own)) {"), true);
  check("the Damage step puts the Profile's mark on them, to the start of the attacker's turn",
    apply.includes("await markUntilNextTurn(attacker, target, riders.squareMark.condition,")
      && apply.includes("riders.squareMark.stacks, \"start\", riders.label);"), true);

  const mark = source(CHAT, "markUntilNextTurn");
  check("the stacks go on them", mark.includes("gainCondition(target, key, stacks)"), true);
  check("and a clock per stack gained on the attacker, to the edge the entry names", [
    mark.includes("for (let i = 0; i < gained; i++)"),
    mark.includes("await lasting(attacker, {"),
    mark.includes('edge: (edge === "end") ? EDGES.END : EDGES.START,'),
    mark.includes("source, next = true) {") && mark.includes("      next,"),
    mark.includes("on: target.uuid")
  ], [true, true, true, true, true]);
  check("and no clock for a stack the cap refused",
    mark.includes("Math.min(cap, before + stacks) - before"), true);

  // The Damage is applied by whoever plays the one who took it, so the clock is written to
  // a character this client may not own.
  const lasting = source(DURATIONS, "lasting");
  check("a clock on somebody else's character is relayed",
    [lasting.includes("if (actor.isOwner === false) {"),
     lasting.includes("await requestActorUpdate(actor, changes);")], [true, true]);
}

// --- The wager, in Life ------------------------------------------------------------------------------
{
  const actor = (ki, life, capacityMax, spent = 0) => ({
    name: "Tester",
    system: {
      ki: { value: ki }, life: { value: life },
      capacity: { max: capacityMax, spent, remaining: capacityMax - spent },
      effects: { slots: {} }, tierOfPower: 2, baseTierOfPower: 2
    }
  });

  // The same three limits against a different pool.
  check("half Capacity, the Capacity left, and the Life there is", [
    maxLifeWager(actor(0, 100, 40)),
    maxLifeWager(actor(0, 100, 40, 30)),
    maxLifeWager(actor(0, 7, 40))
  ], [20, 10, 7]);
  check("Ki is not what limits it", [maxKiWager(actor(0, 100, 40)), maxLifeWager(actor(0, 100, 40))],
    [0, 20]);
  check("Full Wager lifts the half-Capacity limit here too",
    maxLifeWager(actor(0, 100, 40), ["full-wager"]), 40);

  // Not added to the Ki price when it is paid in Life.
  const basic = getManeuver("basic-attack");
  const who = actor(100, 100, 100);
  const inKi = maneuverKiCost(basic, { profile: "elementalDark", kiWager: 6 }, who);
  const inLife = maneuverKiCost(basic,
    { profile: "elementalDark", kiWager: 6, wagerFromLife: true }, who);
  check("a Ki wager is in the Ki price and a Life one is not", inKi - inLife, 6);

  // Checked before anything is spent: the Ki and the wager share one Capacity.
  const declared = { profile: "elementalDark", kiWager: 6, wagerFromLife: true };
  check("nothing wrong with a wager that fits", lifeWagerProblem(actor(0, 50, 40), declared, 4),
    null);
  check("more Life than there is is refused",
    /Life Points/.test(lifeWagerProblem(actor(0, 5, 40), declared, 4) ?? ""), true);
  check("and more Capacity than is left, counting the price",
    /Capacity/.test(lifeWagerProblem(actor(0, 50, 40, 32), declared, 4) ?? ""), true);
  check("a Ki wager is none of this function's business",
    lifeWagerProblem(actor(0, 0, 0), { kiWager: 6 }, 0), null);

  // Paid: Life down and Capacity spent, and the Ki left alone.
  let written = null;
  const payer = { ...actor(30, 50, 40, 4), update: async changes => { written = changes; } };
  await spendLifeWager(payer, declared);
  check("paid out of Life and out of Capacity",
    written, { "system.life.value": 44, "system.capacity.spent": 10 });
  written = null;
  await spendLifeWager(payer, { kiWager: 6 });
  check("and nothing paid for a Ki wager", written, null);

  // The dialog honours the box only for a Profile that allows it.
  check("the box is drawn when a Profile on offer allows it",
    MANEUVERS.includes("const lifeWager = offered.some(profile => profile.wagerFromLife) || Boolean(second?.wagerFromLife);"), true);
  check("and honoured only for one that does",
    MANEUVERS.includes("const wagerFromLife = Boolean((PROFILES[profile]?.wagerFromLife || second?.wagerFromLife)"), true);
  check("clamped against the pool it comes out of",
    MANEUVERS.includes("maxLifeWager(actor, own) : maxKiWager(actor, own)"), true);

  // Both places an attack is paid for check it first and pay it after the Ki.
  for (const [name, text] of [["use-maneuver", USE], ["chat", CHAT]]) {
    const check1 = text.indexOf("lifeWagerProblem(actor, declared, price)");
    const pay = text.indexOf("spendManeuverCost(actor, maneuver, ", check1);
    const life = text.indexOf("spendLifeWager(actor, declared)", pay);
    check(`${name}: checked, then the Ki, then the Life`,
      (check1 > 0) && (pay > check1) && (life > pay), true);
  }

  // The card still adds it to the Wound Roll, and says which pool paid.
  check("carried to the card", CHAT.includes("wagerFromLife: Boolean(wagerFromLife && kiWager),"),
    true);
  check("and said as LP", CHAT.includes('${attack.wagerFromLife ? "LP" : "KP"} wagered'), true);
  check("the Wound Roll still takes the wager, whatever paid it",
    CHAT.includes('{ label: "Ki Wager", value: attack.kiWager ?? 0 },'), true);
}

// --- Elemental (Earth) -------------------------------------------------------------------------------
{
  const earth = PROFILES.elementalEarth;
  check("Earth is there, named as printed", earth?.label, "Elemental (Earth)");
  check("a Magic Profile", earth.foundations, ["magic"]);
  check("Direct, at 4(T)", [earth.damageCategory, earth.kiCostPerTier], ["direct", 4]);
  // All of it is borrowed from the Weapons: Bludgeoning, which possesses Staggering - see the
  // weapons harness for what that comes to.
  check("what it borrows is named", [earth.borrowsCategory, earth.needs ?? null], ["bludgeoning", null]);
  check("and nothing else is on it",
    Object.keys(earth).filter(key =>
      !["label", "foundations", "kiCostPerTier", "damageCategory", "text", "borrowsCategory"].includes(key)),
    []);
  check("its price where it is offered is the rule's",
    maneuverKiCost(getManeuver("basic-attack"), { profile: "elementalEarth" },
      { system: { tierOfPower: 3, baseTierOfPower: 3, effects: { slots: {} } } }), 12);
}

// --- Elemental (Fire) --------------------------------------------------------------------------------
{
  const fire = PROFILES.elementalFire;
  check("Fire is there, named as printed", fire?.label, "Elemental (Fire)");
  check("a Magic Profile, Direct, at 8(T)",
    [fire.foundations, fire.damageCategory, fire.kiCostPerTier], [["magic"], "direct", 8]);
  check("a stack of Broken for a Threshold, and a burning Square",
    [fire.onThreshold, fire.squareMark],
    [{ condition: "broken", stacks: 1 }, { condition: "ignited", stacks: 1 }]);
  check("the AoE sentence is built: nothing waits", fire.needs ?? "", "");

  // The Square: a mark whose file names the Quality it stands for.
  const { qualitiesOf, qualitiesFromEffects } = await import(modUrl("environments.mjs"));
  const ignited = getTrait("ignited");
  check("the mark is there, not a Combat Condition, naming Aflame",
    [ignited?.kind, ignited?.combatCondition, ignited?.quality], ["conditions", false, "aflame"]);
  check("with no effects of its own",
    ignited.script.split("\n").filter(line => line.trim() && !line.trim().startsWith("#")), []);
  check("in the index", INDEX.traits.includes("conditions/ignited.dbu"), true);

  const square = (conditions, ticked = []) => ({ battlefield: { qualities: ticked }, conditions });
  check("held, the Square is Aflame",
    qualitiesOf(square({ ignited: 1 }), null, getTrait), ["aflame"]);
  check("not held, it is not", qualitiesOf(square({ ignited: 0 }), null, getTrait), []);
  check("once, however many attackers lit it and whether the player ticked it too",
    qualitiesOf(square({ ignited: 3 }, ["aflame"]), null, getTrait), ["aflame"]);
  check("a mark with no Quality header puts none on the Square",
    qualitiesFromEffects(square({ darkened: 2, broken: 1 }), getTrait), []);
  check("and nothing without the Trait lookup to read headers from",
    qualitiesOf(square({ ignited: 1 }), null), []);

  // Every place that asks which Qualities a Square has is handed the lookup.
  for (const [name, text, call] of [
    ["registry", REGISTRY, "qualitiesOf(actor.system, standing, getTrait)"],
    ["chat", CHAT, "qualitiesOf(target.system, standing, getTrait)"],
    ["sheet", SHEET, "qualitiesOf(system, environmentTrait, getTrait)"],
    ["model", read("module", "data", "actor-character.mjs"), "qualitiesOf(this, standing, getTrait)"]
  ]) {
    check(`the ${name} sees an Ignited Square`, text.includes(call), true);
  }
  check("and the sheet will not let the player untick it",
    SHEET.includes("...qualitiesFromEffects(system, getTrait)"), true);

  // Broken, off a Threshold crossed by this one write, until the end of the attacker's turn.
  const apply = source(CHAT, "applyAttackDamage");
  check("the Threshold is read on both sides of the write",
    [apply.includes("DBUCharacterData.thresholdKey(floor, target.system.life.max, typicalMinion(target)))"),
     apply.includes("DBUCharacterData.thresholdKey(target.system.life.value,")], [true, true]);
  check("the Threshold's Condition only for a Threshold crossed, to the end of their next turn",
    apply.includes("const onThreshold = PROFILES[id]?.onThreshold;\n      if (onThreshold && knockedThrough) {")
      && apply.includes('onThreshold.stacks, onThreshold.untimed ? null : "end", PROFILES[id].label);'),
    true);

  // Said as data, so nothing in the code is keyed to one Profile's Condition.
  check("no Profile's Condition is named in the Damage step",
    /"broken"|"slowed"|"ignited"|"frosted"|"darkened"|"brightened"/.test(apply), false);

  // Downward only: the Thresholds are in order from Healthy, so deeper is a higher index.
  const keys = Object.keys(DBUCharacterData.THRESHOLDS);
  const at = life => keys.indexOf(DBUCharacterData.thresholdKey(life, 100));
  check("the order the comparison relies on", keys, ["healthy", "bruised", "injured", "critical"]);
  check("60 to 40 crosses one, 60 to 55 none", [at(40) > at(60), at(55) > at(60)], [true, false]);
}

// --- Elemental (Ice) ---------------------------------------------------------------------------------
{
  const ice = PROFILES.elementalIce;
  check("Ice is there, named as printed", ice?.label, "Elemental (Ice)");
  check("a Magic Profile, Direct, at 8(T)",
    [ice.foundations, ice.damageCategory, ice.kiCostPerTier], [["magic"], "direct", 8]);
  check("a stack of Slowed for a Threshold, and a frozen Square",
    [ice.onThreshold, ice.squareMark],
    [{ condition: "slowed", stacks: 1 }, { condition: "frosted", stacks: 1 }]);
  check("the AoE sentence is built: nothing waits", ice.needs ?? "", "");

  const { qualitiesOf } = await import(modUrl("environments.mjs"));
  const frosted = getTrait("frosted");
  check("the mark is there, not a Combat Condition, naming Frozen",
    [frosted?.kind, frosted?.combatCondition, frosted?.quality], ["conditions", false, "frozen"]);
  check("with no effects of its own",
    frosted.script.split("\n").filter(line => line.trim() && !line.trim().startsWith("#")), []);
  check("in the index", INDEX.traits.includes("conditions/frosted.dbu"), true);
  check("held, the Square is Frozen",
    qualitiesOf({ battlefield: { qualities: [] }, conditions: { frosted: 1 } }, null, getTrait),
    ["frozen"]);
  check("burning and frozen at once is both",
    qualitiesOf({ battlefield: { qualities: [] }, conditions: { frosted: 1, ignited: 2 } },
      null, getTrait).sort(), ["aflame", "frozen"]);

  // Every Profile's rider names things that exist: the Condition, and a mark whose Quality
  // is an Environmental Quality with a file.
  const { allConditions } = await import(modUrl("conditions.mjs"));
  const known = allConditions().map(condition => condition.key);
  for (const [id, profile] of Object.entries(PROFILES)) {
    if (profile.onThreshold) {
      check(`${id}'s Threshold Condition exists`, known.includes(profile.onThreshold.condition), true);
    }
    if (profile.squareMark) {
      // A mark does its work through its file: a Quality for the Square, a Light shift, or
      // an Environment the Square becomes.
      const mark = getTrait(profile.squareMark.condition);
      const quality = getTrait(mark?.quality ?? "");
      const becomes = getTrait(mark?.becomes ?? "");
      check(`${id}'s Square mark stands for a Quality, a Light shift or an Environment`,
        Boolean(quality?.envQuality) || Boolean(Number(mark?.lightShift))
          || (becomes?.environment === true), true);
      check(`${id}'s Square mark is a stack or more`, profile.squareMark.stacks >= 1, true);
    }
  }
}

// --- Elemental (Light) -------------------------------------------------------------------------------
{
  const light = PROFILES.elementalLight;
  check("Light is there, named as printed", light?.label, "Elemental (Light)");
  check("a Magic Profile, Standard, at 2(T)",
    [light.foundations, light.damageCategory, light.kiCostPerTier], [["magic"], "standard", 2]);
  check("granting Full Wager", light.grantsAdvantage, "full-wager");
  check("and a Level up on whoever it Damages",
    light.squareMark, { condition: "brightened", stacks: 1 });
  check("nothing about it waits any more", light.needs ?? "", "");

  // Full Wager, free: nothing about it is in the Ki price.
  const basic = getManeuver("basic-attack");
  const who = { system: { tierOfPower: 3, baseTierOfPower: 3, effects: { slots: {} } } };
  check("its price is the rule's, and Full Wager adds nothing to it",
    maneuverKiCost(basic, { profile: "elementalLight" }, who), 6);

  // The ceiling in the dialog is the Profile's: settled once the choice is known.
  check("the ceiling is worked out against what the chosen Profile grants",
    MANEUVERS.includes("const own = withProfile(profile);")
      && MANEUVERS.includes("const ceiling = Math.min(capped(wagerFromLife ? maxLifeWager(actor, own) : maxKiWager(actor, own)),"),
    true);
  check("and the dialog says what Full Wager would allow",
    MANEUVERS.includes("fullMax > wagerMax ? ` (${fullMax} with Full Wager)` : \"\""), true);
  check("All or Nothing still pins the floor to that ceiling",
    MANEUVERS.includes("const floor = forcedFullWager(features) ? ceiling : Math.min(wagerMin, ceiling);"),
    true);

  // The Level: Brightened moves it up, and both marks at once cancel.
  const bright = getTrait("brightened");
  check("the mark is there, not a Combat Condition, a Level up",
    [bright?.kind, bright?.combatCondition, Number(bright?.lightShift), Number(bright?.maxStacks)],
    ["conditions", false, 1, 4]);
  check("Darkened says a Level down", Number(getTrait("darkened")?.lightShift), -1);
  check("in the index", INDEX.traits.includes("conditions/brightened.dbu"), true);

  const at = (set, conditions) => lightLevelOf({ battlefield: { lightLevel: set }, conditions },
    getTrait);
  check("Brightened is a Level up, and never past Blinding",
    [at(0, { brightened: 1 }), at(1, { brightened: 3 }), at(-2, { brightened: 2 })], [1, 2, 0]);
  check("one of each is the Level set", at(0, { brightened: 1, darkened: 1 }), 0);
  check("with no lookup, the Level set", lightLevelOf(
    { battlefield: { lightLevel: 1 }, conditions: { darkened: 2 } }), 1);

  const brightened = standing(0, { conditions: { brightened: 1 } });
  const inBright = standing(1);
  check("Brightened at Normal is Bright to the engine",
    [brightened.awareness, brightened.defenseValue], [inBright.awareness, inBright.defenseValue]);
  check("and the sheet says which way it moved",
    SHEET.includes('${inNow < standing ? "Darkened" : "Brightened"}'), true);
  check("and no mark is named where the Level is worked out",
    /darkened|brightened/.test(read("module", "light.mjs").split("\n")
      .filter(line => !line.trim().startsWith("*") && !line.trim().startsWith("//")).join("\n")),
    false);
}

// --- Elemental (Lightning) ---------------------------------------------------------------------------
{
  const bolt = PROFILES.elementalLightning;
  check("Lightning is there, named as printed", bolt?.label, "Elemental (Lightning)");
  check("a Magic Profile, Direct, at 8(T)",
    [bolt.foundations, bolt.damageCategory, bolt.kiCostPerTier], [["magic"], "direct", 8]);
  check("Impediment for a Threshold, and a live Square",
    [bolt.onThreshold, bolt.squareMark],
    [{ condition: "impediment", stacks: 1 }, { condition: "crackling", stacks: 1 }]);
  check("the AoE sentence is built: nothing waits", bolt.needs ?? "", "");

  const { qualitiesOf } = await import(modUrl("environments.mjs"));
  const crackling = getTrait("crackling");
  check("the mark is there, not a Combat Condition, naming Electrified",
    [crackling?.kind, crackling?.combatCondition, crackling?.quality],
    ["conditions", false, "electrified"]);
  check("with no effects of its own",
    (crackling?.script ?? "x").split("\n")
      .filter(line => line.trim() && !line.trim().startsWith("#")), []);
  check("in the index", INDEX.traits.includes("conditions/crackling.dbu"), true);
  check("held, the Square is Electrified",
    qualitiesOf({ battlefield: { qualities: [] }, conditions: { crackling: 1 } }, null, getTrait),
    ["electrified"]);

  // No two files share an id: the lookup would hand back whichever loaded last. Read off
  // each file's own `id:` header, which is what the lookup is keyed on - not its name.
  const ids = INDEX.traits.map(file => {
    const text = fs.readFileSync(path.join(TRAITS, file), "utf8");
    return text.match(/^id:\s*(\S+)/m)?.[1] ?? file.split("/").pop().replace(/\.dbu$/, "");
  });
  check("no Trait id is used twice",
    ids.filter((id, i) => ids.indexOf(id) !== i), []);
}

// --- Elemental (Metal) -------------------------------------------------------------------------------
{
  const metal = PROFILES.elementalMetal;
  check("Metal is there, named as printed", metal?.label, "Elemental (Metal)");
  check("a Magic Profile, Lethal, at 8(T)",
    [metal.foundations, metal.damageCategory, metal.kiCostPerTier], [["magic"], "lethal", 8]);
  check("the Square becomes Metallic, for good - no mark, no clock",
    [metal.squareQuality, metal.squareMark, metal.onThreshold], ["metallic", undefined, undefined]);
  check("naming a Quality there is", getTrait(metal.squareQuality)?.envQuality, true);
  check("the AoE sentence is built: nothing waits", metal.needs ?? "", "");

  // Applied where the others are, off the same Damage.
  const apply = source(CHAT, "applyAttackDamage");
  check("the Damage step applies it",
    apply.includes("if (riders.squareQuality && !attackArea(attack)) await applySquareQuality(target, riders.squareQuality);"),
    true);
  check("inside the same guard as every other rider",
    apply.indexOf("if (riders.squareQuality && !attackArea(attack))") > apply.indexOf("if (attacker && (damage > 0) && !isAbsoluteMiss(own)) {"),
    true);

  const put = source(CHAT, "applySquareQuality");
  check("onto the list the player ticks",
    put.includes('await requestActorUpdate(target, { "system.battlefield.qualities": next });'), true);
  check("alone, where the Quality's file says so, and beside the others where not",
    put.includes("const next = alone ? [id] : [...new Set([...held, id])];")
      && put.includes("const alone = quality.appliedAlone === true;"), true);
  check("taking every mark that puts a Quality on the Square with it",
    put.includes("if ((Number(stacks) > 0) && getTrait(key)?.quality) await setCondition(target, key, 0);"),
    true);
  check("and naming no Quality itself", /"metallic"|"glass"|"aflame"/.test(put), false);

  // The floor the Hardness answers to is Metallic's own.
  check("Hardness Rank 3 is Metallic's floor", Number(getTrait("metallic").hardnessMin), 3);
}

// --- Elemental (Plantlife) ---------------------------------------------------------------------------
{
  const plant = PROFILES.elementalPlantlife;
  check("Plantlife is there, named as printed", plant?.label, "Elemental (Plantlife)");
  check("a Magic Profile, Standard, at 3(T)",
    [plant.foundations, plant.damageCategory, plant.kiCostPerTier], [["magic"], "standard", 3]);

  // Staggering Attack, granted, and nothing left to say is not automated.
  check("granting Staggering Attack", plant.grantsAdvantage, "staggering-attack");
  check("with nothing left waiting", plant.needs, undefined);
  const advantages = fs.readdirSync(path.join(TRAITS, "signature", "advantages"))
    .map(file => file.replace(/\.dbu$/, ""));
  check("every Advantage a Profile grants has a file",
    Object.entries(PROFILES).filter(([, p]) => p.grantsAdvantage
      && !advantages.includes(p.grantsAdvantage)).map(([id]) => id), []);

  // The Feature: the table places it, the card says what it is.
  check("the Feature it may make", plant.createsFeature, { hardnessRank: 1, quality: "splintering" });
  const { FEATURE_QUALITIES } = await import(modUrl("features.mjs"));
  check("named by a Feature Quality there is",
    FEATURE_QUALITIES.some(quality => quality.key === plant.createsFeature.quality), true);
  const note = source(CHAT, "featureNote");
  // Reinforced Plantlife adds its ranks to it.
  check("the card says it, by the Quality's own name",
    [note.includes("Feature: Hardness Rank ${made.hardnessRank + reinforced}"),
     note.includes("FEATURE_QUALITIES.find(entry => entry.key === made.quality)")], [true, true]);
  check("on the attack's own line", CHAT.includes("${featureNote(profileFor(attack), attack)}</span>"),
    true);
  check("and the picker says to place it yourself",
    MANEUVERS.includes("if (profile.createsFeature) {"), true);
}

// --- Staggering Attack --------------------------------------------------------------------------------
{
  const advantage = getTrait("staggering-attack");
  check("the Advantage is there, a Signature Advantage at 6 TP",
    [advantage?.kind, advantage?.side, Number(advantage?.tpCost)], ["signature", "advantages", 6]);
  check("in the index", INDEX.traits.includes("signature/advantages/staggering-attack.dbu"), true);
  check("worded as printed", printedLines(advantage.text), [
    "If you inflict Damage to an Opponent with this Attacking Maneuver, make a Might Clash "
      + "against your Opponent. If you win, they gain the Staggered Combat Condition until "
      + "the end of their turn."
  ]);

  const { staggers } = await import(modUrl("signature.mjs"));
  check("an attack carrying it staggers, one without does not",
    [staggers({ advantages: ["staggering-attack"] }), staggers({ advantages: ["knockback"] }),
     staggers({})], [true, false, false]);

  // Opened off Damage inflicted, beside Knockback, inside the same guard.
  const apply = source(CHAT, "applyAttackDamage");
  const guard = apply.indexOf("if ((damage > 0) && !isAbsoluteMiss(own)) {");
  const opened = apply.indexOf("if (foe && staggers(attack)) await openStagger(attack, attacker, target);");
  check("the Clash is opened off Damage inflicted, and not off an Absolute miss",
    (guard > 0) && (opened > guard), true);

  const open = source(CHAT, "openStagger");
  check("a Might Clash, carrying what it leaves",
    [open.includes("return postMightClash(attacker, target, {"),
     open.includes("stagger: { applied: false }")], [true, true]);
  check("settled where every Clash's payload is",
    CHAT.includes("if (clash.stagger && clash.result && !clash.stagger.applied) {"), true);

  const settle = source(CHAT, "settleStagger");
  check("only the winner staggers them",
    settle.includes('if (whoWonClash(clash.result) !== "challenger") {'), true);
  check("marked settled before anything else", settle.indexOf("applied: true")
    < settle.indexOf('setCondition(target, "staggered", 1)'), true);
  check("until the end of their turn - their clock, not the attacker's", [
    settle.includes("await lasting(target, {"),
    settle.includes("edge: EDGES.END,"),
    /next: true/.test(settle),
    /on: /.test(settle)
  ], [true, true, false, false]);
  check("Staggered is a Combat Condition there is", Boolean(getTrait("staggered")), true);
}

// --- Elemental (Poison) ------------------------------------------------------------------------------
{
  const venom = PROFILES.elementalPoison;
  check("Poison is there, named as printed", venom?.label, "Elemental (Poison)");
  check("a Magic Profile, Direct, at 8(T)",
    [venom.foundations, venom.damageCategory, venom.kiCostPerTier], [["magic"], "direct", 8]);
  check("Poisoned for a Threshold, and a Poisonous Square",
    [venom.onThreshold, venom.squareMark],
    [{ condition: "poisoned", stacks: 1 }, { condition: "tainted", stacks: 1 }]);
  check("the AoE sentence is built: nothing waits", venom.needs ?? "", "");

  const { qualitiesOf } = await import(modUrl("environments.mjs"));
  const tainted = getTrait("tainted");
  check("the mark is there, not a Combat Condition, naming Poisonous",
    [tainted?.kind, tainted?.combatCondition, tainted?.quality],
    ["conditions", false, "poisonous"]);
  check("with no effects of its own",
    (tainted?.script ?? "x").split("\n")
      .filter(line => line.trim() && !line.trim().startsWith("#")), []);
  check("in the index", INDEX.traits.includes("conditions/tainted.dbu"), true);
  check("held, the Square is Poisonous",
    qualitiesOf({ battlefield: { qualities: [] }, conditions: { tainted: 1 } }, null, getTrait),
    ["poisonous"]);

  // Treatment finds whoever Poisoned them by the clock on the other side - the same clock
  // `markUntilNextTurn` sets, with `on` naming the one it is about.
  const { whoInflicted } = await import(modUrl("durations.mjs"));
  const victim = { uuid: "Actor.victim", system: { timed: [] } };
  const poisoner = { uuid: "Actor.poisoner",
    system: { timed: [{ kind: "condition", key: "poisoned", edge: "end", edges: 2,
                        on: "Actor.victim", source: "Elemental (Poison)" }] } };
  globalThis.canvas = { tokens: { placeables: [{ actor: victim }, { actor: poisoner }] } };
  check("the Treatment Maneuver can name who Poisoned them",
    whoInflicted(victim, "condition", "poisoned"), "Actor.poisoner");
  delete globalThis.canvas;
  const { KINDS: DURATION_KINDS } = await import(modUrl("durations.mjs"));
  check("which is the kind of clock the rider sets", DURATION_KINDS.CONDITION, "condition");
}

// --- Elemental (Water) -------------------------------------------------------------------------------
{
  const water = PROFILES.elementalWater;
  check("Water is there, named as printed", water?.label, "Elemental (Water)");
  check("a Magic Profile, Direct, at 8(T)",
    [water.foundations, water.damageCategory, water.kiCostPerTier], [["magic"], "direct", 8]);
  check("Prone for a Threshold, with no clock, and a Bog under them",
    [water.onThreshold, water.squareMark],
    [{ condition: "prone", stacks: 1, untimed: true }, { condition: "flooded", stacks: 1 }]);
  check("the AoE sentence is built: nothing waits", water.needs ?? "", "");

  // No clock for an untimed Condition: the edge is null, and null sets none.
  const apply = source(CHAT, "applyAttackDamage");
  check("an untimed Threshold Condition is passed no edge",
    apply.includes('onThreshold.untimed ? null : "end"'), true);
  const mark = source(CHAT, "markUntilNextTurn");
  check("and no edge is no clock, after the stack is gained",
    mark.indexOf("if (!edge) return;") > mark.indexOf("gainCondition(target, key, stacks)"), true);
  check("every other Profile's Threshold Condition still has its clock",
    Object.entries(PROFILES).filter(([id, p]) => p.onThreshold?.untimed).map(([id]) => id),
    ["elementalWater"]);

  // The mark: an Environment the Square becomes, for as long as it is held.
  const flooded = getTrait("flooded");
  check("the mark is there, not a Combat Condition, becoming Bog",
    [flooded?.kind, flooded?.combatCondition, flooded?.becomes],
    ["conditions", false, "bog-environment"]);
  check("with no effects of its own",
    (flooded?.script ?? "x").split("\n")
      .filter(line => line.trim() && !line.trim().startsWith("#")), []);
  check("in the index", INDEX.traits.includes("conditions/flooded.dbu"), true);

  const { environmentIdOf, STANDARD_ENVIRONMENT } = await import(modUrl("environments.mjs"));
  const on = (pick, conditions = {}) => ({ battlefield: { environment: pick }, conditions });
  check("held, they are in the Bog, whatever they picked", [
    environmentIdOf(on("lava-environment", { flooded: 1 }), getTrait),
    environmentIdOf(on("underwater-environment", { flooded: 2 }), getTrait)
  ], ["bog-environment", "bog-environment"]);
  check("not held, they are in what they picked",
    environmentIdOf(on("lava-environment", { flooded: 0 }), getTrait), "lava-environment");
  check("and with no pick, the Standard one",
    environmentIdOf(on(""), getTrait), STANDARD_ENVIRONMENT);
  check("a mark with no `becomes` turns nothing",
    environmentIdOf(on("lava-environment", { ignited: 1, darkened: 1 }), getTrait),
    "lava-environment");

  // Run through the engine: Flooded on Standard ground is the Bog's effects, all of them.
  const plain = standing(0);
  const bog = (() => {
    const parent = new ActorStub({}, { strict: false });
    parent.items = [];
    const model = new DBUCharacterData({ powerLevel: 10, progression: progressionTo(10),
      battlefield: { environment: "bog-environment" } }, { parent, strict: false });
    parent.system = model;
    model.prepareBaseData?.();
    model.prepareDerivedData();
    return model;
  })();
  const flood = standing(0, { conditions: { flooded: 1 } });
  check("the Bog changes something to measure", plain.speed.normal !== bog.speed.normal, true);
  check("Flooded on Standard ground is the Bog to the engine",
    [flood.speed.normal, flood.speed.boosted], [bog.speed.normal, bog.speed.boosted]);
  check("and the pick is left alone", flood.battlefield.environment, "standard-environment");

  // Every reader asks the one function.
  for (const [name, text, call] of [
    ["breath", read("module", "breath.mjs"), "getTrait(environmentIdOf(actor.system, getTrait))"],
    ["model", read("module", "data", "actor-character.mjs"), "getTrait(environmentIdOf(this, getTrait))"],
    ["registry (Qualities)", REGISTRY, "getTrait(environmentIdOf(actor.system, getTrait))"],
    ["registry (Environment)", REGISTRY, "const id = environmentIdOf(actor.system, getTrait);"],
    ["sheet", SHEET, "const environmentHere = environmentIdOf(system, getTrait);"]
  ]) {
    check(`the ${name} asks which Environment they are in`, text.includes(call), true);
  }
  const ELSEWHERE = ["breath.mjs", "chat.mjs", "combat.mjs", "sheets/actor-character-sheet.mjs",
    "effects/registry.mjs", "data/actor-character.mjs"]
    .map(file => read("module", ...file.split("/"))).join("\n");
  check("and nothing reads the pick as if it were where they are",
    /getTrait\([^)]*battlefield\??\.environment/.test(ELSEWHERE), false);

  // Run: Underwater turned to Bog is somewhere to breathe, and back again is not.
  const { isUnbreathable } = await import(modUrl("breath.mjs"));
  const diver = conditions => ({ system: {
    battlefield: { environment: "underwater-environment", highEnvironment: 0 }, conditions } });
  check("under water there is nothing to breathe", isUnbreathable(diver({})), true);
  check("Flooded, it is a Bog, and they can breathe", isUnbreathable(diver({ flooded: 1 })), false);
  check("and when it runs out, the water again", isUnbreathable(diver({ flooded: 0 })), true);

  // The breath notices the Square changing under them, not only the pick.
  const COMBAT = read("module", "combat.mjs");
  check("the breath watches the marks as well as the pick",
    COMBAT.includes('(foundry.utils.getProperty(changes, "system.conditions") === undefined)'),
    true);
  check("and the tab says what they are in while it differs",
    TAB.includes("{{environmentNow.turned}}") && SHEET.includes("turned: (environmentHere !== standingOn)"),
    true);
}

// --- Elemental (Wind) --------------------------------------------------------------------------------
{
  const wind = PROFILES.elementalWind;
  check("Wind is there, named as printed", wind?.label, "Elemental (Wind)");
  check("a Magic Profile, Direct, at 4(T)",
    [wind.foundations, wind.damageCategory, wind.kiCostPerTier], [["magic"], "direct", 4]);
  check("what it borrows is named", [wind.borrowsCategory, wind.needs ?? null], ["slashing", null]);
  check("and nothing else is on it",
    Object.keys(wind).filter(key =>
      !["label", "foundations", "kiCostPerTier", "damageCategory", "text", "borrowsCategory"].includes(key)),
    []);
  check("its price where it is offered is the rule's",
    maneuverKiCost(getManeuver("basic-attack"), { profile: "elementalWind" },
      { system: { tierOfPower: 3, baseTierOfPower: 3, effects: { slots: {} } } }), 12);
}

// --- Entangled, the Net's mark ------------------------------------------------------------------------
{
  const mark = getTrait("entangled");
  check("the mark is there, not a Combat Condition", [mark?.kind, mark?.combatCondition],
    ["conditions", false]);
  check("in the index", INDEX.traits.includes("conditions/entangled.dbu"), true);

  // A point of Defense Value per stack - so three stacks, from a Tier 3 thrower, is three off.
  const plain = standing(0);
  const one = standing(0, { conditions: { entangled: 1 } });
  const three = standing(0, { conditions: { entangled: 3 } });
  check("the test character has a Defense Value to lose", plain.defenseValue > 3, true);
  check("a point off per stack", [plain.defenseValue - one.defenseValue,
    plain.defenseValue - three.defenseValue], [1, 3]);
}

// --- Beautified, the Beaut Bug's mark ----------------------------------------------------------------
{
  const mark = getTrait("beautified");
  check("the mark is there, not a Combat Condition, ended by hand",
    [mark?.kind, mark?.combatCondition, mark?.endedByHand], ["conditions", false, true]);
  check("in the index", INDEX.traits.includes("conditions/beautified.dbu"), true);

  // Two on every Persuasion Check - the roll, not the Bonus the sheet shows.
  const plain = standing(0);
  const pretty = standing(0, { conditions: { beautified: 1 } });
  check("two on a Persuasion Check",
    pretty.skills.persuasion.roll - plain.skills.persuasion.roll, 2);
  check("and the Bonus the sheet shows is left alone",
    pretty.skills.persuasion.bonus, plain.skills.persuasion.bonus);
  check("and no other Skill", pretty.skills.perception.roll, plain.skills.perception.roll);
}

console.log(`${failed} failing`);
process.exit(failed ? 1 : 0);
