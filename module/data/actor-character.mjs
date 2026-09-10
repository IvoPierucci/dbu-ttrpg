const { fields } = foundry.data;

import { applyPassives, applySlot, permits } from "../effects/interpreter.mjs";
import { programsFor } from "../effects/registry.mjs";
import { evaluate } from "../effects/conditions.mjs";
import {
  categoryFormula,
  greaterDiceCategory,
  maxCategoryIncrease,
  tierExtraDiceCategory
} from "../dice.mjs";
import {
  racialAttributeChoices,
  racialAttributeIncrease,
  racialLifeModifier,
  racialSavingThrows,
  racialSkillRankCount
} from "../races.mjs";

/**
 * Fold one phase of passive effects into the character's derived data.
 *
 * Called three times during the pass, because amounts are themselves derived: the
 * earliest phase runs before the Tiers are known and may only use (bT), the middle one
 * has everything, and the last waits for Might and the Thresholds. A Slot declares
 * which phase it belongs to and the compiler refuses an amount that would read a value
 * not settled yet - that check is what makes the arrangement honest rather than hopeful.
 */
function runPhase(data, phase) {
  const scope = {
    data,
    errors: data.effects.errors,
    // The rulebook asks this as a Trait's name ("while you are not benefiting from
    // Balanced Warrior"), so it is answered by looking for that Trait among the ones
    // whose conditions currently hold. The visited set arrives through the scope, so
    // two Traits naming each other stop instead of recursing.
    benefitsFrom: (name, inner) => data.effects.programs.some(entry =>
      (entry.sourceName?.toLowerCase() === String(name).toLowerCase())
      && (entry.program.blocks ?? []).some(b => blockApplies(b, inner))
    )
  };

  const { slots, active } = applyPassives(data.effects.programs, phase, scope);
  Object.assign(data.effects.slots, slots);
  data.effects.active.push(...active);
}

/** Whether a block would do anything right now, which is what "benefiting" means. */
function blockApplies(b, scope) {
  if (b.mode !== "passive") return false;
  return (b.statements ?? []).some(statement =>
    (statement.type !== "if") || evaluate(statement.condition, scope)
  );
}

/**
 * What effects add to one Slot, for values that are a component of a larger formula.
 *
 * Only the additive part: a multiplication has to land on the finished value, not on
 * one ingredient of it, so anything that can be multiplied goes through withEffects.
 */
function slot(data, key) {
  return data.effects?.slots?.[key]?.add ?? 0;
}

/**
 * A finished value with everything effects did to it: adds, then set/floor/ceiling,
 * then multiplications last, as Calculation Priority requires.
 *
 * **Nothing the system derives goes below zero.** A penalty large enough to take a
 * value past zero simply cancels whatever it was, rather than turning it into a number
 * that then drags a roll down with it. The exceptions are stated where they apply -
 * Undying letting Life Points go negative is one - and are opted into here rather than
 * being the default.
 */
function withEffects(data, key, base, { min = 0 } = {}) {
  const value = applySlot(data.effects?.slots, key, base);
  return (min === null) ? value : Math.max(min, value);
}

/**
 * Data model for the "character" Actor type in the DBU TTRPG system.
 * Based on the Attributes rules from https://dbu-rpg.com/attributes/
 */
export default class DBUCharacterData extends foundry.abstract.TypeDataModel {

  /** Highest Power Level a character can reach. */
  static MAX_POWER_LEVEL = 30;

  /** Life Points: 60 at PL1, +12 per Power Level after that. */
  static BASE_LIFE = 60;
  static LIFE_PER_LEVEL = 12;

  /** Ki Points: 50 at PL1, +12 per Power Level after that. */
  static BASE_KI = 50;
  static KI_PER_LEVEL = 12;

  /** Life Points gained per Power Level per point of Tenacity Score. */
  static LIFE_PER_TENACITY = 2;

  /**
   * An Attribute Score: 1, plus every Attribute Addition granted at or below the
   * given Power Level. Shared with the creation hook, which needs a Score before any
   * derived data exists.
   */
  /**
   * The total Attribute Score increase a character's race grants for one Attribute:
   * the race's fixed increases plus whatever the player picked for its choices.
   */
  static racialIncreaseFor(race, choices, key) {
    const chosen = racialAttributeChoices(race).reduce((total, choice, index) => {
      return total + ((choices[index] === key) ? choice.amount : 0);
    }, 0);
    return racialAttributeIncrease(race, key) + chosen;
  }

  static attributeScore(progression, key, powerLevel, racialIncrease = 0) {
    return 1 + racialIncrease + progression
      .filter(entry => entry.lvl <= powerLevel)
      .reduce((total, entry) => total + (entry.attributes?.[key] ?? 0), 0);
  }

  /**
   * Maximum Life Points. The flat part grows once per Power Level, while the Racial
   * Life Modifier, the Tenacity contribution and any Transformation bonus are granted
   * for EVERY Power Level - which is what makes a Tenacity increase apply
   * retroactively to Levels already gained.
   */
  static maxLife({ powerLevel, tenacityScore, racialLifeModifier = 0, lifePerLevelBonus = 0 }) {
    const perLevel = racialLifeModifier
      + (DBUCharacterData.LIFE_PER_TENACITY * tenacityScore)
      + lifePerLevelBonus;
    return DBUCharacterData.BASE_LIFE
      + (DBUCharacterData.LIFE_PER_LEVEL * (powerLevel - 1))
      + (perLevel * powerLevel);
  }

  /** Maximum Ki Points: a flat pool per Power Level, plus any Transformation bonus. */
  static maxKi({ powerLevel, kiPerLevelBonus = 0 }) {
    return DBUCharacterData.BASE_KI
      + (DBUCharacterData.KI_PER_LEVEL * (powerLevel - 1))
      + (kiPerLevelBonus * powerLevel);
  }

  /**
   * How many Skills a Skill Improvement may take twice.
   *
   * A Skill Improvement normally spreads across distinct Skills. The Level 1 one is
   * the exception: the extra Ranks it carries may be placed in a Skill already chosen
   * there - but only one Skill may be doubled up that way.
   */
  static PAIRED_SKILL_RANKS_LEVEL_1 = 1;

  /**
   * Whether a Skill can be taken in one more slot of a Skill Improvement, given what
   * the rest of that grant already holds.
   *
   * No Skill may appear more than twice, and only the Level 1 grant allows a Skill to
   * appear twice at all - and only one Skill within it.
   */
  static canRepeatSkillRank(entry, key, otherSlots) {
    const taken = otherSlots.filter(slot => slot === key).length;
    if (taken === 0) return true;
    if (taken > 1) return false;
    if (!DBUCharacterData.isLevel1SkillImprovement(entry)) return false;

    const pairs = new Set(
      otherSlots.filter(slot => slot && (otherSlots.filter(other => other === slot).length > 1))
    ).size;
    return pairs < DBUCharacterData.PAIRED_SKILL_RANKS_LEVEL_1;
  }

  /** Skill rank slots granted by a Skill Improvement: 6 for the Level 1 slot, 4 otherwise. */
  static SKILL_RANK_SLOTS = 4;
  static SKILL_RANK_SLOTS_LEVEL_1 = 6;

