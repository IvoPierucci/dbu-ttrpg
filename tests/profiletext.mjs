/**
 * The Profile entries say what the rulebook says.
 *
 * Word for word, not a tidied-up version: a player choosing a Profile is choosing
 * against the text they know, and a paraphrase is one more thing to reconcile at the
 * table. What was there before was a summary line and a list of bullet points somebody
 * had rewritten, which read well and was not the rule.
 *
 * So this holds the published entries and compares them to what the system will show.
 * Wrapping is ignored - the source file wraps to stay readable - but every word, every
 * number and every piece of punctuation has to survive.
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

const { PROFILES, FOUNDATION_NOTES } = await import(modUrl("maneuvers.mjs"));
const MANEUVERS = fs.readFileSync(path.join(ROOT, "module", "maneuvers.mjs"), "utf8");
const CSS = fs.readFileSync(path.join(ROOT, "styles", "dbu-ttrpg.css"), "utf8");

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

const DASH = "\u2013";

/** The published entries, as sent. */
const PUBLISHED = {
  simple: [
    "Simple: A simple punch, kick, energy ball, or spell.",
    `${DASH}Foundations: All`,
    `${DASH}Damage Category: Standard`,
    `${DASH}KP Cost: 0`,
    // The 2026-09-29 update, as the user gave it.
    `${DASH}Effect: Reduce the starting TP Cost of a Signature Technique made with this Profile from 8 to 4.`
  ],
  combination: [
    "Combination: A combination of several attacks done in sequence.",
    `${DASH}Foundations: All`,
    `${DASH}Damage Category: Standard`,
    `${DASH}KP Cost: 3(T)`,
    `${DASH}Effect: After you hit an Opponent with this Attacking Maneuver but before you `
      + "roll your Wound Roll, roll your Strike Roll for this Attacking Maneuver against "
      + "the Dice Score of their Dodge Roll or Strike Roll (if they used the Parry option "
      + "of the Defend Maneuver) an additional 3 times. For every additional time your "
      + "Strike Roll exceeds their Dice Score, increase the Wound Roll by an additional 2(T)."
  ],
  launching: [
    "Launching: An attack that sends enemies flying away from you.",
    `${DASH}Foundations: All`,
    `${DASH}Damage Category: Standard`,
    `${DASH}KP Cost: 3(T)`,
    `${DASH}Effect: This Profile has multiple effects:`,
    "* This Attacking Maneuver gains the Knockback Advantage for free (this does not "
      + "increase the KP Cost, or the TP Cost if it is a Signature Technique).",
    "* Double any Collision Damage a Character suffers due to any movement resulting from "
      + "this Attacking Maneuver's use of the Knockback Advantage."
  ],
  megaFlare: [
    "Mega Flare: By focusing as much energy as possible, this attack is highly destructive.",
    `${DASH}Foundations: All`,
    `${DASH}Damage Category: Standard`,
    `${DASH}KP Cost: 4(T)`,
    `${DASH}Effect: This Profile has multiple effects:`,
    "* The maximum number of Energy Charges for this Profile is 10.",
    "* For every Energy Charge applied to this Attacking Maneuver, increase the Wound Roll by 1(T).",
    "* If the number of Energy Charges applied to this Attacking Maneuver is 7+, increase "
      + "the Damage Category by 1 Category."
  ],
  blitz: [
    "Blitz: An attack made as part of a high-speed charge.",
    `${DASH}Damage Category: Standard`,
    `${DASH}KP Cost: 4(T)`,
    `${DASH}Effect: This Profile has multiple effects:`,
    "* This Attacking Maneuver gains the Charging Assault Advantage for free (this does "
      + "not increase the KP Cost, or the TP Cost if it is a Signature Technique).",
    "* If you move a number of Squares that exceeds your Normal Speed due to the effects "
      + "of Charging Assault, increase the Wound Roll of that Attacking Maneuver by 1/2 "
      + "of your Agility Modifier.",
    "* If this Attacking Maneuver is a Signature Technique, reduce the KP Cost by 2(T)."
  ],
  crushing: [
    "Crushing: A heavy strike with the intent to break bones or cause internal damage.",
    `${DASH}Damage Category: Lethal`,
    `${DASH}KP Cost: 6(T)`,
    `${DASH}Effect: Only apply half of your Haste to the Strike Roll for this Attacking Maneuver.`
  ],
  pinpoint: [
    "Pinpoint: Attacks made against pressure points, done through immense skill and precision.",
    `${DASH}Damage Category: Standard`,
    `${DASH}KP Cost: 4(T)`,
    `${DASH}Effect: This Profile has multiple effects:`,
    "* This Attacking Maneuver ignores an amount of the target's Soak Value equal to your "
      + "Insight Modifier.",
    "* If you score a Critical Result on the Strike Roll for this Attacking Maneuver, "
      + "double your Insight Modifier for the duration of this Attacking Maneuver."
  ],
  powered: [
    "Powered: A single, powerful punch or kick charged to the brim with ki.",
    `${DASH}Damage Category: Standard`,
    `${DASH}KP Cost: 8(T)`,
    `${DASH}Effect: This Profile has multiple effects:`,
    "* Apply your Damage Attribute an additional time for this Attacking Maneuver.",
    "* This Attacking Maneuver gains an Energy Charge."
  ],
  soaring: [
    "Soaring: A physical attack that launches a concussive shock wave at a distant opponent.",
    `${DASH}Damage Category: Direct`,
    `${DASH}KP Cost: 5(T)`,
    `${DASH}Effect: This Attacking Maneuver has a Standard Line AoE.`
  ],
  sweeping: [
    "Sweeping: Through a spinning kick, some kind of physical shock wave, or any other "
      + "form of attack, the user strikes at multiple enemies simultaneously.",
    `${DASH}Damage Category: Standard`,
    `${DASH}KP Cost: 4(T)`,
    `${DASH}Effect: This Profile has multiple effects:`,
    "* This Attacking Maneuver has a Minor Sphere AoE (centered on you).",
    "* Allies in this Attacking Maneuver's AoE are not targeted by this Attacking Maneuver.",
    "* If you deal Damage with this Attacking Maneuver, double the amount of Diminishing "
      + "Defense stacks a target would receive from this Attacking Maneuver."
  ]
,
  beam: [
    "Beam: A concentrated beam of energy that has incredible power.",
    `${DASH}Damage Category: Direct`,
    `${DASH}KP Cost: 8(T)`,
    `${DASH}Effect: This Attacking Maneuver gains an Energy Charge that does not count `
      + "towards your maximum number of Energy Charges."
  ],
  blast: [
    "Blast: A cone-shaped wave of energy that can expand.",
    `${DASH}Damage Category: Direct`,
    `${DASH}KP Cost: 5(T)`,
    `${DASH}Effect: This Attacking Maneuver has a Cone AoE.`
  ],
  clearing: [
    "Clearing: A huge surge of energy that strikes a large area.",
    `${DASH}Damage Category: Standard`,
    `${DASH}KP Cost: 6(T)`,
    `${DASH}Effect: This Profile has multiple effects:`,
    "* Target a Square that is not at Long Range. This Attacking Maneuver has a Sphere "
      + "AoE centered on your chosen Square.",
    "* The minimum Natural Result for the Strike Roll for this Attacking Maneuver is 5 "
      + "(if your Natural Result is less than 5, it becomes 5). This is applied after "
      + "rolling and applying any increases to your Natural Result."
  ],
  concentrated: [
    "Concentrated: A further concentrated beam that carries the ability to penetrate "
      + "through all defenses.",
    `${DASH}Damage Category: Lethal`,
    `${DASH}KP Cost: 10(T)`,
    `${DASH}Effect: This Profile has multiple effects:`,
    "* This Attacking Maneuver has a Line AoE.",
    "* Ignore 1/2 of your target's Damage Reduction.",
    "* The AoE for this Attacking Maneuver cannot have a Magnitude larger than Standard, "
      + "nor can it have an AoE applied to it other than the Line AoE."
  ],
  cutting: [
    "Cutting: A disk or small arc of energy focused to possess a cutting edge.",
    `${DASH}Damage Category: Direct`,
    `${DASH}KP Cost: 6(T)`,
    `${DASH}Effect: This Profile has multiple effects:`,
    "* On the Strike Roll for this Attacking Maneuver, if you do not score a Critical "
      + "Result, then you score a Botch Result regardless of the Natural Result.",
    "* On a Critical Result for the Strike Roll of this Attacking Maneuver, increase the "
      + "Damage Category by 1 Category.",
    "* On the Wound Roll for this Attacking Maneuver, the Critical Target is 5 (ignoring "
      + "the usual limit)."
  ],
  wave: [
    "Wave: An attack that strikes down a number of enemies lined up together.",
    `${DASH}Damage Category: Direct`,
    `${DASH}KP Cost: 6(T)`,
    `${DASH}Effect: Target a Square that is not at Long Range. This Attacking Maneuver `
      + "has a Line AoE centered on your chosen Square, pointing in any cardinal "
      + "direction of your choice."
  ],
  elementalDark: [
    "Elemental (Dark): Using the powers of darkness, you launch powerful, demonic spells "
      + "at your opponents. Burn your own life to empower your spell.",
    `${DASH}Damage Category: Standard`,
    `${DASH}KP Cost: 2(T)`,
    `${DASH}Effect: This Profile has multiple effects:`,
    "* When making a Ki Wager for this Attacking Maneuver, you may spend your Life Points "
      + "instead of your Ki Points (reduce your Capacity as if you spent Ki Points as usual).",
    "* Any Squares occupied by Character(s) who take Damage from this Attacking Maneuver "
      + "have their Light Level reduced by 1 Level until the start of your next turn. If "
      + "this Attacking Maneuver has an AoE, then all Squares within the AoE have their "
      + "Light Level reduced by 1 Level instead until the start of your next turn instead.",
    "* If this Attacking Maneuver has the Elemental (Light) Profile applied to it, "
      + "increase the Wound Rolls by 2(T)."
  ],
  glass: [
    "Glass: Your attack is made out of or covered in glass, slicing through your enemies\u2019 defenses.",
    `${DASH}Foundations: All`,
    `${DASH}Damage Category: Standard`,
    `${DASH}KP Cost: 2(T)`,
    `${DASH}Effect: For every 2 Energy Charges applied to this Attacking Maneuver, increase its Wound Roll by 1(T) and its Damage Category by 1 Category (max. +2 Categories).`
  ],
  time: [
    "Time: You slow the flow of time around your opponent.",
    `${DASH}Foundations: All`,
    `${DASH}Damage Category: Standard`,
    `${DASH}KP Cost: 10(T)`,
    `${DASH}Effect: If you deal Damage to an Opponent with this Attacking Maneuver, they gain a stack of the Slowed Combat Condition until the end of your next turn and the Guard Down Combat Condition until the end of this turn.`
  ],
  elementalEarth: [
    "Elemental (Earth): Using the powers of earth, you launch chunks of stone at your "
      + "opponent that batter their defenses.",
    `${DASH}Damage Category: Direct`,
    `${DASH}KP Cost: 4(T)`,
    `${DASH}Effect: This Attacking Maneuver gains the effects of the Bludgeoning Weapon `
      + "Category as if this Attacking Maneuver was made with a Weapon, even if it was "
      + "Unarmed. Apply the effects of the Staggering Quality as if this Attacking "
      + "Maneuver was made with a Weapon, even if it was Unarmed."
  ],
  elementalFire: [
    "Elemental (Fire): Using the powers of fire, you launch plumes of flames at your "
      + "opponent that break down their defenses.",
    `${DASH}Damage Category: Direct`,
    `${DASH}KP Cost: 8(T)`,
    `${DASH}Effect: This Profile has multiple effects:`,
    "* If you knock an Opponent through a Health Threshold, they gain a stack of the "
      + "Broken Combat Condition until the end of your next turn.",
    "* Any Squares occupied by Character(s) who take Damage from this Attacking Maneuver "
      + "become Aflame (see — Environmental Qualities, Battle Environments) until the start "
      + "of your next turn. If this Attacking Maneuver has an AoE, then all Squares within "
      + "the AoE become Aflame until the start of your next turn instead."
  ],
  elementalIce: [
    "Elemental (Ice): Using the power of ice, you create frigid winds of icy projectiles "
      + "to assault your opponents and try to freeze them in place!",
    `${DASH}Damage Category: Direct`,
    `${DASH}KP Cost: 8(T)`,
    `${DASH}Effect: This Profile has multiple effects:`,
    "* If you knock an Opponent through a Health Threshold, they gain a stack of the "
      + "Slowed Combat Condition until the end of your next turn.",
    "* Any Squares occupied by Character(s) who take Damage from this Attacking Maneuver "
      + "become Frozen (see — Environmental Qualities, Battle Environments) until the start "
      + "of your next turn. If this Attacking Maneuver has an AoE, then all Squares within "
      + "the AoE become Frozen until the start of your next turn instead."
  ],
  elementalLight: [
    "Elemental (Light): Using the powers of light, you create constructs or shattered "
      + "fragments of light to assault your foes. The more energy spent, the more lethal "
      + "the spell.",
    `${DASH}Damage Category: Standard`,
    `${DASH}KP Cost: 2(T)`,
    `${DASH}Effect: This Profile has multiple effects:`,
    "* This Attacking Maneuver gains the Full Wager Advantage for free (this does not "
      + "increase the KP Cost, or the TP Cost if it is a Signature Technique).",
    "* Any Squares occupied by Character(s) who take Damage from this Attacking Maneuver "
      + "have their Light Level increased by 1 Level until the start of your next turn. If "
      + "this Attacking Maneuver has an AoE, then all Squares within the AoE have their "
      + "Light Level increased by 1 Level instead until the start of your next turn instead.",
    "* If this Attacking Maneuver has the Elemental (Dark) Profile applied to it, increase "
      + "the Strike Roll by 1(T)."
  ],
  elementalLightning: [
    "Elemental (Lightning): Using the powers of lightning, you electrocute an opponent.",
    `${DASH}Damage Category: Direct`,
    `${DASH}KP Cost: 8(T)`,
    `${DASH}Effect: This Profile has multiple effects:`,
    "* If you knock an Opponent through a Health Threshold, they gain the Impediment "
      + "Combat Condition until the end of your next turn.",
    "* Any Squares occupied by Character(s) who take Damage from this Attacking Maneuver "
      + "become Electrified (see — Environmental Qualities, Battle Environments) until the "
      + "start of your next turn. If this Attacking Maneuver has an AoE, then all Squares "
      + "within the AoE become Electrified until the start of your next turn instead."
  ],
  elementalMetal: [
    "Elemental (Metal): Using the powers of magnetism, you manipulate metal and slam it "
      + "against your enemies to bypass their guard.",
    `${DASH}Damage Category: Lethal`,
    `${DASH}KP Cost: 8(T)`,
    `${DASH}Effect: Any Squares occupied by Character(s) who take Damage from this `
      + "Attacking Maneuver become Metallic (see — Environmental Qualities, Battle "
      + "Environments). If this Attacking Maneuver has an AoE, then all Squares and "
      + "Features within the AoE become Metallic and gain the Dangerous Environment Quality "
      + "or the Sharp Feature Quality respectively. Any Squares or Features that become "
      + "Metallic through this effect have their Hardness Rank increased to 3 if it was lower."
  ],
  elementalPlantlife: [
    "Elemental (Plantlife): Using the powers of nature, you conjure a series of entangling "
      + "vines, trees, or other flora.",
    `${DASH}Damage Category: Standard`,
    `${DASH}KP Cost: 3(T)`,
    `${DASH}Effect: This Profile has multiple effects:`,
    "* This Attacking Maneuver gains the Staggering Attack Advantage for free (this does "
      + "not increase the KP Cost, or the TP Cost if it is a Signature Technique).",
    "* After using this Attacking Maneuver (regardless of if you hit your target(s) or "
      + "deal damage), you may create a Feature occupying an unoccupied Square of your "
      + "choice adjacent to the target(s) of this Attacking Maneuver. This Feature has a "
      + "Hardness Rank of 1 and the Splintering Feature Quality. If this Attacking Maneuver "
      + "possessed an AoE, you may instead fill all of the unoccupied Squares within that "
      + "AoE with Features that possess a Hardness Rank of 1 and the Splintering Feature "
      + "Quality."
  ],
  elementalPoison: [
    "Elemental (Poison): Using the powers of poison, you shoot a stream of potent venom at "
      + "your enemies to weaken them.",
    `${DASH}Damage Category: Direct`,
    `${DASH}KP Cost: 8(T)`,
    `${DASH}Effect: This Profile has multiple effects:`,
    "* If you knock an Opponent through a Health Threshold, they gain the Poisoned Combat "
      + "Condition until the end of your next turn.",
    "* Any Squares occupied by Character(s) who take Damage from this Attacking Maneuver "
      + "become Poisoned (see — Environmental Qualities, Battle Environments) until the "
      + "start of your next turn. If this Attacking Maneuver has an AoE, then all Squares "
      + "within the AoE become Poisoned until the start of your next turn instead."
  ],
  elementalWater: [
    "Elemental (Water): Using the powers of water, you strike with waves of potent water "
      + "to knock them over.",
    `${DASH}Damage Category: Direct`,
    `${DASH}KP Cost: 8(T)`,
    `${DASH}Effect: This Profile has multiple effects:`,
    "* If you knock an Opponent through a Health Threshold, they gain the Prone Combat "
      + "Condition.",
    "* Any Squares occupied by Character(s) who take Damage from this Attacking Maneuver "
      + "become the Bog Environment (see — Battle Environments) until the start of your "
      + "next turn. If this Attacking Maneuver has an AoE, then all Squares within the AoE "
      + "become the Bog Environment until the start of your next turn instead."
  ],
  elementalWind: [
    "Elemental (Wind): Using the powers of the wind, this attack is able to blow away "
      + "opponents with great force.",
    `${DASH}Damage Category: Direct`,
    `${DASH}KP Cost: 4(T)`,
    `${DASH}Effect: This Attacking Maneuver gains the effects of the Slashing Weapon `
      + "Category as if this Attacking Manuever was made with a Weapon, even if it is "
      + "Unarmed."
  ]
};

