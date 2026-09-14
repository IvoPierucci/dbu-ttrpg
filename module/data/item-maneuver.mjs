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
      /**
       * A Ki Point Cost written "2(T)", which grows with the Tier of Power rather than
       * with the Base Tier.
       *
       * The Profiles have had one since they were built; no Maneuver had, because until
       * the Blockade Maneuver none was priced that way.
       */
      kiCostPerTier: new fields.NumberField({ required: true, integer: true, initial: 0 }),

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
       * Grabs the character it is aimed at: a Clash of Strike against their Strike or
       * Dodge, and the winner decides whether the two of them end up in a Grapple.
       *
       * A flag rather than the Maneuver's id, because several of the Grapple's own rules
       * talk about "the Grapple Maneuver" being used by somebody else - a third
       * character grappling into an existing Grapple - and those have to recognise it
       * however it was reached.
       */
      grapple: new fields.BooleanField({ required: true, initial: false }),
      /**
       * Throws the Character this one is already holding: a Grapple Check against their
       * own Grappled, with no target to pick, since being the Grappler names exactly one
       * Character and the Grapple already knows which.
       */
      launch: new fields.BooleanField({ required: true, initial: false }),
      /**
       * Crosses the battlefield, and asks how: Normal Speed for nothing or Boosted Speed
       * for 3(T), with Rapid Movement another 2(T) on top. The first Maneuver whose own
       * Ki Point Cost is a choice rather than a number.
       */
      movement: new fields.BooleanField({ required: true, initial: false }),
      /**
       * Holds the Character this one is Grappling down: a Grapple Check at a penalty and
       * then a Might Clash, with no target to pick - being the Grappler names exactly one
       * Character, as it does for the Launch Maneuver.
       */
      pin: new fields.BooleanField({ required: true, initial: false }),
      /**
       * Gains a stack of Power, and offers to drop one first. The offer is the whole of
       * what needs asking: everything else this Maneuver does is in its own script.
       */
      powerUp: new fields.BooleanField({ required: true, initial: false }),
      /**
       * Throws one of the character's own Signature Techniques: asks which, spends this
       * Maneuver's Action and the Technique's Ki, and is the Technique from there on.
       *
       * The flag is on the door, not on what is behind it. "[1/Round]" is a limit across
       * every Technique a character has, and it can only be that if the use is counted
       * against the Maneuver they all go through.
       */
      signatureTechnique: new fields.BooleanField({ required: true, initial: false }),
      /**
       * Shoves the Character it is aimed at: a Clash of Strike against their Strike or
       * Dodge, and winning offers a choice of two effects on the card.
       *
       * A flag rather than the Maneuver's id, like every other one here - what it marks
       * is a shape the code knows how to run, and a homebrew Maneuver written to that
       * shape should run the same way.
       */
      thrust: new fields.BooleanField({ required: true, initial: false }),
      /**
       * Steps into somebody's path: played from a Movement Maneuver's card, and a Clash
       * of Impulsive against the Character who moved.
       *
       * The first Counter Maneuver that answers something other than an attack aimed at
       * you - Energy Cancel spends its Counter Action beside an attack rather than on
       * anything, and every other one meets one.
       */
      blockade: new fields.BooleanField({ required: true, initial: false }),
      /**
       * Digs in when somebody else's effect is moving you: played from the card that is
       * doing the moving, by the Character being moved.
       *
       * Every effect in these rules that moves somebody opens a Clash carrying a
       * collision and the Character moved is its Defender, so that is one shape rather
       * than a list of Maneuvers to keep up with.
       */
      suddenStop: new fields.BooleanField({ required: true, initial: false }),
      /**
       * Throws an avoided Energy or Magic attack back: you roll the Strike with their
       * Profile and they roll the Wound Roll for it.
       *
       * Offered rather than used - an Out-of-Sequence Maneuver is a chance something
       * handed you - so what this marks is a shape the offer machinery knows how to
       * carry, the way `exploit` marks the Maneuver that gives away a Basic Attack.
       */
      reflect: new fields.BooleanField({ required: true, initial: false }),
      /**
       * What a Modifier Maneuver may be applied to: its Base Maneuver.
       *
       * "A Maneuver (or type of Maneuver)", which is both shapes and sometimes several -
       * an id from the library, one of the four kinds, or `attacking` for every Attacking
       * Maneuver. Empty on every Maneuver that is not a Modifier, and a Modifier with an
       * empty one attaches to nothing rather than to everything.
       */
      baseManeuver: new fields.ArrayField(
        new fields.StringField({ required: true, blank: false }), { required: true, initial: [] }
      ),
      /**
       * What a Modifier Maneuver will not apply to, on top of what it applies to.
       *
       * Called Shot's Base Maneuver is "any Attacking Maneuver" and its Effect narrows
       * that to "one that does not have an Area of Effect" - two separate sentences, so
       * two separate fields. `area` is the only thing anything forbids so far.
       */
      baseForbids: new fields.ArrayField(
        new fields.StringField({ required: true, blank: false }), { required: true, initial: [] }
      ),
      /**
       * Steps this Modifier puts on the Damage Category of the attack it was applied to.
       * "Increase the Damage Category of that Attacking Maneuver by 1."
       */
      damageCategoryShift: new fields.NumberField({ required: true, integer: true, initial: 0 }),
      /**
       * What it does to the Strike Roll of that attack, per Tier of Power. Negative takes
       * it off: "decrease the Strike Roll for that Attacking Maneuver by 2(T)" is -2.
       */
      strikePerTier: new fields.NumberField({ required: true, integer: true, initial: 0 }),
      /**
       * A question this Modifier asks as it is applied, in the rulebook's own words -
       * "state the area you targeted with this Attacking Maneuver". The answer is written
       * on the attack's card, because the answer is for the table to read rather than for
       * the system to act on.
       */
      asks: new fields.StringField({ required: true, blank: true, initial: "" }),
      /**
       * Holds the Base Maneuver back instead of letting it happen.
       *
       * The one thing a Modifier does that is a shape rather than a number, which is why
       * it is a flag where the rest are fields: the Action Cost and the Ki are paid, the
       * Maneuver is put on the character with a trigger written beside it, and it is
       * handed back later as an Out-of-Sequence Maneuver that costs nothing.
       */
      delays: new fields.BooleanField({ required: true, initial: false }),
      /**
       * The Signature Technique features this Maneuver was built with, by id.
       *
       * Both sides of the ledger, despite the name: All or Nothing is a Disadvantage and
       * is read out of this list like every other feature. What side a feature is on is
       * its own file's business - `featureSummary(id).side` - and no reader here has ever
       * needed to ask.
       *
       * Read since Charging Assault was built and written by nothing until now, so a
       * Technique could only ever carry the features its Profile handed it.
       */
      advantages: new fields.ArrayField(
        new fields.StringField({ required: true, blank: false }), { required: true, initial: [] }
      ),

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
