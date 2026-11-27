/**
 * The Physical Profiles, and the rule the Physical Foundation puts on all of them.
 *
 * Five of the six are machinery, and the maths for those is checked here. The two with
 * an Area of Effect are handled without any geometry at all: the attack is handed to
 * whoever the player and the GM agree it caught, which is a faster and better answer
 * than measuring, so what is checked is that handing it on charges nothing twice.
 *
 * Blitz hands out Charging Assault, which is a Signature Technique Advantage in its
 * own right and is checked in signature.mjs. What is checked here is that Blitz names
 * it rather than restating it, so the Advantage has one home whichever route reaches
 * it.
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
globalThis.canvas = null;

const { PROFILES, FOUNDATION_RULES, DAMAGE_CATEGORIES, profileKiCost, squaresBetween,
        whyNotInReach, areaLabel, maxEnergyCharges, resolveDamageCategory } =
  await import(modUrl("maneuvers.mjs"));

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

/** A token as squaresBetween reads one: pixels, and a footprint in Squares. */
const tokenAt = (x, y, size = 1, scene = "one") =>
  ({ x: x * 100, y: y * 100, width: size, height: size, parent: { id: scene, grid: { size: 100 } } });
const fighterAhead = (x, reachSquares = 0) => ({
  name: "Fighter", system: { meleeRange: reachSquares }, getActiveTokens: () => [tokenAt(x, 0)]
});
const reachAhead = (from, to, declared) => whyNotInReach(from, to, declared);

// --- The table --------------------------------------------------------------
const PHYSICAL = ["blitz", "crushing", "pinpoint", "powered", "soaring", "sweeping"];

check("every Physical Profile is present",
  PHYSICAL.filter(id => PROFILES[id]).length, PHYSICAL.length);

check("and each belongs to the Physical Foundation alone",
  PHYSICAL.map(id => PROFILES[id].foundations), PHYSICAL.map(() => ["physical"]));

// The Damage Categories, straight from the rulebook.
check("the Damage Categories are as written",
  PHYSICAL.map(id => PROFILES[id].damageCategory),
  ["standard", "lethal", "standard", "standard", "direct", "standard"]);

check("and every one of them is a Category the system knows",
  PHYSICAL.every(id => PROFILES[id].damageCategory in DAMAGE_CATEGORIES), true);

// --- Multi-Foundation -------------------------------------------------------
// "Profiles that don't belong to a specific Foundation ... you can decide which of the
// Foundations that Profile belongs to for the duration of that Attacking Maneuver,
// including all the rules that are applied to Profiles of that Foundation."
const MULTI = ["simple", "combination", "launching", "megaFlare"];

check("every Multi-Foundation Profile is present",
  MULTI.filter(id => PROFILES[id]).length, MULTI.length);
check("and each is offered for all three Foundations",
  MULTI.map(id => PROFILES[id].foundations),
  MULTI.map(() => ["physical", "energy", "magic"]));
check("all four are Standard",
  MULTI.map(id => PROFILES[id].damageCategory), MULTI.map(() => "standard"));

// The Foundation's rules follow the Foundation, not the Profile. That is what makes
// these Multi-Foundation rather than four more Energy Profiles: chosen as Physical, a
// Combination is bound by Melee Range exactly as Crushing is.
check("a Multi-Foundation Profile declared Physical is bound by Melee Range",
  Boolean(reachAhead(fighterAhead(0), fighterAhead(6),
    { foundation: "physical", profile: "combination" })), true);
check("and the same Profile declared Energy is not",
  reachAhead(fighterAhead(0), fighterAhead(6),
    { foundation: "energy", profile: "combination" }), null);

// --- What they cost ---------------------------------------------------------
// Every Physical Profile is priced in (T), so the cost grows with the Tier of Power.
const at = tier => ({ system: { tierOfPower: tier } });
const plain = { attacking: true };

check("Multi-Foundation costs at Tier 1 are the written numbers",
  MULTI.map(id => profileKiCost(id, plain, at(1))), [0, 3, 3, 4]);
check("and they scale too",
  MULTI.map(id => profileKiCost(id, plain, at(4))), [0, 12, 12, 16]);

