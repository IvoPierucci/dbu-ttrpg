/**
 * Light Levels: the range, and the Level a character is actually standing in.
 *
 * Two numbers can say where the light is now. The one the player set on the Battlefields
 * tab, and whatever has been done to it since - Elemental (Dark): "Any Squares occupied by
 * Character(s) who take Damage from this Attacking Maneuver have their Light Level reduced
 * by 1 Level until the start of your next turn", and Elemental (Light), which raises it.
 *
 * Kept apart rather than written into one field. The change runs out on somebody else's
 * clock, and a field the effect had moved would have to be moved back at the end - past
 * whatever the player set it to in the meantime. So the player's number stays theirs, each
 * change is a mark with a clock on it, and the Level is read off both.
 */

export const LIGHT_LEVEL_MIN = -2;
export const LIGHT_LEVEL_MAX = 2;

/**
 * The Level this character is in: the one set, moved a Level per stack of every mark whose
 * file says `lightShift:`, and never past either end of the table.
 *
 * Which marks move it, and which way, is in their files - Darkened is -1, Brightened +1 -
 * so no mark is named here. Handed the Trait lookup, as `qualitiesOf` is; without one there
 * are no headers to read and the Level is the one set.
 */
export function lightLevelOf(system, getTrait = null) {
  const set = Number(system?.battlefield?.lightLevel) || 0;
  const shift = getTrait
    ? Object.entries(system?.conditions ?? {}).reduce((total, [key, stacks]) =>
      total + (Math.max(0, Number(stacks) || 0) * (Number(getTrait(key)?.lightShift) || 0)), 0)
    : 0;
  return Math.max(LIGHT_LEVEL_MIN, Math.min(LIGHT_LEVEL_MAX, set + shift));
}
