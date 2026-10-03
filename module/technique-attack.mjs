/**
 * What a Signature Technique's features do to the attack it is made with.
 *
 * Worked out once, when the attack is declared (`techniqueAttack`), and carried on the attack
 * as `attack.technique`: which features are active on this attack and which are switched off
 * because their Requirement is not met on it ("the Signature Technique stops benefiting from the
 * effects of that Advantage"), the Area it ends up with, the Energy Charges it gains, and the
 * flags the Strike, the Wound and the damage read. The rows themselves are built here too, so
 * chat.mjs only asks for them where each roll is made.
 *
 * Numbers per Tier are multiplied with the Tier of the one rolling: "(T)" the Tier of Power,
 * "(bT)" the base Tier.
 */

import { PROFILES, SUPER_PROFILES, atLongRange, flatSquaresAway, LONG_RANGE_SQUARES,
  heightRanksBetween } from "./maneuvers.mjs";
import { featureRanks } from "./signature.mjs";
import { buildArea, connectedWeather, featureDef, requirementHolds } from "./technique.mjs";

const tierOf = actor => Math.max(1, Number(actor?.system?.tierOfPower) || 1);
const baseTierOf = actor => Math.max(1, Number(actor?.system?.baseTierOfPower) || 1);

/** The Health Thresholds reached, counted from Bruised: Bruised 1, Injured 2, Critical 3. */
export function thresholdsBelow(actor) {
  return Math.max(0, ["healthy", "bruised", "injured", "critical"].indexOf(actor?.system?.threshold?.key ?? "healthy"));
}

/**
 * The Technique block an attack carries.
 *
 * @param {object} maneuver  the Technique's definition, through the door (level, ultimate, the
 *   Super Profile, `featureChoices`, `advantages`)
 * @param {object} declared  what was declared: profile, foundation, advantages (with anything a
 *   Profile granted), area, weapon, charges, the targets' uuids, and the answers asked for
 */
