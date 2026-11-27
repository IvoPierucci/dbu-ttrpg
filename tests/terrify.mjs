/**
 * The Terrify Maneuver.
 *
 * Two things worth running, and one of them is an ordering.
 *
 * "If they already possessed the Shaken Combat Condition, they are additionally knocked
 * Prone." Already - so it has to be read before this use writes it. Get that backwards and
 * every Terrify knocks its target Prone, because every Terrify has just made them Shaken.
 * That is the failure a reasonable build walks into, so it is checked both ways round.
 *
 * And "reduce the Dice Score of your Skill Clash by 2 if your target is of a higher Tier of
 * Power than you" - the first thing in these rules to set the two sides' Tiers against each
 * other. Yours and not theirs, strictly higher, and on the challenger's side only.
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
globalThis.game = { combat: null, users: { activeGM: null } };

const TRAITS = path.join(ROOT, "traits");
globalThis.foundry.utils.fetchJsonWithTimeout = async () =>
  JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));
globalThis.fetch = async url => {
  const file = path.join(TRAITS, String(url).replace("systems/dbu-ttrpg/traits/", ""));
  if (!fs.existsSync(file)) return { ok: false, status: 404, statusText: "missing" };
  return { ok: true, status: 200, text: async () => fs.readFileSync(file, "utf8") };
};

const { loadTraits, getTrait } = await import(modUrl("effects/traits.mjs"));
const { loadManeuvers, getManeuver, whyNotSpecial, MANEUVER_TYPES } =
  await import(modUrl("maneuvers.mjs"));
const { maneuverItemFrom, definitionOf } = await import(modUrl("use-maneuver.mjs"));
const { EDGES, KINDS, edgesToWait } = await import(modUrl("durations.mjs"));
const { default: DBUCharacterData } = await import(modUrl("data/actor-character.mjs"));
await loadTraits();
await loadManeuvers();

const TRAIT = fs.readFileSync(path.join(TRAITS, "maneuvers", "terrify.dbu"), "utf8");
const SHAKEN = fs.readFileSync(path.join(TRAITS, "conditions", "shaken.dbu"), "utf8");
const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
const USE = fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8");
const INDEX = JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

/** One top-level function out of a module, sliced so it can be run. */
function source(text, name) {
  let at = text.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`no ${name}`);
  if (text.slice(at - 6, at) === "async ") at -= 6;
  return text.slice(at, text.indexOf("\n}\n", at) + 2);
}