  /** Placeholder rank choices, standing in until the skill list is implemented. */
  static SKILL_RANK_OPTIONS = ["1", "2", "3", "4"];


  /**
   * Every Skill, keyed by id, with the Attribute that governs it.
   *   required     - cannot be rolled at all without at least one Rank.
   *   encompassing - covers a field broad enough to need a written specialisation.
   * Force and Tenacity govern no Skills.
   */
  static SKILLS = Object.freeze({
    acrobatics:       { label: "Acrobatics",       attribute: "agility" },
    flight:           { label: "Flight",           attribute: "agility",     required: true },
    stealth:          { label: "Stealth",          attribute: "agility" },
    thievery:         { label: "Thievery",         attribute: "agility" },

    craft:            { label: "Craft",            attribute: "scholarship", required: true, encompassing: true },
    investigation:    { label: "Investigation",    attribute: "scholarship" },
    knowledge:        { label: "Knowledge",        attribute: "scholarship", encompassing: true },
    medicine:         { label: "Medicine",         attribute: "scholarship", required: true },

    clairvoyance:     { label: "Clairvoyance",     attribute: "insight",     required: true },
    concealment:      { label: "Concealment",      attribute: "insight",     required: true },
    creatureHandling: { label: "Creature Handling", attribute: "insight" },
    intuition:        { label: "Intuition",        attribute: "insight" },
    perception:       { label: "Perception",       attribute: "insight" },
    pilot:            { label: "Pilot",            attribute: "insight",     required: true },
    survival:         { label: "Survival",         attribute: "insight" },

    useMagic:         { label: "Use Magic",        attribute: "magic",       required: true },

    bluff:            { label: "Bluff",            attribute: "personality" },
    cooking:          { label: "Cooking",          attribute: "personality" },
    intimidation:     { label: "Intimidation",     attribute: "personality" },
    performance:      { label: "Performance",      attribute: "personality" },
    persuasion:       { label: "Persuasion",       attribute: "personality" }
  });

  /**
   * The Base Die every check is rolled with. Matches the die the Attribute roll has
   * always used; if the rules call for a different one, this is the only place to change.
   */
  static BASE_DIE = "1d10";

  /** A natural 1 is a Botch: this much is subtracted from the result. */
  static BOTCH_PENALTY = 2;

  /**
   * The highest Natural Result that scores a Botch. One by default; effects raise it.
   *
   * The mirror of the Critical Target, and read the same way: a Botch is any Natural
   * Result at or below this, just as a Critical is any at or above the Critical Target.
   */
  static BOTCH_RANGE_DEFAULT = 1;

  /**
   * A critical on a Skill roll always adds a flat 1d4. Every other roll uses the
   * character's Critical Extra Dice, which grow with the Tier of Power.
   */
  static SKILL_CRITICAL_DIE = "1d4";

  /**
   * A roll crits when the Base Die meets or beats the Critical Target. It starts at 10
   * and effects can lower it, but never below 7.
   */
  static CRITICAL_TARGET_DEFAULT = 10;
  static CRITICAL_TARGET_MIN = 7;

  /** The most Karma Points a character can hold. */
  static KARMA_MAX = 4;

  /** The most Energy Charges one Attacking Maneuver can carry. */
  static MAX_ENERGY_CHARGES = 7;

  /**
   * What one Energy Charge adds to the Wound Roll of the Maneuver carrying it.
   *
   * A Signature Technique gets the larger die. Which one it is comes from the Maneuver
   * carrying a `signature` tag - the concept has no home of its own in the system yet,
   * and a tag is the hook that will not have to move when it does.
   */
  static energyChargeDie(signature) {
    return signature ? "1d8" : "1d6";
  }

  /** Column headings for the Attributes in the progression table. */
  static ATTRIBUTE_ABBREVIATIONS = Object.freeze({
    agility: "AG",
    force: "FO",
    tenacity: "TE",
    scholarship: "SC",
    insight: "IN",
    magic: "MA",
    personality: "PE"
  });

  /**
   * Skills that care how big you are. Being larger makes you harder to hide and easier
   * to take seriously, so the same step counts against one and for the other.
   */
  static SIZE_SKILL_ADJUSTMENTS = Object.freeze({
    stealth: -1,
    intimidation: 1
  });

  /** Each Skill Rank adds this much to the Skill's bonus. */
  static SKILL_RANK_BONUS = 2;

  /** Highest number of Ranks one Skill may hold: 2 at ToP 1, one more per Tier, capped at 5. */
  static skillRankCap(tierOfPower) {
    return Math.min(5, tierOfPower + 1);
  }

  /**
   * Base Tier of Power at a given Power Level: 1 for Levels 1-4, then one more per
   * five. This is the Tier a character has by Level alone, before anything alters it.
   */
  static tierOfPowerFor(powerLevel) {
    return Math.floor(powerLevel / 5) + 1;
  }

  /**
   * Whether one Skill's Ranks stay within the cap at every point they were earned.
   *
   * A Rank is only legal if it was legal when gained, so the whole sequence has to be
   * replayed: the racial Ranks first, since those come with Power Level 1, then each
   * Skill Improvement in Level order, checking the cap for that Level's Tier of Power
   * as we go. Checking only the final total against the final cap would let a racial
   * Rank slip in on top of Ranks that already filled an earlier Tier's allowance.
   */
  static rankSequenceIsLegal(key, racialRanks, progression) {
    let count = racialRanks.filter(rank => rank === key).length;
    if (count > DBUCharacterData.skillRankCap(DBUCharacterData.tierOfPowerFor(1))) return false;

    for (const entry of progression) {
      if (entry.choice !== "Skill Improvement") continue;
      count += entry.skillRanks.filter(rank => rank === key).length;
      if (count > DBUCharacterData.skillRankCap(DBUCharacterData.tierOfPowerFor(entry.lvl))) return false;
    }
    return true;
  }

  /** Capacity: 20 at Power Level 1, plus 4 for every Level above it. */
  static BASE_CAPACITY = 20;
  static CAPACITY_PER_LEVEL = 4;

  /**
   * The three Foundations an attack can have, and the Attribute each one draws its
   * Damage Attribute from. Physical and Energy both use Force; Magic uses Magic.
   */
  static FOUNDATIONS = Object.freeze({
    physical: { label: "Physical", attribute: "force" },
    energy: { label: "Energy", attribute: "force" },
    magic: { label: "Magic", attribute: "magic" }
  });

  /** Attacking Maneuvers in a Combat Round that cost nothing before stacks begin. */
  static FREE_ATTACKS_PER_ROUND = 3;

  /**
   * Stacks of Diminishing Defense gained per Attacking Maneuver aimed at you: one at
   * Base Tier of Power 1-2, and one more for every two Tiers after that.
   */
  static diminishingDefensePerAttack(baseTierOfPower) {
    return Math.floor((baseTierOfPower + 1) / 2);
  }

