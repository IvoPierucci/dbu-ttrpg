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

      source: new fields.StringField({ required: true, blank: true, initial: "" })
    };
  }
}
