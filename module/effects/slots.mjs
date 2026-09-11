/**
 * Every value an effect is allowed to change.
 *
 * The list is closed on purpose. A Slot exists only because some line of the pipeline
 * reads it, so a name that is not here is an authoring error rather than an effect
 * that quietly does nothing - which is exactly the bug the old string `key` had.
 *
 * Each Slot declares the phase it is resolved in. The phases exist because amounts are
 * written in (T) and (bT), and those are themselves derived: a Slot resolved before the
 * Tier of Power is known may only use (bT), which follows from Power Level alone. The
 * compiler checks that, so an amount can never read a value that is not settled yet.
 */

/** When a Slot is resolved, relative to the character's derived data pass. */
export const PHASES = Object.freeze({
  /** Before the Tiers are known. Amounts may use (bT) but never (T). */
  TIER: "tier",
  /** The bulk of the pipeline. Everything is available. */
  CORE: "core",
  /** After Might, Wound and the Thresholds are settled. */
  LATE: "late",
  /** Not derived at all: collected at a Moment during an exchange. */
  REACTIVE: "reactive"
});

/** What kind of value a Slot holds, which decides how contributions combine. */
export const KINDS = Object.freeze({
  NUMBER: "number",
  /** A dice formula, e.g. "2d10". Contributions are appended, never summed. */
  DICE: "dice",
  /** True or false. Only `set`, `allow` and `forbid` make sense. */
  FLAG: "flag"
});

const N = KINDS.NUMBER;
const D = KINDS.DICE;
const F = KINDS.FLAG;

/** Operations a numeric Slot normally accepts. */
const NUMERIC = ["add", "multiply", "set", "min", "max"];

/**
 * The Slot table.
 *
 * `fanOut` names other Slots a contribution also lands on: writing to `combatRolls`
 * contributes to Strike, Dodge and Wound at once, because those three *are* the Combat
 * Rolls and the sheet has to show the total already made.
 */
