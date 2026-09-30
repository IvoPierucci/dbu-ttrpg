/**
 * The Adventure rules: time outside a Combat Encounter.
 */

/**
 * "There are three types of Travel, decided by the time an instance of Travel would take." Each
 * with the share of Maximum Ki Points it costs on completing it.
 */
export const TRAVEL_TYPES = Object.freeze({
  // "A Travel that will take less than an hour. There is little difficulty in Short Travel."
  short: { label: "Short", time: "Less than an hour", share: 0 },
  // "Upon completing Medium Travel, reduce your Ki Points by 1/10th of your Maximum Ki Points."
  medium: { label: "Medium", time: "An hour to a day", share: 10 },
  // "Upon completing Long Travel, reduce your Ki Points by 1/4 of your Maximum Ki Points."
  long: { label: "Long", time: "More than a day", share: 4 }
});

/** "If a Character has less than 2 Skill Ranks in Flight, double the amount of Ki Points they lose." */
export const TRAVEL_FLIGHT_RANKS = 2;

/**
 * The Ki Points an instance of Travel takes on completing it, and why.
 *
 * "Travel and Vehicles ... regardless of the Travel Type, you do not lose any Ki Points." "Travel and
 * Rest. If you use the Rest Maneuver while engaging in a Medium or Long Travel (if the instance of
 * Travel takes less than 2 days), you do not have to reduce your Ki Points." Fractions round down.
 */
export function travelKiLoss({ type, maxKi = 0, flightRanks = 0, vehicle = false, rested = false } = {}) {
  const share = TRAVEL_TYPES[type]?.share ?? 0;
  if (!share) return { loss: 0, reason: "" };
  if (vehicle) return { loss: 0, reason: "by Vehicle" };
  if (rested) return { loss: 0, reason: "rested on the way" };
  const base = Math.floor(Math.max(0, Number(maxKi) || 0) / share);
  const doubled = (Number(flightRanks) || 0) < TRAVEL_FLIGHT_RANKS;
  return {
    loss: doubled ? base * 2 : base,
    reason: `1/${share} of their Maximum Ki Points${doubled ? `, doubled - under ${TRAVEL_FLIGHT_RANKS} Ranks in Flight` : ""}`
  };
}

/**
 * The Adventuring Maneuvers a character has, each with what is left of its Session Limit.
 *
 * "Universal Adventuring Maneuvers ... are possessed by all Characters." "While most Adventuring
 * Maneuvers can only be attempted once during each Adventuring Session, some may be able to be used
 * multiple times up to a listed Session Limit."
 */
export function adventuringManeuvers(definitions, uses = [], system = null) {
  return definitions
    .filter(definition => (definition.universal === true) || meetsPrerequisite(definition, system))
    .map(definition => {
      const limit = Math.max(1, Number(definition.sessionLimit) || 1);
      const used = uses.filter(id => id === definition.id).length;
      return {
        id: definition.id,
        name: definition.name,
        timeCost: String(definition.timeCost ?? ""),
        prerequisite: String(definition.prerequisite ?? "N/A"),
        limit,
        left: Math.max(0, limit - used),
        text: String(definition.text ?? "")
      };
    });
}

/**
 * "To use an Adventuring Maneuver, you may have to meet a certain requirement" - so many Skill Ranks,
 * Stretch's "2+ Skill Ranks in Acrobatics". One that is not met is not offered.
 */
export function meetsPrerequisite(definition, system) {
  const skill = String(definition?.requiresSkill ?? "").trim().toLowerCase();
  if (!skill) return false;
  const ranks = Number(system?.skills?.[skill]?.ranks) || 0;
  return ranks >= (Number(definition.requiresRanks) || 0);
}

/**
 * Why an Adventuring Maneuver cannot be attempted now, or null. "Adventuring Maneuvers are Maneuvers
 * that can be exclusively used outside of Combat Encounters."
 */
export function whyNotAdventuring(entry, { adventuring = true } = {}) {
  if (!entry) return "There is no such Adventuring Maneuver.";
  if (!adventuring) return "Only outside a Combat Encounter.";
  if (entry.left <= 0) return `Its Session Limit (${entry.limit}) is reached this Adventuring Session.`;
  return null;
}

/**
 * Life and Ki Points regained - "equal to 1/10th of their respective maximums", "half" - each up to
 * its maximum. Rounded down.
 */
export function regainedShare(share, { life, ki }) {
  const back = pool => {
    const max = Math.max(0, Number(pool?.max) || 0);
    const value = Number(pool?.value) || 0;
    const gain = share ? Math.floor(max / share) : 0;
    return Math.max(0, Math.min(max, value + gain) - value);
  };
  return { life: back(life), ki: back(ki) };
}
