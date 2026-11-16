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

/** The Size order, smallest first, for "Gigantic or larger" - asked when needed, never as the module loads. */
const sizeOrder = () => Object.keys(DBUCharacterData.SIZES);

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
  if (definition.needsSizeAtLeast && (sizeOrder().indexOf(size) < sizeOrder().indexOf(definition.needsSizeAtLeast))) {
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
      choose: ["environment", "weapon"].includes(definition.choose) ? chooseCount : 0,
      // What it chooses: Battle Environments, or one of its Vehicle Weapons (Big Blaster's).
      chooseWeapon: definition.choose === "weapon",
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
    size: { key: sizeKey, label: size.label, steps: sizeOrder().indexOf(sizeKey) - sizeOrder().indexOf(DBUCharacterData.DEFAULT_SIZE),
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
  registerCrewHooks();
  // Hikou: "The current High Environment of the Vehicle is also applied to all Characters within the Vehicle" - its Pilot's, who
  // Soars it: their rank written onto every Passenger as it changes, and onto one getting in.
  Hooks.on("updateActor", async (actor, change, options, userId) => {
    if (userId !== game.user.id) return;
    if (actor.type === "vehicle") {
      if (!foundry.utils.hasProperty(change, "system.crew") || !hasVehicleQuality(actor, "hikou")) return;
      // A Pilot from afar is not where it is.
      const pilot = actor.system.crew?.remote ? null : actorAt(actor.system.crew?.pilot);
      if (pilot) await skyForPassengers(actor, Number(pilot.system?.battlefield?.highEnvironment) || 0);
      return;
    }
    if (!foundry.utils.hasProperty(change, "system.battlefield.highEnvironment")) return;
    const vehicle = pilotedBy(actor);
    if (vehicle && !vehicle.system.crew?.remote && hasVehicleQuality(vehicle, "hikou")) {
      await skyForPassengers(vehicle, Number(actor.system.battlefield?.highEnvironment) || 0);
    }
  });
  Hooks.on("preCreateActor", (actor, data) => {
    if (actor.type !== "vehicle") return;
    const reading = vehicleReading(actor.system);
    actor.updateSource({ prototypeToken: { actorLink: true, ...tokenSizeOf(reading) },
      "system.life.value": reading.lifeMax, "system.ki.value": reading.kiMax });
  });
  // Its Crew changed: everyone who was in it or is now worked out again - what they ignore of the ground and the air is whether
  // they are in it (vehicle-crew.mjs), and that is read as they are prepared.
  Hooks.on("preUpdateActor", (actor, change, options) => {
    // Its Life Points as they were, for whether this write destroys it.
    if ((actor.type === "vehicle") && foundry.utils.hasProperty(change, "system.life.value")) {
      options.dbuLifeBefore = Number(actor.system.life?.value) || 0;
    }
    if ((actor.type === "vehicle") && foundry.utils.hasProperty(change, "system.crew")) {
      const crew = actor.system.crew ?? {};
      options.dbuCrewBefore = [crew.pilot, ...(crew.passengers ?? [])].filter(Boolean);
    }
  });
  // Its Grade changed: its Vehicle Weapons' with it - "a Craftsmanship Grade equal to that of this Vehicle".
  Hooks.on("updateActor", async (actor, change, options, userId) => {
    if ((actor.type !== "vehicle") || (userId !== game.user.id) || !foundry.utils.hasProperty(change, "system.grade")) return;
    const grade = Number(actor.system.grade) || 1;
    const updates = Array.from(actor.items ?? []).filter(item => (item.getFlag?.("dbu-ttrpg", VEHICLE_WEAPON) !== undefined)
      && (Number(item.system?.crafted?.grade) !== grade)).map(item => ({ _id: item.id, "system.crafted.grade": grade }));
    if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  });
  // Destroyed: its Life Points from above 0 to 0 - its crew hurt, once, by the GM.
  Hooks.on("updateActor", async (actor, change, options) => {
    if ((actor.type !== "vehicle") || !foundry.utils.hasProperty(change, "system.life.value")) return;
    if (!game.user.isActiveGM && !(game.user.isGM && !game.users.activeGM)) return;
    if (((Number(options.dbuLifeBefore) || 0) > 0) && ((Number(actor.system.life?.value) || 0) <= 0)) await vehicleDestroyed(actor);
  });
  Hooks.on("updateActor", (actor, change, options) => {
    if ((actor.type !== "vehicle") || !foundry.utils.hasProperty(change, "system.crew")) return;
    const crew = actor.system.crew ?? {};
    for (const uuid of new Set([...(options.dbuCrewBefore ?? []), crew.pilot, ...(crew.passengers ?? [])].filter(Boolean))) {
      const member = actorAt(uuid);
      if (!member || (member.type === "vehicle")) continue;
      member.reset?.();
      if (member.sheet?.rendered) member.sheet.render();
    }
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

// --- Crew: the Ride Maneuver, and the tokens in a Vehicle ----------------------------------------------------------------------
//
// "There are two positions within a Vehicle: Pilot ... Passenger." Kept on the Vehicle (`system.crew`, by uuid). Their tokens stay
// on the map over the Vehicle's Squares and move with it (the user's); one whose token ends up outside them is in it no more - "If
// you, for any reason, are placed on a Square outside of the Squares occupied by a Vehicle, you are no longer a Pilot or Passenger
// for that Vehicle."

/** Every Vehicle in the world. */
function allVehicles() {
  return Array.from(globalThis.game?.actors ?? []).filter(actor => actor.type === "vehicle");
}

/** The Vehicle a character is in, and as what: { vehicle, role: "pilot" | "passenger" }, or null. */
export function vehicleOf(actor) {
  if (!actor?.uuid) return null;
  for (const vehicle of allVehicles()) {
    const crew = vehicle.system?.crew ?? {};
    // Not one Piloting it by a Remote Control: they are not in it.
    if ((crew.pilot === actor.uuid) && !crew.remote) return { vehicle, role: "pilot" };
    if ((crew.passengers ?? []).includes(actor.uuid)) return { vehicle, role: "passenger" };
  }
  return null;
}

/** Whether a character is Piloting a Vehicle - in it, or from afar by a Remote Control - the Vehicle, or null. */
export function pilotedBy(actor) {
  if (!actor?.uuid) return null;
  return allVehicles().find(vehicle => vehicle.system?.crew?.pilot === actor.uuid) ?? null;
}

/**
 * The crew a change leaves: who is Pilot, who are Passengers - one actor moved, added or taken out. Piloted from afar while its
 * Pilot is the same one; anybody else at its controls is in it.
 */
export function crewWith(crew, uuid, role) {
  const passengers = (crew?.passengers ?? []).filter(each => each !== uuid);
  let pilot = (crew?.pilot === uuid) ? "" : (crew?.pilot ?? "");
  if (role === "pilot") pilot = uuid;
  if (role === "passenger") passengers.push(uuid);
  return { pilot, passengers, remote: Boolean(crew?.remote) && Boolean(pilot) && (pilot === crew?.pilot) };
}

/** Who is in it: its Passengers, and its Pilot unless they Pilot it from afar. */
export function aboard(vehicle) {
  const crew = vehicle?.system?.crew ?? {};
  return [...((crew.pilot && !crew.remote) ? [crew.pilot] : []), ...(crew.passengers ?? [])];
}

/** A token's first one on a scene - an Actor's, or the token given. */
function tokenDocOf(who, scene = null) {
  if (!who) return null;
  if (who.documentName === "Token") return who;
  if (who.document?.documentName === "Token") return who.document;
  const tokens = who.getActiveTokens?.(false, true) ?? [];
  return tokens.find(token => !scene || (token.parent?.id === scene.id)) ?? null;
}

/** A token's footprint in Squares on its scene: { x, y, w, h }. */
export function footprint(token) {
  const grid = token?.parent?.grid?.size ?? globalThis.canvas?.grid?.size ?? 100;
  return { x: Math.round(token.x / grid), y: Math.round(token.y / grid), w: token.width ?? 1, h: token.height ?? 1 };
}

const overlaps = (a, b) => (a.x < b.x + b.w) && (b.x < a.x + a.w) && (a.y < b.y + b.h) && (b.y < a.y + a.h);
const within = (inner, outer) => (inner.x >= outer.x) && (inner.y >= outer.y) && (inner.x + inner.w <= outer.x + outer.w)
  && (inner.y + inner.h <= outer.y + outer.h);

/** Whether a token stands wholly on a Vehicle's Squares. */
export function standsIn(token, vehicleToken) {
  return Boolean(token && vehicleToken) && within(footprint(token), footprint(vehicleToken));
}

/**
 * Where a token may be put in a Vehicle: "If they cannot fit within the confines of the available Squares (meaning that nothing is
 * occupying those squares), a Character cannot enter that Vehicle." The first room from the front left, row by row - or the Square
 * asked for first, the Pilot Seat. Squares, not pixels; null when there is none.
 *
 * @param {object} vehicleBox   the Vehicle's footprint
 * @param {object} size         { w, h } of the one going in
 * @param {object[]} taken      the footprints of the other tokens there
 * @param {number|null} [first] a Square's place in the Vehicle to try first (row by row from its front left)
 */
export function roomIn(vehicleBox, size, taken, first = null) {
  const fits = (x, y) => {
    const box = { x, y, w: size.w, h: size.h };
    return within(box, vehicleBox) && !taken.some(other => overlaps(box, other));
  };
  if (Number.isInteger(first)) {
    const x = vehicleBox.x + (first % vehicleBox.w);
    const y = vehicleBox.y + Math.floor(first / vehicleBox.w);
    if (fits(x, y)) return { x, y };
  }
  for (let y = vehicleBox.y; y <= vehicleBox.y + vehicleBox.h - size.h; y++) {
    for (let x = vehicleBox.x; x <= vehicleBox.x + vehicleBox.w - size.w; x++) {
      if (fits(x, y)) return { x, y };
    }
  }
  return null;
}

/** An unoccupied place beside a Vehicle, for one leaving it - nearest its front left first. Squares; null when there is none. */
export function roomBeside(vehicleBox, size, taken) {
  const around = [];
  for (let y = vehicleBox.y - size.h; y <= vehicleBox.y + vehicleBox.h; y++) {
    for (let x = vehicleBox.x - size.w; x <= vehicleBox.x + vehicleBox.w; x++) {
      const box = { x, y, w: size.w, h: size.h };
      if (overlaps(box, vehicleBox)) continue;
      // Adjacent: touching the Vehicle's Squares, a corner counting.
      const gapX = Math.max(0, Math.max(box.x - (vehicleBox.x + vehicleBox.w), vehicleBox.x - (box.x + box.w)));
      const gapY = Math.max(0, Math.max(box.y - (vehicleBox.y + vehicleBox.h), vehicleBox.y - (box.y + box.h)));
      if (Math.max(gapX, gapY) !== 0) continue;
      if ((x < 0) || (y < 0) || taken.some(other => overlaps(box, other))) continue;
      around.push({ x, y });
    }
  }
  return around[0] ?? null;
}

/** The footprints of every other token on a scene. */
function takenOn(scene, ...not) {
  const skip = new Set(not.filter(Boolean).map(token => token.id));
  return Array.from(scene?.tokens ?? []).filter(token => !skip.has(token.id) && !token.hidden).map(footprint);
}

/** A Vehicle's own token on a scene - the one the character is on. */
export function vehicleTokenOf(vehicle, scene = null) {
  return tokenDocOf(vehicle, scene ?? globalThis.canvas?.scene ?? null);
}

/** The Vehicles beside a character's token, on its scene. */
export function vehiclesBeside(actor) {
  const mine = tokenDocOf(actor, globalThis.canvas?.scene ?? null);
  if (!mine) return [];
  return allVehicles().filter(vehicle => {
    const theirs = tokenDocOf(vehicle, mine.parent);
    if (!theirs) return false;
    const a = footprint(mine);
    const b = footprint(theirs);
    const gapX = Math.max(0, Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w)));
    const gapY = Math.max(0, Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h)));
    return Math.max(gapX, gapY) === 0;
  });
}

