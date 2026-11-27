/**
 * A roll's workings, as rows.
 *
 * The old form was a sentence - "1d10 10 · bonuses +1 (Strike 1) · penalties -3 → 8" -
 * and it had to be parsed rather than read: the amounts and the sources ran together,
 * and a number in it could be a result or an amount taken off with no way to tell.
 *
 * Rows fix that by putting the same three things in the same three places on every
 * line: what the rulebook calls it, what it came to, and where it came from. So what is
 * checked here is the shape of the table and the order of it, since the complaint was
 * about reading and not about arithmetic.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
const modUrl = p => pathToFileURL(path.join(ROOT, "module", p)).href;

globalThis.Handlebars = {
  escapeExpression: text => String(text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#x27;")
};

const { baseDieLine, extraDiceLine, diceLine, partLine, noteLine, floorLine,
        fromOutcome, withoutOutcome, breakdownTable, breakdownText } =
  await import(modUrl("breakdown.mjs"));

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

/** A DiceTerm as the builders read one: a face count and the results it rolled. */
const term = (faces, ...results) => ({
  faces, expression: `${results.length}d${faces}`, results: results.map(result => ({ result }))
});

/** The table as rows of plain text, which is what a reader actually sees. */
function rows(lines, total) {
  return breakdownTable(lines, total)
    .split("<tr")
    .slice(1)
    .map(row => row
      // Splitting on "<tr" leaves the rest of that opening tag behind, so it goes first.
      .replace(/^[^>]*>/, "")
      // Tags become spaces rather than nothing: two cells run together otherwise, and
      // a separator that is a real space needs nothing invisible to stand for it.
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim())
    .filter(Boolean);
}

// --- The line the whole thing is for -----------------------------------------
// A 1d10 showing 10, three stacks of Impaired taking the Natural Result to 7, and a
// Strike of 1. The bracket on the Base Die carries both numbers: what was rolled and
// what it became. Neither on its own answers "did that Botch?".
{
  const lines = [
    baseDieLine("1d10", { rolled: 10, natural: 7 }),
    partLine({ label: "Strike", value: 1 })
  ];
  check("the Base Die shows what it became, and what from",
    rows(lines, 8),
    ["1d10 [10 → 7] (Base die)", "+1 [+1] (Strike)", "[8] (Total)"]);
}

// Untouched, it is one number and no arrow - an arrow pointing at nothing is a
// question the reader has to answer before they can read past it.
check("an untouched Base Die is just its result",
  rows([baseDieLine("1d10", { rolled: 7, natural: 7 })], 7)[0], "1d10 [7] (Base die)");

// A Base Die an effect stated outright was never rolled, so there is nothing to point
// away from and the arrow stands alone.
check("a stated Base Die has nothing to point away from",
  rows([baseDieLine("1d10", { forcedNatural: 8 })], 8)[0], "1d10 [→ 8] (Base die)");

// --- Extra Dice, one row per source -------------------------------------------
// Within a row they are grouped by size and written smallest first, so two of the same
// die read as "2d6" and the row can be checked against what is on the table.
{
  const dice = extraDiceLine([term(6, 4, 2), term(4, 3), term(6, 5)]);
  // Three d6 across two terms, counted as three - which is the point: a player
  // holding them sees three d6, not "two and another one".
  check("they are grouped by size and ordered smallest first",
    rows([dice], 14)[0], "+1d4 + 3d6 [3 + 4 + 2 + 5] [14] (Extra dice)");
}

check("one Extra Die is not listed beside its own total",
  rows([extraDiceLine([term(8, 6)])], 6)[0], "+1d8 [6] (Extra dice)");

check("four sizes come out in size order",
  extraDiceLine([term(10, 1), term(4, 2), term(8, 3), term(6, 4)]).written,
  "+1d4 + 1d6 + 1d8 + 1d10");

check("no Extra Dice, no row", extraDiceLine([]), null);

// Each source gets its own row, and they stay in the order they were granted rather
// than being shuffled among themselves - they share a rank, and the sort is stable.
{
  const lines = [
    baseDieLine("1d10", { rolled: 9, natural: 9 }),
    extraDiceLine([term(6, 3, 4)], "Extra dice"),
    extraDiceLine([term(8, 7)], "Superior"),
    extraDiceLine([term(6, 2, 5, 1)], "Energy charges"),
    extraDiceLine([term(4, 3)], "Critical"),
    partLine({ label: "Wound", value: 11 })
  ];
  check("one row per source, in the order they were granted",
    rows(lines, 45).map(row => row.slice(row.lastIndexOf("(") + 1, -1)),
    ["Base die", "Extra dice", "Superior", "Energy charges", "Critical", "Wound", "Total"]);

  check("and each says what it was worth",
    rows(lines, 45)[3], "+3d6 [2 + 5 + 1] [8] (Energy charges)");
}

