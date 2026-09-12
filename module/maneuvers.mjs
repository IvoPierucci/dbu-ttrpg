import { applySlot } from "./effects/interpreter.mjs";
import { printedLines, traitsOfKind } from "./effects/traits.mjs";
import { featureAsks } from "./signature.mjs";

/**
 * Maneuvers: anything that spends an Action.
 *
 * Every Maneuver carries an Action Cost (which type of Action, and how many) and a
 * Ki Point cost, and some may only be used a limited number of times per Combat
 * Round or per Combat Encounter - written in their name as [x/Round] or
 * [x/Encounter].
 *
 * Nothing consumes this yet; it is the shared vocabulary the combat rules are built
 * on, kept in one place so the timing rules are stated once rather than restated at
 * each call site.
 *
 * @typedef {object} ManeuverDefinition
 * @property {string} name
 * @property {keyof MANEUVER_TYPES} type
 * @property {number} actionCost   How many Actions of the type's Action are spent.
 * @property {number} kiCost       Ki Points spent to use it.
 * @property {boolean} attacking  Whether it is an Attack, which is what Counter
 *                                Maneuvers may be used in response to.
 * @property {string} source      Where the Maneuver comes from - "Core Rule" for the
 *                                ones everyone has, and later a Talent, race or
 *                                Transformation for the rest.
 * @property {?{amount: number, per: "round"|"encounter"}} usageLimit
 * @property {boolean} requiresTarget  Whether a token must be targeted to use it.
 * @property {?{skill: string}} clash  Makes this a Skill Clash: both sides roll the
 *                                     named Skill and the higher total wins.
 * @property {?string} profile     Attack Profile, for an attacking Maneuver: a
 *                                 Profile id, or "any" to choose freely. Its
 *                                 Foundation is chosen when the attack is declared.
 */

/**
 * The four types of Maneuver. `action` names the Action a Maneuver of that type
 * spends; the types that resolve outside the Action economy spend none.
 */
export const MANEUVER_TYPES = Object.freeze({
  standard: {
    label: "Standard",
    action: "standard",
    /** Only on your own turn. */
    ownTurnOnly: true,
    /**
     * The default: a Maneuver is Standard unless it says otherwise.
     */
    isDefault: true
  },

  counter: {
    label: "Counter",
    action: "counter",
    ownTurnOnly: false,
    /**
     * Defensive. Unusable unless you are the target of an Attacking Maneuver, unless
     * the Maneuver itself says otherwise.
     */
    requiresBeingTargeted: true
  },

  instant: {
    label: "Instant",
    action: null,
    ownTurnOnly: false,
    /**
     * Occurs on any character's turn, between Standard Maneuvers - either after one
     * or in response to one, resolving before it.
     *
     * Two restrictions that a combat tracker has to enforce, since neither is
     * visible from the Maneuver itself:
     *  - it may only respond to a Standard Maneuver, never to any other type;
     *  - it may not be used if your previous Maneuver this turn was also an Instant,
     *    including when that Instant's effects led to another Maneuver being used.
     *
     * A Maneuver used "as an Instant Maneuver" ignores its usual Action Cost.
     */
    respondsTo: ["standard"]
  },

  outOfSequence: {
    label: "Out-of-Sequence",
    action: null,
    ownTurnOnly: false,
    /**
     * Resolves the moment its effect occurs, pausing every Maneuver already in
     * progress until it finishes. Counter Maneuvers and effects may still respond to
     * it as normal.
     *
     * Only one may occur from a single trigger: two effects that both fire on the
     * same trigger are a choice between them, not both.
     *
     * A Maneuver used "as an Out-of-Sequence Maneuver" ignores its usual timing and
     * Action Cost.
     */
    onePerTrigger: true
  }
});

/**
 * Attack Profiles. A Profile belongs to one or more Foundations, and each carries an
 * effect of its own - none of which are implemented yet.
 *
 * A Profile available in several Foundations does not fix which one an attack uses:
 * the Foundation is declared alongside the Profile when the attack is made, and it
 * is what decides the Damage Attribute behind the Wound roll.
 */
/**
 * How much of the target's Soak Value stands between them and the damage. A Profile
 * declares one, and it is what makes two attacks of the same Wound land differently.
 *
 * Each is numbered, because a Damage Category is arrived at by arithmetic: every
 * effect that raises or lowers it contributes a step, they are summed, and only the
 * sum is clamped. Clamping as you go would lose the difference between a Category
 * pushed to the ceiling and one pushed well past it - a +3 answered by a -2 must land
 * on Direct, not back on Standard.
 */
export const DAMAGE_CATEGORIES = Object.freeze({
  standard: { value: 1, label: "Standard", soakMultiplier: 1, summary: "Defended against with the full Soak Value." },
  direct: { value: 2, label: "Direct", soakMultiplier: 0.5, summary: "Ignores half of the Soak Value." },
  lethal: { value: 3, label: "Lethal", soakMultiplier: 0, summary: "Ignores the Soak Value entirely." }
});

const DAMAGE_CATEGORY_MIN = 1;
const DAMAGE_CATEGORY_MAX = 3;

/**
 * The Damage Category an attack ends up at: its Profile's, moved by the total of every
 * step for and against it, and only then held within range.
 */
export function resolveDamageCategory(baseCategory, shift = 0) {
  const base = DAMAGE_CATEGORIES[baseCategory]?.value ?? DAMAGE_CATEGORY_MIN;
  const value = Math.min(DAMAGE_CATEGORY_MAX, Math.max(DAMAGE_CATEGORY_MIN, base + shift));
  return Object.keys(DAMAGE_CATEGORIES).find(key => DAMAGE_CATEGORIES[key].value === value);
}

/**
 * The Profiles an Attacking Maneuver can be made with.
 *
 * `kiCost` is flat; `kiCostPerTier` is the "4(T)" notation and grows with the Tier of
 * Power, which is how every Profile but Simple is priced. Both are added to the
 * Maneuver's own cost - a Profile is what an attack pays for.
 *
 * `needs` names machinery a Profile leans on that the system does not have yet. It is
 * carried rather than left out so the Profile can still be chosen, priced and thrown:
 * what it says here is shown when it is picked, so nobody discovers at the table that
 * half of it did nothing.
 */
