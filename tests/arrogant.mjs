/**
 * The Arrogant Declaration Maneuver, and the four things it needed that did not exist.
 *
 * "Enter the Superior State until the end of your next turn. Then, upon leaving the
 * Superior State entered through this effect, reduce your Combat Rolls, Surgency, and
 * Soak Value by 1(bT) for the remainder of the Combat Encounter."
 *
 * A duration, a way into a State, a Moment for leaving one that something other than the
 * State itself can hear, and a Maneuver whose own script runs when it is used. None of
 * them were specific to this Maneuver, which is why they are built as rules rather than
 * as a branch with its name on it.
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

const { getMoment } = await import(modUrl("effects/moments.mjs"));
const { compile } = await import(modUrl("effects/parser.mjs"));

const TRAIT = fs.readFileSync(
  path.join(ROOT, "traits", "maneuvers", "arrogant-declaration.dbu"), "utf8");
const INDEX = JSON.parse(fs.readFileSync(path.join(ROOT, "traits", "index.json"), "utf8"));
const RUNTIME = fs.readFileSync(
  path.join(ROOT, "module", "effects", "moments-runtime.mjs"), "utf8");
const CONDITIONS = fs.readFileSync(path.join(ROOT, "module", "conditions.mjs"), "utf8");
const REGISTRY = fs.readFileSync(path.join(ROOT, "module", "effects", "registry.mjs"), "utf8");
const USE = fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8");

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

/** The script half of a trait file. */
const scriptOf = text => text.slice(text.indexOf("\n---") + 4);

// --- The Maneuver as the rulebook lists it ------------------------------------------
check("a Standard Maneuver", /^type: standard$/m.test(TRAIT), true);
check("costing one Action", /^actionCost: 1$/m.test(TRAIT), true);
check("and no Ki - the rulebook says N/A", /^kiCost: 0$/m.test(TRAIT), true);
check("once per Combat Encounter", /^usageLimit: 1\/encounter$/m.test(TRAIT), true);
check("giving every adjacent Opponent an opening",
  /^exploitable: All adjacent Opponents$/m.test(TRAIT), true);
check("and listed", INDEX.traits.includes("maneuvers/arrogant-declaration.dbu"), true);

// The Minion limit is not in the file, and says why it is not.
check("the Minion limit is left to the table",
  /limit across a group of characters/.test(TRAIT), true);

// --- It compiles, which is the thing that proves the language can say it -------------
{
  const { errors } = compile(scriptOf(TRAIT), null);
  check("the whole effect compiles", errors.map(e => e.message ?? String(e)), []);
}

// --- Entering the Superior State, on a clock ------------------------------------------
check("it enters Superior until the end of your next turn",
  /enterState\(superior, 1, next-turn\);/.test(TRAIT), true);

// Which is a duration the rule names, turned into edges where that rule lives.
check("`next-turn` is a duration the verb knows", /"next-turn":/.test(RUNTIME), true);

// --- A State you are standing in, entered again: a level higher (the user's ruling) ----------
{
  const body = /export async function enterState[\s\S]*?\n\}/.exec(RUNTIME)?.[0] ?? "";
  check("entering a State you are in raises it a level, for what this one would have lasted",
    body.includes("const added = await raiseState(actor, key, wanted);"), true);
  check("and nothing known, nothing set on a clock",
    body.indexOf("if (!added) return false;") < body.indexOf("lasting(actor,"), true);
  check("and the boast is marked as it is used, so only its own Superior owes the penalty",
    TRAIT.includes("[on used]\nenterState(superior, 1, next-turn);\narrogance.stacks += 1;"), true);
}

