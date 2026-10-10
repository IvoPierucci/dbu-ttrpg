const { fields } = foundry.data;

import DBUTalentData from "./item-talent.mjs";

/**
 * A Racial Trait, as an Item a character owns.
 *
 * Made from its file when it is added (racial.mjs racialItemFrom) and from then on the character's own: what it does is
 * its `script`, edited on its Effect tab exactly as a Talent's is, and changing it changes how it acts on that character
 * and on nobody else - the file is never touched (the user's ruling). Its Option chosen and any choice made are written
 * into that script when it is added, and recorded in `chosen` so a reader can see what was taken.
 *
 * A Talent's shape, and kept apart from Talents by its type: a Racial Trait sits on its own rung of the Priority ladder,
 * above a Talent.
 */
export default class DBURacialData extends DBUTalentData {

  static defineSchema() {
    return {
      ...super.defineSchema(),
      /** The race it belongs to - any race's may be taken (the user's ruling). */
      race: new fields.StringField({ required: true, blank: true, initial: "" }),
      /** "All Racial Traits are split between the Body and Mind Categories". */
      category: new fields.StringField({ required: true, blank: true, initial: "" }),
      /** "Primary or Secondary Traits" - a Subrace Trait is Primary. */
      importance: new fields.StringField({ required: true, blank: true, initial: "" }),
      /** The Subrace it belongs to, for a Subrace Trait. */
      subrace: new fields.StringField({ required: true, blank: true, initial: "" }),
      /** The Racial Factor it is a Factor Trait of - its id - for one; its race is then "". */
      factor: new fields.StringField({ required: true, blank: true, initial: "" }),
      /** An Other Trait's group - evolution, bestial, monstrous - for one: listed apart from the Racial Traits. */
      other: new fields.StringField({ required: true, blank: true, initial: "" }),
      /** What was chosen when it was added: its Option, and any choice its effects ask for. */
      chosen: new fields.ArrayField(new fields.SchemaField({
        key: new fields.StringField({ required: true, blank: true, initial: "" }),
        value: new fields.StringField({ required: true, blank: true, initial: "" }),
        label: new fields.StringField({ required: true, blank: true, initial: "" })
      }), { required: true, initial: [] })
    };
  }
}