export const PROFILES = Object.freeze({
  // --- Multi-Foundation -----------------------------------------------------
  // "Profiles that don't belong to a specific Foundation. When using any of these, you
  // can decide which of the Foundations that Profile belongs to for the duration of
  // that Attacking Maneuver, including all the rules that are applied to Profiles of
  // that Foundation and using their Damage Attribute."
  //
  // That is already how the system reads them: the Foundation is chosen when the attack
  // is declared, the Damage Attribute follows from it, and the Foundation's own rules
  // are keyed off the Foundation rather than off the Profile - so a Simple attack
  // declared as Physical is bound by Melee Range exactly as a Crushing one is.

  simple: {
    label: "Simple",
    foundations: ["physical", "energy", "magic"],
    kiCost: 0,
    damageCategory: "standard",
    text: `
      Simple: A simple punch, kick, energy ball, or spell.
      –Foundations: All
      –Damage Category: Standard
      –KP Cost: 0
      –Effect: None.`,
  },

  combination: {
    label: "Combination",
    foundations: ["physical", "energy", "magic"],
    kiCostPerTier: 3,
    damageCategory: "standard",
    text: `
      Combination: A combination of several attacks done in sequence.
      –Foundations: All
      –Damage Category: Standard
      –KP Cost: 3(T)
      –Effect: After you hit an Opponent with this Attacking Maneuver but before
      you roll your Wound Roll, roll your Strike Roll for this Attacking Maneuver
      against the Dice Score of their Dodge Roll or Strike Roll (if they used the
      Parry option of the Defend Maneuver) an additional 3 times. For every additional
      time your Strike Roll exceeds their Dice Score, increase the Wound Roll by an
      additional 2(T).`,
    // Three more Strike Rolls after the hit and before the Wound Roll, each measured
    // against the defence the target already made - the same roll that lost the first
    // Clash, bonuses and all.
    followUps: { rolls: 3, woundPerHitPerTier: 2 },
  },

  launching: {
    label: "Launching",
    foundations: ["physical", "energy", "magic"],
    kiCostPerTier: 3,
    damageCategory: "standard",
    text: `
      Launching: An attack that sends enemies flying away from you.
      –Foundations: All
      –Damage Category: Standard
      –KP Cost: 3(T)
      –Effect: This Profile has multiple effects:
      * This Attacking Maneuver gains the Knockback Advantage for free (this does not
        increase the KP Cost, or the TP Cost if it is a Signature Technique).
      * Double any Collision Damage a Character suffers due to any movement resulting
        from this Attacking Maneuver's use of the Knockback Advantage.`,
    grantsAdvantage: "knockback",
    doublesCollisionDamage: true,
  },

  megaFlare: {
    label: "Mega Flare",
    foundations: ["physical", "energy", "magic"],
    kiCostPerTier: 4,
    damageCategory: "standard",
    text: `
      Mega Flare: By focusing as much energy as possible, this attack is highly
      destructive.
      –Foundations: All
      –Damage Category: Standard
      –KP Cost: 4(T)
      –Effect: This Profile has multiple effects:
      * The maximum number of Energy Charges for this Profile is 10.
      * For every Energy Charge applied to this Attacking Maneuver, increase the Wound
        Roll by 1(T).
      * If the number of Energy Charges applied to this Attacking Maneuver is 7+,
        increase the Damage Category by 1 Category.`,
    maxEnergyCharges: 10,
    woundPerChargePerTier: 1,
    categoryUpAtCharges: 7,
  },

  // --- Physical -------------------------------------------------------------
  // Every one of these is bound by the Foundation's own rule: a Physical Attack can
  // only be made against an Opponent within your Melee Range.

  blitz: {
    label: "Blitz",
    foundations: ["physical"],
    kiCostPerTier: 4,
    damageCategory: "standard",
    text: `
      Blitz: An attack made as part of a high-speed charge.
      –Damage Category: Standard
      –KP Cost: 4(T)
      –Effect: This Profile has multiple effects:
      * This Attacking Maneuver gains the Charging Assault Advantage for free (this
        does not increase the KP Cost, or the TP Cost if it is a Signature Technique).
      * If you move a number of Squares that exceeds your Normal Speed due to the
        effects of Charging Assault, increase the Wound Roll of that Attacking
        Maneuver by 1/2 of your Agility Modifier.
      * If this Attacking Maneuver is a Signature Technique, reduce the KP Cost by
        2(T).`,
    // "Gains the Charging Assault Advantage for free", and a Wound bonus of half your
    // Agility Modifier when that Advantage carried you past your Normal Speed.
    signatureDiscountPerTier: 2,
    // Named rather than restated. Charging Assault is a Signature Technique Advantage
    // in its own right, worth 10 TP to buy - this Profile is one way to it and a
    // Technique that bought it is another, and neither knows about the other. What they
    // share is the number the charge covered, and nothing else.
    grantsAdvantage: "charging-assault",
    // "If you move a number of Squares that exceeds your Normal Speed due to the
    // effects of Charging Assault", which is this Profile's own rule about somebody
    // else's Advantage - so it lives here, keyed off the same number.
    woundPerCharge: "halfAgilityBeyondNormalSpeed",
  },

  crushing: {
    label: "Crushing",
    foundations: ["physical"],
    kiCostPerTier: 6,
    damageCategory: "lethal",
    text: `
      Crushing: A heavy strike with the intent to break bones or cause internal damage.
      –Damage Category: Lethal
      –KP Cost: 6(T)
      –Effect: Only apply half of your Haste to the Strike Roll for this Attacking
      Maneuver.`,
    // Strike is Haste + Awareness, so this is a penalty of half the Haste that went
    // into it - taken off the roll rather than rebuilt, so anything else that changed
    // Strike is untouched.
    halfHasteOnStrike: true,
  },

  pinpoint: {
    label: "Pinpoint",
    foundations: ["physical"],
    kiCostPerTier: 4,
    damageCategory: "standard",
    text: `
      Pinpoint: Attacks made against pressure points, done through immense skill and
      precision.
      –Damage Category: Standard
      –KP Cost: 4(T)
      –Effect: This Profile has multiple effects:
      * This Attacking Maneuver ignores an amount of the target's Soak Value equal to
        your Insight Modifier.
      * If you score a Critical Result on the Strike Roll for this Attacking Maneuver,
        double your Insight Modifier for the duration of this Attacking Maneuver.`,
    ignoresSoakByInsight: true,
  },

  powered: {
    label: "Powered",
    foundations: ["physical"],
    kiCostPerTier: 8,
    damageCategory: "standard",
    text: `
      Powered: A single, powerful punch or kick charged to the brim with ki.
      –Damage Category: Standard
      –KP Cost: 8(T)
      –Effect: This Profile has multiple effects:
      * Apply your Damage Attribute an additional time for this Attacking Maneuver.
      * This Attacking Maneuver gains an Energy Charge.`,
    extraDamageAttribute: true,
    grantsEnergyCharge: 1,
  },

  soaring: {
    label: "Soaring",
    foundations: ["physical"],
    kiCostPerTier: 5,
    damageCategory: "direct",
    text: `
      Soaring: A physical attack that launches a concussive shock wave at a distant
      opponent.
      –Damage Category: Direct
      –KP Cost: 5(T)
      –Effect: This Attacking Maneuver has a Standard Line AoE.`,
    area: { shape: "line", magnitude: "standard" },
    // A shock wave "at a distant opponent": this is the Profile that specifies
    // otherwise, so the Melee Range the Physical Foundation demands does not bind it.
    ignoresMeleeRule: true,
  },

  sweeping: {
    label: "Sweeping",
    foundations: ["physical"],
    kiCostPerTier: 4,
    damageCategory: "standard",
    text: `
      Sweeping: Through a spinning kick, some kind of physical shock wave, or any other
      form of attack, the user strikes at multiple enemies simultaneously.
      –Damage Category: Standard
      –KP Cost: 4(T)
      –Effect: This Profile has multiple effects:
      * This Attacking Maneuver has a Minor Sphere AoE (centered on you).
      * Allies in this Attacking Maneuver's AoE are not targeted by this Attacking
        Maneuver.
      * If you deal Damage with this Attacking Maneuver, double the amount of
        Diminishing Defense stacks a target would receive from this Attacking Maneuver.`,
    area: { shape: "sphere", magnitude: "minor", centredOnSelf: true, sparesAllies: true },
    doublesDiminishingDefense: true,
  },

  // --- Energy ---------------------------------------------------------------
  // Bound by the Foundation's own rules: an Energy Attack reaches anywhere on the
  // Battlefield, and cannot be made at all with a Force Score below 3.

  beam: {
    label: "Beam",
    foundations: ["energy"],
    kiCostPerTier: 8,
    damageCategory: "direct",
    text: `
      Beam: A concentrated beam of energy that has incredible power.
      –Damage Category: Direct
      –KP Cost: 8(T)
      –Effect: This Attacking Maneuver gains an Energy Charge that does not count
      towards your maximum number of Energy Charges.`,
    // Not `grantsEnergyCharge`, which Powered uses and which is held to the Profile's
    // maximum along with every other Charge. This one is "an Energy Charge that does not
    // count towards your maximum", so it is added after the ceiling rather than under it.
    grantsUncappedEnergyCharge: 1
  },

  blast: {
    label: "Blast",
    foundations: ["energy"],
    kiCostPerTier: 5,
    damageCategory: "direct",
    text: `
      Blast: A cone-shaped wave of energy that can expand.
      –Damage Category: Direct
      –KP Cost: 5(T)
      –Effect: This Attacking Maneuver has a Cone AoE.`,
    // No Magnitude: the rule says "a Cone AoE" and names none, unlike Soaring's
    // "Standard Line AoE". Left unnamed rather than guessed at.
    area: { shape: "cone" }
  },

  clearing: {
    label: "Clearing",
    foundations: ["energy"],
    kiCostPerTier: 6,
    damageCategory: "standard",
    text: `
      Clearing: A huge surge of energy that strikes a large area.
      –Damage Category: Standard
      –KP Cost: 6(T)
      –Effect: This Profile has multiple effects:
      * Target a Square that is not at Long Range. This Attacking Maneuver has a Sphere
        AoE centered on your chosen Square.
      * The minimum Natural Result for the Strike Roll for this Attacking Maneuver is 5
        (if your Natural Result is less than 5, it becomes 5). This is applied after
        rolling and applying any increases to your Natural Result.`,
    // Centred on a Square rather than on a character, which is the first Profile to do
    // so - who that covers is the table's to agree, as with every other Area.
    area: { shape: "sphere", centredOnSquare: true },
    // "The minimum Natural Result for the Strike Roll is 5", applied last, after the die
    // and after anything that moved it.
    minimumNatural: 5
  },

  concentrated: {
    label: "Concentrated",
    foundations: ["energy"],
    kiCostPerTier: 10,
    damageCategory: "lethal",
    text: `
      Concentrated: A further concentrated beam that carries the ability to penetrate
      through all defenses.
      –Damage Category: Lethal
      –KP Cost: 10(T)
      –Effect: This Profile has multiple effects:
      * This Attacking Maneuver has a Line AoE.
      * Ignore 1/2 of your target's Damage Reduction.
      * The AoE for this Attacking Maneuver cannot have a Magnitude larger than Standard,
        nor can it have an AoE applied to it other than the Line AoE.`,
    // No Magnitude here either: the text says "a Line AoE" and names none, so it is
    // Standard by default - which is also exactly where the cap below holds it.
    area: { shape: "line" },
    // "Ignore 1/2 of your target's Damage Reduction" - a fraction of theirs rather than
    // an amount of your own, so it cannot go through `damageReduction.pierced`, which is
    // a number the attacker brings.
    ignoresHalfDamageReduction: true,
    // "The AoE cannot have a Magnitude larger than Standard, nor can it have an AoE
    // applied to it other than the Line AoE." Carried rather than enforced: nothing in
    // the system changes an attack's Area yet, so there is nothing here to refuse. The
    // day something does, this is what it has to ask.
    areaLocked: { magnitude: "standard" }
  },

  cutting: {
    label: "Cutting",
    foundations: ["energy"],
    kiCostPerTier: 6,
    damageCategory: "direct",
    text: `
      Cutting: A disk or small arc of energy focused to possess a cutting edge.
      –Damage Category: Direct
      –KP Cost: 6(T)
      –Effect: This Profile has multiple effects:
      * On the Strike Roll for this Attacking Maneuver, if you do not score a Critical
        Result, then you score a Botch Result regardless of the Natural Result.
      * On a Critical Result for the Strike Roll of this Attacking Maneuver, increase the
        Damage Category by 1 Category.
      * On the Wound Roll for this Attacking Maneuver, the Critical Target is 5 (ignoring
        the usual limit).`,
    // All or nothing on the Strike: anything short of a Critical Result is a Botch,
    // whatever the Natural Result was.
    botchUnlessCritical: true,
    // And a Critical is worth a Damage Category, which is settled per target because the
    // defence has its own say in the same sum.
    categoryUpOnCriticalStrike: 1,
    // On the Wound Roll only, and "ignoring the usual limit" - the floor a character's
    // own Critical Target is held to.
    woundCriticalTarget: 5
  },

  wave: {
    label: "Wave",
    foundations: ["energy"],
    kiCostPerTier: 6,
    damageCategory: "direct",
    text: `
      Wave: An attack that strikes down a number of enemies lined up together.
      –Damage Category: Direct
      –KP Cost: 6(T)
      –Effect: Target a Square that is not at Long Range. This Attacking Maneuver has
      a Line AoE centered on your chosen Square, pointing in any cardinal direction of
      your choice.`,
    // Which cardinal direction the Line points is the player's to pick, and who it
    // covers the table's to agree - but that is true of every Area here, and the tip
    // already says it for all of them. `needs` is for machinery the system lacks, and
    // this is not that: nothing is missing, the answer simply belongs to the table.
    area: { shape: "line", centredOnSquare: true }
  }
});

