/**
 * What the floor throws away when a reduction takes the Soak Value past zero.
 *
 * Broken turns exactly that into extra Damage, and it had been turning the *whole*
 * reduction into Damage instead - and adding Damage even when the Soak survived the
 * reduction with room to spare. The comment in the file claimed the arithmetic was
 * right, which is why this is a check rather than a comment.
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
const { applySlot } = await import(`${M}/interpreter.mjs`);

/**
 * The two lines the data model derives, in the same order and with the same floors.
 * Kept in step with actor-character.mjs by the numbers below rather than by hope.
 */
function settleSoak(ownSoak, externalSlot) {
  const beforeFloor = applySlot({ "soakValue.external": externalSlot }, "soakValue.external", ownSoak);
  return { soak: Math.max(0, beforeFloor), shortfall: Math.max(0, -beforeFloor) };
}

/** A reduction written into soakValue.external, as Broken and anything else are. */
const reduce = amount =>
  ({ add: -amount, multiply: 1, set: null, min: null, max: null, clamp: null });

/** What Broken itself takes off: 2(bT) per stack. */
const brokenTakes = (baseTier, stacks) => 2 * baseTier * stacks;

/** What Broken adds to the Damage: the shortfall, but never more than it took. */
const brokenAdds = (shortfall, baseTier, stacks) =>
  Math.min(shortfall, brokenTakes(baseTier, stacks));

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

// Soak 1, one stack at Base Tier 1: the reduction is 2, so 1 of it lands and 1 spills.
check("a reduction that just overruns", settleSoak(1, reduce(brokenTakes(1, 1))),
  { soak: 0, shortfall: 1 });

// Soak 10 against a reduction of 6: nothing spills, and nothing is added to Damage.
check("a reduction the Soak absorbs", settleSoak(10, reduce(brokenTakes(1, 3))),
  { soak: 4, shortfall: 0 });

// Exactly consumed: no Soak left, and still nothing spills.
check("a reduction that exactly consumes it", settleSoak(6, reduce(brokenTakes(1, 3))),
  { soak: 0, shortfall: 0 });

// Three stacks at Base Tier 3 is 18 against a Soak of 5.
check("stacks and Base Tier both count", settleSoak(5, reduce(brokenTakes(3, 3))),
  { soak: 0, shortfall: 13 });

check("no Broken, no shortfall", settleSoak(7, undefined), { soak: 7, shortfall: 0 });

// --- Broken's share of the shortfall ----------------------------------------
// The shortfall is the whole drop below zero, whatever caused it. Broken turns its
// own share into Damage and no more, or a second effect reducing your Soak would be
// paid for twice - once in Soak, and again as Damage credited to Broken.

// Soak 2, one stack at Base Tier 1 takes 2, and something else takes 5 as well.
{
  const { shortfall } = settleSoak(2, reduce(brokenTakes(1, 1) + 5));
  check("the shortfall counts every reduction", shortfall, 5);
  check("but Broken only adds what it took", brokenAdds(shortfall, 1, 1), 2);
}

// And when Broken is the only thing pushing it under, it adds the whole shortfall.
{
  const { shortfall } = settleSoak(1, reduce(brokenTakes(1, 1)));
  check("alone, Broken adds all of it", brokenAdds(shortfall, 1, 1), 1);
}

// --- Damage that is not there -------------------------------------------------
// "Wound Roll - Soak Value - Damage Reduction = Damage. If that comes to 0 or less, one
// reading is that it does not exist - so effects that increase the Damage you receive,
// like Superior, do not apply, there being no Damage to increase."
{
  const fs = await import("node:fs");
  const path = await import("node:path");
  const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
  const GUIDE = fs.readFileSync(path.join(ROOT, "WRITING-EFFECTS.txt"), "utf8");

  // Mirrors damageTaken: nothing at all when there was nothing to begin with.
  const taken = (raw, ...changes) => {
    if (raw <= 0) return 0;
    let damage = raw;
    for (const change of changes) {
      if (change) damage = applySlot({ "incoming.damage": change }, "incoming.damage", damage);
    }
    return Math.max(0, damage);
  };

  /** Superior: "increase the Damage you take by 2(T)" - 6 at Tier of Power 3. */
  const superior = { add: 6, multiply: 1, set: null, min: null, max: null, clamp: null };

  check("Superior takes more of a Wound that got through", taken(10, superior), 16);
  check("but conjures none from a Wound the Soak swallowed", taken(0, superior), 0);
  check("nor from one it more than swallowed", taken(-4, superior), 0);

  // One point through is Damage, and Superior has something to take more of. The edge is
  // between nothing and one, which is the whole of the rule.
  check("a single point through is still Damage", taken(1, superior), 7);

  // A reduction is moot at nothing either, and must not take it below.
  const halved = { add: 0, multiply: 0.5, set: null, min: null, max: null, clamp: null };
  check("and nothing halved is still nothing", taken(0, halved), 0);

  // Both passes are skipped together: being hit, and before the Wound Roll.
  check("neither pass is applied to nothing", taken(0, superior, superior), 0);

  // The two places that work Damage out say it the same way, because they ask the same
  // function - the Wound step and the re-settling after a Karmic Effect.
  check("the rule has one definition",
    (CHAT.match(/function damageTaken\(raw, \.\.\.changes\)/g) ?? []).length, 1);
  // Five places work Damage out now (Bruising Wound's Critical on the Wound Roll the fifth) - the Wound step, the re-settling after a Karmic
  // Effect, somebody who took a Wound Roll in another's place, and what spills past them
  // onto the Ally - and every one of them asks it. Counted rather than listed, since the
  // thing that matters is that none of them does the arithmetic itself.
  check("every place that works Damage out asks it",
    (CHAT.match(/damageTaken\(raw,/g) ?? []).length - 1, 5);
  // Asked of everything but the function itself, which is the one place the Slot is
  // meant to be applied.
  {
    const body = /function damageTaken[\s\S]*?\n\}/.exec(CHAT)?.[0] ?? "";
    check("and none of them applies the Slot by hand",
      /applySlot\([^)]*"incoming\.damage"/.test(CHAT.replace(body, "")), false);
    check("while the function itself does", body.includes('"incoming.damage"'), true);
  }

  // The Moment is not even fired when there is nothing to answer about: asked anyway, a
  // one-shot effect armed for it would be spent raising nothing.
  check("the before-wound Moment is not fired over nothing",
    /const beforeWound = \(raw > 0\)/.test(CHAT), true);
  check("and nothing is spent on it",
    /if \(beforeWound\) spendChosen\(target, beforeWound\);/.test(CHAT), true);

  // Which is a different question from whether it was a hit.
  check("the guide keeps the two apart",
    GUIDE.includes("A hit that deals no") && GUIDE.includes("is still a hit"), true);
}

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
