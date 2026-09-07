const { fields } = foundry.data;

/**
 * A Talent, as an Item a character owns.
 *
 * Its passives are typed entries rather than prose: `key` names the rule the entry
 * hooks into and the rest are its arguments, so a Talent that reuses an existing rule
 * needs no code at all. `text` is the wording from the book, kept alongside so the
 * sheet can show what the entry is meant to say.
 */
export default class DBUTalentData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {
      description: new fields.HTMLField({ required: true, blank: true, initial: "" }),
      prerequisites: new fields.StringField({ required: true, blank: true, initial: "" }),

      effects: new fields.ArrayField(
        new fields.SchemaField({
          // Which rule this hooks into, e.g. "defendOptionCost" or "soakWhenDefending".
          key: new fields.StringField({ required: true, blank: true, initial: "" }),
          // Argument for rules that name one, such as which Defend option is affected.
          option: new fields.StringField({ required: true, blank: true, initial: "" }),
          // The "x(T)" part: how much per Tier of Power, negative to reduce.
          perTier: new fields.NumberField({ required: true, integer: true, initial: 0 }),
          text: new fields.StringField({ required: true, blank: true, initial: "" })
        }),
        { required: true, initial: [] }
      )
    };
  }
}
