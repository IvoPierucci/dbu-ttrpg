/**
 * Long Range, and what it costs a Strike Roll.
 *
 * "Characters are considered to be at Long Range, from your Character's perspective, if
 * they are 9+ Squares away." "Reduce your Strike Rolls against any Character at Long
 * Range by 2(bT)."
 *
 * Two things make this easy to get wrong. The distance is counted differently from the
 * way the system measures it - `squaresBetween` answers how many Squares lie *between*
 * two tokens, and the rules count the target's own Square as the first - so the two
 * numbers differ by one and a band read off the wrong one is off by one. And the penalty
 * is against a *Character*, not on the roll: one Strike Roll reaches several people at
 * several distances, and it is not worth the same against each of them.
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
globalThis.canvas = { grid: { size: 100 } };

const { squaresBetween, squaresAway, atLongRange, longRangePenalty,
        LONG_RANGE_SQUARES, LONG_RANGE_PENALTY_PER_BASE_TIER } =
  await import(modUrl("maneuvers.mjs"));

const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
const GUIDE = fs.readFileSync(path.join(ROOT, "WRITING-EFFECTS.txt"), "utf8");

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

const SCENE = { id: "scene", grid: { size: 100 } };

/** A character standing at a Square, with a footprint of one unless it is said. */
function standing(x, { size = 1, baseTier = 1 } = {}) {
  const token = { x: x * 100, y: 0, width: size, height: size, parent: SCENE };
  return {
    name: `at ${x}`,
    system: { baseTierOfPower: baseTier },
    getActiveTokens: () => [token]
  };
}

// --- Counting the Squares -------------------------------------------------------
// The rules count the target's own Square as the first, so somebody you are touching is
// 1 Square away and not 0.
{
  const here = standing(0);
  check("touching is one Square away", squaresAway(here, standing(1)), 1);
  check("and the gap between them is none", squaresBetween(
    here.getActiveTokens()[0], standing(1).getActiveTokens()[0]), 0);

  check("the two differ by one all the way out",
    [1, 5, 8, 9, 12].map(x => squaresAway(here, standing(x))),
    [1, 5, 8, 9, 12]);
}

// --- Where the band falls -------------------------------------------------------
// "9+ Squares away", so eight is not Long Range and nine is. Off by one here is the
// whole rule, which is why it gets its own case at each edge.
{
  const here = standing(0);
  check("the band opens at nine", LONG_RANGE_SQUARES, 9);
  check("eight Squares away is not Long Range", atLongRange(here, standing(8)), false);
  check("nine is", atLongRange(here, standing(9)), true);
  check("and further still is", atLongRange(here, standing(30)), true);
  check("touching is not", atLongRange(here, standing(1)), false);
}

// A larger character is measured from their footprint, not their middle - so a Gigantic
// one standing nine Squares off by their nearest corner is not at Long Range.
{
  const here = standing(0);
  const huge = standing(6, { size: 4 });
  check("a big character is measured from the nearest Square they cover",
    squaresAway(here, huge), 6);
  check("so being wide can keep them out of Long Range", atLongRange(here, huge), false);
}

// Unmeasurable is not far. Out of combat there are no Squares, and a rule about them is
// not enforced where there are none - the same answer the Melee Range gives.
{
  const nowhere = { name: "nowhere", system: {}, getActiveTokens: () => [] };
  check("somebody with no token is not at Long Range",
    atLongRange(standing(0), nowhere), false);
  check("and the distance is unmeasurable rather than zero",
    squaresAway(standing(0), nowhere), null);
}

// --- What it costs --------------------------------------------------------------
// "Reduce your Strike Rolls against any Character at Long Range by 2(bT)."
{
  check("it is 2(bT)", LONG_RANGE_PENALTY_PER_BASE_TIER, 2);
  check("which at Base Tier 1 is 2",
    longRangePenalty(standing(0, { baseTier: 1 }), standing(9)), 2);
  check("and at Base Tier 4 is 8",
    longRangePenalty(standing(0, { baseTier: 4 }), standing(9)), 8);
  check("and nothing at all inside the band",
    longRangePenalty(standing(0, { baseTier: 4 }), standing(8)), 0);

  // (bT), so a Transformation does not make the distance worse.
  check("the Base Tier is what is read, not the current one",
    /LONG_RANGE_PENALTY_PER_BASE_TIER \* \(actor\?\.system\?\.baseTierOfPower \?\? 1\)/
      .test(fs.readFileSync(path.join(ROOT, "module", "maneuvers.mjs"), "utf8")), true);
}

// --- Against a Character, not on the roll -----------------------------------------
// One Strike Roll reaches several people at several distances. Taken off the roll, an
// area attack that caught somebody far away would be blunted against everybody near.
{
  const strike = 20;
  const against = (penalty) => Math.max(0, strike - penalty);

  check("the near half faces the whole Strike", against(0), 20);
  check("and the far half faces less of it", against(6), 14);

  // So one roll can land on one and miss the other.
  const dodge = 16;
  check("which lets one roll land and miss off the same number",
    [against(0) > dodge, against(6) > dodge], [true, false]);

  // Floored at nothing like every other roll, rather than going negative for somebody to
  // beat from below.
  check("a Strike reduced past nothing is nothing", against(40), 0);

  // The Analysis Maneuver's bonus goes on in the same place, so the two lines are no
  // longer adjacent. What this is about is that the distance is measured here, against
  // this one defender, and comes off what the Strike is worth against them.
  check("it is taken where the Strike meets the defence",
    /: \(\(weapon\.ignoresLongRange \|\| skyWaived \? 0 : longRangePenalty\(attacker, target\)\)/.test(CHAT), true);
  check("and taken off what the Strike is worth against them",
    /const against = attack\.techniqueBlocked \? 0 : Math\.max\(0, \(strike\.total \+ analysis\) - longRange\);/.test(CHAT),
    true);
  check("and that is what the Clash compares",
    /const hit = automatic \|\| \(answer \? \(against > answer\.total\) : true\);/.test(CHAT), true);
  check("rather than the roll itself",
    /strike\.total > answer\.total/.test(CHAT), false);
}

// --- Combination's extra Strikes pay it too ----------------------------------------
// They are three more Strike Rolls against the same Character, so the distance costs
// them what it cost the first one.
check("the follow-up Strikes take the same penalty",
  /rolls\.filter\(roll => Math\.max\(0, roll\.total - longRange\) > beatable\)/.test(CHAT), true);
check("read off the line they are measured against",
  /const longRange = line\?\.longRange \?\? 0;/.test(CHAT), true);

// --- Said on the card ---------------------------------------------------------------
// A Strike of 20 losing to a Dodge of 15 reads as a bug unless the five that went
// missing are named.
check("the defence line says the distance was in the way - in the hover of 'Strike N against them' (the user's)",
  CHAT.includes('return [...(own?.analysisRows ?? []).map(partLine), ...distanceRows(own).map(partLine)];')
    && CHAT.includes('return [...technique, ...(distance ? [{ label: "Long Range", value: distance }] : [])];')
    && CHAT.includes("...againstLines(own)], own.against)"), true);
// The Analysis row and its comment sit between the two now, so this allows for what is
// recorded beside them rather than demanding the two be adjacent.
check("and the branch records both numbers",
  /longRange,\s*\n[\s\S]{0,1400}?against,/.test(CHAT), true);

// --- Written down where an author reads it --------------------------------------------
check("the guide says where the band falls",
  GUIDE.includes("9 or more Squares away, counting theirs as the first"), true);
check("and that the penalty belongs to the pairing",
  GUIDE.includes("Against them,"), true);

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