const TABLE = [
  // --- Power -------------------------------------------------------------------
  // Resolved before the Tiers, since the Tier of Power is what they feed.
  { key: "tierOfPower", phase: PHASES.TIER, kind: N, ops: NUMERIC,
    doc: "Current Tier of Power. Breakthrough still caps it at two above the Base Tier." },
  { key: "life.perLevel", phase: PHASES.TIER, kind: N, ops: NUMERIC,
    doc: "Life Points gained per Power Level." },
  { key: "ki.perLevel", phase: PHASES.TIER, kind: N, ops: NUMERIC,
    doc: "Ki Points gained per Power Level." },
  { key: "life.allowNegative", phase: PHASES.TIER, kind: F, ops: ["set"],
    doc: "Lets damage take Life Points below zero, as the Undying State does." },

  // --- Attributes --------------------------------------------------------------
  { key: "attributeScoreCap", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "The Attribute Score Limit for the current Tier of Power." },

  // --- Pools -------------------------------------------------------------------
  // The pools as they stand, rather than what they can reach. These are written by
  // effects that happen rather than by effects that are true: Poisoned taking a tenth of
  // your Life at the end of your turn belongs here, not on the maximum. Reactive on
  // purpose - a passive writing to one of these would be undone by the next preparation.
  { key: "life.value", phase: PHASES.REACTIVE, kind: N, ops: NUMERIC,
    doc: "Life Points you have now." },
  { key: "ki.value", phase: PHASES.REACTIVE, kind: N, ops: NUMERIC,
    doc: "Ki Points you have now." },
  { key: "capacity.spent", phase: PHASES.REACTIVE, kind: N, ops: NUMERIC,
    doc: "Capacity used this round. Adding to it spends Capacity." },

  { key: "life.max", phase: PHASES.CORE, kind: N, ops: NUMERIC, doc: "Maximum Life Points." },
  { key: "ki.max", phase: PHASES.CORE, kind: N, ops: NUMERIC, doc: "Maximum Ki Points." },
  { key: "capacity.flat", phase: PHASES.CORE, kind: N, ops: ["add"],
    doc: "Added to Max Capacity before the multiplier, as the rules order it." },
  { key: "capacity.multiplier", phase: PHASES.CORE, kind: N, ops: ["multiply"],
    doc: "Multiplies Max Capacity, after every flat change." },
  { key: "surge.life.dice", phase: PHASES.CORE, kind: D, ops: ["add-dice"],
    doc: "Extra dice on the Life Points regained by a Healing Surge." },
  { key: "surge.ki.amount", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "Extra Ki Points regained by a Ki Surge." },

  // --- Defence -----------------------------------------------------------------
  { key: "soakValue", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "Your Soak Value. Floors at your Tier of Power, then at zero." },
  { key: "soakValue.external", phase: PHASES.CORE, kind: N, ops: ["add"],
    doc: "Soak changed by something outside you, applied after your own." },
  { key: "soakValue.base", phase: PHASES.REACTIVE, kind: N, ops: ["add"],
    doc: "Soak before any calculation, so before the Damage Category multiplier." },
  { key: "damageReduction", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "Damage Reduction. Taken off the Wound Roll like Soak, but the Damage Category "
       + "neither reduces nor ignores it, and a multiplier on Soak does not touch it. "
       + "Harder to come by than Soak, and worth more for it." },
  { key: "damageReduction.pierced", phase: PHASES.REACTIVE, kind: N, ops: ["add"],
    doc: "How much of the target's Damage Reduction this one attack gets past. Written "
       + "by the attacker, and lasts only for that attack." },
  { key: "defenseValue", phase: PHASES.CORE, kind: N, ops: NUMERIC, doc: "Defense Value." },
  { key: "might", phase: PHASES.LATE, kind: N, ops: NUMERIC,
    doc: "Might, which is what a Might Clash rolls. Not what a Wound Roll is made of - "
       + "the two are separate terms, and an effect raising one raises only that one." },
  { key: "stressBonus", phase: PHASES.LATE, kind: N, ops: NUMERIC, doc: "Stress Bonus." },
  { key: "awareness", phase: PHASES.CORE, kind: N, ops: NUMERIC, doc: "Awareness." },
  { key: "surgency", phase: PHASES.CORE, kind: N, ops: NUMERIC, doc: "Surgency." },
  { key: "haste", phase: PHASES.CORE, kind: N, ops: NUMERIC, doc: "Haste." },
  { key: "meleeRange", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "Melee Range, in Squares beyond the adjacent ones. 0 reaches only what you touch." },

  // --- Rolls -------------------------------------------------------------------
  // Named as the rulebook names them: "increase your Wound Rolls by 2(T)" is `wound`.
  { key: "strike", phase: PHASES.LATE, kind: N, ops: NUMERIC, doc: "Strike Rolls." },
  { key: "dodge", phase: PHASES.LATE, kind: N, ops: NUMERIC, doc: "Dodge Rolls." },
  { key: "parry", phase: PHASES.LATE, kind: N, ops: NUMERIC,
    doc: "Added on top of Strike, but only when Strike is rolled defensively as a Parry." },
  { key: "wound", phase: PHASES.LATE, kind: N, ops: NUMERIC,
    doc: "Wound Rolls, which are the Damage Attribute the attack's Foundation names. "
       + "Raising Might does not raise this." },
  { key: "initiative", phase: PHASES.CORE, kind: N, ops: NUMERIC, doc: "Initiative Bonus." },

  // Writing here lands on all three, because those three are the Combat Rolls.
  { key: "combatRolls", phase: PHASES.LATE, kind: N, ops: NUMERIC,
    fanOut: ["strike", "dodge", "wound"],
    doc: "Every Combat Roll. Contributes to Strike, Dodge and Wound at once - a Parry "
       + "gets it through Strike. Saving Throws and Skill Checks are not Combat Rolls." },
  { key: "combatRolls.dice", phase: PHASES.LATE, kind: D, ops: ["add-dice"],
    doc: "Dice added to every Combat Roll, as the Superior State's Greater Dice." },

  { key: "roll.total", phase: PHASES.REACTIVE, kind: N, ops: NUMERIC,
    doc: "A finished roll of yours, after it has been made and read. Karmic Boost "
       + "adds to one; changing it can change the Clash it settled." },
  { key: "roll.dice", phase: PHASES.REACTIVE, kind: D, ops: ["add-dice"],
    doc: "Dice added to a roll after the fact, rolled when the effect is taken." },
  { key: "clash.succeed", phase: PHASES.REACTIVE, kind: F, ops: ["set"],
    doc: "Turns a Clash you lost into one you won, whatever the totals said. Karmic "
       + "Save is the one thing in the rules that does this." },
  { key: "defend.free", phase: PHASES.REACTIVE, kind: F, ops: ["set"],
    doc: "The Defend Maneuver costs no Counter Action for this attack." },

  { key: "baseDie", phase: PHASES.REACTIVE, kind: N, ops: ["set", "add"],
    doc: "The Base Die's Natural Result. Setting it skips rolling it, but does not "
       + "protect from a Botch: the Natural Result is whatever it ends up being." },
  { key: "criticalTarget", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "Lowest Natural Result that scores a Critical. Never below 7." },
  { key: "botchRange", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "Highest Natural Result that scores a Botch. Starts at 1." },
  { key: "botch.penalty", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "What a Botch costs: 2 flat on Skill rolls, 2(bT) on everything else." },
  { key: "willingFailure", phase: PHASES.REACTIVE, kind: F, ops: ["set", "allow", "forbid"],
    doc: "Whether this roll may be failed on purpose. An Urgent Roll forbids it." },

  // --- What you are allowed to do ----------------------------------------------
  // Written with `forbid`, and declared here for the same reason every other Slot is:
  // a name nobody reads is an effect that does nothing, and it has to be caught when
  // it is written rather than discovered at the table.
  { key: "maneuvers", phase: PHASES.CORE, kind: F, ops: ["allow", "forbid", "set"],
    doc: "Using Maneuvers at all, Counter Maneuvers included. Sleeping and Slowed "
       + "at three stacks forbid this." },
  { key: "attackingManeuvers", phase: PHASES.CORE, kind: F, ops: ["allow", "forbid", "set"],
    doc: "Using Attacking Maneuvers. Pinned forbids this." },
  { key: "movement", phase: PHASES.CORE, kind: F, ops: ["allow", "forbid", "set"],
    doc: "The Movement Maneuver, the Soar Maneuver, and moving through your own "
       + "effects. Staggered and Pinned forbid this." },
  { key: "transformations", phase: PHASES.CORE, kind: F, ops: ["allow", "forbid", "set"],
    doc: "Entering an Enhancement or a Form. Stress Exhaustion forbids this." },
  { key: "signatureTechniques", phase: PHASES.CORE, kind: F, ops: ["allow", "forbid", "set"],
    doc: "Using a Signature Technique." },
  { key: "uniqueAbilities", phase: PHASES.CORE, kind: F, ops: ["allow", "forbid", "set"],
    doc: "Using a Unique Ability." },
  { key: "nonPhysicalAttacks", phase: PHASES.CORE, kind: F, ops: ["allow", "forbid", "set"],
    doc: "Attacking Maneuvers of any Attack Type other than Physical." },
  { key: "attacksOnOthers", phase: PHASES.CORE, kind: F, ops: ["allow", "forbid", "set"],
    doc: "Attacking anyone but the target you were given. Compelled forbids this." },
  { key: "defeat", phase: PHASES.CORE, kind: F, ops: ["allow", "forbid", "set"],
    doc: "Being registered as Defeated at all. The Undying State forbids it, which is "
       + "what lets Life Points go negative without the fight ending." },
  { key: "diceAdvantage", phase: PHASES.REACTIVE, kind: N, ops: ["dice-up", "dice-down"],
    doc: "Rolling two Base Dice and taking the better or worse. These do not stack, "
       + "and opposing ones cancel out entirely - see Dice Priority." },

  // --- Dice --------------------------------------------------------------------
  { key: "dice.extra.category", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "Tier of Power Extra Dice, as a category step." },
  { key: "dice.greater.category", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "Greater Dice, as a category step." },
  { key: "dice.critical.category", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "Critical Extra Dice, as a category step. Capped using the Base Tier." },
  { key: "dice.extra.instances", phase: PHASES.CORE, kind: N, ops: NUMERIC, clamp: [0, 2],
    doc: "How many times the Tier of Power Extra Dice apply. One by default, and no "
       + "effect may take it past two." },

  // --- Economy -----------------------------------------------------------------
  { key: "attack.kiCost", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "Ki Point Cost of every Attacking Maneuver." },
  { key: "attack.kiWager.min", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "The least you may Ki Wager on an Attacking Maneuver. Compelled forces one." },
  { key: "actions.standard", phase: PHASES.CORE, kind: N, ops: NUMERIC, doc: "Standard Actions." },
  { key: "actions.counter", phase: PHASES.CORE, kind: N, ops: NUMERIC, doc: "Counter Actions." },
  { key: "actions.perRound", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "Actions gained each Combat Round." },
  { key: "actions.remaining", phase: PHASES.REACTIVE, kind: N, ops: NUMERIC,
    doc: "Actions left this round. Changed as they are spent or taken away." },
  { key: "speed.normal", phase: PHASES.CORE, kind: N, ops: NUMERIC, doc: "Speed." },
  { key: "speed.boosted", phase: PHASES.CORE, kind: N, ops: NUMERIC, doc: "Boosted Speed." },

  // --- Damage ------------------------------------------------------------------
  { key: "attack.energyCharges", phase: PHASES.REACTIVE, kind: N, ops: NUMERIC, clamp: [0, 7],
    doc: "Energy Charges on this Attacking Maneuver. Never more than seven." },
  { key: "damage.category.shift", phase: PHASES.REACTIVE, kind: N, ops: ["add"],
    doc: "Steps the Damage Category of your attack. Summed first, clamped last." },
  { key: "incoming.damage.category.shift", phase: PHASES.REACTIVE, kind: N, ops: ["add"],
    doc: "Steps the Damage Category of attacks made against you." },
  { key: "wound.total", phase: PHASES.REACTIVE, kind: N, ops: NUMERIC,
    doc: "The finished Wound Roll, after it is rolled. Guard halves this." },
  { key: "wound.dice", phase: PHASES.REACTIVE, kind: D, ops: ["add-dice"],
    doc: "Dice added to the Wound Roll, as an Energy Charge does." },
  { key: "damage.dealt", phase: PHASES.REACTIVE, kind: N, ops: NUMERIC,
    doc: "Damage you deal, once Soak has been taken off." },
  { key: "incoming.damage", phase: PHASES.REACTIVE, kind: N, ops: NUMERIC,
    doc: "Damage you receive." },
  { key: "attack.autoHit", phase: PHASES.CORE, kind: F, ops: ["set"],
    doc: "Your Attacking Maneuvers hit regardless of the Clash. A standing property "
       + "while it lasts - the Determined State - rather than something that happens." },
  { key: "incoming.autoHit", phase: PHASES.CORE, kind: F, ops: ["set"],
    doc: "Attacking Maneuvers aimed at you hit regardless of the Clash, as a Sleeping "
       + "character is." },

  // --- Range -------------------------------------------------------------------
  { key: "range.melee", phase: PHASES.CORE, kind: N, ops: NUMERIC, doc: "Melee Range, in squares." },
  { key: "range.attack", phase: PHASES.CORE, kind: N, ops: NUMERIC, doc: "Attack range, in squares." },
  { key: "area.size", phase: PHASES.REACTIVE, kind: N, ops: NUMERIC, doc: "Area of Effect magnitude." },

  // --- Initiative and turns ----------------------------------------------------
  { key: "initiative.advantage", phase: PHASES.CORE, kind: F, ops: ["set"], doc: "Initiative Advantage." },
  { key: "turn.outOfOrder", phase: PHASES.REACTIVE, kind: F, ops: ["set"],
    doc: "Lets you act outside the Initiative Order." },
  { key: "skipTurn", phase: PHASES.CORE, kind: F, ops: ["set"],
    doc: "Your turn in the Initiative Order is skipped, for as long as this lasts - "
       + "Slowed at three stacks. Read off the prepared character when the turn comes "
       + "round, so it has to be settled by then." },
  { key: "turn.skip", phase: PHASES.REACTIVE, kind: F, ops: ["set"],
    doc: "Skips the turn that is beginning right now, once. Deliberately not the same "
       + "as skipTurn: the Determined State skips one turn and ends in the same breath, "
       + "so a standing property would be gone before it was read." },

  // --- Attacks per round -------------------------------------------------------
  { key: "attacks.free", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "Attacking Maneuvers each round before Diminishing Offense begins." },
  { key: "diminishing.offense.perStack", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "What one stack of Diminishing Offense costs your Strike Rolls." },
  { key: "diminishing.defense.perAttack", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "Stacks of Diminishing Defense gained per attack aimed at you." },

  // --- Thresholds --------------------------------------------------------------
  { key: "threshold.penalty", phase: PHASES.LATE, kind: N, ops: NUMERIC,
    doc: "What failed Steadfast Checks cost your Combat Rolls." },
  { key: "steadfast.target", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "What a Steadfast Check has to meet." }
];

