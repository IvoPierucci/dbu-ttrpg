/**
 * Compelled: an Urgent Combat Roll, and the Ki Wager it forces.
 *
 * "All Combat Rolls for Attacking Maneuvers made against that target become Urgent",
 * and Urgent means a Willing Failure is forbidden. The forbid is written in a reactive
 * block, so it exists only at the moment a Combat Roll is made - which is exactly why
 * the dialog that offers the Willing Failure never saw it.
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

const TRAITS = path.join(ROOT, "traits");
globalThis.foundry.utils.fetchJsonWithTimeout = async () =>
  JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));
globalThis.fetch = async url => {
  const file = path.join(TRAITS, String(url).replace("systems/dbu-ttrpg/traits/", ""));
  if (!fs.existsSync(file)) return { ok: false, status: 404, statusText: "missing" };
  return { ok: true, text: async () => fs.readFileSync(file, "utf8") };
};

const { loadTraits } = await import(modUrl("effects/traits.mjs"));
await loadTraits();
const { programsFor } = await import(modUrl("effects/registry.mjs"));
const { applyPassives, collectReactive, applySlot } = await import(modUrl("effects/interpreter.mjs"));
const { reactiveFor } = await import(modUrl("effects/registry.mjs"));

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
const MANEUVERS = fs.readFileSync(path.join(ROOT, "module", "maneuvers.mjs"), "utf8");
// Both ways an attack is declared - from the sheet and out of sequence - checked one
// by one rather than concatenated, or patching a single path would pass for both.
const MANEUVER_CALLERS = [
  CHAT, fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8")
];

/** A character with the given Conditions, prepared as the data model prepares one. */
function prepared(conditions, { capacityMax = 74, lifeMax = 120, lifeValue = 120,
                                minion = false, attackActions = 0 } = {}) {
  const errors = [];
  const actor = { name: "Probe", items: [], system: { conditions } };
  const programs = programsFor(actor, { report: m => errors.push(m) });
  const data = {
    effects: { slots: {}, active: [], errors, programs },
    conditions, baseTierOfPower: 3, tierOfPower: 3, powerLevel: 12,
    capacity: { max: capacityMax, spent: 0 },
    life: { max: lifeMax, value: lifeValue },
    minion, attackActionsThisTurn: attackActions,
    skills: {}, attributes: {}, savingThrows: {}
  };
  const scope = { data, errors, benefitsFrom: () => false };
  for (const phase of ["tier", "core", "late"]) {
    Object.assign(data.effects.slots, applyPassives(programs, phase, scope).slots);
  }
  actor.system = { ...data, effects: data.effects };
  return { actor, slots: data.effects.slots, errors, programs };
}

/** What the reactive blocks come to at one moment, the way rollSide collects them. */
function atMoment(actor, moment, context = {}) {
  const scope = { data: actor.system, errors: [], context, queue: [] };
  return collectReactive(reactiveFor(actor), moment, scope);
}

// --- The passive half -------------------------------------------------------
{
  const { slots, errors } = prepared({ compelled: 1 });
  check("nothing is reported against Compelled", errors, []);
  check("you may not attack anyone else", slots.attacksOnOthers, false);
  // 74 / 10 = 7.4, rounded up. The rule says "(rounded up)" and means it: it is the
  // one place in the system that goes the other way from everything else.
  check("and must wager a tenth of Max Capacity, rounded up",
    slots["attack.kiWager.min"]?.set, 8);
}

// A tenth of nothing is nothing, and a tenth that divides evenly is not rounded up
// past itself.
check("an exact tenth is not rounded past itself",
  prepared({ compelled: 1 }, { capacityMax: 70 }).slots["attack.kiWager.min"]?.set, 7);

// --- The reactive half ------------------------------------------------------
// The forbid lives in `[automatic/combat-roll]`, so it does not exist on the sheet at
// all - only at the moment a Combat Roll is made. Both halves of an attack are Combat
// Rolls, so both are Urgent.
{
  const { actor, slots } = prepared({ compelled: 1 });
  check("the sheet alone does not forbid it", slots.willingFailure, undefined);

  // "All Combat Rolls **for Attacking Maneuvers**" - your own. A Strike and a Wound
  // Roll are those; a Dodge and a Parry are Combat Rolls made during somebody else's
  // Attacking Maneuver, and being Compelled drives you at your target rather than
  // making you careful about being hit.
  const mine = atMoment(actor, "combat-roll", { roll: true, attackingManeuver: true });
  check("your own attack is Urgent", mine.slots.willingFailure, false);

  const theirs = atMoment(actor, "combat-roll", { roll: true });
  check("but your defence against theirs is not", theirs.slots.willingFailure, undefined);
}

// Nothing forbids it for a character who is not Compelled, attacking or not.
{
  const { actor } = prepared({});
  check("an unaffected character may still fail on purpose",
    atMoment(actor, "combat-roll", { roll: true, attackingManeuver: true })
      .slots.willingFailure, undefined);
}

// --- Both halves have a reader ----------------------------------------------
// The forbid was refused at the roll and nowhere else, so the Willing Failure was
// offered, taken, silently ignored and left armed for the next roll.
check("the dialog asks the same question the roll will ask",
  CHAT.includes("whyNotWilling(actor, { urgent, combatRoll, attackingManeuver })"), true);
// The two have to agree, or the dialog closes an option the roll would have allowed.
check("and the attacker is the one making the Attacking Maneuver",
  CHAT.includes("attackingManeuver: attack?.attackerUuid === actor.uuid"), true);
