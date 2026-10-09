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
import { SENSES } from "../senses.mjs";

export const PHASES = Object.freeze({
  /** Before the Tiers are known. Amounts may use (bT) but never (T). */
  TIER: "tier",
  /**
   * The Attribute Modifiers, ahead of the bulk so that what reads one there - Powerful Physique's "1/4 of your Force
   * Modifier", Spinning's Agility Modifier - reads it finished. Conditions may read Scores and the Tiers.
   */
  MODS: "mods",
  /** The bulk of the pipeline. Everything is available. */
  CORE: "core",
  /** After Might, Wound and the Thresholds are settled. */
  LATE: "late",
  /** Not derived at all: collected at a Moment during an exchange. */
  REACTIVE: "reactive",
  /**
   * Before anything else: what lowers the Weather Tier a character feels - the Brace
   * Maneuver's. Worked out ahead of the rest because a Weather felt at 0 is one whose effects
   * are not gathered at all. Conditions may read Scores and Skill Ranks; nothing derived.
   */
  WEATHER: "weather",
  /**
   * Not the character's at all: what a built Item's own script says about the piece itself -
   * its Break Value, its Hardness, what it lets its wearer ignore. Worked out on the piece,
   * from its Effects alone, and never folded into anyone's numbers.
   */
  PIECE: "piece",
  /**
   * Not the character's either: what a Weapon's own script says about an attack made with it -
   * "All Attacking Maneuvers made with this Weapon ..." - worked out on the Weapon, for that
   * attack, when it is declared, and never folded into anyone's numbers. What a Weapon does
   * while it is merely wielded - the Magic Staff's Use Magic, Warding's Damage Reduction - is
   * written against the character's own Slots, as any worn Item's is.
   */
  WEAPON: "weapon"
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
  // "If any effect changes your Racial Life Modifier, it applies retroactively" - and in a Combat Encounter, the Life
  // Points with it (combat.mjs registerRacialLifeHooks).
  { key: "racialLifeModifier", phase: PHASES.TIER, kind: N, ops: NUMERIC,
    doc: "The Racial Life Modifier, counted for every Power Level." },
  { key: "ki.perLevel", phase: PHASES.TIER, kind: N, ops: NUMERIC,
    doc: "Ki Points gained per Power Level." },
  // "Reduce your Size Category by 1." A number of Categories up or down the list from the
  // one the character was built with, because that is how every rule that moves somebody's
  // Size states it. Settled in the Tier pass, which is the one that has run by the time the
  // Size is resolved - so an effect that moves it may be written in (bT) and never in (T).
  { key: "size.steps", phase: PHASES.TIER, kind: N, ops: NUMERIC,
    doc: "Size Categories up or down from the one you chose. Negative is smaller. Clamped "
       + "to the ends of the list: nothing is smaller than Nano or larger than Colossal." },
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
  { key: "capacity.maxFraction", phase: PHASES.CORE, kind: N, ops: ["add"],
    doc: "Extra Max Capacity, as a fraction of it: 0.25 is \"increase your Max Capacity "
       + "by 1/4\". Added rather than multiplied, so two of them are a half and not a "
       + "quarter twice over." },
  // Discarded Divinity's "you cannot Ki Wager a number of Ki Points that exceed 1/4 of your Max Capacity".
  { key: "kiWager.capacityShare", phase: PHASES.CORE, kind: N, ops: ["set"],
    doc: "The most that may be Ki Wagered - in Ki or in Life - as a share of the Max Capacity: 0.25 is a quarter. "
       + "A ceiling beside the others, Full Wager's lifted half included (maneuvers.mjs maxKiWager)." },
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
  // A Stress Test is 1d10 plus this, so the Stress Bonus *is* the Dice Score of one -
  // there is no second number for the roll. Vile Weather reduces the Dice Score and this
  // is what it reduces.
  { key: "stressBonus", phase: PHASES.LATE, kind: N, ops: NUMERIC,
    doc: "Stress Bonus, which is the Dice Score of a Stress Test above the die." },
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
  // Warrior of Two Worlds' - each read where the Wound Roll of an attack is worked out (chat.mjs woundParts).
  // Enhanced Reflexes': "apply your Greater Dice to this Dodge Roll" - ticked for it (chat.mjs rollSide).
  { key: "dodge.greaterDice", phase: PHASES.REACTIVE, kind: F, ops: ["set"],
    doc: "The Greater Dice on this Dodge Roll." },
  { key: "wound.signature", phase: PHASES.CORE, kind: N, ops: ["add"],
    doc: "Added to the Wound Roll of an Attacking Maneuver made through the Signature Technique Maneuver alone." },
  { key: "wound.perThresholdOrAlly", phase: PHASES.CORE, kind: N, ops: ["add"],
    doc: "Added to the Wound Roll once for each Health Threshold you, or the Ally deepest below, is below - whichever "
       + "is more (Inherited Fury)." },
  { key: "wound.perTargetThreshold", phase: PHASES.CORE, kind: N, ops: ["add"],
    doc: "Added to the Wound against each target once for each Health Threshold they are below (Inherited Aggression)." },
  { key: "techniquePoints.perSkillImprovement", phase: PHASES.TIER, kind: N, ops: ["add"],
    doc: "Technique Points more from each Skill Improvement, as Gifted Student's (Inherited Creativity)." },
  { key: "signature.tpCost", phase: PHASES.CORE, kind: N, ops: ["add"],
    doc: "Added to what each Signature Technique takes from the character, after all else (Earthling-Raised's 2 off)." },
  { key: "energyCharge.again.kiCost", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "The Energy Charge Maneuver's Ki Point Cost once it has been used this Combat Round (Energy Core's 1(T) off)." },
  { key: "signature.kiCost", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "The Ki Point Cost of your Signature Techniques (Inherited Creativity's 1(T) off)." },

  // Writing here lands on all three, because those three are the Combat Rolls.
  // "Increase all of your Grapple Checks made as the Grappled by 1(T)." The Grappled is
  // always the Defender of a Grapple Check, whoever opened it, so this is read there - and
  // only there, which is what makes it different from `strike`.
  { key: "grapple.all", phase: PHASES.LATE, kind: N, ops: NUMERIC,
    doc: "Every Grapple Check you make, as the Grappler or the Grappled - Four Witches Grip." },
  { key: "grapple.defending", phase: PHASES.LATE, kind: N, ops: NUMERIC,
    doc: "Grapple Checks you make as the Grappled. Not the ones you make as the Grappler, "
       + "which are Strike Rolls like any other." },
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
  // Warding Weapon: "increase your Dice Score in any Clash initiated by an Opponent by 1(T)" -
  // their attack's Strike against your Dodge or Parry, and every Clash they open, whatever it
  // rolls. Never one you opened.
  { key: "clash.defending", phase: PHASES.LATE, kind: N, ops: NUMERIC,
    doc: "Added to your Dice Score in any Clash an Opponent opened - their attack against your "
       + "Dodge or Parry included." },
  { key: "defend.free", phase: PHASES.REACTIVE, kind: F, ops: ["set"],
    doc: "The Defend Maneuver costs no Counter Action for this attack." },

  { key: "baseDie", phase: PHASES.REACTIVE, kind: N, ops: ["set", "add"],
    doc: "The Base Die's Natural Result. Setting it skips rolling it, but does not "
       + "protect from a Botch: the Natural Result is whatever it ends up being." },
  { key: "criticalTarget", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "Lowest Natural Result that scores a Critical. Never below 7." },
  { key: "botchRange", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "Highest Natural Result that scores a Botch. Starts at 1." },
  // Vile Weather widens the Botch Range "for a Combat Roll", and nothing else: a Skill
  // Check made in the poison is no likelier to go wrong than one made in clean air.
  { key: "botchRange.combat", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "Highest Natural Result that scores a Botch on a Combat Roll, where that is "
       + "wider than the ordinary one. Vile Weather sets it to 2(WT)." },
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
  // Said to the table rather than enforced, and the only two of these that are. This
  // system does not move anybody - the players move the tokens - and it does not track
  // who you were told to attack, which is a thing the table settled it would rather
  // handle itself. Both are still worth writing: a Condition that forbids something
  // silently is a Condition nobody reads.
  { key: "movement", phase: PHASES.CORE, kind: F, ops: ["allow", "forbid", "set"],
    doc: "The Movement Maneuver, the Soar Maneuver, and moving through your own "
       + "effects. Staggered and Pinned forbid this. Said to the table, not enforced: "
       + "nothing here moves a token." },
  { key: "transformations", phase: PHASES.CORE, kind: F, ops: ["allow", "forbid", "set"],
    doc: "Entering an Enhancement or a Form. Stress Exhaustion forbids this." },
  { key: "signatureTechniques", phase: PHASES.CORE, kind: F, ops: ["allow", "forbid", "set"],
    doc: "Using a Signature Technique." },
  { key: "specialManeuvers", phase: PHASES.CORE, kind: F, ops: ["allow", "forbid", "set"],
    doc: "Using Special Maneuvers at all, as a class - which is a different question from "
       + "`maneuver.<id>`, the Slot that grants or closes one by name. The Spectator State "
       + "forbids the class." },
  // "Your Movement Maneuver does not provoke the Exploit Maneuver." Said to the table
  // rather than measured - nothing here watches a token leave a Melee Range - but it does
  // decide whether the card offers the Exploit, which is the only place an Exploit is ever
  // offered from.
  { key: "movement.provokes", phase: PHASES.CORE, kind: F, ops: ["allow", "forbid", "set"],
    doc: "Whether your Movement Maneuver provokes the Exploit Maneuver. Forbidding it "
       + "stops the card offering one." },
  { key: "uniqueAbilities", phase: PHASES.CORE, kind: F, ops: ["allow", "forbid", "set"],
    doc: "Using a Unique Ability." },
  { key: "nonPhysicalAttacks", phase: PHASES.CORE, kind: F, ops: ["allow", "forbid", "set"],
    doc: "Attacking Maneuvers of any Attack Type other than Physical." },
  // "You cannot use ... Ki Wagers, or any Profile aside from Simple (Physical)" - the
  // Ki-Sealing Handcuff's. The Physical half is `nonPhysicalAttacks`; these are the rest.
  { key: "kiWagers", phase: PHASES.CORE, kind: F, ops: ["allow", "forbid", "set"],
    doc: "Ki Wagering on an Attacking Maneuver at all, in Ki or in Life. Forbidding it "
       + "takes the most you may wager to nothing." },
  { key: "profiles.nonSimple", phase: PHASES.CORE, kind: F, ops: ["allow", "forbid", "set"],
    doc: "Every Profile but Simple. Forbidding it leaves Simple the only one offered." },
  { key: "attacksOnOthers", phase: PHASES.CORE, kind: F, ops: ["allow", "forbid", "set"],
    doc: "Attacking anyone but the target you were given. Compelled forbids this. Said "
       + "to the table, not enforced: who you were told to attack is not tracked, which "
       + "is a thing the table chose to keep." },
  // Taken off the Weather Tier the character feels, before the Weather's effects are
  // gathered - so a Tier brought to 0 is a Weather whose effects are not gathered at all.
  { key: "weather.tiers", phase: PHASES.WEATHER, kind: N, ops: NUMERIC,
    doc: "How many Weather Tiers lower every Battle Weather counts for you. The Brace "
       + "Maneuver writes 1, or 2 at 4+ Ranks in Survival. A Tier reduced to 0 is a "
       + "Weather whose effects you ignore." },
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
  { key: "attack.kiCost.minimum", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "The least an Attacking Maneuver can be reduced to. Half the Profile's listed "
       + "KP Cost by default, and read off that alone - anything that raises the price "
       + "leaves the floor where it was. Perfect Ki Control lowers it with "
       + "`max= 2(T)`, which is how \"this cannot increase the Minimum\" is written." },
  { key: "attack.kiWager.min", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "The least you may Ki Wager on an Attacking Maneuver. Compelled forces one." },
  { key: "actions.standard", phase: PHASES.CORE, kind: N, ops: NUMERIC, doc: "Standard Actions." },
  { key: "actions.counter", phase: PHASES.CORE, kind: N, ops: NUMERIC, doc: "Counter Actions." },
  // "Convert up to 2 of your Counter Actions into Actions" - this Combat Round's, at a moment (Celestial Potential's).
  { key: "actions.fromCounter", phase: PHASES.REACTIVE, kind: N, ops: NUMERIC,
    doc: "Counter Actions turned into Actions this Combat Round, at a moment." },
  // "Gain 2 Counter Actions" - this Combat Round's, at a moment (Skill of the Watcher's), never past six.
  { key: "actions.counterGained", phase: PHASES.REACTIVE, kind: N, ops: NUMERIC,
    doc: "Counter Actions gained this Combat Round, at a moment." },
  { key: "actions.perRound", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "Actions gained each Combat Round." },
  { key: "actions.remaining", phase: PHASES.REACTIVE, kind: N, ops: NUMERIC,
    doc: "Actions left this round. Changed as they are spent or taken away." },
  // Both Speeds at once. "Reduce your Speeds and Defense Value by 2(WT)" names them
  // together, and there is no reason for a file to know how many there are.
  //
  // Applied outside the two named ones, so a halving written here lands on the finished
  // Speed - the same shape `save.all` has.
  { key: "speed.all", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "Both Speeds. Applied after the one named for a single Speed." },
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
    doc: "Damage you receive. Not asked at all when the Wound Roll less your Soak Value "
       + "and Damage Reduction came to nothing: there is no Damage then, so there is "
       + "nothing here to change - an effect that increases what you take takes more of "
       + "something rather than conjuring it." },
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
  { key: "diminishing.defense.onPhysicalHit", phase: PHASES.CORE, kind: F, ops: ["set"],
    doc: "Once a Combat Round, a Physical Attack that hits gives its target the Diminishing Defense of "
       + "one more Attacking Maneuver - Multiple Arms." },
  { key: "combination.extraRoll", phase: PHASES.CORE, kind: F, ops: ["set"],
    doc: "Once a Combat Round, one more of Combination's follow-up Strike Rolls - Multiple Arms." },
  { key: "basicAttack.asInstant", phase: PHASES.CORE, kind: F, ops: ["set"],
    doc: "Once a Combat Round, the Basic Attack as an Instant Maneuver for 2 Counter Actions - Multiple Arms." },
  { key: "weapons.wielded", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "Weapons you can wield at once - two, four in Multiple Arms." },
  { key: "diminishing.defense.reduction", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "Taken off the total penalty from Diminishing Defense - Desperate Dodge's." },

  // --- Damage Over Time --------------------------------------------------------
  { key: "dot", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "Stacks of DOT you hold. Each costs you Life Points at the start of your turn. "
       + "Not a Combat Condition, though it stacks like one." },
  { key: "dot.perStack", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "What one stack of DOT costs at the start of your turn. 1(bT) by default." },

  // --- Super Stacks ------------------------------------------------------------
  // The count is resolved in CORE because everything it feeds - the Soak Value, and
  // the two roll bonuses read off the sheet - is settled from CORE onwards.
  { key: "superStacks", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "Super Stacks you possess. Never counts for more than 3, however many are "
       + "granted." },
  { key: "superStack.musclePenalty", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "The Muscle Penalty your Super Stacks cost your Strike and Dodge Rolls. "
       + "1(bT) per stack, and 1(bT) more at three. Zero while you hold none, so an "
       + "effect adding to it adds to nothing." },
  { key: "superStack.solidBulk", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "The Soak Value your Super Stacks grant: 1(bT) per stack." },
  { key: "superStack.massivePower", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "What your Super Stacks add to the Wound Rolls of your Physical and Energy "
       + "Attacks: 1/4 of your Force Modifier per stack, each quarter rounded down." },

  // --- Thresholds --------------------------------------------------------------
  { key: "threshold.penalty", phase: PHASES.LATE, kind: N, ops: NUMERIC,
    doc: "What failed Steadfast Checks cost your Combat Rolls." },
  // Every Saving Throw at once. "Reduce the Dice Score of your Saving Throws by 1(WT)"
  // names all of them, and writing the four out in a file would be a list that quietly
  // misses the fifth if one is ever added.
  //
  // Applied outside `save.<x>`, so a halving written here lands on the finished Saving
  // Throw rather than on the Attribute Score it started as.
  { key: "save.all", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "Every Saving Throw. Applied after the one named for a single Throw." },

  // "While you are wearing this Accessory, ignore Unbreathable Environments" - the Space
  // Helmet. Not the same as being Unnatural: that stops the Suffocating, and this stops the
  // Environment being Unbreathable for you at all - no Check, no Held Breath to lose.
  { key: "unbreathableEnvironments", phase: PHASES.CORE, kind: F,
    ops: ["allow", "forbid", "set"],
    doc: "Whether an Unbreathable Environment is Unbreathable for you. Forbidding it ignores "
       + "them: no Survival Check, no Held Breath, no Suffocating from them." },
  { key: "unnatural", phase: PHASES.CORE, kind: F, ops: ["allow", "forbid", "set"],
    // "A Character that is Unnatural cannot gain the Suffocating or Poisoned Combat
    // Conditions." Which is two immunities the system already has, so this fans out to
    // them rather than being a third thing to read: `forbid unnatural` and everything
    // that already respects an immunity respects this one.
    fanOut: ["condition.suffocating", "condition.poisoned"],
    // And a fact of its own: Natural Healing Hands' "you cannot target Unnatural characters" asks it by name.
    keepsSelf: true,
    doc: "Unnatural biology. Forbidding it makes the character immune to Suffocating and "
       + "Poisoned at once - which is the whole of what being Unnatural is." },

  { key: "steadfast.target", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "What a Steadfast Check has to meet. 6 by default." },
  // "Increase the Natural Result for all Steadfast Checks and Saving Throws by 2" - Legacy.
  // The die, not the total: what a Critical and a Botch of a Saving Throw are read off.
  { key: "steadfast.natural", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "Added to the Natural Result of your Steadfast Checks." },
  { key: "saves.natural", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "Added to the Natural Result of every Saving Throw you roll." },
  // Drunk's "Increase the Natural Result of your Strike and Dodge Rolls by L" - read where those are rolled (rollSide).
  { key: "strike.natural", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "Added to the Natural Result of every Strike Roll you make - attacking, Parrying, or in a Clash." },
  { key: "dodge.natural", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "Added to the Natural Result of every Dodge Roll you make." },
  // Feral's "Increase the Natural Result of your Strike and Wound Rolls ... by L".
  { key: "wound.natural", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "Added to the Natural Result of every Wound Roll you make." },
  { key: "steadfast.dice", phase: PHASES.CORE, kind: N, ops: NUMERIC,
    doc: "What is added to the Dice Score of your Steadfast Checks. Hot Weather takes "
       + "1(WT) off it." },

  // --- The piece itself ----------------------------------------------------------------------
  //
  // Written in a built Item's own Effects - a piece of Apparel's - and read off that piece:
  // what it is, rather than what it does to whoever wears it. `piece.breakValue += 3;`.
  { key: "piece.apparelBonus", phase: PHASES.PIECE, kind: N, ops: NUMERIC,
    doc: "Added to this piece's Apparel Bonus, per base Tier - Dense Armor's 1." },
  { key: "piece.breakValue", phase: PHASES.PIECE, kind: N, ops: NUMERIC,
    doc: "Added to the most this piece's Break Value can be - Durable's 3." },
  { key: "piece.hardnessValue", phase: PHASES.PIECE, kind: N, ops: NUMERIC,
    doc: "This piece's Hardness Value, set outright - Hefty Plating's `= 4`." },
  { key: "piece.armorDamageReduction", phase: PHASES.PIECE, kind: N, ops: NUMERIC,
    doc: "What the Armor Category's Damage Reduction from this piece is multiplied by - "
       + "Sleek Design's `*= 1/2`." },
  { key: "piece.countsForPenalty", phase: PHASES.PIECE, kind: F, ops: ["allow", "forbid", "set"],
    doc: "Whether this piece counts towards the Apparel Penalty. `= false` for Lightweight, "
       + "Sleek Design and Standard Clothing." },
  { key: "piece.unbreakable", phase: PHASES.PIECE, kind: F, ops: ["allow", "forbid", "set"],
    doc: "This piece's Break Value is never reduced - Unbreakable." },
  { key: "piece.sparesFirstBreak", phase: PHASES.PIECE, kind: F, ops: ["allow", "forbid", "set"],
    doc: "The first loss of Break Value from full each Combat Encounter does not happen - "
       + "Joint Protection." },
  { key: "piece.wornOverArmor", phase: PHASES.PIECE, kind: F, ops: ["allow", "forbid", "set"],
    doc: "This piece may go on over Armor - the Jacket." },
  { key: "piece.doffsWithNoEffort", phase: PHASES.PIECE, kind: F, ops: ["allow", "forbid", "set"],
    doc: "This piece may be Doffed through the No-Effort Maneuver - Loose." },
  { key: "piece.doffRounds", phase: PHASES.PIECE, kind: N, ops: NUMERIC,
    doc: "Combat Rounds this piece's first Doff Bonus of an Encounter lasts longer - "
       + "Segmented Weight's 1 for each of its Quality Slots." },
  { key: "piece.sizeIsWearers", phase: PHASES.PIECE, kind: F, ops: ["allow", "forbid", "set"],
    doc: "This piece's Size Category is always its wearer's - Stretching." },
  { key: "piece.spikes", phase: PHASES.PIECE, kind: F, ops: ["allow", "forbid", "set"],
    doc: "A Physical blow landing on this piece costs the one who struck its Apparel Bonus in "
       + "Life Points, if adjacent - Spiked." },
  { key: "piece.thrownMightClash", phase: PHASES.PIECE, kind: F,
    ops: ["allow", "forbid", "set"],
    doc: "Hitting a Character with this piece through the Throw Maneuver opens a Might Clash, "
       + "won to knock them Prone - Hefty Plating." },
  { key: "piece.waivesWeightsWhileHoldingBack", phase: PHASES.PIECE, kind: F,
    ops: ["allow", "forbid", "set"],
    doc: "The Weights take nothing off its wearer's Combat Rolls while they Hold Back - "
       + "Training Support." },
  { key: "piece.ignoresEnvironments", phase: PHASES.PIECE, kind: F,
    ops: ["allow", "forbid", "set"],
    doc: "Its wearer ignores the Battle Environment's effects - Environmental Protection." },
  { key: "piece.ignoresEnvironmentalQualities", phase: PHASES.PIECE, kind: F,
    ops: ["allow", "forbid", "set"],
    doc: "Its wearer ignores their Square's Environmental Qualities - Environmental Protection." },

  // --- A Weapon, and an attack made with it -----------------------------------------------------
  //
  // Written in a Weapon's own Effects, and read off that Weapon when an attack is declared with
  // it: "Attacking Maneuvers made with this Weapon ...". `weapon.wound += 2(T);`.
  { key: "weapon.strike", phase: PHASES.WEAPON, kind: N, ops: NUMERIC,
    doc: "Added to the Strike Roll of an attack made with it." },
  { key: "weapon.wound", phase: PHASES.WEAPON, kind: N, ops: NUMERIC,
    doc: "Added to the Wound Roll of an attack made with it." },
  { key: "weapon.strikeNatural", phase: PHASES.WEAPON, kind: N, ops: NUMERIC,
    doc: "Added to the Natural Result of the Strike Roll of an attack made with it - Targeting "
       + "System." },
  { key: "weapon.kiCost", phase: PHASES.WEAPON, kind: N, ops: NUMERIC,
    doc: "Added to the Ki Point Cost of an attack made with it - Efficient's -2(T)." },
  { key: "weapon.energyCharges", phase: PHASES.WEAPON, kind: N, ops: NUMERIC,
    doc: "Energy Charges an attack made with it gains - High Power's." },
  { key: "weapon.damageCategory", phase: PHASES.WEAPON, kind: N, ops: NUMERIC,
    doc: "Steps the Damage Category of an attack made with it - Dimension Blade's." },
  { key: "weapon.meleeRange", phase: PHASES.WEAPON, kind: N, ops: NUMERIC,
    doc: "Added to the Melee Range for an attack made with it - Extending's 3." },
  { key: "weapon.magnitude", phase: PHASES.WEAPON, kind: N, ops: NUMERIC,
    doc: "Magnitudes added to the Area of Effect of an attack made with it - High Power's." },
  { key: "weapon.damageReductionIgnored", phase: PHASES.WEAPON, kind: N, ops: NUMERIC,
    doc: "The part of the target's Damage Reduction an attack made with it ignores - "
       + "Bludgeoning's 1/2. Read as written, the fraction being the point." },
  { key: "weapon.soakIgnored", phase: PHASES.WEAPON, kind: N, ops: NUMERIC,
    doc: "The part of the target's Soak Value, before any reductions, an attack made with it "
       + "ignores - Piercing's 1/4, rounded up." },
  { key: "weapon.diminishingAtDeclaration", phase: PHASES.WEAPON, kind: F,
    ops: ["allow", "forbid", "set"],
    doc: "Its Diminishing Defense is applied at Attack Declaration - Slashing." },
  { key: "weapon.lifePerLevel", phase: PHASES.WEAPON, kind: N, ops: NUMERIC,
    doc: "Life Points the Weapon gains for each of its wielder's Power Levels, beyond the 8 "
       + "every Weapon does - the Shield's x, Durable's 2." },
  { key: "weapon.hardnessRank", phase: PHASES.WEAPON, kind: N, ops: NUMERIC,
    doc: "Its Hardness Rank, thrown, where it is not the 2 every Weapon has - Super Heavy's 4. Its "
       + "Hardness Value is the Rank's, at the base Tier of the one it hits." },
  { key: "weapon.block", phase: PHASES.WEAPON, kind: F, ops: ["allow", "forbid", "set"],
    doc: "Wielding it gives access to the Block Special Maneuver - the Shield." },
  { key: "weapon.staggering", phase: PHASES.WEAPON, kind: F, ops: ["allow", "forbid", "set"],
    doc: "An attack made with it that knocks an Opponent through a Health Threshold opens a Might "
       + "Clash that knocks them Prone - Staggering." },
  { key: "weapon.lastingWounds", phase: PHASES.WEAPON, kind: F, ops: ["allow", "forbid", "set"],
    doc: "An attack made with it that deals Damage leaves a stack of DOT until the start of the "
       + "attacker's next turn - Lasting Wounds." },
  { key: "weapon.ignoresLongRange", phase: PHASES.WEAPON, kind: F, ops: ["allow", "forbid", "set"],
    doc: "An attack made with it takes no Long Range penalty - Far Sight." },
  { key: "weapon.longRangeStrike", phase: PHASES.WEAPON, kind: N, ops: NUMERIC,
    doc: "Added to its Strike against each Opponent 9+ Squares away - Long Range Weapon." },
  { key: "weapon.wholeBattlefield", phase: PHASES.WEAPON, kind: F, ops: ["allow", "forbid", "set"],
    doc: "The whole Battlefield is the Melee Range for an attack made with it - Elongation." },
  { key: "weapon.scholarshipDamage", phase: PHASES.WEAPON, kind: F, ops: ["allow", "forbid", "set"],
    doc: "The Damage Attribute of an attack made with it is Scholarship - High-Tech." },
  { key: "weapon.breaker", phase: PHASES.WEAPON, kind: F, ops: ["allow", "forbid", "set"],
    doc: "Apparel hit with it loses twice the Break Value, and a Weapon hit with it takes 1/4 "
       + "(rounded up) more Damage - Breaker." },
  { key: "weapon.unbreakable", phase: PHASES.WEAPON, kind: F, ops: ["allow", "forbid", "set"],
    doc: "Nothing reduces its Life Points, and it is never broken - Unbreakable." },
  { key: "weapon.regenerates", phase: PHASES.WEAPON, kind: F, ops: ["allow", "forbid", "set"],
    doc: "Whole again at the end of every Combat Encounter, broken or not - Regenerating." },
  { key: "weapon.selfDamage", phase: PHASES.WEAPON, kind: N, ops: NUMERIC,
    doc: "The part of its own maximum Life Points each attack made with it costs it - Dimension "
       + "Blade's 1/10. Read as written, the fraction being the point." },
  { key: "weapon.throwing", phase: PHASES.WEAPON, kind: F, ops: ["allow", "forbid", "set"],
    doc: "Thrown with the Throw Maneuver and hitting, its Category and Qualities apply - Throwing "
       + "Weapon." },
  { key: "weapon.barrage", phase: PHASES.WEAPON, kind: F, ops: ["allow", "forbid", "set"],
    doc: "Thrown, the Combination Profile (Physical) may be used instead of the Simple - Barrage "
       + "Weapon." },
  { key: "weapon.returns", phase: PHASES.WEAPON, kind: N, ops: NUMERIC,
    doc: "Thrown, it may be taken in hand again at once; at 2, with the Homing Advantage - "
       + "Boomerang's Slots." },
  { key: "weapon.copies", phase: PHASES.WEAPON, kind: F, ops: ["allow", "forbid", "set"],
    doc: "Thrown, a copy goes and it stays in hand - three Throws a Combat Round - Multi-Storage." },
  { key: "weapon.quickDraw", phase: PHASES.WEAPON, kind: F, ops: ["allow", "forbid", "set"],
    doc: "Drawn, 1(T) on the next Attacking Maneuver's Strike if it is the next Maneuver; put away, "
       + "2(T) on the next attack with it's Wound - Quick Draw." },
  { key: "weapon.burstFire", phase: PHASES.WEAPON, kind: F, ops: ["allow", "forbid", "set"],
    doc: "An attack made with it may spend any number of Actions, an Energy Charge for each - Burst "
       + "Fire." },
  { key: "weapon.concealed", phase: PHASES.WEAPON, kind: F, ops: ["allow", "forbid", "set"],
    doc: "The first Armed Attack with it each Combat Round opens a Clash (Stealth vs Perception) "
       + "for Guard Down - Concealed." },
  { key: "weapon.snacks", phase: PHASES.WEAPON, kind: N, ops: NUMERIC,
    doc: "How many Snacks it gives, an Action each, a Combat Encounter - Shishkebab's Slots." },
  { key: "weapon.remoteAll", phase: PHASES.WEAPON, kind: F, ops: ["allow", "forbid", "set"],
    doc: "A Remote Control for every Item of the type it is attuned to, not one - Controller "
       + "Weapon at 2 Slots." },
  { key: "weapon.telekinetic", phase: PHASES.WEAPON, kind: F, ops: ["allow", "forbid", "set"],
    doc: "Held by the mind: not counted among the two Weapons wielded, and an attack made with it "
       + "may come from anywhere in a Large Sphere around its wielder - Telekinetic." }
];

