/**
 * Vehicles (the Vehicles page; the user's, 2026-11-15): an Actor type of their own, made from nothing a Character has - a
 * Craftsmanship Grade, a Size Category, a Vehicle Level and Vehicle Qualities, and from those its Life, Ki, Capacity, Output and
 * the Aptitudes Output stands in for. Everything a Vehicle is lives here; its data model (data/actor-vehicle.mjs) and its sheet
 * (sheets/actor-vehicle-sheet.mjs) only ask.
 *
 * The Vehicle Qualities are files - traits/vehicles/qualities/<id>.dbu, their entries as the page prints them - and what each
 * does to the numbers is said in its header, in a few words read here:
 *   damageReduction: halfOutput   Armored Plating        soakValue: level        Heavy Vehicle
 *   speeds: half                  Heavy Vehicle          boostedSpeed: doubleOutput  Boost Speed
 *   hardnessRank: slots           Brutal Design          extraRows: slots        Extra Space
 *   sizeTo: colossal              Ultra-Massive          defenseValueThere: halfOutput  Favored Environment (said; applied in play)
 * and what each asks, warned of and never refused (the user's): needsSizeAtLeast, needsSizeIs, needsGrade, needsQuality,
 * needsCreatorSkill ("<skill> <ranks>"), and the Battle Environments it has chosen (choose / chooseCount).
 */

import DBUCharacterData from "./data/actor-character.mjs";
import { hardnessValue } from "./features.mjs";
import { getTrait, traitsOfKind } from "./effects/traits.mjs";

/** The Size Categories a Vehicle may be made at - "from Large to Gigantic"; Colossal only by Ultra-Massive. */
export const VEHICLE_SIZES = Object.freeze(["large", "enormous", "gigantic"]);

/** Vehicle Level: its creator's Power Level when made, Tune Up to its owner's - a Power Level's bounds. */
export const MAX_VEHICLE_LEVEL = 30;

/** "At Vehicle Level 1, a Vehicle has a Maximum Life Point value of 50", 5 more a Level; Ki 30 and 8 more a Level. */
export const VEHICLE_LIFE = Object.freeze({ base: 50, perLevel: 5 });
export const VEHICLE_KI = Object.freeze({ base: 30, perLevel: 8 });

/** "Most Vehicles have a Hardness Rank of 3." */
export const VEHICLE_HARDNESS_RANK = 3;

/** The Craftsmanship Grade table: its Craft DC and how many Quality Slots it gives. */
export const VEHICLE_GRADES = Object.freeze([
  { grade: 1, difficulty: "apprentice", slots: 0 },
  { grade: 2, difficulty: "qualified", slots: 1 },
  { grade: 3, difficulty: "expert", slots: 2 },
  { grade: 4, difficulty: "master", slots: 3 },
  { grade: 5, difficulty: "grandmaster", slots: 4 }
]);

/** The Vehicle Qualities' files, in name order. */
export function vehicleQualities() {
  return traitsOfKind("vehicles", "qualities");
}

/** How many Quality Slots a Vehicle Quality may take: "1", or a range "1~3" to choose in. */
export function qualitySlotRange(definition) {
  const [min, max] = String(definition?.slots ?? "1").split("~").map(part => Math.max(1, Math.floor(Number(part) || 1)));
  return { min, max: Math.max(min, max ?? min) };
}

/** A Grade's row, 1 to 5. */
export function gradeRow(grade) {
  return VEHICLE_GRADES.find(row => row.grade === Number(grade)) ?? VEHICLE_GRADES[0];
}

/** The Squares a Size Category takes up, as columns and rows - "2x2"; "1" is one Square. */
function squaresOf(sizeKey) {
  const [cols, rows] = String(DBUCharacterData.SIZES[sizeKey]?.squares ?? "1").split("x").map(part => Number(part) || 1);
  return { cols, rows: rows ?? cols };
}

/** A header's amount, by its word. */
function amountOf(word, { output, level, slots }) {
  switch (String(word ?? "").trim()) {
    case "halfOutput": return Math.floor(output / 2);
    case "output": return output;
    case "doubleOutput": return output * 2;
    case "level": return level;
    case "slots": return slots;
    default: return Number(word) || 0;
  }
}

