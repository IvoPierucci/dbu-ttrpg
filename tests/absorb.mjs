/**
 * The Attack Absorption Maneuver: the other thing that can be done with a caught attack.
 *
 * Two halves worth running. The first is the pair it forms with Reflect - offered from the
 * same moment, exclusive with it, and differing on the one clause that is easiest to
 * assume matches: Reflect refuses an Area of Effect and this does not.
 *
 * The second is the arithmetic, which is the whole of what the Maneuver is worth: half a
 * Dice Score, capped by the room there was to put it, and a fifth measured against that
 * capped amount. So `settleAbsorption` is run for real rather than read.
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
// use-maneuver.mjs reaches the character data model, which is built of DataFields.
globalThis.foundry.data = { ...await import(appUrl("common/data/_module.mjs")) };
globalThis.foundry.data.operators = { ForcedReplacement: { create: value => value } };
const { default: DataModel } = await import(appUrl("common/abstract/data.mjs"));
globalThis.foundry.abstract = { DataModel, TypeDataModel: DataModel };
globalThis.ui = { notifications: { warn: () => {}, error: () => {}, info: () => {} } };
globalThis.Handlebars = { escapeExpression: String };
globalThis.game = { combat: null };

const TRAITS = path.join(ROOT, "traits");
globalThis.foundry.utils.fetchJsonWithTimeout = async () =>
  JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));
globalThis.fetch = async url => {
  const file = path.join(TRAITS, String(url).replace("systems/dbu-ttrpg/traits/", ""));
  if (!fs.existsSync(file)) return { ok: false, status: 404, statusText: "missing" };
  return { ok: true, status: 200, text: async () => fs.readFileSync(file, "utf8") };
};

const { loadTraits } = await import(modUrl("effects/traits.mjs"));
const { loadManeuvers, getManeuver, maneuverKiCost, whyNotSpecial, PROFILES } =
  await import(modUrl("maneuvers.mjs"));
const { maneuverItemFrom, definitionOf } = await import(modUrl("use-maneuver.mjs"));
await loadTraits();
await loadManeuvers();

const TRAIT = fs.readFileSync(path.join(TRAITS, "maneuvers", "attack-absorption.dbu"), "utf8");
const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
const INDEX = JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

/**
 * One function out of chat.mjs, to be run rather than read.
 *
 * Sliced to the first closing brace in the first column, which is where a top-level
 * function ends and nothing inside one ever is.
 */
function source(name) {
  let at = CHAT.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`chat.mjs has no ${name}`);
  // Back over the `async`, which is part of the declaration. Without it the text compiles
  // as an ordinary function and every `await` inside is a syntax error - which is how this
  // reported a broken harness where the function was fine.
  if (CHAT.slice(at - 6, at) === "async ") at -= 6;
  const end = CHAT.indexOf("\n}\n", at);
  return CHAT.slice(at, end + 2);
}

// --- The Maneuver as the rulebook lists it ---------------------------------------------------
{
  check("listed", INDEX.traits.includes("maneuvers/attack-absorption.dbu"), true);

  const absorb = getManeuver("attack-absorption");
  check("loaded", Boolean(absorb), true);
  check("as an Out-of-Sequence Maneuver", absorb.type, "outOfSequence");
  check("with no Action Cost, which is what N/A means here", absorb.actionCost, 0);
  check("and no KP Cost either", maneuverKiCost(absorb, null,
    { system: { tierOfPower: 4, effects: { slots: {} } } }), 0);
  check("it is not an Attacking Maneuver", Boolean(absorb.attacking), false);
  check("and aims at nobody: what it answers is already on the card",
    Boolean(absorb.requiresTarget), false);
  check("it is Special", absorb.special, true);
  check("and carries the flag the offer machinery reads", absorb.absorb, true);
  check("with no limit on how often, since the entry names none",
    absorb.usageLimit ?? null, null);

  // The entry, whole. The parenthetical is the half easiest to drop and the half that
  // decides what happens next.
  for (const line of [
    "If you use the Parry option of the Defend Maneuver to successfully avoid an",
    "Attacking Maneuver of the Energy or Magic Foundation",
    "you cannot use\n  the Reflect Maneuver in response to the successful Parry",
    "Your Opponent makes an\n  Urgent Wound Roll for their Attacking Maneuver as if you were hit",
    "you regain Ki\n  Points equal to 1/2 of the Dice Score",
    "If you regain Ki Points that equal or exceed 1/5 of your Maximum Ki Points through",
    "you may use the Power Up Maneuver as an Out-of-Sequence Maneuver"
  ]) {
    check(`the entry says "${line.slice(0, 44).replace(/\n\s+/g, " ")}"`,
      TRAIT.includes(line), true);
  }

  // It travels onto a character and into the compendium, which is two lists a flag added
  // to the schema alone would be missing from.
  const item = maneuverItemFrom(absorb);
  check("the Item carries the flag", item.system.absorb, true);
  check("and reading it back gives it up again", definitionOf({
    id: "x", name: absorb.name, system: { ...item.system, maneuverId: absorb.id }
  }).absorb, true);
  check("it is a Core Rule Maneuver, so every character gets one", absorb.source, "Core Rule");
}