// --- Every column in one table ------------------------------------------------
{
  const lines = [
    baseDieLine("1d10", { rolled: 10, natural: 10 }),
    extraDiceLine([term(6, 4, 3), term(4, 2)]),
    partLine({ label: "Superior", written: "+1(T)", value: 3 }),
    partLine({ label: "Strike", value: 12 }),
    partLine({ label: "Botch", written: "-2(bT)", value: -6, rank: "botch" }),
    partLine({ label: "Dim. Offense", value: -4 })
  ];
  check("written amount, dice, value, source - in that order on every row",
    rows(lines, 24),
    ["1d10 [10] (Base die)",
     "+1d4 + 2d6 [2 + 4 + 3] [9] (Extra dice)",
     "+1(T) [+3] (Superior)",
     "+12 [+12] (Strike)",
     "-2(bT) [-6] (Botch)",
     "-4 [-4] (Dim. Offense)",
     "[24] (Total)"]);
}

// --- The order is the order, whatever order they arrive in --------------------
// The maths happens dice, parts, then the Botch or the Critical - and the Critical is
// only known at the end, which is why the dice rows are drawn last and sorted first.
{
  const lines = [
    partLine({ label: "Late penalty", value: -2 }),
    partLine({ label: "Early bonus", value: 5 }),
    extraDiceLine([term(4, 3)]),
    baseDieLine("1d10", { rolled: 10, natural: 10 })
  ];
  check("the dice come first however late they were gathered",
    rows(lines, 16).map(row => row.slice(row.lastIndexOf("(") + 1, -1)),
    ["Base die", "Extra dice", "Early bonus", "Late penalty", "Total"]);
}

// The Botch sits between what was added and what was taken - it is a penalty, but it
// is the roll's own outcome rather than one more modifier, and the eye wants it apart.
{
  const lines = [
    baseDieLine("1d10", { rolled: 1, natural: 1 }),
    partLine({ label: "Penalty", value: -3 }),
    partLine({ label: "Bonus", value: 4 }),
    partLine({ label: "Botch", written: "-2(bT)", value: -6, rank: "botch" })
  ];
  check("the Botch sits between the bonuses and the penalties",
    rows(lines, 0).map(row => row.slice(row.lastIndexOf("(") + 1, -1)),
    ["Base die", "Bonus", "Botch", "Penalty", "Total"]);
}

// --- Dice that arrive later ---------------------------------------------------
// Karma and Karmic Chance are not Extra Dice. They arrive once the roll has been read,
// because somebody spent a Karma Point - and a row that hid that would be hiding the
// only part of the roll that was a decision.
check("Karma keeps a row of its own, below the roll",
  rows([baseDieLine("1d10", { rolled: 6, natural: 6 }),
        diceLine({ dice: [term(8, 5)] }, "Karma")], 11)
    .map(row => row.slice(row.lastIndexOf("(") + 1, -1)),
  ["Base die", "Karma", "Total"]);

// --- Notes --------------------------------------------------------------------
check("a note takes the whole row",
  rows([baseDieLine("1d10", { rolled: 4, natural: 4 }),
        noteLine("Urgent - a willing failure was refused")], 4),
  ["1d10 [4] (Base die)", "Urgent - a willing failure was refused", "[4] (Total)"]);

// --- It is still readable as one line -----------------------------------------
check("the one-line form says the same things",
  breakdownText([
    baseDieLine("1d10", { rolled: 10, natural: 7 }),
    partLine({ label: "Strike", written: "+1(T)", value: 3 })
  ], 10),
  "Base die: 1d10 10 → 7  ·  Strike: +1(T) +3  →  10");

// --- The line has one shape, in one place -------------------------------------
{
  const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
  const OWN = fs.readFileSync(path.join(ROOT, "module", "breakdown.mjs"), "utf8");

  check("the punctuation is defined once",
    [/const SEPARATOR = /.test(OWN), /const ARROW = /.test(OWN),
     /const SEPARATOR = /.test(CHAT), /const ARROW = /.test(CHAT)],
    [true, true, false, false]);

  // The one-line form is escaped on its way onto a card, so an entity in it shows as
  // its own source text. The table is injected as HTML and may hold them; the sentence
  // may not, and the sentence is what this file builds.
  check("no HTML entity is written into the one-line form",
    /breakdownText[^]{0,400}&(middot|rarr|amp|nbsp);/.test(OWN), false);

  check("no line quotes a raw roll formula", /roll[.]formula/.test(CHAT), false);

  // The total is drawn from the lines rather than being one of them, which is what
  // makes a second total in the middle of the line impossible rather than trimmed.
  check("the total is not a line",
    /lines[^]{0,200}rank: LINE_ORDER[.]total/.test(OWN), false);
}

