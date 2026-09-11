import { applySlot } from "./effects/interpreter.mjs";
import { traitsOfKind } from "./effects/traits.mjs";
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
    summary: "A simple punch, kick, energy ball, or spell.",
    rules: ["No effect of its own."]
  },

  combination: {
    label: "Combination",
    foundations: ["physical", "energy", "magic"],
    kiCostPerTier: 3,
    damageCategory: "standard",
    summary: "A combination of several attacks done in sequence.",
    // Three more Strike Rolls after the hit and before the Wound Roll, each measured
    // against the defence the target already made - the same roll that lost the first
    // Clash, bonuses and all.
    followUps: { rolls: 3, woundPerHitPerTier: 2 },
    rules: [
      "After you hit, and before the Wound Roll, roll your Strike Roll three more times.",
      "Each is measured against the roll they answered the first Strike with.",
      "Every one that beats it adds 2(T) to the Wound Roll.",
      "A hit that landed automatically still faces that defence here - the first Strike "
        + "is the one that could not be stopped."
    ]
  },

  launching: {
    label: "Launching",
    foundations: ["physical", "energy", "magic"],
    kiCostPerTier: 3,
    damageCategory: "standard",
    summary: "An attack that sends enemies flying away from you.",
    grantsAdvantage: "knockback",
    doublesCollisionDamage: true,
    rules: [
      "Gains the Knockback Advantage for free - no added KP, and no added TP as a Signature Technique.",
      "Collision Damage from movement this causes is doubled."
    ]
  },

  megaFlare: {
    label: "Mega Flare",
    foundations: ["physical", "energy", "magic"],
    kiCostPerTier: 4,
    damageCategory: "standard",
    summary: "By focusing as much energy as possible, this attack is highly destructive.",
    maxEnergyCharges: 10,
    woundPerChargePerTier: 1,
    categoryUpAtCharges: 7,
    rules: [
      "Holds up to 10 Energy Charges rather than the usual 7.",
      "Each Energy Charge adds 1(T) to the Wound Roll, on top of its die.",
      "At 7 or more Energy Charges the Damage Category rises by one."
    ]
  },

  // --- Physical -------------------------------------------------------------
  // Every one of these is bound by the Foundation's own rule: a Physical Attack can
  // only be made against an Opponent within your Melee Range.

  blitz: {
    label: "Blitz",
    foundations: ["physical"],
    kiCostPerTier: 4,
    damageCategory: "standard",
    summary: "An attack made as part of a high-speed charge.",
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
    rules: [
      "Gains the Charging Assault Advantage for free - no added KP, and no added TP as a Signature Technique.",
      "Move further than your Normal Speed through Charging Assault and the Wound Roll rises by half your Agility Modifier.",
      "As a Signature Technique, the KP Cost drops by 2(T)."
    ]
  },

  crushing: {
    label: "Crushing",
    foundations: ["physical"],
    kiCostPerTier: 6,
    damageCategory: "lethal",
    summary: "A heavy strike with the intent to break bones or cause internal damage.",
    // Strike is Haste + Awareness, so this is a penalty of half the Haste that went
    // into it - taken off the roll rather than rebuilt, so anything else that changed
    // Strike is untouched.
    halfHasteOnStrike: true,
    rules: ["Only half of your Haste applies to the Strike Roll."]
  },

  pinpoint: {
    label: "Pinpoint",
    foundations: ["physical"],
    kiCostPerTier: 4,
    damageCategory: "standard",
    summary: "Attacks made against pressure points, done through immense skill and precision.",
    ignoresSoakByInsight: true,
    rules: [
      "Ignores the target's Soak Value equal to your Insight Modifier.",
      "A Critical Result on the Strike Roll doubles that Insight Modifier for this attack."
    ]
  },

  powered: {
    label: "Powered",
    foundations: ["physical"],
    kiCostPerTier: 8,
    damageCategory: "standard",
    summary: "A single, powerful punch or kick charged to the brim with ki.",
    extraDamageAttribute: true,
    grantsEnergyCharge: 1,
    rules: [
      "Your Damage Attribute applies one more time.",
      "Gains an Energy Charge."
    ]
  },

  soaring: {
    label: "Soaring",
    foundations: ["physical"],
    kiCostPerTier: 5,
    damageCategory: "direct",
    summary: "A physical attack that launches a concussive shock wave at a distant opponent.",
    area: { shape: "line", magnitude: "standard" },
    // A shock wave "at a distant opponent": this is the Profile that specifies
    // otherwise, so the Melee Range the Physical Foundation demands does not bind it.
    ignoresMeleeRule: true,
    rules: [
      "Has a Standard Line AoE.",
      "Reaches past your Melee Range, unlike every other Physical Attack."
    ]
  },

  sweeping: {
    label: "Sweeping",
    foundations: ["physical"],
    kiCostPerTier: 4,
    damageCategory: "standard",
    summary: "The user strikes at multiple enemies simultaneously.",
    area: { shape: "sphere", magnitude: "minor", centredOnSelf: true, sparesAllies: true },
    doublesDiminishingDefense: true,
    rules: [
      "Has a Minor Sphere AoE centred on you.",
      "Allies within it are not targeted.",
      "Deal Damage and a target takes twice the Diminishing Defense stacks."
    ]
  }
});

/**
 * What a Foundation demands of an attack made with it, beyond the Damage Attribute.
 *
 * Each Foundation has rules of its own. Physical is the one written so far: "Physical
 * Attacks can only be made against Opponents within your Melee Range, unless specified
 * otherwise."
 */
