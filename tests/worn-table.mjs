/**
 * The Gear tab's table of what is worn (the user's, 2026-10-30, from their sheet): a row a Layer - the piece, its Category,
 * what that gives (the Top Layer's alone applies), its Break Value, Doff Bonus, whether it counts toward the Penalty from
 * Layers, its Qualities - the Integrated pieces, and the Accessories with their text, hidden at will. The sheet's own
 * builder run over real pieces, and the template rendered with what it builds.
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
const GEAR = await import(modUrl("gear.mjs"));
const { isIntegrated } = await import(modUrl("integrated.mjs"));
await loadTraits();

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

let made = 0;
const flags = {};
const asItem = data => {
  made++;
  const id = `i${made}`;
  return { ...data, id, uuid: `Actor.a.Item.${id}`, type: "gear",
    getFlag: (scope, key) => flags[id]?.[key] };
};
const piece = ({ name, category, grade = 3, layer = "", equipped = true, integrated = false, qualities = [] }) => {
  const data = GEAR.craftedItemFrom("apparel", null, getTrait);
  return asItem({ ...data, name, system: { ...data.system, equipped, layer, integrated,
    crafted: { ...data.system.crafted, effects: null, category, grade, qualities } } });
};
const accessory = (id, { integrated = false, equipped = true } = {}) => {
  const data = GEAR.gearItemFrom(getTrait(id), null);
  return asItem({ ...data, system: { ...data.system, equipped, integrated } });
};

// The sheet's builder, cut out and run as the sheet runs it.
const SHEET = fs.readFileSync(path.join(ROOT, "module", "sheets", "actor-character-sheet.mjs"), "utf8");
const from = SHEET.indexOf("  #wornTable(gearItems) {");
const to = SHEET.indexOf("  /** An Accessory's text on the Gear tab's table", from);
const body = SHEET.slice(SHEET.indexOf("{", from) + 1, SHEET.lastIndexOf("}", to)).replaceAll("this.actor", "actor");
const wornTable = new Function("actor", "gearItems", "getTrait", "printedLines", "topLayerPiece", "apparelPenaltyPieces",
  "categoryApplies", "craftedReading", "doffBonusFor", "qualityEntries", "wornAccessories", "ACCESSORIES_WORN",
  "APPAREL_LAYERS", "isIntegrated", "isAccessory", body);
const run = (items, baseTier = 3) => wornTable({ system: { baseTierOfPower: baseTier }, items }, items, getTrait, printedLines,
  GEAR.topLayerPiece, GEAR.apparelPenaltyPieces, GEAR.categoryApplies, GEAR.craftedReading, GEAR.doffBonusFor,
  GEAR.qualityEntries, GEAR.wornAccessories, GEAR.ACCESSORIES_WORN, GEAR.APPAREL_LAYERS, isIntegrated, GEAR.isAccessory);

const armor = piece({ name: "Saiyan Battle Armor", category: "armor", layer: "top",
  qualities: [{ id: "dense-armor", slots: 1, choice: "" }] });
const weights = piece({ name: "Training Weights", category: "weights", layer: "middle" });
const plating = piece({ name: "Plating", category: "armor", integrated: true });
const gloves = accessory("armored-gloves");
const worn = run([armor, weights, plating, gloves]);

check("a row a Layer, top down, the piece on each - nothing on the Bottom",
  worn.layers.map(layer => [layer.label, layer.piece?.name ?? null]),
  [["Top Layer", "Saiyan Battle Armor"], ["Middle Layer", "Training Weights"], ["Bottom Layer", null]]);
// Standard's 2(bT) and Dense Armor's 1(bT) at base Tier 3 is 9; Weights' Standard 2(bT) is 6.
// Every Category on any Layer now but Armor's and Combat Clothing's, the Top's alone (the user's): the Middle's Weights apply.
check("each Category's Benefit at its Apparel Bonus - Armor on top and Weights in the Middle both applying",
  worn.layers.slice(0, 2).map(layer => [layer.piece.category, layer.piece.benefit, layer.piece.applies]),
  [["Armor", "DR +9", true], ["Weights", "Rolls -6", true]]);
check("its Break Value left of its most, its Doff Bonus, whether it counts, its Qualities",
  [worn.layers[0].piece.bv, worn.layers[0].piece.doff, worn.layers[0].piece.counts, worn.layers[0].piece.qualities],
  ["3/3", 9, true, "Dense Armor"]);
// Two counted, the first free: one piece's worth, 1/2 of base Tier 3 rounded up.
check("the Penalty from Layers: a piece after the first, 1/2 the base Tier rounded up",
  [worn.penalty, run([armor]).penalty], [2, 0]);
check("the Integrated piece apart, its Benefit always, Active as it is - not counted",
  worn.integrated.map(row => [row.name, row.benefit, row.applies, row.active, row.counts]),
  [["Plating", "DR +6", true, true, false]]);
// Active Integrated Apparel's Category stacks with what is worn (the rules' Integrated text): an Integrated Armor besides a worn
// Armor, an Integrated Combat Clothing besides a worn one - and the worn one still the Top, whatever Layer the Integrated says.
const gi = piece({ name: "Integrated Gi", category: "combat-clothing", integrated: true, layer: "top" });
const fightingTop = piece({ name: "Fighting Gi", category: "combat-clothing", layer: "middle" });
check("an Active Integrated piece's Category besides the worn one's of the same Category; the worn one the Top",
  [run([armor, plating]).layers[0].piece.applies, run([armor, plating]).integrated[0].applies,
   run([fightingTop, gi]).layers[1].piece.applies, run([fightingTop, gi]).integrated[0].applies,
   GEAR.topLayerPiece([fightingTop, gi])?.name, GEAR.topLayerPiece([gi])?.name],
  [true, true, true, true, "Fighting Gi", "Integrated Gi"]);
check("the Accessories worn, with their text; how many of the two",
  [worn.accessories.map(row => [row.name, row.hidden, row.lines.length > 0]), worn.accessoriesWorn, worn.accessoriesMax],
  [[["Armored Gloves", false, true]], 1, 2]);
flags[gloves.id] = { hideText: true };
check("its text hidden once asked",
  run([armor, gloves]).accessories.map(row => row.hidden), [true]);
const standard = piece({ name: "Gi", category: "standard-clothing", layer: "top" });
const fightingGi = piece({ name: "Fighting Gi", category: "combat-clothing", layer: "middle" });
check("Combat Clothing under the Top Layer inactive, Weights there active",
  run([armor, fightingGi]).layers[1].piece.applies, false);
// A Jacket over Armor (the user's): the Armor under it still gives its own, the Jacket's own too.
const armorUnder = piece({ name: "Battle Armor", category: "armor", layer: "middle" });
const jacket = piece({ name: "Jacket", category: "standard-clothing", layer: "top", qualities: [{ id: "jacket", slots: 1, choice: "" }] });
const plain = piece({ name: "Shirt", category: "standard-clothing", layer: "top" });
check("Armor under a Jacket still applies; under a piece that is not worn over Armor, not",
  [run([armorUnder, jacket]).layers[1].piece.applies, run([armorUnder, plain]).layers[1].piece.applies], [true, false]);
check("Standard Clothing on top: its Benefit said, and not counted",
  [run([standard, weights]).layers[0].piece.benefit, run([standard, weights]).layers[0].piece.counts,
   run([standard, weights]).penalty], ["No Apparel Penalty", false, 0]);

// The template, rendered with what the builder made.
const require = createRequire(`${(process.env.FOUNDRY_APP || (process.env.FOUNDRY_APP || String.raw`C:\Program Files\Foundry Virtual Tabletop\resources\app`))}/package.json`);
const Handlebars = require("handlebars");
const GEAR_HBS = fs.readFileSync(path.join(ROOT, "templates", "parts", "actor-gear.hbs"), "utf8");
const section = GEAR_HBS.slice(GEAR_HBS.indexOf('<section class="panel dbu-worn">'),
  GEAR_HBS.indexOf("</section>", GEAR_HBS.indexOf('<section class="panel dbu-worn">')) + 10);
flags[gloves.id] = {};
const html = Handlebars.compile(section)({ worn: run([armor, weights, plating, gloves]) });
check("drawn above the lists: the Layers, the Weights not struck, the empty Layer, the penalty, no Layer marked inactive",
  [GEAR_HBS.indexOf('<section class="panel dbu-worn">') < GEAR_HBS.indexOf('data-section="gearBasic"'),
   /<td class="dbu-worn-inactive"><s>Rolls -6<\/s><\/td>/.test(html), html.includes("Nothing worn"),
   /Penalty from Layers <b>-2<\/b>/.test(html), (html.match(/\(inactive Benefit\)/g) ?? []).length],
  [true, false, true, true, 0]);
check("the Integrated row's Active box switching it, and the Accessory's Hide button",
  [/class="dbu-worn-active on" data-action="switchIntegrated"/.test(html),
   /class="dbu-worn-hide" data-action="toggleGearText"[\s\S]*?>Hide<\/button>/.test(html),
   SHEET.includes("toggleGearText: DBUCharacterSheet._onToggleGearText,")],
  [true, true, true]);

console.log(failed ? `\n${failed} failing` : "\n0 failing");
process.exit(failed ? 1 : 0);