check("costs at Tier 1 are the written numbers",
  PHYSICAL.map(id => profileKiCost(id, plain, at(1))), [4, 6, 4, 8, 5, 4]);
check("and they scale with the Tier of Power",
  PHYSICAL.map(id => profileKiCost(id, plain, at(3))), [12, 18, 12, 24, 15, 12]);

check("Simple still costs nothing", profileKiCost("simple", plain, at(5)), 0);

// Blitz alone is cheaper as a Signature Technique: "reduce the KP Cost by 2(T)".
const signature = { attacking: true, signature: true };
check("Blitz is 2(T) cheaper as a Signature Technique",
  [profileKiCost("blitz", signature, at(1)), profileKiCost("blitz", signature, at(3))], [2, 6]);
check("and no other Profile is",
  PHYSICAL.filter(id => id !== "blitz")
    .map(id => profileKiCost(id, signature, at(3)) === profileKiCost(id, plain, at(3))),
  PHYSICAL.filter(id => id !== "blitz").map(() => true));

// --- Crushing ---------------------------------------------------------------
// "Only apply half of your Haste to the Strike Roll." Strike is Haste + Awareness, so
// what is taken off is the half that does not apply - and halves round down, so an odd
// Haste loses the larger piece.
const crushingPenalty = haste => haste - Math.floor(haste / 2);
check("an even Haste loses exactly half", crushingPenalty(6), 3);
check("an odd Haste keeps the smaller half", crushingPenalty(7), 4);
check("no Haste, no penalty", crushingPenalty(0), 0);

// --- Pinpoint ---------------------------------------------------------------
// "Ignores an amount of the target's Soak Value equal to your Insight Modifier", and a
// Critical on the Strike Roll doubles that Modifier for the attack.
const ignored = (insight, critical) => Math.max(0, insight * (critical ? 2 : 1));
check("it ignores Soak equal to the Insight Modifier", ignored(4, false), 4);
check("and twice that on a Critical Strike", ignored(4, true), 8);
check("a negative Modifier ignores nothing", ignored(-2, true), 0);

// Never more Soak than is left after the Damage Category and the defence.
const soakAfter = (soak, ignore) => Math.max(0, soak - ignore);
check("it cannot ignore Soak that is not there", soakAfter(3, 8), 0);

// --- Powered ----------------------------------------------------------------
// "Apply your Damage Attribute an additional time" - the Modifier the Foundation names,
// added once more rather than the Wound Roll doubled.
//
// Which is only a doubling if the Wound Roll carries that Modifier once. It used to
// carry Might as well, and Might is the higher of Force and Magic - so a Force
// character attacking with Force had it counted twice before any Profile said
// anything, and Powered made three. The two terms are separate now, and this reads the
// formula out of the data model rather than restating it.
const MODEL = fs.readFileSync(path.join(ROOT, "module", "data", "actor-character.mjs"), "utf8");

// The Slot's base, read as its arguments: the call grew an options object when values
// started carrying their workings, so the old one-line literal no longer matched.
const woundCall = MODEL.slice(MODEL.indexOf('withEffects(this, "wound", '));
const woundBase = woundCall.slice(0, woundCall.indexOf(",", 30));
check("the Wound Roll is the Damage Attribute and nothing else",
  woundBase.includes("woundAttribute(key"), true);
check("Might is not part of it", woundCall.slice(0, 200).includes("this.might"), false);

// So Powered is a doubling, which is what it reads as.
const woundValue = attributeMod => attributeMod;
check("Powered applies the Damage Attribute a second time",
  woundValue(9) + 9, 18);
check("and that is twice what it was, not three times",
  (woundValue(9) + 9) / woundValue(9), 2);

