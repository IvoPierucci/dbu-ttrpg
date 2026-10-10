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

  /**
   * "If you already had access to the <X> Maneuver" (Majestic Grace's): a Special Maneuver opened by anything but the
   * effect asking - a Skill's Ranks.
   */
  accessElsewhere: (scope, id) => {
    const table = scope.data?.constructor?.SKILLS ?? {};
    const needs = Number(scope.data?.constructor?.SKILL_MANEUVER_RANKS) || 2;
    return Object.entries(table).some(([key, skill]) => (skill.specialManeuver === String(id))
      && ((Number(scope.data?.skills?.[key]?.ranks) || 0) >= needs));
  },

  /** The Clash won was won with this Skill (Stealthy Trick's) - clash-win's context. */
  wonWithSkill: (scope, id) => (scope.context?.skill ?? "") === String(id),

  /** The Clash won was the one your Terrify Maneuver opened (Terrifying Pressure's) - clash-win's context. */
  wonTerrify: scope => Boolean(scope.context?.terrify),

  /** The Attacking Maneuver hit someone Oblivious of you, as it hit (Stealthy Trick's) - hit-opponent's context. */
  hitOblivious: scope => Boolean(scope.context?.oblivious),

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
    // "Natural Armor does not count as equipped Apparel for any of your effects."
    return Array.from(scope.data?.parent?.items ?? []).some(item => (item.type === "gear")
      && ((item.system?.gearId === wanted) || (item.system?.crafted?.category === wanted))
      && Boolean(item.system?.equipped) && (item.flags?.["dbu-ttrpg"]?.naturalArmor !== true));
  },

  /** Is the Maneuver being declared one made through the Signature Technique Maneuver - God of Judgment's. */
  signatureTechnique: scope => Boolean(scope.context?.maneuver?.signature && !scope.context?.maneuver?.signatureTechnique),

  /** No Counter Action left - Lingering Instincts' "while you possess no Counter Actions". */
  noCounterActions: scope => (Number(scope.data?.actions?.counterLeft) || 0) <= 0,

  /** Is this character in their own Frozen Turn - Time Freeze's (God of Time's "during Frozen Turns"). */
  frozenTurn: scope => Boolean(scope.data?.parent?.getFlag?.("dbu-ttrpg", "frozenTurn")),

  /** Is the Maneuver being declared that one, by its id - Cosmic Efficiency's Combat Recovery. */
  using: (scope, id) => (scope.context?.maneuver?.id ?? "") === String(id).trim(),

  /** The one this Moment says was Defeated, your Lock On Target (Lock On's 2nd). */
  defeatedLockOn: scope => Boolean(scope.context?.defeatedUuid)
    && (scope.data?.parent?.getFlag?.("dbu-ttrpg", "lockOn")?.uuid === scope.context.defeatedUuid),

  /** Ki Multiplier from somewhere else than an effect that always gives it - the sheet's box, until Forms (Power Battery). */
  kiMultiplied: scope => scope.data?.debug?.kiMultiplier === true,

  /** No Ki Points regained through a Ki Surge or Combat Recovery (Power Battery's). */
  kiLocked: scope => scope.data?.effects?.slots?.["ki.noRegain"] === true,

  /** Does this character still have their tail - Saiyan Heritage's Tailed, not lost (the Options tab's Tail lost box). */
  tailed: scope => !scope.data?.parent?.getFlag?.("dbu-ttrpg", "tailLost"),

  /** Do these Resources come to at least this many stacks between them - Blood of the Warrior's "6+ stacks of Battle Born". */
  stacksAtLeast: (scope, amount, ...names) => names
    .reduce((sum, name) => sum + (Number(scope.data?.resources?.[String(name).toLowerCase()]?.stacks) || 0), 0)
    >= (Number(amount) || 0),

  /**
   * Is this character below that Health Threshold - in it or a lower one, as Final Chance and All Out read "below the
   * Injured Health Threshold" (Blood of the Warrior's).
   */
  belowThreshold: (scope, name) => {
    const keys = ["healthy", "bruised", "injured", "critical"];
    const wanted = keys.indexOf(String(name).toLowerCase());
    // Divine Physique (3): Superior, and Healthy as well for every effect of theirs - so below nothing.
    if ((scope.data?.effects?.slots?.["threshold.healthyInSuperior"] === true)
      && ((Number(scope.data?.states?.superior) || 0) > 0)) return false;
    return (wanted > 0) && (keys.indexOf(scope.data?.threshold?.key ?? "healthy") >= wanted);
  },

  /** In the Healthy Health Threshold, whatever counts them as Healthy besides - Divine Physique (2)'s. */
  trulyHealthy: scope => (scope.data?.threshold?.key ?? "healthy") === "healthy",

  /** No Character in the Combat Encounter larger than you - King's Stature's "the highest Size Category". */
  largestInEncounter: scope => {
    const own = Number(scope.data?.size?.steps) || 0;
    return Array.from(game.combat?.combatants ?? []).map(entry => entry.actor).filter(Boolean)
      .every(other => (Number(other.system?.size?.steps) || 0) <= own);
  },

  /** Is the Maneuver being declared a Unique Ability - Frigid Tricks'. */
  usingUnique: scope => (scope.context?.maneuver?.tags ?? []).includes("uniqueAbility"),

  /** Whoever was Defeated or knocked through a Threshold is your Enemy - Burning Hatred's (chat.mjs askEnemy). */
  fallenEnemy: scope => {
    const fallen = scope.context?.defeatedUuid || scope.context?.knockedUuid || "";
    return Boolean(fallen) && (scope.data?.parent?.getFlag?.("dbu-ttrpg", "enemy")?.uuid === fallen);
  },

  /** The attack an AoE, and more than one hit by it - Overwhelming Pressure's (2) (moment hit-opponent's context). */
  aoeHitMany: scope => Boolean(scope.context?.area) && ((Number(scope.context?.hits) || 0) > 1),

  /** Natural Armor with Break Value to get back, or broken - Survivor's Plating (3). */
  platingMendable: scope => Array.from(scope.data?.parent?.items ?? []).some(item => (item.flags?.["dbu-ttrpg"]?.naturalArmor === true)
    && (((Number(item.system?.crafted?.breakLost) || 0) > 0) || Boolean(item.system?.crafted?.destroyed))),

  /** The Superior State's extra Damage not taken - Divine Physique (2). */
  superiorUnhurt: scope => scope.data?.effects?.slots?.["superior.noExtraDamage"] === true,

  /**
   * Majin Style's Default Costume, worn or broken, with Break Value to get back - "while wearing your Default Costume ...
   * If the piece of Apparel was broken, it stops being broken".
   */
  costumeMendable: scope => Array.from(scope.data?.parent?.items ?? []).some(item => item.getFlag?.("dbu-ttrpg", "defaultCostume")
    && ((Number(item.system?.crafted?.breakLost) || 0) > 0) && !item.system?.crafted?.destroyed
    && (item.system?.equipped || !String(item.system?.layer ?? ""))),

  /** Brought to 0 by their own effect - Revenge Bomber's. */
  ownDefeat: scope => Boolean(scope.data?.parent?.getFlag?.("dbu-ttrpg", "ownDefeat")),

  /** A Snack eaten this Combat Round - Snack Motivated's. */
  snackThisRound: scope => (scope.data?.parent?.getFlag?.("dbu-ttrpg", "snackRound") ?? "")
    === `${globalThis.game?.combat?.id ?? "none"}:${globalThis.game?.combat?.round ?? 0}`,

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
