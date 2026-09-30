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
  const named = (Array.isArray(definition?.requiresSkill) ? definition.requiresSkill
    : String(definition?.requiresSkill ?? "").split(",")).map(each => String(each).trim()).filter(Boolean);
  if (!named.length) return false;
  // Any of several - Create's "Craft Skill (or Medicine/Cooking ...)".
  if (named.length > 1) return named.some(one => meetsPrerequisite({ ...definition, requiresSkill: one }, system));
  const [said] = named;
  // The Skill's own key, whatever case the file wrote it in - `creatureHandling`.
  const skill = Object.keys(system?.skills ?? {}).find(key => key.toLowerCase() === said.toLowerCase()) ?? said;
  const ranks = Number(system?.skills?.[skill]?.ranks) || 0;
  if (ranks < (Number(definition.requiresRanks) || 0)) return false;
  // And a Specialty of it, where it names one - Tune Up's "Craft (Vehicles)", ticked on the Skill.
  const specialty = String(definition.requiresSpecialty ?? "").trim().toLowerCase();
  if (!specialty) return true;
  // Stored by the Specialty's name - "Basic Item", "Vehicles" - which opens with its key.
  return String(system?.skillSpecializations?.[skill] ?? "").split(",")
    .map(each => each.trim().toLowerCase()).some(each => each.startsWith(specialty));
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

/**
 * The most an Adventuring Maneuver's area can be for so many Skill Ranks - Fraud's "At 2~3 Skill Ranks,
 * at most you can affect a single city. At 4 Skill Ranks ... a full country. At 5 Skill Ranks ... an
 * entire planet." Written `area2:`, `area4:`, `area5:` - the highest reached.
 */
export function areaFor(definition, ranks) {
  const steps = Object.entries(definition ?? {})
    .map(([key, value]) => [Number(key.match(/^area(\d+)$/)?.[1]), String(value ?? "").trim()])
    .filter(([at, said]) => Number.isFinite(at) && said)
    .sort(([a], [b]) => a - b);
  return steps.filter(([at]) => at <= (Number(ranks) || 0)).pop()?.[1] ?? "";
}

/** "Hunger is a penalty that comes in three stages" - the stack count of the Hunger mark, and none. */
export const HUNGER_STAGES = Object.freeze([
  { stage: 0, label: "Fed", tip: "No Hunger." },
  { stage: 1, label: "Hungry", tip: "Halve your Surgency." },
  { stage: 2, label: "Ravenous", tip: "Quarter your Surgency and reduce your Combat Rolls and Soak Value by 1(bT)." },
  { stage: 3, label: "Starving", tip: "Set your Surgency to 0 and reduce your Combat Rolls and Soak Value by 3(bT)." }
]);

/**
 * The Cook Maneuver's Difficulty Category, by "the highest Rarity of any Special Ingredients you used to
 * pay the Ingredient Cost of a Meal".
 */
export const COOK_DIFFICULTIES = Object.freeze([
  { key: "apprentice", special: "No Special Ingredient" },
  { key: "qualified", special: "Uncommon Ingredient" },
  { key: "expert", special: "Rare Ingredient" },
  { key: "master", special: "Legendary Ingredient" }
]);

/**
 * "Each individual you intend to feed is worth 1~3 Ingredients, depending on the intended reduction to
 * Hunger Stages." The Ingredient Cost of so many portions - each 0 (not fed) to 3.
 */
export function mealCost(portions) {
  return (portions ?? []).reduce((sum, portion) => sum + Math.max(0, Math.min(3, Number(portion?.stages) || 0)), 0);
}

/**
 * How many Ingredients to take from each Item carried, so many in all: from the first on as far as each
 * goes, unless a choice says otherwise. Null if they do not carry enough.
 */