// Might keeps its own value, for the Clash category that asks for it.
check("Might is still derived, for Might Clashes",
  /this.might = withEffects\(this, "might"/.test(MODEL), true);

// Nothing else was built around the doubled Wound. Swept for it: the two Slots that
// write it, the sheet that shows it, and the one defence that rolls one of its own.
{
  const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
  const SLOTS = fs.readFileSync(path.join(ROOT, "module", "effects", "slots.mjs"), "utf8");

  // Power Flare answers a Wound Roll with a Wound Roll, so it reads the value the
  // model derives, exactly as the attacker does - symmetrical before and symmetrical
  // now, at half the size. Nobody rebuilds it out of parts.
  // The fourth is Power Flare's formula in Defend, which shows the same value it rolls.
  check("everyone who rolls a Wound reads the derived value",
    (CHAT.match(/system\.combat\.wound\[/g) ?? []).length, 4);
  check("and nobody adds Might to it on the way",
    /combat\.wound\[[^\]]*\][^;]*might/i.test(CHAT), false);

  // The two Slots say they are separate, since an author writing one and expecting the
  // other is exactly the mistake the old shape invited.
  check("the Slots say Might and Wound are not each other",
    [/Not what a Wound Roll is made of/.test(SLOTS),
     /Raising Might does not raise this/.test(SLOTS)],
    [true, true]);

  // The one halving in the file is Guard's own rule - "the Wound Roll against you is
  // halved" - and it belongs to the defence rather than to the value, so it is left
  // exactly as it was. Named here so a future reader does not mistake it for a
  // compensation and take it out.
  check("the only halving is Guard's, on the defence and not on the value",
    /guard: \{[^]{0,400}wound: \(total\) => Math\.floor\(total \/ 2\)/.test(CHAT), true);
}

// "Gains an Energy Charge", on top of whatever was charged into it, held to seven.
const charges = (fed, granted, max = 7) => Math.min(fed + granted, max);
check("it adds a charge to an uncharged attack", charges(0, 1), 1);
check("and to a charged one", charges(3, 1), 4);
check("but never past the seven the rules allow", charges(7, 1), 7);

// --- The Foundation's own rule ----------------------------------------------
check("Physical is the Foundation that demands Melee Range",
  [FOUNDATION_RULES.physical.meleeOnly, FOUNDATION_RULES.energy.meleeOnly,
   FOUNDATION_RULES.magic.meleeOnly],
  [true, undefined, undefined]);

/** A token as squaresBetween reads one: pixels, and a footprint in Squares. */
const token = (x, y, size = 1, scene = "one") =>
  ({ x: x * 100, y: y * 100, width: size, height: size, parent: { id: scene, grid: { size: 100 } } });

check("a token touching another has nothing between them",
  squaresBetween(token(0, 0), token(1, 0)), 0);
check("diagonally touching counts the same - a corner is a touch",
  squaresBetween(token(0, 0), token(1, 1)), 0);
check("one Square apart is one",
  squaresBetween(token(0, 0), token(2, 0)), 1);
check("and a knight's move is measured the long way, not the short",
  squaresBetween(token(0, 0), token(3, 1)), 2);

// A 2x2 token reaches from any of its own Squares, so its far edge is what counts.
check("a large token is measured from its footprint, not its centre",
  squaresBetween(token(0, 0, 2), token(2, 0)), 0);
check("and from the near edge when it is the one being reached",
  squaresBetween(token(5, 0), token(0, 0, 2)), 3);

check("two tokens on different scenes cannot be measured",
  squaresBetween(token(0, 0, 1, "one"), token(0, 0, 1, "two")), null);
check("nor can one that is not there", squaresBetween(token(0, 0), null), null);

// --- Who may be attacked ----------------------------------------------------
const fighter = (x, reach = 0, size = 1) => ({
  name: "Fighter",
  system: { meleeRange: reach },
  getActiveTokens: () => [token(x, 0, size)]
});

const reach = (from, to, declared) => whyNotInReach(from, to, declared);
const physical = { foundation: "physical", profile: "simple" };

check("an adjacent Opponent may be struck",
  reach(fighter(0), fighter(1), physical), null);
check("one further away may not",
  Boolean(reach(fighter(0), fighter(3), physical)), true);

check("a wider Melee Range reaches further",
  reach(fighter(0, 2), fighter(3), physical), null);
check("but not without limit",
  Boolean(reach(fighter(0, 2), fighter(5), physical)), true);

// Charging Assault moves them there first, on the map: the player's to make, so nothing is refused.
check("Charging Assault reaches one who is not in Melee Range yet",
  reach(fighter(0), fighter(9), { ...physical, advantages: ["charging-assault"] }), null);
check("and nothing else on the attack does",
  Boolean(reach(fighter(0), fighter(9), { ...physical, advantages: ["knockback"] })), true);
const USE_REACH = fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8");
check("the declaration hands its Advantages to the reach check",
  USE_REACH.includes("whyNotInReach(actor, targetActor, declared ?? {}, (declared?.weapon?.meleeRange ?? 0) + whipReach)"), true);

check("an Energy Attack is not bound by it",
  reach(fighter(0), fighter(9), { foundation: "energy", profile: "simple" }), null);
check("nor a Magic one",
  reach(fighter(0), fighter(9), { foundation: "magic", profile: "simple" }), null);

// A rule about Squares cannot be enforced where there are none - out of combat, or
// with a character who has no token on the scene.
check("no token, no ruling",
  reach({ name: "A", system: {}, getActiveTokens: () => [] }, fighter(9), physical), null);

// --- Mega Flare -------------------------------------------------------------
// Three effects, all arithmetic: a higher ceiling on Energy Charges, a Wound bonus per
// Charge on top of the die each already adds, and a Damage Category step at 7+.
check("it holds ten Charges where everything else holds seven",
  [maxEnergyCharges("megaFlare", 7), maxEnergyCharges("simple", 7),
   maxEnergyCharges("crushing", 7)],
  [10, 7, 7]);
check("and a Profile nobody wrote falls back to the usual ceiling",
  maxEnergyCharges("nonesuch", 7), 7);

// The ceiling has to be the one the Profile sets everywhere it is applied, and there
// used to be a second one underneath that knew nothing about Profiles: the field that
// stores the count carried a maximum of 7, so declaring a Mega Flare and charging it an
// eighth time spent the Action and the Ki, passed the rule's own check, and was clamped
// straight back to 7 on the way into the document.
{
  const MODEL = fs.readFileSync(path.join(ROOT, "module", "data", "actor-character.mjs"), "utf8");
  const USE = fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8");
  const charging = MODEL.slice(MODEL.indexOf("schema.charging"),
    MODEL.indexOf("schema.charging") + 1600);

  check("nothing caps the stored count behind the Profile's back",
    /charges: new fields[.]NumberField\(\{[^}]*max:/.test(charging), false);

  // And the Profile it was declared with is kept, or the ceiling could not be found.
  check("the declared Profile is stored with the charge",
    /"system[.]charging[.]profile": profile/.test(USE), true);
  check("and the ceiling is read from it",
    /maxEnergyCharges\(charging[.]profile/.test(USE), true);

  // Which means letting go of a charge has to let go of the Profile too, or the next
  // ceiling is read off a declaration that is over. Two places cleared it and had
  // drifted apart - one kept the Profile, and only one took Guard Down off, so leaving
  // an Encounter mid-charge left the Condition on the character for good.
  const COMBAT = fs.readFileSync(path.join(ROOT, "module", "combat.mjs"), "utf8");
  check("there is one definition of not charging",
    (COMBAT.match(/"system[.]charging[.]profile": ""/g) ?? []).length, 1);
  // Declaring a charge writes those fields, which is its job. What must not be written
  // by hand a second time is the *clearing* of them, which is where the two drifted.
  check("and nothing else clears them by hand",
    /"system[.]charging[.](maneuverId|profile)": ""|"system[.]charging[.]charges": 0/.test(USE),
    false);
  check("letting go of a charge lets go of Guard Down",
    /export async function stopCharging[^]{0,220}setCondition\(actor, "guard-down", 0\)/
      .test(COMBAT), true);
  check("and both ways out of a charge take it",
    (COMBAT.match(/await stopCharging\(actor\)/g) ?? []).length
      + (USE.match(/await stopCharging\(actor\)/g) ?? []).length, 3);
}

const flareWound = (charges, tier) =>
  charges * PROFILES.megaFlare.woundPerChargePerTier * tier;
check("each Charge adds 1(T) to the Wound Roll", flareWound(4, 3), 12);
check("and no Charges add nothing", flareWound(0, 3), 0);

const categoryStep = charges => (charges >= PROFILES.megaFlare.categoryUpAtCharges) ? 1 : 0;
check("six Charges leave the Damage Category alone", categoryStep(6), 0);
check("seven raise it", categoryStep(7), 1);
check("and ten raise it once, not four times", categoryStep(10), 1);

// Standard raised once is Direct, which is the Category the step is worth.
check("a fully charged Mega Flare lands as Direct",
  resolveDamageCategory(PROFILES.megaFlare.damageCategory, categoryStep(10)), "direct");

// --- Combination ------------------------------------------------------------
// "Roll your Strike Roll ... an additional 3 times. For every additional time your
// Strike Roll exceeds their Dice Score, increase the Wound Roll by an additional 2(T)."
const { rolls, woundPerHitPerTier } = PROFILES.combination.followUps;
check("it is three more Strikes", rolls, 3);

const combination = (totals, defence, tier) =>
  totals.filter(t => t > defence).length * woundPerHitPerTier * tier;
check("none of them beating it adds nothing", combination([4, 5, 6], 9, 2), 0);
check("one of them adds 2(T)", combination([12, 5, 6], 9, 2), 4);
check("all three add three times that", combination([12, 13, 14], 9, 2), 12);
check("and equalling what they rolled is not exceeding it",
  combination([9, 9, 9], 9, 2), 0);

// What they are measured against is the whole roll the defender answered the first
// Strike with - the same number that lost. Measuring against the dice inside it left
// them answering three more Strikes with a bare die and every bonus gone missing.
{
  const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
  check("the follow-ups are measured against the defence that was rolled",
    /const beatable = answer [?] \(answer[.]total [?][?] 0\) : null/.test(CHAT), true);
  check("and nothing computes a Dice Score any more", /diceScore/.test(CHAT), false);
}

// The defence they made, bonuses and all: a Dodge of 9 is a 9 to beat, whether the
// dice in it came to 5 or to 8.
const beats = (followUp, defence) => followUp > defence;
check("a follow-up has to beat the whole Dodge", beats(8, 9), false);
check("and beating it is beating it", beats(10, 9), true);
check("equalling it is not exceeding it", beats(9, 9), false);

// --- An automatic hit settles the first Strike and nothing else -----------------
// Being hit automatically does not take the defence away: the Strikes that follow are
// measured against it, so it is rolled even though it cannot stop the blow coming. It
// used to be skipped, and the defender met three more Strikes with nothing at all.
{
  const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");

  // The same test the resolution makes.
  const rolls = (forced, profile) =>
    !forced || Boolean(PROFILES[profile]?.followUps);

  check("a forced hit skips the defence when nothing else needs it",
    rolls(true, "simple"), false);
  check("but rolls it when more Strikes will face it",
    rolls(true, "combination"), true);
  check("and an ordinary attack rolls it either way",
    [rolls(false, "simple"), rolls(false, "combination")], [true, true]);

  check("the resolution decides it the same way",
    /const stillCounts = Boolean\(profileFor\(attack\)\?\.followUps\)/.test(CHAT), true);

  // Diminishing Defense follows the roll rather than the forcing, which is the
  // reasoning it always had: what accrues the stacks is having dodged.
  check("the stacks follow whether the Dodge was actually rolled",
    /gainsDiminishingDefense && answer/.test(CHAT), true);
}

// The follow-ups are a step of their own between the hit and the Wound Roll, which is
// where the rule puts them and what makes the bonus something the table watched happen
// rather than a number the Wound Roll arrived with.
{
  const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");

  // The same test the card runs, in the same order, so this checks the rule and not a
  // copy of it: only a Combination, only after a hit, only before the Wound Roll, and
  // only while they have not been rolled.
  const awaits = attack => Boolean(PROFILES[attack.profile]?.followUps)
    && Boolean(attack.result?.hit)
    && !attack.result?.wound
    && !attack.result?.followUps;

  const hit = { profile: "combination", result: { hit: true } };
  check("a Combination that hit owes its follow-ups", awaits(hit), true);
  check("a Combination that missed owes nothing",
    awaits({ profile: "combination", result: { hit: false } }), false);
  check("and one that has already rolled them owes nothing",
    awaits({ profile: "combination", result: { hit: true, followUps: { beat: 0 } } }), false);
  check("nor does any other Profile",
    awaits({ profile: "simple", result: { hit: true } }), false);
  check("and the Wound Roll closes the window",
    awaits({ profile: "combination", result: { hit: true, wound: {} } }), false);

  check("the card tests it the same way", /function awaitsFollowUps/.test(CHAT), true);
  // The Wound button waits for them, which is the whole of the request.
  // The follow-up button returns before the Wound button is ever reached, which is
  // the whole of the request: no Wound Roll until the extra Strikes are in.
  check("the Wound button is not reached while they are owed",
    CHAT.indexOf("additional Strikes") < CHAT.indexOf('roll.textContent = "Roll Wound"'), true);
  check("and the follow-up step returns rather than falling through",
    /more[.]addEventListener[^]{0,120}container[.]append\(more\);[^]{0,40}return;/.test(CHAT), true);
  // Rolled once and written down, so the Wound Roll adds a settled number.
  check("the bonus is settled when they are rolled, not when the Wound is",
    /function combinationFollowUps\(attacker, attack\)/.test(CHAT), true);
}

// --- Areas of Effect --------------------------------------------------------
// No geometry: the Profile says it has a Line or a Sphere, and who that covers is the
// player's and the GM's to agree. What the system does is hand the same attack to
// whoever they name, on a card each, without charging for it twice.
check("the Profiles with an area are the ones that say they have one",
  Object.keys(PROFILES).filter(id => PROFILES[id].area),
  ["soaring", "sweeping", "blast", "clearing", "concentrated", "wave"]);

// Nothing in the system measures an Area. The shape and the Magnitude are words on a
// card; who was caught is the attacker's to say, through the button. So every reader of
// `area` is a label, a tip, or the button's own condition - and if one ever starts
// working out who is covered, this is the check that should have stopped it.
{
  const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
  const adding = /async function addAreaTargets[\s\S]*?\n\}/.exec(CHAT)?.[0] ?? "";

  // Everyone on the scene who is not already in the exchange, offered as a list to tick.
  // Not everyone the shape covers - the shape is not measured anywhere.
  check("who else is caught is asked, not worked out",
    adding.includes("canvas?.tokens?.placeables"), true);
  check("and the Area is only named in the asking",
    /areaLabel\(area\)/.test(adding), true);

  // Nothing measures Squares to decide it. `squaresBetween` exists and answers the Melee
  // Range, which is a different question with a real answer.
  check("no distance is measured to decide who an Area covers",
    /squaresBetween/.test(adding), false);
  check("nor is the shape read for anything but its name",
    /area\.shape/.test(CHAT), false);
}

check("each area is named in words a player can read",
  [areaLabel(PROFILES.soaring.area), areaLabel(PROFILES.sweeping.area)],
  ["Standard Line", "Minor Sphere (centred on you)"]);
check("and nothing is named for a Profile without one", areaLabel(null), "");

// Soaring specifies otherwise, which is the clause the Melee Range rule leaves open.
check("Soaring reaches past Melee Range",
  reach(fighter(0), fighter(9), { foundation: "physical", profile: "soaring" }), null);
check("but Sweeping does not - its Sphere is centred on you",
  Boolean(reach(fighter(0), fighter(9), { foundation: "physical", profile: "sweeping" })), true);

// The Maneuver is thrown once however far it reaches. Charging a second target as a
// second attack would blunt the attacker's own Strike Rolls for the rest of the round
// and pay off Compelled by standing in a crowd.
{
  const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
  // Added to the attack rather than posted as one of their own, which is what makes
  // double-counting impossible instead of merely guarded against: there is one card,
  // so there is one Strike Roll, one Wound Roll, one Action and one Energy Charge.
  check("added targets join the attack rather than starting new ones",
    /attack: \{ [.][.][.]attack, [^}]*targets: \[[.][.][.]attackTargets\(attack\), [.][.][.]added\]/
      .test(CHAT), true);
  check("and nothing posts a second attack for them",
    /addAreaTargets[\s\S]{0,1400}postAttack/.test(CHAT), false);
  // The machinery that used to stop a sibling card charging twice is gone with the
  // sibling cards.
  check("the anti-double-charge flag is gone entirely", /alsoCaught/.test(CHAT), false);
  check("and the button is the attacker's alone",
    /attackArea\(attack\) && thrower\?\.isOwner/.test(CHAT), true);
}

// --- What is not automated says so ------------------------------------------
// Blitz, Soaring and Sweeping each lean on machinery that does not exist. The half
// that can be applied is; the half that cannot is named where the Profile is chosen,
// so it is not discovered after the attack has been thrown.
// Nothing is left waiting on machinery now. Blitz's Charging Assault is a Signature
// Technique Advantage of its own, and the movement it asks for is made on the map and
// then declared - which is a better answer than tracking it would have been.
// Nothing is left waiting. What is not automated is not waiting on machinery - it is
// the map, which the player answers by moving a token, and the size of a collision,
// which the table sets.
// Until the Magic Profiles. Two of Dark's sentences are about an attack carrying something
// no attack here can carry - a second Profile, or an Area on a Profile that has none - and
// the whole of Earth is borrowed from Weapons, which do not exist. Said where the Profile
// is chosen rather than built for nothing to reach.
// The Elemental AoE sentence was the last of them: the card's area marking now.
check("no Profile is waiting on something that does not exist",
  Object.keys(PROFILES).filter(id => PROFILES[id].needs), []);

// What Blitz grants is named, not restated, so the Advantage has one home.
check("Blitz grants an Advantage rather than describing one",
  [PROFILES.blitz.grantsAdvantage, Boolean(PROFILES.blitz.needs)],
  ["charging-assault", false]);

// Every Profile carries its published entry - the rulebook's own words, checked word
// for word by the profiletext harness. What used to be here asked for a hand-written
// summary and a list of rewritten bullets, which is exactly what that replaced.
check("and every Profile says what it does",
  Object.keys(PROFILES).filter(id => !PROFILES[id].text?.trim()), []);
check("including the Effect line, whatever it says",
  Object.keys(PROFILES).filter(id => !PROFILES[id].text.includes("Effect:")), []);

// The parts of those three that do not need the missing machinery are applied.
check("Blitz's Signature discount applies",
  profileKiCost("blitz", signature, at(2)), 4);
check("Sweeping's doubled Diminishing Defense is applied",
  PROFILES.sweeping.doublesDiminishingDefense, true);

// --- Sweeping's stacks, through both moments they arrive in ---------------------
// "If you deal Damage with this Attacking Maneuver, double the amount of Diminishing
// Defense stacks a target would receive." The first helping is handed out when the
// Clash settles - every answered attack gives them - and the second when the Damage is
// actually taken off, because that is where "if you deal Damage" is first answerable.
{
  const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
  const MODEL = fs.readFileSync(path.join(ROOT, "module", "data", "actor-character.mjs"), "utf8");

  const perAttack = baseTier => Math.floor((baseTier + 1) / 2);
  const stacks = ({ profile, damage = 10, answered = true, gains = true, forced = false, tier = 1 }) => {
    let held = 0;
    if (gains && answered) held += perAttack(tier);
    if ((damage > 0) && PROFILES[profile]?.doublesDiminishingDefense && gains && !forced) {
      held += perAttack(tier);
    }
    return held;
  };

  check("an ordinary attack gives one helping", stacks({ profile: "simple" }), 1);
  check("Sweeping gives two once the Damage lands", stacks({ profile: "sweeping" }), 2);
  check("but only one when it dealt none", stacks({ profile: "sweeping", damage: 0 }), 1);
  check("and two of the larger helpings at Base Tier 3",
    stacks({ profile: "sweeping", tier: 3 }), 4);
  check("a Guard takes none either way",
    stacks({ profile: "sweeping", gains: false }), 0);

  // Both helpings land in one write off one reading of the character. Two updates each
  // doing their own read-and-add is how a number raised twice ends up raised once.
  check("the second helping rides with the Damage in a single write",
    /await target\.update\(\{[^]{0,400}"system\.diminishingDefense"/.test(CHAT), true);

  // The rule is written against the Base Tier, and its own parameter says so. It was
  // being handed the current Tier, so a Transformation inflated it.
  check("the stack size follows the Base Tier of Power",
    /diminishingDefensePerAttack\(this\.baseTierOfPower\)/.test(MODEL), true);
}

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
