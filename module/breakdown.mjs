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
  // What a floor handed back, which has to come after everything it was measured
  // against - a clamp is the last thing that happens to a number.
  floor: 5,
  note: 6
});

/**
 * The Base Die.
 *
 * One die, and the number in brackets is its Natural Result - the Base Die alone, which
 * is what a Botch and a Critical are read off, so it is the one number on this row
 * anybody needs. When an effect moved it the bracket carries both, joined by an arrow:
 * "10 → 7" says what was rolled and what it became, which no single figure can.
 *
 * The two terms the rules use for a roll meet on this table. The Natural Result is this
 * row's bracket; the Dice Score is the row at the bottom - the Base Die, every other
 * die, and every bonus, all together.
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

/**
 * Lines that came from how the dice landed rather than from what was added to them.
 *
 * A Botch and the Critical Extra Dice are read off the Base Die, so replacing that die
 * replaces them - and Karmic Chance replaces it. Marked here so the reroll can take
 * them away rather than leaving a Botch on the card that the new total was worked out
 * without.
 */
export function fromOutcome(line) {
  return line ? { ...line, outcome: true } : line;
}

/** Whatever a roll's lines are, minus the ones its Base Die decided. */
export function withoutOutcome(lines) {
  return (lines ?? []).filter(line => !line.outcome);
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

/**
 * Where a floor stopped the number.
 *
 * A table of signed numbers with an answer ruled off underneath is an addition, and a
 * reader who cannot make it come out will conclude the card is lying rather than that a
 * rule quietly clamped something. So every clamp that bites gets a row: the rules do
 * this in two places, and neither of them was visible.
 *
 * What the row shows is where the number came to rest, not what the floor handed back to
 * get it there. Written as a compensation it read as one more bonus - a column with
 * "-8 (Dim. Defense)" above "+3 (Penalties stop at the dice)" looks like something gave
 * three points back, when what happened is that the penalties ran out of bonuses to take
 * and stopped at nothing.
 *
 * `written` carries the sentence and the value column carries the floor itself, so the
 * row reads as a statement and still lets the column be followed down to the total.
 *
 * Returns nothing when the floor did not bite, since a row saying a rule left the number
 * alone is a row to read past.
 *
 * @param {number} given  what the clamp handed back; zero means it did not bite
 * @param {number} floor  where the number stopped
 * @param {string} source what stopped it
 */
export function floorLine(given, floor, source) {
  if (!given) return null;
  return {
    kind: "part",
    rank: LINE_ORDER.floor,
    written: "stops at",
    value: floor,
    shown: String(floor),
    source
  };
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

/**
 * What one Slot contribution is called, and which way it points.
 *
 * The rules name these operations rather than writing them as arithmetic - "reduce your
 * Soak Value by 2(bT)", "the Dice Score of the Wound Roll is halved" - so each row says
 * the operation and lets the number speak for itself.
 */
function contributionLine(part) {
  const value = Number(part.value) || 0;
  const label = part.source || "an effect";

  switch (part.op) {
    case "multiply":
      return { ...partLine({ label, value: 0, rank: "negative" }),
        written: `x${value}`, shown: `x${value}` };
    case "set":
      return { ...partLine({ label, value, rank: "positive" }),
        written: `set ${value}`, shown: `= ${value}` };
    case "min":
      return { ...partLine({ label, value, rank: "positive" }),
        written: `at least ${value}`, shown: `>= ${value}` };
    case "max":
      return { ...partLine({ label, value, rank: "negative" }),
        written: `at most ${value}`, shown: `<= ${value}` };
    default:
      return partLine({ label, value });
  }
}

/**
 * One derived value's workings, as the table a roll's hover uses.
 *
 * `key` may be a chain, for a value that went through more than one Slot on its way -
 * the Soak Value is `soakValue` and then `soakValue.external`, one for what the character
 * has and one for what anybody else did to it. The base and its ingredients come from the
 * first; every Slot's contributions follow in the order they were applied; the total is
 * the last one's.
 *
 * `extra` is for what the sheet cannot fold into the number: anything applied when the
 * dice come out rather than when the character is derived. Those arrive as notes, which
 * sit below the total rather than inside the sum.
 *
 * `total` overrides the answer, for the values clamped once more outside every Slot. A
 * table whose answer differs from the number it is attached to is worse than no table.
 */
export function workingsTable(system, key, { extra = [], total = null } = {}) {
  const keys = Array.isArray(key) ? key : [key];
  const steps = keys.map(one => system.effects?.workings?.[one]).filter(Boolean);
  if (!steps.length) return "";

  const lines = [];
  const first = steps[0];

  // The base by its ingredients where the data model named them, and as one number where
  // it did not. A part worth nothing is left out: "Size 0" is a row saying only that Size
  // did not apply.
  const named = (first.parts ?? []).filter(part => Number(part.value) !== 0);
  if (named.length) for (const part of named) lines.push(partLine({ label: part.label, value: part.value }));
  else lines.push(partLine({ label: "Base", value: first.base }));

  for (const step of steps) {
    for (const part of step.contributions ?? []) lines.push(contributionLine(part));

    if ((step.floored !== null) && (step.floored !== undefined)) {
      lines.push(floorLine(step.base, step.floored, "nothing goes below zero"));
    }
  }

  for (const note of extra) if (note) lines.push(noteLine(note));

  return breakdownTable(lines, total ?? steps[steps.length - 1].value);
}

/**
 * Everything a Combat Roll picks up between the sheet and the dice.
 *
 * None of it is in the number above, and none of it can be: Diminishing Offense counts
 * the attacks made this Combat Round, the Health Threshold penalty follows the Life
 * Points, and the Muscle Penalty follows the Super Stacks held right now. All three are
 * true of a roll rather than of a character, so they are said rather than folded in - the
 * number on the sheet stays the one the rules call the Strike Roll.
 */
export function atRollTime(system, which) {
  const notes = [];

  if (which === "strike") {
    const { stacks = 0, penalty = 0 } = system.diminishing?.offense ?? {};
    if (penalty) notes.push(`-${penalty} Diminishing Offense, from ${stacks} stack(s) this round`);
  }
  if (which === "dodge") {
    const { penalty = 0 } = system.diminishing?.defense ?? {};
    if (penalty) notes.push(`-${penalty} Diminishing Defense, from ${penalty} stack(s) this round`);
  }

  // On the Strike and the Dodge, not on the Wound: the Muscle Penalty is written against
  // the rolls you make with your body rather than the damage they do.
  if ((which === "strike") || (which === "dodge")) {
    const muscle = system.superStack?.musclePenalty ?? 0;
    if (muscle) notes.push(`-${muscle} Muscle Penalty, from ${system.superStack.stacks} Super Stack(s)`);
  }

  // Every Combat Roll, the Wound Roll included. Failed Steadfast Checks, not the
  // Threshold itself: reaching one costs nothing, and losing the Check it asks for costs
  // 1(bT) on every Combat Roll from then on.
  const threshold = system.threshold?.penalty ?? 0;
  const failures = system.threshold?.failures ?? 0;
  if (threshold) {
    notes.push(`-${threshold} from ${failures} failed Steadfast Check${
      failures === 1 ? "" : "s"} at a Health Threshold`);
  }

  const extra = system.dice?.extra?.formula ?? "";
  if (extra) notes.push(`+${extra} Tier of Power Extra Dice, on every Combat Roll`);

  return notes;
}

/**
 * A roll as a formula, for the window it is rolled from: `1d10 + 1d4 + 1d6 + 20`. Each piece names itself on hover -
 * the Base Die, each group of Extra or Greater Dice by what gave it, and the bonus as the table of what it is made of:
 * the workings of each part that has them (its Talents, its Items, its effects - the same table as the sheet's hover)
 * and the parts summed where there is more than one.
 *
 * @param {object} formula
 * @param {string} [formula.base]   the Base Die
 * @param {{formula: string, label: string}[]} [formula.dice]   the dice beside it, each group by its source
 * @param {{label: string, value: number, workings?: string}[]} [formula.parts]   what is added, `workings` an HTML
 *   table (workingsTable) where the part has one
 */
export function formulaHtml({ base = "1d10", dice = [], parts = [] } = {}) {
  // Escaped here for an attribute, quotes and all: the tooltip may be a whole table.
  const attr = text => String(text ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const piece = (text, tip, html = false) =>
    `<span class="dbu-formula-piece" ${html ? "data-tooltip-html" : "data-tooltip"}="${attr(tip)}">${esc(text)}</span>`;
  const counted = parts.filter(part => Number(part.value) || part.workings);
  const netted = counted.reduce((sum, part) => sum + (Number(part.value) || 0), 0);
  // Penalties cancel bonuses but never take a roll below its dice.
  const bonus = Math.max(0, netted);
  const tables = counted.filter(part => part.workings)
    .map(part => `<div class="dbu-bd-head">${esc(part.label)}</div>${part.workings}`);
  const summed = ((counted.length > 1) || !tables.length)
    ? breakdownTable(counted.map(part => partLine({ label: part.label, value: Number(part.value) || 0 })), bonus) : "";
  return [
    piece(base, "Base Die"),
    ...dice.filter(group => group.formula).map(group => piece(group.formula, group.label)),
    piece(String(bonus), `${tables.join("")}${summed}`, true)
  ].join(" + ");
}