/** How the system puts an entry back together, mirrored from profileLines. */
function shown(profile) {
  const lines = [];
  for (const piece of String(profile.text ?? "").split("\n")) {
    const trimmed = piece.trim();
    if (!trimmed) continue;
    if (!lines.length || /^[\u2013*]/.test(trimmed)) lines.push(trimmed);
    else lines[lines.length - 1] += ` ${trimmed}`;
  }
  return lines;
}

// --- Word for word --------------------------------------------------------------
for (const [id, published] of Object.entries(PUBLISHED)) {
  check(`${id} says what the rulebook says`, shown(PROFILES[id]), published);
}

// Every Profile in the system has an entry, so none can be added without one.
check("every Profile carries its entry",
  Object.keys(PROFILES).filter(id => !PROFILES[id].text?.trim()), []);
check("and there are as many entries as Profiles",
  Object.keys(PROFILES).length, Object.keys(PUBLISHED).length);

// --- Nothing rewritten is left behind ----------------------------------------------
// The summary line and the bullet list were a rewrite of the above, and two texts for
// one Profile is one text too many - the wrong one is the one that gets read.
check("the paraphrases are gone", /^\s*(summary|rules):/m.test(
  MANEUVERS.slice(MANEUVERS.indexOf("export const PROFILES"),
    MANEUVERS.indexOf("export const FOUNDATION_NOTES"))), false);

