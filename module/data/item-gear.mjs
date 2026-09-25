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

      /** Whether it is a Capsule, which holds one Basic Item. */
      capsule: new fields.BooleanField({ required: true, initial: false }),
      /** The Capsule this Item is inside, by its Item id, or blank. */
      storedIn: new fields.StringField({ required: true, blank: true, initial: "" }),

      /** What it does to whoever moves through it, once it is on the ground - Caltrops. */
      hazard: new fields.SchemaField({
        dice: new fields.StringField({ required: true, blank: true, initial: "" }),
        scale: new fields.StringField({ required: true, blank: true, initial: "" }),
        sparesAirborne: new fields.BooleanField({ required: true, initial: false })
      })
    };
  }
}
