/**
 * Absolute Attacks, and what counts as missing.
 *
 * An Absolute Attack is the one thing in the system that deals Damage without hitting:
 * "if you fail to hit a target with an Attacking Maneuver, you still roll the Wound Roll
 * and apply 1/2 of the Dice Score of that roll to the target's Soak Value and Damage
 * Reduction". So it walks a path nothing else walks - a Wound Roll owed by a Maneuver
 * that landed on nobody, Damage owed by a line that missed - and every gate along it was
 * written expecting a hit.
 *
 * The other half is what it must NOT set off: "this does not count as hitting a
 * Character with an Attacking Maneuver, or dealing damage to that Character with an
 * Attacking Maneuver, for any effects that would trigger as a result." That half is
 * invisible until some effect keys off one of them, which is exactly when it is too late
 * to notice.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.argv[2];
const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
const MANEUVERS = fs.readFileSync(path.join(ROOT, "module", "maneuvers.mjs"), "utf8");
const MODEL = fs.readFileSync(path.join(ROOT, "module", "data", "actor-character.mjs"), "utf8");
const ITEM = fs.readFileSync(path.join(ROOT, "module", "data", "item-maneuver.mjs"), "utf8");
const USE = fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8");
const COMBAT = fs.readFileSync(path.join(ROOT, "module", "combat.mjs"), "utf8");
const MOMENTS = fs.readFileSync(path.join(ROOT, "module", "effects", "moments.mjs"), "utf8");
const SHEET = fs.readFileSync(path.join(ROOT, "templates", "parts", "actor-combat.hbs"), "utf8");
const ITEM_SHEET = fs.readFileSync(path.join(ROOT, "templates", "parts", "maneuver-rules.hbs"), "utf8");

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

// --- The arithmetic --------------------------------------------------------------
// "Apply 1/2 of the Dice Score of that roll to the target's Soak Value and Damage
// Reduction. The amount you exceed the cumulative of the target's Soak Value and Damage
// Reduction is dealt as Damage."
const absolute = (diceScore, soak, reduction = 0) => {
  const half = Math.floor(diceScore / 2);
  return { half, damage: Math.max(0, half - soak - reduction) };
};

check("half the Dice Score, less Soak and Damage Reduction together",
  absolute(40, 10, 4), { half: 20, damage: 6 });
check("the halving rounds down", absolute(41, 0), { half: 20, damage: 20 });
check("defences that cover it leave nothing", absolute(30, 20, 5), { half: 15, damage: 0 });
check("and nothing is dealt below zero", absolute(10, 50), { half: 5, damage: 0 });

// The two are cumulative, not applied one after the other: 20 against 8 soak and 8
// reduction is 4, not 20 - 8 = 12 then - 8 again.
check("the two are one cumulative total", absolute(40, 8, 8).damage, 4);

// It is the Dice Score - the whole roll - that is halved, and half of it is what meets
// the Soak. Halving the Soak instead would be a different rule and a kinder one.
check("it is the roll that is halved, not the defences",
  absolute(40, 10).damage !== (40 - Math.floor(10 / 2)), true);

// --- Missing an Attacking Maneuver -------------------------------------------------
// "If an Opponent is hit, but they received no Damage from that Attacking Maneuver due
// to their Soak Value and Damage Reduction reducing the Wound Roll's Dice Score to 0,
// this is NOT considered a 'missed' Attacking Maneuver."
{
  const line = (hit, damage) => ({ hit, damage });
  const missed = own => !own.hit;

  check("a hit for no damage is not a miss", missed(line(true, 0)), false);
  check("a hit for damage is not a miss", missed(line(true, 12)), false);
  check("failing to hit is", missed(line(false, 0)), true);

  // Which is what the card says too: a line that was hit reads as a hit however little
  // it took, and only a line that never landed reads as missed.
  check("the card asks the same question",
    /if \(!own\.hit\) \{[\s\S]{0,400}?return "missed";/.test(CHAT), true);
}

// The `hit` and `miss` Moments carry the definition, since an author writing "when you
// miss" reads them and nothing else.
check("the hit Moment says a damageless hit is still a hit",
  /key: "hit"[\s\S]{0,400}?Hitting for no damage is still a hit/.test(MOMENTS), true);
check("and that an Absolute Attack does not fire it",
  /key: "hit"[\s\S]{0,700}?does not fire this/.test(MOMENTS), true);
check("the miss Moment lists every way of failing to hit",
  ["the Strike lost", "dodged", "Intervene", "Defend Maneuver"]
    .every(phrase => /key: "miss"[\s\S]{0,700}?$/.test("") || MOMENTS.includes(phrase)), true);
check("and says an Absolute Attack has still missed",
  /key: "miss"[\s\S]{0,700}?has still missed/.test(MOMENTS), true);
check("and that an Ally intervening is not a miss on the first target",
  /Intervene is not a miss on the first target/.test(MOMENTS), true);

// --- Two a Combat Round -------------------------------------------------------------
{
  const MAX = 2;
  const left = used => Math.max(0, MAX - used);
  const allowed = used => used < MAX;

  check("two are allowed", [0, 1, 2, 3].map(allowed), [true, true, false, false]);
  check("and what is left is counted down", [0, 1, 2, 3].map(left), [2, 1, 0, 0]);

  check("the limit is two", /static MAX_ABSOLUTE_ATTACKS_PER_ROUND = 2;/.test(MODEL), true);
  check("the count is stored",
    /schema\.absoluteAttacksThisRound = new fields\.NumberField/.test(MODEL), true);
  check("and derived beside the limit it is checked against",
    /this\.absoluteAttacks = \{[\s\S]{0,300}?max: DBUCharacterData\.MAX_ABSOLUTE_ATTACKS_PER_ROUND/
      .test(MODEL), true);

  // It is a Combat Round's count, so the round clears it - in the same place every other
  // per-round count is cleared, rather than somewhere of its own that could be missed.
  check("the round clears it",
    /newRoundFor[\s\S]{0,600}?"system\.absoluteAttacksThisRound": 0/.test(COMBAT), true);

  // The rule is asked in one place, and both ways of throwing an attack ask it.
  check("the rule has one definition",
    (MANEUVERS.match(/export function whyNotAnotherAbsolute/g) ?? []).length, 1);
  check("the ordinary path asks it", USE.includes("whyNotAnotherAbsolute(actor, maneuver)"), true);
  check("and the out-of-sequence path asks it too",
    CHAT.includes("whyNotAnotherAbsolute(actor, maneuver)"), true);

  // Before anything is paid, so a refused attack costs nothing.
  check("it is asked before the Ki is spent",
    USE.indexOf("whyNotAnotherAbsolute") < USE.indexOf("spendManeuverCost(actor, maneuver"), true);
  check("on the out-of-sequence path as well",
    CHAT.indexOf("whyNotAnotherAbsolute") < CHAT.indexOf("spendManeuverCost(actor, maneuver"), true);

  // Counted when the attack is made, not when it misses: doing an Absolute Attack is
  // making one. Counting misses instead would let a character throw them all round and
  // spend the two on whichever happened to need them.
  check("it is counted as the attack is made",
    /"system\.absoluteAttacksThisRound": actor\.system\.absoluteAttacksThisRound \+ 1/.test(CHAT),
    true);
  check("in the same write as the rest of the counters",
    /await actor\.update\(\{[\s\S]{0,500}?absoluteAttacksThisRound[\s\S]{0,120}?\}\);/.test(CHAT),
    true);

  // Only an Attacking Maneuver can be one, so the flag on anything else is inert.
  check("only an Attacking Maneuver counts",
    /if \(!maneuver\?\.absolute \|\| !maneuver\?\.attacking\) return null;/.test(MANEUVERS), true);
  check("and only an Attacking Maneuver is counted",
    CHAT.includes("const absolute = Boolean(((maneuver.absolute || technique?.absolute) && maneuver.attacking)"), true);
}

// --- The flag travels ---------------------------------------------------------------
check("the Maneuver Item holds the boolean",
  /absolute: new fields\.BooleanField\(\{ required: true, initial: false \}\)/.test(ITEM), true);
check("the definition carries it off the Item", /absolute: item\.system\.absolute/.test(USE), true);
check("and back onto one", /absolute: Boolean\(definition\.absolute\)/.test(USE), true);
check("the item sheet can set it",
  /name="system\.absolute"/.test(ITEM_SHEET), true);
check("and the card carries it, settled at declaration",
  /\n\s*absolute,\n/.test(CHAT), true);

// --- The path a missed Absolute Attack has to walk -------------------------------------
// Every gate along it was written expecting a hit, and each one had to be told.
{
  // The Wound Roll is owed even when nothing landed: "you still roll the Wound Roll".
  // Read out of the function rather than matched at a distance: it has grown a
  // deflection short-circuit since, and a pattern counting characters between two lines
  // fails on the next thing that goes in between.
  const owes = /function owesWound\([\s\S]*?\n\}/.exec(CHAT)?.[0] ?? "";
  check("the Wound Roll is owed when nothing landed",
    owes.includes("anyoneHit(attack) || Boolean(attack.absolute)"), true);
  check("and the button asks that rather than whether anyone was hit",
    /if \(!result\.wound && owesWound\(attack\)\)/.test(CHAT), true);

  // The Wound step works out the miss instead of skipping it.
  check("a missed line is worked out rather than zeroed",
    /if \(!attack\.absolute\) \{[\s\S]{0,200}?continue;\s*\}\s*\n\s*settledTargets\.push\(\{ \.\.\.own, \.\.\.absoluteOutcome\(target, wound\) \}\);/
      .test(CHAT), true);

  // And the Damage button is offered on a line that never hit.
  check("Damage is offered on a line that missed",
    /if \(!entry\.own\?\.hit && !isAbsoluteMiss\(entry\.own\)\) continue;/.test(CHAT), true);
}

// --- What it must not set off -----------------------------------------------------
// "This does not count as hitting a Character with an Attacking Maneuver, or dealing
// damage to that Character with an Attacking Maneuver, for any effects that would
// trigger as a result."
{
  check("Sweeping's second helping of stacks does not follow from it",
    /const doubled = \(damage > 0\)\s*\n\s*&& !isAbsoluteMiss\(own\)/.test(CHAT), true);
  // Still ahead of the Knockback, which is the thing that matters. The guard grew when
  // Local Space started granting the Advantage to every Attacking Maneuver, so what is
  // checked is that `isAbsoluteMiss` is what opens the block rather than one branch of it.
  check("nor does Knockback",
    /if \(\(damage > 0\) && !isAbsoluteMiss\(own\)\) \{/.test(CHAT), true);

  // The hit triggers are offered off `own.hit`, which an Absolute miss never sets - so
  // nothing keyed to hitting is offered either.
  check("and nothing keyed to hitting is offered",
    /entry\.own\?\.hit \? relevantTriggers\(target, message, "hit"\)/.test(CHAT), true);

  // The line is marked, which is what all of the above read.
  check("the line says it was an Absolute Attack's answer to a miss",
    /function isAbsoluteMiss\(own\) \{\s*\n\s*return Boolean\(own\?\.absolute\) && !own\?\.hit;/
      .test(CHAT), true);
}

// --- Health Thresholds --------------------------------------------------------------
// "If you knock a Character through a Health Threshold with an Absolute Attack, treat it
// still as if it was done through your Attacking Maneuver." Nothing to do: the Damage is
// applied through the same path, and the Threshold is derived from Life rather than
// recorded by whatever dealt it.
{
  const body = /async function applyAttackDamage[\s\S]*?\n\}/.exec(CHAT)?.[0] ?? "";

  // An Absolute Attack's Damage is applied by the same function as any other attack's -
  // there is no second path for it - so the Life it takes moves the Health Threshold
  // exactly as an ordinary hit would. That is the whole of "treat it still as if it was
  // done through your Attacking Maneuver".
  check("an attack's Damage is taken in one place",
    (body.match(/"system\.life\.value":/g) ?? []).length, 1);
  check("and nothing applies an Absolute Attack's Damage separately",
    /absolute[\s\S]{0,40}(apply|deal)[\s\S]{0,40}life/i.test(CHAT.replace(body, "")), false);
}

// --- The card says what happened -------------------------------------------------------
check("a miss with a Wound Roll still owed says so",
  /missed - Absolute Attack, Wound Roll still owed/.test(CHAT), true);
check("and a settled one reads as a miss first",
  /function absoluteOutcomeText[\s\S]{0,900}?missed - Absolute Attack/.test(CHAT), true);
check("the sheet shows the two a round",
  /system\.absoluteAttacks\.used/.test(SHEET) && /system\.absoluteAttacks\.max/.test(SHEET), true);

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
