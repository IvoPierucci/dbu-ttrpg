/**
 * What every value on the sheet is made of, in the hover on it.
 *
 * Two halves. The engine's: a Slot keeps who contributed what, so a finished number can
 * be taken apart again - that half is checked in evaluate.mjs, where the Slots are. And
 * the sheet's: the base's own ingredients, which only the data model knows, and what a
 * Combat Roll picks up on its way to the dice, which is on the character but not in the
 * number.
 *
 * Built as a real character and rendered with the sheet's own helpers, cut out and run:
 * every one of these numbers is the end of a long derivation, and a label attached to the
 * wrong one compiles perfectly.
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
globalThis.foundry.data = await import(appUrl("common/data/_module.mjs"));
const { default: DataModel } = await import(appUrl("common/abstract/data.mjs"));
globalThis.foundry.abstract = { DataModel, TypeDataModel: DataModel };
globalThis.ui = { notifications: { warn: () => {}, error: () => {}, info: () => {} } };
globalThis.Handlebars = {
  escapeExpression: s => String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
};

const TRAITS = path.join(ROOT, "traits");
globalThis.foundry.utils.fetchJsonWithTimeout = async () =>
  JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));
globalThis.fetch = async url => {
  const file = path.join(TRAITS, String(url).replace("systems/dbu-ttrpg/traits/", ""));
  if (!fs.existsSync(file)) return { ok: false, status: 404, statusText: "missing" };
  return { ok: true, status: 200, text: async () => fs.readFileSync(file, "utf8") };
};

const { default: DBUCharacterData } = await import(modUrl("data/actor-character.mjs"));
const { partLine, noteLine, floorLine, breakdownTable } = await import(modUrl("breakdown.mjs"));
const { loadTraits } = await import(modUrl("effects/traits.mjs"));
await loadTraits();

const SHEET = fs.readFileSync(
  path.join(ROOT, "module", "sheets", "actor-character-sheet.mjs"), "utf8");
const MAIN = fs.readFileSync(path.join(ROOT, "templates", "parts", "actor-main.hbs"), "utf8");
const COMBAT = fs.readFileSync(path.join(ROOT, "templates", "parts", "actor-combat.hbs"), "utf8");

// The two helpers, shared now by the sheet's hovers and every roll window (breakdown.mjs).
const { workingsTable, atRollTime } = await import(modUrl("breakdown.mjs"));

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

/** A character with enough going on to have something to explain. */
function build({ powerLevel = 12, attacks = 0, defenceStacks = 0, stacks = 0, life = null,
                 failedChecks = [] } = {}) {
  const progression = [
    { lvl: 1, choice: "Skill Improvement", locked: true, attributes: {}, skillRanks: ["craft", "craft"] }
  ];
  for (let lvl = 2; lvl <= 8; lvl++) {
    progression.push({ lvl, choice: "Attribute Addition", locked: false,
      attributes: { force: 1, agility: 1, insight: 1, tenacity: 1, scholarship: 1 }, skillRanks: [] });
  }

  const model = new DBUCharacterData({
    powerLevel, progression,
    attacksThisRound: attacks, diminishingDefense: defenceStacks, superStacks: stacks,
    // A Threshold penalty comes from losing the Steadfast Check a Threshold asks for,
    // not from the Life Points alone - so it is the failures that are set here.
    thresholdChecks: Object.fromEntries(failedChecks.map(key => [key, "fail"])),
    ...(life === null ? {} : { life: { value: life } })
  }, { strict: false });
  model.prepareBaseData?.();
  model.prepareDerivedData();
  return model;
}

/** The rows a table came out with, as [label, value] pairs, plus its notes and total. */
function read(html) {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(m => m[1]);
  const cells = row => [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => c[1].trim());

  const lines = [];
  const notes = [];
  let total = null;

  for (const row of rows) {
    const parts = cells(row);
    if (parts.length === 1) { notes.push(parts[0]); continue; }
    const source = (parts[3] ?? "").replace(/^\(|\)$/g, "");
    const value = (parts[2] ?? "").replace(/^\[|\]$/g, "");
    if (source === "Total") { total = Number(value); continue; }
    lines.push([source, value]);
  }
  return { lines, notes, total };
}

