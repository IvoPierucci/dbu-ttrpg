/**
 * Battle Weather.
 *
 * "Is it sunny, or is it pouring down destruction and kittens?"
 *
 * The frame, ahead of the Weathers themselves. What is here is the part of the rule that
 * is the same whichever Weather is in play - the three Tiers, how they stack, how one
 * replaces another, and who may take one away - kept in one place so that the tab which
 * lists it and whatever comes to read it are reading the same words.
 *
 * Nothing here is set on a character yet. A Battle Weather is a thing standing over some
 * number of Squares, and this system has no Squares - so when the Weathers arrive the
 * shape will be the one Light Level already has: the player says which one they are
 * standing in, and at what Tier, and the effects follow from that. The rest - how far it
 * reaches, which Squares it covers, whether the ARC put it over the whole Battlefield -
 * is the table's, as every area in these rules is.
 *
 * `weather.tiers` already exists in the Slot table, written by the Brace Maneuver and
 * said on the Combat tab rather than applied, because there has been nothing to apply it
 * to. It is the number this subsystem will read first.
 */

/**
 * The three Weather Tiers.
 *
 * "Each Tier gains the effects of the earlier Tiers", so a Weather at Cataclysmic is
 * doing everything it does at Natural and Unnatural as well - which is why they are
 * numbered rather than named alone, and why the number is the thing an effect multiplies
 * by.
 */
export const WEATHER_TIERS = Object.freeze([
  {
    tier: 1,
    name: "Natural",
    text: "This represents weather of an elevated degree, but nothing beyond what is "
        + "normal for a planet like Earth."
  },
  {
    tier: 2,
    name: "Unnatural",
    text: "This represents weather that may be supernatural in origin, or represent the "
        + "harsher weather patterns that may not seem natural to a planet."
  },
  {
    tier: 3,
    name: "Cataclysmic",
    text: "This represents weather that, if not controlled, could lead to planet-wide "
        + "disasters. Such weather may occur when a planet is being destroyed."
  }
]);

/** The highest Weather Tier there is. */
export const MAX_WEATHER_TIER = 3;

/**
 * The rules that hold whichever Weather is in play, in the rulebook's own words.
 *
 * Listed rather than built, every one of them, and each for its own reason:
 *
 *   Scale             - Squares and AoEs, which this system has none of
 *   Replacing         - a question about an area, asked of two Weathers at once
 *   Created Weather   - an Instant that removes a Weather from Squares you choose
 *   Connected Profiles- the Elemental Profiles are the Magic Profiles, which are on hold
 *
 * The one that is machinery rather than area is `(WT)`: a number multiplied by the Weather
 * Tier, the way `(T)` is multiplied by the Tier of Power. That is a notation the effects
 * language will need when the Weathers arrive, and it is the first thing to build then.
 */
export const WEATHER_RULES = Object.freeze([
  {
    key: "combining",
    name: "Combining",
    text: "Battle Weather effects can be combined in any fashion; you could have it "
        + "raining while a thick fog rolls in."
  },
  {
    key: "scale",
    name: "Scale",
    text: "Battle Weather can affect the whole area or just part of it. Traditionally, "
        + "Battle Weather created by the ARC will be used across the entire Battlefield - "
        + "but this isn't always the case, your ARC will specify the Battle Weather (if "
        + "relevant) when starting a Combat Encounter. Effects that create Battle Weathers "
        + "will specify how many Squares it covers, typically through an AoE. The effects "
        + "of any Battle Weather only apply if you are in the Squares that they influence."
  },
  {
    key: "tier",
    name: "Tier",
    text: "Weather comes in various levels, known as the Weather Tiers. Each Battle "
        + "Weather will have various effects that they apply depending on their Weather "
        + "Tier. Each Tier gains the effects of the earlier Tiers. If an effect has a "
        + "number with (WT) after it, this means that the number is multiplied by the "
        + "Weather Tier."
  },
  {
    key: "replacing",
    name: "Replacing Weathers",
    text: "Each Square can (with few exceptions) only have a single Battle Weather applied "
        + "to it. To place a Battle Weather in an area already affected by the Battle "
        + "Weather, the new Battle Weather must have a Weather Tier that matches or "
        + "exceeds the Weather Tier of the Battle Weather already present in that area."
  },
  {
    key: "created",
    name: "Created Weather",
    text: "If you have created a Battle Weather, you may remove it from the Battlefield as "
        + "an Instant Maneuver during your turn. You can choose which squares to remove it "
        + "from affecting, or choose to remove all instances of that Battle Weather you "
        + "have created."
  },
  {
    key: "profiles",
    name: "Connected Profiles",
    text: "Each Battle Weather is connected to a Profile with Elemental in the name. "
        + "Several Transformations and effects in the system will refer to this connection "
        + "between Battle Weather and Profile."
  }
]);

/** One Weather Tier by its number. */
export function weatherTier(tier) {
  return WEATHER_TIERS.find(entry => entry.tier === Number(tier)) ?? null;
}

/**
 * What a number written `(WT)` comes to at this Weather Tier.
 *
 * "If an effect has a number with (WT) after it, this means that the number is multiplied
 * by the Weather Tier." The same shape as `(T)` and `(bT)`, against a different number.
 *
 * Here now because the Tiers are, and because a Weather arriving with its effects should
 * find the multiplication already settled rather than settle it a sixth time. Nothing
 * calls it yet.
 */
export function perWeatherTier(multiplier, tier) {
  const entry = weatherTier(tier);
  if (!entry) return 0;
  return multiplier * entry.tier;
}