export function techniqueAttack(actor, maneuver, declared, { targets = [], shaken = [] } = {}) {
  const advantages = [...(declared.advantages ?? maneuver.advantages ?? [])];
  const choices = maneuver.featureChoices ?? {};
  const ultimate = Boolean(maneuver.ultimate);
  const profiles = [declared.profile, maneuver.secondProfile].filter(Boolean);
  const superId = maneuver.superProfile ?? "";
  const tierCharges = Number(declared.charges) || 0;

  // The Area first, from everything but the Charges Super Beam counts.
  const weaponSteps = Number(declared.weapon?.magnitude) || 0;
  const weaponArea = declared.thrown?.area ?? null;
  const areaFor = charges => buildArea({ profiles, features: advantages, choices,
    weaponArea, weaponSteps, charges, superProfile: superId, picked: declared.areaFrom ?? "" });

  // Which features hold on this attack. Read against the final attack: its Area, its Charges,
  // whether it is an Ultimate this time (Ascended counts). A Disadvantage stays whatever happens.
  const provisional = areaFor(tierCharges).area;
  const ctx = {
    actor, profiles, foundation: declared.foundation ?? "", ultimate, area: provisional,
    charges: tierCharges,
    ranks: id => featureRanks(advantages, id),
    choiceOf: id => choices[id] ?? ""
  };
  const off = [];
  const on = [];
  for (const id of [...new Set(advantages)]) {
    const def = featureDef(id);
    if (!def) { on.push(id); continue; }
    const holds = !def.requires || requirementHolds(def.requires, { ...ctx, choice: choices[id] ?? "" });
    if (holds || (def.owner === "disadvantages")) on.push(id);
    else off.push({ id, name: def.name, why: def.requirement });
  }
  const active = advantages.filter(id => on.includes(id));
  const has = id => active.includes(id);
  const ranks = id => featureRanks(active, id);

  // Energy Charges the features bring, before the ceiling.
  const single = targets.length === 1;
  const bonusCharges = []
    .concat(has("concentrated-strike") && single ? [{ label: "Concentrated Strike", amount: 1 }] : [])
    .concat(has("overwhelming-terror") && targets.length && (shaken.length === targets.length)
      ? [{ label: "Overwhelming Terror", amount: 1 }] : [])
    .concat(has("transformation-boost") && declared.transformed ? [{ label: "Transformation Boost", amount: 1 }] : [])
    .concat(ultimate && thresholdsBelow(actor) ? [{ label: "Ultimate (Thresholds)", amount: thresholdsBelow(actor) }] : [])
    .concat(declared.gigaFlare ? [{ label: "Giga Flare", amount: 2 * declared.gigaFlare }] : [])
    .concat(declared.superCombination ? [{ label: "Super Combination", amount: declared.superCombination }] : [])
    // Spike!: "it gains 1 Energy Charge for each time the Opponent has been hit by an Attacking Maneuver from your
    // Allies during Volleyball Time!"
    .concat(declared.volleyball?.charges ? [{ label: "Volleyball Time!", amount: declared.volleyball.charges }] : []);

  // The Super Profile, if its Prerequisite holds on this attack.
  const superEntry = SUPER_PROFILES[superId] ?? null;
  const charged = tierCharges + bonusCharges.reduce((sum, entry) => sum + entry.amount, 0);
  const superHolds = superEntry && (!superEntry.prerequisite
    || requirementHolds(superEntry.prerequisite, { ...ctx, charges: charged, area: provisional }));

  const { area, notes } = areaFor(charged);
  // Controlled Blast: "this Attacking Maneuver's Target Square is any Square you select on the
  // Battlefield that is not at Long Range, pointing in any direction you wish."
  if (area && active.includes("controlled-blast")) area.anySquare = true;
  const lead = [];
  if (off.length) lead.push(`${off.map(entry => entry.name).join(", ")}: Requirement not met`);
  if (superEntry && !superHolds) lead.push(`${superEntry.label}: Prerequisite not met`);

  return {
    itemId: maneuver.itemId ?? "",
    level: maneuver.level ?? "super",
    ultimate,
    ascended: Boolean(maneuver.ascended),
    features: active,
    off,
    choices,
    superProfile: superHolds ? superId : "",
    secondProfile: maneuver.secondProfile ?? "",
    area,
    areaNotes: notes,
    bonusCharges,
    // "Ultimate Signature Techniques can possess an additional Energy Charge beyond the
    // Character's usual limit."
    chargeCeilingBonus: ultimate ? 1 : 0,
    // Charged Up is the Technique's own; these are on top: Maximum Charge, Super Beam.
    chargeCategories: (has("maximum-charge") ? 1 : 0) + ((superHolds && superId === "super-beam") ? 1 : 0),
    absolute: has("intense-blast"),
    attacksCounted: 1 + ranks("shoot-and-pray"),
    diminishingDefenseTimes: 1 + ranks("peppering-blows") + (Number(declared.superCombination) || 0),
    followUpRolls: ranks("alotta-lotta-attacks") + (Number(declared.superCombination) || 0),
    noThresholdPenalty: has("last-legs"),
    noMusclePenalty: has("power-burst"),
    superStacks: ranks("power-burst"),
    extraDamageAttribute: Boolean(superHolds && superEntry?.extraDamageAttribute),
    halfDamageAttribute: has("low-power-crush"),
    linked: {
      strike: has("twin-linked") && (choices["twin-linked"] === "strike") ? "high"
        : has("dead-link") && (choices["dead-link"] === "strike") ? "low" : "",
      wound: has("twin-linked") && (choices["twin-linked"] === "wound") ? "high"
        : has("dead-link") && (choices["dead-link"] === "wound") ? "low" : ""
    },
    targetsCount: targets.length,
    splittingTargets: has("splitting") ? (ranks("splitting") >= 2 ? 4 : 2) : 0,
    squaresCharged: Number(declared.squaresCharged) || 0,
    powerbomb: Boolean(declared.powerbomb && ranks("powerbomb")),
    thresholdsBelow: thresholdsBelow(actor),
    weather: has("weather-calling") ? weatherCalled(profiles, ultimate, superHolds && superId === "weather-maximizer") : null,
    notes: lead
  };
}

