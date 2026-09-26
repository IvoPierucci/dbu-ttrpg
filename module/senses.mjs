/**
 * The senses a Check can rely on, where something moves its Natural Result for it -
 * "made relying on sight", "related to your hearing".
 *
 * Asked when the Check is rolled, and only then; `checked` is what the question starts
 * at, and most Perception is sight. A module of its own, imported by nothing it imports,
 * so the Slot list can name the senses without reaching for the data model.
 */
export const SENSES = Object.freeze({
  sight: { label: "Relying on sight", checked: true },
  hearing: { label: "Relying on hearing", checked: false }
});
