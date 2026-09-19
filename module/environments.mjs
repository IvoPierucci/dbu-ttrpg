/**
 * Battle Environments.
 *
 * "The Battle Environment in DBU represents the very land you stand on and other
 * influences to Battlefields beyond just the weather."
 *
 * The frame, ahead of the Environments themselves. The shape is the one Battle Weather
 * already has and for the same reason: an Environment covers some number of Squares, this
 * system has none, so the player says which one they are standing in and the rest - where
 * the water ends and the land begins - is the table's.
 *
 * Where it differs from a Weather is that there is no "none". A character is always
 * standing on something, and what they are standing on is the Standard Environment unless
 * somebody says otherwise. So the picker has no blank and the schema has a default with a
 * file behind it, rather than an empty string meaning nothing is in play.
 *
 * And there are no Tiers. A Weather comes in three strengths and an Environment does not:
 * you are underwater or you are not.
 */

/** What a character is standing on when nobody has said otherwise. */
export const STANDARD_ENVIRONMENT = "standard-environment";

/**
 * The rules that hold whichever Environment is in play, in the rulebook's own words.
 *
 * Both are about Squares, which is to say both are the table's: one says an Environment
 * may cover part of a Battlefield rather than all of it, and the other is about a Maneuver
 * that moves you between them.
 */
export const ENVIRONMENT_RULES = Object.freeze([
  {
    key: "entering",
    name: "Entering and Leaving Environments",
    text: "Environments may cover an entire Battlefield, but they also may not. For "
        + "example, a Battlefield may have both land (Standard Environment) and water "
        + "(Underwater Environment). If a Character enters any Squares that are designated "
        + "as the Underwater Environment, they will therefore enter that Environment."
  },
  {
    key: "soar",
    name: "Soar Maneuver and Environments",
    text: "While not in a High Environment, the Soar Maneuver can be used to enter the Low "
        + "Sky Environment. While in the High Environment, the Soar Maneuver can be used "
        + "to move up/down 1 rank of High Environment, or (if in the Low Sky Environment) "
        + "to leave the High Environment and enter the Battle Environment of the Square "
        + "they would be occupying.",
    // Listed and not built, at the table's request and because there is nothing to build
    // it out of: the High Environments are not in the system yet and neither is the Soar
    // Maneuver, which is named by Staggered and by a Slot and has no file of its own.
    note: "The High Environments and the Soar Maneuver are both still to come. Changing "
        + "Environment is picking a different one here."
  }
]);