/** "To Pilot a Vehicle, you require at least 1 Skill Rank in the Piloting Skill." */
export function canPilot(actor) {
  return (Number(actor?.system?.skills?.pilot?.ranks) || 0) >= 1;
}

/** Why a character may not take a Vehicle's controls, or "" - a Pilot Rank, and a Vehicle not destroyed. */
export function whyNotPilot(actor, vehicle) {
  if (!canPilot(actor)) return `${actor.name} needs at least 1 Skill Rank in Pilot to Pilot a Vehicle.`;
  if ((Number(vehicle?.system?.life?.value) || 0) <= 0) return `${vehicle.name} is destroyed: nobody can Pilot it till it is repaired.`;
  return "";
}

/** A token's place, from Squares into the scene's pixels. */
function toPixels(scene, square) {
  const grid = scene?.grid?.size ?? globalThis.canvas?.grid?.size ?? 100;
  return { x: square.x * grid, y: square.y * grid };
}

/** Its crew written - by the GM when the Vehicle is not the mover's. */
async function writeCrew(vehicle, crew) {
  const { requestActorUpdate } = await import("./chat.mjs");
  return requestActorUpdate(vehicle, { "system.crew": crew });
}

/** Tokens moved - by the GM when one is not the mover's. */
async function moveTokens(scene, updates, options = {}) {
  const { requestTokenUpdates } = await import("./chat.mjs");
  return requestTokenUpdates(scene, updates, { dbuVehicleCrew: true, ...options });
}

/**
 * What the Ride Maneuver will do, asked before it is paid for. Out of a Vehicle: "Enter an adjacent Vehicle ... then you may become
 * the Pilot if there is no Pilot." In one: "Leave that Vehicle", "Stop Piloting this Vehicle", or "Attempt to become the Pilot".
 *
 * @returns {Promise<object|null>}  { vehicle, action: "enter" | "leave" | "stop" | "pilot", asPilot }, or null for nothing
 */
export async function askRide(actor) {
  const { askPlayerChoice } = await import("./chat.mjs");
  const notify = text => globalThis.ui?.notifications?.warn(text);
  const inside = vehicleOf(actor);
  if (inside) {
    const { vehicle, role } = inside;
    const options = [{ value: "leave", label: `Leave ${vehicle.name}` }];
    if (role === "pilot") options.push({ value: "stop", label: "Stop Piloting" });
    else options.push({ value: "pilot", label: vehicle.system.crew.pilot ? "Attempt to become the Pilot" : "Become the Pilot" });
    const action = await askPlayerChoice(actor, `Ride: ${vehicle.name}`, options);
    if (!action) return null;
    if (action === "pilot") {
      const why = whyNotPilot(actor, vehicle);
      if (why) { notify(why); return null; }
    }
    return { vehicle, action };
  }

  const beside = vehiclesBeside(actor);
  if (!beside.length) { notify(`${actor.name} is not next to a Vehicle to Ride.`); return null; }
  let vehicle = beside[0];
  if (beside.length > 1) {
    const id = await askPlayerChoice(actor, "Ride: which Vehicle?", beside.map(each => ({ value: each.id, label: each.name })));
    vehicle = beside.find(each => each.id === id);
    if (!vehicle) return null;
  }
  // Room for them, or no going in.
  const mine = tokenDocOf(actor, globalThis.canvas?.scene ?? null);
  const theirs = vehicleTokenOf(vehicle, mine?.parent);
  if (!mine || !theirs || !roomIn(footprint(theirs), footprint(mine), takenOn(mine.parent, mine, theirs))) {
    notify(`There is no room for ${actor.name} in ${vehicle.name}.`);
    return null;
  }
  let asPilot = false;
  if (!vehicle.system.crew.pilot && !whyNotPilot(actor, vehicle)) {
    const role = await askPlayerChoice(actor, `Ride: ${vehicle.name}`,
      [{ value: "pilot", label: "Enter as the Pilot" }, { value: "passenger", label: "Enter as a Passenger" }]);
    if (!role) return null;
    asPilot = role === "pilot";
  }
  return { vehicle, action: "enter", asPilot };
}

/**
 * The Ride Maneuver done, once paid: the crew written and the tokens moved; a Pilot who is not willing to give the controls up
 * answered with the Clash (Physical Strike vs Physical Strike/Dodge). What happened, said - or the Clash's card, which is its card.
 */