/**
 * Slots whose name carries a parameter - one Attribute, one Skill, one Defend option.
 *
 * The name is checked against what the character actually has rather than a hardcoded
 * list, so a Skill added to the data model needs no change here.
 */
const PATTERNS = [
  // "Some effects may designate a Profile as a Favored Element" - `favored.elementalEarth = true;`, Telekinesis's.
  { match: /^favored\.(elemental\w+)$/, phase: PHASES.CORE, kind: F, ops: ["allow", "forbid", "set"],
    valid: () => true,
    doc: "That Elemental Profile is a Favored Element: usable below Magic 3, the Force Modifier as its Damage Attribute, "
       + "Strike 1(T) and Wound 2(T) with it." },
  // One Foundation's: "your Energy Strike", "your Physical Wound Rolls" - on top of the Strike or Wound every Foundation
  // shares, read where an attack, a Parry or a Clash names that Foundation.
  { match: /^strike\.(physical|energy|magic)$/, phase: PHASES.LATE, kind: N, ops: NUMERIC,
    valid: () => true,
    doc: "That Foundation's Strike Rolls only - Physical, Energy or Magic Strike." },
  { match: /^wound\.(physical|energy|magic)$/, phase: PHASES.LATE, kind: N, ops: NUMERIC,
    valid: () => true,
    doc: "That Foundation's Wound Rolls only - Physical, Energy or Magic Wound." },
  // The Combat Roll a piece narrows its Category's effects to - Focal's choice.
  { match: /^piece\.narrows\.(strike|dodge|wound)$/, phase: PHASES.PIECE, kind: F,
    ops: ["allow", "forbid", "set"],
    valid: () => true,
    doc: "The only Combat Roll this piece's Category reaches, and its Doff Bonus - Focal." },
  // Controller Weapon: "this Weapon can be treated as the Remote Control Basic Item. Select what
  // this Remote Control is attuned to" - by the file the Items it reaches are made from.
  { match: /^weapon\.remote\.([\w-]+)$/, phase: PHASES.WEAPON, kind: F,
    ops: ["allow", "forbid", "set"],
    valid: () => true,
    doc: "A Remote Control for the Items made from that file - `weapon.remote.bomb`." },
  // Karmic Edge: "Apply an Energy Charge to all Attacking Maneuvers using this Weapon against
  // Opponents whose Alignment matches the chosen Alignments" - Good/Pure Good or Evil/Pure Evil.
  { match: /^weapon\.karmicEdge\.(good|evil)$/, phase: PHASES.WEAPON, kind: F,
    ops: ["allow", "forbid", "set"],
    valid: () => true,
    doc: "An attack made with it gains an Energy Charge against a Good or Evil Opponent." },
  // The Ki Point Cost of the Attacking Maneuvers of one Attack Type - the Magic Staff's "reduce
  // the Ki Point Cost of your Magic Attacks ... by 2(T)".
  { match: /^attack\.kiCost\.(physical|energy|magic)$/, phase: PHASES.CORE, kind: N, ops: NUMERIC,
    valid: () => true,
    doc: "Ki Point Cost of every Attacking Maneuver of that Attack Type." },
  // A Battle Weather, by its id, felt this many Weather Tiers lower - Weather Resistant.
  { match: /^piece\.resistsWeather\.([\w-]+)$/, phase: PHASES.PIECE, kind: N, ops: NUMERIC,
    valid: () => true,
    doc: "How many Weather Tiers lower its wearer feels one Battle Weather, by its id." },
  { match: /^(\w+)\.score$/, phase: PHASES.TIER, kind: N, ops: ["add"],
    valid: (data, [k]) => k in (data.attributes ?? {}),
    doc: "An Attribute Score." },
  { match: /^(\w+)\.mod$/, phase: PHASES.MODS, kind: N, ops: NUMERIC,
    valid: (data, [k]) => k in (data.attributes ?? {}),
    doc: "An Attribute Modifier." },
  { match: /^skill\.(\w+)$/, phase: PHASES.LATE, kind: N, ops: NUMERIC,
    valid: (data, [k]) => k in (data.skills ?? {}),
    doc: "A bonus to rolls using that Skill." },
  // Checked against the Skill table rather than the derived Skills, because this is a
  // CORE Slot and the Skills are worked out after the CORE phase has run. Reading the
  // derived object meant asking a question whose answer was always "no" this early, so
  // every `skill.<name>.bonus` an effect wrote was dropped as an unknown Slot - Blinded's
  // Perception halving, Sleeping's two, Holding Back's Concealment bonus and Liquid's
  // Stealth among them. None of them had ever applied.
  // Every Skill governed by one Attribute - "all Skill Checks that use your Personality
  // Score". By the Attribute rather than a list of Skills, so a Skill added under it is
  // not quietly missed. On the roll, as `skill.<name>` is, and applied round it.
  { match: /^skills\.(\w+)$/, phase: PHASES.LATE, kind: N, ops: NUMERIC,
    valid: (data, [k]) => k in (data.attributes ?? {}),
    doc: "A bonus to rolls of every Skill that uses that Attribute Score." },
  // What a Skill's Checks do to their own Natural Result - "increase the Natural Result
  // of any Perception Skill Check by 1". The die, not the total: it is what a Critical
  // and a Botch are read off, which a bonus to the roll never reaches.
  // "Reduce the Critical Target of your Performance Skill Checks by 1" - Para Para Dance's. A move from the character's
  // own Critical Target, held to the same floor.
  // "You may use your Insight Score instead of your Magic Score to calculate the Skill Bonus for the Use Magic Skill"
  // (Psychic's) - `allow skill.useMagic.from.insight`: the higher of the two.
  { match: /^skill\.(\w+)\.from\.(\w+)$/, phase: PHASES.CORE, kind: F, ops: ["allow", "forbid", "set"],
    valid: (data, [k, attribute]) => (k in (data.skills ?? data.constructor?.SKILLS ?? {})) && (attribute in (data.attributes ?? {})),
    doc: "That Skill's Skill Bonus may be worked out from that Attribute's Score instead, where it is the higher." },
  { match: /^skill\.(\w+)\.criticalTarget$/, phase: PHASES.CORE, kind: N, ops: NUMERIC,
    valid: (data, [k]) => k in (data.skills ?? data.constructor?.SKILLS ?? {}),
    doc: "Added to the Critical Target of that Skill's Checks - negative is easier." },
  { match: /^skill\.(\w+)\.natural$/, phase: PHASES.CORE, kind: N, ops: NUMERIC,
    valid: (data, [k]) => k in (data.skills ?? data.constructor?.SKILLS ?? {}),
    doc: "Added to the Natural Result of that Skill's Checks." },
  // The same, only on a Check relying on one sense - "made relying on sight", "related to
  // your hearing". Whether one is, is the player's to say when they roll it - asked only
  // while this is not zero. The senses are those in senses.mjs.
  { match: /^skill\.(\w+)\.natural\.(\w+)$/, phase: PHASES.CORE, kind: N, ops: NUMERIC,
    valid: (data, [k, sense]) => (k in (data.skills ?? data.constructor?.SKILLS ?? {}))
      && (sense in SENSES),
    doc: "Added to the Natural Result of that Skill's Checks made relying on that sense: "
       + "sight or hearing." },
  // A Skill Rank an effect gives - Divine Magic's "At Character Creation, gain a Skill Rank in each of the following
  // skills" - counted with the Progression tab's.
  { match: /^skill\.(\w+)\.ranks$/, phase: PHASES.CORE, kind: N, ops: NUMERIC, valid: () => true,
    doc: "Skill Ranks an effect gives in that Skill, counted with the ones picked." },
  // Something granted rather than permitted - set true by `allow`, read as granted: "You can sense God Ki" (God Ki's
  // Concealment cannot win outright against it), and Skill of the Watcher's (5) Power Up out of sequence, offered after
  // an Exploit's Damage or a Defend's none.
  { match: /^(sense\.godKi|powerUp\.afterExploitOrDefend|surgency\.magic|exploit\.onNoDamage|combatRecovery\.flowOfCombat|freedom\.turnStart)$/,
    phase: PHASES.CORE, kind: F, ops: ["allow", "forbid", "set"], valid: () => true,
    doc: "Sensing God Ki; the Power Up offered after an Exploit's Damage or a Defend's none; Surgency from the Magic "
       + "Modifier where higher (Cosmic Efficiency); the Exploit offered when an attack left you without Damage, and "
       + "Combat Recovery out of sequence at the start of a turn with none taken (Flow of Combat); a Standard Maneuver of 1 Action "
       + "out of sequence for a Counter Action at the start of a turn (Inherited Freedom)." },
  // "For each Health Threshold you are below, increase your Wound Rolls, Soak Value and Surgency by 1(T)" (Blood of the
  // Warrior's): written once, counted where each is worked out.
  { match: /^(wound|soakValue|surgency)\.perThreshold$/, phase: PHASES.CORE, kind: N, ops: ["add"], valid: () => true,
    doc: "Added to it once for each Health Threshold the character is below." },
  // Powerful Physique's 4th: hit by an Attacking Maneuver, the Basic Attack back once it is done.
  { match: /^basicAttack\.afterHit$/, phase: PHASES.CORE, kind: F, ops: ["allow", "forbid", "set"], valid: () => true,
    doc: "Hit by an Opponent's Attacking Maneuver, the Basic Attack offered on its card once it is done, the Force "
       + "Modifier on its Wound Roll - once per Encounter." },
  // Rubbery Body's: the Pin's Might Clash, held down; Damage taken from a Direct or Lethal attack; the stretch a Physical
  // Attack or a Grapple may take; and Majin Regeneration's Life Points per Threshold on a Healing Surge.
  { match: /^(might\.againstPin|incoming\.damage\.directOrHigher|meleeRange\.stretch|surge\.life\.perThreshold)$/,
    phase: PHASES.CORE, kind: N, ops: ["add"], valid: () => true,
    doc: "The Dice Score of a Might Clash when targeted by the Pin Maneuver; Damage received from an Attacking Maneuver "
       + "of Direct or higher; Squares a Physical Attack or Grapple may reach past the Melee Range, asked; Life Points a "
       + "Healing Surge gives back for each Health Threshold below." },
  { match: /^(collision\.halved|rubbery\.move|bouncy\.moveAway|bouncy\.afterCollision|burrowed\.strike|burrowed\.diminishing|disarming\.onMiss|disarming\.onHit|disarming\.onCounter|malice\.backlash|mentality\.signature|quickSleep\.recovery|quickLearner\.\w+|revenge\.\w+|snack\.double|transfiguration\.beam|snackFiend\.superior|signature\.earthlingRaised|ki\.protected|concealment\.autoSucceed|kiMultiplier\.always|ki\.noRegain|powerBattery\.overCapacity|protector\.intervene)$/, phase: PHASES.CORE, kind: F, ops: ["allow", "forbid", "set"],
    valid: () => true,
    doc: "Every Collision Damage received halved; moving one hit with a Physical Attack or put in a Grapple, once a Round "
       + "(Rubbery Body's); moving away when hit, and the Movement after Collision Damage (Bouncy Physique's); a Physical "
       + "Attack through the ground, and 2(bT) Ki to double Diminishing Defense on a Simple one (Burrowed Strike's)." },
  // Majin Malice's: a Healing Surge given as Ki Points and Capacity; and the Power Up's Out-of-Sequence Maneuver.
  { match: /^(surge\.asKi|malice\.outOfSequence|costume\.mend)$/, phase: PHASES.REACTIVE, kind: F, ops: ["set"], valid: () => true,
    doc: "A Healing Surge's Life Points given as Ki Points and Capacity instead, the Capacity past its Max; the Basic "
       + "Attack, a Signature Technique or the Energy Charge out of sequence for 5(bT) Life Points." },
  // Elastic Tentacle's: this attack's Diminishing Defense doubled, ticked as it hits.
  { match: /^attack\.doublesDiminishing$/, phase: PHASES.REACTIVE, kind: F, ops: ["set"], valid: () => true,
    doc: "The Diminishing Defense this Attacking Maneuver gave the ones it hit, doubled - not on top of another increase." },
  // Transfiguration Beam's: the Strike Roll's Critical Target for an attack of that Foundation.
  { match: /^criticalTarget\.(physical|energy|magic)$/, phase: PHASES.CORE, kind: N, ops: ["add"], valid: () => true,
    doc: "The Critical Target of the Strike Roll of an Attacking Maneuver of that Foundation - its own floor still under it." },
  // Bouncy Physique's "Increase your Strike Rolls by 2(T) when using the Reflect Maneuver": one Maneuver's Strike Roll.
  { match: /^([a-z][\w-]*)\.strike$/, phase: PHASES.CORE, kind: N, ops: ["add"], valid: () => true,
    doc: "The Strike Roll of an Attacking Maneuver made with that Maneuver, by its id - `reflect.strike`." },
  // "Apply your Racial Saving Throw Bonus to Cognitive as well as Corporeal" (Warrior's Pride's).
  // Construct's: "Ignore the penalties for the Bruised or Injured Health Thresholds, but reduce your Steadfast Checks by 3
  // for the Critical Health Threshold and double its penalties" - a failure there costing nothing, or twice.
  { match: /^threshold\.(ignore|double)\.(bruised|injured|critical)$/, phase: PHASES.CORE, kind: F,
    ops: ["allow", "forbid", "set"], valid: () => true,
    doc: "A Steadfast Check failed at that Health Threshold costs nothing (ignore), or twice what it would (double)." },
  { match: /^steadfast\.dice\.(bruised|injured|critical)$/, phase: PHASES.CORE, kind: N, ops: NUMERIC, valid: () => true,
    doc: "Added to the Steadfast Check for that Health Threshold alone." },
  // Alternate Scale Structure's: "That selected Size Category becomes your base Size Category".
  { match: /^size\.base\.(\w+)$/, phase: PHASES.TIER, kind: F, ops: ["allow", "forbid", "set"], valid: () => true,
    doc: "The Size Category the character is built as, in place of the one picked on the sheet." },
  // Enhanced Organism's: "Gain the Alternate Upbringing Factor, ignoring its Racial Requirements".
  { match: /^factor\.ignoreRequirement\.([\w-]+)$/, phase: PHASES.CORE, kind: F, ops: ["allow", "forbid", "set"],
    valid: () => true, doc: "That Racial Factor's Racial Requirement does not apply to them (it only orders the list)." },
  { match: /^save\.racial\.(\w+)$/, phase: PHASES.CORE, kind: F, ops: ["allow", "forbid", "set"], valid: () => true,
    doc: "That Saving Throw gets the Racial Saving Throw Bonus too: 1(T), and its Critical Target 1 lower." },
  // "You automatically succeed all Steadfast Checks for the Bruised Health Threshold" (Saiyan Heritage's) - and never fail
  // one for it.
  { match: /^steadfast\.autoPass\.(\w+)$/, phase: PHASES.CORE, kind: F, ops: ["allow", "forbid", "set"], valid: () => true,
    doc: "That Health Threshold's Steadfast Check passed, and never failed - whatever would fail it." },
  // "Your minimum Action Cost for Combat Recovery is 1 Action" - the least a Maneuver priced in a range may be given.
  { match: /^(\w[\w-]*)\.actionCost\.minimum$/, phase: PHASES.CORE, kind: N, ops: NUMERIC, valid: () => true,
    doc: "The least Action Cost that Maneuver may be given." },
  // God of War's "add the Weapon Assisted Advantage to that Signature Technique without spending Technique Points".
  { match: /^technique\.free\.([\w-]+)$/, phase: PHASES.CORE, kind: F, ops: ["allow", "forbid", "set"], valid: () => true,
    doc: "A Signature Technique feature whose TP the character does not pay - its TP still the Technique's." },
  // God of Magic's "Reduce the TP Cost of all Magical Unique Abilities by 3 TP and ... the KP Cost ... by 2(T)".
  { match: /^unique\.(technical|magical)\.(tpCost|kiCost)$/, phase: PHASES.CORE, kind: N, ops: NUMERIC, valid: () => true,
    doc: "The TP or KP Cost of every Unique Ability of that type. The TP never below half the listed cost." },
  { match: /^skill\.(\w+)\.bonus$/, phase: PHASES.CORE, kind: N, ops: NUMERIC,
    valid: (data, [k]) => k in (data.skills ?? data.constructor?.SKILLS ?? {}),
    doc: "The Skill Bonus itself, as the sheet shows it." },
  // The same shape and the same fix: a CORE Slot whose values are derived later still.
  // Nothing in the library writes one yet, so this was latent rather than biting.
  { match: /^save\.(\w+)$/, phase: PHASES.CORE, kind: N, ops: NUMERIC,
    valid: (data, [k]) => k in (data.savingThrows ?? data.constructor?.SAVING_THROWS ?? {}),
    doc: "A Saving Throw." },
  { match: /^maneuver\.([\w-]+)$/, phase: PHASES.CORE, kind: F,
    ops: ["allow", "forbid", "set"],
    valid: () => true,
    doc: "Using one named Maneuver, by its id - `forbid maneuver.energy-charge`. For a "
       + "rule that names Maneuvers one by one rather than by what they are." },
  { match: /^defend\.(\w+)\.kiCost$/, phase: PHASES.CORE, kind: N, ops: NUMERIC,
    valid: () => true,
    doc: "Ki Point Cost of one option of the Defend Maneuver." },
  { match: /^intervene\.(\w+)\.kiCost$/, phase: PHASES.CORE, kind: N, ops: NUMERIC,
    valid: () => true,
    doc: "Ki Point Cost of one option of the Intervene Maneuver: defenseWall, deflect "
       + "or distantDeflect." },
  { match: /^(\w[\w-]*)\.kiCost$/, phase: PHASES.CORE, kind: N, ops: NUMERIC,
    valid: () => true,
    doc: "Ki Point Cost of one named Maneuver." },
  { match: /^(\w[\w-]*)\.uses$/, phase: PHASES.CORE, kind: N, ops: NUMERIC,
    valid: () => true,
    doc: "Uses of one named Maneuver's limit, beyond its own - Energizing Training's \"use the Surge "
       + "Maneuver an additional time during each Combat Encounter\" is `surge.uses += 1`." },
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

/**
 * Whether an operation is allowed on a Slot.
 *
 * Adding dice to a number Slot is allowed wherever adding a number is: the dice are
 * rolled and the total is the number. "Regain 1d10(bT) Life and Ki Points" is the shape,
 * and it is a number by the time anything reads it.
 */
export function allowsOperation(slot, operation) {
  if (slot.ops.includes(operation)) return true;
  return (operation === "add-dice") && (slot.kind === KINDS.NUMBER) && slot.ops.includes("add");
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
