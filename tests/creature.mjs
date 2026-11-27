/**
 * Creatures (a Minion Race): Monstrous Vitality, Violent Mental State, Weaponized Vitality, Mind for Combat.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const ROOT = process.argv[2];
const APP = (process.env.FOUNDRY_APP || String.raw`C:\Program Files\Foundry Virtual Tabletop\resources\app`);
const appUrl = p => pathToFileURL(path.join(APP, p)).href;
const modUrl = p => pathToFileURL(path.join(ROOT, "module", p)).href;

globalThis.CONST = {};
globalThis.foundry = {};
await import(appUrl("common/primitives/_module.mjs"));
globalThis.foundry.utils = { ...await import(appUrl("common/utils/_module.mjs")) };
globalThis.foundry.data = await import(appUrl("common/data/_module.mjs"));
const { default: DataModel } = await import(appUrl("common/abstract/data.mjs"));
globalThis.foundry.abstract = { DataModel, TypeDataModel: DataModel };
globalThis.ui = { notifications: { warn: () => {}, error: () => {}, info: () => {} } };

const TRAITS = path.join(ROOT, "traits");
globalThis.foundry.utils.fetchJsonWithTimeout = async () =>
  JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));
globalThis.fetch = async url => {
  const file = path.join(TRAITS, String(url).replace("systems/dbu-ttrpg/traits/", ""));
  if (!fs.existsSync(file)) return { ok: false, status: 404, statusText: "missing" };
  return { ok: true, status: 200, text: async () => fs.readFileSync(file, "utf8") };
};

const { loadTraits } = await import(modUrl("effects/traits.mjs"));
const { default: DBUCharacterData } = await import(modUrl("data/actor-character.mjs"));
const ALLIES = await import(modUrl("allies.mjs"));
const TYPES = await import(modUrl("actor-types.mjs"));
await loadTraits();

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

/** What a model's parent has to be: a DataModel - the Actor, with its type. */
class ActorStub extends DataModel {
  static defineSchema() { return {}; }
}


const { getTrait } = await import(modUrl("effects/traits.mjs"));
const { compile } = await import(modUrl("effects/parser.mjs"));
const T = await import(modUrl("technique.mjs"));
const FP = await import(modUrl("full-power.mjs"));
const M = await import(modUrl("maneuvers.mjs"));

/** A Character with these Racial Traits on, prepared as Foundry prepares one - at that share of its Life Points where asked. */
function build(traits, { powerLevel = 10, lifeShare = 1 } = {}) {
  const parent = new ActorStub({}, { strict: false });
  parent.type = "character";
  parent.items = traits.map((id, n) => ({ id: `r${n}`, uuid: `A.r${n}`, type: "racial", name: getTrait(id).name,
    flags: { "dbu-ttrpg": { sourceId: id } }, system: { script: getTrait(id).script } }));
  parent.getFlag = () => undefined;
  parent.uuid = "Actor.alien";
  // Technique Points granted on the way: a Skill Improvement at Power Levels 1 and 2 (each row's grant derived from its choice).
  const progression = [1, 2].map(lvl => ({ lvl, stepType: "Skill Improvement", choice: "Skill Improvement" }));
  const make = life => {
    const model = new DBUCharacterData({ powerLevel, race: "alien", progression, ...(life === null ? {} : { life: { value: life } }) },
      { strict: false, parent });
    parent.system = model;
    model.prepareBaseData?.();
    model.prepareDerivedData();
    return model;
  };
  const first = make(null);
  // The same Actor again, so the early Threshold reads the Maximum it kept.
  return (lifeShare === 1) ? first : make(Math.floor(first.life.max * lifeShare));
}


const RACES = await import(modUrl("races.mjs"));
{
  const keep = foundry.utils.fetchJsonWithTimeout;
  foundry.utils.fetchJsonWithTimeout = async url => JSON.parse(read("races", String(url).split("/races/")[1]));
  await RACES.loadRaces();
  foundry.utils.fetchJsonWithTimeout = keep;
}

/** A Racial Trait's Item, as adding it makes one. */
const traitItem = (id, n) => ({ id: `r${n}`, uuid: `A.r${n}`, type: "racial", name: getTrait(id).name,
  flags: { "dbu-ttrpg": { sourceId: id } }, system: { script: getTrait(id).script, chosen: [] } });

/** A Creature with these Racial Traits, in these States, prepared - again at that share of its Life Points where asked. */
function creature(traits, { states = {}, lifeShare = 1 } = {}) {
  const parent = new ActorStub({}, { strict: false });
  parent.type = "character";
  parent.items = traits.map(traitItem);
  parent.getFlag = () => undefined;
  parent.uuid = "Actor.creature";
  const make = life => {
    const model = new DBUCharacterData({ powerLevel: 10, race: "creature", states, ...(life === null ? {} : { life: { value: life } }) },
      { strict: false, parent });
    parent.system = model;
    model.prepareBaseData?.();
    model.prepareDerivedData();
    return model;
  };
  const first = make(null);
  return (lifeShare === 1) ? first : make(Math.floor(first.life.max * lifeShare));
}
const add = (model, key) => Number(model.effects.slots[key]?.add) || 0;

