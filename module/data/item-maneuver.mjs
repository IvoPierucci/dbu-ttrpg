import { getTrait, traitsOfKind } from "../effects/traits.mjs";
import { withLibrary } from "../unique.mjs";

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
      /** Joins an Ally's attack: the United Attack Maneuver, played from that attack's card. */
      united: new fields.BooleanField({ required: true, initial: false }),
      /** Answers a heavy attack with a Duel: the Duel Maneuver, played from that attack's Respond. */
      duel: new fields.BooleanField({ required: true, initial: false }),
      /** Tries to get out of a Duel aimed at one's attack: played from that attack's card. */
      duelEscape: new fields.BooleanField({ required: true, initial: false }),
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
      /** Lifts a Square or a Feature and holds it - the Terrain Lift Maneuver (chat.mjs askTerrainLift). */
      terrainLift: new fields.BooleanField({ required: true, initial: false }),
      /** A God Maneuver: "only available to those with access to Divine Ki Points ... spend Divine Ki Points to use". */
      godManeuver: new fields.BooleanField({ required: true, initial: false }),
      /** Divine Movement: "Move to any Square within range of your Boosted Speed", no Exploit. */
      divineMovement: new fields.BooleanField({ required: true, initial: false }),
      /** A second limit over the usage limit - Divine Movement's "[1/Round, 3/Encounter]". 0 is none. */
      encounterLimit: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
      /** Its KP Cost "for each Action spent" - Divine Pulse's 1(bT). A Unique Ability's is under `unique`. */
      kiPerAction: new fields.BooleanField({ required: true, initial: false }),
      /** Hands an Item over to be caught - the Toss Maneuver (chat.mjs askToss). */
      toss: new fields.BooleanField({ required: true, initial: false }),
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
      /** A Healing Surge of its own size: Divine Breathing's "Regain 5d10(bT) Life Points". 0 is the Surge's own. */
      surgeDicePerBaseTier: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
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
      /** Whether what it targets may be a piece of Apparel - the Called Shot. */
      targetsApparel: new fields.BooleanField({ required: true, initial: false }),
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
       * Marks the Opponent it is aimed at as Seen, and hands whoever did it a bonus on the
       * Clashes they make against them.
       *
       * Analysis's sibling, and a flag for the same reason: both halves are about a pair,
       * and a passive writes Slots onto the character holding it. What differs is which
       * rolls it reaches - a Skill Clash and a Clash of Saving Throws, where Analysis
       * reaches the Combat Rolls.
       */
      intuit: new fields.BooleanField({ required: true, initial: false }),
      /**
       * Takes Life and Ki off the Grappled, and hands the Ki to the Grappler.
       *
       * Only usable as the Grappler, aimed at itself - the one you are holding is the only
       * answer - and priced per Action up to three. A flag because none of that is a number
       * another Maneuver would want, and the amount is the one thing it does share with
       * anything: half the user's Might, rounded up.
       */
      powerDrain: new fields.BooleanField({ required: true, initial: false }),
      /**
       * Reads an Opponent: a Clash, and winning tells the winner how much of their
       * Opponent's power is being held back.
       *
       * A flag because what it leaves behind is not a Condition, a clock or a number on
       * anybody - it is a sentence sent to one side. The first Maneuver here whose whole
       * effect is that somebody now knows something, which is also why its note is
       * whispered where every other settled Clash's is read out.
       */
      sense: new fields.BooleanField({ required: true, initial: false }),
      /**
       * Frightens an Opponent: a Clash, and winning leaves them Shaken - or Prone as well,
       * if they were Shaken before this landed.
       *
       * A flag because the two things it brings are particular to it. One is an ordering:
       * "if they ALREADY possessed the Shaken Combat Condition" has to be read before this
       * use writes it, or every Terrify knocks its target Prone. The other is a penalty on
       * its own Clash for aiming above your Tier of Power, which is the first thing in
       * these rules to compare the two sides' Tiers to each other.
       */
      terrify: new fields.BooleanField({ required: true, initial: false }),
      /**
       * Turns an Opponent into an object: two Clashes in sequence, and winning both takes
       * them out of the fight for the Encounter.
       *
       * A flag because almost none of it is shared with anything. Two chained Clashes of
       * different categories, an Item named by the winner and kept on the loser, a branch
       * that undoes an earlier use instead of rolling at all, a Counter Action that turns
       * the Maneuver on its user, and a death with a Karma Point in front of it.
       */
      transfiguration: new fields.BooleanField({ required: true, initial: false }),
      /**
       * Puts Life Points on an Ally, and may go after a poison instead of half of them.
       *
       * A flag because both halves are about somebody else - the Life Points and the
       * Condition are theirs - and a script writes onto whoever is running it. The Empower
       * Maneuver had the same problem with Ki Points and is answered the same way.
       */
      treatment: new fields.BooleanField({ required: true, initial: false }),
      /** Repairs a Weapon or a piece of Apparel: the Repair Maneuver. The Item is not the character. */
      repair: new fields.BooleanField({ required: true, initial: false }),
      /**
       * An Instant that is itself an attack, made with the Simple Profile or with the one
       * other Profile its owner's tail was built for.
       *
       * A flag rather than a set of fields, because what it brings is a shape no other
       * Maneuver has: a Profile list of two, a surcharge on its own price for the second
       * of them, and a choice made once and kept. The choice is `tailVariant` below; the
       * list and the surcharge are derived from it, so the two cannot disagree.
       */
      tailAttack: new fields.BooleanField({ required: true, initial: false }),
      /**
       * This Maneuver's stated Ki Point Cost is the whole price, the Profile's included.
       *
       * False everywhere else, and rightly: the Basic Attack's cost line reads "Varies
       * (uses the Ki Point Cost of the chosen Profile)" and its own cost is nothing, so
       * adding the two is adding nothing to something. A Maneuver that states a price and
       * then names which Profiles that price buys is the case this exists for - charging
       * the Profile again would charge for it twice.
       *
       * The Minimum Ki Point Cost is untouched by this. That floor is half the Profile's
       * listed cost and it is a rule about attacks rather than about this Maneuver, so it
       * still applies underneath - it simply never bites here, because a stated price that
       * buys a Profile is more than half what the Profile lists.
       */
      kiCostCoversProfile: new fields.BooleanField({ required: true, initial: false }),
      /**
       * Which of the Tail Attack's four additional effects this character took.
       *
       * On the Item because it is a choice about this character's own copy of a Maneuver,
       * kept for as long as they have it - the same place their rename of it lives, and it
       * survives the Maneuver going off the list and coming back.
       *
       * Blank means it has not been asked yet; "none" means it was asked and declined.
       * Two states rather than one, because only one of them is worth asking about again.
       */
      tailVariant: new fields.StringField({ required: true, blank: true, initial: "" }),
      /**
       * Neither suffers Diminishing Offense nor counts towards it.
       *
       * Two pieces of machinery in one sentence: the Strike Roll leaves the row off, and
       * the round's attack count is not raised. The second is the half that would have
       * gone unnoticed - a count is easy to read and easy to forget not to write.
       */
      outsideDiminishing: new fields.BooleanField({ required: true, initial: false }),
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
      /** The No Effort Maneuver: one of several small things, picked when it is used. */
      noEffort: new fields.BooleanField({ required: true, initial: false }),
      /** The Throw Maneuver: what is thrown is asked, and it hits as a Feature would. */
      throws: new fields.BooleanField({ required: true, initial: false }),
      efforts: new fields.ArrayField(new fields.StringField({ blank: false })),

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

      /**
       * What a Signature Technique was built out of, on its Sig Creation and Adv & Disadv tabs.
       *
       * Blank on every other Maneuver, and on a Technique made before the builder existed -
       * which goes on reading its `advantages` as it always did. Once a Technique has
       * features here, `advantages` is derived from them (one entry per rank), so every reader
       * of that list keeps working unchanged.
       */
      signature: new fields.SchemaField({
        level: new fields.StringField({ required: true, blank: false, initial: "super" }),
        foundation: new fields.StringField({ required: true, blank: true, initial: "" }),
        profile: new fields.StringField({ required: true, blank: true, initial: "" }),
        /** Multi-Profile's other Profile, chosen when the Technique is built. */
        secondProfile: new fields.StringField({ required: true, blank: true, initial: "" }),
        /** A Dramatic Finisher's Super Profile. */
        superProfile: new fields.StringField({ required: true, blank: true, initial: "" }),
        /** Gained from a Transformation Trait: left out of the Ultimate-to-Super count. */
        fromTransformation: new fields.BooleanField({ required: true, initial: false }),
        /**
         * TP this Technique does not take from the character - Power Level 1's "20 TP to spend on
         * one Signature Technique". Its TP, its cap and its KP are unchanged: only what the
         * character pays for it is less.
         */
        freeTP: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
        features: new fields.ArrayField(new fields.SchemaField({
          id: new fields.StringField({ required: true, blank: false }),
          ranks: new fields.NumberField({ required: true, integer: true, initial: 1, min: 1 }),
          /** Widespread's shape, Trick Attack's Skill, Condition's Condition, and so on. */
          choice: new fields.StringField({ required: true, blank: true, initial: "" })
        }), { required: true, initial: [] }),
        /**
         * Delayed: "keep a record of the Dice Score of your Wound Roll". Which attack it was, who
         * carries its Imminent, and the Round it was made in (for Short Delay).
         */
        delayed: new fields.SchemaField({
          wound: new fields.NumberField({ required: true, integer: true, initial: 0 }),
          messageId: new fields.StringField({ required: true, blank: true, initial: "" }),
          round: new fields.NumberField({ required: true, integer: true, initial: 0 }),
          targets: new fields.ArrayField(new fields.StringField({ blank: false }), { required: true, initial: [] })
        })
      }),

      /**
       * A Unique Ability's own: its type, its TP Cost and Prerequisite, and the Advancements bought onto it
       * and Restrictions applied to it - each with a script of its own, added to the Ability's while it
       * counts (module/unique.mjs). Blank on every other Maneuver.
       */
      unique: new fields.SchemaField({
        /** technical, magical, or both - "then the category can be chosen when gaining" it. */
        uaType: new fields.StringField({ required: true, blank: true, initial: "" }),
        chosenType: new fields.StringField({ required: true, blank: true, initial: "" }),
        tpCost: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
        /** Added to the listed TP Cost, up or down - never below the rule's minimum (the user's). */
        tpChange: new fields.NumberField({ required: true, integer: true, initial: 0 }),
        /** Its own price not charged; what is bought onto it still is (the user's). */
        free: new fields.BooleanField({ required: true, initial: false }),
        prerequisite: new fields.StringField({ required: true, blank: true, initial: "" }),
        /** The file it was gained from, if any - `unique/<id>.dbu`. */
        libraryId: new fields.StringField({ required: true, blank: true, initial: "" }),
        /** Its Effect makes an Item - Magical Materialization (use-maneuver.mjs askMaterialize). */
        materialize: new fields.BooleanField({ required: true, initial: false }),
        /** Its Effect moves an Opponent up the Initiative Order - Precognition (use-maneuver.mjs askPrecognition). */
        precognition: new fields.BooleanField({ required: true, initial: false }),
        /**
         * Its effects stay applied, their Ki Point Cost paid again at the start of each of your turns - the Atmospheric
         * Bubble's (chat.mjs upkeepUniques). `applied`, what that costs on top (`upkeepKi`, Big Bubble's Magnitudes)
         * and the Sphere it was applied in are this character's own.
         */
        sustained: new fields.BooleanField({ required: true, initial: false }),
        /** Kept for half its KP Cost at the start of each turn - Extra Arms'. */
        upkeepHalf: new fields.BooleanField({ required: true, initial: false }),
        /** Prone and a Clash (Bluff vs Intuition) at every Opponent, won Hidden - Fake Death's (chat.mjs postFakeDeath). */
        fakesDeath: new fields.BooleanField({ required: true, initial: false }),
        /** A False Moon, counted: its Combat Rounds from the file, and how many are left of one made - Fake Moon's. */
        fakeMoon: new fields.BooleanField({ required: true, initial: false }),
        /** Finish Sign's: a Signature Technique declared, and Finisher stacks for it (chat.mjs postFinishSign). */
        finishSign: new fields.BooleanField({ required: true, initial: false }),
        /** The Battle Environment it gives its user while applied - Flooding Technique's Underwater. */
        floods: new fields.StringField({ required: true, blank: true, initial: "" }),
        /** The Meteor Phase - God Meteor's (chat.mjs postMeteor). */
        meteor: new fields.BooleanField({ required: true, initial: false }),
        /** Life Points regained by another - Healing Hands' (chat.mjs postHealing). */
        heals: new fields.BooleanField({ required: true, initial: false }),
        /** A Wound Roll of the Simple Profile off your own Life Points - Holstein Shock's (chat.mjs postShock). */
        selfShock: new fields.BooleanField({ required: true, initial: false }),
        /** A Clash at everyone in a Sphere, losers given a Combat Condition - Illusion's (chat.mjs postIllusion). */
        illusion: new fields.BooleanField({ required: true, initial: false }),
        /** A Basic Attack out of sequence as if they stood beside you - Illusion Smash's (chat.mjs postSmash). */
        smashes: new fields.BooleanField({ required: true, initial: false }),
        /** A Clash that leaves its target Debilitated, kept each turn - Internal Assault's (chat.mjs). */
        debilitates: new fields.BooleanField({ required: true, initial: false }),
        /** A Counter answering a Physical Attack with your Strike Roll - Judo Toss's (chat.mjs playJudo). */
        judoToss: new fields.BooleanField({ required: true, initial: false }),
        /** Kept for this much (bT) KP at the start of each turn - Ki Avatar's 4(bT). */
        upkeepKiPerBaseTier: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
        /** The Size it makes you count as while applied - Ki Avatar's Gigantic. */
        avatarSize: new fields.StringField({ required: true, blank: true, initial: "" }),
        /** A Clash that puts its targets to sleep, each once an Encounter - Lullaby Fist's (chat.mjs postLullaby). */
        lullaby: new fields.BooleanField({ required: true, initial: false }),
        /** An Ally Magically Enhanced until the end of their turn - Magical Enhancement's (chat.mjs postEnhance). */
        enhances: new fields.BooleanField({ required: true, initial: false }),
        /** A Clash that leaves its target Compelled - Mind Control's (chat.mjs postMindControl). */
        mindControl: new fields.BooleanField({ required: true, initial: false }),
        /** A Clash that reads its target, defending against them easier - Mind Reading's (chat.mjs postMindReading). */
        mindReading: new fields.BooleanField({ required: true, initial: false }),
        /** Duplicate Minions, counted - Multi-Form Technique's (chat.mjs postMultiForm). The sheets are the table's. */
        multiForm: new fields.BooleanField({ required: true, initial: false }),
        /** A dance that provokes Exploits, then Clashes for Actions - Para Para Dance's (chat.mjs postParaPara). */
        paraPara: new fields.BooleanField({ required: true, initial: false }),
        /** A Strike Clash, then a Saving Throw Clash for Slowed - Petrification's (chat.mjs postPetrification). */
        petrifies: new fields.BooleanField({ required: true, initial: false }),
        /** Portals made two at a time - Portal Creation's 2 at one time - and how many are held now (chat.mjs postPortals). */
        portals: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
        portalsHeld: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
        /** A Clash (Cognitive) that swaps places - Position Change's (chat.mjs postPositionChange). */
        positionChange: new fields.BooleanField({ required: true, initial: false }),
        /** An opening offered for the Exploit, punished - Punisher Guard's (chat.mjs postPunisherGuard). */
        punisherGuard: new fields.BooleanField({ required: true, initial: false }),
        /** A Clash, a Might Clash, and a container - Sealing's (chat.mjs postSealing). */
        seals: new fields.BooleanField({ required: true, initial: false }),
        /** A Character watched from anywhere - Second Sight's (chat.mjs postSecondSight). */
        secondSight: new fields.BooleanField({ required: true, initial: false }),
        /** Another shape - Shapeshift's (chat.mjs postShapeshift) - and, while applied, its Size, Bestial Traits, form
         *  (a Vehicle or a Weapon, the table's) and turns left (0 is no limit). */
        shapeshift: new fields.BooleanField({ required: true, initial: false }),
        /** A Cone of light - Solar Flare's (chat.mjs postSolarFlare). */
        solarFlare: new fields.BooleanField({ required: true, initial: false }),
        /** A Basic Attack out of sequence with a blade of energy - Spirit Sword's (chat.mjs postSpiritSword). */
        spiritSword: new fields.BooleanField({ required: true, initial: false }),
        /** A Counter rolling Strike against an Energy or Magic Attack - Stardust Barrier's (DEFENCES.stardust). */
        stardust: new fields.BooleanField({ required: true, initial: false }),
        /** Kamikaze Ghosts made, and how many stand - Super Ghost Kamikaze Attack's (chat.mjs postKamikaze). */
        kamikaze: new fields.BooleanField({ required: true, initial: false }),
        ghosts: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
        /** A Counter against one Signature Technique, by its name as written - Technique Block's (chat.mjs). */
        techniqueBlock: new fields.BooleanField({ required: true, initial: false }),
        blockedName: new fields.StringField({ required: true, blank: true, initial: "" }),
        /** Throw, take or Launch from 8 Squares away - Telekinesis's (chat.mjs postTelekinesis). */
        telekinesis: new fields.BooleanField({ required: true, initial: false }),
        /** A link of minds for the Combat Round - Telepathy's (chat.mjs postTelepathy, telepathyBonus). */
        telepathy: new fields.BooleanField({ required: true, initial: false }),
        /** An Explosive Web that strikes who enters it - Threaded Energy's (chat.mjs webStrike). */
        explosiveWeb: new fields.BooleanField({ required: true, initial: false }),
        /** A Frozen Turn - Time Freeze's (chat.mjs postTimeFreeze). */
        timeFreeze: new fields.BooleanField({ required: true, initial: false }),
        /** Spinning - Tornado Attack's (chat.mjs postTornado). */
        tornado: new fields.BooleanField({ required: true, initial: false }),
        /** A Signature Technique stored in a Trap Square - Trap Attack's (chat.mjs springTrap): its Item, and its name. */
        trapAttack: new fields.BooleanField({ required: true, initial: false }),
        /** A Clash at an Ally for an Awakening - Warped Evolution's (chat.mjs postWarpedEvolution). */
        warpedEvolution: new fields.BooleanField({ required: true, initial: false }),
        /** A Battle Weather over the Battlefield - Weather Summoning's (chat.mjs postWeatherSummon): which, at what Tier,
         *  what each character had before it, and how many of its user's turn ends are left (0 is kept, Lasting Weather). */
        summonsWeather: new fields.BooleanField({ required: true, initial: false }),
        /** A Feature conjured on a Use Magic Check - World Forging's (chat.mjs postWorldForging). */
        worldForging: new fields.BooleanField({ required: true, initial: false }),
        weatherSet: new fields.StringField({ required: true, blank: true, initial: "" }),
        weatherTier: new fields.NumberField({ required: true, integer: true, initial: 1, min: 1 }),
        weatherBefore: new fields.ArrayField(new fields.SchemaField({
          uuid: new fields.StringField({ required: true, blank: true, initial: "" }),
          id: new fields.StringField({ required: true, blank: true, initial: "" }),
          tier: new fields.NumberField({ required: true, integer: true, initial: 1, min: 1 })
        }), { required: true, initial: () => [] }),
        weatherEnds: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
        trapTechnique: new fields.StringField({ required: true, blank: true, initial: "" }),
        trapName: new fields.StringField({ required: true, blank: true, initial: "" }),
        shapeSize: new fields.StringField({ required: true, blank: true, initial: "" }),
        shapeBestial: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
        shapeForm: new fields.StringField({ required: true, blank: true, initial: "" }),
        shapeLeft: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
        /** How many Duplicate Minions it has made that stand. */
        duplicates: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
        /** A State it may only be used in - God Meteor's God Ki. */
        requiresState: new fields.StringField({ required: true, blank: true, initial: "" }),
        /** The one they had before, given back when it ends. */
        floodedFrom: new fields.StringField({ required: true, blank: true, initial: "" }),
        /** The Signature Technique it declared, by its Item's id - blank while none is. */
        finishTechnique: new fields.StringField({ required: true, blank: true, initial: "" }),
        moonRounds: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
        /** Rounds left of the False Moon applied; 0 while applied is the rest of the Encounter (Lasting Moon). */
        moonLeft: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
        /** A Counter played once hit, before the Wound Roll - Barrier's (chat.mjs barrierStage). */
        barrier: new fields.BooleanField({ required: true, initial: false }),
        /** Its Effect Pins somebody and holds them - Binding's (chat.mjs postBinding); who, while it does. */
        binds: new fields.BooleanField({ required: true, initial: false }),
        /** Its Clash won Staggers and Shakes, lost hands over their Exploit - Bluff Attack's (chat.mjs settleBluffAttack). */
        bluffs: new fields.BooleanField({ required: true, initial: false }),
        boundUuid: new fields.StringField({ required: true, blank: true, initial: "" }),
        applied: new fields.BooleanField({ required: true, initial: false }),
        upkeepKi: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
        area: new fields.StringField({ required: true, blank: true, initial: "" }),
        /**
         * What keeping it costs each turn where that is not its own KP Cost - Bound Battlefield's 6(T) - and the Sphere
         * it is applied in where the entry names one - its Destructive.
         */
        upkeepKiPerTier: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
        sphereMagnitude: new fields.StringField({ required: true, blank: true, initial: "" }),
        /**
         * Cage of Light's: "All of your remaining Actions (Min. 2)" to use and to keep; removed as an Instant; and its Life
         * Point reductions and Might Clash as buttons under its entry while it stands.
         */
        spendsAllActions: new fields.BooleanField({ required: true, initial: false }),
        upkeepAllActions: new fields.BooleanField({ required: true, initial: false }),
        instantRelease: new fields.BooleanField({ required: true, initial: false }),
        cage: new fields.BooleanField({ required: true, initial: false }),
        /**
         * Copy Being's: "you still use your Life Points, Ki Points, and Capacity (and their respective Maximums)" - the
         * Maximums recorded under its entry, this character's own (the user's).
         */
        keepsPools: new fields.BooleanField({ required: true, initial: false }),
        /** Offered on your Energy Attack that missed everyone - Cyclone Energy's (chat.mjs cycloneStage). */
        cyclone: new fields.BooleanField({ required: true, initial: false }),
        /**
         * Dead Zone's: Actions spent each turn to keep it, beside its Ki - "1 Action and 5(T) Ki Points" - and a Might Clash
         * against everyone at the end of each of your turns while it is open.
         */
        upkeepActions: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
        pullsAtEnd: new fields.BooleanField({ required: true, initial: false }),
        /** Answers an Exploit you triggered - Desperate Dodge's (chat.mjs desperateDodge). */
        dodgesExploits: new fields.BooleanField({ required: true, initial: false }),
        /** Its Clash won, read off the target's alignment - Devilmite Beam's (chat.mjs settleDevilmite). */
        devilmite: new fields.BooleanField({ required: true, initial: false }),
        /** Offered on a Knockback Clash you won - Dragon Dash's (chat.mjs dashStage). */
        dashes: new fields.BooleanField({ required: true, initial: false }),
        /** Its Clash (Impulsive) against everyone around, won Hidden - Down Burst's (chat.mjs postDownBurst). */
        downBurst: new fields.BooleanField({ required: true, initial: false }),
        /** Gathers Lifeforce - Energy Gathering's (use-maneuver.mjs postGathering). */
        gathers: new fields.BooleanField({ required: true, initial: false }),
        /** Gives the Squares around an Environmental Quality - Environment Shift's (chat.mjs postEnvironmentShift). */
        shiftsEnvironment: new fields.BooleanField({ required: true, initial: false }),
        /** Its KP Cost "for each Action spent", and a Clash at a Character for each - Explosion Sorcery's. */
        kiPerAction: new fields.BooleanField({ required: true, initial: false }),
        explodes: new fields.BooleanField({ required: true, initial: false }),
        /** A Might Clash against everyone around, won pushing them away - Explosive Wave's (chat.mjs postWave). */
        waves: new fields.BooleanField({ required: true, initial: false }),
        kept: new fields.SchemaField({
          life: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
          ki: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
          capacity: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 })
        }),
        /**
         * A Counter that raises the Defense Value against the attack it answers - the Afterimage Technique's
         * 2(T), `defense` per Tier - and what it offers out of sequence if that attack is avoided.
         */
        evade: new fields.SchemaField({
          defense: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
          offer: new fields.StringField({ required: true, blank: true, initial: "" }),
          /** More per Tier against a Called Shot - Physical Retreat's 1(T). */
          calledShot: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
          /** Answering the Grapple Maneuver too, on its Grapple Check's Dodge - Physical Retreat's. */
          grapple: new fields.BooleanField({ required: true, initial: false })
        }),
        advancements: new fields.ArrayField(new fields.SchemaField({
          id: new fields.StringField({ required: true, blank: false }),
          /** Its file's id, where it came from one - what the code asks after. */
          key: new fields.StringField({ required: true, blank: true, initial: "" }),
          name: new fields.StringField({ required: true, blank: true, initial: "" }),
          /** What it adds to the evasion: a Maneuver offered beside it - Wild Sense's Basic Attack. */
          alsoOffer: new fields.StringField({ required: true, blank: true, initial: "" }),
          /** A Clash on taking that offer - Afterimage Strike's Impulsive vs Cognitive - and what winning says. */
          clashSave: new fields.StringField({ required: true, blank: true, initial: "" }),
          clashAgainst: new fields.StringField({ required: true, blank: true, initial: "" }),
          clashNote: new fields.StringField({ required: true, blank: true, initial: "" }),
          clashHides: new fields.BooleanField({ required: true, initial: false }),
          /** No Diminishing Defense from the attack it answered - Sonic Sway. */
          noDiminishing: new fields.BooleanField({ required: true, initial: false }),
          /** Bought without its TP being charged (the user's). */
          free: new fields.BooleanField({ required: true, initial: false }),
          /** Added to its TP Cost, up or down - never below nothing (the user's). */
          tpChange: new fields.NumberField({ required: true, integer: true, initial: 0 }),
          tp: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
          prerequisite: new fields.StringField({ required: true, blank: true, initial: "" }),
          text: new fields.StringField({ required: true, blank: true, initial: "" }),
          script: new fields.StringField({ required: true, blank: true, initial: "" }),
          bought: new fields.BooleanField({ required: true, initial: false })
        }), { required: true, initial: [] }),
        restrictions: new fields.ArrayField(new fields.SchemaField({
          id: new fields.StringField({ required: true, blank: false }),
          key: new fields.StringField({ required: true, blank: true, initial: "" }),
          /** What was chosen when it was applied - Limited Creation's kind of Item. */
          choice: new fields.StringField({ required: true, blank: true, initial: "" }),
          name: new fields.StringField({ required: true, blank: true, initial: "" }),
          /** Its TP Cost Reduction - and what it costs to remove it at a Power Level. */
          reduction: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
          /** The Advancements it locks, by name, comma-separated. */
          locked: new fields.StringField({ required: true, blank: true, initial: "" }),
          text: new fields.StringField({ required: true, blank: true, initial: "" }),
          script: new fields.StringField({ required: true, blank: true, initial: "" }),
          applied: new fields.BooleanField({ required: true, initial: false })
        }), { required: true, initial: [] })
      }),

      /** How often it may be used, as "1/round" or "2/encounter". Blank means freely. */
      usageLimit: new fields.StringField({ required: true, blank: true, initial: "" }),

      /** Effects of its own, in the same language every other Trait uses. */
      script: new fields.StringField({ required: true, blank: true, initial: "" }),
      text: new fields.StringField({ required: true, blank: true, initial: "" })
    };
  }

  /**
   * A built Technique's `advantages` are what its features say: one id per rank. Derived
   * rather than stored twice, so the two can never disagree.
   */
  prepareDerivedData() {
    super.prepareDerivedData?.();
    // A Unique Ability gained from a file reads that file as it is now (unique.mjs withLibrary).
    this.fromLibrary = withLibrary(this, { getTrait, traitsOfKind });
    const features = this.signature?.features ?? [];
    if (!features.length) return;
    this.advantages = features.flatMap(entry =>
      Array(Math.max(1, Number(entry.ranks) || 1)).fill(entry.id));
  }

  /** The usage limit, split into the shape the rest of the system reads. */
  get limit() {
    const match = String(this.usageLimit).match(/^(\d+)\s*\/\s*(round|encounter)$/i);
    if (!match) return null;
    return { amount: Number(match[1]), per: match[2].toLowerCase() };
  }
}
