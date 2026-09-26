const { fields } = foundry.data;

import { GEAR_TYPES } from "../gear.mjs";

/**
 * A piece of Gear, as an Item a character owns.
 *
 * A copy of a file in traits/gear/, made when the character gains it. The name and the
 * description are the player's to change; the rest says what the file said, so a renamed
 * Item is still the same Item to the rules.
 */
export default class DBUGearData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {
      /**
       * The file this Item came from. Kept so its entry can be read from the file while the
       * file exists, and so a rule that names an Item finds it whatever it was renamed to.
       */
      gearId: new fields.StringField({ required: true, blank: true, initial: "" }),

      /** Which of the four Item Types it is. */
      itemType: new fields.StringField({
        required: true, blank: false, initial: "basic", choices: Object.keys(GEAR_TYPES)
      }),

      /** [Tech], [Med], [Food] - the tags after its name. */
      tags: new fields.ArrayField(
        new fields.StringField({ required: true, blank: false }),
        { required: true, initial: () => [] }
      ),

      /** The Craft DC, as the entry writes it. */
      craftDC: new fields.StringField({ required: true, blank: true, initial: "" }),

      /** The player's own words for it. */
      description: new fields.HTMLField({ required: true, blank: true, initial: "" }),

      /** The rulebook's entry, as the file had it when this was given. */
      text: new fields.StringField({ required: true, blank: true, initial: "" }),

      source: new fields.StringField({ required: true, blank: true, initial: "" }),

      // --- An Item that records something from its maker and goes off - the Bomb ------------