/**
 * What a Foundation demands of an attack made with it, beyond the Damage Attribute.
 *
 * Each Foundation has rules of its own. Physical is the one written so far: "Physical
 * Attacks can only be made against Opponents within your Melee Range, unless specified
 * otherwise."
 */
export const FOUNDATION_NOTES = Object.freeze({
  physical: "Physical Attacks can only be made against Opponents within your Melee "
    + "Range, unless specified otherwise.",
  energy: "Energy Attacks can be made against an Opponent at any distance from you "
    + "within the Battlefield (unless they possess an AoE). You cannot use an Energy "
    + "Attack if your Force Score is below 3.",
  magic: "Magic Attacks can be made against an Opponent at any distance from you within "
    + "the Battlefield (unless they possess an AoE). You cannot use a Magic Attack if "
    + "your Magic Score is below 3."
});

export const FOUNDATION_RULES = Object.freeze({
  physical: { meleeOnly: true },
  // "You cannot use an Energy Attack if your Force Score is below 3." The Score, not the
  // Modifier - the two part company early and this one names the Score.
  energy: { minimum: { attribute: "force", score: 3 } },
  // And the same shape for Magic, which asks for its own Attribute: "you cannot use a
  // Magic Attack if your Magic Score is below 3."
  //
  // The Profiles themselves are not here yet - they have effects strange enough to need
  // a rule of their own explained first - but what the Foundation demands of the
  // attacker stands without them, and a Multi-Foundation Profile declared as Magic is
  // bound by it today.
  magic: { minimum: { attribute: "magic", score: 3 } }
});

/**
 * Whether this character may make an attack with this Foundation at all.
 *
 * Apart from reach, which is its own question and its own answer: this one is about the
 * character rather than about where the target is standing.
 *
 * The Foundation's name is passed in rather than looked up, for the reason declareAttack
 * takes the whole Foundation table as an argument: this module stays clear of the data
 * model, and importing it here to read one label pulled the model into every harness
 * that loads a Maneuver.
 *
 * @returns {null|string} null if they may, otherwise why they may not
 */
export function whyNotThisFoundation(actor, foundation, name = foundation) {
  const required = FOUNDATION_RULES[foundation]?.minimum;
  if (!required) return null;

  const score = actor?.system?.attributes?.[required.attribute]?.score ?? 0;
  if (score >= required.score) return null;

  const label = required.attribute.charAt(0).toUpperCase() + required.attribute.slice(1);
  // "An Energy Attack" but "A Magic Attack". One Foundation hid this and the second one
  // found it - the article is the only word in the sentence that depends on the name.
  const article = /^[aeiou]/i.test(name) ? "An" : "A";
  return `${article} ${name} Attack needs a ${label} Score of ${required.score}. `
    + `${actor.name} has ${score}.`;
}

/**
 * How many empty Squares lie between two tokens.
 *
 * Zero means they are touching - adjacent, which is what Melee Range is before a Size
 * or an effect widens it. Measured between the footprints rather than between centres,
 * because a Gigantic character occupies 4x4 Squares and reaching them means reaching
 * the nearest of those, not the middle of them.
 *
 * Chebyshev, so a diagonal costs the same as a straight line: the rules count Squares,
 * and a Square touched at the corner is touched.
 *
 * @returns {number|null} null when it cannot be measured - no token, or two scenes.
 */
export function squaresBetween(a, b) {
  if (!a || !b || (a.parent?.id !== b.parent?.id)) return null;

  const grid = a.parent?.grid?.size ?? canvas?.grid?.size;
  if (!grid) return null;

  // In Squares, with the footprint each token actually covers.
  const box = t => ({
    x: t.x / grid, y: t.y / grid,
    w: t.width ?? 1, h: t.height ?? 1
  });
  const one = box(a);
  const two = box(b);

  const gap = (p, q, pSize, qSize) => Math.max(0, Math.max(p - (q + qSize), q - (p + pSize)));
  return Math.max(
    Math.ceil(gap(one.x, two.x, one.w, two.w)),
    Math.ceil(gap(one.y, two.y, one.h, two.h))
  );
}

/**
 * How far away somebody is, in Squares, counted the way the rules count them.
 *
 * `squaresBetween` answers how many Squares lie *between* two tokens - zero when they
 * are touching - and the rules count the target's own Square as the first one. So a
 * character standing next to you is 1 Square away and the two numbers differ by one,
 * which is exactly the sort of thing that gets a range band off by one and is why this
 * is written down rather than done at each call site.
 *
 * @returns {number|null} null when it cannot be measured - no token, or two scenes.
 */
export function squaresAway(actor, target) {
  const from = actor?.getActiveTokens?.(false, true)?.[0];
  const to = target?.getActiveTokens?.(false, true)?.[0];
  const between = squaresBetween(from, to);
  return (between === null) ? null : between + 1;
}

/**
 * "Characters are considered to be at Long Range, from your Character's perspective, if
 * they are 9+ Squares away from your Character."
 *
 * From your perspective, which is why it takes both of you: it is a fact about the gap
 * rather than about either of you, and a Profile that tells you to target a Square "not
 * at Long Range" is measuring from the character choosing it.
 */
export const LONG_RANGE_SQUARES = 9;

/** Whether this target is at Long Range from this character. */
export function atLongRange(actor, target) {
  const away = squaresAway(actor, target);
  // Unmeasurable is not far: out of combat there are no Squares, and a rule about them
  // cannot be enforced where there are none - the same answer the Melee Range gives.
  return (away === null) ? false : (away >= LONG_RANGE_SQUARES);
}

/**
 * "Reduce your Strike Rolls against any Character at Long Range by 2(bT)."
 *
 * Against a Character, so it belongs to the pairing and not to the roll: one Strike Roll
 * can reach several people at several distances, and what it is worth against each of
 * them is not the same number.
 */
export const LONG_RANGE_PENALTY_PER_BASE_TIER = 2;

export function longRangePenalty(actor, target) {
  if (!atLongRange(actor, target)) return 0;
  return LONG_RANGE_PENALTY_PER_BASE_TIER * (actor?.system?.baseTierOfPower ?? 1);
}

/**
 * Whether a Physical Attack can reach this target at all.
 *
 * "Physical Attacks can only be made against Opponents within your Melee Range, unless
 * specified otherwise." Melee Range is the adjacent Squares, widened by Size - an
 * Enormous character reaches one Square further, a Colossal one six - and by anything
 * written against the `meleeRange` Slot.
 *
 * Answers null - allowed - whenever the distance cannot be known. Neither character
 * being on a scene is the ordinary case out of combat, and a rule about Squares cannot
 * be enforced where there are none.
 *
 * @returns {null|string} null if it may be made, otherwise why it may not
 */
export function whyNotInReach(actor, target, { foundation, profile } = {}) {
  if (!FOUNDATION_RULES[foundation]?.meleeOnly) return null;
  if (PROFILES[profile]?.ignoresMeleeRule) return null;

  const from = actor?.getActiveTokens?.(false, true)?.[0];
  const to = target?.getActiveTokens?.(false, true)?.[0];
  const squares = squaresBetween(from, to);
  if (squares === null) return null;

  const reach = Math.max(0, actor.system.meleeRange ?? 0);
  if (squares <= reach) return null;

  const range = reach
    ? `${reach + 1} Squares`
    : "adjacent Squares";
  return `A Physical Attack only reaches your Melee Range (${range}). `
    + `${target.name} is ${squares + 1} Squares away.`;
}

