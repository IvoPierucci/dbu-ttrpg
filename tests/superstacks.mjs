/**
 * Super Stacks: three rules pulling in two directions.
 *
 * Muscle Penalty takes off Strike and Dodge, Solid Bulk adds to Soak, and Massive Power
 * adds to the Wound Rolls of Physical and Energy Attacks. Nothing grants a stack yet,
 * which is exactly the condition under which a rule quietly ends up with a Slot nobody
 * reads - so what is checked here is that each of the three is wired to something that
 * will use it the day a stack arrives.
 *
 * The arithmetic is mirrored rather than imported (the data model needs a whole Foundry
 * document to instantiate), and the numbers it mirrors are pinned against the model's
 * own source below, so the two cannot drift apart in silence.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.argv[2];
const MODEL = fs.readFileSync(path.join(ROOT, "module", "data", "actor-character.mjs"), "utf8");
const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
const SLOTS = fs.readFileSync(path.join(ROOT, "module", "effects", "slots.mjs"), "utf8");
const SHEET = fs.readFileSync(path.join(ROOT, "templates", "parts", "actor-combat.hbs"), "utf8");
const GUIDE = fs.readFileSync(path.join(ROOT, "WRITING-EFFECTS.txt"), "utf8");

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

const MAX = 3;
const DIVISOR = 4;

/** What holding `granted` stacks is worth, the way the data model works it out. */
function superStack(granted, { baseTier = 1, force = 0 } = {}) {
  const stacks = Math.min(MAX, Math.max(0, granted));
  const muscleMultiplier = stacks + ((stacks >= MAX) ? 1 : 0);
  const massivePerStack = Math.floor(force / DIVISOR);
  return {
    stacks,
    muscleMultiplier,
    musclePenalty: stacks ? muscleMultiplier * baseTier : 0,
    solidBulk: stacks ? stacks * baseTier : 0,
    massivePower: stacks ? stacks * massivePerStack : 0
  };
}

// --- Max Stacks ---------------------------------------------------------------
// "You can possess up to 3 Super Stacks." One ceiling, applied where they are read.
check("none held is nothing at all", superStack(0, { baseTier: 3, force: 20 }),
  { stacks: 0, muscleMultiplier: 0, musclePenalty: 0, solidBulk: 0, massivePower: 0 });

check("a fourth stack counts for nothing", superStack(4).stacks, MAX);
check("nor does a tenth", superStack(10).stacks, MAX);
check("and it cannot go below none", superStack(-2).stacks, 0);

// The stored field is deliberately uncapped, so a source that granted a fourth can be
// seen to have granted one. The cap lives in one place: where the stacks are read.
check("the stored count is not clamped on the way in",
  /schema\.superStacks = new fields\.NumberField\(\{[^}]*min: 0[^}]*\}\)/.test(MODEL)
    && !/schema\.superStacks = new fields\.NumberField\(\{[^}]*max:/.test(MODEL),
  true);
check("and the cap is applied once, where they are read",
  (MODEL.match(/MAX_SUPER_STACKS/g) ?? []).length >= 2
    && /Math\.min\(DBUCharacterData\.MAX_SUPER_STACKS, superStacks\)/.test(MODEL),
  true);
check("the ceiling itself is three", /static MAX_SUPER_STACKS = 3;/.test(MODEL), true);

// --- Muscle Penalty -----------------------------------------------------------
// "For each Super Stack you possess, reduce your Strike and Dodge Rolls by 1(bT). If you
// possess 3 Super Stacks, increase your Muscle Penalty by an additional 1(bT)."
check("one stack costs 1(bT)", superStack(1, { baseTier: 1 }).musclePenalty, 1);
check("two cost 2(bT)", superStack(2, { baseTier: 1 }).musclePenalty, 2);
check("three cost 4(bT), not 3", superStack(3, { baseTier: 1 }).musclePenalty, 4);

// The extra helping is the third stack's, so it does not arrive early or twice.
check("the multipliers are 1, 2, then 4",
  [0, 1, 2, 3, 4].map(n => superStack(n).muscleMultiplier), [0, 1, 2, 4, 4]);

// (bT), so it bites harder the stronger you are - and a Transformation does not widen it.
check("at Base Tier 3, three stacks cost 12", superStack(3, { baseTier: 3 }).musclePenalty, 12);
check("it is written in (bT) and not (T)",
  /musclePenalty: stacks\s*\?\s*withEffects\(this, "superStack\.musclePenalty", this\.perBaseTier\(muscleMultiplier\)\)/
    .test(MODEL), true);

// --- Solid Bulk ---------------------------------------------------------------
// "For each Super Stack you possess, increase your Soak Value by 1(bT)."
check("each stack is 1(bT) of Soak", superStack(2, { baseTier: 4 }).solidBulk, 8);

