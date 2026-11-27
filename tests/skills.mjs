/**
 * What a Condition does to a Skill, from the Trait file to the number rolled.
 *
 * Blinded halves the Perception Skill Bonus and Sleeping takes 2 off it, and neither
 * did anything: both Skill Slots were declared, written by Conditions, and read by
 * nobody. The Slot existing and holding the right value is not the same as the sheet
 * showing it, which is the distinction this check exists to keep.
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
globalThis.ui = { notifications: { warn: () => {}, error: () => {}, info: () => {} } };

const TRAITS = path.join(ROOT, "traits");
globalThis.foundry.utils.fetchJsonWithTimeout = async () =>
  JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));
globalThis.fetch = async url => {
  const file = path.join(TRAITS, String(url).replace("systems/dbu-ttrpg/traits/", ""));
  if (!fs.existsSync(file)) return { ok: false, status: 404, statusText: "missing" };
  return { ok: true, text: async () => fs.readFileSync(file, "utf8") };
};

const { loadTraits } = await import(modUrl("effects/traits.mjs"));
await loadTraits();
const { programsFor } = await import(modUrl("effects/registry.mjs"));
const { applyPassives, applySlot } = await import(modUrl("effects/interpreter.mjs"));

const MODEL = fs.readFileSync(path.join(ROOT, "module", "data", "actor-character.mjs"), "utf8");
const SHEET = fs.readFileSync(
  path.join(ROOT, "module", "sheets", "actor-character-sheet.mjs"), "utf8");

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

const FLAT = JSON.stringify({ add: 0, multiply: 1, set: null, min: null, max: null, clamp: null });
const SKILLS = ["perception", "clairvoyance", "stealth", "flight"];
const zeroed = keys => Object.fromEntries(keys.map(k => [k, { mod: 0, score: 10, bonus: 0 }]));

/** Every Slot a character with these Conditions ends up holding. */
function slotsOf(conditions) {
  const errors = [];
  const programs = programsFor({ system: { conditions }, items: [] },
    { report: m => errors.push(m) });
  const data = {
    effects: { slots: {}, active: [], errors, programs },
    conditions, baseTierOfPower: 3, tierOfPower: 3, powerLevel: 12,
    skills: zeroed(SKILLS),
    attributes: zeroed(["agility", "force", "tenacity", "scholarship", "insight", "magic", "personality"]),
    savingThrows: zeroed(["impulsive", "corporeal", "cognitive", "morale"])
  };
  const scope = { data, errors, benefitsFrom: () => false };
  for (const phase of ["tier", "core", "late"]) {
    Object.assign(data.effects.slots, applyPassives(programs, phase, scope).slots);
  }
  return { slots: data.effects.slots, errors };
}

/** The two lines the data model derives, with the same floors and the same order. */
const withEffects = (slots, key, base, min = 0) => {
  const value = applySlot(slots, key, base);
  return (min === null) ? value : Math.max(min, value);
};
const skillBonus = (slots, key, base) => withEffects(slots, `skill.${key}.bonus`, base);
// The Skill Bonus is the base of the roll, not something added on after it. That is
// Calculation Priority: a multiplication comes after every other modification, so it
// has to find the whole roll assembled or it multiplies only part of it.
const skillRoll = (slots, key, base) =>
  withEffects(slots, `skill.${key}`, skillBonus(slots, key, base));

// --- Blinded ----------------------------------------------------------------
{
  const { slots, errors } = slotsOf({ blinded: 1 });
  check("nothing is reported against Blinded", errors, []);
  check("it halves the Perception Bonus", skillBonus(slots, "perception", 7), 3);
  check("a Skill it does not name is untouched", skillBonus(slots, "stealth", 7), 7);
  check("and it halves Awareness and Defense Value too",
    [withEffects(slots, "awareness", 9), withEffects(slots, "defenseValue", 9)], [4, 4]);
}

// --- Sleeping ---------------------------------------------------------------
{
  const { slots } = slotsOf({ sleeping: 1 });
  check("Sleeping takes 2 off Perception", skillBonus(slots, "perception", 7), 5);
  check("and 2 off Clairvoyance", skillBonus(slots, "clairvoyance", 7), 5);
}

