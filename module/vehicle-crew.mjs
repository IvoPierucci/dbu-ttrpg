/**
 * Who is in which Vehicle (vehicles.mjs), asked without importing it - the effects engine, the breath and the Maneuvers ask while a
 * character is prepared, and vehicles.mjs brings the data models with it. No imports: read from anywhere.
 *
 * The Crew is kept on the Vehicle (`system.crew`: a Pilot's uuid and the Passengers'), so this looks through the world's Vehicles.
 */

/**
 * The Vehicle a character is in, and as what: { vehicle, role: "pilot" | "passenger" }, or null. Not one they Pilot by a Remote
 * Control - they are not in it.
 */
export function vehicleHolding(actor) {
  const uuid = actor?.uuid;
  if (!uuid) return null;
  for (const vehicle of Array.from(globalThis.game?.actors ?? [])) {
    if (vehicle?.type !== "vehicle") continue;
    const crew = vehicle.system?.crew ?? {};
    if ((crew.pilot === uuid) && !crew.remote) return { vehicle, role: "pilot" };
    if ((crew.passengers ?? []).includes(uuid)) return { vehicle, role: "passenger" };
  }
  return null;
}

/** The Vehicle a character is Piloting - in it, or from afar by a Remote Control - or null. */
export function pilotedVehicle(actor) {
  const uuid = actor?.uuid;
  if (!uuid) return null;
  return Array.from(globalThis.game?.actors ?? []).find(vehicle => (vehicle?.type === "vehicle") && (vehicle.system?.crew?.pilot === uuid)) ?? null;
}

/** Whether a Vehicle has a Vehicle Quality, by its file's id without the "vehicle-". */
export function vehicleHasQuality(vehicle, id) {
  return (vehicle?.system?.qualities ?? []).some(entry => entry?.id === `vehicle-${id}`);
}

/**
 * An attack's targets with the Vehicles' crews taken out: "Characters within a Vehicle cannot be targeted by an Attacking Maneuver,
 * unless it is a Called Shot that targets them. Instead, any Attacking Maneuver made against Character(s) within a Vehicle will
 * instead target the Vehicle (even if that Attacking Maneuver was an AoE that would target multiple Characters, the Vehicle is only
 * targeted once by that Attacking Maneuver)." A Called Shot keeps the one it was aimed at.
 *
 * @param {Actor} target          the one it was aimed at
 * @param {object[]} extraTargets the rest, `{ uuid, name, ... }`
 * @param {boolean} calledShot
 * @returns {{ target: Actor, extraTargets: object[] }}
 */
export function vehicleTargets(target, extraTargets = [], calledShot = false) {
  const lookup = uuid => globalThis.fromUuidSync?.(uuid) ?? null;
  const instead = actor => vehicleHolding(actor)?.vehicle ?? actor;
  const first = calledShot ? target : instead(target);
  const seen = new Set([first?.uuid]);
  const rest = [];
  for (const entry of extraTargets ?? []) {
    const actor = lookup(entry?.uuid);
    const now = actor ? instead(actor) : null;
    const uuid = now?.uuid ?? entry?.uuid;
    if (!uuid || seen.has(uuid)) continue;
    seen.add(uuid);
    rest.push((now && (now !== actor)) ? { ...entry, uuid: now.uuid, name: now.name } : entry);
  }
  return { target: first, extraTargets: rest };
}

/**
 * "If a Character is targeted by a Called Shot while inside of a Vehicle, increase their Damage Reduction by that Vehicle's Soak
 * Value." What it adds, or 0.
 */
export function calledShotShelter(target, calledShot) {
  if (!calledShot) return 0;
  return Number(vehicleHolding(target)?.vehicle?.system?.soakValue) || 0;
}

/** An attack's Pilot standing in for the Vehicle it is aimed at - the user's: its Pilot's Dodge Roll, with its Defense Value. */
export function vehicleDodgeOf(attack, pilotUuid) {
  return (attack?.vehicleDodges ?? []).find(entry => entry?.pilotUuid === pilotUuid) ?? null;
}

/**
 * "Characters within a Vehicle ignore the effects of the Battle Environment and Environment Qualities for the Squares they are
 * currently occupying. They still suffer the effects of an Unbreathable Environment." And Air-Tight: "Characters within this
 * Vehicle can ignore the effects of Battle Weather and Unbreathable Environments."
 */
export function shelteredBy(actor) {
  const held = vehicleHolding(actor);
  if (!held) return { ground: false, airTight: false };
  return { ground: true, airTight: vehicleHasQuality(held.vehicle, "air-tight") };
}