// --- The Maneuver as the rulebook lists it --------------------------------------------------
{
  check("listed", INDEX.traits.includes("maneuvers/terrify.dbu"), true);

  const terrify = getManeuver("terrify");
  check("loaded as a Standard Maneuver", terrify?.type, "standard");
  check("costing one Action", terrify.actionCost, 1);
  check("which is what a Standard Maneuver spends",
    MANEUVER_TYPES.standard.action, "standard");
  check("once a Combat Round", terrify.usageLimit, { amount: 1, per: "round" });
  check("it is Special", terrify.special, true);
  check("aimed at somebody", terrify.requiresTarget, true);
  check("and it is not an attack", Boolean(terrify.attacking), false);
  check("no Ki", terrify.kiCost, 0);
  check("and none per Tier either", terrify.kiCostPerTier ?? 0, 0);
  check("it is the flag it is", terrify.terrify, true);

  for (const line of [
    "Target an Opponent within 4 Squares of you",
    "Make a Skill Clash (Intimidation\n  vs Intuition/Intimidation) against them",
    "your target gains the Shaken\n  Combat Condition until the end of your next turn",
    "If they already possessed the Shaken\n  Combat Condition, they are additionally knocked Prone",
    "Reduce the Dice Score of your Skill Clash by 2 if your target is of a higher Tier of\n  Power than you"
  ]) {
    check(`the entry says "${line.slice(0, 44).replace(/\n\s+/g, " ")}"`,
      TRAIT.includes(line), true);
  }

  const item = maneuverItemFrom(terrify);
  check("the Item carries the flag", item.system.terrify, true);
  check("and reading it back gives it up",
    definitionOf({ id: "x", name: terrify.name,
      system: { ...item.system, maneuverId: terrify.id } }).terrify, true);

  // "Special Maneuver: you gain access to the Terrify Maneuver", in Intimidation's entry -
  // which is also the Skill this Clash is rolled with, and still a coincidence of this
  // entry: Bluff opens the Feint and the Dirty Trick rolls Bluff without being opened by it.
  check("Intimidation is the Skill that opens it",
    DBUCharacterData.SKILLS.intimidation.specialManeuver, "terrify");
  check("which is the Skill it rolls, though those are two questions",
    terrify.clashSkill, "intimidation");
  check("and Bluff is the pair that shows they are two",
    [DBUCharacterData.SKILLS.bluff.specialManeuver, getManeuver("dirty-trick").clashSkill],
    ["feint", "bluff"]);

  const ranks = (n) => ({
    name: "Tizi",
    system: {
      effects: { slots: {} },
      specialManeuvers: [{ maneuver: "terrify", skill: "Intimidation", ranks: n, needs: 2,
                           open: n >= 2 }]
    }
  });
  check("one Rank short, and the reason says by how much",
    whyNotSpecial(ranks(1), terrify),
    "Terrify opens at 2 Ranks of Intimidation, and Tizi has 1.");
  check("two Ranks opens it", whyNotSpecial(ranks(2), terrify), null);

  // Not Required, so two Ranks from nothing rather than two after the Skill became
  // rollable - which is where it differs from Sense.
  check("Intimidation is not a Required Skill",
    Boolean(DBUCharacterData.SKILLS.intimidation.required), false);
  check("where Clairvoyance, which opens Sense, is",
    DBUCharacterData.SKILLS.clairvoyance.required, true);

  // Neither Skill this Clash can be answered with is Required either, so nobody is ever
  // stuck unable to defend against it. Sense's defence is a Required Skill and that is not
  // true of it - the difference is the two entries' own.
  check("and neither Skill it is answered with is Required",
    terrify.clashDefenderSkills.map(key => Boolean(DBUCharacterData.SKILLS[key].required)),
    [false, false]);
  check("which the file follows through",
    TRAIT.includes("so nobody is ever stuck without an answer to it"), true);

  // "Adventuring Maneuver: you gain access to the Frighten Maneuver." An eighth named and
  // none of them built. Worth its own check because this is the first Skill whose two
  // Maneuver lines are this close together - Frighten and Terrify are two different
  // Maneuvers out of the one Skill, and only one of them exists.
  check("Frighten is not in the library", getManeuver("frighten") ?? null, null);
  check("and is not to be confused with the one that is",
    Boolean(getManeuver("terrify")), true);
  check("the Skill table names no Adventuring Maneuver at all",
    Object.values(DBUCharacterData.SKILLS).some(s => s.adventuringManeuver), false);
  check("which the entry is recorded as saying instead",
    fs.readFileSync(path.join(ROOT, "module", "data", "actor-character.mjs"), "utf8")
      .includes("It grants the Frighten Adventuring Maneuver too"), true);
}