// --- The Traits ---------------------------------------------------------------------------------------------------------------
{
  const row = id => { const t = getTrait(id); return [t.owner, t.category, t.importance, Number(t.order), compile(t.script).errors.length]; };
  check("the Creatures' four: Monstrous Vitality and Violent Mental State Primary, Weaponized Vitality and Mind for Combat Secondary - compiling",
    ["monstrous-vitality", "violent-mental-state", "weaponized-vitality", "mind-for-combat"].map(row),
    [["creature", "body", "primary", 1, 0], ["creature", "mind", "primary", 2, 0], ["creature", "body", "secondary", 3, 0],
     ["creature", "mind", "secondary", 4, 0]]);
  const blocks = id => compile(getTrait(id).script).program.blocks.filter(b => b.mode !== "passive")
    .map(b => `${b.mode}/${b.moment}${b.modifiers?.outOfSequence ? "+oos" : ""}`);
  check("a Monstrous and a Bestial Trait; Healing Surges out of sequence at Injured and as the Encounter begins; Surging, Feral; the Power Up "
    + "after a Healing Surge; Ki on entering any State",
    [getTrait("monstrous-vitality").grantsOther, blocks("monstrous-vitality"), blocks("violent-mental-state"), blocks("weaponized-vitality"),
     blocks("mind-for-combat")],
    [["monstrous", "bestial"], ["triggered/threshold+oos", "triggered/start-of-encounter+oos"], ["triggered/start-of-turn", "triggered/power"],
     ["triggered/healing-surge+oos"], ["triggered/state"]]);
}

// --- On a character ---------------------------------------------------------------------------------------------------------
{
  const plain = creature([]);
  const vital = creature(["monstrous-vitality"]);
  check("Monstrous Vitality (2): Life Points regained up to half the Maximum past it, rounded down - the Maximum alone without it",
    [plain.life.ceiling, vital.life.ceiling], [plain.life.max, vital.life.max + Math.floor(vital.life.max / 2)]);
  const calm = creature(["violent-mental-state", "mind-for-combat"]);
  const raging = creature(["violent-mental-state", "mind-for-combat"], { states: { raging: 1 } });
  const feral = creature(["violent-mental-state", "mind-for-combat"], { states: { feral: 1 } });
  check("Violent Mental State (1) and Mind for Combat (1): Raging or Feral - Wound 2(T), every Combat Roll's Critical Target 1 lower",
    // Against one in the same State without them - Raging has a Wound of its own.
    [[add(calm, "wound"), add(calm, "criticalTarget.combat")],
     [add(raging, "wound") - add(creature([], { states: { raging: 1 } }), "wound"), add(raging, "criticalTarget.combat")],
     [add(feral, "wound") - add(creature([], { states: { feral: 1 } }), "wound"), add(feral, "criticalTarget.combat")]],
    [[0, 0], [2 * raging.tierOfPower, -1], [2 * feral.tierOfPower, -1]]);
  const hurt = creature(["weaponized-vitality", "mind-for-combat"], { lifeShare: 0.2 });
  const well = creature(["weaponized-vitality", "mind-for-combat"]);
  const base = creature([], { lifeShare: 0.2 });
  check("below Injured: Surgency 4(T) (Weaponized Vitality), Soak and Defense 1(T) (Mind for Combat); the Wound by a quarter of the Surgency, "
    + "rounded up, either way",
    [hurt.surgency - base.surgency, add(hurt, "soakValue"), add(hurt, "defenseValue"), add(hurt, "wound"), add(well, "wound"),
     add(well, "soakValue")],
    [4 * hurt.tierOfPower, hurt.tierOfPower, hurt.tierOfPower, Math.ceil(hurt.surgency / 4), Math.ceil(well.surgency / 4), 0]);
}

// --- Wired --------------------------------------------------------------------------------------------------------------------
{
  const CH = read("module", "chat.mjs");
  check("wired: the Healing Surge, regaining by effects, the Minions' Recovery and the sheet's healing up to the ceiling; the Power Up offered",
    [CH.includes("const restored = Math.max(0, Math.min(ceiling ?? max, value + total) - value);"),
     CH.includes("Math.min(Number(pool.ceiling ?? pool.max) || 0, (Number(pool.value) || 0) + life)"),
     read("module", "effects", "moments-runtime.mjs").includes("cap: a => a.system.life.ceiling ?? a.system.life.max },"),
     read("module", "combat.mjs").includes("Math.min(Number(life.ceiling ?? life.max) || 0, (Number(life.value) || 0) + back)"),
     read("module", "sheets", "actor-character-sheet.mjs").includes("Math.min(life.ceiling ?? life.max, life.value + roll.total)"),
     CH.includes("return offerPowerOrTransform(actor, \"Weaponized Vitality - a Healing Surge used\", [\"power-up\"]);")],
    [true, true, true, true, true, true]);
}

console.log(failed ? `\n${failed} failing` : "\n0 failing");
