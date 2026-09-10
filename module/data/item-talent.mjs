const { fields } = foundry.data;

import { legacyToProgram } from "../effects/migrate.mjs";
import { decompile } from "../effects/decompile.mjs";

/**
 * A Talent, as an Item a character owns.
 *
 * What it does lives in `script`, written in the small language this system uses for
 * rules. `text` is the wording from the book, kept alongside: a script is precise but
 * does not read like a rule, and generated prose would never sound like the book.
 *
 * `effects` is what Talents used to carry - typed data rows, one per rule, with the
 * meaning of each `key` living in whatever code consumed it. It is kept only so that
 * Talents written before the language existed still work, and `migrateData` turns them
 * into a script on the way in.
 */
export default class DBUTalentData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {
      description: new fields.HTMLField({ required: true, blank: true, initial: "" }),
      prerequisites: new fields.StringField({ required: true, blank: true, initial: "" }),

      /** What the Talent does. */
      script: new fields.StringField({ required: true, blank: true, initial: "" }),

      /** The book's own wording, shown to players. */
      text: new fields.StringField({ required: true, blank: true, initial: "" }),

      /** An Addendum's separate explanation, when the effect carries one. */
      addendum: new fields.StringField({ required: true, blank: true, initial: "" }),

      // --- Deprecated -------------------------------------------------------
      // The old typed rows. Nothing writes these any more; they are read once by
      // migrateData and otherwise left alone, so reverting the system loses nothing.
      effects: new fields.ArrayField(
        new fields.SchemaField({
          key: new fields.StringField({ required: true, blank: true, initial: "" }),
          option: new fields.StringField({ required: true, blank: true, initial: "" }),
          attribute: new fields.StringField({ required: true, blank: true, initial: "" }),
          attributes: new fields.ArrayField(
            new fields.StringField({ required: true, blank: false }),
            { required: true, initial: [] }
          ),
          flat: new fields.NumberField({ required: true, integer: true, initial: 0 }),
          perTier: new fields.NumberField({ required: true, integer: true, initial: 0 }),
          perBaseTier: new fields.NumberField({ required: true, integer: true, initial: 0 }),
          dicePerTier: new fields.StringField({ required: true, blank: true, initial: "" }),
          value: new fields.NumberField({ required: true, integer: true, initial: 0 }),
          limits: new fields.SchemaField({
            round: new fields.NumberField({ required: false, integer: true, nullable: true, initial: null }),
            encounter: new fields.NumberField({ required: false, integer: true, nullable: true, initial: null })
          }),
          condition: new fields.ObjectField({ required: true, initial: {} }),
          text: new fields.StringField({ required: true, blank: true, initial: "" })
        }),
        { required: true, initial: [] }
      )
    };
  }

  /**
   * Give a Talent written in the old form a script, on the way in.
   *
   * This runs on the document source before anything reads it, so **every Talent
   * already owned by every character keeps working with nothing written and nothing for
   * anyone to run**. It is the safety net that makes the one-shot migration optional
   * rather than urgent.
   */
  static migrateData(source) {
    if (source?.script) return super.migrateData(source);
    if (!source?.effects?.length) return super.migrateData(source);

    const program = legacyToProgram(source.effects);
    if (program.blocks.length) source.script = decompile(program);

    // The rows carried the book's wording one per effect; joined, it is the Talent's.
    if (!source.text) {
      source.text = source.effects.map(row => row.text).filter(Boolean).join("\n");
    }

    return super.migrateData(source);
  }
}