/** The Size order, smallest first, for "Gigantic or larger". */
const SIZE_ORDER = Object.keys(DBUCharacterData.SIZES);

/**
 * Whatever a Vehicle Quality asks that this Vehicle does not have - warned of, never refused (the user's).
 *
 * @param {object} definition     the Quality's file
 * @param {object} vehicle        { grade, size (as made, before Ultra-Massive), qualityIds, creator (an Actor or null) }
 * @returns {string[]}
 */
export function qualityWarnings(definition, { grade, size, qualityIds = [], creator = null } = {}) {
  const warnings = [];
  const sizeLabel = key => DBUCharacterData.SIZES[key]?.label ?? key;
  if (definition.needsSizeAtLeast && (SIZE_ORDER.indexOf(size) < SIZE_ORDER.indexOf(definition.needsSizeAtLeast))) {
    warnings.push(`Needs a Size Category of ${sizeLabel(definition.needsSizeAtLeast)} or larger.`);
  }
  if (definition.needsSizeIs && (size !== definition.needsSizeIs)) {
    warnings.push(`Needs the Size Category to be ${sizeLabel(definition.needsSizeIs)} before it applies.`);
  }
  if (definition.needsGrade && (Number(grade) < Number(definition.needsGrade))) {
    warnings.push(`Needs a Craftsmanship Grade of ${definition.needsGrade} or higher.`);
  }
  for (const needed of [].concat(definition.needsQuality ?? []).filter(Boolean)) {
    if (!qualityIds.includes(needed)) warnings.push(`Needs the ${getTrait(needed)?.name ?? needed} Vehicle Quality.`);
  }
  for (const need of [].concat(definition.needsCreatorSkill ?? []).filter(Boolean)) {
    const [skill, least] = String(need).split(/\s+/);
    const label = DBUCharacterData.SKILLS?.[skill]?.label ?? skill;
    if (!creator) warnings.push(`Needs its Creator to have ${least}+ Skill Ranks in ${label} - no Creator chosen in Creation.`);
    else if ((Number(creator.system?.skills?.[skill]?.ranks) || 0) < Number(least)) {
      warnings.push(`Needs its Creator to have ${least}+ Skill Ranks in ${label}: ${creator.name} has ${Number(creator.system?.skills?.[skill]?.ranks) || 0}.`);
    }
  }
  return warnings;
}

/** A Battle Environment's name, by its id. */
export function environmentName(id) {
  return getTrait(id)?.name ?? id;
}

/** The Battle Environments a Favored Environment may pick from. */
export function battleEnvironments() {
  return traitsOfKind("battlefields").filter(trait => trait.environment === true);
}

/**
 * Everything a Vehicle's numbers are, from what it was made with.
 *
 * "A Vehicle's Output is equal to its Vehicle Level plus double its Craftsmanship Grade", and it stands in for the Attributes:
 * Speed is Output and Boosted 1.5x Output (rounded down), Might is Output, Soak Value and Defense Value are Output with the Size
 * Category's per-Tier change after it (the user's) - the Tier its Vehicle Level's, as a Character's is their Power Level's - and
 * no Size bonus to Speed (the user's). Damage Reduction 0 by default. Capacity as a Character of that Power Level has.
 *
 * @param {object} source      the Vehicle's own data: grade, size, vehicleLevel, qualities, capacity.spent
 * @param {object} [options]
 * @param {Actor|null} [options.creator]  its Creator, for the Prerequisites that ask about Skills
 */
