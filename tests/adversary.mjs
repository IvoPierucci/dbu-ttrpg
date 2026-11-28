/**
 * Adversaries (the user's, after the rulebook's Adversaries page): a kind of Actor of its own, with the tab that takes Main's
 * place, what its Category gives, and what it has in combat. And what changed on Main for every sheet with it.
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
const { getSlot } = await import(modUrl("effects/slots.mjs"));
const { PRIORITY } = await import(modUrl("effects/interpreter.mjs"));
const BUFFS = await import(modUrl("custom-buffs.mjs"));
const TYPES = await import(modUrl("actor-types.mjs"));
await loadTraits();

const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");

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

function progressionTo(powerLevel, choice = "Attribute Addition") {
  const rows = [{ lvl: 1, choice: "Skill Improvement", locked: true, attributes: {}, skillRanks: ["perception", "perception"] }];
  for (let lvl = 2; lvl <= powerLevel; lvl++) {
    rows.push({ lvl, choice, locked: false, attributes: { insight: 1, agility: 1 }, skillRanks: [] });
  }
  return rows;
}

/** A prepared Actor of a kind, holding what is given. */
function made(type = "character", data = {}, { powerLevel = 12 } = {}) {
  const parent = new ActorStub({}, { strict: false });
  parent.items = [];
  parent.uuid = "Actor.me";
  parent.type = type;
  const model = new DBUCharacterData({ powerLevel, progression: progressionTo(powerLevel), ...data }, { parent, strict: false });
  parent.system = model;
  model.prepareBaseData?.();
  model.prepareDerivedData();
  return parent;
}

// --- Stage 0: Main, for every sheet ------------------------------------------------------------------------
{
  const MAIN = read("templates", "parts", "actor-main.hbs");
  const COMBAT = read("templates", "parts", "actor-combat.hbs");
  const GEAR = read("templates", "parts", "actor-gear.hbs");
  check("Main: no Bonus box on an Attribute, no Aptitudes panel (the user's) - Attributes and Skills alone",
    [MAIN.includes(".bonus"), MAIN.includes("Aptitudes</h3>"), MAIN.includes("{{system.surgency}}"), MAIN.includes("{{system.ingenuity}}"), MAIN.includes("{{system.stressBonus}}"),
     MAIN.includes('data-action="rollAttribute"'), MAIN.includes('data-action="rollSkill"')],
    [false, false, false, false, false, true, true]);
  check("Surgency on the Combat tab and the Stress Bonus on Progression (the user's, 2026-11-15), with their workings; Ingenuity on the Gear tab",
    [COMBAT.includes('<div class="stat"><em>Surgency</em><span data-tooltip-html="{{workings.surgency}}">{{system.surgency}}</span></div>'),
     read("templates", "parts", "actor-progression.hbs").includes('<label class="dbu-readout" data-tooltip-html="<p>A Stress Test is 1d10 plus this.</p>{{workings.stressBonus}}">Stress Bonus'),
     GEAR.includes("<em>Ingenuity</em><span>{{system.ingenuity}}</span>"), COMBAT.includes("Ingenuity")],
    [true, true, true, false]);
  // A Bonus written before is counted no longer (the user's: "dejarlo en 0 y listo"); a Custom Buff does it now.
  const plain = made("character");
  const old = made("character", { attributes: { force: { bonus: 5 } } });
  check("an Attribute's old Bonus is read by nothing: the Modifier is the Score, and its hover says only that",
    [old.system.attributes.force.mod === plain.system.attributes.force.mod,
     (old.system.effects.workings?.["force.mod"]?.parts ?? []).map(part => part.label)],
    [true, ["Score"]]);
  const buffed = made("character", { customBuffs: [{ id: "b1", name: "", group: "", active: true, effect: "force.mod", flat: 5, perBase: 0, perTier: 0 }] });
  check("what raises a Modifier by hand is a Custom Buff's", buffed.system.attributes.force.mod - plain.system.attributes.force.mod, 5);
}

// --- Stage 1: the Actor type, and the tab in Main's place -----------------------------------------------------
const ADV = await import(modUrl("adversary.mjs"));
{
  check("an Adversary is a Character of a type of its own; a Player Character is neither a Minion nor an Adversary",
    [TYPES.CHARACTER_TYPES, TYPES.isCharacter({ type: "adversary" }), TYPES.isAdversary({ type: "adversary" }), TYPES.isAdversary({ type: "character" }),
     ["character", "minion", "adversary"].map(type => TYPES.isPlayerCharacter({ type }))],
    [["character", "minion", "adversary", "fusion"], true, true, false, [true, false, false]]);
  const MAIN = read("module", "dbu-ttrpg.mjs");
  check("the type is the manifest's, named, given the Character's model and its sheet",
    [Object.keys(JSON.parse(read("system.json")).documentTypes.Actor), JSON.parse(read("lang", "en.json"))["TYPES.Actor.adversary"],
     MAIN.includes("CONFIG.Actor.dataModels.adversary = DBUCharacterData;"), MAIN.includes('types: ["character", "minion", "adversary", "fusion"],')],
    [["character", "minion", "adversary", "fusion", "vehicle"], "Adversary", true, true]);

  const row = (category, pcc) => { const g = ADV.adversaryGains({ adversary: { category, pcc } });
    return [g.lifePerLevel, g.kiPerLevel, g.pointsPerTier, g.staminaPerTier, g.traits, g.narrative]; };
  check("the Adversary Table: Standard 1 / 1 / - / - / -; Elite PCC / 2(PCC) / PCC / PCC*6(bT) / 1; Villain 2(PCC) / 4(PCC) / 2(PCC) / PCC*12(bT) / 2",
    [row("standard", 4), row("elite", 3), row("villain", 4)],
    [[1, 1, 0, 0, 0, false], [3, 6, 3, 18, 1, true], [8, 16, 8, 48, 2, true]]);
  check("a Category this system has not is Standard's; a PCC is 1 at least; nothing for an Actor that is no Adversary",
    [ADV.adversaryCategory({ adversary: { category: "boss" } }), ADV.adversaryPcc({ adversary: { pcc: 0 } }), ADV.adversaryPcc({}),
     ADV.adversaryGains({ adversary: { category: "villain", pcc: 4 } }, { made: false }).lifePerLevel], ["standard", 1, 1, 0]);

  const hero = made("character");
  const villain = made("adversary", { adversary: { category: "villain", pcc: 4 } });
  const standard = made("adversary", { adversary: { category: "standard", pcc: 4 } });
  check("Max LP and KP per PL, for each Power Level reached (12): a Villain of PCC 4, 8 and 16 a Level; a Standard, 1 and 1",
    [villain.system.life.max - hero.system.life.max, villain.system.ki.max - hero.system.ki.max,
     standard.system.life.max - hero.system.life.max, standard.system.ki.max - hero.system.ki.max], [96, 192, 12, 12]);
  const written = { category: "villain", pcc: 4, extra: { force: 6, magic: 2 }, ranks: { intimidation: 5, flight: 1 } };
  const built = made("adversary", { adversary: written });
  const pretender = made("character", { adversary: written });
  check("the Attribute Points written over its Progression's are in its Scores; the Ranks written are its Skills', never over a cap",
    [built.system.attributes.force.score - hero.system.attributes.force.score, built.system.attributes.magic.score - hero.system.attributes.magic.score,
     ADV.adversaryExtraUsed(built.system), built.system.skills.intimidation.ranks, built.system.skills.intimidation.overCap,
     built.system.skills.flight.ranks, built.system.skills.flight.untrained,
     built.system.skills.intimidation.bonus - hero.system.skills.intimidation.bonus],
    [6, 2, 8, 5, false, 1, false, 10]);
  check("written on a Character, all of it is nothing: its Life, its Scores and its Ranks its own",
    [pretender.system.life.max - hero.system.life.max, pretender.system.attributes.force.score - hero.system.attributes.force.score,
     pretender.system.skills.intimidation.ranks, pretender.system.adversaryGains.traits], [0, 0, 0, 0]);
}

