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

/**
 * The High Environments: the sky, and above.
 *
 * "They are layered above the usual Battle Environments in the case of the first 3 ranks,
 * while the 4th rank functions differently."
 *
 * Layered above, so a character in one is over a Battle Environment rather than in it -
 * which the Soar Maneuver says outright from the other direction: leaving a High
 * Environment is "to leave the High Environment and enter the Battle Environment of the
 * Square they would be occupying". Entering it on the way down means not having been in it
 * on the way up.
 *
 * Rank 0 is not one of these. It is the absence of one - standing on the ground - and it
 * is what a character is in unless somebody says otherwise.
 */
export const HIGH_ENVIRONMENTS = Object.freeze([
  {
    rank: 1,
    name: "Low Sky",
    text: "This rank represents the general level that you see most airborne fights in "
        + "the Dragon Universe."
  },
  {
    rank: 2,
    name: "High Sky",
    text: "This rank represents the rare instances when battles can occur past the cloud "
        + "level; this rank is used to represent battles approaching the edge of space."
  },
  {
    rank: 3,
    name: "Local Space",
    text: "This rank represents battles that are in space, but still around a planet."
  },
  {
    rank: 4,
    name: "Deep Space",
    text: "This rank represents battles that occur in the depth of space.",
    // "While the 4th rank functions differently." How it differs is not stated yet, and
    // this is the note that says so rather than a guess wearing a rule's clothes.
    note: "The fourth rank functions differently from the first three. How is not in the "
        + "rules yet, so nothing here treats it as anything but the highest of them."
  }
]);

/** The highest High Environment there is. */
export const MAX_HIGH_ENVIRONMENT = 4;

/** Whether this character is off the ground. */
export function isAirborne(system) {
  return (Number(system?.battlefield?.highEnvironment) || 0) > 0;
}

/** One High Environment by its rank, or nothing for the ground. */
export function highEnvironment(rank) {
  return HIGH_ENVIRONMENTS.find(entry => entry.rank === Number(rank)) ?? null;
}

/**
 * The Environmental Qualities a character's Square has.
 *
 * "Qualities are applied on a Square-by-Square basis and ultimately decided by the ARC
 * unless an effect directly allows you to apply them."
 *
 * Two sources and they are added together. The Environment's own file may declare some -
 * "a certain Environment has elements that apply to every space", which is what the Lava
 * and Magma Environments' Aflame is - and the player ticks the rest, which is the ARC
 * having decided something about that Square in particular.
 *
 * The Environment's own are not tickable: they come with the ground and go when you leave
 * it. Written as one list so that everything downstream asks one question.
 */
export function qualitiesOf(system, environmentTrait) {
  const own = String(environmentTrait?.qualities ?? "")
    .split(",").map(id => id.trim()).filter(Boolean);
  const picked = Array.isArray(system?.battlefield?.qualities)
    ? system.battlefield.qualities.map(String)
    : [];
  return [...new Set([...own, ...picked])];
}

/**
 * The Hardness Rank of the ground, after the Qualities of the Square have had their say.
 *
 * Two of them touch it and they touch it differently, which is the distinction worth
 * keeping: Glass is "increasing its Hardness Rank by 1" - one harder than whatever is
 * under it - and Metallic is "it must have a Hardness Rank of 3+", which is a floor. Glass
 * over stone is harder than stone; metal is metal whatever was there before.
 *
 * So the shift is added and the floor is applied afterwards, and both are held inside the
 * Ranks that exist: glass over Katchin is still Rank 5 rather than a sixth Rank nobody
 * wrote.
 *
 * @param {number} rank        the Rank the ARC picked
 * @param {object[]} qualities the Quality Traits of this Square
 * @param {number} max         the highest Hardness Rank there is
 */
export function groundHardnessWith(rank, qualities, max) {
  const shift = qualities.reduce(
    (sum, quality) => sum + (Number(quality?.hardnessShift) || 0), 0);
  const floor = qualities.reduce(
    (lowest, quality) => Math.max(lowest, Number(quality?.hardnessMin) || 0), 0);

  return Math.min(max, Math.max(0, floor, (Number(rank) || 0) + shift));
}

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
