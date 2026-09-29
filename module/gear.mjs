/**
 * Gear, which is the rulebook's Equipment.
 *
 * "There are four Item Types in DBU: Basic Item, Accessory, Apparel, and Weapon." Each
 * Item a character has is an Item document of the `gear` type, copied from a file in
 * traits/gear/ the way a Maneuver is copied from traits/maneuvers/ - so it can be renamed
 * and re-described on the character without touching the file, and the file's entry is
 * still there to read.
 *
 * A character does not have every Item there is: they are given one when they gain it,
 * through the Add Item window on the Gear tab. How they came by it - the Gear Kit, its
 * Equipment Points, a find, a gift - is between the player and the ARC, and nothing here
 * keeps count of it.
 */

import { compile as compileScript } from "./effects/parser.mjs";
import { applyPassives, applySlot, PRIORITY } from "./effects/interpreter.mjs";
import { PHASES } from "./effects/slots.mjs";

/**
 * The four Item Types, and which list on the Gear tab each is drawn in.
 *
 * Accessories share the Basic Items' list: "Accessories are also counted as Basic Items
 * for rules and effects".
 */
export const GEAR_TYPES = Object.freeze({
  basic: { label: "Basic Item", list: "basic" },
  accessory: { label: "Accessory", list: "basic" },
  apparel: { label: "Apparel", list: "apparel" },
  weapon: { label: "Weapon", list: "weapon" },
  // "A Buddy is a small companion that assists you in certain ways both in and out of combat."
  buddy: { label: "Buddy", list: "buddy" }
});

/**
 * The tags a Basic Item can carry after its name.
 *
 * "Any Basic Item that has the [Tech] tag after its name is Technology." [Med] is
 * medicine, made with a Medicine Skill Check of the Craft DC, and [Food] is food, made
 * with a Cooking one.
 */
export const GEAR_TAGS = Object.freeze({
  tech: { label: "Tech" },
  med: { label: "Med", craftSkill: "medicine" },
  food: { label: "Food", craftSkill: "cooking" }
});

/**
 * What can set off an Item that goes off - the Bomb's three, as its entry names them.
 *
 * `row` is whether the Item's own row offers to set it off. A Timed one is not set off by
 * hand: its Rounds are counted, and the Round's card offers it when they have passed. A
 * Remote Controlled one is set off from the Remote Control connected to it: "You can
 * trigger this Bomb using a Remote Control Basic Item."
 */
export const GEAR_TRIGGERS = Object.freeze({
  remote: { label: "Remote Controlled", row: false },
  timed: { label: "Timed", row: false },
  proximity: { label: "Proximity", row: true }
});

/** A header of `key=value` pairs - "qualified=2, expert=3" - as numbers. */
function pairsOf(raw) {
  return Object.fromEntries(listOf(raw).map(entry => entry.split("=").map(part => part.trim()))
    .filter(([key, value]) => key && Number.isFinite(Number(value)))
    .map(([key, value]) => [key, Number(value)]));
}

/**
 * An Item made at one of the Craft DCs its entry allows: the DC, the Concealment it asks
 * for, and what destroys it. "Characters may attempt a Concealment Skill Check equal to the
 * Craft DC of this Scouter."
 */
export function atCraftDC(system, key, labels) {
  const label = labels?.[key]?.label ?? key;
  return {
    craftDC: label,
    scan: { ...system.scan, difficulty: key, breaksAt: Number(system.breaksAt?.[key]) || 0 }
  };
}

/**
 * The Items a Power Up at this Tier destroys, among these characters': "it can be destroyed
 * when a Character of Tier of Power 2+ (Qualified) or 3+ (Expert) uses the Power Up Maneuver
 * within 15 Squares of you." Who is within 15 Squares is the table's.
 */
export function brokenByPowerUp(actors, tier) {
  const broken = [];
  for (const actor of actors ?? []) {
    for (const item of Array.from(actor.items ?? [])) {
      const at = Number(item.system?.scan?.breaksAt) || 0;
      if ((item.type === "gear") && at && (tier >= at)) broken.push({ actor, item });
    }
  }
  return broken;
}

/**
 * Items built rather than picked from a list, and what building one is made of.
 *
 * "Apparel have a Craft DC depending on their Craftsmanship Grade. The Craftsmanship of a
 * piece of Apparel decides how many Quality Slots they have and the Apparel Grade of that
 * piece of Apparel." And "Apparel comes in three grades, each with their own Apparel Bonus."
 *
 * `categories` and `qualities` are the subfolders of traits/crafting/ the pieces are read
 * from. Weapons join this table the same way.
 */
export const CRAFTED = Object.freeze({
  apparel: {
    label: "Apparel",
    categories: "apparel-categories",
    qualities: "apparel-qualities",
    // "Choose a Craftsmanship Grade ... Choose an Apparel Category" - what Add Apparel starts
    // at, for the player to change on the Item.
    defaultCategory: "standard-clothing",
    grades: Object.freeze({
      1: { craftDC: "apprentice", grade: "low", slots: 0 },
      2: { craftDC: "qualified", grade: "low", slots: 1 },
      3: { craftDC: "expert", grade: "standard", slots: 2 },
      4: { craftDC: "master", grade: "standard", slots: 3 },
      5: { craftDC: "grandmaster", grade: "high", slots: 4 }
    }),
    // "All pieces of Apparel by default have a Break Value of 3."
    breakValue: 3,
    // "Low: Apparel Bonus of 1(bT). Standard: 2(bT). High: 3(bT)."
    bonus: Object.freeze({
      low: { label: "Low", perBaseTier: 1 },
      standard: { label: "Standard", perBaseTier: 2 },
      high: { label: "High", perBaseTier: 3 }
    })
  },
  weapon: {
    label: "Weapon",
    categories: "weapon-categories",
    qualities: "weapon-qualities",
    // "1) Choose a Craftsmanship Grade ... 2) Choose a Weapon Type. 3) Choose a Weapon Size.
    // 4) Choose a Weapon Category." What Add Weapon starts at, for the player to change.
    defaultCategory: "bludgeoning",
    defaultType: "physical",
    defaultSize: "standard",
    // "Weapons have a Craft DC depending on their Craftsmanship Grade ... The Craftsmanship of
    // a Weapon decides how many Quality Slots they have." No Grade band: a Weapon has no Bonus.
    grades: Object.freeze({
      1: { craftDC: "apprentice", slots: 0 },
      2: { craftDC: "qualified", slots: 1 },
      3: { craftDC: "expert", slots: 2 },
      4: { craftDC: "master", slots: 3 },
      5: { craftDC: "grandmaster", slots: 4 }
    }),
    // "Each Weapon starts with 32 Life Points and gains 8 Life Points each Power Level" - 40
    // at Power Level 1, by the table's ruling. "Weapons have Damage Reduction of 6(bT)."
    lifeBase: 32,
    lifePerLevel: 8,
    damageReductionPerBaseTier: 6,
    // "Weapons have a Hardness Value of 2 by default ... solely for the sake of throwing" - and the
    // Throw Maneuver's "If it was a Weapon, the Hardness Rank is 2". A Rank, by the table's ruling:
    // the Value is worked out from it, as any Feature's is.
    hardnessRank: 2
  }
});

/**
 * "When you create a Weapon, you must select an Attack Type (Physical/Energy/Magic)." Which
 * Attacking Maneuvers it can be used for - "fundamentally melee Weapons that can only be used
 * for Physical Attacks" - and which Categories it may be: the Foundation's key, each.
 */
export const WEAPON_TYPES = Object.freeze({
  physical: { label: "Physical" },
  energy: { label: "Energy" },
  magic: { label: "Magic" }
});

/**
 * "Weapons come in three Sizes": what each does to "All Attacking Maneuvers made with this
 * Weapon", in (T) - and its place in the three, which the Shield counts by: "X is 1 for Small
 * Weapons, 2 for Standard Weapons, and 3 for Large Weapons".
 */
export const WEAPON_SIZES = Object.freeze({
  small: { label: "Small", strike: 1, wound: -2, rank: 1 },
  standard: { label: "Standard", strike: 0, wound: 0, rank: 2 },
  big: { label: "Big", strike: -1, wound: 2, rank: 3 }
});

/** "While wielding any type of Weapon, reduce your Strike Rolls by 2(T)" - with it, by the table's ruling. */
export const WEAPON_PENALTY_PER_TIER = 2;

/** "You can only wield two Weapons at any one time." */
export const WEAPONS_WIELDED = 2;

/**
 * What a built Item comes to: its Category, Craft DC, Grade, Bonus and Quality Slots, and how
 * far past its Slots its Qualities go.
 *
 * Over is said, never refused: an Item with more Qualities than its Slots works as it is,
 * and the sheet says it is over.
 *
 * @param {object} crafted  the Item's `system.crafted`
 * @param {{getTrait: function, difficulties: object, baseTier: number}} with
 */
export function craftedReading(crafted, { getTrait, difficulties, baseTier = 1, data = null,
  category: withCategory = true }) {
  const kind = CRAFTED[crafted?.kind];
  if (!kind) return null;
  const grade = kind.grades[crafted.grade] ?? kind.grades[1];
  const category = getTrait?.(crafted.category) ?? null;

  // The Craft DC the Grade gives, moved by the Category - Standard Clothing's one lower -
  // and held to the ends of the list.
  const order = Object.keys(difficulties ?? {});
  const from = order.indexOf(grade.craftDC);
  const shift = Number(category?.craftDCShift) || 0;
  const craftDC = (from < 0) ? grade.craftDC
    : order[Math.min(order.length - 1, Math.max(0, from + shift))];

  // A Weapon has no Grade band and no Bonus: nothing, for whatever reads one.
  const band = kind.bonus?.[grade.grade] ?? { label: "", perBaseTier: 0 };
  // Slots used, not Qualities counted: "The Quality Slots for an Apparel Quality will explain
  // how many Quality Slots it takes up."
  const entries = qualityEntries(crafted);
  const count = entries.length;
  const used = entries.reduce((sum, entry) =>
    sum + slotsTaken(entry, getTrait?.(entry.id)), 0);
  const weapon = (crafted.kind === "weapon")
    ? weaponReading(crafted, { getTrait, data, baseTier }) : {};
  // What the piece is, as its own Effects say - never its Qualities' files: what they wrote
  // there when they were added, and whatever its owner has written since. Dense Armor's
  // `piece.apparelBonus += 1;`, Durable's `piece.breakValue += 3;`.
  const piece = pieceSlots(crafted, { getTrait, data, perBaseTier: band.perBaseTier,
    category: withCategory });
  const fromQualities = applySlot(piece, "piece.apparelBonus", 0);
  const perBaseTier = band.perBaseTier + fromQualities;
  const flag = key => piece[key] === true;
  return {
    kind: crafted.kind,
    categoryName: category?.name ?? crafted.category,
    craftDC,
    craftDCLabel: difficulties?.[craftDC]?.label ?? craftDC,
    gradeLabel: band.label,
    perBaseTier,
    fromQualities,
    bonus: perBaseTier * (Number(baseTier) || 1),
    slots: grade.slots,
    qualities: count,
    used,
    over: Math.max(0, used - grade.slots),
    // What the Armor Category's Damage Reduction is multiplied by - Sleek Design's "Halve the
    // Damage Reduction gained from this Armor", `piece.armorDamageReduction *= 1/2;` - 1 where
    // nothing says so. Read as written: the halving is the point, not a whole number.
    armorDamageReduction: factorOf(piece["piece.armorDamageReduction"]),
    // Whether it counts towards the Apparel Penalty - `piece.countsForPenalty = false;`, which
    // Lightweight, Sleek Design and Standard Clothing write.
    countsForPenalty: piece["piece.countsForPenalty"] !== false,
    // Whether its Break Value can be reduced at all - Unbreakable's "cannot have its Break
    // Value reduced". Read by breakApparel().
    unbreakable: flag("piece.unbreakable"),
    // The rest of what it says about itself, for the rules that come with Layers and the
    // Break Value: Joint Protection's, the Jacket's, Loose's, Segmented Weight's, Stretching's.
    sparesFirstBreak: flag("piece.sparesFirstBreak"),
    wornOverArmor: flag("piece.wornOverArmor"),
    doffsWithNoEffort: flag("piece.doffsWithNoEffort"),
    doffRounds: applySlot(piece, "piece.doffRounds", 0),
    sizeIsWearers: flag("piece.sizeIsWearers"),
    spikes: flag("piece.spikes"),
    // The most its Break Value can be: 3, and what its Effects add.
    breakValue: applySlot(piece, "piece.breakValue", Number(kind.breakValue) || 0),
    // What is left of it, and whether that is nothing: "An item only breaks when its Break
    // Value reaches 0." A destroyed piece has none left, whatever it lost.
    breakLeft: crafted.destroyed ? 0
      : Math.max(0, applySlot(piece, "piece.breakValue", Number(kind.breakValue) || 0)
        - (Number(crafted.breakLost) || 0)),
    destroyed: Boolean(crafted.destroyed),
    // A Hardness Value its Effects set outright - Hefty Plating's "is set to 4" - or null
    // where they say nothing about it.
    hardnessValue: piece["piece.hardnessValue"] ? applySlot(piece, "piece.hardnessValue", 0) : null,
    // Everything its Effects said about the piece, by Slot, for whoever reads one of its own.
    piece,
    // The ones its Category does not take: "Apparel Qualities may apply to only certain
    // Apparel Categories" - or, a Weapon's, its Type. Kept, and inactive.
    misfits: entries.filter(entry => !qualityFitsPiece(getTrait?.(entry.id), crafted))
      .map(entry => entry.id),
    // A Weapon's: its Type, Size, Life Points and the rest - see weaponReading().
    ...weapon,
    // How many of its Qualities are Special - "your ARC should be wary of giving any piece of
    // Apparel more than one Special Apparel Quality". Said past one, never refused.
    specials: entries.filter(entry => getTrait?.(entry.id)?.special === true).length,
    // Every one that is inactive, for either reason, by id.
    inactive: entries.filter(entry => qualityInactive(entry, crafted, getTrait))
      .map(entry => entry.id)
  };
}

/**
 * What worn Apparel has its wearer ignore of the ground under them - Environmental
 * Protection's "Ignore the effects of Battle Environments, Environmental Qualities": the
 * Environment's own effects, and its Square's Qualities'.
 *
 * Read off the Qualities rather than off an effect, because it decides which effects are
 * gathered at all: by the time an effect could say so, the Environment's has been run.
 */
export function groundIgnored(items, getTrait) {
  const ignored = { environments: false, qualities: false };
  const top = topLayerPiece(items);
  for (const { item } of apparelQualitiesInEffect(items)) {
    const piece = pieceSlots(item.system.crafted, { getTrait, category: item === top });
    if (piece["piece.ignoresEnvironments"] === true) ignored.environments = true;
    if (piece["piece.ignoresEnvironmentalQualities"] === true) ignored.qualities = true;
  }
  return ignored;
}

/**
 * Why a Quality on a piece does nothing, or "" when it applies.
 *
 * Its Category may not take it; or it asks for another Quality on the same piece, or for
 * one not to be there - "Prerequisites that require another Apparel Quality or lack thereof,
 * which require that Apparel Quality (or the lack of it) for them to be applied at all."
 * `excludesQualities: lightweight`, `requiresQualities: armed`. The wearer's own
 * Prerequisites are another matter, asked in the Quality's script.
 */
export function qualityInactive(entry, crafted, getTrait) {
  const trait = getTrait?.(entry.id);
  if (!qualityFitsPiece(trait, crafted)) {
    return (crafted?.kind === "weapon") ? "type" : "category";
  }
  const present = new Set(qualityEntries(crafted).map(other => other.id));
  const named = id => getTrait?.(id)?.name ?? id;
  const clash = listOf(trait?.excludesQualities).find(id => present.has(id));
  if (clash) return `has ${named(clash)}`;
  const missing = listOf(trait?.requiresQualities).find(id => !present.has(id));
  if (missing) return `needs ${named(missing)}`;
  return "";
}

/**
 * A built Item's Qualities as entries of `{id, slots}` - a Quality and how many Slots it was
 * given, where it takes a range. An entry written before Qualities had Slots of their own
 * was only its id.
 */
export function qualityEntries(crafted) {
  return (crafted?.qualities ?? []).map(entry => (typeof entry === "string")
    ? { id: entry, slots: 0, choice: "", on: false, name: "" }
    : { id: String(entry?.id ?? ""), slots: Number(entry?.slots) || 0,
        choice: String(entry?.choice ?? ""), on: entry?.on === true,
        name: String(entry?.name ?? "") })
    .filter(entry => entry.id);
}

/**
 * What a Quality asks to be chosen when it is added - "a Skill of your choice (when creating
 * this piece of Apparel)" - as the keys to choose among. `chooses: skill`, narrowed by
 * `choiceAttribute: personality` to the Skills that use that Score. Empty when it asks nothing.
 */
