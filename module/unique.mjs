/**
 * Unique Abilities: Maneuvers bought with Technique Points, each an Item tagged `uniqueAbility`, with
 * Advancements bought onto it and Restrictions applied to it.
 */

/** The tag a Unique Ability carries - Transfigured forbids everything tagged with it. */
export const UNIQUE_TAG = "uniqueAbility";

/**
 * "Unique Abilities are separated into two types: Technical and Magical ... If a Unique Ability lists both
 * of them (Technical/Magical), then the category can be chosen when gaining the Unique Ability."
 */
export const UNIQUE_TYPES = Object.freeze({
  technical: { label: "Technical" },
  magical: { label: "Magical" },
  both: { label: "Technical/Magical" }
});

/** Whether an Item is a Unique Ability. */
export function isUniqueAbility(item) {
  return (item?.type === "maneuver") && (item.system?.tags ?? []).includes(UNIQUE_TAG);
}

/** The type it counts as: its own, or - listing both - the one chosen. */
export function uniqueTypeOf(unique) {
  const listed = String(unique?.uaType ?? "");
  if (listed !== "both") return listed;
  return ["technical", "magical"].includes(unique?.chosenType) ? unique.chosenType : "";
}

/** The names of the Advancements its applied Restrictions lock - "Locked Advancements". */
export function lockedAdvancements(unique) {
  return new Set((unique?.restrictions ?? []).filter(entry => entry.applied)
    .flatMap(entry => String(entry.locked ?? "").split(",").map(name => name.trim().toLowerCase()).filter(Boolean)));
}

/**
 * What a Unique Ability costs in Technique Points: its listed cost, changed by its TP Cost Change and less its
 * applied Restrictions - "The TP Cost for a Unique Ability cannot be reduced below 1/2 of its listed TP Cost" -
 * and each Advancement bought on top. Free, its own price is not charged; its Advancements still are (the
 * user's rulings).
 */
export function uniqueTPOf(unique) {
  const listed = Math.max(0, Number(unique?.tpCost) || 0);
  const change = Math.trunc(Number(unique?.tpChange) || 0);
  const reduction = (unique?.restrictions ?? []).filter(entry => entry.applied)
    .reduce((sum, entry) => sum + Math.max(0, Number(entry.reduction) || 0), 0);
  // Never below half the listed cost: a half-point would be below it, so it is kept.
  const floor = Math.ceil(listed / 2);
  const base = Math.max(floor, listed + change - reduction);
  const free = unique?.free === true;
  const charged = free ? 0 : base;
  const advancements = (unique?.advancements ?? []).filter(entry => entry.bought)
    .reduce((sum, entry) => sum + Math.max(0, Number(entry.tp) || 0), 0);
  return { listed, change, reduction, floor, base, free, charged, advancements, total: charged + advancements };
}

/**
 * What a Unique Ability does, as one script: its own - the Passive Bonus and what it does when used - then
 * each Advancement bought and each Restriction applied.
 */
export function uniqueScriptOf(system) {
  const unique = system?.unique ?? {};
  return [system?.script ?? "",
    ...(unique.advancements ?? []).filter(entry => entry.bought).map(entry => entry.script ?? ""),
    ...(unique.restrictions ?? []).filter(entry => entry.applied).map(entry => entry.script ?? "")]
    .map(part => String(part).trim()).filter(Boolean).join("\n\n");
}

/**
 * "If a Unique Ability's Ki Point Cost (before modifications) is 4(T) or higher, you cannot reduce it below
 * 1/2 of its Ki Point Cost." The least it may cost, or 0 where the rule does not reach it.
 */
export function uniqueKiFloor(listed, tierOfPower) {
  const cost = Math.max(0, Number(listed) || 0);
  return (cost >= 4 * Math.max(1, Number(tierOfPower) || 1)) ? Math.ceil(cost / 2) : 0;
}