/** Weather Calling's Battle Weather, and its Tier: Natural, Unnatural, or Cataclysmic. */
function weatherCalled(profiles, ultimate, maximized) {
  const weather = profiles.map(id => connectedWeather(id)).find(Boolean);
  if (!weather) return null;
  const tier = maximized ? "Cataclysmic" : (ultimate ? "Unnatural" : "Natural");
  return { id: weather.id, name: weather.name, tier };
}

// --- The Strike -------------------------------------------------------------------------------

/** What the Technique adds to its Strike Roll, the same for everyone it reaches. */
export function techniqueStrikeParts(attacker, attack) {
  const tech = attack.technique;
  if (!tech) return [];
  const tier = tierOf(attacker);
  const ranks = id => featureRanks(tech.features, id);
  const doubled = id => (tech.features.includes("super-advantage") && (tech.choices["super-advantage"] === id)) ? 2 : 1;
  const parts = [];
  if (ranks("accurate")) {
    const per = ranks("accurate") * doubled("accurate");
    parts.push({ label: `Accurate ${ranks("accurate")}`, written: `+${per}(T)`, value: per * tier });
  }
  if (ranks("inaccurate")) {
    parts.push({ label: `Inaccurate ${ranks("inaccurate")}`, written: `-${ranks("inaccurate")}(T)`,
      value: -ranks("inaccurate") * tier });
  }
  if (tech.features.includes("last-legs") && tech.thresholdsBelow) {
    parts.push({ label: "Last Legs", written: `+${tech.thresholdsBelow}(T)`, value: tech.thresholdsBelow * tier });
  }
  // Elemental (Light): "If this Attacking Maneuver has the Elemental (Dark) Profile applied to it,
  // increase the Strike Roll by 1(T)."
  if (darkAndLight(attack)) parts.push({ label: "Elemental (Light) with (Dark)", written: "+1(T)", value: tier });
  return parts;
}

/** Whether both Elemental (Dark) and Elemental (Light) are on this attack - Multi-Profile's pair. */
export function darkAndLight(attack) {
  const profiles = [attack?.profile, attack?.technique?.secondProfile || attack?.secondProfile,
    ...(attack?.appliedProfiles ?? [])];
  return profiles.includes("elementalDark") && profiles.includes("elementalLight");
}

/**
 * What the Technique adds to the Strike against one target: Long Shot at 9+ Squares, Short Range
 * outside Melee Range, a Trick Attack's Clash won against them.
 *
 * @param {{longRange: boolean, outsideMelee: boolean, tricked: boolean}} facts  about this pair
 */
export function techniqueStrikeAgainst(attacker, attack, { longRange = false, outsideMelee = false, tricked = false } = {}) {
  const tech = attack.technique;
  if (!tech) return 0;
  const tier = tierOf(attacker);
  const baseTier = baseTierOf(attacker);
  const ranks = id => featureRanks(tech.features, id);
  const doubled = id => (tech.features.includes("super-advantage") && (tech.choices["super-advantage"] === id)) ? 2 : 1;
  let value = 0;
  if (longRange && ranks("long-shot")) value += ranks("long-shot") * doubled("long-shot") * tier;
  if (outsideMelee && (ranks("short-range") === 1)) value -= 2 * baseTier;
  if (tricked) value += 2 * baseTier;
  return value;
}

/**
 * Sky Assault: "Ignore any penalties from Long Range due to an Opponent being on a higher High
 * Environment." Due to the height when the map alone would not make it Long Range.
 */