// Inside the Slot's base rather than added after it: a multiplier on the Soak Value has
// to reach the whole finished value, which is what Calculation Priority asks.
// Read as the Slot call's own arguments rather than as a line of source: the call grew
// an options object when values started carrying their workings, and a literal match on
// the old one-line form said nothing about where Solid Bulk sits.
const soakCall = MODEL.slice(MODEL.indexOf('withEffects(this, "soakValue", '));
check("Solid Bulk is part of the Soak Value the Slot sees",
  soakCall.slice(0, soakCall.indexOf(",", 30)).includes("ownSoak + this.superStack.solidBulk"),
  true);

// It is read where the Soak Value is built, which is the point - a Slot written and
// never read is the bug this whole check exists against.
// It is read where the Soak Value is built, which is the point - a Slot written and
// never read is the bug this whole check exists against. Counted inside the Soak block
// rather than across the file, since naming it in its own breakdown is a third mention
// that says nothing about who reads it.
// `this.superStack.solidBulk` is the read; the bare name in quotes further up is the
// Slot being declared, which is not a reader of anything.
const soakBlock = soakCall.slice(0, 1400);
const reads = text => (text.match(/this\.superStack\.solidBulk/g) ?? []).length;
check("and the Soak Value is where it is read", reads(soakBlock) >= 1, true);
check("and nothing outside that block reads it",
  reads(MODEL.replace(soakBlock, "")), 0);

// --- Massive Power ------------------------------------------------------------
// "Apply 1/4 of your Force Modifier to the Wound Rolls of your Physical and Energy
// Attacks for each stack of Super Stack." A quarter is what is applied per stack, so
// each quarter rounds down on its own.
check("a Force Modifier of 10 is 2 a stack", superStack(1, { force: 10 }).massivePower, 2);
check("and 6 at three stacks, not 7", superStack(3, { force: 10 }).massivePower, 6);
check("a Force Modifier under 4 is worth nothing", superStack(3, { force: 3 }).massivePower, 0);
check("a Force Modifier of 12 divides evenly", superStack(3, { force: 12 }).massivePower, 9);

check("the quarter is taken before the stacks multiply it",
  /Math\.floor\(\s*atts\.force\.mod \/ DBUCharacterData\.MASSIVE_POWER_DIVISOR\s*\)/.test(MODEL),
  true);

// --- Force, and not the Damage Attribute ---------------------------------------
// The two are the same thing today, since Physical and Energy Attacks both name Force -
// which is what makes this worth a check rather than a comment. An effect that swaps
// which Attribute a Wound Roll is made of does not swap this one: whatever the Wound
// Roll becomes, the Super Stacks keep contributing quarters of Force.
check("Massive Power reads Force outright",
  /atts\.force\.mod \/ DBUCharacterData\.MASSIVE_POWER_DIVISOR/.test(MODEL), true);

// The Powered Profile is the shape this must not drift into: it reads the Foundation's
// Attribute, because applying "your Damage Attribute an additional time" is exactly
// what it does. Massive Power names one Attribute and means it.
check("and not the Attribute the Foundation names",
  /MASSIVE_POWER_DIVISOR/.test(MODEL)
    && !/FOUNDATIONS\[[^\]]*\]\??\.attribute[^;]*MASSIVE_POWER/.test(MODEL), true);
check("the Wound part does not go looking for a Damage Attribute either",
  /function superStackWoundParts[\s\S]{0,1400}?\n\}/.exec(CHAT)?.[0]
    .includes("attribute"), false);

// So the Foundation decides only whether Massive Power applies at all, never what it is
// made of. Those are two separate questions and only one of them reads the attack.
check("the Foundation is asked whether it applies, not what it is worth",
  /MASSIVE_POWER_FOUNDATIONS\.includes\(attack\.foundation\)/.test(CHAT)
    && !/massivePower[^;]*attack\.foundation/.test(CHAT), true);

// Physical and Energy only. The Foundations are named once, in the data model, and the
// card asks that list rather than keeping a second copy of it.
check("the Foundations it reaches are Physical and Energy",
  /MASSIVE_POWER_FOUNDATIONS = Object\.freeze\(\["physical", "energy"\]\)/.test(MODEL), true);
check("and the Wound Roll asks that list rather than its own",
  /DBUCharacterData\.MASSIVE_POWER_FOUNDATIONS\.includes\(attack\.foundation\)/.test(CHAT), true);

/** The gate the Wound part applies, as chat.mjs applies it. */
const reaches = foundation => ["physical", "energy"].includes(foundation);
check("a Magic Attack gets none of it", reaches("magic"), false);
check("a Physical one does", reaches("physical"), true);
check("and an Energy one does", reaches("energy"), true);

// --- Nothing is worth anything without a stack ---------------------------------
// All three are written "for each Super Stack you possess", so with none possessed
// there is nothing there for an effect to increase either.
for (const key of ["musclePenalty", "solidBulk", "massivePower"]) {
  const pattern = new RegExp(`${key}: stacks\\s*\\?\\s*withEffects`);
  check(`${key} is nothing while you hold no stacks`, pattern.test(MODEL), true);
}

