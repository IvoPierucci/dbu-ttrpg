/**
 * A roll's workings, as rows rather than as a sentence.
 *
 * One line per thing that moved the number, read top to bottom: the dice first, then
 * everything added, then the Botch, then everything taken away. Each line says the same
 * three things in the same three places - what the rulebook calls it, what it came to,
 * and where it came from - so the eye can run down a column instead of parsing prose.
 *
 * `written` is the amount as it is written in the rules, notation and all: "1(T)",
 * "-2(bT)", or just "+3" where the rule has no notation and the number is the whole of
 * it. `value` is what that came to for this character on this roll. Those are different
 * questions - a player who knows 1(T) is 3 for them still wants to see the 3 - and
 * running them together is what made the old line unreadable.
 */

/**
 * How the one-line form is punctuated.
 *
 * Literal characters rather than HTML entities: the line is read through
 * escapeExpression on its way onto a card, and an entity would show as its own source
 * text. One arrow, at the end, so what follows it is always the answer.
 */
const SEPARATOR = "  ·  ";
const ARROW = "  →  ";

/** Where each kind of line sits, top to bottom. */
const LINE_ORDER = Object.freeze({
  base: 0,
  critical: 1,
  positive: 2,
  botch: 3,
  negative: 4,
  note: 5
});

/**
 * The dice, as one line.
 *
 * `each` is every die on its own and `value` is their sum, because both are worth
 * seeing: the sum is what enters the total, and the individual results are what a
 * player checks when they want to know whether the Extra Dice were any good.
 */
export function diceLine(roll, source, { rank = "base", naturalShift = 0, natural = null,
                                  forcedNatural = null } = {}) {
  const dice = roll.dice ?? [];
  const each = dice.map(die => die.total);
  const sum = each.reduce((total, value) => total + value, 0) + naturalShift;

  // With the Base Die stated by an effect it was never rolled, so the line says what it
  // was set to rather than quoting a die that does not exist.
  const written = (forcedNatural !== null)
    ? `set to ${forcedNatural}`
    : dice.map(die => die.expression).join(" + ");

  return {
    kind: "dice",
    rank: LINE_ORDER[rank],
    written,
    each,
    value: sum,
    source,
    // Said on the line it happened to: the Natural Result is the Base Die's, and the
    // Extra Dice beside it are untouched.
    note: naturalShift ? `Natural Result ${natural}` : ""
  };
}

/** One thing added to or taken off the roll. */
export function partLine(part) {
  const value = part.value ?? 0;
  return {
    kind: "part",
    rank: LINE_ORDER[part.rank ?? (value < 0 ? "negative" : "positive")],
    // Falls back to the number itself, which is the honest answer for a value the
    // rules state as a number - a Strike of 12 is written "12" and nothing else.
    written: part.written ?? signed(value),
    value,
    source: part.label ?? ""
  };
}

/** Something that happened to the roll that is not a number. */
export function noteLine(text) {
  return { kind: "note", rank: LINE_ORDER.note, written: "", value: null, source: text };
}

/** A number with its sign always shown, since a column of them is read by sign. */
function signed(value) {
  return (value >= 0) ? `+${value}` : String(value);
}

/** The lines in reading order: dice, then what was added, the Botch, what was taken. */
function ordered(lines) {
  return [...lines].sort((a, b) => a.rank - b.rank);
}

/**
 * The workings as a table, for the hover.
 *
 * Four columns, and every row fills the same ones: what it is called, the dice if it
 * had any, what it came to, and where it came from. A row with no dice leaves that
 * column empty rather than shifting the others, which is what keeps the values in a
 * line the eye can follow.
 */
export function breakdownTable(lines, total) {
  const rows = ordered(lines).map(line => {
    if (line.kind === "note") {
      return `<tr class="dbu-bd-note"><td colspan="4">${esc(line.source)}</td></tr>`;
    }

    const each = (line.each?.length > 1) ? `[${line.each.join(" + ")}]` : "";
    const value = (line.kind === "dice") ? `[${line.value}]` : `[${signed(line.value)}]`;
    const source = line.note ? `${esc(line.source)} · ${esc(line.note)}` : esc(line.source);

    return `<tr>
      <td class="dbu-bd-written">${esc(line.written)}</td>
      <td class="dbu-bd-each">${each}</td>
      <td class="dbu-bd-value">${value}</td>
      <td class="dbu-bd-source">(${source})</td>
    </tr>`;
  }).join("");

  return `<table class="dbu-breakdown">${rows}
    <tr class="dbu-bd-total">
      <td></td><td></td>
      <td class="dbu-bd-value">[${total}]</td>
      <td class="dbu-bd-source">(Total)</td>
    </tr>
  </table>`;
}

/**
 * The same workings on one line, for anywhere a table cannot go.
 *
 * Kept derived from the lines rather than built alongside them: two descriptions of one
 * roll drift, and the one that drifts is always the one nobody is looking at.
 */
export function breakdownText(lines, total) {
  const parts = ordered(lines).map(line => {
    if (line.kind === "note") return line.source;
    const each = (line.each?.length > 1) ? ` [${line.each.join(" + ")}]` : "";
    const value = (line.kind === "dice") ? line.value : signed(line.value);
    const shown = (line.written === String(value)) ? "" : `${line.written} `;
    return `${line.source}: ${shown}${each}${value}`.replace(/\s+/g, " ");
  });

  return `${parts.join(SEPARATOR)}${ARROW}${total}`;
}

function esc(text) {
  return Handlebars.escapeExpression(String(text ?? ""));
}
