/**
 * Adventure marks run through the whole engine: Hunger's three stages, and Stretched waiting while
 * Adventuring.
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

const { loadTraits } = await import(modUrl("effects/traits.mjs"));
const { default: DBUCharacterData } = await import(modUrl("data/actor-character.mjs"));
await loadTraits();

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

class ActorStub extends DataModel {
  static defineSchema() { return {}; }
}

// Built up, so nothing below bottoms out at nothing and passes by measuring nothing.
function progressionTo(powerLevel) {
  const rows = [{ lvl: 1, choice: "Skill Improvement", locked: true, attributes: {}, skillRanks: [] }];
  for (let lvl = 2; lvl <= powerLevel; lvl++) {
    rows.push({ lvl, choice: "Attribute Addition", locked: false,
      attributes: { force: 1, tenacity: 1, agility: 2, insight: 2 }, skillRanks: [] });
  }
  return rows;
}

function character({ conditions = {}, adventuring = false, powerLevel = 30 } = {}) {
  const parent = new ActorStub({}, { strict: false });
  parent.items = [];
  const model = new DBUCharacterData({ powerLevel, progression: progressionTo(powerLevel), conditions, adventuring },
    { parent, strict: false });
  parent.system = model;
  model.prepareBaseData?.();
  model.prepareDerivedData();
  return model;
}

// --- Hunger ----------------------------------------------------------------------------------------
{
  const fed = character();
  const bT = fed.baseTierOfPower;
  check("something to measure: Surgency, Strike and Soak Value all above 3(bT)",
    [fed.surgency > 3 * bT, fed.combat.strike > 3 * bT, fed.soakValue > 3 * bT], [true, true, true]);
  const at = stage => character({ conditions: { hunger: stage } });
  const hungry = at(1);
  const ravenous = at(2);
  const starving = at(3);
  check("Hungry: Surgency halved, nothing else",
    [hungry.surgency, hungry.combat.strike, hungry.soakValue],
    [Math.floor(fed.surgency / 2), fed.combat.strike, fed.soakValue]);
  check("Ravenous: Surgency quartered, Combat Rolls and Soak Value 1(bT) lower",
    [ravenous.surgency, fed.combat.strike - ravenous.combat.strike, fed.soakValue - ravenous.soakValue],
    [Math.floor(fed.surgency / 4), bT, bT]);
  check("Starving: Surgency 0, Combat Rolls and Soak Value 3(bT) lower",
    [starving.surgency, fed.combat.strike - starving.combat.strike, fed.soakValue - starving.soakValue],
    [0, 3 * bT, 3 * bT]);
}

// --- Stretched ------------------------------------------------------------------------------------
{
  const plain = character();
  const T = plain.tierOfPower ?? plain.baseTierOfPower;
  check("Stretched in a Combat Encounter: Combat Rolls 1(T) better",
    character({ conditions: { stretched: 1 } }).combat.strike - plain.combat.strike, T);
  check("and nothing while Adventuring",
    character({ conditions: { stretched: 1 }, adventuring: true }).combat.strike
      - character({ adventuring: true }).combat.strike, 0);
}

// --- Training Bonuses, run through the engine -----------------------------------------------------
{
  const plain = character();
  const bT = plain.baseTierOfPower;
  const T = plain.tierOfPower ?? bT;
  const held = key => character({ conditions: { [key]: 1 } });
  const energized = held("energizing-training");
  const { maneuverUsesLeft } = await import(modUrl("maneuvers.mjs"));
  const surge = { id: "surge", usageLimit: { amount: 1, per: "encounter" } };
  const usesLeft = (model, used = []) => maneuverUsesLeft({ system: { usedManeuvers: used, effects: model.effects } }, surge);
  check("Energizing: Surgency 2(bT) higher, and a Surge more each Encounter",
    [energized.surgency - plain.surgency, usesLeft(plain), usesLeft(energized), usesLeft(energized, ["encounter:surge"])],
    [2 * bT, 1, 2, 1]);
  const survival = held("survival-training");
  check("Survival: Soak 2(bT), Steadfast 1, and 2 more Maximum Life Points each Power Level",
    [survival.soakValue - plain.soakValue, survival.life.max - plain.life.max], [2 * bT, 2 * 30]);
  const speed = held("speed-training");
  check("Speed: Awareness and Defense Value 1(bT), Boosted Speed 3(bT)",
    [speed.awareness - plain.awareness, speed.defenseValue - plain.defenseValue,
     speed.speed.boosted - plain.speed.boosted], [bT, bT, 3 * bT]);
  check("Battle-Focused: Combat Rolls 1(bT)", held("battle-focused-training").combat.strike - plain.combat.strike, bT);
  check("Transformation: Stress Bonus 2", held("transformation-training").stressBonus - plain.stressBonus, 2);
  const sure = held("post-training-confidence");
  check("Post-Training Confidence: Saving Throws 1(bT), and no Impediment",
    [sure.savingThrows.corporeal.value - plain.savingThrows.corporeal.value, sure.effects.slots["condition.impediment"]],
    [bT, false]);
  check("Ki Control: no Drained", held("ki-control-training").effects.slots["condition.drained"], false);
}

// --- Reputation, kept by the schema ---------------------------------------------------------------
{
  const parent = new ActorStub({}, { strict: false });
  parent.items = [];
  const kept = new DBUCharacterData({ powerLevel: 5, progression: progressionTo(5), reputation: [
    { id: "r", kind: "faction", name: "Red Ribbon Army" },
    { id: "s", kind: "individual", name: "General Blue", faction: "r", affection: 9, alarm: -1 }] },
    { parent, strict: false }).toObject().reputation;
  const rich = new DBUCharacterData({ powerLevel: 5, progression: progressionTo(5), riches: 12 },
    { parent, strict: false }).toObject().riches;
  check("Riches kept, up to 10", [rich, new DBUCharacterData({ powerLevel: 5, progression: progressionTo(5) },
    { parent, strict: false }).toObject().riches], [10, 0]);
  check("Reputation kept: both start Neutral, and a Rating stays within 0~4",
    kept.map(entry => [entry.name, entry.kind, entry.faction, entry.affection, entry.alarm]),
    [["Red Ribbon Army", "faction", "", 2, 2], ["General Blue", "individual", "r", 4, 0]]);
}

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
