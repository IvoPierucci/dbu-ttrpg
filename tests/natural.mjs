/**
 * The Natural Result: the Base Die's own result, before any bonus and without the Tier
 * of Power Extra Dice, which never decide a Botch or a Critical.
 *
 * The `baseDie` Slot could both state it and adjust it, and only the statement was ever
 * read. Impaired - "reduce the Natural Result of your Combat Rolls by the number of
 * Impaired Stacks" - writes an adjustment, so it did nothing at all: not to the total,
 * and not to the Botch Range it exists to push you into.
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
const { applyPassives, collectReactive, applySlot } = await import(modUrl("effects/interpreter.mjs"));
const { reactiveFor } = await import(modUrl("effects/registry.mjs"));

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");

/** A character with the given Conditions, prepared as the data model prepares one. */
function prepared(conditions) {
  const errors = [];
  const actor = { name: "Probe", items: [], system: { conditions } };
  const programs = programsFor(actor, { report: m => errors.push(m) });
  const data = {
    effects: { slots: {}, active: [], errors, programs },
    conditions, baseTierOfPower: 3, tierOfPower: 3, powerLevel: 12,
    skills: {}, attributes: {}, savingThrows: {}
  };
  const scope = { data, errors, benefitsFrom: () => false };
  for (const phase of ["tier", "core", "late"]) {
    Object.assign(data.effects.slots, applyPassives(programs, phase, scope).slots);
  }
  actor.system = { ...data, effects: data.effects };
  return { actor, errors };
}

function atMoment(actor, moment, context = {}) {
  const scope = { data: actor.system, errors: [], context, queue: [] };
  return collectReactive(reactiveFor(actor), moment, scope);
}

/**
 * What a roll settles to, in the same order and with the same floors as evaluateCheck.
 * The die is rolled here rather than thrown, so the cases are about the arithmetic.
 */
function settle(baseDie, rolled, { botchRange = 1, criticalTarget = 20 } = {}) {
  const forced = baseDie?.set ?? null;
  const face = (forced === null) ? rolled : forced;
  const natural = baseDie ? Math.max(0, applySlot({ baseDie }, "baseDie", face)) : face;
  return {
    natural,
    shift: natural - face,
    botch: natural <= botchRange,
    critical: natural >= criticalTarget
  };
}

// --- What Impaired writes ---------------------------------------------------
{
  const { actor, errors } = prepared({ impaired: 2 });
  check("nothing is reported against Impaired", errors, []);
  const { slots } = atMoment(actor, "combat-roll", { roll: true });
  check("it adjusts the Natural Result rather than setting it",
    [slots.baseDie?.add, slots.baseDie?.set], [-2, null]);
}

// One stack, and none at all.
check("one stack takes one off",
  atMoment(prepared({ impaired: 1 }).actor, "combat-roll", { roll: true }).slots.baseDie?.add, -1);
check("an unaffected character has no Base Die Slot at all",
  atMoment(prepared({}).actor, "combat-roll", { roll: true }).slots.baseDie, undefined);

// --- What the roll does with it ---------------------------------------------
const impaired = stacks =>
  atMoment(prepared({ impaired: stacks }).actor, "combat-roll", { roll: true }).slots.baseDie;

// The whole point: a 3 with two Stacks of Impaired is a 1, and a 1 is a Botch. A
// penalty to the Combat Roll could never have done that.
check("it can push a roll into the Botch Range",
  settle(impaired(2), 3).botch, true);
check("the same roll unimpaired is not a Botch", settle(null, 3).botch, false);

// And out of the Critical Target, for the same reason.
check("it can cost a Critical", settle(impaired(1), 20).critical, false);

check("the Natural Result itself moves", settle(impaired(2), 11).natural, 9);
check("and the total moves with it - the die is part of the sum",
  settle(impaired(2), 11).shift, -2);

// Never below nothing, like every other value the system settles.
check("it stops at nothing", settle(impaired(2), 1).natural, 0);

// A Slot that states the Natural Result states it: adds land first and the set
// overrides them, which is Calculation Priority and not a rule of its own.
{
  const stated = { add: -2, multiply: 1, set: 18, min: null, max: null, clamp: null };
  check("an effect stating the Natural Result wins over one adjusting it",
    settle(stated, 4).natural, 18);
  check("and the total is not moved twice", settle(stated, 4).shift, 0);
}

// --- The reader exists ------------------------------------------------------
// It half-existed, which is why this went unseen: `set` was read and `add` was not.
// The whole Slot rather than only its `set`, which is what let Impaired do anything at
// all. Asked of the call's arguments rather than of the characters between them - the
// call has since grown an options object, and a pattern counting characters fails on
// the next thing that goes in.
check("the roll takes the whole Slot, not only its set",
  /evaluateCheck\(actor, bonus,[^]*?baseDie[,)]/.test(CHAT), true);
check("and carries the adjustment into the total",
  /roll\.total \+ naturalShift/.test(CHAT), true);

// How the line reads is checked in lines.mjs, which owns the wording for every
// roll rather than only this one.

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