      /** Which Attribute's Modifier it records when made, or blank for none. */
      records: new fields.StringField({ required: true, blank: true, initial: "" }),
      /** The Modifier it recorded. Editable: the maker is not always the one holding it. */
      recorded: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null }),

      /** The triggers it can be set to, and the one it is. */
      triggers: new fields.ArrayField(
        new fields.StringField({ required: true, blank: false }),
        { required: true, initial: () => [] }
      ),
      trigger: new fields.StringField({ required: true, blank: true, initial: "" }),

      /** What placing it costs, in Actions. */
      placeCost: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
      /** Whether it is out on the Battlefield, waiting to go off. */
      placed: new fields.BooleanField({ required: true, initial: false }),
      /** A Timed one's Combat Rounds still to pass. */
      countdown: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),

      /** The Basic Attack it makes when it goes off, if it goes off. */
      detonation: new fields.SchemaField({
        profile: new fields.StringField({ required: true, blank: true, initial: "" }),
        foundation: new fields.StringField({ required: true, blank: true, initial: "" }),
        autoHit: new fields.BooleanField({ required: true, initial: false })
      }),

      /** A Special Basic Item, which only the ARC hands out and nothing crafts. */
      special: new fields.BooleanField({ required: true, initial: false }),

      /** Tied to a Character, and which - the Teleport Remote - and whether it moves
       *  its holder to them or them to its holder. */
      assignsCharacter: new fields.BooleanField({ required: true, initial: false }),
      assigned: new fields.SchemaField({
        uuid: new fields.StringField({ required: true, blank: true, initial: "" }),
        name: new fields.StringField({ required: true, blank: true, initial: "" })
      }),
      teleports: new fields.BooleanField({ required: true, initial: false }),

      /** Put on somebody and locked there - the Ki-Sealing Handcuff - and the Key's pair. */
      lock: new fields.SchemaField({
        locks: new fields.BooleanField({ required: true, initial: false }),
        cost: new fields.NumberField({ required: true, integer: true, min: 0, initial: 0 }),
        unlockCost: new fields.NumberField({ required: true, integer: true, min: 0, initial: 0 }),
        skills: new fields.ArrayField(new fields.StringField({ blank: false })),
        against: new fields.StringField({ required: true, blank: true, initial: "" }),
        condition: new fields.StringField({ required: true, blank: true, initial: "" }),
        mark: new fields.StringField({ required: true, blank: true, initial: "" }),
        id: new fields.StringField({ required: true, blank: true, initial: "" }),
        gave: new fields.BooleanField({ required: true, initial: false })
      }),
      /** A Key: the lock it opens. */
      keyFor: new fields.StringField({ required: true, blank: true, initial: "" }),

      /** Shrinks its wearer to a Size named outright - the Micro Band - and where they are. */
      shrink: new fields.SchemaField({
        to: new fields.ArrayField(new fields.StringField({ blank: false })),
        cost: new fields.NumberField({ required: true, integer: true, min: 0, initial: 0 }),
        now: new fields.StringField({ required: true, blank: true, initial: "" })
      }),

      /** An Attribute that may stand in for the Damage Attribute, and on what attacks -
       *  the Hologram Projector's Personality, on a Signature Technique. */
      damageAttribute: new fields.SchemaField({
        attribute: new fields.StringField({ required: true, blank: true, initial: "" }),
        when: new fields.StringField({ required: true, blank: true, initial: "" })
      }),

      /** Made for one Character, and which - the Eyeglasses' Intended Character. */
      declaresIntended: new fields.BooleanField({ required: true, initial: false }),
      intended: new fields.SchemaField({
        uuid: new fields.StringField({ required: true, blank: true, initial: "" }),
        name: new fields.StringField({ required: true, blank: true, initial: "" })
      }),

      /** An Accessory being worn. Its effects apply only while it is. */
      equipped: new fields.BooleanField({ required: true, initial: false }),

      /** Portions of several kinds, how many of each are left, and what eating one does -
       *  the Medibugs - with the dice for how many are shared out. */
      portionsDice: new fields.StringField({ required: true, blank: true, initial: "" }),
      portions: new fields.ArrayField(
        new fields.SchemaField({
          key: new fields.StringField({ required: true, blank: false }),
          label: new fields.StringField({ required: true, blank: true, initial: "" }),
          count: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
          full: new fields.BooleanField({ required: true, initial: false }),
          dot: new fields.BooleanField({ required: true, initial: false }),
          removes: new fields.ArrayField(
            new fields.StringField({ required: true, blank: false }),
            { required: true, initial: () => [] }
          ),
          gains: new fields.StringField({ required: true, blank: true, initial: "" })
        }),
        { required: true, initial: () => [] }
      ),

      /** A Maneuver holding it gives access to, and what it changes about that Maneuver -
       *  the Energy-Suction Device's Power Drain. */
      grantsManeuver: new fields.StringField({ required: true, blank: true, initial: "" }),
      drainsAnywhere: new fields.BooleanField({ required: true, initial: false }),
      storesDrain: new fields.BooleanField({ required: true, initial: false }),
      paysAttacks: new fields.ArrayField(
        new fields.StringField({ required: true, blank: false }),
        { required: true, initial: () => [] }
      ),

      /** One of a set - a Dragon Ball: the sizes a set may be, this one's, which ball it
       *  is, and the least Actions gathering them all takes to use. */
      set: new fields.SchemaField({
        min: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
        max: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
        size: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
        number: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
        actionsMin: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 })
      }),

      /** The sizes it comes in, "Label=dice", and the one it is. */
      sizes: new fields.ArrayField(
        new fields.SchemaField({
          label: new fields.StringField({ required: true, blank: false }),
          dice: new fields.StringField({ required: true, blank: false })
        }),
        { required: true, initial: () => [] }
      ),
      size: new fields.StringField({ required: true, blank: true, initial: "" }),

      /** Full Life and Ki and every Combat Condition off but these - a Senzu Bean - and
       *  whether it may be fed to a Defeated character beside you. */
      restore: new fields.SchemaField({
        full: new fields.BooleanField({ required: true, initial: false }),
        keeps: new fields.ArrayField(
          new fields.StringField({ required: true, blank: false }),
          { required: true, initial: () => [] }
        ),
        feedsDefeated: new fields.BooleanField({ required: true, initial: false })
      }),

      /** Charges it is made with: the dice rolled for them, what they are called, and how
       *  many are left - the Poison Vial's 1d6 Poison Drops. */
      chargesDice: new fields.StringField({ required: true, blank: true, initial: "" }),
      chargesLabel: new fields.StringField({ required: true, blank: true, initial: "" }),
      /** Charges made at so many per base Tier of its maker - the Jetpack's 30(bT) Ki - and
       *  the most it holds. */
      chargesPerBaseTier: new fields.NumberField({ required: true, integer: true, min: 0,
        initial: 0 }),
      chargesMax: new fields.NumberField({ required: true, integer: true, min: 0, initial: 0 }),
      /** Its charges pay for the Movement Maneuver's Ki instead of the character's. */
      paysMovement: new fields.BooleanField({ required: true, initial: false }),
      charges: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),

      /** A mark it leaves on everyone in the area it bursts in, and until which edge of the
       *  thrower's next turn - the Smoke Bomb's Smoked. */
      areaMark: new fields.SchemaField({
        condition: new fields.StringField({ required: true, blank: true, initial: "" }),
        until: new fields.StringField({ required: true, blank: true, initial: "" })
      }),

      /** A scan, and the Skill Check at the Difficulty that hides from it - the Scout Scope. */
      scan: new fields.SchemaField({
        skill: new fields.StringField({ required: true, blank: true, initial: "" }),
        difficulty: new fields.StringField({ required: true, blank: true, initial: "" }),
        /** Only during a Combat Encounter - the Scouter. */
        combatOnly: new fields.BooleanField({ required: true, initial: false }),
        /** Hiding from it lasts only while the Holding Back stacks do - the Scout Scope. */
        holdingBack: new fields.BooleanField({ required: true, initial: true }),
        /** The Tier a Power Up nearby has to be at to destroy it; 0 for nothing does. */
        breaksAt: new fields.NumberField({ required: true, integer: true, min: 0, initial: 0 })
      }),
      /** The Craft DCs it may be made at, and the Tier that destroys it at each. */
      craftDCChoices: new fields.ArrayField(new fields.StringField({ blank: false })),
      breaksAt: new fields.ObjectField({ required: true, initial: () => ({}) }),

      /** The mark it gives whoever holds it lit, and whether it is - the Torch. */
      lightMark: new fields.StringField({ required: true, blank: true, initial: "" }),
      lit: new fields.BooleanField({ required: true, initial: false }),

      /** The files of the Items it can be connected to - the Remote Control's. */
      connects: new fields.ArrayField(
        new fields.StringField({ required: true, blank: false }),
        { required: true, initial: () => [] }
      ),
      /** The Item it is connected to, by its Item id, or blank. */
      connectedTo: new fields.StringField({ required: true, blank: true, initial: "" }),

      /** Whether it is a Capsule, which holds one Basic Item. */
      capsule: new fields.BooleanField({ required: true, initial: false }),
      /** The Capsule this Item is inside, by its Item id, or blank. */
      storedIn: new fields.StringField({ required: true, blank: true, initial: "" }),

      /**
       * A Clash it makes against whoever it catches: the Saving Throw on both sides, the
       * Condition winning leaves, and whether it lasts to the start or the end of the
       * thrower's next turn.
       */
      clash: new fields.SchemaField({
        save: new fields.StringField({ required: true, blank: true, initial: "" }),
        /** Or "strike": a Strike Clash, answered with a Strike or a Dodge - the Taser. */
        roll: new fields.StringField({ required: true, blank: true, initial: "" }),
        /** "melee" where the one aimed at has to be within the user's Melee Range. */
        reach: new fields.StringField({ required: true, blank: true, initial: "" }),
        condition: new fields.StringField({ required: true, blank: true, initial: "" }),
        until: new fields.StringField({ required: true, blank: true, initial: "" }),
        /** A mark that keeps the Condition from being removed, on the same clock. */
        hold: new fields.StringField({ required: true, blank: true, initial: "" })
      }),

      /** Made at a higher Craft DC for a longer reach, and whether it was - the Taser. */
      upgrade: new fields.SchemaField({
        craftDC: new fields.StringField({ required: true, blank: true, initial: "" }),
        reach: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
        chosen: new fields.BooleanField({ required: true, initial: false })
      }),

      /**
       * Thrown to catch someone - the Net: the Foundations its Strike may be made with, the
       * mark winning that Strike leaves, and the Condition winning the Might Clash after it.
       */
      snare: new fields.SchemaField({
        foundations: new fields.ArrayField(
          new fields.StringField({ required: true, blank: false }),
          { required: true, initial: () => [] }
        ),
        mark: new fields.StringField({ required: true, blank: true, initial: "" }),
        condition: new fields.StringField({ required: true, blank: true, initial: "" })
      }),

      /** The Conditions using it takes off - the Longevity Supplement's. */
      removes: new fields.ArrayField(
        new fields.StringField({ required: true, blank: false }),
        { required: true, initial: () => [] }
      ),
      /** The Life Points using it heals: dice, and the Tier they scale with - Medicine. */
      heal: new fields.SchemaField({
        dice: new fields.StringField({ required: true, blank: true, initial: "" }),
        scale: new fields.StringField({ required: true, blank: true, initial: "" }),
        /** Ki Points too, rolled for separately - the Snack. */
        ki: new fields.BooleanField({ required: true, initial: false })
      }),
      /** "You can only use this Basic Item once per Combat Encounter." */
      oncePerEncounter: new fields.BooleanField({ required: true, initial: false }),
      /** Used up when it is used. */
      consumed: new fields.BooleanField({ required: true, initial: false }),

      /** What it does to whoever moves through it, once it is on the ground - Caltrops. */
      hazard: new fields.SchemaField({
        dice: new fields.StringField({ required: true, blank: true, initial: "" }),
        scale: new fields.StringField({ required: true, blank: true, initial: "" }),
        sparesAirborne: new fields.BooleanField({ required: true, initial: false })
      })
    };
  }
}
