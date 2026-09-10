/**
 * Whether an effect applies right now.
 *
 * The one behaviour worth naming: this **fails closed**. The old `conditionHolds` ended
 * its switch with a warning and `return true`, so a condition the system did not
 * understand was treated as met - a typo made a gated effect apply unconditionally,
 * which is the worst way for it to be wrong. Anything unrecognised here is false, and
 * it is reported.
 */

import { resolveAmount, useConditionEvaluator } from "./amounts.mjs";

/**
 * Questions an effect can ask that are not arithmetic.
 *
 * Each takes the scope and whatever arguments the condition carried. Adding one is a
 * row here; nothing else changes.
 */
const PREDICATES = {
  /** Are you Defending against the attack currently being resolved. */
  defending: scope => Boolean(scope.context?.defending),

  /**
   * Is a named Trait doing anything for this character at the moment.
   *
   * Written as a Trait's name because that is how the rulebook writes it ("while you
   * are not benefiting from Balanced Warrior"). The visited set matters: two Traits can
   * name each other, and without it that recurses forever.
   */
  benefiting: (scope, name) => {
    const key = String(name).toLowerCase();
    if (scope.visiting?.has(key)) {
      scope.errors?.push(`"${name}" refers back to an effect that refers to it; treating it as not benefiting.`);
      return false;
    }
    const visiting = new Set(scope.visiting ?? []);
    visiting.add(key);
    return Boolean(scope.benefitsFrom?.(name, { ...scope, visiting }));
  },

  /** Do you hold any of a Resource. */
  hasResource: (scope, name) => (scope.data?.resources?.[name]?.stacks ?? 0) > 0,

  /** Are you in a named State. */
  inState: (scope, name) => Boolean(scope.data?.states?.[String(name).toLowerCase()]),

  /** Do you have a named Combat Condition. */
  hasCondition: (scope, name) => Boolean(scope.data?.conditions?.[String(name).toLowerCase()]),

  /** Is this character a Minion. */
  isMinion: scope => Boolean(scope.data?.minion),

  /** Does the Maneuver being resolved include this character as a target. */
  targets: (scope, who) =>
    (scope.context?.targets ?? []).some(t => matches(t, who, scope)),

  /** Does this attack's area cover them. */
  aoeHits: (scope, who) =>
    (scope.context?.area?.covered ?? []).some(t => matches(t, who, scope)),

  /** Is this Maneuver an attack aimed at them. */
  attacking: (scope, who) =>
    Boolean(scope.context?.attack) && matches(scope.context?.target, who, scope)
};

/** A character reference can be a uuid, a name, or a Ruling's stored value. */
function matches(candidate, who, scope) {
  if (!candidate) return false;
  const wanted = scope.rulings?.[who] ?? who;
  const uuid = candidate.uuid ?? candidate;
  return (uuid === wanted) || (candidate.name === wanted);
}

/**
 * Evaluate a condition.
 *
 * @returns {boolean} False for anything it does not understand, having said so.
 */
export function evaluate(condition, scope) {
  if (!condition) return true;

  switch (condition.type) {
    case "compare": {
      const left = resolveAmount(condition.left, scope);
      const right = resolveAmount(condition.right, scope);
      switch (condition.op) {
        case "==": return left === right;
        case "!=": return left !== right;
        case "<": return left < right;
        case "<=": return left <= right;
        case ">": return left > right;
        case ">=": return left >= right;
        default:
          scope.errors?.push(`Unknown comparison "${condition.op}".`);
          return false;
      }
    }

    case "logical": {
      // Short-circuiting matters: the right side of an && may only be safe to read
      // because the left one held.
      if (condition.op === "&&") {
        return evaluate(condition.left, scope) && evaluate(condition.right, scope);
      }
      if (condition.op === "||") {
        return evaluate(condition.left, scope) || evaluate(condition.right, scope);
      }
      scope.errors?.push(`Unknown operator "${condition.op}".`);
      return false;
    }

    case "not":
      return !evaluate(condition.operand, scope);

    case "predicate": {
      const fn = PREDICATES[condition.name];
      if (!fn) {
        scope.errors?.push(`Unknown condition "${condition.name}".`);
        return false;
      }
      return Boolean(fn(scope, ...(condition.args ?? []).map(a => literal(a, scope))));
    }

    default:
      scope.errors?.push(`Unknown condition "${condition.type}".`);
      return false;
  }
}

/** A predicate's argument is usually a name rather than a number. */
function literal(arg, scope) {
  if (typeof arg === "string") return arg;
  if (arg?.type === "name") return arg.value;
  return resolveAmount(arg, scope);
}

// Amounts need to evaluate a condition for the ternary, and conditions need to resolve
// an amount to compare. Registering the evaluator breaks the cycle without either file
// importing the other twice.
useConditionEvaluator(evaluate);

export { PREDICATES };
