/**
 * Feature Qualities.
 *
 * "While generally, the material is decided by the ARC and then an appropriate Hardness
 * Rank is selected for that material, some Features may possess Feature Qualities (once
 * again decided by the ARC)."
 *
 * So a Quality is never a thing this system holds: it belongs to a Feature, and a Feature
 * is the ARC's - it has Squares, a shape, a material and Life Points, and none of those
 * are things anything here keeps. What this file is, then, is the text, kept in one place
 * so that the tab that lists them and the dialog that asks which one applied are reading
 * the same words.
 *
 * Six of the ten do something at the moment somebody takes Collision Damage, which is the
 * one moment in all of this that the system does resolve - it takes the Life Points off.
 * Those six carry a `collision` entry saying what, and are the ones offered when the
 * damage is applied. The other four are about the Feature itself - how much Life it has,
 * what happens when it is destroyed, what bounces off it - and there is nothing here for
 * them to act on, so they are listed and left alone.
 */

/**
 * What a Quality does to a collision, where it does anything.
 *
 *   halves    - the Collision Damage is halved. Folded in with every other halving and
 *               the Launching doubling, and rounded once at the end.
 *   condition - a Combat Condition gained, by key and by stacks.
 *   dot       - stacks of Damage Over Time gained.
 *
 * Each of the three durations here is written the same way: "for 1 Combat Round (ending
 * on the end of this turn, next Combat Round)". Which is the end edge of the turn being
 * played now, one Combat Round from now - so the clock is kept by whoever is taking that
 * turn, not by whoever is hurt.
 *
 * `manual` is the half the table settles: this system moves nobody, so Rubbery's Squares
 * and Fragile's continued movement are said and not done.
 */
export const FEATURE_QUALITIES = Object.freeze([
  {
    key: "rubbery",
    name: "Rubbery",
    text: "If you would Collide with this Feature, halve the amount of Collision Damage "
        + "you would receive and then move a number of Squares equal to the Hardness "
        + "Value directly away from the Feature in a straight line. You can only apply "
        + "this effect once per Combat Round on each individual Feature.",
    collision: {
      halves: true,
      manual: "then move Hardness Value Squares straight away from it. Once per Combat "
            + "Round on each individual Feature - which is the table's to remember."
    }
  },
  {
    key: "fragile",
    name: "Fragile",
    text: "If you Collide with this Feature, it is destroyed regardless of its Hardness "
        + "Rank, halve the Collision Damage you take and you continue your movement. If "
        + "you have already hit a Fragile Feature during this movement, cease your "
        + "movement as usual upon colliding with the second Fragile Feature (it is still "
        + "destroyed).",
    collision: {
      halves: true,
      manual: "the Feature is destroyed whatever its Hardness Rank, and the movement "
            + "carries on - unless this is the second Fragile Feature of that movement."
    }
  },
  {
    key: "splintering",
    name: "Splintering",
    text: "If this Feature is destroyed, all Characters within a Minor Sphere AoE "
        + "(centered on this Feature) receive Collision Damage equal to its Hardness "
        + "Value.",
    // Not offered below. It is not something that happens to whoever collided - it is a
    // second helping of Collision Damage handed to an area, and an area is the table's.
    // Somebody caught by it is taking Collision Damage from this Feature, so a Feature
    // that is also Burning, Shocking or Sharp catches them with that too.
    note: "Damage to an area rather than to the one who collided. Whoever is caught is "
        + "taking Collision Damage from this Feature, so its other Qualities catch them."
  },
  {
    key: "burning",
    name: "Burning",
    text: "If you receive Collision Damage from this Feature, gain a stack of the Broken "
        + "Combat Condition for 1 Combat Round (ending on the end of this turn, next "
        + "Combat Round).",
    collision: { condition: "broken", stacks: 1 }
  },
  {
    key: "shocking",
    name: "Shocking",
    text: "If you receive Collision Damage from this Feature, suffer from the Impediment "
        + "Combat Condition for 1 Combat Round (ending on the end of this turn, next "
        + "Combat Round).",
    collision: { condition: "impediment", stacks: 1 }
  },
  {
    key: "sharp",
    name: "Sharp",
    text: "If you receive Collision Damage from this Feature, gain 2 stacks of Damage "
        + "Over Time for 1 Combat Round (ending on the end of this turn, next Combat "
        + "Round).",
    collision: { dot: 2 }
  },
  {
    key: "resilient",
    name: "Resilient",
    text: "Double the Life Points of this Feature. Additionally, anyone benefiting from "
        + "Cover due to this Feature may reduce the Damage they suffer by the Hardness "
        + "Value of this Feature, even if hit by an Attacking Maneuver that possesses an "
        + "AoE.",
    // The Cover half is the Battlefields tab's toggle, which is already turned on by
    // hand and already refuses nothing - so this is a reason to leave it on rather than
    // a number to change.
    note: "Cover behind it holds against an Area of Effect too: leave the Cover toggle "
        + "on for that attack."
  },
  {
    key: "metallic",
    name: "Metallic",
    text: "This Feature is made of metal. It must have a Hardness Rank of 3+. If this "
        + "Feature Quality is applied through an effect, remove all other Feature "
        + "Qualities on this Feature."
  },
  {
    key: "reflective",
    name: "Reflective",
    text: "If an Attacking Maneuver of the Energy Foundation or the Elemental (Light) "
        + "Profile fails to hit you while you are in Cover behind this Feature, you may "
        + "roll Strike against an Opponent of your choice using the Profile of the "
        + "initial Attacking Maneuver. If they are hit, the original attacking Character "
        + "rolls the Wound Roll for their initial Attacking Maneuver instead as an Urgent "
        + "Roll, including any Ki Wagers and Energy Charges included on that Attacking "
        + "Maneuver. Damage calculation occurs as usual from this point."
  },
  {
    key: "glass",
    name: "Glass",
    text: "This Feature is encased in glass, increasing its Hardness Rank by 1. If this "
        + "Feature Quality is applied through an effect, remove all other Feature "
        + "Qualities on this Feature."
  }
]);