export async function doRide(actor, maneuver, plan) {
  const { vehicle, action } = plan;
  const scene = globalThis.canvas?.scene ?? null;
  const mine = tokenDocOf(actor, scene);
  const theirs = vehicleTokenOf(vehicle, scene);
  const crew = vehicle.system.crew;
  const seat = (vehicle.system.reading?.size?.cols ?? 1) > 1 ? vehicle.system.pilotSeat : null;

  if (action === "leave") {
    const spot = (mine && theirs) ? roomBeside(footprint(theirs), footprint(mine), takenOn(scene, mine, theirs)) : null;
    await writeCrew(vehicle, crewWith(crew, actor.uuid, null));
    if (spot) await moveTokens(scene, [{ _id: mine.id, ...toPixels(scene, spot) }]);
    return `${actor.name} leaves ${vehicle.name}${spot ? "" : " - no unoccupied Square beside it: place the token by hand"}.`;
  }

  if (action === "stop") {
    await writeCrew(vehicle, crewWith(crew, actor.uuid, "passenger"));
    const spot = (mine && theirs) ? roomIn(footprint(theirs), footprint(mine), takenOn(scene, mine, theirs)) : null;
    if (spot) await moveTokens(scene, [{ _id: mine.id, ...toPixels(scene, spot) }]);
    return `${actor.name} stops Piloting ${vehicle.name}, a Passenger now.`;
  }

  if (action === "enter") {
    const spot = (mine && theirs) ? roomIn(footprint(theirs), footprint(mine), takenOn(scene, mine, theirs), plan.asPilot ? seat : null) : null;
    if (!spot) return `There is no room for ${actor.name} in ${vehicle.name}.`;
    await writeCrew(vehicle, crewWith(crew, actor.uuid, plan.asPilot ? "pilot" : "passenger"));
    await moveTokens(scene, [{ _id: mine.id, ...toPixels(scene, spot) }]);
    return `${actor.name} gets into ${vehicle.name}${plan.asPilot ? " as its Pilot" : " as a Passenger"}.`;
  }

  // "Attempt to become the Pilot of the Vehicle." Nobody at the controls: they are theirs.
  const pilot = actorAt(crew.pilot);
  if (!pilot) {
    await takeControls(vehicle, actor, scene);
    return `${actor.name} becomes ${vehicle.name}'s Pilot.`;
  }
  // "If the current Pilot is willing, you become the Pilot in their place and swap which Squares you are occupying."
  const { askPlayerChoice } = await import("./chat.mjs");
  const willing = await askPlayerChoice(pilot, `${actor.name} wants ${vehicle.name}'s controls`,
    [{ value: "yes", label: "Let them Pilot" }, { value: "no", label: "Refuse - a Clash" }],
    { text: `${actor.name} attempts to become the Pilot. Willing, you swap Squares; not, a Clash (Physical Strike vs Physical Strike/Dodge).` });
  if ((willing === "yes") && crew.remote) {
    await takeControls(vehicle, actor, scene, crewWith(crewWith(crew, pilot.uuid, null), actor.uuid, "pilot"));
    return `${pilot.name} lets ${actor.name} take ${vehicle.name}'s controls from afar.`;
  }
  if (willing === "yes") {
    await writeCrew(vehicle, crewWith(crewWith(crew, pilot.uuid, "passenger"), actor.uuid, "pilot"));
    const a = tokenDocOf(actor, scene);
    const b = tokenDocOf(pilot, scene);
    if (a && b) await moveTokens(scene, [{ _id: a.id, x: b.x, y: b.y }, { _id: b.id, x: a.x, y: a.y }]);
    return `${pilot.name} lets ${actor.name} take ${vehicle.name}'s controls - they swap places.`;
  }
  return postRideClash(actor, pilot, vehicle, maneuver);
}

/** The Pilot's place taken: the crew written, and the Pilot Seat sat in - swapping with whoever was in it. */
async function takeControls(vehicle, actor, scene, crew = vehicle.system.crew) {
  await writeCrew(vehicle, crewWith(crew, actor.uuid, "pilot"));
  const cols = vehicle.system.reading?.size?.cols ?? 1;
  const mine = tokenDocOf(actor, scene);
  const theirs = vehicleTokenOf(vehicle, scene);
  if ((cols <= 1) || !mine || !theirs) return;
  const box = footprint(theirs);
  const seat = vehicle.system.pilotSeat;
  const at = { x: box.x + (seat % cols), y: box.y + Math.floor(seat / cols) };
  const here = footprint(mine);
  if ((here.x === at.x) && (here.y === at.y)) return;
  const sitter = Array.from(scene.tokens).find(token => (token.id !== mine.id) && (token.id !== theirs.id)
    && overlaps(footprint(token), { x: at.x, y: at.y, w: 1, h: 1 }));
  const updates = [{ _id: mine.id, ...toPixels(scene, at) }];
  if (sitter) updates.push({ _id: sitter.id, x: mine.x, y: mine.y });
  await moveTokens(scene, updates);
}

/** "If not, make a Clash (Physical Strike vs Physical Strike/Dodge). If you win, you become the Pilot." */
async function postRideClash(actor, pilot, vehicle, maneuver) {
  return globalThis.ChatMessage.create({
    speaker: globalThis.ChatMessage.getSpeaker({ actor }),
    content: "",
    flags: {
      "dbu-ttrpg": {
        clash: {
          category: "strike",
          clashLabel: "Clash (Physical Strike vs Physical Strike/Dodge)",
          strikeFoundations: ["physical"],
          maneuverName: maneuver.name,
          reason: `${actor.name} tries to take ${vehicle.name}'s controls from ${pilot.name}. Win and they are the Pilot; `
            + "whoever wins may put the other out of it.",
          challengerUuid: actor.uuid,
          challengerName: actor.name,
          defenderUuid: pilot.uuid,
          defenderName: pilot.name,
          defenderRoll: "",
          ride: { applied: false, vehicleUuid: vehicle.uuid },
          ready: [],
          result: null
        }
      }
    }
  });
}

/**
 * The Ride Clash settled (chat.mjs): "If you win, you become the Pilot. The winner of the Clash may choose to remove the other
 * Character involved in the Clash from the Vehicle, placing them on a Square adjacent to the Vehicle of their choice." Asked of the
 * winner's player; the Square the first unoccupied one beside it, moved by hand from there.
 */
export async function settleRideClash(clash, challengerWon) {
  const vehicle = actorAt(clash.ride.vehicleUuid);
  const challenger = actorAt(clash.challengerUuid);
  const defender = actorAt(clash.defenderUuid);
  if (!vehicle || !challenger || !defender) return "";
  const scene = globalThis.canvas?.scene ?? null;
  const said = [];
  let crew = vehicle.system.crew;
  // Its Pilot from afar loses the controls and nothing else: they are not in it.
  const fromAfar = Boolean(crew.remote) && (crew.pilot === defender.uuid);
  if (challengerWon && fromAfar) {
    await takeControls(vehicle, challenger, scene, crewWith(crewWith(crew, defender.uuid, null), challenger.uuid, "pilot"));
    return `${challenger.name} takes ${vehicle.name}'s controls from ${defender.name}'s Remote Control.`;
  }
  if (!challengerWon && fromAfar) return `${defender.name} keeps ${vehicle.name}'s controls.`;
  if (challengerWon) {
    crew = crewWith(crewWith(crew, defender.uuid, "passenger"), challenger.uuid, "pilot");
    said.push(`${challenger.name} takes ${vehicle.name}'s controls.`);
  }
  else said.push(`${defender.name} keeps ${vehicle.name}'s controls.`);
  const [winner, loser] = challengerWon ? [challenger, defender] : [defender, challenger];
  const { askPlayerChoice } = await import("./chat.mjs");
  const out = await askPlayerChoice(winner, `Ride: ${vehicle.name}`,
    [{ value: "out", label: `Put ${loser.name} out of it` }, { value: "stay", label: `Let ${loser.name} stay` }]);
  const theirs = vehicleTokenOf(vehicle, scene);
  const loserToken = tokenDocOf(loser, scene);
  const updates = [];
  if (out === "out") {
    crew = crewWith(crew, loser.uuid, null);
    const spot = (theirs && loserToken) ? roomBeside(footprint(theirs), footprint(loserToken), takenOn(scene, loserToken, theirs)) : null;
    if (spot) updates.push({ _id: loserToken.id, ...toPixels(scene, spot) });
    said.push(`${winner.name} puts ${loser.name} out of it${spot ? "" : " - no unoccupied Square beside it: place the token by hand"}.`);
  }
  if (challengerWon) await takeControls(vehicle, challenger, scene, crew);
  else await writeCrew(vehicle, crew);
  if (updates.length) await moveTokens(scene, updates);
  return said.join(" ");
}