// --- The base says what it is made of --------------------------------------------------
{
  const model = build();

  const strike = read(workingsTable(model, "strike"));
  check("the Strike Roll names its ingredients",
    strike.lines.map(([source]) => source), ["Haste", "Awareness"]);
  check("and they add up to the number on the sheet",
    strike.total, model.combat.strike);
  check("which is what the sheet shows", strike.total,
    strike.lines.reduce((sum, [, value]) => sum + Number(value), 0));

  const dodge = read(workingsTable(model, "dodge"));
  check("the Dodge Roll names its Defense Value",
    dodge.lines[0][0], "Defense Value");

  // One Slot, three values: filed under the Slot they would have overwritten one another
  // and every Wound Roll would have shown the last Foundation's workings.
  for (const [foundation, attribute] of [
    ["physical", "Force Modifier"], ["energy", "Force Modifier"], ["magic", "Magic Modifier"]
  ]) {
    const wound = read(workingsTable(model, `wound.${foundation}`));
    check(`the ${foundation} Wound Roll names its Damage Attribute`,
      wound.lines.map(([source]) => source), [attribute]);
    check(`and comes to what the sheet shows`, wound.total, model.combat.wound[foundation]);
  }

  const might = read(workingsTable(model, "might"));
  check("Might says which of the two it took",
    ["Force Modifier", "Magic Modifier"].includes(might.lines[0][0]), true);

  // A value with no ingredients worth naming says Base, rather than inventing some.
  const reduction = read(workingsTable(model, "damageReduction"));
  check("a value with nothing to break down says Base",
    reduction.lines.map(([source]) => source), ["Base"]);
}

// --- A chain of Slots is a chain of steps -------------------------------------------------
{
  const model = build({ stacks: 2 });

  // The Soak Value goes through two: what the character has, then what anybody else did
  // to it. Read off the second alone, the ingredients of the first are lost.
  const soak = read(workingsTable(model, ["soakValue", "soakValue.external"],
    { total: model.soakValue }));
  check("the Soak Value names both its halves",
    // Its own half named for what it is (the user's): the Tenacity Modifier, or the base Tier of Power where higher.
    soak.lines.map(([source]) => (["Tenacity Modifier", "Base Tier of Power"].includes(source) ? "own" : source)), ["own", "Super Stacks"]);
  check("and Solid Bulk is worth what the Super Stacks say",
    Number(soak.lines[1][1]), model.superStack.solidBulk);
  check("and the total is the number on the sheet", soak.total, model.soakValue);

  // The total may be given outright, for a value clamped once more outside every Slot.
  check("a given total wins over the last Slot's",
    read(workingsTable(model, "might", { total: 99 })).total, 99);
}

// --- What a Combat Roll picks up on the way to the dice -------------------------------------
// None of it is in the number, and none of it can be: each is true of a roll rather than
// of a character. Said as notes, below the total, so the column still adds up.
{
  const rested = build();
  check("a character with nothing wrong has only the Extra Dice to mention",
    atRollTime(rested, "strike").filter(note => !note.includes("Extra Dice")), []);

  const worn = build({ attacks: 9, defenceStacks: 2, stacks: 2, life: 1,
    failedChecks: ["bruised", "injured"] });

  const strike = atRollTime(worn, "strike").join(" | ");
  check("Diminishing Offense is said on the Strike", strike.includes("Diminishing Offense"), true);
  check("the Muscle Penalty too", strike.includes("Muscle Penalty"), true);
  check("and the failed Steadfast Check",
    strike.includes("failed Steadfast Check"), true);
  check("but not Diminishing Defense", strike.includes("Diminishing Defense"), false);

  const dodge = atRollTime(worn, "dodge").join(" | ");
  check("Diminishing Defense is said on the Dodge", dodge.includes("Diminishing Defense"), true);
  check("and not Diminishing Offense", dodge.includes("Diminishing Offense"), false);

  // The Muscle Penalty is written against the rolls you make with your body; the Health
  // Threshold is written against every Combat Roll, the Wound Roll included.
  const wound = atRollTime(worn, "wound").join(" | ");
  check("the Wound Roll carries no Muscle Penalty", wound.includes("Muscle Penalty"), false);
  check("but does carry the failed Steadfast Check",
    wound.includes("failed Steadfast Check"), true);

  // They are notes, so the arithmetic above them still comes out.
  const table = read(workingsTable(worn, "strike", { extra: atRollTime(worn, "strike") }));
  check("they sit below the total rather than inside the sum",
    table.total, table.lines.reduce((sum, [, value]) => sum + Number(value), 0));
  check("and there are several of them", table.notes.length >= 3, true);
}

