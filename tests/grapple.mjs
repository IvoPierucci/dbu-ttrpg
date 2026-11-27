/**
 * The Grapple Maneuver.
 *
 * Two firsts in one Maneuver. It is the first Clash made out of Combat Rolls rather than
 * a Skill or Might, and the first with two different rolls in it - "Strike vs
 * Strike/Dodge", the second of which the Defender picks. And a Grapple is the first thing
 * in this system that is a link between two characters rather than something one of them
 * carries alone, which is why both sides store it and why every rule in the entry turns
 * on which half of it you are.
 *
 * The Clash category is not read as source here: it is cut out of chat.mjs and run, with
 * stubs for the two penalty helpers, so what is checked is the code that will decide
 * which roll a side makes and which Slot an effect reaches it through.
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

const { whyNotAnotherGrapple, whyNotLaunch, whyNotPin, whyNotWithinMelee } =
  await import(modUrl("maneuvers.mjs"));

const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
const USE = fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8");
const COMBAT = fs.readFileSync(path.join(ROOT, "module", "combat.mjs"), "utf8");
const CONDITIONS = fs.readFileSync(path.join(ROOT, "module", "conditions.mjs"), "utf8");
const MODEL = fs.readFileSync(path.join(ROOT, "module", "data", "actor-character.mjs"), "utf8");
const ITEM = fs.readFileSync(path.join(ROOT, "module", "data", "item-maneuver.mjs"), "utf8");
const SHEET = fs.readFileSync(
  path.join(ROOT, "module", "sheets", "actor-character-sheet.mjs"), "utf8");
const TAB = fs.readFileSync(path.join(ROOT, "templates", "parts", "actor-combat.hbs"), "utf8");
const TRAIT = fs.readFileSync(path.join(ROOT, "traits", "maneuvers", "grapple.dbu"), "utf8");
const LAUNCH = fs.readFileSync(path.join(ROOT, "traits", "maneuvers", "launch.dbu"), "utf8");
const PIN = fs.readFileSync(path.join(ROOT, "traits", "maneuvers", "pin.dbu"), "utf8");
const INDEX = JSON.parse(fs.readFileSync(path.join(ROOT, "traits", "index.json"), "utf8"));

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

const EN_DASH = "\u2013";

// --- The Maneuver as the rulebook lists it ---------------------------------------------
{
  check("a Standard Maneuver", /^type: standard$/m.test(TRAIT), true);
  check("costing 1 Action", /^actionCost: 1$/m.test(TRAIT), true);
  check("no Ki", /^kiCost: 0$/m.test(TRAIT), true);
  check("once a Combat Round", /^usageLimit: 1\/round$/m.test(TRAIT), true);
  check("needing a target", /^requiresTarget: true$/m.test(TRAIT), true);
  check("and knowing what it is", /^grapple: true$/m.test(TRAIT), true);
  check("listed", INDEX.traits.includes("maneuvers/grapple.dbu"), true);

  // Not an Attacking Maneuver: no Strike against a Dodge for damage, no Wound Roll. The
  // Clash it makes is its own thing.
  check("not an Attacking Maneuver", /^attacking: false$/m.test(TRAIT), true);

  // The Exploitable line is deliberately not in the field that hands out Exploits: that
  // field fires when a Maneuver is used, and this one fires only on a lost Check.
  check("the Exploitable line is not in the field that offers Exploits",
    /^exploitable:/m.test(TRAIT), false);
  check("and the file says why", TRAIT.includes("that is deliberate"), true);

  // The whole entry, all eight of its rules. Half of them are not built, and the wording
  // being there is what the table has instead.
  for (const phrase of [
    "Grapple Maneuver [1/Round]:", `${EN_DASH}Maneuver Type: Standard`,
    "* Grapple Penalty:", "* Ending a Grapple:", "* Escaping a Grapple:",
    "* Movement in a Grapple:", "* Pulled In:", "* Moving a Character:",
    "* Grappling a Grapple:", "* Tail Restraint:"
  ]) {
    check(`the entry carries "${phrase}"`, TRAIT.includes(phrase), true);
  }

  // And says which of them are not built, and why each is not about effort.
  for (const [what, why] of [
    ["the movement rules", "does not move anybody"],
    ["Grappling a Grapple", "the same shape with the same missing half"],
  ]) {
    check(`the file says what is missing for ${what}`, TRAIT.includes(why), true);
  }
  check("and that Tail Restraint is built", TRAIT.includes("Tail Restraint is built"), true);
}

// --- You cannot start a second one ------------------------------------------------------
{
  const held = { name: "Tizi", system: { grapple: { partner: "Actor.x", role: "grappled" } } };
  const free = { name: "Tizi", system: { grapple: { partner: "", role: "" } } };
  const GRAPPLE = { id: "grapple", name: "Grapple", grapple: true };
  const OTHER = { id: "basic-attack", name: "Basic Attack", attacking: true };

  check("free to grapple when not in one", whyNotAnotherGrapple(free, GRAPPLE), null);
  check("and refused while already in one",
    Boolean(whyNotAnotherGrapple(held, GRAPPLE)), true);
  check("the refusal says so plainly",
    whyNotAnotherGrapple(held, GRAPPLE).includes("already in a Grapple"), true);

  // Only the Grapple Maneuver. Being held does not stop you doing anything else - the
  // rules that do are the Guard Down and whatever the table rules on.
  check("nothing else is refused by it", whyNotAnotherGrapple(held, OTHER), null);

  // And it is asked before anything is paid, so a refused Maneuver costs nothing.
  check("asked before anything is paid",
    USE.indexOf("const alreadyGrappling") < USE.indexOf("maneuverKiCost(maneuver, declared, actor)"),
    true);
}

// --- Within your Melee Range ------------------------------------------------------------
{
  // The measurement without the rule that is asking, so a Physical Attack and a Grapple
  // count the same Squares the same way.
  check("the Melee Range check is shared",
    /export function whyNotWithinMelee\(actor, target, what, extra = 0\)/.test(
      fs.readFileSync(path.join(ROOT, "module", "maneuvers.mjs"), "utf8")), true);
  check("and a Physical Attack asks it too",
    /return whyNotWithinMelee\(actor, target, "A Physical Attack", extra\);/.test(
      fs.readFileSync(path.join(ROOT, "module", "maneuvers.mjs"), "utf8")), true);

  // Unmeasurable is within: with no tokens there are no Squares.
  const nowhere = { name: "Tizi", system: { meleeRange: 0 } };
  check("nothing to measure is not a refusal",
    whyNotWithinMelee(nowhere, { name: "Goku" }, "The Grapple Maneuver"), null);

  check("and the Maneuver asks it of its target",
    USE.includes('whyNotWithinMelee(actor, targetActor, "The Grapple Maneuver")'), true);
}

// --- The Grapple Check, run rather than read ----------------------------------------------
{
  // Cut the category out of chat.mjs and run it. The two penalty helpers are stubbed so
  // that what they contribute is visible as itself.
  // The pair of rolls, keyed for what it rolls rather than for one of its two users: a
  // Clash of Strike answered by Strike or Dodge, which the Thrust Maneuver asks for too.
  // What makes a card a Grapple Check is `clash.grapple` and the label it is opened
  // with, and both of those are checked below.
  const from = CHAT.indexOf(`strike: {${String.fromCharCode(10)}    label: "Strike Clash",`);
  const to = CHAT.indexOf("\n});", from);
  check("the category is where it is expected", from > 0 && to > from, true);

  const source = CHAT.slice(from, to).replace(/,?\s*$/, "");
  const build = new Function("musclePenalty", "thresholdPenalty", "pick",
    "grappleDefenceParts", "grappleAllParts",
    `return ({${source}}).strike;`);
  const grapple = build(
    () => [{ label: "Muscle Penalty", value: -4 }],
    () => [{ label: "Thresholds", value: -2 }],
    async () => null,
    // "Increase all of your Grapple Checks made as the Grappled by 1(T)." Nothing in this
    // section carries it, so it contributes nothing here - which is the point: the rows
    // this checks are the ones that were always there.
    () => [],
    // Four Witches Grip's - nobody here has it.
    () => []
  );

  const actor = {
    name: "Tizi",
    system: {
      combat: { strike: 12, dodge: 9 },
      dice: { extra: { formula: "2d6" }, critical: { formula: "1d6" } },
      tierOfPower: 2
    }
  };
  const clash = {
    challengerUuid: "Actor.a", defenderUuid: "Actor.b",
    defenderRoll: "", earlierAttempts: 0, defenderBonus: 0
  };

  // The pair is named for what it rolls; the card is named for what it is being used
  // for, and a Grapple Check's card still says Grapple Check.
  check("the pair is named for what it rolls", grapple.label, "Strike Clash");
  check("and a Grapple Check's card says so",
    CHAT.includes('clashLabel: "Grapple Check",'), true);

  // "Strike vs Strike/Dodge": the Initiator's is always the Strike.
  check("the Initiator rolls Strike",
    grapple.of(actor, clash, "Actor.a"), { label: "Strike", value: 12 });
  // And so does the Defender, until they say otherwise.
  check("the Defender rolls Strike unless they say otherwise",
    grapple.of(actor, clash, "Actor.b"), { label: "Strike", value: 12 });
  check("and their Dodge when they do",
    grapple.of(actor, { ...clash, defenderRoll: "dodge" }, "Actor.b"),
    { label: "Dodge", value: 9 });
  // The Initiator's roll is never swapped by the Defender's answer.
  check("the Initiator is unaffected by what the Defender picked",
    grapple.of(actor, { ...clash, defenderRoll: "dodge" }, "Actor.a"),
    { label: "Strike", value: 12 });

  // A Combat Roll, so it carries what one carries.
  const parts = grapple.parts(actor, clash, "Actor.a").map(part => part.label);
  check("it takes the Muscle Penalty and the Threshold penalty",
    parts, ["Muscle Penalty", "Thresholds"]);

  // And not Diminishing Offense, which blunts "the Strike Roll of every Attacking
  // Maneuver" - and the Grapple Maneuver is not one.
  check("and not Diminishing Offense",
    CHAT.slice(from, to).includes("Dim. Offense"), false);
  check("which the category says out loud",
    CHAT.slice(from, to).includes("blunts"), true);

  // The Tier of Power Extra Dice ride on every Combat Roll, and the Slot follows which
  // roll was made, so "increase your Strike Rolls" reaches one and not the other.
  check("the Extra Dice ride on it",
    grapple.options(actor, clash, "Actor.a").extraDice, "2d6");
  check("and it is a Combat Roll",
    grapple.options(actor, clash, "Actor.a").combatRoll, true);
  check("a Strike lands in the Strike Slot",
    grapple.options(actor, clash, "Actor.b").slot, "strike");
  check("and a Dodge in the Dodge Slot",
    grapple.options(actor, { ...clash, defenderRoll: "dodge" }, "Actor.b").slot, "dodge");

  // "For each Action spent after the first, increase the Dice Score of their Grapple
  // Check by 1(T) until the end of their turn." What the attempts already made this turn
  // are worth to this one - the Grappled's, and nobody else's.
  const thirdTry = { ...clash, earlierAttempts: 2, defenderBonus: 4 };
  check("earlier attempts raise the Grappled's roll",
    grapple.parts(actor, thirdTry, "Actor.b").map(p => [p.label, p.value, p.written]),
    [["Muscle Penalty", -4, undefined], ["Thresholds", -2, undefined],
     ["Earlier attempts", 4, "+2(T)"]]);
  check("and not the Grappler's",
    grapple.parts(actor, thirdTry, "Actor.a").map(p => p.label),
    ["Muscle Penalty", "Thresholds"]);
  check("the first attempt of a turn has none",
    grapple.parts(actor, clash, "Actor.b").map(p => p.label),
    ["Muscle Penalty", "Thresholds"]);

  // The Defender is asked which roll before either side has seen a number.
  check("only the Defender is asked", await grapple.choose(clash, { uuid: "Actor.a" }), {});
  check("and backing out of the question does not mark them ready",
    await grapple.choose(clash, { uuid: "Actor.b", name: "Goku", system: actor.system }), null);
  check("the button says what this side is about to roll",
    [grapple.prompt(actor, clash, "Actor.a"), grapple.prompt(actor, clash, "Actor.b")],
    ["Strike", "Strike or Dodge"]);
  check("and the card asks it before rolling",
    CHAT.includes("const answer = kind.choose ? await kind.choose(opened, actor) : {};"), true);

  // The Grapple Maneuver is a Standard Maneuver, so an Instant can be played in answer
  // to it - the same as a Skill Clash, which is also a Maneuver wearing a Clash. The
  // escape Check is not one: Actions spent, with nothing there to answer.
  check("an Instant can answer the Maneuver's own Check",
    CHAT.includes("[RESPONDABLE_FLAG]: Boolean(maneuver) && isRespondable(maneuver),"), true);
  check("and the Maneuver is handed to the card for that",
    USE.includes("        maneuver,"), true);
  check("while an escape Check offers nothing to answer",
    /kind: "escape",[\s\S]{0,400}?maneuver:/.test(USE), false);
}

// --- Who won, asked once -------------------------------------------------------------------
{
  check("one answer to who took a Clash",
    CHAT.includes("function whoWonClash({ challenger, defender })"), true);
  // The defender takes a tie, which within a Grapple is always the Grappled - and that is
  // how a tie frees them.
  check("the defender takes a tie",
    /if \(defender\.succeeded\) return "defender";\s*\n\s*return \(challenger\.total > defender\.total\) \? "challenger" : "defender";/
      .test(CHAT), true);
  check("and the Knockback collision asks the same question",
    CHAT.includes('const wonIt = whoWonClash(result) === "challenger";'), true);
}

// --- What a settled Check leaves behind ------------------------------------------------------
{
  // Settled where the Clash is written, which is the one place exactly one client
  // reaches - so it happens once rather than once per person watching.
  const clashWriter = CHAT.indexOf("async function settleClashEffects(");
  const applyClash = CHAT.slice(clashWriter, CHAT.indexOf("/**", clashWriter));
  check("settled where the Clash is written",
    applyClash.includes("await settleGrapple(message, clash);"), true);
  check("and only once", CHAT.includes("!clash.grapple.applied"), true);
  // Inside settleGrapple's own body. Three functions are built to this shape now - the
  // Thrust and the Blockade settle the same way - so asking the whole file for either
  // line finds whichever of the three sits earliest in it.
  const settle = CHAT.slice(CHAT.indexOf("async function settleGrapple("),
    CHAT.indexOf("/** A line under the card saying what the Clash came to. */"));
  check("settleGrapple is where it is expected", settle.length > 0, true);
  check("marked before anything else, so a failure cannot settle it twice",
    settle.indexOf("grapple: { ...clash.grapple, applied: true }")
      < settle.indexOf("const winner = whoWonClash(clash.result);"), true);

  // Starting one: the Initiator has to win, and losing hands the target an Exploit.
  check("losing the initial Check offers the target an Exploit",
    /maneuverId: "exploit",\s*\n\s*maneuverName: "Exploit",\s*\n\s*targetUuid: grappler\.uuid/
      .test(CHAT), true);
  check("and only the target, not every adjacent Opponent",
    CHAT.includes("actorUuid: grappled.uuid,\n          actorName: grappled.name,"), true);
  check("offered only to somebody who has the Exploit Maneuver",
    CHAT.includes('grappled.items.some(item => (item.type === "maneuver") && item.system.exploit)'),
    true);

  // "While in a Grapple, all Characters suffer from the Guard Down Combat Condition."
  check("both sides take Guard Down",
    /for \(const actor of \[grappler, grappled\]\) \{[^]{0,200}await setCondition\(actor, "guard-down", 1\);/
      .test(CHAT), true);
  check("and both are recorded as being in it",
    ['"system.grapple.role": "grappler"', '"system.grapple.role": "grappled"']
      .every(line => CHAT.includes(line)), true);

  // Letting go takes both out of it and the Guard Down with it - and in that order,
  // since the refusal that holds it would otherwise refuse this too.
  check("ending it takes them both out",
    CHAT.indexOf("await requestActorUpdate(actor, { ...NOT_GRAPPLING });")
      < CHAT.indexOf('await setCondition(actor, "guard-down", 0);'), true);
}