/**
 * The tokens kept with their Vehicle (the user's: the crew's tokens over its Squares, moving with it): a Vehicle's token moved, its
 * Pilot's and Passengers' moved as far the same way - by the client that moved it, through the GM where they are not its. And one
 * of theirs moved off its Squares by any other means - "placed on a Square outside of the Squares occupied by a Vehicle" - is in it
 * no more.
 */
export function registerCrewHooks() {
  Hooks.on("preUpdateToken", (token, change, options) => {
    if ((token.actor?.type !== "vehicle") || !(("x" in change) || ("y" in change))) return;
    options.dbuVehicleFrom = { x: token.x, y: token.y };
  });
  Hooks.on("updateToken", async (token, change, options, userId) => {
    if (userId !== game.user.id) return;
    if (!(("x" in change) || ("y" in change))) return;
    const scene = token.parent;
    if (token.actor?.type === "vehicle") {
      const from = options.dbuVehicleFrom;
      if (!from) return;
      const dx = token.x - from.x;
      const dy = token.y - from.y;
      if (!dx && !dy) return;
      const updates = aboard(token.actor).map(uuid => tokenDocOf(actorAt(uuid), scene)).filter(Boolean)
        .map(member => ({ _id: member.id, x: member.x + dx, y: member.y + dy }));
      if (updates.length) await moveTokens(scene, updates);
      return;
    }
    if (options.dbuVehicleCrew) return;
    const inside = vehicleOf(token.actor);
    if (!inside) return;
    const theirs = vehicleTokenOf(inside.vehicle, scene);
    if (theirs && !standsIn(token, theirs)) await writeCrew(inside.vehicle, crewWith(inside.vehicle.system.crew, token.actor.uuid, null));
  });
}

// --- Piloting ------------------------------------------------------------------------------------------------------------------
//
// "While you are Piloting a Vehicle, you cannot use any Unique Abilities or Attacking Maneuvers except an Attacking Maneuver that
// uses the Vehicle Weapon ... or an Attacking Maneuver of the Blitz Profile" - refused (the user's). "You cannot use the Soar
// Maneuver while in a Vehicle" but its Pilot with Hikou; Rapid Movement only with Boost Speed. "When using the Movement Maneuver
// or an Attacking Maneuver as a Pilot, use the Vehicle's Ki Points instead of your own" - its Capacity too, the Ki Wager with it,
// its Tier for the Movement's (T) (the user's). "Any Attacking Maneuver made by the Pilot of a Vehicle uses the Output for the
// Damage Attribute"; Blitz moves and counts with its Output (the user's).

/** The flags a Vehicle Weapon carries on its Vehicle: which of Weapon Installed's it is, and the one Profile it makes. */
export const VEHICLE_WEAPON = "vehicleWeapon";
export const VEHICLE_PROFILE = "vehicleProfile";

/** Whether a Vehicle has a Vehicle Quality, by its file's id without the "vehicle-". */
export function hasVehicleQuality(vehicle, id) {
  return (vehicle?.system?.qualities ?? []).some(entry => entry.id === `vehicle-${id}`);
}

/** Why a Pilot may not use this Maneuver, or "": a Unique Ability; the Soar without Hikou. Attacks are judged once declared. */
export function whyNotPiloting(actor, vehicle, maneuver) {
  if (!vehicle) return "";
  const said = `${actor.name} is Piloting ${vehicle.name}`;
  if ((maneuver?.tags ?? []).includes("uniqueAbility")) return `${said}: no Unique Abilities.`;
  if ((maneuver?.id === "soar") && !hasVehicleQuality(vehicle, "hikou")) return `${said}: no Soar Maneuver - it has no Hikou.`;
  return "";
}

/**
 * "You cannot use the Soar Maneuver while in a Vehicle" - a Passenger never, its Pilot only with Hikou. A Pilot from afar is bound
 * as any Pilot: "spend your Actions as if you are Piloting a Vehicle".
 */
export function whyNotInVehicle(actor, maneuver) {
  const piloted = pilotedBy(actor);
  if (piloted) return whyNotPiloting(actor, piloted, maneuver);
  const inside = vehicleOf(actor);
  if (!inside) return "";
  return (maneuver?.id === "soar") ? `${actor.name} is in ${inside.vehicle.name}: no Soar Maneuver in a Vehicle.` : "";
}

/** The Vehicle Weapons an attack of this Foundation and Profile may be made with: built, whole, and made for that Profile. */
export function vehicleWeaponsFor(vehicle, foundation, profile) {
  return Array.from(vehicle?.items ?? []).filter(item => (item.type === "gear")
    && (item.getFlag?.("dbu-ttrpg", VEHICLE_WEAPON) !== undefined) && (item.system?.crafted?.kind === "weapon")
    && !item.system.crafted.destroyed && ((item.system.crafted.weaponType ?? "") === foundation)
    && ((item.getFlag?.("dbu-ttrpg", VEHICLE_PROFILE) ?? "") === profile));
}

/**
 * Why a Pilot's attack may not be made, or "": only with a Vehicle Weapon made for its Profile and Foundation, or of the Blitz
 * Profile.
 */
export function whyNotPilotAttack(actor, vehicle, declared) {
  if (!vehicle || !declared) return "";
  const { profile, foundation } = declared;
  if (profile === "blitz") return "";
  if (vehicleWeaponsFor(vehicle, foundation, profile).length) return "";
  return `${actor.name} is Piloting ${vehicle.name}: only an Attacking Maneuver with one of its Vehicle Weapons (of the Profile it was `
    + "made for), or of the Blitz Profile.";
}

/** What a Pilot's attack carries of its Vehicle: whose Output is its Damage Attribute, and the Speed a Blitz measures by. */
export function pilotingOf(vehicle) {
  return { vehicleUuid: vehicle.uuid, name: vehicle.name, output: Number(vehicle.system.output) || 0,
    normalSpeed: Number(vehicle.system.speed?.normal) || 0 };
}

/**
 * Big Blaster: "Apply a Minor Sphere AoE to any Attacking Maneuver made with a Vehicle Weapon of your choice when selecting this
 * Vehicle Quality. The Target Square for this AoE may be any Square, EXCEPT a Square that this Vehicle would occupy. If this Vehicle
 * Quality takes up 2 Quality Slots, apply the Intense Blast Advantage" - an Absolute Attack. What an attack with this Weapon gets,
 * or null.
 */
export function bigBlasterFor(vehicle, item) {
  const at = item?.getFlag?.("dbu-ttrpg", VEHICLE_WEAPON);
  if (at === undefined) return null;
  const entry = (vehicle?.system?.qualities ?? []).find(each => (each.id === "vehicle-big-blaster")
    && (String(each.choices?.[0] ?? "") === String(at)));
  if (!entry) return null;
  return { area: { shape: "sphere", magnitude: "minor", centredOnSquare: true, notOn: vehicle.uuid, source: "Big Blaster" },
    absolute: (Number(entry.slots) || 1) >= 2 };
}

/** What a Vehicle paid of a Maneuver, so taking it back gives it back to the Vehicle. */
const VEHICLE_PAID = new Map();

/**
 * A Pilot's Movement or attack paid by the Vehicle: its Ki Points, and as much of its Capacity - through the GM when it is not the
 * Pilot's to change.
 *
 * @returns {Promise<boolean>} whether it was paid
 */
export async function spendVehicleCost(actor, vehicle, maneuver, cost) {
  cost = Math.max(0, Math.floor(Number(cost) || 0));
  if (!cost) return true;
  const ki = Number(vehicle.system.ki?.value) || 0;
  const left = Number(vehicle.system.capacity?.remaining) || 0;
  if (ki < cost) {
    globalThis.ui?.notifications?.warn(`${vehicle.name} needs ${cost} Ki Points for ${maneuver.name} and has ${ki}.`);
    return false;
  }
  if (cost > left) {
    globalThis.ui?.notifications?.warn(`${vehicle.name} has ${left} Capacity left this round and ${maneuver.name} costs ${cost}.`);
    return false;
  }
  const { requestActorUpdate } = await import("./chat.mjs");
  await requestActorUpdate(vehicle, { "system.ki.value": ki - cost,
    "system.capacity.spent": (Number(vehicle.system.capacity?.spent) || 0) + cost });
  VEHICLE_PAID.set(`${actor.uuid}:${maneuver.id ?? maneuver.name}`, { vehicleUuid: vehicle.uuid, cost });
  return true;
}

