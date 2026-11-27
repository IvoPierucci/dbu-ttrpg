/**
 * What a script actually comes to, not merely whether it compiles.
 *
 * The other harnesses check that the language accepts a file. This one runs it and
 * looks at the Slot values that come out - which is the layer where `slot = true`
 * turned out to be resolving to false.
 */

import path from "node:path";
import { pathToFileURL } from "node:url";

const APP = (process.env.FOUNDRY_APP || String.raw`C:\Program Files\Foundry Virtual Tabletop\resources\app`);
const appUrl = p => pathToFileURL(path.join(APP, p)).href;

globalThis.foundry = {};
await import(appUrl("common/primitives/_module.mjs"));
globalThis.foundry.utils = await import(appUrl("common/utils/_module.mjs"));

const ROOT = process.argv[2];
const M = pathToFileURL(path.join(ROOT, "module", "effects")).href;
const { compile } = await import(`${M}/parser.mjs`);
const { applyPassives, collectReactive } = await import(`${M}/interpreter.mjs`);

const DATA = {
  attributes: Object.fromEntries(
    ["agility", "force", "tenacity", "scholarship", "insight", "magic", "personality"]
      .map(k => [k, { score: 10, mod: 2 }])),
  skills: Object.fromEntries(["stealth", "perception"].map(k => [k, { bonus: 0 }])),
  savingThrows: Object.fromEntries(["impulsive", "morale"].map(k => [k, { value: 0 }])),
  conditions: {}, states: {}, resources: {},
  dice: { greater: { formula: "2d8" }, extra: { formula: "1d6" }, critical: { formula: "1d8" } },
  tierOfPower: 3, baseTierOfPower: 3,
  soakValue: 10, life: { max: 100, value: 100 }
};

/** The Slot as the arithmetic sees it: everything but the record of who contributed. */
function withoutParts(slot) {
  if (!slot || (typeof slot !== "object") || Array.isArray(slot)) return slot;
  const { parts, ...rest } = slot;
  return rest;
}

/** A numeric Slot with nothing but an add on it. */
const added = n => ({ add: n, multiply: 1, set: null, min: null, max: null, clamp: null });

let failed = 0;

/**
 * @param {string} label
 * @param {string} source
 * @param {string} slot      which Slot to look at
 * @param {any} expected     what it should come to
 * @param {object} [options] a moment to fire instead of folding it as a passive
 */
function check(label, source, slot, expected,
               { moment = null, stacks = 1, level = 0, phase = "core" } = {}) {
  const { program, errors } = compile(source, DATA);
  if (errors.length) {
    failed++;
    console.log(`FAIL  ${label}: did not compile - ${errors[0].message}`);
    return;
  }

  const entry = {
    program, priority: 6, sourceId: "test", sourceName: "Test",
    level, stacks, armed: true, available: true
  };
  const scope = { data: DATA, errors: [], context: {}, queue: [] };

  const result = moment
    ? collectReactive([entry], moment, scope)
    : applyPassives([entry], phase, scope);

  // Without the contributions. Those are a description of how the Slot got where it is,
  // not part of where it got - and every case here is a hand-written Slot object that
  // would have to restate them. They get a section of their own at the end.
  const actual = withoutParts(result.slots[slot]);
  const matched = JSON.stringify(actual) === JSON.stringify(expected);
  if (!matched) failed++;

  console.log(`${matched ? "ok  " : "FAIL"}  ${label}`);
  if (!matched) {
    console.log(`        ${slot} expected ${JSON.stringify(expected)}`);
    console.log(`        ${slot} got      ${JSON.stringify(actual)}`);
  }
  for (const e of scope.errors) console.log(`        ! ${e}`);
}

/** Compares outright, for the one section that is about the contributions themselves. */
function check2(label, actual, expected) {
  const matched = JSON.stringify(actual) === JSON.stringify(expected);
  if (!matched) failed++;
  console.log(`${matched ? "ok  " : "FAIL"}  ${label}`);
  if (!matched) {
    console.log(`        expected ${JSON.stringify(expected)}`);
    console.log(`        got      ${JSON.stringify(actual)}`);
  }
}

// --- Flags -------------------------------------------------------------------
check("a flag set to true", "[passive]\nskipTurn = true;", "skipTurn", true);
check("a flag set to false", "[passive]\nskipTurn = false;", "skipTurn", false);
check("a reactive flag set to true",
  "[triggered/clash-resolved]\nclash.succeed = true;", "clash.succeed", true,
  { moment: "clash-resolved" });
check("forbidding a permission", "[passive]\nforbid maneuvers;", "maneuvers", false);