/**
 * The effects the Defend Maneuver can be used for. Each is chosen when the Maneuver
 * is played, and each carries its own Ki Point cost - which is why the Maneuver's own
 * cost is listed as varying.
 *
 * `kiCostPerBaseTier` is the "8(bT)" notation: the cost is that much per Base Tier of
 * Power, so it grows with the character rather than staying flat.
 */
export const DEFEND_OPTIONS = Object.freeze({
  parry: {
    label: "Parry",
    kiCost: 0,
    summary: "Clash with your Strike Roll instead of your Dodge Roll. Win and you avoid "
      + "the attack. Each Energy Charge on it takes 1(bT) off your roll."
  },
  directHit: {
    label: "Direct Hit",
    kiCost: 0,
    summary: "Forgo the clash and be hit, with your Soak Value increased by half for "
      + "this attack. Shrug off a charged or heavily wagered blow for nothing and the "
      + "attacker is left Shaken."
  },
  powerFlare: {
    label: "Power Flare",
    kiCost: 0,
    // The only option whose own Wound Roll is made, so the only one that can wager.
    allowsKiWager: true,
    summary: "Be hit automatically, then answer their Wound Roll with your own, as an "
      + "Energy or Magic Attack. Beat it and take no damage."
  },
  crossCounter: {
    label: "Cross Counter",
    kiCost: 0,
    summary: "Clash with your Defense Value halved, then strike back with a Basic Attack out of sequence."
  },
  guard: {
    label: "Guard",
    /** Each Energy Charge on the attack adds this much per Base Tier, up to `max`. */
    chargeSurcharge: { perCharge: 1, max: 4 },
    kiCostPerBaseTier: 8,
    summary: "Forgo the clash and be hit, but halve the Wound Roll against you and "
      + "drop its Damage Category by one. Each Energy Charge on the attack adds "
      + "1(bT) to what this costs, up to four."
  }
});

/**
 * The effects the Intervene Maneuver can be used for.
 *
 * Shaped like the Defend options, and priced the same way - the Maneuver's own cost is
 * "varies", and the effect chosen is what sets it.
 *
 * Two of them ask for movement the system does not do: "move yourself to an unoccupied
 * Square that is within range of your Boosted Speed and is between your Ally and the
 * Character who used the Attacking Maneuver". Where a character stands is the table's to
 * settle - there is no pathing here, and no notion of which Squares are occupied - so
 * the requirement is stated on the card, with the Boosted Speed beside it, and whether
 * it was met is a thing the players say out loud. `movement` is what gets said.
 */
export const INTERVENE_OPTIONS = Object.freeze({
  defenseWall: {
    label: "Defense Wall",
    kiCost: 0,
    /** Takes the Wound Roll in the Ally's place, whatever else happens. */
    takesWound: true,
    /** "Increase your Soak Value by 1/2 (rounded up)" for this attack. */
    soakBonusFraction: 2,
    movement: "Move to an unoccupied Square within your Boosted Speed, between your Ally "
      + "and the attacker - or push the Ally back one Square and take their place.",
    summary: "Take the Wound Roll in your Ally's place, with your Soak Value increased "
      + "by half. If it Defeats you, what is left over reaches them through their own "
      + "Soak and Damage Reduction."
  },
  deflect: {
    label: "Deflect",
    kiCostPerBaseTier: 2,
    /** Won, the attack is turned aside from everyone it reached. */
    clashes: true,
    /** Lost, the Wound Roll is taken in the Ally's place, one Category harder. */
    takesWoundOnLoss: true,
    damageCategoryShiftOnLoss: 1,
    movement: "Move to an unoccupied Square within your Boosted Speed, between your Ally "
      + "and the attacker, or adjacent to your Ally.",
    summary: "Might Clash with the attacker. Win and the attack is deflected away from "
      + "everyone it reached. Lose and you take the Wound Roll in your Ally's place, one "
      + "Damage Category harder for you."
  },
  distantDeflect: {
    label: "Distant Deflect",
    kiCostPerBaseTier: 8,
    clashes: true,
    /** Nothing is said about losing, so losing costs nothing but the Ki. */
    summary: "Might Clash with the attacker from where you stand. Win and the attack is "
      + "deflected away from everyone it reached. Lose and the attack goes on as it was."
  }
});

/**
 * What one Intervene option costs this character.
 *
 * The same road the Defend options take, down to the Slot being named after the option -
 * so an effect that cheapens Deflect cannot touch Distant Deflect.
 */
export function interveneOptionCost(option, actor) {
  const definition = INTERVENE_OPTIONS[option];
  if (!definition) return 0;

  const base = definition.kiCostPerBaseTier
    ? definition.kiCostPerBaseTier * actor.system.baseTierOfPower
    : (definition.kiCost ?? 0);

  return Math.max(0,
    applySlot(actor.system.effects?.slots, `intervene.${option}.kiCost`, base));
}

/**
 * Whether this character may step in for that Ally against this attack.
 *
 * Two rules, and they refuse for different reasons.
 *
 * The attack must not have been aimed at you: "when an Ally who is not at Long Range is
 * hit by an Attacking Maneuver (that did not also target you)". Stepping in front of
 * something already coming for you is not stepping in front of anything.
 *
 * And one per Ally: "if you use the Intervene Maneuver, no other Character can use the
 * Intervene Maneuver for your selected Ally against that Attacking Maneuver." One per
 * Ally rather than one per attack - a Maneuver that caught four people can be intervened
 * against four times, by four different characters, once each.
 *
 * @returns {null|string} null if it may be used, otherwise why it may not
 */
export function whyNotIntervene(actor, allyUuid,
                                { interventions = [], targetUuids = [] } = {}) {
  if (actor.uuid === allyUuid) return "You cannot Intervene for yourself.";

  if (targetUuids.includes(actor.uuid)) {
    return `${actor.name} was targeted by this Attacking Maneuver, so they cannot Intervene against it.`;
  }

  const taken = interventions.find(entry => entry.allyUuid === allyUuid);
  if (taken) return `${taken.name} has already Intervened for them against this attack.`;

  return null;
}

/**
 * What one Defend option costs this character, resolving the (bT) notation and any
 * Talent that discounts it. A discount can never make a Maneuver pay you.
 */
export function defendOptionCost(option, actor, attack = null) {
  const definition = DEFEND_OPTIONS[option];
  const base = definition.kiCostPerBaseTier
    ? definition.kiCostPerBaseTier * actor.system.baseTierOfPower
    : (definition.kiCost ?? 0);

  // Guard gets dearer the more the attack was charged: "+1(bT) for each Energy Charge
  // on your Opponent's Attacking Maneuver (max. +4(bT))". The cap is on the Charges
  // counted, not on the Ki - four Charges is as expensive as seven.
  const surcharge = definition.chargeSurcharge
    ? Math.min(attack?.energyCharges ?? 0, definition.chargeSurcharge.max)
      * definition.chargeSurcharge.perCharge * actor.system.baseTierOfPower
    : 0;

  // The Slot names the option, so an effect that discounts Guard cannot touch Parry.
  // The whole cost goes through the engine rather than a hand-rolled sum, which is
  // what makes flat and (bT) discounts work here - reading only perTier is why they
  // silently did nothing before.
  // The surcharge rides on top of whatever the option costs after any discount: an
  // effect that cheapens Guard cheapens Guard, not the Charges on the attack.
  return Math.max(0,
    applySlot(actor.system.effects?.slots, `defend.${option}.kiCost`, base) + surcharge);
}

/** Action types a Maneuver can spend. Instant and Out-of-Sequence spend none. */
export const ACTION_TYPES = Object.freeze(["standard", "counter"]);

/**
 * Spend a Maneuver's Ki Point cost, or report that the character cannot afford it.
 *
 * Action Costs are not spent: that needs a notion of the current Combat Round to
 * reset the pool against, which the system does not have yet.
 *
 * @returns {Promise<boolean>} Whether the Maneuver may proceed.
 */
export async function spendManeuverCost(actor, maneuver, costOverride = null) {
  const cost = costOverride ?? maneuver.kiCost ?? 0;
  if (cost <= 0) return true;

  const { ki, capacity } = actor.system;

  if (ki.value < cost) {
    ui.notifications.warn(`${actor.name} needs ${cost} Ki Points for ${maneuver.name} and has ${ki.value}.`);
    return false;
  }

  // Capacity caps what may be spent within one Combat Round, on top of what the
  // pool holds.
  if (cost > capacity.remaining) {
    ui.notifications.warn(
      `${actor.name} has ${capacity.remaining} Capacity left this round and ${maneuver.name} costs ${cost}.`
    );
    return false;
  }

  await actor.update({
    "system.ki.value": ki.value - cost,
    "system.capacity.spent": capacity.spent + cost
  });
  return true;
}

/** Give back the Ki Points a Maneuver cost, when it is cancelled before resolving. */
export async function refundManeuverCost(actor, maneuver) {
  const cost = maneuver.kiCost ?? 0;
  if (cost <= 0) return;

  // Never refund past the pool's maximum, or cancelling would be a way to heal Ki.
  const restored = Math.min(actor.system.ki.max, actor.system.ki.value + cost);
  await actor.update({
    "system.ki.value": restored,
    // The Capacity it used is released too, or a cancelled Maneuver would still
    // count against what may be spent this round.
    "system.capacity.spent": Math.max(0, actor.system.capacity.spent - cost)
  });
}