// --- Nobody has it until something gives it to them ------------------------------------------
{
  const absorb = getManeuver("attack-absorption");
  const who = (slots = {}, skills = []) => ({
    name: "Tizi",
    system: { effects: { slots }, specialManeuvers: skills }
  });

  check("closed with nothing granting it",
    whyNotSpecial(who(), absorb),
    "Tizi has not been granted access to Attack Absorption. A Special Maneuver is gained "
    + "through an effect.");
  check("and no Skill opens this one, so the reason does not name one",
    who().system.specialManeuvers.length, 0);
  check("an effect opens it",
    whyNotSpecial(who({ "maneuver.attack-absorption": true }), absorb), null);
  check("and a forbid closes it again",
    whyNotSpecial(who({ "maneuver.attack-absorption": false }), absorb),
    "Something is keeping Tizi from using Attack Absorption.");
}

// --- Which attacks can be swallowed, and the clause Reflect has that this has not ------------
{
  const whyNotAbsorb = new Function(`${source("whyNotAbsorb")}\nreturn whyNotAbsorb;`)();
  const attackArea = new Function("PROFILES",
    `${source("attackArea")}\nreturn attackArea;`)(PROFILES);
  const whyNotReflect = new Function("PROFILES", "attackArea",
    `${source("whyNotReflect")}\nreturn whyNotReflect;`)(PROFILES, attackArea);

  const plain = Object.keys(PROFILES).find(key => !PROFILES[key].area);
  const area = Object.keys(PROFILES).find(key => PROFILES[key].area);
  check("there is a Profile with an Area to test against", Boolean(area), true);

  check("an Energy attack can be absorbed",
    whyNotAbsorb({ foundation: "energy", profile: plain }), null);
  check("and a Magic one", whyNotAbsorb({ foundation: "magic", profile: plain }), null);
  check("a Physical attack cannot",
    whyNotAbsorb({ foundation: "physical", profile: plain }),
    "only an Energy or Magic Attack can be absorbed");

  // The difference between the two entries, which is a paragraph apart in the rulebook and
  // easy to assume away. One refuses an Area of Effect and the other says nothing about it.
  check("an Area attack can be absorbed",
    whyNotAbsorb({ foundation: "energy", profile: area }), null);
  check("where the same attack cannot be thrown back",
    whyNotReflect({ foundation: "energy", profile: area }),
    "an Attacking Maneuver with an Area of Effect cannot be thrown back");
}

