/**
 * Turning tokens into a program.
 *
 * Recursive descent, and deliberately forgiving in one way: it **collects** errors
 * instead of throwing on the first. An author who mistyped three slot names should be
 * told about all three, not made to save four times to find them.
 */

import { tokenize, T } from "./lexer.mjs";
import * as A from "./ast.mjs";
import { validateProgram } from "./ast.mjs";

/** Block keywords that say what mode the effect is in. */
const MODES = ["passive", "triggered", "automatic"];

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.i = 0;
    this.errors = [];
  }

  /**
   * The cursor never runs off the end.
   *
   * Past the last token every read is EOF and `next` stops advancing, so a file that
   * ends mid-statement produces an error like any other mistake. This parser exists to
   * collect problems rather than throw them: a Trait that threw here would take
   * `prepareDerivedData` down with it and leave the whole character unusable, which is
   * a much worse answer than "line 3: this block is never closed".
   */
  peek(offset = 0) {
    return this.tokens[Math.min(this.i + offset, this.tokens.length - 1)];
  }

  next() {
    const token = this.peek();
    if (this.i < this.tokens.length - 1) this.i++;
    return token;
  }

  atEnd() { return this.peek().type === T.EOF; }

  is(type, value) {
    const t = this.peek();
    return (t.type === type) && ((value === undefined) || (t.value === value));
  }

  accept(type, value) {
    if (!this.is(type, value)) return null;
    return this.next();
  }

  expect(type, value, what) {
    const t = this.accept(type, value);
    if (t) return t;
    this.fail(what ?? `Expected ${value ?? type}.`);
    return null;
  }

  fail(message, token = this.peek()) {
    this.errors.push({ message, line: token?.line, column: token?.column });
  }

  /** Skip to the end of the current statement, so one mistake does not cascade. */
  recover() {
    while (!this.atEnd() && !this.is(T.PUNCT, ";") && !this.is(T.BRACKET, "[")) this.next();
    this.accept(T.PUNCT, ";");
  }

  // --- Program --------------------------------------------------------------

  parseProgram() {
    const blocks = [];
    while (!this.atEnd()) {
      if (!this.is(T.BRACKET, "[")) {
        this.fail("Every effect starts with its keyword in brackets, like [passive].");
        this.recover();
        continue;
      }
      const b = this.parseBlock(blocks.length + 1);
      if (b) blocks.push(b);
    }
    return A.program(blocks);
  }

  parseBlock(index) {
    this.expect(T.BRACKET, "[");

    const header = [];
    while (!this.atEnd() && !this.is(T.BRACKET, "]")) header.push(this.next());
    this.expect(T.BRACKET, "]", "This effect's keywords are never closed with ].");

    const b = this.readHeader(header, index);

    const statements = [];
    let requires = null;
    while (!this.atEnd() && !this.is(T.BRACKET, "[")) {
      // `requires` is the condition for the effect being available at all, which the
      // sheet reads to grey a Maneuver out and say why. An `if` inside the body is a
      // plain branch and cannot serve for that - it would run and do nothing.
      if (this.is(T.WORD, "requires")) {
        this.next();
        requires = this.parseExpression();
        this.accept(T.PUNCT, ";");
        continue;
      }
      const s = this.parseStatement();
      if (s) statements.push(s);
    }

    return A.block({ ...b, index, requires, statements });
  }

  /** The bracketed keywords: the mode, the moment, the budget and the modifiers. */
  readHeader(tokens, index) {
    const groups = [[]];
    for (const t of tokens) {
      if ((t.type === T.PUNCT) && (t.value === ",")) groups.push([]);
      else groups[groups.length - 1].push(t);
    }

    let mode = "passive";
    let moment = null;
    const budget = {};
    const modifiers = {};

    for (const group of groups) {
      if (!group.length) continue;

      // A comma is not required between keywords: `[passive per stack]` is one group
      // holding two of them, and reading only the first silently dropped the rest -
      // which is exactly the quiet failure this language exists to prevent. So a group
      // is walked rather than assumed to hold one keyword.
      let at = 0;
      while (at < group.length) {
        const first = group[at];
        const rest = group.slice(at + 1);
        const word = String(first.value);
        // How many tokens this keyword consumed, set by whichever branch takes it.
        let took = 1;

        // `triggered/combat-roll`, and `defeated(Focus)` for the ones that name a subject.
        if (MODES.includes(word)) {
          mode = word;
          if (rest[0] && (rest[0].value === "/")) {
            moment = String(rest[1]?.value ?? "");
            took = 3;
            if (rest[2]?.value === "(") {
              moment += `(${rest[3]?.value ?? ""})`;
              took = 6;
            }
            else if (rest[2]?.value === "/") {
              moment += `/${rest[3]?.value ?? ""}`;
              took = 5;
            }
          }
          at += took;
          continue;
        }

        // `1/round`, `2/encounter`
        if ((first.type === T.NUMBER) && (rest[0]?.value === "/")) {
          const per = String(rest[1]?.value ?? "");
          if ((per === "round") || (per === "encounter")) budget[per] = first.value;
          else this.fail(`"${per}" is not a period; use round or encounter.`, first);
          at += 3;
          continue;
        }

        switch (word) {
          case "before": modifiers.before = true; break;
          case "first":
            // Once, and the Encounter is the span that resets. Parsed and then honoured
            // by nobody until now, which made it a keyword that silently did nothing.
            modifiers.first = true;
            budget.encounter ??= 1;
            break;
          case "armed": budget.armed = true; break;
          case "per":
            if (rest[0]?.value === "stack") { modifiers.perStack = true; took = 2; }
            else this.fail('"per" is followed by "stack".', first);
            break;
          case "from":
            modifiers.fromLevel = Number(rest[0]?.value ?? 0);
            modifiers.levelled = true;
            took = 2;
            break;
          case "after":
            modifiers.after = String(rest[0]?.value ?? "");
            took = 2;
            break;
          case "costs":
            budget.actions = Number(rest[0]?.value ?? 1);
            modifiers.activated = true;
            // `costs 1 action`, with the noun spelled out the way the rulebook says it.
            took = (String(rest[1]?.value ?? "").startsWith("action")) ? 3 : 2;
            break;
          case "on":
            // `[on applied]` and `[on removed]` are moments of their own.
            mode = "automatic";
            moment = (rest[0]?.value === "removed") ? "on-removed" : "on-applied";
            took = 2;
            break;
          case "instant":
          case "standard":
          case "counter":
            if (rest[0]?.value === "maneuver") {
              modifiers.grantsManeuver = word;
              modifiers.activated = true;
              took = 2;
            }
            else this.fail(`"${word}" here is followed by "maneuver".`, first);
            break;
          default:
            this.fail(`"${word}" is not a keyword this system knows.`, first);
        }

        at += took;
      }
    }

    return { mode, moment, budget: Object.keys(budget).length ? budget : null, modifiers };
  }

  // --- Statements -----------------------------------------------------------

  parseStatement() {
    if (this.is(T.WORD, "if")) return this.parseIf();
    if (this.is(T.WORD, "forbid") || this.is(T.WORD, "allow")) return this.parseForbid();

    // Either an assignment to a Slot, or a verb call.
    if (this.is(T.WORD)) {
      const name = this.peek();
      if (this.peek(1)?.type === T.PAREN && this.peek(1)?.value === "(") {
        const call = this.parseCall();
        this.accept(T.PUNCT, ";");
        return A.invoke(call.fn, call.args);
      }

      this.next();
      const op = this.accept(T.OPERATOR);
      if (!op) {
        this.fail(`"${name.value}" is not doing anything. Did you mean to change it, with += or =?`, name);
        this.recover();
        return null;
      }

      const operation = { "+=": "add", "-=": "add", "*=": "multiply", "=": "set",
                          "min=": "min", "max=": "max", "/=": "multiply" }[op.value];
      if (!operation) {
        this.fail(`"${op.value}" cannot be used to change a value.`, op);
        this.recover();
        return null;
      }

      let amount = this.parseAmount();
      // `-=` is an add of the negative, and `/=` a multiply by the reciprocal, so the
      // engine only ever has to know about two directions instead of four.
      if (op.value === "-=") amount = A.binary("-", A.flat(0), amount);
      if (op.value === "/=") amount = A.binary("/", A.flat(1), amount);

      this.accept(T.PUNCT, ";");
      const dice = (amount?.type === "dice");
      return A.assign(String(name.value), dice ? "add-dice" : operation, amount);
    }

    this.fail("This is not something an effect can do.");
    this.recover();
    return null;
  }

  parseIf() {
    this.next();
    this.expect(T.PAREN, "(", "An if needs its condition in brackets.");
    const condition = this.parseExpression();
    this.expect(T.PAREN, ")", "This condition is never closed.");

    const then = this.parseBody();
    let otherwise = [];
    if (this.accept(T.WORD, "else")) otherwise = this.parseBody();

    return A.branch(condition, then, otherwise);
  }

  /** A body is either braces, or the single statement that follows. */
  parseBody() {
    if (!this.accept(T.BRACE, "{")) {
      const one = this.parseStatement();
      return one ? [one] : [];
    }
    const statements = [];
    while (!this.atEnd() && !this.is(T.BRACE, "}")) {
      const s = this.parseStatement();
      if (s) statements.push(s);
    }
    this.expect(T.BRACE, "}", "This block is never closed with }.");
    return statements;
  }

  parseForbid() {
    const kind = String(this.next().value);
    const parts = [];
    while (!this.atEnd() && !this.is(T.PUNCT, ";")) parts.push(this.next());
    this.accept(T.PUNCT, ";");

    // Everything after the verb describes what is being forbidden. It is kept as
    // written rather than parsed into a shape, because what each one means belongs to
    // the rule it names and not to the grammar.
    const what = parts.map(t => (t.type === T.STRING) ? `"${t.value}"` : String(t.value)).join(" ");
    return A.forbid(what, { allow: kind === "allow" });
  }

  parseCall() {
    const name = String(this.next().value);
    this.expect(T.PAREN, "(");
    const args = [];
    while (!this.atEnd() && !this.is(T.PAREN, ")")) {
      args.push(this.parseAmount());
      if (!this.accept(T.PUNCT, ",")) break;
    }
    this.expect(T.PAREN, ")", `The arguments to ${name} are never closed.`);
    return { fn: name, args };
  }

  // --- Amounts --------------------------------------------------------------

  parseAmount() { return this.parseTernary(); }

  parseTernary() {
    const condition = this.parseAdditive();
    if (!this.accept(T.PUNCT, "?")) return condition;
    const then = this.parseAmount();
    this.expect(T.PUNCT, ":", "A ? needs a : and a second amount.");
    const otherwise = this.parseAmount();
    return A.ternary(asCondition(condition), then, otherwise);
  }

  parseAdditive() {
    let left = this.parseMultiplicative();
    while (this.is(T.OPERATOR, "+") || this.is(T.OPERATOR, "-")) {
      const op = String(this.next().value);
      left = A.binary(op, left, this.parseMultiplicative());
    }
    return left;
  }

  parseMultiplicative() {
    let left = this.parseUnary();
    while (this.is(T.OPERATOR, "*") || this.is(T.OPERATOR, "/") || this.is(T.OPERATOR, "%")) {
      const op = String(this.next().value);
      left = A.binary(op, left, this.parseUnary());
    }
    return left;
  }

  parseUnary() {
    if (this.accept(T.OPERATOR, "-")) return A.binary("-", A.flat(0), this.parseUnary());

    if (this.is(T.NUMBER)) {
      const value = this.next().value;
      const scale = this.accept(T.SCALE);
      if (!scale) return A.flat(value);
      return (scale.value === "T") ? A.perTier(value) : A.perBaseTier(value);
    }

    if (this.is(T.DICE)) {
      const formula = String(this.next().value);
      const scale = this.accept(T.SCALE);
      return A.dice(formula, scale ? String(scale.value) : null);
    }

    if (this.is(T.STRING)) return { type: "name", value: String(this.next().value) };

    if (this.accept(T.PAREN, "(")) {
      const inner = this.parseAmount();
      this.expect(T.PAREN, ")", "This bracket is never closed.");
      return inner;
    }

    if (this.is(T.WORD)) {
      const word = String(this.peek().value);
      if ((word === "true") || (word === "false")) {
        this.next();
        return A.boolean(word === "true");
      }

      if (word === "L") {
        this.next();
        const scale = this.accept(T.SCALE);
        return A.level(scale ? String(scale.value) : null);
      }

      // The three sets of dice the character already has, by name. Written as a word
      // rather than a formula because what they come to depends on the character.
      if (NAMED_DICE[word]) { this.next(); return A.dice(null, null, NAMED_DICE[word]); }

      if (this.peek(1)?.type === T.PAREN && this.peek(1)?.value === "(") {
        const call = this.parseCall();
        // A word followed by brackets is either arithmetic or a question. Which one it
        // is depends on the name, and only the engine knows that list.
        return PREDICATE_NAMES.has(call.fn)
          ? A.predicate(call.fn, call.args.map(unwrapName))
          : A.call(call.fn, call.args);
      }

      this.next();
      return BARE_PREDICATES.has(word) ? A.predicate(word) : A.path(word);
    }

    this.fail("An amount was expected here.");
    this.next();
    return A.flat(0);
  }

  // --- Conditions -----------------------------------------------------------

  parseExpression() { return this.parseOr(); }

  parseOr() {
    let left = this.parseAnd();
    while (this.accept(T.OPERATOR, "||")) left = A.logical("||", left, this.parseAnd());
    return left;
  }

  parseAnd() {
    let left = this.parseNot();
    while (this.accept(T.OPERATOR, "&&")) left = A.logical("&&", left, this.parseNot());
    return left;
  }

  parseNot() {
    if (this.accept(T.OPERATOR, "!")) return A.not(this.parseNot());
    return this.parseComparison();
  }

  parseComparison() {
    if (this.accept(T.PAREN, "(")) {
      const inner = this.parseExpression();
      this.expect(T.PAREN, ")", "This condition is never closed.");
      return inner;
    }

    const left = this.parseAdditive();
    const op = ["==", "!=", "<", "<=", ">", ">="].find(o => this.is(T.OPERATOR, o));
    if (!op) return asCondition(left);

    this.next();
    return A.compare(op, left, this.parseAdditive());
  }
}

