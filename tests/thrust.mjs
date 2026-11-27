/**
 * The Thrust Maneuver, and the Clash machinery it needed.
 *
 * Three things are checked by running them rather than by reading the source, because
 * all three are the kind of thing that looks right on the page:
 *
 *   - which of the four kinds each Clash is, which two readers had been guessing at
 *   - a duration one character keeps over a Condition on another, which is what
 *     "until the end of YOUR turn" means when it is said about somebody else
 *   - the Saving Throw Clash, both sides choosing, which is the first of its category
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
const { loadManeuvers, getManeuver } = await import(modUrl("maneuvers.mjs"));
await loadTraits();
await loadManeuvers();

const { EDGES, KINDS, lasting, edgeReached } = await import(modUrl("durations.mjs"));

const TRAIT = fs.readFileSync(path.join(TRAITS, "maneuvers", "thrust.dbu"), "utf8");
const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
const USE = fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8");
const SHEET = fs.readFileSync(
  path.join(ROOT, "module", "sheets", "actor-character-sheet.mjs"), "utf8");
const INDEX = JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

// --- The Maneuver as the rulebook lists it ----------------------------------------------------
{
  check("listed", INDEX.traits.includes("maneuvers/thrust.dbu"), true);

  const thrust = getManeuver("thrust");
  check("loaded as a Standard Maneuver", thrust?.type, "standard");
  check("costing 1 Action and no Ki", [thrust.actionCost, thrust.kiCost], [1, 0]);
  check("once a Combat Round", thrust.usageLimit, { amount: 1, per: "round" });
  check("aimed at somebody", thrust.requiresTarget, true);
  check("and giving no opening", thrust.exploitable, "");
  // Not an Attacking Maneuver: it makes no Strike Roll against a Dodge and no Wound
  // Roll, so Diminishing Offense and the attack discounts have nothing to do with it.
  check("not an Attacking Maneuver", thrust.attacking, false);

  check("the entry is there whole", [
    thrust.text.includes("Thrust Maneuver [1/Round]: You strike an Opponent"),
    thrust.text.includes("make a Clash (Strike vs Strike/Dodge) against them"),
    thrust.text.includes("equal to 1/2 of your Might"),
    thrust.text.includes("Double any Collision Damage they suffer due to this movement."),
    thrust.text.includes("Make a second Clash (Impulsive/Corporeal)"),
    thrust.text.includes("Guard Down Combat Condition until the end of your turn.")
  ], [true, true, true, true, true, true]);

  // Both options are printed as their own lines, which is how the rulebook prints them
  // and how the row lays them out.
  const lines = thrust.text.split("\n");
  check("Push Back and Knock Prone each open a line of their own", [
    lines.some(line => line.startsWith("* Push Back.")),
    lines.some(line => line.startsWith("* Knock Prone."))
  ], [true, true]);
}

// --- Which of the four each Clash is ------------------------------------------------------------
{
  // `clash.category` names the pair of rolls; the four kinds are a different list, and
  // two readers had been asking the first for the second. A Grapple Check is Strike
  // against Strike or Dodge - Combat Rolls both - and said it was not a Combat Roll, so
  // Compelled's "your Combat Rolls are Urgent" could never reach one.
  const from = CHAT.indexOf("const CLASH_ROLLS = ({");
  // Down to the question-asker, so the alias, the freeze and the two helpers the save
  // pair leans on all come with it.
  const to = CHAT.indexOf(" * Two buttons and a question") - 4;
  const table = new Function("DBUCharacterData", "musclePenalty", "thresholdPenalty", "pick", "uniqueNatural",
    `${CHAT.slice(from, to)}\nreturn CLASH_ROLLS;`)(
      {}, () => [], () => [], async () => null, () => 0);

  check("every pair says which of the four it is",
    Object.fromEntries(Object.keys(table).map(key => [key, table[key].family])),
    { skill: "skill", might: "might", strike: "combat", wrestle: "might", save: "save", grapple: "combat" });

  // The old key still resolves, because cards posted before the rename are still in
  // people's chat logs and an unknown key falls back to Skill Clash.
  check("the old name still resolves to the same pair", table.grapple, table.strike);

  check("and the two readers ask the pair rather than the field", [
    CHAT.includes("return Boolean(clash) && (clashFamily(clash) === \"combat\");"),
    CHAT.includes("category: clashFamily(clash),")
  ], [true, true]);

  // A Grapple Check is still called one on its card; the pair underneath is not named
  // after it any more.
  check("a Grapple Check still says Grapple Check",
    CHAT.includes('clashLabel: "Grapple Check",'), true);
  check("and the card prefers its own label",
    CHAT.includes("Handlebars.escapeExpression(clash.clashLabel\n          ?? CLASH_ROLLS[clash.category ?? \"skill\"].label)"),
    true);
}

// --- A Clash of Saving Throws, both sides choosing ------------------------------------------------
{
  const from = CHAT.indexOf("const CLASH_ROLLS = ({");
  // Down to the question-asker, so the alias, the freeze and the two helpers the save
  // pair leans on all come with it.
  const to = CHAT.indexOf(" * Two buttons and a question") - 4;
  let asked = null;
  const table = new Function("DBUCharacterData", "musclePenalty", "thresholdPenalty", "pick", "uniqueNatural",
    `${CHAT.slice(from, to)}\nreturn CLASH_ROLLS;`)(
      {}, () => [], () => [],
      async (title, question, buttons) => { asked = { title, question, buttons }; return "corporeal"; }, () => 0);

  const save = table.save;
  const actor = uuid => ({
    uuid,
    name: uuid,
    system: {
      dice: { critical: { formula: "2d10" } },
      savingThrows: {
        impulsive: { label: "Impulsive", value: 6, criticalTarget: 10 },
        corporeal: { label: "Corporeal", value: 9, criticalTarget: 9 }
      }
    }
  });

  const clash = { saves: ["impulsive", "corporeal"], challengerUuid: "A", defenderUuid: "B",
                  maneuverName: "Thrust" };

  // With nothing picked yet, the first named Saving Throw stands in - a card mid-flight
  // still has to draw a number beside each name.
  check("each side answers with what they picked",
    [save.of(actor("A"), { ...clash, challengerSave: "corporeal" }, "A").label,
     save.of(actor("B"), { ...clash, defenderSave: "impulsive" }, "B").label],
    ["Corporeal", "Impulsive"]);
  check("and the value comes with it",
    save.of(actor("A"), { ...clash, challengerSave: "corporeal" }, "A").value, 9);

  // A racial Saving Throw crits one point more easily, which the data model works out
  // per Saving Throw and nothing had ever read.
  check("the Critical Target is the Saving Throw's own",
    [save.options(actor("A"), { ...clash, challengerSave: "corporeal" }, "A").criticalTarget,
     save.options(actor("A"), { ...clash, challengerSave: "impulsive" }, "A").criticalTarget],
    [9, 10]);
  check("and effects reach the one that was answered with",
    save.options(actor("B"), { ...clash, defenderSave: "corporeal" }, "B").slot,
    "save.corporeal");

  check("the button names both, since either may be picked",
    save.prompt(actor("A"), clash, "A"), "Impulsive or Corporeal");

  // Both sides are asked, not only the Defender: where the rule offers a choice it
  // offers it to whoever is rolling.
  check("the challenger is asked", await save.choose(clash, actor("A")),
    { challengerSave: "corporeal" });
  check("and so is the defender", await save.choose(clash, actor("B")),
    { defenderSave: "corporeal" });
  check("with both Saving Throws on the buttons",
    asked.buttons.map(b => b.action), ["impulsive", "corporeal"]);
  check("each showing what it is worth to this character",
    asked.buttons.map(b => b.label), ["Impulsive 6", "Corporeal 9"]);

  // Named one only, nothing is asked - there is nothing to choose between.
  check("one Saving Throw named is no question",
    await save.choose({ ...clash, saves: ["corporeal"] }, actor("A")), {});
}

// --- A clock one character keeps over another -----------------------------------------------------
{
  // "They suffer from the Guard Down Combat Condition until the end of YOUR turn." The
  // Condition is theirs and the turns counted are yours, and every duration before this
  // one was somebody's own on both counts.
  const held = { conditions: {}, states: {}, resources: {}, timed: [] };
  // Owned, so `setCondition` writes rather than relaying the change to a GM that is not
  // here - the relay is the right path in a real game and has nothing to test here.
  const makeActor = (uuid, store) => ({
    uuid,
    name: uuid,
    isOwner: true,
    system: store,
    async update(changes) {
      for (const [key, value] of Object.entries(changes)) {
        if (key === "system.timed") store.timed = [...value];
        if (key === "system.conditions") store.conditions = { ...value };
      }
    },
    items: []
  });

  const targetStore = { conditions: { "guard-down": 1 }, states: {}, resources: {}, timed: [] };
  const thruster = makeActor("Actor.thruster", held);
  const target = makeActor("Actor.target", targetStore);
  globalThis.fromUuidSync = uuid => (uuid === target.uuid) ? target : thruster;

  await lasting(thruster, {
    kind: KINDS.CONDITION, key: "guard-down", edge: EDGES.END,
    on: target.uuid, source: "Thrust"
  });

  check("the clock is kept by whoever's turn it counts", held.timed.length, 1);
  check("and nothing is put on the character it is about", targetStore.timed.length, 0);
  check("the entry names them", held.timed[0].on, target.uuid);

  await edgeReached(thruster, EDGES.END);
  // Taken off, which is the key gone rather than a zero left behind - `setCondition` at
  // nothing removes it, the way a Resource at nothing is removed.
  check("their turn ending takes it off the other character",
    Number(targetStore.conditions["guard-down"]) || 0, 0);
  check("and they are carrying nothing at all now", targetStore.conditions, {});
  check("and the clock is spent", held.timed.length, 0);

  // Every other duration is somebody's own, and says nothing about anybody.
  await lasting(thruster, { kind: KINDS.CONDITION, key: "shaken", edge: EDGES.END,
    on: thruster.uuid, source: "x" });
  check("a duration over yourself names nobody", "on" in held.timed[0], false);
}

// --- What the Maneuver does, and where -------------------------------------------------------------
{
  check("using it opens the Thrust Clash",
    USE.includes("    : maneuver.thrust\n    ? await postThrust(actor, targetActor, maneuver)"), true);
  check("after checking they are in Melee Range",
    USE.includes('whyNotWithinMelee(actor, targetActor, "The Thrust Maneuver")'), true);
  check("and the range check comes before anything is paid",
    USE.indexOf("The Thrust Maneuver\")")
      < USE.indexOf("if (!fromStore && !await spendManeuverCost(actor, maneuver, moving.fromSelf)) return false;"), true);

  // The same pair of rolls as a Grapple Check, opened under its own name.
  check("it is a Strike Clash", CHAT.includes('category: "strike",\n          clashLabel: "Thrust",'), true);
  check("with no collision armed until Push Back is chosen",
    CHAT.includes("          collision: null,\n          collisionApplied: false,\n          thrust: {"),
    true);

  // Losing does nothing: the entry says what winning buys and says nothing else.
  check("losing the Clash does nothing but say so",
    CHAT.includes('await settledNote(message, `${target.name} holds their ground.`);'), true);

  // Push Back: half the Might, floored, and the collision doubled.
  check("Push Back is half the Might, rounded down",
    CHAT.includes("Math.floor(Math.max(0, thruster.system.might ?? 0) / 2)"), true);
  check("and doubles the collision",
    CHAT.includes('collision: { doubles: true, doubledBy: "Push Back" }'), true);

  // Knock Prone: a second Clash, landing either way.
  check("Knock Prone opens a Clash of both Saving Throws",
    CHAT.includes('saves: ["impulsive", "corporeal"],'), true);
  check("winning it knocks them Prone",
    CHAT.includes('await setCondition(target, "prone", 1);'), true);
  check("and losing it still leaves them Guard Down", [
    CHAT.includes('await setCondition(target, "guard-down", 1);'),
    CHAT.includes("      on: target.uuid,\n      source: \"Thrust\"")
  ], [true, true]);

  // The choice is offered on the card, to the winner, once.
  check("the choice is drawn for whoever won it",
    CHAT.includes('if ((clash.thrust?.stage === "strike") && wonIt && !clash.thrust.chosen'), true);
  check("as the two effects the entry names",
    [CHAT.includes('["push", "Push Back"'), CHAT.includes('["prone", "Knock Prone"')],
    [true, true]);
  check("and a Thrust Clash settles once, like a Grapple Check",
    CHAT.includes("if (clash.thrust && clash.result && !clash.thrust.applied) {"), true);
}

// --- The racial Saving Throw that crits one point more easily ------------------------------------------
{
  // Worked out per Saving Throw since they were built, and read by nothing: rolling one
  // from the sheet used the character's ordinary Critical Target.
  check("the sheet's Saving Throw button passes its own Critical Target",
    SHEET.includes("      criticalTarget: save.criticalTarget"), true);
  check("and the roll takes one",
    SHEET.includes('await evaluateCheck(this.actor, bonus, "", null, { criticalTarget, naturalAdd,'), true);
  // `combatRoll` joined the options when Vile Weather gave Combat Rolls a Botch Range of
  // their own. A Saving Throw is not one, so the sheet leaves it at its default.
  check("in the position evaluateCheck reads it from",
    /export async function evaluateCheck\(actor, bonus, extraDice = "", baseDie = null,\s*\n\s*\{ minimumNatural = 0, criticalTarget = null,\s*\n\s*combatRoll = false, naturalAdd = 0, wound = false, twice = false \} = \{\}\)/
      .test(CHAT), true);
  check("and a Saving Throw does not claim to be a Combat Roll",
    SHEET.includes('await evaluateCheck(this.actor, bonus, "", null, { criticalTarget, combatRoll'),
    false);
}

// --- What is not built, and the one thing the entry leaves open -------------------------------------------
{
  check("the movement is left to the table", TRAIT.includes("this system moves nobody"), true);
  check("the half is read as rounded down, and says why",
    TRAIT.includes("read as half, rounded down, because every other half in"), true);
  check("and the reading of (Impulsive/Corporeal) is written down",
    TRAIT.includes("The other reading is that the Initiator rolls Impulsive"), true);
}

console.log(failed ? `\n${failed} failing` : "\nall good");
process.exit(failed ? 1 : 0);
