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

/**
 * The names of the Advancements its applied Restrictions lock - "Locked Advancements" - less any its choice
 * frees: Limited Creation's "Weapon Summoner (unless you choose Weapon for the effects of Limited Creation)",
 * read off its file's `unlocksIf: weapon=Weapon Summoner`.
 */
export function lockedAdvancements(unique, getTrait = null) {
  return new Set((unique?.restrictions ?? []).filter(entry => entry.applied).flatMap(entry => {
    const freed = new Set(listOf(getTrait?.(entry.key)?.unlocksIf)
      .map(rule => rule.split("="))
      .filter(([choice]) => String(choice).trim().toLowerCase() === String(entry.choice ?? "").toLowerCase())
      .map(([, name]) => String(name ?? "").trim().toLowerCase()));
    return String(entry.locked ?? "").split(",").map(name => name.trim().toLowerCase())
      .filter(name => name && !freed.has(name));
  }));
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
    .reduce((sum, entry) => sum + advancementTPOf(entry), 0);
  return { listed, change, reduction, floor, base, free, charged, advancements, total: charged + advancements };
}

/** An Advancement's TP Cost: its own, changed by its TP Cost Change - never below nothing (the user's). */
export function advancementTPOf(entry) {
  return Math.max(0, (Number(entry?.tp) || 0) + Math.trunc(Number(entry?.tpChange) || 0));
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
    .map(part => String(part).trim()).filter(Boolean).join("\n\n")
    // "While this Unique Ability's effects are applied" - the Atmospheric Bubble's.
    .replace(/\$applied\b/g, unique.applied ? "1" : "0");
}

/**
 * "If a Unique Ability's Ki Point Cost (before modifications) is 4(T) or higher, you cannot reduce it below
 * 1/2 of its Ki Point Cost." The least it may cost, or 0 where the rule does not reach it.
 */
export function uniqueKiFloor(listed, tierOfPower) {
  const cost = Math.max(0, Number(listed) || 0);
  return (cost >= 4 * Math.max(1, Number(tierOfPower) || 1)) ? Math.ceil(cost / 2) : 0;
}

/**
 * The Unique Abilities an Active Buddy gives access to - the Oracle Fish's Precognition, `grantsUnique` - that
 * the character does not already have.
 */
export function grantedUniques(buddy, items, headerOf) {
  if (!buddy || buddy.system?.buddy?.locked || buddy.system?.buddy?.destroyed) return [];
  const owned = new Set(Array.from(items ?? []).filter(isUniqueAbility).map(item => item.system.unique?.libraryId));
  return listOf(headerOf(buddy, "grantsUnique")).filter(id => !owned.has(id));
}

/**
 * A Unique Ability as its file says it now. The files are where a Unique Ability is written (the user's ruling),
 * so a change there reaches everybody who already has it: what the Item keeps of its own is only what was chosen -
 * the type it counts as, its Free and TP Cost Change, each Advancement bought with its Free and TP Cost Change,
 * each Restriction applied with its choice. The rest is read from the file; the copy made when it was gained is
 * kept only for a file that is gone. An Advancement or Restriction added to the file appears, not bought; one
 * taken out of it goes, unless it was bought or applied.
 *
 * Written onto the prepared data (DBUManeuverData.prepareDerivedData), so every reader sees the file's.
 */