/** A Maneuver its Vehicle paid for, taken back: its Ki Points and Capacity given back to the Vehicle. False when none paid. */
export async function refundVehicleCost(actor, maneuver) {
  const key = `${actor.uuid}:${maneuver.id ?? maneuver.name}`;
  const paid = VEHICLE_PAID.get(key);
  if (!paid) return false;
  VEHICLE_PAID.delete(key);
  const vehicle = actorAt(paid.vehicleUuid);
  if (!vehicle) return true;
  const { requestActorUpdate } = await import("./chat.mjs");
  await requestActorUpdate(vehicle, {
    "system.ki.value": Math.min(Number(vehicle.system.ki?.max) || 0, (Number(vehicle.system.ki?.value) || 0) + paid.cost),
    "system.capacity.spent": Math.max(0, (Number(vehicle.system.capacity?.spent) || 0) - paid.cost) });
  return true;
}

// --- Attacked ------------------------------------------------------------------------------------------------------------------
//
// "A Vehicle is a member of the Battlefield, and can thus be targeted by Attacking Maneuvers as if it was another Character" -
// "When targeted by an Attacking Maneuver, a Vehicle uses its own Defense Value, Soak Value, and Damage Reduction". Its Pilot
// answers for it with their own Dodge Roll and its Defense Value, nothing else of the Defend Maneuver (the user's); with no Pilot it
// does not defend, hit as a Feature is (the user's). Countermeasures and Energy Shield are its Pilot's Counter Action (the user's).

/**
 * The Battle Environment its Favored Environment is set to: "Select a Battle Environment" - or, with Adjustable, "change the Battle
 * Environment that is selected for Favored Environment to one of the additional Battle Environments selected for this Vehicle
 * Quality or change it back" (the sheet's choice, `activeEnvironment`). "" with no Favored Environment.
 */
export function favoredEnvironment(vehicle) {
  const qualities = vehicle?.system?.qualities ?? [];
  const own = qualities.find(entry => entry.id === "vehicle-favored-environment")?.choices?.[0] ?? "";
  if (!own) return "";
  const extra = (qualities.find(entry => entry.id === "vehicle-adjustable")?.choices ?? []).filter(Boolean);
  const active = String(vehicle.system.activeEnvironment ?? "");
  return (active && extra.includes(active)) ? active : own;
}

/** A Counter Action of its Pilot's spent, where a Combat Encounter counts them - through the GM where they are not the mover's. */
async function spendPilotCounter(pilot) {
  if (!globalThis.game?.combat?.started) return true;
  if ((Number(pilot.system?.actions?.counterLeft) || 0) <= 0) return false;
  const { requestActorUpdate } = await import("./chat.mjs");
  await requestActorUpdate(pilot, { "system.actionsSpent.counter": (Number(pilot.system.actionsSpent?.counter) || 0) + 1 });
  return true;
}

/** Whether a Pilot has a Counter Action to spend - always, out of a Combat Encounter. */
function pilotHasCounter(pilot) {
  return !globalThis.game?.combat?.started || ((Number(pilot?.system?.actions?.counterLeft) || 0) > 0);
}

/**
 * What an attack carries for the Vehicles among its targets, worked out as it is made: each one ready at once - nothing of the
 * Defend Maneuver to choose for it - its Pilot's Dodge Roll with its Defense Value, or, with no Pilot, hit as a Feature is.
 * Favored Environment's 1/2 Output where its Pilot stands in that Battle Environment; Countermeasures' asked of its Pilot.
 *
 * @param {Actor[]} everyone   the attack's targets
 * @returns {Promise<{ ready: string[], defences: object[], autoHit: string[], dodges: object[] }>}
 */
export async function vehicleDefences(everyone) {
  const out = { ready: [], defences: [], autoHit: [], dodges: [] };
  for (const vehicle of everyone.filter(each => each?.type === "vehicle")) {
    out.ready.push(vehicle.uuid);
    const pilot = actorAt(vehicle.system.crew?.pilot);
    if (!pilot) {
      out.autoHit.push(vehicle.uuid);
      continue;
    }
    const output = Number(vehicle.system.output) || 0;
    let defenseValue = Number(vehicle.system.defenseValue) || 0;
    const notes = [];
    const favored = favoredEnvironment(vehicle);
    if (favored) {
      const { environmentIdOf } = await import("./environments.mjs");
      if (environmentIdOf(pilot.system, getTrait) === favored) {
        defenseValue += Math.floor(output / 2);
        notes.push(`Favored Environment +${Math.floor(output / 2)}`);
      }
    }
    // Expert Pilot (2): "Increase all of your Dodge Rolls made with a Vehicle by 1(T) for every 2 Skill Ranks of Piloting gained."
    const expert = expertPilotDodge(pilot);
    if (expert) {
      defenseValue += expert;
      notes.push(`Expert Pilot +${expert}`);
    }
    if (hasVehicleQuality(vehicle, "countermeasures") && pilotHasCounter(pilot)) {
      const { askPlayerChoice } = await import("./chat.mjs");
      const used = await askPlayerChoice(pilot, `${vehicle.name}: Countermeasures`,
        [{ value: "yes", label: `Spend a Counter Action: Defense Value +${Math.floor(output / 2)}` }, { value: "no", label: "No" }],
        { text: `${vehicle.name} is targeted by an Attacking Maneuver.` });
      if ((used === "yes") && await spendPilotCounter(pilot)) {
        defenseValue += Math.floor(output / 2);
        notes.push(`Countermeasures +${Math.floor(output / 2)}`);
      }
    }
    out.defences.push({ uuid: vehicle.uuid, defence: "dodge" });
    out.dodges.push({ uuid: vehicle.uuid, pilotUuid: pilot.uuid, name: vehicle.name, defenseValue, notes });
  }
  return out;
}

/**
 * Energy Shield: "When this Vehicle is hit by an Attacking Maneuver, you may spend a Counter Action. If you do, you may spend an
 * amount of the Vehicle's Ki Points up to its Output to increase this Vehicle's Damage Reduction by an equal amount." Asked of its
 * Pilot as the hit is; the Damage Reduction it adds, or 0.
 */
export async function energyShield(vehicle) {
  if ((vehicle?.type !== "vehicle") || !hasVehicleQuality(vehicle, "energy-shield")) return 0;
  const pilot = actorAt(vehicle.system.crew?.pilot);
  const most = Math.min(Number(vehicle.system.output) || 0, Number(vehicle.system.ki?.value) || 0);
  if (!pilot || (most <= 0) || !pilotHasCounter(pilot)) return 0;
  const { askPlayerAmount, requestActorUpdate } = await import("./chat.mjs");
  const amount = Math.min(most, Math.max(0, Math.floor(Number(await askPlayerAmount(pilot, `${vehicle.name}: Energy Shield`, most,
    "Ki Points into its Damage Reduction - a Counter Action spent")) || 0)));
  if (!amount || !await spendPilotCounter(pilot)) return 0;
  await requestActorUpdate(vehicle, { "system.ki.value": (Number(vehicle.system.ki?.value) || 0) - amount });
  return amount;
}

/**
 * "If a Vehicle is destroyed, all Characters within it have their Life Points reduced by 1/4 of the Maximum Life Points for that
 * Vehicle." Done once, as its Life Points reach 0 - by the GM - and said.
 */
async function vehicleDestroyed(vehicle) {
  const loss = Math.floor((Number(vehicle.system.life?.max) || 0) / 4);
  const crew = aboard(vehicle).map(actorAt).filter(Boolean);
  const { reduceLifePoints } = await import("./chat.mjs");
  for (const member of crew) await reduceLifePoints(member, loss, { reason: `${vehicle.name} destroyed` });
  await globalThis.ChatMessage?.create({
    speaker: globalThis.ChatMessage.getSpeaker({ actor: vehicle }),
    content: `<p><strong>${foundry.utils.escapeHTML(vehicle.name)}</strong> is destroyed.${crew.length
      ? ` Everyone in it loses ${loss} Life Points (1/4 of its Maximum): ${crew.map(each => foundry.utils.escapeHTML(each.name)).join(", ")}.` : ""}</p>`
  });
}