/** Questions the engine answers, as opposed to arithmetic it works out. */
const PREDICATE_NAMES = new Set([
  "benefiting", "hasResource", "inState", "hasCondition", "targets", "aoeHits", "attacking"
]);

/** The ones written without brackets, because they take nothing. */
const BARE_PREDICATES = new Set(["defending", "isMinion"]);

/**
 * Dice the character already has, named rather than written out.
 *
 * The Superior State adds "your Greater Dice" to every Combat Roll, and what those are
 * depends on the Tier of Power - so the amount has to name them rather than state them.
 */
const NAMED_DICE = Object.freeze({
  extraDice: "extra",
  greaterDice: "greater",
  criticalDice: "critical"
});

/** A bare amount used where a condition belongs means "is this true". */
function asCondition(node) {
  if (!node) return node;
  if (["compare", "logical", "not", "predicate"].includes(node.type)) return node;
  return A.compare("!=", node, A.flat(0));
}

/** A predicate's argument is a name, not a number: benefiting("Balanced Warrior"). */
function unwrapName(node) {
  return (node?.type === "name") ? node.value : node;
}

/**
 * Compile a script.
 *
 * @returns {{program, errors}} Errors carry a line and column when they have one.
 */
export function compile(source, data = null) {
  const { tokens, errors: lexErrors } = tokenize(source ?? "");
  const parser = new Parser(tokens);
  const program = parser.parseProgram();

  const errors = [
    ...lexErrors.map(e => ({ message: e.message, line: e.line, column: e.column })),
    ...parser.errors
  ];

  // Only worth checking meaning once it parsed: a file full of syntax errors would
  // otherwise report every slot in it as unknown too.
  if (!errors.length) errors.push(...validateProgram(program, data));

  return { program, errors };
}
