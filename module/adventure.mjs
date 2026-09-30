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
      // "Session Limit: Infinite" - or "Unlimited" - null, and never reached.
      const infinite = ["infinite", "unlimited"].includes(String(definition.sessionLimit ?? "").trim().toLowerCase());
      const limit = infinite ? null : Math.max(1, Number(definition.sessionLimit) || 1);
      const used = uses.filter(entry => usedAs(entry, definition.id)).length;
      return {
        id: definition.id,
        name: definition.name,
        timeCost: String(definition.timeCost ?? ""),
        prerequisite: String(definition.prerequisite ?? "N/A"),
        limit,
        left: infinite ? null : Math.max(0, limit - used),
        exhausted: !infinite && (used >= limit),
        text: String(definition.text ?? ""),
        // The mark it leaves, and whether it is held now - for the row's Cancel buff.
        gains: String(definition.gains ?? "").trim().toLowerCase(),
        buffed: Boolean(definition.gains)
          && ((Number(system?.conditions?.[String(definition.gains).trim().toLowerCase()]) || 0) > 0)
      };
    });
}

/**
 * One attempt recorded for this Adventuring Maneuver: its id, or its id and whom it was aimed at -
 * `pickpocket@Actor.x` - where that matters.
 */
function usedAs(entry, id) {
  return (entry === id) || String(entry).startsWith(`${id}@`);
}

/**
 * Pickpocket's "each time you target a Character with this Adventuring Maneuver during an
 * Adventuring Session, reduce the Dice Score of your Thievery Skill against that Character by 3 for
 * any subsequent checks" - so much for every earlier attempt on them.
 */
export function targetPenalty(uses, id, targetUuid, per) {
  return (uses ?? []).filter(entry => entry === `${id}@${targetUuid}`).length * (Number(per) || 0);
}

/**
 * "To use an Adventuring Maneuver, you may have to meet a certain requirement" - so many Skill Ranks,
 * Stretch's "2+ Skill Ranks in Acrobatics". One that is not met is not offered.
 */
export function meetsPrerequisite(definition, system) {
  const said = String(definition?.requiresSkill ?? "").trim();
  if (!said) return false;
  // The Skill's own key, whatever case the file wrote it in - `creatureHandling`.
  const skill = Object.keys(system?.skills ?? {}).find(key => key.toLowerCase() === said.toLowerCase()) ?? said;
  const ranks = Number(system?.skills?.[skill]?.ranks) || 0;
  if (ranks < (Number(definition.requiresRanks) || 0)) return false;
  // And a Specialty of it, where it names one - Tune Up's "Craft (Vehicles)", ticked on the Skill.
  const specialty = String(definition.requiresSpecialty ?? "").trim().toLowerCase();
  if (!specialty) return true;
  return String(system?.skillSpecializations?.[skill] ?? "").split(",")
    .map(each => each.trim().toLowerCase()).includes(specialty);
}

/**
 * Why an Adventuring Maneuver cannot be attempted now, or null. "Adventuring Maneuvers are Maneuvers
 * that can be exclusively used outside of Combat Encounters."
 */
export function whyNotAdventuring(entry, { adventuring = true } = {}) {
  if (!entry) return "There is no such Adventuring Maneuver.";
  if (!adventuring) return "Only outside a Combat Encounter.";
  if ((entry.left !== null) && (entry.left <= 0)) return `Its Session Limit (${entry.limit}) is reached this Adventuring Session.`;
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

/**
 * Full Repair's "1/5 of their respective maximums for every 2 hours spent": the fifths earned by so
 * many hours. Any hour from 2 to 10 may be spent (the user's ruling); an odd one rounds down.
 */
export function repairSteps(hours, { per = 2, min = 2, max = 10 } = {}) {
  const spent = Math.min(max, Math.max(min, Math.floor(Number(hours) || 0)));
  return Math.floor(spent / (Number(per) || 2));
}

/** The Life Points a Weapon is left having lost, so many fifths of its most given back. */
export function repairedLoss({ lifeMax = 0, lifeLost = 0, steps = 0, share = 5 } = {}) {
  const back = steps * Math.floor(Math.max(0, Number(lifeMax) || 0) / (Number(share) || 5));
  return Math.max(0, (Number(lifeLost) || 0) - back);
}

/**
 * Care, done: "They regain Life Points equal to 1/4 of their maximum", and - where they take it - "treated
 * as if they used the Rest Maneuver": that one's share of Life and Ki on top. Each up to its maximum,
 * rounded down. What they are left at.
 */
export function caredFor({ life, ki }, { lifeShare = 4, restShare = 0 } = {}) {
  const lifeMax = Math.max(0, Number(life?.max) || 0);
  const kiMax = Math.max(0, Number(ki?.max) || 0);
  let lifeNow = Math.min(lifeMax, (Number(life?.value) || 0) + Math.floor(lifeMax / (Number(lifeShare) || 4)));
  let kiNow = Number(ki?.value) || 0;
  if (restShare) {
    lifeNow = Math.min(lifeMax, lifeNow + Math.floor(lifeMax / restShare));
    kiNow = Math.min(kiMax, kiNow + Math.floor(kiMax / restShare));
  }
  return { life: Math.max(Number(life?.value) || 0, lifeNow), ki: Math.max(Number(ki?.value) || 0, kiNow) };
}