// --- What waited on Vehicles -----------------------------------------------------------------------------------------------------

/** Whether a character has the Expert Pilot Talent. */
export function hasExpertPilot(actor) {
  return Array.from(actor?.items ?? []).some(item => (item.type === "talent")
    && ((item.flags?.["dbu-ttrpg"]?.sourceId === "expert-pilot") || (String(item.name ?? "").trim().toLowerCase() === "expert pilot")));
}

/** Expert Pilot (1): "For the effects of this Talent, the 5th Skill Rank in Piloting is treated as 2 Skill Ranks." */
export function expertPilotRanks(actor) {
  const ranks = Number(actor?.system?.skills?.pilot?.ranks) || 0;
  return (ranks >= 5) ? ranks + 1 : ranks;
}

/** Expert Pilot (2): "Increase all of your Dodge Rolls made with a Vehicle by 1(T) for every 2 Skill Ranks of Piloting gained." */
export function expertPilotDodge(actor) {
  if (!hasExpertPilot(actor)) return 0;
  return Math.floor(expertPilotRanks(actor) / 2) * Math.max(1, Number(actor.system?.tierOfPower) || 1);
}

const roundOf = () => `${globalThis.game?.combat?.id ?? "none"}:${globalThis.game?.combat?.round ?? 0}`;

/** Expert Pilot (4): "[1/Round]: Use the Ride Maneuver as an Instant Maneuver." Asked; taken, its Round spent. */
export async function rideAsInstant(actor, maneuver) {
  if (!hasExpertPilot(actor) || (actor.getFlag?.("dbu-ttrpg", "expertRideRound") === roundOf())) return maneuver;
  const { askPlayerChoice } = await import("./chat.mjs");
  const answer = await askPlayerChoice(actor, `${actor.name}: Expert Pilot`,
    [{ value: "instant", label: "Ride as an Instant Maneuver (1/Round)" }, { value: "standard", label: "As it is - 1 Action" }]);
  if (answer !== "instant") return maneuver;
  await actor.setFlag("dbu-ttrpg", "expertRideRound", roundOf());
  return { ...maneuver, type: "instant", actionCost: 0 };
}

/** Vehicle Attack: "You cannot use this Signature Technique unless you are Piloting a Vehicle." */
export function whyNotVehicleAttack(actor, maneuver) {
  if (!(maneuver?.advantages ?? []).includes("vehicle-attack") || pilotedBy(actor)) return "";
  return `${maneuver.name} is a Vehicle Attack: only while Piloting a Vehicle.`;
}

/**
 * Eye of the Dragon's Way of the Pilot, by Quick to Master's Option: "If you would target an Opponent with an Attacking Maneuver
 * while piloting a Battle Jacket or Vehicle, you may spend up to 10(bT) of that Battle Jacket or Vehicle's Life Points to increase
 * the Wound Roll for that Attacking Maneuver by an equal amount." Asked, once a Round; taken, on the Wound.
 */
export function wayOfThePilot(actor) {
  const items = Array.from(actor?.items ?? []);
  return items.some(item => item.flags?.["dbu-ttrpg"]?.sourceId === "eye-of-the-dragon")
    && items.some(item => (item.system?.chosen ?? []).some(entry => (entry?.key === "option") && (entry.value === "way-of-the-pilot")));
}

export async function askWayOfThePilot(actor, vehicle, declared, target) {
  if (!vehicle || !declared || !target || !wayOfThePilot(actor) || (actor.getFlag?.("dbu-ttrpg", "wayOfThePilotRound") === roundOf())) {
    return declared;
  }
  const { areOpponents } = await import("./allies.mjs");
  if (!areOpponents(target, actor)) return declared;
  const most = Math.min(10 * Math.max(1, Number(actor.system?.baseTierOfPower) || 1), Math.max(0, Number(vehicle.system.life?.value) || 0));
  if (most <= 0) return declared;
  const { askPlayerAmount, requestActorUpdate } = await import("./chat.mjs");
  const amount = Math.min(most, Math.max(0, Math.floor(Number(await askPlayerAmount(actor, `${actor.name}: Way of the Pilot`, most,
    `${vehicle.name}'s Life Points onto the Wound Roll (1/Round)`)) || 0)));
  if (!amount) return declared;
  await actor.setFlag("dbu-ttrpg", "wayOfThePilotRound", roundOf());
  await requestActorUpdate(vehicle, { "system.life.value": (Number(vehicle.system.life?.value) || 0) - amount });
  return { ...declared, woundExtra: [...(declared.woundExtra ?? []), { label: `Way of the Pilot (${vehicle.name})`, value: amount }] };
}

/**
 * The Eject Maneuver: "Immediately leave a Vehicle/Battle Jacket and move a number of Squares away from the Vehicle/Battle Jacket in
 * a straight line equal to your number of Skill Ranks in Piloting." Straight away from its middle - out of it first, if that is
 * further. "If that Vehicle/Battle Jacket was targeted for an Attacking Maneuver when you used this effect, and you were the Pilot,
 * carry out that Attacking Maneuver against the Vehicle/Battle Jacket as if you were still the Pilot" - an attack already made at it
 * keeps who answers for it (vehicleDefences), so nothing more is done for that.
 */
export async function doEject(actor) {
  const inside = vehicleOf(actor);
  if (!inside) return null;
  const { vehicle } = inside;
  await writeCrew(vehicle, crewWith(vehicle.system.crew, actor.uuid, null));
  const scene = globalThis.canvas?.scene ?? null;
  const mine = tokenDocOf(actor, scene);
  const theirs = vehicleTokenOf(vehicle, scene);
  const ranks = Number(actor.system?.skills?.pilot?.ranks) || 0;
  if (!mine || !theirs) return `${actor.name} ejects from ${vehicle.name} - ${ranks} Square${ranks === 1 ? "" : "s"} away from it.`;
  const box = footprint(theirs);
  const here = footprint(mine);
  const sign = value => (value > 0) ? 1 : (value < 0) ? -1 : 0;
  // Away from its middle: along the side they are on, or the corner's diagonal when they are as far off one way as the other.
  const offX = (here.x + (here.w / 2)) - (box.x + (box.w / 2));
  const offY = (here.y + (here.h / 2)) - (box.y + (box.h / 2));
  let dx = (Math.abs(offY) > 2 * Math.abs(offX)) ? 0 : sign(offX);
  let dy = (Math.abs(offX) > 2 * Math.abs(offY)) ? 0 : sign(offY);
  if (!dx && !dy) dy = -1;
  let at = { ...here };
  for (let step = 0; (step < ranks) || overlaps(at, box); step++) at = { ...at, x: at.x + dx, y: at.y + dy };
  at = { ...at, x: Math.max(0, at.x), y: Math.max(0, at.y) };
  await moveTokens(scene, [{ _id: mine.id, ...toPixels(scene, at) }]);
  return `${actor.name} ejects from ${vehicle.name}, ${ranks} Square${ranks === 1 ? "" : "s"} away from it in a straight line.`;
}

/** The Craft DC a Vehicle's Craftsmanship Grade asks - its table's. */
export function vehicleCraftDC(vehicle) {
  return gradeRow(vehicle?.system?.grade).difficulty;
}

/**
 * The Repair Maneuver's "a Vehicle/Battle Jacket you are adjacent to": each Vehicle beside them, to be repaired with Craft
 * (Vehicles) at its Craft DC - entries shaped as the Maneuver's own (use-maneuver.mjs repairables).
 */
export function vehicleRepairables(actor) {
  const ranks = Number(actor?.system?.skills?.craftVehicles?.ranks) || 0;
  return vehiclesBeside(actor).map(vehicle => ({
    item: { id: vehicle.uuid, name: vehicle.name }, vehicleUuid: vehicle.uuid, kind: "vehicle", specialty: "craftVehicles",
    craftDC: vehicleCraftDC(vehicle),
    why: !(ranks > 0) ? "needs Ranks in Craft (Vehicles)"
      : ((Number(vehicle.system.life?.value) || 0) >= (Number(vehicle.system.life?.max) || 0)) ? "nothing to repair" : ""
  }));
}

