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

import { traitAside } from "./aside.mjs";

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
export function lightLevelOf(system, getTrait = null, { treated = true } = {}) {
  const set = Number(system?.battlefield?.lightLevel) || 0;
  const shift = getTrait
    ? Object.entries(system?.conditions ?? {}).reduce((total, [key, stacks]) =>
      total + (Math.max(0, Number(stacks) || 0) * (Number(getTrait(key)?.lightShift) || 0)), 0)
    : 0;
  const level = Math.max(LIGHT_LEVEL_MIN, Math.min(LIGHT_LEVEL_MAX, set + shift));
  // Alternate Sight (1): "Treat the Light Level as if it was 1 level closer to Normal (0)" - its header's `lightTowardNormal`, on
  // a Trait or Talent held and applied (a Bestial Trait the Bestial Limit set aside, not).
  const items = Array.from(system?.parent?.items ?? []);
  // Or on an Option chosen on it - Weather Environment's Light. Not asked (`treated: false`), the Level as it is.
  const towardOf = id => Number(getTrait(id ?? "")?.lightTowardNormal) || 0;
  const toward = (getTrait && treated) ? items.filter(item => ["racial", "talent"].includes(item.type)
    && !traitAside(item, items, system?.parent))
    .reduce((sum, item) => sum + towardOf(item.flags?.["dbu-ttrpg"]?.sourceId)
      + (item.system?.chosen ?? []).filter(entry => entry.key === "option").reduce((more, entry) => more + towardOf(entry.value), 0), 0) : 0;
  return (level > 0) ? Math.max(0, level - toward) : Math.min(0, level + toward);
}