export function vehicleReading(source, { creator = null } = {}) {
  const grade = Math.min(5, Math.max(1, Math.floor(Number(source?.grade) || 1)));
  const level = Math.min(MAX_VEHICLE_LEVEL, Math.max(1, Math.floor(Number(source?.vehicleLevel) || 1)));
  const madeSize = VEHICLE_SIZES.includes(source?.size) ? source.size : VEHICLE_SIZES[0];
  const output = level + (2 * grade);
  const tier = DBUCharacterData.tierOfPowerFor(level);

  const owned = (source?.qualities ?? []).map(entry => ({ entry, definition: getTrait(entry.id) }))
    .filter(({ definition }) => definition?.kind === "vehicles");
  const qualityIds = owned.map(({ definition }) => definition.id);
  const context = slots => ({ output, level, slots });

  // What the Qualities do, summed - each kept by name for the hovers.
  const from = { damageReduction: [], soakValue: [], hardnessRank: [], extraRows: [] };
  let halfSpeeds = null;
  let boostedFrom = null;
  let sizeKey = madeSize;
  const qualities = owned.map(({ entry, definition }) => {
    const range = qualitySlotRange(definition);
    const slots = Math.min(range.max, Math.max(range.min, Math.floor(Number(entry.slots) || range.min)));
    const effects = [];
    for (const key of Object.keys(from)) {
      if (definition[key] === undefined) continue;
      const amount = amountOf(definition[key], context(slots));
      from[key].push({ name: definition.name, amount });
      const said = { damageReduction: "DR", soakValue: "Soak", hardnessRank: "Hardness Rank", extraRows: "Rows" }[key];
      effects.push(`${said} +${amount}`);
    }
    if (definition.speeds === "half") { halfSpeeds = definition.name; effects.push("Speeds halved"); }
    if (definition.boostedSpeed) {
      boostedFrom = { name: definition.name, amount: amountOf(definition.boostedSpeed, context(slots)) };
      effects.push(`Boosted ${boostedFrom.amount}`);
    }
    if (definition.sizeTo && DBUCharacterData.SIZES[definition.sizeTo]) {
      sizeKey = definition.sizeTo;
      effects.push(DBUCharacterData.SIZES[definition.sizeTo].label);
    }
    if (definition.defenseValueThere) {
      effects.push(`DV +${amountOf(definition.defenseValueThere, context(slots))} there`);
    }
    const chooseCount = Number(definition.chooseCount) || 0;
    return {
      id: definition.id,
      name: definition.name,
      slots,
      range,
      ranged: range.max > range.min,
      effect: effects.join(", "),
      choose: definition.choose === "environment" ? chooseCount : 0,
      choices: (entry.choices ?? []).slice(0, chooseCount),
      waits: String(definition.waits ?? ""),
      weapons: definition.weapons ? amountOf(definition.weapons, context(slots)) : 0,
      warnings: qualityWarnings(definition, { grade, size: madeSize, qualityIds, creator })
    };
  });

  const sum = list => list.reduce((total, each) => total + each.amount, 0);
  const said = (base, list) => [base, ...list.map(each => `${each.name} +${each.amount}`)].join("<br>");

  const size = DBUCharacterData.SIZES[sizeKey];
  const defenseChange = size.defensePerTier * tier;
  const soakChange = size.soakPerTier * tier;
  const signed = value => (value < 0 ? `− ${-value}` : `+ ${value}`);

  const defenseValue = DBUCharacterData.applySizeModifier(output, defenseChange);
  const soakValue = DBUCharacterData.applySizeModifier(output, soakChange) + sum(from.soakValue);
  const damageReduction = sum(from.damageReduction);
  const hardnessRank = Math.min(DBUCharacterData.MAX_HARDNESS_RANK, VEHICLE_HARDNESS_RANK + sum(from.hardnessRank));

  let normal = output;
  let boosted = boostedFrom ? boostedFrom.amount : Math.floor(output * 1.5);
  if (halfSpeeds) { normal = Math.floor(normal / 2); boosted = Math.floor(boosted / 2); }

  const { cols, rows } = squaresOf(sizeKey);
  const extraRows = sum(from.extraRows);
  const slotsHave = gradeRow(grade).slots;
  const slotsUsed = qualities.reduce((total, quality) => total + quality.slots, 0);
  const lifeMax = VEHICLE_LIFE.base + (VEHICLE_LIFE.perLevel * (level - 1));
  const kiMax = VEHICLE_KI.base + (VEHICLE_KI.perLevel * (level - 1));
  const capacityMax = DBUCharacterData.BASE_CAPACITY + (DBUCharacterData.CAPACITY_PER_LEVEL * (level - 1));
  const capacitySpent = Math.max(0, Math.floor(Number(source?.capacity?.spent) || 0));

  return {
    grade, level, output, tier,
    gradeRow: gradeRow(grade),
    madeSize,
    size: { key: sizeKey, label: size.label, steps: SIZE_ORDER.indexOf(sizeKey) - SIZE_ORDER.indexOf(DBUCharacterData.DEFAULT_SIZE),
      cols, rows: rows + extraRows, baseRows: rows, extraRows, squares: cols * (rows + extraRows) },
    lifeMax, kiMax,
    capacity: { max: capacityMax, spent: capacitySpent, left: Math.max(0, capacityMax - capacitySpent) },
    defenseValue, soakValue, damageReduction,
    might: output,
    speed: { normal, boosted },
    hardnessRank,
    hardness: hardnessValue(hardnessRank, tier),
    slots: { have: slotsHave, used: slotsUsed, over: Math.max(0, slotsUsed - slotsHave) },
    qualities,
    workings: {
      output: `Vehicle Level ${level} + 2 × Grade ${grade}`,
      speed: halfSpeeds ? `Output ${output}, halved (${halfSpeeds})` : `Output ${output}`,
      boosted: [boostedFrom ? `${boostedFrom.name}: 2 × Output` : `1.5 × Output ${output}, rounded down`,
        ...(halfSpeeds ? [`halved (${halfSpeeds})`] : [])].join("<br>"),
      might: `Output ${output}`,
      soakValue: said(`Output ${output} ${signed(soakChange)} ${size.label} (${size.soakPerTier} × Tier ${tier})`, from.soakValue),
      defenseValue: `Output ${output} ${signed(defenseChange)} ${size.label} (${size.defensePerTier} × Tier ${tier})`,
      damageReduction: said("0 by default", from.damageReduction),
      hardness: said(`Rank ${VEHICLE_HARDNESS_RANK}`, from.hardnessRank) + `<br>${hardnessValue(hardnessRank, tier)} at Tier ${tier}`,
      squares: `${size.label}: ${cols}×${rows}` + (extraRows ? ` + ${extraRows} row${extraRows > 1 ? "s" : ""} (Extra Space)` : ""),
      life: `50 at Vehicle Level 1, 5 more for each Level after it`,
      ki: `30 at Vehicle Level 1, 8 more for each Level after it`,
      capacity: `A Power Level ${level} Character's: 20 + 4 for each Level after the first`
    }
  };
}

