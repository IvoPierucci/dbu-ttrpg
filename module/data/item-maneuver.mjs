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
       * Swallows an avoided Energy or Magic attack instead of throwing it back: the one
       * who threw it rolls its Wound Roll as if it had hit, and half that Dice Score
       * comes back to you as Ki.
       *
       * Offered rather than used, like `reflect`, and offered from the same moment - a
       * Parry that turned an attack aside. The two are alternatives, which the offer
       * machinery settles on its own: one Out-of-Sequence Maneuver per character per
       * card is exactly what "you cannot use the Reflect Maneuver in response to the
       * successful Parry" asks for.
       */
      absorb: new fields.BooleanField({ required: true, initial: false }),
      /**
       * The Skills the *defender* of a Skill Clash may answer with, where the rule names
       * something other than the challenger's.
       *
       * "A Clash (Bluff vs Intuition)" names one and "(Bluff vs Intuition/Perception)"
       * names two - and that slash is the same slash as in "Strike/Dodge", which is a
       * choice made by whoever is rolling. So this is a list, and more than one in it is
       * a question asked of the defender before either side sees a number.
       *
       * Empty means what every Skill Clash written before this meant: one Skill named, and
       * both sides roll it.
       */
      clashDefenderSkills: new fields.ArrayField(
        new fields.StringField({ required: true, blank: false }), { required: true, initial: [] }
      ),
      /**
       * Wins a Skill Clash and then offers one of three Combat Conditions to hang on the
       * loser.
       *
       * A flag rather than three fields, because the three differ in more than their
       * Condition: two are timed by the trickster's turn and one by the target's, one ends
       * early on being hit, and one carries a rider and a limit of its own.
       */
      dirtyTrick: new fields.BooleanField({ required: true, initial: false }),
      /**
       * Wins a Skill Clash and hands over a Basic Attack with conditions attached.
       *
       * The Exploit Maneuver's shape - "you may use the Basic Attack Maneuver as an
       * Out-of-Sequence Maneuver" - with four things travelling on the offer: a bonus to
       * the Strike and the Wound, a defence narrowed to Cross Counter, no Area of Effect,
       * and a ceiling on the Ki Wager.
       */
      feint: new fields.BooleanField({ required: true, initial: false }),
      /**
       * A Skill whose Ranks say how far this Maneuver moves you, and how many Squares each
       * Rank is worth.
       *
       * "Move a number of Squares up to twice your number of Skill Ranks in Acrobatics."
       * Written as the Skill and the multiplier rather than as code, because it is a rule
       * and rules live in the files. Nothing here moves a token - the number is said on the
       * card and the player moves themselves - so this is the whole of what is built.
       */
      /**
       * Asks how many stacks of its own Resource to hold, and writes that as the total.
       *
       * "Gain any number... you can instead choose to remove any number of them or gain
       * more up to your maximum." Both halves of that are one question with one answer -
       * a new total - which is why this is a flag and not two.
       */
      holdingBack: new fields.BooleanField({ required: true, initial: false }),
      /**
       * The Saving Throws a Clash this Maneuver opens is made of.
       *
       * "Make a Morale Clash against them" - one named, so neither side is asked anything.
       * More than one is the slash in "(Impulsive/Corporeal)", which is a choice made by
       * whoever is rolling. Empty on every Maneuver that opens no Clash of Saving Throws,
       * and on the ones that reach that shape from a card instead of from the sheet.
       */
      clashSaves: new fields.ArrayField(
        new fields.StringField({ required: true, blank: false }), { required: true, initial: [] }
      ),
      /**
       * Wins a Morale Clash and leaves two Combat Conditions on the loser.
       *
       * A flag rather than fields, because the two differ in the thing that matters: one is
       * timed by the insulter's turn and against them by name, and the other is stated flat
       * and stays until something takes it off.
       */
      insult: new fields.BooleanField({ required: true, initial: false }),
      /**
       * The Saving Throws the *defender* of a Clash may answer with, where the rule names
       * something other than the challenger's.
       *
       * "(Impulsive vs Impulsive/Corporeal)" is one for them and two for the other side,
       * where "(Impulsive/Corporeal)" with no `vs` in it is one list offered to both.
       */
      clashDefenderSaves: new fields.ArrayField(
        new fields.StringField({ required: true, blank: false }), { required: true, initial: [] }
      ),
      /**
       * Wins a Clash and puts the winner inside the loser until they choose to come out.
       *
       * A state on two characters at once - one is inside, one has somebody in them - and
       * an Instant that only exists while it holds. A flag, because none of that is a
       * number any other Maneuver would want.
       */
      internalAttack: new fields.BooleanField({ required: true, initial: false }),
      /**
       * A State this Maneuver throws like a switch: into it, or out of it if you are
       * already there.
       *
       * "You enter the Liquid Special State. If you use this Maneuver while in the Liquid
       * Special State, you exit." One Maneuver with two outcomes, and which one is read
       * when it is used - a script cannot ask, because it would be asking about a change
       * that has not landed yet.
       */
      togglesState: new fields.StringField({ required: true, blank: true, initial: "" }),
      /**
       * The Trait whose own effect this Maneuver is, and which of that Trait's numbered
       * effects it is.
       *
       * Some effects hand you a Maneuver rather than doing something themselves: the
       * Liquid Special State's sixth is "as a Standard Action with an Action Cost of 1
       * Action, you may use a Healing Surge". That is a Maneuver in every way the system
       * cares about, so it is one - a real Item on the character, editable and renameable
       * like any other, which is what makes a player's changes to it stick.
       *
       * What `fromTrait` buys is the listing: the row only appears while that Trait is
       * actually on them. So the Maneuver is always theirs and only sometimes offered,
       * rather than appearing from nowhere and taking their edits with it when it goes.
       */
      fromTrait: new fields.StringField({ required: true, blank: true, initial: "" }),
      fromEffect: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
      /**
       * Which Surge this Maneuver takes, where the rule names one.
       *
       * The Surge Maneuver offers both and asks; an effect that names one is not offering
       * a choice - "you may use a Healing Surge" is one Surge, and asking which would be
       * wrong. Blank means ask, which is what the Surge Maneuver does.
       */
      surgeKind: new fields.StringField({ required: true, blank: true, initial: "" }),
      /**
       * Three effects to pick between, chosen before anything is paid for.
       *
       * "Apply one of the following effects", where two of the three open a Clash and the
       * third does not - so the choice cannot wait for the dice the way the Thrust's and
       * the Dirty Trick's do. Theirs is a choice about what winning buys; this one decides
       * whether there is anything to win.
       */
      magicTrick: new fields.BooleanField({ required: true, initial: false }),
      /**
       * An Exploitable line that fires on a lost Clash rather than when the Maneuver is
       * used, and to the one person it was aimed at rather than to everybody in reach.
       *
       * The line itself is carried as printed, for a reader; this is what keeps it out of
       * the door that hands the ordinary ones out.
       */
      exploitOnLoss: new fields.BooleanField({ required: true, initial: false }),
      moveSkill: new fields.StringField({ required: true, blank: true, initial: "" }),
      movePerRank: new fields.NumberField({ required: true, integer: true, initial: 0 }),
      /**
       * What this Maneuver tells the table, in the entry's own words.
       *
       * The companion to `asks`: that one is a question a Modifier puts to the player, and
       * this is a statement the card puts to everybody. For the parts of a rule that are
       * about where a token is or what somebody may do next - things this system does not
       * track on purpose - being said clearly on the card is the whole of what it can do.
       */
      says: new fields.StringField({ required: true, blank: true, initial: "" }),
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
       * And what it does to the Wound Roll, per Tier of Power. Feint raises both -
       * "increase the Strike and Wound Rolls for this Attacking Maneuver by 1(T)" - and
       * before it nothing applied to an attack had ever touched the second.
       */
      woundPerTier: new fields.NumberField({ required: true, integer: true, initial: 0 }),
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
       * A Special Maneuver: one nobody has until an effect gives it to them.
       *
       * "While you can use all forms of Maneuver naturally, you cannot use any Special
       * Maneuvers until you have gained access to them through an effect." Something a
       * Maneuver of any kind can be rather than a kind of its own - the Analysis
       * Maneuver is Special and its entry reads "Maneuver Type: Standard Maneuver".
       *
       * Access is a Slot an effect writes, `allow maneuver.<id>`, and the same Slot can
       * take it away: a Special Maneuver has to be granted and not forbidden. Owning the
       * Item is not access, because "through an effect" is what the rule asks for.
       */
      special: new fields.BooleanField({ required: true, initial: false }),
      /**
       * Marks the Opponent it is aimed at as Analyzed, and hands whoever did it a bonus
       * against them.
       *
       * A flag rather than a script, because both halves are about a pair: the mark goes
       * on somebody else and the bonus is measured against them, and a passive writes
       * Slots onto the character holding it.
       */
      analysis: new fields.BooleanField({ required: true, initial: false }),
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