// Both at once: the 2 comes off first, and then what is left is halved. Adds before
// multiplies is Calculation Priority, not an accident of the order they were applied.
{
  const { slots } = slotsOf({ blinded: 1, sleeping: 1 });
  check("stacked, the penalty lands before the halving",
    skillBonus(slots, "perception", 7), 2);
}

// A Skill Bonus never goes below nothing, however much is taken off it.
check("a Bonus is floored at nothing",
  skillBonus(slotsOf({ sleeping: 1 }).slots, "perception", 1), 0);

// --- The two Slots are not the same one -------------------------------------
// `skill.stealth` applies to rolling Stealth; `skill.stealth.bonus` is the number on
// the sheet. Folding one into the other would make a bonus to rolls raise the Bonus
// another Skill is compared against.
const mod = extra => ({ ...JSON.parse(FLAT), ...extra });
{
  const slots = { "skill.stealth": mod({ add: 4 }) };
  check("a roll bonus does not raise the Skill Bonus", skillBonus(slots, "stealth", 7), 7);
  check("but it is added to the roll", skillRoll(slots, "stealth", 7), 11);
}

// --- Calculation Priority ----------------------------------------------------
// "When an effect multiplies or divides a value, that is applied after all other
// modifications to said value." The roll is one value, so a doubling of it doubles
// the Skill Bonus too - against a base of nothing it would have doubled the 4 and
// left the 7 alone, which is what this catches.
{
  const slots = { "skill.stealth": mod({ add: 4, multiply: 2 }) };
  check("a multiplied roll multiplies the Skill Bonus with it",
    skillRoll(slots, "stealth", 7), 22);
}

// And it comes after the Bonus has finished being modified in its own right, since
// the Bonus is a value too and its own halving lands before this one is read.
{
  const { slots } = slotsOf({ blinded: 1 });
  slots["skill.perception"] = mod({ add: 4 });
  check("the halved Bonus is what the roll is built on",
    skillRoll(slots, "perception", 7), 7);
}

// A multiplication is the last thing to happen, whichever order the effects were
// written in - so an add and a multiply on the same value never depend on that order.
{
  const slots = { "skill.flight": mod({ add: 3, multiply: 0.5 }) };
  check("adds land before the multiply, and the result rounds down",
    skillRoll(slots, "flight", 6), 4);
}

// --- Both Slots are actually read -------------------------------------------
// The whole failure was a Slot nothing consumed, and it looked correct everywhere it
// was written. So the check is on the reading side.
// --- Saving Throws -----------------------------------------------------------
// The same Slot, the same omission: `save.<key>` was declared, documented and read
// by nothing. Its whole value is assembled before the Slot for the same reason the
// Skill roll is - so a halving halves the Saving Throw and not part of it.
{
  const slots = { "save.corporeal": mod({ add: 2, multiply: 0.5 }) };
  const save = (key, base) => withEffects(slots, `save.${key}`, base);
  check("a Saving Throw takes what an effect adds", save("corporeal", 10), 6);
  check("and one it does not name is untouched", save("morale", 10), 10);
}
check("the data model reads the Saving Throw Slot",
  /withEffects\(this, `save\.\$\{save\}`/.test(MODEL), true);

check("the data model reads the Skill Bonus Slot",
  /withEffects\(this, `skill\.\$\{key\}\.bonus`/.test(MODEL), true);
check("and the roll Slot", /withEffects\(this, `skill\.\$\{key\}`/.test(MODEL), true);
check("and the sheet rolls the finished value",
  /const total = skill\.roll;/.test(SHEET), true);
// Whatever the roll is worth is assembled before the Slot runs, so a halving finds
// the whole of it. The Bonus opens that base; Gifted Student adds to it, which is
// the point of it being a bonus to the Dice Score of a Check rather than to the
// Skill Bonus - Blinded halves the Bonus Slot above and leaves this alone.
// Inside the Slot for every Skill of its Attribute, which wraps it the way `save.all`
// wraps one Throw - another Slot, not something added after this one.
const rollBase = /const own = withEffects\(this, `skill\.\$\{key\}`, ([^,]*),/.exec(MODEL)?.[1] ?? "";
check("the roll Slot has a base at all", Boolean(rollBase), true);
check("with the Bonus opening it", rollBase.startsWith("entry.bonus"), true);
check("and nothing added after the Slot has run",
  rollBase.includes("withEffects"), false);

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