/** One-question dialog returning the chosen action, or null if dismissed. */
async function pick(title, question, buttons) {
  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title },
    content: `<p>${question}</p>`,
    buttons: [...buttons, { action: "cancel", label: "Cancel" }],
    rejectClose: false
  });
  return (chosen && (chosen !== "cancel")) ? chosen : null;
}

/**
 * Group the Profiles the way they are chosen: those offered in more than one
 * Foundation come first, since picking one leaves the Foundation still to declare,
 * and the rest sit under the single Foundation they belong to.
 *
 * The per-Foundation groups are empty for now - Simple is the only Profile - but they
 * are what every Foundation-specific Profile will slot into.
 */
/**
 * What a Profile does, on hover.
 *
 * Written here rather than in the row because spelt out inline it is a paragraph per
 * Profile and the dialog grows to fit the longest - the same reason the Karmic Effects
 * put their wording on the name. What the system does not do yet is said last and
 * plainly, so a Profile that is half machinery and half table ruling says so where it
 * is chosen rather than after it is thrown.
 */
/**
 * The Magnitude an Area has when it does not say: "if an AoE does not have its Magnitude
 * declared, it is Standard by default."
 *
 * Kept as a rule rather than written into each Profile that omits one, so the published
 * text and the data say the same thing - Blast has "a Cone AoE" and names no Magnitude,
 * and that is what its entry says too.
 */
export const DEFAULT_AREA_MAGNITUDE = "standard";

/** What Magnitude this Area actually has, stated or defaulted. */
export function areaMagnitude(area) {
  return area?.magnitude ?? DEFAULT_AREA_MAGNITUDE;
}

/**
 * How an Area of Effect is named on the card and in the picker.
 *
 * A name and nothing more. Nothing in this system measures an Area: what it covers is
 * the player's and the GM's to agree, and the attacker says who was caught with the
 * button on the card. So the shape and the Magnitude are words a reader checks their own
 * ruling against, which is exactly why a missing Magnitude has to read as Standard
 * rather than as nothing - it used to come out as "Undefined Cone".
 */
export function areaLabel(area) {
  if (!area) return "";
  const name = `${areaMagnitude(area)} ${area.shape}`
    .replace(/(^|\s)\w/g, c => c.toUpperCase());
  return area.centredOnSelf ? `${name} (centred on you)` : name;
}

/**
 * Published lines and asides, as the markup a tooltip carries.
 *
 * Shared by Profiles and Maneuvers because it is the same thing on the page: the
 * rulebook's own words laid out as it prints them, and underneath, kept visibly apart,
 * whatever this implementation or this character has added to them.
 *
 * Built as HTML rather than as lines joined by newlines: `data-tooltip` is injected as
 * HTML, so a newline in it is just whitespace and the whole entry came out as one
 * run-on paragraph. `data-tooltip-html` is the attribute that means it.
 */
export function entryTip(lines, notes = []) {
  const body = lines.map(line => {
    // An empty line is a paragraph break the text itself has, so it is drawn as one
    // rather than closed up.
    if (!line) return `<div class="dbu-entry-break"></div>`;

    const bullet = /^[*•]/.test(line);
    return `<div class="dbu-profile-line${bullet ? " dbu-profile-bullet" : ""}">${
      Handlebars.escapeExpression(line)}</div>`;
  }).join("");

  const aside = notes.filter(Boolean).map(note =>
    `<div class="dbu-profile-note">${Handlebars.escapeExpression(note)}</div>`).join("");

  if (!body && !aside) return "";
  return `<div class="dbu-profile-tip">${body}${aside}</div>`;
}

/**
 * What a Maneuver has to say, as the pieces a row lays out when it is opened.
 *
 * Two bodies of text, answering different questions. The description is this character's
 * - the pencil on the row edits it, through Foundry's own editor, so it is HTML and is
 * rendered rather than escaped: what somebody wrote as two paragraphs shows as two
 * paragraphs. The entry is the rule, word for word as the rulebook prints it, which is
 * what a Profile's own hover shows and for the same reason: somebody reading a Maneuver
 * is reading the text they know, and a tidied-up version of it is one more thing to
 * reconcile at the table.
 *
 * A row rather than a hover, because a hover cannot be read at leisure or scrolled, and
 * the whole Defend Maneuver in one was taller than the display. The Profile picker keeps
 * its hover: that is a dialog being chosen from, not a list being read.
 *
 * The description is shown when it is theirs rather than the one the definition ships
 * with. Re-describing a Maneuver is much of the point of their being Items - a Basic
 * Attack reflavoured as something of your own - so what somebody writes there has to
 * read somewhere. The shipped summary does not need to: the entry below it says the same
 * thing and says it better, which is why the entries were written out in the first
 * place.
 *
 * @param {object} maneuver  a definition, from definitionOf() or the registry
 * @returns {{lines: {text: string, bullet: boolean, gap: boolean}[], description: string,
 *           empty: boolean}}
 */
export function maneuverEntry(maneuver) {
  // The file's entry wherever the file has one, rather than the copy's. A character
  // granted a Maneuver last week holds the wording the file had last week, and six of
  // these were granted with an entry the parser had truncated at its first blank line -
  // so every one of those copies carries a third of its entry. The rules live in
  // traits/, and this is one of them.
  //
  // The copy's own wording is what a Maneuver with no file has: a Signature Technique or
  // a Unique Ability is bought per character and exists only as an Item, so the Item is
  // the only place its wording could live.
  const published = maneuvers.get(maneuver.id);
  const printed = printedLines(published?.text || maneuver.text || "");

  const own = String(maneuver.description ?? "").trim();
  const shipped = String(published?.description ?? "").trim();

  // With no entry to quote, the description is all there is - the case for a homebrew
  // Maneuver and for the five Core ones whose printed entry was never given here. Then
  // it is shown whether or not it is theirs, because it is the only thing there is.
  const description = printed.length ? (((own !== shipped)) ? own : "") : own;

  const lines = printed.map(line => ({
    text: line,
    // The rulebook's own markers, not ours: a bullet opens an option, and an empty line
    // is a paragraph break the text itself has.
    bullet: /^[*\u2022]/.test(line),
    gap: !line
  }));

  return { lines, description, empty: !lines.length && !description };
}

/**
 * What a Profile says, on hover.
 *
 * The rulebook's own words, and nothing rewritten: a player choosing a Profile is
 * choosing against the text they know, and a tidied-up version of it is one more thing
 * to reconcile at the table.
 *
 * What the system leaves to the table goes underneath, kept visibly apart - it is not
 * part of the rule, it is how this implementation asks to be driven.
 *
 * Built as HTML rather than as lines joined by newlines: `data-tooltip` is injected as
 * HTML, so a newline in it is just whitespace and the whole entry came out as one
 * run-on paragraph. `data-tooltip-html` is the attribute that means it.
 */
function profileTip(profile) {
  const printed = printedLines(profile.text);
  const notes = [];

  if (profile.grantsAdvantage === "charging-assault") {
    notes.push("Move on the map first, then say how far you came - the line, the "
      + "distance and where you end up are yours to make; the Squares are what the "
      + "bonuses are worked out from.");
  }
  if (profile.grantsAdvantage === "knockback") {
    notes.push("Deal Damage and the card offers the Might Clash. Win it and move them "
      + "yourself; what the collision costs is yours and the GM's to set, and the "
      + "button takes it straight off their Life.");
  }
  if (profile.area) {
    notes.push("Add the others it catches with the button on the card - who the "
      + `${areaLabel(profile.area)} covers is yours and the GM's to agree.`);
  }
  if (profile.needs) notes.push(`Not automated: ${profile.needs}`);

  const tip = entryTip(printed, notes);
  if (!tip) return "";

  return ` data-tooltip-html="${Handlebars.escapeExpression(tip)}"`;
}

/**
 * What a Foundation demands of every Profile under it, on the group that holds them.
 *
 * The rulebook says it once, at the head of the Foundation's Profiles, rather than on
 * each of them - so it is said once here too, where the group is.
 */
/**
 * Why each Foundation is shut to this character, if any is.
 *
 * Keyed by Foundation, and the value is the reason - which is what the player is shown,
 * since a control that is greyed out and says nothing is a control that looks broken.
 *
 * Worked out once per dialog rather than per row: the answer is the same for every
 * Profile under a Foundation, that being what a Foundation rule is.
 */
function shutFoundations(actor, foundations) {
  const shut = {};
  if (!actor) return shut;

  for (const key of Object.keys(foundations ?? {})) {
    const refused = whyNotThisFoundation(actor, key, foundations[key]?.label ?? key);
    if (refused) shut[key] = refused;
  }
  return shut;
}

/**
 * One group of Profiles, drawn either as a list to choose from or as a shut door.
 *
 * A Foundation the character cannot use is not a disclosure widget at all - the whole
 * point is that it does not open, and a `<details>` that is merely closed is one click
 * from being open. So it is drawn as a plain block that says the group's name and why it
 * is shut, and the Profiles under it are not rendered: nothing to select, nothing to
 * reveal, and a reason on the face of it.
 */
