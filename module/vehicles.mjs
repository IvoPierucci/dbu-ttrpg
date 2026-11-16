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
  registerCrewHooks();
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
    if (crew.pilot === actor.uuid) return { vehicle, role: "pilot" };
    if ((crew.passengers ?? []).includes(actor.uuid)) return { vehicle, role: "passenger" };
  }
  return null;
}

/** Whether a character is Piloting a Vehicle - the Vehicle, or null. */
export function pilotedBy(actor) {
  const inside = vehicleOf(actor);
  return (inside?.role === "pilot") ? inside.vehicle : null;
}

/** The crew a change leaves: who is Pilot, who are Passengers - one actor moved, added or taken out. */
export function crewWith(crew, uuid, role) {
  const passengers = (crew?.passengers ?? []).filter(each => each !== uuid);
  let pilot = (crew?.pilot === uuid) ? "" : (crew?.pilot ?? "");
  if (role === "pilot") pilot = uuid;
  if (role === "passenger") passengers.push(uuid);
  return { pilot, passengers };
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
      const crew = token.actor.system.crew;
      const updates = [crew.pilot, ...(crew.passengers ?? [])].map(uuid => tokenDocOf(actorAt(uuid), scene)).filter(Boolean)
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

/** The Actor a uuid names, if it can be had without waiting - a Vehicle's Creator, its Pilot and Passengers. */
export function actorAt(uuid) {
  if (!uuid) return null;
  try { return globalThis.fromUuidSync?.(uuid) ?? null; }
  catch { return null; }
}