/** "Restore the Life Points of the Weapon/Vehicle/Battle Jacket by 2d10(bT) plus your Skill Bonus" - Craft (Vehicles)'. Said. */
export async function repairVehicle(actor, vehicleUuid) {
  const vehicle = actorAt(vehicleUuid);
  if (!vehicle) return null;
  const baseTier = Math.max(1, Number(actor.system?.baseTierOfPower) || 1);
  const roll = await new Roll(`${2 * baseTier}d10`).evaluate();
  const bonus = Number(actor.system?.skills?.craftVehicles?.bonus) || 0;
  const back = roll.total + bonus;
  const life = Math.min(Number(vehicle.system.life?.max) || 0, (Number(vehicle.system.life?.value) || 0) + back);
  const { requestActorUpdate } = await import("./chat.mjs");
  await requestActorUpdate(vehicle, { "system.life.value": life });
  return { roll, text: `${vehicle.name}: ${roll.total} (${2 * baseTier}d10) + ${bonus} (Craft (Vehicles)) = ${back} Life Points back.` };
}

/** Full Repair: "It regains Life ... equal to 1/5 of their respective maximums for every 2 hours spent." Said. */
export async function fullRepairVehicle(vehicleUuid, steps, share = 5) {
  const vehicle = actorAt(vehicleUuid);
  if (!vehicle) return "the Vehicle is gone";
  const max = Number(vehicle.system.life?.max) || 0;
  const before = Number(vehicle.system.life?.value) || 0;
  const back = Math.floor((max * Math.max(0, steps)) / Math.max(1, share));
  const life = Math.min(max, before + back);
  const { requestActorUpdate } = await import("./chat.mjs");
  await requestActorUpdate(vehicle, { "system.life.value": life });
  return `${vehicle.name} regains ${life - before} Life Points (${steps}/${share} of its Maximum)`;
}

/** Tune Up: "with your current Power Level" - its Vehicle Level the one who did it's. Said. */
export async function tuneUpVehicle(vehicleUuid, actor) {
  const vehicle = actorAt(vehicleUuid);
  if (!vehicle) return "the Vehicle is gone";
  const level = Math.min(MAX_VEHICLE_LEVEL, Math.max(1, Number(actor.system?.powerLevel) || 1));
  const { requestActorUpdate } = await import("./chat.mjs");
  await requestActorUpdate(vehicle, { "system.vehicleLevel": level });
  return `${vehicle.name} is Vehicle Level ${level}`;
}

/** The Craftsmanship Grade a Create Check's Difficulty makes - the Grade table's Craft DCs, Novice taken as Apprentice. */
export function gradeForDifficulty(difficulty) {
  return VEHICLE_GRADES.find(row => row.difficulty === difficulty)?.grade ?? 1;
}

/**
 * Create, a Vehicle made: "A Vehicle's Vehicle Level is equal to the Power Level of its creator at the time of creation" - an Actor of
 * its own, its Grade the Difficulty the Check was made at, its Creator who made it, owned by their players. By the GM where the maker
 * may not make Actors.
 */
export function vehicleDataFor(maker, { name = "", difficulty = "apprentice" } = {}) {
  const owners = Array.from(globalThis.game?.users ?? []).filter(user => !user.isGM && maker.testUserPermission?.(user, "OWNER"));
  return {
    name: String(name || "").trim() || `${maker.name}'s Vehicle`,
    type: "vehicle",
    system: { grade: gradeForDifficulty(difficulty), vehicleLevel: Math.min(MAX_VEHICLE_LEVEL, Math.max(1, Number(maker.system?.powerLevel) || 1)),
      creator: maker.uuid },
    ownership: Object.fromEntries(owners.map(user => [user.id, 3]))
  };
}

export async function makeVehicle(maker, create) {
  const data = vehicleDataFor(maker, create);
  if (game.user.isGM || game.user.can?.("ACTOR_CREATE")) return Actor.create(data);
  if (!game.users.activeGM) return ui.notifications.warn("A GM must be connected to make the Vehicle.");
  const { requestMakeVehicle } = await import("./chat.mjs");
  return requestMakeVehicle(data);
}

/** A Hikou Vehicle's High Environment written onto its Passengers - through the GM where they are not the mover's. */
async function skyForPassengers(vehicle, rank) {
  const { requestActorUpdate } = await import("./chat.mjs");
  for (const passenger of (vehicle.system.crew?.passengers ?? []).map(actorAt).filter(Boolean)) {
    if ((Number(passenger.system?.battlefield?.highEnvironment) || 0) !== rank) {
      await requestActorUpdate(passenger, { "system.battlefield.highEnvironment": rank });
    }
  }
}

// --- Capsule ----------------------------------------------------------------------------------------------------------------------
//
// The Capsule Quality: "While no Character is inside of this Vehicle, it can be stored within a Capsule" - the Capsule Basic Item's
// "Vehicles and Bases can also be stored within Capsules through the Capsule Quality". Stored, its tokens are taken off the scenes
// and the Capsule holds it (`vehicleStored`); thrown - an Action - it appears beside its thrower, the table moving it from there.

/** The flag a Capsule holding a Vehicle carries: its uuid. */
export const VEHICLE_STORED = "vehicleStored";

/** The Vehicles a character may put in a Capsule: theirs, with the Capsule Quality, nobody in it, in no other Capsule. */
export function capsuleVehicles(actor) {
  const stored = new Set(Array.from(globalThis.game?.actors ?? []).flatMap(each => Array.from(each.items ?? []))
    .map(item => item.getFlag?.("dbu-ttrpg", VEHICLE_STORED)).filter(Boolean));
  return allVehicles().filter(vehicle => vehicle.isOwner && hasVehicleQuality(vehicle, "capsule") && !stored.has(vehicle.uuid)
    && !vehicle.system.crew?.pilot && !(vehicle.system.crew?.passengers ?? []).length);
}

/** Stored: the Capsule holds it, and its tokens are off every scene. */
export async function storeVehicle(capsule, vehicle) {
  await capsule.setFlag("dbu-ttrpg", VEHICLE_STORED, vehicle.uuid);
  const { requestTokenDeletes } = await import("./chat.mjs");
  for (const scene of Array.from(globalThis.game?.scenes ?? [])) {
    const ids = Array.from(scene.tokens ?? []).filter(token => token.actorId === vehicle.id).map(token => token.id);
    if (ids.length) await requestTokenDeletes(scene, ids);
  }
}

/**
 * Thrown: "it appears instantly in that position" - its token beside its thrower on their scene, where there is room (the first
 * unoccupied place, nearest their front left), the Capsule empty again. Said.
 */
export async function throwVehicle(actor, capsule) {
  const vehicle = actorAt(capsule.getFlag?.("dbu-ttrpg", VEHICLE_STORED));
  if (!vehicle) {
    await capsule.unsetFlag?.("dbu-ttrpg", VEHICLE_STORED);
    return null;
  }
  const scene = globalThis.canvas?.scene ?? null;
  const mine = tokenDocOf(actor, scene);
  const size = tokenSizeOf(vehicle.system.reading);
  const spot = mine ? roomBeside(footprint(mine), { w: size.width, h: size.height }, takenOn(scene, mine)) : null;
  await capsule.unsetFlag("dbu-ttrpg", VEHICLE_STORED);
  if (spot && scene) {
    const { requestVehicleToken } = await import("./chat.mjs");
    await requestVehicleToken(scene, vehicle, toPixels(scene, spot));
  }
  return `${actor.name} throws ${capsule.name}, and ${vehicle.name} appears${spot ? " beside them" : " - place it on the map by hand"}.`;
}

// --- Remote Controlled -----------------------------------------------------------------------------------------------------------
//
// "This Vehicle can be connected to and controlled with a Remote" - the Remote Control: "select an Item (Bomb/Collar/Vehicle/Battle
// Jacket) you possess for it to be connected to ... allowing you to spend your Actions as if you are Piloting a Vehicle ... that can
// be controlled with this Remote Control ... You cannot use this effect if the Vehicle or Battle Jacket has a Pilot." Connected on the
// Remote Control's row (`remoteVehicle`); its Pilot from afar a Pilot in every way (the user's) - paying with it, bound as one, its
// Dodge Roll theirs - but not in it: never moved with it, nor hurt as it is destroyed, nor sheltered by it.

