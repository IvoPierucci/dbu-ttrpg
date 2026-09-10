/**
 * Turning an amount into a number.
 *
 * One implementation, deliberately. The old code worked out `flat + perTier*T +
 * perBaseTier*bT` in four different places and three of them left out `flat` and
 * `perBaseTier` entirely, so those fields silently did nothing on the effects that used
 * them. Reading `perTier` without a default also produced NaN whenever a row omitted
 * it. Both of those stop being possible when there is only one place that does the sum.
 */

/** Functions an amount may call. */
export const FUNCTIONS = {
  min: (...args) => Math.min(...args),
  max: (...args) => Math.max(...args),
  floor: value => Math.floor(value),
  ceil: value => Math.ceil(value),
  round: value => Math.round(value),
  abs: value => Math.abs(value)
};

/**
 * Resolve an amount to a number.
 *
 * `scope` carries the character's derived data, the level of the source when it has one
 * (a State's level, an Aspect's level on that Transformation), and the Moment's context
 * when the effect is reactive.
 */
export function resolveAmount(amount, scope) {
  if (amount == null) return 0;

  switch (amount.type) {
    case "flat":
      return amount.value ?? 0;

    case "perTier":
      return (amount.value ?? 0) * (scope.data?.tierOfPower ?? 0);

    case "perBaseTier":
      return (amount.value ?? 0) * (scope.data?.baseTierOfPower ?? 0);

    case "level": {
      const level = scope.level ?? 0;
      if (amount.scale === "T") return level * (scope.data?.tierOfPower ?? 0);
      if (amount.scale === "bT") return level * (scope.data?.baseTierOfPower ?? 0);
      return level;
    }

    case "path":
      return resolvePath(amount.path, scope);

    case "binary": {
      const left = resolveAmount(amount.left, scope);
      const right = resolveAmount(amount.right, scope);
      switch (amount.op) {
        case "+": return left + right;
        case "-": return left - right;
        case "*": return left * right;
        case "/": return right === 0 ? 0 : left / right;
        case "%": return right === 0 ? 0 : left % right;
        default:
          scope.errors?.push(`Unknown operator "${amount.op}".`);
          return 0;
      }
    }

    case "ternary":
      return resolveAmount(
        evaluateCondition(amount.condition, scope) ? amount.then : amount.else, scope
      );

    case "call": {
      const fn = FUNCTIONS[amount.fn];
      if (!fn) {
        scope.errors?.push(`Unknown function "${amount.fn}".`);
        return 0;
      }
      return fn(...(amount.args ?? []).map(arg => resolveAmount(arg, scope)));
    }

    case "boolean":
      return amount.value ? 1 : 0;

    case "name":
      // Passed straight through. A verb such as gain("Prone", 2) needs the word, and it
      // was being resolved to 0 here, which quietly dropped it.
      return amount.value;

    case "dice":
      // Dice are a formula, not a number; a caller that wanted a number asked wrongly.
      scope.errors?.push("A dice amount cannot be used where a number is expected.");
      return 0;

    default:
      scope.errors?.push(`Unknown amount "${amount.type}".`);
      return 0;
  }
}

/**
 * Resolve a dice amount to a formula string.
 *
 * "1d10" scaled per Tier becomes "3d10" at Tier 3: the count multiplies, the die does
 * not change. Written `1d10(T)` in the rulebook and in a script.
 */
export function resolveDice(amount, scope) {
  if (amount?.type !== "dice") return "";

  // Named dice are whatever the character has right now. An empty formula is the honest
  // answer when they have none - at Tier 1 there are no Greater Dice to add.
  if (amount.from) return scope.data?.dice?.[amount.from]?.formula ?? "";

  const [count, faces] = String(amount.formula).split("d");
  const n = Number(count) || 0;
  if (!faces) return "";

  const multiplier = (amount.scale === "T") ? (scope.data?.tierOfPower ?? 1)
    : (amount.scale === "bT") ? (scope.data?.baseTierOfPower ?? 1)
    : 1;

  const total = n * multiplier;
  return total > 0 ? `${total}d${faces}` : "";
}

/**
 * Read a value off the character or the Moment's context.
 *
 * Character paths are read from prepared data, so `insight.score` and `life.max` mean
 * what the sheet shows. Context paths (`attack.`, `incoming.`, ...) come from whatever
 * the Moment put within reach; the compiler has already refused any that the Moment
 * does not provide, so anything arriving here is legal to ask for.
 */
export function resolvePath(p, scope) {
  const parts = String(p).split(".");
  const root = parts[0];

  // How many stacks of the thing carrying this effect the character has. Written plainly
  // as `stacks` because that is how the rulebook says it, and needed by any effect whose
  // amount is not simply repeated per stack.
  if (p === "stacks") return scope.stacks ?? 1;

  const CONTEXTUAL = ["attack", "attacker", "target", "incoming", "clash", "roll",
                      "damage", "burst", "proc"];
  if (CONTEXTUAL.includes(root)) {
    return numeric(foundry.utils.getProperty(scope.context ?? {}, p), p, scope);
  }

  // An Attribute or Skill is written by its own name, so `insight.score` reads
  // attributes.insight.score without the author having to know where it lives.
  const data = scope.data ?? {};
  if (data.attributes?.[root]) {
    return numeric(foundry.utils.getProperty(data.attributes[root], parts.slice(1).join(".")), p, scope);
  }
  if (data.skills?.[root]) {
    return numeric(foundry.utils.getProperty(data.skills[root], parts.slice(1).join(".")), p, scope);
  }

  // A Resource is read as `<name>.stacks` or `<name>.max`.
  if (data.resources?.[root]) {
    return numeric(foundry.utils.getProperty(data.resources[root], parts.slice(1).join(".")), p, scope);
  }

  return numeric(foundry.utils.getProperty(data, p), p, scope);
}

/**
 * Anything that is not a number is an error worth hearing about rather than a zero that
 * quietly changes the arithmetic.
 */
function numeric(value, p, scope) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value == null) {
    scope.errors?.push(`"${p}" is not something this character has.`);
    return 0;
  }
  scope.errors?.push(`"${p}" is not a number.`);
  return 0;
}

/** Set by conditions.mjs at load, to break the circular import between the two. */
let evaluateCondition = () => true;
export function useConditionEvaluator(fn) {
  evaluateCondition = fn;
}
