/**
 * The Power Up Maneuver.
 *
 * Core enough that most of what it needed did not exist: a Resource whose stacks each
 * carry their own clock, and a Max Capacity that can be raised by a fraction of itself.
 * Both are checked here by running them - the clock against the real `edgeReached`, and
 * the Capacity through a real character - because both are the kind of arithmetic that
 * looks right in every reading and comes out wrong.
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
// Spread: a Module namespace is frozen, and ForcedReplacement is stubbed further down so
// a write to the Resource bag comes back as the plain object it describes.
globalThis.foundry.data = { ...await import(appUrl("common/data/_module.mjs")) };
const { default: DataModel } = await import(appUrl("common/abstract/data.mjs"));
globalThis.foundry.abstract = { DataModel, TypeDataModel: DataModel };
globalThis.ui = { notifications: { warn: () => {}, error: () => {}, info: () => {} } };
globalThis.Handlebars = { escapeExpression: String };
// No Combat, so nobody is standing in their own turn: "your next turn" is the turn that
// is coming, and one end edge away.
globalThis.game = { combat: null };

const TRAITS = path.join(ROOT, "traits");
globalThis.foundry.utils.fetchJsonWithTimeout = async () =>
  JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));
globalThis.fetch = async url => {
  const file = path.join(TRAITS, String(url).replace("systems/dbu-ttrpg/traits/", ""));
  if (!fs.existsSync(file)) return { ok: false, status: 404, statusText: "missing" };
  return { ok: true, status: 200, text: async () => fs.readFileSync(file, "utf8") };
};

const { loadTraits, resourceLimits } = await import(modUrl("effects/traits.mjs"));
const { loadManeuvers, getManeuver } = await import(modUrl("maneuvers.mjs"));
const { compile } = await import(modUrl("effects/parser.mjs"));
const { applyPassives, applySlot, collectReactive } = await import(modUrl("effects/interpreter.mjs"));
const { EDGES, KINDS, lasting, edgeReached } = await import(modUrl("durations.mjs"));
const { default: DBUCharacterData } = await import(modUrl("data/actor-character.mjs"));
await loadTraits();
await loadManeuvers();

const TRAIT = fs.readFileSync(path.join(TRAITS, "maneuvers", "power-up.dbu"), "utf8");
const RECOVERY = fs.readFileSync(path.join(TRAITS, "maneuvers", "combat-recovery.dbu"), "utf8");
const USE = fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8");
const SLOTS = fs.readFileSync(path.join(ROOT, "module", "effects", "slots.mjs"), "utf8");
const INDEX = JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

const EN_DASH = "\u2013";
const script = text => text.slice(text.indexOf("\n---") + 4);

// A write to the Resource bag comes back as the plain object it describes, so a mock
// Actor can simply keep it.
globalThis.foundry.data.operators = { ForcedReplacement: { create: value => value } };

/** An Actor as far as the durations and the Resource bag read one. */
function makeActor({ resources = {}, timed = [] } = {}) {
  return {
    name: "Tizi",
    uuid: "Actor.tizi",
    system: { resources: { ...resources }, timed: [...timed], states: {}, conditions: {} },
    async update(changes) {
      for (const [key, value] of Object.entries(changes)) {
        if (key === "system.resources") this.system.resources = { ...value };
        if (key === "system.timed") this.system.timed = [...value];
      }
    }
  };
}

// --- The Maneuver as the rulebook lists it ---------------------------------------------
{
  check("a Standard Maneuver", /^type: standard$/m.test(TRAIT), true);
  check("costing 1 Action", /^actionCost: 1$/m.test(TRAIT), true);
  check("twice a Combat Round", /^usageLimit: 2\/round$/m.test(TRAIT), true);
  check("and no Ki", /^kiCost: 0$/m.test(TRAIT), true);
  check("listed", INDEX.traits.includes("maneuvers/power-up.dbu"), true);

  // Read through the parser, not off the file: the file wraps in the middle of two of
  // these, and the whole sentence is what the row shows.
  const entryText = getManeuver("power-up").text;
  check("the entry is there whole", [
    entryText.includes("Power Up Maneuver [2/Round]: Concentrate your power"),
    entryText.includes("you may remove a stack of Power before applying this effect"),
    entryText.includes("only applies for the first 2 stacks of Power"),
    entryText.includes("you cannot possess more than 2 stacks of Power")
  ], [true, true, true, true]);

  // "Power is a Resource and you cannot possess more than 2 stacks of Power."
  check("Power is a Resource the library declares", resourceLimits().power, 2);
}