function profileSection(group, items, shut) {
  const reason = shut[group.key];
  if (reason) {
    return `<div class="dbu-profile-group dbu-profile-shut"
                 data-tooltip="${Handlebars.escapeExpression(reason)}">
      <div class="dbu-profile-shut-name">${Handlebars.escapeExpression(group.label)}
        <em>${Handlebars.escapeExpression(reason)}</em></div>
    </div>`;
  }

  if (!items) {
    return `<details class="dbu-profile-group dbu-profile-empty">
      <summary>${Handlebars.escapeExpression(group.label)} <em>none yet</em></summary>
    </details>`;
  }

  return `<details class="dbu-profile-group" open>
    <summary${groupTip(group)}>${Handlebars.escapeExpression(group.label)}</summary>
    ${items}
  </details>`;
}

function groupTip(group) {
  const note = FOUNDATION_NOTES[group.key];
  return note ? ` data-tooltip="${Handlebars.escapeExpression(note)}"` : "";
}

function profileGroups(foundations) {
  const groups = [{ key: "multi", label: "Multi-Foundation", profiles: [] }];
  for (const [key, foundation] of Object.entries(foundations)) {
    groups.push({ key, label: foundation.label, profiles: [] });
  }

  for (const [id, profile] of Object.entries(PROFILES)) {
    const group = (profile.foundations.length > 1)
      ? groups[0]
      : groups.find(candidate => candidate.key === profile.foundations[0]);
    group?.profiles.push({ id, ...profile });
  }

  return groups;
}

/**
 * Ask which Profile an attack uses and, when the Profile spans more than one, which
 * Foundation - the Foundation is what decides the Damage Attribute behind Wound.
 *
 * A Maneuver naming one Profile skips the first question, and a Profile that belongs
 * to a single Foundation answers the second on its own. Shared, because an attack has
 * to be declared the same way however it is reached - from the sheet, or out of
 * sequence.
 *
 * @returns {Promise<?{profile: string, foundation: string}>}
 */
export async function declareAttack(maneuver, foundations, actor) {
  const declared = await pickProfile(maneuver, foundations, actor);
  if (!declared) return null;

  const { profile, kiWager } = declared;

  // What this attack carries from the Signature Technique side: whatever the Maneuver
  // was built with, plus whatever the Profile hands out. Blitz grants Charging Assault
  // for free, and a Technique that bought the same Advantage for 10 TP arrives here
  // with it already in the list - so the two routes meet and neither is special.
  const advantages = [...new Set([
    ...(maneuver.advantages ?? []),
    ...(PROFILES[profile]?.grantsAdvantage ? [PROFILES[profile].grantsAdvantage] : [])
  ])];

  const answers = await askFeatures(maneuver, actor, advantages);
  if (!answers) return null;

  if (!profile) return { profile: "", foundation: "physical", kiWager, advantages, ...answers };

  // A Foundation this character cannot use is offered greyed out rather than left off
  // the list: a missing button reads as a bug, and a disabled one carrying its reason
  // answers the question the player was about to ask. A disabled button also cannot
  // submit, so clicking it does nothing and the dialog stays where it is.
  const available = PROFILES[profile].foundations;
  const shut = shutFoundations(actor, foundations);

  const foundation = (available.length === 1)
    ? available[0]
    : await pick(
        `${maneuver.name} - ${PROFILES[profile].label} Profile`,
        "Which Foundation is this attack made with?",
        available.map(key => ({
          action: key,
          label: shut[key]
            ? `${foundations[key].label} - ${shut[key]}`
            : foundations[key].label,
          disabled: Boolean(shut[key])
        }))
      );
  if (!foundation) return null;

  return { profile, foundation, kiWager, advantages, ...answers };
}

/**
 * The numbers an attack's Advantages need before it can be rolled.
 *
 * Asked at Attack Declaration because that is where the rules that use them put their
 * movement - "at Attack Declaration, you may move up to your Boosted Speed" - so by
 * the time anything is rolled the answer is already settled and cannot be chosen to
 * suit the dice.
 *
 * Only the map is left to the player, and all of it: the straight line, the Melee
 * Range the movement ends in, the ceiling on how far. Moving the token has answered
 * those, and asking again would be asking the same question twice.
 *
 * @returns {Promise<object|null>} the answers, or null if the declaration was dropped
 */
async function askFeatures(maneuver, actor, advantages) {
  const asks = featureAsks(advantages);
  if (!asks.length) return {};

  const rows = asks.map(ask => `
    <label class="dbu-wager">
      <span>${Handlebars.escapeExpression(ask.label)}</span>
      <input type="number" name="${ask.field}" value="0" min="0" max="${ask.max ?? 99}"/>
      <em>${Handlebars.escapeExpression(ask.hint)}</em>
    </label>`).join("");

  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: `${maneuver.name} - Charge` },
    content: rows,
    buttons: [
      {
        action: "confirm",
        label: "Confirm",
        callback: (event, button, dialog) => Object.fromEntries(asks.map(ask => {
          const typed = Math.floor(Number(dialog.element.querySelector(`input[name="${ask.field}"]`)?.value));
          return [ask.field, Number.isFinite(typed) ? Math.max(0, typed) : 0];
        }))
      },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });

  return (chosen && (typeof chosen === "object")) ? chosen : null;
}

/**
 * Just the Profile, with no wager and no Foundation.
 *
 * The Energy Charge Maneuver declares an Attacking Maneuver before it is thrown, and
 * the Profile is settled then - "the next Basic Attack has to be with that Profile".
 * What it costs and what Foundation carries it are still the attack's own business, so
 * they are asked when it is finally made.
 *
 * @returns {Promise<string|null>} A Profile id, or null if nothing was chosen.
 */
export async function pickProfileOnly(maneuver, foundations, hint = "", actor = null) {
  if (maneuver.profile && (maneuver.profile !== "any")) return maneuver.profile;

  const groups = profileGroups(foundations);
  let checked = false;

  const shut = shutFoundations(actor, foundations);

  const sections = groups.map(group => {
    if (!group.profiles.length) return "";
    // Nothing under a shut Foundation is drawn, so nothing under one can be selected -
    // and the first Profile that starts selected is never one of them.
    if (shut[group.key]) return profileSection(group, "", shut);

    const items = group.profiles.map(profile => {
      const attr = checked ? "" : "checked";
      checked = true;
      return `<label class="dbu-profile-option">
        <input type="radio" name="profile" value="${profile.id}" ${attr}/>
        <span class="dbu-profile-name"${profileTip(profile)}>${Handlebars.escapeExpression(profile.label)}</span>
        <span class="dbu-profile-category">${DAMAGE_CATEGORIES[profile.damageCategory].label}</span>
        <span class="dbu-profile-cost">${profileOptionCost(maneuver, profile.id, actor)} KP</span>
      </label>`;
    }).join("");

    return profileSection(group, items, shut);
  }).join("");

  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: `${maneuver.name} - Profile` },
    content: `${hint ? `<p class="dbu-respond-hint">${hint}</p>` : ""}
      <div class="dbu-profile-picker">${sections}</div>`,
    buttons: [
      {
        action: "confirm",
        label: "Confirm",
        callback: (event, button, dialog) =>
          dialog.element.querySelector('input[name="profile"]:checked')?.value ?? null
      },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });

  return (typeof chosen === "string") ? chosen : null;
}

/** The four kinds a Maneuver can be. Dodging is not among them: it is not a Maneuver. */
const MANEUVER_KINDS = new Set(["standard", "instant", "counter", "outOfSequence"]);

/**
 * What a Maneuver just used does to the Instant rule.
 *
 * "An Instant Maneuver cannot be used if the last Maneuver you used was an Instant
 * Maneuver." So playing one holds you, and using any other kind releases you - your
 * own use, not somebody else's turn going by.
 *
 * An Out-of-Sequence Maneuver releases you too, with one exception: not when the thing
 * that offered it was the Instant still holding you. That would be laundering an
 * Instant into permission for the next one, and the two would alternate for ever.
 *
 * Lives here rather than in either caller because both reach it - a Maneuver played
 * from the sheet and one played into a chat card are the same rule - and this module is
 * the one they already share.
 *
 * @param {Actor} actor
 * @param {string} type       standard, instant, counter or outOfSequence
 * @param {object} [options]
 * @param {string} [options.messageId]  the card this Maneuver was played on or from
 */
export async function recordManeuverType(actor, type, { messageId = "" } = {}) {
  // Fails closed, like every other judgement in this system: an unrecognised kind
  // leaves the hold exactly as it was rather than lifting it. The four kinds are the
  // four kinds, and anything else reaching here is a mistake that must not be a way
  // out from under the rule - dodging is the obvious one, since it is not a Maneuver
  // at all and costs nothing.
  if (!MANEUVER_KINDS.has(type)) {
    console.warn(`DBU TTRPG | "${type}" is not a kind of Maneuver; the Instant rule is unchanged.`);
    return;
  }

  const held = actor.system.instantPlayed ?? { held: false, messageId: "" };

  // Triggered by the Instant that is holding you, so it does not count as getting out
  // from under it.
  if ((type === "outOfSequence") && held.held && messageId && (messageId === held.messageId)) {
    return;
  }

  const now = (type === "instant")
    ? { held: true, messageId: messageId ?? "" }
    : { held: false, messageId: "" };

  if ((now.held === held.held) && (now.messageId === held.messageId)) return;
  return actor.update({ "system.instantPlayed": now });
}

