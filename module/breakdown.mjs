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

/**
 * Where each kind of line sits, top to bottom.
 *
 * Every Extra Dice row shares one rank, so they keep the order they were gathered in -
 * which is the order the rules granted them - rather than being shuffled among
 * themselves by a sort that has nothing to tell them apart.
 */
const LINE_ORDER = Object.freeze({
  base: 0,
  extra: 1,
  positive: 2,
  botch: 3,
  negative: 4,
  note: 5
});

/**
 * The Base Die.
 *
 * One die, and the number in brackets is its Natural Result - which is what a Botch and
 * a Critical are read off, so it is the one number on this row anybody needs. When an
 * effect moved it the bracket carries both, joined by an arrow: "10 → 7" says what was
 * rolled and what it became, which no single figure can.
 *
 * A Base Die an effect stated outright was never rolled at all, so there is nothing to
 * point away from - the arrow stands alone.
 */
export function baseDieLine(die, { rolled = null, natural = null, forcedNatural = null } = {}) {
  const shown = (forcedNatural !== null)
    ? `→ ${forcedNatural}`
    : (rolled !== natural) ? `${rolled} → ${natural}` : String(natural);

  return {
    kind: "base",
    rank: LINE_ORDER.base,
    written: die ?? "",
    each: [],
    // What it contributes is the Natural Result; `shown` is how that is written.
    value: (forcedNatural !== null) ? forcedNatural : natural,
    shown,
    source: "Base die"
  };
}

/**
 * Every Extra Die on the roll, on one line.
 *
 * One row per source - the Tier of Power Extra Dice, a State's Greater Dice, what the
 * Energy Charges are worth, the Critical Extra Dice - because "which rule gave me this
 * die" is the question a player asks of a fistful of them. Within a row they are
 * grouped by size and written smallest first: 1d4 + 2d6 + 1d8, so eight of a kind read
 * as "8d6" rather than as a list to count.
 */
export function extraDiceLine(terms, source = "Extra dice") {
  // Grouped by number of faces, since that is what makes two dice the same die.
  const byFaces = new Map();
  for (const term of terms ?? []) {
    const faces = term.faces ?? 0;
    const results = (term.results ?? []).map(r => r.result ?? r);
    const held = byFaces.get(faces) ?? { count: 0, results: [] };
    held.count += results.length;
    held.results.push(...results);
    byFaces.set(faces, held);
  }

  const sizes = [...byFaces.keys()].sort((a, b) => a - b);
  if (!sizes.length) return null;

  const written = sizes.map(faces => `${byFaces.get(faces).count}d${faces}`).join(" + ");
  const each = sizes.flatMap(faces => byFaces.get(faces).results);
  const value = each.reduce((total, result) => total + result, 0);

  return {
    kind: "dice",
    rank: LINE_ORDER.extra,
    written: `+${written}`,
    each,
    value,
    source
  };
}

/**
 * Dice rolled after the fact, by a Karmic Effect.
 *
 * Their own row for the reason they are not Extra Dice: they arrive once the roll has
 * been read, because somebody spent a Karma Point on it.
 */
export function diceLine(roll, source, { rank = "positive" } = {}) {
  const dice = roll.dice ?? [];
  const each = dice.flatMap(die => (die.results ?? []).map(r => r.result ?? r));
  return {
    kind: "dice",
    rank: LINE_ORDER[rank],
    written: `+${dice.map(die => die.expression).join(" + ")}`,
    each,
    value: each.reduce((total, result) => total + result, 0),
    source
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
    // `shown` is how a row writes its own value when the number alone will not do -
    // the Base Die's "10 → 7", which says what was rolled and what it became.
    const value = line.shown ?? ((line.kind === "dice") ? String(line.value) : signed(line.value));

    return `<tr>
      <td class="dbu-bd-written">${esc(line.written)}</td>
      <td class="dbu-bd-each">${each}</td>
      <td class="dbu-bd-value">[${esc(value)}]</td>
      <td class="dbu-bd-source">(${esc(line.source)})</td>
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
    const value = line.shown ?? ((line.kind === "dice") ? String(line.value) : signed(line.value));
    const shown = (line.written === value) ? "" : `${line.written} `;
    return `${line.source}: ${shown}${each}${value}`.replace(/\s+/g, " ");
  });

  return `${parts.join(SEPARATOR)}${ARROW}${total}`;
}

function esc(text) {
  return Handlebars.escapeExpression(String(text ?? ""));
}