/**
 * Slots whose name carries a parameter - one Attribute, one Skill, one Defend option.
 *
 * The name is checked against what the character actually has rather than a hardcoded
 * list, so a Skill added to the data model needs no change here.
 */
const PATTERNS = [
  { match: /^(\w+)\.score$/, phase: PHASES.TIER, kind: N, ops: ["add"],
    valid: (data, [k]) => k in (data.attributes ?? {}),
    doc: "An Attribute Score." },
  { match: /^(\w+)\.mod$/, phase: PHASES.CORE, kind: N, ops: NUMERIC,
    valid: (data, [k]) => k in (data.attributes ?? {}),
    doc: "An Attribute Modifier." },
  { match: /^skill\.(\w+)$/, phase: PHASES.LATE, kind: N, ops: NUMERIC,
    valid: (data, [k]) => k in (data.skills ?? {}),
    doc: "A bonus to rolls using that Skill." },
  { match: /^skill\.(\w+)\.bonus$/, phase: PHASES.CORE, kind: N, ops: NUMERIC,
    valid: (data, [k]) => k in (data.skills ?? {}),
    doc: "The Skill Bonus itself, as the sheet shows it." },
  { match: /^save\.(\w+)$/, phase: PHASES.CORE, kind: N, ops: NUMERIC,
    valid: (data, [k]) => k in (data.savingThrows ?? {}),
    doc: "A Saving Throw." },
  { match: /^defend\.(\w+)\.kiCost$/, phase: PHASES.CORE, kind: N, ops: NUMERIC,
    valid: () => true,
    doc: "Ki Point Cost of one option of the Defend Maneuver." },
  { match: /^(\w[\w-]*)\.kiCost$/, phase: PHASES.CORE, kind: N, ops: NUMERIC,
    valid: () => true,
    doc: "Ki Point Cost of one named Maneuver." },
  { match: /^threshold\.(\w+)\.at$/, phase: PHASES.CORE, kind: N, ops: NUMERIC,
    valid: () => true,
    doc: "Where one Health Threshold falls." },
  { match: /^(\w+)\.stacks$/, phase: PHASES.CORE, kind: N, ops: NUMERIC,
    valid: () => true,
    doc: "How many of a Resource you hold." },
  { match: /^(\w+)\.max$/, phase: PHASES.CORE, kind: N, ops: NUMERIC,
    valid: () => true,
    doc: "The most of a Resource you can hold." },
  // Immunity, written as forbidding the Condition itself: `forbid condition.compelled`.
  { match: /^condition\.(\w[\w-]*)$/, phase: PHASES.CORE, kind: F,
    ops: ["allow", "forbid", "set"],
    valid: () => true,
    doc: "Gaining one named Combat Condition. Forbidding it is immunity to it." }
];