// --- The Guard Down that will not come off ------------------------------------------------
{
  check("something can hold a Condition in place",
    CONDITIONS.includes("function heldInPlace(actor, key, wanted = 0)"), true);
  check("and a Grapple holds Guard Down",
    /key === "guard-down"\) && actor\.system\?\.grapple\?\.partner/.test(CONDITIONS), true);
  check("only against taking it off, not against gaining it",
    /if \(wanted < current\) \{\s*\n\s*const held = heldInPlace\(actor, key, wanted\);/.test(CONDITIONS),
    true);
  // Said, not silently refused: a toggle that does nothing looks exactly like a bug.
  check("and it says why", /ui\.notifications\?\.warn\(held\);/.test(CONDITIONS), true);
}

// --- Ending it and escaping it ----------------------------------------------------------------
{
  // "The Grappler can end a Grapple as an Instant Maneuver on their turn." All three of
  // those are rules.
  check("only the Grappler ends it",
    USE.includes('if (actor.system.grapple.role !== "grappler")'), true);
  check("on their own turn", USE.includes("if (!isTheirTurn(actor))"), true);
  check("bound by the Instant rule",
    /export async function releaseGrapple[\s\S]{0,1400}?whyNotAnotherInstant\(actor\)/.test(USE),
    true);
  check("and recorded as an Instant afterwards, which holds the next one",
    /await recordManeuverType\(actor, "instant", \{ messageId: card\?\.id \}\);/.test(USE), true);

  // "By spending 1 Action, the Grappled can make a Grapple Check against the Grappler."
  check("only the Grappled escapes",
    USE.includes('if (actor.system.grapple.role !== "grappled")'), true);
  check("the Actions are spent before the Check is opened",
    USE.indexOf('await spendActions(actor, spent, "standard")')
      < USE.indexOf('kind: "escape"'), true);
  check("and the Check is opened with the Grappler as its Initiator",
    /await postGrappleCheck\(grappler, actor, \{/.test(USE), true);
  check("which is the rule about roles not swapping",
    USE.includes("the roles in a Grapple do not swap"), true);

  // Not a Maneuver, so nothing about Instants or usage limits touches it.
  check("escaping is not recorded as a Maneuver",
    /export async function escapeGrapple[\s\S]{0,2000}?recordManeuverType/.test(USE), false);
}

// --- Where it lives, and when it ends -----------------------------------------------------------
{
  check("a character stores the Grapple they are in",
    /schema\.grapple = new fields\.SchemaField\(\{/.test(MODEL), true);
  check("as a partner and a role",
    ["partner: new fields.StringField", "role: new fields.StringField"]
      .every(line => MODEL.includes(line)), true);
  check("the Maneuver knows it is the Grapple Maneuver",
    /grapple: new fields\.BooleanField\(\{ required: true, initial: false \}\)/.test(ITEM), true);

  // Written as a pair, because half a Grapple is not a thing.
  check("letting go is said once",
    /export const NOT_GRAPPLING = Object\.freeze\(\{[\s\S]{0,200}?"system\.grapple\.role": ""/
      .test(COMBAT), true);
  check("an Encounter starts with nobody held",
    /startEncounter[\s\S]{0,1400}?\.\.\.NOT_GRAPPLING/.test(COMBAT), true);
  // Each character's Encounter ended in one place, the tracker's end and the sheet's New encounter alike (endEncounterFor).
  check("and ends with nobody held",
    /export async function endEncounterFor\(actor\) \{[\s\S]{0,5000}?\.\.\.NOT_GRAPPLING/.test(COMBAT)
      && COMBAT.includes("for (const actor of combatants(combat)) await endEncounterFor(actor);"), true);
  // A Combat Round does not end a Grapple: nothing in the entry says it should.
  check("a Combat Round does not end one",
    /function newRoundFor[\s\S]{0,900}?NOT_GRAPPLING/.test(COMBAT), false);
}

// --- The sheet -----------------------------------------------------------------------------------
{
  check("the sheet works out which half of it they are",
    SHEET.includes('grappler: role === "grappler",'), true);
  check("and offers each half its own button", [
    TAB.includes('data-action="releaseGrapple"'),
    TAB.includes('data-action="escapeGrapple"')
  ], [true, true]);
  check("one or the other, never both",
    /\{\{#if grapple\.grappler\}\}\s*\n\s*<button type="button" data-action="releaseGrapple"/
      .test(TAB), true);
  check("the row says which they are",
    TAB.includes("Grappler &middot; holding") && TAB.includes("Grappled &middot; held by"), true);
  // A partner whose token has gone leaves a Grapple with nobody in it, and the button
  // still works - letting go of nothing is how you get out of that.
  check("a missing partner is said rather than drawn blank",
    SHEET.includes('other?.name ?? "somebody who is no longer here"'), true);
}

// --- The Launch Maneuver: throw the one you are holding -----------------------------------------
{
  check("a Standard Maneuver", LAUNCH.includes("type: standard"), true);
  check("costing 1 Action", LAUNCH.includes("actionCost: 1"), true);
  check("once a Combat Round", LAUNCH.includes("usageLimit: 1/round"), true);
  check("and listed", INDEX.traits.includes("maneuvers/launch.dbu"), true);
  check("the entry is there whole", [
    LAUNCH.includes("Launch Maneuver [1/Round]: Throw a Character you are holding."),
    LAUNCH.includes("If you lose, the Grappled")
  ], [true, true]);

  // No target to pick. "An Opponent you are currently in a Grapple with as the Grappler"
  // names exactly one Character, and the Grapple already knows which.
  check("it asks for no target", LAUNCH.includes("requiresTarget: false"), true);
  check("and the file says why", LAUNCH.includes("a question with one answer"), true);

  const LAUNCHER = { id: "launch", name: "Launch", launch: true };
  const holding = { name: "Tizi", system: { grapple: { partner: "Actor.x", role: "grappler" } } };
  const beingHeld = { name: "Tizi", system: { grapple: { partner: "Actor.x", role: "grappled" } } };
  const free = { name: "Tizi", system: { grapple: { partner: "", role: "" } } };

  check("the Grappler may throw", whyNotLaunch(holding, LAUNCHER), null);
  check("somebody in no Grapple may not",
    whyNotLaunch(free, LAUNCHER).includes("not in a Grapple"), true);
  // The Grappled has the Escape, which is the same Check pointed the other way.
  check("and neither may the Grappled",
    whyNotLaunch(beingHeld, LAUNCHER).includes("is the Grappled, not the Grappler"), true);
  check("nothing else is refused by it",
    whyNotLaunch(free, { id: "grapple", grapple: true }), null);

  // Before anything is paid, with the rest of the refusals.
  check("asked before anything is paid",
    USE.indexOf("const nobodyToThrow") < USE.indexOf("maneuverKiCost(maneuver, declared, actor)"),
    true);
  // A uuid can outlive the Actor it names, and a Grapple with nobody in it has nobody to
  // throw - found before the Action is spent rather than when the card reads a Tier of
  // Power off nothing.
  // One guard for both Maneuvers that aim themselves, since both read the same partner.
  check("a partner who is gone is a refusal, not a crash",
    USE.includes('&& !fromUuidSync(actor.system.grapple?.partner ?? "")'), true);

  // A third kind of Grapple Check, with the Grappler as its Initiator like every other.
  check("it opens a Grapple Check", USE.includes('"pin" : maneuver.choke ? "choke" : "launch"'), true);
  check("with the Grappler as its Initiator",
    USE.includes("? await postGrappleCheck(actor, fromUuidSync(actor.system.grapple.partner), {"),
    true);

  // The card's own half - who it lands on, and the once-per-win mark. The damage itself
  // is worked out in the window the card opens, which the Battlefields tab opens too.
  const APPLY_COLLISION = CHAT.slice(
    CHAT.indexOf("async function applyCollisionDamage("),
    CHAT.indexOf("/** Take the damage off one target, once and once only. */"));
  const ASK_COLLISION = CHAT.slice(
    CHAT.indexOf("async function askCollisionDamage("),
    CHAT.indexOf("/**\n * Collision Damage taken because the character says so."));

  const launchOutcome = CHAT.slice(
    CHAT.indexOf('if (clash.grapple.kind === "launch") {'),
    CHAT.indexOf('if (clash.grapple.kind === "escape") {'));

  // "If you lose, the Grappled Opponent escapes the Grapple." A tie is a loss: the
  // Defender takes one, and within a Grapple the Defender is the Grappled.
  check("losing it frees the Grappled", [
    launchOutcome.includes('winner !== "challenger"'),
    launchOutcome.includes("await endGrapple(grappler, grappled);")
  ], [true, true]);

  // Winning throws them, rather than offering to. The entry writes it as a choice, and
  // it is taken as done: using a Maneuver and then being asked whether you meant it is a
  // strange thing to hand somebody.
  check("winning throws them and ends the Grapple", [
    launchOutcome.includes("await endGrapple(grappler, grappled);"),
    launchOutcome.includes("throws ${grappled.name} - the Grapple ends")
  ], [true, true]);
  check("with nothing left to decline",
    CHAT.includes("Let go and throw them"), false);
  check("and no second function to do it in",
    CHAT.includes("async function applyLaunch("), false);

  // "A number of Squares up to your Might", read when the Check settles - which is when
  // the throw happens now - so it is the Grappler's Might as it stands when they let go.
  check("the distance is the Grappler's Might",
    launchOutcome.includes("const squares = Math.max(0, grappler.system.might ?? 0);"), true);
  check("and it is said on the card",
    launchOutcome.includes("they move up to ") && launchOutcome.includes("${squares} Squares"),
    true);

  // What the throw leaves open is what they land against, which is the question
  // Knockback already asks - so it is the same button, the same dialog and the same
  // once-per-win guard rather than a second one beside it.
  check("a Launch Check carries a collision to offer",
    CHAT.includes('collision: (kind === "launch") ? { doubles: false, doubledBy: "" } : null,'),
    true);
  check("and nothing else does",
    CHAT.includes('collision: (kind === "escape")') || CHAT.includes('collision: (kind === "start")'),
    false);
  // Nothing doubles it: the Launching Profile doubles a Knockback's collision, and this
  // is the Launch Maneuver - a different thing with a similar name.
  check("nothing doubles it", CHAT.includes('(kind === "launch") ? { doubles: false'), true);

  // Drawn by the button that was already there, which is the point of reusing the flag.
  check("the collision button is the one Knockback uses",
    CHAT.includes('collision.textContent = "Apply collision damage";'), true);
  check("offered to the winner alone, once",
    CHAT.includes("clash.collision && wonIt && !clash.collisionApplied && challenger?.isOwner"),
    true);
  // It takes the Life Points off the Defender, who in a Launch is the one being thrown.
  check("and it lands on the Character who was thrown",
    APPLY_COLLISION.includes("const target = fromUuidSync(clash.defenderUuid);"), true);
  check("straight off their Life",
    ASK_COLLISION.includes("await reduceLifePoints(target, ignored ? 0 : received,"), true);
  check("and the card marks the Clash so one win buys one collision",
    APPLY_COLLISION.includes("clash: { ...clash, collisionApplied: true }"), true);
}

// --- Collision Damage is not doubled by a Launch -----------------------------------------------
// The only other place this button appears is behind the Launching Profile, which doubles
// Collision Damage and says so. Both halves are cut out and run here rather than read:
// the flag a real Launch Check writes, and the two lines that decide the amount.
{
  const from = CHAT.indexOf("export async function postGrappleCheck(");
  const to = CHAT.indexOf("\n}\n", from);
  check("postGrappleCheck is where it is expected", from > 0 && to > from, true);

  const source = CHAT.slice(from, to + 2).replace("export async function", "async function");
  const build = new Function(
    "ChatMessage", "SCOPE", "RESPONDABLE_FLAG", "CLASH_FLAG", "isRespondable",
    `${source}\nreturn postGrappleCheck;`);

  // Hands back what it was about to write, so the flags can be looked at.
  const postGrappleCheck = build(
    { create: async data => data, getSpeaker: () => ({}) },
    "dbu-ttrpg", "respondable", "clash", () => false
  );

  const someone = name => ({
    uuid: `Actor.${name}`, name, system: { tierOfPower: 3 }
  });

  const flagsOf = async kind => {
    const written = await postGrappleCheck(someone("Tizi"), someone("Kale"), { kind });
    return written.flags["dbu-ttrpg"].clash;
  };

  const launch = await flagsOf("launch");
  const start = await flagsOf("start");
  const escape = await flagsOf("escape");

  // A Launch Check carries a collision for the button to be drawn from; the other two do
  // not, because neither of them throws anybody.
  check("a Launch Check offers a collision", Boolean(launch.collision), true);
  check("and it does not double", launch.collision.doubles, false);
  check("starting a Grapple offers none", start.collision, null);
  check("nor does escaping one", escape.collision, null);
  check("and none of them has been applied yet",
    [launch.collisionApplied, start.collisionApplied, escape.collisionApplied],
    [false, false, false]);

  // The lines that turn the Hardness Value into what comes off their Life. Two of them: a
  // Sudden Stop halves what a Launching doubles and a Rubbery or Fragile Feature halves it
  // again, and all of them are settled as one multiplier rather than one after another.
  // Three now: a Dangerous Square doubles the Collision Damage the way a Launching
  // Profile does, so the doublings are counted as well and the two multiply.
  const counts = CHAT.indexOf("const halvings = (halved ? 1 : 0)");
  const doublings = CHAT.indexOf("const doublings = (doubled ? 1 : 0)");
  const multiplies = CHAT.indexOf(
    "const amount = Math.floor(value * (2 ** doublings) * (0.5 ** halvings));");
  check("all three lines are where they are expected",
    (counts > 0) && (doublings > counts) && (multiplies > doublings), true);

  const line = at => CHAT.slice(at, CHAT.indexOf(";", at) + 1);
  // What the card hands the window, cut out as well, so this is the Clash's own reading of
  // its flags rather than a second copy of it written here.
  const reads = CHAT.indexOf("    doubled: Boolean(clash.collision?.doubles),");
  const handed = CHAT.slice(reads, CHAT.indexOf("  });", reads));
  check("the card reads its own flags to open the window", reads > 0, true);

  // `applied` is the Feature Qualities ticked in the window. None of them here: this is
  // the Grapple's own arithmetic, and what a Quality does to it is `qualities.mjs`.
  const collisionAmount = (clash, value) =>
    new Function("clash", "value", "applied", "fromGround",
      `const { doubled, halved } = { ${handed} };
       ${line(counts)}
       ${line(doublings)}
       ${line(multiplies)}
       return amount;`)(clash, value, [], []);

  // The question itself: a Hardness Value of 7 against a real Launch card comes off as 7.
  check("7 against a Launch stays 7", collisionAmount(launch, 7), 7);
  check("and 0 stays 0", collisionAmount(launch, 0), 0);

  // The rule that does double is still there and still doubles, so this is not the
  // doubling having been broken instead.
  check("the Launching Profile still doubles",
    collisionAmount({ collision: { doubles: true, doubledBy: "Launching" } }, 7), 14);
  check("and it is the only thing that sets that",
    (CHAT.match(/doubles: Boolean\(/g) ?? []).length, 1);
  check("off the Profile that says so",
    CHAT.includes("doubles: Boolean(profileFor(attack)?.doublesCollisionDamage),"), true);
  check("which is one Profile",
    (fs.readFileSync(path.join(ROOT, "module", "maneuvers.mjs"), "utf8")
      .match(/doublesCollisionDamage: true/g) ?? []).length, 1);
}

// --- Escaping is a Check you make again, not one you buy dice for ------------------------------
// "By spending 1 Action, the Grappled can make a Grapple Check against the Grappler. If
// they win, they escape the Grapple. For each Action spent after the first, increase the
// Dice Score of their Grapple Check by 1(T) until the end of their turn."
//
// Three Actions is three Checks, and the third only happens because the first two lost -
// which is the whole shape of it. Bought in advance, a player spent three Actions on one
// roll and never found out that the first would have been enough.
{
  // One Action a try, and no question about how many.
  check("an attempt costs one Action",
    USE.includes('if (!free && !await spendActions(actor, 1, "standard")) return false;'), true);
  check("and nothing asks how many to spend", USE.includes("askEscapeActions"), false);

  // What the earlier attempts are worth is read before this one is counted, so the first
  // is made at nothing - which is what "each Action spent after the first" means.
  check("the tally is read before this attempt is added",
    USE.indexOf("const already = actor.system.grapple.escapeActions ?? 0;")
      < USE.indexOf('"system.grapple.escapeActions": already + 1'), true);
  check("and it is what the card is opened with",
    USE.includes("earlierAttempts: already,"), true);

  // 1(T), off the Grappled's own Tier of Power.
  check("each earlier attempt is worth 1(T)",
    CHAT.includes("defenderBonus: earlierAttempts * tier,"), true);
  check("of the Grappled's Tier of Power",
    CHAT.includes("const tier = Math.max(1, grappled.system.tierOfPower ?? 1);"), true);

  // The tally belongs to the turn - "until the end of their turn" - and is cleared where
  // the other thing a turn leaves behind is cleared, after the end-of-turn Moment.
  check("the tally is a field on the character",
    MODEL.includes("escapeActions: new fields.NumberField({"), true);
  check("cleared when the turn ends",
    COMBAT.includes('await leaving.update({ "system.grapple.escapeActions": 0 });'), true);
  check("after the end-of-turn Moment, like the other one",
    COMBAT.indexOf('fireMoment(leaving, "end-of-turn")')
      < COMBAT.indexOf('"system.grapple.escapeActions": 0'), true);

  // And the panel says what the next attempt is worth, which is what decides whether
  // another Action is worth spending.
  check("the panel counts the attempts", SHEET.includes("tried: escapeActions,"), true);
  check("and says what the next Check gains",
    SHEET.includes("nextBonus: escapeActions * Math.max(1, this.actor.system.tierOfPower ?? 1),"),
    true);
  check("which the tab draws", TAB.includes("{{grapple.tried}} tried this turn"), true);
}

// --- The Pin Maneuver: two Clashes, and losing either frees them --------------------------------
// "If you are the Grappler in a Grapple, make a Grapple Check against the Grappled with
// your Dice Score reduced by 1(bT). If you win, make a Might Clash against the Grappled.
// If you win, they gain the Pinned Combat Condition while in this Grapple. If you lose
// either of these Clashes, they escape the Grapple."
{
  check("a Standard Maneuver", PIN.includes("type: standard"), true);
  // Two, which is what makes losing either Clash a real price rather than a big one.
  check("costing 2 Actions", PIN.includes("actionCost: 2"), true);
  check("once a Combat Round", PIN.includes("usageLimit: 1/round"), true);
  check("and listed", INDEX.traits.includes("maneuvers/pin.dbu"), true);
  check("the entry is there whole", [
    PIN.includes("Pin Maneuver [1/Round]: Pin your Opponents, preventing escape!"),
    PIN.includes("with your Dice Score reduced by 1(bT)"),
    PIN.includes("You can only use this Maneuver if you are in a Grapple.")
  ], [true, true, true]);

  // No target, for the reason the Launch has none.
  check("it asks for no target", PIN.includes("requiresTarget: false"), true);

  const PINNER = { id: "pin", name: "Pin", pin: true };
  const holding = { name: "Tizi", system: { grapple: { partner: "Actor.x", role: "grappler" } } };
  const beingHeld = { name: "Tizi", system: { grapple: { partner: "Actor.x", role: "grappled" } } };
  const free = { name: "Tizi", system: { grapple: { partner: "", role: "" } } };

  check("the Grappler may Pin", whyNotPin(holding, PINNER), null);
  check("somebody in no Grapple may not",
    whyNotPin(free, PINNER).includes("not in a Grapple"), true);
  check("and neither may the Grappled",
    whyNotPin(beingHeld, PINNER).includes("is the Grappled, not the Grappler"), true);
  check("nothing else is refused by it", whyNotPin(free, { id: "grapple", grapple: true }), null);

  // Refused before anything is paid, and the partner resolved there too - the guard the
  // Launch needed is now the one both of them use.
  check("asked before anything is paid",
    USE.indexOf("const nobodyToPin") < USE.indexOf("maneuverKiCost(maneuver, declared, actor)"),
    true);
  check("and one guard covers both aiming Maneuvers",
    USE.includes("if ((maneuver.launch || maneuver.pin || maneuver.choke || maneuver.suplex)"), true);
  check("which opens the Check with the Grappler as its Initiator",
    USE.includes('kind: maneuver.pin ? "pin" : maneuver.choke ? "choke" : "launch"'), true);

  // --- The penalty on the first Clash ----------------------------------------------------
  // The category cut out and run again: the one above is inside a block of its own, and a
  // fixture reached across a block boundary is a fixture two sections share by accident.
  // The pair of rolls, keyed for what it rolls rather than for one of its two users: a
  // Clash of Strike answered by Strike or Dodge, which the Thrust Maneuver asks for too.
  // What makes a card a Grapple Check is `clash.grapple` and the label it is opened
  // with, and both of those are checked below.
  const from = CHAT.indexOf(`strike: {${String.fromCharCode(10)}    label: "Strike Clash",`);
  const to = CHAT.indexOf("\n});", from);
  const build = new Function("musclePenalty", "thresholdPenalty", "pick",
    "grappleDefenceParts", "grappleAllParts",
    `return ({${CHAT.slice(from, to).replace(/,?\s*$/, "")}}).strike;`);
  const grapple = build(
    () => [{ label: "Muscle Penalty", value: -4 }],
    () => [{ label: "Thresholds", value: -2 }],
    async () => null,
    // Nothing here is Liquid, so the Grappled bonus contributes nothing - which is the
    // point: the penalty this section is about is the one that was always there.
    () => [],
    // Four Witches Grip's - nobody here has it.
    () => []
  );

  // A Base Tier of 2, since the penalty this is about is written in (bT).
  const actor = {
    name: "Tizi",
    system: {
      combat: { strike: 12, dodge: 9 },
      dice: { extra: { formula: "2d6" }, critical: { formula: "1d6" } },
      tierOfPower: 3, baseTierOfPower: 2
    }
  };
  const clash = {
    challengerUuid: "Actor.a", defenderUuid: "Actor.b",
    defenderRoll: "", earlierAttempts: 0, defenderBonus: 0
  };

  // The only Grapple Check made at a penalty, and it is the Grappler's alone.
  const pinning = { ...clash, grapple: { kind: "pin" } };
  check("the Grappler's Dice Score is reduced by 1(bT)",
    grapple.parts(actor, pinning, "Actor.a").map(p => [p.label, p.value, p.written]),
    [["Muscle Penalty", -4, undefined], ["Thresholds", -2, undefined],
     ["Pinning", -2, "-1(bT)"]]);
  check("and the Grappled's is not",
    grapple.parts(actor, pinning, "Actor.b").map(p => p.label),
    ["Muscle Penalty", "Thresholds"]);
  check("nor is any other kind of Grapple Check",
    grapple.parts(actor, { ...clash, grapple: { kind: "start" } }, "Actor.a").map(p => p.label),
    ["Muscle Penalty", "Thresholds"]);

  // --- What each of the two leaves behind -------------------------------------------------
  const pinOutcome = CHAT.slice(
    CHAT.indexOf('if (clash.grapple.kind === "pin") {'),
    CHAT.indexOf('if (clash.grapple.kind === "pin-hold") {'));
  const holdOutcome = CHAT.slice(
    CHAT.indexOf('if (clash.grapple.kind === "pin-hold") {'),
    CHAT.indexOf('if (clash.grapple.kind === "launch") {'));

  // "If you lose either of these Clashes, they escape the Grapple." A tie is a loss in
  // both, the Defender taking one as everywhere else.
  check("losing the Grapple Check frees them", [
    pinOutcome.includes('winner !== "challenger"'),
    pinOutcome.includes("await endGrapple(grappler, grappled);")
  ], [true, true]);
  check("and losing the Might Clash frees them too", [
    holdOutcome.includes('winner !== "challenger"'),
    holdOutcome.includes("await endGrapple(grappler, grappled);")
  ], [true, true]);

  // Winning the first opens the second rather than doing anything itself.
  check("winning the first opens the Might Clash",
    pinOutcome.includes("await postMightClash(grappler, grappled, {"), true);
  check("which carries the Grapple, so one settlement reads both",
    pinOutcome.includes('grapple: { kind: "pin-hold", applied: false }'), true);
  check("and a Might Clash may carry one",
    CHAT.includes("...(grapple ? { grapple } : {}),"), true);
  check("which is what routes it to the same place",
    CHAT.includes("if (clash.grapple && clash.result && !clash.grapple.applied) {"), true);

  // Winning the second is the whole point.
  check("winning the second Pins them",
    holdOutcome.includes('await setCondition(grappled, "pinned", 1);'), true);
  check("and says it lasts as long as the Grapple",
    holdOutcome.includes("for as long as this Grapple lasts"), true);

  // --- "While in this Grapple" ----------------------------------------------------------------
  // Tied to the hold rather than to a clock, so it goes wherever a Grapple ends.
  const ending = CHAT.slice(CHAT.indexOf("export async function endGrapple("));
  check("ending a Grapple takes the Condition off",
    ending.slice(0, 1400).includes('await setCondition(actor, "pinned", 0);'), true);
  check("after they are out of it, like the Guard Down beside it",
    ending.indexOf("requestActorUpdate(actor, { ...NOT_GRAPPLING })")
      < ending.indexOf('setCondition(actor, "pinned", 0)'), true);

  // The Condition itself is one the library already had, written in full.
  const PINNED = fs.readFileSync(
    path.join(ROOT, "traits", "conditions", "pinned.dbu"), "utf8");
  check("and Pinned is a Condition the library knows",
    PINNED.includes("id: pinned"), true);
}

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