  /**
   * Size Categories, smallest first. Defense Value and Soak move in opposite
   * directions - the smaller you are the harder you are to hit, the larger you are the
   * more you shrug off - and both scale with Tier of Power, hence the (T) notation.
   *
   * Only Small, Medium and Large may be chosen at Character Creation; the rest exist
   * because effects and Traits can move a character into them.
   */
  static SIZES = Object.freeze({
    nano:     { label: "Nano",     meleeRange: 0, speed: -6, defensePerTier: 3,  soakPerTier: -3, squares: "1" },
    tiny:     { label: "Tiny",     meleeRange: 0, speed: -3, defensePerTier: 2,  soakPerTier: -2, squares: "1" },
    small:    { label: "Small",    meleeRange: 0, speed: 0,  defensePerTier: 1,  soakPerTier: -1, squares: "1", selectable: true },
    medium:   { label: "Medium",   meleeRange: 0, speed: 0,  defensePerTier: 0,  soakPerTier: 0,  squares: "1", selectable: true },
    large:    { label: "Large",    meleeRange: 0, speed: 0,  defensePerTier: -1, soakPerTier: 1,  squares: "1", selectable: true },
    enormous: { label: "Enormous", meleeRange: 1, speed: 3,  defensePerTier: -2, soakPerTier: 2,  squares: "2x2" },
    gigantic: { label: "Gigantic", meleeRange: 3, speed: 6,  defensePerTier: -3, soakPerTier: 3,  squares: "4x4" },
    colossal: { label: "Colossal", meleeRange: 6, speed: 10, defensePerTier: -5, soakPerTier: 5,  squares: "7x7" }
  });

  /** The Size everything else is measured against. */
  static DEFAULT_SIZE = "medium";

  /** No Size penalty may take an Aptitude below this. */
  static SIZE_APTITUDE_FLOOR = 2;

  /**
   * Apply a Size modifier to an Aptitude.
   *
   * A penalty stops at 2 - and that floor beats the general minimums elsewhere, being
   * the more specific rule. It can only ever reduce, though: an Aptitude already below
   * 2 is left where it is rather than being raised up to the floor.
   */
  static applySizeModifier(value, modifier) {
    if (modifier >= 0) return value + modifier;
    const floor = Math.min(value, DBUCharacterData.SIZE_APTITUDE_FLOOR);
    return Math.max(floor, value + modifier);
  }

  /**
   * Health Thresholds, in order. `above` is the fraction of Maximum Life Points you
   * must be strictly above to be at that Threshold, so each one ends where the next
   * begins.
   *
   * Healthy is not itself a Threshold: rules that count how many Thresholds you are
   * below start at Bruised, which is what `counts` marks.
   */
  static THRESHOLDS = Object.freeze({
    healthy: { label: "Healthy", above: 0.5, counts: false },
    bruised: { label: "Bruised", above: 0.25, counts: true },
    injured: { label: "Injured", above: 0.1, counts: true },
    critical: { label: "Critical", above: -Infinity, counts: true }
  });

  /** The Health Threshold a character sits at, from their Life Points. */
  static thresholdKey(value, max) {
    const ratio = max ? (value / max) : 0;
    return Object.keys(DBUCharacterData.THRESHOLDS)
      .find(key => ratio > DBUCharacterData.THRESHOLDS[key].above);
  }

  /** Thresholds deeper than the given one, whose recorded checks no longer apply. */
  static thresholdsAbove(key) {
    const keys = Object.keys(DBUCharacterData.THRESHOLDS);
    return keys
      .filter((candidate, index) => (index > keys.indexOf(key)) && DBUCharacterData.THRESHOLDS[candidate].counts);
  }

  /** A Steadfast Check is a bare d10 against this - no Extra Dice, no crits, no botches. */
  static STEADFAST_DIE = "1d10";
  static STEADFAST_TARGET = 6;

  /** A Healing Surge restores this many d10 per Tier of Power. */
  static HEALING_SURGE_DICE_PER_TIER = 2;

  /** A Ki Surge restores this fraction of the Ki and Capacity maximums. */
  static KI_SURGE_FRACTION = 4;

  /** Ki Multiplier: Maximum Ki doubled, Max Capacity increased by half. */
  static KI_MULTIPLIER_KI = 2;
  static KI_MULTIPLIER_CAPACITY = 1.5;

  /** Actions a character has each Combat Round before any effect alters them. */
  static BASE_STANDARD_ACTIONS = 3;
  static BASE_COUNTER_ACTIONS = 1;

  /** Breakthrough: the current Tier of Power may exceed the Base Tier by at most this. */
  static BREAKTHROUGH_LIMIT = 2;

  /** TP granted by a Skill Improvement: 25 for the Level 1 slot, 15 everywhere else. */
  static SKILL_IMPROVEMENT_TP = 15;
  static SKILL_IMPROVEMENT_TP_LEVEL_1 = 25;

  /**
   * Power Levels 5 through 29 repeat a fixed five-level cycle, keyed by level % 5.
   * Levels 1-4 and 30 break the pattern and are listed explicitly below.
   */
  static POWER_LEVEL_CYCLE = Object.freeze({
    0: ["Talent Addition", "Attribute Addition", "Skill Improvement"],
    1: ["Character Perk"],
    2: ["Attribute Addition"],
    3: ["Character Perk"],
    4: ["Talent Addition"]
  });

  /**
   * Levels that do not follow POWER_LEVEL_CYCLE. Note that Level 4 grants no Talent
   * Addition even though the cycle would place one there - that is the published
   * table, not an oversight.
   */
  static POWER_LEVEL_EXCEPTIONS = Object.freeze({
    1: [
      "Character Perk",
      ...Array(4).fill("Talent Addition"),
      ...Array(5).fill("Attribute Addition"),
      "Skill Improvement"
    ],
    2: ["Character Perk"],
    3: ["Attribute Addition"],
    4: ["Character Perk"],
    30: Array(5).fill("Character Perk")
  });

  /** The slots granted when a character reaches the given Power Level. */
  static grantsForLevel(level) {
    return DBUCharacterData.POWER_LEVEL_EXCEPTIONS[level]
      ?? DBUCharacterData.POWER_LEVEL_CYCLE[level % 5];
  }

  /**
   * The single fixed Skill Improvement awarded at Level 1, which is worth more than
   * every other one. A Skill Improvement picked in a Character Perk slot is never
   * this row, even at Level 1, because Character Perk rows are not locked.
   */
  static isLevel1SkillImprovement(entry) {
    return (entry.choice === "Skill Improvement") && entry.locked && (entry.lvl === 1);
  }

  /**
   * TP granted by a progression row. Only a Skill Improvement grants any, and the
   * fixed Level 1 slot is worth 25 rather than the usual 15.
   */
  static techniquePointsFor(entry) {
    if (entry.choice !== "Skill Improvement") return 0;
    return DBUCharacterData.isLevel1SkillImprovement(entry)
      ? DBUCharacterData.SKILL_IMPROVEMENT_TP_LEVEL_1
      : DBUCharacterData.SKILL_IMPROVEMENT_TP;
  }

  /** Skill rank slots a progression row offers: 6 for the Level 1 slot, 4 otherwise. */
  static skillRankSlotsFor(entry) {
    return DBUCharacterData.isLevel1SkillImprovement(entry)
      ? DBUCharacterData.SKILL_RANK_SLOTS_LEVEL_1
      : DBUCharacterData.SKILL_RANK_SLOTS;
  }