// --- The Foundation's own line -----------------------------------------------------
// The rulebook says it once, over the Physical Profiles, rather than on each of them.
check("the Energy rule is said where its group is",
  FOUNDATION_NOTES.energy,
  "Energy Attacks can be made against an Opponent at any distance from you within the "
    + "Battlefield (unless they possess an AoE). You cannot use an Energy Attack if your "
    + "Force Score is below 3.");
check("and no Energy Profile repeats it",
  ["beam", "blast", "clearing", "concentrated", "cutting", "wave"]
    .filter(id => PROFILES[id].text.includes("Force Score")), []);
check("nor carries a Foundations line, the published text having none",
  ["beam", "blast", "clearing", "concentrated", "cutting", "wave"]
    .filter(id => PROFILES[id].text.includes("Foundations:")), []);

// The Magic Profiles are not here yet - they have effects strange enough to need a rule
// of their own explained first - but what the Foundation demands of the attacker stands
// without them, and a Multi-Foundation Profile declared as Magic is bound by it.
check("the Magic rule is said where its group will be",
  FOUNDATION_NOTES.magic,
  "Magic Attacks can be made against an Opponent at any distance from you within the "
    + "Battlefield (unless they possess an AoE). You cannot use a Magic Attack if your "
    + "Magic Score is below 3.");
