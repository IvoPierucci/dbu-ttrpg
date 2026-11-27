/**
 * The Intuit Maneuver: Analysis's sibling, on the other half of the rolls.
 *
 * A mark on somebody else, a clock kept by you, and a bonus that is yours against them.
 * Analysis reaches the Combat Rolls; this reaches a Skill Clash and a Clash of Saving
 * Throws, at two different numbers - "by 2 and 1(T) respectively" - which is why they are
 * two rows and not one.
 *
 * "In Clashes" is the whole of the scope, and it is the half worth running: a Skill Check
 * rolled off the sheet is against nobody, and a Might Clash and a Grapple Check are neither
 * of the two rolls the sentence names.
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
const { loadManeuvers, getManeuver, allManeuvers, whyNotSpecial } =
  await import(modUrl("maneuvers.mjs"));
const { allConditions, marksFor, combatConditionsFor } = await import(modUrl("conditions.mjs"));
const { maneuverItemFrom, definitionOf } = await import(modUrl("use-maneuver.mjs"));
const { default: DBUCharacterData } = await import(modUrl("data/actor-character.mjs"));
await loadTraits();
await loadManeuvers();

const TRAIT = fs.readFileSync(path.join(TRAITS, "maneuvers", "intuit.dbu"), "utf8");
const MARK = fs.readFileSync(path.join(TRAITS, "conditions", "seen.dbu"), "utf8");
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

/** One top-level function out of chat.mjs, sliced so it can be run. */
function source(name) {
  let at = CHAT.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`chat.mjs has no ${name}`);
  if (CHAT.slice(at - 6, at) === "async ") at -= 6;
  return CHAT.slice(at, CHAT.indexOf("\n}\n", at) + 2);
}

// --- The Maneuver as the rulebook lists it --------------------------------------------------
{
  check("listed", INDEX.traits.includes("maneuvers/intuit.dbu"), true);
  check("and so is the mark", INDEX.traits.includes("conditions/seen.dbu"), true);

  const intuit = getManeuver("intuit");
  check("loaded as a Standard Maneuver", intuit?.type, "standard");
  check("costing one Action", intuit.actionCost, 1);
  check("and no Ki", intuit.kiCost, 0);
  check("once a Combat Round", intuit.usageLimit, { amount: 1, per: "round" });
  check("it is Special", intuit.special, true);
  check("aimed at an Opponent", intuit.requiresTarget, true);
  check("and it is not an attack", Boolean(intuit.attacking), false);
  check("it makes no Clash of its own", intuit.clash ?? null, null);

  for (const line of [
    "Target an Opponent, that Opponent becomes \u2018Seen\u2019 until the end of your next",
    "Increase the Dice Score of your Skill Checks and Saving Throws in Clashes against",
    "a Seen Opponent by 2 and 1(T) respectively"
  ]) {
    check(`the entry says "${line.slice(0, 44).replace(/\n\s+/g, " ")}"`,
      TRAIT.includes(line), true);
  }

  // "Special Maneuver: you gain access to the Intuit Maneuver", in Intuition's own entry -
  // which was also the obvious guess, and the guess was worth nothing either way.
  check("Intuition opens it",
    DBUCharacterData.SKILLS.intuition.specialManeuver, "intuit");

  const who = (ranks) => ({
    name: "Tizi",
    system: {
      effects: { slots: {} },
      specialManeuvers: [{ maneuver: "intuit", skill: "Intuition", ranks, needs: 2,
                           open: ranks >= 2 }]
    }
  });
  check("one Rank is short, and says by how much", whyNotSpecial(who(1), intuit),
    "Intuit opens at 2 Ranks of Intuition, and Tizi has 1.");
  check("two Ranks opens it", whyNotSpecial(who(2), intuit), null);
  check("and Bluff is still the case that says a guess is worth nothing",
    [DBUCharacterData.SKILLS.bluff.specialManeuver, getManeuver("dirty-trick").clashSkill],
    ["feint", "bluff"]);
}