export function ingredientsTaken(pools, cost, chosen = null) {
  const wanted = Math.max(0, Number(cost) || 0);
  const have = (pools ?? []).reduce((sum, pool) => sum + Math.max(0, Number(pool.charges) || 0), 0);
  if (have < wanted) return null;
  if (chosen) {
    const taken = pools.map(pool => ({ id: pool.id,
      count: Math.min(Math.max(0, Math.floor(Number(chosen[pool.id]) || 0)), Math.max(0, Number(pool.charges) || 0)) }));
    return (taken.reduce((sum, each) => sum + each.count, 0) === wanted) ? taken.filter(each => each.count) : null;
  }
  let left = wanted;
  return pools.map(pool => {
    const count = Math.min(left, Math.max(0, Number(pool.charges) || 0));
    left -= count;
    return { id: pool.id, count };
  }).filter(each => each.count);
}

/** A fed Character's Hunger after the Meal: so many stages off, never below none. */
export function hungerAfter(stage, stages) {
  return Math.max(0, (Number(stage) || 0) - Math.max(0, Number(stages) || 0));
}

/**
 * Crafting's Auto-Succeed: "Once you possess 4 Skill Ranks in Craft, you automatically succeed at all
 * Craft Skill Checks against Difficulty Categories of Qualified or less. Upon reaching 5 Skill Ranks,
 * increase this to Expert or less." Whether a Craft Check at this Difficulty, with so many Ranks, needs no
 * roll.
 */
export function craftAutoSucceeds(ranks, difficulty) {
  const order = ["novice", "apprentice", "qualified", "expert", "master", "grandmaster"];
  const at = order.indexOf(String(difficulty ?? ""));
  if (at < 0) return false;
  const reach = ((Number(ranks) || 0) >= 5) ? "expert" : ((Number(ranks) || 0) >= 4) ? "qualified" : "";
  return Boolean(reach) && (at <= order.indexOf(reach));
}

/** The Difficulty Categories in order, Novice to Grandmaster. */
export const DIFFICULTY_ORDER = Object.freeze(["novice", "apprentice", "qualified", "expert", "master", "grandmaster"]);

/**
 * What the Create Maneuver rolls for a Basic Item: "Medicine. Use your Medicine Skill instead of the
 * Craft Skill"; "Food ... use your Cooking Skill instead"; otherwise Craft, with its Basic Items
 * Specialty.
 */
export function createSkillFor(tags) {
  const list = (tags ?? []).map(tag => String(tag).toLowerCase());
  if (list.includes("med")) return { skill: "medicine", specialty: "" };
  if (list.includes("food")) return { skill: "cooking", specialty: "" };
  return { skill: "craft", specialty: "basic" };
}

/**
 * "To create a Basic Item with the [Tech] tag, a Vehicle, or a Battle Jacket, you must spend a number of
 * Scrap depending on the Difficulty Category (1~6, from Novice to Grandmaster). For creating a Battle
 * Jacket, however, you must double the amount of Scrap required."
 */
export function scrapCost(difficulty, { battleJacket = false } = {}) {
  const at = DIFFICULTY_ORDER.indexOf(String(difficulty ?? ""));
  if (at < 0) return 0;
  return (at + 1) * (battleJacket ? 2 : 1);
}

/** Whether a character may use a Skill for Create: 2+ Ranks, and the Specialty ticked where one is named. */
export function canCreateWith(system, skill, specialty = "") {
  return meetsPrerequisite({ requiresSkill: skill, requiresRanks: 2, requiresSpecialty: specialty }, system);
}

/**
 * Whether a character already holds a Blueprint of this - one of each thing is enough. A Basic Item's
 * by its file; anything else by its name.
 */
export function hasBlueprint(items, { kind, id, name }) {
  return (items ?? []).some(item => {
    const record = item?.system?.blueprint;
    if (!record?.kind || (record.kind !== kind)) return false;
    return (kind === "basic") ? (record.id === id) : (record.name.trim().toLowerCase() === String(name ?? "").trim().toLowerCase());
  });
}