// --- The Adversary tab ---------------------------------------------------------------------------------------
{
  const SHEET = read("module", "sheets", "actor-character-sheet.mjs");
  check("in Main's place: one of the two on the strip and drawn; the sheet opens on it; its limits neither warn nor stop",
    [SHEET.includes('adversary: { id: "adversary", group: "primary", label: "Adversary" },'),
     // A Fusion's tab left off the same way (fusion.mjs): the tabs left off are a list now.
     SHEET.includes('if (isAdversary(this.actor)) return ["main", "fusion"];'),
     SHEET.includes("if (Array.isArray(options.parts)) options.parts = options.parts.filter(part => !this.#tabsLeftOff.includes(part));"),
     SHEET.includes("if (this.#tabsLeftOff.includes(key)) continue;"),
     SHEET.includes('if (this.#tabsLeftOff.includes(this.tabGroups.primary)) this.tabGroups.primary = isAdversary(this.actor) ? "adversary" : "main";'),
     SHEET.includes("over: (spent > total) && !isAdversary(this.actor),"),
     (SHEET.match(/benefit: this\.#unlimited\(/g) ?? []).length, (SHEET.match(/offerSkill: !isAdversary\(this\.actor\) \|\|/g) ?? []).length],
    [true, true, true, true, true, true, 2, 2]);
  const PROG = read("templates", "parts", "actor-progression.hbs");
  check("no Skill Improvement offered on an Adversary's Progression, row or Character Perk",
    [PROG.includes('{{#if row.offerSkill}}<option value="Skill Improvement"'), PROG.includes('{{#if perk.offerSkill}}<option value="Skill Improvement"')],
    [true, true]);

  const { createRequire } = await import("node:module");
  const require = createRequire(`${(process.env.FOUNDRY_APP || (process.env.FOUNDRY_APP || String.raw`C:\Program Files\Foundry Virtual Tabletop\resources\app`))}/package.json`);
  const Hbs = require("handlebars");
  Hbs.registerHelper("numberFormat", value => ((Number(value) >= 0) ? `+${value}` : String(value)));
  // Foundry's own, registered by its client.
  Hbs.registerHelper("eq", (a, b) => a === b);
  const template = Hbs.compile(read("templates", "parts", "actor-adversary.hbs"));
  const html = template({ tabs: { adversary: { cssClass: "active" } }, editable: true, adversary: {
    categories: [{ value: "standard", label: "Standard" }, { value: "elite", label: "Elite" }, { value: "villain", label: "Villain", selected: true }],
    pcc: 4, lifePerLevel: 8, lifeTotal: 96, kiPerLevel: 16, kiTotal: 192, pointsPerTier: 8, points: 24, used: 8, over: false, traits: 2,
    attributes: [{ key: "force", mod: 14, workings: "w", extra: 6, score: 14, from: 8 }, { key: "magic", mod: 4, workings: "w", extra: 0, score: 4, from: 4 }],
    skillGroups: [{ label: "Personality", skills: [
      { key: "intimidation", label: "Intimidation", written: 5, more: 0, roll: 13, critical: 10, workings: "w" },
      { key: "clairvoyance", label: "Clairvoyance", required: true, written: 2, more: 1, roll: 10, critical: 10, workings: "w" },
      { key: "medicine", label: "Medicine", required: true, untrained: true, written: 0, more: 0, roll: 1, critical: 10, workings: "w" }] }] } });
  check("the Category and the PCC written, and what the table gives for them, each with what it comes to",
    [html.includes('<select name="system.adversary.category" >'), html.includes('<option value="villain" selected>Villain</option>'),
     /name="system\.adversary\.pcc" value="4" min="1"/.test(html), html.includes("<b>+8 <small>(+96)</small></b>"),
     html.includes("<b>+16 <small>(+192)</small></b>"), html.includes("<b>+8 <small>(24)</small></b>"), html.includes("8 of 24 extra points used")],
    [true, true, true, true, true, true, true]);
  check("Main's Attributes, rolled from here, each with its points over the Progression's; no Bonus box",
    [html.includes('data-action="rollAttribute" data-attribute="force"'), html.includes('<div class="attribute-mod" data-tooltip-html="w">14</div>'),
     html.includes("<span>8 +</span>"), /name="system\.adversary\.extra\.force" value="6"\s+min="0"/.test(html), html.includes(".bonus")],
    [true, true, true, true, false]);
  check("Main's Skills, rolled from here, each with its Ranks written; what comes from elsewhere said; a Required one with none not rolled",
    [html.includes('data-action="rollSkill"\n                      data-skill="intimidation"'),
     /name="system\.adversary\.ranks\.intimidation"\s+value="5" min="0"/.test(html), html.includes('<span class="skill-bonus" data-tooltip-html="w">+13</span>'),
     html.includes(">+1</span>"), html.includes('data-skill="medicine"'), html.includes("skill-over-cap")],
    [true, true, true, true, false, false]);
  const quiet = template({ tabs: { adversary: { cssClass: "" } }, editable: false, adversary: { categories: [], pcc: 1, lifePerLevel: 1, lifeTotal: 12,
    kiPerLevel: 1, kiTotal: 12, pointsPerTier: 0, points: 0, used: 0, traits: 0, attributes: [], skillGroups: [] } });
  check("a Standard has no Attribute Points and no Villainous Traits from the table: said as none",
    [(quiet.match(/<b>-<\/b>/g) ?? []).length, quiet.includes("disabled")], [2, true]);
}

// --- Stage 2: Adversaries in Combat --------------------------------------------------------------------------
{
  const of = (category, pcc, more = {}, data = {}) => made("adversary", { adversary: { category, pcc, ...more }, ...data }).system;
  const hero = made("character").system;
  const tier = hero.baseTierOfPower;
  check("Narrative Stamina a Round: PCC*12(bT) a Villain's, PCC*6(bT) an Elite's, none a Standard's - and none in a 1-on-1 Duel",
    [of("villain", 4).narrativeStamina.max, of("elite", 3).narrativeStamina.max, of("standard", 4).narrativeStamina.max,
     of("villain", 4, { duel: true }).narrativeStamina.max, hero.narrativeStamina.max],
    [48 * tier, 18 * tier, 0, 0, 0]);
  check("One-Man Army: PCC Adversary Actions in the Counter Action's place - past six where its PCC is; a Counter Action in a Duel, and a Standard's",
    [of("villain", 4).actions.counter, of("elite", 2).actions.counter, of("villain", 8).actions.counter,
     of("villain", 4, { duel: true }).actions.counter, of("standard", 4).actions.counter, hero.actions.counter,
     of("villain", 4, {}, { actionsSpent: { counter: 3 } }).actions.counterLeft],
    [4, 2, 8, 1, 1, 1, 1]);
  const spent = of("villain", 4, {}, { capacity: { spent: hero.capacity.max + 7 } });
  const kept = of("standard", 4, {}, { capacity: { spent: 5 } });
  check("Without Capacity: an Elite's and a Villain's ignored - nothing left to run out, its Maximum the same, what is spent past it counted",
    [spent.capacity.ignored, spent.capacity.max === hero.capacity.max, spent.capacity.over, spent.capacity.remaining === DBUCharacterData.NO_CAPACITY_LIMIT,
     of("elite", 1).capacity.ignored, of("villain", 4, { duel: true }).capacity.ignored],
    [true, true, 7, true, true, true]);
  check("a Standard one keeps its Capacity (the user's)", [Boolean(kept.capacity.ignored), kept.capacity.remaining], [false, hero.capacity.max - 5]);
  check("Villainous Karma: PCC a Villain's, half of it an Elite's - down, 1 at least - none a Standard's; no limit to it",
    [ADV.adversaryKarma({ adversary: { category: "villain", pcc: 4 } }), ADV.adversaryKarma({ adversary: { category: "elite", pcc: 5 } }),
     ADV.adversaryKarma({ adversary: { category: "elite", pcc: 1 } }), ADV.adversaryKarma({ adversary: { category: "standard", pcc: 4 } }),
     of("villain", 9, {}, { karma: 9 }).karma],
    [4, 2, 1, 0, 9]);
  check("given as an Encounter starts, none left as it ends - the Round's Stamina and a 1-on-1 Duel with it",
    [ADV.adversaryEncounterStart({ adversary: { category: "villain", pcc: 3 } }), ADV.adversaryEncounterEnd()],
    [{ "system.karma": 3, "system.adversary.karmaRegained": false },
     { "system.karma": 0, "system.adversary.karmaRegained": false, "system.adversary.duel": false, "system.narrativeStamina.value": 0 }]);
  const COMBAT = read("module", "combat.mjs");
  const SHEET = read("module", "sheets", "actor-character-sheet.mjs");
  check("the Round gives the Stamina and the Encounter the Karma, an Adversary's alone; the sheet's Karma without a ceiling for it",
    [COMBAT.includes('...(isAdversary(actor) ? { "system.narrativeStamina.value": Number(actor.system.narrativeStamina?.max) || 0 } : {})'),
     COMBAT.includes("...(isAdversary(actor) ? adversaryEncounterStart(actor.system) : {})"),
     COMBAT.includes("if (isAdversary(actor)) await actor.update(adversaryEncounterEnd());"),
     SHEET.includes('return this.actor.update({ "system.karma": Math.max(0, wanted), ...((wanted > 0) ? { "system.adversary.karmaRegained": false } : {}) });'),
     SHEET.includes('"system.karma": Math.min(DBUCharacterData.KARMA_MAX, Math.max(0, wanted))'),
     SHEET.includes("adversaryRegain: DBUCharacterSheet._onAdversaryRegain,"),
     SHEET.includes("const lifeBack = Math.floor((Number(life.max) || 0) / 4);"), SHEET.includes('"system.adversary.karmaRegained": true')],
    [true, true, true, true, true, true, true, true]);

  const { createRequire } = await import("node:module");
  const require = createRequire(`${(process.env.FOUNDRY_APP || (process.env.FOUNDRY_APP || String.raw`C:\Program Files\Foundry Virtual Tabletop\resources\app`))}/package.json`);
  const Hbs = require("handlebars");
  const template = Hbs.compile(read("templates", "parts", "actor-adversary.hbs"));
  const drawn = combat => template({ tabs: { adversary: { cssClass: "active" } }, editable: true, adversary: { categories: [], pcc: 4, attributes: [],
    skillGroups: [], combat } });
  const on = drawn({ narrative: true, active: true, duel: false, stamina: 100, staminaMax: 144, actions: 4, actionsLeft: 3, karma: 0,
    capacitySpent: 90, capacityMax: 80, capacityOver: 10, canRegain: true, regained: false });
  check("In Combat on its tab: the Stamina written and stepped, the Adversary Actions, the Karma stepped, the Capacity spent against its Maximum and how far past",
    [/name="system\.narrativeStamina\.value" value="100" min="0"/.test(on), on.includes("/ 144</span>"), (on.match(/data-action="stepStamina"/g) ?? []).length,
     on.includes("<span>Adversary Actions</span>"), on.includes("<b>3 <small>/ 4</small></b>"), (on.match(/data-action="stepKarma"/g) ?? []).length,
     on.includes('90 <small>/ 80</small> <small class="dbu-adversary-over">over by 10</small>'),
     /data-action="adversaryRegain"\s+data-tooltip="Out of Karma Points/.test(on), on.includes('name="system.adversary.duel"')],
    [true, true, 2, true, true, 2, true, true, true]);
  const duel = drawn({ narrative: true, active: false, duel: true, stamina: 0, staminaMax: 0, actions: 1, actionsLeft: 1, karma: 2,
    capacitySpent: 0, capacityMax: 80, capacityOver: 0, canRegain: false, regained: false });
  check("in a 1-on-1 Duel: Counter Actions said, the box ticked, its button shut while it has Karma; a Standard one has no such panel",
    [duel.includes("<span>Counter Actions</span>"), /name="system\.adversary\.duel" checked/.test(duel), /data-action="adversaryRegain" disabled/.test(duel),
     drawn({ narrative: false }).includes("In Combat")], [true, true, true, false]);
  const CT = read("templates", "parts", "actor-combat.hbs");
  check("the same on the Combat tab (the user's): the Stamina said and stepped - not a second field of its name - the Adversary Actions named; the Capacity ignored and how far past, on the header's",
    [CT.includes("{{#if adversary.combat.narrative}}"), CT.includes("<b>{{adversary.combat.stamina}}</b>"),
     (CT.match(/name="system\.narrativeStamina\.value"/g) ?? []).length,
     CT.includes("<em>{{#if adversary.combat.active}}Adversary Actions{{else}}Counter Actions{{/if}}</em>"),
     read("templates", "parts", "actor-header.hbs").includes("{{#if capacity.ignored}}Ignored, and counted: {{#if capacity.over}}over by {{capacity.over}}{{else}}within it{{/if}}")],
    [true, true, 0, true, true]);
}

// --- Stage 3a: Narrative Stamina against the Damage -------------------------------------------------------
{
  const T = DBUCharacterData.THRESHOLDS;
  check("the Health Threshold lines on 400 Life Points: Bruised at 200, Injured at 100, Critical at 40",
    ADV.thresholdLines(400, T).map(line => [line.label, line.at]), [["Bruised", 200], ["Injured", 100], ["Critical", 40]]);
  check("the least Stamina that keeps a hit above the next line down - never more than the Damage or than there is",
    [ADV.staminaToStay(260, 400, 150, 144, T), ADV.staminaToStay(260, 400, 50, 144, T), ADV.staminaToStay(260, 400, 150, 30, T),
     ADV.staminaToStay(30, 400, 20, 144, T)],
    // At 200 of 400 they are Bruised already: Healthy is above a half, so 201 is the least that stays - 91 off a 150 hit.
    [{ needed: 91, enough: true }, { needed: 0, enough: true }, { needed: 30, enough: false }, { needed: 0, enough: true }]);
  check("what is left to spend: an Adversary's, never a Character's",
    [ADV.staminaLeft({ type: "adversary", system: { narrativeStamina: { value: 37 } } }),
     ADV.staminaLeft({ type: "character", system: { narrativeStamina: { value: 37 } } }), ADV.staminaLeft(null)], [37, 0, 0]);
  const CHAT = read("module", "chat.mjs");
  check("the Take Damage window: its own section, offered whenever there is Stamina and a hit that costs Life Points",
    [CHAT.includes("const stamina = ((Number(own?.damage) || 0) > 0) ? staminaLeft(target) : 0;"),
     CHAT.includes("any: Boolean(before.length || cut.length || taken.length || none.length || stamina)"),
     CHAT.includes('<input type="number" name="stamina" value="0" min="0" max="${staminaMost}" step="1"/>'),
     CHAT.includes("Stay above the line"), CHAT.includes("lines.map(line => `<span class=\"dbu-stamina-line\""),
     CHAT.includes("stamina: staminaIn(dialog.element),")],
    [true, true, true, true, true, true]);
  check("spent: gone from the Stamina, and that many Life Points fewer lost - the Damage itself as it was; none where it was cancelled",
    [CHAT.includes("const absorbed = chosen.before.length ? 0 : Math.min(Number(chosen.stamina) || 0, staminaLeft(target));"),
     CHAT.includes('if (absorbed) await target.update({ "system.narrativeStamina.value": staminaLeft(target) - absorbed });'),
     CHAT.includes("const settled = target.system.life.value - Math.max(0, damage - Math.max(0, Number(absorbed) || 0));"),
     CHAT.includes("return await applyAttackDamage(message, target, attack, { damageOverride, absorbed });")],
    [true, true, true, true]);
}

// --- Stage 3b: Narrative Stamina in place of Ki Points ---------------------------------------------------
{
  globalThis.ui.notifications.warn = () => {};
  const MAN = await import(modUrl("maneuvers.mjs"));
  // An Adversary whose writes go through the hook as Foundry's would (dbu-ttrpg.mjs preUpdateActor).
  const foe = ({ type = "adversary", narrative = true, ki = 50, stamina = 30, spent = 0, mode = "auto" } = {}) => {
    const actor = { type, uuid: `Actor.${Math.random()}`, system: { adversaryNarrative: narrative, adversary: { staminaMode: mode },
      ki: { value: ki, max: 200 }, capacity: { spent, max: 40, remaining: narrative ? 999999 : 40 - spent }, narrativeStamina: { value: stamina } } };
    actor.update = async (changes, options = {}) => {
      ADV.payKiWithStamina(actor, changes, options);
      for (const [key, value] of Object.entries(foundry.utils.flattenObject(changes))) foundry.utils.setProperty(actor, key, value);
      if (!actor.system.adversaryNarrative) actor.system.capacity.remaining = 40 - actor.system.capacity.spent;
    };
    return actor;
  };
  const state = actor => [actor.system.ki.value, actor.system.narrativeStamina.value, actor.system.capacity.spent];

  const auto = foe();
  await MAN.spendManeuverCost(auto, { id: "beam", name: "Beam" }, 20);
  check("Auto: a cost paid with Narrative Stamina first - none of it Ki, none of it counted against the Capacity",
    state(auto), [50, 10, 0]);
  await MAN.spendManeuverCost(auto, { id: "wave", name: "Wave" }, 25);
  check("as far as it goes, the rest in Ki Points and their Capacity", state(auto), [35, 0, 15]);
  await MAN.refundManeuverCost(auto, { id: "wave", name: "Wave", kiCost: 25 });
  check("cancelled: what the Stamina paid back to the Stamina, the rest to the Ki Points and the Capacity", state(auto), [50, 10, 0]);

  const short = foe({ ki: 5, stamina: 10 });
  check("counted with the Ki Points: enough between them is enough, not more", [await MAN.spendManeuverCost(short, { name: "A" }, 15), state(short),
    await MAN.spendManeuverCost(foe({ ki: 5, stamina: 10 }), { name: "B" }, 16)], // the 5 the Ki Points paid counted against the Capacity, the 10 of Stamina not
    [true, [0, 0, 5], false]);
  const declined = foe({ mode: "ask" });
  await MAN.spendManeuverCost(declined, { id: "beam", name: "Beam", noStamina: true }, 20);
  check("Ask, answered no: paid in Ki Points alone", state(declined), [30, 30, 20]);
  check("asked only on Ask, and only with Stamina to pay with; none in a 1-on-1 Duel or for a Standard one",
    [ADV.asksStamina(foe({ mode: "ask" })), ADV.asksStamina(foe()), ADV.asksStamina(foe({ mode: "ask", stamina: 0 })),
     ADV.staminaForKi(foe({ narrative: false })), ADV.staminaForKi(foe({ type: "character" }))], [true, false, false, 0, 0]);

  // Not a payment: no Capacity spent with it - drained by an Opponent, or set by hand.
  const drained = foe();
  await drained.update({ "system.ki.value": 20 });
  const typed = foe();
  await typed.update({ system: { ki: { value: 10 } } });
  const paidNested = foe();
  await paidNested.update({ system: { ki: { value: 40 }, capacity: { spent: 10 } } });
  check("a Ki Point drained or set by hand is not paid with Stamina; a payment written nested is",
    [state(drained), state(typed), state(paidNested)], [[20, 30, 0], [10, 30, 0], [50, 20, 0]]);
  const hero = foe({ type: "character", narrative: false });
  await hero.update({ "system.ki.value": 40, "system.capacity.spent": 10 });
  check("a Character's Ki is its own", state(hero), [40, 30, 10]);
  check("the Ki Wager's ceiling counts the Stamina with the Ki Points",
    MAN.maxKiWager({ system: { capacity: { max: 400, remaining: 999999 }, ki: { value: 10 }, adversaryNarrative: true, narrativeStamina: { value: 30 },
      effects: { slots: {} } }, type: "adversary" }), 40);

  const MAIN = read("module", "dbu-ttrpg.mjs");
  const USE = read("module", "use-maneuver.mjs");
  const MANS = read("module", "maneuvers.mjs");
  const TAB = read("templates", "parts", "actor-adversary.hbs");
  check("wired: the hook on every Actor write, the attack window's box on Ask, its answer to the payment, Auto / Ask on the tab",
    [MAIN.includes('Hooks.on("preUpdateActor", (actor, changes, options) => { payKiWithStamina(actor, changes, options); });'),
     MANS.includes('${asksStamina(actor) ? `'), MANS.includes('<input type="checkbox" name="payStamina"/>'),
     MANS.includes("return { profile, kiWager, wagerFromLife, wagerFromDivine, payStamina, ...(foundation ? { foundation } : {}) };"),
     USE.includes("if (declared && (declared.payStamina === false)) maneuver = { ...maneuver, noStamina: true };"),
     TAB.includes('<select name="system.adversary.staminaMode"'), TAB.includes('<option value="ask" {{#if (eq adversary.combat.staminaMode "ask")}}selected{{/if}}>Ask</option>')],
    [true, true, true, true, true, true, true]);
}

// --- Stage 4: Villainous Traits ---------------------------------------------------------------------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const RACIAL = await import(modUrl("racial.mjs"));
  const ids = ["arrogant-and-unstoppable", "dauntless", "desperate-adversary", "narrative-transformation", "second-phase", "statstick", "wild-swings"];
  check("the page's seven examples, Villainous Traits of their own: kept off the Other Traits' picker",
    [RACIAL.villainousTraitFiles().map(trait => trait.id).sort(), ids.map(id => getTrait(id)?.owner),
     RACIAL.otherTraitsInOrder().some(trait => trait.owner === "villainous"), RACIAL.otherGroupName("villainous")],
    [ids, ids.map(() => "villainous"), false, "Villainous"]);
  check("each text as the page gives it", ids.map(id => /^[A-Z][^:]+: /.test(getTrait(id)?.text ?? "") && /\(1\)-\[Passive\]/.test(getTrait(id)?.text ?? "")),
    ids.map(() => true));

  let n = 0;
  const item = (id, flags = {}) => ({ id: `v${++n}`, name: getTrait(id).name, type: "racial", sort: n,
    flags: { "dbu-ttrpg": { sourceId: id, ...flags } }, system: { script: getTrait(id).script ?? "", other: "villainous", chosen: [] } });
  // A Villain of PCC 4 at Power Level 12, holding what is given.
  const holding = (items = [], data = {}) => {
    const parent = new ActorStub({}, { strict: false });
    parent.items = items;
    parent.items.get = key => items.find(each => each.id === key);
    parent.uuid = "Actor.villain";
    parent.type = "adversary";
    const model = new DBUCharacterData({ powerLevel: 12, progression: progressionTo(12), adversary: { category: "villain", pcc: 4 }, ...data },
      { parent, strict: false });
    parent.system = model;
    // Twice, as Foundry prepares it: the Health Threshold an effect reads early is the last preparation's.
    for (let pass = 0; pass < 2; pass++) {
      model.prepareBaseData?.();
      model.prepareDerivedData();
    }
    return parent.system;
  };
  const bare = holding();
  const T = bare.tierOfPower;
  const bT = bare.baseTierOfPower;

  const stat = holding([item("statstick")]);
  check("Statstick: Combat Rolls and Soak 1(T); the Adversary Table's Life and Ki twice; no Unique Ability, no Special Maneuver",
    [stat.combat.strike - bare.combat.strike, stat.soakValue - bare.soakValue, stat.life.max - bare.life.max, stat.ki.max - bare.ki.max,
],
    [T, T, 96, 192]);
  const { permits } = await import(modUrl("effects/interpreter.mjs"));
  check("its bans: the Unique Abilities' as every ban is; the Special Maneuvers' its own mark - the Soar left open",
    [permits(stat.effects.slots, "uniqueAbilities"), stat.effects.slots["statstick.noSpecial"], permits(stat.effects.slots, "specialManeuvers")],
    [false, true, true]);

  const wild = holding([item("wild-swings")]);
  check("Wild Swings: Strike 2(bT) lower, Wound 3(T) higher; its Absolute Attack asked",
    [wild.combat.strike - bare.combat.strike, wild.combat.wound.physical - bare.combat.wound.physical, wild.effects.slots["wildSwings.absolute"]],
    [-2 * bT, 3 * T, true]);

  const daunt = holding([item("dauntless")]);
  const daunted = n => holding([item("dauntless")], { resources: { dauntless: { stacks: n } } }).life.max;
  check("Dauntless: a quarter more Life; a quarter less for each Health Threshold knocked through (the user's) - back to its own, then 3/4, then 1/2",
    [daunt.life.max, daunted(1), daunted(2), daunted(3)],
    [Math.floor(bare.life.max * 1.25), bare.life.max, Math.floor(bare.life.max * 0.75), Math.floor(bare.life.max * 0.5)]);
  check("no Bonus Momentum for knocking it through, no Reduced Momentum of its own",
    [daunt.effects.slots["dauntless.noBonus"], daunt.effects.slots["momentum.noReduced"]], [true, true]);

  const life = bare.life.max;
  const at = (ids, value, more = {}) => holding(ids.map(id => item(id)), { life: { value }, ...more });
  const desperate = [at(["desperate-adversary"], life), at(["desperate-adversary"], Math.floor(life * 0.4)), at(["desperate-adversary"], Math.floor(life * 0.05))];
  const plain = [at([], life), at([], Math.floor(life * 0.4)), at([], Math.floor(life * 0.05))];
  check("Desperate Adversary: for each Health Threshold below, Combat Rolls 1(T) higher and Soak 1(T) lower - none Healthy, one Bruised, three Critical",
    desperate.map((each, i) => [each.combat.strike - plain[i].combat.strike, each.soakValue - plain[i].soakValue]),
    [[0, 0], [T, -Math.min(T, plain[1].soakValue)], [3 * T, -Math.min(3 * T, plain[2].soakValue)]]);

  const arrogantHealthy = at(["arrogant-and-unstoppable"], life);
  const arrogantBruised = at(["arrogant-and-unstoppable"], Math.floor(life * 0.4));
  const arrogantMarked = at(["arrogant-and-unstoppable"], Math.floor(life * 0.4), { conditions: { "arrogant-unstoppable-mark": 1 } });
  check("Arrogant and Unstoppable: Healthy, Combat Rolls, Soak and Might 2(T); Bruised, none; Bruised but counted Healthy by (2), all of it",
    [[arrogantHealthy.combat.strike - plain[0].combat.strike, arrogantHealthy.might - plain[0].might],
     [arrogantBruised.combat.strike - plain[1].combat.strike], [arrogantMarked.combat.strike - plain[1].combat.strike, arrogantMarked.soakValue - plain[1].soakValue]],
    [[2 * T, 2 * T], [0], [2 * T, 2 * T]]);

  const off = holding([item("statstick", { villainousOff: true })]);
  check("one switched off is had and does nothing - by hand, or by a Weakpoint hit",
    [off.combat.strike - bare.combat.strike, off.life.max - bare.life.max], [0, 0]);

  const CHAT = read("module", "chat.mjs");
  const USE = read("module", "use-maneuver.mjs");
  const SHEET = read("module", "sheets", "actor-character-sheet.mjs");
  const TRAITS = read("templates", "parts", "actor-traits.hbs");
  const TAB = read("templates", "parts", "actor-adversary.hbs");
  check("wired: the Bonus Momentum, the Absolute Attack twice a Round, the Soar alone, the Defeated (2) once an Encounter as its Keyword is",
    [CHAT.includes('else if (knockedFor && (target.system.effects?.slots?.["dauntless.noBonus"] !== true)) {'),
     CHAT.includes("|| (!reflecting && maneuver.attacking && await askWildSwings(actor)));"), CHAT.includes("if (count >= 2) return false;"),
     USE.includes('if (maneuver.special && (maneuver.id !== "soar") && (slots?.["statstick.noSpecial"] === true)) {'),
     getTrait("second-phase").script.includes("[triggered/defeated, effect 2]\nlife.value += floor(life.max / 2);")],
    [true, true, true, true, true]);
  check("listed above the Racial Traits on an Adversary's Traits tab and on its own tab, switched on and off, its own or the page's",
    [TRAITS.indexOf('data-section="villainousTraits"') < TRAITS.indexOf('data-section="racialTraits"'), TRAITS.includes("{{#if isAdversary}}"),
     (TRAITS.match(/data-action="toggleVillainous"/g) ?? []).length, TAB.includes('data-action="addVillainousTrait"'),
     TAB.includes('data-action="toggleVillainous"'), SHEET.includes('<option value="custom">Your own - a name and its text</option>'),
     SHEET.includes("return addCustomVillainousTrait(this.actor, picked.name, picked.text);")],
    [true, true, 1, true, true, true, true]);
}

// --- Stage 5: Weakpoints --------------------------------------------------------------------------------
{
  const system = { customBuffs: [
    { id: "a", name: "Tail cut: FO", group: "W", active: false, effect: "force.mod", flat: -4 },
    { id: "b", name: "Tail cut: Soak", group: "w", active: false, effect: "soakValue", flat: -6 },
    { id: "c", name: "Other", group: "X", active: false, effect: "strike", flat: 2 }] };
  const hit = ADV.weakpointOutcome(system, { traitName: "Statstick", conditionName: "Impediment", group: "w" });
  check("a Weakpoint hit: the group's rows on, whatever the case of its letter, the rest as they were; what was done said",
    [hit.buffs.map(buff => [buff.id, buff.active]), hit.lines],
    [[["a", true], ["b", true], ["c", false]],
     ["Statstick switched off.", "Impediment applied.", "Custom Buffs of group W switched on: Tail cut: FO, Tail cut: Soak."]]);
  check("nothing chosen: nothing changed, nothing said", [ADV.weakpointOutcome(system, {}).buffs, ADV.weakpointOutcome(system, {}).lines], [null, []]);
  const kept = made("adversary", { adversary: { category: "villain", pcc: 4, weakpoints: [{ id: "w1", what: "A Called Shot to the tail", does: "Loses Statstick" }] } });
  check("written on its sheet: what each is and what hitting it does",
    kept.system.adversary.weakpoints.map(weak => [weak.id, weak.what, weak.does]), [["w1", "A Called Shot to the tail", "Loses Statstick"]]);

  const SHEET = read("module", "sheets", "actor-character-sheet.mjs");
  const TAB = read("templates", "parts", "actor-adversary.hbs");
  const order = ["Adversary Category", ">\n      Attributes", ">\n      Skills", "In Combat", ">\n      Villainous Traits", ">\n      Weakpoints"]
    .map(title => TAB.replace(/\r\n/g, "\n").indexOf(title));
  check("the Adversary tab's panels in the user's order: Category, Attributes, Skills, In Combat, Villainous Traits, Weakpoints",
    [order.every(at => at >= 0), order.every((at, i) => !i || (at > order[i - 1]))], [true, true]);
  check("its rows written, not submitted; the hit's window offering a Villainous Trait, a Combat Condition and a group of Custom Buffs - and said in the chat",
    [TAB.includes('data-weakpoint="what"'), TAB.includes('data-weakpoint="does"'), TAB.includes('data-action="weakpointHit"'),
     SHEET.includes('this.#writeWeakpoint(input.closest("[data-weakpoint-id]")?.dataset.weakpointId, input.dataset.weakpoint, input.value);'),
     SHEET.includes('${select("trait", "Villainous Trait off",'), SHEET.includes('${select("condition", "Combat Condition",'),
     SHEET.includes('${select("group", "Custom Buffs on",'), SHEET.includes('if (item) await item.setFlag("dbu-ttrpg", "villainousOff", true);'),
     SHEET.includes("if (condition) await setCondition(this.actor, condition.key, 1);"), SHEET.includes("<b>Weakpoint hit</b>")],
    [true, true, true, true, true, true, true, true, true, true]);
}

// --- Stage 6a: Villainous Maneuvers ---------------------------------------------------------------------------
{
  const { getTrait, traitsOfKind } = await import(modUrl("effects/traits.mjs"));
  const VIL = await import(modUrl("villainous.mjs"));
  const ids = ["act-again", "face-me-at-full-power", "get-up", "insta-kill", "one-man-army", "one-on-one-duel", "stop-wasting-my-time", "time-to-get-serious"];
  const files = traitsOfKind("maneuvers").filter(trait => trait.source === "Villainous Maneuver");
  check("the Villainous Maneuvers, each its file: Special Maneuvers, its type, its Action Cost and its limit as the page gives them",
    files.map(trait => [trait.id, trait.type, Number(trait.actionCost) || 0, String(trait.usageLimit ?? ""), Boolean(trait.special)]).sort(),
    [["act-again", "outOfSequence", 0, "1/round", true], ["area-wipe", "standard", 2, "1/encounter", true], ["face-me-at-full-power", "outOfSequence", 0, "1/encounter", true],
     ["get-up", "standard", 1, "1/round", true], ["insta-kill", "standard", 2, "1/encounter", true], ["one-man-army", "instant", 0, "", true],
     ["one-on-one-duel", "instant", 0, "1/encounter", true], ["planet-burst", "standard", 3, "1/round", true], ["stop-wasting-my-time", "outOfSequence", 0, "1/encounter", true],
     ["time-to-get-serious", "instant", 0, "1/encounter", true]]);
  check("One-Man Army in the user's words", getTrait("one-man-army").text.includes(
    "Spend 2 Adversary Actions to use a Standard Maneuver with an Action Cost of 1 Action as an Instant Maneuver."), true);
  const MAN = await import(modUrl("maneuvers.mjs"));
  const adversary = { type: "adversary", name: "Frieza", system: { effects: { slots: {} }, specialManeuvers: [] }, items: [] };
  const hero = { type: "character", name: "Goku", system: { effects: { slots: {} }, specialManeuvers: [] }, items: [] };
  const getUp = { id: "get-up", name: "Get Up!", special: true, source: "Villainous Maneuver" };
  check("open to every Adversary, as a Special Maneuver given; to nobody else - and shut by what shuts Special Maneuvers",
    [MAN.whyNotSpecial(adversary, getUp), Boolean(MAN.whyNotSpecial(hero, getUp)),
     Boolean(MAN.whyNotSpecial({ ...adversary, system: { ...adversary.system, effects: { slots: { specialManeuvers: { forbidden: true, value: false } } } } }, getUp))],
    [null, true, MAN.whyNotSpecial({ ...adversary, system: { ...adversary.system, effects: { slots: { specialManeuvers: { forbidden: true, value: false } } } } }, getUp) !== null]);
  check("given with an Adversary's sheet, and by the sheet's button; nobody else's",
    [read("module", "use-maneuver.mjs").includes('.filter(m => (m.source === "Core Rule") || !m.source || (adversary && (m.source === "Villainous Maneuver")))'),
     read("module", "dbu-ttrpg.mjs").includes('coreManeuverItems({ adversary: actor.type === "adversary" })'),
     read("module", "sheets", "actor-character-sheet.mjs").includes("coreManeuverItems({ adversary: isAdversary(this.actor) })")],
    [true, true, true]);
  const USE = read("module", "use-maneuver.mjs");
  const SHEET = read("module", "sheets", "actor-character-sheet.mjs");
  check("wired: asked before anything is paid, done once its card is made; its Action Cost in Adversary Actions where it may be",
    [USE.includes("villainPlan = await villainousBefore(actor, maneuver);"), USE.includes("if (villainPlan) await villainousAfter(actor, maneuver, villainPlan, card);"),
     USE.includes('if ((kind === "standard") && await adversaryActionsFor(actor, maneuver, amount, actionsWithin(actor, "standard"))) {'),
     USE.includes('if (isVillainousManeuver(maneuver) && actor.system?.adversaryNarrative && ((Number(actor.system.actions?.counterLeft) || 0) >= amount)) return true;'),
     USE.includes('if (maneuver.special && (maneuver.id !== "soar") && (slots?.["statstick.noSpecial"] === true)) {')],
    [true, true, true, true, true]);
  check("a Villainous tab of their own on an Adversary's Maneuvers tab, off the type tabs",
    [SHEET.includes('...(isAdversary(this.actor) ? [{ key: "villainous", label: "Villainous", playable: true,'),
     SHEET.includes('.filter(maneuver => ((group.key === "villainous") ? isVillainousManeuver(maneuver)')],
    [true, true]);
  const VILSRC = read("module", "villainous.mjs");
  const CHAT = read("module", "chat.mjs");
  const COMBAT = read("module", "combat.mjs");
  check("Act Again: offered on the card of the turn beginning as another's ends, its turn put right after theirs and gone once over",
    [CHAT.includes('again.textContent = `Act Again - ${actor.name}`;'), CHAT.includes("await useManeuver(actor, maneuver, { outOfSequence: true });"),
     VILSRC.includes("(card.subjectUuid !== combat.combatant?.actor?.uuid)"), VILSRC.includes('flags: { "dbu-ttrpg": { actAgain: true } }'),
     COMBAT.includes('if (actAgainOver) await (await import("./villainous.mjs")).actAgainEnded(combat, actAgainOver);'),
     COMBAT.includes('if (combatant.getFlag?.("dbu-ttrpg", "actAgain")) return;')],
    [true, true, true, true, true, true]);
  // The review (2026-11-14): the turn it cuts into - begun already, its card out - was ended by it and begun a second time after.
  // Now as Jump Start's: moved to with no turn change told, the cut one taken up again, not begun again.
  const turnChange = COMBAT.slice(COMBAT.indexOf('Hooks.on("combatTurnChange"'), COMBAT.indexOf('Hooks.on("deleteCombatant"'));
  check("Act Again's turn put in as Jump Start's: no turn change told, the turn it cuts into not ended and not begun again",
    [VILSRC.includes("combat.update({ turn: at })"), VILSRC.includes('await combat.setFlag("dbu-ttrpg", "turnResumed", current.id);'),
     VILSRC.includes("await keepTurnWith(combat, made.id);"), VILSRC.includes("await beginTurnOf(combat, actor);"),
     turnChange.indexOf("actAgainEnded(combat, actAgainOver)") < turnChange.indexOf('const resumed = combat.getFlag?.("dbu-ttrpg", "turnResumed");'),
     turnChange.includes("if (resumed && (arrivingId === resumed)) {")],
    [false, true, true, true, true, true]);
  check("the rest: One-Man Army's pick used as an Instant, its 2 Adversary Actions once it is; 1-on-1 Duel switching its toggle; Insta-Kill said;"
      + " Time to Get Serious's Karma, Conditions, Grapple and Legend Realized; Get Up!'s tenth, counted for Will to Survive",
    [VILSRC.includes('const used = await useManeuver(actor, { ...plan.chosen, type: "instant", actionCost: 0 });'),
     VILSRC.includes('await spendActions(actor, 2, "counter");'), VILSRC.includes('await actor.update({ "system.adversary.duel": true });'),
     VILSRC.includes("<b>Insta-Kill</b>"), VILSRC.includes('(each.key !== "suffocating")'), VILSRC.includes("return legendRealized(actor);"),
     VILSRC.includes("const life = Math.floor((Number(who.system.life?.max) || 0) / 10);"),
     VILSRC.includes('"system.defeatsEscaped": (Number(who.system.defeatsEscaped) || 0) + 1')],
    [true, true, true, true, true, true, true, true]);
  check("the two that waited for the Transformations built (stage 7): no longer refused",
    VILSRC.includes("const WAITING"), false);
  check("an Adversary's Adversary Actions pay a Villainous Maneuver's Action Cost; anyone else's, or another Maneuver's, not",
    [await VIL.adversaryActionsFor({ system: { adversaryNarrative: true, actions: { counterLeft: 3 } } }, { source: "Villainous Maneuver" }, 2, 0),
     await VIL.adversaryActionsFor({ system: { adversaryNarrative: true, actions: { counterLeft: 1 } } }, { source: "Villainous Maneuver" }, 2, 0),
     await VIL.adversaryActionsFor({ system: { adversaryNarrative: false, actions: { counterLeft: 5 } } }, { source: "Villainous Maneuver" }, 2, 0),
     await VIL.adversaryActionsFor({ system: { adversaryNarrative: true, actions: { counterLeft: 5 } } }, { source: "Core Rule" }, 2, 0)],
    [true, false, false, false]);
}

// --- Stage 6b: Area Wipe ---------------------------------------------------------------------------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const VIL = await import(modUrl("villainous.mjs"));
  const wipe = getTrait("area-wipe");
  check("Area Wipe: a Standard Maneuver of 2 Actions, once an Encounter, an attack of the Simple Profile - any Foundation - Exploitable",
    [wipe.type, wipe.actionCost, wipe.attacking, wipe.profile, wipe.foundation ?? "", wipe.exploitable], ["standard", 2, true, "simple", "", "All adjacent Opponents."]);
  const actor = { uuid: "Actor.frieza" };
  const others = [{ uuid: "Actor.goku" }, { uuid: "Actor.frieza" }, { uuid: "Actor.vegeta" }, { uuid: "Actor.goku" }, null];
  globalThis.game.combat = { combatants: others.map(each => ({ actor: each })) };
  check("its targets: every other Character in the Combat, once each", VIL.areaWipeTargets(actor).map(each => each.uuid), ["Actor.goku", "Actor.vegeta"]);
  globalThis.game.combat = null;
  const USE = read("module", "use-maneuver.mjs");
  const CHAT = read("module", "chat.mjs");
  check("wired: given every other one as its targets, Hidden or not, however far; concluded, the Qualities off and the Features said",
    [USE.includes('if ((maneuver?.id === "area-wipe") && !options.targetUuid) {'),
     USE.includes('const several = maneuver.attacking && (((game.user.targets?.size ?? 0) > 1) || ["area-wipe", "planet-burst"].includes(maneuver.id));'),
     USE.includes('let outOfReach = targetActor && !maneuver.throws && !unbounded && !["area-wipe", "planet-burst"].includes(maneuver.id)'),
     CHAT.includes('if (attack?.maneuverId === "area-wipe") await (await import("./villainous.mjs")).areaWipeConcluded(attack);'),
     read("module", "villainous.mjs").includes('else await requestActorUpdate(actor, { "system.battlefield.qualities": [] });')],
    [true, true, true, true, true]);
}

// --- Stage 7: Quickplay ------------------------------------------------------------------------------------
{
  const extra = { agility: 0, force: 0, tenacity: 0, scholarship: 0, insight: 0, magic: 0, personality: 0 };
  const quick = (more = {}) => ({ adversary: { extra, quickplay: { on: true, limit: "force", threeA: "agility", threeB: "tenacity", half: "insight", ...more } } });
  check("the Score Limit, 8 and 3 more a Tier: at base Tier 3, 14 - two at 3/4 of it (10), one at 1/2 (7), the other three at 1 (the user's)",
    [ADV.quickplayScores(quick(), 3).limit, ADV.quickplayScores(quick(), 3).scores],
    [14, { agility: 10, force: 14, tenacity: 10, scholarship: 1, insight: 7, magic: 1, personality: 1 }]);
  check("Balanced Warrior: the lower of Force and Magic set to the higher; off, nothing set; 3(bT) Talents",
    [ADV.quickplayScores(quick({ limit: "magic", threeA: "force" }), 2, { balanced: true }).scores.force,
     ADV.quickplayScores(quick({ limit: "magic", threeA: "force" }), 2, { balanced: true }).scores.magic,
     ADV.quickplayScores({ adversary: { extra, quickplay: { on: false } } }, 3), ADV.quickplayTalentCount(1), ADV.quickplayTalentCount(4)],
    [11, 11, null, 3, 12]);
  const hero = made("character");
  const fast = made("adversary", { adversary: { category: "villain", pcc: 4, extra: { magic: 2 },
    quickplay: { on: true, limit: "force", threeA: "agility", threeB: "tenacity", half: "insight", talents: ["balanced-warrior"] } } });
  const tier = DBUCharacterData.tierOfPowerFor(12);
  const limit = 8 + 3 * (tier - 1);
  check("on an Adversary: its Scores set by it, in place of the table's - the Attribute Points written still on top; Balanced Warrior's Force and Magic",
    [fast.system.attributes.force.score, fast.system.attributes.agility.score, fast.system.attributes.insight.score,
     fast.system.attributes.magic.score, fast.system.attributes.scholarship.score],
    [limit, Math.floor(limit * 3 / 4), Math.floor(limit / 2), limit + 2, 1]);
  const pretend = made("character", { adversary: { extra, quickplay: { on: true, limit: "force", threeA: "agility", threeB: "tenacity", half: "insight" } } });
  check("on a Character: nothing", pretend.system.attributes.force.score, hero.system.attributes.force.score);
  const TAL = await import(modUrl("talents.mjs"));
  check("its Talents the Quickplay's in place of the table's - the Character Perks' still",
    TAL.progressionTalentIds({ parent: { type: "adversary" }, powerLevel: 12, progression: [{ lvl: 2, choice: "Talent Addition", talent: "brawler" }],
      characterPerks: [{ lvl: 1, choice: "Talent Addition", talent: "iron-body" }],
      adversary: { quickplay: { on: true, talents: ["balanced-warrior", "", "power-striker"] } } }),
    ["balanced-warrior", "power-striker", "iron-body"]);
  const PROG = read("templates", "parts", "actor-progression.hbs");
  const SHEET = read("module", "sheets", "actor-character-sheet.mjs");
  check("on its Progression tab, above the table: the switch, the four picks, the Talents by Tier as the Talent Addition row's list; the table gone while on, the Character Perks kept",
    [PROG.indexOf("dbu-quickplay") < PROG.indexOf('<table class="progression-table">\n'.replace("\n", "")) || PROG.indexOf("dbu-quickplay") < PROG.lastIndexOf('<table class="progression-table">'),
     PROG.includes('name="system.adversary.quickplay.on"'), PROG.includes('name="system.adversary.quickplay.{{place.field}}"'),
     PROG.includes('<input type="hidden" data-quickplay-talent="{{row.index}}" value="{{row.talent}}"/>'),
     PROG.includes("{{#unless quickplay.on}}\n  <table class=\"progression-table\">") || PROG.replace(/\r\n/g, "\n").includes("{{#unless quickplay.on}}\n  <table class=\"progression-table\">"),
     PROG.replace(/\r\n/g, "\n").includes("  </table>\n  {{/unless}}\n\n  {{! Character Perks from anywhere"),
     SHEET.includes("this.#writeQuickplayTalent(Number(field.dataset.quickplayTalent), field.value);"),
     read("module", "dbu-ttrpg.mjs").includes('|| ("adversary" in changes.system))) return;')],
    [true, true, true, true, true, true, true, true]);
}

// --- Stage 8: Adversary Minions --------------------------------------------------------------------------
{
  const ALLIES = await import(modUrl("allies.mjs"));
  const slots = add => ({ "minions.combatRolls": { add }, "minions.soakValue": { add: 0 } });
  const frieza = { documentName: "Actor", id: "frieza", type: "adversary", system: { minions: [], effects: { slots: slots(2) } }, getFlag: () => null };
  const cell = { documentName: "Actor", id: "cell", type: "adversary", system: { minions: [], effects: { slots: slots(3) } }, getFlag: () => null };
  const goku = { documentName: "Actor", id: "goku", type: "character", system: { minions: ["saibaman"], effects: { slots: slots(5) } }, getFlag: () => null };
  const mook = { documentName: "Actor", id: "mook", type: "minion", system: { adversaryMinion: true, master: "" }, getFlag: () => null };
  const copy = { documentName: "Actor", id: "copy", type: "minion", system: { adversaryMinion: true, duplicate: true, master: "frieza" }, getFlag: () => null };
  const saibaman = { documentName: "Actor", id: "saibaman", type: "minion", system: { master: "" }, getFlag: () => null };
  const actors = [frieza, cell, goku, mook, copy, saibaman];
  const before = globalThis.game.actors;
  globalThis.game.actors = { contents: actors, get: id => actors.find(each => each.id === id) };
  check("an Adversary Minion: every Adversary its Master for any effects, their gifts added together; a Duplicate one its own Master's alone",
    [ALLIES.isAdversaryMinion(mook), ALLIES.isAdversaryMinion(copy), ALLIES.mastersOf(mook), ALLIES.masterOf(mook), ALLIES.mastersOf(copy),
     ALLIES.minionGifts(mook).combatRolls, ALLIES.minionGifts(copy).combatRolls],
    [true, false, ["frieza", "cell"], "frieza", ["frieza"], 5, 2]);
  check("its Act Phase always, Commanded or not; and every Adversary's to Command - a Character's Minions as they were",
    [ALLIES.actsFreely(mook), ALLIES.actsFreely(saibaman), ALLIES.minionsOf(cell), ALLIES.minionsOf(goku), ALLIES.masterOf(saibaman)],
    [true, false, ["mook"], ["saibaman"], "goku"]);
  globalThis.game.actors = before;
  const MAIN = read("module", "dbu-ttrpg.mjs");
  const CHAT = read("module", "chat.mjs");
  const SET = read("templates", "parts", "actor-settings.hbs");
  check("any Power Level, not grown with a Master's; Commanded, the Power Up or a Surge said; out of Limited Control's count; a box on its Settings",
    [MAIN.includes("if (minion.system?.adversaryMinion && !minion.system?.duplicate) continue;"),
     CHAT.includes("Maneuver or a Surge as an Out-of-Sequence Maneuver instead."),
     read("module", "combat.mjs").includes("if (combatant.actor?.system?.adversaryMinion && !combatant.actor?.system?.duplicate) return;"),
     SET.includes('<input type="checkbox" name="system.adversaryMinion"'), "adversaryMinion" in DBUCharacterData.defineSchema()],
    [true, true, true, true, true]);
}

// --- Stage 6c: Planet Burst ------------------------------------------------------------------------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const VIL = await import(modUrl("villainous.mjs"));
  const burst = getTrait("planet-burst");
  check("Planet Burst: a Standard Maneuver of 3 Actions, once a Round and twice an Encounter, a Mega Flare whose price is not its Profile's",
    [burst.type, burst.actionCost, burst.usageLimit, burst.encounterLimit, burst.attacking, burst.profile, burst.kiCostCoversProfile],
    ["standard", 3, "1/round", 2, true, "megaFlare", true]);
  const foe = (value, max, narrative = true) => ({ system: { adversaryNarrative: narrative, narrativeStamina: { value, max } } });
  check("its price this Round's whole Narrative Stamina (the user's): none of it spent, and an Elite's or a Villain's",
    [VIL.planetBurstRefused(foe(144, 144)), Boolean(VIL.planetBurstRefused(foe(100, 144))), Boolean(VIL.planetBurstRefused(foe(0, 0))),
     Boolean(VIL.planetBurstRefused(foe(144, 144, false)))], ["", true, true, true]);
  const pcs = [{ type: "character", uuid: "a" }, { type: "adversary", uuid: "b" }, { type: "minion", uuid: "c" }, { type: "character", uuid: "a" },
    { type: "character", uuid: "d" }];
  globalThis.game.combat = { combatants: { contents: pcs.map(actor => ({ actor })) } };
  check("its targets: every Player Character in the Combat, once each", VIL.planetBurstTargets().map(actor => actor.uuid), ["a", "d"]);
  globalThis.game.combat = null;
  const USE = read("module", "use-maneuver.mjs");
  const CHAT = read("module", "chat.mjs");
  const VILSRC = read("module", "villainous.mjs");
  check("wired: at every Player Character with PCC Energy Charges; its Stamina paid, 1/2 of PCC Power Shot stacks on its Wound; no Duel, the planet destroyed and no Damage",
    [USE.includes('if ((maneuver?.id === "planet-burst") && !options.targetUuid) {'),
     USE.includes("extraCharges: (Number(options.extraCharges) || 0) + (Number(actor.system.adversaryGains?.pcc) || 1) });"),
     VILSRC.includes('await actor.update({ "system.narrativeStamina.value": 0 });'),
     VILSRC.includes("const stacks = Math.floor((Number(actor.system.adversaryGains?.pcc) || 1) / 2);"),
     VILSRC.includes('label: "Power Shot", written: `+${2 * stacks}(T)`, value: 2 * stacks * tier'),
     CHAT.includes('gone.textContent = "No Duel - the planet is destroyed";'),
     CHAT.includes("? \"Planet Burst: no Player Character answered with a Duel - the planet is destroyed, and nobody takes Damage.\""),
     read("module", "maneuvers.mjs").includes('if (maneuver.id !== "planet-burst") cost = Math.max(cost, minimumAttackKiCost(declared?.profile, actor));')],
    [true, true, true, true, true, true, true, true]);
}

// --- Adversary Transformations' machinery, second pass (2026-11-28) ------------------------------------------------------------
{
  const CHAT = read("module", "chat.mjs");
  const RUN = read("module", "effects/moments-runtime.mjs");
  const TR = read("module", "transformations.mjs");
  check("costs N counter paid in every window: Moment cards, offered windows, a declared Maneuver, Respond and the hit",
    [CHAT.includes("await payCounterCosts(actor, offered.filter(entry => ids.includes(entry.blockId)));"),
     CHAT.includes("await payCounterCosts(actor, triggers.filter(entry => !before.has(entry.blockId)));"),
     (CHAT.match(/await payTickedCounterCosts\(/g) ?? []).length],
    [true, true, 2]);
  check("Damage: halved by a Resource held for it (resourceHalvesDamage), a Resource worn down by it (resourceDrainedByDamage) leaving its Transformation at 0",
    [CHAT.includes("await studiedShield(target, fromUuidSync(attack.attackerUuid ?? \"\"), await halveByResource(target, settledDamage))"),
     CHAT.includes("await drainOnDamage(target, Math.max(0, damage - Math.max(0, Number(absorbed) || 0)));"),
     CHAT.includes("await TR.leaveTransformations(target, [item.id]);"),
     read("module", "effects/traits.mjs").includes("halvesDamage: Boolean(trait.resourceHalvesDamage),")],
    [true, true, true, true]);
  check("conditionOnLeave owed, gained as the Transformation is left; lifeBelowNextThreshold; shedForAdversaryActions; inflictedLosesKi",
    [RUN.includes('case "conditionOnLeave": {'), TR.includes('const due = onLeave.filter(entry => entry.id === item.system?.transformationId);'),
     RUN.includes('case "lifeBelowNextThreshold": {'), RUN.includes('case "shedForAdversaryActions": {'), RUN.includes('case "inflictedLosesKi": {')],
    [true, true, true, true, true]);
  check("inflict-condition fired for any Combat Condition on an Opponent; the Adversary Action Clash box; an Ally's Damage answered on its card",
    [CHAT.includes('if (opponent && combat) answerFor(by, "inflict-condition", { inflictedUuid: actor.uuid, condition: key });'),
     CHAT.includes("...adversaryBumpBonus(actor, clash, uuid),"),
     CHAT.includes("offerAllyDamageBasic(message, armsUser, target);")],
    [true, true, true]);
  check("Charging Assault's cap, Teamwork (2) multiplied, Combat Recovery's 1/2 Surgency, Transformation Traits ignoring a Quality",
    [read("module", "signature.mjs").includes('const capPerTier = 2 + (Number(applySlot(attacker.system.effects?.slots, "chargingAssault.capPerTier", 0)) || 0);'),
     read("module", "united-attack.mjs").includes('applySlot(joiner.system?.effects?.slots, "united.teamworkMultiplier", 1)'),
     read("traits", "maneuvers", "combat-recovery.dbu").includes('flagged("combatRecovery.halfSurgency")'),
     read("module", "effects/registry.mjs").includes("traitFilesFor(fileOf(item)).flatMap(trait => [trait?.ignoresQualities ?? []].flat())")],
    [true, true, true, true]);
}

console.log(failed ? `${failed} failing` : "all passing");
process.exit(failed ? 1 : 0);