export const FOUNDATION_RULES = Object.freeze({
  physical: { meleeOnly: true },
  energy: {},
  magic: {}
});

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
/** How an Area of Effect is named on the card and in the picker. */
export function areaLabel(area) {
  if (!area) return "";
  const name = `${area.magnitude} ${area.shape}`.replace(/(^|\s)\w/g, c => c.toUpperCase());
  return area.centredOnSelf ? `${name} (centred on you)` : name;
}

function profileTip(profile) {
  const lines = [profile.summary, ...(profile.rules ?? [])].filter(Boolean);
  if (profile.grantsAdvantage === "charging-assault") {
    lines.push("Move on the map first, then say how far you came - the line, the "
      + "distance and where you end up are yours to make; the Squares are what the "
      + "bonuses are worked out from.");
  }
  if (profile.grantsAdvantage === "knockback") {
    lines.push("Deal Damage and the card offers the Might Clash. Win it and move them "
      + "yourself; what the collision costs is yours and the GM's to set, and the "
      + "button takes it straight off their Life.");
  }
  if (profile.area) {
    lines.push("Add the others it catches with the button on the card - who the "
      + `${areaLabel(profile.area)} covers is yours and the GM's to agree.`);
  }
  if (profile.needs) lines.push(`Not automated: ${profile.needs}`);
  if (!lines.length) return "";
  return ` data-tooltip="${Handlebars.escapeExpression(lines.join("\n"))}"`;
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

  const available = PROFILES[profile].foundations;
  const foundation = (available.length === 1)
    ? available[0]
    : await pick(
        `${maneuver.name} - ${PROFILES[profile].label} Profile`,
        "Which Foundation is this attack made with?",
        available.map(key => ({ action: key, label: foundations[key].label }))
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

  const sections = groups.map(group => {
    if (!group.profiles.length) return "";
    const items = group.profiles.map(profile => {
      const attr = checked ? "" : "checked";
      checked = true;
      return `<label class="dbu-profile-option">
        <input type="radio" name="profile" value="${profile.id}" ${attr}/>
        <span class="dbu-profile-name"${profileTip(profile)}>${Handlebars.escapeExpression(profile.label)}</span>
        <span class="dbu-profile-category">${DAMAGE_CATEGORIES[profile.damageCategory].label}</span>
        <span class="dbu-profile-cost">${profileKiCost(profile.id, maneuver, actor)} KP</span>
      </label>`;
    }).join("");

    return `<details class="dbu-profile-group" open>
      <summary>${Handlebars.escapeExpression(group.label)}</summary>
      ${items}
    </details>`;
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
export function maxKiWager(actor) {
  const { capacity, ki } = actor.system;
  return Math.max(0, Math.min(Math.floor(capacity.max / 2), capacity.remaining, ki.value));
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

  const sections = groups.map(group => {
    if (!group.profiles.length) {
      return `<details class="dbu-profile-group dbu-profile-empty">
        <summary>${Handlebars.escapeExpression(group.label)} <em>none yet</em></summary>
      </details>`;
    }

    const items = group.profiles.map(profile => {
      // The first Profile in the first non-empty group starts selected, so confirming
      // straight away is always a valid choice.
      const attr = checked ? "" : "checked";
      checked = true;
      return `<label class="dbu-profile-option">
        <input type="radio" name="profile" value="${profile.id}" ${attr}/>
        <span class="dbu-profile-name"${profileTip(profile)}>${Handlebars.escapeExpression(profile.label)}</span>
        <span class="dbu-profile-category">${DAMAGE_CATEGORIES[profile.damageCategory].label}</span>
        <span class="dbu-profile-cost">${profileKiCost(profile.id, maneuver, actor)} KP</span>
      </label>`;
    }).join("");

    // Groups that hold something open by default; empty ones stay shut.
    return `<details class="dbu-profile-group" open>
      <summary>${Handlebars.escapeExpression(group.label)}</summary>
      ${items}
    </details>`;
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
  const wagerMax = maxKiWager(actor);
  const wagerMin = minimumKiWager(actor, maneuver);
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
 * What a Profile adds to the price.
 *
 * Every Physical Profile is written in the "4(T)" notation, so it grows with the Tier
 * of Power. Blitz alone takes some of it back as a Signature Technique - "reduce the KP
 * Cost by 2(T)" - and never below nothing.
 */
export function profileKiCost(profileId, maneuver, actor) {
  const profile = PROFILES[profileId];
  if (!profile) return 0;

  const tier = actor?.system?.tierOfPower ?? 1;
  const cost = (profile.kiCost ?? 0) + ((profile.kiCostPerTier ?? 0) * tier);
  const discount = (maneuver?.signature && profile.signatureDiscountPerTier)
    ? profile.signatureDiscountPerTier * tier
    : 0;

  return Math.max(0, cost - discount);
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
  if (actor && maneuver.attacking) cost = applySlot(slots, "attack.kiCost", cost);

  // The wager is Ki spent on the attack like any other, so it is paid here - which is
  // also what takes it out of Capacity. A Talent that cheapens Attacking Maneuvers
  // discounts the Maneuver, never the wager: the wager is what you chose to spend.
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
    kiCost: trait.kiCost ?? 0,
    attacking: Boolean(trait.attacking),
    requiresTarget: Boolean(trait.requiresTarget),
    defend: Boolean(trait.defend),
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
