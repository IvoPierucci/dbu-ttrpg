const { fields } = foundry.data;

/**
 * A Transformation a character has access to - an Awakening, an Enhancement, a Form or an Evolved Stage (transformations.mjs).
 *
 * Only what is the character's own is kept here: whether it is in use, its Grade, Stacks, Higher Scales and Mastery, what was
 * chosen for it. What the rules say about it - its Aspects, its Attribute Modifier Bonuses, its Requirements, its text - is read
 * from its file every time it is prepared, as a Unique Ability's is, so a file put right reaches every character that has it.
 *
 * Its Transformation Traits are Racial Trait Items of their own (`system.transformation` this Item's id), made and taken away
 * with it.
 */
export default class DBUTransformationData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    const count = (initial, min = 0) => new fields.NumberField({ required: true, integer: true, min, initial });
    return {
      /** Its file's id: traits/transformations/<type>/<id>/<id>.dbu. */
      transformationId: new fields.StringField({ required: true, blank: true, initial: "" }),
      /** In use. Ticked by hand it is only that: its bonuses, Aspects and Traits - no Stress Test (the user's). */
      active: new fields.BooleanField({ required: true, initial: false }),
      /** Graded: the Grade it is in (G). */
      grade: count(1, 1),
      /** An Awakening's Stacks (Z). */
      stacks: count(1, 0),
      /** Scaling: the Higher Scales chosen as it was entered. */
      scales: count(0),
      /** How many times it was Mastered (M) - Difficult's levels and the Transcendent Trait's one in the same number. */
      mastery: count(0),
      /** A Transcendent Enhancement made Transcended as it was entered. */
      transcended: new fields.BooleanField({ required: true, initial: false }),
      /** Entered with Prelude. */
      prelude: new fields.BooleanField({ required: true, initial: false }),
      /** New Level of Power, ticked by the table. */
      newLevel: new fields.BooleanField({ required: true, initial: false }),
      /** A Temporary Awakening's level (1 or 2); 0 for one that is not. */
      temporary: count(0),
      /** How many of its Stacks are a Temporary Awakening's ("until the end of the Combat Encounter"). */
      temporaryStacks: count(0),
      /** What was chosen for it - an Option, a Trait of a group, an Attribute, a Save - by what was asked. */
      choices: new fields.ArrayField(new fields.SchemaField({
        key: new fields.StringField({ required: true, blank: true, initial: "" }),
        value: new fields.StringField({ required: true, blank: true, initial: "" })
      }), { required: true, initial: [] })
    };
  }
}