// Three rolls are part of an attack you are making - the Strike, the Wound Roll and
// Combination's follow-ups - plus the two dialogs the attacker confirms them in.
// Power Flare answers a Wound Roll with a Wound Roll and is not among them: it is a
// defence, and marking it would make a defender's Compelled reach it. Hostile Chase's is
// the sixth: the attacker rolling the Wound of their own attack against themselves.
// The seventh is Homing's retry window - the same attacker's Strike, asked before it is rolled. The eighth and ninth,
// the Wound Roll at the God Meteor and its window: an attack of their own at it. The tenth, Focused Strike's reroll
// of the attacker's Strike.
check("only the attacker's own rolls are marked",
  (CHAT.match(/attackingManeuver: true/g) ?? []).length, 10);
check("the card says a roll was Urgent rather than dropping the choice",
  /outcome = "urgent";/.test(CHAT) && /refusedWilling/.test(CHAT), true);
check("and the declaration enforces the Ki Wager floor",
  /export function minimumKiWager/.test(MANEUVERS), true);

// --- Which Maneuvers the floor applies to ------------------------------------
// "On all Attacking Maneuvers" - and since Compelled also forbids attacking anyone
// but its target, that comes to every Attacking Maneuver you are able to make. What
// it is not is every Maneuver: a Crouch is not an attack and wagers nothing.
//
// The same shape as minimumKiWager, kept here so the arithmetic is checked and not
// only the fact that a function by that name exists.
const floorFor = (slots, maneuver, max) => {
  if (maneuver && !maneuver.attacking) return 0;
  return Math.max(0, Math.min(applySlot(slots, "attack.kiWager.min", 0), max));
};

const attack = { id: "basic-attack", attacking: true, profile: "any" };
// An Attacking Maneuver that names no Profile is still an attack, and still wagers.
const bare = { id: "signature", attacking: true, profile: "" };
const crouch = { id: "crouch", attacking: false, profile: "" };

{
  const { slots } = prepared({ compelled: 1 });
  check("the floor is what the Condition asks for", floorFor(slots, attack, 30), 8);
  check("an attack with no Profile is still an attack", floorFor(slots, bare, 30), 8);
  check("a Maneuver that is not an attack wagers nothing", floorFor(slots, crouch, 30), 0);
  check("but never more than can be paid", floorFor(slots, attack, 3), 3);
  check("and is nothing without the Condition",
    floorFor(prepared({}).slots, attack, 30), 0);
}

// The dialog has to be opened for it to be asked at all, and it used to be opened
// only for a Maneuver that named a Profile.
check("both ways of declaring an attack open it for every Attacking Maneuver",
  MANEUVER_CALLERS.map(file => /maneuver\.profile \|\| maneuver\.attacking/.test(file)),
  [true, true]);
check("and the floor is asked for the Maneuver, not just the character",
  /minimumKiWager\(actor, maneuver\)/.test(MANEUVERS), true);

// --- The end-of-turn Life Point loss -----------------------------------------
// "If you do not spend at least 2 Actions (1 Action if you are a Minion) making
// Attacking Maneuvers ... reduce your Life Points by 1/10 of your Maximum Life
// Points at the end of your turn."
//
// Counted in Actions, not in Maneuvers: one attack costing 2 Actions satisfies it by
// itself, which is what the rule says and not what "two attacks" would say.

/** What the character's Life ends the turn on, the way moments-runtime settles it. */
function endTurn(options) {
  const { actor } = prepared({ compelled: 1 }, options);
  const { slots } = atMoment(actor, "end-of-turn");
  const settled = applySlot(slots, "life.value", actor.system.life.value);
  return Math.max(0, Math.round(settled));
}

// 120 / 10 = 12.
check("no attacking at all costs a tenth of Max Life",
  endTurn({ attackActions: 0 }), 108);
check("one Action is not enough", endTurn({ attackActions: 1 }), 108);
check("two Actions are", endTurn({ attackActions: 2 }), 120);
check("and more than two is still enough", endTurn({ attackActions: 5 }), 120);

// A Minion is held to one.
check("a Minion needs only one Action",
  endTurn({ attackActions: 1, minion: true }), 120);
check("but still needs that one",
  endTurn({ attackActions: 0, minion: true }), 108);

// Fractions round down, as everywhere the rules do not say otherwise.
check("a tenth that does not divide evenly rounds down",
  endTurn({ attackActions: 0, lifeMax: 105, lifeValue: 105 }), 95);

// The loss is a tenth of Max Life taken off current Life - being hurt already does
// not change what the tenth is.
check("the tenth is of Max Life, taken off current Life",
  endTurn({ attackActions: 0, lifeValue: 40 }), 28);

// And it never takes you below nothing.
check("it stops at nothing", endTurn({ attackActions: 0, lifeValue: 5 }), 0);

// Nobody else pays it.
{
  const { actor } = prepared({});
  const { slots } = atMoment(actor, "end-of-turn");
  check("a character who is not Compelled loses nothing",
    applySlot(slots, "life.value", 120), 120);
}

// --- The counter is kept, counted into, and reset ----------------------------
const MODEL = fs.readFileSync(path.join(ROOT, "module", "data", "actor-character.mjs"), "utf8");
const COMBAT = fs.readFileSync(path.join(ROOT, "module", "combat.mjs"), "utf8");

check("the counter exists on the character", /schema.attackActionsThisTurn/.test(MODEL), true);
check("an attack counts the Actions it took",
  /"system.attackActionsThisTurn": actor.system.attackActionsThisTurn/.test(CHAT), true);
// Order matters and is the whole reason this is checked: zeroed before the moment,
// the moment reads nothing and every turn costs a tenth of your Life.
check("and the end of the turn zeroes it only after the moment has read it",
  COMBAT.indexOf('fireMoment(leaving, "end-of-turn")') <
    COMBAT.indexOf('"system.attackActionsThisTurn": 0'), true);

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