export function qualityChoices(trait, skills, weathers = {}, { crafted = null, categories = [] } = {}) {
  // Or a list of its own - Focal's `choices: strike=Strike Rolls, dodge=Dodge Rolls`.
  const own = Object.keys(choiceLabelsOf(trait));
  if (own.length) return own;
  // A Weapon's: Flexible's "a different Weapon Category of the same Foundation", Transforming's
  // "a Weapon Category of a different Weapon Type", Variable's "an additional Weapon Size".
  const chooses = String(trait?.chooses ?? "").trim();
  if (chooses === "sameTypeCategory") {
    return categories.filter(each => (each.weaponType === crafted?.weaponType)
      && (each.id !== crafted?.category)).map(each => each.id);
  }
  if (chooses === "otherTypeCategory") {
    return categories.filter(each => each.weaponType && (each.weaponType !== crafted?.weaponType))
      .map(each => each.id);
  }
  if (chooses === "weaponSize") {
    return Object.keys(WEAPON_SIZES).filter(key => key !== crafted?.weaponSize);
  }
  // Or a type of Battle Weather - Weather Resistant's - among the ones there are.
  if (String(trait?.chooses ?? "").trim().toLowerCase() === "weather") return Object.keys(weathers);
  if (String(trait?.chooses ?? "").trim().toLowerCase() !== "skill") return [];
  const attribute = String(trait?.choiceAttribute ?? "").trim().toLowerCase();
  return Object.entries(skills ?? {})
    .filter(([, skill]) => !attribute || (skill.attribute === attribute))
    .map(([key]) => key);
}

/** A Quality's own list of choices, `key=Label` each, as `{key: label}`. */
function choiceLabelsOf(trait) {
  return Object.fromEntries(String(trait?.choices ?? "").split(",")
    .map(entry => entry.split("=").map(part => part.trim()))
    .filter(([key]) => key)
    .map(([key, label]) => [key.toLowerCase(), label || key]));
}

/** What a choice made for a Quality is called: its own label, or the Skill's name. */
export function qualityChoiceLabel(trait, choice, skills, weathers = {}, getTrait = null) {
  if (!choice) return "";
  // Several, for one that chooses one for each Slot - Flexible's Categories, Variable's Sizes.
  if (String(choice).includes(",")) {
    return String(choice).split(",").map(each => qualityChoiceLabel(trait, each.trim(), skills,
      weathers, getTrait)).filter(Boolean).join(", ");
  }
  return choiceLabelsOf(trait)[choice] ?? weathers?.[choice]?.label ?? skills?.[choice]?.label
    ?? WEAPON_SIZES[choice]?.label ?? getTrait?.(choice)?.name ?? choice;
}

/** What was chosen for a Quality, one for each Slot: `slashing,piercing`. */
export function choicesOf(entry) {
  return String(entry?.choice ?? "").split(",").map(each => each.trim()).filter(Boolean);
}

/**
 * How many Weather Tiers lower a Battle Weather is for whoever wears these - Weather
 * Resistant's "Treat the Weather Tier as if it was x Weather Tiers lower, where x is equal to
 * the number of Quality Slots occupied by this Apparel Quality", for the Weather chosen for
 * it. Only while the wearer has the 2+ Ranks in Survival its Prerequisite asks, told here
 * because this is read before any script runs.
 */
export function weatherResisted(items, weatherId, getTrait, data = null) {
  if (!weatherId) return 0;
  let tiers = 0;
  const top = topLayerPiece(items);
  for (const { item } of apparelQualitiesInEffect(items)) {
    tiers += applySlot(pieceSlots(item.system.crafted, { getTrait, data, category: item === top }),
      `piece.resistsWeather.${weatherId}`, 0);
  }
  return tiers;
}

/**
 * The Combat Roll a worn Apparel's Quality narrows it to - Focal's "The chosen Combat Roll is
 * the only Combat Roll reduced by the effects of the Weight Apparel Category, but only that
 * Combat Roll benefits from this piece of Apparel's Doff Bonus." `narrowsCategory: true` on
 * the Quality, its choice the Roll. "" when nothing narrows it: every Combat Roll.
 *
 * Read by the Weights Category's part, through its tokens, and by the Doff Bonus.
 */
export function narrowedRoll(item, getTrait) {
  const piece = pieceSlots(item?.system?.crafted, { getTrait });
  const found = Object.keys(piece).find(key => key.startsWith("piece.narrows.") && (piece[key] === true));
  return found ? found.slice("piece.narrows.".length) : "";
}

/**
 * Whether the Weights Category's reduction to the Combat Rolls is left off this piece for its
 * wearer - Training Support's "If you possess any stacks of Holding Back while wearing this
 * Apparel, you may ignore the reduction". Its wearer's own Prerequisite, 2+ Ranks in
 * Concealment, asked in its script - with the Ranks counted early, since this is asked while
 * the effects are gathered. Read by the Weights Category's part, as `$waived`.
 */
export function weightsPenaltyWaived(item, wearer, getTrait) {
  // The Ranks as counted before the Skills are worked out, where they have been: this is asked
  // while the effects are gathered, which is before.
  const piece = pieceSlots(item?.system?.crafted, { getTrait,
    data: wearer?.system?.early ?? wearer?.system ?? null });
  if (piece["piece.waivesWeightsWhileHoldingBack"] !== true) return false;
  return holdingBackStacks(wearer) > 0;
}

/**
 * The Size Category a piece is: the one it was made for - "Each piece of Apparel is created
 * with a specific Size Category in mind" - or, where Stretching says so, "the current Size
 * Category of this piece of Apparel's wearer". Read by equipPlan() and outgrown().
 */
export function apparelSize(item, wearer, getTrait) {
  const crafted = item?.system?.crafted;
  const stretches = pieceSlots(crafted, { getTrait })["piece.sizeIsWearers"] === true;
  if (stretches && wearer?.system?.size?.key) return wearer.system.size.key;
  return crafted?.size ?? "";
}

/**
 * The worn pieces whose spikes answer a blow, and what each takes: Spiked's "When you are
 * struck by an Unarmed Physical Attack ... reduce their Life Points by the Apparel Bonus for
 * this piece of Armor". Its own piece's Bonus, at the wearer's base Tier.
 */
export function spikesOf(items, getTrait, baseTier = 1) {
  const found = [];
  const top = topLayerPiece(items);
  for (const { item } of apparelQualitiesInEffect(items)) {
    const reading = craftedReading(item.system.crafted, { getTrait, difficulties: {}, baseTier,
      category: item === top });
    if (!reading?.spikes) continue;
    found.push({ item, amount: reading.bonus ?? 0 });
  }
  return found;
}

/**
 * How many Combat Rounds longer a piece's first Doff Bonus of an Encounter lasts - Segmented
 * Weight's "for each Quality Slot this Quality occupies ... by 1 Combat Round". Read by the
 * Doff Bonus.
 */
export function doffRounds(item, getTrait) {
  return applySlot(pieceSlots(item?.system?.crafted, { getTrait }), "piece.doffRounds", 0);
}

/**
 * A Quality's script with what was chosen for it written in: `skill.$choice += 2;` becomes
 * `skill.persuasion += 2;`. Nothing is written for a Quality that asks nothing, and a script
 * still naming `$choice` has had nothing chosen and is not run.
 */
export function scriptWithChoice(script, choice) {
  const text = String(script ?? "");
  if (!text.includes("$choice")) return text;
  return choice ? text.replaceAll("$choice", choice) : "";
}

/**
 * A Quality's script with its own piece's numbers written in: `$apparelBonus` is that piece's
 * Apparel Bonus per base Tier, so `ceil($apparelBonus(bT) / 2)` is "1/2 (rounded up) of the
 * Apparel Bonus" - Parrying Armor's. Per base Tier because a script reads (bT) itself, and the
 * base Tier is not known yet when the scripts are gathered.
 */
export function scriptWithPiece(script, reading, tokens = {}) {
  let text = String(script ?? "").replaceAll("$apparelBonus", String(Number(reading?.perBaseTier) || 0));
  // The rest of what a piece's Effects may name about the piece, longest first so none is read
  // as the start of another - and each at its default where nobody said: nothing narrowed,
  // nothing waived, nothing multiplied.
  const all = { ...PIECE_TOKENS, ...WEAPON_TOKENS, ...tokens };
  for (const name of Object.keys(all).sort((a, b) => b.length - a.length)) {
    text = text.replaceAll(`$${name}`, String(Number(all[name]) || 0));
  }
  return text;
}

/**
 * What a piece's Effects may name about the piece, beside `$apparelBonus`, at what each is when
 * nothing says otherwise. Read by its Category's part:
 *
 *   $armorFactor     what its Qualities multiply the Armor's Damage Reduction by - Sleek Design's 1/2
 *   $reachesStrike   1 when its Category reaches Strike Rolls - all three, unless a Quality narrows
 *   $reachesDodge    it to one: Focal's chosen Roll
 *   $reachesWound
 *   $waived          1 while its Weights take nothing off - Training Support, Holding Back
 */
export const PIECE_TOKENS = Object.freeze({
  armorFactor: 1,
  reachesStrike: 1,
  reachesDodge: 1,
  reachesWound: 1,
  waived: 0
});

/** What a worn piece's tokens come to, for the one wearing it. */
export function pieceTokens(item, wearer, reading, getTrait) {
  const narrowed = narrowedRoll(item, getTrait);
  const reaches = roll => ((!narrowed || (narrowed === roll)) ? 1 : 0);
  return {
    armorFactor: reading?.armorDamageReduction ?? 1,
    reachesStrike: reaches("strike"),
    reachesDodge: reaches("dodge"),
    reachesWound: reaches("wound"),
    waived: (wearer && weightsPenaltyWaived(item, wearer, getTrait)) ? 1 : 0
  };
}

/**
 * The Apparel Penalty: "For each piece of Apparel you are wearing after the first, reduce your
 * Combat Rolls by 1/2 of your base Tier of Power (rounded up)." Counted over the pieces that
 * count towards it - one that does not, Lightweight's or Standard Clothing's on top, is not
 * there at all for it, by the table's ruling - and the first of those is free.
 */
export function apparelPenaltyPieces(items, getTrait) {
  const top = topLayerPiece(items);
  const counted = apparelQualitiesInEffect(items).filter(({ item }) =>
    craftedReading(item.system.crafted, { getTrait, difficulties: {}, category: item === top })
      ?.countsForPenalty !== false);
  return Math.max(0, counted.length - 1);
}

// --- A built Item's own Effects ----------------------------------------------------------------
//
// A built Item's pseudo-code is its own: `system.crafted.effects`. Its Category and each of its
// Qualities write their part into it when they are chosen - between markers, so the part can be
// found again to take out - and from then on the Item answers to what is written there and
// nothing else. Nothing reads a Quality's file to know what a piece does. Whatever its owner
// writes, in a part or outside every part, is as much the piece's as what was written for them:
// that is what makes homebrew possible.
//
//   #@ category standard-clothing | Standard Clothing
//   [passive]
//   piece.countsForPenalty = false;
//   #@ end
//
// A marker is a comment to the language, so the whole text compiles as it stands.

/** A part's opening marker: `#@ quality combat-ready nostack | Combat Ready`. */
const PART_OPEN = /^#@\s+(category|quality)\s+(\S+)((?:\s+[a-z]+)*)\s*(?:\|\s*(.*?))?\s*$/;
const PART_CLOSE = /^#@\s+end\s*$/;
/** How a switched-off Quality's lines are kept: still there, and read as comments. */
const OFF = "#off ";

/**
 * A built Item's Effects, as parts and the text between them.
 *
 * @returns {Array<{text: string} | {type: string, id: string, key: string, flags: string[],
 *   name: string, body: string}>}
 */