// --- Numbers -----------------------------------------------------------------
check("a flat add", "[passive]\nsoakValue += 4;", "soakValue", added(4));
check("per Tier", "[passive]\nsoakValue += 2(T);", "soakValue", added(6));
check("per Base Tier", "[passive]\nsoakValue += 2(bT);", "soakValue", added(6));
check("a level scaled per Tier", "[passive from 1]\nsoakValue += L(T);", "soakValue",
  added(6), { level: 2 });
check("repeated per stack", "[passive per stack]\nsoakValue += 1;", "soakValue",
  added(3), { stacks: 3 });
check("reading the stack count", "[passive]\nsoakValue += stacks;", "soakValue",
  added(3), { stacks: 3 });

// --- Dice --------------------------------------------------------------------
// Not fanned out: every Combat Roll reads this Slot straight off the prepared
// character, rather than it being split across strike, dodge and wound.
// A die keeps the name of whatever granted it, so the roll can say which rule put it
// in your hand rather than calling every one of them "extra".
check("named dice", "[passive]\ncombatRolls.dice += greaterDice;",
  "combatRolls.dice", [{ formula: "2d8", source: "Test" }], { phase: "late" });
check("combatRolls fans out to the three", "[passive]\ncombatRolls += 2;",
  "dodge", added(2), { phase: "late" });


// --- Who contributed, not just what it came to -------------------------------
// A Slot keeps the list so a finished number can be taken apart again: the sheet shows
// a Soak Value of 14 and can say which effect is responsible for which part of it.
{
  const contributions = (source, slot) => {
    const { program, errors } = compile(source, DATA);
    if (errors.length) return `did not compile: ${errors[0].message}`;

    const entry = {
      program, priority: 6, sourceId: "test", sourceName: "Test Talent",
      level: 0, stacks: 1, armed: true, available: true
    };
    const scope = { data: DATA, errors: [], context: {}, queue: [] };
    return applyPassives([entry], "core", scope).slots[slot]?.parts;
  };

  const one = contributions("[passive]\nsoakValue += 3;", "soakValue");
  check2("an add is recorded with its source", one, [{ op: "add", value: 3, written: "3", source: "Test Talent", sourceId: "test" }]);

  const two = contributions("[passive]\nsoakValue += 3;\nsoakValue *= 0.5;", "soakValue");
  check2("and so is a multiply, in the order they were gathered", two, [
    { op: "add", value: 3, written: "3", source: "Test Talent", sourceId: "test" },
    { op: "multiply", value: 0.5, written: "0.5", source: "Test Talent", sourceId: "test" }
  ]);

  // A contradiction that lost on Priority is still something somebody did, and saying so
  // is more use than dropping it - the resolved value already says which one won.
  const three = contributions("[passive]\nsoakValue min= 4;\nsoakValue min= 9;", "soakValue");
  check2("a contradiction is kept even where it lost", three?.length, 2);

  // Nothing contributed, nothing to say.
  check2("a Slot nobody touched has no list",
    contributions("[passive]\nmight += 1;", "soakValue"), undefined);
}


// --- A word in a verb's arguments is a word ----------------------------------
// It was a path: read off the character, found nothing, and resolved to 0. So
// `expires(recovery, start-of-next-turn)` reached the runtime as `expires(0, 0)`, which
// refuses on its first line and says nothing - no duration written in a file had ever
// been set. It compiled perfectly the whole time, which is why nothing here caught it.
{
  const queued = source => {
    const { program, errors } = compile(source, DATA);
    if (errors.length) return `did not compile: ${errors[0].message}`;

    const scope = { data: DATA, errors: [], context: {}, queue: [] };
    collectReactive([{
      program, priority: 6, sourceId: "test", sourceName: "Test",
      level: 0, stacks: 1, armed: true, available: true
    }], "on-used", scope);
    return scope.queue;
  };

  check2("a duration reaches the runtime as words",
    queued("[on used]\nexpires(recovery, start-of-next-turn);"),
    [{ verb: "expires", args: ["recovery", "start-of-next-turn"] }]);

  check2("and so does a State's name",
    queued("[on used]\nleaveState(superior);"),
    [{ verb: "leaveState", args: ["superior"] }]);

  // The name and the duration are words; the level between them is a number, which is
  // why the positions are declared rather than guessed at.
  check2("a name, a number and a duration are told apart",
    queued("[on used]\nenterState(superior, 2, next-turn);"),
    [{ verb: "enterState", args: ["superior", 2, "next-turn"] }]);

  // An argument that is meant as an amount still is one.
  check2("an amount in a name position is still read",
    queued("[on used]\ngain(prone, tierOfPower);"),
    [{ verb: "gain", args: ["prone", 3] }]);

  // Quoting still works, since that is what the files could have said all along.
  check2("a quoted name is unchanged",
    queued('[on used]\nexpires("recovery", "start-of-next-turn");'),
    [{ verb: "expires", args: ["recovery", "start-of-next-turn"] }]);
}

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
