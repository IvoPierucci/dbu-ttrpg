/**
 * Turning a script into tokens.
 *
 * Every token carries the line and column it came from, because the whole point of
 * having a language is that a mistake gets pointed at. An author who writes a slot name
 * wrong should be told where, not handed a Trait that quietly does nothing - which is
 * exactly what the old data rows did.
 */

export const T = Object.freeze({
  BRACKET: "bracket",     // [ ]
  PAREN: "paren",         // ( )
  BRACE: "brace",         // { }
  PUNCT: "punct",         // ; , ? :
  OPERATOR: "operator",
  NUMBER: "number",
  DICE: "dice",           // 1d10
  SCALE: "scale",         // the (T) or (bT) that follows an amount
  WORD: "word",           // an identifier or a dotted path
  STRING: "string",
  EOF: "eof"
});

/** Longest first, so `<=` is never read as `<` followed by `=`. */
const OPERATORS = [
  "min=", "max=", "+=", "-=", "*=", "/=",
  "==", "!=", "<=", ">=", "&&", "||",
  "=", "<", ">", "!", "+", "-", "*", "/", "%"
];

export class LexError extends Error {
  constructor(message, line, column) {
    super(message);
    this.line = line;
    this.column = column;
  }
}

/**
 * @param {string} source
 * @returns {{tokens: Array, errors: Array}}
 */
export function tokenize(source) {
  const tokens = [];
  const errors = [];

  let i = 0;
  let line = 1;
  let lineStart = 0;
  const n = source.length;

  const column = () => (i - lineStart) + 1;
  const push = (type, value, at = column()) => tokens.push({ type, value, line, column: at });

  while (i < n) {
    const c = source[i];

    if (c === "\n") { line++; i++; lineStart = i; continue; }
    if (c === " " || c === "\t" || c === "\r") { i++; continue; }

    // A comment runs to the end of the line. `#` as well as `//`, because the rulebook
    // uses `#` in its own examples and an author copying one should not be punished.
    if ((c === "#") || (c === "/" && source[i + 1] === "/")) {
      while (i < n && source[i] !== "\n") i++;
      continue;
    }

    if ("[]".includes(c)) { push(T.BRACKET, c); i++; continue; }
    if ("{}".includes(c)) { push(T.BRACE, c); i++; continue; }
    if (";,?:".includes(c)) { push(T.PUNCT, c); i++; continue; }

    // A parenthesis directly after an amount is its scale, not a group: `2(T)` is two
    // per Tier of Power, written the way the rulebook writes it.
    if (c === "(") {
      const previous = tokens[tokens.length - 1];
      const touching = previous && (previous.line === line)
        && ((previous.column + String(previous.value).length) === column());
      const scale = source.slice(i).match(/^\((T|bT)\)/);

      // A level scales like any other amount: Raging at level 2 gives Wound +2(T), not
      // +1(T), so L has to be able to carry a scale the same way a number does.
      const scalable = previous
        && ((previous.type === T.NUMBER) || (previous.type === T.DICE)
          || ((previous.type === T.WORD) && (previous.value === "L")));

      if (scale && touching && scalable) {
        push(T.SCALE, scale[1]);
        i += scale[0].length;
        continue;
      }
      push(T.PAREN, "(");
      i++;
      continue;
    }
    if (c === ")") { push(T.PAREN, ")"); i++; continue; }

    if (c === '"' || c === "'") {
      const quote = c;
      const at = column();
      let j = i + 1;
      let text = "";
      while ((j < n) && (source[j] !== quote)) {
        if (source[j] === "\n") break;
        text += source[j];
        j++;
      }
      if ((j >= n) || (source[j] !== quote)) {
        errors.push(new LexError("This text is never closed.", line, at));
        i = j;
        continue;
      }
      push(T.STRING, text, at);
      i = j + 1;
      continue;
    }

    // A number, possibly dice. `1d10` is one token so the amount stays whole.
    if (/[0-9]/.test(c)) {
      const at = column();
      const dice = source.slice(i).match(/^\d+d\d+/);
      if (dice) {
        push(T.DICE, dice[0], at);
        i += dice[0].length;
        continue;
      }
      const number = source.slice(i).match(/^\d+(\.\d+)?/);
      push(T.NUMBER, Number(number[0]), at);
      i += number[0].length;
      continue;
    }

    // `min=` and `max=` are the only operators that start with letters, so they have to
    // be taken before the word branch below - otherwise they lex as the word "min" and
    // a separate "=", and the parser sees a slot that is not being changed at all.
    const worded = source.slice(i).match(/^(min|max)=(?!=)/);
    if (worded) {
      push(T.OPERATOR, worded[0]);
      i += worded[0].length;
      continue;
    }

    // A word, or a dotted path. Kept as one token because `defend.guard.kiCost` names
    // a single Slot and splitting it would only make the parser glue it back together.
    if (/[A-Za-z_]/.test(c)) {
      const at = column();
      const word = source.slice(i).match(/^[A-Za-z_][\w-]*(\.[A-Za-z_][\w-]*)*/);
      push(T.WORD, word[0], at);
      i += word[0].length;
      continue;
    }

    const operator = OPERATORS.find(op => source.startsWith(op, i));
    if (operator) {
      push(T.OPERATOR, operator);
      i += operator.length;
      continue;
    }

    errors.push(new LexError(`"${c}" does not mean anything here.`, line, column()));
    i++;
  }

  tokens.push({ type: T.EOF, value: null, line, column: column() });
  return { tokens, errors };
}