// --- The Clash, and a slash that includes the challenger's own Skill --------------------------
{
  const terrify = getManeuver("terrify");
  check("made with Intimidation", terrify.clashSkill, "intimidation");
  check("and answered with either of two", terrify.clashDefenderSkills,
    ["intuition", "intimidation"]);
  check("both of which are Skills a character has",
    terrify.clashDefenderSkills.every(key => Boolean(DBUCharacterData.SKILLS[key])), true);
  check("one of them being the challenger's own",
    terrify.clashDefenderSkills.includes(terrify.clashSkill), true);
  check("which the Magic Trick's slash also does",
    getManeuver("magic-trick").clashDefenderSkills
      .includes(getManeuver("magic-trick").clashSkill), true);

  // Both copies of the Maneuver carry the same Clash.
  check("the library's copy carries both halves", terrify.clash,
    { skill: "intimidation", defenderSkills: ["intuition", "intimidation"] });
  const item = maneuverItemFrom(terrify);
  check("and the Item's copy says the same", item.system.clashDefenderSkills,
    ["intuition", "intimidation"]);
  check("read back off the Item unchanged",
    definitionOf({ id: "x", name: terrify.name,
      system: { ...item.system, maneuverId: terrify.id } }).clash,
    { skill: "intimidation", defenderSkills: ["intuition", "intimidation"] });

  // Which Skill each side rolls, run. Two offered, so the defender is asked.
  const skillPicked = new Function(`${source(CHAT, "skillPicked")}\nreturn skillPicked;`)();
  const clash = { challengerUuid: "Actor.a", defenderUuid: "Actor.b", skill: "intimidation",
                  defenderSkills: ["intuition", "intimidation"], defenderSkill: "" };
  check("the challenger rolls Intimidation",
    skillPicked(clash, "Actor.a"), "intimidation");
  check("the defender rolls the first offered until they say",
    skillPicked(clash, "Actor.b"), "intuition");
  check("and staring back is one of the answers",
    skillPicked({ ...clash, defenderSkill: "intimidation" }, "Actor.b"), "intimidation");
  check("which is asked because there are two to choose from",
    CHAT.includes("      if ((actor.uuid !== clash.defenderUuid) || (offered.length < 2)) return {};"),
    true);
}

// --- Punching up, run ------------------------------------------------------------------------
{
  const terrifyPenalty = new Function("fromUuidSync",
    `${source(CHAT, "terrifyPenalty")}\nreturn terrifyPenalty;`)(
      uuid => (uuid === "Actor.kuro") ? { system: { tierOfPower: TARGET_TIER } } : null);

  // Set by the closure above, so one stub serves every pairing.
  globalThis.TARGET_TIER = 1;
  const at = (mine, theirs, uuid = "Actor.a") => {
    globalThis.TARGET_TIER = theirs;
    return terrifyPenalty(
      { system: { tierOfPower: mine } },
      { terrify: { applied: false }, challengerUuid: "Actor.a", defenderUuid: "Actor.kuro" },
      uuid);
  };

  check("a target above you costs 2",
    at(2, 3), [{ label: "Terrify - higher Tier", written: "-2", value: -2 }]);
  check("and further above still costs 2, not more", at(1, 9).length, 1);
  check("an equal Tier costs nothing, since equal is not higher", at(3, 3), []);
  check("and a target below you costs nothing", at(4, 2), []);

  // The challenger's row alone: a defender answering with Intimidation takes none of it.
  check("the defender never takes it", at(1, 5, "Actor.kuro"), []);

  // And no other Clash carries it.
  check("a Clash that is not a Terrify carries nothing",
    terrifyPenalty({ system: { tierOfPower: 1 } },
      { challengerUuid: "Actor.a", defenderUuid: "Actor.kuro" }, "Actor.a"), []);
  check("nor one whose target has left the scene",
    terrifyPenalty({ system: { tierOfPower: 1 } },
      { terrify: {}, challengerUuid: "Actor.a", defenderUuid: "Actor.gone" }, "Actor.a"), []);

  // Applied on the hook a Skill Clash's rows go through, beside Intuit's bonus.
  check("it rides the Skill Clash's own parts hook",
    CHAT.includes("      ...terrifyPenalty(actor, clash, uuid)"), true);
  check("beside the other thing that rides it",
    CHAT.indexOf('...seenBonus(actor, clashOpponent(clash, uuid), "skill")')
      < CHAT.indexOf("...terrifyPenalty(actor, clash, uuid)"), true);
  check("and a Clash of Saving Throws does not take it, there being no Save here",
    CHAT.includes('parts: (actor, clash, uuid) => [...seenBonus(actor, clashOpponent(clash, uuid), "save"), ...saveDefendingParts(actor, clash, uuid),'),
    true);

  // The current Tier, not the Base - which is what makes Holding Back matter to this.
  check("read off the current Tier of Power on both sides",
    (source(CHAT, "terrifyPenalty").match(/tierOfPower/g) ?? []).length, 2);
  check("and never the Base Tier",
    source(CHAT, "terrifyPenalty").includes("baseTierOfPower"), false);
  check("which the file follows through",
    TRAIT.includes("somebody holding their power back is easier to"), true);
}

