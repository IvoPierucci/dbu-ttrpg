/**
 * Damage Over Time.
 *
 * "Some effects apply a stack of DOT to a Character over a period of time decided by the
 * effect. For each stack of DOT you possess, reduce your Life Points by 1(bT) at the
 * start of your turn."
 *
 * Not a Combat Condition - it is not one of the named ones and nothing about it is a
 * Condition - but it stacks the same way, which is the sort of near-miss that gets built
 * as one anyway and then inherits rules it was never given: immunity, the Condition
 * limits, everything a Condition carries.
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

const { getSlot } = await import(modUrl("effects/slots.mjs"));
const { allConditions } = await import(modUrl("conditions.mjs"));

const MODEL = fs.readFileSync(path.join(ROOT, "module", "data", "actor-character.mjs"), "utf8");
const COMBAT = fs.readFileSync(path.join(ROOT, "module", "combat.mjs"), "utf8");
const SHEET = fs.readFileSync(path.join(ROOT, "templates", "parts", "actor-combat.hbs"), "utf8");
const GUIDE = fs.readFileSync(path.join(ROOT, "WRITING-EFFECTS.txt"), "utf8");

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

// --- What a stack costs -----------------------------------------------------------
// 1(bT) each, so a Transformation does not make what is already burning you burn faster.
{
  const burn = (stacks, baseTier) => stacks * (1 * baseTier);

  check("one stack at Base Tier 1 is 1", burn(1, 1), 1);
  check("three stacks at Base Tier 1 are 3", burn(3, 1), 3);
  check("three at Base Tier 4 are 12", burn(3, 4), 12);
  check("and none is none", burn(0, 4), 0);

  check("the rate is 1(bT)", /static DOT_PER_STACK_PER_BASE_TIER = 1;/.test(MODEL), true);
  check("read off the Base Tier, not the current one",
    /this\.perBaseTier\(DBUCharacterData\.DOT_PER_STACK_PER_BASE_TIER\)/.test(MODEL), true);
}

// --- It stacks, and nothing caps it ------------------------------------------------
// "Over a period of time decided by the effect" - so how long a stack lasts is the
// business of whatever applied it, and the rule states no ceiling on how many.
{
  check("the count is stored",
    /schema\.dotStacks = new fields\.NumberField/.test(MODEL), true);
  check("with no ceiling, the rule naming none",
    /schema\.dotStacks = new fields\.NumberField\(\{[^}]*max:/.test(MODEL), false);
  check("and never below none",
    /schema\.dotStacks = new fields\.NumberField\(\{[^}]*min: 0/.test(MODEL), true);

  // Nothing clears it on its own: not the round, not the Encounter. Whatever applied it
  // takes it away, which is what "a period of time decided by the effect" means.
  check("the round does not clear it", /dotStacks/.test(
    /export function newRoundFor[\s\S]*?\n\}/.exec(COMBAT)?.[0] ?? ""), false);
  check("nor does entering or leaving an Encounter", /"system\.dotStacks"/.test(COMBAT), false);
}

// --- It is not a Combat Condition ---------------------------------------------------
// The near-miss worth checking: built as one, it would inherit everything a Condition
// carries - immunity written as `forbid condition.dot`, the stack limits, the lot.
check("DOT is not among the Combat Conditions",
  allConditions().filter(c => /dot/i.test(c.key)), []);
check("and it has a Slot of its own instead", Boolean(getSlot("dot")), true);
check("with what one stack costs beside it", Boolean(getSlot("dot.perStack")), true);

// --- Taken at the start of the turn ---------------------------------------------------
{
  const body = /async function beginTurn[\s\S]*?\n\}/.exec(COMBAT)?.[0] ?? "";

  check("it is taken as the turn begins", body.includes("await burnDot(actor);"), true);

  // After the Moment, so an effect that answers the start of your turn by taking a stack
  // off takes it off before it burns you.
  check("after the Moment that could still take a stack off",
    body.indexOf('fireMoment(actor, "start-of-turn")') < body.indexOf("await burnDot(actor);"),
    true);

  // On a skipped turn as much as any other - a skipped turn is still your turn, which is
  // the whole reason both of its edges arrive.
  check("and on a skipped turn too",
    body.indexOf("await burnDot(actor);") < body.indexOf("if (skipped) ui.notifications"),
    true);

  // A Life Point reduction rather than Damage: "reduce your Life Points" is the wording,
  // and it is the wording Collision Damage uses - Soak has no say in either.
  check("it reduces Life Points rather than dealing Damage",
    /const \{ reduceLifePoints \} = await import\("\.\/chat\.mjs"\);/.test(COMBAT), true);
  check("and nothing is taken when no stack is held",
    /if \(taken <= 0\) return;/.test(COMBAT), true);

  // The reason names the stacks, since a bare "Life Point reduction" beside a number the
  // player did not expect is the thing that starts an argument.
  check("the line says where it came from",
    /reason: `Damage Over Time - \$\{stacks\} stack\$\{\(stacks === 1\) \? "" : "s"\}`/.test(COMBAT),
    true);
}

// --- Where it is read -----------------------------------------------------------------
check("the sheet counts the stacks", /name="system\.dotStacks"/.test(SHEET), true);
check("and says what they will cost",
  /-\{\{system\.dot\.total\}\} Life at the start of your turn/.test(SHEET), true);
check("the guide says it is not a Condition",
  GUIDE.includes("It is not a") && GUIDE.includes("Combat Condition"), true);
check("and that nothing here takes a stack away",
  GUIDE.includes("whatever applied it is what takes it away"), true);

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