export function effectParts(script) {
  const out = [];
  let text = [];
  let open = null;
  const seen = {};
  const flushText = () => {
    const joined = trimBlank(text.join("\n"));
    if (joined) out.push({ text: joined });
    text = [];
  };
  for (const line of String(script ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const opens = line.trim().match(PART_OPEN);
    if (!open && opens) {
      flushText();
      const [, type, id, flags, name] = opens;
      const base = `${type}:${id}`;
      seen[base] = (seen[base] ?? 0) + 1;
      open = { type, id, key: (seen[base] > 1) ? `${base}:${seen[base]}` : base,
        flags: flags.trim().split(/\s+/).filter(Boolean), name: name ?? "", lines: [] };
      continue;
    }
    if (open && PART_CLOSE.test(line.trim())) {
      out.push({ type: open.type, id: open.id, key: open.key, flags: open.flags, name: open.name,
        body: trimBlank(open.lines.join("\n")) });
      open = null;
      continue;
    }
    (open ? open.lines : text).push(line);
  }
  // A part never closed runs to the end, rather than being lost.
  if (open) {
    out.push({ type: open.type, id: open.id, key: open.key, flags: open.flags, name: open.name,
      body: trimBlank(open.lines.join("\n")) });
  }
  else flushText();
  return out;
}

/** Leading and trailing blank lines off, and never more than one blank line in a row. */
function trimBlank(text) {
  return String(text ?? "").replace(/\n{3,}/g, "\n\n").replace(/^\s*\n/, "").replace(/\s+$/, "");
}

/**
 * What a Category or Quality writes into a piece: its script's code, with its own notes left in
 * its file, and what was chosen for it written in - `skill.$choice` as `skill.persuasion`, and
 * `$slots` as the Quality Slots it was given. A script naming `$choice` with nothing chosen
 * writes nothing.
 */
function partBody(trait, entry = null) {
  let code = String(trait?.script ?? "").replace(/\r\n?/g, "\n").split("\n")
    .filter(line => !/^\s*(#|\/\/)/.test(line)).join("\n");
  if (entry) {
    code = scriptWithChoice(code, entry.choice);
    code = code.replaceAll("$slots", String(slotsTaken(entry, trait)));
  }
  return trimBlank(code);
}

/**
 * What a Category writes: its own code, and the code of each Quality it possesses - "This Weapon
 * also possesses the Staggering Weapon Quality (this Weapon Quality does not count towards your
 * Quality Slots)", `possesses: staggering`. Inside the Category's part, so it comes and goes
 * with the Category and takes no Slot, and each under a line naming it.
 */
function categoryBody(category, getTrait) {
  const own = partBody(category);
  const possessed = listOf(category?.possesses).map(id => getTrait?.(id)).filter(Boolean)
    .map(trait => [`# ${trait.name}, possessed with the Category`, partBody(trait, { slots: 0 })]
      .filter(Boolean).join("\n"));
  return trimBlank([own, ...possessed].filter(Boolean).join("\n\n"));
}

/**
 * A switched-off part's lines kept as comments, or a switched-on part's given back.
 *
 * Or, where some of its lines end `# until switched on`, those lines alone, the other way
 * round: kept while the switch is off, and commented out once it is on - Super Heavy's Strike
 * Rolls, until its wielder is accustomed to the weight.
 */
function switched(body, on) {
  const lines = String(body ?? "").split("\n");
  const plain = line => line.startsWith(OFF) ? line.slice(OFF.length) : line;
  if (lines.some(line => line.includes(UNTIL_ON))) {
    return lines.map(line => (!line.includes(UNTIL_ON) ? line
      : (on ? `${OFF}${plain(line)}` : plain(line)))).join("\n");
  }
  if (on) return lines.map(plain).join("\n");
  return lines.map(line => (!line.trim() || line.startsWith(OFF)) ? line : `${OFF}${line}`).join("\n");
}

/** The end of a line a Quality's switch turns off, rather than on. */
const UNTIL_ON = "# until switched on";

/** A part as it is written. */
function partText(part) {
  const flags = part.flags.length ? ` ${part.flags.join(" ")}` : "";
  const name = part.name ? ` | ${part.name}` : "";
  return [`#@ ${part.type} ${part.id}${flags}${name}`, part.body, "#@ end"]
    .filter(line => line !== "").join("\n");
}

/**
 * Write a built Item's Category and Qualities into its Effects.
 *
 * Its Category's part and a part for each Quality that applies - one its Category takes, and
 * whose other Qualities do not hold it off. A part already there keeps what is written in it,
 * whoever wrote it; a part no longer wanted is taken out; a new one is written from its file.
 * Text outside every part is its owner's and is left where it is. A Quality with a switch -
 * Team Outfit - has its lines kept as comments while switched off.
 *
 * @param {object} crafted   the Item's `system.crafted`, as it is to be
 * @param {?string} previous what its Effects say now; null or "" for none
 * @param {{getTrait: function}} with
 */
export function composeEffects(crafted, previous, { getTrait } = {}) {
  const kind = CRAFTED[crafted?.kind];
  if (!kind) return String(previous ?? "");
  const existing = effectParts(previous);
  const had = new Map(existing.filter(part => part.key).map(part => [part.key, part]));

  // What should be there, in order: the Category, then the Qualities that apply.
  const wanted = [];
  const category = getTrait?.(crafted.category);
  if (category && categoryFitsPiece(category, crafted)) {
    wanted.push({ type: "category", id: category.id, key: `category:${category.id}`,
      flags: [], name: category.name, fresh: () => categoryBody(category, getTrait) });
  }
  // The other Categories a Weapon may be used as - Flexible's, Transforming's - each written as
  // a Category part of its own, marked `alternate`: only the one in use runs.
  for (const entry of qualityEntries(crafted)) {
    const trait = getTrait?.(entry.id);
    if ((trait?.alternates !== true) || qualityInactive(entry, crafted, getTrait)) continue;
    for (const id of choicesOf(entry)) {
      const other = getTrait?.(id);
      if (!other || wanted.some(part => part.key === `category:${other.id}`)) continue;
      wanted.push({ type: "category", id: other.id, key: `category:${other.id}`,
        flags: ["alternate"], name: other.name, fresh: () => categoryBody(other, getTrait) });
    }
  }
  const counted = {};
  for (const entry of qualityEntries(crafted)) {
    const trait = getTrait?.(entry.id);
    if (!trait || qualityInactive(entry, crafted, getTrait)) continue;
    const base = `quality:${trait.id}`;
    counted[base] = (counted[base] ?? 0) + 1;
    wanted.push({ type: "quality", id: trait.id,
      key: (counted[base] > 1) ? `${base}:${counted[base]}` : base,
      flags: (trait.noStack === true) ? ["nostack"] : [],
      name: qualityName(entry, trait), toggle: Boolean(trait.toggle), on: entry.on,
      fresh: () => partBody(trait, entry) });
  }
  const wantedKeys = new Set(wanted.map(part => part.key));

  const written = part => {
    const kept = had.get(part.key);
    let body = kept ? kept.body : part.fresh();
    if (part.toggle) body = switched(body, part.on);
    return { type: part.type, id: part.id, key: part.key, flags: part.flags, name: part.name, body };
  };

  // What is there, kept in its place where it is still wanted; the owner's own text always.
  const out = [];
  for (const part of existing) {
    if (!part.key) out.push(part);
    else if (wantedKeys.has(part.key)) out.push(written(wanted.find(want => want.key === part.key)));
  }
  // What is new: a Category at the top, the Qualities after the last part there is.
  for (const part of wanted) {
    if (had.has(part.key)) continue;
    if ((part.type === "category") && !part.flags.includes("alternate")) {
      out.unshift(written(part));
      continue;
    }
    let last = -1;
    out.forEach((each, index) => { if (each.key) last = index; });
    out.splice((last >= 0) ? last + 1 : out.length, 0, written(part));
  }
  return out.map(part => (part.key ? partText(part) : part.text)).join("\n\n");
}

/**
 * What a Quality is called on this piece: the name its owner gave it, where it takes one -
 * Dynamic, `renameable: true` - and its own otherwise.
 */
export function qualityName(entry, trait) {
  return ((trait?.renameable === true) && String(entry?.name ?? "").trim())
    || trait?.name || entry?.id || "";
}

/**
 * The Apparel Layers, top down: "Apparels have layers, allowing you to wear up to three pieces
 * of Apparel at once. The Top Layer, Middle Layer, and Bottom Layer in descending order." One
 * piece to a Layer.
 */
export const APPAREL_LAYERS = Object.freeze({
  top: { label: "Top" },
  middle: { label: "Middle" },
  bottom: { label: "Bottom" }
});

/**
 * What an Item comes to thrown with the Throw Maneuver: "If it was a Weapon, the Hardness Rank
 * is 2. If it was a Basic Item, the Hardness Rank is 1." Apparel is neither and is read as a
 * Basic Item - unless its own Effects set its Hardness Value outright, Hefty Plating's 4, which
 * is then the Collision Damage whatever the Rank. What else an Item does thrown is its own: a
 * piece saying `piece.thrownMightClash` opens a Might Clash on a hit (the thrower's the `if`
 * reads - Hefty Plating's Force 6+), and the Grenade brings a Minor Sphere and its recorded
 * Scholarship Modifier, and is gone once thrown.
 */
export function thrownAs(item, thrower, getTrait) {
  const system = item?.system ?? {};
  const thrown = { itemId: item?.id ?? "", name: item?.name ?? "", rank: 1, value: null,
    mightClash: false };
  if (system.itemType === "weapon") thrown.rank = 2;
  // A Weapon: its own Hardness Rank where its Effects set one - Super Heavy's 4 - and what it
  // does thrown: Throwing Weapon's Category and Qualities on a hit, Barrage's Combination
  // Profile, Boomerang's return, Multi-Storage's copies.
  if (system.crafted?.kind === "weapon") {
    const slots = weaponSlots(system.crafted, { getTrait, data: thrower?.system ?? null });
    thrown.rank = applySlot(slots, "weapon.hardnessRank", CRAFTED.weapon.hardnessRank);
    thrown.wielded = Boolean(system.equipped);
    thrown.throwing = slots["weapon.throwing"] === true;
    thrown.barrage = slots["weapon.barrage"] === true;
    thrown.returns = applySlot(slots, "weapon.returns", 0);
    thrown.copies = slots["weapon.copies"] === true;
    return thrown;
  }
  if (system.crafted?.kind) {
    const piece = pieceSlots(system.crafted, { getTrait, data: thrower?.system ?? null });
    if (piece["piece.hardnessValue"]) thrown.value = applySlot(piece, "piece.hardnessValue", 0);
    thrown.mightClash = piece["piece.thrownMightClash"] === true;
  }
  // "That Attacking Maneuver has a Minor Sphere AoE (centered on the initial target of this
  // Maneuver) and the Damage Attribute for that Attacking Maneuver is the Recorded Ingenuity" - and,
  // Consumable, "destroyed once it is used".
  if (system.gearId === "grenade") {
    thrown.destroyed = isConsumable(item, getTrait);
    thrown.area = { shape: "sphere", magnitude: "minor", centredOnTarget: true };
    thrown.damageAttribute = system.records
      ? { label: `${item.name}, ${recordedLabel(system.records)}`, value: system.recorded ?? 0 }
      : null;
  }
  return thrown;
}

/**
 * How many times a Combat Round the Throw Maneuver may be used to throw this: once, "the usual
 * 1/Round limitation", or three times for a Multi-Storage Weapon - three Throws in all, by the
 * table's ruling, whatever else was thrown among them.
 */
export function throwsAllowed(thrown) {
  return thrown?.copies ? MULTI_STORAGE_THROWS : 1;
}

/** "You may use the Throw Maneuver to throw this Weapon up to 3 times per Combat Round." */
export const MULTI_STORAGE_THROWS = 3;

/** Whether any of these is a Multi-Storage Weapon to throw. */
export function throwsCopies(items, getTrait) {
  return throwables(items).some(item => (item.system?.crafted?.kind === "weapon")
    && (weaponSlots(item.system.crafted, { getTrait })["weapon.copies"] === true));
}

/**
 * What an attack made by throwing a Throwing Weapon carries: "If this Weapon hits an Opponent
 * with the use of the Throw Maneuver, apply the effects of its Weapon Category and any
 * qualifying Weapon Qualities." Only if it hits, by the table's ruling: nothing of it on the
 * Strike - no Size, no Weapon Penalty, nothing its Effects add there - and the Size nowhere.
 * What comes after the hit is its own: the Wound, what it ignores, Staggering and the rest.
 */
export function thrownWeaponAttack(armed) {
  if (!armed) return null;
  const size = `${WEAPON_SIZES[armed.weaponSize]?.label ?? ""} Weapon`;
  return { ...armed, thrown: true, strike: [], strikeNatural: 0, kiCost: 0, energyCharges: 0,
    meleeRange: 0, wound: (armed.wound ?? []).filter(part => part.label !== size) };
}

/**
 * What a character has to throw: "whatever you are holding". An Item they are not wearing -
 * Apparel on a Layer and an Accessory worn are not in hand - and none in a Capsule.
 */
export function throwables(items) {
  // A Weapon wielded is in hand: that one most of all.
  return (items ?? []).filter(item => (item.type === "gear")
    && (!item.system?.equipped || (item.system?.crafted?.kind === "weapon"))
    && !isStored(items, item));
}

/**
 * The worn piece of Apparel that is the Top Layer: the one on the Top Layer, or - with nothing
 * there - the Middle, or the Bottom. Its Category is the only one that applies: "each one with
 * their own benefits that you gain while wearing that piece of Apparel as the Top Layer", and
 * by the table's ruling the highest Layer worn acts as the Top. A piece worn before there were
 * Layers is under all three. Null when nothing is worn.
 */
export function topLayerPiece(items) {
  const order = Object.keys(APPAREL_LAYERS);
  const rank = item => {
    const at = order.indexOf(item.system?.layer ?? "");
    return (at < 0) ? order.length : at;
  };
  return apparelQualitiesInEffect(items).map(({ item }) => item)
    .sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/**
 * The Doff Bonus a piece gives, taken off: "a boost to your Combat Rolls equal to the Apparel
 * Bonus for that piece of Apparel". Its Apparel Bonus at the wearer's base Tier; for Weights
 * taken off "after the 3rd Combat Round of a Combat Encounter", half as much again, rounded up;
 * on each Combat Roll, or on the one Focal chose alone - "only that Combat Roll benefits from
 * this piece of Apparel's Doff Bonus". And the Combat Rounds Segmented Weight adds to how long.
 */
export function doffBonusFor(item, wearer, { round = 0, getTrait } = {}) {
  const reading = craftedReading(item?.system?.crafted, { getTrait, difficulties: {},
    baseTier: wearer?.system?.baseTierOfPower ?? 1 });
  let amount = reading?.bonus ?? 0;
  if ((item.system.crafted.category === "weights") && (Number(round) > 3)) {
    amount += Math.ceil(amount / 2);
  }
  const narrowed = narrowedRoll(item, getTrait);
  const on = roll => ((!narrowed || (narrowed === roll)) ? amount : 0);
  return { amount, strike: on("strike"), dodge: on("dodge"), wound: on("wound"),
    rounds: doffRounds(item, getTrait) };
}

/** A piece's once-an-Encounter Doff Bonus, among the uses the Encounter clears. */
export function doffKey(item) {
  return `encounter:doff.${item.id}`;
}

/**
 * Give the Doff Bonus for a piece just taken off, where it is owed: in a Combat Encounter, the
 * first time this piece is taken off in it, and larger than one already held - "only apply the
 * largest Doff Bonus". The amount goes on the character, and the mark with its clock.
 *
 * @returns {Promise<string>} what the table is told, or "" for nothing given.
 */
export async function grantDoffBonus(actor, item, getTrait) {
  if (!game.combat?.started || !item?.system?.crafted?.kind) return "";
  const used = actor.system.usedManeuvers ?? [];
  if (used.includes(doffKey(item))) {
    return `${item.name} has given its Doff Bonus this Combat Encounter.`;
  }
  const bonus = doffBonusFor(item, actor, { round: game.combat.round ?? 0, getTrait });
  if (!(bonus.amount > 0)) return "";
  const held = (Number(actor.system.conditions?.["doff-bonus"]) || 0) > 0;
  if (held && (bonus.amount <= (Number(actor.system.doffBonus?.amount) || 0))) {
    return `${item.name}'s Doff Bonus is not larger than the one held: not gained.`;
  }

  const { setCondition } = await import("./conditions.mjs");
  const { lasting, clockOff, EDGES, KINDS } = await import("./durations.mjs");
  await writeActor(actor, {
    "system.usedManeuvers": [...used, doffKey(item)],
    "system.doffBonus": { amount: bonus.amount, strike: bonus.strike, dodge: bonus.dodge,
      wound: bonus.wound, source: item.name }
  });
  // A larger one takes the place of the one held, clock and all.
  if (held) await clockOff(actor, KINDS.CONDITION, ["doff-bonus"]);
  await setCondition(actor, "doff-bonus", 1);
  await lasting(actor, { kind: KINDS.CONDITION, key: "doff-bonus", edge: EDGES.END, next: true,
    source: `Doff Bonus (${item.name})`, extra: bonus.rounds });
  const rolls = (bonus.strike && bonus.dodge) ? "Combat Rolls"
    : bonus.strike ? "Strike Rolls" : "Dodge Rolls";
  return `Doff Bonus: ${rolls} +${bonus.amount} until the end of their next turn`
    + `${bonus.rounds ? `, and ${bonus.rounds} Combat Round${bonus.rounds === 1 ? "" : "s"} more` : ""}.`;
}

/** Write to a character this client may not own, relayed through the GM where it does not. */
async function writeActor(actor, changes) {
  if (actor.isOwner === false) {
    const { requestActorUpdate } = await import("./chat.mjs");
    return requestActorUpdate(actor, changes);
  }
  return actor.update(changes);
}

/**
 * Lower the Break Value of what a character wears, by 1: "Apparel loses 1 Break Value if you are
 * knocked through a Health Threshold", and a Called Shot at it. "If your Break Value would be
 * lowered by any rule or effect, it only applies to the Top Layer" - the Top, or whichever Layer
 * worn is highest. Not a piece that cannot have it reduced (Unbreakable); not, the first time in
 * a Combat Encounter it would be lowered from its most, one with Joint Protection.
 *
 * Brought to 0 it breaks - "that piece of Apparel no longer fully functions" - and is taken off,
 * by the table's ruling that a broken piece is as good as not there. Weights broken count "as if
 * you removed them for the Doff Bonus".
 *
 * @returns {Promise<string>} what the table is told, or "" when nothing is worn.
 */
export async function breakApparel(actor, getTrait, { amount = 1 } = {}) {
  const top = topLayerPiece(Array.from(actor?.items ?? []));
  if (!top) return "";
  const reading = craftedReading(top.system.crafted, { getTrait, difficulties: {} });
  if (reading.unbreakable) return `${top.name} cannot have its Break Value reduced.`;

  const lost = Number(top.system.crafted.breakLost) || 0;
  const used = actor.system.usedManeuvers ?? [];
  const spareKey = `encounter:spare.${top.id}`;
  if (game.combat?.started && reading.sparesFirstBreak && (lost === 0) && !used.includes(spareKey)) {
    await writeActor(actor, { "system.usedManeuvers": [...used, spareKey] });
    return `${top.name} keeps its Break Value: Joint Protection.`;
  }

  // Breaker's "double the loss of Break Value": 2, never more than there is.
  const loss = Math.min(Math.max(1, Number(amount) || 1), reading.breakLeft);
  const left = Math.max(0, reading.breakLeft - loss);
  await writeActor(actor, { items: [{ _id: top.id, "system.crafted.breakLost": lost + loss,
    ...(left ? {} : { "system.equipped": false, "system.layer": "" }) }] });
  if (left) return `${top.name} loses ${loss} Break Value: ${left}/${reading.breakValue}.`;
  let said = `${top.name} breaks, and is taken off.`;
  if (top.system.crafted.category === "weights") {
    const doff = await grantDoffBonus(actor, top, getTrait);
    if (doff) said += ` ${doff}`;
  }
  return said;
}

/**
 * The worn pieces their wearer has grown out of: "If, while wearing a piece of Apparel, your Size
 * Category would increase to be 2+ Size Categories larger than the Size Category for that piece
 * of Apparel, that piece of Apparel is destroyed." A stretching piece is always its wearer's
 * Size, so never. `sizes` is the Size Categories in order, smallest first.
 */
export function outgrown(items, wearer, sizes, getTrait) {
  const now = sizes.indexOf(wearer?.system?.size?.key ?? "");
  if (now < 0) return [];
  return apparelQualitiesInEffect(items).map(({ item }) => item).filter(item => {
    const made = sizes.indexOf(apparelSize(item, wearer, getTrait));
    return (made >= 0) && ((now - made) >= 2);
  });
}

/**
 * Destroy what a character has grown out of: taken off, and marked destroyed - kept on the sheet,
 * by the table's ruling, for the player to take off it if they like. Said at the table.
 */
export async function destroyOutgrown(actor, sizes, getTrait) {
  const gone = outgrown(Array.from(actor?.items ?? []), actor, sizes, getTrait);
  if (!gone.length) return [];
  await actor.updateEmbeddedDocuments("Item", gone.map(item => ({ _id: item.id,
    "system.crafted.destroyed": true, "system.equipped": false, "system.layer": "" })));
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p>${Handlebars.escapeExpression(actor.name)} grows out of `
      + `${gone.map(item => Handlebars.escapeExpression(item.name)).join(" and ")}: destroyed.</p>`
  });
  return gone;
}

/** What it costs to put a piece of Apparel on during a Combat Encounter: "2 Actions". */
export const APPAREL_EQUIP_COST = 2;

/**
 * Where putting this piece on this Layer leaves every piece worn, or why it cannot go.
 *
 * - "Each piece of Apparel is created with a specific Size Category in mind. They can only be
 *   equipped by Characters of that Size Category" - its wearer's, where Stretching says so.
 * - "During a Combat Encounter, putting on a piece of Apparel ... you must equip it on the Top
 *   Layer (move each other piece of Apparel down a Layer)" - as far down as it has to, and not
 *   at all with no Layer left under the Bottom.
 * - "Armor must be the Top Layer of your Apparel and you cannot equip any piece of Apparel while
 *   wearing Armor" - but a piece that may be worn over it, the Jacket, which goes on top of it.
 * - Outside one, the Layer is the player's, and one taken is closed - but Armor, which goes on
 *   top whatever is there.
 *
 * @returns {{moves: Array<{id: string, layer: string}>, problem: string}}
 */
export function equipPlan(items, item, layer, { inCombat = false, wearer = null, getTrait } = {}) {
  const refuse = problem => ({ moves: [], problem });
  const crafted = item?.system?.crafted;
  if (!crafted?.kind || !APPAREL_LAYERS[layer]) return refuse("That is not a Layer.");
  if (item.system?.equipped) return refuse(`${item.name} is already worn.`);
  // Broken is as good as not there, by the table's ruling - until it is repaired.
  if (crafted.destroyed) return refuse("Destroyed.");
  const left = craftedReading(crafted, { getTrait, difficulties: {} })?.breakLeft;
  if (left === 0) return refuse("Broken: repair it first.");

  // Made for one Size - or its wearer's, stretching.
  const size = wearer?.system?.size?.key;
  const made = apparelSize(item, wearer, getTrait);
  if (size && made && (made !== size)) {
    return refuse(`Made for a ${sizeLabel(made)} Character.`);
  }

  const worn = apparelQualitiesInEffect(items).map(({ item: piece }) => piece)
    .filter(piece => piece.id !== item.id);
  const isArmor = piece => piece.system?.crafted?.category === "armor";
  const overArmor = pieceSlots(crafted, { getTrait })["piece.wornOverArmor"] === true;
  const armorWorn = worn.find(isArmor);

  if (inCombat && (layer !== "top")) return refuse("In a Combat Encounter it goes on the Top Layer.");
  if (isArmor(item) && (layer !== "top")) return refuse("Armor must be the Top Layer.");
  if (armorWorn && !overArmor) return refuse(`Nothing goes on while wearing ${armorWorn.name}.`);
  if (armorWorn && overArmor && (layer !== "top")) return refuse("It goes on over the Armor.");

  const order = Object.keys(APPAREL_LAYERS);
  const on = key => worn.find(piece => piece.system?.layer === key) ?? null;
  const moves = [{ id: item.id, layer }];
  if (!on(layer)) return { moves, problem: "" };

  // Taken: pushed down only where the rules put it on top regardless.
  const pushes = (layer === "top") && (inCombat || isArmor(item) || (armorWorn && overArmor));
  if (!pushes) return refuse(`${on(layer).name} is on it.`);
  for (let at = order.indexOf(layer); on(order[at]); at++) {
    const below = order[at + 1];
    if (!below) return refuse("No Layer is left under the Bottom.");
    moves.push({ id: on(order[at]).id, layer: below });
  }
  return { moves, problem: "" };
}

/**
 * What taking this piece off costs in a Combat Encounter: "1 Action. If you would attempt to
 * remove a piece of Apparel that is not your current Top Layer of Apparel, increase the number
 * of Actions required to remove that piece of Apparel by 1 for each higher layer of Apparel."
 * Each higher Layer with a piece on it.
 */
export function unequipCost(items, item) {
  const order = Object.keys(APPAREL_LAYERS);
  const rank = piece => {
    const at = order.indexOf(piece.system?.layer ?? "");
    return (at < 0) ? order.length : at;
  };
  const above = apparelQualitiesInEffect(items).map(({ item: piece }) => piece)
    .filter(piece => (piece.id !== item.id) && (rank(piece) < rank(item))).length;
  return 1 + above;
}

/** A Size's name, for the sentence. */
function sizeLabel(key) {
  return String(key).charAt(0).toUpperCase() + String(key).slice(1);
}

/**
 * The piece of Apparel on one Layer among these Items, other than `except`, or null - what
 * keeps a second piece off it.
 */
export function onLayer(items, layer, except = null) {
  return (items ?? []).find(item => (item.type === "gear") && item.system?.crafted?.kind
    && item.system?.equipped && (item.system?.layer === layer) && (item.id !== except?.id)) ?? null;
}

/**
 * A built Item's Effects: what is written on it, or - for one written before Items had
 * Effects of their own - what its Category and Qualities would write.
 */
export function effectsOf(crafted, getTrait) {
  if (typeof crafted?.effects === "string") return crafted.effects;
  return composeEffects(crafted, "", { getTrait });
}

/** Compiled Effects, by their text: a piece is read far more often than it is changed. */
const pieceCache = new Map();

/**
 * What a built Item's Effects say about the piece itself - its `piece.*` Slots, resolved.
 *
 * `data` is its wearer's, for a Prerequisite asked in an `if` - Weather Resistant's Survival -
 * and nobody's where there is no wearer, which leaves such a line unmet. `category: false`
 * leaves its Category's part out, for a piece worn under the Top Layer.
 */
export function pieceSlots(crafted, options = {}) {
  return craftedSlots(crafted, PHASES.PIECE, options);
}

/**
 * A built Item's Effects resolved at one phase - the piece's own Slots, or a Weapon's for an
 * attack - with its tokens written in: `tokens` over the defaults.
 */
function craftedSlots(crafted, phase, { getTrait, data = null, perBaseTier = null,
  category = true, tokens = {}, form = null } = {}) {
  if (!CRAFTED[crafted?.kind]) return {};
  const band = CRAFTED[crafted.kind].bonus?.[CRAFTED[crafted.kind].grades[crafted.grade]?.grade];
  const written = (crafted.kind === "weapon")
    ? formScript(effectsOf(crafted, getTrait), form ?? activeForm(crafted), getTrait)
    : effectsOf(crafted, getTrait);
  const script = scriptWithPiece(category ? written : withoutCategory(written),
    { perBaseTier: perBaseTier ?? band?.perBaseTier ?? 0 }, tokens);
  if (!script.trim()) return {};
  let program = pieceCache.get(script);
  if (program === undefined) {
    const built = compileScript(script);
    program = built.errors?.length ? null : built.program;
    pieceCache.set(script, program);
  }
  if (!program) return {};
  return applyPassives([{ program, priority: PRIORITY.talent, sourceName: "", level: 0, stacks: 1 }],
    phase, { data: data ?? {}, errors: [] }).slots;
}

/**
 * A Weapon's Effects as one of its forms: the Category part in use and no other, and - used as
 * another Weapon Type, Transforming's - "only benefits from other Weapon Qualities that are
 * applicable to that Weapon Type". Its owner's own lines always.
 */
export function formScript(script, form, getTrait) {
  return effectParts(script).filter(part => {
    if (part.type === "category") return part.id === form?.category;
    if ((part.type === "quality") && form?.weaponType) {
      return qualityFitsPiece(getTrait?.(part.id), { kind: "weapon", weaponType: form.weaponType });
    }
    return true;
  }).map(part => (part.key ? partText(part) : part.text)).join("\n\n");
}

/**
 * What a Weapon is being used as right now: its own Category, or the one Flexible switched it to
 * until the end of its wielder's turn; its own Type; its own Size, or the one Variable changed it
 * to.
 */
export function activeForm(crafted) {
  return {
    category: crafted?.activeCategory || crafted?.category || "",
    weaponType: crafted?.weaponType ?? "",
    size: crafted?.activeSize || crafted?.weaponSize || ""
  };
}

/**
 * Every form a Weapon may make an attack as, the one it is in first: Transforming's "You may use
 * this Weapon as if it was a Weapon of that Weapon Category and Weapon Type ... it has the same
 * Weapon Size". Each `{category, weaponType, size}`.
 */
export function weaponForms(item, getTrait) {
  const crafted = item?.system?.crafted;
  if (crafted?.kind !== "weapon") return [];
  const now = activeForm(crafted);
  const forms = [now];
  for (const entry of qualityEntries(crafted)) {
    const trait = getTrait?.(entry.id);
    if ((trait?.chooses !== "otherTypeCategory") || qualityInactive(entry, crafted, getTrait)) continue;
    for (const id of choicesOf(entry)) {
      const other = getTrait?.(id);
      if (other?.weaponType) forms.push({ category: other.id, weaponType: other.weaponType, size: now.size });
    }
  }
  return forms;
}

/**
 * The Categories a Flexible Weapon may be switched to for a turn - its own and the ones chosen -
 * and the Sizes a Variable one may be wielded at: its own and the ones chosen.
 */
export function flexibleCategories(item, getTrait) {
  return alternativesOf(item, getTrait, "sameTypeCategory", item?.system?.crafted?.category);
}
export function variableSizes(item, getTrait) {
  return alternativesOf(item, getTrait, "weaponSize", item?.system?.crafted?.weaponSize);
}
function alternativesOf(item, getTrait, chooses, own) {
  const crafted = item?.system?.crafted;
  if (crafted?.kind !== "weapon") return [];
  const found = qualityEntries(crafted).filter(entry => (getTrait?.(entry.id)?.chooses === chooses)
    && !qualityInactive(entry, crafted, getTrait)).flatMap(choicesOf);
  return found.length ? [own, ...found.filter(each => each !== own)] : [];
}

/** A piece's Effects without its Category's part: what it does worn under the Top Layer. */
export function withoutCategory(script) {
  return effectParts(script).filter(part => part.type !== "category")
    .map(part => (part.key ? partText(part) : part.text)).join("\n\n");
}

/** A multiplier Slot as written - `*= 1/2` - rather than rounded to a whole number. */
function factorOf(contribution) {
  if (!contribution || (typeof contribution !== "object")) return 1;
  const base = (contribution.set !== null && contribution.set !== undefined) ? contribution.set : 1;
  return base * (contribution.multiply ?? 1);
}

/**
 * The worn Apparel whose Qualities apply, each with the Qualities that do: those its Category
 * takes. "Apparel Qualities may apply to only certain Apparel Categories."
 *
 * Worn is `equipped`, as an Accessory is - on a Layer, `layer`; a broken piece is taken off. The
 * wearer's Prerequisites are asked in each Quality's own script.
 */
export function apparelQualitiesInEffect(items) {
  return (items ?? [])
    .filter(item => (item.type === "gear") && (item.system?.crafted?.kind === "apparel")
      && item.system?.equipped && !isStored(items, item))
    .map(item => ({ item, entries: qualityEntries(item.system.crafted) }));
}

// --- Weapons ------------------------------------------------------------------------------------
//
// A Weapon is built as a piece of Apparel is, and its own Effects are what it does. What it does
// to "Attacking Maneuvers made with this Weapon" is written against `weapon.*` Slots and read off
// it when an attack is declared with it (weaponAttack); what it does while merely wielded is
// written against the character's own Slots, and run by the registry for as long as it is.

/**
 * What a Weapon's Effects may name about the attack being made with it, at what each is when
 * nothing says - which is also what its sheet checks them at:
 *
 *   $simple         1 for an attack of the Simple Profile - Efficient
 *   $calledShot     1 for a Called Shot - Precision
 *   $aoe            1 for an attack with an Area of Effect
 *   $lineAoe        1 where that Area is a Line - Extending's exception
 *   $halfWager      1 where the Ki Wager is 1/2 of the Max Capacity or more - High Power
 *   $belowEnormous  how many Size Categories its wielder is smaller than Enormous - Giant Weapon
 *   $sizeRank       1, 2 or 3 for a Small, Standard or Big Weapon - the Shield's x
 */
export const WEAPON_TOKENS = Object.freeze({
  simple: 0,
  calledShot: 0,
  aoe: 0,
  lineAoe: 0,
  halfWager: 0,
  belowEnormous: 0,
  sizeRank: 2
});

/** A Weapon's `weapon.*` Slots, resolved for its wielder and the attack its tokens describe. */
export function weaponSlots(crafted, { getTrait, data = null, tokens = {}, form = null } = {}) {
  if (crafted?.kind !== "weapon") return {};
  const as = form ?? activeForm(crafted);
  return craftedSlots(crafted, PHASES.WEAPON, { getTrait, data, form: as,
    tokens: { sizeRank: WEAPON_SIZES[as.size]?.rank ?? WEAPON_TOKENS.sizeRank, ...tokens } });
}

/**
 * What a Weapon is, beside what every built Item is: its Type and Size, its Life Points -
 * "starts with 32 Life Points and gains 8 Life Points each Power Level", and what its Effects
 * add for each - its Damage Reduction of 6(bT), and its Hardness Rank, thrown.
 *
 * Broken is `destroyed` - the same thing, by the table's ruling: "If the Weapon's Life Points
 * are reduced to 0, it is broken and cannot be used for any Attacking Maneuvers."
 */
function weaponReading(crafted, { getTrait, data = null, baseTier = 1 }) {
  const kind = CRAFTED.weapon;
  const slots = weaponSlots(crafted, { getTrait, data });
  const level = Math.max(1, Number(data?.powerLevel) || 1);
  // A Shifting Buddy's: "this Weapon's Life Points are equal to your Buddy Attribute".
  const lifeMax = (Number(crafted.lifeFixed) > 0) ? Number(crafted.lifeFixed)
    : kind.lifeBase + (level * applySlot(slots, "weapon.lifePerLevel", kind.lifePerLevel));
  const lost = Number(crafted.lifeLost) || 0;
  const type = String(crafted.weaponType ?? "");
  const size = String(activeForm(crafted).size ?? "");
  return {
    weaponType: type,
    weaponTypeLabel: WEAPON_TYPES[type]?.label ?? type,
    weaponSize: size,
    weaponSizeLabel: WEAPON_SIZES[size]?.label ?? size,
    lifeMax,
    lifeLeft: crafted.destroyed ? 0 : Math.max(0, lifeMax - lost),
    damageReduction: kind.damageReductionPerBaseTier * (Number(baseTier) || 1),
    hardnessRank: applySlot(slots, "weapon.hardnessRank", kind.hardnessRank),
    blocks: slots["weapon.block"] === true,
    // Unbreakable: "cannot be destroyed by any means"; Regenerating: whole at every Encounter's end.
    unbreakable: slots["weapon.unbreakable"] === true,
    regenerates: slots["weapon.regenerates"] === true,
    weapon: slots
  };
}

/**
 * What a blow that lands on a Weapon does to it - a Called Shot at it, or a Block with it: the
 * Wound Roll, less the Weapon's own Damage Reduction of 6(bT) at its owner's base Tier. Breaker
 * adds "1/4 (rounded up)" to it first, the part of the blow it adds to. Unbreakable takes
 * nothing: "You cannot use effects that would reduce the Life Points of this Weapon."
 */
export function weaponHit(item, owner, wound, { getTrait, breaker = false } = {}) {
  const reading = craftedReading(item?.system?.crafted, { getTrait, difficulties: {},
    data: owner?.system ?? null, baseTier: owner?.system?.baseTierOfPower ?? 1 });
  if (!reading) return null;
  const blow = Math.max(0, Number(wound) || 0);
  const more = breaker ? Math.ceil(blow / 4) : 0;
  return {
    itemId: item.id,
    name: item.name,
    unbreakable: reading.unbreakable,
    damage: reading.unbreakable ? 0 : Math.max(0, blow + more - reading.damageReduction)
  };
}

/**
 * Take Life Points off a Weapon. "If the Weapon's Life Points are reduced to 0, it is broken and
 * cannot be used for any Attacking Maneuvers" - and broken is as if it were not there, by the
 * table's ruling: out of hand until it is repaired. Unbreakable loses none.
 *
 * @returns {Promise<string>} what happened, for the table
 */
export async function damageWeapon(owner, item, damage, getTrait) {
  const reading = craftedReading(item?.system?.crafted, { getTrait, difficulties: {},
    data: owner?.system ?? null, baseTier: owner?.system?.baseTierOfPower ?? 1 });
  if (!reading || reading.destroyed) return "";
  if (reading.unbreakable) return `${item.name} is Unbreakable: it loses nothing.`;
  const taken = Math.max(0, Number(damage) || 0);
  if (!taken) return `${item.name} takes no Damage.`;
  const lost = (Number(item.system.crafted.lifeLost) || 0) + taken;
  const left = Math.max(0, reading.lifeMax - lost);
  // A Shifting Buddy's Weapon, broken: "if it is destroyed, then your Buddy is destroyed".
  const buddy = (!left && item.system.crafted.fromBuddy)
    ? Array.from(owner?.items ?? []).find(each => each.id === item.system.crafted.fromBuddy) : null;
  await writeActor(owner, { items: [{ _id: item.id, "system.crafted.lifeLost": lost,
    ...(left ? {} : { "system.crafted.destroyed": true, "system.equipped": false }) },
    ...(buddy ? [{ _id: buddy.id, "system.buddy.destroyed": true, "system.buddy.active": false }] : [])] });
  return left ? `${item.name} loses ${taken} Life Points: ${left}/${reading.lifeMax}.`
    : `${item.name} loses ${taken} Life Points and breaks.${buddy ? ` ${buddy.name} is Destroyed.` : ""}`;
}

/**
 * The Weapons made whole at the end of a Combat Encounter - Regenerating's "this Weapon's Life
 * Points are completely recovered. If it was destroyed during the Combat Encounter, it is
 * completely repaired."
 */
export function regenerating(items, getTrait) {
  return (items ?? []).filter(item => (item.type === "gear")
    && (item.system?.crafted?.kind === "weapon")
    && ((Number(item.system.crafted.lifeLost) || 0) || item.system.crafted.destroyed)
    && (weaponSlots(item.system.crafted, { getTrait })["weapon.regenerates"] === true));
}

/**
 * The Weapons a character is wielding: `equipped`, whole, and not put away in anything. "As if
 * not there" once broken, by the table's ruling - not wielded, and nothing of it applies.
 */
export function wieldedWeapons(items) {
  return (items ?? []).filter(item => (item.type === "gear")
    && (item.system?.crafted?.kind === "weapon") && item.system?.equipped
    && !item.system?.crafted?.destroyed && !isStored(items, item));
}

/**
 * Why a Weapon cannot be taken in hand, or "": broken, or both hands full - "You can only wield
 * two Weapons at any one time."
 */
export function wieldProblem(items, item, getTrait = null) {
  if (item?.system?.crafted?.destroyed) return "Broken: repair it first.";
  // Telekinetic: "Wielding this Weapon does not count towards your maximum number of Weapons".
  if (heldByMind(items, item, getTrait)) return "";
  const held = wieldedWeapons(items).filter(other => (other !== item)
    && !heldByMind(items, other, getTrait));
  if (held.length >= WEAPONS_WIELDED) return `Already wielding ${WEAPONS_WIELDED} Weapons.`;
  return "";
}

/**
 * Whether a Weapon is held by the mind - Telekinetic - by one who can: "The wielder has the
 * Telekinesis Unique Ability", a Maneuver of theirs by that name.
 */
export function heldByMind(items, item, getTrait = null) {
  if (weaponSlots(item?.system?.crafted, { getTrait })["weapon.telekinetic"] !== true) return false;
  return telekinetic(items);
}

/** Whether these are the Items of one with the Telekinesis Unique Ability. */
export function telekinetic(items) {
  return (items ?? []).some(item => (item.type === "maneuver")
    && (String(item.name ?? "").trim().toLowerCase() === "telekinesis"));
}

/**
 * The Weapons an Attacking Maneuver of this Foundation may be made with: "Physical Weapons ...
 * can only be used for Physical Attacks", and so on. Chosen at declaration: "When making an
 * Attacking Maneuver, you must choose which Weapon (if any) you are using".
 */
export function weaponsFor(items, foundation, getTrait = null) {
  return wieldedWeapons(items).filter(item => weaponForms(item, getTrait)
    .some(form => form.weaponType === foundation));
}

/** Whether the character is rid of the Weapon Penalty: "gain the Weapon Specialist Talent". */
export function weaponSpecialist(actor) {
  const named = entry => String(entry ?? "").trim().toLowerCase() === "weapon specialist";
  return Array.from(actor?.items ?? []).some(item => (item.type === "talent") && named(item.name))
    || (actor?.system?.effects?.programs ?? []).some(entry => named(entry.sourceName));
}

/**
 * Karmic Edge's Energy Charge, against an Opponent of the Alignment chosen for it: "Good/Pure
 * Good" is 1 and up, "Evil/Pure Evil" -1 and down. Against the one the attack was declared at.
 */
function karmicCharge(slots, target) {
  const alignment = Number(target?.system?.alignment) || 0;
  if ((slots["weapon.karmicEdge.good"] === true) && (alignment >= 1)) return 1;
  if ((slots["weapon.karmicEdge.evil"] === true) && (alignment <= -1)) return 1;
  return 0;
}

/** A fraction written against a Slot - `weapon.damageReductionIgnored = 1/2;` - unrounded. */
function fractionOf(slots, key) {
  const c = slots?.[key];
  if (!c || (typeof c !== "object")) return 0;
  const base = ((c.set !== null) && (c.set !== undefined)) ? c.set : (c.add ?? 0);
  return base * (c.multiply ?? 1);
}

/**
 * What an attack made with this Weapon carries, worked out when it is declared: the rows its
 * Size, the Weapon Penalty and its Effects add to the Strike and the Wound, and what else they
 * say about the attack. On the attack rather than looked up later, as a Profile's Damage
 * Category is: the Weapon may be changed, put away or broken before the Wound Roll.
 *
 * @param {object} context  the attack: `profile`, `calledShot`, `area`, `kiWager`, and `sizes`,
 *                          the Size Categories in order, smallest first
 */
export function weaponAttack(item, attacker, { profile = "", calledShot = false, area = null,
  kiWager = 0, sizes = [], target = null, form = null, getTrait } = {}) {
  const crafted = item?.system?.crafted;
  if (crafted?.kind !== "weapon") return null;
  const data = attacker?.system ?? {};
  const tier = Number(data.tierOfPower) || 1;
  const as = form ?? activeForm(crafted);
  const size = WEAPON_SIZES[as.size] ?? WEAPON_SIZES.standard;
  const enormous = sizes.indexOf("enormous");
  const at = sizes.indexOf(data.size?.key ?? "");
  const tokens = {
    simple: (profile === "simple") ? 1 : 0,
    calledShot: calledShot ? 1 : 0,
    aoe: area ? 1 : 0,
    lineAoe: (area?.shape === "line") ? 1 : 0,
    halfWager: ((Number(kiWager) || 0) >= Math.floor((data.capacity?.max ?? 0) / 2))
      && ((Number(kiWager) || 0) > 0) ? 1 : 0,
    belowEnormous: ((enormous >= 0) && (at >= 0)) ? Math.max(0, enormous - at) : 0
  };
  const slots = weaponSlots(crafted, { getTrait, data, tokens, form: as });
  const byMind = (slots["weapon.telekinetic"] === true) && telekinetic(Array.from(attacker?.items ?? []));
  const perTier = (label, amount) => (amount
    ? [{ label, written: `${amount > 0 ? "+" : ""}${amount}(T)`, value: amount * tier }] : []);
  const own = (key) => {
    const value = applySlot(slots, key, 0);
    return value ? [{ label: item.name, value }] : [];
  };
  return {
    itemId: item.id,
    name: item.name,
    // Elemental Blade: "select a Profile with 'Elemental' in the name" - chosen when it was made.
    elementalBlade: qualityEntries(crafted).find(entry => entry.id === "elemental-blade")?.choice ?? "",
    category: as.category,
    categoryName: getTrait?.(as.category)?.name ?? as.category,
    weaponType: as.weaponType,
    weaponSize: as.size,
    // "Small: ... Strike Rolls increased by 1(T) and their Wound Rolls decreased by 2(T)."
    // And the Weapon Penalty, on the Strike of an attack made with a Weapon, unless the
    // Weapon Specialist Talent has taken it away.
    strike: [
      ...perTier(`${size.label} Weapon`, size.strike),
      ...(weaponSpecialist(attacker) ? [] : perTier("Weapon Penalty", -WEAPON_PENALTY_PER_TIER)),
      ...own("weapon.strike")
    ],
    wound: [...perTier(`${size.label} Weapon`, size.wound), ...own("weapon.wound")],
    strikeNatural: applySlot(slots, "weapon.strikeNatural", 0),
    kiCost: applySlot(slots, "weapon.kiCost", 0),
    energyCharges: applySlot(slots, "weapon.energyCharges", 0) + karmicCharge(slots, target),
    damageCategory: applySlot(slots, "weapon.damageCategory", 0),
    meleeRange: applySlot(slots, "weapon.meleeRange", 0),
    magnitude: area ? applySlot(slots, "weapon.magnitude", 0) : 0,
    damageReductionIgnored: fractionOf(slots, "weapon.damageReductionIgnored"),
    soakIgnored: fractionOf(slots, "weapon.soakIgnored"),
    diminishingAtDeclaration: slots["weapon.diminishingAtDeclaration"] === true,
    // Staggering's Might Clash, and Lasting Wounds' stack of DOT.
    staggering: slots["weapon.staggering"] === true,
    lastingWounds: slots["weapon.lastingWounds"] === true,
    // Far Sight's, and Long Range Weapon's 1(T) against each Opponent 9+ Squares away.
    ignoresLongRange: slots["weapon.ignoresLongRange"] === true,
    longRangeStrike: applySlot(slots, "weapon.longRangeStrike", 0),
    // Elongation: "the entire Battlefield is your Melee Range".
    wholeBattlefield: slots["weapon.wholeBattlefield"] === true,
    // High-Tech: "Your Damage Attribute ... is Scholarship."
    scholarshipDamage: slots["weapon.scholarshipDamage"] === true,
    // Telekinetic, in the mind of one with Telekinesis: from anywhere in a Large Sphere around
    // them - which Square is the table's, and so is how far it is from there.
    telekinetic: byMind,
    // A Poison Vial's Drop on it: "A Poisoned Weapon inflicts the Poisoned Combat Condition to a
    // Character if you knock them through a Health Threshold with an Attacking Maneuver using that
    // Weapon."
    poisoned: Boolean(crafted.poisoned),
    // Burst Fire's Actions for Energy Charges, asked at declaration; Concealed's Clash.
    burstFire: slots["weapon.burstFire"] === true,
    concealed: slots["weapon.concealed"] === true,
    // Breaker, on what it hits of the target's; and Dimension Blade's cost to itself - "reduces
    // the Life Points of this Weapon by 1/10 of its Maximum Life Points", rounded down.
    breaker: slots["weapon.breaker"] === true,
    selfDamage: Math.floor(fractionOf(slots, "weapon.selfDamage")
      * (craftedReading(crafted, { getTrait, difficulties: {}, data })?.lifeMax ?? 0))
  };
}

/**
 * A Weapon Category's effects on an attack made with no Weapon of it - Elemental (Earth)'s "gains
 * the effects of the Bludgeoning Weapon Category as if this Attacking Maneuver was made with a
 * Weapon, even if it was Unarmed". What the Category writes, and nothing a Weapon brings with it:
 * no Size, no Weapon Penalty.
 */
export function borrowedCategory(categoryId, attacker, { source = "", getTrait, ...context } = {}) {
  const category = getTrait?.(categoryId);
  if (!category) return null;
  const crafted = { kind: "weapon", category: category.id, weaponType: category.weaponType,
    weaponSize: "standard", grade: 1, qualities: [] };
  crafted.effects = composeEffects(crafted, "", { getTrait });
  const name = source ? `${category.name} (${source})` : category.name;
  const lent = weaponAttack({ id: "", name, system: { crafted } }, attacker, { getTrait, ...context });
  if (!lent) return null;
  return { ...lent, itemId: "", borrowed: true, selfDamage: 0,
    strike: lent.strike.filter(part => part.label === name),
    wound: lent.wound.filter(part => part.label === name) };
}

/**
 * Two things' effects on one attack - a Weapon's own, and a Category it borrows in place of its own
 * ("No Attacking Maneuver can benefit from more than one Weapon Category at a time") - as one: the
 * rows of both, numbers summed, whatever either says it does.
 */
export function withBorrowed(armed, lent) {
  if (!armed) return lent;
  if (!lent) return armed;
  const merged = { ...armed };
  for (const [key, value] of Object.entries(lent)) {
    if (["itemId", "name", "weaponType", "weaponSize", "borrowed"].includes(key)) continue;
    if (Array.isArray(value)) merged[key] = [...(armed[key] ?? []), ...value];
    else if (typeof value === "number") merged[key] = (Number(armed[key]) || 0) + value;
    else if (typeof value === "boolean") merged[key] = Boolean(armed[key]) || value;
    else if ((key === "category") || (key === "categoryName")) merged[key] = value;
  }
  return merged;
}

/**
 * What a line of a Quality's Effects is, by the first word of its tag as the rulebook writes
 * one: on for as long as it is worn, happening without asking, one its wearer may use when it
 * comes - and what the wearer or the piece must meet for any of it to apply.
 */
export const EFFECT_TYPES = {
  prerequisite: { label: "Prerequisite" },
  passive: { label: "Passive" },
  automatic: { label: "Automatic" },
  triggered: { label: "Triggered" }
};

/**
 * What a Quality does, a line to an effect, for the Effects on its Item's sheet: its
 * Prerequisites as printed first, then its `summary` - each line opening with its tag, as the
 * rulebook's own do: `[Passive]: ...`, `[Automatic, 1/Encounter]: ...`. The badge says the tag;
 * its first word is the type, and a tag whose first word is none of them is not shown.
 *
 * @returns {{type: string, label: string, text: string}[]}
 */
export function qualitySummary(trait) {
  const lines = [];
  const prerequisites = [].concat(trait?.prerequisites ?? []).join(", ").trim();
  if (prerequisites && !/^n\/?a$/i.test(prerequisites)) {
    lines.push({ type: "prerequisite", label: EFFECT_TYPES.prerequisite.label, text: prerequisites });
  }
  for (const line of String(trait?.summary ?? "").split("\n").map(each => each.trim())) {
    const [, tag, text] = line.match(/^\[([^\]]+)\]:\s*(.+)$/) ?? [];
    const type = String(tag ?? "").split(/[\s,/]/)[0].toLowerCase();
    if (!tag || !EFFECT_TYPES[type] || (type === "prerequisite")) continue;
    lines.push({ type, label: tag.trim(), text });
  }
  return lines;
}

/**
 * Whether a name begins with what has been typed so far, character by character - the Add
 * Quality search. Case, apostrophes and the like aside, so "leaders" finds Leader's Insignia.
 */
export function namePrefixMatches(name, typed) {
  const plain = text => String(text ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ").trimStart();
  return plain(name).startsWith(plain(typed));
}

/**
 * How many Quality Slots a Quality takes: `slots: 2`, or a range - `slots: 1-3` - "you may
 * select how many Quality Slots a Apparel Quality takes up". One when it does not say.
 */
export function qualitySlotRange(trait) {
  const said = String(trait?.slots ?? "").trim();
  const [low, high] = said.split(/\s*[-~]\s*/).map(part => Number(part));
  const min = Number.isFinite(low) && (low > 0) ? low : 1;
  const max = Number.isFinite(high) && (high >= min) ? high : min;
  return { min, max, ranged: max > min };
}

/** The Slots one Quality entry takes: what was chosen, held to its range. */
export function slotsTaken(entry, trait) {
  const { min, max } = qualitySlotRange(trait);
  const chosen = Number(entry?.slots) || 0;
  return chosen ? Math.min(max, Math.max(min, chosen)) : min;
}

/**
 * Whether a Quality may go on this Category: `categories: armor, combat-clothing`, or on any
 * when it names none - and never on one `categoriesExcept` names, "All (except Weights)".
 */
export function qualityFits(trait, category) {
  const which = String(category ?? "").toLowerCase();
  const allowed = listOf(trait?.categories);
  if (listOf(trait?.categoriesExcept).includes(which)) return false;
  return !allowed.length || allowed.includes(which);
}

/**
 * Whether a Quality may go on this piece: an Apparel Quality by its Category, a Weapon Quality
 * by its Type - "Weapon Qualities may apply to only certain Weapon Types", `types: physical,
 * energy`, on any Type when it names none ("Weapon Type: All").
 */
export function qualityFitsPiece(trait, crafted) {
  if (crafted?.kind !== "weapon") return qualityFits(trait, crafted?.category);
  const allowed = listOf(trait?.types);
  return !allowed.length || allowed.includes(String(crafted.weaponType ?? "").toLowerCase());
}

/**
 * Whether a Category may be this piece's: a Weapon Category by its Type - "The Weapon Categories
 * available are decided based on the Weapon Type chosen", `weaponType: physical`. Any Apparel
 * Category on any piece of Apparel.
 */
export function categoryFitsPiece(trait, crafted) {
  if (crafted?.kind !== "weapon") return true;
  return String(trait?.weaponType ?? "").toLowerCase() === String(crafted.weaponType ?? "").toLowerCase();
}

/**
 * A new built Item, at what building one starts at: "Add Apparel" - Standard Clothing,
 * Craftsmanship Grade 1, the Size the character was built as, and no Qualities.
 */
export function craftedItemFrom(kindKey, actor, getTrait) {
  const kind = CRAFTED[kindKey];
  if (!kind) return null;
  const size = actor?.system?.size;
  // "Add Weapon": Grade 1, Physical, Standard, Bludgeoning - whole, and not in hand.
  if (kindKey === "weapon") {
    const crafted = { kind: kindKey, category: kind.defaultCategory, grade: 1,
      weaponType: kind.defaultType, weaponSize: kind.defaultSize, qualities: [] };
    return {
      name: getTrait?.(kind.defaultCategory)?.name ?? kind.label,
      type: "gear",
      img: GEAR_ICON,
      system: {
        gearId: "",
        itemType: kindKey,
        crafted: { ...crafted, size: "", effects: composeEffects(crafted, "", { getTrait }),
          lifeLost: 0, breakLost: 0, destroyed: false }
      }
    };
  }
  return {
    name: getTrait?.(kind.defaultCategory)?.name ?? kind.label,
    type: "gear",
    img: GEAR_ICON,
    system: {
      gearId: "",
      itemType: kindKey,
      crafted: {
        kind: kindKey,
        category: kind.defaultCategory,
        grade: 1,
        size: size?.chosen ?? size?.key ?? "medium",
        qualities: [],
        // Written from its Category the moment it is made, and its own from then on.
        effects: composeEffects({ kind: kindKey, category: kind.defaultCategory, qualities: [] },
          "", { getTrait }),
        // Whole.
        breakLost: 0,
        destroyed: false
      }
    }
  };
}

/** A list header, from one value or several. */
/**
 * Whether an Item is destroyed once it is used: Consumable in its Details, read off its own file too,
 * so one given before its entry said so is used up the same way.
 */
export function isConsumable(item, getTrait = null) {
  if (item?.system?.consumed) return true;
  const definition = getTrait?.(item?.system?.gearId ?? "");
  return (definition?.consumed === true) || listOf(definition?.details).includes("consumable");
}

function listOf(raw) {
  const list = Array.isArray(raw) ? raw : String(raw ?? "").split(",");
  return list.map(entry => String(entry).trim().toLowerCase()).filter(Boolean);
}

/**
 * The sizes a file offers, each with the dice for its charges, in the order written.
 *
 * Written `Small=1d4, Standard=1d6` - a name and the dice for it.
 */
export function sizesOf(definition) {
  const raw = definition?.sizes;
  const list = Array.isArray(raw) ? raw : String(raw ?? "").split(",");
  return list.map(entry => String(entry).trim()).filter(entry => entry.includes("="))
    .map(entry => {
      const [label, dice] = entry.split("=").map(part => part.trim());
      return { label, dice };
    })
    .filter(size => size.label && /^\d+d\d+$/.test(size.dice));
}

/**
 * The Combat Conditions a full restore takes off a character: every one held, but those it
 * keeps. Marks this system files beside them are not Combat Conditions and are not touched.
 *
 * A Senzu Bean: "removes all Combat Conditions (except Pinned or Suffocating)".
 *
 * @param {object} held        the character's `system.conditions`
 * @param {object[]} conditions every Condition definition, as `allConditions()` gives them
 */
export function conditionsRestored(held, conditions, keeps = []) {
  const combat = new Set(conditions.filter(condition => condition.combatCondition)
    .map(condition => condition.key));
  return Object.entries(held ?? {})
    .filter(([key, stacks]) => ((Number(stacks) || 0) > 0) && combat.has(key) && !keeps.includes(key))
    .map(([key]) => key);
}

/**
 * The kinds of portion a file offers, each read off its own headers: `<kind>Label`,
 * `<kind>Full` for Life and Ki to their maximum, `<kind>Dot` for Damage Over Time off,
 * `<kind>Removes` for the Conditions taken off, `<kind>Gains` for a mark put on.
 */
export function portionsOf(definition) {
  return listOf(definition?.portions).map(key => ({
    key,
    label: String(definition[`${key}Label`] ?? key),
    count: 0,
    full: definition[`${key}Full`] === true,
    dot: definition[`${key}Dot`] === true,
    removes: listOf(definition[`${key}Removes`]),
    gains: String(definition[`${key}Gains`] ?? "").trim().toLowerCase()
  }));
}

/**
 * What eating one portion changes about a character, as the writes to make.
 *
 * Revive: Life and Ki to their maximum. Achichi: Damage Over Time off, every stack, and its
 * clocks with it. Zutsu and Achichi: the Conditions named, off. Beaut: a mark, gained.
 */
export function portionEffects(portion, system) {
  const update = {};
  if (portion.full) {
    update["system.life.value"] = system.life.max;
    update["system.ki.value"] = system.ki.max;
  }
  if (portion.dot) {
    update["system.dotStacks"] = 0;
    update["system.timed"] = (system.timed ?? []).filter(entry => entry.kind !== "dot");
  }
  const removes = (portion.removes ?? [])
    .filter(key => (Number(system.conditions?.[key]) || 0) > 0);
  return { update, removes, gains: portion.gains || "" };
}

/**
 * Whether an Item is giving its holder what it gives right now: a Basic Item by being
 * held, an Accessory only while it is worn - "apply benefits while equipped".
 */
export function inEffect(item) {
  if (item?.type !== "gear") return false;
  return (item.system?.itemType !== "accessory") || Boolean(item.system?.equipped);
}

/** The character's Item that gives them access to this Maneuver, if one does. */
export function gearGranting(items, maneuverId) {
  return (items ?? []).find(item => inEffect(item)
    && (item.system?.grantsManeuver === maneuverId)) ?? null;
}

/** A pool made at so many per base Tier of Power of whoever makes it. */
function chargesAtCreation(definition, actor) {
  const per = Math.max(0, Number(definition?.chargesPerBaseTier) || 0);
  return per * (actor?.system?.baseTierOfPower ?? 1);
}

/**
 * Who pays a Movement's Ki, and how much each: the Item worn that pays for Movement first,
 * as far as its charges go, and the character the rest.
 *
 * "When you would spend Ki Points through the Movement Maneuver, remove them from the
 * Jetpack instead." What it cannot cover, the character pays - by the table's ruling -
 * and only that part counts against their Capacity.
 */
export function movementPayment(items, price) {
  const store = (items ?? []).find(item => inEffect(item) && item.system?.paysMovement)
    ?? null;
  const fromStore = store ? Math.min(Math.max(0, Number(store.system.charges) || 0), price) : 0;
  return { store: fromStore > 0 ? store : null, fromStore, fromSelf: price - fromStore };
}

/** The character's Item that stores what a Power Drain takes, if they have one. */
export function drainStore(items) {
  return (items ?? []).find(item => (item.type === "gear") && item.system?.storesDrain) ?? null;
}

/**
 * Whether an Item's stored Ki may pay for this attack: made with a Foundation it names, with
 * enough stored for the whole price. All or nothing, by the table's ruling.
 */
export function canPayAttack(item, foundation, price) {
  return Boolean(item) && (price > 0)
    && (item.system?.paysAttacks ?? []).includes(foundation)
    && ((Number(item.system?.charges) || 0) >= price);
}

/**
 * Whether a character holds every ball of this one's set: Items from the same file, in a set
 * of the same size, with every number from 1 to that size among them.
 *
 * "Once you gather all of them."
 */
export function setGathered(items, item) {
  const size = Number(item?.system?.set?.size) || 0;
  if (!size) return false;
  const numbers = new Set((items ?? [])
    .filter(other => (other.system?.gearId === item.system.gearId)
      && (Number(other.system?.set?.size) === size))
    .map(other => Number(other.system.set.number)));
  for (let n = 1; n <= size; n++) if (!numbers.has(n)) return false;
  return true;
}

/** The triggers a file offers, in the order written, and only the ones there are. */
export function triggersOf(definition) {
  return listOf(definition?.triggers).filter(trigger => GEAR_TRIGGERS[trigger]);
}

/**
 * The modifier an Item records from whoever makes it, or null if it records none.
 *
 * An Attribute's Modifier by its name, or Ingenuity - the Bomb's "Recorded Ingenuity", "equal to
 * your Scholarship Modifier at the time of creating/modifying an Item".
 */
export function recordedFrom(definition, actor) {
  const attribute = recordsOf(definition);
  if (!attribute) return null;
  const modifier = (attribute === "ingenuity")
    ? actor?.system?.ingenuity
    : actor?.system?.attributes?.[attribute]?.mod;
  return Number.isFinite(Number(modifier)) ? Number(modifier) : 0;
}

/**
 * What an Item records from its maker: its own header, or - a Device - Ingenuity. "A Basic Item with
 * this Detail records the creator's Ingenuity at its time of creation ... The 'Recorded Ingenuity'
 * refers to this value."
 */
export function recordsOf(definition) {
  const said = String(definition?.records ?? "").trim().toLowerCase();
  if (said) return said;
  return listOf(definition?.details).includes("device") ? "ingenuity" : "";
}

/**
 * Device, "gained from a Gear Kit": "it records a value equal to the Score Limit for your starting
 * Tier of Power" - 8 at Tier 1, 3 more a Tier. The starting Tier is asked when the Item is given
 * (the user's ruling); this is the Limit it stands for.
 */
export function gearKitIngenuity(startingTier = 1) {
  return 8 + (Math.max(1, Math.floor(Number(startingTier) || 1)) - 1) * 3;
}

/** What a recorded value is called on the card: "Recorded Ingenuity", "Recorded Scholarship". */
export function recordedLabel(records) {
  const key = String(records ?? "").trim();
  return key ? `Recorded ${key.charAt(0).toUpperCase()}${key.slice(1)}` : "";
}

/**
 * The placed, Timed Items whose Rounds have now passed, and every placed Timed one's count
 * one Round lower.
 *
 * "This Bomb will trigger once that number of Combat Rounds have passed." Counted at the
 * start of each Combat Round: placed with three, it goes off at the start of the third
 * Round after. Held at zero once it gets there, until it is set off.
 *
 * @param {{system: object}[]} items the character's Gear
 * @returns {{updates: object[], due: object[]}} the writes to make, and the Items now due
 */
export function tickCountdowns(items) {
  const updates = [];
  const due = [];
  for (const item of items ?? []) {
    const system = item.system ?? {};
    if (!system.placed || (system.trigger !== "timed")) continue;
    const left = Math.max(0, (Number(system.countdown) || 0) - 1);
    if (left !== system.countdown) updates.push({ _id: item.id, "system.countdown": left });
    if (left === 0) due.push(item);
  }
  return { updates, due };
}

/** Foundry's own bag, until an Item brings a picture of its own. */
export const GEAR_ICON = "icons/svg/item-bag.svg";

/**
 * The folders under traits/gear/, one per list on the Gear tab, and the Item Types each
 * may hold - the first being what a file in it is when its header does not say.
 *
 * So the folder is what decides the list, and `itemType:` is only needed to tell an
 * Accessory from a Basic Item.
 */
export const GEAR_FOLDERS = Object.freeze({
  basic: ["basic", "accessory"],
  apparel: ["apparel"],
  weapons: ["weapon"],
  buddies: ["buddy"]
});

/**
 * Which of the four Item Types a file is.
 *
 * What its header says, where that is a type its folder holds; the folder's own type
 * otherwise. A file outside the three folders is whatever its header says, or a Basic
 * Item.
 */
export function typeOf(definition) {
  const allowed = GEAR_FOLDERS[definition?.owner] ?? Object.keys(GEAR_TYPES);
  const said = String(definition?.itemType ?? "").trim().toLowerCase();
  return allowed.includes(said) ? said : allowed[0];
}

/**
 * The tags a file gives its Item, in the order written.
 *
 * A header with one value comes back from the parser as a string and one with several as a
 * list, so both are read. Only the tags the rules name are kept.
 */
export function tagsOf(definition) {
  return listOf(definition?.tags).filter(tag => GEAR_TAGS[tag]);
}

/** The files for one list on the Gear tab, by name. */
export function gearOfList(definitions, list) {
  return (definitions ?? [])
    .filter(definition => GEAR_TYPES[typeOf(definition)].list === list)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/**
 * The Item a character is given from a file.
 *
 * The description starts empty: it is the player's, for whatever this one is to them. The
 * rulebook's entry is kept as `text` and shown beside it, read from the file where the
 * file still exists.
 */
export function gearItemFrom(definition, actor = null) {
  const triggers = triggersOf(definition);
  return {
    name: definition.name,
    type: "gear",
    img: GEAR_ICON,
    flags: { "dbu-ttrpg": { sourceId: definition.id } },
    system: {
      gearId: definition.id,
      itemType: typeOf(definition),
      tags: tagsOf(definition),
      craftDC: String(definition.craftDC ?? ""),
      text: String(definition.text ?? ""),
      source: String(definition.source ?? ""),
      description: "",

      // What an Item that records something from its maker, and goes off, needs to keep.
      // Copied rather than read from the file each time, as everything else here is: the
      // Item is the character's, and the file may change under it.
      records: recordsOf(definition),
      recorded: recordedFrom(definition, actor),
      triggers,
      trigger: triggers[0] ?? "",
      placeCost: Math.max(0, Number(definition.placeCost) || 0),
      placed: false,
      countdown: 0,
      detonation: {
        profile: String(definition.detonationProfile ?? ""),
        foundation: String(definition.detonationFoundation ?? ""),
        autoHit: definition.detonationAutoHit === true
      },

      // A Special Basic Item: "cannot be obtained by Crafting and can only be gained from
      // your ARC".
      special: definition.special === true,

      // Tied to a Character picked when it is given, and moving to or from them - the
      // Teleport Remote.
      assignsCharacter: definition.assignsCharacter === true,
      assigned: { uuid: "", name: "" },
      teleports: definition.teleports === true,

      // Put on somebody else and locked there - the Ki-Sealing Handcuff: what putting it on
      // costs, what taking it off with the Key costs, the Skills that sneak it onto someone
      // who has not noticed and the one they notice with, the Condition it holds on them
      // and the mark that holds it. `id` pairs it with its Key, and is set when it is given.
      lock: {
        locks: definition.locks === true,
        cost: Math.max(0, Number(definition.lockCost) || 0),
        unlockCost: Math.max(0, Number(definition.unlockCost) || 0),
        skills: listOf(definition.lockSkills),
        against: String(definition.lockAgainst ?? "").trim().toLowerCase(),
        condition: String(definition.sealCondition ?? "").trim().toLowerCase(),
        mark: String(definition.sealMark ?? "").trim().toLowerCase(),
        id: "",
        // Whether putting it on gave its wearer a stack, or found them at the most already.
        gave: false
      },
      // A Key: the lock it opens.
      keyFor: "",

      // A State it lets its wearer enter on entering another, once for this Item, and until
      // which edge of their turn - the Bloodstained Accessory's Determined on entering
      // Raging, "until the end of your turn".
      entersOn: {
        from: String(definition.entersOnFrom ?? "").trim().toLowerCase(),
        state: String(definition.entersOnState ?? "").trim().toLowerCase(),
        edge: String(definition.entersOnUntil ?? "").trim().toLowerCase(),
        spent: false
      },

      // Shrinks its wearer to a Size Category named outright - the Micro Band's Tiny or
      // Nano - for so many Actions, and the same to come back. `now` is where they are.
      shrink: {
        to: listOf(definition.shrinksTo),
        cost: Math.max(0, Number(definition.shrinkCost) || 0),
        now: ""
      },

      // An Attribute that may stand in for the Damage Attribute, and on what - the
      // Hologram Projector's Personality Modifier, on a Signature Technique.
      damageAttribute: {
        attribute: String(definition.damageAttribute ?? "").trim().toLowerCase(),
        when: String(definition.damageAttributeWhen ?? "").trim().toLowerCase()
      },

      // Made for one Character, who may be the one holding it - the Eyeglasses'
      // "Intended Character", declared when it is given.
      declaresIntended: definition.declaresIntended === true,
      intended: { uuid: "", name: "" },

      // Worn, for an Accessory: "Accessories ... apply benefits while equipped." Given
      // unworn - putting it on is an Action.
      equipped: false,

      // Portions of several kinds, each with what eating one does - the Medibugs - and the
      // dice for how many are shared out among them.
      portionsDice: String(definition.portionsDice ?? ""),
      portions: portionsOf(definition),

      // A Maneuver holding it gives access to, and what it changes about that Maneuver - the
      // Energy-Suction Device's Power Drain: used without a Grapple, the Ki stored in it,
      // and the Foundations whose attacks the stored Ki may pay for.
      grantsManeuver: String(definition.grantsManeuver ?? "").trim().toLowerCase(),
      drainsAnywhere: definition.drainsAnywhere === true,
      storesDrain: definition.storesDrain === true,
      paysAttacks: listOf(definition.paysAttacks),

      // One of a set: how large a set may be, how large this one's is, and which of it this
      // is - a Dragon Ball - and what gathering them all costs to use.
      set: {
        min: Math.max(0, Number(definition.setMin) || 0),
        max: Math.max(0, Number(definition.setMax) || 0),
        size: 0,
        number: 0,
        actionsMin: Math.max(0, Number(definition.summonActionsMin) || 0)
      },

      // Sizes it comes in, each with the dice for its charges - the Bag of Senzu Beans'.
      sizes: sizesOf(definition),
      size: "",

      // Full Life and Ki, and every Combat Condition off but these - a Senzu Bean - and
      // whether it may be fed to a Defeated character beside you.
      restore: {
        full: definition.restoresFully === true,
        keeps: listOf(definition.restoreKeeps),
        feedsDefeated: definition.feedsDefeated === true
      },

      // Charges it is made with, rolled when it is given - the Poison Vial's Drops.
      chargesDice: String(definition.chargesDice ?? ""),
      chargesLabel: String(definition.chargesLabel ?? ""),
      // A charge spent for an effect the system cannot apply, said on the card: the Sake Bottle's
      // "1 Action and 1 Alcohol ... to enter the Drunk Special State".
      chargeUseLabel: String(definition.chargeUseLabel ?? "").trim(),
      chargeUseNote: String(definition.chargeUseNote ?? "").trim(),
      // Or so many per base Tier of Power of whoever makes it, "at the time of creation" -
      // the Jetpack's 30(bT) Ki. Worked out off the character it is given to, and kept as
      // the most it holds.
      chargesPerBaseTier: Math.max(0, Number(definition.chargesPerBaseTier) || 0),
      charges: chargesAtCreation(definition, actor),
      chargesMax: chargesAtCreation(definition, actor),
      // What its charges pay for instead of the character's Ki - the Jetpack's Movement.
      paysMovement: definition.paysMovement === true,

      // A mark it leaves on everyone in the area it bursts in, and whether it lasts to the
      // start or the end of the thrower's next turn - the Smoke Bomb's Smoked.
      areaMark: {
        condition: String(definition.areaMark ?? "").trim().toLowerCase(),
        until: String(definition.areaUntil ?? "").trim().toLowerCase()
      },

      // A scan, and the Check that hides from it - the Scout Scope's Qualified Concealment.
      scan: {
        skill: String(definition.scanSkill ?? "").trim().toLowerCase(),
        difficulty: String(definition.scanDifficulty ?? "").trim().toLowerCase(),
        // "During a Combat Encounter" - the Scouter's scan, where the Scout Scope's is any time.
        combatOnly: definition.scanCombatOnly === true,
        // Whether hiding from it lasts only while the Holding Back stacks do - the Scout
        // Scope's "If their number of Holding Back stacks would decrease below their current
        // number, they lose this benefit". The Scouter's lasts the Encounter regardless.
        holdingBack: definition.scanHoldingBack !== false,
        // The Tier of Power a Power Up has to be made at to destroy it, by its Craft DC -
        // "Tier of Power 2+ (Qualified) or 3+ (Expert)". Nothing destroys one made higher.
        breaksAt: 0
      },
      // Craft DCs it may be made at - "Variable (Qualified ~ Grandmaster)" - asked when it
      // is given, and what each makes breakable by.
      craftDCChoices: listOf(definition.craftDCChoices),
      breaksAt: pairsOf(definition.breaksAt),

      // A Light Source while it is lit and held: the mark it gives its holder, and whether
      // it is lit - the Torch.
      lightMark: String(definition.lightMark ?? "").trim().toLowerCase(),
      lit: false,

      // What it can be connected to, and what it is - the Remote Control's Item.
      connects: listOf(definition.connects),
      connectedTo: "",
      // The pair of what it is connected to, where that is a Collar: found by this wherever
      // it is worn, since it is made to end up on somebody else.
      connectedPair: "",

      // Paired with whatever connects to it, so it can be found on whoever wears it - a
      // Collar. Set when it is given.
      paired: definition.paired === true,
      pairId: "",
      // What setting it off does to its wearer: a part of their Maximum Life Points - 1/5,
      // written 5 - and Prone if that knocks them through a Health Threshold. The Shock
      // Collar.
      shock: {
        part: Math.max(0, Number(definition.shockPart) || 0),
        prone: definition.shockProne === true
      },

      // A Capsule: it holds one Basic Item. Which one is on that Item, as `storedIn`.
      capsule: definition.capsule === true,
      storedIn: "",

      // A Clash it makes against whoever it catches, and what winning leaves on them -
      // the Flash Bang's Clash (Impulsive), and Blinded until the start of your next turn.
      clash: {
        save: String(definition.clashSave ?? "").trim().toLowerCase(),
        // Or a Strike, answered with a Strike or a Dodge - the Taser's.
        roll: String(definition.clashRoll ?? "").trim().toLowerCase(),
        // How far it reaches: "melee" for the user's Melee Range, blank for the table's.
        reach: String(definition.clashReach ?? "").trim().toLowerCase(),
        condition: String(definition.clashCondition ?? "").trim().toLowerCase(),
        until: String(definition.clashUntil ?? "").trim().toLowerCase(),
        // A mark that keeps the Condition from coming off, on the same clock - Tased.
        hold: String(definition.clashHold ?? "").trim().toLowerCase(),
        // The Taser's two steps: the first Clash won takes the Recorded Ingenuity off their Life
        // Points ("recorded"), and a second Clash - the Recorded Ingenuity against this Saving
        // Throw - is the one that leaves the Condition.
        damage: String(definition.clashDamage ?? "").trim().toLowerCase(),
        second: String(definition.clashSecond ?? "").trim().toLowerCase()
      },

      // Made at a higher Craft DC for a longer reach - the Expert Taser. Chosen on the Item.
      upgrade: {
        craftDC: String(definition.upgradeCraftDC ?? ""),
        reach: Math.max(0, Number(definition.upgradeReach) || 0),
        chosen: false
      },

      // An Item thrown to catch someone - the Net: the Foundations its Strike may be made
      // with, the mark winning the Strike leaves, and the Condition winning the Might Clash
      // after it does.
      snare: {
        foundations: listOf(definition.snareFoundations),
        mark: String(definition.snareMark ?? "").trim().toLowerCase(),
        condition: String(definition.snareCondition ?? "").trim().toLowerCase()
      },

      // An Item used up to take Conditions off, or to heal - the Longevity Supplement,
      // Medicine.
      removes: listOf(definition.removes),
      // What consuming it does that the system cannot, said on the card - the Performance
      // Enhancer's Doping Enhancement.
      consumeNote: String(definition.consumeNote ?? "").trim(),
      heal: {
        dice: String(definition.healDice ?? ""),
        scale: String(definition.healScale ?? ""),
        // Ki Points as well as Life, each rolled for - the Snack's "Life and Ki Points".
        ki: definition.healKi === true,
        // All of it, no roll - the Ensenji's "regain all of your Life and Ki Points".
        full: definition.healFull === true
      },
      oncePerEncounter: definition.oncePerEncounter === true,
      // Consumable: "A Basic Item with this Detail is destroyed once it is used" - the Details line,
      // or the header that said so before there was one.
      details: listOf(definition.details),
      consumed: (definition.consumed === true) || listOf(definition.details).includes("consumable"),

      // What an Item left on the ground does to whoever moves through it - Caltrops.
      hazard: {
        dice: String(definition.hazardDice ?? ""),
        scale: String(definition.hazardScale ?? ""),
        sparesAirborne: definition.hazardSparesAirborne === true
      }
    }
  };
}

/**
 * The entry a once-per-Encounter Item leaves among the character's used effects.
 *
 * Kept with the other once-per-Encounter uses, in `usedManeuvers`, which is cleared when an
 * Encounter begins and when it ends. Keyed by the file rather than the Item, so a second
 * copy of the same Item is still the same Item used again.
 */
export function encounterUseKey(item) {
  return `encounter:gear.${item.system?.gearId || item.id}`;
}

/** Whether this character has already used this Item this Combat Encounter. */
export function usedThisEncounter(actor, item) {
  return (actor?.system?.usedManeuvers ?? []).includes(encounterUseKey(item));
}

/**
 * The entry a character hidden from a scanning Item leaves among their once-per-Encounter
 * uses, with the Holding Back stacks they had when they hid.
 *
 * The Scout Scope: "they automatically succeed on any further Concealment Skill Checks to
 * avoid being spotted by a Scout Scope for the remainder of the Combat Encounter. If their
 * number of Holding Back stacks would decrease below their current number, they lose this
 * benefit." Kept in `usedManeuvers`, which clears when an Encounter begins and ends.
 */
export function hiddenKey(gearId, stacks) {
  return `encounter:gear.${gearId}.hidden.${Math.max(0, Number(stacks) || 0)}`;
}

/** The Holding Back stacks a character has. */
export function holdingBackStacks(actor) {
  return Number(actor?.system?.resources?.holdingback?.stacks) || 0;
}

/**
 * Whether a character is still hidden from this kind of scanning Item: they hid this
 * Encounter, and their Holding Back stacks have not dropped below what they had then.
 */
export function stillHidden(actor, gearId) {
  const prefix = `encounter:gear.${gearId}.hidden.`;
  const entry = (actor?.system?.usedManeuvers ?? []).find(used => used.startsWith(prefix));
  if (!entry) return false;
  return holdingBackStacks(actor) >= (Number(entry.slice(prefix.length)) || 0);
}

/**
 * What a scan reads: the current Tier of Power, and the Power Level only when that Tier is
 * the base one. "If their current Tier of Power is the same as their base Tier of Power, you
 * also learn of their Power Level."
 */
export function scanReading(actor) {
  const system = actor?.system ?? {};
  const tier = system.tierOfPower ?? 1;
  const atBase = tier === (system.baseTierOfPower ?? 1);
  return { tier, powerLevel: atBase ? (system.powerLevel ?? null) : null };
}

/**
 * What a Remote Control can be connected to among a character's Items: their own Items made
 * from one of the files it names.
 *
 * "Select an Item (Bomb/Collar/Vehicle/Battle Jacket) you possess for it to be connected to."
 */
export function connectable(items, remote, getTrait = null) {
  const kinds = remoteKinds(remote, getTrait);
  return (items ?? []).filter(item => (item.id !== remote.id)
    && kinds.includes(item.system?.gearId));
}

/**
 * What a Remote Control reaches, by the files those Items are made from: its own `connects`, or -
 * a Controller Weapon, "treated as the Remote Control Basic Item" - what its Effects attune it to.
 */
export function remoteKinds(item, getTrait = null) {
  // A Support Buddy, Active: "a Remote Control for any Items/Vehicles/Battle Jackets you possess
  // that may link with a Remote Control" - the ones in this system.
  if (item?.system?.itemType === "buddy") {
    return (item.system.buddy?.active && !item.system.buddy?.destroyed
      && (buddyHeader(item, getTrait, "remote") === true)) ? REMOTE_LINKS : [];
  }
  const own = item?.system?.connects ?? [];
  if (own.length || (item?.system?.crafted?.kind !== "weapon")) return own;
  const slots = weaponSlots(item.system.crafted, { getTrait });
  return Object.keys(slots).filter(key => key.startsWith("weapon.remote.") && (slots[key] === true))
    .map(key => key.slice("weapon.remote.".length));
}

/** Whether a Controller Weapon reaches every Item of its type: "all Items of that type". */
export function remotesAll(item, getTrait = null) {
  if (item?.system?.itemType === "buddy") return remoteKinds(item, getTrait).length > 0;
  return weaponSlots(item?.system?.crafted, { getTrait })["weapon.remoteAll"] === true;
}

/** What links with a Remote Control in this system: a Bomb, a Collar. */
export const REMOTE_LINKS = Object.freeze(["bomb", "shock-collar"]);

/** What setting something off from it costs: the Remote Control's own, and an Action for a Weapon. */
export function remoteCost(item) {
  return Number(item?.system?.placeCost)
    || (((item?.system?.crafted?.kind === "weapon") || (item?.system?.itemType === "buddy")) ? 1 : 0);
}

/** Whether a Weapon has Quick Draw. */
export function quickDraws(item, getTrait = null) {
  return weaponSlots(item?.system?.crafted, { getTrait })["weapon.quickDraw"] === true;
}

/** The Sheath/Holster a character wears with nothing in it, to put a Weapon away in. */
export function emptySheath(items) {
  return (items ?? []).find(item => (item.system?.gearId === "sheath-holster") && item.system?.equipped
    && !(items ?? []).some(other => other.system?.crafted?.sheathedIn === item.id)) ?? null;
}

/**
 * What drawing a Weapon, or putting it away, leaves - the changes to it. Drawn: Quick Draw's "if
 * your next Maneuver is an Attacking Maneuver, increase the Strike Roll ... by 1(T)", and - out of
 * a Sheath/Holster, the first time this Combat Encounter - "increase your next Strike Roll made
 * for an Armed Attack with that Weapon during this Combat Round by 2(T)". Put away: Quick Draw's
 * "increase the Wound Roll of the next Attacking Maneuver you would make with this Weapon by
 * 2(T)", and into the Sheath/Holster if one is offered.
 */
export function drawChanges(actor, item, drawing, { getTrait = null, sheath = null, round = 0 } = {}) {
  const crafted = item?.system?.crafted ?? {};
  const quick = quickDraws(item, getTrait);
  if (drawing) {
    const fromSheath = Boolean(crafted.sheathedIn);
    const firstKey = `encounter:sheath.${item.id}`;
    // "For the first time in a Combat Encounter" - so only in one.
    const first = fromSheath && (round > 0) && !(actor?.system?.usedManeuvers ?? []).includes(firstKey);
    return {
      item: { "system.equipped": true, "system.crafted.sheathedIn": "",
        "system.crafted.drawn.quick": quick, "system.crafted.drawn.sheath": first,
        "system.crafted.drawn.round": first ? round : 0 },
      firstKey: first ? firstKey : ""
    };
  }
  return {
    item: { "system.equipped": false, "system.crafted.sheathedIn": sheath?.id ?? "",
      "system.crafted.drawn.quick": false, "system.crafted.drawn.sheath": false,
      ...(quick ? { "system.crafted.drawn.sheathedWound": true } : {}) },
    firstKey: ""
  };
}

/**
 * What the next Maneuver takes of what drawing and putting away left, as rows shaped like the
 * Modifier Maneuvers' - `{id, name, strikePerTier, woundPerTier}` - and the changes spending them.
 * Any Maneuver spends Quick Draw's Strike, on an attack or not; the others wait for an attack with
 * that Weapon, the Sheath/Holster's within the Round it was drawn.
 */
export function drawnBonuses(items, { attacking = false, weaponId = "", round = 0 } = {}) {
  const rows = [];
  const spent = [];
  for (const item of items ?? []) {
    const drawn = item.system?.crafted?.drawn;
    if (!drawn || (item.system.crafted.kind !== "weapon")) continue;
    const changes = {};
    if (drawn.quick) {
      if (attacking) rows.push({ id: "quick-draw", name: `Quick Draw (${item.name})`, strikePerTier: 1, woundPerTier: 0 });
      changes["system.crafted.drawn.quick"] = false;
    }
    if (attacking && (item.id === weaponId)) {
      if (drawn.sheath && (drawn.round === round)) {
        rows.push({ id: "sheath-holster", name: "Sheath/Holster", strikePerTier: 2, woundPerTier: 0 });
        changes["system.crafted.drawn.sheath"] = false;
      }
      if (drawn.sheathedWound) {
        rows.push({ id: "quick-draw", name: `Quick Draw (${item.name})`, strikePerTier: 0, woundPerTier: 2 });
        changes["system.crafted.drawn.sheathedWound"] = false;
      }
    }
    if (Object.keys(changes).length) spent.push({ _id: item.id, ...changes });
  }
  return { rows: rows.map(row => ({ damageCategoryShift: 0, note: "", atApparel: false, atWeapon: null, ...row })), spent };
}

/**
 * The Sheath/Holster at a Combat Encounter's end: "if you sheathe your Weapon into this Accessory,
 * that Weapon regains 1/4 of its Life Points. This effect does not apply if the Weapon is
 * destroyed." A quarter of its most, rounded down.
 */
export function sheathMending(actor, getTrait = null) {
  const items = Array.from(actor?.items ?? []);
  return items.filter(item => (item.system?.crafted?.kind === "weapon") && item.system.crafted.sheathedIn
    && !item.system.crafted.destroyed && ((Number(item.system.crafted.lifeLost) || 0) > 0)
    && items.some(other => other.id === item.system.crafted.sheathedIn))
    .map(item => {
      const most = craftedReading(item.system.crafted, { getTrait, difficulties: {}, data: actor.system })?.lifeMax ?? 0;
      return { item, lifeLost: Math.max(0, (Number(item.system.crafted.lifeLost) || 0) - Math.floor(most / 4)) };
    });
}

// --- Buddies -------------------------------------------------------------------------------------
//
// A Buddy is an Item given from a file in traits/gear/buddies/. One is Active at a time, called
// and dismissed as an Instant Maneuver on its owner's turn. Its file's script is what it does:
// its Buddy Effect's lines under `if ($active == 1)`, its Adventure Effect's under
// `if (adventuring)`. A Greater Buddy is its Original Buddy and more: both files' scripts run.

/** "A Buddy Attribute is equal to the Attribute Score Limit at your base Tier of Power." */
export function buddyAttribute(baseTier) {
  return 8 + ((Math.max(1, Number(baseTier) || 1) - 1) * 3);
}

/** The Buddies a character has, destroyed ones among them. */
export function buddiesOf(items) {
  return (items ?? []).filter(item => (item.type === "gear") && (item.system?.itemType === "buddy"));
}

/** The one Active: "You can only have one Buddy active at any one time." */
export function activeBuddy(items) {
  return buddiesOf(items).find(item => item.system.buddy?.active && !item.system.buddy?.destroyed) ?? null;
}

/**
 * The files a Buddy is, its Original Buddy's first: a Greater Buddy "possess[es] an elevated
 * version of the capabilities of a normal Buddy" - all of its Original's, by the table's ruling,
 * and its own. `original: ride-buddy`, or `any` and the one chosen when it was gained.
 */
export function buddyLine(item, getTrait) {
  const own = getTrait?.(item?.system?.gearId);
  if (!own) return [];
  const said = String(own.original ?? "").trim().toLowerCase();
  const originalId = (said === "any") ? String(item.system?.buddy?.original ?? "") : said;
  const original = originalId ? getTrait?.(originalId) : null;
  return [original, own].filter(Boolean);
}

/** One header, read off the Buddy's own file first and its Original's after. */
export function buddyHeader(item, getTrait, key) {
  for (const trait of buddyLine(item, getTrait).reverse()) {
    if ((trait?.[key] !== undefined) && (trait[key] !== null) && (trait[key] !== "")) return trait[key];
  }
  return undefined;
}

/**
 * A Buddy's scripts as they run for its owner: its Original's and its own, with what they name
 * written in - `$active` (1 while it is Active), `$buddyAttribute`, `$skill` (a Skill Buddy's),
 * `$flyin` / `$dodgin` (a Ride Buddy's choice), `$shiftedRide` (a Shifting Buddy that became a
 * Ride Buddy this Combat Round). A line naming `skill.$insightSkill` is written once for every
 * Skill that uses Insight. A Spirit's Skill Ranks and base Tier are written out as lines of their
 * own. A destroyed Buddy runs nothing.
 *
 * @param {object} context  `baseTier`, `round` (the Combat Round, 0 out of one), `skills` (the
 *                          Skill table), `spirit` (the Spirit's Actor, where there is one)
 */
export function buddyScript(item, getTrait, { baseTier = 1, round = 0, skills = {}, spirit = null } = {}) {
  const buddy = item?.system?.buddy ?? {};
  if (buddy.destroyed) return "";
  const shiftedRide = (buddy.shiftedTo === "ride") && round && (buddy.shiftRound === round);
  const tokens = {
    active: (buddy.active && !buddy.locked) ? 1 : 0,
    buddyAttribute: buddyAttribute(baseTier),
    flyin: (buddy.ride === "flyin") ? 1 : 0,
    dodgin: (buddy.ride === "dodgin") ? 1 : 0,
    shiftedRide: shiftedRide ? 1 : 0
  };
  const insight = Object.entries(skills).filter(([, skill]) => skill.attribute === "insight").map(([key]) => key);
  let script = buddyLine(item, getTrait).map(trait => String(trait.script ?? "")).join("\n\n");
  script = script.split("\n").flatMap(line => line.includes("skill.$insightSkill")
    ? insight.map(key => line.replace("skill.$insightSkill", `skill.${key}`)) : [line]).join("\n");
  if (script.includes("$skill")) script = buddy.skill ? script.replaceAll("$skill", buddy.skill) : "";
  for (const name of Object.keys(tokens).sort((a, b) => b.length - a.length)) {
    script = script.replaceAll(`$${name}`, String(tokens[name]));
  }
  // The Guiding Spirit's: "increase your Skill Bonus for your Skills by the number of Skill Ranks
  // your Spirit has in each of those Skills and increase your Combat Rolls by 1(bT) - using the
  // base Tier of Power of your Spirit" - and, Adventuring, the Skill Ranks alone.
  if (buddyHeader(item, getTrait, "spirit") === true && spirit) {
    const ranks = Object.entries(spirit.system?.skills ?? {})
      .map(([key, skill]) => [key, Number(skill?.ranks) || 0]).filter(([, value]) => value > 0)
      .map(([key, value]) => `  skill.${key} += ${value};`);
    const spiritTier = Math.max(1, Number(spirit.system?.baseTierOfPower) || 1);
    script += `\n\n[passive]\nif (${tokens.active} == 1) {\n  combatRolls += ${spiritTier};\n`
      + `${ranks.join("\n")}\n}\n`
      + (ranks.length ? `if (adventuring) {\n${ranks.join("\n")}\n}\n` : "");
  }
  return script;
}

/**
 * What a Buddy's row offers to use, with what each costs: its Activated Buddy Effect - once a
 * Combat Round - and, for a Shifting Buddy that became a Ride or Assault Buddy this Round, that
 * one's as well. `key` is what it does: assault, heal, ride, shift, zeno.
 */
export function buddyActions(item, getTrait, round = 0) {
  const buddy = item?.system?.buddy ?? {};
  if (!buddy.active || buddy.destroyed || buddy.locked) return [];
  const actions = [];
  const own = String(buddyHeader(item, getTrait, "buddyAction") ?? "");
  const kind = key => ({
    assault: { label: "Attack", maneuverType: "standard", actionCost: 1 },
    heal: { label: "Heal", maneuverType: "standard", actionCost: 1 },
    ride: { label: "Ride", maneuverType: "standard", actionCost: 1 },
    shift: { label: "Shift", maneuverType: "instant", actionCost: 0 },
    zeno: { label: "Erase", maneuverType: "standard", actionCost: 1 }
  })[key];
  if (kind(own)) {
    actions.push({ key: own, form: false, ...kind(own),
      maneuverType: String(buddyHeader(item, getTrait, "maneuverType") ?? kind(own).maneuverType),
      actionCost: Number(buddyHeader(item, getTrait, "actionCost") ?? kind(own).actionCost) });
  }
  // "Your Buddy can use the Buddy Effect of a Ride Buddy" - or an Assault Buddy's - this Round.
  if ((own === "shift") && round && (buddy.shiftRound === round) && kind(buddy.shiftedTo)
    && (buddy.shiftedTo !== "weapon")) {
    actions.push({ key: buddy.shiftedTo, form: true, ...kind(buddy.shiftedTo) });
  }
  return actions;
}

/** The key a use of a Buddy's Effect is recorded under, for "once per Combat Round". */
export function buddyUseKey(item, form = false) {
  return `round:${form ? "buddyform" : "buddy"}.${item?.id ?? ""}`;
}

/**
 * Why a Shifting Buddy cannot shift now, or "": "can only use their Buddy Effect 3 times per Combat
 * Encounter and cannot use their Buddy Effect if they used it during the last Combat Round" - a
 * Studied Shifting Buddy, `shiftLimit: 0`, neither.
 */
export function shiftProblem(actor, item, getTrait, round = 0) {
  const limit = Number(buddyHeader(item, getTrait, "shiftLimit") ?? 3);
  if (!limit || !round) return "";
  const used = (actor?.system?.usedManeuvers ?? []).filter(entry => entry === `encounter:shift.${item.id}`).length;
  if (used >= limit) return `Shifted ${limit} times this Combat Encounter already.`;
  if (item.system.buddy?.shiftRound === (round - 1)) return "It shifted last Combat Round.";
  return "";
}

/** How far a Ride Buddy - or a Greater one of it - carries its owner: its Buddy Attribute, and more. */
export function rideSquares(item, getTrait, baseTier = 1) {
  return buddyAttribute(baseTier) + (Number(buddyHeader(item, getTrait, "rideBonus")) || 0);
}

/** Whether its owner is small enough to ride it: "Large or lower", a Cruise Buddy's "Gigantic". */
export function rideFits(item, getTrait, sizeKey, sizes = []) {
  const most = String(buddyHeader(item, getTrait, "rideSize") ?? "large");
  const at = sizes.indexOf(sizeKey);
  return (at < 0) || (at <= sizes.indexOf(most));
}

/**
 * What was chosen for a Buddy, said: its Original Buddy, its Profile, Skill, Flyin' or Dodgin',
 * Technique, Spirit - for its row.
 */
export function buddyChoiceLabel(item, getTrait, { profiles = {}, skills = {}, techniqueName = "" } = {}) {
  const buddy = item?.system?.buddy ?? {};
  return [
    buddy.original ? (getTrait?.(buddy.original)?.name ?? buddy.original) : "",
    buddy.profile ? (profiles[buddy.profile]?.label ?? buddy.profile) : "",
    buddy.skill ? (skills[buddy.skill]?.label ?? buddy.skill) : "",
    { flyin: "Flyin'", dodgin: "Dodgin'" }[buddy.ride] ?? "",
    techniqueName,
    buddy.spiritName ? `Spirit: ${buddy.spiritName}` : ""
  ].filter(Boolean).join(" · ");
}

/**
 * The Signature Techniques that are a Buddy's and nobody else's - a Warrior Buddy's, "usable only
 * through the Buddy" by the table's ruling - by their Maneuver Item's id.
 */
export function buddyOnlyTechniques(items, getTrait) {
  return buddiesOf(items).filter(item => buddyHeader(item, getTrait, "chooses") === "profileOrTechnique")
    .map(item => item.system.buddy?.technique).filter(Boolean);
}

/**
 * The Buddy a Called Shot may claim as its target on this character: their Active one - "Make a
 * Called Shot against a Character with an Active Buddy, claiming the Buddy as the target" - unless
 * it "cannot be targeted by a Called Shot" (the Guiding Spirit, the Invincibuddy, Zen-O).
 */
export function targetableBuddy(items, getTrait) {
  const buddy = activeBuddy(items);
  if (!buddy || (buddyHeader(buddy, getTrait, "calledShotImmune") === true)) return null;
  return buddy;
}

/**
 * Flyin' Buddy's "If you already had access to the Soar Maneuver, then increase your Dodge Rolls
 * by 2(bT) when this Buddy is targeted by a Called Shot" - already, by anything but this Buddy:
 * the Skill Ranks that open it, or an Item that gives it - the Jetpack.
 */
export function soarElsewhere(actor, buddy) {
  const bySkill = (actor?.system?.specialManeuvers ?? []).some(entry => (entry.maneuver === "soar") && entry.open);
  const byItem = Array.from(actor?.items ?? []).some(item => (item !== buddy) && (item.type === "gear")
    && (item.system?.grantsManeuver === "soar")
    && ((item.system?.itemType !== "accessory") || item.system?.equipped));
  return bySkill || byItem;
}

/**
 * Why a Buddy cannot be called now, or "": destroyed, kept from it for the Encounter, or another
 * one Active - "You can only have one Buddy active at any one time" - which is dismissed first.
 */
export function callProblem(items, item) {
  const buddy = item?.system?.buddy ?? {};
  if (buddy.destroyed) return "Destroyed.";
  if (buddy.locked) return "It cannot be called again this Combat Encounter.";
  const other = activeBuddy(items);
  if (other && (other !== item)) return `${other.name} is Active: dismiss it first.`;
  return "";
}

/** How many Snacks a Shishkebab still gives this Combat Encounter, and its key for each. */
export function snacksLeft(actor, item, getTrait = null) {
  const most = applySlot(weaponSlots(item?.system?.crafted, { getTrait }), "weapon.snacks", 0);
  if (!most) return 0;
  if (!game?.combat?.started) return most;
  const used = (actor?.system?.usedManeuvers ?? []).filter(entry => entry === snackKey(item)).length;
  return Math.max(0, most - used);
}
export function snackKey(item) {
  return `encounter:snack.${item?.id ?? ""}`;
}

/** The Item a Remote Control is connected to, if the character still has it. */
export function connectedItem(items, remote) {
  const id = remote.system?.connectedTo;
  return id ? ((items ?? []).find(item => item.id === id) ?? null) : null;
}

/**
 * What a Remote Control reaches: a Collar wherever it is worn - on anybody, since putting it
 * on somebody else is what it is for - and otherwise the connected Item among the holder's own.
 *
 * @returns {{item: object, wearer: object|null}|null} the Item, and who it was found on when
 *          that was looked for among every character
 */
export function connectedTarget(remote, items, actors = []) {
  const pair = remote.system?.connectedPair;
  if (pair) {
    const found = [];
    for (const actor of actors ?? []) {
      for (const item of Array.from(actor.items ?? [])) {
        if ((item.type === "gear") && (item.system?.pairId === pair)) found.push({ item, wearer: actor });
      }
    }
    // The one being worn, where there are copies of it about.
    const worn = found.find(entry => entry.item.system?.equipped) ?? found[0];
    if (worn) return worn;
  }
  const own = connectedItem(items, remote);
  return own ? { item: own, wearer: null } : null;
}

/**
 * Whether a Remote Control can set off what it is connected to now: a Bomb, placed, set to
 * be Remote Controlled - or a Collar, worn.
 */
export function canTrigger(target) {
  if (target?.system?.shock?.part) return Boolean(target.system.equipped);
  return Boolean(target?.system?.placed) && (target.system.trigger === "remote")
    && Boolean(target.system.detonation?.profile);
}

/**
 * What a Collar's shock takes: "reduce your Life Points by 1/5 of your Maximum Life Points".
 * Rounded down, as a Life Point reduction is.
 */
export function shockAmount(collar, wearer) {
  const part = Number(collar?.system?.shock?.part) || 0;
  return part ? Math.floor((Number(wearer?.system?.life?.max) || 0) / part) : 0;
}

/**
 * The Item a Capsule holds, among a character's Items, or null.
 *
 * Found by the mark on the held Item rather than kept on the Capsule: the held Item stays an
 * Item of the character's, so it can be read, renamed and thrown out whole.
 */
export function heldBy(items, capsule) {
  return (items ?? []).find(item => item.system?.storedIn === capsule.id) ?? null;
}

/**
 * Whether an Item is inside a Capsule the character still has.
 *
 * A Capsule removed with something in it leaves that Item marked with a Capsule that is no
 * longer there - and an Item held by nothing is an Item in the character's hands.
 */
export function isStored(items, item) {
  const id = item.system?.storedIn;
  return Boolean(id) && (items ?? []).some(other => other.id === id);
}

/**
 * What a Capsule can take: the character's Basic Items and Accessories, not a Capsule, not
 * one already inside a Capsule, and not an Accessory being worn - that is taken off first.
 *
 * "You can store any Basic Item into a Capsule ... You cannot store a living thing or a
 * Capsule within a Capsule."
 */
export function storable(items, capsule) {
  return (items ?? []).filter(item => (item.id !== capsule.id)
    && (item.type === "gear")
    && (GEAR_TYPES[item.system?.itemType]?.list === "basic")
    && !item.system?.capsule
    && !item.system?.equipped
    && !isStored(items, item));
}

/**
 * Dice an Item rolls, scaled by a character's Tier.
 *
 * "1d4(bT)" is a d4 per base Tier of Power - the count multiplies and the die does not,
 * which is how every Tier-scaled roll here reads. The character is the one the dice are
 * about: whoever moves through Caltrops, whoever takes Medicine.
 */
export function tierDice(spec, actor) {
  const [count, faces] = String(spec?.dice ?? "").split("d");
  const n = Number(count) || 0;
  if (!n || !faces) return "";
  const system = actor?.system ?? {};
  const multiplier = (spec.scale === "T") ? (system.tierOfPower ?? 1)
    : (spec.scale === "bT") ? (system.baseTierOfPower ?? 1)
    : 1;
  const total = n * Math.max(1, multiplier);
  return `${total}d${faces}`;
}

/**
 * The dice an Item left on the ground rolls against whoever moves through it - theirs, the
 * one suffering it.
 */
export function hazardFormula(hazard, victim) {
  return tierDice(hazard, victim);
}

/**
 * How many Accessories a character can wear at once.
 *
 * "Accessories are Basic Items that can be equipped and apply benefits while equipped. You
 * can only equip up to 2 Accessories at once. You can spend 1 Action to equip or remove an
 * Accessory."
 */
export const ACCESSORIES_WORN = 2;

/** What equipping or removing an Accessory costs, in Actions. */
export const EQUIP_COST = 1;

/** Whether an Item is an Accessory. */
export function isAccessory(item) {
  return (item?.type === "gear") && (item.system?.itemType === "accessory");
}

/** The Accessories a character is wearing. */
export function wornAccessories(items) {
  return (items ?? []).filter(item => isAccessory(item) && item.system?.equipped);
}

/**
 * Why an Accessory cannot be put on, or "" when it can.
 *
 * "You can only equip up to 2 Accessories at once" and "You cannot wear two of the same
 * Accessory" - the same being the same file, whatever either has been renamed to. One in a
 * Capsule is not to hand.
 */
export function equipProblem(items, item) {
  if (!isAccessory(item)) return `${item?.name ?? "That"} is not an Accessory.`;
  if (item.system.equipped) return "";
  if (isStored(items, item)) return `${item.name} is inside a Capsule.`;
  const worn = wornAccessories(items).filter(other => other.id !== item.id);
  if (worn.some(other => other.system.gearId === item.system.gearId)) {
    return `Already wearing a ${item.name}.`;
  }
  if (worn.length >= ACCESSORIES_WORN) {
    return `Already wearing ${ACCESSORIES_WORN} Accessories.`;
  }
  return "";
}

/**
 * The worn Items that offer a State on entering another, and have not yet: "If you enter the
 * Raging State, you may enter the Determined State until the end of your turn. This effect
 * can only be used once for this Accessory."
 */
export function statesOffered(items, entered) {
  return accessoriesInEffect(items).filter(item => {
    const on = item.system?.entersOn;
    return on?.state && (on.from === entered) && !on.spent;
  });
}

/**
 * The Size Category something worn has shrunk its wearer to, or "" - the Micro Band's.
 *
 * Only while it is worn: an Accessory "apply benefits while equipped", and one taken off
 * takes its Size with it.
 */
export function shrunkSize(items) {
  return accessoriesInEffect(items).find(item => item.system?.shrink?.now)
    ?.system.shrink.now ?? "";
}

/**
 * The Size Categories an Item can shrink its wearer to from where they are: "reduce your
 * Size Category to the Tiny or Nano Size Category" - a reduction, so only the ones smaller
 * than the Size they were built as.
 */
export function shrinkChoices(item, chosen, order) {
  const from = order.indexOf(chosen);
  return (item?.system?.shrink?.to ?? [])
    .filter(key => (order.indexOf(key) >= 0) && ((from < 0) || (order.indexOf(key) < from)));
}

/**
 * Whether an Item is locked on whoever wears it - a Ki-Sealing Handcuff put on: "While
 * wearing this Accessory, you cannot remove this Accessory."
 */
export function lockedOn(item) {
  return Boolean(item?.system?.lock?.locks && item.system.equipped);
}

/**
 * The Item locked on this character that a Key opens - "the correct Key": the one made
 * with that instance, and no other.
 */
export function lockedBy(items, key) {
  const fits = key?.system?.keyFor;
  if (!fits) return null;
  return (items ?? []).find(item => lockedOn(item) && (item.system.lock.id === fits)) ?? null;
}

/**
 * A Key for a locking Item, made with it: "When this Accessory is created, you must create
 * a Key Basic Item for this instance of the Accessory." The Key Basic Item's own entry where there
 * is one: "This Key only works on that chosen target."
 */
export function keyItemFor(lockName, lockId, keyDefinition = null) {
  const made = keyDefinition ? gearItemFrom(keyDefinition) : null;
  return {
    ...(made ?? {}),
    name: `Key (${lockName})`,
    type: "gear",
    img: GEAR_ICON,
    system: { ...(made?.system ?? {}), gearId: made?.system?.gearId ?? "", itemType: "basic", keyFor: lockId,
      description: `<p>Opens the ${lockName} it was made with.</p>` }
  };
}

/**
 * A character's Conditions with a lock's hold put on or taken off: a stack of its
 * Condition and the mark that holds it, together, in one write.
 *
 * On, the stack is added to whatever they had, up to the most there can be. Off, that
 * stack comes off with the mark - "while you're wearing this Accessory" is as long as it
 * lasts.
 */
export function sealedConditions(conditions, lock, on, maxStacks = Infinity) {
  const next = { ...(conditions ?? {}) };
  const had = Number(next[lock.condition]) || 0;
  if (on) {
    if (lock.condition) next[lock.condition] = Math.min(maxStacks, had + 1);
    if (lock.mark) next[lock.mark] = 1;
    return next;
  }
  if (lock.mark) delete next[lock.mark];
  // Only the stack it gave: one they already had at the most there can be was theirs, and
  // stays theirs when it comes off.
  if (lock.condition && (lock.gave !== false)) {
    if (had > 1) next[lock.condition] = had - 1;
    else delete next[lock.condition];
  }
  return next;
}

/**
 * What may stand in for the Damage Attribute of this attack: the worn Accessories that
 * offer an Attribute for it, one per Attribute.
 *
 * "When using the Signature Technique Maneuver, you may use your Personality Modifier for
 * the Damage Attribute of that Attacking Maneuver." `when: signature` is that - an attack
 * made through the Signature Technique Maneuver, which marks what it makes `signature`.
 */
export function damageAttributeOffers(items, maneuver) {
  const offers = [];
  for (const item of accessoriesInEffect(items)) {
    const { attribute, when } = item.system.damageAttribute ?? {};
    if (!attribute) continue;
    if ((when === "signature") && !maneuver?.signature) continue;
    if (offers.some(offer => offer.attribute === attribute)) continue;
    offers.push({ attribute, source: item.name });
  }
  return offers;
}

/**
 * The Accessories whose effects apply: the ones worn, one of each.
 *
 * "... nor benefit from the same Accessory's effects twice (even if it was Integrated)."
 * Two of the same cannot be worn, so the one-of-each here is for the other way there could
 * be two - Integrated, which arrives with the rules that name it. Whatever reads an
 * Accessory's effects reads them from here.
 */
export function accessoriesInEffect(items) {
  const seen = new Set();
  return wornAccessories(items).filter(item => {
    const key = item.system.gearId || item.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