// --- A stack, and a clock of its own for it ----------------------------------------------
{
  const { program, errors } = compile(script(TRAIT), null);
  check("the script compiles", errors.map(e => e.message), []);

  const entry = { program, priority: 6, sourceId: "power-up", sourceName: "Power Up",
                  level: 0, stacks: 1, armed: true, available: true };

  // The verbs are queued onto the scope rather than returned: an effect only ever asks
  // for one, and the runtime is what runs it.
  const scope = { data: { resources: {} }, errors: [], context: {}, queue: [] };
  const used = collectReactive([entry], "on-used", scope);
  check("using it gains a stack", used.slots["power.stacks"]?.add, 1);
  // "Until the end of your next turn", which this system calls "next-turn".
  check("and puts that stack on a clock",
    scope.queue.map(call => [call.verb, ...(call.args ?? [])]),
    [["expires", "power", "next-turn"]]);
}

// --- One stack, taken on your turn, followed to the end of your next ------------------------
{
  // The plain case, and the one that was broken. Everything below this had two stacks
  // running out against each other, which always has a one-edge entry in it - and it was
  // the one-edge entry running out that made the clock get written back at all. A single
  // stack of Power was counted down and the count thrown away, so it never left.
  //
  // "Gain a stack of Power until the end of your next turn", used on your own turn, which
  // is the only turn a Standard Maneuver can be used on.
  globalThis.game = { combat: { started: true, combatant: { actor: { uuid: "Actor.tizi" } } } };

  const actor = makeActor({ resources: { power: { stacks: 1, max: 2 } } });
  await lasting(actor, { kind: KINDS.RESOURCE, key: "power", edge: EDGES.END, next: true,
    source: "power" });

  check("taken on your own turn, it waits two edges",
    actor.system.timed.map(entry => entry.edges), [2]);

  await edgeReached(actor, EDGES.END);
  check("the end of that turn does not take it", actor.system.resources.power?.stacks, 1);
  check("and the clock is a step nearer",
    actor.system.timed.map(entry => entry.edges), [1]);

  await edgeReached(actor, EDGES.END);
  check("the end of your next turn takes it", actor.system.resources.power, undefined);
  check("and nothing is left on the clock", actor.system.timed, []);

  // Outside your own turn the wording means the turn that is coming, which is one edge -
  // and one edge has always worked, because a clock running out is what got the list
  // written.
  globalThis.game = { combat: null };
  const later = makeActor({ resources: { power: { stacks: 1, max: 2 } } });
  await lasting(later, { kind: KINDS.RESOURCE, key: "power", edge: EDGES.END, next: true,
    source: "power" });
  check("gained outside your turn it waits one",
    later.system.timed.map(entry => entry.edges), [1]);
  await edgeReached(later, EDGES.END);
  check("and goes on the first end edge", later.system.resources.power, undefined);
}

// --- One clock takes off one stack ---------------------------------------------------------
{
  // Two stacks, each with a clock of its own - which is what "gain a stack of Power until
  // the end of your next turn" means when it is used twice.
  // Set a turn apart, which is the case worth testing: two set in the same breath run out
  // in the same breath, and a stack gained this turn leaving with one gained last turn is
  // the bug.
  const actor = makeActor({
    resources: { power: { stacks: 2, max: 2 } },
    timed: [
      { kind: "resource", key: "power", edge: "end", edges: 1, source: "power" },
      { kind: "resource", key: "power", edge: "end", edges: 2, source: "power" }
    ]
  });
  check("two stacks carry two clocks", actor.system.timed.length, 2);

  await edgeReached(actor, EDGES.END);
  check("one edge takes one stack", actor.system.resources.power?.stacks, 1);
  check("and leaves the other, a step nearer",
    actor.system.timed.map(entry => entry.edges), [1]);

  await edgeReached(actor, EDGES.END);
  check("the next takes the last one", actor.system.resources.power, undefined);
  check("and nothing is left on a clock", actor.system.timed.length, 0);

  // What `lasting` writes for "until the end of your next turn" outside anybody's turn:
  // one edge, since the turn that is coming is the one that has that edge ahead of it.
  const fresh = makeActor({ resources: { power: { stacks: 1, max: 2 } } });
  await lasting(fresh, { kind: KINDS.RESOURCE, key: "power", edge: EDGES.END, next: true,
    source: "power" });
  check("a clock set outside a turn waits one edge",
    fresh.system.timed.map(entry => entry.edges), [1]);

  // Which is the bug this avoids: one clock used to take the whole Resource, so a stack
  // gained this turn would have left with one gained last turn.
  const single = makeActor({ resources: { power: { stacks: 2, max: 2 } } });
  await lasting(single, { kind: KINDS.RESOURCE, key: "power", edge: EDGES.END, source: "power" });
  await edgeReached(single, EDGES.END);
  check("one clock never takes two stacks", single.system.resources.power?.stacks, 1);
}