// --- Leaving a State is a Moment anything can hear -----------------------------------
// `on-removed` is the State's own Moment about itself and is scoped to it, so only
// Superior's own effects hear that one - and "upon leaving the Superior State" is
// written by things that are not Superior.
{
  check("leaving a State has a Moment", Boolean(getMoment("left-state/superior")), true);
  check("and it is parameterised by the State's name",
    getMoment("left-state/superior")?.key, "left-state");

  check("it is fired when a State is left",
    /await fireMoment\(actor, `left-state\/\$\{key\}`, context\);/.test(CONDITIONS), true);
  // Asked of each line rather than of the gap between them: the two sit together with a
  // paragraph of comment in between, and a pattern spanning that is measuring the
  // comment's length.
  check("on-removed is scoped to the thing being removed",
    CONDITIONS.includes('fireMoment(actor, "on-removed", context, { only: source'), true);
  check("and left-state is not, so anything can hear it",
    CONDITIONS.includes("fireMoment(actor, `left-state/${key}`, context);"), true);
  check("and only for States, not for Conditions",
    /if \(kind === "state"\) \{\n[^\n]*offerTriggers\(actor, `left-state\/[^\n]*\n\s*await fireMoment\(actor, `left-state/.test(CONDITIONS), true);

  check("the Maneuver answers leaving Superior - only its own, marked as it was used",
    TRAIT.includes("[automatic/left-state/superior]\nrequires stacksAtLeast(1, arrogance) && !stacksAtLeast(2, arrogance);"), true);
}

// --- A Maneuver's own script runs when it is used --------------------------------------
{
  check("a Maneuver's script is compiled at all",
    /\(item\.type !== "talent"\) && \(item\.type !== "maneuver"\)/.test(REGISTRY), true);

  check("`[on used]` is a Moment of its own", Boolean(getMoment("on-used")), true);
  check("and the parser knows the keyword",
    /\{ removed: "on-removed", used: "on-used" \}/.test(
      fs.readFileSync(path.join(ROOT, "module", "effects", "parser.mjs"), "utf8")), true);

  // Heard only by the Maneuver being used. `declare-maneuver` is the one everything
  // hears, and using this for that would fire every Maneuver's effect on every Maneuver.
  // Asked as two facts rather than as one pattern spanning both: what goes in that
  // context has grown once already, and a pattern counting the characters between the
  // call and its scope fails on the next thing that goes in.
  check("it is fired", USE.includes('await fireMoment(actor, "on-used", {'), true);
  check("scoped to the Maneuver", USE.includes("}, { only: maneuver.itemId, quiet: true });"), true);
  // Inside useManeuver's own body. A Modifier Maneuver's effects are fired from a helper
  // above it that fires the same Moment, so asking the whole file for the first `on-used`
  // finds that one instead - and the claim here is about the order of the two calls in
  // this function.
  const using = USE.slice(USE.indexOf("export async function useManeuver("));
  check("beside the one everything hears, not instead of it",
    using.indexOf('fireMoment(actor, "declare-maneuver"')
      < using.indexOf('fireMoment(actor, "on-used"'), true);
}

// --- What the boast costs afterwards -----------------------------------------------------
{
  // The Resource is the carrier, and the right one: a Resource is lost when the Combat
  // Encounter ends, which is exactly the span the rule names - so nothing has to
  // remember to take the penalty off.
  check("the penalty is carried by a Resource", /^resource: arrogance$/m.test(TRAIT), true);
  check("two stacks at most: the boast marked, then the penalty", /^resourceMax: 2$/m.test(TRAIT), true);
  check("gained on leaving Superior", /arrogance\.stacks \+= 1;/.test(TRAIT), true);

  // All three, in the rulebook's own (bT).
  for (const [what, line] of [
    ["Combat Rolls", "combatRolls -= 1(bT);"],
    ["Surgency", "surgency    -= 1(bT);"],
    ["the Soak Value", "soakValue   -= 1(bT);"]
  ]) {
    check(`it costs ${what}`, TRAIT.includes(line), true);
  }

  check("and only while the Resource is held",
    TRAIT.includes("if (stacksAtLeast(2, arrogance)) {"), true);

  // (bT), so a Transformation neither deepens the penalty nor escapes it.
  check("written in (bT) throughout",
    (TRAIT.match(/-= 1\(bT\);/g) ?? []).length, 3);
}

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