// --- What winning leaves, run ----------------------------------------------------------------
{
  const notes = [];
  const set = [];
  let flagged = null;
  let clocked = null;

  const message = {
    speaker: { alias: "Tizi" },
    setFlag: async (scope, key, value) => { flagged = value; }
  };

  // `settleTerrify` imports setCondition at the point of use, so the import is what is
  // stubbed - the same shape every other settlement here is run in.
  const body = source(CHAT, "settleTerrify").replace(
    'const { setCondition } = await import("./conditions.mjs");',
    "const { setCondition } = stub;");
  const settleTerrify = new Function(
    "fromUuidSync", "SCOPE", "CLASH_FLAG", "whoWonClash", "settledNote", "lasting",
    "KINDS", "EDGES", "stub", "shakenBy",
    `${body}\nreturn settleTerrify;`)(
      uuid => ({
        "Actor.tizi": { name: "Tizi", uuid: "Actor.tizi" },
        "Actor.kuro": { name: "Kuro", uuid: "Actor.kuro",
                        system: { conditions: SHAKEN_NOW ? { shaken: 1 } : {} } }
      }[uuid] ?? null),
      "dbu-ttrpg", "clash",
      new Function(`${source(CHAT, "whoWonClash")}\nreturn whoWonClash;`)(),
      async (msg, text) => { notes.push(text); },
      async (actor, entry) => { clocked = { actor: actor.uuid, ...entry }; return true; },
      KINDS, EDGES,
      // The stub applies what it records. It has to: "already possessed" is read off the
      // target, and a stub that only counts the calls would let the read happen after the
      // write and still answer no - which is exactly the bug being checked for, passing.
      { setCondition: async (actor, key, value) => {
          set.push(`${key}=${value}`);
          actor.system.conditions = { ...(actor.system.conditions ?? {}), [key]: value };
        } },
      async () => {});

  globalThis.SHAKEN_NOW = false;
  const run = async (alreadyShaken, challenger, defender) => {
    globalThis.SHAKEN_NOW = alreadyShaken;
    notes.length = 0; set.length = 0; flagged = null; clocked = null;
    await settleTerrify(message, {
      challengerUuid: "Actor.tizi", defenderUuid: "Actor.kuro",
      terrify: { applied: false },
      result: { challenger, defender }
    });
    return { notes: [...notes], set: [...set], flagged, clocked };
  };

  // Winning against somebody who was not Shaken: one Condition.
  const fresh = await run(false, { succeeded: true, total: 9 }, { succeeded: false, total: 3 });
  check("Shaken and nothing else", fresh.set, ["shaken=1"]);
  check("and the card says so",
    fresh.notes, ["Kuro is Shaken until the end of Tizi's next turn."]);

  // Winning against somebody who already was: Prone as well.
  const again = await run(true, { succeeded: true, total: 9 }, { succeeded: false, total: 3 });
  check("Shaken again, and knocked Prone for having had it",
    again.set, ["shaken=1", "prone=1"]);
  check("the Prone comes after the Shaken, which is the order it is written in",
    again.set.indexOf("prone=1") > again.set.indexOf("shaken=1"), true);
  check("and the card says which of the two it was",
    again.notes[0].includes("was Shaken already, so they are knocked Prone"), true);

  // The ordering, stated as the thing it protects: "already" is read before it is written.
  // A build that read it afterwards would knock every target Prone, because every Terrify
  // has just made them Shaken.
  check("a fresh target is not knocked Prone", fresh.set.includes("prone=1"), false);
  check("which is the failure the order avoids",
    CHAT.indexOf("  const already = (Number(target.system.conditions?.shaken) || 0) > 0;")
      < CHAT.indexOf('  await setCondition(target, "shaken", 1);'), true);
  check("and the file says it is the one to get wrong",
    TRAIT.includes("the one thing here that a reasonable build gets backwards"), true);

  // The clock is the terrifier's, and the Condition is the target's.
  check("the clock is kept by whoever frightened them", fresh.clocked.actor, "Actor.tizi");
  check("counting an end edge of their next turn",
    [fresh.clocked.edge, fresh.clocked.next], [EDGES.END, true]);
  check("and naming whose Condition it is", fresh.clocked.on, "Actor.kuro");
  check("as a Condition rather than a State or a Resource",
    fresh.clocked.kind, KINDS.CONDITION);
  check("on Shaken by name", fresh.clocked.key, "shaken");
  check("said to have come from this Maneuver", fresh.clocked.source, "Terrify");
  check("which is two edges off during your own turn and one outside it",
    [edgesToWait(EDGES.END, { next: true, theirTurn: true }),
     edgesToWait(EDGES.END, { next: true, theirTurn: false })], [2, 1]);

  // Prone gets no clock: the entry gives it none.
  check("only one clock is set, and it is Shaken's",
    [fresh.clocked.key, again.clocked.key], ["shaken", "shaken"]);
  check("so Prone comes off the way Prone always comes off",
    TRAIT.includes("Prone gets no clock."), true);

  // A tie goes to the Defender, here as everywhere else.
  const tied = await run(true, { succeeded: false, total: 7 }, { succeeded: false, total: 7 });
  check("a tie leaves nothing on them", tied.set, []);
  check("and says so", tied.notes, ["Kuro does not flinch."]);
  check("with no clock either", tied.clocked, null);
  const lost = await run(true, { succeeded: false, total: 2 }, { succeeded: true, total: 8 });
  check("as does losing outright", lost.set, []);

  // Marked before anything else, so a failure halfway through does not settle twice.
  check("the card is marked settled", fresh.flagged.terrify.applied, true);
  check("and the dispatch will not come back to it",
    CHAT.includes("  if (clash.terrify && clash.result && !clash.terrify.applied) {"), true);

  // A card for somebody who has left the scene settles into nothing rather than throwing.
  notes.length = 0; set.length = 0;
  await settleTerrify(message, {
    challengerUuid: "Actor.tizi", defenderUuid: "Actor.gone",
    terrify: { applied: false }, result: { challenger: { succeeded: true }, defender: {} }
  });
  check("a missing side leaves nothing", [notes.length, set.length], [0, 0]);
}