export function skyAssaultWaives(attacker, attack, target) {
  if (!attack.technique?.features?.includes("sky-assault")) return false;
  const up = rank => Math.max(0, Number(rank?.system?.battlefield?.highEnvironment) || 0);
  if (!(up(target) > up(attacker))) return false;
  const flat = flatSquaresAway(attacker, target);
  return (flat !== null) && (flat < LONG_RANGE_SQUARES) && (heightRanksBetween(attacker, target) > 0);
}

// --- The Wound --------------------------------------------------------------------------------

/** What the Technique adds to its Wound Roll, the same for everyone it reaches. */
export function techniqueWoundParts(attacker, attack) {
  const tech = attack.technique;
  if (!tech) return [];
  const tier = tierOf(attacker);
  const ranks = id => featureRanks(tech.features, id);
  const parts = [];
  if (ranks("low-penetration")) {
    parts.push({ label: `Low Penetration ${ranks("low-penetration")}`, written: `-${ranks("low-penetration")}(T)`,
      value: -ranks("low-penetration") * tier });
  }
  if (tech.features.includes("last-legs") && tech.thresholdsBelow) {
    parts.push({ label: "Last Legs", written: `+${tech.thresholdsBelow}(T)`, value: tech.thresholdsBelow * tier });
  }
  // Splitting: "For each Opponent you chose after the first, reduce your Wound Roll by 1(T)."
  if (tech.features.includes("splitting") && (tech.targetsCount > 1)) {
    const more = tech.targetsCount - 1;
    parts.push({ label: `Splitting (${tech.targetsCount} targets)`, written: `-${more}(T)`, value: -more * tier });
  }
  // Powerbomb: "increased by 1/2 of your Might for each Rank" - each half rounded down.
  if (tech.powerbomb) {
    const half = Math.floor((Number(attacker.system?.might) || 0) / 2);
    const count = ranks("powerbomb");
    if (half) parts.push({ label: `Powerbomb ${count}`, value: half * count });
  }
  // Elemental (Dark): "If this Attacking Maneuver has the Elemental (Light) Profile applied to it,
  // increase the Wound Rolls by 2(T)."
  if (darkAndLight(attack)) parts.push({ label: "Elemental (Dark) with (Light)", written: "+2(T)", value: 2 * tier });
  // Power Shot doubled by Super Advantage: the existing Power Shot row counts once more.
  if (tech.features.includes("super-advantage") && (tech.choices["super-advantage"] === "power-shot")) {
    const shot = Math.min(ranks("power-shot"), 3);
    if (shot) parts.push({ label: "Super Advantage (Power Shot)", written: `+${2 * shot}(T)`, value: 2 * shot * tier });
  }
  return parts;
}

/** What the Technique adds to the Wound against one target: Long Shot, Short Range, Condition. */
export function techniqueWoundAgainst(attacker, attack, { longRange = false, outsideMelee = false,
                                                         alreadyConditioned = false } = {}) {
  const tech = attack.technique;
  if (!tech) return 0;
  const tier = tierOf(attacker);
  const baseTier = baseTierOf(attacker);
  const ranks = id => featureRanks(tech.features, id);
  const doubled = id => (tech.features.includes("super-advantage") && (tech.choices["super-advantage"] === id)) ? 2 : 1;
  let value = 0;
  if (longRange && ranks("long-shot")) value += ranks("long-shot") * doubled("long-shot") * tier;
  if (outsideMelee && (ranks("short-range") === 1)) value -= 2 * baseTier;
  // Condition: "If an Opponent is already suffering from your selected Combat Condition, instead
  // increase the Wound Roll for this Attacking Maneuver against them by 3(T)."
  if (alreadyConditioned) value += 3 * tier;
  return value;
}