/** The ones that do something the moment Collision Damage lands, in the order above. */
export const COLLISION_QUALITIES = Object.freeze(
  FEATURE_QUALITIES.filter(quality => quality.collision));

/** One Quality by key, or nothing. */
export function featureQuality(key) {
  return FEATURE_QUALITIES.find(quality => quality.key === key) ?? null;
}

/**
 * Hardness.
 *
 * "Hardness represents the resilience of Features and how much they would hurt to be
 * knocked into it or struck with." Two numbers wearing one name, which is the whole
 * difficulty of it:
 *
 *   Hardness Rank  - what the Feature is made of, 0 to 5. It is also the Feature's Life
 *                    Points, which are the table's to keep.
 *   Hardness Value - what colliding with it costs, in square brackets in the entry, and
 *                    scaling with the base Tier of Power of whoever hit it.
 *
 * "The easiest way to remember it is that (aside from Hardness Rank 0), the Hardness
 * Value is twice the Hardness Rank multiplied by the base Tier of Power of the Character
 * who is suffering the Collision Damage." Rank 0 is the exception and is 1(bT), not
 * nothing - sand and the surface of water still cost something to hit.
 *
 * So the Value is not a property of the Feature at all. The same wall costs two
 * characters two different numbers, which is why the collision dialog works it out from
 * whoever is taking the damage rather than storing it anywhere.
 */
export const HARDNESS_RANKS = Object.freeze([
  {
    rank: 0,
    perBaseTier: 1,
    // `material` is the entry's own nouns, short enough to read in a dropdown. The rule is
    // `text`, which is what the tab prints and what the picker carries on hover - a line
    // that has to be scrolled sideways to be read is a line nobody reads.
    material: "sand, the surface of water",
    text: "This Hardness Rank represents substances that are not structurally sound, such "
        + "as sand or the surface of water. Features cannot have a Hardness value of 0, "
        + "but the Squares themselves can."
  },
  {
    rank: 1,
    perBaseTier: 2,
    material: "wood, gravel",
    text: "This Hardness Rank represents structures made of wood or a collection of "
        + "harder substances, like gravel."
  },
  {
    rank: 2,
    perBaseTier: 4,
    material: "stone, bone, cement",
    text: "This Hardness Rank represents structures made of stone, bone or cement."
  },
  {
    rank: 3,
    perBaseTier: 6,
    material: "metal, resilient stone",
    text: "This Hardness Rank represents structures made of metal or more resilient stone."
  },
  {
    rank: 4,
    perBaseTier: 8,
    material: "reinforced metals",
    text: "This Hardness Rank represents structures that are made from reinforced metals."
  },
  {
    rank: 5,
    perBaseTier: 10,
    material: "Katchin, or its equal",
    text: "This Hardness Rank represents structures forged of Katchin, the strongest metal "
        + "in the universe, or other comparable materials."
  }
]);

/**
 * What Collision Damage is, in one sentence, so that nothing has to work it out twice.
 *
 * "Collision Damage: reduce your Life Points by the Hardness Value of the Feature you
 * Collided with (see - Hardness)."
 *
 * Which settles the thing the window is built on: the Hardness Value is not something the
 * Collision Damage is derived from, it is the Collision Damage. There is no second step
 * and nothing to add to it - so picking the Rank is picking the number, and the only
 * things between the two are the doublings and halvings that other rules hand it.
 */
export const COLLISION_DAMAGE = "Collision Damage: reduce your Life Points by the "
  + "Hardness Value of the Feature you Collided with (see - Hardness).";

/**
 * What a Feature of this Hardness Rank costs this character to hit.
 *
 * Twice the Rank a base Tier, except at Rank 0, which is 1(bT) - so the multiplier is
 * carried on the entry rather than worked out, and the exception is data instead of an
 * `if`.
 */
export function hardnessValue(rank, baseTierOfPower) {
  const entry = HARDNESS_RANKS.find(hardness => hardness.rank === Number(rank));
  if (!entry) return 0;
  return entry.perBaseTier * Math.max(1, Number(baseTierOfPower) || 1);
}