// --- The mark, which is Analyzed's sibling --------------------------------------------------------
{
  const seen = allConditions().find(c => c.key === "seen");
  check("Seen is in the library", Boolean(seen), true);
  check("and is not a Combat Condition", seen.combatCondition, false);
  check("so the checklist is still the published eighteen",
    allConditions().filter(c => c.combatCondition).length, 18);
  check("it is listed with the marks when somebody has it",
    marksFor({ system: { conditions: { seen: 1 }, timed: [] } }).map(m => m.key), ["seen"]);
  check("and not in the checklist",
    combatConditionsFor({ system: { conditions: { seen: 1 }, timed: [] } })
      .some(c => c.key === "seen"), false);

  // No effects of its own: what being Seen costs is the Maneuver's, because the bonus
  // belongs to whoever made the mark rather than to everybody.
  check("the mark carries no effects of its own",
    String(getTrait("seen").script ?? "").includes("[passive]"), false);
  check("which the file says is the point",
    MARK.includes("passive here would hand it to the whole table."), true);

  // Marked on them, timed by you.
  check("the Maneuver marks the target",
    USE.includes('await setCondition(target, "seen", 1);'), true);
  check("and keeps the clock itself",
    USE.includes('    key: "seen",\n    edge: EDGES.END,\n    next: true,\n'
      + "    on: target.uuid,"), true);
  check("which is the same split Analysis uses",
    USE.includes('    key: "analyzed",\n    edge: EDGES.END,\n    next: true,\n'
      + "    on: target.uuid,"), true);
  check("fired when the Maneuver is used",
    USE.includes("if (maneuver.intuit && targetActor) await markSeen(actor, targetActor);"),
    true);

  const item = maneuverItemFrom(getManeuver("intuit"));
  check("the Item carries the flag", item.system.intuit, true);
  check("and reading it back gives it up",
    definitionOf({ id: "x", name: "Intuit",
      system: { ...item.system, maneuverId: "intuit" } }).intuit, true);
}

// --- Two numbers for two rolls, run -----------------------------------------------------------------
{
  // seenBonus asks whether a Custom Buff's "Seen" is switched on (custom-buffs.mjs customBuffOn): none here.
  const seenBonus = new Function("customBuffOn", `${source("seenBonus")}\nreturn seenBonus;`)(() => false);

  const reader = (tier, on) => ({
    system: {
      tierOfPower: tier,
      timed: on ? [{ kind: "condition", key: "seen", on, edge: "end", edges: 2,
                     source: "Intuit" }] : []
    }
  });
  const kuro = { uuid: "Actor.kuro" };
  const goro = { uuid: "Actor.goro" };

  // "By 2 and 1(T) respectively."
  check("a Skill Check in a Clash gains a flat 2",
    seenBonus(reader(4, "Actor.kuro"), kuro, "skill"),
    [{ label: "Intuit", written: "+2", value: 2 }]);
  check("which does not scale with the Tier of Power",
    seenBonus(reader(1, "Actor.kuro"), kuro, "skill")[0].value, 2);

  check("a Saving Throw in a Clash gains 1(T)",
    seenBonus(reader(4, "Actor.kuro"), kuro, "save"),
    [{ label: "Intuit", written: "+1(T)", value: 4 }]);
  check("which does", seenBonus(reader(1, "Actor.kuro"), kuro, "save")[0].value, 1);

  // Neither of the two rolls the sentence names gets nothing.
  check("a Might Clash gets nothing",
    seenBonus(reader(4, "Actor.kuro"), kuro, "might"), []);
  check("and a Grapple Check, being a Combat Roll, gets nothing either",
    seenBonus(reader(4, "Actor.kuro"), kuro, "combat"), []);

  // Yours against the one you read, and nobody else's.
  check("somebody who read nobody gets nothing",
    seenBonus(reader(4, ""), kuro, "skill"), []);
  check("and somebody who read a different Opponent gets nothing against this one",
    seenBonus(reader(4, "Actor.goro"), kuro, "skill"), []);
  check("but does against the one they read",
    seenBonus(reader(4, "Actor.goro"), goro, "skill").length, 1);
  check("and a Clash with nobody on the other side is no bonus",
    seenBonus(reader(4, "Actor.kuro"), null, "skill"), []);
}