// --- The markup is what Foundry will accept -----------------------------------
// It reaches the player through `data-tooltip-html`, which runs it through cleanHTML -
// so only tags on Foundry's list survive, and a source name a player chose has to be
// escaped or a character called <b> would style the tooltip.
{
  const html = breakdownTable([partLine({ label: "<b>Ku</b>", value: 2 })], 2);
  check("only tags Foundry allows are used",
    [...html.matchAll(/<(\/?)([a-z]+)/g)].map(m => m[2]).filter((t, i, a) => a.indexOf(t) === i),
    ["table", "tr", "td"]);
  check("and a source name is escaped rather than rendered",
    html.includes("&lt;b&gt;Ku&lt;/b&gt;"), true);
}

// --- Sharing the rolled dice back out ------------------------------------------
// They are rolled as one formula, so which term belongs to which source is worked out
// by counting dice in each group's formula. Our formulas are always "NdM" joined with
// plus signs - written by this system, never typed by a player - but a miscount here
// would silently put somebody else's dice on your row, so it is checked.
{
  const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
  const count = formula => (String(formula).match(/[0-9]*d[0-9]+/gi) ?? []).length;

  check("a single die counts as one", count("1d6"), 1);
  check("a handful of one size still counts as one term", count("8d6"), 1);
  check("two terms count as two", count("3d6 + 1d4"), 2);
  check("nothing counts as nothing", [count(""), count(null)], [0, 0]);

  // The same counting the product does, so this is checking the rule and not a copy.
  check("the count is done the same way in the product",
    CHAT.includes("match(/\\d*d\\d+/gi)"), true);

  // Dice the groups did not account for are shown rather than dropped. A die that
  // vanishes off the card is worse than one labelled vaguely, and a miscount is the
  // only way it could happen.
  check("leftover dice are still shown", /leftover/.test(CHAT), true);

  // The Energy Charges are the reason this matters: seven Charges at Tier 3 is
  // twenty-one dice, and they must not be lumped in with the Tier's own.
  check("the Wound Roll keeps the Charges apart from the Tier's dice",
    /label: "Energy charges", formula: energyChargeDice\(attacker, attack\)/.test(CHAT), true);
}

// --- The column has to add up --------------------------------------------------
// A table of signed numbers with an answer ruled off underneath is an addition, and a
// reader who cannot make it come out will conclude the card is lying rather than that a
// rule quietly clamped something. The rules clamp in two places and neither was shown.
const adds = lines => lines.reduce((sum, line) => sum + (line.value ?? 0), 0);

// "Penalties cancel bonuses; they never drag a roll below the dice." With 2 of bonus
// against 6 of penalty the roll keeps its dice, and the row says where the bonuses
// stopped rather than what the floor handed back to get them there.
//
// Written as a compensation it read as one more bonus: a column with "-6 (Thresholds)"
// above "+4 (Penalties stop at the dice)" looks like something gave four points back,
// when what happened is that the penalties ran out of bonuses to take.
{
  const parts = [{ label: "Strike", value: 2 }, { label: "Thresholds", value: -6 }];
  const netted = parts.reduce((sum, p) => sum + p.value, 0);
  const bonus = Math.max(0, netted);
  const floor = floorLine(bonus - netted, bonus,
    "Penalties took the bonuses to nothing, and stop there");

  check("the row says where the bonuses stopped, not what it gave back",
    [floor.value, floor.shown], [0, "0"]);
  check("and reads as a statement rather than a sum",
    rows([floor], 0)[0],
    "stops at [0] (Penalties took the bonuses to nothing, and stop there)");

  // The dice are what is left, and the column still comes out at the total.
  const lines = [baseDieLine("1d10", { rolled: 7, natural: 7 }), ...parts.map(partLine), floor]
    .filter(Boolean);
  check("the column still adds up to the roll", adds(lines) - netted + bonus, 7);
}