/**
 * Why this character may not play an Instant Maneuver, if they may not.
 *
 * @returns {null|string} null when they may, otherwise what is in the way
 */
export function whyNotAnotherInstant(actor) {
  if (!actor?.system?.instantPlayed?.held) return null;
  return "Your last Maneuver was an Instant. Use another kind first.";
}

/**
 * The most Ki a character may wager on one attack: half their Capacity by the rule,
 * and no more than they could actually pay for.
 */
export function maxKiWager(actor, advantages = []) {
  const { capacity, ki } = actor.system;

  // Full Wager: "the amount of Ki Points you can Ki Wager is only limited by your
  // remaining Capacity." So the half-Capacity limit is lifted and the other two stay -
  // "only limited by your remaining Capacity" still cannot let you spend Ki you do not
  // have, and a wager of Ki that is not there is not a wager.
  const half = advantages.includes("full-wager")
    ? Number.POSITIVE_INFINITY
    : Math.floor(capacity.max / 2);

  return Math.max(0, Math.min(half, capacity.remaining, ki.value));
}

/**
 * The least that may be wagered, when an effect says it must be everything.
 *
 * All or Nothing: "you must make the highest Ki Wager possible for this Signature
 * Technique." A floor set to the ceiling, which is the only way to say "all of it" to a
 * question that asks for a number.
 */
export function forcedFullWager(advantages = []) {
  return advantages.includes("all-or-nothing");
}

/**
 * The least that may be wagered on an Attacking Maneuver.
 *
 * Normally nothing. Compelled is what makes it something: "you must Ki Wager at least
 * 1/10 (rounded up) of your Max Capacity on all Attacking Maneuvers against that
 * target". Held down to what can actually be paid, since a floor above the ceiling
 * would leave the dialog with no number it would accept - the rule cannot make you
 * spend Ki you do not have.
 */
export function minimumKiWager(actor, maneuver = null) {
  // "on all Attacking Maneuvers". Compelled also forbids attacking anyone but its
  // target, so that is every Attacking Maneuver you are able to make - which is why
  // the target itself is left to the table rather than tracked. A Maneuver that is
  // not an attack is untouched however it was declared.
  if (maneuver && !maneuver.attacking) return 0;

  const floor = applySlot(actor.system.effects?.slots, "attack.kiWager.min", 0);
  return Math.max(0, Math.min(floor, maxKiWager(actor)));
}

/**
 * Declare the attack's Profile and its Ki Wager together, since both are settled at
 * the same moment - and both are paid for at the same moment too.
 *
 * A Maneuver that names its own Profile still opens this, because the wager is asked
 * either way; it simply has nothing to choose between.
 */
async function pickProfile(maneuver, foundations, actor) {
  const groups = profileGroups(foundations);
  const fixed = (maneuver.profile !== "any") ? PROFILES[maneuver.profile] : null;
  // An Attacking Maneuver that names no Profile at all - which the schema allows, and
  // a hand-written Signature Technique can be - still has a wager to declare. There is
  // simply nothing to choose between, so only the wager is asked.
  const noProfile = !maneuver.profile;
  let checked = false;

  const shut = shutFoundations(actor, foundations);

  const sections = groups.map(group => {
    if (!group.profiles.length || shut[group.key]) return profileSection(group, "", shut);

    const items = group.profiles.map(profile => {
      // The first Profile in the first non-empty group starts selected, so confirming
      // straight away is always a valid choice.
      const attr = checked ? "" : "checked";
      checked = true;
      return `<label class="dbu-profile-option">
        <input type="radio" name="profile" value="${profile.id}" ${attr}/>
        <span class="dbu-profile-name"${profileTip(profile)}>${Handlebars.escapeExpression(profile.label)}</span>
        <span class="dbu-profile-category">${DAMAGE_CATEGORIES[profile.damageCategory].label}</span>
        <span class="dbu-profile-cost">${profileOptionCost(maneuver, profile.id, actor)} KP</span>
      </label>`;
    }).join("");

    // Groups that hold something open by default; empty and shut ones do not open.
    return profileSection(group, items, shut);
  }).join("");

  const body = noProfile
    ? ""
    : fixed
    ? `<p class="dbu-profile-fixed"><strong>${Handlebars.escapeExpression(fixed.label)}</strong>
        &middot; ${DAMAGE_CATEGORIES[fixed.damageCategory].label}</p>`
    : `<div class="dbu-profile-picker">${sections}</div>`;

  // Wagered Ki is added to the Wound Roll and comes out of Capacity, so the ceiling
  // is the lower of the rule's half-Capacity limit and what can actually be paid.
  // The floor is normally nothing, and is what Compelled raises.
  // What this Technique brings changes what may be wagered: Full Wager lifts the
  // ceiling, All or Nothing pins the floor to it. Read off the Maneuver rather than the
  // character, because they belong to the Technique and not to whoever throws it.
  const features = maneuver.advantages ?? [];
  const wagerMax = maxKiWager(actor, features);
  const wagerMin = forcedFullWager(features)
    ? wagerMax
    : minimumKiWager(actor, maneuver);
  const wager = `
    <label class="dbu-wager">
      <span>Ki Wager</span>
      <input type="number" name="kiWager" value="${wagerMin}" min="${wagerMin}" max="${wagerMax}"/>
      <em>${wagerMin ? `at least ${wagerMin}, ` : ""}max ${wagerMax}, added to the Wound Roll</em>
    </label>`;

  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: `${maneuver.name} - ${noProfile ? "Ki Wager" : "Profile"}` },
    content: `${body}${wager}`,
    buttons: [
      {
        action: "confirm",
        label: "Confirm",
        callback: (event, button, dialog) => {
          const profile = noProfile
            ? ""
            : fixed
            ? maneuver.profile
            : dialog.element.querySelector('input[name="profile"]:checked')?.value;
          if (!noProfile && !profile) return null;

          // Clamped here as well as on the input: `min` on a number field is advice to
          // the browser, not a guarantee, and a typed number gets through it.
          const typed = Math.floor(Number(dialog.element.querySelector('input[name="kiWager"]').value));
          const kiWager = Number.isFinite(typed)
            ? Math.min(Math.max(typed, wagerMin), wagerMax)
            : wagerMin;
          return { profile, kiWager };
        }
      },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });

  return (chosen && (typeof chosen === "object")) ? chosen : null;
}

/**
 * A Maneuver's own Ki Point cost, before anything is declared.
 *
 * `kiCostPerBaseTier` is the "2(bT)" notation, and it was being read for the Defend
 * options and nowhere else - so a Maneuver written with it cost nothing at all. The two
 * are alternatives rather than additions: a Maneuver states its price one way or the
 * other.
 */
function baseKiCost(maneuver, actor) {
  return maneuver.kiCostPerBaseTier
    ? maneuver.kiCostPerBaseTier * (actor?.system?.baseTierOfPower ?? 1)
    : (maneuver.kiCost ?? 0);
}

/**
 * The most Energy Charges an attack made with this Profile can hold.
 *
 * Seven for everything but Mega Flare, which is built to hold ten - "the maximum number
 * of Energy Charges for this Profile is 10".
 */
export function maxEnergyCharges(profileId, fallback) {
  return PROFILES[profileId]?.maxEnergyCharges ?? fallback;
}

/**
 * What choosing this Profile would actually cost, which is what a picker shows.
 *
 * The whole price of the attack under that Profile - the Maneuver's own cost, the
 * Profile's, whatever effects do to it, and the Minimum Ki Point Cost underneath it -
 * rather than the Profile's share alone. The share was what a player was shown and
 * never quite what they were charged, and the Minimum is where the two come apart in
 * the case that matters: once everything else has cut the price to the bone, what you
 * pay is the floor, and the floor is the Profile's.
 *
 * No wager in it, because none has been declared at the moment of choosing.
 */
function profileOptionCost(maneuver, profileId, actor) {
  return maneuverKiCost(maneuver, { profile: profileId }, actor);
}

/**
 * Whether another Absolute Attack may be made: "You can't do more than 2 Absolute
 * Attacks during a single Combat Round."
 *
 * Counted when the attack is made rather than when it misses. An Absolute Attack is an
 * Attacking Maneuver that is Absolute, and doing one is making one - the property is
 * not something the attack acquires later by failing. The other reading, counting only
 * the ones that actually missed, would let a character throw them all round and spend
 * the two on whichever happened to need them.
 *
 * @returns {null|string} null if one may be made, otherwise why not
 */
export function whyNotAnotherAbsolute(actor, maneuver) {
  if (!maneuver?.absolute || !maneuver?.attacking) return null;

  const { used = 0, max = 0 } = actor?.system?.absoluteAttacks ?? {};
  return (used < max)
    ? null
    : `${actor.name} has already made ${max} Absolute Attacks this Combat Round.`;
}