// --- Offered from the Parry, beside the Reflect -----------------------------------------------
{
  // The one door the entry names. Reflect has two - a won Parry and a won Might Clash on a
  // Deflect - and this has only the first.
  check("offered where a Parry turned an attack aside",
    CHAT.includes('offerAbsorb(message, attack, target, "Attack Absorption - your Parry '
      + 'turned it aside");'), true);
  check("beside the Reflect, on the same won Parry",
    CHAT.indexOf('offerReflect(message, attack, target, "Reflect - your Parry turned it aside");')
      < CHAT.indexOf("offerAbsorb(message, attack, target,"), true);
  check("both inside the loop over Parries that were not hit",
    CHAT.indexOf('if ((own?.defense !== "parry") || own.hit) continue;')
      < CHAT.indexOf("offerAbsorb(message, attack, target,"), true);
  check("and offered from nowhere else but a Parry made a Critical by Artful Strike",
    (CHAT.match(/\n\s+offerAbsorb\(message/g) ?? []).length, 3);
  check("where Reflect is offered from three places (one an Artful Strike Parry)",
    (CHAT.match(/\n\s+offerReflect\(message/g) ?? []).length, 4);

  // Only to somebody who holds it, and only when it has been opened: an offer nobody may
  // take is worse than no offer.
  check("only to somebody who has the Maneuver",
    CHAT.includes('const item = actor.items?.find(entry => (entry.type === "maneuver") '
      + "&& entry.system.absorb);"), true);
  check("and only when it is open to them",
    CHAT.includes("if (!maneuver || whyNotSpecial(actor, maneuver)) return;"), true);
  check("asked of the library by the Item's own id rather than by a name written here",
    CHAT.includes("const maneuver = getManeuver(item.system.maneuverId || item.id);"), true);
}

// --- One opening, and two things it could have been -------------------------------------------
{
  // "Therefore you cannot use the Reflect Maneuver in response to the successful Parry."
  // Nothing was written for this: one Out-of-Sequence Maneuver per character per card is a
  // rule the offer machinery already keeps, and taking either of these closes the other.
  check("what has been taken is recorded per character",
    CHAT.includes("const taken = takenOffers(message);\n  await message.setFlag(SCOPE, "
      + "OOS_TAKEN_FLAG, [...new Set([...taken, actorUuid])]);"), true);
  check("and an offer is only usable by somebody who has taken none",
    CHAT.includes("if (!taken.includes(offer.actorUuid) && actor?.isOwner && ![\"pending\", \"won\"].includes(dodged)) {"), true);
  check("taking one marks the card",
    CHAT.includes('requestEdit(message, { type: "offerTaken", actorUuid: actor.uuid });'), true);
}

// --- A Special Maneuver is Special whichever door it comes through ------------------------------
{
  check("the Out-of-Sequence door refuses one that is closed",
    CHAT.includes("  const closed = whyNotSpecial(actor, maneuver);\n"
      + "  // Unless the effect handing it over gives it - Down Burst's \"you may use the Soar Maneuver\".\n"
      + "  if (closed && !offer.grantsAccess) {\n    ui.notifications.warn(closed);\n    return;\n  }"), true);
  // Asked before anything is paid for, which is the only place it is worth asking.
  check("before the Ki is spent",
    CHAT.indexOf("const closed = whyNotSpecial(actor, maneuver);")
      < CHAT.indexOf("if (price && !fromStore && !await spendManeuverCost(actor, maneuver, price)) return;"),
    true);
}

// --- The Wound Roll it asks for -----------------------------------------------------------------
{
  const owesWound = new Function("deflection", "anyoneHit",
    `${source("owesWound")}\nreturn owesWound;`)(
      attack => attack.deflected ?? null, attack => Boolean(attack.hit));

  check("an attack that hit nobody owes no Wound Roll", owesWound({}), false);
  check("one that hit somebody does", owesWound({ hit: true }), true);
  check("an Absolute Attack owes one having missed", owesWound({ absolute: true }), true);

  // "As if you were hit." There was no hit, and the roll is owed anyway - which is the
  // whole of what the absorber is buying.
  check("and an absorbed one owes it having hit nobody",
    owesWound({ absorbed: { uuid: "Actor.tizi" } }), true);
  check("but not when a Deflect turned the whole thing aside first",
    owesWound({ absorbed: { uuid: "Actor.tizi" }, deflected: { name: "Kuro" } }), false);

  // Theirs, not the absorber's: "your Opponent makes an Urgent Wound Roll for their
  // Attacking Maneuver". Nothing sets woundBy, so the roll stays with whoever struck.
  const woundRoller = new Function("fromUuidSync",
    `${source("woundRoller")}\nreturn woundRoller;`)(uuid => uuid);
  check("the roll belongs to whoever threw the attack",
    woundRoller({ attackerUuid: "Actor.striker", absorbed: { uuid: "Actor.tizi" } }),
    "Actor.striker");

  check("and it is Urgent", CHAT.includes("      urgentWound: true"), true);
  check("which is the flag the roll already reads",
    CHAT.includes("      urgent: Boolean(attack.urgentWound || attack.urgentRolls),"), true);
  check("said on the button too", CHAT.includes("} else if (attack.absorbed) {"), true);
}

// --- What it pays -------------------------------------------------------------------------------
{
  const actors = {};
  const updates = [];
  const offers = [];

  const settleAbsorption = new Function(
    "fromUuidSync", "requestActorUpdate", "ChatMessage", "checkCard", "requestEdit",
    `${source("settleAbsorption")}\nreturn settleAbsorption;`)(
      uuid => actors[uuid] ?? null,
      (actor, changes) => { updates.push([actor.uuid, changes]); },
      { create: async () => ({ id: "card1" }), getSpeaker: () => ({}) },
      () => "",
      (message, request) => { offers.push(request); });

  const run = async (wound, value, max) => {
    updates.length = 0;
    offers.length = 0;
    actors["Actor.tizi"] = { uuid: "Actor.tizi", name: "Tizi", system: { ki: { value, max } } };
    const settled = await settleAbsorption(
      {}, { absorbed: { uuid: "Actor.tizi", name: "Tizi", maneuverName: "Ki Blast" } },
      { total: wound });
    return { settled, updates: [...updates], offers: [...offers] };
  };

  // "Ki Points equal to 1/2 of the Dice Score", rounded down as every half here is.
  let out = await run(30, 0, 100);
  check("half the Dice Score comes back", out.settled.regained, 15);
  check("and is written to the character", out.updates,
    [["Actor.tizi", { "system.ki.value": 15 }]]);

  out = await run(31, 0, 100);
  check("an odd Dice Score rounds down", out.settled.regained, 15);

  // What is regained is what there was room for.
  out = await run(40, 98, 100);
  check("a character nearly full regains only the room they had", out.settled.regained, 2);
  check("and is not taken past their maximum", out.updates,
    [["Actor.tizi", { "system.ki.value": 100 }]]);
  out = await run(40, 100, 100);
  check("a character at full regains nothing", out.settled.regained, 0);

  // "Equal or exceed 1/5 of your Maximum Ki Points", against the Ki that actually came
  // back rather than against the half the roll would have paid.
  out = await run(40, 0, 100);
  check("exactly a fifth of the maximum opens the Power Up",
    [out.settled.regained, out.settled.fifth], [20, true]);
  check("offered as one", out.offers.map(entry => entry.offer.maneuverId), ["power-up"]);
  check("to the one who absorbed it", out.offers[0].offer.actorUuid, "Actor.tizi");

  out = await run(38, 0, 100);
  check("a point short of a fifth does not", out.settled.fifth, false);
  check("and nothing is offered", out.offers, []);

  // The capped amount is what is measured, so a character with no room gets no Power Up
  // however large the roll was.
  out = await run(200, 99, 100);
  check("a huge absorption into one point of room is one point", out.settled.regained, 1);
  check("and opens nothing", out.settled.fifth, false);

  // No rounding was invented: a fifth of 23 is 4.6, and 5 clears it where 4 does not.
  out = await run(8, 0, 23);
  check("four of a maximum of 23 is short of a fifth",
    [out.settled.regained, out.settled.fifth], [4, false]);
  out = await run(10, 0, 23);
  check("and five clears it", [out.settled.regained, out.settled.fifth], [5, true]);

  check("the Power Up is offered on a card of its own, not on the attack",
    CHAT.includes('    requestEdit(card, {\n      type: "offer",'), true);
  check("and what the absorption came to is written back onto the attack",
    CHAT.includes("      ...(absorbed ? { absorbed } : {}),"), true);
}

// --- The row the card grows ----------------------------------------------------------------------
{
  const absorbRow = new Function(`${source("absorbRow")}\nreturn absorbRow;`)();

  check("an attack nobody absorbed grows no row", absorbRow({}), "");

  const owed = absorbRow({ absorbed: { name: "Tizi", maneuverName: "Ki Blast", regained: null } });
  check("one that was absorbed says who", owed.includes("Tizi"), true);
  check("and says the roll is still owed rather than saying it paid nothing",
    owed.includes("awaiting the Wound Roll"), true);
  check("a zero is not mistaken for that",
    absorbRow({ absorbed: { name: "Tizi", maneuverName: "Ki Blast", regained: 0 } })
      .includes("+0 KP"), true);
  check("and what it paid is said once it is known",
    absorbRow({ absorbed: { name: "Tizi", maneuverName: "Ki Blast", regained: 15 } })
      .includes("+15 KP"), true);
  check("the fifth is said where it was reached",
    absorbRow({ absorbed: { name: "Tizi", maneuverName: "Ki Blast", regained: 20, fifth: true } })
      .includes("a fifth of their maximum Ki"), true);
  check("drawn on the attack card", CHAT.includes("    ${absorbRow(attack)}"), true);
}

// --- The script an offered Maneuver never ran ------------------------------------------------------
{
  // The Power Up this hands over is the first offered Maneuver with a script of its own,
  // and the Out-of-Sequence door fired nothing: it posted the card and stopped. The same
  // gap swallowed a Maneuver held by Triggered and released later.
  check("Power Up has a script to run",
    getManeuver("power-up").script.includes("power.stacks += 1"), true);
  check("the Out-of-Sequence door fires it",
    CHAT.includes('await fireMoment(actor, "on-used", {'), true);
  check("scoped to the character's own copy of that Maneuver",
    CHAT.includes("    }, { only: own.id, quiet: true }))?.slots;"), true);
  check("found by the Maneuver's id rather than by the Item's",
    CHAT.includes('(item.type === "maneuver") && ((item.system.maneuverId || item.id) '
      + "=== maneuver.id)"), true);

  // A Maneuver they do not hold - Cross Counter's Basic Attack - has no script of theirs,
  // and firing this unscoped would run every `on used` they own.
  check("and nothing is fired for a Maneuver they do not hold",
    CHAT.includes("  if (own) {\n    const { fireMoment } ="), true);

  // What the script is told was paid. Nothing, out of sequence - unless it is a Maneuver
  // they held, where the Actions went in when they held it: "delay its use but pay the
  // Action Cost and KP Cost immediately".
  check("a script is told what was paid",
    CHAT.includes("      actionsSpent: Number(granted?.actionsSpent) || heldActions,"), true);
  check("which is nothing for an offer that was not held",
    CHAT.includes("const heldActions = offer.free ? (actor.system.delayed?.actions ?? 0) : 0;"),
    true);
  check("read before the holding is let go of, since that is what clears it",
    CHAT.indexOf("const heldActions = offer.free")
      < CHAT.indexOf("const { dropDelayed } = await import"), true);
  check("and there is a Maneuver whose whole effect is one stack per Action",
    getManeuver("combat-recovery").script.includes("recovery.stacks += actionsSpent;"), true);

  // The tally, which a held Maneuver already paid: "delay its use but pay the Action Cost
  // and KP Cost immediately" was the use, and it was counted then.
  check("a use is recorded",
    CHAT.includes("  if (!offer.free) await recordManeuverUse(actor, maneuver);"), true);
  check("and Power Up has a limit for that to matter to",
    getManeuver("power-up").usageLimit, { amount: 2, per: "round" });
}

// --- The swallow itself ---------------------------------------------------------------------------
{
  check("taking it goes to the swallow rather than to an attack",
    CHAT.includes("  if (maneuver.absorb) return absorbAttack(message, actor, maneuver);"), true);
  check("and it posts no Maneuver card of its own",
    CHAT.includes("async function absorbAttack(message, actor, maneuver) {"), true);
  check("it writes the absorption onto the attack",
    CHAT.includes("      absorbed: {\n        uuid: actor.uuid,"), true);
  check("once, so a second click changes nothing",
    CHAT.includes("  if (!attack || attack.absorbed) return;"), true);
  check("and says at the table what is now owed",
    CHAT.includes("rolls its Wound `\n    + `Roll as if it had hit"), true);
}

console.log(`${failed} failing`);
process.exit(failed ? 1 : 0);