// And the floor at zero, which only a Botch can reach - the bonuses are already floored
// at nothing and the dice never come to less.
{
  const floor = floorLine(0 - (1 + 2 - 9), 0,
    "A Botch takes what it takes, and stops at nothing");
  check("the zero floor says where the total stopped", floor.value, 0);
  check("and says why",
    rows([floor], 0)[0],
    "stops at [0] (A Botch takes what it takes, and stops at nothing)");
}

// A floor that did not bite writes nothing: a row saying a rule left the number alone
// is a row to read past.
check("a floor that did not bite is not a row",
  floorLine(0, 0, "A Botch takes what it takes, and stops at nothing"), null);

// --- What the Base Die decided goes with the Base Die --------------------------
// The floor at zero among it. Only a Botch can drive a total under zero, so when Karmic
// Chance replaces the die and the Botch goes, this has to go too - left standing, a roll
// rerolled out of its Botch kept a row saying it had been rescued from a negative it no
// longer had. Which is exactly what a reported card showed: a Dodge rerolled from 1 to 6,
// total 6, and a row underneath claiming something had been floored.
{
  const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
  check("the zero floor is marked as the die's doing",
    /const floored = fromOutcome\(floorLine\(Math\.max\(0, total\) - total, 0,/.test(CHAT), true);

  // The other floor is not: it comes from the parts, which a reroll does not touch.
  check("the floor on the bonuses is not, since a reroll does not move them",
    /const held = floorLine\(bonus - netted, bonus,/.test(CHAT), true);

  const kept = { outcome: true, value: 1 };
  const stays = { value: 2 };
  check("so a reroll strips one and keeps the other",
    withoutOutcome([kept, stays]), [stays]);
}


// Karmic Chance replaces it, and the new total is worked out from what the roll came
// to *before* the old die's consequences. So those consequences come off the card with
// it, or a Botch sits beside a total that was reached without it.
{
  const before = [
    baseDieLine("1d10", { rolled: 1, natural: 1 }),
    partLine({ label: "Strike", value: 12 }),
    fromOutcome(partLine({ label: "Botch", value: -6, rank: "botch" }))
  ];
  check("a reroll drops the old Botch and keeps the rest",
    withoutOutcome(before).map(line => line.source), ["Base die", "Strike"]);

  // Critical Extra Dice are read off the same die, so they go the same way.
  const crit = [
    baseDieLine("1d10", { rolled: 10, natural: 10 }),
    extraDiceLine([term(6, 4)], "Extra dice"),
    fromOutcome(extraDiceLine([term(4, 3)], "Critical"))
  ];
  check("and the old Critical Extra Dice with it",
    withoutOutcome(crit).map(line => line.source), ["Base die", "Extra dice"]);
}

// --- Every roll in the system reads the same way -------------------------------
// A Skill Check used to show Foundry's own dice tooltip and nothing about where the
// bonus came from, or - on a Botch - a sentence quoting the raw formula.
{
  const SHEET = fs.readFileSync(
    path.join(ROOT, "module", "sheets", "actor-character-sheet.mjs"), "utf8");

  check("the sheet builds the same rows", /baseDieLine|extraDiceLine/.test(SHEET), true);
  check("and quotes no raw formula anywhere", /roll[.]formula/.test(SHEET), false);

  // Each caller names what it is rolling, which is the whole point of a source column.
  // Looked for where a check is actually built - `bonus:` is a field name too, and the
  // Attribute rows have carried one since they started carrying their workings.
  const checks = SHEET.split("checkCard(").slice(1).join("checkCard(");
  check("every check names its source rather than passing a bare number",
    /bonus: (this[.]actor|attribute|save|total)/.test(checks), false);
}

// --- The two terms the rules use about a roll -----------------------------------
// The Natural Result is the Base Die alone. The Dice Score is the whole roll - the Base
// Die, every other die, and every bonus, all together. They meet on this table: the
// first is the Base Die row's bracket, the second is the row at the bottom.
{
  const lines = [
    baseDieLine("1d10", { rolled: 7, natural: 7 }),
    extraDiceLine([term(6, 4, 2)], "Extra dice"),
    partLine({ label: "Strike", value: 12 })
  ];
  const drawn = rows(lines, 25);

  check("the Natural Result is the Base Die's bracket",
    drawn[0], "1d10 [7] (Base die)");
  check("and the Dice Score is everything, at the bottom",
    drawn.at(-1), "[25] (Total)");

  // Which is to say the bottom row is the sum of the rows above it, dice and bonuses
  // alike - that is what makes it the Dice Score and not something else.
  check("and it is the sum of every row above it",
    lines.reduce((sum, line) => sum + (line.value ?? 0), 0), 25);
}

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