/** Karmic: a Category step against an opposing Z-Soul, two against a Pure one. */
export function karmicSteps(attacker, attack, target) {
  if (attack.technique?.superProfile !== "karmic") return 0;
  const mine = Number(attacker?.system?.alignment) || 0;
  const theirs = Number(target?.system?.alignment) || 0;
  if (!mine || !theirs || (Math.sign(mine) === Math.sign(theirs))) return 0;
  return (Math.abs(theirs) >= 2) ? 2 : 1;
}

// --- Damage -----------------------------------------------------------------------------------

/**
 * What the Technique adds to the Damage a target takes, once it is known there is some - and
 * not on an Absolute miss, which "doesn't count as hitting or damaging for triggering effects".
 *
 * @returns {Array<{label: string, value: number}>}
 */
export function techniqueDamageParts(attacker, attack, target, damage, { absoluteMiss = false } = {}) {
  const tech = attack.technique;
  if (!tech || (damage <= 0) || absoluteMiss) return [];
  const ranks = id => featureRanks(tech.features, id);
  const parts = [];
  // Minion Destroyer: "increase the amount of Damage taken by the Damage Attribute".
  if (tech.features.includes("minion-destroyer") && target?.system?.minion) {
    const value = damageAttributeOf(attacker, attack);
    if (value) parts.push({ label: "Minion Destroyer", value });
  }
  // Shattering Blow: "1/4 of the target's Soak Value for each rank" - each quarter on its own.
  if (ranks("shattering-blow")) {
    const quarter = Math.floor(Math.max(0, Number(target?.system?.soakValue) || 0) / 4);
    if (quarter) parts.push({ label: `Shattering Blow ${ranks("shattering-blow")}`, value: quarter * ranks("shattering-blow") });
  }
  // Complete Annihilation: "If a target ... is in the Undying State, increase the amount of Damage
  // they receive by 1/2."
  if ((tech.superProfile === "complete-annihilation") && ((Number(target?.system?.states?.undying) || 0) > 0)) {
    const half = Math.floor(damage / 2);
    if (half) parts.push({ label: "Complete Annihilation (Undying)", value: half });
  }
  return parts;
}

/** The Damage Attribute this attack is made with, as a Modifier: its stand-in, or the Foundation's. */
export function damageAttributeOf(attacker, attack) {
  if (attack.damageAttribute) return Number(attack.damageAttribute.value) || 0;
  const attribute = { physical: "force", energy: "force", magic: "magic" }[attack.foundation] ?? "force";
  const mod = Number(attacker?.system?.attributes?.[attribute]?.mod) || 0;
  return attack.technique?.halfDamageAttribute ? Math.floor(mod / 2) : mod;
}

/** Armor-Piercing: "Ignore the target's Damage Reduction equal to 1/2 of your Insight Modifier." */
export function armorPiercing(attacker, attack, { insightDoubled = false } = {}) {
  if (!attack.technique?.features?.includes("armor-piercing")) return 0;
  const insight = (Number(attacker?.system?.attributes?.insight?.mod) || 0) * (insightDoubled ? 2 : 1);
  return Math.max(0, Math.floor(insight / 2));
}

/** A roll made twice, keeping the higher (Twin-Linked) or the lower (Dead-Link). */
export function linkedPick(first, second, mode) {
  if (!mode || !second) return { kept: first, dropped: null };
  const keepSecond = (mode === "high") ? (second.total > first.total) : (second.total < first.total);
  return keepSecond ? { kept: second, dropped: first } : { kept: first, dropped: second };
}

/** The Profiles an attack is "of" - its own, and Multi-Profile's second. */
export function attackProfiles(attack) {
  return [...new Set([attack.profile, attack.technique?.secondProfile || attack.secondProfile,
    ...(attack.appliedProfiles ?? [])])].filter(id => id && PROFILES[id]);
}

/** Whether an attack carries a Profile flag through any of its Profiles. */
export function anyProfile(attack, flag) {
  return attackProfiles(attack).some(id => PROFILES[id]?.[flag]);
}

export { atLongRange };