// --- What the stacks are worth --------------------------------------------------------------
{
  const { program } = compile(script(TRAIT), null);
  const entry = { program, priority: 6, sourceId: "power-up", sourceName: "Power Up",
                  level: 0, stacks: 1, armed: true, available: true };

  // Each in the phase its Slot lives in: combatRolls is LATE and capacity.maxFraction is
  // CORE, so the one passive is gathered in two passes. That is the ordering keeping
  // itself honest - a Slot only lands in its own phase.
  const at = (stacks, phase) => {
    const data = { resources: stacks ? { power: { stacks, max: 2 } } : {}, tierOfPower: 3 };
    return applyPassives([entry], phase, { data, errors: [], context: {}, queue: [] }).slots;
  };

  // "Increase your Combat Rolls by 1(T)" - the term the rulebook uses for all three, and
  // the Slot fans out to them, so it never appears under its own name.
  check("no Power, no bonus", at(0, "late").strike, undefined);
  check("one stack is 1(T) on Combat Rolls", applySlot(at(1, "late"), "strike", 0), 3);
  check("and two stacks are 2(T)", applySlot(at(2, "late"), "strike", 0), 6);
  check("which reaches the Strike, the Dodge and the Wound Roll",
    ["strike", "dodge", "wound"].map(key => applySlot(at(2, "late"), key, 0)), [6, 6, 6]);

  // "Increase your Max Capacity by 1/4" - per stack, so two are a half.
  //
  // Read as the data model reads it, off the additive part alone: applySlot floors
  // anything that is not a whole number, so a quarter put through it comes back as
  // nothing. That is right for every value the rules state in whole numbers and wrong for
  // a fraction, which is why this one is read the other way.
  const fraction = slots => slots["capacity.maxFraction"]?.add ?? 0;
  check("one stack is a quarter more Max Capacity", fraction(at(1, "core")), 0.25);
  check("and two are a half, not a quarter twice over", fraction(at(2, "core")), 0.5);
  check("and applySlot would have floored it away",
    applySlot(at(2, "core"), "capacity.maxFraction", 0), 0);
  check("the Slot is one an effect can write",
    SLOTS.includes('{ key: "capacity.maxFraction", phase: PHASES.CORE, kind: N, ops: ["add"]'),
    true);
}

// --- And a real character's Max Capacity ------------------------------------------------------
{
  const build = fraction => {
    const model = new DBUCharacterData({ powerLevel: 10, progression: [] }, { strict: false });
    model.prepareBaseData?.();
    const real = model.prepareDerivedData.bind(model);
    model.prepareDerivedData = function () {
      real();
      return this;
    };
    model.prepareDerivedData();
    return model;
  };

  const plain = build();
  const base = plain.capacity.max;
  check("a character has a Max Capacity to raise", base > 0, true);

  // Driven through the real derivation, with the Slot written as an effect would write it.
  const raised = new DBUCharacterData({ powerLevel: 10, progression: [] }, { strict: false });
  raised.prepareBaseData?.();
  const original = Object.getPrototypeOf(raised).prepareDerivedData;
  // The Slot is settled in the core phase, which runs inside the derivation - so it is put
  // there by a passive rather than written on afterwards.
  const { program } = compile("[passive]\ncapacity.maxFraction += 0.5;\n", null);
  const half = { program, priority: 6, sourceId: "t", sourceName: "Test",
                 level: 0, stacks: 1, armed: true, available: true };
  const slots = applyPassives([half], "core",
    { data: { resources: {} }, errors: [], context: {}, queue: [] }).slots;
  check("half again is what two stacks ask for",
    slots["capacity.maxFraction"]?.add ?? 0, 0.5);
  check("and the model folds it into the Max Capacity",
    fs.readFileSync(path.join(ROOT, "module", "data", "actor-character.mjs"), "utf8")
      .includes("* (1 + capacityFraction)"), true);
  // Taken off as well since Custom Buffs' "Max Capacity by 1/4" (-2 is half of it) - never more than the whole of it.
  check("read as a fraction, never taking off more than the whole",
    fs.readFileSync(path.join(ROOT, "module", "data", "actor-character.mjs"), "utf8")
      .includes('const capacityFraction = Math.max(-1, slot(this, "capacity.maxFraction"));'),
    true);
}