// The Magic Profiles arrive one at a time, and each is listed here as it does.
check("the Magic Profiles are the ones given so far",
  Object.keys(PROFILES).filter(id =>
    JSON.stringify(PROFILES[id].foundations) === JSON.stringify(["magic"])),
  ["elementalDark", "elementalEarth", "elementalFire", "elementalIce", "elementalLight",
   "elementalLightning", "elementalMetal", "elementalPlantlife", "elementalPoison",
   "elementalWater", "elementalWind"]);

check("the Physical rule is said where the group is",
  FOUNDATION_NOTES.physical,
  "Physical Attacks can only be made against Opponents within your Melee Range, "
    + "unless specified otherwise.");
check("and no Physical Profile repeats it in its own entry",
  ["blitz", "crushing", "pinpoint", "powered", "soaring", "sweeping"]
    .filter(id => PROFILES[id].text.includes("Melee Range")), []);
check("the group header carries it", /<summary\$\{groupTip\(group\)\}>/.test(MANEUVERS), true);
// Once, because both pickers draw their groups through one function now - which is what
// keeps the two from disagreeing about what a group looks like.
check("written once, for both pickers",
  (MANEUVERS.match(/<summary\$\{groupTip\(group\)\}>/g) ?? []).length, 1);
check("and the Energy Charge's picker goes through it - the attack's has a tab per Foundation (the user's, 2026-11-15)",
  (MANEUVERS.match(/return profileSection\(group, items, shut\[group\.key\] \? \{ \.\.\.shut, \[group\.key\]: "" \} : shut\);/g) ?? []).length, 1);