/** "Reputation for Affection is measured in Affection Rating, a value between 0~4." */
export const AFFECTION_RATINGS = Object.freeze([
  { label: "Hated", tip: "This Individual or Faction actively hates your Character and will act against them in most situations. They may go out of their way to spite or try to harm your Character, depending on their beliefs." },
  { label: "Disliked", tip: "While not to the extent of hatred, this Individual or Faction finds your Character unpleasant or harbors some kind of grudge. Generally speaking, they will act against your Character, but may not go out of their way to purposefully upset you." },
  { label: "Neutral", tip: "This Individual or Faction has no particular feelings about your Character, and will treat them like any other stranger they’d encounter." },
  { label: "Liked", tip: "This Individual or Faction likes your Character, typically being on their side and doing what they can to help them. They may not act to their own detriment in doing so, but they will offer aid where they can." },
  { label: "Loved", tip: "This Individual or Faction loves your Character, they may act even to their own detriment to help them, or act in surprising ways to your Character’s benefit." }
]);

/** "Reputation for Alarm is measured in Alarm Rating, a value between 0~4." */
export const ALARM_RATINGS = Object.freeze([
  { label: "Harmless", tip: "Your Character is seen as completely harmless by this Individual or Faction. They won’t be scared to act against you, and may exploit your presence without concern." },
  { label: "Unbothered", tip: "This Individual or Faction does not consider you a threat, and is generally unbothered by your presence. While they may treat you with some degree of awareness as an individual, they are unlikely to budge due to your actions." },
  { label: "Neutral", tip: "This Individual or Faction has no strong feelings of fear about your Character beyond what they’d have against an unknown stranger." },
  { label: "Feared", tip: "This Individual or Faction fears your Character. They may hesitate to act against them and may act in a way that supports your Character purely to try and remain on their good side." },
  { label: "Terrified", tip: "This Individual or Faction is absolutely terrified of your Character and is highly unlikely to act against them, unless they gain some kind of unique edge, ally, or power that changes the dynamics. They will likely accept any requests and may act for you just to avoid angering your Character." }
]);

/**
 * "Reduce/increase the TN of any Persuasion Skill Check against an Individual or Faction based on how much
 * higher/lower their Affection Rating is than 2" - and Intimidation by the Alarm Rating, the same way.
 */
export function reputationTN(rating) {
  return 2 - Math.max(0, Math.min(4, Number(rating) || 0));
}

/**
 * The list as the sheet shows it: each Faction with its Individuals under it, then the Individuals of
 * none - "a Character’s particular Reputation in relation to that Character supersedes the Reputation they
 * possess with the Faction as a whole".
 */
export function reputationRows(entries) {
  const list = entries ?? [];
  const row = (entry, member = false) => {
    const affection = Math.max(0, Math.min(4, Number(entry.affection) || 0));
    const alarm = Math.max(0, Math.min(4, Number(entry.alarm) || 0));
    const signed = n => (n > 0) ? `+${n}` : String(n);
    return { ...entry, member, affection, alarm, kindLabel: (entry.kind === "faction") ? "Faction" : "Individual",
      affectionLabel: AFFECTION_RATINGS[affection].label, affectionTip: AFFECTION_RATINGS[affection].tip,
      alarmLabel: ALARM_RATINGS[alarm].label, alarmTip: ALARM_RATINGS[alarm].tip,
      persuasionTN: signed(reputationTN(affection)), intimidationTN: signed(reputationTN(alarm)) };
  };
  const factions = list.filter(entry => entry.kind === "faction");
  const known = new Set(factions.map(faction => faction.id));
  return [
    ...factions.flatMap(faction => [row(faction),
      ...list.filter(entry => (entry.kind === "individual") && (entry.faction === faction.id)).map(entry => row(entry, true))]),
    ...list.filter(entry => (entry.kind === "individual") && !known.has(entry.faction)).map(entry => row(entry))
  ];
}