/**
 * A Vehicle's token as big as the Squares it takes up - Extra Space's rows included - and linked to its sheet: one Vehicle, one
 * token. Set as it is made, and again whenever its Size or its Qualities change, on its prototype and on the tokens of it on the
 * scenes (by the GM, who may change them).
 */
export function tokenSizeOf(reading) {
  return { width: reading.size.cols, height: reading.size.rows };
}

export function registerVehicleHooks() {
  Hooks.on("preCreateActor", (actor, data) => {
    if (actor.type !== "vehicle") return;
    const reading = vehicleReading(actor.system);
    actor.updateSource({ prototypeToken: { actorLink: true, ...tokenSizeOf(reading) },
      "system.life.value": reading.lifeMax, "system.ki.value": reading.kiMax });
  });
  Hooks.on("updateActor", async (actor, change, options, userId) => {
    if ((actor.type !== "vehicle") || (game.user.id !== userId)) return;
    const changed = foundry.utils.getProperty(change, "system");
    if (!changed || !(("size" in changed) || ("qualities" in changed))) return;
    const size = tokenSizeOf(actor.system.reading);
    const proto = actor.prototypeToken;
    if ((proto.width !== size.width) || (proto.height !== size.height)) await actor.update({ prototypeToken: size });
    for (const token of actor.getActiveTokens(false, true)) {
      if (((token.width !== size.width) || (token.height !== size.height)) && token.isOwner) await token.update(size);
    }
  });
}

/** The Actor a uuid names, if it can be had without waiting - a Vehicle's Creator, its Pilot and Passengers. */
export function actorAt(uuid) {
  if (!uuid) return null;
  try { return globalThis.fromUuidSync?.(uuid) ?? null; }
  catch { return null; }
}