export function withLibrary(system, { getTrait, traitsOfKind } = {}) {
  const unique = system?.unique;
  const definition = unique?.libraryId ? getTrait?.(unique.libraryId) : null;
  if (!definition) return false;
  const fresh = uniqueItemFrom(definition, traitsOfKind?.("unique", definition.id) ?? []).system;
  for (const key of ["type", "actionCost", "kiCost", "kiCostPerTier", "kiCostPerBaseTier", "attacking",
    "requiresTarget", "usageLimit", "source", "text", "script", "clashSkill", "clashDefenderSkills"]) system[key] = fresh[key];
  system.tags = [...new Set([...(system.tags ?? []), ...fresh.tags])];
  for (const key of ["uaType", "tpCost", "prerequisite", "materialize", "precognition", "sustained", "upkeepKiPerTier", "sphereMagnitude", "barrier", "binds", "bluffs", "evade"]) {
    unique[key] = fresh.unique[key];
  }
  const merge = (stored, files, kept, held) => {
    const fromFile = files.map(entry => {
      const own = stored.find(each => each.key === entry.key);
      return { ...entry, id: own?.id ?? entry.key, ...Object.fromEntries(kept.map(key => [key, own?.[key] ?? entry[key]])) };
    });
    const known = new Set(files.map(entry => entry.key));
    return [...fromFile, ...stored.filter(each => !each.key || (!known.has(each.key) && each[held]))];
  };
  unique.advancements = merge(unique.advancements ?? [], fresh.unique.advancements, ["bought", "free", "tpChange"], "bought");
  unique.restrictions = merge(unique.restrictions ?? [], fresh.unique.restrictions, ["applied", "choice"], "applied");
  // What its bought Advancements do to its Ki Point Cost - Efficient Barrier's "by 2(T)" (maneuverKiCost).
  unique.kiCostPerTierChange = boughtTraits(unique, getTrait)
    .reduce((sum, trait) => sum + (Number(trait.kiCostPerTierChange) || 0), 0);
  return true;
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
export function uniqueItemFrom(definition, children = [], { chosenType = "", applied = [], choices = {} } = {}) {
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
      kiCostPerBaseTier: number(definition.kiCostPerBaseTier),
      attacking: definition.attacking === true,
      requiresTarget: definition.requiresTarget === true,
      // A Clash the Effect makes - Bluff Attack's "(Bluff vs Bluff/Intuition)".
      clashSkill: String(definition.clashSkill ?? ""),
      clashDefenderSkills: listOf(definition.clashDefenderSkills),
      tags: [UNIQUE_TAG],
      usageLimit: "1/round",
      source: String(definition.source ?? ""),
      text: String(definition.text ?? ""),
      script: String(definition.script ?? ""),
      unique: {
        uaType: String(definition.uaType ?? ""),
        chosenType,
        tpCost: number(definition.tpCost),
        prerequisite: listOf(definition.prerequisite).join(", "),
        libraryId: definition.id,
        materialize: definition.materializes === true,
        precognition: definition.foresees === true,
        sustained: definition.sustained === true,
        upkeepKiPerTier: number(definition.upkeepKiPerTier),
        sphereMagnitude: String(definition.sphereMagnitude ?? ""),
        barrier: definition.barrier === true,
        binds: definition.binds === true,
        bluffs: definition.bluffs === true,
        evade: { defense: number(definition.evadeDefense), offer: String(definition.evadeOffer ?? "") },
        advancements: children.filter(child => child.advancement === true).map(child => ({
          id: id(), key: child.id, name: child.name, tp: number(child.tpCost),
          prerequisite: listOf(child.prerequisite).join(", "), text: String(child.text ?? ""), script: String(child.script ?? ""),
          alsoOffer: String(child.evadeAlso ?? ""), clashSave: String(child.evadeClash ?? ""),
          clashAgainst: String(child.evadeClashAgainst ?? ""), clashNote: String(child.evadeClashNote ?? ""),
          noDiminishing: child.evadeNoDiminishing === true, bought: false, free: false, tpChange: 0
        })),
        restrictions: children.filter(child => child.restriction === true).map(child => ({
          id: id(), key: child.id, name: child.name, reduction: number(child.reduction),
          locked: listOf(child.locked).join(", "), text: String(child.text ?? ""), script: String(child.script ?? ""),
          applied: applied.includes(child.id),
          choice: String(choices[child.id] ?? "")
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
    kiCostPerTierChange: Number(system.unique?.kiCostPerTierChange) || 0,
    usageLimit: limit ? { amount: Number(limit[1]), per: limit[2].toLowerCase() } : null
  };
}

/** The Difficulty Categories in order, Novice to Grandmaster. */
const ORDER = ["novice", "apprentice", "qualified", "expert", "master", "grandmaster"];

/**
 * A Difficulty one Category harder - Magical Materialization's "increase the Difficulty Category by 1" - or,
 * already at Grandmaster, the same with 4 off the Dice Score: "(or reduce your Dice Score by 4 if the
 * Difficulty Category was Grandmaster)".
 */
export function harderBy1(difficulty) {
  const at = ORDER.indexOf(String(difficulty ?? ""));
  if (at < 0) return { difficulty, diceMinus: 0 };
  if (at === ORDER.length - 1) return { difficulty, diceMinus: 4 };
  return { difficulty: ORDER[at + 1], diceMinus: 0 };
}

/**
 * The Advancements bought onto a Unique Ability, as their files: what each does is written there
 * (`projectile: true`, `allowsTag: tech`...), and the Item keeps only which were bought.
 */
/** The files of the Restrictions applied to it - Gentle Hold's, Weak Hold's. */
export function appliedTraits(unique, getTrait) {
  return (unique?.restrictions ?? []).filter(entry => entry.applied && entry.key)
    .map(entry => getTrait?.(entry.key)).filter(Boolean);
}

export function boughtTraits(unique, getTrait) {
  return (unique?.advancements ?? []).filter(entry => entry.bought && entry.key)
    .map(entry => getTrait?.(entry.key)).filter(Boolean);
}

/**
 * Whether Magical Materialization makes this one harder: "Do not increase the Difficulty Category" with Magic
 * Crafter; a [Tech] Basic Item with Tech Materialization and 4+ Ranks in Craft (Basic Item), a [Food] one with
 * Food Materialization and 4+ in Cooking.
 */
export function materializeHarder(tags, bought, system) {
  if (bought.some(trait => String(trait.noHarder ?? "") === "all")) return false;
  for (const trait of bought) {
    const tag = String(trait.allowsTag ?? "").toLowerCase();
    const [skill, ranks] = String(trait.noHarderAt ?? "").split("=");
    if (!tag || !(tags ?? []).includes(tag) || !skill) continue;
    if ((Number(system?.skills?.[skill.trim()]?.ranks) || 0) >= (Number(ranks) || 0)) return false;
  }
  return true;
}

/**
 * The Basic Items Magical Materialization may make: "a Basic Item that does not have the [Tech] or [Food] tag"
 * - unless an Advancement allows that tag - with a Craft DC, and never "any Accessory with a Craft DC of
 * Grandmaster".
 */
export function materializable(definition, tags, itemType, bought) {
  if (!definition?.craftDC || (definition.special === true)) return false;
  const allowed = bought.map(trait => String(trait.allowsTag ?? "").toLowerCase()).filter(Boolean);
  if ((tags ?? []).some(tag => ["tech", "food"].includes(tag) && !allowed.includes(tag))) return false;
  if ((itemType === "accessory") && (String(definition.craftDC).trim().toLowerCase() === "grandmaster")) return false;
  return true;
}