// A Physical Profile's entry has no Foundations line, because the published text has
// none - the section it sits under is what says it.
check("Physical entries carry no Foundations line",
  ["blitz", "crushing", "pinpoint", "powered", "soaring", "sweeping"]
    .filter(id => PROFILES[id].text.includes("Foundations:")), []);
check("and the Multi-Foundation ones all do",
  ["simple", "combination", "launching", "megaFlare"]
    .every(id => PROFILES[id].text.includes(`${DASH}Foundations: All`)), true);

// --- How it is shown -----------------------------------------------------------------
{
  // `data-tooltip` is injected as HTML, so newlines in it are whitespace and the whole
  // entry came out as one run-on paragraph. `data-tooltip-html` is the one that means it.
  check("the entry is shown as HTML", /data-tooltip-html="\$\{Handlebars\.escapeExpression\(/
    .test(MANEUVERS.slice(MANEUVERS.indexOf("function profileTip"))), true);
  check("a line at a time",
    /<div class="dbu-profile-line\$\{bullet \? " dbu-profile-bullet" : ""\}">/.test(MANEUVERS),
    true);
  check("and the styles for it exist",
    [".dbu-profile-tip", ".dbu-profile-line", ".dbu-profile-bullet", ".dbu-profile-note"]
      .every(rule => CSS.includes(rule)), true);

  // What the system leaves to the table is kept apart from the rule rather than mixed
  // into it: it is not part of the text.
  // Anchored on where it lands rather than on the exact call: the builder moved once
  // already, when a Maneuver's hover started asking it too, and an assertion that
  // spells out the call breaks every time it is touched.
  check("the table's share is separated from the rule",
    /const aside = notes[\s\S]{0,80}dbu-profile-note/.test(MANEUVERS), true);
  check("and it lands beneath the entry, not inside it",
    /\$\{body\}\$\{aside\}/.test(MANEUVERS), true);
  check("and nothing pushes a note into the printed lines",
    /printed\.push\(/.test(MANEUVERS), false);
}

// --- Wrapping is ours, the words are theirs ---------------------------------------------
// A wrapped continuation line rejoins the line above; only an en dash or a bullet starts
// a new one. Get that wrong and the entry reads as a list of fragments.
{
  const probe = {
    text: `\n      Thing: a description that\n      wrapped in the file.\n      ${DASH}KP Cost: 3(T)\n      * a bullet that also\n        wrapped.`
  };
  check("a wrapped sentence comes back as one line", shown(probe), [
    "Thing: a description that wrapped in the file.",
    `${DASH}KP Cost: 3(T)`,
    "* a bullet that also wrapped."
  ]);
}

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
