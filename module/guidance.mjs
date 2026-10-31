/**
 * The Angels' Guidance Range (Watchful Gaze (1)): "All Squares within a Sphere AoE (centered on you) are within your 'Guidance
 * Range'" - a Sphere of no Magnitude named, Standard; Huge with Attendant's Focus (1). Without Watchful Gaze, Angelic Guidance
 * reaches an adjacent Ally only.
 *
 * A Sphere "targets everything within a number of Squares from the Target Square (decided by Magnitude)" - the site's picture:
 * Minor 1, Standard 3, Large 4, Huge 5, Destructive 6. Counted here as the Squares between two tokens, 0 when adjacent - so a
 * Standard Sphere reaches whoever has 2 Squares or fewer between them and you.
 *
 * One import, itself of none - who is whose Ally (allies.mjs): the character's own data reads this as it is prepared
 * (Attendant's Focus (2)).
 */

import { areAllies, areOpponents } from "./allies.mjs";

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
 * The Oni's Area of Rule (Afterlife Officials (1)): "All Squares within a Sphere AoE (centered on you) are within your 'Area of Rule'" - a
 * Standard Sphere, a Magnitude larger for each `areaOfRule.magnitude` (Employed for Size's), Destructive at most - as the Squares there may
 * be between: its radius less one.
 */
export function areaOfRuleGap(actor) {
  const order = ["minor", "standard", "large", "huge", "destructive"];
  const steps = Math.round(Number(actor?.system?.effects?.slots?.["areaOfRule.magnitude"]?.add) || 0);
  const magnitude = order[Math.max(0, Math.min(order.length - 1, order.indexOf("standard") + steps))];
  return SPHERE_RADIUS[magnitude] - 1;
}

/** Those within someone's Area of Rule, not Defeated, but themselves - every one, an Ally or not; `test` narrows it. */
export function withinAreaOfRule(actor, test = () => true) {
  const from = tokenOf(actor);
  if (!from) return [];
  const gap = areaOfRuleGap(actor);
  return [...new Map((globalThis.canvas?.tokens?.placeables ?? [])
    .filter(token => token.actor && (token.actor.uuid !== actor.uuid) && !token.actor.system?.defeated && test(token.actor)
      && ((gapBetween(from.document ?? from, token.document ?? token) ?? 99) <= gap))
    .map(token => [token.actor.uuid, token.actor])).values()];
}

/**
 * The Opponents on the scene nearest to `actor` - not Defeated, of another side - every one at that fewest Squares between, where
 * several are (From the Stars (3)'s "the nearest Opponent"). None off a scene.
 */
export function nearestOpponents(actor) {
  const from = tokenOf(actor);
  if (!from) return [];
  const gaps = [...new Map((globalThis.canvas?.tokens?.placeables ?? [])
    .filter(token => token.actor && (token.actor.uuid !== actor.uuid) && !token.actor.system?.defeated && areOpponents(token.actor, actor))
    .map(token => [token.actor.uuid, { actor: token.actor, gap: gapBetween(from.document ?? from, token.document ?? token) }])).values()]
    .filter(entry => entry.gap !== null);
  const least = Math.min(...gaps.map(entry => entry.gap));
  return gaps.filter(entry => entry.gap === least).map(entry => entry.actor);
}

/**
 * The Opponents on the scene with `gap` Squares or fewer between them and `actor` - not Defeated, of another side. Bio-Berserker's Field
 * of Aggression (a Large Sphere: 3).
 */
export function opponentsWithin(actor, gap) {
  const from = tokenOf(actor);
  if (!from) return [];
  return [...new Map((globalThis.canvas?.tokens?.placeables ?? [])
    .filter(token => token.actor && (token.actor.uuid !== actor.uuid) && !token.actor.system?.defeated
      && areOpponents(token.actor, actor) && ((gapBetween(from.document ?? from, token.document ?? token) ?? 99) <= gap))
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
  if (!actor) return [];
  return [...new Map((globalThis.canvas?.tokens?.placeables ?? [])
    .filter(token => token.actor && (token.actor.uuid !== actor.uuid) && areAllies(token.actor, actor))
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
  if (!actor) return [];
  return [...new Map((globalThis.canvas?.tokens?.placeables ?? [])
    .filter(token => token.actor && (token.actor.uuid !== actor.uuid) && areAllies(token.actor, actor))
    .map(token => [token.actor.uuid, token.actor])).values()]
    .filter(holder => ((Number(holder.system?.states?.spectator) || 0) > 0) && (holder.system?.effects?.slots?.[slot] === true));
}

/** The Allies of `actor` on the scene, not Defeated, holding `slot`, with `gap` Squares or fewer between them - Party Tactics' Minor Sphere. */
export function alliesWithin(actor, slot, gap) {
  if (!actor) return [];
  return [...new Map((globalThis.canvas?.tokens?.placeables ?? [])
    .filter(token => token.actor && (token.actor.uuid !== actor.uuid) && areAllies(token.actor, actor))
    .map(token => [token.actor.uuid, token.actor])).values()]
    .filter(holder => !holder.system?.defeated && (holder.system?.effects?.slots?.[slot] === true) && withinGuidance(holder, actor, gap));
}

/** The Allies of `actor` on the scene, not Defeated, holding `slot` - wherever they stand (Feline Rally's "all of your Allies"). */
export function alliesHolding(actor, slot) {
  return alliesWithin(actor, slot, Infinity);
}

/** The Allies of `actor` on the scene, not Defeated, holding `slot`, with `actor` in their Area of Rule (Life Among the Dead's). */
export function alliesRuling(actor, slot) {
  return alliesWithin(actor, slot, Infinity).filter(holder => withinGuidance(holder, actor, areaOfRuleGap(holder)));
}

/** The Allies of `actor` on the scene, not Defeated, holding `slot`, with `actor` in their Melee Range (Kindhearted Saiyan's). */
export function alliesInMelee(actor, slot) {
  return alliesWithin(actor, slot, Infinity).filter(holder => withinGuidance(holder, actor, Math.max(0, Number(holder.system?.meleeRange) || 0)));
}