// --- Applied where a Clash builds the side that is rolling -------------------------------------------
{
  // A Skill Clash's rows are a list now - the Terrify's penalty for punching up is a row
  // on the same hook - so what is pinned is that this bonus is one of them, and that it
  // asks for the Skill Check's number rather than the Saving Throw's.
  check("a Skill Clash takes it",
    CHAT.includes('      ...seenBonus(actor, clashOpponent(clash, uuid), "skill"),'), true);
  check("as one row among whatever else that family collects",
    CHAT.includes("    parts: (actor, clash, uuid) => [") , true);
  check("and a Clash of Saving Throws takes its own number",
    CHAT.includes('    parts: (actor, clash, uuid) => [...seenBonus(actor, clashOpponent(clash, uuid), "save"), ...saveDefendingParts(actor, clash, uuid),'),
    true);
  check("which is the same hook a Grapple Check's rows go through",
    CHAT.includes("  return [kind.of(actor, clash, uuid), ...(kind.parts ? kind.parts(actor, clash, uuid) : []),")
      && CHAT.includes("    clashParts(kind, actor, clash, uuid),"),
    true);

  // Who the other side is, run.
  const clashOpponent = new Function("fromUuidSync",
    `${source("clashOpponent")}\nreturn clashOpponent;`)(uuid => ({ uuid }));
  const clash = { challengerUuid: "Actor.a", defenderUuid: "Actor.b" };
  check("the challenger's opponent is the defender",
    clashOpponent(clash, "Actor.a").uuid, "Actor.b");
  check("and the defender's is the challenger",
    clashOpponent(clash, "Actor.b").uuid, "Actor.a");
  check("a Clash with a side missing has no opponent to find",
    clashOpponent({ challengerUuid: "Actor.a" }, "Actor.a"), null);

  // Not on the Skill itself: "in Clashes" is the whole of the scope, and a Skill Check
  // rolled off the sheet is against nobody.
  const SHEET = fs.readFileSync(
    path.join(ROOT, "module", "sheets", "actor-character-sheet.mjs"), "utf8");
  check("a Skill Check rolled off the sheet never sees it",
    SHEET.includes("seenBonus"), false);
  check("nor does an attack, which is Analysis's half of the pair",
    CHAT.includes("...analysisBonus(actor, fromUuidSync(attack?.attackerUuid ?? \"\"))"), true);
}

// --- The pair it forms with Analysis --------------------------------------------------------------------
{
  // Two Maneuvers, two marks, two halves of the roll table - and both built the same way
  // because both are about a pair of characters rather than about one.
  check("both mark somebody and time it themselves",
    [getManeuver("analysis").analysis, getManeuver("intuit").intuit], [true, true]);
  check("and both marks are marks rather than Combat Conditions",
    allConditions().filter(c => ["analyzed", "seen"].includes(c.key))
      .every(c => !c.combatCondition), true);
  check("Analysis reaches the Combat Rolls",
    getManeuver("analysis").text.includes("Increase your Combat Rolls against Analyzed"),
    true);
  check("and Intuit reaches the other two",
    getManeuver("intuit").text.includes("Skill Checks and Saving Throws in Clashes"), true);
  check("so neither can reach the other's",
    CHAT.includes('if (family === "skill") return [{ label: "Intuit", written: "+2", value: 2 }];'),
    true);
}

console.log(`${failed} failing`);
process.exit(failed ? 1 : 0);