// --- Shaken, and what it is --------------------------------------------------------------------
{
  check("Shaken is a Condition the library has", getTrait("shaken")?.kind, "conditions");
  check("worth 2(T) off Strike Rolls", SHAKEN.includes("strike -= 2(T);"), true);
  check("and carrying no stacks, so a second Terrify does not stack it",
    /stacks/i.test(SHAKEN), false);
  check("Prone is a Condition too", getTrait("prone")?.kind, "conditions");

  // Shaken's own unbuilt half, which Terrify is the first thing to put anybody into.
  check("Shaken records its own gap",
    SHAKEN.includes("# Not automated: moving towards whoever inflicted this."), true);
  check("and Terrify says it is now standing in it",
    TRAIT.includes("Terrify is the first Maneuver that inflicts it"), true);

  // The range, said and not policed - like every range here.
  check("4 Squares is on the card and nowhere else",
    CHAT.includes("4 Squares"), false);
  check("which the file records",
    TRAIT.includes("Said and not policed, like every range in this system"), true);
}

// --- The payload reaches the card --------------------------------------------------------------
{
  check("the Clash carries it",
    USE.includes("        ...(maneuver.terrify ? { terrify: { applied: false } } : {})"), true);
  check("through the same spread every other settlement goes through",
    CHAT.includes("          ...leaves,"), true);
}

console.log(`${failed} failing`);
process.exit(failed ? 1 : 0);
