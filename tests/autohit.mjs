/**
 * The flags that settle a Clash before it is rolled, from the character sheet to the
 * value resolveAttack reads.
 *
 * Sleeping was reported as doing nothing, and every piece of it looked right in
 * isolation: the file compiled, the Slot existed, the attack read it. What nothing had
 * ever checked was the whole run - a Condition ticked on an actor arriving at the Slot
 * with the phase and the shape the attack expects. That is what this does.
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
const { applyPassives } = await import(modUrl("effects/interpreter.mjs"));

/**
 * The Skills, Attributes and Saving Throws a real character has.
 *
 * Read out of the data model rather than listed here, because a parameterised Slot is
 * only a Slot when the character actually has the thing it names - `skill.perception`
 * is real and `skill.perceptoin` is an error - and a hand-kept copy of the list would
 * turn a misspelling in a Trait file into a passing check.
 */
const MODEL = fs.readFileSync(path.join(ROOT, "module", "data", "actor-character.mjs"), "utf8");
const keysOf = (from, to) => {
  const body = MODEL.slice(MODEL.indexOf(from) + from.length, MODEL.indexOf(to, MODEL.indexOf(from)));
  return [...body.matchAll(/^\s{4}(\w+):\s*\{/gm)].map(m => m[1]);
};
const SKILLS = keysOf("static SKILLS = Object.freeze({", "\n  });");
const ATTRIBUTES = ["agility", "force", "tenacity", "scholarship", "insight", "magic", "personality"];
const SAVES = ["impulsive", "corporeal", "cognitive", "morale"];
const zeroed = keys => Object.fromEntries(keys.map(k => [k, { mod: 0, score: 10, bonus: 0 }]));

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

/**
 * The Slots a character ends up with, run through all three phases the same way the
 * data model runs them - accumulating, so a phase never drops what an earlier one said.
 */
function slotsOf({ conditions = {}, states = {} }) {
  const errors = [];
  const actor = {
    name: "Probe",
    system: {
      conditions, states, items: [],
      baseTierOfPower: 3, tierOfPower: 3, powerLevel: 12
    },
    items: []
  };
  const programs = programsFor(actor, { report: m => errors.push(m) });
  const data = {
    effects: { slots: {}, active: [], errors, programs },
    ...actor.system,
    skills: zeroed(SKILLS),
    attributes: zeroed(ATTRIBUTES),
    savingThrows: zeroed(SAVES)
  };
  const scope = { data, errors, benefitsFrom: () => false };

  for (const phase of ["tier", "core", "late"]) {
    const { slots } = applyPassives(programs, phase, scope);
    Object.assign(data.effects.slots, slots);
  }
  return { slots: data.effects.slots, errors, programs };
}

// --- Sleeping ---------------------------------------------------------------
{
  const { slots, errors, programs } = slotsOf({ conditions: { sleeping: 1 } });
  check("the Condition is found by name",
    programs.some(p => p.sourceId === "condition:sleeping"), true);
  check("and nothing is reported against it", errors, []);
  check("a Sleeping character is hit automatically", slots["incoming.autoHit"], true);
  check("and may use no Maneuvers", slots.maneuvers, false);
  check("and is worse at noticing anything",
    [slots["skill.perception.bonus"]?.add, slots["skill.clairvoyance.bonus"]?.add], [-2, -2]);
}

// A Condition at zero stacks is not had at all.
check("no stacks, no flag",
  slotsOf({ conditions: { sleeping: 0 } }).slots["incoming.autoHit"], undefined);

// --- Determined -------------------------------------------------------------
{
  const { slots, errors } = slotsOf({ states: { determined: 1 } });
  check("nothing is reported against the State", errors, []);
  check("a Determined character hits automatically", slots["attack.autoHit"], true);
}

// Neither flag is set for a character with nothing on them, or every attack would
// land and nothing would ever be rolled.
{
  const { slots } = slotsOf({});
  check("an untouched character forces nothing",
    [slots["attack.autoHit"], slots["incoming.autoHit"]], [undefined, undefined]);
}

// --- What resolveAttack does with them --------------------------------------
// The same expression, in the same order, so the reason shown on the card cannot
// drift from the flag that decided the hit.
const forcedBy = (attacker, target) =>
  attacker["attack.autoHit"] === true ? "attacker"
  : target["incoming.autoHit"] === true ? "target"
  : null;

check("the attacker's flag is named", forcedBy({ "attack.autoHit": true }, {}), "attacker");
check("the defender's flag is named", forcedBy({}, { "incoming.autoHit": true }), "target");
check("and a plain exchange is left to the dice", forcedBy({}, {}), null);

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