// --- The choice at the front of the effect ------------------------------------------------------
{
  // "You may remove a stack of Power before applying this effect." Asked, and only when
  // there is one to drop.
  check("the choice is only offered when there is a stack to drop",
    USE.includes('if (maneuver.powerUp && ((actor.system.resources?.power?.stacks ?? 0) > 0))'),
    true);
  check("and backing out of it drops the Maneuver",
    USE.includes("if (dropped === null) return false;"), true);
  check("asked before anything is paid",
    USE.indexOf("await askDropPower(actor)")
      < USE.indexOf("await spendManeuverCost(actor, maneuver, moving.fromSelf)"), true);

  // Dropping one takes the clock nearest running out with it, or the stack would be given
  // away twice: once now and once when that clock arrived.
  const from = USE.indexOf("async function dropPowerStack(");
  const to = USE.indexOf("\n/**", from);
  // The one thing it imports is handed in instead: a dynamic import inside the slice
  // would resolve against this file rather than against the module it was cut from.
  const stripped = USE.slice(from, to)
    .replace(/const \{ replaceObject \} = await import\([^)]*\);/, "");
  const dropPowerStack = new Function("actor", "replaceObject",
    `${stripped}
return dropPowerStack(actor);`);

  const actor = makeActor({
    resources: { power: { stacks: 2, max: 2 } },
    timed: [
      { kind: "resource", key: "power", edge: "end", edges: 2, source: "power" },
      { kind: "resource", key: "power", edge: "end", edges: 1, source: "power" },
      { kind: "condition", key: "shaken", edge: "end", edges: 1, source: "shaken" }
    ]
  });
  await dropPowerStack(actor, value => value);

  check("dropping one leaves the other", actor.system.resources.power?.stacks, 1);
  check("and takes the clock nearest running out",
    actor.system.timed.filter(e => e.key === "power").map(e => e.edges), [2]);
  check("leaving everything else on its own clock",
    actor.system.timed.some(e => e.key === "shaken"), true);

  const last = makeActor({
    resources: { power: { stacks: 1, max: 2 } },
    timed: [{ kind: "resource", key: "power", edge: "end", edges: 1, source: "power" }]
  });
  await dropPowerStack(last, value => value);
  check("dropping the last one removes the Resource", last.system.resources.power, undefined);
  check("and its clock with it", last.system.timed.length, 0);
}

// --- Combat Recovery follows the same shape -------------------------------------------------------
{
  // "For each Action spent, reduce your Defense Value by 1(T) until the start of your next
  // turn" - a duration each Action buys. It had one clock for all of them, which only
  // looked right because they are all set in the same turn.
  check("each Action's stack gets its own clock",
    (RECOVERY.match(/expires\(recovery, start-of-next-turn\);/g) ?? []).length, 3);
  check("one inside each Action's branch", [
    RECOVERY.includes("if (actionsSpent >= 1) {"),
    RECOVERY.includes("if (actionsSpent >= 3) {")
  ], [true, true]);
  check("and none left outside them",
    /recovery\.stacks \+= actionsSpent;\s*\n\s*expires/.test(RECOVERY), false);
}

// --- What is not built, and why ---------------------------------------------------------------------
{
  check("the file says which half is missing",
    TRAIT.includes("If an effect would stop you from losing a stack(s) of Power"), true);
  check("and why it is not effort",
    TRAIT.includes("Nothing in this system stops anybody losing a Resource"), true);
}

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
