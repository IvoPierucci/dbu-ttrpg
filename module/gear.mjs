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
  weapon: { label: "Weapon", list: "weapon" }
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
  }
});

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
export function craftedReading(crafted, { getTrait, difficulties, baseTier = 1, data = null }) {
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

  const band = kind.bonus[grade.grade];
  // Slots used, not Qualities counted: "The Quality Slots for an Apparel Quality will explain
  // how many Quality Slots it takes up."
  const entries = qualityEntries(crafted);
  const count = entries.length;
  const used = entries.reduce((sum, entry) =>
    sum + slotsTaken(entry, getTrait?.(entry.id)), 0);
  // What the piece is, as its own Effects say - never its Qualities' files: what they wrote
  // there when they were added, and whatever its owner has written since. Dense Armor's
  // `piece.apparelBonus += 1;`, Durable's `piece.breakValue += 3;`.
  const piece = pieceSlots(crafted, { getTrait, data, perBaseTier: band.perBaseTier });
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
    // Value reduced". Read by the Break Value, which comes with the rest of the Apparel rules.
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
    // A Hardness Value its Effects set outright - Hefty Plating's "is set to 4" - or null
    // where they say nothing about it.
    hardnessValue: piece["piece.hardnessValue"] ? applySlot(piece, "piece.hardnessValue", 0) : null,
    // Everything its Effects said about the piece, by Slot, for whoever reads one of its own.
    piece,
    // The ones its Category does not take: "Apparel Qualities may apply to only certain
    // Apparel Categories." Kept, and inactive.
    misfits: entries.filter(entry => !qualityFits(getTrait?.(entry.id), crafted.category))
      .map(entry => entry.id),
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
  for (const { item } of apparelQualitiesInEffect(items)) {
    const piece = pieceSlots(item.system.crafted, { getTrait });
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
  if (!qualityFits(trait, crafted?.category)) {
    return "category";
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
export function qualityChoices(trait, skills, weathers = {}) {
  // Or a list of its own - Focal's `choices: strike=Strike Rolls, dodge=Dodge Rolls`.
  const own = Object.keys(choiceLabelsOf(trait));
  if (own.length) return own;
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
export function qualityChoiceLabel(trait, choice, skills, weathers = {}) {
  if (!choice) return "";
  return choiceLabelsOf(trait)[choice] ?? weathers?.[choice]?.label ?? skills?.[choice]?.label
    ?? choice;
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
  for (const { item } of apparelQualitiesInEffect(items)) {
    tiers += applySlot(pieceSlots(item.system.crafted, { getTrait, data }),
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
 * Read by the Weights Category and the Doff Bonus, which come with the rest of the Apparel
 * rules.
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
 * Concealment, asked here as its script would. Read by the Weights, which come with the rest
 * of the Apparel rules.
 */
export function weightsPenaltyWaived(item, wearer, getTrait) {
  const piece = pieceSlots(item?.system?.crafted, { getTrait, data: wearer?.system ?? null });
  if (piece["piece.waivesWeightsWhileHoldingBack"] !== true) return false;
  return holdingBackStacks(wearer) > 0;
}

/**
 * The Size Category a piece is: the one it was made for - "Each piece of Apparel is created
 * with a specific Size Category in mind" - or, where Stretching says so, "the current Size
 * Category of this piece of Apparel's wearer". Read by the Size rules, which come with the rest
 * of the Apparel rules.
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
  for (const { item } of apparelQualitiesInEffect(items)) {
    const reading = craftedReading(item.system.crafted, { getTrait, difficulties: {}, baseTier });
    if (!reading?.spikes) continue;
    found.push({ item, amount: reading.bonus ?? 0 });
  }
  return found;
}

/**
 * How many Combat Rounds longer a piece's first Doff Bonus of an Encounter lasts - Segmented
 * Weight's "for each Quality Slot this Quality occupies ... by 1 Combat Round". Read by the
 * Doff Bonus, which comes with the rest of the Apparel rules.
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
export function scriptWithPiece(script, reading) {
  return String(script ?? "").replaceAll("$apparelBonus", String(Number(reading?.perBaseTier) || 0));
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

/** A switched-off part's lines kept as comments, or a switched-on part's given back. */
function switched(body, on) {
  const lines = String(body ?? "").split("\n");
  if (on) return lines.map(line => line.startsWith(OFF) ? line.slice(OFF.length) : line).join("\n");
  return lines.map(line => (!line.trim() || line.startsWith(OFF)) ? line : `${OFF}${line}`).join("\n");
}

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
  if (category) {
    wanted.push({ type: "category", id: category.id, key: `category:${category.id}`,
      flags: [], name: category.name, fresh: () => partBody(category) });
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
    if (part.type === "category") {
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
 * and nobody's where there is no wearer, which leaves such a line unmet.
 */
export function pieceSlots(crafted, { getTrait, data = null, perBaseTier = null } = {}) {
  if (!CRAFTED[crafted?.kind]) return {};
  const band = CRAFTED[crafted.kind].bonus[CRAFTED[crafted.kind].grades[crafted.grade]?.grade];
  const script = scriptWithPiece(effectsOf(crafted, getTrait),
    { perBaseTier: perBaseTier ?? band?.perBaseTier ?? 0 });
  if (!script.trim()) return {};
  let program = pieceCache.get(script);
  if (program === undefined) {
    const built = compileScript(script);
    program = built.errors?.length ? null : built.program;
    pieceCache.set(script, program);
  }
  if (!program) return {};
  return applyPassives([{ program, priority: PRIORITY.talent, sourceName: "", level: 0, stacks: 1 }],
    PHASES.PIECE, { data: data ?? {}, errors: [] }).slots;
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
 * Worn is `equipped`, as an Accessory is; Layers, and which is on top, come with the rest of
 * the Apparel rules. The wearer's Prerequisites are asked in each Quality's own script.
 */
export function apparelQualitiesInEffect(items) {
  return (items ?? [])
    .filter(item => (item.type === "gear") && item.system?.crafted?.kind
      && item.system?.equipped && !isStored(items, item))
    .map(item => ({ item, entries: qualityEntries(item.system.crafted) }));
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
 * A new built Item, at what building one starts at: "Add Apparel" - Standard Clothing,
 * Craftsmanship Grade 1, the Size the character was built as, and no Qualities.
 */
export function craftedItemFrom(kindKey, actor, getTrait) {
  const kind = CRAFTED[kindKey];
  if (!kind) return null;
  const size = actor?.system?.size;
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
          "", { getTrait })
      }
    }
  };
}

/** A list header, from one value or several. */
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
 * The Bomb: "When you create this Basic Item, record your Scholarship Modifier."
 */
export function recordedFrom(definition, actor) {
  const attribute = String(definition?.records ?? "").trim().toLowerCase();
  if (!attribute) return null;
  const modifier = actor?.system?.attributes?.[attribute]?.mod;
  return Number.isFinite(Number(modifier)) ? Number(modifier) : 0;
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
  weapons: ["weapon"]
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
      records: String(definition.records ?? "").trim().toLowerCase(),
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
        hold: String(definition.clashHold ?? "").trim().toLowerCase()
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
      heal: {
        dice: String(definition.healDice ?? ""),
        scale: String(definition.healScale ?? ""),
        // Ki Points as well as Life, each rolled for - the Snack's "Life and Ki Points".
        ki: definition.healKi === true
      },
      oncePerEncounter: definition.oncePerEncounter === true,
      consumed: definition.consumed === true,

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
export function connectable(items, remote) {
  const kinds = remote.system?.connects ?? [];
  return (items ?? []).filter(item => (item.id !== remote.id)
    && kinds.includes(item.system?.gearId));
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
 * a Key Basic Item for this instance of the Accessory."
 */
export function keyItemFor(lockName, lockId) {
  return {
    name: `Key (${lockName})`,
    type: "gear",
    img: GEAR_ICON,
    system: { gearId: "", itemType: "basic", keyFor: lockId,
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
