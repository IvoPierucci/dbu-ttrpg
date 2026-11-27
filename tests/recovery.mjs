/**
 * Combat Recovery, and the two capabilities it needed.
 *
 * A Maneuver whose Action Cost is a range - "Variable (2~3 Actions)" - and one that
 * hands back dice: "for each Action spent, reduce your Defense Value by 1(T) until the
 * start of your next turn and regain 1d10(bT) Life and Ki Points."
 *
 * Neither was possible. An Action Cost was one number, and a dice amount was refused
 * anywhere a number was expected - which meant every recovery in the rulebook, and the
 * rulebook writes most of them as dice, had to be code rather than a file.
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
  return { ok: true, status: 200, text: async () => fs.readFileSync(file, "utf8") };
};

const { compile } = await import(modUrl("effects/parser.mjs"));
const { VERBS, checkVerb } = await import(modUrl("effects/verbs.mjs"));
const { getSlot, allowsOperation } = await import(modUrl("effects/slots.mjs"));

const TRAIT = fs.readFileSync(
  path.join(ROOT, "traits", "maneuvers", "combat-recovery.dbu"), "utf8");
const INDEX = JSON.parse(fs.readFileSync(path.join(ROOT, "traits", "index.json"), "utf8"));
const USE = fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8");
const AMOUNTS = fs.readFileSync(path.join(ROOT, "module", "effects", "amounts.mjs"), "utf8");
const RUNTIME = fs.readFileSync(
  path.join(ROOT, "module", "effects", "moments-runtime.mjs"), "utf8");

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

const scriptOf = text => text.slice(text.indexOf("\n---") + 4);

// --- The Maneuver as the rulebook lists it ------------------------------------------
check("a Standard Maneuver", /^type: standard$/m.test(TRAIT), true);
check("costing between 2 and 3 Actions",
  [/^actionCost: 2$/m.test(TRAIT), /^actionCostMax: 3$/m.test(TRAIT)], [true, true]);
check("no Ki", /^kiCost: 0$/m.test(TRAIT), true);
check("once a Combat Round", /^usageLimit: 1\/round$/m.test(TRAIT), true);
check("and an opening for every Opponent not at Long Range",
  /^exploitable: All Opponents that are not at Long Range$/m.test(TRAIT), true);
check("listed", INDEX.traits.includes("maneuvers/combat-recovery.dbu"), true);

check("the whole effect compiles", compile(scriptOf(TRAIT), null).errors.map(e => e.message), []);

// --- An Action Cost can be a range ----------------------------------------------------
{
  // Asked before anything is paid, while the whole thing can still be dropped - the same
  // place the Ki Point Cost is checked and for the same reason.
  check("the player is asked how many",
    /const actionsSpent = await askActionsSpent\(actor, maneuver\);/.test(USE), true);
  check("before anything is paid",
    USE.indexOf("const actionsSpent = await askActionsSpent")
      < USE.indexOf("await payActions(actor, maneuver, actionsSpent)"), true);
  check("and dropping the question drops the Maneuver",
    /if \(actionsSpent === null\) return false;/.test(USE), true);

  // What is paid is what was chosen.
  check("what is paid is what was chosen",
    /await payActions\(actor, maneuver, actionsSpent\);/.test(USE), true);

  // A Maneuver that costs what it costs is not asked at all.
  check("a fixed cost asks nothing",
    /if \(most <= least\) return least;/.test(USE), true);

  // Nor is one where only one count is affordable: offering a choice that ends in a
  // refusal two steps later is not offering a choice.
  check("nor is one where only one count is affordable",
    /if \(options\.length === 1\) return Number\(options\[0\]\.action\);/.test(USE), true);
  check("and what they can afford is what is offered",
    USE.includes("? actionsWithin(actor, kind)"), true);
}

// --- And the answer reaches the Maneuver's own script ------------------------------------
{
  check("`actionsSpent` is readable",
    /if \(p === "actionsSpent"\) return scope\.context\?\.actionsSpent \?\? 1;/.test(AMOUNTS), true);
  check("carried on the Moment the Maneuver hears",
    /actionsSpent,\s*\n\s*targets: targetActor/.test(USE), true);
  check("and the Maneuver reads it", /recovery\.stacks \+= actionsSpent;/.test(TRAIT), true);

  // One everywhere else, so a Maneuver that never asked reads a sensible number rather
  // than nothing.
  check("and it is one where nothing asked", /\?\? 1;/.test(
    /if \(p === "actionsSpent"\)[^\n]*/.exec(AMOUNTS)?.[0] ?? ""), true);
}

