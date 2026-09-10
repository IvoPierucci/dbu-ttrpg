/**
 * Turning the old data rows into compiled programs.
 *
 * The engine ships before the language does, so the first programs come from here
 * rather than from a parser. That order is deliberate: it means the engine can be
 * proven against effects that already exist and whose numbers are already known, and
 * the parser lands later with a target that works instead of being designed alongside
 * the thing it produces.
 *
 * Every character who already owns a Talent keeps working through this, with no data
 * written and nothing for anyone to run.
 */

import * as A from "./ast.mjs";

/**
 * The amount a row describes.
 *
 * All three parts count. The old code summed them in one place and forgot two of them
 * in three others, which is why `flat` and `perBaseTier` silently did nothing on the
 * effects that used them - reproducing the sum properly here is part of the fix.
 */
function amountFrom(row) {
  const parts = [];
  if (row.flat) parts.push(A.flat(row.flat));
  if (row.perTier) parts.push(A.perTier(row.perTier));
  if (row.perBaseTier) parts.push(A.perBaseTier(row.perBaseTier));

  if (!parts.length) return A.flat(0);
  return parts.reduce((left, right) => A.binary("+", left, right));
}

/** The old condition objects, in the same shapes they were written in. */
function conditionFrom(condition) {
  if (!condition?.type) return null;

  switch (condition.type) {
    // Every named Score equals the first one named.
    case "scoresEqual": {
      const [first, ...rest] = condition.attributes ?? [];
      if (!rest.length) return null;
      return rest
        .map(key => A.compare("==", A.path(`${key}.score`), A.path(`${first}.score`)))
        .reduce((left, right) => A.logical("&&", left, right));
    }

    // Every named Score is at least `by` lower than the one compared against.
    case "scoresLowerThan":
      return (condition.attributes ?? [])
        .map(key => A.compare("<=",
          A.path(`${key}.score`),
          A.binary("-", A.path(`${condition.than}.score`), A.flat(condition.by ?? 0))))
        .reduce((left, right) => A.logical("&&", left, right));

    case "notBenefiting":
      return A.not(A.predicate("benefiting", [condition.talent]));

    case "all":
      return (condition.conditions ?? [])
        .map(conditionFrom)
        .filter(Boolean)
        .reduce((left, right) => A.logical("&&", left, right), null);

    case "not": {
      const inner = conditionFrom(condition.condition);
      return inner ? A.not(inner) : null;
    }

    default:
      // Unlike the old evaluator, an unknown condition is not treated as met. It is
      // surfaced as a program that cannot compile, so it is noticed.
      return A.predicate("__unknown__", [condition.type]);
  }
}

/** Wrap statements in the row's condition, when it has one. */
function gated(condition, statements) {
  const test = conditionFrom(condition);
  return test ? [A.branch(test, statements)] : statements;
}

/**
 * One old row becomes one block.
 *
 * Returns null for a key the system never knew, which the caller reports rather than
 * dropping - a mistyped key used to do nothing at all, and finding those is part of
 * what this is for.
 */
export function legacyRowToBlock(row, index) {
  const amount = amountFrom(row);
  const text = row.text ?? "";

  switch (row.key) {
    // A pair of Attributes each lending the other its Score, bounded so the total stays
    // within the Attribute Score Limit. It needed a rule of its own before; now it is
    // ordinary arithmetic.
    case "mirrorAttributeModifiers": {
      const [first, second] = row.attributes ?? [];
      if (!first || !second) return null;
      // Floored at zero, as it was: with the Score already at the Limit there is no
      // headroom left, and lending must not turn into a penalty.
      const lend = (to, from) => A.assign(`${to}.mod`, "add",
        A.call("max", [
          A.flat(0),
          A.call("min", [
            A.path(`${from}.score`),
            A.binary("-", A.path("attributeScoreCap"), A.path(`${to}.score`))
          ])
        ]));
      return A.block({
        index, mode: "passive", text,
        statements: gated(row.condition, [lend(first, second), lend(second, first)])
      });
    }

    case "attributeModifier":
      if (!row.attribute) return null;
      return A.block({
        index, mode: "passive", text,
        statements: gated(row.condition, [A.assign(`${row.attribute}.mod`, "add", amount)])
      });

    // One row that moved two values. The engine states it as the two facts it is.
    case "woundAndMight":
      return A.block({
        index, mode: "passive", text,
        statements: gated(row.condition, [
          A.assign("might", "add", amount),
          A.assign("wound", "add", amount)
        ])
      });

    case "soak":
      return A.block({
        index, mode: "passive", text,
        statements: gated(row.condition, [A.assign("soakValue", "add", amount)])
      });

    case "stressBonus":
      return A.block({
        index, mode: "passive", text,
        statements: gated(row.condition, [A.assign("stressBonus", "add", amount)])
      });

    // Answers a Moment rather than being folded into derived data: it applies only for
    // the duration of an attack aimed at you, and only if you Defended against it -
    // neither of which the derived-data pass can know. "Before any calculations" means
    // onto the base Soak, ahead of the Damage Category multiplier, which is what the
    // Slot's name says.
    //
    // Automatic rather than triggered: it is not something the player chooses.
    case "soakWhenDefending":
      return A.block({
        index, mode: "automatic", moment: "defending", text,
        statements: gated(row.condition, [A.assign("soakValue.base", "add", amount)])
      });

    case "healingSurgeDice": {
      if (!row.dicePerTier) return null;
      return A.block({
        index, mode: "passive", text,
        statements: gated(row.condition, [
          A.assign("surge.life.dice", "add-dice", A.dice(row.dicePerTier, "T"))
        ])
      });
    }

    case "defendOptionCost":
      if (!row.option) return null;
      return A.block({
        index, mode: "passive", text,
        statements: gated(row.condition, [
          A.assign(`defend.${row.option}.kiCost`, "add", amount)
        ])
      });

    case "attackKiCost":
      return A.block({
        index, mode: "passive", text,
        statements: gated(row.condition, [A.assign("attack.kiCost", "add", amount)])
      });

    // The one triggered effect that existed. `before` because it replaces the Base Die
    // rather than reacting to it, which is the exception the rulebook allows.
    case "forceNaturalResult":
      return A.block({
        index, mode: "triggered", moment: "combat-roll", text,
        modifiers: { before: true },
        budget: {
          round: row.limits?.round ?? null,
          encounter: row.limits?.encounter ?? null,
          armed: true
        },
        statements: gated(row.condition, [A.assign("baseDie", "set", A.flat(row.value ?? 0))])
      });

    default:
      return null;
  }
}

/**
 * Every row of one Talent Item, as a program.
 *
 * The block index is the effect's number as the rulebook counts them, starting at one,
 * because effects refer to each other that way.
 */
export function legacyToProgram(rows, report = () => {}) {
  const blocks = [];

  (rows ?? []).forEach((row, i) => {
    const b = legacyRowToBlock(row, i + 1);
    if (b) blocks.push(b);
    else report(`Effect ${i + 1} uses "${row?.key ?? "(no key)"}", which is not a rule this system knows.`);
  });

  return A.program(blocks);
}
