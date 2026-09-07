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
          // Which rule this hooks into, e.g. "soak" or "attackKiCost".
          key: new fields.StringField({ required: true, blank: true, initial: "" }),
          // Arguments for the rules that name something: a Defend option, one
          // Attribute, or the pair of Attributes a rule plays off each other.
          option: new fields.StringField({ required: true, blank: true, initial: "" }),
          attribute: new fields.StringField({ required: true, blank: true, initial: "" }),
          attributes: new fields.ArrayField(
            new fields.StringField({ required: true, blank: false }),
            { required: true, initial: [] }
          ),
          // A plain amount, for the effects written without a (T) or (bT).
          flat: new fields.NumberField({ required: true, integer: true, initial: 0 }),
          // The "x(T)" and "x(bT)" parts. Negative reduces.
          perTier: new fields.NumberField({ required: true, integer: true, initial: 0 }),
          perBaseTier: new fields.NumberField({ required: true, integer: true, initial: 0 }),
          // The "1d10(T)" form: this many of that die per Tier of Power.
          dicePerTier: new fields.StringField({ required: true, blank: true, initial: "" }),
          // Forced value for the rules that set one, such as a Base Die's result.
          value: new fields.NumberField({ required: true, integer: true, initial: 0 }),
          // How often a triggered effect may be used. Absent means no limit.
          limits: new fields.SchemaField({
            round: new fields.NumberField({ required: false, integer: true, nullable: true, initial: null }),
            encounter: new fields.NumberField({ required: false, integer: true, nullable: true, initial: null })
          }),
          // When the passive applies at all. Empty means always.
          condition: new fields.ObjectField({ required: true, initial: {} }),
          text: new fields.StringField({ required: true, blank: true, initial: "" })
        }),
        { required: true, initial: [] }
      )
    };
  }
}
