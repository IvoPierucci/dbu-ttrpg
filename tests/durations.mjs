/**
 * Durations, made real.
 *
 * The rule was settled before any of it was built: "your turn" and "your next turn" both
 * mean the next turn of yours that still has that edge ahead of it. Everything here is
 * that sentence turned into a count, and the counting is done when the clock is set
 * rather than when it is read - because the one question the wording cannot answer for
 * itself is "is it my turn right now", and that has an answer then and only then.
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
// The clock entries go through the character's own schema now, which is built of
// DataFields - and a SchemaField throwing away what it does not know is the whole point.
globalThis.foundry.data = { ...await import(appUrl("common/data/_module.mjs")) };
globalThis.foundry.data.operators = { ForcedReplacement: { create: value => value } };
const { default: DataModel } = await import(appUrl("common/abstract/data.mjs"));
globalThis.foundry.abstract = { DataModel, TypeDataModel: DataModel };

const { EDGES, KINDS, edgesToWait, edgeReached } = await import(modUrl("durations.mjs"));
const { default: DBUCharacterData } = await import(modUrl("data/actor-character.mjs"));
const { VERBS, checkVerb } = await import(modUrl("effects/verbs.mjs"));

const DURATIONS = fs.readFileSync(path.join(ROOT, "module", "durations.mjs"), "utf8");
const COMBAT = fs.readFileSync(path.join(ROOT, "module", "combat.mjs"), "utf8");
const RUNTIME = fs.readFileSync(
  path.join(ROOT, "module", "effects", "moments-runtime.mjs"), "utf8");

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

// --- The rule, as a count -------------------------------------------------------
// The start of your turn is never ahead of you while you stand in it, so the two
// start-of durations are one duration written two ways. Always.
{
  const start = (next, theirTurn) => edgesToWait(EDGES.START, { next, theirTurn });

  check("until the start of your turn, outside your turn", start(false, false), 1);
  check("until the start of your next turn, outside your turn", start(true, false), 1);
  check("until the start of your turn, during your turn", start(false, true), 1);
  check("until the start of your next turn, during your turn", start(true, true), 1);
  check("so the two are one duration, in every case",
    [start(false, false), start(true, false), start(false, true), start(true, true)],
    [1, 1, 1, 1]);
}

// The end of your turn is ahead of you while you stand in it, so there the two part -
// and only there.
{
  const end = (next, theirTurn) => edgesToWait(EDGES.END, { next, theirTurn });

  check("until the end of your turn, outside your turn", end(false, false), 1);
  check("until the end of your next turn, outside your turn", end(true, false), 1);
  check("outside your turn the two are the same", end(false, false), end(true, false));

  check("until the end of your turn, during your turn", end(false, true), 1);
  check("until the end of your next turn, during your turn", end(true, true), 2);
  check("which is where they part, by a whole Combat Round",
    end(true, true) - end(false, true), 1);
}

// The Encounter waits on no edge at all.
check("the Encounter counts no edges", edgesToWait(EDGES.ENCOUNTER, { next: true }), 0);

// --- Counted when it is set, not when it is read ----------------------------------
// The wording alone cannot say how long it is: the answer depends on whether you were
// standing in your own turn, which is only true at the moment it is applied.
check("whether it is their turn is asked as the clock is set",
  /edges: edgesToWait\(edge, \{ next, theirTurn: isTheirTurnNow\(actor\) \}\)/.test(DURATIONS),
  true);
check("and the count is what is stored",
  /edges: new fields\.NumberField/.test(
    fs.readFileSync(path.join(ROOT, "module", "data", "actor-character.mjs"), "utf8")), true);

// --- Counting down, with the real function ------------------------------------------
{
  // This section used to mirror `edgeReached` as a local `step` and test the mirror. The
  // mirror was right, which is exactly the problem with a mirror: the original returned
  // before writing the list whenever nothing had run out that edge, so the step it had
  // just taken was thrown away and a clock of two edges never became one. "Until the end
  // of your next turn" lasted for ever.
  const makeActor = (timed) => ({
    name: "Tizi",
    uuid: "Actor.tizi",
    isOwner: true,
    system: { timed: [...timed], states: {}, conditions: {}, resources: {} },
    async update(changes) {
      for (const [key, value] of Object.entries(changes)) {
        if (key === "system.timed") this.system.timed = [...value];
        if (key === "system.states") this.system.states = { ...value };
        if (key === "system.conditions") this.system.conditions = { ...value };
        if (key === "system.resources") this.system.resources = { ...value };
      }
    }
  });

  const twoTurns = [{ kind: KINDS.STATE, key: "superior", edge: EDGES.END, edges: 2,
                      source: "superior" }];

  // The case nothing had ever run: one clock, two edges, and nothing beside it to run out
  // and force the write.
  const alone = makeActor(twoTurns);
  alone.system.states.superior = 1;

  const first = await edgeReached(alone, EDGES.END);
  check("an end edge takes one off", alone.system.timed.map(e => e.edges), [1]);
  check("and nothing has run out yet", first, []);
  // What a clock takes off when it runs out has a section of its own further down, and
  // it needs the Trait library loaded to look a State up. Here the question is only
  // whether the counting happens, so it is asked of the clock.
  check("so nothing has been taken off yet", alone.system.states.superior, 1);

  const second = await edgeReached(alone, EDGES.END);
  check("the second end edge runs it out", second, ["superior"]);
  check("and nothing is left on the clock", alone.system.timed, []);
  check("and it was named as it went", second, ["superior"]);

  // The other edge does not touch it, which is the whole point of recording which one.
  const other = makeActor(twoTurns);
  other.system.states.superior = 1;
  check("a start edge runs nothing out", await edgeReached(other, EDGES.START), []);
  check("and leaves an end clock alone", other.system.timed.map(e => e.edges), [2]);
  check("and nothing was taken off", other.system.states.superior, 1);

  // A character with nothing on a clock is left exactly as they were.
  const empty = makeActor([]);
  check("an edge with no clocks waiting on it does nothing",
    await edgeReached(empty, EDGES.END), []);
}

// --- Two clocks on one thing are two clocks ----------------------------------------
// One effect's Superior running out must not take away another's.
check("the clock is a list, not a thing keyed by what it holds",
  /schema\.timed = new fields\.ArrayField/.test(
    fs.readFileSync(path.join(ROOT, "module", "data", "actor-character.mjs"), "utf8")), true);
check("and the list is what says so",
  /Two clocks on the same thing are two entries/.test(DURATIONS), true);

// --- Where the edges are -----------------------------------------------------------
{
  const begin = /async function beginTurn[\s\S]*?\n\}/.exec(COMBAT)?.[0] ?? "";

  // "Until the start of your turn" means up to it and not through it, so it is gone
  // before anything answers the start of the turn.
  check("a start clock runs out before the Moment fires",
    begin.indexOf("edgeReached(actor, EDGES.START)")
      < begin.indexOf('fireMoment(actor, "start-of-turn")'), true);

  // "Until the end of your turn" lasts for the whole of your turn, and the end of your
  // turn is part of it - so it goes once the answering is done.
  check("and an end clock runs out after it",
    COMBAT.indexOf('fireMoment(leaving, "end-of-turn")')
      < COMBAT.indexOf("edgeReached(leaving, EDGES.END)"), true);

  // Both edges arrive on a skipped turn, which is what a skipped turn still being your
  // turn is for - and this is where that stops being only a comment.
  check("a skipped turn still reaches its start edge",
    begin.indexOf("edgeReached(actor, EDGES.START)") < begin.indexOf("const skipped"), true);

  // The Encounter ending stops every clock, not only the ones counting it: a turn edge
  // that never arrives is a duration that never ends, and there are no more turns.
  check("the Encounter ending stops every clock",
    /await encounterEnded\(actor\);/.test(COMBAT), true);
  check("all of them, not only the ones counting it",
    /await actor\.update\(\{ "system\.timed": \[\] \}\);/.test(DURATIONS), true);
}

// --- What runs out is said out loud -------------------------------------------------
// A thing that quietly comes off is a thing nobody notices has gone, and the whole point
// of a duration is that everybody knows when it ended.
check("what ran out at the start of a turn is on the card",
  /Ran out: \$\{ran\.join\(", "\)\}/.test(COMBAT), true);
check("and what ran out at the end of one gets a line",
  /title: `\$\{actor\.name\}: \$\{ran\.join\(", "\)\} ran out`/.test(COMBAT), true);

// --- Entering a State ----------------------------------------------------------------
// leaveState had no counterpart: nothing in the language could put a State on anybody,
// so every State in the system arrived by somebody ticking a box on a sheet.
check("entering a State is something an effect can do", Boolean(VERBS.enterState), true);
check("it needs a name", checkVerb("enterState", 0) !== null, true);
check("and takes a level and a duration after it", checkVerb("enterState", 3), null);
check("but no more than that", checkVerb("enterState", 4) !== null, true);

check("the durations it accepts are the rulebook's wordings",
  ["turn", "next-turn", "start-of-turn", "start-of-next-turn", "encounter"]
    .filter(word => !RUNTIME.includes(`"${word}":`)), []);
check("and an unknown one leaves the State on rather than guessing",
  /is not a duration this system knows[\s\S]{0,60}return true;/.test(RUNTIME), true);

// The clock is set through the one place the rule lives, not counted again here.
check("it asks the duration rules rather than counting for itself",
  /return lasting\(actor, \{ kind: KINDS\.STATE, key, \.\.\.clock, levels: added, source: source \|\| key \}\)/
    .test(RUNTIME), true);
check("and with no duration the State simply stays",
  /if \(!duration\) return true;/.test(RUNTIME), true);

// --- Every kind of thing a clock can hold is one something can take off ---------------
{
  const takeOff = /async function takeOff[\s\S]*?\n\}/.exec(DURATIONS)?.[0] ?? "";
  for (const kind of Object.values(KINDS)) {
    check(`a ${kind} on a clock can be taken off`,
      takeOff.includes(`KINDS.${kind.toUpperCase()}`), true);
  }
  check("and an unknown kind says so rather than failing quietly",
    /Nothing knows how to take off/.test(takeOff), true);
}

// --- What is written has to be declared, or the schema eats it ---------------------------
{
  // A SchemaField deletes what it does not know on the way in. `on` was written by
  // `lasting` and declared by nobody, so every entry came back without it and the clock
  // took the Condition off whoever was counting instead of whoever had it - Analyzed stayed
  // on the target for the rest of the Encounter, and Thrust's Guard Down did too.
  //
  // Run through the real field rather than asserted against a list, and the list of keys is
  // read out of `lasting` itself: a sixth key added there with no field to land in fails
  // here rather than at a table.
  const { fields } = globalThis.foundry.data;
  const schema = DBUCharacterData.defineSchema().timed;

  const body = DURATIONS.slice(
    DURATIONS.indexOf("export async function lasting("),
    DURATIONS.indexOf("await actor.update({ \"system.timed\""));

  // Three forms of a key going onto the entry: `key,`, `edges: ...`, and the two that are
  // spread in only when they have something to say.
  const written = [...new Set([
    ...[...body.matchAll(/^ {4}(\w+)[,:]/gm)].map(m => m[1]),
    ...[...body.matchAll(/\{ (\w+) \} : \{\}\)/g)].map(m => m[1])
  ])].sort();

  check("lasting writes these", written,
    ["edge", "edges", "key", "kind", "on", "source", "until"]);

  const full = Object.fromEntries(written.map(name =>
    [name, (name === "edges") ? 2 : `${name}-value`]));
  const survived = Object.keys(schema.clean([full])[0]).sort();

  check("and every one of them survives being written", survived, written);

  // The two that were the bug, said on their own so the reason is on the record.
  const entry = schema.clean([{
    kind: "condition", key: "analyzed", edge: "end", edges: 2, source: "Analysis",
    on: "Actor.target", until: "being-hit"
  }])[0];
  check("a clock kept over somebody else still knows who", entry.on, "Actor.target");
  check("and one with a second way out still knows what", entry.until, "being-hit");

  // Which is what takeOff reads to decide whose Condition it is.
  const takeOffBody = DURATIONS.slice(DURATIONS.indexOf("async function takeOff("));
  check("takeOff takes it off whoever it was about",
    takeOffBody.includes("const actor = entry.on ? fromUuidSync(entry.on) : owner;"), true);
}

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
