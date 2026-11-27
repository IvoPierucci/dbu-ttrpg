/**
 * What the language accepts, checked one feature at a time.
 *
 * Written before the Combat Conditions, because seventeen files authored against a
 * header the parser does not actually support is seventeen files to rewrite.
 */

import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
const MODULES = pathToFileURL(path.join(ROOT, "module", "effects")).href;
const { compile } = await import(`${MODULES}/parser.mjs`);
const { decompile } = await import(`${MODULES}/decompile.mjs`);

const DATA = {
  attributes: Object.fromEntries(
    ["agility", "force", "tenacity", "scholarship", "insight", "magic", "personality"]
      .map(k => [k, { score: 10, mod: 0 }])),
  skills: Object.fromEntries(
    ["stealth", "perception", "intuition", "flight"].map(k => [k, { bonus: 0 }])),
  savingThrows: Object.fromEntries(
    ["impulsive", "corporeal", "cognitive", "morale"].map(k => [k, { value: 0 }])),
  conditions: {}, states: {}, resources: {},
  tierOfPower: 3, baseTierOfPower: 3
};

/** [source, should it compile, what it is testing] */
const CASES = [
  // --- Headers ---------------------------------------------------------------
  ["[passive]\nmight += 1;", true, "passive"],
  ["[automatic/start-of-turn]\nlife.value -= 2;", true, "automatic with a moment"],
  ["[triggered/combat-roll]\nstrike += 2(T);", true, "triggered with a moment"],
  ["[triggered/combat-roll, 1/round]\nstrike += 1;", true, "a per-round budget"],
  ["[triggered/combat-roll, 1/round, 2/encounter]\nstrike += 1;", true, "both budgets"],
  ["[automatic/being-hit, before]\nsoakValue.base += 2;", true, "before"],
  ["[passive per stack]\nspeed.normal -= 1;", true, "per stack"],
  ["[passive from 2]\nmight += 1;", true, "from a level"],
  ["[triggered/start-of-turn, costs 1 action]\nremove();", true, "an action cost"],
  ["[triggered/counter-window, instant maneuver]\nstrike += 1;", true, "granting a maneuver"],
  ["[automatic/threshold]\nlife.value -= 1;", true, "a moment with its own limit"],
  ["[automatic/defeated]\nleaveState();", true, "defeated"],
  ["[automatic/defeat-resolved]\nleaveState();", true, "defeat-resolved"],
  ["[triggered]\nmight += 1;", false, "triggered with no moment is refused"],
  ["[passive/start-of-turn]\nmight += 1;", false, "passive with a moment is refused"],
  ["[automatic/nonsense]\nmight += 1;", false, "an unknown moment is refused"],

  // --- Statements ------------------------------------------------------------
  ["[passive]\nmight += 2(T);", true, "per Tier"],
  ["[passive]\ntierOfPower += 1(bT);", true, "per Base Tier in the tier phase"],
  ["[passive]\ntierOfPower += 1(T);", false, "per Tier in the tier phase is refused"],
  ["[passive]\ncombatRolls += 1;", true, "combatRolls fans out"],
  ["[passive]\nwound += 2(T);\nmight += 2(T);", true, "two statements"],
  ["[passive]\nsoakValue *= 2;", true, "multiply"],
  ["[passive]\ncriticalTarget min= 7;", true, "min="],
  ["[passive]\nmight = 4;", true, "set"],
  ["[passive]\ncombatRolls.dice += 1d10;", true, "adding dice"],
  ["[passive]\nsurge.life.dice += 1d10(T);", true, "scaled dice"],
  // Allowed since Combat Recovery: "regain 1d10(bT) Life and Ki Points" is the shape
  // the rulebook writes a recovery in, and the dice are a number by the time anything
  // reads them - so they go wherever a number goes.
  ["[passive]\nmight += 1d10;", true, "dice where a number is expected"],
  ["[passive]\nnonsense += 1;", false, "an unknown slot is refused"],
  ["[passive]\nskill.stelth += 1;", false, "a misspelled skill is refused"],
  ["[passive]\nskill.stealth += 1;", true, "a real skill"],
  ["[passive]\nsave.morale += 1;", true, "a saving throw"],
  ["[passive]\nforce.mod += 1;", true, "an attribute modifier"],
  ["[passive]\nwillingFailure forbid;", false, "forbid is a statement, not an operator"],
  ["[passive]\nforbid willingFailure;", true, "forbid"],
  ["[triggered/start-of-turn]\ngain(\"Prone\", 2);", true, "a verb with a name argument"],
  ["[triggered/start-of-turn]\nremove(\"Prone\");", true, "remove by name"],

  // --- Conditions ------------------------------------------------------------
  ["[passive]\nif (force.score > 10) { might += 1; }", true, "a comparison"],
  ["[passive]\nif (force.score > 10) { might += 1; } else { might += 2; }", true, "else"],
  ['[passive]\nif (hasCondition("Prone")) { dodge -= 2; }', true, "hasCondition"],
  ['[passive]\nif (inState("Raging")) { might += 2; }', true, "inState"],
  ['[passive]\nif (!benefiting("Balanced Warrior")) { might += 1; }', true, "a negated predicate"],
  ['[passive]\nif (isMinion) { life.max = 1; }', true, "a predicate with no arguments"],
  ['[passive]\nif (benefitting("X")) { might += 1; }', false, "a misspelled predicate is refused"],
  ["[automatic/being-hit]\nif (defending) { soakValue.base += 2; }", true, "defending"],
  ["[passive]\nif (force.score > 10 && insight.score > 10) { might += 1; }", true, "&&"],
  ["[passive]\nif (force.score > 10 || insight.score > 10) { might += 1; }", true, "||"],
  ["[passive]\nrequires isMinion;\nmight += 1;", true, "a requires line"],

  // --- Context ---------------------------------------------------------------
  ["[automatic/damage-applied]\nlife.value -= damage;", true, "reading the moment context"],
  ["[automatic/start-of-turn]\nlife.value -= damage;", false,
    "reading context the moment does not offer is refused"],

  // --- Levels ----------------------------------------------------------------
  ["[passive from 1]\nmight += L;", true, "L on a levelled effect"],
  ["[passive]\nmight += L;", false, "L with no level is refused"],

  // --- Verbs and permissions -------------------------------------------------
  [`[triggered/start-of-turn]\nnonsenseVerb();`, false, "an unknown verb is refused"],
  [`[triggered/start-of-turn]\ngain();`, false, "a verb missing an argument is refused"],
  [`[triggered/start-of-turn]\nsurge("ki");`, true, "a verb naming its kind"],
  [`[triggered/start-of-turn]\nmightClash();`, true, "mightClash"],
  [`[passive]\nforbid maneuvers;`, true, "forbidding a declared permission"],
  [`[passive]\nforbid nonsense;`, false, "forbidding something undeclared is refused"],
  [`[passive]\nforbid might;`, false, "forbidding a number is refused"],

  // --- Stacks ----------------------------------------------------------------
  [`[passive]\nsoakValue.external -= 2(bT) * stacks;`, true, "reading the stack count"],
  [`[passive per stack]\ncapacity.multiplier *= 0.5;`, true, "repeating per stack"],

  // --- Levels that scale, and dice by name -----------------------------------
  [`[passive from 1]\nwound += L(T);`, true, "a level scaled per Tier"],
  [`[passive from 1]\nsoakValue += L(bT);`, true, "a level scaled per Base Tier"],
  [`[passive from 1]\ntierOfPower += L(T);`, false, "L(T) in the tier phase is refused"],
  [`[passive from 1]\ntierOfPower += L(bT);`, true, "L(bT) in the tier phase"],
  [`[passive]\ncombatRolls.dice += greaterDice;`, true, "Greater Dice by name"],
  [`[passive]\nsurge.life.dice += criticalDice;`, true, "Critical Dice by name"],
  [`[passive]\nmight += greaterDice;`, true, "named dice where a number is expected"],

  // --- Taken after the result is known ---------------------------------------
  [`[triggered/clash-resolved]\nrequires clash.lost && clash.combatRoll;\nroll.dice += greaterDice;\nroll.total += 1(bT);`, true, "Karmic Boost"],
  [`[triggered/clash-resolved]\nrequires clash.lost && clash.answering && (clash.skill || clash.save || clash.might);\nclash.succeed = true;`, true, "Karmic Save"],
  [`[triggered/clash-resolved]\nrequires clash.nonsense;\nclash.succeed = true;`, true, "unknown clash context is not caught - paths under a provided root are unchecked"],
  [`[triggered/clash-resolved]\nreroll();`, true, "Karmic Chance"],
  [`[triggered/defending]\ndefend.free = true;`, true, "Karmic Desperation"],
  [`[passive]\nclash.succeed = true;`, false, "a reactive slot in a passive still parses but is refused"],
  [`[triggered/combat-roll]\nrequires clash.lost;`, false, "clash context at a moment without it is refused"],

  // --- Grouping conditions ----------------------------------------------------
  [`[triggered/clash-resolved]\nrequires clash.lost && (clash.skill || clash.might);\nclash.succeed = true;`, true, "parentheses group a condition"],
  // A ternary binds looser than a comparison, so one used as an operand has to keep
  // its brackets or it reads back inside out: `n < (m ? 1 : 2)` written flat parses
  // as `(n < m) ? 1 : 2`, which is a different question that still compiles.
  [`[automatic/end-of-turn]\nif (attacksThisRound < (isMinion ? 1 : 2)) {\n  life.value -= 1;\n}`,
    true, "a ternary keeps its brackets as an operand"],
  [`[passive]\nwound += isMinion ? 1(T) : 2(T);`, true, "a ternary standing alone"],
  [`[triggered/clash-resolved]\nrequires !clash.combatRoll;\nclash.succeed = true;`, true, "a negated context flag"],

  // --- Booleans ---------------------------------------------------------------
  [`[passive]\nskipTurn = true;`, true, "a flag set to true"],
  [`[passive]\nskipTurn = false;`, true, "a flag set to false"],
  [`[passive]\nmight = true;`, false, "true into a number slot is refused"],

  // --- Which phase a block may write -----------------------------------------
  [`[triggered/combat-roll]\ncombatRolls += 2(T);`, true, "a triggered bonus to every Combat Roll"],
  [`[triggered/combat-roll]\nwound += 2(T);`, true, "a triggered bonus to Wound Rolls"],
  [`[automatic/being-hit]\nsoakValue += 2(T);`, true, "a reactive block may name a derived slot"],
  [`[passive]\nclash.succeed = true;`, false, "a passive writing a reactive-only slot is refused"],
  [`[passive]\nturn.skip = true;`, false, "a passive writing turn.skip is refused"],
  [`[passive]\nskipTurn = true;`, true, "skipTurn is standing, so a passive sets it"],

  // --- Comments and shape ----------------------------------------------------
  ["# a comment\n[passive]\nmight += 1; // trailing\n", true, "comments"],
  ["[passive]\nmight += 1;\n\n[passive]\nwound += 1;", true, "two blocks"]
];

let failed = 0;
for (const [src, shouldCompile, label] of CASES) {
  const { program, errors } = compile(src, DATA);
  const ok = errors.length === 0;

  if (ok !== shouldCompile) {
    failed++;
    console.log(`FAIL  ${label}`);
    console.log(`      ${src.replaceAll("\n", " | ")}`);
    if (ok) console.log("      compiled, but should not have");
    else for (const e of errors) console.log(`      ${e.message}`);
    continue;
  }

  // Anything that compiles has to survive being written back out.
  if (ok) {
    const text = decompile(program);
    const again = compile(text, DATA);
    if (again.errors.length || (JSON.stringify(again.program) !== JSON.stringify(program))) {
      failed++;
      console.log(`FAIL  ${label}: round trip`);
      console.log(`      in:  ${src.replaceAll("\n", " | ")}`);
      console.log(`      out: ${text.replaceAll("\n", " | ")}`);
      if (again.errors.length) console.log(`      ${again.errors[0].message}`);
    }
  }
}

console.log(`\n${CASES.length} case(s), ${failed} failing`);
process.exit(failed ? 1 : 0);
