/**
 * The Magic Trick Maneuver: the first whose choice comes before the dice.
 *
 * "Apply one of the following effects", and the three are not three outcomes of one thing -
 * two open a Clash and the third does not, one needs an Opponent and another will take any
 * Character. The Thrust and the Dirty Trick both choose after the dice, because what they
 * are choosing between is what winning buys; this one decides whether there is anything to
 * win, so it has to be asked first.
 *
 * And the first conditional Exploitable line: "if you fail the initial Clash, this triggers
 * the Exploit Maneuver from the target" - one person, and only on a loss, where every other
 * line in the library fires for everybody in reach the moment the card is posted.
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

const { loadTraits } = await import(modUrl("effects/traits.mjs"));
const { loadManeuvers, getManeuver, allManeuvers, whyNotSpecial } =
  await import(modUrl("maneuvers.mjs"));
const { maneuverItemFrom, definitionOf } = await import(modUrl("use-maneuver.mjs"));
const { allConditions } = await import(modUrl("conditions.mjs"));
const { default: DBUCharacterData } = await import(modUrl("data/actor-character.mjs"));
await loadTraits();
await loadManeuvers();

const TRAIT = fs.readFileSync(path.join(TRAITS, "maneuvers", "magic-trick.dbu"), "utf8");
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
  check("listed", INDEX.traits.includes("maneuvers/magic-trick.dbu"), true);

  const trick = getManeuver("magic-trick");
  check("loaded as a Standard Maneuver", trick?.type, "standard");
  check("costing one Action", trick.actionCost, 1);
  check("and no Ki", trick.kiCost, 0);
  check("once a Combat Round", trick.usageLimit, { amount: 1, per: "round" });
  check("it is Special", trick.special, true);

  // It takes no target outright, because the third effect needs none - the two that do are
  // refused where the choice is made instead.
  check("it asks for no target of its own", Boolean(trick.requiresTarget), false);
  check("and the choice refuses one that needs a target and has none",
    USE.includes('if (clashing && !target) {'), true);

  for (const line of [
    "Apply one of the following effects",
    "Target an Opponent within your Melee Range",
    "Make a Clash (Use Magic vs Intuition/Use\n  Magic) against them",
    "the target gains the Impaired Combat Condition until\n  the start of your next turn",
    "Target a Character within your Melee Range",
    "move that target by a number of Squares equal to your\n  number of Skill Ranks in the Use Magic Skill",
    "Move a number of Squares equal to your number of Skill Ranks in the Use Magic Skill.\n  This movement does not trigger the Exploit Maneuver"
  ]) {
    check(`the entry says "${line.slice(0, 42).replace(/\n\s+/g, " ")}"`,
      TRAIT.includes(line), true);
  }

  // "Special Maneuver: you gain access to the Magic Trick Maneuver", in Use Magic's own
  // entry - which is also the Skill this Maneuver rolls and counts, and that is a
  // coincidence of this entry rather than a rule.
  check("Use Magic opens it",
    DBUCharacterData.SKILLS.useMagic.specialManeuver, "magic-trick");
  check("which is the Skill it rolls too, though those are two questions",
    trick.clashSkill, "useMagic");
  check("as Bluff shows, opening the Feint while the Dirty Trick rolls it",
    [DBUCharacterData.SKILLS.bluff.specialManeuver, getManeuver("dirty-trick").clashSkill],
    ["feint", "bluff"]);

  // Required, so no Rank is no roll - and this Maneuver counts Ranks for distance, so a
  // character who has just opened it at two Ranks moves two Squares.
  check("and Use Magic is Required",
    DBUCharacterData.SKILLS.useMagic.required, true);
}

// --- The Clash it makes ------------------------------------------------------------------------
{
  const trick = getManeuver("magic-trick");
  check("made with Use Magic", trick.clashSkill, "useMagic");
  check("and answered with either of two", trick.clashDefenderSkills,
    ["intuition", "useMagic"]);
  check("which includes the Skill the caster is using, so both sides can roll it",
    trick.clashDefenderSkills.includes("useMagic"), true);
  check("both of which a character has",
    [Boolean(DBUCharacterData.SKILLS.intuition), Boolean(DBUCharacterData.SKILLS.useMagic)],
    [true, true]);
  // Use Magic is a Required Skill: no Rank, no roll, which is worth knowing for a Maneuver
  // whose whole distance is counted in Ranks of it.
  check("and Use Magic is Required, so no Rank is no roll and no Squares",
    DBUCharacterData.SKILLS.useMagic.required, true);

  check("the distance is its Ranks, one Square each",
    [trick.moveSkill, trick.movePerRank], ["useMagic", 1]);

  const item = maneuverItemFrom(trick);
  const read = definitionOf({ id: "x", name: trick.name,
    system: { ...item.system, maneuverId: trick.id } });
  // Off an Item the Clash comes back as the pair rather than as two flat fields, which is
  // the shape `definitionOf` has always given it.
  check("all of it travels onto an Item and back",
    [read.clash, read.magicTrick, read.moveSkill, read.exploitOnLoss],
    [{ skill: "useMagic", defenderSkills: ["intuition", "useMagic"] }, true, "useMagic", true]);
}

// --- The choice, and what each answer says ---------------------------------------------------------
{
  const note = new Function(`${source(USE, "magicTrickRanks")}\n${source(USE, "magicTrickNote")}\nreturn magicTrickNote;`)();
  const trick = getManeuver("magic-trick");
  const who = (ranks) => ({
    name: "Tizi",
    system: { skills: { useMagic: { ranks, label: "Use Magic" } } }
  });
  const target = { name: "Kuro" };

  check("impairing says what winning buys and what losing costs",
    note(who(3), trick, "impair", target),
    "Tizi works a trick on Kuro. Win and they are Impaired until the start of Tizi's next "
    + "turn; lose and Kuro may Exploit.");
  check("shoving says how far, off the Ranks",
    note(who(3), trick, "shove", target),
    "Tizi works a trick on Kuro. Win and Kuro moves 3 Squares - Tizi's Use Magic Ranks; "
    + "lose and Kuro may Exploit.");
  check("and moving yourself says the distance and that nothing answers it",
    note(who(4), trick, "move", null),
    "Move up to 4 Squares - Tizi's Use Magic Ranks. This movement does not trigger the "
    + "Exploit Maneuver.");

  // One Square is a Square.
  check("one Rank is one Square, singular",
    note(who(1), trick, "move", null).startsWith("Move up to 1 Square - "), true);
  // No Ranks is no distance, said as the number it is rather than refused - the Maneuver
  // still has two other effects.
  check("no Ranks is no Squares", note(who(0), trick, "move", null)
    .startsWith("Move up to 0 Squares - "), true);

  // Asked before anything is paid for.
  check("the question is asked at the door",
    USE.includes("    if (maneuver.magicTrick) {\n      trick = await askMagicTrick("), true);
  check("and dropping it leaves the Maneuver unused",
    USE.includes("      if (!trick) return false;"), true);
  check("before the Ki is spent",
    USE.indexOf("trick = await askMagicTrick(")
      < USE.indexOf("if (!fromStore && !await spendManeuverCost(actor, maneuver, moving.fromSelf)) return false;"),
    true);

  // And the third answer takes a different road out of the door.
  check("moving yourself opens no Clash",
    USE.includes('    : (maneuver.magicTrick && (trick === "move"))\n'
      + "    ? await postManeuver(actor, maneuver, {"), true);
  check("asked before the Clash routes, so it does not fall into one",
    USE.indexOf('(maneuver.magicTrick && (trick === "move"))')
      < USE.indexOf("    : maneuver.clash\n"), true);
  check("and the other two carry which trick it was",
    USE.includes("          ? { magicTrick: { option: trick, applied: false },"), true);
}

// --- What a settled Clash leaves ----------------------------------------------------------------------
{
  check("settled once, by the one client that writes a Clash",
    CHAT.includes("  if (clash.magicTrick && clash.result && !clash.magicTrick.applied) {"),
    true);
  check("and marked before anything else happens",
    CHAT.includes("    ...clash, magicTrick: { ...clash.magicTrick, applied: true }"), true);

  const settle = source(CHAT, "settleMagicTrick");

  // Winning the first: Impaired "until the start of your next turn" - the caster's turn, so
  // their clock over the target.
  check("impairing puts the Condition on the target",
    settle.includes('await setCondition(target, "impaired", 1);'), true);
  check("on a start edge, which is the caster's next turn",
    settle.includes('      key: "impaired",\n      edge: EDGES.START,\n      next: true,\n'
      + "      on: target.uuid,"), true);
  check("and Impaired is a published Combat Condition",
    allConditions().filter(c => c.combatCondition).some(c => c.key === "impaired"), true);

  // Winning the second: a number of Squares, said and not done.
  check("shoving says how far and leaves the moving to the table",
    settle.includes("Where to is ${caster.name}'s to say."), true);
  check("counted off the caster's Ranks when it lands",
    CHAT.includes("  const ranks = caster.system.skills?.[clash.skill]?.ranks ?? 0;"), true);

  // A tie is a failure here, which is what hands the target the opening.
  check("a tie goes to the defender, here as everywhere",
    settle.includes('if (whoWonClash(clash.result) !== "challenger") {'), true);
}

// --- The Exploitable line, which is conditional ----------------------------------------------------------
{
  const trick = getManeuver("magic-trick");

  // Carried as printed, for a reader - and with the comma intact, which is what broke the
  // first time: `coerce` splits a header value on commas, so the file folds it.
  check("the line is carried whole",
    trick.exploitable,
    "If you fail the initial Clash, this triggers the Exploit Maneuver from the target.");
  check("written folded, since it has a comma in it",
    TRAIT.includes("exploitable: >"), true);
  check("and every Exploitable line in the library is a sentence rather than a list",
    allManeuvers().every(m => typeof m.exploitable === "string"), true);

  // It is not the door's to open: that one fires for everybody in reach when the card is
  // posted, and this fires for one person when a Clash is lost.
  check("this one is marked as firing on a loss", trick.exploitOnLoss, true);
  check("and the ordinary door stands aside for it",
    CHAT.includes("  if (maneuver.exploitOnLoss) return;"), true);
  check("after the line itself is checked, so a Maneuver with no line is unaffected",
    CHAT.indexOf("if (!card || !maneuver?.exploitable) return;")
      < CHAT.indexOf("if (maneuver.exploitOnLoss) return;"), true);
  check("and the Maneuvers that say so - the Magic Trick and the Talk, the Disarm",
    allManeuvers().filter(m => m.exploitOnLoss).map(m => m.id).sort(), ["absorb", "disarm", "glassification", "magic-trick", "possess", "talk"]);

  // Handed to the one person the rule names, on a loss.
  const settle = source(CHAT, "settleMagicTrick");
  check("losing hands the target the Exploit",
    settle.includes("offerExploitTo(message, target, caster,"), true);
  check("and winning does not",
    (settle.match(/offerExploitTo\(/g) ?? []).length, 1);

  check("offered to one person rather than swept for",
    CHAT.includes("function offerExploitTo(message, who, against, reason, maneuverId = \"magic-trick\") {"), true);
  check("and only to somebody holding the Exploit Maneuver",
    CHAT.includes('if (!who.items?.some(item => (item.type === "maneuver") '
      + "&& item.system.exploit)) return;"), true);
  check("aimed back at whoever tried the trick",
    CHAT.includes("      targetUuid: against.uuid,"), true);

  // The third effect makes no Clash, so there is nothing to fail and nothing to Exploit -
  // which the entry also says on its own line.
  check("and the effect that makes no Clash says so too",
    trick.says.includes("This movement does not trigger the Exploit Maneuver"), true);
}

console.log(`${failed} failing`);
process.exit(failed ? 1 : 0);