/**
 * The KP Cost a Profile *lists*, before anything reduces it.
 *
 * Kept apart from what the Profile ends up adding to the price, because the Minimum Ki
 * Point Cost is half of this and half of nothing else: "cannot be reduced to lower than
 * 1/2 of the listed KP Cost of that Attacking Maneuver's Profile". A reduction that
 * lowers the price does not lower the floor under it, or the floor would follow the
 * price down and stop being a floor at all.
 *
 * Every Physical Profile is written in the "4(T)" notation, so it grows with the Tier
 * of Power.
 */
export function profileListedKiCost(profileId, actor) {
  const profile = PROFILES[profileId];
  if (!profile) return 0;

  const tier = actor?.system?.tierOfPower ?? 1;
  return (profile.kiCost ?? 0) + ((profile.kiCostPerTier ?? 0) * tier);
}

/**
 * What a Profile adds to the price.
 *
 * The listed cost, less what Blitz takes back as a Signature Technique - "reduce the KP
 * Cost by 2(T)" - and never below nothing. That discount is a reduction like any other,
 * so it is subject to the Minimum and does not move it.
 */
export function profileKiCost(profileId, maneuver, actor) {
  const profile = PROFILES[profileId];
  if (!profile) return 0;

  const tier = actor?.system?.tierOfPower ?? 1;
  const discount = (maneuver?.signature && profile.signatureDiscountPerTier)
    ? profile.signatureDiscountPerTier * tier
    : 0;

  return Math.max(0, profileListedKiCost(profileId, actor) - discount);
}

/**
 * The Minimum Ki Point Cost: what an Attacking Maneuver costs however much is taken off
 * it. Half the Profile's listed cost, rounded down.
 *
 * The floor is read off the listed cost alone, so nothing that changes the price changes
 * it. Drained making every attack cost 2(T) more raises what you pay and leaves the
 * floor exactly where it was - which only shows when reductions are in play too, and is
 * the whole point of the rule.
 *
 * The Slot can only be worth having if something may lower it, and something does:
 * Perfect Ki Control, an Aspect, says "Your Minimum Ki Point Cost for your Attacking
 * Maneuvers is 2(T), this cannot increase the Minimum Ki Point Cost for an Attacking
 * Maneuver" - a ceiling on the minimum rather than a new value for it, written
 * `attack.kiCost.minimum max= 2(T)`.
 */
export function minimumAttackKiCost(profileId, actor) {
  const listed = profileListedKiCost(profileId, actor);
  const half = Math.floor(listed / 2);
  return Math.max(0, applySlot(actor?.system?.effects?.slots, "attack.kiCost.minimum", half));
}

/** What a Maneuver costs in Ki once its declared Profile is taken into account. */
export function maneuverKiCost(maneuver, declared, actor) {
  // One path whether or not a Profile has been declared. It used to fork, and the
  // branch that answers "what does this cost" for the sheet had quietly lost the
  // half that applies to Attacking Maneuvers - so Drained raising the price of every
  // attack was true when you paid and invisible when you looked.
  const base = baseKiCost(maneuver, actor)
    + (declared ? profileKiCost(declared.profile, maneuver, actor) : 0);

  const slots = actor?.system?.effects?.slots;

  // A named Maneuver can be discounted on its own; an Attacking one also takes whatever
  // applies to attacks in general.
  let cost = applySlot(slots, `${maneuver.id}.kiCost`, base);

  if (actor && maneuver.attacking) {
    cost = applySlot(slots, "attack.kiCost", cost);

    // Minimum Ki Point Cost, applied last: the price is whatever everything did to it,
    // but never less than half what the Profile lists. Last because it is a floor under
    // the finished price and not one more term in it - putting it anywhere earlier lets
    // the next reduction walk straight through it.
    cost = Math.max(cost, minimumAttackKiCost(declared?.profile, actor));
  }

  // The wager is Ki spent on the attack like any other, so it is paid here - which is
  // also what takes it out of Capacity. A Talent that cheapens Attacking Maneuvers
  // discounts the Maneuver, never the wager: the wager is what you chose to spend, and
  // the Minimum is a floor under the price rather than under what you choose to add.
  return Math.max(0, cost) + (declared?.kiWager ?? 0);
}

/**
 * How many uses of a limited Maneuver a character has left. A Maneuver with no limit
 * is always available, so it reports Infinity rather than a number to compare.
 */
export function maneuverUsesLeft(actor, maneuver) {
  if (!maneuver.usageLimit) return Infinity;

  const spent = (actor.system.usedManeuvers ?? []).filter(entry => usedIs(entry, maneuver)).length;
  return Math.max(0, maneuver.usageLimit.amount - spent);
}

/**
 * Whether a recorded use is a use of this Maneuver.
 *
 * A use is written with the period it is counted against - `round:energy-cancel` - so
 * that a new Combat Round can clear the ones it owns and leave the per-Encounter ones
 * alone. A bare id is a use recorded before that was true, and still counts: a Maneuver
 * has one limit, so there is never more than one form of its own entry in the list.
 */
function usedIs(entry, maneuver) {
  return (entry === maneuver.id) || (entry === `${maneuver.usageLimit.per}:${maneuver.id}`);
}

/**
 * Record one use of a limited Maneuver.
 *
 * Written with its period, because that is what tells a new Round which uses it hands
 * back. Without it every use looked alike, the Round could not tell them apart, and a
 * Maneuver limited to once per Round was in practice once per Encounter.
 */
export async function recordManeuverUse(actor, maneuver) {
  if (!maneuver.usageLimit) return;
  const entry = `${maneuver.usageLimit.per}:${maneuver.id}`;
  await actor.update({ "system.usedManeuvers": [...actor.system.usedManeuvers, entry] });
}

/** "[1/Encounter]", as the rules write it in a Maneuver's name. */
export function usageLimitLabel(maneuver) {
  if (!maneuver.usageLimit) return "";
  const { amount, per } = maneuver.usageLimit;
  return `${amount}/${per.charAt(0).toUpperCase()}${per.slice(1)}`;
}


/** Loaded maneuver definitions, keyed by id. Populated by loadManeuvers(). */
const maneuvers = new Map();

/** Every loaded Maneuver, in the order the file lists them. */
export function allManeuvers() {
  return [...maneuvers.values()];
}

/** A Maneuver definition, or undefined if the id is unknown. */
export function getManeuver(id) {
  return maneuvers.get(id);
}

/**
 * Load the Maneuver list. Unlike races, these live in a single file: a Maneuver is
 * a rule rather than something a group is expected to extend piecemeal.
 */
/** "1/encounter" as the shape the rest of the system reads. */
function parseLimit(text) {
  const match = String(text ?? "").match(/^(\d+)\s*\/\s*(round|encounter)$/i);
  return match ? { amount: Number(match[1]), per: match[2].toLowerCase() } : null;
}

export async function loadManeuvers() {
  maneuvers.clear();

  // Read from the files under traits/maneuvers/, the same place a homebrew Maneuver
  // goes. The registry is still keyed by id, because several rules name a Maneuver
  // rather than owning one - Cross Counter grants "basic-attack", and the cost of a
  // Defend option is asked for without anyone holding the Maneuver.
  const definitions = traitsOfKind("maneuvers").map(trait => ({
    ...trait,
    actionCost: trait.actionCost ?? 1,
    actionCostMax: trait.actionCostMax ?? 0,
    actionCostOpen: Boolean(trait.actionCostOpen),
    kiCost: trait.kiCost ?? 0,
    attacking: Boolean(trait.attacking),
    requiresTarget: Boolean(trait.requiresTarget),
    defend: Boolean(trait.defend),
    intervene: Boolean(trait.intervene),
    exploit: Boolean(trait.exploit),
    empower: Boolean(trait.empower),
    // Kept as written: "All adjacent Opponents" is a range the table reads, not one the
    // system measures. It had been sitting in a Maneuver file since Energy Charge was
    // written and nothing had ever carried it this far.
    exploitable: trait.exploitable ?? "",
    surge: Boolean(trait.surge),
    charge: Boolean(trait.charge),
    cancelCharge: Boolean(trait.cancelCharge),
    usageLimit: parseLimit(trait.usageLimit),
    clash: trait.clashSkill ? { skill: trait.clashSkill } : null
  }));

  for (const maneuver of definitions) {
    if (!maneuver?.id || !maneuver?.name) {
      console.warn("DBU TTRPG | A maneuver is missing an id or a name; skipping.", maneuver);
      continue;
    }
    if (!MANEUVER_TYPES[maneuver.type]) {
      console.warn(`DBU TTRPG | Maneuver "${maneuver.id}" has an unknown type "${maneuver.type}"; skipping.`);
      continue;
    }
    if (maneuver.profile && (maneuver.profile !== "any") && !PROFILES[maneuver.profile]) {
      console.warn(`DBU TTRPG | Maneuver "${maneuver.id}" has an unknown profile "${maneuver.profile}"; skipping.`);
      continue;
    }
    if (maneuvers.has(maneuver.id)) {
      console.warn(`DBU TTRPG | Maneuver id "${maneuver.id}" is defined more than once; keeping the first.`);
      continue;
    }
    maneuvers.set(maneuver.id, maneuver);
  }

  console.log(`DBU TTRPG | Loaded ${maneuvers.size} maneuver(s)`);
}
