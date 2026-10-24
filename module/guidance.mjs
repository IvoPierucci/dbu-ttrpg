/**
 * The Angels' Guidance Range (Watchful Gaze (1)): "All Squares within a Sphere AoE (centered on you) are within your 'Guidance
 * Range'" - a Sphere of no Magnitude named, Standard; Huge with Attendant's Focus (1). Without Watchful Gaze, Angelic Guidance
 * reaches an adjacent Ally only.
 *
 * A Sphere "targets everything within a number of Squares from the Target Square (decided by Magnitude)" - the site's picture:
 * Minor 1, Standard 3, Large 4, Huge 5, Destructive 6. Counted here as the Squares between two tokens, 0 when adjacent - so a
 * Standard Sphere reaches whoever has 2 Squares or fewer between them and you.
 *
 * No imports: the character's own data reads it as it is prepared (Attendant's Focus (2)).
 */

export const SPHERE_RADIUS = Object.freeze({ minor: 1, standard: 3, large: 4, huge: 5, destructive: 6 });

function tokenOf(actor) {
  return actor?.getActiveTokens?.(false, true)?.[0] ?? null;
}

/** The Squares between two tokens' footprints - 0 touching - or null off one scene. */
function gapBetween(a, b) {
  if (!a || !b || (a.parent?.id !== b.parent?.id)) return null;
  const grid = a.parent?.grid?.size ?? globalThis.canvas?.grid?.size;
  if (!grid) return null;
  const box = t => ({ x: t.x / grid, y: t.y / grid, w: t.width ?? 1, h: t.height ?? 1 });
  const one = box(a);
  const two = box(b);
  const gap = (p, q, pSize, qSize) => Math.max(0, Math.max(p - (q + qSize), q - (p + pSize)));
  return Math.max(Math.ceil(gap(one.x, two.x, one.w, two.w)), Math.ceil(gap(one.y, two.y, one.h, two.h)));
}

/**
 * The Opponents on the scene with `gap` Squares or fewer between them and `actor` - not Defeated, of another side. Bio-Berserker's Field
 * of Aggression (a Large Sphere: 3).
 */
export function opponentsWithin(actor, gap) {
  const from = tokenOf(actor);
  if (!from) return [];
  const side = from.document?.disposition ?? from.disposition;
  return [...new Map((globalThis.canvas?.tokens?.placeables ?? [])
    .filter(token => token.actor && (token.actor.uuid !== actor.uuid) && !token.actor.system?.defeated
      && ((token.document?.disposition ?? token.disposition) !== side) && ((gapBetween(from.document ?? from, token.document ?? token) ?? 99) <= gap))
    .map(token => [token.actor.uuid, token.actor])).values()];
}

/** The Guidance Range itself, as Squares between: a Standard Sphere, a Huge one with Attendant's Focus (1). */
export function guidanceRangeGap(holder) {
  const huge = holder?.system?.effects?.slots?.["guidance.huge"] === true;
  return SPHERE_RADIUS[huge ? "huge" : "standard"] - 1;
}

/** How far Angelic Guidance reaches: adjacent - or, with Watchful Gaze (2), the Guidance Range. */
export function guidanceGap(holder) {
  return (holder?.system?.effects?.slots?.["guidance.range"] === true) ? guidanceRangeGap(holder) : 0;
}

/** Whether `other` is within `gap` Squares of the holder. */
export function withinGuidance(holder, other, gap = guidanceGap(holder)) {
  const between = gapBetween(tokenOf(holder), tokenOf(other));
  return (between !== null) && (between <= gap);
}

/**
 * The Allies of `actor` on the scene, not Defeated, holding `slot`, who reach them: Angelic Guidance's reach, or - `range` - the
 * Guidance Range itself.
 */
export function guidingAllies(actor, slot, { range = false } = {}) {
  const own = tokenOf(actor)?.disposition;
  if (own === undefined) return [];
  return [...new Map((globalThis.canvas?.tokens?.placeables ?? [])
    .filter(token => token.actor && (token.actor.uuid !== actor.uuid) && (token.document?.disposition === own))
    .map(token => [token.actor.uuid, token.actor])).values()]
    .filter(holder => !holder.system?.defeated && (holder.system?.effects?.slots?.[slot] === true)
      && withinGuidance(holder, actor, range ? guidanceRangeGap(holder) : guidanceGap(holder)));
}

/** The best Tier among them - one bonus however many hold it (Double Dip). */
export function bestTier(holders) {
  return holders.reduce((top, holder) => Math.max(top, Number(holder.system?.tierOfPower) || 1), 0);
}

/** The Allies of `actor` on the scene in the Spectator State holding `slot` - Way of the Champion's, read by each Ally. */
export function spectatingAllies(actor, slot) {
  const own = tokenOf(actor)?.disposition;
  if (own === undefined) return [];
  return [...new Map((globalThis.canvas?.tokens?.placeables ?? [])
    .filter(token => token.actor && (token.actor.uuid !== actor.uuid) && (token.document?.disposition === own))
    .map(token => [token.actor.uuid, token.actor])).values()]
    .filter(holder => ((Number(holder.system?.states?.spectator) || 0) > 0) && (holder.system?.effects?.slots?.[slot] === true));
}

/** The Allies of `actor` on the scene, not Defeated, holding `slot`, with `gap` Squares or fewer between them - Party Tactics' Minor Sphere. */
export function alliesWithin(actor, slot, gap) {
  const own = tokenOf(actor)?.disposition;
  if (own === undefined) return [];
  return [...new Map((globalThis.canvas?.tokens?.placeables ?? [])
    .filter(token => token.actor && (token.actor.uuid !== actor.uuid) && (token.document?.disposition === own))
    .map(token => [token.actor.uuid, token.actor])).values()]
    .filter(holder => !holder.system?.defeated && (holder.system?.effects?.slots?.[slot] === true) && withinGuidance(holder, actor, gap));
}

/** The Allies of `actor` on the scene, not Defeated, holding `slot` - wherever they stand (Feline Rally's "all of your Allies"). */
export function alliesHolding(actor, slot) {
  return alliesWithin(actor, slot, Infinity);
}

/** The Allies of `actor` on the scene, not Defeated, holding `slot`, with `actor` in their Melee Range (Kindhearted Saiyan's). */
export function alliesInMelee(actor, slot) {
  return alliesWithin(actor, slot, Infinity).filter(holder => withinGuidance(holder, actor, Math.max(0, Number(holder.system?.meleeRange) || 0)));
}
