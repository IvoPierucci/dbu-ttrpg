/**
 * Minimum Ki Point Cost.
 *
 * "The Ki Point Cost of an Attacking Maneuver cannot be reduced to lower than 1/2 of the
 * listed KP Cost of that Attacking Maneuver's Profile."
 *
 * The whole rule is in where the floor is read from. It is half the *listed* cost, so
 * nothing that changes the price changes the floor: Drained making every attack cost
 * 2(T) more raises what you pay and leaves the floor exactly where it was. Read it off
 * the price instead and the floor follows the price down, which is no floor at all -
 * and that is invisible until an increase and a reduction are in play at once.
 *
 * The real functions are run here rather than mirrored: maneuvers.mjs imports nothing
 * that needs a document, so the pricing path can be exercised end to end.
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
globalThis.Handlebars = { escapeExpression: String };

const { PROFILES, maneuverKiCost, minimumAttackKiCost, profileListedKiCost, profileKiCost } =
  await import(modUrl("maneuvers.mjs"));

const MANEUVERS = fs.readFileSync(path.join(ROOT, "module", "maneuvers.mjs"), "utf8");
const SLOTS = fs.readFileSync(path.join(ROOT, "module", "effects", "slots.mjs"), "utf8");

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

/** One contribution to a Slot, in the shape the interpreter leaves behind. */
const flat = (changes = {}) =>
  ({ add: 0, multiply: 1, set: null, min: null, max: null, clamp: null, ...changes });

/** A character as the pricing path reads one. */
const fighter = (tier, slots = {}) =>
  ({ system: { tierOfPower: tier, baseTierOfPower: tier, effects: { slots } } });

/** A Basic Attack: no cost of its own, so the Profile is the whole price. */
const attack = { id: "basic-attack", attacking: true, kiCost: 0 };

/** What an attack with this Profile costs this character. */
const price = (profile, actor, extra = {}) =>
  maneuverKiCost({ ...attack, ...extra }, { profile }, actor);

// --- The listed cost is its own number -----------------------------------------
// Crushing lists 6(T). At Tier 3 that is 18 listed and 9 underneath it.
check("a Profile's listed cost grows with the Tier",
  [1, 2, 3].map(t => profileListedKiCost("crushing", fighter(t))), [6, 12, 18]);
check("and the floor is half of it, rounded down",
  [1, 2, 3].map(t => minimumAttackKiCost("crushing", fighter(t))), [3, 6, 9]);

// Simple costs nothing, so there is nothing to be kept above.
check("a Profile that costs nothing has no floor",
  minimumAttackKiCost("simple", fighter(3)), 0);

// An odd listed cost rounds the floor down, as everything in the rules does.
check("an odd listed cost rounds down",
  minimumAttackKiCost("combination", fighter(1)), 1);

// --- Nothing else is paid --------------------------------------------------------
check("with nothing in the way, you pay the listed cost",
  price("crushing", fighter(3)), 18);

// --- A reduction stops at the floor ----------------------------------------------
{
  const cheap = fighter(3, { "attack.kiCost": flat({ add: -30 }) });
  check("a reduction larger than the price stops at half the listed cost",
    price("crushing", cheap), 9);

  const some = fighter(3, { "attack.kiCost": flat({ add: -4 }) });
  check("a reduction that does not reach the floor is paid in full",
    price("crushing", some), 14);

  const exact = fighter(3, { "attack.kiCost": flat({ add: -9 }) });
  check("one that lands exactly on it is the floor", price("crushing", exact), 9);
}

// --- An increase raises the price and not the floor --------------------------------
// This is the case the rule is written for, and the one a floor read off the price
// gets wrong. Drained is +2(T): at Tier 3 that is 6 more.
{
  const drained = fighter(3, { "attack.kiCost": flat({ add: 6 }) });
  check("Drained makes the attack dearer", price("crushing", drained), 24);

  // Now both at once. The floor is still 9 - half of 18 - and not half of 24.
  const both = fighter(3, { "attack.kiCost": flat({ add: 6 - 30 }) });
  check("and with a reduction on top, the floor is still half the listed cost",
    price("crushing", both), 9);

  // Written the other way round it has to come to the same number: the floor is not a
  // term in the sum, so the order the two arrive in cannot matter.
  const reversed = fighter(3, { "attack.kiCost": flat({ add: -30 + 6 }) });
  check("however the increase and the reduction are ordered",
    price("crushing", reversed), price("crushing", both));
}

// A multiplier is a reduction like any other and stops at the same place.
{
  const halved = fighter(3, { "attack.kiCost": flat({ multiply: 0.25 }) });
  check("a multiplier cannot go under it either", price("crushing", halved), 9);
}

