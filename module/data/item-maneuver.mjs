const { fields } = foundry.data;

/**
 * A Maneuver, as an Item a character owns.
 *
 * Almost all of it is description rather than effect: the type, what it costs, whether
 * it attacks, whether it needs a target. That is why the header of a Maneuver's file
 * carries the weight and its script is usually empty - a Basic Attack has no script at
 * all, because its behaviour *is* the attack engine.
 *
 * They are Items rather than a shared table for two reasons that have nothing to do
 * with the hotbar. Each Unique Ability is a Maneuver, and so is each Signature
 * Technique; both are bought per character with Technique Points, so a global list
 * cannot hold them. And a rule that forbids "any Maneuver tagged uniqueAbility" then
 * reads a tag off the document instead of needing somewhere new to keep that mark.
 */
export default class DBUManeuverData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {
      /**
       * The definition this Maneuver came from.
       *
       * Kept because several rules name a Maneuver rather than owning one - Cross
       * Counter offers "basic-attack" - and because every character carries their own
       * copy of the Core Maneuvers, so the Item's own id differs from person to person.
       */
      maneuverId: new fields.StringField({ required: true, blank: true, initial: "" }),

      /** Which of the four kinds it is: standard, counter, instant, out-of-sequence. */
      type: new fields.StringField({ required: true, blank: false, initial: "standard" }),

      description: new fields.HTMLField({ required: true, blank: true, initial: "" }),
      source: new fields.StringField({ required: true, blank: true, initial: "" }),

      /** What it costs to use. */
      actionCost: new fields.NumberField({ required: true, integer: true, initial: 1, min: 0 }),
      /**
       * The most Actions this Maneuver may be given, when it takes a range of them -
       * "Action Cost: Variable (2~3 Actions)". Zero means it costs what it costs.
       *
       * The player is asked which, and what they answer is readable in the Maneuver's
       * own script as `actionsSpent`, since a Maneuver priced in a range is always one
       * that does more for more.
       */
      actionCostMax: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
      /**
       * Whether the range has no ceiling of its own - "Action Cost: Variable", with no
       * number after it. What you have left is the ceiling then, which is a different
       * thing from a Maneuver that names one and happens to be unaffordable today.
       */
      actionCostOpen: new fields.BooleanField({ required: true, initial: false }),
      kiCost: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
      kiCostPerBaseTier: new fields.NumberField({ required: true, integer: true, initial: 0 }),

      /** How it behaves in an exchange. */
      attacking: new fields.BooleanField({ required: true, initial: false }),
      /**
       * An Absolute Attack: one that still rolls its Wound Roll when it fails to hit,
       * and measures half that roll against the target's Soak Value and Damage
       * Reduction. Only meaningful on an Attacking Maneuver.
       */
      absolute: new fields.BooleanField({ required: true, initial: false }),
      requiresTarget: new fields.BooleanField({ required: true, initial: false }),
      defend: new fields.BooleanField({ required: true, initial: false }),
      /** Steps in for somebody else. Played from an attack aimed at an Ally. */
      intervene: new fields.BooleanField({ required: true, initial: false }),
      /** Punishes an opening: taking it hands over an Out-of-Sequence Basic Attack. */
      exploit: new fields.BooleanField({ required: true, initial: false }),
      /** Hands Ki Points to the character it is aimed at. */
      empower: new fields.BooleanField({ required: true, initial: false }),

      /**
       * Who this Maneuver gives an opening to, in the rulebook's own words - "All
       * adjacent Opponents". Blank when it gives none.
       *
       * The range is carried as it is written rather than measured. Whether somebody is
       * in it is the table's to say, as every other question about where people stand
       * is here, and the wording differs from Maneuver to Maneuver.
       */
      exploitable: new fields.StringField({ required: true, blank: true, initial: "" }),
      surge: new fields.BooleanField({ required: true, initial: false }),
      /** Feeds an Energy Charge into an Attacking Maneuver declared through it. */
      charge: new fields.BooleanField({ required: true, initial: false }),
      /** Throws away a charge being held, and the hold that came with it. */
      cancelCharge: new fields.BooleanField({ required: true, initial: false }),

      /** "any" lets the user pick one when the Maneuver is declared. */
      profile: new fields.StringField({ required: true, blank: true, initial: "" }),

      /** For a Maneuver that is a Skill Clash: which Skill both sides roll. */
      clashSkill: new fields.StringField({ required: true, blank: true, initial: "" }),

      /**
       * Labels other rules match on. Transfigured forbids everything tagged
       * `uniqueAbility` rather than naming each one, so the tag is where that lives.
       */
      tags: new fields.ArrayField(
        new fields.StringField({ required: true, blank: false }), { required: true, initial: [] }
      ),

      /** How often it may be used, as "1/round" or "2/encounter". Blank means freely. */
      usageLimit: new fields.StringField({ required: true, blank: true, initial: "" }),

      /** Effects of its own, in the same language every other Trait uses. */
      script: new fields.StringField({ required: true, blank: true, initial: "" }),
      text: new fields.StringField({ required: true, blank: true, initial: "" })
    };
  }

  /** The usage limit, split into the shape the rest of the system reads. */
  get limit() {
    const match = String(this.usageLimit).match(/^(\d+)\s*\/\s*(round|encounter)$/i);
    if (!match) return null;
    return { amount: Number(match[1]), per: match[2].toLowerCase() };
  }
}
