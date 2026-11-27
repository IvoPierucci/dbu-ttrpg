/**
 * The No Effort Maneuver: its six effects, and the one this system does itself.
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
// The No Effort Maneuver: one of several small things, picked when it is used.
// =================================================================================================
const { loadManeuvers, getManeuver, MANEUVER_TYPES } = await import(modUrl("maneuvers.mjs"));
await loadManeuvers();
const { effortsOf, coreManeuverItems } = await import(modUrl("use-maneuver.mjs"));
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");
const USE = read("module", "use-maneuver.mjs");
const ITEM = read("module", "data", "item-maneuver.mjs");

{
  const effort = getManeuver("no-effort");
  check("the No Effort Maneuver is there", Boolean(effort), true);
  check("an Instant, once a Round, costing nothing, aimed at nobody",
    [effort?.type, effort?.usageLimit, effort?.actionCost, effort?.kiCost,
     effort?.requiresTarget, effort?.attacking],
    ["instant", { amount: 1, per: "round" }, 0, 0, false, false]);
  check("the entry, as printed", printedLines(getTrait("no-effort")?.text), [
    "No Effort Maneuver [1/Round]: Anything incredibly easy to do, taking almost no time.",
    "–Maneuver Type: Instant",
    "–Action Cost: N/A",
    "–KP Cost: N/A",
    "–Effect: This Maneuver covers a lot of different effects which can only be used during "
      + "your turn, which are listed below:",
    "",
    "* Dynamic. Anything that’s not covered here, your ARC may declare requires a No Effort "
      + "Maneuver, such as attempting to talk to an Opponent for a length of time that exceeds "
      + "typical combat banter but does not quite reach the level of a Combat Recovery.",
    "* Un/Sheathing a Weapon. Put away or draw a weapon.",
    "* Replace a Weapon. Replacing a Weapon you are holding with another Weapon you possess.",
    "* Drop/Pickup. Dropping or picking up an object.",
    "* Cancel Energy Charge. Stop suffering from the effects of the Energy Charge Maneuver, but "
      + "you lose all gathered Energy Charges from your chosen Attacking Maneuver.",
    "* Activate/Deactivate Integrated Items. You may make an Active Integrated Item you possess "
      + "become Inactive, and then choose one of your Inactive Integrated Items to become Active."
  ]);
  check("in the index, and a Core Maneuver every character is given",
    [INDEX.traits.includes("maneuvers/no-effort.dbu"),
     coreManeuverItems().some(item => item.system?.maneuverId === "no-effort")], [true, true]);

  // The six effects, read through the header's commas.
  check("its six effects, each by name",
    effortsOf(effort, true).map(entry => [entry.key, entry.label]),
    [["dynamic", "Dynamic"], ["sheathe", "Un/Sheathing a Weapon"], ["replace", "Replace a Weapon"],
     ["drop", "Drop/Pickup"], ["cancel-charge", "Cancel Energy Charge"],
     ["integrated", "Activate/Deactivate Integrated Items"]]);
  check("Cancel Energy Charge offered only while charging",
    effortsOf(effort, false).map(entry => entry.key).includes("cancel-charge"), false);
  const item = coreManeuverItems().find(entry => entry.system?.maneuverId === "no-effort");
  check("and carried onto the character's copy", [item?.system?.noEffort, item?.system?.efforts?.length],
    [true, 6]);
  check("which the Item keeps", [ITEM.includes("noEffort: new fields.BooleanField"),
    ITEM.includes("efforts: new fields.ArrayField")], [true, true]);

  const block = USE.slice(USE.indexOf("  if (maneuver.noEffort) {"), USE.indexOf("  if (maneuver.charge) {"));
  check("during their own turn only, when there is a Combat Encounter",
    block.includes("if (game.combat?.started && !isTheirTurn(actor)) {"), true);
  check("which effect is asked before anything is recorded",
    block.indexOf("await askEffort(actor, maneuver);") < block.indexOf("await recordManeuverUse(actor, maneuver);"),
    true);
  check("Cancel Energy Charge cancels it; every effect is said on the card",
    [block.includes('if (effort.key === "cancel-charge") await cancelCharge(actor);'),
     block.includes("postManeuver(actor, maneuver, { note: switched ? `${effort.label}: ${switched}.` : `${effort.label}.` })")], [true, true]);
  check("an Instant, so bound by what binds them", MANEUVER_TYPES.instant.respondsTo, ["standard"]);
}

console.log(`${failed} failing`);
process.exit(failed ? 1 : 0);