// --- Every roll the rule names ---------------------------------------------------
// The Muscle Penalty reaches Strike, Dodge and the Parry that rolls Strike. Missing one
// of the three is the half-a-reader bug: the rule works everywhere except the one place
// nobody thought to look.
{
  const strike = CHAT.indexOf("function strikeParts(attacker, attack) {");
  const dimOffense = CHAT.indexOf('{ label: "Dim. Offense"', strike);
  check("the attacking Strike Roll takes the Muscle Penalty",
    CHAT.slice(strike, dimOffense).includes("musclePenalty(attacker)"), true);

  const dodge = CHAT.indexOf("function dodgeBonus(actor");
  const dodgeEnd = CHAT.indexOf("function thresholdPenalty(actor", dodge);
  check("so does the Dodge Roll",
    CHAT.slice(dodge, dodgeEnd).includes("parts.push(...musclePenalty(actor));"), true);

  const parry = CHAT.indexOf('{ label: "Parry", value: actor.system.combat.parry');
  const parryEnd = CHAT.indexOf('slot: "strike" }', parry);
  check("and so does a Parry, which is a Strike Roll made defensively",
    CHAT.slice(parry, parryEnd).includes("...musclePenalty(actor),"), true);

  // And a Grapple Check, which is one or the other: "a Clash (Strike vs Strike/Dodge)".
  // Asked of the `strike` entry in CLASH_ROLLS, which is the one a Grapple Check is an
  // alias of - this used to slice from the first "  grapple: {" anywhere in the file to
  // the first "prompt:" after it, a window some 2,700 lines wide that would have passed
  // on almost anything inside it.
  const strikeEntry = CHAT.indexOf("  strike: {");
  check("the Grapple Check's rolls are one entry in the table",
    CHAT.includes("CLASH_ROLLS.grapple = CLASH_ROLLS.strike;"), true);
  check("and a Grapple Check, being a Strike or a Dodge Roll",
    CHAT.slice(strikeEntry, CHAT.indexOf("\n  },", strikeEntry))
      .includes("...musclePenalty(actor),"), true);

  // The fifth: the Block Maneuver's Strike, made with a Shield. The sixth: Judo Toss's Strike in place of a Dodge. The
  // seventh: Stardust Barrier's, the same. The eighth: Alternative Warrior Race (4)'s Strike against a hit.
  check("eight rolls take it, and no more than eight",
    (CHAT.match(/\.\.\.musclePenalty\(|musclePenalty\(actor\)\);|: musclePenalty\(attacker\)\)/g) ?? []).length, 8);
}

// Massive Power reaches the attacker's Wound Roll - and not the Power Flare, which
// answers a Wound Roll rather than being one of your attacks.
{
  const wound = CHAT.indexOf("function woundParts(attacker, attack) {");
  const woundEnd = CHAT.indexOf("\n}\n", wound);
  check("the Wound Roll takes Massive Power",
    CHAT.slice(wound, woundEnd).includes("...superStackWoundParts(attacker, attack),"), true);

  const flare = CHAT.indexOf("const counterWound = defence.answersWound");
  const flareEnd = CHAT.indexOf('slot: "wound"', flare);
  check("a Power Flare does not, being a defence rather than an attack",
    CHAT.slice(flare, flareEnd).includes("superStackWoundParts"), false);
}

// --- The Slots exist, and are spelt the same everywhere --------------------------
for (const key of ["superStacks", "superStack.musclePenalty", "superStack.solidBulk",
                   "superStack.massivePower"]) {
  check(`the Slot "${key}" is declared`, SLOTS.includes(`key: "${key}"`), true);
  check(`and something reads it`, MODEL.includes(`"${key}"`) || MODEL.includes(`this.${key}`), true);
  check(`and the guide lists it`, GUIDE.includes(key), true);
}

// --- The sheet -------------------------------------------------------------------
// The stored count is what is edited; the capped one is what is shown, so a character
// holding a granted fourth is displayed as the 3 that everything else is using.
// A row of the Resources list since the Combat tab's new layout (the user's), stepped there.
const SHEET_JS = fs.readFileSync(path.join(ROOT, "module", "sheets", "actor-character-sheet.mjs"), "utf8");
check("the sheet edits the stored count",
  SHEET_JS.includes('"system.superStacks": Math.max(0, Math.min(DBUCharacterData.MAX_SUPER_STACKS,')
    && /data-action="stepResource"\s+data-resource="\{\{row\.key\}\}"/.test(SHEET), true);
// A box in the Turn State now (the user's), not a Resources row: the capped count, what it costs and buys, its sources on hover.
check("and displays the capped one, in the Turn State",
  SHEET_JS.includes("stacks: held.stacks ?? 0, max: held.max ?? DBUCharacterData.MAX_SUPER_STACKS,")
    && SHEET.includes('<div class="stat stat-super" data-tooltip-html="{{superStackBox.tip}}">'), true);
check("with what holding them is costing and granting beside it, and where they come from on hover",
  ["held.musclePenalty", "held.solidBulk", "held.massivePower", "Given by: ", "Gained in play or set by hand: "]
    .every(key => SHEET_JS.includes(key)) && SHEET.includes("{{superStackBox.note}}"), true);

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
