/**
 * Dice Categories.
 *
 * Every die that is not the Base Die sits on a scale of d4, d6, d8, d10. Raising a
 * die's Dice Category moves it up that scale, and past d10 it does not grow further:
 * a d4 is added alongside instead, and later increases climb that new die until it
 * too reaches d10 and another d4 joins it.
 *
 *   0: -   1: 1d4   2: 1d6   3: 1d8   4: 1d10
 *   5: 1d10+1d4     6: 1d10+1d6      7: 1d10+1d8      8: 2d10 ...
 *
 * Which makes a Category just a count of steps: every four steps completes another
 * d10, and the remainder is how far the trailing die has climbed.
 */

/** The trailing die at each position within a group of four steps. */
const STEP_FACES = [null, 4, 6, 8];

/** Category 0 is no die at all, which is why the Tier of Power 1 row is empty. */
export function categoryFormula(category) {
  if (category <= 0) return "";

  const tens = Math.floor(category / 4);
  const faces = STEP_FACES[category % 4];

  const parts = [];
  if (tens > 0) parts.push(`${tens}d10`);
  if (faces) parts.push(`1d${faces}`);
  return parts.join("+");
}

/** How many dice a Category rolls, for a compact readout. */
export function categoryDiceCount(category) {
  if (category <= 0) return 0;
  return Math.floor(category / 4) + ((category % 4) ? 1 : 0);
}

/**
 * Tier of Power Extra Dice: nothing at Tier 1, a d4 at Tier 2, and one Category per
 * Tier above that.
 */
export function tierExtraDiceCategory(tierOfPower) {
  return Math.max(0, tierOfPower - 1);
}

/**
 * Greater Dice work like Tier of Power Extra Dice but start a Category higher: a d4
 * already at Tier 1.
 */
export function greaterDiceCategory(tierOfPower) {
  return Math.max(0, tierOfPower);
}

/**
 * The most Categories an Extra Dice may be raised by, which is the Base Tier of
 * Power plus one. Energy Charges are exempt from this limit.
 */
export function maxCategoryIncrease(baseTierOfPower) {
  return baseTierOfPower + 1;
}