/** The flag a Remote Control connected to a Vehicle carries: its uuid. */
export const REMOTE_VEHICLE = "remoteVehicle";

/** The Vehicles a Remote Control may be connected to: those with Remote Controlled the player can see. */
export function remoteVehicles() {
  return allVehicles().filter(vehicle => vehicle.visible !== false && hasVehicleQuality(vehicle, "remote-controlled"));
}

/** The Vehicle a Remote Control is connected to, or null. */
export function remoteVehicleOf(remote) {
  return actorAt(remote?.getFlag?.("dbu-ttrpg", REMOTE_VEHICLE) ?? "");
}

/** Why it may not be Piloted from afar right now, or "". */
export function whyNotRemote(actor, vehicle) {
  if (!vehicle) return "It is connected to no Vehicle.";
  if (!hasVehicleQuality(vehicle, "remote-controlled")) return `${vehicle.name} has no Remote Controlled Quality.`;
  if (vehicle.system.crew?.pilot && (vehicle.system.crew.pilot !== actor.uuid)) return `${vehicle.name} has a Pilot: "You cannot use this effect if the Vehicle ... has a Pilot."`;
  return whyNotPilot(actor, vehicle);
}

/** The Vehicle a character Pilots from afar, or null. */
export function remotePilotedVehicle(actor) {
  return allVehicles().find(vehicle => (vehicle.system?.crew?.pilot === actor?.uuid) && vehicle.system.crew.remote) ?? null;
}

/** Piloting one from afar ended. Said, or null where there was none. */
export async function stopRemotePilot(actor) {
  const vehicle = remotePilotedVehicle(actor);
  if (!vehicle) return null;
  await writeCrew(vehicle, { pilot: "", passengers: [...(vehicle.system.crew.passengers ?? [])], remote: false });
  return `${actor.name} stops Piloting ${vehicle.name} from afar.`;
}

/** Piloting one from afar begun, by a device - out of any other's controls first. Said, or null where it may not be. */
export async function startRemotePilot(actor, vehicle, device) {
  const why = whyNotRemote(actor, vehicle);
  if (why) {
    globalThis.ui?.notifications?.warn(why);
    return null;
  }
  const other = pilotedBy(actor);
  if (other && (other !== vehicle)) await writeCrew(other, crewWith(other.system.crew, actor.uuid, null));
  await writeCrew(vehicle, { pilot: actor.uuid, passengers: [...(vehicle.system.crew?.passengers ?? [])], remote: true });
  return `${actor.name} Pilots ${vehicle.name} from afar, by ${device?.name ?? "a Remote Control"}.`;
}

/** The Remote Control's connected Vehicle Piloted from afar, or no longer. What happened, said. */
export async function toggleRemotePilot(actor, remote) {
  const vehicle = remoteVehicleOf(remote);
  if (vehicle && (remotePilotedVehicle(actor) === vehicle)) return stopRemotePilot(actor);
  return startRemotePilot(actor, vehicle, remote);
}

/**
 * How a device reaches Vehicles from afar: "one" - connected to one (the Remote Control; a Controller Weapon attuned to Vehicles) -
 * "any" - every one of theirs with Remote Controlled (a Support Buddy: "a Remote Control for any Items/Vehicles/Battle Jackets you
 * possess ... considered to already be connected to them"; a Controller Weapon at 2 Slots: "all Items of that type") - or "".
 *
 * @param {Item} item
 * @param {string[]} kinds   what it reaches (gear.mjs remoteKinds)
 * @param {boolean} all      whether it reaches every one of them (gear.mjs remotesAll)
 */
export function vehicleRemoteMode(item, kinds = [], all = false) {
  if (item?.system?.gearId === "remote-control") return "one";
  if (item?.system?.itemType === "buddy") return kinds.length ? "any" : "";
  if (kinds.includes("vehicle")) return all ? "any" : "one";
  return "";
}

/** The Vehicles a device reaching "any" may Pilot from afar: theirs, with Remote Controlled. */
export function possessedRemoteVehicles() {
  return remoteVehicles().filter(vehicle => vehicle.isOwner);
}

// --- Collisions ------------------------------------------------------------------------------------------------------------------
//
// "If a Vehicle collides with a Feature, it is treated as Feature Collision as if the Vehicle was a Character. If a Vehicle collides
// with the ground, it is treated as Ground Collision as if the Vehicle was a Character. If a Vehicle collides with another
// Character, it is treated as Feature Collision as if the Vehicle was a Feature." A button on its sheet (the user's): what it hit,
// and the Collision Damage - "reduce your Life Points by the Hardness Value of the Feature you Collided with" - its own off a
// Feature or the ground, theirs off it, at its Hardness Rank, for the Characters targeted.

/** What a collision costs: a Feature's or the ground's Hardness Rank against the Vehicle, or its own against the Characters. */
export function collisionCosts(vehicle, { kind, rank = 0 } = {}, targets = []) {
  if (kind === "character") {
    return targets.map(target => ({ target, amount: hardnessValue(vehicle.system.hardnessRank,
      Math.max(1, Number(target.system?.baseTierOfPower) || 1)) }));
  }
  return [{ target: vehicle, amount: hardnessValue(rank, Math.max(1, Number(vehicle.system.baseTierOfPower) || 1)) }];
}

/** The Collision button: asked what it hit, the Damage taken, said. */
export async function vehicleCollision(vehicle) {
  const { HARDNESS_RANKS } = await import("./features.mjs");
  const targets = Array.from(globalThis.game?.user?.targets ?? []).map(token => token.actor)
    .filter(actor => actor && (actor.type !== "vehicle"));
  const ranks = HARDNESS_RANKS.map(entry => `<option value="${entry.rank}">Rank ${entry.rank} &middot; ${
    hardnessValue(entry.rank, Math.max(1, Number(vehicle.system.baseTierOfPower) || 1))} Damage &middot; ${
    foundry.utils.escapeHTML(entry.material)}</option>`).join("");
  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"], window: { title: `${vehicle.name}: Collision` },
    content: `<label class="dbu-wager"><span>It hit</span><select name="kind">
        <option value="feature">A Feature</option><option value="ground">The ground</option>
        ${targets.length ? `<option value="character">${targets.length === 1 ? foundry.utils.escapeHTML(targets[0].name)
          : `The ${targets.length} Characters targeted`} - as a Feature, Hardness Rank ${vehicle.system.hardnessRank}</option>` : ""}
      </select></label>
      <label class="dbu-wager"><span>Hardness Rank</span><select name="rank">${ranks}</select>
        <em>Of the Feature or the ground it hit</em></label>
      <p class="dbu-respond-hint">A Character it hits takes its Hardness Value; target them first.</p>`,
    buttons: [{ action: "hit", label: "Collide", default: true, callback: (event, button) => ({
      kind: button.form.elements.kind.value, rank: Number(button.form.elements.rank.value) || 0 }) },
      { action: "cancel", label: "Cancel" }],
    rejectClose: false
  }).catch(() => null);
  if (!chosen || (typeof chosen !== "object")) return null;
  const costs = collisionCosts(vehicle, chosen, targets);
  const { collisionTaken, requestActorUpdate } = await import("./chat.mjs");
  const said = [];
  for (const { target, amount } of costs) {
    if (target === vehicle) {
      const life = Math.max(0, (Number(vehicle.system.life?.value) || 0) - amount);
      await requestActorUpdate(vehicle, { "system.life.value": life });
      said.push(`${vehicle.name} loses ${amount} Life Points (${chosen.kind === "ground" ? "the ground" : "a Feature"}, Hardness Rank ${chosen.rank})`);
    }
    else said.push(await collisionTaken(target, amount, `Collision Damage, ${vehicle.name} - Hardness Rank ${vehicle.system.hardnessRank}`));
  }
  const text = `${vehicle.name} collides: ${said.join("; ")}.`;
  await globalThis.ChatMessage?.create({ speaker: globalThis.ChatMessage.getSpeaker({ actor: vehicle }),
    content: `<div class="dbu-settled-note">${foundry.utils.escapeHTML(text)}</div>` });
  return text;
}

/** The Actor a uuid names, if it can be had without waiting - a Vehicle's Creator, its Pilot and Passengers. */
export function actorAt(uuid) {
  if (!uuid) return null;
  try { return globalThis.fromUuidSync?.(uuid) ?? null; }
  catch { return null; }
}
