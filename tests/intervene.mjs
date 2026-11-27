/**
 * The Intervene Maneuver.
 *
 * The first Counter Maneuver that can be played without being the target, which is the
 * whole difficulty: every window in the exchange was written around the two people in
 * it, and this one opens for a third who may not be on the card at all.
 *
 * What is checked here is the arithmetic of taking a Wound Roll in somebody else's
 * place - including the halving that rounds *up*, the only one in the system that does -
 * and the three rules that are easy to get almost right: one Intervene per Ally, a won
 * Deflect ending it for everybody rather than for the Ally alone, and somebody who
 * the attack having to be one that was not aimed at the person stepping in.
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

const { INTERVENE_OPTIONS, interveneOptionCost, whyNotIntervene } =
  await import(modUrl("maneuvers.mjs"));

const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
const MANEUVERS = fs.readFileSync(path.join(ROOT, "module", "maneuvers.mjs"), "utf8");
const SLOTS = fs.readFileSync(path.join(ROOT, "module", "effects", "slots.mjs"), "utf8");
const TRAIT = fs.readFileSync(path.join(ROOT, "traits", "maneuvers", "intervene.dbu"), "utf8");
const INDEX = JSON.parse(fs.readFileSync(path.join(ROOT, "traits", "index.json"), "utf8"));

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

const fighter = (name, extra = {}) => ({
  uuid: `Actor.${name}`,
  name,
  system: {
    baseTierOfPower: 3, tierOfPower: 3,
    soakValue: 10, damageReduction: 0, might: 12,
    life: { value: 40, max: 60 },
    speed: { boosted: 8 },
    effects: { slots: {} },
    ...extra
  }
});

// --- The Maneuver itself -----------------------------------------------------------
check("it is a Counter Maneuver", /type: counter/.test(TRAIT), true);
check("costing one Counter Action", /actionCost: 1/.test(TRAIT), true);
check("and it is listed", INDEX.traits.includes("maneuvers/intervene.dbu"), true);
check("and marked as one that steps in", /intervene: true/.test(TRAIT), true);

// --- What each effect costs ----------------------------------------------------------
{
  const goku = fighter("Goku");

  check("Defense Wall is free", interveneOptionCost("defenseWall", goku), 0);
  check("Deflect is 2(bT)", interveneOptionCost("deflect", goku), 6);
  check("Distant Deflect is 8(bT)", interveneOptionCost("distantDeflect", goku), 24);

  // (bT), so a Transformation does not make stepping in dearer.
  const transformed = fighter("Goku", { baseTierOfPower: 2, tierOfPower: 5 });
  check("and the cost follows the Base Tier, not the current one",
    interveneOptionCost("distantDeflect", transformed), 16);

  // The Slot names the option, so cheapening one cannot cheapen another.
  const discounted = fighter("Goku", {
    effects: { slots: { "intervene.deflect.kiCost": {
      add: -4, multiply: 1, set: null, min: null, max: null, clamp: null } } }
  });
  check("an effect can cheapen one option", interveneOptionCost("deflect", discounted), 2);
  check("and only that one", interveneOptionCost("distantDeflect", discounted), 24);
  check("and never below nothing",
    interveneOptionCost("defenseWall", discounted), 0);

  check("the Slot is a patterned one", /\^intervene\\\.\(\\w\+\)\\\.kiCost\$/.test(SLOTS), true);
}

// --- One Intervene per Ally ------------------------------------------------------------
// "If you use the Intervene Maneuver, no other Character can use the Intervene Maneuver
// for your selected Ally against that Attacking Maneuver."
{
  const krillin = fighter("Krillin");
  const yamcha = fighter("Yamcha");
  const gohan = fighter("Gohan");
  const piccolo = fighter("Piccolo");

  check("nothing is in the way to begin with",
    whyNotIntervene(krillin, gohan.uuid, {}), null);

  const taken = [{ uuid: yamcha.uuid, name: "Yamcha", allyUuid: gohan.uuid }];
  check("but a second for the same Ally is refused",
    Boolean(whyNotIntervene(krillin, gohan.uuid, { interventions: taken })), true);
  check("and it says who got there first",
    whyNotIntervene(krillin, gohan.uuid, { interventions: taken }).includes("Yamcha"), true);

  // Per Ally, not per attack: a Maneuver that caught four people can be intervened
  // against four times, once for each of them.
  check("somebody else may still be stepped in for",
    whyNotIntervene(krillin, piccolo.uuid, { interventions: taken }), null);

  check("and nobody steps in for themselves",
    Boolean(whyNotIntervene(krillin, krillin.uuid, {})), true);
}

// --- Not against an attack that was aimed at you -----------------------------------------
// "When an Ally who is not at Long Range is hit by an Attacking Maneuver (that did not
// also target you)". Stepping in front of something already coming for you is not
// stepping in front of anything.
{
  const krillin = fighter("Krillin");
  const gohan = fighter("Gohan");

  const aimedAtBoth = [gohan.uuid, krillin.uuid];
  check("somebody the attack targeted cannot step in",
    Boolean(whyNotIntervene(krillin, gohan.uuid, { targetUuids: aimedAtBoth })), true);
  check("and it says why",
    whyNotIntervene(krillin, gohan.uuid, { targetUuids: aimedAtBoth }).includes("targeted"), true);

  check("somebody it did not target can",
    whyNotIntervene(krillin, gohan.uuid, { targetUuids: [gohan.uuid] }), null);

  // Refused twice over rather than once: the list of who may step in is drawn when the
  // card is rendered, and an area attack can pick up new targets after that.
  check("the list of who may step in leaves out the attack's targets",
    /const aimedAt = new Set\(attackTargets\(attack\)\.map\(entry => entry\.uuid\)\);/.test(CHAT),
    true);
  check("and it is asked again when the Maneuver is actually played",
    /targetUuids: attackTargets\(attack\)\.map\(entry => entry\.uuid\)/.test(CHAT), true);

  // Which means nobody can be both, so nothing downstream has to handle one who is.
  check("so no line is both a target and an intervention",
    /steppedIn/.test(CHAT), false);
}

// --- Taking the Wound Roll in somebody's place -------------------------------------------
// Defense Wall: "increase your Soak Value by 1/2 (rounded up)". The one halving in the
// system that rounds up, which is why it is worth a case of its own.
{
  const bulwark = soak => Math.ceil(soak / 2);

  check("half the Soak Value, rounded up", bulwark(11), 6);
  check("and an even one is just half", bulwark(10), 5);
  // Rounded down it would be 5, which is the mistake this exists to catch.
  check("it is not rounded down like everything else", bulwark(11) !== Math.floor(11 / 2), true);

  check("the code rounds it up",
    /Math\.ceil\(base \/ option\.soakBonusFraction\)/.test(CHAT), true);
  check("and the option says by how much",
    INTERVENE_OPTIONS.defenseWall.soakBonusFraction, 2);
}

// A lost Deflect is one Category harder, for the one who stepped in and nobody else.
check("a lost Deflect raises the Damage Category by one",
  INTERVENE_OPTIONS.deflect.damageCategoryShiftOnLoss, 1);
check("only when the Clash was lost",
  /lost \? \(option\.damageCategoryShiftOnLoss \?\? 0\) : 0/.test(CHAT), true);
check("and Defense Wall never raises it",
  INTERVENE_OPTIONS.defenseWall.damageCategoryShiftOnLoss ?? 0, 0);

// --- Who takes the Wound Roll at all ------------------------------------------------------
{
  // Mirrors takesWoundFor: Defense Wall always, Deflect only having lost, Distant
  // Deflect never - losing it is written to cost nothing but the Ki.
  const takes = entry => {
    const option = INTERVENE_OPTIONS[entry.effect];
    if (option?.takesWound) return true;
    return Boolean(option?.takesWoundOnLoss && entry.clash && !entry.clash.won);
  };

  check("Defense Wall always takes it", takes({ effect: "defenseWall", clash: null }), true);
  check("a lost Deflect takes it",
    takes({ effect: "deflect", clash: { won: false } }), true);
  check("a won Deflect does not - there is nothing left to take",
    takes({ effect: "deflect", clash: { won: true } }), false);
  check("and a lost Distant Deflect costs only the Ki",
    takes({ effect: "distantDeflect", clash: { won: false } }), false);
}

// --- A won Deflect ends it for everybody ---------------------------------------------------
// "If you win, the Attacking Maneuver is successfully deflected away from all targets" -
// all of them, not only the Ally who was stepped in for.
check("a deflection is looked for across every intervention",
  /function deflection\(attack\) \{[\s\S]{0,200}?find\(entry => entry\.deflected\)/.test(CHAT), true);
check("and it means no Wound Roll is owed at all",
  /if \(deflection\(attack\)\) return false;/.test(CHAT), true);
check("the card says the attack was deflected",
  /Deflected by \$\{Handlebars\.escapeExpression\(turned\.name\)\}/.test(CHAT), true);
check("and every target reads as deflected",
  /if \(deflection\(attack\)\) return "deflected";/.test(CHAT), true);

// The attacker wins ties, as everywhere else in the system.
{
  const won = (mine, theirs) => mine > theirs;
  check("the one stepping in has to beat the attacker", won(20, 20), false);
  check("and beating them wins", won(21, 20), true);
  check("the code says so", /won: mine\.total > theirs\.total/.test(CHAT), true);
}

// --- The Deflect penalty ---------------------------------------------------------------
// "Reduce your Dice Score by 1(T) for each Energy Charge or Rank of Power Shot the
// Attacking Maneuver possesses." (T), not the Parry's (bT).
{
  const penalty = (counted, tier) => counted * tier;
  check("each Charge costs 1(T)", penalty(3, 4), 12);
  check("the code reads the Tier of Power", /const perStep = actor\.system\.tierOfPower/.test(CHAT), true);
  check("and counts Charges and Power Shot as one number",
    /const counted = charges \+ powerShot;/.test(CHAT), true);
  // Power Shot's rules are not in the system yet, so the ranks read as none and only
  // the Charges half bites. The input exists so that the day they arrive, nothing here
  // has to change.
  check("Power Shot ranks are read off the attack",
    /attack\?\.powerShotRanks \?\? 0/.test(CHAT), true);
}

// --- The Ally who was stepped in front of ------------------------------------------------
check("the shielded Ally takes nothing",
  /if \(shielded\.has\(uuid\)\) \{[\s\S]{0,300}?damage: 0,\s*\n\s*shieldedBy/.test(CHAT), true);
check("and the card names who is standing there",
  /if \(own\.shieldedBy\) return `shielded by \$\{own\.shieldedBy\}`;/.test(CHAT), true);

// "If the Attacking Maneuver hits multiple targets, all other targets receive the Wound
// Roll as usual" - which follows from only the chosen Ally's line being redirected.
check("only the chosen Ally is shielded",
  /const shielded = new Set\(shields\.map\(entry => entry\.allyUuid\)\);/.test(CHAT), true);

// --- Taking a Wound Roll is taking a Wound Roll --------------------------------------------
// Whether or not it was aimed at you. So somebody who steps in takes the same two passes
// anybody hit takes: what their own effects do to Damage they receive, and what they do
// before the Wound Roll is settled. Superior is the first: "increase the Damage you take
// by 2(T)" is about Damage you take, and a Wound Roll taken in somebody's place is Damage
// you take.
{
  // The collection point is the part that did not exist. `incoming.damage` is gathered at
  // `being-hit` for each target of the attack, and somebody stepping in front of one is
  // not a target - nobody had ever received a Wound Roll without being aimed at.
  check("the intervener's own effects are collected when they step in",
    /const incoming = atMoment\(actor, "being-hit", \{ attack: 1, attacker: 1, attackerUuid: attack\?.attackerUuid \?\? "" \}\);/
      .test(CHAT), true);
  check("on their own client, and carried on the entry",
    CHAT.includes('incomingDamage: incoming?.slots?.["incoming.damage"] ?? null,'), true);

  // And both passes reach their Damage, through the same function every other hit uses.
  check("their Damage takes both passes",
    /const damage = damageTaken\(raw,\s*\n\s*\{ "incoming\.damage": entry\.incomingDamage \},\s*\n\s*beforeWound\?\.slots\);/
      .test(CHAT), true);

  // Which means the rule about Damage that came to nothing reaches here too: the Soak and
  // the Damage Reduction swallowing the whole Wound Roll leaves nothing to raise.
  check("and nothing is raised when nothing got through",
    /const beforeWound = \(raw > 0\)/.test(CHAT), true);

  // Working one out fires Moments, so the caller waits for it. A map would have handed on
  // a list of promises and every number on the card would have read as undefined.
  check("the caller waits for each one",
    /outcome: await interventionOutcome\(attack, entry, wound\)/.test(CHAT), true);
}

// --- Excess Damage on being Defeated -------------------------------------------------------
// "If you are Defeated by this Attacking Maneuver, any excess Damage is inflicted to that
// Ally - but is reduced by their Soak Value and Damage Reduction as usual."
{
  const spill = (damage, life, allySoak, allyReduction) => {
    const excess = (damage > life) ? (damage - life) : 0;
    return excess ? Math.max(0, excess - allySoak - allyReduction) : 0;
  };

  check("nothing spills while they survive", spill(30, 40, 5, 0), 0);
  check("nor when it exactly Defeats them", spill(40, 40, 5, 0), 0);
  check("what is over their Life reaches the Ally", spill(60, 40, 5, 0), 15);
  check("through the Ally's own defences", spill(60, 40, 12, 4), 4);
  check("which can stop it entirely", spill(45, 40, 12, 0), 0);

  // "Reduced by their Soak Value and Damage Reduction as usual." And if anything is still
  // standing after those two, it is Damage they are receiving - so what raises the Damage
  // they take raises it. The rule names only the reductions, but it names them to say the
  // excess is not a special kind of Damage: it arrives the ordinary way.
  check("what survives both reductions is Damage like any other",
    /damage: damageTaken\(raw,\s*\n\s*\{ "incoming\.damage": own\?\.incomingDamage \},/.test(CHAT), true);
  check("and what does not survive them raises nothing",
    /const raw = Math\.max\(0, excess - soak - reduction\);/.test(CHAT), true);

  check("only Defense Wall spills",
    /const excess = \(option\.takesWound && \(damage > life\)\) \? \(damage - life\) : 0;/.test(CHAT),
    true);
  check("and it goes through the Ally's Soak and Damage Reduction",
    /function spilloverTo\(ally, excess, attack\)[\s\S]{0,700}?Math\.max\(0, excess - soak - reduction\)/
      .test(CHAT), true);
  // The Ally may well be somebody else's character, so their Life goes through the relay.
  check("and the Ally's Life is written through the relay",
    /requestActorUpdate\(ally, \{\s*\n\s*"system\.life\.value"/.test(CHAT), true);
}

// --- Paying for it ----------------------------------------------------------------------
{
  // A Counter Action first: it is the one that can be short, and a refused Maneuver has
  // to cost nothing.
  check("the Counter Action is spent before the Ki",
    CHAT.indexOf('spendActions(actor, maneuver.actionCost ?? 1, "counter")')
      < CHAT.indexOf("spendManeuverCost(actor, maneuver, interveneOptionCost"), true);
  check("and the effect chosen is what is paid for",
    /spendManeuverCost\(actor, maneuver, interveneOptionCost\(effect, actor\)\)/.test(CHAT), true);
  // A Counter Maneuver is a Maneuver of another kind, so it releases the Instant rule.
  // A Counter Maneuver is a Maneuver of another kind, so it releases the Instant rule.
  // Recorded once it is certainly happening - after the Action and the Ki are spent, and
  // before anything is written onto the attack.
  check("it counts as a Counter Maneuver for the Instant rule",
    CHAT.includes('await recordManeuverType(actor, "counter");'), true);
  // Asked of this function's own body: the Defend path records a Counter Maneuver too,
  // and searching the whole file finds that one first.
  {
    const body = /async function playIntervene[\s\S]*?\n\}/.exec(CHAT)?.[0] ?? "";
    check("once it is certainly happening",
      body.indexOf("spendManeuverCost(actor, maneuver, interveneOptionCost")
        < body.indexOf('await recordManeuverType(actor, "counter");'), true);
    check("and before the entry is built",
      body.indexOf('await recordManeuverType(actor, "counter");')
        < body.indexOf("const entry = {"), true);
  }
}

// --- The list is a list ------------------------------------------------------------------
// A uuid is full of dots and Foundry expands dotted keys on the way into a document, so
// nothing here may be keyed by one.
check("interventions are a list", /interventions: \[\]/.test(CHAT), true);
check("read as one", /return attack\.interventions \?\? \[\];/.test(CHAT), true);
check("and nothing about them is keyed by a uuid",
  /\[(entry|ally|who)\.uuid\]:/.test(CHAT), false);

// --- The window it opens in ----------------------------------------------------------------
// After the Ally has been hit, before the Wound Roll - which is the only point at which
// "an Ally is hit by an Attacking Maneuver" is both true and still worth answering.
// Drawn before anything that belongs to the two people in the exchange. It used to sit
// after Combination's extra Strikes, and that block returns early for anyone who is not
// the attacker - so against a Combination, the one attack that puts a step between the
// hit and the Wound Roll, no third party could step in at all.
{
  const body = /function renderAttack[\s\S]*?\n\}/.exec(CHAT)?.[0] ?? "";
  // One Apply effects for everything that answers a hit now (the user's) - the Intervene in each Ally's window behind it.
  const intervene = body.indexOf('apply.addEventListener("click", () => openHitWindows(message));');

  check("the button is drawn at all", intervene > 0, true);

  // Every early return in this function belongs to the attacker or to a target. None of
  // them may stand between a third party and their own button.
  for (const [what, marker] of [
    ["Combination's extra Strikes", "if (awaitsFollowUps(attack)) {"],
    ["the Wound Roll", "if (!result.wound && owesWound(attack)) {"],
    ["applying the Damage", "if (!result.wound) return;"]
  ]) {
    check(`${what} cannot come between a third party and the button`,
      intervene < body.indexOf(marker), true);
  }
}

check("the button is offered before the Wound Roll",
  /  if \(!result\.wound && !attack\.woundHeld\) \{\n    const entries = hitEntries\(message, attack\);[\s\S]{0,1200}?openHitWindows\(message\)/.test(CHAT)
    && CHAT.includes("const interveners = !deflection(attack) ? possibleInterveners(attack).filter(who => shieldableTargets(attack, who).length) : [];"),
  true);
check("and only for Allies the attack actually hit",
  /entry\.own\?\.hit\s*\n\s*&& \(entry\.uuid !== intervener\?\.uuid\)\s*\n\s*&& !interventionFor/
    .test(CHAT), true);

// --- What is left to the table ---------------------------------------------------------------
// The movement, and Long Range. Both are said rather than enforced, which is the system's
// standing answer to geometry it has no way to settle.
check("each moving option says what the move has to be",
  [INTERVENE_OPTIONS.defenseWall, INTERVENE_OPTIONS.deflect].every(o => Boolean(o.movement)),
  true);
check("and Distant Deflect asks for none",
  Boolean(INTERVENE_OPTIONS.distantDeflect.movement), false);
check("the Boosted Speed is put in front of the player",
  /Boosted Speed \$\{actor\.system\.speed\.boosted\} Squares/.test(CHAT), true);
check("and the dialog says whose call the Squares are",
  /yours and the Gamemaster's to settle/.test(CHAT), true);
check("the table's share is written down where the options are",
  /Where a character stands is the table's to\s+\*?\s*settle/.test(MANEUVERS), true);

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
