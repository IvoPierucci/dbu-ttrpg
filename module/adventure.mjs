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