/** Exact Slots, by name. */
const SLOTS = new Map(TABLE.map(slot => [slot.key, Object.freeze(slot)]));

/**
 * Look a Slot up by name, parameterised ones included.
 *
 * Returns undefined for a name the system does not know, which every caller treats as
 * an authoring error rather than a no-op.
 */
export function getSlot(key, data = null) {
  const exact = SLOTS.get(key);
  if (exact) return exact;

  for (const pattern of PATTERNS) {
    const found = key.match(pattern.match);
    if (!found) continue;
    // A pattern that names something the character does not have is still unknown:
    // `skill.stelth` must fail rather than silently become a Slot of its own.
    if (data && !pattern.valid(data, found.slice(1))) continue;
    return Object.freeze({ ...pattern, key, params: found.slice(1) });
  }

  return undefined;
}

/** Whether an operation is allowed on a Slot. */
export function allowsOperation(slot, operation) {
  return slot.ops.includes(operation);
}

/** Every exact Slot, for the sheet's reference list and for the tests. */
export function allSlots() {
  return [...SLOTS.values()];
}

/**
 * Operations that contradict rather than accumulate.
 *
 * Priority only breaks ties, and only between these: two effects that set a value, two
 * that impose a floor, one that forbids against one that allows. Adds and multiplies
 * never disagree - they all apply.
 */
export const CONFLICTING = Object.freeze(["set", "min", "max", "allow", "forbid"]);