// --- The sheet asks for them, and puts them on the values ------------------------------------
{
  check("the sheet builds one table per value",
    SHEET.includes("context.workings = this.#workings();"), true);

  // Rows carry their own, because a template cannot join "agility" and ".mod".
  check("Attribute rows carry theirs", SHEET.includes("workings: context.workings[`${key}.mod`]"), true);
  check("Saving Throw rows too", SHEET.includes("workings: workingsTable(this.actor.system, `save.${key}`, { aside: split ? [] : sometimes }) || context.workings[`save.${key}`]"), true);
  check("and Skills - one sum of the Bonus's and the roll's", SHEET.includes('workings: skillWorkingsTable(this.actor.system, skill.key) || (workings[`skill.${skill.key}`] ?? "")'), true);

  // data-tooltip-html, not data-tooltip: the table is markup, and the other attribute
  // would show it as its own source text.
  for (const [what, markup, needle] of [
    ["the Attribute Modifier", MAIN, 'data-tooltip-html="{{attribute.workings}}"'],
    ["Might", COMBAT, 'data-tooltip-html="{{workings.might}}"'],
    ["the Soak Value", COMBAT, 'data-tooltip-html="{{workings.soakValue}}"'],
    ["a Skill", MAIN, 'data-tooltip-html="{{skill.workings}}"'],
    ["a Saving Throw", COMBAT, 'data-tooltip-html="{{save.workings}}"'],
    // The total as Aptitudes + Effects, the Effects each by name (the user's).
    ["the Strike Roll", COMBAT, 'data-tooltip-html="{{combatRolls.strike.totalTip}}"'],
    ["the Strike Roll's Effects", COMBAT, 'data-tooltip-html="{{combatRolls.strike.effectsTip}}"'],
    ["the Dodge Roll", COMBAT, 'data-tooltip-html="{{combatRolls.dodge.totalTip}}"'],
    ["the Dodge Roll's Effects", COMBAT, 'data-tooltip-html="{{combatRolls.dodge.effectsTip}}"'],
    ["a Wound Roll", COMBAT, 'data-tooltip-html="{{row.woundWorkings}}"']
  ]) {
    check(`${what} shows its workings`, markup.includes(needle), true);
  }

  // The Skill list shows what the button rolls. It showed the Skill Bonus, which is a
  // different number the moment anything touches the roll - Gifted Student does, and so
  // does every effect that names the Skill rather than its Bonus.
  check("the Skill list shows the roll, not the Bonus",
    MAIN.includes("{{numberFormat skill.roll decimals=0 sign=true}}"), true);
  check("and the Bonus is a row inside the hover",
    read(workingsTable(build(), "skill.craft")).lines.some(([source]) => source === "Skill Bonus"),
    true);
}

// --- Nothing is recorded onto the document ------------------------------------------------
{
  // The workings live in the effects bag, which is rebuilt from scratch on every pass -
  // so this can never be written to the Actor. A description of one derivation is not
  // data.
  const model = build();
  check("the workings are in the effects bag",
    typeof model.effects.workings, "object");
  check("and the bag is not a stored field",
    fs.readFileSync(path.join(ROOT, "module", "data", "actor-character.mjs"), "utf8")
      .includes("schema.effects"), false);
  check("a key nothing recorded gets no table", workingsTable(model, "nothing.like.this"), "");
}

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
