/**
 * Light Levels: the range, and the Level a character is actually standing in.
 *
 * Two numbers can say where the light is now. The one the player set on the Battlefields
 * tab, and whatever has been done to it since - Elemental (Dark): "Any Squares occupied by
 * Character(s) who take Damage from this Attacking Maneuver have their Light Level reduced
 * by 1 Level until the start of your next turn."
 *
 * Kept apart rather than written into one field. The reduction runs out on somebody else's
 * clock, and a field the effect had lowered would have to be raised again at the end -
 * past whatever the player set it to in the meantime. So the player's number stays theirs,
 * the reduction is the Darkened mark with a clock on it, and the Level is read off both.
 */

export const LIGHT_LEVEL_MIN = -2;
export const LIGHT_LEVEL_MAX = 2;

/**
 * The Level this character is in: the one set, less a Level for each stack of Darkened,
 * and never past either end of the table - there is nothing darker than Pitch Black.
 */
export function lightLevelOf(system) {
  const set = Number(system?.battlefield?.lightLevel) || 0;
  const darkened = Math.max(0, Number(system?.conditions?.darkened) || 0);
  return Math.max(LIGHT_LEVEL_MIN, Math.min(LIGHT_LEVEL_MAX, set - darkened));
}