// --- Dice where a number is expected are rolled --------------------------------------------
{
  // Refused in three places, which is why it had never worked: the operation check, the
  // amount check, and the resolver.
  check("adding dice to a number Slot is allowed",
    allowsOperation(getSlot("life.value"), "add-dice"), true);
  check("but not to a flag",
    allowsOperation(getSlot("attack.autoHit"), "add-dice"), false);
  check("and the resolver rolls them rather than refusing",
    /const roll = new Roll\(formula\);\s*\n[\s\S]{0,300}?roll\.evaluateSync\(\);\s*\n\s*return roll\.total;/
      .test(AMOUNTS), true);

  // Synchronous on purpose: an amount is resolved in the middle of folding effects into
  // derived data, and there is nowhere in that to await.
  check("rolled synchronously, there being nowhere to await",
    /evaluateSync/.test(AMOUNTS), true);

  check("so the line the rulebook writes compiles",
    compile("[automatic/on-used]\nlife.value += 1d10(bT);\n", null).errors.map(e => e.message), []);
}

// --- One roll an Action, not one roll multiplied --------------------------------------------
// "For each Action spent ... regain 1d10(bT)". Three rolls of 1d10(bT) and one tripled
// have the same average and nothing else in common.
{
  check("the dice are rolled per Action",
    (TRAIT.match(/life\.value \+= 1d10\(bT\)( \* \(hasCondition\(\"recovery-doubled\"\) \? 2 : 1\))?;/g) ?? []).length, 3);
  check("Ki the same way",
    (TRAIT.match(/ki\.value \+= (floor\()?1d10\(bT\)( \* \(hasCondition\(\"recovery-doubled\"\) \? 2 : 1\))?( \/ \(kiRegainHalved \? 2 : 1\)\))?;/g) ?? []).length, 3);
  check("each behind its own Action",
    ["if (actionsSpent >= 1)", "if (actionsSpent >= 2)", "if (actionsSpent >= 3)"]
      .filter(line => !TRAIT.includes(line)), []);
  check("and nothing multiplies a single roll",
    /actionsSpent \* 1d10/.test(TRAIT), false);
}

// --- The Defense Value, for as long as it lasts ------------------------------------------------
{
  // Per Action rather than per use, so the count is what is held.
  check("the penalty counts the Actions",
    /defenseValue -= \(recovery\.stacks \* tierOfPower\);/.test(TRAIT), true);
  check("held as a Resource, one stack an Action",
    [/^resource: recovery$/m.test(TRAIT), /^resourceMax: 3$/m.test(TRAIT)], [true, true]);

  // "Until the start of your next turn", which is a clock the file sets itself.
  check("and put on a clock", /expires\(recovery, start-of-next-turn\);/.test(TRAIT), true);
  check("`expires` is something an effect can do", Boolean(VERBS.expires), true);
  check("taking a name and a duration", checkVerb("expires", 2), null);
  check("and nothing else", checkVerb("expires", 1) !== null, true);

  // The kind is worked out from what the character holds rather than named: an effect
  // saying "this lasts until the start of your next turn" is not also saying what sort of
  // thing it is - the file already said that when it granted it.
  check("what sort of thing it is comes from what they hold",
    /const kind = actor\.system\.states\?\.\[key\] \? KINDS\.STATE/.test(RUNTIME), true);
  check("and holding nothing by that name says so rather than failing quietly",
    /is not holding "\$\{name\}", so nothing was put on a clock/.test(RUNTIME), true);
}

// --- What is deliberately not here -------------------------------------------------------------
// Half of one of these would be worse than none, and the file says which and why.
{
  for (const [what, why] of [
    ["Condition Recovery", "offer the player a choice"],
    // The carrier it was waiting on exists now; what is left is this end of it.
    ["the Exploit reprisal", "noticing, once the Damage lands"],
    ["Spectate", "which does not exist"]
  ]) {
    check(`the file says ${what} is not built`, TRAIT.includes(why), true);
  }

  // But the published text is all there, so nothing is lost while it waits.
  check("and the published text carries all three",
    ["Condition Recovery:", "Spectate:", "Exploit Maneuver"]
      .filter(phrase => !TRAIT.includes(phrase)), []);
}

// --- And it reaches the character -------------------------------------------------------------
// The Slot was written, and nothing carried it: `system.resources` is read in four places,
// cleared in two, and was filled by nobody. So the Defense Value penalty and the clock
// beside it had never once applied - the file said the right thing and the character never
// heard it.
{
  const { loadTraits, resourceLimits } = await import(modUrl("effects/traits.mjs"));
  await loadTraits();

  const { applySlot } = await import(modUrl("effects/interpreter.mjs"));

  // The resource half of writeStateful, cut out and run: it is private, and this is the
  // half that decides whether anything reaches the character at all.
  const RUNTIME = fs.readFileSync(
    path.join(ROOT, "module", "effects", "moments-runtime.mjs"), "utf8");
  const cut = RUNTIME.slice(
    RUNTIME.indexOf("const RESOURCE_STACKS ="),
    RUNTIME.indexOf("/** Put what the Moment changed onto the character. */"));
  const resourceUpdates = new Function("applySlot", "resourceLimits",
    `${cut}\nreturn resourceUpdates;`)(applySlot, resourceLimits);

  const slot = add => ({ add, multiply: 1, set: null, min: null, max: null, clamp: null });
  const holding = held => ({ system: { resources: held } });

  check("the Maneuver's Resource is one the library declares",
    resourceLimits().recovery, 3);

  check("spending two Actions puts two stacks on the character",
    resourceUpdates(holding({}), { "recovery.stacks": slot(2) }),
    { recovery: { stacks: 2, max: 3 } });

  // "You can spend between 2 and 3 Actions", so three is the ceiling and the file says so.
  check("and the declared maximum is the ceiling",
    resourceUpdates(holding({}), { "recovery.stacks": slot(9) }).recovery.stacks, 3);

  check("a second use adds to what is held",
    resourceUpdates(holding({ recovery: { stacks: 1, max: 3 } }), { "recovery.stacks": slot(1) })
      .recovery.stacks, 2);

  // Taken off rather than left at zero: `hasResource` asks whether it is there at all,
  // and a duration removes one by deleting its key.
  check("and one that reaches nothing is removed",
    resourceUpdates(holding({ recovery: { stacks: 2, max: 3 } }), { "recovery.stacks": slot(-5) }),
    {});

  // A Resource nobody declared is unbounded, not bounded at zero.
  check("a Resource with no declared maximum has no ceiling",
    resourceUpdates(holding({}), { "momentum.stacks": slot(40) }).momentum.stacks, 40);

  check("and a Moment that touched no Resource writes none",
    resourceUpdates(holding({}), { "life.value": slot(5) }), null);

  // Written whole with a ForcedReplacement, which is the only way a removal sticks on an
  // ObjectField.
  check("the bag is replaced rather than merged",
    RUNTIME.includes('updates["system.resources"] = replaceObject(resources);'), true);
}

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
