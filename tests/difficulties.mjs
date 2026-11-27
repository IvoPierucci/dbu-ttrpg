/**
 * Difficulty Categories: the other half of what a Skill Check can be rolled against.
 *
 * "You may be required to make a Skill Check against an Opponent in the form of a Clash or
 * against a set Difficulty Category." The Clash half has been here since the Clash
 * categories were told apart; this is the rest of it.
 *
 * Three things worth running.
 *
 * The table and the comparison. "You must match or exceed the listed value of the TN" - so
 * meeting it is enough, which is the opposite of how a Clash settles a tie, and the reason
 * is that a Clash has somebody on the other side for a tie to go to.
 *
 * The verdict surviving what happens to a Check after it is posted. A Critical Die can take
 * a Check over a Target Number it missed, and the card it posts has to judge again rather
 * than repeat the old answer under a new number.
 *
 * And the two rules the page states about Skill Checks in particular - a flat Botch of 2
 * and a flat 1d4 critical, "regardless of your Tier of Power". Both were already built.
 * Checked anyway: a rule that happens to be right is worth pinning once somebody has said
 * what it is.
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

const { default: DBUCharacterData } = await import(modUrl("data/actor-character.mjs"));
const { difficultyLine } = await import(modUrl("chat.mjs"));
const { noteLine } = await import(modUrl("breakdown.mjs"));

const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
const SHEET = fs.readFileSync(
  path.join(ROOT, "module", "sheets", "actor-character-sheet.mjs"), "utf8");
const CHARACTER = fs.readFileSync(
  path.join(ROOT, "module", "data", "actor-character.mjs"), "utf8");

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

// --- The table, as the rulebook prints it ---------------------------------------------------
{
  check("six Categories", Object.keys(DBUCharacterData.DIFFICULTIES).length, 6);
  check("named and numbered as the table prints them",
    Object.entries(DBUCharacterData.DIFFICULTIES)
      .map(([key, entry]) => [key, entry.label, entry.tn]),
    [["novice", "Novice", 6],
     ["apprentice", "Apprentice", 10],
     ["qualified", "Qualified", 14],
     ["expert", "Expert", 18],
     ["master", "Master", 22],
     ["grandmaster", "Grandmaster", 26]]);

  // Four apart, every step, which is the shape of the table rather than a rule it states -
  // pinned because a typo in one number is the failure this catches and reading the list
  // back does not.
  const tns = Object.values(DBUCharacterData.DIFFICULTIES).map(entry => entry.tn);
  check("each one four above the last",
    tns.slice(1).map((tn, at) => tn - tns[at]), [4, 4, 4, 4, 4]);
  check("and in order", [...tns].sort((a, b) => a - b), tns);

  // Flat, and the same for everybody. Nothing about a Target Number scales.
  check("nothing in the table depends on a character",
    /DIFFICULTIES = Object\.freeze\(\{[^}]*tierOfPower/.test(CHARACTER), false);
  check("frozen, like every other table here",
    Object.isFrozen(DBUCharacterData.DIFFICULTIES), true);
}

// --- Match or exceed, run ---------------------------------------------------------------------
{
  const apprentice = DBUCharacterData.DIFFICULTIES.apprentice;

  check("under it is not met", difficultyLine(9, apprentice), noteLine("Apprentice 10 - not met"));
  check("matching it is met", difficultyLine(10, apprentice), noteLine("Apprentice 10 - met"));
  check("exceeding it is met", difficultyLine(11, apprentice), noteLine("Apprentice 10 - met"));

  // Which is the opposite of how a Clash settles a tie. There the Defender takes it,
  // because there is somebody on the other side for it to go to; a Target Number is nobody.
  const whoWonClash = new Function(`${source(CHAT, "whoWonClash")}\nreturn whoWonClash;`)();
  check("where a tied Clash goes to the Defender",
    whoWonClash({ challenger: { total: 10 }, defender: { total: 10 } }), "defender");
  check("and a tied Check is made", difficultyLine(10, apprentice).source.endsWith("- met"),
    true);

  // Every Category, at its number and one below it.
  check("every Category is met at its own number",
    Object.values(DBUCharacterData.DIFFICULTIES)
      .every(entry => difficultyLine(entry.tn, entry).source.endsWith("- met")), true);
  check("and missed one under it",
    Object.values(DBUCharacterData.DIFFICULTIES)
      .every(entry => difficultyLine(entry.tn - 1, entry).source.endsWith("- not met")), true);

  // A Check with no Difficulty gets no row at all, since almost none has one - a row
  // saying "no Target Number" is a row to read past.
  check("no Difficulty, no row", difficultyLine(14, null), null);
  check("the name and the number are both on it, so neither has to be looked up",
    difficultyLine(26, DBUCharacterData.DIFFICULTIES.grandmaster).source,
    "Grandmaster 26 - met");
}

// --- The verdict survives what happens to a Check afterwards -----------------------------------
{
  // "A Critical on a Skill Check is a bonus Extra Dice of 1d4" - and that die is exactly
  // what can carry a Check over a Target Number it had missed. So the card the Critical
  // posts judges again rather than carrying the old answer under a new number.
  check("the Critical Die's card works the verdict out again",
    CHAT.includes("    difficultyLine(total, check?.against ?? null)"), true);
  check("off the Difficulty the first card carried",
    SHEET.includes("            against"), true);
  check("and drops the verdict the first card had",
    CHAT.includes("    ...(check?.lines ?? []).filter(line => !isVerdict(line)),"), true);

  // Which the verdict has to be recognisable for. Run, because "a note whose sentence ends
  // in met or not met" is the kind of rule that quietly stops matching.
  const isVerdict = new Function(`${source(CHAT, "isVerdict")}\nreturn isVerdict;`)();
  check("a verdict is one", isVerdict(noteLine("Apprentice 10 - met")), true);
  check("a missed one too", isVerdict(noteLine("Grandmaster 26 - not met")), true);
  check("every Category's own row is recognised",
    Object.values(DBUCharacterData.DIFFICULTIES)
      .flatMap(entry => [entry.tn, entry.tn - 1])
      .every((total, at) => isVerdict(difficultyLine(total,
        Object.values(DBUCharacterData.DIFFICULTIES)[Math.floor(at / 2)]))), true);

  // And the other notes on a card are not.
  for (const note of [
    "Willing failure - the total is 0",
    "Karmic Chance rolled 7, keeping 9",
    "Penalties took the bonuses to nothing, and stop there"
  ]) {
    check(`"${note.slice(0, 30)}" is not a verdict`, isVerdict(noteLine(note)), false);
  }
  check("nor is a row that is not a note at all",
    isVerdict({ kind: "part", source: "Apprentice 10 - met" }), false);
  check("nor nothing at all", isVerdict(null), false);
}

// --- Every branch of a Check says whether it was met ----------------------------------------------
{
  // Three cards can come out of one Check, and all three carry the verdict. A willing
  // failure that totals 0 has still missed a Target Number, and saying nothing there would
  // read as though the Difficulty had been forgotten.
  check("the willing failure's card says it",
    SHEET.includes("                  difficultyLine(0, against)].filter(Boolean),"), true);
  check("the Botch's card says it against the botched total",
    SHEET.includes("        difficultyLine(botched, against)"), true);
  check("and the ordinary card against the roll",
    SHEET.includes("    const lines = [...rows(), difficultyLine(rolledTotal, against)].filter(Boolean);"),
    true);
  check("resolved once rather than in each of the three",
    SHEET.includes("    const against = target ?? DBUCharacterData.DIFFICULTIES[difficulty] ?? null;"),
    true);
  check("and a Difficulty nobody picked is no Difficulty",
    DBUCharacterData.DIFFICULTIES[""] ?? null, null);
}

// --- Asked in the window that confirms the roll ------------------------------------------------------
{
  // The same dialog, because that dialog exists so a roll takes one click.
  check("the roll window can offer it",
    CHAT.includes("                                    difficulties = false, senses = [], formula = null, offerWilling = true,"), true);
  check("built from the table rather than written out",
    CHAT.includes("${Object.entries(DBUCharacterData.DIFFICULTIES).map(([key, entry]) =>"),
    true);
  check("with a way to roll against none, which is nearly every Check",
    CHAT.includes('<option value="">None - just the roll</option>'), true);

  // Offered to the Skill Check and to nothing else: a Combat Roll is not measured against
  // a Target Number. Which is two separate facts - that one caller asks for it, and that
  // the window only draws it when somebody asked.
  check("only the Skill Check asks for one",
    (CHAT.match(/difficulties: true/g) ?? []).length
      + (SHEET.match(/difficulties: true/g) ?? []).length, 1);
  check("and it is the Skill Check",
    SHEET.includes("      difficulties: true, senses: sensesAsked(this.actor, target.dataset.skill),\n      boxes: silk"), true);

  // The gate itself. Without this, a Difficulty select on every Strike Roll in the system
  // is a change nothing here would notice: the call sites are untouched by it.
  check("the rows are built only when a caller asked for them",
    CHAT.includes("  const difficultyRows = difficulties\n    ? `<label"), true);
  check("and there is one place they can reach the window from",
    (CHAT.match(/\$\{difficultyRows\}/g) ?? []).length, 1);
  check("which is empty for every roll that did not ask",
    CHAT.includes('       </label>`\n    : "";\n\n  // "Any Perception Skill check made relying on sight"'), true);

  // The return shape changes only for the caller that asked, and stays truthy - which is
  // what every other caller tests.
  check("an object where a Difficulty was offered, and true where it was not",
    CHAT.includes('  return (difficulties || senses.length || pick || boxes.length || spend)\n    ? { difficulty: chosen.difficulty || "", senses: chosen.senses ?? [], picked: chosen.picked ?? "", boxes: chosen.boxes ?? [],\n      spent: chosen.spent ?? {} }\n    : true;'),
    true);
  check("read by the one caller that asked",
    SHEET.includes("      difficulty: ready.difficulty"), true);
  check("and the one place that tests for a false still gets one from a cancel",
    CHAT.includes("  if (!chosen || (typeof chosen !== \"object\")) return false;"), true);
}

// --- What the page says about a Skill Check's own Botch and Critical --------------------------------
{
  // "A Botch on a Skill Check is always a penalty of 2, regardless of your Tier of Power."
  check("a Skill Botch is a flat 2", DBUCharacterData.BOTCH_PENALTY, 2);
  check("and the character carries it apart from the scaled one",
    CHARACTER.includes("      skill: DBUCharacterData.BOTCH_PENALTY,"), true);
  check("where every other roll loses 2(bT)",
    CHARACTER.includes("        DBUCharacterData.BOTCH_PENALTY * this.baseTierOfPower)"), true);
  check("and the sheet picks between them by which kind of roll it is",
    SHEET.includes("    const botchPenalty = skillRoll"), true);

  // "A Critical on a Skill Check is a bonus Extra Dice of 1d4, regardless of your Tier of
  // Power."
  check("a Skill Critical is a flat 1d4", DBUCharacterData.SKILL_CRITICAL_DIE, "1d4");
  check("which is what a Skill Clash uses",
    CHAT.includes("    criticalDice: () => DBUCharacterData.SKILL_CRITICAL_DIE,"), true);
  check("and what the sheet's Skill Check uses",
    SHEET.includes("      criticalDice: DBUCharacterData.SKILL_CRITICAL_DIE,"), true);
  check("neither of them scaling with the Tier of Power",
    /SKILL_CRITICAL_DIE\s*=\s*"1d4"/.test(CHARACTER), true);

  // Both were already right before the page was read. Said here because a rule that
  // happens to be right is worth pinning once somebody has stated it.
  check("a Might Clash takes the character's own critical dice instead, being no Skill",
    CHAT.includes("    criticalDice: (actor) => actor.system.dice.critical.formula,"), true);
}

console.log(`${failed} failing`);
process.exit(failed ? 1 : 0);
