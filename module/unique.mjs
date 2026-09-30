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
 * and each Advancement bought on top. Free, its own price is not charged; its Advancements still are - unless
 * an Advancement is Free itself (the user's rulings).
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
  const advancements = (unique?.advancements ?? []).filter(entry => entry.bought && !entry.free)
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

/** A header list - "a, b" or a parsed list - as clean strings. */
function listOf(raw) {
  return (Array.isArray(raw) ? raw : String(raw ?? "").split(",")).map(each => String(each).trim()).filter(Boolean);
}

/**
 * A Unique Ability's Item, from its file and the files of its Advancements and Restrictions: a Maneuver,
 * tagged, once per Combat Round, with everything it can have bought onto it - none bought, and the
 * Restrictions chosen when it is gained applied. `chosenType` where it lists both.
 */
export function uniqueItemFrom(definition, children = [], { chosenType = "", applied = [] } = {}) {
  const id = () => foundry.utils.randomID();
  const number = raw => Math.max(0, Number(raw) || 0);
  return {
    name: definition.name,
    type: "maneuver",
    img: "icons/magic/symbols/rune-sigil-black-pink.webp",
    system: {
      type: String(definition.type ?? "standard"),
      actionCost: number(definition.actionCost),
      kiCost: number(definition.kiCost),
      kiCostPerTier: number(definition.kiCostPerTier),
      attacking: definition.attacking === true,
      requiresTarget: definition.requiresTarget === true,
      tags: [UNIQUE_TAG],
      usageLimit: "1/round",
      source: String(definition.source ?? ""),
      text: String(definition.text ?? ""),
      script: String(definition.script ?? ""),
      unique: {
        uaType: String(definition.uaType ?? ""),
        chosenType,
        tpCost: number(definition.tpCost),
        prerequisite: String(definition.prerequisite ?? ""),
        libraryId: definition.id,
        evade: { defense: number(definition.evadeDefense), offer: String(definition.evadeOffer ?? "") },
        advancements: children.filter(child => child.advancement === true).map(child => ({
          id: id(), key: child.id, name: child.name, tp: number(child.tpCost),
          prerequisite: String(child.prerequisite ?? ""), text: String(child.text ?? ""), script: String(child.script ?? ""),
          alsoOffer: String(child.evadeAlso ?? ""), clashSave: String(child.evadeClash ?? ""),
          clashAgainst: String(child.evadeClashAgainst ?? ""), clashNote: String(child.evadeClashNote ?? ""),
          noDiminishing: child.evadeNoDiminishing === true, bought: false
        })),
        restrictions: children.filter(child => child.restriction === true).map(child => ({
          id: id(), key: child.id, name: child.name, reduction: number(child.reduction),
          locked: listOf(child.locked).join(", "), text: String(child.text ?? ""), script: String(child.script ?? ""),
          applied: applied.includes(child.id)
        }))
      }
    }
  };
}

/**
 * What answering an attack with this Unique Ability brings to it - the Afterimage Technique's: the Defense
 * Value it adds, and what the attack avoided offers, with every Advancement bought onto it.
 */
export function evasionOf(item, tierOfPower) {
  const unique = item?.system?.unique;
  const defense = Number(unique?.evade?.defense) || 0;
  if (!defense) return null;
  const bought = (unique.advancements ?? []).filter(entry => entry.bought);
  const clash = bought.find(entry => entry.clashSave);
  return {
    itemId: item.id,
    name: item.name,
    bonus: defense * Math.max(1, Number(tierOfPower) || 1),
    written: `+${defense}(T)`,
    offer: String(unique.evade.offer ?? ""),
    also: bought.map(entry => entry.alsoOffer).filter(Boolean),
    alsoFrom: bought.filter(entry => entry.alsoOffer).map(entry => entry.name),
    clash: clash ? { save: clash.clashSave, against: clash.clashAgainst, note: clash.clashNote, from: clash.name } : null,
    noDiminishing: bought.some(entry => entry.noDiminishing)
  };
}

/**
 * A Unique Ability's Item as the Maneuver rules read one - what it costs, its limit, its tags - for the
 * doors that are not the sheet's: the Afterimage Technique answered from an attack's card.
 */
export function uniqueDefinitionOf(item) {
  const system = item?.system ?? {};
  const limit = String(system.usageLimit ?? "").match(/^(\d+)\s*\/\s*(round|encounter)$/i);
  return {
    id: item.id,
    itemId: item.id,
    name: item.name,
    type: system.type,
    actionCost: system.actionCost,
    kiCost: system.kiCost,
    kiCostPerBaseTier: system.kiCostPerBaseTier,
    kiCostPerTier: system.kiCostPerTier,
    tags: system.tags ?? [],
    usageLimit: limit ? { amount: Number(limit[1]), per: limit[2].toLowerCase() } : null
  };
}