// --- Perfect Ki Control ------------------------------------------------------------
// "Reduce the Ki Point Cost of all Attacking Maneuvers by 1(T). Your Minimum Ki Point
// Cost for your Attacking Maneuvers is 2(T), this cannot increase the Minimum Ki Point
// Cost for an Attacking Maneuver."
{
  const tier = 3;
  const aspect = {
    "attack.kiCost": flat({ add: -tier }),
    "attack.kiCost.minimum": flat({ max: 2 * tier })
  };

  // Crushing at Tier 3: 18 listed, 6(T) is 2(T) x 3 = 6, and the usual floor is 9. The
  // Aspect lowers the floor to 6 because 6 is less than 9.
  check("the Aspect lowers the floor when 2(T) is less",
    minimumAttackKiCost("crushing", fighter(tier, aspect)), 6);

  // The reduction alone is only 3, so the price does not reach the new floor.
  check("and the attack still costs what the reduction left it at",
    price("crushing", fighter(tier, aspect)), 15);

  // With a deep reduction on top, the Aspect's lower floor is what you land on.
  const deep = { ...aspect, "attack.kiCost": flat({ add: -tier - 30 }) };
  check("a deep reduction lands on the lowered floor",
    price("crushing", fighter(tier, deep)), 6);

  // "This cannot increase the Minimum Ki Point Cost." Combination lists 3(T): at Tier 3
  // that is 9 listed and a floor of 4, which is already below 2(T) = 6. The Aspect must
  // leave that alone rather than pushing it up to 6.
  check("a floor already lower than 2(T) is left alone",
    minimumAttackKiCost("combination", fighter(tier, aspect)), 4);
  check("which is what `max=` means and `set` would not",
    minimumAttackKiCost("combination", fighter(tier, {
      "attack.kiCost.minimum": flat({ set: 2 * tier })
    })), 6);
}

// --- What the floor is measured against --------------------------------------------
// Blitz takes 2(T) back as a Signature Technique. That is a reduction, not a smaller
// listed cost, so the floor stays at half of 4(T) and the discount is measured against
// it like anything else.
{
  const tier = 3;
  const plain = fighter(tier);
  check("Blitz lists 4(T) however it is used", profileListedKiCost("blitz", plain), 12);
  check("and its Signature discount is a reduction",
    profileKiCost("blitz", { signature: true }, plain), 6);
  check("so the floor is half the listed cost, not half the discounted one",
    minimumAttackKiCost("blitz", plain), 6);
  check("a Signature Blitz pays the floor",
    price("blitz", plain, { signature: true }), 6);
}

// --- The Maneuver's own cost -------------------------------------------------------
// The rule floors "the Ki Point Cost of an Attacking Maneuver" at half the Profile's -
// so a Maneuver carrying a price of its own is inside the floor, not beside it.
{
  const tier = 1;
  const own = { ...attack, kiCost: 5 };
  check("a Maneuver's own cost is part of the price",
    maneuverKiCost(own, { profile: "crushing" }, fighter(tier)), 11);

  const cheap = fighter(tier, { "attack.kiCost": flat({ add: -20 }) });
  check("and the floor is under the whole of it",
    maneuverKiCost(own, { profile: "crushing" }, cheap), 3);
}

// --- What the floor does not touch ---------------------------------------------------
{
  const cheap = fighter(3, { "attack.kiCost": flat({ add: -30 }) });

  // The wager is what you chose to spend, added after the price is settled.
  check("a Ki Wager is added on top of the floor",
    maneuverKiCost(attack, { profile: "crushing", kiWager: 7 }, cheap), 16);

  // Only Attacking Maneuvers. Everything else is priced as it always was.
  const defending = { id: "defend", attacking: false, kiCost: 4 };
  check("a Maneuver that is not an attack has no floor",
    maneuverKiCost(defending, null, cheap), 4);

  // An Attacking Maneuver with no Profile declared has no listed cost to halve.
  check("nor does an attack with no Profile declared",
    maneuverKiCost(attack, null, cheap), 0);
}

// --- Where it sits in the pipeline -----------------------------------------------
// Last, because it is a floor under the finished price. Anywhere earlier and the next
// reduction walks straight through it.
{
  const body = /export function maneuverKiCost[\s\S]*?\n\}/.exec(MANEUVERS)?.[0] ?? "";
  check("the floor is applied after everything written to attack.kiCost",
    body.indexOf('applySlot(slots, "attack.kiCost", cost)')
      < body.indexOf("minimumAttackKiCost"), true);
  check("and the wager after the floor",
    body.indexOf("minimumAttackKiCost") < body.indexOf("kiWager"), true);
  check("it is a floor, not a term",
    /cost = Math\.max\(cost, minimumAttackKiCost\(/.test(body), true);
}

// Read off the listed cost, never off the discounted one.
check("the floor reads the listed cost",
  /const listed = profileListedKiCost\(profileId, actor\);\s*\n\s*const half = Math\.floor\(listed \/ 2\);/
    .test(MANEUVERS), true);

// The Slot exists, and takes the ops the Aspect needs.
check("the Slot is declared", SLOTS.includes('key: "attack.kiCost.minimum"'), true);
check("and takes the numeric operations, `max=` among them",
  /key: "attack\.kiCost\.minimum"[\s\S]{0,80}ops: NUMERIC/.test(SLOTS), true);

// Both Profile pickers price the attack rather than the Profile's share, since the
// floor belongs to the Profile and only shows in the total. Asked once, because the two
// pickers build their rows with the same function - it used to be written out twice.
check("a row shows what the attack would cost",
  (MANEUVERS.match(/profileOptionCost\(maneuver, profile\.id, actor\)/g) ?? []).length, 1);
check("from the builder both pickers use - the Energy Charge's, and the attack's Foundation tabs",
  (MANEUVERS.match(/profileOption\(profile, maneuver, actor, (\{|state, limits,)/g) ?? []).length, 2);
check("and that is the same function the attack is charged with",
  /function profileOptionCost[\s\S]{0,200}?maneuverKiCost\(maneuver, \{ profile: profileId \}, actor\)/
    .test(MANEUVERS), true);

// Every Profile's floor is half of what it lists, whatever the Profile.
{
  const tier = 2;
  const wrong = Object.keys(PROFILES).filter(id =>
    minimumAttackKiCost(id, fighter(tier)) !== Math.floor(profileListedKiCost(id, fighter(tier)) / 2));
  check("every Profile is floored at half its own listed cost", wrong, []);
}

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
