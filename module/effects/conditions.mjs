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
   * Is this roll part of an Attacking Maneuver *you* are making.
   *
   * Not the same question as "is an attack happening": a Dodge and a Parry are Combat
   * Rolls made during somebody else's Attacking Maneuver, and a rule about the rolls
   * "for Attacking Maneuvers" does not reach them. Compelled is the rule that cares -
   * it makes your own attacks Urgent, not your defence against one.
   */
  attackingManeuver: scope => Boolean(scope.context?.attackingManeuver),

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

  /**
   * Are you in a named Battle Environment - "While in the Underwater Battle Environment" - by its file, with or without
   * "-environment" on the end. Not while you are above it in a High Environment: there it does not reach you.
   */
  inEnvironment: (scope, name) => {
    const battlefield = scope.data?.battlefield ?? {};
    if ((Number(battlefield.highEnvironment) || 0) > 0) return false;
    const here = String(battlefield.environment ?? "").toLowerCase();
    const wanted = String(name).trim().toLowerCase();
    return (here === wanted) || (here === `${wanted}-environment`);
  },

  /** Do you have a named Combat Condition. */
  hasCondition: (scope, name) => Boolean(scope.data?.conditions?.[String(name).toLowerCase()]),

  /**
   * Is the Item carrying this effect meant for whoever is wearing it - the Eyeglasses'
   * "If you're the Intended Character". Declared on the Item; false for anything that
   * declares nobody.
   */
  intendedForYou: scope => Boolean(scope.intended),

  /**
   * Is this character wielding a Weapon - Parrying Armor's "While you do not have a Weapon
   * equipped". Wielded is `equipped`; a broken one is as if it were not there.
   */
  adventuring: scope => Boolean(scope.data?.adventuring),

  wieldingWeapon: scope => Array.from(scope.data?.parent?.items ?? []).some(item =>
    (item.type === "gear") && (item.system?.crafted?.kind === "weapon") && item.system?.equipped
    && !item.system?.crafted?.destroyed),

  /**
   * Is this character wearing an Item made from a named file - "while wearing Standard
   * Clothing". By the file's id, so a renamed one still counts; worn being the same
   * `equipped` an Accessory is put on with, and one in a Capsule never being worn.
   */
  wearing: (scope, id) => {
    const wanted = String(id).trim().toLowerCase();
    // An Item made from that file, or one built as that Category - "Standard Clothing" is an
    // Apparel Category, and any Apparel of it counts.
    return Array.from(scope.data?.parent?.items ?? []).some(item => (item.type === "gear")
      && ((item.system?.gearId === wanted) || (item.system?.crafted?.category === wanted))
      && Boolean(item.system?.equipped));
  },

  /** Is the Maneuver being declared one made through the Signature Technique Maneuver - God of Judgment's. */
  signatureTechnique: scope => Boolean(scope.context?.maneuver?.signature && !scope.context?.maneuver?.signatureTechnique),

  /** Is this character in their own Frozen Turn - Time Freeze's (God of Time's "during Frozen Turns"). */
  frozenTurn: scope => Boolean(scope.data?.parent?.getFlag?.("dbu-ttrpg", "frozenTurn")),

  /** Is the Maneuver being declared that one, by its id - Cosmic Efficiency's Combat Recovery. */
  using: (scope, id) => (scope.context?.maneuver?.id ?? "") === String(id).trim(),

  /** Is this an even-numbered Combat Round - Born for Battle's. */
  evenRound: () => {
    const round = Number(globalThis.game?.combat?.started ? globalThis.game.combat.round : 0) || 0;
    return (round > 0) && ((round % 2) === 0);
  },

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
