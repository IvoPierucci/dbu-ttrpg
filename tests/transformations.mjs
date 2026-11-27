/**
 * Transformations (the plan, approved 2026-11-19): their folders read, their Aspects put together by one function, their
 * Attribute Modifier Bonuses, their Traits applying only as the rules and the user's rulings say - and nothing in module/ or
 * templates/ naming one.
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

// Every warning the loader gives - a Transformation's id clashing with another file's is one.
const warnings = [];
const warn = console.warn;
console.warn = (...args) => { warnings.push(args.join(" ")); };

const { loadTraits, getTrait, traitsOfKind, transformationPlace } = await import(modUrl("effects/traits.mjs"));
const { default: DBUCharacterData } = await import(modUrl("data/actor-character.mjs"));
const { default: DBUTransformationData } = await import(modUrl("data/item-transformation.mjs"));
const T = await import(modUrl("transformations.mjs"));
const { traitAside } = await import(modUrl("aside.mjs"));
await loadTraits();
console.warn = warn;

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

// --- The folders -----------------------------------------------------------------------------------------------------------

check("a Transformation's own file", transformationPlace("transformations/forms/alternate/super-saiyan-1/super-saiyan-1.dbu".split("/")),
  { kind: "transformations", owner: null, transformation: "super-saiyan-1", folder: "forms/alternate" });
check("its Trait", transformationPlace("transformations/awakenings/zenkai/traits/saiyan-spirit.dbu".split("/")),
  { kind: "transformations", owner: "zenkai", transformation: "zenkai", folder: "awakenings" });
check("its Unique Ability, as one anywhere", transformationPlace("transformations/awakenings/spirit-control/unique/gigantification.dbu".split("/")),
  { kind: "unique", owner: null, transformation: "spirit-control", folder: "awakenings" });
check("an Advancement of it, in its Unique Ability's folder",
  transformationPlace("transformations/awakenings/spirit-control/unique/instant-transmission/combat-transmitter.dbu".split("/")),
  { kind: "unique", owner: "instant-transmission", transformation: "spirit-control", folder: "awakenings" });
check("any other file is not one", transformationPlace("races/saiyan/saiyan-heritage.dbu".split("/")), null);

const files = T.transformationFiles();
check("the first group, all 57, read (Superior Super Saiyan and Time-Skipper added 2026-11-21, Boiling Rage, Steel Frame and Super Kaioken 2026-11-26, Unkillable Majin 2026-11-27)", files.length, 57);
check("no id defined twice (no Transformation's clashing with another file's)",
  warnings.filter(each => /defined more than once|has no id|folder this system does not know/.test(each)), []);
check("each one's type from its header or folder",
  Object.fromEntries(["zenkai", "kaioken", "super-saiyan-1", "full-power-super-saiyan", "legendary-evolved"].map(id => [id, T.kindOf(T.transformationFile(id))])),
  { zenkai: "awakening", kaioken: "enhancement", "super-saiyan-1": "form", "full-power-super-saiyan": "form", "legendary-evolved": "evolved" });
check("a Form's Form Type", ["super-saiyan-1", "full-power-super-saiyan"].map(id => T.formTypeOf(T.transformationFile(id))),
  ["alternate", "legendary"]);
check("every one has its page's words and at least one Trait",
  files.filter(file => !String(file.text ?? "").includes("Racial Requirement") && !String(file.text ?? "").includes("Evolved Stage Type")
    || !T.traitFilesOf(file).length).map(file => file.id), []);
check("Super Saiyan 1's Traits, in order", T.traitFilesOf(T.transformationFile("super-saiyan-1")).map(t => [t.name, t.slot, t.mastery ?? 0]),
  [["S-Cells", "trait", 0], ["Golden Power", "trait", 0], ["This is a Super Saiyan", "mastery", 1]]);
check("an Awakening's Traits by their Stacks", T.traitFilesOf(T.transformationFile("zenkai")).map(t => [t.name, t.stacks ?? 0]),
  [["Saiyan Spirit", 0], ["Warrior's Determination", 2], ["On the Brink", 3]]);
check("a [Permanent] effect and a [Constant] one, by number", [getTrait("pure-form-erratic-majin").permanent, getTrait("drunken-fist-power-of-the-bottle").constant],
  [3, 1]);
check("Traits of which one is chosen keep their group", T.traitFilesOf(T.transformationFile("full-power-super-saiyan")).filter(t => t.group).length, 7);

// --- Variants ----------------------------------------------------------------------------------------------------------------

const names = id => T.traitFilesFor(T.transformationFile(id)).map(t => t.name);
check("Evil Saiyan: Evil Aura's Power of Evil inherited, Villainous Form replaced where it stood, its own Burst Limit and Mastery",
  names("evil-saiyan"), ["Dark Saiya Power", "Power of Evil", "Aura Expansion", "Overwhelming Evil Power", "Focused Evil", "Evil of Legend"]);
check("Seething Fury (Peaked): Explosive Fury inherited, no Mastery Trait of Enraged's", names("seething-fury"),
  ["Explosive Fury", "That Actually Hurt!", "You Must Die by My Hand!"]);
check("Great Namekian: Accelerated Growth inherited", names("great-namekian"),
  ["Accelerated Growth", "Namekian Titan", "Giant's Vantage", "Dragon-Sized"]);
check("Feral Fist: Unpredictable Combat inherited", names("feral-fist"), ["Mad Dog Attack", "Unpredictable Combat", "Unforeseen Ferocity"]);

// --- Aspects -----------------------------------------------------------------------------------------------------------------

check("an Aspect as a page writes it", ["Growth (LV3)", "Rampaging (LV G)", "Growth (Level G)", "Draining 2", "Enhanced Save (Impulsive/Corporeal)",
  "-Draining", "+Natural (LV1)", "Variant (Evil Aura)"].map(T.parseAspect),
  [{ id: "growth", name: "Growth", level: "3", params: [], sign: 0 }, { id: "rampaging", name: "Rampaging", level: "G", params: [], sign: 0 },
    { id: "growth", name: "Growth", level: "G", params: [], sign: 0 }, { id: "draining", name: "Draining", level: "2", params: [], sign: 0 },
    { id: "enhanced-save", name: "Enhanced Save", level: null, params: ["Impulsive", "Corporeal"], sign: 0 },
    { id: "draining", name: "Draining", level: null, params: [], sign: -1 }, { id: "natural", name: "Natural", level: "1", params: [], sign: 1 },
    { id: "variant", name: "Variant", level: null, params: ["Evil Aura"], sign: 0 }]);
check("a list split outside brackets", T.parseAspects("Enhanced Save (Impulsive/Corporeal), Raging, Draining (LV1)").map(a => a.id),
  ["enhanced-save", "raging", "draining"]);
check("every Aspect named by the first group has its file",
  [...new Set(files.flatMap(file => T.parseAspects(file.aspects).map(a => a.id)))].filter(id => !T.aspectFile(id)), []);
check("an Aspect's file is not a State's of the same name", [T.aspectFile("raging")?.kind, getTrait("raging")?.kind], ["aspects", "states"]);

check("the Aspects only their Transformation's own kept off the Active Aspects (the user's: Peaked, Pinnacle, Graded, Heartbeat)",
  ["peaked", "pinnacle", "graded", "heartbeat", "super-saiyan-form", "straining"].map(id => T.aspectFile(id)?.bar !== false), [false, false, false, false, true, true]);
check("and the sheet leaves them out of the bar", fs.readFileSync(path.join(ROOT, "module", "sheets", "actor-character-sheet.mjs"), "utf8")
  .includes("aspects: combineAspects(this.actor).filter(aspect => aspect.file?.bar !== false)"), true);

// --- A character -------------------------------------------------------------------------------------------------------------

class ActorStub extends DataModel {
  static defineSchema() { return {}; }
}
let ids = 0;
function transformation(id, system = {}, sort = 0) {
  const file = T.transformationFile(id);
  const model = new DBUTransformationData({ transformationId: id, ...system }, { strict: false });
  return { id: `t${++ids}`, name: file.name, type: "transformation", sort: sort || ids, uuid: `Actor.me.Item.t${ids}`, flags: {},
    system: model };
}
function traitItem(owner, traitId) {
  const file = getTrait(traitId);
  return { id: `r${++ids}`, name: file.name, type: "racial", uuid: `Actor.me.Item.r${ids}`, flags: { "dbu-ttrpg": { sourceId: traitId } },
    system: { transformation: owner.id, script: file.script, chosen: [] } };
}
function progressionTo(powerLevel) {
  const rows = [{ lvl: 1, choice: "Skill Improvement", locked: true, attributes: {}, skillRanks: ["perception", "perception"] }];
  for (let lvl = 2; lvl <= powerLevel; lvl++) rows.push({ lvl, choice: "Attribute Addition", locked: false, attributes: { insight: 1, agility: 1 }, skillRanks: [] });
  return rows;
}
function holding(items, { powerLevel = 12 } = {}) {
  const parent = new ActorStub({}, { strict: false });
  parent.items = items;
  for (const item of items) item.parent = parent;
  parent.uuid = "Actor.me";
  const model = new DBUCharacterData({ powerLevel, progression: progressionTo(powerLevel) }, { parent, strict: false });
  parent.system = model;
  model.prepareBaseData?.();
  model.prepareDerivedData();
  return parent;
}
const partsOf = (actor, key) => (actor.system.effects.slots[key]?.parts ?? []).map(part => [part.source ?? part.label ?? part.sourceName, part.value]);

// Bonuses.
const kaioken = transformation("kaioken", { active: true, grade: 3 });
check("Kaioken's Grade 3 sets its AG/FO/MA (its table's '*')", Object.fromEntries(Object.entries(T.bonusesOf(kaioken)).map(([k, b]) => [k, T.bonusWritten(b)])),
  { agility: "2(T)", force: "2(T)", magic: "2(T)" });
check("Lightspeed Mode's G(T) at Grade 2, its AG from its table", Object.fromEntries(Object.entries(T.bonusesOf(transformation("lightspeed-mode", { grade: 2 })))
  .map(([k, b]) => [k, T.bonusWritten(b)])), { agility: "3(T)", force: "2(T)", magic: "2(T)" });
check("an Awakening's bonuses once a Stack", Object.fromEntries(Object.entries(T.bonusesOf(transformation("spirit-control", { stacks: 2 })))
  .map(([k, b]) => [k, T.bonusWritten(b)])), { agility: "2", force: "2", insight: "2", magic: "2" });
check("Higher Scales: +1(T) each but SC/IN/PE; Prelude -1(T), never under 1(T)",
  Object.fromEntries(Object.entries(T.bonusesOf(transformation("super-saiyan-1", { scales: 2, prelude: true }))).map(([k, b]) => [k, T.bonusWritten(b)])),
  { agility: "2(T)", force: "2(T)", tenacity: "2(T)", insight: "1(T)", magic: "2(T)" });

// Aspects put together.
const ssj1 = transformation("super-saiyan-1", { active: true });
const asOne = T.combineAspects({ items: [ssj1, kaioken] });
const aspect = id => asOne.find(a => a.id === id);
check("Enhanced Save's Saves put together (Impulsive/Corporeal and Impulsive)", aspect("enhanced-save").params, ["Impulsive", "Corporeal"]);
check("an Aspect without levels once, from both", [aspect("glowing").level, [...aspect("glowing").from].sort()], [null, ["Kaioken", "Super Saiyan 1"]]);
check("High Speed once, from both that have it", T.combineAspects({ items: [ssj1, kaioken, transformation("lightspeed-mode", { active: true })] })
  .find(a => a.id === "high-speed").from, ["Kaioken", "Lightspeed Mode"]);
const ssj2 = transformation("super-saiyan-2", { active: true });
check("levels added between Transformations (Draining 1 + 2)", T.combineAspects({ items: [ssj1, ssj2] }).find(a => a.id === "draining").level, 3);
check("a level written G is the Grade (Evil Aura's Rampaging at Grade 2)",
  T.combineAspects({ items: [transformation("evil-aura", { active: true, grade: 2 })] }).find(a => a.id === "rampaging").level, 2);
check("capped at the Aspect's maximum (Growth 3 + 3)",
  T.combineAspects({ items: [transformation("oozaru", { active: true }), transformation("giant-form", { active: true, grade: 3 })] }).find(a => a.id === "growth").level, 3);
check("none from one not in use", T.combineAspects({ items: [transformation("super-saiyan-1")] }), []);
check("an Aspect's script with its Saves written in", T.aspectScript(aspect("enhanced-save")).split("\n").filter(l => l.includes("save")),
  ["save.impulsive += 1(T);", "save.corporeal += 1(T);"]);
check("High Speed's script with the highest AG of those it came from", T.aspectScript(aspect("high-speed")).includes("speed.all += 2(T);"), true);
check("aspectLevel and hasAspect", [T.aspectLevel({ items: [ssj1, ssj2] }, "Draining"), T.hasAspect({ items: [ssj1] }, "raging"),
  T.hasAspect({ items: [ssj1] }, "bulky")], [3, true, false]);

// Prepared: in the hovers, by name.
const prepared = holding([transformation("super-saiyan-1", { active: true })]);
check("its bonuses named by the Transformation", partsOf(prepared, "agility.mod").map(p => p[0]), ["Super Saiyan 1"]);
check("an Aspect named by itself and what it came from", partsOf(prepared, "save.impulsive").map(p => p[0]), ["Enhanced Save (Super Saiyan 1)"]);
check("not in use, nothing", partsOf(holding([transformation("super-saiyan-1")]), "agility.mod"), []);
check("no errors gathering them", (prepared.system.effects.errors ?? []).filter(e => /Super Saiyan|Aspect|Enhanced|Raging/.test(String(e?.message ?? e))), []);

// --- Its Traits --------------------------------------------------------------------------------------------------------------

const off = transformation("super-saiyan-1");
const offPure = transformation("pure-form");
const sCells = traitItem(offPure, "pure-form-erratic-majin");
const golden = traitItem(off, "super-saiyan-1-golden-power");
const mastery = traitItem(off, "super-saiyan-1-this-is-a-super-saiyan");
check("outside it: set aside, save one with a [Permanent] effect", [traitAside(golden, [off, golden]), traitAside(sCells, [offPure, sCells])],
  ["outside", ""]);
const program = { blocks: [{ index: 1, modifiers: { effect: 1 } }, { index: 2, modifiers: { effect: 3 } }] };
check("outside it: of that one, its [Permanent] effect alone", T.transformationTraitProgram(sCells, program, [offPure, sCells]).blocks.map(b => b.index), [2]);
// [Permanent, Option] keeps the choice, its [Passive] effects only in it (the user's, 2026-11-21) - Back to Basics (2) keeps them outside.
{
  const ss1 = transformation("super-saiyan-1");
  const cells = traitItem(ss1, "super-saiyan-1-s-cells");
  const fpss = transformation("full-power-super-saiyan", { active: true });
  const basics = traitItem(fpss, "full-power-super-saiyan-back-to-basics");
  check("S-Cells outside Super Saiyan 1: set aside - but beside Back to Basics in use, its Option (3) kept",
    [traitAside(cells, [ss1, cells]), traitAside(cells, [ss1, cells, fpss, basics]),
     T.transformationTraitProgram(cells, program, [ss1, cells, fpss, basics]).blocks.map(b => b.index)], ["outside", "", [2]]);
}
const on = transformation("super-saiyan-1", { active: true });
const onMastery = traitItem(on, "super-saiyan-1-this-is-a-super-saiyan");
check("in it: a Mastery Trait wants its Mastery", [traitAside(onMastery, [on, onMastery]),
  traitAside(onMastery, [Object.assign(on, { system: new DBUTransformationData({ transformationId: "super-saiyan-1", active: true, mastery: 1 }, { strict: false }) }), onMastery])],
  ["mastery", ""]);
const lower = transformation("super-saiyan-1");
const upper = transformation("super-saiyan-2", { active: true });
const inherited = traitItem(lower, "super-saiyan-1-golden-power");
const lowerMastery = traitItem(Object.assign(lower, { system: new DBUTransformationData({ transformationId: "super-saiyan-1", mastery: 1 }, { strict: false }) }),
  "super-saiyan-1-this-is-a-super-saiyan");
check("a higher Stage in use: the lower Stage's Traits apply, not its Mastery Traits",
  [traitAside(inherited, [lower, upper, inherited]), traitAside(lowerMastery, [lower, upper, lowerMastery])], ["", "mastery"]);
const zenkai = transformation("zenkai", { stacks: 1 });
check("an Awakening's: always, but those of more Stacks than it has",
  [traitAside(traitItem(zenkai, "zenkai-saiyan-spirit"), [zenkai]), traitAside(traitItem(zenkai, "zenkai-warriors-determination"), [zenkai])], ["", "stacks"]);
const fpssj = transformation("full-power-super-saiyan");
check("a Legendary Form's Legendary Trait: always", traitAside(traitItem(fpssj, "full-power-super-saiyan-true-power-of-the-saiyan-race"), [fpssj]), "");
const evil = transformation("evil-saiyan", { active: true });
check("a Transcendent Trait only Transcended", traitAside(traitItem(evil, "evil-saiyan-evil-of-legend"), [evil]), "outside");
check("its Transformation gone: set aside", traitAside(traitItem({ id: "gone" }, "zenkai-saiyan-spirit"), []), "transformation");
check("a Trait of a Transformation not had is not among the Racial Traits had",
  holding([off, golden]).system.racialTraits.includes("super-saiyan-1-golden-power"), false);
// --- The tab, drawn with Foundry's own Handlebars ----------------------------------------------------------------------------

{
  const { createRequire } = await import("node:module");
  const require = createRequire(`${(process.env.FOUNDRY_APP || (process.env.FOUNDRY_APP || String.raw`C:\Program Files\Foundry Virtual Tabletop\resources\app`))}/package.json`);
  const Hbs = require("handlebars");
  Hbs.registerHelper("checked", value => (value ? "checked" : ""));
  const source = fs.readFileSync(path.join(ROOT, "templates", "parts", "actor-transformations.hbs"), "utf8");
  const template = Hbs.compile(source);
  const bonus = (label, value) => ({ label, value: value ? `+${value}` : "+0", up: Boolean(value) });
  const bonuses = values => ["AG", "FO", "TE", "SC", "IN", "MA", "PE"].map((label, at) => bonus(label, values[at]));
  const rows = [
    { line: "Super Saiyan Line", race: "Saiyan" },
    { id: "t1", name: "Super Saiyan 1", kind: "form", inUse: true, active: true, open: true, facts: ["Stage 1"], grades: 0, tier: "2+",
      stress: "12", mastery: 1, masteryMax: 1, bonuses: bonuses(["1(T)", "1(T)", "1(T)", "", "1(T)", "1(T)", ""]),
      evolved: [{ name: "Full Power", active: true }], aspects: [{ label: "Raging" }, { label: "Draining 1" }],
      traits: [{ name: "S-Cells", note: "", lines: [{ html: "S-Cells: The latent power" }] },
        { name: "This is a Super Saiyan", note: "Mastery 1", off: false, lines: [{ html: "This is a Super Saiyan: Your comfort" }] }] },
    { id: "t2", name: "Super Saiyan 2", kind: "form", facts: ["Stage 2"], tier: "3+", stress: "16", mastery: 0, masteryMax: 2, overMastery: false,
      bonuses: bonuses(["2(T)"]), evolved: [], aspects: [], traits: [{ name: "Sparking Momentum", note: "missing Mastery 1", off: true, lines: [] }],
      racialUnmet: "not a Saiyan", prerequisite: "Fully Mastered Super Saiyan 1" }
  ];
  const tab = section => ({ aspects: [{ label: "Raging", from: "Super Saiyan 1" }], stressBonus: 14,
    sections: [{ key: "awakening", label: "Awakenings", count: 1, active: section === "awakening" },
      { key: "form", label: "Forms", count: 2, active: section === "form" }],
    rows, traitGroups: [{ label: "Awakenings", entries: [{ item: { id: "r1", name: "Saiyan Spirit" }, from: "Zenkai", lines: [], triggered: [] }] },
      { label: "Forms", entries: [{ item: { id: "r2", name: "Power to the Limit" }, from: "Full Power", lines: [], triggered: [] }] }],
    constant: [], traitCount: 2 });
  const html = template({ tabs: { transformations: { cssClass: "active" } }, editable: true, openSections: {}, transformationsTab: tab("form") });
  const li = id => html.slice(html.indexOf(`data-tf-id="${id}"`), html.indexOf("</li>", html.indexOf(`data-tf-id="${id}"`)));
  check("the tab drawn: a section a type had, with its count", [...html.matchAll(/data-key="(\w+)">([^<]+)<b>(\d+)<\/b>/g)].map(m => [m[1], m[2], m[3]]),
    [["awakening", "Awakenings", "1"], ["form", "Forms", "2"]]);
  check("a Line's heading, then its Stages", [html.includes('<li class="dbu-tf-line">Super Saiyan Line <span class="dbu-tf-dim">(Saiyan)</span></li>'),
    html.indexOf('data-tf-id="t1"') < html.indexOf('data-tf-id="t2"')], [true, true]);
  check("each row's fields written onto its Item, never the form's (no name=)",
    [li("t1").includes('data-tf-field="active"'), li("t1").includes('data-tf-field="mastery"'), li("t1").includes('data-tf-field="newLevel"'),
     /<input[^>]*\sname=/.test(li("t1"))], [true, true, true, false]);
  check("in use and open drawn so", [html.includes('class="dbu-tf-row in-use maneuver-open" data-tf-id="t1"'),
    html.includes('class="dbu-tf-row" data-tf-id="t2"')], [true, true]);
  check("its seven bonuses, the ones it gives marked", (li("t1").match(/class="dbu-tf-bonus up"/g) ?? []).length, 5);
  check("the sheet's own caret and trash", [li("t1").includes('<span class="maneuver-mark" aria-hidden="true"></span>'),
    li("t1").includes('<i class="fa-solid fa-trash"></i>')], [true, true]);
  check("a Requirement unmet and a Prerequisite said, never refused", [li("t2").includes("not a Saiyan"),
    li("t2").includes("Prerequisite: Fully Mastered Super Saiyan 1")], [true, true]);
  check("a Trait missing its Mastery greyed with why", li("t2").includes('<div class="dbu-tf-trait off">'), true);
  check("the Traits of what is in use under their type, an Evolved Stage's among the Forms",
    [...html.matchAll(/<div class="dbu-tf-dim dbu-tf-subhead">([^<]+)<\/div>/g)].map(m => m[1]), ["Awakenings", "Forms"]);
  check("no \"On:\" for an Evolved Stage, nor its Evolved Stages beside a Form (the user's)", [source.includes("row.on"), source.includes("row.evolved")], [false, false]);
  check("no stray symbols in the template (the user's): no carets, crosses or arrows typed in",
    [...source.matchAll(/[\u25B8\u25BE\u2715\u2192\u00D7]|&times;|&middot;/g)].map(m => m[0]), []);
  check("in English throughout", /[\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1\u00bf]/.test(source), false);
  const empty = template({ tabs: { transformations: { cssClass: "" } }, editable: true, openSections: {},
    transformationsTab: { aspects: [], stressBonus: 0, sections: [], rows: [], traitGroups: [], constant: [], traitCount: 0 } });
  check("none had: no sections, and said", [empty.includes('data-action="transformationSection"'), empty.includes("No Transformations yet")], [false, true]);
  check("the Stress Bonus at the right of the sections' row, not in the Aspects' bar (the user's)",
    [/<nav class="dbu-tf-sections">[\s\S]*Stress Bonus 14<\/span>\s*<\/nav>/.test(html), /<div class="dbu-tf-bar">[\s\S]*?Stress Bonus[\s\S]*?<\/div>/.test(html.slice(0, html.indexOf("<nav")))],
    [true, false]);
}

// --- In use, ticked by hand --------------------------------------------------------------------------------------------------

{
  const off = changes => (changes ?? []).filter(c => c["system.active"] === false).map(c => c._id).sort();
  const f1 = transformation("super-saiyan-1", { active: true });
  const f2 = transformation("super-saiyan-2");
  const fp = transformation("full-power-evolved");
  check("an Evolved Stage ticked as an Enhancement is: the Form you are in stays (the user's)", T.inUseChanges([f1, f2, fp], fp, true), []);
  check("its Original is the Form in use", T.originalFormOf([f1, f2, fp])?.id, f1.id);
  check("in no Form: it may not be entered", T.inUseChanges([f2, fp], fp, true), null);
  const nullStage = transformation("full-suppression", { active: true });
  check("a Null Stage takes it as a Form does", T.inUseChanges([nullStage, fp], fp, true), []);
  const fpOn = transformation("full-power-evolved", { active: true });
  check("another Form ticked: the Form before put by, the Evolved Stage kept (on the new one)", off(T.inUseChanges([f1, f2, fpOn], f2, true)), [f1.id]);
  check("the last Form put by takes the Evolved Stage with it", off(T.inUseChanges([f1, fpOn], f1, false)), [fpOn.id]);
  const legendary = transformation("legendary-evolved");
  const fullForce = transformation("full-force-super-saiyan-2", { active: true });
  const golden = transformation("golden-oozaru");
  check("another Evolved Stage kept where either is Pinnacle (Full Power, Legendary), put by where neither is (Full Force, Golden Oozaru)",
    [off(T.inUseChanges([f1, fpOn, legendary], legendary, true)), off(T.inUseChanges([f1, fullForce, golden], golden, true))], [[], [fullForce.id]]);
  const k = transformation("kaioken", { active: true });
  check("an Enhancement puts another by, and leaves the Forms", off(T.inUseChanges([k, f1], transformation("drunken-fist"), true)), [k.id]);
}

// --- Stage 2: Awakenings --------------------------------------------------------------------------------------------------------

{
  const zenkai = transformation("zenkai", { stacks: 2 });
  const spirit = traitItem(zenkai, "zenkai-saiyan-spirit");
  const script = T.transformationTraitScript(spirit, [zenkai, spirit]);
  check("a Trait's script read from its file, Z written in (Saiyan Spirit at 2 Stacks)",
    [script.includes("min(threshold.depth, 2)"), script.includes("[triggered/steadfast-passed, 2/encounter, effect 4]"), script.includes("$Z")],
    [true, true, false]);
  const prepared = holding([zenkai, spirit]);
  check("and it applies: Steadfast Checks per Threshold below, named by the Trait", partsOf(prepared, "steadfast.dice").map(p => p[0]), ["Saiyan Spirit"]);
  const spiritControl = transformation("spirit-control", { stacks: 2 });
  const apprentice = traitItem(spiritControl, "spirit-control-spiritual-apprentice");
  const withApprentice = holding([spiritControl, apprentice]);
  check("Spiritual Apprentice: 2 Ki a Power Level, Attacking Maneuvers 1(T) cheaper, Surgency Z(bT)",
    [partsOf(withApprentice, "ki.perLevel").length, partsOf(withApprentice, "attack.kiCost").length, partsOf(withApprentice, "surgency").length],
    [1, 1, 1]);
  check("the Spiritual Unique Abilities in Spirit Control's folder, bought as any other", ["instant-transmission", "gigantification",
    "spiritual-healing", "spiritual-cloning", "forced-spirit-fission", "instant-transmission-saviour", "instant-transmission-assault"]
    .map(id => [getTrait(id)?.kind, getTrait(id)?.transformation]), Array(7).fill(["unique", "spirit-control"]));
  check("its Advancements under Instant Transmission", ["combat-transmitter", "masterful-combat-transmitter", "sonic-transmission", "spirit-transporter"]
    .map(id => getTrait(id)?.owner), Array(4).fill("instant-transmission"));

  // The Awakening Limit: each Stack, a Temporary one's not, Class Up free beside Class Avatar.
  const actor = { system: { baseTierOfPower: 1 }, items: [transformation("zenkai", { stacks: 2, temporaryStacks: 1 }),
    transformation("class-up"), transformation("unlocked-potential", { stacks: 2 })] };
  check("the Awakening Limit counted - a Temporary Stack not", T.awakeningCount(actor), { lesser: 2, greater: 2, lesserMax: 2, greaterMax: 1 });
  actor.items.push(transformation("class-avatar"));
  check("Class Up free of it beside Class Avatar", [T.awakeningCount(actor).lesser, T.awakeningCount(actor).greater], [1, 3]);
  check("Born for Battle (4): a stack of Zenkai as a Level 1 Temporary Awakening",
    getTrait("born-for-battle").script.includes("temporaryAwakening(zenkai, 1);"), true);
}

// --- Stage 2: the rest of the Awakenings --------------------------------------------------------------------------------------------

{
  check("the Aspects in their own words (the page the user gave)", ["armored", "fading", "weakening"].map(id => /–Effect:/.test(String(T.aspectFile(id)?.text ?? ""))),
    [true, true, true]);
  check("Martial Skill's Stance: a Special Maneuver of its folder, its four Stances marks, its Styles Options",
    [getTrait("stance")?.kind, getTrait("stance")?.special, ["flame-stance", "wind-stance", "wave-stance", "stone-stance"].map(id => getTrait(id)?.kind),
      T.traitFilesOf(T.transformationFile("martial-skill")).map(t => t.name)],
    ["maneuvers", true, ["conditions", "conditions", "conditions", "conditions"], ["Martial Arts Practitioner"]]);
  check("Pure Progress's Flow, a State of its own", getTrait("flow")?.kind, "states");
  check("their Resources declared by their Traits (Combat Imprinting's Progress, Super Weapon's Reserved Energy)",
    ["progressstrike", "progressdodge", "progresswound", "reservedenergy"].map(name => getTrait(name === "reservedenergy"
      ? "super-android-super-weapon" : "pure-progress-combat-imprinting")?.resource?.toString().includes(name)), [true, true, true, true]);
  check("Class Mark, an Apparel Quality of Class Avatar's", [getTrait("class-mark")?.kind, getTrait("class-mark")?.owner], ["crafting", "apparel-qualities"]);
  const perfection = transformation("perfection", { stacks: 2 });
  const groups = T.groupsOf(perfection, [perfection]);
  check("Perfection: one Perfect Trait a Stack, chosen on its row", [groups.length, groups[0]?.picks, groups[0]?.offered.length], [1, 2, 7]);
  const divine = transformation("divine-candidate");
  const training = traitItem(divine, "divine-candidate-divine-training");
  const aui = transformation("autonomous-ultra-instinct", { active: true });
  check("Divine Candidate gives Perfect Ki Control to a Transformation with God Ki",
    T.aspectsOf(aui, [divine, training, aui]).some(a => a.id === "perfect-ki-control"), true);
  check("not to one without God Ki", T.aspectsOf(transformation("kaioken", { active: true }), [divine, training]).some(a => a.id === "perfect-ki-control"), false);
}

// --- Stage 3: Awakenings held through a Character ---------------------------------------------------------------------------------

{
  const piccolo = { uuid: "Actor.piccolo", name: "Piccolo", system: { attributes: { agility: { score: 9 }, force: { score: 14 },
    tenacity: { score: 12 }, scholarship: { score: 4 }, insight: { score: 11 }, magic: { score: 13 }, personality: { score: 5 } } } };
  const seventeen = { uuid: "Actor.seventeen", name: "Android 17", system: { attributes: { agility: { score: 15 }, force: { score: 8 },
    tenacity: { score: 14 }, scholarship: { score: 6 }, insight: { score: 12 }, magic: { score: 3 }, personality: { score: 7 } } } };
  const world = { [piccolo.uuid]: piccolo, [seventeen.uuid]: seventeen };
  const before = globalThis.fromUuidSync;
  globalThis.fromUuidSync = uuid => world[uuid] ?? null;
  const absorption = transformation("absorption");
  const owner = { system: { conditions: { "absorption-awakening": 2 } }, getFlag: (scope, key) => (key === "absorbedWith")
    ? [{ uuid: piccolo.uuid, name: "Piccolo", temporary: true }, { uuid: seventeen.uuid, name: "Android 17" }] : null, items: [absorption] };
  absorption.parent = owner;
  check("Absorption's stacks are the Absorb Maneuver's marks", [T.stacksOf(absorption), T.inUse(absorption)], [2, true]);
  check("each stack's Absorbed Character, and whether it is Temporary", T.ownersOf(absorption).map(o => [o.name, o.temporary]),
    [["Piccolo", true], ["Android 17", false]]);
  check("+1 in each Absorbed Character's three highest Attribute Scores (Piccolo FO MA TE, 17 AG TE IN)",
    Object.fromEntries(Object.entries(T.bonusesOf(absorption)).map(([k, b]) => [k, T.bonusWritten(b)]).sort()),
    { agility: "1", force: "1", insight: "1", magic: "1", tenacity: "2" });
  const overtaken = transformation("overtaken", { choices: [{ key: "owner", value: piccolo.uuid }] });
  check("Overtaken: +2 in the Possessing Character's three highest", Object.fromEntries(Object.entries(T.bonusesOf(overtaken))
    .map(([k, b]) => [k, T.bonusWritten(b)]).sort()), { force: "2", magic: "2", tenacity: "2" });
  check("none chosen, none", T.bonusesOf(transformation("inherited-life")), {});
  globalThis.fromUuidSync = before;
  const unifiedFile = T.transformationFile("unified");
  check("Unified: the Unify Maneuver's marks and Merged Characters", [unifiedFile.stacksFromCondition, unifiedFile.ownersFromFlag],
    ["unified-awakening", "unifiedWith"]);
  check("Absorb and Unify make the Awakening where it is not had", fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8")
    .match(/ensureConditionAwakening\(actor, "(absorption|unified)-awakening"\)/g)?.length, 2);
}

// --- Stage 4: entering and leaving ------------------------------------------------------------------------------------------------

{
  const kk = transformation("kaioken", { grade: 3 });
  check("its own Stress Test Requirement: its Grade's line (Kaioken Grade 3: 10)", T.ownStressRequirement(kk, {}, [kk]), 10);
  check("Higher Scales +2 each, Prelude -3 (Super Saiyan 1: 12 + 4 - 3)",
    T.ownStressRequirement(transformation("super-saiyan-1"), { scales: 2, prelude: true }, []), 13);
  const ssj1 = transformation("super-saiyan-1", { active: true });
  const kaioken = transformation("kaioken", { grade: 1 });
  const actor = { system: {}, items: [ssj1, kaioken] };
  for (const item of actor.items) item.parent = actor;
  const kaiokenOnSsj1 = T.stressRequirementFor(actor, kaioken, { grade: 1 });
  check("with another in use: the highest, and half of the other (SSJ1 12 + Kaioken 6 / 2)", kaiokenOnSsj1.requirement, 15);
  const ssj2 = transformation("super-saiyan-2");
  const inSsj1 = { system: {}, items: [ssj1, ssj2] };
  for (const item of inSsj1.items) item.parent = inSsj1;
  check("Step-by-Step within its Line: 2 lower (SSJ1 into SSJ2: 16 - 2), the Form left not counted",
    T.stressRequirementFor(inSsj1, ssj2).requirement, 14);
  const fullPower = transformation("full-power-evolved");
  const onSsj1 = { system: {}, items: [ssj1, fullPower] };
  for (const item of onSsj1.items) item.parent = onSsj1;
  check("an Evolved Stage's: its Original's and its sum, one Requirement with the Form (SSJ1 12 + 2), Step-by-Step 2 lower into its higher Tier",
    [T.ownStressRequirement(fullPower, {}, onSsj1.items), T.stressRequirementFor(onSsj1, fullPower).requirement], [14, 12]);
  check("its Tier of Power Requirement: an Evolved Stage's +1 over its Original's", T.tierRequirementOf(fullPower, T.fileOf(fullPower), onSsj1.items), 3);
  const nullStage = transformation("full-suppression");
  const alone = { system: {}, items: [nullStage] };
  nullStage.parent = alone;
  check("Natural, alone: no Stress Test", T.stressRequirementFor(alone, nullStage).natural, true);
  check("not Natural beside one that is not", T.stressRequirementFor(actor, kaioken).natural, false);
  check("the Revert Maneuver: a Core Rule Maneuver that reverts", [getTrait("revert")?.reverts, getTrait("revert")?.source], [true, "Core Rule"]);
  check("the Transformation Maneuver fires Triggered/Transform as it enters one - ticked with Apply effects on its card (the user's, 2026-11-21)",
    ['await card.setFlag(SCOPE, MOMENT_FLAG, { moment: "transform"', '"end-of-turn", "transform"]', '((card.moment === "transform") ? { ...(card.transformContext ?? {}), cardId: message.id } : {})']
      .map(line => fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8").includes(line)), [true, true, true]);
  check("Evil Saiyan's Berserk a State, its Aura Tail a Special Maneuver", [getTrait("berserk")?.kind, getTrait("aura-tail")?.special], ["states", true]);
}

// --- Stage 5: Forms, Lines and the Aspects of a moment ------------------------------------------------------------------------------

{
  const ssj1 = transformation("super-saiyan-1", { active: true });
  check("in a Form: Ki Multiplier", [T.inAForm({ items: [ssj1] }), T.inAForm({ items: [transformation("full-suppression", { active: true })] }),
    T.inAForm({ items: [transformation("kaioken", { active: true })] })], [true, false, false]);
  const prepared = holding([transformation("super-saiyan-1", { active: true })]);
  check("its Ki Multiplier named in the hovers", (prepared.system.effects.slots["kiMultiplier.always"] === true), true);
  const ssj3 = transformation("super-saiyan-3", { active: true });
  const owner = { items: [ssj3] };
  ssj3.parent = owner;
  const draining = T.combineAspects(owner).find(a => a.id === "draining");
  check("Draining: 3 x its level x the highest Tier of Power Requirement in use (SSJ3: Draining 4, Tier 4)",
    T.aspectScript(draining).includes("ki.value -= 3 * 4 * 4;"), true);
  const innate = T.combineAspects({ items: [transformation("oozaru", { active: true })] }).find(a => a.id === "innate-state");
  check("Innate State: each State in brackets entered", T.aspectScript(innate).split("\n").filter(l => l.startsWith("enterState")),
    ["enterState(feral, 1, encounter);", "enterState(raging, 1, encounter);"]);
  const growth = T.combineAspects({ items: [transformation("oozaru", { active: true })] }).find(a => a.id === "growth");
  check("Growth 3: Gigantic", T.aspectScript(growth).includes("allow size.base.gigantic;"), true);
  check("S-Cells' Options found, kept off its Traits", [T.traitFilesOf(T.transformationFile("super-saiyan-1")).map(t => t.name),
    ["s-cells-super-surger", "s-cells-super-speed", "s-cells-super-sturdy", "s-cells-super-specialist"].map(id => getTrait(id)?.optionOf)],
    [["S-Cells", "Golden Power", "This is a Super Saiyan"], Array(4).fill("super-saiyan-1-s-cells")]);
  const weak = transformation("super-saiyan-1", { active: true });
  weak.parent = { system: { ki: { value: 10, max: 100 } }, items: [weak] };
  check("Weakening (none on SSJ1): its bonuses whole", T.bonusWritten(T.bonusesOf(weak).force), "1(T)");
  check("Suppressed Divinity's Unique Abilities given with Divine Role", getTrait("suppressed-divinity-divine-role")?.grantsUnique?.toString(),
    "injury-transfer,space-time-connection");
  check("a Mastery Trait's Aspects - This is a Super Saiyan: Draining and Power High lost, Natural and Heartbeat gained",
    (() => {
      const mastered = transformation("super-saiyan-1", { active: true, mastery: 1 });
      const trait = traitItem(mastered, "super-saiyan-1-this-is-a-super-saiyan");
      return T.aspectsOf(mastered, [mastered, trait]).map(a => a.id).filter(id => ["draining", "power-high", "natural", "heartbeat"].includes(id)).sort();
    })(), ["heartbeat", "natural"]);
}

// --- Stage 6: Evolved Stages --------------------------------------------------------------------------------------------------------

{
  const { transformationQuestion } = await import(modUrl("aside.mjs"));
  const FP = await import(modUrl("full-power.mjs"));
  const owner = list => { const actor = { system: { capacity: { max: 40 } }, items: list }; for (const item of list) item.parent = actor; return actor; };
  // Pinnacle: Legendary (Pinnacle 1) on Full Power (Pinnacle 2) together; two without it, one by the other.
  {
    const ssj1 = transformation("super-saiyan-1", { active: true });
    const fp = transformation("full-power-evolved", { active: true });
    const legendary = transformation("legendary-evolved");
    const both = owner([ssj1, fp, legendary]);
    check("Pinnacle: Legendary goes on Full Power (one of them at level 2), the Form kept", T.inUseChanges(both.items, legendary, true), []);
    const golden = transformation("golden-oozaru", { active: true });
    const force = transformation("full-force-super-saiyan-2");
    const pair = owner([transformation("super-saiyan-2", { active: true }), golden, force]);
    check("two Evolved Stages without Pinnacle: the one entered puts the other by",
      T.inUseChanges(pair.items, force, true), [{ _id: golden.id, "system.active": false }]);
    check("the Form, Full Power and Legendary one Stress Test Requirement - both sums (SSJ1 12 + 2 + 5; Same as Original: no Step-by-Step)",
      T.stressRequirementFor(both, legendary).requirement, 19);
    const kk = transformation("kaioken", { grade: 1 });
    const withKaioken = owner([transformation("super-saiyan-1", { active: true }), transformation("full-power-evolved", { active: true }), kk]);
    check("an Enhancement beside a Form and its Evolved Stage: the two as one, then half of the Enhancement's (12 + 2 + 6 / 2)",
      T.stressRequirementFor(withKaioken, kk).requirement, 17);
  }
  // Autonomous Ultra Instinct: added whole, less twice the highest Tier of Power Requirement of the others.
  {
    const aui = transformation("autonomous-ultra-instinct");
    const into = owner([transformation("super-saiyan-1", { active: true }), aui]);
    check("Autonomous Ultra Instinct: SSJ1's 12, and its own 12 less 2 x 2 whole (Angelic Technique (1))",
      T.stressRequirementFor(into, aui).requirement, 20);
    check("alone: its own", T.stressRequirementFor(owner([aui]), aui).requirement, 12);
  }
  // Tier of Power: relative to the Original's as written, not its Higher Scales; its Form Type the Original's ("Same").
  {
    const scaled = transformation("super-saiyan-1", { active: true, scales: 2 });
    const fp = transformation("full-power-evolved", { active: true });
    const actor = owner([scaled, fp]);
    check("Full Power's Tier of Power Requirement: SSJ1's written 2 + 1, its Higher Scales not counted", T.tierRequirementOf(fp), 3);
    check("its Form Type the Original's (Same as Original Form)", T.formTypeFor(fp, actor.items), "alternate");
  }
  // Mastered, Fully Mastered, [Acclimated].
  {
    const ssj2 = transformation("super-saiyan-2", { active: true, mastery: 1 });
    check("Mastered once; Fully Mastered with every Difficult level (SSJ2 Difficult 1: twice); Peaked counts as both",
      [T.isMastered(ssj2), T.isFullyMastered(ssj2), T.isFullyMastered(transformation("full-power-evolved"))], [true, false, true]);
    const rampagingOf = mastery => {
      const form = transformation("super-saiyan-1", { active: true, mastery });
      const legendary = transformation("legendary-evolved", { active: true });
      const trait = traitItem(legendary, "legendary-evolved-unlimited-power");
      const actor = owner([form, legendary, trait]);
      return [T.aspectsOf(legendary, actor.items).some(a => a.id === "rampaging"), transformationQuestion("originalMastered", actor)];
    };
    check("[Acclimated]: Legendary's Rampaging gone and originalMastered once the Form it is on is Mastered", [rampagingOf(0), rampagingOf(1)],
      [[true, false], [false, true]]);
  }
  // What does not fit, said.
  {
    const golden = transformation("golden-oozaru", { active: true });
    const fp = transformation("full-power-evolved", { active: true });
    check("said, not refused: Golden Oozaru on SSJ1 (Unique to Oozaru); Full Power on an unmastered SSJ1",
      [T.evolvedUnmet(golden, owner([transformation("super-saiyan-1", { active: true }), golden]).items),
       T.evolvedUnmet(fp, owner([transformation("super-saiyan-1", { active: true }), fp]).items),
       T.evolvedUnmet(fp, owner([transformation("super-saiyan-1", { active: true, mastery: 1 }), fp]).items)],
      ["Unique to Oozaru", "Super Saiyan 1 is not Mastered", ""]);
  }
  // Stress taken off by another's Trait: Legendary Super Saiyan's 3 off the Legendary on its Form.
  {
    const fpssj = transformation("full-power-super-saiyan", { active: true });
    const style = traitItem(fpssj, "full-power-super-saiyan-legendary-super-saiyan");
    const legendary = transformation("legendary-evolved");
    const actor = owner([fpssj, style, legendary]);
    check("Legendary Super Saiyan (2): the Legendary Evolved Stage on its Form 3 lower (5 - 3)", T.evolvedAdd(legendary, {}, actor.items), 2);
  }
  // Signature Techniques given as a Trait's data.
  {
    const fire = FP.techniqueItemsFrom(getTrait("golden-oozaru-golden-beast"), "r0");
    check("Golden Beast (4): Fire Breath - Super, Magic (Elemental: Fire), 13(T), its four features, Restricted to Golden Oozaru",
      fire.map(item => [item.name, item.system.signature.level, item.system.signature.profile, item.system.signature.fixedKiPerTier,
        item.system.signature.features.map(f => `${f.id}:${f.ranks}:${f.choice}`)]),
      [["Fire Breath", "super", "elementalFire", 13, ["terrain-destruction:2:", "widespread-assault:1:cone", "concentrated-strike:1:",
        "restricted-transformation:2:golden-oozaru"]]]);
    check("Villainous Form (1): the five Evil Techniques", FP.techniqueItemsFrom(getTrait("evil-aura-villainous-form")).map(item => item.name),
      ["Baked Sphere", "Gigantic Ki Blast", "Marbling Drop", "Peeler Storm", "Rage Saucer"]);
  }
  // Restricted - Transformation / Untransformed.
  {
    const nullStage = owner([transformation("full-suppression", { active: true })]);
    const inSsj1 = owner([transformation("super-saiyan-1", { active: true })]);
    const inKaioken = owner([transformation("kaioken", { active: true })]);
    check("the Normal State: a Null Stage is it; Restricted - Transformation by kind, Line and id (a Variant counting as its original)",
      [T.inNormalState(nullStage), T.inNormalState(inSsj1), T.inTransformationOf(inSsj1, "form"), T.inTransformationOf(nullStage, "form"),
       T.inTransformationOf(inSsj1, "line:super-saiyan"), T.inTransformationOf(inSsj1, "enhancement"), T.inTransformationOf(inKaioken, "kaioken"),
       T.inTransformationOf(owner([transformation("evil-saiyan", { active: true })]), "evil-aura")],
      [true, false, true, false, true, false, true, true]);
    const CHT = fs.readFileSync(path.join(ROOT, "module", "technique-use.mjs"), "utf8");
    check("refused as the Technique is used", [CHT.includes("inTransformationOf(actor, wanted)"), CHT.includes("!inNormalState(actor)"),
      getTrait("restricted-transformation")?.choose], [true, true, "transformation"]);
  }
  // The Ki Wager of 1/4 of the Max Capacity.
  {
    const CH = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
    check("a Ki Wager of 1/4 of the Max Capacity: Strike, Wound, Damage Category; half the wager (Limitless)",
      [CH.includes('slotPart(attacker, "strike.heavyWager", heavyWager(attacker, attack)'), CH.includes('slotPart(attacker, "wound.heavyWager"'),
       CH.includes("heavyWager(actor, { kiWager })"), CH.includes("...halfWagerParts(attacker, attack),")], [true, true, true, true]);
    check("Full Force Super Saiyan 2's two Slots read by Item (scripts compiled)", [getTrait("full-force-super-saiyan-2-sparking-limit-break")
      .script.includes("strike.heavyWager += 1(T);"), getTrait("super-saiyan-2-sparking-momentum").script.includes("attack.damageCategory.heavyWager += 1;")],
      [true, true]);
  }
  // Golden Beast (1): failing, the Form kept.
  check("Golden Oozaru fails into the Form it is on (failsInto: original)", [getTrait("golden-oozaru")?.failsInto,
    fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8").includes('(String(T.fileOf(each)?.failsInto ?? "") === "original")')],
    ["original", true]);
}


// --- Stage 7: what surrounds them -----------------------------------------------------------------------------------------------

{
  const { transformationQuestion } = await import(modUrl("aside.mjs"));
  const owner = list => { const actor = { system: {}, items: list }; for (const item of list) item.parent = actor; return actor; };
  const racialOf = traitId => ({ id: `r${++ids}`, name: getTrait(traitId).name, type: "racial", flags: { "dbu-ttrpg": { sourceId: traitId } },
    system: { script: getTrait(traitId).script, chosen: [] } });
  // What gives a Transformation, what takes off its Stress, what gives it an Aspect.
  {
    const evil = transformation("evil-saiyan");
    const actor = owner([evil, racialOf("evil-saiyan-of-legend")]);
    check("Evil Saiyan of Legend: Evil Saiyan given, 3 lower (13 - 3), Natural (LV2)",
      [String(getTrait("evil-saiyan-of-legend").grantsTransformation), T.ownStressRequirement(evil, {}, actor.items),
       T.aspectsOf(evil, actor.items).find(a => a.id === "natural")?.level], ["evil-saiyan", 10, 2]);
    check("Emperor: every Stage of Metamorphosis given; Searing Anger, Return to Heritage, Discarded Divinity, Tremendous Lord, Legendary Saiyan, "
      + "True God of Time theirs", ["emperor", "searing-anger", "return-to-heritage", "discarded-divinity", "tremendous-lord", "legendary-saiyan",
        "divinity-unleashed-true-god-of-time"].map(id => String(getTrait(id)?.grantsTransformation ?? "")),
      ["full-suppression,heavy-suppression,partial-suppression,true-form", "seething-fury", "feral-fist", "true-angel", "great-namekian",
       "legendary-evolved", "time-power"]);
    const RAC = fs.readFileSync(path.join(ROOT, "module", "racial.mjs"), "utf8");
    check("given as the Trait is added, gone with it (grantedBy; a Transformation deleted takes its Traits)",
      [RAC.includes("for (const id of transformationsGiven) {") && RAC.includes("chosenOptions(item).flatMap(option => listOf(option.grantsTransformation))"), RAC.includes('await given.setFlag("dbu-ttrpg", "grantedBy", item.id);'),
       fs.readFileSync(path.join(ROOT, "module", "transformations.mjs"), "utf8").includes("export function registerTransformationHooks()"),
       fs.readFileSync(path.join(ROOT, "module", "dbu-ttrpg.mjs"), "utf8").includes("registerTransformationHooks();")], [true, true, true, true]);
  }
  check("Saiyan Heritage's Tailed gives the Oozaru; Tailless in a Form or Enhancement", [String(getTrait("tailed")?.grantsTransformation ?? ""),
    getTrait("tailless")?.script.includes("if (inFormOrTranscended || inEnhancement) {")], ["oozaru", true]);
  // The Awakening Limit of a Fusion and of an Adversary.
  check("a Fusion's Awakening Limit its own table (base Tier 2: 4 / 2); an Adversary's none",
    [(l => [l.lesserMax, l.greaterMax])(T.awakeningCount({ type: "fusion", system: { baseTierOfPower: 2 }, items: [] })),
     T.awakeningCount({ type: "adversary", system: { baseTierOfPower: 2 }, items: [] }).none], [[4, 2], true]);
  // The questions the effects language asks.
  {
    const oozaru = owner([transformation("oozaru", { active: true })]);
    const transcended = owner([transformation("lightspeed-mode", { active: true, transcended: true }), transformation("kaioken", { active: true })]);
    check("inTransformation, inFormOrTranscended, inEnhancement, enhancementsAtLeast, transformedTierAtLeast",
      [transformationQuestion("inTransformation", oozaru, "oozaru"), transformationQuestion("inFormOrTranscended", oozaru),
       transformationQuestion("inFormOrTranscended", transcended), transformationQuestion("inEnhancement", transcended),
       transformationQuestion("enhancementsAtLeast", transcended, 2), transformationQuestion("transformedTierAtLeast", oozaru, 2),
       transformationQuestion("transformedTierAtLeast", owner([transformation("super-saiyan-3", { active: true })]), 4)],
      [true, true, true, true, true, false, true]);
  }
  // The Stress Test to remain.
  check("to remain in them: their Requirement together (SSJ1 12 + Kaioken 6 / 2); none where all are Natural",
    [T.stressRequirementInUse(owner([transformation("super-saiyan-1", { active: true }), transformation("kaioken", { active: true, grade: 1 })])).requirement,
     T.stressRequirementInUse(owner([transformation("full-suppression", { active: true })])).natural], [15, true]);
  {
    const CH = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
    check("forced: a Health Threshold's Steadfast Check failed, Straining at the start of a turn; Ki at 0 said in a window",
      [CH.includes('if (failed.length) await forcedStressTest(actor, "A Steadfast Check failed");'), getTrait("aspect-straining")?.script.includes("stressTest();"),
       fs.readFileSync(path.join(ROOT, "module", "transformations.mjs"), "utf8").includes('(await import("./chat.mjs")).kiEmptied(actor);')],
      [true, true, true]);
  }
  // New Level of Power.
  {
    const lifted = holding([transformation("super-saiyan-1", { active: true, newLevel: true })]);
    const plain = holding([transformation("super-saiyan-1", { active: true })]);
    check("New Level of Power: Tier of Power 1 higher and the Stress Bonus 1(bT), named in the hovers",
      [lifted.system.tierOfPower - plain.system.tierOfPower, partsOf(lifted, "tierOfPower").some(([source]) => /New Level of Power/.test(String(source)))],
      [1, true]);
  }
  // Power Advantage.
  check("Power Advantage: an Action more the Round it is gained (combat.mjs powerAdvantages)",
    [fs.readFileSync(path.join(ROOT, "module", "combat.mjs"), "utf8").includes("const advantaged = [...await powerAdvantages(combat), ...(await import(\"./transformations.mjs\")).limitedNotices(combat)];"),
     fs.readFileSync(path.join(ROOT, "module", "data", "actor-character.mjs"), "utf8").includes("+ powerAdvantageNow(this)),")], [true, true]);
  // Emperor (2): an Arcosian Form part of Metamorphosis.
  check("the Line a Form is part of: its own", T.lineOf(T.transformationFile("heavy-suppression"), []), "metamorphosis");
}

// --- Stage 7: Adversaries and Fusions -------------------------------------------------------------------------------------------

{
  const owner = list => { const actor = { system: {}, items: list }; for (const item of list) item.parent = actor; return actor; };
  // Narrative Transformation (1).
  {
    const oozaru = transformation("oozaru");
    const narrative = { id: `r${++ids}`, name: "Narrative Transformation", type: "racial", flags: { "dbu-ttrpg": { sourceId: "narrative-transformation" } },
      system: { chosen: [{ key: "narrative-transformation", value: "oozaru" }] } };
    const alone = owner([oozaru, narrative]);
    const kk = transformation("kaioken", { active: true });
    const withOther = owner([transformation("oozaru"), kk, { ...narrative, id: `r${++ids}` }]);
    check("Narrative Transformation (1): the Form chosen with no Stress Test alone - with another in use, one",
      [T.stressRequirementFor(alone, oozaru).natural, T.stressRequirementFor(withOther, withOther.items[0]).natural], [true, false]);
  }
  // Fused Transformation (4) and the Fused Forms.
  {
    const a = owner([transformation("super-saiyan-1"), transformation("kaioken")]);
    const b = owner([transformation("super-saiyan-1"), transformation("oozaru")]);
    a.uuid = "Actor.a"; b.uuid = "Actor.b";
    const before = globalThis.fromUuidSync;
    globalThis.fromUuidSync = uuid => ({ "Actor.a": a, "Actor.b": b })[uuid] ?? null;
    const ssj1 = transformation("super-saiyan-1", { active: true });
    const modifier = { id: `r${++ids}`, name: "Fused Transformation", type: "racial", flags: { "dbu-ttrpg": { sourceId: "fused-transformation" } }, system: {} };
    const fusion = { type: "fusion", system: { fusion: { fused: [{ uuid: "Actor.a" }, { uuid: "Actor.b" }] } }, items: [ssj1, modifier] };
    for (const item of fusion.items) item.parent = fusion;
    check("Fused Transformation: the Fused Form (both have SSJ1), its AG/FO/TE/MA 1(T) higher as an Alternate Form",
      [T.fusedFormIds(fusion), T.bonusWritten(T.bonusesOf(ssj1).force), T.bonusWritten(T.bonusesOf(ssj1).insight)], [["super-saiyan-1"], "2(T)", "1(T)"]);
    globalThis.fromUuidSync = before;
  }
  {
    const FM = fs.readFileSync(path.join(ROOT, "module", "fusion-make.mjs"), "utf8");
    check("a Fusion's Transformations: each once, the one Mastered most with its Traits, none in use; Enhanced and Fused Transformation's "
      + "Prerequisites read", [FM.includes("const keptTransformations = new Set("), FM.includes("Object.assign(data.system, { active: false, newLevel: false"),
        FM.includes('"enhanced-fusion": { ok: formSets.every(set => !set.size)'), FM.includes('"fused-transformation": { ok: sharedForms.length > 0')],
      [true, true, true, true]);
    const V = fs.readFileSync(path.join(ROOT, "module", "villainous.mjs"), "utf8");
    check("\"Face Me at Full Power\" and \"Stop Wasting My Time\" no longer waiting", [V.includes("const WAITING"),
      V.includes('if (maneuver.id === "face-me-at-full-power") {'), V.includes('"flags.dbu-ttrpg.stopWastingBy"'),
      getTrait("second-phase").script.includes("transformationOutOfSequence();")], [false, true, true, true]);
  }
}

// --- The Possess Maneuver ------------------------------------------------------------------------------------------------------

{
  const CH = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
  const UM = fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8");
  const possess = getTrait("possess");
  check("Possess: a Special Maneuver of 2 Actions once a Round, its Exploit on the first Clash lost, Overtaken the Awakening it gives",
    [possess?.special, possess?.actionCost, possess?.usageLimit, possess?.exploitOnLoss, possess?.givesAwakening, T.kindOf(T.transformationFile(possess?.givesAwakening))],
    [true, 2, "1/round", true, "overtaken", "awakening"]);
  check("its door, its two Clashes, the possession by the GM and its end as the Awakening goes",
    [UM.includes('if (maneuver.id === "possess") {'), CH.includes("if (clash.possessing && clash.result && !clash.possessing.applied)"),
     CH.includes('saves: ["impulsive"],'), CH.includes('case "possess": return possessCharacter('), CH.includes("await T.gainTemporaryAwakening(target, awakening, 2);"),
     fs.readFileSync(path.join(ROOT, "module", "transformations.mjs"), "utf8").includes('(await import("./chat.mjs")).releasePossession(actor);')],
    [true, true, true, true, true, true]);
  check("given in the Liquid State (Parasitic Biology, Genes of a Parasite) and the Ball Form; Roomy Biology, Mutualism, Tuffle Parasite answer it",
    [getTrait("parasitic-biology").script.includes("allow maneuver.possess;"), getTrait("focus-genes-of-a-parasite").script.includes("allow maneuver.possess;"),
     getTrait("personified-dragon-ball").script.includes("allow maneuver.possess;"), getTrait("roomy-biology").script.includes("allow roomy.possessHold;"),
     getTrait("mutualism").script.includes("allow mutualism.noControl;"), getTrait("tuffle-parasite").script.includes("allow tuffleParasite.minion;")],
    [true, true, true, true, true, true]);
}

// --- Chaotic Majin, Pure Form, Prelude, the Chaos Die ------------------------------------------------------------------------------

{
  const owner = list => { const actor = { system: {}, items: list }; for (const item of list) item.parent = actor; return actor; };
  const racialOf = traitId => ({ id: `r${++ids}`, name: getTrait(traitId).name, type: "racial", flags: { "dbu-ttrpg": { sourceId: traitId } },
    system: { script: getTrait(traitId).script, chosen: [] } });
  // Any Trait's Aspect for a Transformation by its name: Absolute Chaos's.
  {
    const aspectsAt = mastery => {
      const pure = transformation("pure-form", { mastery });
      const actor = owner([pure, racialOf("absolute-chaos")]);
      const held = T.aspectsOf(pure, actor.items);
      return [held.some(a => a.id === "prelude"), held.find(a => a.id === "natural")?.level ?? 0];
    };
    check("Absolute Chaos: Pure Form given Prelude by its name; Natural (LV1) once Mastered, (LV2) Fully Mastered (Difficult 3: 4 Masteries)",
      [aspectsAt(0), aspectsAt(1), aspectsAt(4)], [[true, 0], [true, 1], [true, 2]]);
    check("given by its name or its id, a Line, any", [T.namesTransformation("Pure Form", T.transformationFile("pure-form")),
      T.namesTransformation("pure-form", T.transformationFile("pure-form")), T.namesTransformation("line:super-saiyan", T.transformationFile("super-saiyan-2")),
      T.namesTransformation("any", T.transformationFile("kaioken")), T.namesTransformation("Oozaru", T.transformationFile("kaioken"))],
      [true, true, true, true, false]);
    const pure = transformation("pure-form");
    const chaos = transformation("internalized-chaos", { active: true });
    const actor = owner([chaos, pure, racialOf("absolute-chaos")]);
    check("Absolute Chaos (4): Pure Form the Pure Majin Line's Stage 1 - Step-by-Step 2 lower from Internalized Chaos (12 - 2, alone in it)",
      [T.lineOf(T.fileOf(pure), actor.items), T.stageOf(T.fileOf(pure), actor.items), T.stressRequirementFor(actor, pure).requirement],
      ["pure-majin", 1, 10]);
    check("and both given with it", String(getTrait("absolute-chaos").grantsTransformation), "pure-form,internalized-chaos");
  }
  // Prelude: the last Trait left out, its Permanent effects kept.
  {
    const pure = transformation("pure-form", { active: true, prelude: true });
    const unpredictable = traitItem(pure, "pure-form-unpredictable");
    const erratic = traitItem(pure, "pure-form-erratic-majin");
    const actor = owner([pure, unpredictable, erratic]);
    const plain = transformation("pure-form", { active: true });
    const kept = traitItem(plain, "pure-form-unpredictable");
    owner([plain, kept]);
    check("Prelude: Pure Form's last Trait (Unpredictable) left out, the first kept; without Prelude, had",
      [T.transformationTraitAside(unpredictable, actor.items), T.transformationTraitAside(erratic, actor.items), T.transformationTraitAside(kept, plain.parent.items)],
      ["prelude", "", ""]);
  }
  // Pure Chaos (1): Legendary, 9 more Stress, its Legendary Trait had.
  {
    const at = mastery => {
      const pure = transformation("pure-form", { active: true, mastery });
      const pureChaos = traitItem(pure, "pure-form-pure-chaos");
      const legend = traitItem(pure, "pure-form-sensation-of-purity");
      const actor = owner([pure, pureChaos, legend]);
      return [T.formTypeFor(pure, actor.items), T.ownStressRequirement(pure, {}, actor.items), T.transformationTraitAside(legend, actor.items)];
    };
    check("Pure Chaos (third Mastery): Pure Form Legendary, Stress 12 + 9, Sensation of Purity applying; before it, Alternate",
      [at(2), at(3)], [["alternate", 12, "legendary"], ["legendary", 21, ""]]);
  }
  // The Chaos Die: its mark, read.
  {
    const withDie = (stacks, mastery = 0) => {
      const pure = transformation("pure-form", { active: true, mastery });
      const items = [pure, traitItem(pure, "pure-form-erratic-majin"), traitItem(pure, "pure-form-pure-chaos")];
      const actor = holding(items);
      const plain = holding([transformation("pure-form", { active: true, mastery })]);
      void plain;
      actor.system.conditions = { ...(actor.system.conditions ?? {}), "chaos-die": stacks };
      return actor;
    };
    const die = getTrait("chaos-die");
    check("the Chaos Die: a mark of 6 stacks at most, not a Combat Condition, each result said",
      [die?.kind, Number(die?.maxStacks), String(die?.combatCondition), die?.result6], ["conditions", 6, "false", "Combat Rolls and Soak Value 1(T) higher"]);
    void withDie;
    const CH = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
    check("rolled at the start of the Round once (whatever gives it), rerolled and nudged as asked, then its Moment",
      [CH.includes('if (actor.getFlag?.(SCOPE, "chaosRound") === roundKey()) return;'), CH.includes('await answerFor(actor, "chaos-die", { natural: result });'),
       getTrait("pure-form-erratic-majin").script.includes("chaosDie(start);"), getTrait("internalized-chaos-chaotic-entity").script.includes("allow chaos.reroll;"),
       getTrait("pure-form-unpredictable").script.includes("allow chaos.nudge;")], [true, true, true, true, true]);
  }
}

// --- An Aspect given on a condition ----------------------------------------------------------------------------------------------

{
  await import(modUrl("effects/conditions.mjs"));
  const { transformationQuestion } = await import(modUrl("aside.mjs"));
  const armored = (id, system, traitId, actorSystem) => {
    const item = transformation(id, system);
    const trait = traitItem(item, traitId);
    const actor = { system: actorSystem, items: [item, trait] };
    item.parent = actor; trait.parent = actor;
    return T.aspectsOf(item, actor.items).some(a => a.id === "armored");
  };
  check("Pinnacle of Legacy: Armored in the Undying State, not out of it",
    [armored("full-power-super-saiyan", { active: true }, "full-power-super-saiyan-pinnacle-of-legacy", { states: { undying: 1 } }),
     armored("full-power-super-saiyan", { active: true }, "full-power-super-saiyan-pinnacle-of-legacy", { states: {} })], [true, false]);
  check("Fiendish Evolution: Armored with 2+ Demonic Power",
    [armored("super-demon", { active: true, mastery: 2 }, "super-demon-fiendish-evolution", { resources: { demonicpower: { stacks: 2 } } }),
     armored("super-demon", { active: true, mastery: 2 }, "super-demon-fiendish-evolution", { resources: { demonicpower: { stacks: 1 } } })], [true, false]);
  check("Accelerated Growth: Armored from its 3rd Grade - Great Namekian, its Variant, too (This)",
    [armored("giant-form", { active: true, grade: 3 }, "giant-form-accelerated-growth", {}),
     armored("giant-form", { active: true, grade: 2 }, "giant-form-accelerated-growth", {}),
     armored("great-namekian", { active: true, grade: 3 }, "giant-form-accelerated-growth", {})], [true, false, true]);
  check("the Normal State asked of what is in use: a Null Stage is it, a Form is not",
    [transformationQuestion("normalState", { items: [transformation("full-suppression", { active: true })] }),
     transformationQuestion("normalState", { items: [transformation("oozaru", { active: true })] })], [true, false]);
  check("Disguised Shadow: Monster Form given, Absorbed Apparel by name", [String(getTrait("disguised-shadow").grantsTransformation),
    (() => { const mf = transformation("monster-form"); const actor = { items: [mf, { id: "rd", type: "racial", flags: { "dbu-ttrpg": { sourceId: "disguised-shadow" } }, system: {} }] };
      mf.parent = actor; return T.aspectsOf(mf, actor.items).some(a => a.id === "absorbed-apparel"); })()], ["monster-form", true]);
}

// --- Super Saiyan 1: S-Cells' text as chosen; Raging or Superior ------------------------------------------------------------------

{
  const RAC = await import(modUrl("racial.mjs"));
  const sCells = getTrait("super-saiyan-1-s-cells");
  const lines = RAC.racialTraitLines({ system: { text: sCells.text, chosen: [{ key: "option", value: "s-cells-super-surger" }] },
    flags: { "dbu-ttrpg": { sourceId: sCells.id } } }).map(line => String(line.html));
  check("S-Cells' \"(3)-[Permanent, Option]\" shows the Option chosen alone (Super Surger), not the other three",
    [lines.some(line => line.includes("Super Surger")), lines.some(line => /Super Speed|Super Sturdy|Super Specialist/.test(line))], [true, false]);
  check("and it is asked as an Option effect", RAC.optionGroupsOf(sCells).map(group => [group.effect, group.count, group.options.length]), [[3, 1, 4]]);
  const CH = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
  check("Golden Power (3) through ragingOrSuperior; This is a Super Saiyan (4) its own button on a Moment never fired; (3) Superior as Raging",
    [getTrait("super-saiyan-1-golden-power").script.includes("ragingOrSuperior();"),
     getTrait("super-saiyan-1-this-is-a-super-saiyan").script.includes("[triggered/superior-instead, effect 4]"),
     CH.includes('const offered = triggersFor(actor, ["superior-instead"]);'), CH.includes("superior = offered.some(entry => automaticIds(actor).has(entry.blockId))"),
     getTrait("aspect-raging").script.includes('(inState("superior") && superiorAsRaging)')], [true, true, true, true, true]);
  const { transformationQuestion } = await import(modUrl("aside.mjs"));
  const asRaging = mastery => {
    const ssj1 = transformation("super-saiyan-1", { active: true, mastery });
    const trait = traitItem(ssj1, "super-saiyan-1-this-is-a-super-saiyan");
    return transformationQuestion("superiorAsRaging", { items: [ssj1, trait] });
  };
  check("Superior as Raging once Mastered, not before", [asRaging(1), asRaging(0)], [true, false]);
}

// --- Monster Form: its choices on its row ------------------------------------------------------------------------------------------

{
  const chose = values => Object.entries(values).map(([key, value]) => ({ key: `choice:${key}`, value }));
  const mf = transformation("monster-form", { active: true, choices: chose({ attribute: "fo-ma", aspect: "raging", save1: "impulsive", save2: "morale",
    growth: "2", rampaging: "0" }) });
  const ascension = traitItem(mf, "monster-form-monstrous-ascension");
  const actor = { system: {}, items: [mf, ascension] };
  mf.parent = actor; ascension.parent = actor;
  const held = T.aspectsOf(mf, actor.items);
  check("Monster Form's six choices on its row", T.rowChoicesOf(mf).map(choice => [choice.key, choice.options.length, choice.chosen]),
    [["attribute", 3, "fo-ma"], ["aspect", 3, "raging"], ["save1", 4, "impulsive"], ["save2", 4, "morale"], ["growth", 4, "2"], ["rampaging", 3, "0"]]);
  check("what they give it: Raging, Enhanced Save (Impulsive/Morale), Growth 2, no Rampaging at 0; Innate State (Raging) with Raging chosen",
    [held.some(a => a.id === "raging"), held.find(a => a.id === "enhanced-save")?.params, held.find(a => a.id === "growth")?.level,
     held.some(a => a.id === "rampaging"), held.find(a => a.id === "innate-state")?.params], [true, ["Impulsive", "Morale"], 2, false, ["Raging"]]);
  check("and +1(T) on Force and Magic (FO+MA chosen), not on the others", (b => [T.bonusWritten(b.force), T.bonusWritten(b.magic), T.bonusWritten(b.agility)])(T.bonusesOf(mf)),
    ["2(T)", "2(T)", "1(T)"]);
  const unchosen = transformation("monster-form");
  unchosen.parent = { items: [unchosen] };
  check("nothing chosen: none of it", T.aspectsOf(unchosen, [unchosen]).map(a => a.id).filter(id => ["raging", "enhanced-save", "growth", "rampaging"].includes(id)), []);
  const rampaging = transformation("monster-form", { active: true, choices: chose({ rampaging: "2", attribute: "ag" }) });
  const rampTrait = traitItem(rampaging, "monster-form-monstrous-ascension");
  const rampActor = { system: {}, items: [rampaging, rampTrait] };
  rampaging.parent = rampActor; rampTrait.parent = rampActor;
  const script = T.transformationTraitScript(rampTrait, rampActor.items);
  check("its Traits' scripts with them written in: Rampaging 2 for (3), Agility for (2)",
    [script.includes("soakValue += 2 * 1(T);"), script.includes("if (1 == 1) {\n    legend.extra += floor(agility.mod / 2);"), script.includes("if (0 == 1) {\n    legend.extra += floor(tenacity.mod / 2);")],
    [true, true, true]);
  const { traitAside } = await import(modUrl("aside.mjs"));
  const bestial = { id: "rb", type: "racial", flags: { "dbu-ttrpg": { sourceId: "claws", grantedBy: ascension.id } }, system: { other: "bestial" } };
  const off = transformation("monster-form", { choices: [] });
  const offTrait = { ...traitItem(off, "monster-form-monstrous-ascension") };
  const offBestial = { ...bestial, id: "rb2", flags: { "dbu-ttrpg": { sourceId: "claws", grantedBy: offTrait.id } } };
  check("its Bestial Trait in Monster Form, set aside out of it", [traitAside(bestial, [mf, ascension, bestial]), traitAside(offBestial, [off, offTrait, offBestial])],
    ["", "transformation"]);
  check("Controlled Monster and Overtaken: Rampaging ignored", [String(getTrait("monster-form-controlled-monster").ignoresAspect), String(getTrait("overtaken-i-become-you").ignoresAspect),
    getTrait("aspect-rampaging").script.includes('requires !ignoresAspect("rampaging");')], ["Rampaging", "Rampaging", true]);
}

// --- Violent Monster's Vile Technique ---------------------------------------------------------------------------------------------

{
  const TU = await import(modUrl("technique-use.mjs"));
  const withForm = active => {
    const mf = transformation("monster-form", { active });
    const violent = traitItem(mf, "monster-form-violent-monster");
    violent.system.chosen = [{ key: "monster-form-violent-monster", value: "tech1" }];
    const items = [mf, violent];
    const actor = { name: "Monster", system: { usedManeuvers: [] }, items: Object.assign(items, { get: id => items.find(each => each.id === id) }) };
    mf.parent = actor; violent.parent = actor;
    return actor;
  };
  const vile = { id: "tech1", itemId: "tech1", name: "Vile Blast", advantages: [] };
  const other = { id: "tech2", itemId: "tech2", name: "Plain Blast", advantages: [] };
  check("the Vile Technique: chosen as Favored Technique's; refused out of Monster Form, used in it; another Technique untouched",
    [getTrait("monster-form-violent-monster").choose, TU.whyNotTechnique(withForm(false), vile) !== "", TU.whyNotTechnique(withForm(true), vile),
     TU.whyNotTechnique(withForm(false), other)], ["ownTechnique", true, "", ""]);
  const TQ = await import(modUrl("technique.mjs"));
  const vileItem = { id: "tech1", system: { signature: { level: "super", freeTP: 0 } } };
  const plainItem = { id: "tech2", system: { signature: { level: "super", freeTP: 0 } } };
  const holder = withForm(true);
  holder.items.push(vileItem, plainItem); vileItem.parent = holder; plainItem.parent = holder;
  check("free: 25 TP of it none of the character's, and counted as a Transformation Trait's; another Technique not",
    [TQ.signatureOf(vileItem).freeTP, TQ.signatureOf(vileItem).fromTransformation, TQ.signatureOf(plainItem).freeTP], [25, true, 0]);
  const CH = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
  check("(4) its Wound per Threshold doubled on it, (7) Ascended Signature once an Encounter",
    [getTrait("monster-form-violent-monster").script.includes("wound.perTargetThresholdChosen += 1(T);"),
     CH.includes("chosenTechniqueHeld(attacker, attack?.technique?.itemId)"),
     fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8").includes('"chosenAscendEncounter", encounterKey')], [true, true, true]);
}

// --- The Aspects that did nothing yet --------------------------------------------------------------------------------------------

{
  const owner = (list, extra = {}) => { const actor = { system: { stressBonus: 0, ...extra.system }, items: list, getFlag: (s, k) => extra.flags?.[k] }; for (const item of list) item.parent = actor; return actor; };
  // Power High: Guard 1(T) dearer a level - SSJ2's 2.
  const ssj2 = holding([transformation("super-saiyan-2", { active: true })]);
  const plain = holding([]);
  check("Power High: the Guard's Ki Point Cost 1(T) higher a level (SSJ2: Power High 2)",
    (ssj2.system.effects.slots["defend.guard.kiCost"]?.add ?? 0) - (plain.system.effects.slots["defend.guard.kiCost"]?.add ?? 0), 2 * ssj2.system.tierOfPower);
  // Glowing: its own Square's light.
  const { lightLevelOf } = await import(modUrl("light.mjs"));
  check("Glowing: your Square a Light Level higher, not past Normal (SSJ1 glows)",
    [lightLevelOf({ battlefield: { lightLevel: -2 }, effects: { slots: { "light.glowing": true } } }), lightLevelOf({ battlefield: { lightLevel: 0 }, effects: { slots: { "light.glowing": true } } }),
     holding([transformation("super-saiyan-1", { active: true })]).system.effects.slots["light.glowing"]], [-1, 0, true]);
  // Absorbed Apparel: half the Bonus kept, at most 2(T).
  const absorbed = T.aspectScript({ file: getTrait("aspect-absorbed-apparel"), level: null, params: [],
    items: [{ system: { choices: [{ key: "choice:absorbedBonus", value: "5" }] } }] });
  check("Absorbed Apparel: the highest Bonus it took in, written in", absorbed.includes("combatRolls += min(ceil(5 / 2), 2(T));"), true);
  // Heartbeat: Kaioken (3 levels) from its row.
  const kk = transformation("kaioken", { grade: 1 });
  check("Heartbeat: open with the Stress Bonus at the Requirement - 4 (Kaioken 6: 2), not below it; not with Long Transformation (SSJ3)",
    [T.heartbeatRefused(owner([kk], { system: { stressBonus: 2 } }), kk), T.heartbeatRefused(owner([transformation("kaioken")], { system: { stressBonus: 1 } }), transformation("kaioken")) !== "",
     T.heartbeatRefused(owner([transformation("super-saiyan-3")], { system: { stressBonus: 99 } }), transformation("super-saiyan-3"))], ["", true, "it has no Heartbeat"]);
  const kkIn = transformation("kaioken", { active: true, grade: 1 });
  check("in a Graded one already: a higher Grade, not refused for being in use", T.heartbeatRefused(owner([kkIn], { system: { stressBonus: 99 } }), kkIn), "");
  // Limited: True Angel's 3, entered in Round 1 - said at Round 4.
  const angel = transformation("true-angel", { active: true, choices: [{ key: "choice:enteredRound", value: "fight:1" }] });
  const angelActor = owner([angel]); angelActor.name = "Angel";
  const combatAt = round => ({ id: "fight", round, combatants: { contents: [{ actor: angelActor }] } });
  check("Limited: said at the Round it runs out at (True Angel's 3, entered in Round 1: Round 4), not before",
    [T.limitedNotices(combatAt(3)).length, T.limitedNotices(combatAt(4)).length], [0, 1]);
  // Beyond, Blutz Wave.
  check("Beyond with Holding Back stacks, Blutz Wave with no tail - said",
    [T.aspectWarnings(owner([], { system: { resources: { holdingback: { stacks: 1 } } } }), transformation("autonomous-ultra-instinct")),
     T.aspectWarnings(owner([], { flags: { tailLost: true } }), transformation("oozaru"))],
    ["Beyond: not with Holding Back stacks unless Fully Mastered", "Blutz Wave: you have no tail"]);
  check("Long Transformation's level (SSJ3: 2); Divinity Unleashed's Battle Uniform; Style of Super Saiyan (4) by the burst",
    [T.longTransformationLevel(owner([]), transformation("super-saiyan-3")), String(getTrait("divinity-unleashed").battleUniform).split("|")[1].trim(),
     getTrait("full-power-super-saiyan-style-of-super-saiyan").script.includes("combatRolls += ceil($row.burstBonus / 2);")], [2, "combat-clothing", true]);
}

// --- Heartbeat in the roll windows ------------------------------------------------------------------------------------------------

{
  const owner = (list, stressBonus) => { const actor = { system: { stressBonus }, items: Object.assign(list, { get: id => list.find(each => each.id === id) }), getFlag: () => null };
    for (const item of list) item.parent = actor; return actor; };
  const off = transformation("kaioken", { grade: 1 });
  const offActor = owner([off], 99);
  const on = transformation("kaioken", { active: true, grade: 1 });
  const onActor = owner([on], 99);
  check("Heartbeat's choices: Kaioken not in use, itself; in use at Grade 1, every higher Grade (4-6 its Mastery's, said); none with too low a Stress Bonus",
    [T.heartbeatOptions(offActor).map(o => o.label), T.heartbeatOptions(onActor).map(o => o.value.split(":")[1]), T.heartbeatOptions(owner([transformation("kaioken")], 0)).length],
    [["Kaioken"], ["2", "3", "4", "5", "6"], 0]);
  const CH = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
  check("offered on the Strike, in Respond (Dodge, Defend, a Counter - the Duel), on a Clash's side; taken before the roll",
    [CH.includes('"", { combatRoll: true, heartbeat: true, attackingManeuver: true'), CH.includes('${heartbeatSection(actor, `heartbeat-${actor.id}`)}'),
     CH.includes("      heartbeat: true,\n"), CH.includes("if (chosen.heartbeat) await takeHeartbeat(actor, chosen.heartbeat);"),
     CH.includes("for (const choice of chosen) if (choice?.heartbeat) await takeHeartbeat(choice.actor, choice.heartbeat);")], [true, true, true, true, true]);
}

// --- Metamorphosis: each Stage's choices (the Metamorphosis Forms text box) --------------------------------------------------------

{
  const chose = values => Object.entries(values).map(([key, value]) => ({ key: `choice:${key}`, value }));
  const stages = ["full-suppression", "heavy-suppression", "partial-suppression", "true-form"];
  check("each Stage of Metamorphosis asks a Size, a Tail Attack choice, a Survivor Option and S Evolution Traits on its row",
    stages.map(id => T.rowChoicesOf(transformation(id)).map(choice => choice.key)),
    [["size", "tail", "survivor"], ["size", "tail", "survivor", "evolution1"], ["size", "tail", "survivor", "evolution1", "evolution2"],
     ["size", "tail", "survivor", "evolution1", "evolution2", "evolution3"]]);
  const evolution = traitsOfKind("other", "evolution").filter(trait => !trait.optionOf);
  check("an Evolution Trait choice offers every Evolution Trait, by name",
    (choice => [choice.other, choice.options.length, choice.options.every(option => getTrait(option.value)?.owner === "evolution")])(
      T.rowChoicesOf(transformation("true-form")).find(choice => choice.key === "evolution1")),
    ["evolution", evolution.length, true]);
  check("Size: Small, Medium or Large; the Tail Attack's four or none; Survivor's four Options",
    (choices => [choices[0].options.map(o => o.value), choices[1].options.map(o => o.value), choices[2].options.every(o => getTrait(o.value)?.optionOf === "survivor")])(
      T.rowChoicesOf(transformation("heavy-suppression"))),
    [["small", "medium", "large"], ["none", "elongated", "multiple", "spiked", "heavy"], true]);

  // The Size chosen for the Stage in use is the base Size; another Stage's, or none in use, not.
  const large = transformation("true-form", { active: true, choices: chose({ size: "large" }) });
  const small = transformation("heavy-suppression", { active: false, choices: chose({ size: "small" }) });
  const inTrue = holding([large, small]);
  check("in True Form with Large chosen for it: the base Size is Large (its own script, while in use)",
    [T.inUseScript(large).includes("if (1 == 1) {\n    allow size.base.large;"), inTrue.system.size.key, inTrue.system.size.chosen], [true, "large", "large"]);
  const outside = holding([transformation("true-form", { active: false, choices: chose({ size: "large" }) })]);
  check("out of it: the Size you were built as", [outside.system.size.key], ["medium"]);
  const none = transformation("true-form", { active: true });
  check("nothing chosen for it: nothing written", [T.inUseScript(none).includes("if (1 == 1)"), holding([none]).system.size.key], [false, "medium"]);
  check("a Transformation with no script of its own runs none", T.inUseScript(transformation("kaioken", { active: true })), "");

  // What it replaces while in use: Survivor's Option and the Tail Attack's choice - the Stage in use, not another.
  const heavy = transformation("heavy-suppression", { active: true, choices: chose({ survivor: "sleek-plating", tail: "heavy" }) });
  const partial = transformation("partial-suppression", { active: false, choices: chose({ survivor: "power-plating", tail: "spiked" }) });
  const wanted = T.whileInWanted({ items: [heavy, partial] });
  check("in Heavy Suppression: its Survivor Option and Tail Attack choice wanted, not Partial Suppression's",
    [Object.fromEntries(wanted.options), wanted.tail], [{ survivor: "sleek-plating" }, "heavy"]);
  const unchosenWanted = T.whileInWanted({ items: [transformation("true-form", { active: true })] });
  check("nothing chosen for the Stage in use: nothing replaced", [unchosenWanted.options.size, unchosenWanted.tail], [0, ""]);
  check("out of every Stage: nothing replaced (the ones held put back)",
    (w => [w.options.size, w.tail])(T.whileInWanted({ items: [transformation("true-form", { active: false, choices: chose({ survivor: "dense-plating", tail: "heavy" }) })] })), [0, ""]);
  const T_SRC = fs.readFileSync(path.join(ROOT, "module", "transformations.mjs"), "utf8");
  check("wired: put in place as a Transformation comes into use or leaves it, and as its choice changes in use; held and put back",
    [/hasProperty\(changes, "system\.active"\)\) return;\s*const actor = item\.parent;\s*await syncWhileIn\(actor\);/.test(T_SRC),
     T_SRC.includes("if (choice && item.parent && inUse(item)) await syncWhileIn(item.parent);"),
     T_SRC.includes('await racial.setFlag("dbu-ttrpg", "heldOption", now);'), T_SRC.includes("await changeRacialOption(racial, held, now);"),
     T_SRC.includes('"flags.dbu-ttrpg.heldTail": now'), T_SRC.includes('"system.tailVariant": String(held), "flags.dbu-ttrpg.-=heldTail": null')],
    [true, true, true, true, true, true]);

  // The Evolution Traits chosen for a Stage: had while that Stage is in use, set aside otherwise, gone with it.
  const stage = transformation("partial-suppression", { active: true });
  const elongated = { id: `r${++ids}`, name: "Elongated Tail", type: "racial", flags: { "dbu-ttrpg": { sourceId: evolution[0].id, grantedBy: stage.id,
    rowChoice: "evolution1" } }, system: { script: evolution[0].script, chosen: [] } };
  check("an Evolution Trait chosen for a Stage applies while in it", traitAside(elongated, [stage, elongated], { items: [stage, elongated] }), "");
  stage.system.active = false;
  check("and is set aside out of it", traitAside(elongated, [stage, elongated], { items: [stage, elongated] }), "transformation");
  check("wired: given and taken on its row, gone with the Transformation, and the registry runs a Transformation's own script",
    [T_SRC.includes("if (choice?.other && item.parent) await rowTraitChosen(item, key, value);"),
     T_SRC.includes('|| (each.flags?.["dbu-ttrpg"]?.grantedBy === item.id)).map(each => each.id);'),
     fs.readFileSync(path.join(ROOT, "module", "effects", "registry.mjs"), "utf8").includes("const script = inUseScript(item);")],
    [true, true, true]);
}

// --- Metamorphosis: its Traits' effects (the user's, 2026-11-20) -------------------------------------------------------------------

{
  const stage = (id, system = {}) => transformation(id, system);
  // Suppression of Power (4): 1(T) off the Ki Point Cost in the Full Suppression Stage itself, not in a higher one that inherits it.
  const full = stage("full-suppression", { active: true });
  const inFull = holding([full, traitItem(full, "full-suppression-suppression-of-power")]);
  const fullOff = stage("full-suppression", { active: false });
  const heavy = stage("heavy-suppression", { active: true });
  const inHeavy = holding([fullOff, heavy, traitItem(fullOff, "full-suppression-suppression-of-power")]);
  const tier = inFull.system.tierOfPower;
  check("Suppression of Power (4): 1(T) off Attacking Maneuvers and Unique Abilities in Full Suppression, not in Heavy Suppression",
    [Number(inFull.system.effects.slots["attack.kiCost"]?.add) || 0, Number(inFull.system.effects.slots["unique.kiCost"]?.add) || 0,
     Number(inHeavy.system.effects.slots["attack.kiCost"]?.add) || 0], [-tier, -tier, 0]);
  check("Suppression of Power (5): 1d6(T) on Legend Realized, in any Stage", [Number(inHeavy.system.effects.slots["legend.extraD6"]?.add) || 0],
    [inHeavy.system.tierOfPower]);

  // Suppression of Power (3): said, never refused - and not once Conquered Mutation applies.
  const lock = [fullOff, traitItem(fullOff, "full-suppression-suppression-of-power")];
  const lockActor = { items: lock };
  for (const each of lock) each.parent = lockActor;
  check("Suppression of Power (3): a Transcended Enhancement and an Alternate Form outside the Line said; a Stage of it, nothing",
    [T.lineLockWarnings(lockActor, transformation("lightspeed-mode")).length, T.lineLockWarnings(lockActor, transformation("oozaru")).length,
     T.lineLockWarnings(lockActor, transformation("heavy-suppression")).length, T.lineLockWarnings(lockActor, transformation("kaioken")).length],
    [1, 1, 0, 0]);
  check("and leaving a Stage through the Revert Maneuver said", [T.revertLockWarning(lockActor, [fullOff.id]) !== "", T.revertLockWarning({ items: [] }, [])],
    [true, ""]);
  const trueForm = stage("true-form", { active: true, mastery: 1 });
  const conquered = traitItem(trueForm, "true-form-conquered-mutation");
  const free = { items: [...lock, trueForm, conquered] };
  for (const each of free.items) each.parent = free;
  check("Conquered Mutation (3): in True Form, Mastered, Suppression of Power (3) ignored", [T.lockedLines(free), T.lockedLines(lockActor)],
    [[], ["metamorphosis"]]);
  // Conquered Mutation (2): "All Stages of Metamorphosis gain the Perfect Ki Control Aspect" - Heavy Suppression too.
  const heavyToo = stage("heavy-suppression", { active: false });
  const withHeavy = { items: [trueForm, conquered, heavyToo] };
  for (const each of withHeavy.items) each.parent = withHeavy;
  check("Conquered Mutation (2): Perfect Ki Control on every Stage of the Line - Heavy Suppression's too",
    [T.aspectsOf(heavyToo, withHeavy.items).some(a => a.id === "perfect-ki-control"), T.aspectsOf(trueForm, withHeavy.items).some(a => a.id === "perfect-ki-control")],
    [true, true]);

  // Overwhelming Strike (1)(2): written for the attack's declaration and Wound.
  const strikeTrait = getTrait("heavy-suppression-overwhelming-strike").script;
  check("Overwhelming Strike: Healthy - the Signature Techniques' Damage Category; above Injured - their Wound by it",
    [strikeTrait.includes('if (!belowThreshold("bruised")) {\n    attack.damageCategory.signature += 1;'),
     strikeTrait.includes('if (!belowThreshold("injured")) {\n    wound.signaturePerCategory += 1(T);')], [true, true]);
  const inHeavyHealthy = holding([heavy, traitItem(heavy, "heavy-suppression-overwhelming-strike")]);
  check("and in Heavy Suppression, Healthy: both written", [Number(inHeavyHealthy.system.effects.slots["attack.damageCategory.signature"]?.add) || 0,
    Number(inHeavyHealthy.system.effects.slots["wound.signaturePerCategory"]?.add) || 0], [1, inHeavyHealthy.system.tierOfPower]);

  const CH = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
  const UM = fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8");
  const CB = fs.readFileSync(path.join(ROOT, "module", "combat.mjs"), "utf8");
  const MR = fs.readFileSync(path.join(ROOT, "module", "effects", "moments-runtime.mjs"), "utf8");
  check("wired: the Signature Technique's Category as declared, x(T) on its Wound by it (Standard 1, Direct 2, Lethal 3)",
    [CH.includes('+ ((!reflecting && technique) ? (Number(actor.system.effects?.slots?.["attack.damageCategory.signature"]?.add) || 0) : 0),'),
     CH.includes("const x = DAMAGE_CATEGORIES[resolveDamageCategory(attack.damageCategory, attack.damageCategoryShift ?? 0)]?.value ?? 1;")], [true, true]);
  check("wired: Overwhelm spent - by a script, setResource, Overwhelming Assault, Ruler - heard (overwhelm-spent); a set, Overwhelming Fighter's loss, not",
    [MR.includes('!overwhelmParts.some(part => part.op === "set")'), MR.includes('answerFor(actor, "overwhelm-spent", { spent: spentOverwhelm })'),
     CH.includes('if ((name === "overwhelm") && !lost && (capped < before)) await answerFor(actor, "overwhelm-spent", { spent: before - capped });'),
     CH.includes('if (had > left) await answerFor(actor, "overwhelm-spent", { spent: had - left });'),
     CH.includes('await answerFor(actor, "overwhelm-spent", { spent: 2 });'),
     CH.includes('await answerFor(actor, "overwhelm-transformation", { spent: spentOverwhelm });')], [true, true, true, true, true, true]);
  check("wired: Overwhelming Mutant (3)(4) asked before the turn's end loses the Overwhelm, what is kept put back after it",
    [/const keptOverwhelm = await overwhelmAtTurnEnd\(leaving\);\s*await fireMoment\(leaving, "end-of-turn"\);\s*if \(keptOverwhelm\) await overwhelmKept\(leaving, keptOverwhelm\);/.test(CB)],
    [true]);
  check("wired: a Maneuver priced in stacks refused without them and paid as it is used; the Basic Attack made through it carried",
    [UM.includes("spends ${Number(costCount) || 1} stacks of ${costName} - ${actor.name} has not got them."),
     UM.includes("await setResource(actor, costName, Math.max(0,"),
     CH.includes("...((maneuver.madeThrough && !reflecting) ? { madeThrough: maneuver.madeThrough } : {}),"),
     CH.includes("...(attack.madeThrough ? { madeThrough: attack.madeThrough } : {}) });")], [true, true, true, true]);
  check("wired: Coup de Grace (4) asked as the Wound is rolled, every Damage Reduction ignored; Legend Realized's d6",
    [CH.includes("attack = { ...attack, ...(await beyondLethalPierce(attacker, attack)) };"),
     CH.includes("|| Boolean(attack.ignoresDamageReduction);"), CH.includes('${d6 ? ` + ${d6}d6` : ""}')], [true, true, true]);
  check("the two Maneuvers: Special, an Instant once a Round, 2 Overwhelm",
    ["coup-de-grace-strike", "mutants-resilience-counter"].map(id => (m => [m?.type, m?.special, m?.usageLimit, m?.stacksCost])(getTrait(id))),
    [["instant", true, "1/round", "overwhelm 2"], ["instant", true, "1/round", "overwhelm 2"]]);
  const COUP_RESOURCES = (await import(modUrl("effects/traits.mjs"))).resourceDefinitions();
  check("Coup de Grace (3): three Resources, one per Combat Roll, gone on leaving the Superior State",
    [[].concat(getTrait("partial-suppression-coup-de-grace").resource).join(","), getTrait("partial-suppression-coup-de-grace").script.includes("[automatic/left-state/superior, effect 3]"),
     ["coupstrike", "coupdodge", "coupwound"].map(name => COUP_RESOURCES[name]?.max ?? null)],
    ["coupstrike,coupdodge,coupwound", true, [1, 1, 1]]);
}

// --- Appointed God: Divine Role, Cosmic Flow, Divine Entity, True Divinity (the table's, built) -------------------------------------

{
  const sup = transformation("suppressed-divinity", { active: true });
  const role = traitItem(sup, "suppressed-divinity-divine-role");
  role.system.chosen = [{ key: "suppressed-divinity-divine-role", value: "divine-flex" }, { key: "suppressed-divinity-divine-role#2", value: "god-bind" }];
  const alone = holding([sup, role]);
  const T1 = alone.system.tierOfPower;
  const sum = (actor, key) => (actor.system.effects.slots[key]?.parts ?? []).filter(part => /Divine Role|Cosmic Flow/.test(part.source ?? part.sourceName ?? ""))
    .reduce((total, part) => total + (Number(part.value) || 0), 0);
  check("Divine Role (3): no Ally near - Wound and Soak 1(T); its aura on, for the Allies near (allyRolls)",
    [sum(alone, "wound"), sum(alone, "soakValue"), alone.system.effects.slots["divineRole.aura"] === true], [T1, T1, true]);
  const supOff = transformation("suppressed-divinity", { active: false });
  const du = transformation("divinity-unleashed", { active: true, mastery: 2 });
  const role2 = traitItem(supOff, "suppressed-divinity-divine-role");
  role2.system.chosen = role.system.chosen;
  const inDu = holding([supOff, du, role2, traitItem(du, "divinity-unleashed-cosmic-flow"), traitItem(du, "divinity-unleashed-god-of-a-domain"),
    traitItem(du, "divinity-unleashed-divine-entity"), traitItem(du, "divinity-unleashed-true-divinity")]);
  const T2 = inDu.system.tierOfPower;
  check("in Divinity Unleashed: the Sphere Huge, Divine Role's half written once (Cosmic Flow (2)), Divine Ki half again",
    [sum(inDu, "wound"), inDu.system.effects.slots["divineRole.huge"] === true, inDu.system.effects.slots["divineKi.halfMore"] === true],
    [T2, true, true]);
  check("Cosmic Flow (1)(3)(4)(5), Divine Entity (2), True Divinity (2): written",
    [inDu.system.effects.slots["exploit.alliesTargeted"], Number(inDu.system.effects.slots["attack.divineKiCost"]?.add), inDu.system.effects.slots["wound.halfDivineWager"],
     inDu.system.effects.slots["cosmicFlow.recovery"], inDu.system.effects.slots["cosmicFlow.whole"], inDu.system.effects.slots["combatRecovery.counterActions"]],
    [true, -2 * T2, true, true, true, true]);
  const CR = getTrait("combat-recovery").script;
  check("Combat Recovery: Cosmic Flow (5)'s Divine Ki, (6)'s doubling and its mark spent",
    [CR.includes('divineKi.value += (flagged("cosmicFlow.whole") ? surgency : floor(surgency / 2)) * (hasCondition("recovery-doubled") ? 2 : 1);'),
     (CR.match(/\* \(hasCondition\("recovery-doubled"\) \? 2 : 1\);/g) ?? []).length, CR.includes("remove(recovery-doubled);")], [true, 4, true]);
  const SRC = name => fs.readFileSync(path.join(ROOT, "module", ...name.split("/")), "utf8");
  check("wired: Counter Actions spent heard; Divine Ki's discount paid; Divine Role (5)'s Combat Recovery shut; True Divinity asked; Ascended Divine Magic's Clash",
    [SRC("combat.mjs").includes('await answerFor(actor, "counter-spent", { spent: amount, counterTotal:'),
     SRC("maneuvers.mjs").includes('DIVINE_PAID.set(`${actor.uuid}:${maneuver.id ?? maneuver.name}`, { cost: paid, capacity: halved });'),
     SRC("use-maneuver.mjs").includes("used Divine Role's Basic Attack this Round: no Combat Recovery till the next."),
     SRC("use-maneuver.mjs").includes('"Counter Actions spent as Actions (True Divinity)"'),
     SRC("chat.mjs").includes("...vsOpponentClashBonus(actor, clash, uuid),"), SRC("chat.mjs").includes("await guardianOffers(card, actor, [target, ...(extraTargets ?? [])]);")],
    [true, true, true, true, true, true]);
}

// --- Divinity Unleashed: the Domain Maneuvers (God of a Domain (3)) -------------------------------------------------------------------

{
  const du = transformation("divinity-unleashed", { active: true });
  const magic = { id: `r${++ids}`, name: "Divine Magic", type: "racial", flags: { "dbu-ttrpg": { sourceId: "divine-magic" } },
    system: { script: getTrait("divine-magic").script, chosen: [{ key: "option", value: "god-of-peace" }] } };
  const peace = holding([du, traitItem(du, "divinity-unleashed-god-of-a-domain"), magic]);
  check("God of a Domain (3): the Domain Maneuver of Divine Magic's Option open - God of Peace's Divine Peace, no other",
    ["divine-peace", "divine-weapon", "freeze-attack"].map(id => peace.system.effects.slots[`maneuver.${id}`] === true), [true, false, false]);
  const M = await import(modUrl("maneuvers.mjs"));
  check("the ten Domain Maneuvers, God Maneuvers; Divine Peace and Divine Muscle answered in Respond, Divine Healing only after the Damage",
    [["divine-peace", "divine-judgement", "divine-muscle", "divine-healing", "divine-wisdom", "divine-weapon", "divine-spell", "divine-summoning",
      "freeze-attack", "divine-element"].every(id => getTrait(id)?.godManeuver === true),
     getTrait("divine-peace").divinePeace, getTrait("divine-muscle").divineMuscle, getTrait("divine-healing").afterDamage],
    [true, true, true, true]);
  const CH = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
  check("wired: Respond's Divine Peace and Divine Muscle; Judgement and Healing offered once the Damage is taken; a God Maneuver paid as its offer is "
    + "taken; Divine Muscle's Category and Soak; the Damage Attribute again",
    [CH.includes("if (maneuver.divinePeace) return playDivinePeace(message, actor, maneuver);"),
     CH.includes("if (maneuver.divineMuscle) return playDivineMuscle(message, actor, maneuver);"),
     CH.includes("offerDomainAfterDamage(message, target, armsUser, damage);"),
     CH.includes("if (cost && !await spendManeuverCost(actor, { ...(god ?? {}), id: god?.id ?? offer.grants.godCost.id, godManeuver: true }, cost)) return;"),
     CH.includes('damageCategory: defenceFor(attack, uuid)?.divineMuscle?.standard ? "standard"'), CH.includes("+ exoSoak + muscleSoak"),
     CH.includes("const again = Math.max(0, Number(attack.damageAttributeAgain) || 0);"), CH.includes("&& !maneuver.afterDamage);")],
    [true, true, true, true, true, true, true, true]);
}

// --- Divinity Unleashed: the Domain Traits (True God of ...) - what was the table's ----------------------------------------------------

{
  const du = transformation("divinity-unleashed", { active: true, scales: 1 });
  const traits = ["peace", "wisdom", "many", "war", "an-element"].map(name => traitItem(du, `divinity-unleashed-true-god-of-${name}`));
  const actor = holding([du, ...traits]);
  actor.system.states = { ...(actor.system.states ?? {}), mindful: 2 };
  const again = holding([du, ...traits]);
  const T = again.system.tierOfPower;
  const sourced = (who, key, name) => (who.system.effects.slots[key]?.parts ?? []).filter(part => (part.source ?? part.sourceName ?? "").includes(name))
    .reduce((sum, part) => sum + (Number(part.value) || 0), 0);
  check("True God of Wisdom (2): Scholarship and Personality as its Magic - 4(T), and 1(T) a Higher Scale",
    [sourced(again, "scholarship.mod", "True God of Wisdom"), sourced(again, "personality.mod", "True God of Wisdom")], [5 * T, 5 * T]);
  check("True God of Many (2)(3)(5)(6), War (3)(4)(5), an Element (3)(4): written",
    [Number(again.system.effects.slots["minions.combatRolls"]?.add) >= 2 * T, again.system.effects.slots["minions.shareCounter"], again.system.effects.slots["summoning.powerUp"],
     again.system.effects.slots["divineArmament"], again.system.effects.slots["materialize.freeWeapon"], again.system.effects.slots["divineWeapon.damageTwice"],
     again.system.effects.slots["favored.double"], Number(again.system.effects.slots["divine-element.kiCost"]?.add)],
    [true, true, true, true, true, true, true, -2 * again.system.baseTierOfPower]);
  check("True God of an Element (6): its two Options - God of the Elements (three Elemental Profiles), God of Focus",
    [getTrait("true-god-of-an-element-god-of-the-elements")?.optionOf, getTrait("true-god-of-an-element-god-of-the-elements")?.choose3,
     getTrait("true-god-of-an-element-god-of-focus")?.script.includes("allow divineFocus.$choice;")],
    ["divinity-unleashed-true-god-of-an-element", "elementalProfile", true]);
  const peace = getTrait("divinity-unleashed-true-god-of-peace").script;
  check("True God of Peace: L the Mindful level - (4) its Wound back, (5) Strike and Dodge, (6) Divine Peace cheaper, (7) back to Calm, (8) a level up",
    [peace.includes("wound += states.mindful * 1(T);"), peace.includes("strike += states.mindful * 1(T);"), peace.includes("divinePeace.costOff += states.mindful * 1(T);"),
     peace.includes("setStateLevel(mindful, 1);"), peace.includes("enterState(mindful, 1);")], [true, true, true, true, true]);
  const CH = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
  const CB = fs.readFileSync(path.join(ROOT, "module", "combat.mjs"), "utf8");
  check("wired: Favored Element doubled; Divine Armament on Strike and Wound; Magic's Round; Time's Damage Attribute lent; a Minion on its Master's Counter Actions; "
    + "the Divine Focus's Magnitude; the borrowed Unique Ability gone with the Form",
    [CH.includes('* ((attacker.system.effects?.slots?.["favored.double"] === true) ? 2 : 1);'), CH.includes("const armament = armamentFormula(attacker, attack);"),
     CH.includes('label: "Divine Armament", formula: armamentFormula(attacker, attack)'), CH.includes("True God of Magic (a Magical Unique Ability this Round)"),
     CH.includes("Damage Attribute (True God of Time)"), CB.includes('(master.system?.effects?.slots?.["minions.shareCounter"] === true)'),
     CH.includes("+ ((actor.system.effects?.slots?.[`divineFocus.${profile}`] === true) ? 1 : 0))),"),
     fs.readFileSync(path.join(ROOT, "module", "transformations.mjs"), "utf8").includes('each.flags?.["dbu-ttrpg"]?.whileIn === item.id')],
    [true, true, true, true, true, true, true, true]);
}

// --- Full Power Super Saiyan, Class Up (3): what was the table's ----------------------------------------------------------------------

{
  const fp = transformation("full-power-super-saiyan", { active: true });
  const actor = holding([fp, traitItem(fp, "full-power-super-saiyan-true-power-of-the-saiyan-race"), traitItem(fp, "full-power-super-saiyan-all-out-super-saiyan"),
    traitItem(fp, "full-power-super-saiyan-full-power-of-the-super-saiyan"), traitItem(fp, "full-power-super-saiyan-style-of-super-saiyan")]);
  check("True Power (1) and All-Out (3): Power read as Battle Born on the Wound, All-Out Power as Power (stacksAlso)",
    actor.system.stacksAlso, { battlebornwound: ["power"], power: ["allout"] });
  const A = await import(modUrl("effects/amounts.mjs"));
  const read = (path, resources) => A.resolveAmount({ type: "path", path }, { data: { ...actor.system, resources }, errors: [] });
  check("and read so: Battle Born (Wound) 1 + Power 2; Power 1 + All-Out Power 1",
    [read("battlebornwound.stacks", { battlebornwound: { stacks: 1 }, power: { stacks: 2 } }), read("power.stacks", { power: { stacks: 1 }, allout: { stacks: 1 } })], [3, 2]);
  check("All-Out Super Saiyan (4): a level of Draining a stack of All-Out Power",
    [String(getTrait("full-power-super-saiyan-all-out-super-saiyan").grantsAspectTo).split(";").length, getTrait("full-power-super-saiyan-all-out-super-saiyan").resource],
    [3, "allout"]);
  check("Full Power of the Super Saiyan (3)(4) on; (1) the Duel Clash",
    [actor.system.effects.slots["battleBorn.reduction"], actor.system.effects.slots["battleBorn.wound"], getTrait("full-power-super-saiyan-full-power-of-the-super-saiyan").script.includes("clash.duel +=")],
    [true, true, true]);
  check("the Instants: Back to Basics, Pinnacle of Legacy, Limit of the Super Saiyan (two), Greater Super Class, Class Up's three",
    ["back-to-basics-power-up", "pinnacle-of-legacy-power-up", "limit-of-the-super-saiyan-recovery", "limit-of-the-super-saiyan-surge", "greater-super-class-choice",
      "class-up-hero-choice", "class-up-elite-choice", "class-up-berserker-choice"].map(id => [getTrait(id)?.type, getTrait(id)?.special]),
    Array(8).fill(["instant", true]));
  const CH = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
  check("wired: Battle Born on the hit and on the Damage Reduction, owed and lost as the attack concludes",
    [CH.includes('const bornWound = await battleBornAsked(attacker, "battleBorn.wound", "your Wound Roll");'),
     CH.includes('await battleBornAsked(target, "battleBorn.reduction", "your Damage Reduction")'), (CH.match(/await settleOwedBattleBorn\(attack\);/g) ?? []).length],
    [true, true, 2]);
}

// --- Perfection: what was the table's -------------------------------------------------------------------------------------------

{
  const pf = transformation("perfection", { active: true, stacks: 2 });
  const ids = ["critical-perfection", "genetic-zenkai", "junior-creation", "perfect-defense", "perfect-offense", "perfect-guard",
    "long-awaited-perfection", "karyon-core", "a-semi-perfect-step-forward"];
  const actor = holding([pf, ...ids.map(id => traitItem(pf, `perfection-${id}`))]);
  const S = actor.system.effects.slots;
  const TT = actor.system.tierOfPower;
  check("Critical Perfection (1)(2), Perfect Defense (2), Perfect Offense (2), Junior Creation (2): written",
    [Number(S["critical.rollBonus"]?.add), Number(S["combatRoll.naturalUp"]?.add), S["basicAttack.adaptationDodge"], S["adaptation.ultimateCharge"],
     S["maneuver.junior-creation"]], [TT, 1, true, true, true]);
  const jr = getTrait("junior-creation");
  check("Junior Creation's Maneuver: a Special one, 1-3 Actions, 4(bT) Ki each", [jr?.special, jr?.actionCostMax, jr?.kiCostPerBaseTier, jr?.kiPerAction,
    jr?.script.includes("smallDuplicates();")], [true, 3, 4, true, true]);
  const script = id => getTrait(`perfection-${id}`).script;
  check("Genetic Aggressor / Agility (4) offered with their Adaptation Points; Genetic Zenkai (2) on defeat-escaped; Karyon Core (2); "
    + "Long-Awaited Perfection (4); Perfect Guard (2)",
    [script("a-semi-perfect-step-forward").includes("adaptationOffer(basic-attack, 2, atTarget);"),
     script("a-semi-perfect-step-forward").includes("adaptationOffer(movement, 1, noExploit);"),
     script("genetic-zenkai").includes("[triggered/defeat-escaped, 1/encounter, effect 2]"), getTrait("perfection-genetic-zenkai").resource,
     script("karyon-core").includes("surgeRevive();"), script("long-awaited-perfection").includes("actions.remaining += 1;"),
     script("perfect-guard").includes("damageReduction += floor(soakValue / 2);")], [true, true, true, "geneticzenkai", true, true, true]);
  const CH = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
  const CB = fs.readFileSync(path.join(ROOT, "module", "combat.mjs"), "utf8");
  check("wired: the Critical's 1(T), the Natural Result up (NUDGERS), Perfect Offense on the Wound, Perfect Defense on the card, "
    + "the Damage an attack dealt, defeat-escaped (both places), the Healing Surge as the turn starts",
    [CH.includes('label: "On a Critical Result", value: onCritical'), CH.includes('slot: "combatRoll.naturalUp", roll: "Combat Roll", steps: [1],'),
     CH.includes('label: "Energy Charge (Perfect Offense)", formula: oneCharge'), CH.includes("ultimateRoll: Boolean(attack.technique?.ultimate"),
     CH.includes("if (!result.wound && adaptationDodgeButtons(message, container, attack)) return;"),
     CH.includes("[`flags.${SCOPE}.lastAttackDamage`]: { damage: Number(damage) || 0, round: roundKey() },"),
     CH.includes('if (keyword.length) await answerFor(actor, "defeat-escaped", {});'), CB.includes('if (!silenced) await answerFor(actor, "defeat-escaped", {});'),
     CB.includes('takeSurge(actor, { source: "Karyon Core", kind: "healing", forceUp: true })')], Array(9).fill(true));
}

// --- Evil Aura, Evil Saiyan: what was the table's -------------------------------------------------------------------------------

{
  const ea = transformation("evil-aura", { active: true, grade: 2 });
  const traits = ["villainous-form", "power-of-evil", "controlled-darkness"].map(id => traitItem(ea, `evil-aura-${id}`));
  const actor = holding([ea, ...traits]);
  const S = actor.system.effects.slots;
  const TT = actor.system.tierOfPower;
  check("Villainous Form (2)(4), Power of Evil (2)(3): written", [S["maneuver.darkness-mixer"], Number(S["wound.tenthWager"]?.add), S["evilPoints.onWound"],
    S["evilPoints.onReduction"]], [true, 2 * TT, true, true]);
  const vf = getTrait("evil-aura-villainous-form");
  check("Villainous Form (1)(3): the Evil Techniques' Force or Magic, half their Ki Point Cost in Evil Points", [vf.givenTechniqueAttribute, vf.givenTechniquePaidWith],
    ["force/magic", "evilpoints"]);
  const dm = getTrait("darkness-mixer");
  check("Darkness Mixer: a Special Modifier on the Power Up, its Clash", [dm?.type, dm?.baseManeuver, dm?.special, dm?.script.includes("areaClash(might, standard, halfMight);")],
    ["modifier", "power-up", true, true]);
  const es = transformation("evil-saiyan", { active: true, transcended: true, mastery: 2 });
  const own = ["dark-saiya-power", "focused-evil", "evil-of-legend", "overwhelming-evil-power"].map(id => traitItem(es, `evil-saiyan-${id}`));
  const saiyan = holding([es, ...own]);
  const SS = saiyan.system.effects.slots;
  check("Dark Saiya Power (3)(4), Focused Evil (2), Evil of Legend (5): written; alone, no Saiyan Transformation beside it",
    [SS["maneuver.dark-saiya-evil-points"], SS["berserk.clash"], SS["surging.noFatigue"], SS["burst.battleBorn"], getTrait("evil-saiyan-dark-saiya-power").stressBeside],
    [true, true, true, true, "saiyan 3"]);
  const T2 = await import(modUrl("transformations.mjs"));
  const ss1 = transformation("super-saiyan-1", { active: true });
  const beside = holding([es, ss1, ...own]);
  check("beside Super Saiyan 1: its Stress Test Requirement 3 lower, the Extra Dice a Category up", [T2.stressTakenOff(es, beside.items) - T2.stressTakenOff(es, saiyan.items),
    Number(beside.system.effects.slots["dice.extra.category"]?.add || 0) - Number(SS["dice.extra.category"]?.add || 0)], [3, 1]);
  const script = getTrait("evil-saiyan-evil-of-legend").script;
  check("Evil of Legend (4): its own id written in", [script.includes("stopTranscended($self);")], [true]);
  const CH = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
  check("wired: Evil Points on the Wound and the Damage Reduction, spent heard; the area Clash settled; Berserk's Clash; Battle Born for Evil Points",
    [CH.includes('const evilWound = await evilPointsAsked(attacker, "evilPoints.onWound", "the Wound Roll");'), CH.includes("+ bornReduction + evilReduction"),
     CH.includes('await answerFor(actor, "evil-points-spent", { spent: before - capped });'), CH.includes("await settleWinEffects(message, clash);"),
     CH.includes("await berserkClash(target, armsUser, attack);"), CH.includes('if (then === "evil-points") {')], Array(6).fill(true));
}

// --- Autonomous Ultra Instinct, True Angel: what was the table's ----------------------------------------------------------------

{
  const aui = transformation("autonomous-ultra-instinct", { active: true, mastery: 1 });
  const ids = ["angelic-instinct", "angelic-technique", "angelic-trumpets", "in-the-realm-of-angels", "sharpened-instinct"];
  const alone = holding([aui, ...ids.map(id => traitItem(aui, `autonomous-ultra-instinct-${id}`))]);
  const ss3 = transformation("super-saiyan-3", { active: true });
  const beside = holding([aui, ss3, ...ids.map(id => traitItem(aui, `autonomous-ultra-instinct-${id}`))]);
  const S = alone.system.effects.slots;
  const B = beside.system.effects.slots;
  const bT = beside.system.baseTierOfPower;
  check("Angelic Technique (2)(3) and Sharpened Instinct (3): alone the least Natural Result 3, no Combat Rolls; beside Super Saiyan 3 (4+) "
    + "5 and Combat Rolls 2(bT); In the Realm (1), Sharpened (2)",
    [Number(S["strikeDodge.minimumNatural"]?.add), Number(B["strikeDodge.minimumNatural"]?.add),
     (B["strike"]?.parts ?? []).filter(part => String(part.source ?? part.sourceName ?? "").includes("Angelic Technique")).reduce((sum, part) => sum + (Number(part.value) || 0), 0),
     S["exploit.onlyGuardDown"], S["mindful.tranquilInstead"]], [3, 5, 2 * bT, true, true]);
  const ta = transformation("true-angel", { active: true });
  const angel = holding([ta, traitItem(ta, "true-angel-law-defying-battle")], { powerLevel: 12 });
  const TS = angel.system.effects.slots;
  check("Law-Defying Battle (2) base Tier of Power 8, (4) (7) written", [angel.system.baseTierOfPower, TS["hit.notHitOnce"], TS["superProfileOffer.completeAnnihilation"]],
    [8, true, true]);
  const CH = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
  const UM = fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8");
  check("wired: the least Natural Result, the Exploit gate, Angelic Trumpets' dodge, not hit on the card, Determined for an attack, Complete Annihilation",
    [CH.includes('actor?.system?.effects?.slots?.["strikeDodge.minimumNatural"]?.add'), CH.includes('slots?.["exploit.onlyGuardDown"] === true'),
     CH.includes("if (evadesAll) {"),
     CH.includes("if (!result.wound && notHitButtons(message, container, attack)) return;"),
     UM.includes('declared = { ...declared, autoHit: true, determinedNow: true };'), UM.includes("const annihilating = await grantedSuperProfile(actor, maneuver, declared);")],
    Array(6).fill(true));
}

// --- Kaioken, Lightspeed Mode, Doping, Giant Form: what was the table's ---------------------------------------------------------

{
  const ka = transformation("kaioken", { active: true, grade: 2 });
  const kaioken = holding([ka, ...["crimson-sacrifice", "exponential-power"].map(id => traitItem(ka, `kaioken-${id}`))]);
  const ls = transformation("lightspeed-mode", { active: true, grade: 2, mastery: 1 });
  const light = holding([ls, ...["gear-shift", "ftl", "speed-star"].map(id => traitItem(ls, `lightspeed-mode-${id}`))]);
  const dp = transformation("doping", { active: true });
  const doping = holding([dp, traitItem(dp, "doping-dangerous-amplification")]);
  const KS = kaioken.system.effects.slots, LS = light.system.effects.slots, DS = doping.system.effects.slots;
  check("Crimson Sacrifice (1), Exponential Power (1); Gear Shift (2), FTL (4), Speed Star (1); Dangerous Amplification (2)(3): written",
    [KS["life.noRegain"], KS["maneuver.movement-instant"], Number(LS["dice.extra.strike.category"]?.add), Number(LS["dice.extra.dodge.category"]?.add),
     LS["movement.provokes"]?.forbid ?? LS["movement.provokes"], LS["maneuver.movement-or-basic-instant"], DS["lifeOnWound.upToKiCost"], DS["maneuver.amplified-power-up"]],
    [true, true, 2, 2, false, true, true, true]);
  check("the instants: core Special Maneuvers of no Action", ["movement-instant", "movement-or-basic-instant", "amplified-power-up"]
    .map(id => [getTrait(id)?.type, getTrait(id)?.special, Number(getTrait(id)?.actionCost)]), Array(3).fill(["instant", true, 0]));
  const CB = fs.readFileSync(path.join(ROOT, "module", "combat.mjs"), "utf8");
  const TM = fs.readFileSync(path.join(ROOT, "module", "transformations.mjs"), "utf8");
  check("wired: no Life Points regained but by force or Scarlet Multiplier; Power and Payment as it is left",
    [CB.includes('if (!isCharacter(actor) || options.dbuForceUp || options.dbuRegainAnyway) return;'),
     TM.includes('const owed = Array.from(actor.getFlag?.("dbu-ttrpg", "paymentOnLeave") ?? []);')], [true, true]);
  // Scarlet Multiplier (the user's, 2026-11-21): three buttons on the entering card, one used, the others gone; the regain with it.
  {
    const { collectReactive } = await import(modUrl("effects/interpreter.mjs"));
    const { compile } = await import(modUrl("effects/parser.mjs"));
    const ka2 = transformation("kaioken", { active: true, grade: 2 });
    const who = holding([ka2, traitItem(ka2, "kaioken-scarlet-multiplier")], { powerLevel: 6 });
    const script = getTrait("kaioken-scarlet-multiplier").script.replaceAll("$G", "2");
    const { program } = compile(script, who.system);
    const scope = { data: who.system, errors: [], context: {}, queue: [] };
    collectReactive([{ program, priority: 4, sourceId: "sm", sourceName: "Scarlet Multiplier", level: 0, stacks: 1, armed: true, available: true }],
      "transform", scope, { mode: "triggered" });
    const [regain = {}, call = {}] = scope.queue;
    const CH = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
    check("Scarlet Multiplier, ticked on the entering card: 5 x 3(bT) Life and Ki then, and the Power Up, Movement or Basic Attack offered there",
      [regain.verb, regain.args, call.verb, call.args, call.use?.name, CH.includes("if (offer.oneOf && taken.includes(offer.actorUuid)) continue;"),
       CH.includes("if (offer.oneOf) return takeOneOf(message, actor, offer.oneOf);"), CH.includes('fireMoment(actor, "transform", { ...transformContext, cardId: card.id });')],
      ["regainAnyway", [15 * Math.max(1, who.system.baseTierOfPower), 15 * Math.max(1, who.system.baseTierOfPower)],
       "offerOneOf", ["power-up", "movement", "basic-attack"], "Scarlet Multiplier", true, true, true]);
    // And every other Triggered/Transform that hands over a Maneuver out of sequence: a button on that card, as it is activated.
    const offersOf = id => (getTrait(id)?.script ?? "").match(/offerOneOf\(([^)]*)\)/)?.[1] ?? "";
    check("the other Burst Limits and Transform effects: their out-of-sequence Maneuvers buttons on the entering card",
      ["enraged-unleashed-rage", "evil-aura-dark-power-rising", "lightspeed-mode-lightspeed-assault", "seething-fury-you-must-die-by-my-hand",
       "full-power-super-saiyan-all-out-super-saiyan", "divinity-unleashed-true-god-of-wisdom"].map(offersOf),
      ["basic-attack", "power-up", "movement", "basic-attack, signature-technique", "power-up", "any-special"]);
    // Giant's Vantage and Unsealed Instinct (the user's, 2026-11-22): built, so they are ticked on the entering card too.
    const queueOf = (traitId, G) => {
      const { program } = compile(getTrait(traitId).script.replaceAll("$G", String(G)), who.system);
      const q = { data: who.system, errors: [], context: {}, queue: [] };
      collectReactive([{ program, priority: 4, sourceId: "x", sourceName: "X", level: 0, stacks: 1, armed: true, available: true }], "transform", q,
        { mode: "triggered" });
      return q.queue.map(call => [call.verb, call.args]);
    };
    const linkedWith = stacks => {
      const ta = transformation("true-angel", { active: true });
      const trait = traitItem(ta, "true-angel-unsealed-instinct");
      const owner = { system: { resources: { unsealed: { stacks } } }, items: [ta, trait] };
      ta.parent = owner; trait.parent = owner;
      return T.aspectsOf(ta, owner.items).find(each => each.id === "linked")?.params ?? null;
    };
    const gn = transformation("great-namekian", { active: true, grade: 2 });
    const vantage = holding([gn, traitItem(gn, "great-namekian-giants-vantage")], { powerLevel: 6 });
    const drOf = actor => (actor.system.effects.slots["damageReduction"]?.parts ?? []).find(part => String(part.source ?? "").includes("Giant's Vantage"));
    check("Giant's Vantage: every other Character Studied; Unsealed Instinct: Autonomous Ultra Instinct entered as Linked, the Aspect while marked",
      [queueOf("great-namekian-giants-vantage", 2), queueOf("true-angel-unsealed-instinct", 1), linkedWith(1), linkedWith(0), drOf(vantage) ?? null,
       fs.readFileSync(path.join(ROOT, "module", "transformations.mjs"), "utf8").includes('each.flags?.["dbu-ttrpg"]?.whileIn === item.id')],
      [[["expires", ["giantsvantage", "next-turn"]], ["studyAll", []]], [["expires", ["unsealed", "encounter"]], ["enterLinked", ["autonomous-ultra-instinct"]]], ["Autonomous Ultra Instinct"], null, null, true]);
  }
}

// --- Drunken Fist, Feral Fist, Wrathful, Enraged, Seething Fury: what was the table's -------------------------------------------

{
  const df = transformation("drunken-fist", { active: true });
  const drunk = holding([df, ...["power-of-the-bottle", "unpredictable-combat"].map(id => traitItem(df, `drunken-fist-${id}`))]);
  const wr = transformation("wrathful", { active: true, grade: 2 });
  const wrath = holding([wr, traitItem(wr, "wrathful-compressed-oozaru")]);
  const en = transformation("enraged", { active: true, mastery: 1 });
  const rage = holding([en, traitItem(en, "enraged-directed-anger")]);
  const DS = drunk.system.effects.slots;
  check("Unpredictable Combat (2)(3)(6), Power of the Bottle (4); Compressed Oozaru (2); Directed Anger (1): written",
    [Number(DS["critical.rollBonus"]?.add), DS["dodge.botchCritical"], DS["exploit.mayDecline"], DS["stacksOnRoll.toppling"],
     Number(wrath.system.effects.slots["punchingDown.sizeSteps"]?.add), rage.system.effects.slots["conditions.guardDownHidden"]],
    [drunk.system.tierOfPower, true, true, true, 2, true]);
  const CH = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
  check("wired: stacks spent on a roll, Toppling carried to the Wound, every attack's Damage Category, Punching Down's Size",
    [CH.includes("const stacked = (collect && combatRoll) ? await stacksOnRoll(actor, slot, attackingManeuver) : null;"),
     CH.includes("strikeToppled: Number(attack.result?.strike?.toppled) || 0,"), CH.includes('slots?.["attack.damageCategory.all"]?.add'),
     CH.includes('slots?.["punchingDown.sizeSteps"]?.add')], [true, true, true, true]);
}

// --- Any Counter Maneuver without its Counter Action (counter-maneuver, counter.free) ---------------------------------------------

{
  const CH = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
  const UM = fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8");
  check("every Counter Maneuver paid through payCounter - none left paying its Action Cost straight; the Defend with its Option; from the sheet too",
    [(CH.match(/spendActions\(\w+, maneuver\.actionCost \?\? \d, "counter"\)/g) ?? []).length, (CH.match(/payCounter\(/g) ?? []).length >= 21,
     CH.includes("const freed = !free && await counterFree(target, defend0(), 1, { defence: chosen.defence });"),
     UM.includes('await (await import("./chat.mjs")).payCounter(actor, maneuver,')], [0, true, true, true]);
  const C = await import(modUrl("effects/conditions.mjs"));
  const P = await import(modUrl("effects/parser.mjs"));
  const req = P.compile(`[triggered/counter-maneuver]
requires counterManeuver("defend") && defendingWith("crossCounter");
allow counter.free;`).program.blocks[0].requires;
  const holds = context => Boolean(C.evaluate(req, { data: {}, errors: [], context }));
  check("counterManeuver and defendingWith: the Defend with Cross Counter (however written) - not with Direct Hit, not another Maneuver",
    [holds({ maneuverId: "defend", defence: "crossCounter" }), holds({ maneuverId: "defend", defence: "Cross Counter" }),
     holds({ maneuverId: "defend", defence: "directHit" }), holds({ maneuverId: "sudden-stop" })], [true, true, false, false]);
  check("the four that were the table's: Accelerated Growth (3), Frenzied Assault (4), Mind over Monkey (3), Unpredictable Combat (5)",
    ["giant-form-accelerated-growth", "enraged-frenzied-assault", "wrathful-mind-over-monkey", "drunken-fist-unpredictable-combat"]
      .map(id => getTrait(id)?.script.includes("allow counter.free;")), [true, true, true, true]);
}

// --- Time Power: what was the table's -------------------------------------------------------------------------------------------

{
  const tp = transformation("time-power", { active: true, mastery: 1 });
  const actor = holding([tp, ...["time-control", "the-frozen-time", "dominion-over-time", "time-has-stopped"].map(id => traitItem(tp, `time-power-${id}`))]);
  const S = actor.system.effects.slots;
  const TT = actor.system.tierOfPower;
  check("Time Control (1)(3), The Frozen Time (1)(3), Dominion Over Time (2)(3): written",
    [S["profile.time"], S["multiProfile.time"], Number(S["combatRolls.vsSlowed"]?.add), Number(S["timeFreeze.extraAction"]?.add),
     Number(S["time-seal.kiCost"]?.add), Number(S["time-reversion.kiCost"]?.add), S["multiProfile.timeMore"]],
    [true, true, TT, 1, -2 * TT, -2 * TT, true]);
  const M = await import(modUrl("maneuvers.mjs"));
  check("the Time Profile: All Foundations, Standard, 10(T), given by an effect, Slowed and Guard Down on Damage",
    [M.PROFILES.time?.kiCostPerTier, M.PROFILES.time?.damageCategory, M.PROFILES.time?.accessSlot, M.PROFILES.time?.onDamage?.map(each => each.condition)],
    [10, "standard", "profile.time", ["slowed", "guard-down"]]);
  check("Time Seal and Time Reversion: given by Time Control, 2 Actions / 2 Counter Actions, 12(T), once an Encounter",
    [getTrait("time-power-time-control").grantsUnique, ["time-seal", "time-reversion"].map(id => [getTrait(id)?.type, Number(getTrait(id)?.actionCost),
      Number(getTrait(id)?.kiCostPerTier), getTrait(id)?.usageLimit])],
    [["time-seal", "time-reversion"], [["standard", 2, 12, "1/encounter"], ["counter", 2, 12, "1/encounter"]]]);
  const CH = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
  check("wired: a Profile's Conditions on Damage, Slowed's Combat Rolls, the Frozen Turn's Actions, the tally and the reversion, Time Freeze free",
    [CH.includes("for (const rider of PROFILES[id]?.onDamage ?? [])"), CH.includes('slots?.["combatRolls.vsSlowed"]'),
     CH.includes('slots?.["timeFreeze.extraAction"]?.add'), CH.includes("if (clash.winEffects.tally) return settleTally(message, clash, challenger, target);"),
     CH.includes("if (clash.winEffects.revert) return settleReversion(message, clash, challenger);"), CH.includes("export async function freeUnique(actor, id)")],
    Array(6).fill(true));
}

// --- Ki past the Maximum, Crimson Sacrifice (5), Golden Beast (2)(5) -------------------------------------------------------------

{
  const legendary = transformation("legendary-evolved", { active: true });
  const ss1 = transformation("super-saiyan-1", { active: true, mastery: 1 });
  const over = holding([ss1, legendary, traitItem(legendary, "legendary-evolved-unlimited-power")]);
  const plain = holding([ss1]);
  check("Unlimited Power (4): no Ki ceiling in it; the Maximum outside", [over.system.ki.ceiling > over.system.ki.max * 100, plain.system.ki.ceiling],
    [true, plain.system.ki.max]);
  const CH = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
  check("Ki regained held to the ceiling, not the Maximum, everywhere it is regained", [(CH.match(/ki\??\.ceiling \?\?/g) ?? []).length >= 30,
    fs.readFileSync(path.join(ROOT, "module", "effects", "moments-runtime.mjs"), "utf8").includes("cap: a => a.system.ki.ceiling ?? a.system.ki.max")], [true, true]);
  const cs = getTrait("kaioken-crimson-sacrifice").script;
  check("Crimson Sacrifice (5): the Kaioken Dice again and G(T), on an Ultimate as it is declared",
    [cs.includes("requires usingUltimate;"), cs.includes("attack.strikeDice += 1d4;"), cs.includes("attack.woundAdd += $G * 1(T);"),
     CH.includes("...((momentDice && !reflecting) ? { momentDice } : {}),"), CH.includes("const againStrike = (attack.momentDice?.strike ?? [])")],
    [true, true, true, true, true]);
  const go = transformation("golden-oozaru", { active: true });
  const ooz = transformation("oozaru", { active: true });
  const golden = holding([ooz, go, traitItem(go, "golden-oozaru-golden-beast")]);
  golden.system.states = { ...(golden.system.states ?? {}), raging: 1 };
  const raging = holding([ooz, go, traitItem(go, "golden-oozaru-golden-beast")]);
  check("Golden Beast (2): Colossal for Punching Down only in the Raging or Superior State; (5) wired, asked as it hits",
    [golden.system.effects.slots["punchingDown.asColossal"] ?? false, CH.includes("+ colossalSteps(attacker)"),
     CH.includes("const sizeWound = await punchSizesAsked(attacker, attack);")], [false, true, true]);
}

// --- Superior Super Saiyan: a Variant of Super Saiyan 1, and Multiple per Stage ---------------------------------------------------

{
  const T2 = await import(modUrl("transformations.mjs"));
  const file = T2.transformationFile("superior-super-saiyan");
  check("Superior Super Saiyan: Stage 1 of Super Saiyan, a Variant of Super Saiyan 1 - its Traits Crazed Battle Lust (in S-Cells' place), Golden "
    + "Power inherited, its own Mastery Trait; Golden Power in its text",
    [T2.kindOf(file), file.line, Number(file.stage), file.variantOf, T2.traitFilesFor(file).map(t => t.name),
     String(file.text).includes("Golden Power (from Super Saiyan 1, inherited as its Variant)")],
    ["form", "super-saiyan", 1, "super-saiyan-1", ["Crazed Battle Lust", "Golden Power", "Realized Superiority"], true]);
  const sup = transformation("superior-super-saiyan", { active: true });
  const actor = holding([sup, traitItem(sup, "superior-super-saiyan-crazed-battle-lust")]);
  check("Crazed Battle Lust: compiled, applying", [getTrait("superior-super-saiyan-crazed-battle-lust").script.includes("attack.woundAdd += floor(surgency / 2);"),
    Object.keys(actor.system.effects.slots).length > 0], [true, true]);
  // Multiple per Stage: in Super Saiyan 2, only the Stage 1 chosen is inherited.
  const one = transformation("super-saiyan-1");
  const other = transformation("superior-super-saiyan");
  const two = transformation("super-saiyan-2", { active: true });
  const ssTraits = [traitItem(one, "super-saiyan-1-golden-power"), traitItem(other, "superior-super-saiyan-crazed-battle-lust")];
  const items = [one, other, two, ...ssTraits];
  const asideOf = list => ssTraits.map(trait => T2.transformationTraitAside(trait, list) || "applies");
  const defaultPick = asideOf(items);
  two.system.choices = [{ key: "choice:inherit1", value: other.id }];
  const chosen = asideOf(items);
  check("Multiple per Stage: Super Saiyan 2 inherits one Stage 1 - the first had, or the one its row chose", [defaultPick, chosen],
    [["applies", "outside"], ["outside", "applies"]]);
}

// --- Time-Skipper (added 2026-11-21) --------------------------------------------------------------------------------------------

{
  const T2 = await import(modUrl("transformations.mjs"));
  const file = T2.transformationFile("time-skipper");
  check("Time-Skipper: a Greater Awakening of the Mind, 1 Stack, 3+; Beyond the Time giving Time-Skip",
    [T2.kindOf(file), file.subtype, file.origin, Number(file.maxStacks), file.tier, getTrait("time-skipper-beyond-the-time")?.grantsUnique],
    ["awakening", "greater", "mind", 1, "3+", "time-skip"]);
  const ts = transformation("time-skipper", { stacks: 1 });
  const actor = holding([ts, traitItem(ts, "time-skipper-beyond-the-time")]);
  const S = actor.system.effects.slots;
  check("Beyond the Time (4)(5)(6): written", [S["timeSkip.freeVsLower"], S["timeSkip.anySquare"], S["timeSkip.lethal"]], [true, true, true]);
  check("Time-Skip: an Instant, 4(T), once a Round; its six Advancements, Barrage From Time a use more",
    [getTrait("time-skip")?.type, Number(getTrait("time-skip")?.kiCostPerTier), getTrait("time-skip")?.usageLimit,
     ["imperceptible-strike", "barrage-from-time", "time-to-make-the-donuts", "walk-through-time", "time-shift", "time-restraint"].map(id => getTrait(id)?.advancement),
     Number(getTrait("barrage-from-time")?.extraUses)], ["instant", 4, "1/round", Array(6).fill(true), 1]);
  check("Tides of Time, Time Lag, Time Prison: Special Maneuvers; Lagged a status, not a Combat Condition",
    [["tides-of-time", "time-lag", "time-prison"].map(id => [getTrait(id)?.special, getTrait(id)?.type]), getTrait("lagged")?.combatCondition],
    [[[true, "counter"], [true, "standard"], [true, "outOfSequence"]], false]);
  const CH = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
  const TU = fs.readFileSync(path.join(ROOT, "module", "technique-use.mjs"), "utf8");
  check("wired: Time-Skip, a Category locked, Tides of Time on the card and its Ki, the holds paid each turn, Time-Skipped only through it",
    [CH.includes("export async function timeSkip(actor, context = {})"), CH.includes("if (attack.categoryLocked) {"),
     CH.includes("if (!result.wound && tidesButtons(message, container, attack)) return;"), CH.includes("if (tidesKi) absorbed = (Number(absorbed) || 0) + tidesKi;"),
     fs.readFileSync(path.join(ROOT, "module", "combat.mjs"), "utf8").includes("timeHoldsUpkeep(actor);"),
     TU.includes('if (has(technique, "time-skipped") && (via !== "time-skip"))')], Array(6).fill(true));
  const UM2 = fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8");
  check("the user's three (2026-11-21): a Technique through Time-Skip carries its extras; Time Lag lost offers the Exploit; free of Pinned, out of the Cage",
    [CH.includes('useTechnique(actor, pick.slice(10), { via: "time-skip", outOfSequence: true, extras })'),
     UM2.includes("if (techniqueExtras) maneuver = { ...maneuver, ...techniqueExtras };"), UM2.includes("techniqueExtras: extras });"),
     CH.includes('exploitOnLoss: "time-lag"'), CH.includes("if (clash.winEffects.exploitOnLoss) {"),
     CH.includes("export async function escapeTimeHolds(prisoner) {"),
     fs.readFileSync(path.join(ROOT, "module", "combat.mjs"), "utf8").includes('(await import("./chat.mjs")).escapeTimeHolds(actor);')], Array(7).fill(true));
}

// --- "1/2 (rounded up) of G(T)": half of G x T, not half of G times T (the user's report, 2026-11-21) ----------------------------

{
  const woundOf = (grade, powerLevel) => {
    const ka = transformation("kaioken", { active: true, grade });
    const who = holding([ka, traitItem(ka, "kaioken-exponential-power")], { powerLevel });
    const part = (who.system.effects.slots["wound"]?.parts ?? []).find(each => String(each.source ?? "").includes("Exponential Power"));
    return [who.system.tierOfPower, Number(part?.value) || 0];
  };
  // Tier 2 (Power Level 5-9), Grade 1: G(T) 2, half 1. Grade 3: 6, half 3. Tier 3 (Level 10), Grade 1: 3, half rounded up 2.
  check("Exponential Power (2): 1/2 (rounded up) of G(T)", [woundOf(1, 6), woundOf(3, 6), woundOf(1, 12)], [[2, 1], [2, 3], [3, 2]]);
  check("and the others written the same way: Super Giant Form (3), FTL (2), Overwhelming Mutant (1), Need for Revenge (3)",
    [getTrait("giant-form-super-giant-form").script.includes("ceil($G * 1(T) / 2)"), getTrait("lightspeed-mode-ftl").script.includes("ceil($G * 1(T) / 2)"),
     getTrait("heavy-suppression-overwhelming-mutant").script.includes("floor($S * 1(T) / 2)"), getTrait("need-for-revenge").script.includes("floor(spite.stacks * 1(T) / 2)")],
    [true, true, true, true]);
}

// --- Ascended Signature given for one use (Quick to Master (2), Earthling-Raised (3)): asked after the window that gives it (2026-11-26)
{
  const UM = fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8");
  const at = UM.indexOf("const asked = await askTechniqueDeclaration(actor, maneuver, declared, targetActor);");
  const next = UM.slice(at, at + 4200);
  check("an Ascended Signature picked at declaration is asked then: Ascend makes it an Ultimate",
    [at > 0, next.includes('(declared.advantages ?? []).includes("ascended-signature")'),
     next.includes("maneuver = { ...maneuver, ultimate: true, ascended: true };"),
     next.includes("const assaulted = await karmicAssault(actor, maneuver, declared);"),
     next.includes('["giga-flare", "super-combination"].includes(declared.karmicAssault)')], [true, true, true, true, true]);
}

// --- Boiling Rage (the user's link, 2026-11-26): a Variant of Enraged, Scalding Assault in Frenzied Assault's place ---------------
{
  const file = T.transformationFile("boiling-rage");
  const br = transformation("boiling-rage", { active: true, mastery: 1 });
  const armoredAt = level => {
    const trait = traitItem(br, "boiling-rage-simmering-temper");
    const owner = { system: { states: { raging: level } }, items: [br, trait] };
    br.parent = owner; trait.parent = owner;
    return T.aspectsOf(br, owner.items).some(each => each.id === "armored");
  };
  const scripts = ["boiling-rage-scalding-assault", "boiling-rage-vigorous-boil", "boiling-rage-simmering-temper"].map(id => getTrait(id)?.script ?? "");
  const MN = fs.readFileSync(path.join(ROOT, "module", "maneuvers.mjs"), "utf8");
  const CH = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
  check("Boiling Rage: an Enhancement, Variant of Enraged, Any race, Steaming Fury; its three Traits; Armored in Apoplectic",
    [T.kindOf(file), file.variantOf, file.racial, file.tier, Number(file.stress), getTrait("boiling-rage-scalding-assault")?.replaces,
     getTrait("boiling-rage-vigorous-boil")?.slot, getTrait("boiling-rage-simmering-temper")?.slot, armoredAt(3), armoredAt(2)],
    ["enhancement", "enraged", "Any", "1+", 10, "Frenzied Assault", "burst", "mastery", true, false]);
  check("and its effects written: Wound vs the Obscured, Surgency by Raging, Life on its rise, Life on the Wound, Steam, Life wagers",
    [scripts[0].includes("wound.vsObscured += 2(T);"), scripts[0].includes("surgency += states.raging * 1(T);"),
     scripts[0].includes("[triggered/state-level/raging, 1/round, effect 5]"), scripts[0].includes("allow lifeOnWound.upToSurgency;"),
     scripts[1].includes("steamCloud();"), scripts[2].includes("allow wager.anyFromLife;"),
     MN.includes('const anyLife = actor?.system?.effects?.slots?.["wager.anyFromLife"] === true;'),
     CH.includes('qualitiesSuffered(target).includes("obscured")'), CH.includes('"lifeOnWound.upToSurgency"] === true')],
    Array(9).fill(true));
  // (1) and Steaming Fury (3) one and the same limit (the user's, 2026-11-26).
  const { usesLeft } = await import(modUrl("effects/registry.mjs"));
  const spent = { system: { talentUses: { round: ["sf#2"], encounter: ["sf#2", "sf#2"] } } };
  const block = { index: 0, budget: { round: 1, encounter: 3 } };
  check("Scalding Assault (1) shares Steaming Fury (3)'s uses: spent by either, gone for both",
    [getTrait("boiling-rage-scalding-assault")?.sharesUses, usesLeft(spent, "sa", block, [], ["sa#0", "sf#2"]).available,
     usesLeft(spent, "sa", block, [], []).available, usesLeft(spent, "sa", block, [], ["sa#0", "sf#2"]).encounter],
    ["1 = steaming-fury 3", false, true, 1]);
}

// --- Steel Frame (the user's link, 2026-11-26): a Lesser Awakening of the Body, 1 Stack, TE +2 ------------------------------------
{
  const file = T.transformationFile("steel-frame");
  const sf = transformation("steel-frame", { stacks: 1 });
  const steel = holding([sf, traitItem(sf, "steel-frame-hard-as-steel")]);
  const plain = holding([]);
  const S = steel.system.effects.slots;
  const CH = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
  check("Steel Frame: Lesser, Body, 1 Stack; TE +2; Racial Life Modifier +2, Damage Reduction 1(T), Corporeal for Cognitive, Direct Hit's Category",
    [T.kindOf(file), file.subtype, file.origin, Number(file.maxStacks), T.bonusWritten(T.bonusesOf(sf).tenacity),
     steel.system.racialLifeModifier - plain.system.racialLifeModifier, steel.system.damageReduction - plain.system.damageReduction,
     S["clash.corporealForCognitive"], getTrait("steel-frame-hard-as-steel").script.includes("[triggered/direct-hit, 1/round, chosen, effect 5]"),
     CH.includes('(defender?.system?.effects?.slots?.["clash.corporealForCognitive"] === true) && challenger && areOpponents(defender, challenger)')],
    ["awakening", "lesser", "body", 1, "2", 2, steel.system.tierOfPower, true, true, true]);
  // Ticked in Respond, the box above shows the Category it leaves (the user's, 2026-11-26): its Direct Hit step read as settled.
  const { reactiveFor } = await import(modUrl("effects/registry.mjs"));
  const { collectReactive, applySlot } = await import(modUrl("effects/interpreter.mjs"));
  const step = reactiveFor(steel).filter(entry => entry.program.blocks[0].moment === "direct-hit").map(entry => applySlot(collectReactive([{ ...entry, armed: true }],
    "direct-hit", { data: steel.system, errors: [], context: {}, queue: [] }).slots, "incoming.damage.category.shift", 0));
  check("Hard as Steel (5) ticked in Respond: the Direct Hit box one Category lower (chat.mjs directHitStep, categorySteps, damageWith)",
    [step, CH.includes('const { slots } = collectReactive([{ ...entry, armed: true }], "direct-hit", scope);'),
     CH.includes(".reduce((sum, input) => sum + (Number(entry.categorySteps?.[input.value]) || 0), 0) : 0;"),
     CH.includes("const shown = (steps && roll.damageWith) ? roll.damageWith(key, balanced, steps) : (balanced ? roll[key].balanced : roll[key]);")],
    [[-1], true, true, true]);
}

// --- Super Kaioken (the user's link, 2026-11-26): a Special Enhancement, Initial Enhancement Kaioken, 3 Grades ------------------------
{
  const sk = transformation("super-kaioken", { active: true, grade: 3 });
  const ssj = transformation("super-saiyan-1", { active: true });
  const with3 = holding([ssj, sk, ...T.traitFilesFor(T.transformationFile("super-kaioken")).map(t => traitItem(sk, t.id))]);
  const alone = holding([transformation("super-kaioken", { active: true })]);
  const TM = fs.readFileSync(path.join(ROOT, "module", "transformations.mjs"), "utf8");
  check("Super Kaioken: Grade 3 AG/FO/MA 3(T), Extra Dice 2 Categories up, Signature Wound G(T); counts as Kaioken; Kaioken not Mastered and alone said",
    [Object.values(T.bonusesOf(sk)).map(T.bonusWritten), partsOf(with3, "dice.extra.category"), partsOf(with3, "wound.signature"),
     T.inTransformationOf(with3, "kaioken"), T.aspectWarnings(with3, sk), T.aspectWarnings(alone, alone.items[0])],
    [["3(T)", "3(T)", "3(T)"], [["Multiplied Power", 2]], [["Power of a Heartbeat", 3 * with3.system.tierOfPower]], true,
     "Special Enhancement: its Initial Enhancement Kaioken is not Mastered",
     "Special Enhancement: its Initial Enhancement Kaioken is not Mastered; Super Kaioken: only with another Transformation in use"]);
  check("Super Kaioken left with the one beside it (onlyAlongside): the Revert's and one put by as another is entered, not the one entered",
    [TM.includes("for (const id of alongsideLeaving(actor, [...leavingIds])) leavingIds.add(id);"),
     TM.includes("for (const id of alongsideLeaving(actor, changes.filter(change => change[\"system.active\"] === false).map(change => change._id), item.id)) {"),
     getTrait("super-kaioken-multiplied-power").script.includes("requires attackingManeuver && !hasResource(\"vermilion\");"),
     getTrait("super-kaioken-vermilion-explosion").script.includes("expires(vermilion, turn);") && getTrait("super-kaioken-vermilion-explosion").script.includes("offerOneOf(power-up);")],
    [true, true, true, true]);
}

// --- A Trait's Maneuvers by its Option's `allow` (the user's, 2026-11-27): Class Up's Choice Maneuver under Class Selection ----------------
{
  const RAC = await import(modUrl("racial.mjs"));
  const cu = transformation("class-up", { stacks: 1 });
  const sel = traitItem(cu, "class-up-class-selection");
  sel.system.chosen = [{ key: "option", value: "class-up-elite" }];
  const held = holding([cu, sel]);
  const SH = fs.readFileSync(path.join(ROOT, "module", "sheets", "actor-character-sheet.mjs"), "utf8");
  const TT = fs.readFileSync(path.join(ROOT, "templates", "parts", "actor-transformations.hbs"), "utf8");
  check("Class Selection with Elite opens Class Up: Elite, listed under it; the Transformation Traits list draws a Trait's Maneuvers",
    [[...RAC.maneuversOpenedBy(sel)], held.system.effects.slots["maneuver.class-up-elite-choice"],
     SH.includes("|| (maneuversOpenedBy(item).has(maneuver.id) && (this.actor.system.effects?.slots?.[`maneuver.${maneuver.id}`] === true)))"),
     TT.includes('<ul class="maneuver-list trait-maneuvers">')],
    [["class-up-elite-choice"], true, true, true]);
}

// --- Minions and Fusions (the user's links, 2026-11-27) ------------------------------------------------------------------------------
{
  const MAKE = await import(modUrl("minion-make.mjs"));
  const holder = (type, system, items) => {
    const actor = { type, system, items };
    for (const item of items) item.parent = actor;
    return actor;
  };
  const before = globalThis.game.actors;
  globalThis.game.actors = { get: id => (id === "m1") ? { system: { baseTierOfPower: 3 } } : undefined };
  const minion = holder("minion", { master: "m1", baseTierOfPower: 1 }, [transformation("zenkai", { stacks: 2 }), transformation("unlocked-potential", { stacks: 1 })]);
  const duplicate = holder("minion", { master: "m1", duplicate: true, baseTierOfPower: 1 }, [transformation("zenkai", { stacks: 3 })]);
  globalThis.game.actors = before;
  const cut = transformation("zenkai", { stacks: 2 });
  cut.flags["dbu-ttrpg"] = { fusionOff: true };
  const fusion = holder("fusion", { baseTierOfPower: 3 }, [cut, transformation("unlocked-potential", { stacks: 1 })]);
  const kept = transformation("zenkai", { stacks: 2 });
  kept.flags["dbu-ttrpg"] = { fusionOff: true };
  holder("character", { baseTierOfPower: 3 }, [kept]);
  check("a Duplicate copies its Master's Transformations (in use as they were); a Minion's Awakening Limit by its Master's base Tier; a Duplicate none",
    [MAKE.isDuplicatedItem({ type: "transformation" }),
     (() => { globalThis.game.actors = { get: id => (id === "m1") ? { system: { baseTierOfPower: 3 } } : undefined };
       const limit = T.awakeningCount(minion); globalThis.game.actors = before; return [limit.lesser, limit.lesserMax, limit.greater, limit.greaterMax, limit.minion]; })(),
     [T.awakeningCount(duplicate).none, T.awakeningCount(duplicate).noneWhy]],
    [true, [2, 2, 1, 1, true], [true, "Duplicate: its Master's"]]);
  check("a Fusion's Awakening unticked is not had - not in use, not counted; the flag means nothing on another character",
    [T.inUse(cut), T.awakeningCount(fusion).lesser, T.awakeningCount(fusion).greater, T.inUse(kept)], [false, 0, 1, true]);
}

// --- Unkillable Majin (the user's link, 2026-11-27): the first Super Awakening, its Grand Awakening off until the Full Awakening ------------
{
  const um = transformation("unkillable-majin", { stacks: 1 });
  const items = [um, ...T.traitFilesFor(T.transformationFile("unkillable-majin")).map(t => traitItem(um, t.id))];
  const before = globalThis.game.combat;
  const prepared = () => holding(items).system.effects.slots;
  globalThis.game.combat = { started: true, id: "c1" };
  const off = prepared();
  um.flags["dbu-ttrpg"] = { grandMet: "c1" };
  const met = prepared();
  um.flags["dbu-ttrpg"] = { grandMet: "c1", grandOn: "c1" };
  const on = prepared();
  globalThis.game.combat = { started: true, id: "c2" };
  const nextEncounter = prepared();
  globalThis.game.combat = before;
  const boundless = getTrait("unkillable-majin-boundless-majin");
  check("Unkillable Majin: a Super Awakening of the Body; Always Bouncing Back always; Boundless Majin a Grand Awakening, its (1) the Grand Trigger",
    [T.kindOf(T.transformationFile("unkillable-majin")), T.transformationFile("unkillable-majin").subtype, partsOf(holding(items), "stressBonus").length > 0,
     boundless.slot, boundless.grandTrigger, boundless.script.includes('[automatic/surge-threshold, effect 1]\nrequires belowThreshold("bruised") && !belowThreshold("injured") && !grandTriggerMet;\ngrandTrigger();')],
    ["awakening", "super", true, "grand", 1, true]);
  check("the Grand Awakening: off (its Grand Trigger alone), the Full Awakening open once it is met, all of it on once activated, off again the next Encounter",
    [[off["monstrousVitality.overflow"], off["maneuver.full-awakening"]], [met["monstrousVitality.overflow"], met["maneuver.full-awakening"]],
     [on["monstrousVitality.overflow"], on["wager.anyFromLife"]], nextEncounter["monstrousVitality.overflow"]],
    [[undefined, undefined], [undefined, true], [true, true], undefined]);
}

// --- Nothing in module/ or templates/ names one --------------------------------------------------------------------------------

const code = [];
for (const dir of ["module", "templates"]) {
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => e.isDirectory() ? walk(path.join(d, e.name))
    : (/\.(mjs|hbs)$/.test(e.name) && code.push(fs.readFileSync(path.join(d, e.name), "utf8"))));
  walk(path.join(ROOT, dir));
}
const all = code.join("\n");
const named = files.map(file => file.id).filter(id => new RegExp(`["'\`]${id}["'\`]`).test(all));
check("no Transformation's id written in module/ or templates/", named, []);

// --- The index -----------------------------------------------------------------------------------------------------------------

const listed = JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8")).traits;
const disk = [];
for (const dir of ["transformations", "aspects"]) {
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => e.isDirectory() ? walk(path.join(d, e.name))
    : (e.name.endsWith(".dbu") && disk.push(path.relative(TRAITS, path.join(d, e.name)).split(path.sep).join("/"))));
  walk(path.join(TRAITS, dir));
}
check("index.json names every file under transformations/ and aspects/, and no other there",
  [disk.filter(p => !listed.includes(p)), listed.filter(p => /^(transformations|aspects)\//.test(p) && !disk.includes(p))], [[], []]);

console.log(failed ? `${failed} failing` : "all passing");
process.exit(failed ? 1 : 0);