  static defineSchema() {
    const schema = {};

    // --- Core Attributes ---
    // Each of the 7 Attributes has a Score (capped by Tier of Power)
    // and a Modifier (usually equal to Score, but independently alterable).
    schema.attributes = new fields.SchemaField(
      Object.fromEntries(
        ["agility", "force", "tenacity", "scholarship", "insight", "magic", "personality"].map(key => [
          key,
          new fields.SchemaField({
            // Score is not stored: it is 1 plus every Attribute Addition granted up to
            // the character's Power Level (see prepareDerivedData).
            // Bonus represents adjustments from Transformations/effects on top of the Score.
            bonus: new fields.NumberField({ required: true, integer: true, initial: 0 })
          })
        ])
      )
    );

    // Tier of Power is not stored: it follows directly from Power Level
    // (see prepareDerivedData).

    // --- Life and Ki Points ---
    // Only the current value is stored; both maximums are derived from Power Level
    // (see prepareDerivedData).
    // No floor here on purpose. Life Points are the stated exception to the rule that
    // nothing goes below zero - the Undying State lets Damage take them negative - and a
    // floor in the schema would make that impossible rather than merely unusual.
    // prepareDerivedData puts the floor back for everyone who is not Undying.
    schema.life = new fields.SchemaField({
      value: new fields.NumberField({ required: true, integer: true, initial: 60 })
    });

    schema.ki = new fields.SchemaField({
      value: new fields.NumberField({ required: true, integer: true, initial: 50, min: 0 })
    });

    // The Racial Life Modifier is not stored: it comes from the chosen race
    // (see prepareDerivedData and races.mjs).

    // --- Permanent per-Power-Level bonuses from Transformations ---
    // Some Transformations permanently change how much Life or Ki each Power Level
    // grants. Declared here so Transformations have somewhere to write once they exist;
    // both stay at 0 until then.
    schema.transformationBonuses = new fields.SchemaField({
      lifePerLevel: new fields.NumberField({ required: true, integer: true, initial: 0 }),
      kiPerLevel: new fields.NumberField({ required: true, integer: true, initial: 0 })
    });

    // --- Racial Skill Ranks ---
    // One entry per Rank the race grants, each naming a Skill. Picked in the
    // Progression tab; how many slots exist depends on the chosen race.
    schema.racialSkillRanks = new fields.ArrayField(
      new fields.StringField({ required: true, blank: true, initial: "" }),
      { required: true, initial: [] }
    );

    // --- Racial Attribute choices ---
    // Some races leave part of their Attribute increase up to the player ("either
    // Force or Magic"). One entry per choice the race offers, naming the Attribute
    // picked for it.
    schema.racialAttributeChoices = new fields.ArrayField(
      new fields.StringField({ required: true, blank: true, initial: "" }),
      { required: true, initial: [] }
    );

    // --- Capacity ---
    // The most Ki a character may spend in a single Combat Round. Only what has been
    // spent is stored; the ceiling itself is derived from Power Level.
    schema.capacity = new fields.SchemaField({
      spent: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 })
    });

    // --- Instant Maneuver tracking ---
    // An Instant Maneuver cannot follow another Instant within the same turn, so what
    // matters is only whether the last Maneuver was one. Kept editable: turns are not
    // tracked, so the table needs to be able to correct it.
    schema.lastManeuverWasInstant = new fields.BooleanField({ required: true, initial: false });

    // --- Diminishing Offense and Defense ---
    // Both are per-Combat-Round wear: attacking repeatedly blunts your Strike, and
    // being attacked repeatedly blunts your Dodge. Only the counts are stored; what
    // they cost is derived.
    schema.attacksThisRound = new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 });
    schema.diminishingDefense = new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 });

    // --- Steadfast Checks ---
    // One result per Threshold that can be failed: "" until checked, then "pass" or
    // "fail". Kept per Threshold rather than as a count, because recovering above one
    // clears its result and dropping back down calls for a fresh check.
    schema.thresholdChecks = new fields.SchemaField(
      Object.fromEntries(
        Object.entries(DBUCharacterData.THRESHOLDS)
          .filter(([, threshold]) => threshold.counts)
          .map(([key]) => [key, new fields.StringField({ required: true, blank: true, initial: "" })])
      )
    );

    // --- Triggered talent effects ---
    // `armedTalents` holds the ones set to fire on the next roll. Arming is a step of
    // its own because the client that rolls is not always the one that owns the
    // character - a defender resolves the attacker's Strike, and cannot be asked in
    // the middle of it whether the attacker wants to spend something.
    schema.armedTalents = new fields.ArrayField(
      new fields.StringField({ required: true, blank: false }),
      { required: true, initial: [] }
    );

    // One entry per use, so an effect allowed several times can be counted.
    schema.talentUses = new fields.SchemaField({
      round: new fields.ArrayField(new fields.StringField({ required: true, blank: false }), { initial: [] }),
      encounter: new fields.ArrayField(new fields.StringField({ required: true, blank: false }), { initial: [] })
    });

    // --- Willing failure ---
    // Not something a character sits armed with: it is chosen in the window that opens
    // for a roll and spent by that roll. It is stored only because the roll is often
    // made by a different client than the one that declared it, so the choice has to
    // travel on the Actor to get there.
    schema.willingFailure = new fields.BooleanField({ required: true, initial: false });

    // --- Action economy ---
    // Actions spent this Combat Round, by kind. Refilled when the round turns over.
    schema.actionsSpent = new fields.SchemaField({
      standard: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
      counter: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 })
    });

    // --- Combat Conditions ---
    // A Condition is not an Item and not owned: you have it or you do not. Stored as a
    // count so the four that stack need nothing of their own - one is simply 1.
    // Creating and destroying documents as Prone comes and goes would be far heavier.
    //
    // The initial value is a *function*, and that is not a style choice. Foundry hands
    // out a non-function `initial` by reference (DataField#getInitialValue), so a plain
    // `initial: {}` gives every character in the world the same object - and ObjectField
    // commits an update by mutating it in place (ObjectField#_updateCommit). One
    // character gaining Prone would give it to everyone who had never been written to.
    schema.conditions = new fields.ObjectField({ required: true, initial: () => ({}) });

    // --- States ---
    // The same shape, holding the level rather than a count: Raging at 2 is 2.
    schema.states = new fields.ObjectField({ required: true, initial: () => ({}) });

    // --- Resources ---
    // Stackable bonuses a Trait grants by name. Lost at the end of a Combat Encounter.
    schema.resources = new fields.ObjectField({ required: true, initial: () => ({}) });

    // --- Karma Points ---
    // Not a Resource, despite looking like one: Resources are lost when an Encounter
    // ends, and Karma is carried through a campaign. Moved by hand, since it is earned
    // by roleplay - which is not something the system can judge.
    schema.karma = new fields.NumberField({
      required: true, integer: true, initial: 2, min: 0, max: DBUCharacterData.KARMA_MAX
    });

    // --- Energy Charges ---
    // Charges live on the declared Attacking Maneuver, not on the character - they are
    // spent with it. But the declaration itself has to outlive the Maneuver that made
    // it, because the Energy Charge Maneuver is used, ends, and is used again before
    // the attack it is feeding is ever thrown. So the declaration is kept here and the
    // charges ride along with it until the attack collects them.
    schema.charging = new fields.SchemaField({
      /** The Attacking Maneuver that was declared, by its id. Empty when not charging. */
      maneuverId: new fields.StringField({ required: true, blank: true, initial: "" }),
      /**
       * The Profile it was declared with. Settled at the moment of declaring, and the
       * attack has to be made with it - that is what makes it a declaration rather than
       * a note to come back to.
       */
      profile: new fields.StringField({ required: true, blank: true, initial: "" }),
      charges: new fields.NumberField({
        required: true, integer: true, initial: 0, min: 0,
        max: DBUCharacterData.MAX_ENERGY_CHARGES
      })
    });

    // --- Racial Traits ---
    // The ids of the Traits taken from this character's race. Stored rather than
    // derived because a race offers more than a character ends up with, and which ones
    // were taken is a choice made at creation, not something the numbers imply.
    schema.racialTraits = new fields.ArrayField(
      new fields.StringField({ required: true, blank: false }),
      { required: true, initial: () => [] }
    );

    // Whether this character is a Minion, which a few rules ask about.
    schema.minion = new fields.BooleanField({ required: true, initial: false });

    // How many times this character has been brought back from Defeat this Encounter.
    // The rules allow one; kept here because it is a limit of the rule rather than of
    // any one effect.
    schema.defeatsEscaped = new fields.NumberField({
      required: true, integer: true, initial: 0, min: 0
    });

    // --- Maneuver uses ---
    // One entry per use of a Maneuver that is limited per Encounter, so a Maneuver
    // allowed more than once can be counted rather than merely flagged.
    schema.usedManeuvers = new fields.ArrayField(
      new fields.StringField({ required: true, blank: false }),
      { required: true, initial: [] }
    );

    // --- Debug switches ---
    // Effects whose own system does not exist yet, driven by hand so the rules that
    // depend on them can be exercised. Ki Multiplier belongs to a Form entered through
    // the Transformation Maneuver; until Forms exist, this stands in for one.
    schema.debug = new fields.SchemaField({
      kiMultiplier: new fields.BooleanField({ required: true, initial: false })
    });

    // --- Roll modifiers ---
    // Bonuses that attach to a roll rather than to the value behind it. Kept apart
    // from the Attribute-derived values because effects that halve one of those - Cross
    // Counter halving the Defense Value - must not halve these along with it.
    schema.rollModifiers = new fields.SchemaField({
      dodge: new fields.NumberField({ required: true, integer: true, initial: 0 })
    });

    // --- Dice modifiers ---
    // Effects that raise a die's Dice Category write here. Declared now so they have
    // somewhere to go; at 0 they change nothing.
    schema.diceModifiers = new fields.SchemaField({
      criticalCategory: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 })
    });

    // --- Capacity modifiers ---
    // Effects raise Capacity either by adding to it or by scaling it. Declared here
    // so they have somewhere to write once effects exist; the flat bonus starts at 0
    // and the multiplier at 1, so neither changes anything until something sets them.
    schema.capacityModifiers = new fields.SchemaField({
      flat: new fields.NumberField({ required: true, integer: true, initial: 0 }),
      multiplier: new fields.NumberField({ required: true, initial: 1, min: 0 })
    });

    // --- Action economy modifiers ---
    // Signed adjustments to the Actions available each Combat Round. Effects grant or
    // remove Actions; declared here so they have somewhere to write once they exist.
    schema.actionModifiers = new fields.SchemaField({
      standard: new fields.NumberField({ required: true, integer: true, initial: 0 }),
      counter: new fields.NumberField({ required: true, integer: true, initial: 0 })
    });

    // --- Tier of Power modifier ---
    // Signed adjustment to the Base Tier of Power. Transformations and effects raise
    // or lower it; Breakthrough caps how far up it can go (see prepareDerivedData).
    schema.tierOfPowerModifier = new fields.NumberField({ required: true, integer: true, initial: 0 });

    // --- Critical Target ---
    // The Base Die result needed to crit. Editable for now; effects that lower it will
    // write here once they exist.
    schema.criticalTarget = new fields.NumberField({
      required: true, integer: true, initial: DBUCharacterData.CRITICAL_TARGET_DEFAULT
    });

    // --- Specialisations for Encompassing Skills ---
    // Craft and Knowledge each cover a field too broad to roll against directly, so
    // the player writes what theirs is in.
    schema.skillSpecializations = new fields.SchemaField(
      Object.fromEntries(
        Object.entries(DBUCharacterData.SKILLS)
          .filter(([, skill]) => skill.encompassing)
          .map(([key]) => [key, new fields.StringField({ required: true, blank: true, initial: "" })])
      )
    );

    // --- Modifiers applied by sources outside the character ---
    // Signed: negative reduces, positive increases. Declared here so external effects
    // have somewhere to write once they exist; stays at 0 until then.
    schema.externalModifiers = new fields.SchemaField({
      soak: new fields.NumberField({ required: true, integer: true, initial: 0 })
    });

    // Technique Points are not stored either: they are the sum of every TP grant
    // from Level 1 up to the character's current Power Level.

    // --- Power Level (character progression track) ---
    schema.powerLevel = new fields.NumberField({ required: true, integer: true, initial: 1, min: 1 });

    // --- Biographical / descriptive fields ---
    // The id of a race defined under races/. Blank until one is chosen.
    schema.race = new fields.StringField({ required: true, blank: true, initial: "" });

    // Size Category. Chosen at Character Creation from the selectable ones; effects
    // can move a character to any of them.
    schema.size = new fields.StringField({
      required: true, blank: false, initial: DBUCharacterData.DEFAULT_SIZE
    });

    // The id of a subrace, for races that define any. Blank otherwise.
    schema.subrace = new fields.StringField({ required: true, blank: true, initial: "" });
    schema.biography = new fields.HTMLField({ required: true, blank: true, initial: "" });

    // --- Character Progression ---
    // One entry per "slot" from Level 1 to Level 30, mirroring the reference
    // character sheet's Main Progression table (Character Perk / Talent Addition /
    // Attribute Addition / Skill Improvement rows, each level's Attribute/TP grants).
    schema.progression = new fields.ArrayField(
      new fields.SchemaField({
        lvl: new fields.NumberField({ required: true, integer: true, initial: 1 }),
        stepType: new fields.StringField({ required: true, initial: "" }), // e.g. "Character Perk", "Talent Addition", "Attribute Addition", "Skill Improvement"
        choice: new fields.StringField({ required: true, blank: true, initial: "Character Perk" }), // player's actual pick, dropdown-limited
        locked: new fields.BooleanField({ required: true, initial: true }), // if true, Choice is fixed to stepType and can't be changed
        // The talent picked by a "Talent Addition" row. Plain string for now - this
        // becomes a real talent identifier once the talent list exists.
        talent: new fields.StringField({ required: true, blank: true, initial: "" }),
        attributes: new fields.SchemaField(
          Object.fromEntries(
            ["agility", "force", "tenacity", "scholarship", "insight", "magic", "personality"].map(key => [
              key,
              new fields.NumberField({ required: true, integer: true, initial: 0 })
            ])
          )
        ),
        technique: new fields.NumberField({ required: true, integer: true, initial: 0 }),
        // Four rank slots per row. Left as plain strings for now - these become real
        // skill identifiers once the skill list exists.
        skillRanks: new fields.ArrayField(
          new fields.StringField({ required: true, blank: true, initial: "" }),
          { required: true, initial: () => Array(DBUCharacterData.SKILL_RANK_SLOTS).fill("") }
        )
      }),
      { required: true, initial: [] }
    );

    return schema;
  }

  /**
   * Build the full Level 1-30 progression table. Every slot the published Power
   * Level table awards becomes one row; only "Character Perk" rows are a free
   * pick, every other grant is fixed to the option it was awarded as.
   */
  static buildDefaultProgression() {
    const zeroAtts = () => Object.fromEntries(
      ["agility", "force", "tenacity", "scholarship", "insight", "magic", "personality"].map(k => [k, 0])
    );

    const entries = [];
    for (let lvl = 1; lvl <= DBUCharacterData.MAX_POWER_LEVEL; lvl++) {
      for (const stepType of DBUCharacterData.grantsForLevel(lvl)) {
        entries.push({
          lvl,
          stepType,
          choice: stepType,
          locked: stepType !== "Character Perk",
          talent: "",
          attributes: zeroAtts(),
          technique: 0, // Recomputed in prepareDerivedData; never entered by hand.
          skillRanks: Array(DBUCharacterData.skillRankSlotsFor({
            choice: stepType, locked: stepType !== "Character Perk", lvl
          })).fill("")
        });
      }
    }
    return entries;
  }

  /**
   * Resolve the system's "+x(T)" notation: a value of x per Tier of Power. Written
   * throughout the rules for bonuses that scale as a character grows.
   *
   * The same notation appears on dice, where it multiplies how many are rolled rather
   * than what is added: "2d10(T)" is 2 x Tier of Power d10s, not 2d10 plus something.
   *
   * Only valid after prepareDerivedData has set the Tiers.
   */
  perTier(multiplier) {
    return multiplier * this.tierOfPower;
  }

  /**
   * Resolve the system's "+x(bT)" notation: a value of x per Base Tier of Power.
   * Unlike perTier, this ignores Transformations and effects, so a Breakthrough does
   * not inflate it.
   */
  perBaseTier(multiplier) {
    return multiplier * this.baseTierOfPower;
  }

  /**
   * Derived data: Aptitudes, Saving Throws, Speed, etc.
   * All computed from the Attribute Modifiers/Scores per the Attributes rules.
   */
  prepareDerivedData() {
    const atts = this.attributes;

    // The sheet clamps Power Level as it is edited, but a macro or module could still
    // write something out of range; keep everything derived from it sane regardless.
    this.powerLevel = Math.min(Math.max(this.powerLevel, 1), DBUCharacterData.MAX_POWER_LEVEL);

    // Racial Life Modifier, from whichever race is selected. An unknown or unset race
    // contributes nothing rather than breaking the Life calculation.
    this.racialLifeModifier = racialLifeModifier(this.race);

    // The Critical Target can be lowered by effects, but never past 7, and never
    // raised above its starting value of 10.
    this.criticalTarget = Math.min(
      DBUCharacterData.CRITICAL_TARGET_DEFAULT,
      Math.max(DBUCharacterData.CRITICAL_TARGET_MIN, this.criticalTarget)
    );

    // --- Attribute Scores, before anything else ---
    // A Score depends only on the progression table, the Power Level and the race - not
    // on the Tier of Power. That is what lets them come first, and it matters: an
    // effect's condition reads Scores while its amount reads Tiers, so without this the
    // two would need each other. Settling the Scores up front breaks that circle.
    for (const key of Object.keys(atts)) {
      atts[key].score = DBUCharacterData.attributeScore(
        this.progression, key, this.powerLevel,
        DBUCharacterData.racialIncreaseFor(this.race, this.racialAttributeChoices, key)
      );
    }

    // --- Effects ---
    // Everything effects contribute lands in a bag rebuilt from scratch on every pass,
    // never in the stored fields. Those stay as the GM's own manual overrides, and
    // keeping them apart means a stray update can never persist a transient bonus.
    this.effects = { slots: {}, active: [], errors: [], programs: [] };
    // Built after the bag exists: the report callback writes into it, and calling
    // programsFor inside the assignment would fire that callback before there was
    // anywhere for it to write.
    this.effects.programs = programsFor(this.parent ?? {}, {
      report: message => this.effects.errors.push(message)
    });

    // The earliest phase: conditions may read Scores, but amounts may only use (bT),
    // which follows from Power Level alone. (T) is not settled yet.
    runPhase(this, "tier");

    // Base Tier of Power follows from Power Level alone: 1 for Levels 1-4, then one
    // more per five Levels, reaching 7 at Level 30.
    this.baseTierOfPower = DBUCharacterData.tierOfPowerFor(this.powerLevel);

    // The current Tier of Power is the Base Tier as altered by Transformations and
    // effects. Breakthrough caps it at two Tiers above the Base; it can be lowered
    // freely, but never below 1.
    this.tierOfPower = Math.min(
      this.baseTierOfPower + DBUCharacterData.BREAKTHROUGH_LIMIT,
      Math.max(1, this.baseTierOfPower + this.tierOfPowerModifier + slot(this, "tierOfPower"))
    );

    // --- Size ---
    // Its modifiers are written in (T), so they grow with the Tier of Power. `steps`
    // is how far from Medium the character is, which is what the Skill adjustments and
    // every relative-size rule are counted in.
    const size = DBUCharacterData.SIZES[this.size] ?? DBUCharacterData.SIZES[DBUCharacterData.DEFAULT_SIZE];
    const sizeKeys = Object.keys(DBUCharacterData.SIZES);

    this.size = {
      key: this.size,
      label: size.label,
      meleeRange: size.meleeRange,
      squares: size.squares,
      steps: sizeKeys.indexOf(this.size) - sizeKeys.indexOf(DBUCharacterData.DEFAULT_SIZE),
      defenseModifier: size.defensePerTier * this.tierOfPower,
      soakModifier: size.soakPerTier * this.tierOfPower,
      speedModifier: size.speed
    };

    // TP is never entered by hand - each row's grant is derived from its option.
    for (const entry of this.progression) {
      entry.technique = DBUCharacterData.techniquePointsFor(entry);
    }

    // Total TP available: every grant from Level 1 up to the current Power Level.
    // Rows for Levels the character has not reached yet do not count.
    this.techniquePoints = this.progression
      .filter(entry => entry.lvl <= this.powerLevel)
      .reduce((total, entry) => total + entry.technique, 0);

    // Attribute Score cap for the current Tier of Power: 8 at ToP 1, +3 per tier after.
    // The published table only lists ToP 1-5 (8/11/14/17/20); the formula holds beyond
    // that, so ToP 6 and 7 are 23 and 26. Informational only - nothing enforces it yet,
    // except where a Talent is explicitly bounded by it.
    this.attributeScoreCap = withEffects(this, "attributeScoreCap", 8 + (this.tierOfPower - 1) * 3);

    // The bulk of the pass. Everything an amount could read is settled by now, so this
    // is where most effects land.
    runPhase(this, "core");

    for (const key of Object.keys(atts)) {
      // Modifier defaults to the Score, adjusted by any Bonus from effects/Transformations.
      atts[key].mod = withEffects(this, `${key}.mod`, atts[key].score + atts[key].bonus);
    }

    // --- Skills ---
    // A Rank is one filled slot on an earned Skill Improvement row. Rows set to any
    // other option keep their slots hidden, so they must not be counted.
    // Racial Ranks are granted at Power Level 1, so they always count.
    const rankSlots = [
      ...this.racialSkillRanks,
      ...this.progression
        .filter(entry => (entry.lvl <= this.powerLevel) && (entry.choice === "Skill Improvement"))
        .flatMap(entry => entry.skillRanks)
    ];

    const rankCap = DBUCharacterData.skillRankCap(this.tierOfPower);

    this.skills = Object.fromEntries(Object.entries(DBUCharacterData.SKILLS).map(([key, skill]) => {
      const ranks = rankSlots.filter(slot => slot === key).length;
      // One step per Size Category away from Medium, in whichever direction the Skill
      // is affected.
      const sizeAdjustment = (DBUCharacterData.SIZE_SKILL_ADJUSTMENTS[key] ?? 0) * this.size.steps;

      return [key, {
        ...skill,
        key,
        ranks,
        sizeAdjustment,
        // Skill Bonus is the governing Attribute's Score plus 2 per Rank.
        bonus: Math.max(0,
          atts[skill.attribute].score + (DBUCharacterData.SKILL_RANK_BONUS * ranks) + sizeAdjustment),
        specialization: skill.encompassing ? this.skillSpecializations[key] : "",
        // A Required Skill with no Ranks cannot be rolled at all - it always fails.
        untrained: Boolean(skill.required) && (ranks === 0),
        overCap: ranks > rankCap
      }];
    }));

    this.skillRankCap = rankCap;

    this.life.max = DBUCharacterData.maxLife({
      powerLevel: this.powerLevel,
      tenacityScore: atts.tenacity.score,
      racialLifeModifier: this.racialLifeModifier,
      lifePerLevelBonus: this.transformationBonuses.lifePerLevel + slot(this, "life.perLevel")
    });
    this.life.max = Math.max(1, withEffects(this, "life.max", this.life.max));

    this.ki.max = DBUCharacterData.maxKi({
      powerLevel: this.powerLevel,
      kiPerLevelBonus: this.transformationBonuses.kiPerLevel + slot(this, "ki.perLevel")
    });
    this.ki.max = Math.max(0, withEffects(this, "ki.max", this.ki.max));

    // Doubled on the finished pool, for the same reason.
    if (this.debug.kiMultiplier) this.ki.max *= DBUCharacterData.KI_MULTIPLIER_KI;

    // Capacity: the ceiling on Ki spent within one Combat Round. Flat bonuses land
    // before the multiplier, so a doubling effect doubles them too.
    const baseCapacity = DBUCharacterData.BASE_CAPACITY
      + (DBUCharacterData.CAPACITY_PER_LEVEL * (this.powerLevel - 1))
      + this.capacityModifiers.flat + slot(this, "capacity.flat");

    // The Ki Multiplier lands on the finished Capacity, after everything that builds
    // it up - it increases the maximum, not any one part of it.
    const capacityMultiplier = this.capacityModifiers.multiplier
      * (this.effects.slots["capacity.multiplier"]?.multiply ?? 1)
      * (this.debug.kiMultiplier ? DBUCharacterData.KI_MULTIPLIER_CAPACITY : 1);

    this.capacity.max = Math.max(0, Math.floor(baseCapacity * capacityMultiplier));
    this.capacity.remaining = Math.max(0, this.capacity.max - this.capacity.spent);

    // Actions available each Combat Round. An effect can take Actions away, but never
    // past zero.
    this.actions = {
      standard: Math.max(0, withEffects(this, "actions.standard",
        DBUCharacterData.BASE_STANDARD_ACTIONS + this.actionModifiers.standard)),
      counter: Math.max(0, withEffects(this, "actions.counter",
        DBUCharacterData.BASE_COUNTER_ACTIONS + this.actionModifiers.counter))
    };

    // Haste: 1/2 Agility Modifier, added to Strike Rolls.
    this.haste = withEffects(this, "haste", Math.floor(atts.agility.mod / 2));

    // Defense Value: equal to Agility Modifier, then adjusted for Size.
    this.defenseValue = withEffects(this, "defenseValue",
      DBUCharacterData.applySizeModifier(atts.agility.mod, this.size.defenseModifier));

    // Speed: Normal = 2 + (1/2 Agility Mod); Boosted = Agility Mod + 2.
    this.speed = {
      normal: withEffects(this, "speed.normal",
        2 + Math.floor(atts.agility.mod / 2) + this.size.speedModifier),
      boosted: withEffects(this, "speed.boosted",
        atts.agility.mod + 2 + this.size.speedModifier)
    };

    // Initiative bonus: 1/2 Agility Score.
    this.initiativeBonus = withEffects(this, "initiative", Math.floor(atts.agility.score / 2));

    // Soak Value: the Tenacity Modifier, except that the Soak a character provides
    // for themselves never falls below their Tier of Power. External effects can
    // reduce the result further, down to a floor of 0 - nothing writes such a penalty
    // yet, so in practice only the Tier of Power minimum applies today.
    const ownSoak = DBUCharacterData.applySizeModifier(
      Math.max(atts.tenacity.mod, this.tierOfPower),
      this.size.soakModifier
    );
    this.soakValue = Math.max(0, withEffects(this, "soakValue.external",
      withEffects(this, "soakValue", ownSoak) + this.externalModifiers.soak));

    // Damage Reduction: taken off a Wound Roll the way Soak is, and that is where the
    // resemblance stops. The Damage Category does not reduce or ignore it, and nothing
    // that multiplies Soak reaches it either - so a point of this is worth more than a
    // point of Soak, and nothing grants it by default.
    this.damageReduction = Math.max(0, withEffects(this, "damageReduction", 0));

    // Surgency: increases the Life/Ki Points regained through a Surge.
    this.surgency = withEffects(this, "surgency", atts.force.mod);

    // Awareness: Insight Modifier, added to Strike Rolls.
    this.awareness = withEffects(this, "awareness", atts.insight.mod);

    // --- Dice ---
    // Extra Dice ride alongside the Base Die and grow with the Tier of Power. The
    // ceiling on raising them uses the BASE Tier, so a Breakthrough does not widen
    // how far an effect may push them.
    const extraCategory = tierExtraDiceCategory(this.tierOfPower);
    const greaterCategory = greaterDiceCategory(this.tierOfPower);

    // Critical Extra Dice: a d4 at Tier 1, one Category higher per Tier above that.
    // An effect can push them further, but no further than the shared ceiling.
    const increaseLimit = maxCategoryIncrease(this.baseTierOfPower);
    const criticalCategory = greaterDiceCategory(this.tierOfPower)
      + Math.min(this.diceModifiers.criticalCategory, increaseLimit);

    this.dice = {
      extra: { category: extraCategory, formula: categoryFormula(extraCategory) },
      greater: { category: greaterCategory, formula: categoryFormula(greaterCategory) },
      critical: { category: criticalCategory, formula: categoryFormula(criticalCategory) },
      maxCategoryIncrease: increaseLimit
    };

    // --- Critical and Botch ---
    // Both read the Base Die's Natural Result and nothing else, so they are two ends of
    // the same line: a Critical is a Natural at or above the Critical Target, a Botch is
    // one at or below the Botch Range.
    this.criticalTarget = Math.min(
      DBUCharacterData.CRITICAL_TARGET_DEFAULT,
      Math.max(DBUCharacterData.CRITICAL_TARGET_MIN,
        withEffects(this, "criticalTarget", this.criticalTarget))
    );

    // Kept below the Critical Target: with both derived, the two could otherwise be
    // made to overlap and a single Natural Result would be both at once.
    this.botchRange = Math.max(0, Math.min(this.criticalTarget - 1,
      withEffects(this, "botchRange", DBUCharacterData.BOTCH_RANGE_DEFAULT)));

    // What a Botch costs depends on the kind of roll: a Skill roll loses 2 flat, every
    // other roll loses 2(bT). It was one flat constant everywhere, which is right only
    // while the Base Tier is 1 - so from Power Level 5 a botched Combat Roll was costing
    // half what it should.
    this.botch = {
      range: this.botchRange,
      skill: DBUCharacterData.BOTCH_PENALTY,
      penalty: withEffects(this, "botch.penalty",
        DBUCharacterData.BOTCH_PENALTY * this.baseTierOfPower)
    };

    // --- Diminishing Offense and Defense ---
    // Offense only begins once the round's free attacks are used up, and each stack
    // costs 1(bT) - so it bites harder the stronger you are. Defense is a flat 1 per
    // stack, but you gain more of them per attack as your Base Tier rises.
    const freeAttacks = withEffects(this, "attacks.free", DBUCharacterData.FREE_ATTACKS_PER_ROUND);
    const offenseStacks = Math.max(0, this.attacksThisRound - freeAttacks);

    this.diminishing = {
      offense: {
        stacks: offenseStacks,
        penalty: offenseStacks * withEffects(this, "diminishing.offense.perStack",
          this.baseTierOfPower)
      },
      defense: {
        stacks: this.diminishingDefense,
        perAttack: withEffects(this, "diminishing.defense.perAttack",
          DBUCharacterData.diminishingDefensePerAttack(this.tierOfPower)),
        penalty: this.diminishingDefense
      }
    };

    // --- Health Thresholds ---
    // Where the character sits is read from Life, so it follows damage and healing on
    // its own. What it costs comes from the Steadfast Checks failed at or below that
    // point; results recorded above it are ignored, since rising back up clears them.
    const keys = Object.keys(DBUCharacterData.THRESHOLDS);
    const current = DBUCharacterData.thresholdKey(this.life.value, this.life.max);
    const currentIndex = keys.indexOf(current);

    const reached = keys
      .filter((key, index) => (index <= currentIndex) && DBUCharacterData.THRESHOLDS[key].counts);

    const failures = reached.filter(key => this.thresholdChecks[key] === "fail").length;

    this.threshold = {
      key: current,
      label: DBUCharacterData.THRESHOLDS[current].label,
      // How many Thresholds below Healthy the character is.
      depth: reached.length,
      failures,
      // Each failure costs 1(bT) on every Combat Roll.
      penalty: failures * this.baseTierOfPower,
      // Thresholds reached but not yet checked. Crossing several at once auto-fails
      // all but the lowest, which is the only one still rolled for.
      pending: reached.filter(key => !this.thresholdChecks[key])
    };

    // The last phase. It waits for the Thresholds, because Stress Bonus counts their
    // failures and an effect can change what one costs.
    runPhase(this, "late");

    this.threshold.penalty = Math.max(0,
      withEffects(this, "threshold.penalty", this.threshold.penalty));

    // Stress Bonus is what a Transformation's Stress Test is measured against; each
    // Steadfast failure takes 1 off it.
    this.stressBonus = withEffects(this, "stressBonus", (this.powerLevel + 1) - failures);

    // Might: higher of Force / Magic Modifier. Computed here rather than earlier because
    // an effect can raise it and the Wound Roll below reads the result.
    this.might = withEffects(this, "might", Math.max(atts.force.mod, atts.magic.mod));

    // Life Points are the stated exception: Undying lets damage take them below zero,
    // and they are settled against that rather than against the general floor.
    if (!this.effects.slots["life.allowNegative"]) {
      this.life.value = Math.max(0, this.life.value);
    }

    // Defeated is derived, not recorded: at zero you are Defeated, and being healed
    // above zero lifts it by itself without anything having to remember to. Undying
    // forbids it outright, which is what lets negative Life not end the fight.
    this.defeated = (this.life.value <= 0) && permits(this.effects.slots, "defeat");

    // --- Combat Rolls ---
    // Only used in combat. Wound depends on the attack's Foundation, since that is
    // what decides which Attribute is the Damage Attribute.
    // Every Combat Roll picks up what was written to `combatRolls`, which is why that
    // Slot fans out to these three: an effect saying "+1(T) to your Combat Rolls" has to
    // show in the Strike on the sheet, not wait to be remembered at the table.
    this.combat = {
      strike: withEffects(this, "strike", this.haste + this.awareness),
      // The whole Dodge Roll. Its Defense Value component stays reachable on its own,
      // since that is the part an effect can halve.
      dodge: withEffects(this, "dodge", this.defenseValue + this.rollModifiers.dodge),
      // A Parry rolls the Strike value, so it takes Strike's effects and adds its own -
      // which exist for effects that only apply when Strike is rolled defensively.
      parry: withEffects(this, "parry", withEffects(this, "strike", this.haste + this.awareness)),
      wound: Object.fromEntries(
        Object.entries(DBUCharacterData.FOUNDATIONS)
          .map(([key, foundation]) =>
            [key, withEffects(this, "wound", atts[foundation.attribute].mod + this.might)])
      )
    };


    // Saving Throws: tied to Attribute Score (not Modifier) per the rules. The race's
    // focused Saving Throw gains +1(bT) - which does not grow with a Breakthrough,
    // unlike a (T) bonus - and crits one point more easily.
    const racialSaves = racialSavingThrows(this.race);
    const saveAttributes = {
      impulsive: "agility",
      corporeal: "tenacity",
      cognitive: "insight",
      morale: "personality"
    };

    this.savingThrows = Object.fromEntries(Object.entries(saveAttributes).map(([save, attribute]) => {
      const racial = racialSaves.includes(save);
      return [save, {
        label: save.charAt(0).toUpperCase() + save.slice(1),
        racial,
        value: Math.max(0, atts[attribute].score + (racial ? this.perBaseTier(1) : 0)),
        criticalTarget: racial
          ? Math.max(DBUCharacterData.CRITICAL_TARGET_MIN, this.criticalTarget - 1)
          : this.criticalTarget
      }];
    }));

  }
}
