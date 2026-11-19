/**
 * Transformations: Awakenings, Enhancements, Forms and Evolved Stages (the plan, approved 2026-11-19).
 *
 * Each one is a folder of its own under traits/transformations/<type>/ - its file of the same name, its Transformation Traits in
 * `traits/`, whatever else is its own beside them (effects/traits.mjs transformationPlace) - so that adding one is writing its
 * folder, and nothing here or anywhere in module/ names one.
 *
 * On a character a Transformation is an Item of its own (data/item-transformation.mjs) holding only what is the character's: in
 * use or not, Grade, Stacks, Mastery, what was chosen. What the rules say about it is read from its file here, every time.
 *
 * Aspects (the user's, 2026-11-19): never written into a Transformation. Each Aspect is one file, traits/aspects/<id>.dbu,
 * written against `$level` and `$param`; a Transformation only names them in its `aspects:` header, as its page does, and
 * combineAspects() puts every one in use together - the same for every Transformation there is.
 */

import { getTrait, traitsOfKind } from "./effects/traits.mjs";
import { useTransformationGate } from "./aside.mjs";

export const TRANSFORMATION_TYPE = "transformation";

/** The four kinds, in the tab's order, with what their sections are called. */
export const TRANSFORMATION_KINDS = Object.freeze({
  awakening: "Awakenings",
  enhancement: "Enhancements",
  form: "Forms",
  evolved: "Evolved Stages"
});

/** Which type the folder a Transformation sits in means, where its own `type:` does not say. */
const FOLDER_KINDS = Object.freeze({
  awakenings: "awakening",
  enhancements: "enhancement",
  "forms/alternate": "form",
  "forms/legendary": "form",
  evolved: "evolved"
});

/** The seven Attributes as a Transformation's table names them. */
export const BONUS_ATTRIBUTES = Object.freeze({
  AG: "agility", FO: "force", TE: "tenacity", SC: "scholarship", IN: "insight", MA: "magic", PE: "personality"
});

const listOf = value => String(value ?? "").split(",").map(each => each.trim()).filter(Boolean);
const numbersOf = value => listOf(value).map(Number).filter(Number.isFinite);

// --- Files ---------------------------------------------------------------------------------------------------------------

/** Every Transformation there is - their own files, not their Traits. */
export function transformationFiles() {
  return traitsOfKind("transformations").filter(file => !file.owner && file.transformation);
}

/** A Transformation's file by its id, or null. */
export function transformationFile(id) {
  const file = getTrait(String(id ?? ""));
  return (file && (file.kind === "transformations") && !file.owner && file.transformation) ? file : null;
}

/** A Transformation Item's file, or null. */
export function fileOf(item) {
  return transformationFile(item?.system?.transformationId);
}

/** Awakening, Enhancement, Form or Evolved Stage - its `type:`, or what its folder says. */
export function kindOf(file) {
  const own = String(file?.type ?? "").trim().toLowerCase();
  if (own in TRANSFORMATION_KINDS) return own;
  return FOLDER_KINDS[file?.transformationFolder] ?? "";
}

/** A Form's Form Type - Alternate or Legendary - from its `subtype:` or its folder. */
export function formTypeOf(file) {
  const own = String(file?.subtype ?? "").trim().toLowerCase();
  if ((own === "alternate") || (own === "legendary")) return own;
  if (file?.transformationFolder === "forms/legendary") return "legendary";
  if (file?.transformationFolder === "forms/alternate") return "alternate";
  return "";
}

/** Its Transformation Traits' files, in their order: those in its folder's `traits/`. */
export function traitFilesOf(file) {
  if (!file) return [];
  return traitsOfKind("transformations").filter(each => each.owner === file.transformation)
    .sort((a, b) => ((Number(a.order) || 0) - (Number(b.order) || 0)) || String(a.name).localeCompare(String(b.name)));
}

/**
 * Every Transformation Trait a Transformation has, its Variant's inheritance included: "A Variant inherits all of the Traits of
 * the Transformation it is a Variant of, except those it replaces (the original's name in brackets)" - and (the user's,
 * 2026-11-16) its own Burst Limit, Mastery, Transcendent or Legendary Trait replaces the original's, which it inherits only where
 * it has none of its own; one with Peaked inherits no Mastery Trait. In the original's order, each replaced one where it stood.
 */
export function traitFilesFor(file, depth = 0) {
  const own = traitFilesOf(file);
  const original = (depth < 4) && file?.variantOf ? transformationFile(file.variantOf) : null;
  if (!original) return own;
  const replacing = new Map(own.filter(trait => trait.replaces).map(trait => [String(trait.replaces).toLowerCase(), trait]));
  const ownSlots = new Set(own.map(trait => trait.slot).filter(slot => slot && (slot !== "trait")));
  const peaked = parseAspects(file.aspects).some(aspect => aspect.id === "peaked");
  const merged = [];
  for (const trait of traitFilesFor(original, depth + 1)) {
    const instead = replacing.get(String(trait.name).toLowerCase());
    if (instead) merged.push(instead);
    else if ((trait.slot && (trait.slot !== "trait") && ownSlots.has(trait.slot)) || (peaked && (trait.slot === "mastery"))) continue;
    else merged.push(trait);
  }
  return [...merged, ...own.filter(trait => !merged.includes(trait))];
}

// --- Aspects ---------------------------------------------------------------------------------------------------------------

/** An Aspect's id from its name: "Enhanced Save" is enhanced-save. */
export function aspectId(name) {
  return String(name ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * One Aspect as a page writes it: "Growth (LV3)", "Rampaging (LV G)", "Growth (Level G)", "Draining 2", "Enhanced Save
 * (Impulsive/Corporeal)", "Variant (Evil Aura)". A Mastery Trait's change to them leads with a sign: "-Draining", "+Natural (LV1)".
 *
 * @returns {{id: string, name: string, level: string|null, params: string[], sign: number}}
 */
export function parseAspect(entry) {
  let text = String(entry ?? "").trim();
  let sign = 0;
  if (/^[+-]/.test(text)) {
    sign = (text[0] === "-") ? -1 : 1;
    text = text.slice(1).trim();
  }
  let name = text;
  let level = null;
  let params = [];
  const bracketed = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(text);
  if (bracketed) {
    name = bracketed[1];
    const inner = bracketed[2].trim();
    const levelled = /^(?:LV|Level)\s*([\w]+)$/i.exec(inner);
    if (levelled) level = levelled[1];
    else params = inner.split("/").map(each => each.trim()).filter(Boolean);
  }
  else {
    const trailing = /^(.*?)\s+(\d+|[GMSZ])$/.exec(text);
    if (trailing) {
      name = trailing[1];
      level = trailing[2];
    }
  }
  return { id: aspectId(name), name: name.trim(), level, params, sign };
}

/** A list of them, split on the commas outside brackets. */
export function parseAspects(text) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const character of String(text ?? "")) {
    if (character === "(") depth++;
    if (character === ")") depth = Math.max(0, depth - 1);
    if ((character === ",") && !depth) {
      parts.push(current);
      current = "";
    }
    else current += character;
  }
  parts.push(current);
  return parts.map(each => each.trim()).filter(Boolean).map(parseAspect);
}

/** An Aspect's own file - traits/aspects/<id>.dbu, its id `aspect-<id>` (a State of the same name has the bare one) - or null. */
export function aspectFile(id) {
  const file = getTrait(`aspect-${aspectId(id)}`);
  return (file?.kind === "aspects") ? file : null;
}

/** G, Z, S and M for one Transformation Item: its Grade, Stacks, Stage and Mastery. */
export function lettersOf(item, file = fileOf(item)) {
  return {
    G: Math.max(1, Number(item?.system?.grade) || 1),
    Z: Math.max(0, Number(item?.system?.stacks) || 0),
    S: Math.max(0, Number(file?.stage) || 0),
    M: Math.max(0, Number(item?.system?.mastery) || 0)
  };
}

/** A level as written - "3", "G" - as a number for this Item; one where an Aspect without levels has none. */
function levelOf(written, letters) {
  if (written === null || written === undefined || written === "") return null;
  if (/^\d+$/.test(String(written))) return Number(written);
  return letters[String(written).toUpperCase()] ?? 0;
}

/** A Grade's own line in a Transformation's file - `grade2: stress 10; AG 3(T); aspects Straining` - as its parts. */
export function gradeRow(file, grade) {
  const raw = String(file?.[`grade${Number(grade) || 1}`] ?? "").trim();
  const row = { bonuses: {}, aspects: [], values: {} };
  if (!raw) return row;
  for (const part of raw.split(";").map(each => each.trim()).filter(Boolean)) {
    const [key, ...rest] = part.split(/\s+/);
    const value = rest.join(" ");
    const attributes = key.split("/").map(each => each.toUpperCase());
    if (attributes.every(each => each in BONUS_ATTRIBUTES)) {
      for (const each of attributes) row.bonuses[BONUS_ATTRIBUTES[each]] = value;
    }
    else if (key.toLowerCase() === "aspects") row.aspects = parseAspects(value);
    else row.values[key] = value;
  }
  return row;
}

/**
 * The Aspects one Transformation Item has now: those its file names, its Grade's, and what its Traits had change about them
 * (a Mastery Trait's `aspects: -Draining, +Natural (LV1)`), each with its level for this Item - what it is in use as aside.
 */
export function aspectsOf(item, items = item?.parent?.items) {
  const file = fileOf(item);
  if (!file) return [];
  const letters = lettersOf(item, file);
  const own = [...parseAspects(file.aspects), ...gradeRow(file, letters.G).aspects];
  const changes = Array.from(items ?? []).filter(each => (each.type === "racial") && (each.system?.transformation === item.id)
    && !transformationTraitAside(each, items))
    .flatMap(each => parseAspects(getTrait(each.flags?.["dbu-ttrpg"]?.sourceId ?? "")?.aspects));
  const held = new Map();
  for (const aspect of [...own.map(each => ({ ...each, sign: 1 })), ...changes]) {
    const level = levelOf(aspect.level, letters);
    const had = held.get(aspect.id);
    if (aspect.sign < 0) {
      if (!had) continue;
      // "-Draining" takes it all; "-Draining (LV1)" a level of it.
      if ((level === null) || (had.level === null)) held.delete(aspect.id);
      else if (had.level - level <= 0) held.delete(aspect.id);
      else held.set(aspect.id, { ...had, level: had.level - level });
      continue;
    }
    if (!had) held.set(aspect.id, { id: aspect.id, name: aspect.name, level, params: [...aspect.params] });
    else held.set(aspect.id, { ...had, level: (had.level === null) ? level : had.level + (level ?? 0),
      params: [...new Set([...had.params, ...aspect.params])] });
  }
  return [...held.values()];
}

/**
 * Every Aspect in use on a character, put together as the rules say: "Aspects that are shared are not duplicated, unless they
 * have levels, which are added together (up to their maximum)" - and an Aspect marked `solo` in its file, whose levels are not
 * added between Transformations, the highest of them. What goes in brackets is put together (Enhanced Save's Saves).
 *
 * @returns {Array<{id, name, level, params, from: string[], items: object[], file: object|null}>}
 */
export function combineAspects(actor) {
  const items = Array.from(actor?.items ?? []);
  const combined = new Map();
  for (const item of transformationsInUse(actor)) {
    for (const aspect of aspectsOf(item, items)) {
      const file = aspectFile(aspect.id);
      const had = combined.get(aspect.id);
      if (!had) {
        combined.set(aspect.id, { ...aspect, from: [item.name], items: [item], file });
        continue;
      }
      had.from.push(item.name);
      had.items.push(item);
      had.params = [...new Set([...had.params, ...aspect.params])];
      if ((had.level !== null) || (aspect.level !== null)) {
        had.level = file?.solo ? Math.max(had.level ?? 0, aspect.level ?? 0) : (had.level ?? 0) + (aspect.level ?? 0);
      }
    }
  }
  for (const aspect of combined.values()) {
    const max = Number(aspect.file?.max) || 0;
    if (max && (aspect.level !== null)) aspect.level = Math.min(aspect.level, max);
  }
  return [...combined.values()];
}

/** An Aspect's level among those in use - 0 where it is not in use; 1 for one in use that has no levels. */
export function aspectLevel(actor, id) {
  const found = combineAspects(actor).find(aspect => aspect.id === aspectId(id));
  return found ? (found.level ?? 1) : 0;
}

/** Whether an Aspect is in use. */
export function hasAspect(actor, id) {
  return aspectLevel(actor, id) > 0;
}

/**
 * One Aspect's script, with what it is in use as written in: `$level` its level, a line naming `$param` once for each of
 * its bracketed parts ("save.$param += 1(T);" for Impulsive and Corporeal - "All" is `all`), `$agBonus` the highest Agility
 * Modifier Bonus of the Transformations it came from (High Speed's). Empty where the Aspect has no script (yet).
 */
export function aspectScript(aspect) {
  let script = String(aspect?.file?.script ?? "");
  if (!/^\s*\[/m.test(script)) return "";
  const params = (aspect.params ?? []).map(each => aspectId(each).replace(/-([a-z])/g, (all, letter) => letter.toUpperCase()));
  script = script.split("\n").flatMap(line => line.includes("$param") ? params.map(param => line.replaceAll("$param", param)) : [line])
    .join("\n");
  const agility = (aspect.items ?? []).map(item => bonusesOf(item).agility).filter(Boolean)
    .sort((a, b) => b.coefficient - a.coefficient)[0];
  script = script.replaceAll("$agBonus", agility ? bonusWritten(agility) : "0");
  return script.replaceAll("$level", String(aspect.level ?? 1));
}

// --- Attribute Modifier Bonuses ------------------------------------------------------------------------------------------------

/** A table's cell - "+1(T)", "+2", "G(T)", "*" - as a coefficient and its unit, for one Item. Null for "–" or nothing. */
export function readBonus(written, letters) {
  const text = String(written ?? "").replace(/\s+/g, "").replace(/^\+/, "");
  if (!text || /^[-–—]$/.test(text) || (text === "N/A")) return null;
  const match = /^([0-9]+|[GMSZ])(\((?:b)?T\))?$/i.exec(text);
  if (!match) return null;
  const coefficient = /^\d+$/.test(match[1]) ? Number(match[1]) : (letters[match[1].toUpperCase()] ?? 0);
  return { coefficient, unit: (match[2] ?? "").replace(/[()]/g, "") };
}

/** A bonus as the effects language writes it: 2(T), 3(bT), 1. */
export function bonusWritten(bonus) {
  return bonus.unit ? `${bonus.coefficient}(${bonus.unit})` : String(bonus.coefficient);
}

/**
 * A Transformation Item's Attribute Modifier Bonuses now, by Attribute: its file's table (`bonuses: AG +1(T), FO +1(T)`), a "*"
 * filled from its Grade's line; an Awakening's once for each Stack ("the Attribute Bonuses are added together for each Stack").
 * Higher Scales and Prelude: "+1(T) per Higher Scale (except SC/IN/PE)"; Prelude "-1(T) (min. 1(T))".
 */
export function bonusesOf(item, file = fileOf(item)) {
  if (!file) return {};
  const letters = lettersOf(item, file);
  const row = gradeRow(file, letters.G);
  const table = {};
  for (const part of listOf(file.bonuses)) {
    const [key, ...rest] = part.split(/\s+/);
    const attributes = key.split("/").map(each => each.toUpperCase());
    if (!attributes.every(each => each in BONUS_ATTRIBUTES)) continue;
    for (const each of attributes) table[BONUS_ATTRIBUTES[each]] = rest.join("");
  }
  for (const [attribute, value] of Object.entries(row.bonuses)) table[attribute] = value;
  const scales = Math.max(0, Number(item?.system?.scales) || 0);
  const awakening = kindOf(file) === "awakening";
  const bonuses = {};
  for (const [attribute, written] of Object.entries(table)) {
    const bonus = readBonus(written, letters);
    if (!bonus || !bonus.coefficient) continue;
    if (awakening) bonus.coefficient *= Math.max(0, letters.Z);
    if (bonus.unit === "T") {
      if (scales && !["scholarship", "insight", "personality"].includes(attribute)) bonus.coefficient += scales;
      if (item?.system?.prelude) bonus.coefficient = Math.max(1, bonus.coefficient - 1);
    }
    if (bonus.coefficient) bonuses[attribute] = bonus;
  }
  return bonuses;
}

/** Its bonuses as a script of their own, so that each is named in the hovers by the Transformation it comes from. */
export function bonusScript(item, file = fileOf(item)) {
  const lines = Object.entries(bonusesOf(item, file)).map(([attribute, bonus]) => `${attribute}.mod += ${bonusWritten(bonus)};`);
  return lines.length ? `[passive]\n${lines.join("\n")}` : "";
}

// --- In use ------------------------------------------------------------------------------------------------------------------

/** A character's Transformation Items, in the order they were added. */
export function transformationItems(actor) {
  return Array.from(actor?.items ?? []).filter(item => item.type === TRANSFORMATION_TYPE)
    .sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0));
}

/** Whether one is in use: an Awakening always ("Awakenings: permanent"), any other when it is Active. */
export function inUse(item) {
  const file = fileOf(item);
  if (!file) return false;
  if (kindOf(file) === "awakening") return (Number(item.system?.stacks) || 0) > 0;
  return Boolean(item.system?.active);
}

/** Those in use. */
export function transformationsInUse(actor) {
  return transformationItems(actor).filter(inUse);
}

/**
 * Whether a Transformation's Traits apply now: it is in use; or it is a lower Stage of the Line of a Form in use ("each Stage
 * inherits the Traits of the Stages before it"); or it is the Original Form of an Evolved Stage in use.
 */
function traitsInUse(owner, items) {
  if (inUse(owner)) return true;
  const file = fileOf(owner);
  const line = String(file?.line ?? "");
  const list = Array.from(items ?? []).filter(each => each.type === TRANSFORMATION_TYPE);
  if (line && list.some(each => inUse(each) && (String(fileOf(each)?.line ?? "") === line)
    && ((Number(fileOf(each)?.stage) || 0) > (Number(file?.stage) || 0)))) return "inherited";
  if (list.some(each => inUse(each) && (each.system?.original === owner.id))) return "inherited";
  return false;
}

/**
 * A Transformation Trait set aside, and why - or "" where it applies (aside.mjs asks this). "Outside of the Transformation you
 * don't have its Traits" (the user's), save the Legendary Trait while the Form is Legendary, and an Awakening's, which are always
 * had; the Stacks and the Mastery its number in brackets asks for; a Stage's Mastery Traits are not inherited.
 *
 * One with [Permanent] or [Constant] effects is not set aside outside it: its other effects are left out instead
 * (effectsOutside).
 */
export function transformationTraitAside(item, items = item?.parent?.items) {
  const list = Array.from(items ?? []);
  const owner = list.find(each => each.id === item?.system?.transformation);
  if (!owner) return "transformation";
  const ownerFile = fileOf(owner);
  if (!ownerFile) return "transformation";
  const trait = getTrait(item.flags?.["dbu-ttrpg"]?.sourceId ?? "");
  const kind = kindOf(ownerFile);
  if (trait?.stacks && ((Number(owner.system?.stacks) || 0) < Number(trait.stacks))) return "stacks";
  if (trait?.mastery && ((Number(owner.system?.mastery) || 0) < Number(trait.mastery))) return "mastery";
  if (kind === "awakening") return "";
  if ((trait?.slot === "legendary") && (formTypeOf(ownerFile) === "legendary")) return "";
  const using = traitsInUse(owner, list);
  if ((using === "inherited") && trait?.mastery) return "mastery";
  if (using && ((trait?.slot !== "transcendent") || owner.system?.transcended)) return "";
  return effectsOutside(trait).length ? "" : "outside";
}

/** The effects of a Transformation Trait that hold outside its Transformation: its [Permanent] and its [Constant] ones, by number. */
export function effectsOutside(trait) {
  return [...numbersOf(trait?.permanent), ...numbersOf(trait?.constant)];
}

/**
 * A Transformation Trait's program, with only what applies now: all of it in use; outside, only its [Permanent] and [Constant]
 * effects (each block written `effect N`).
 */
export function transformationTraitProgram(item, program, items = item?.parent?.items) {
  if (!item?.system?.transformation) return program;
  const owner = Array.from(items ?? []).find(each => each.id === item.system.transformation);
  const trait = getTrait(item.flags?.["dbu-ttrpg"]?.sourceId ?? "");
  if (owner && (kindOf(fileOf(owner)) === "awakening")) return program;
  if ((trait?.slot === "legendary") && (formTypeOf(fileOf(owner)) === "legendary")) return program;
  const using = owner ? traitsInUse(owner, items) : false;
  if (using && ((trait?.slot !== "transcendent") || owner.system?.transcended)) return program;
  const kept = new Set(effectsOutside(trait));
  return { ...program, blocks: (program.blocks ?? []).filter(block => kept.has(Number(block.modifiers?.effect) || 0)) };
}

useTransformationGate((item, items) => transformationTraitAside(item, items));

// --- Adding and removing -------------------------------------------------------------------------------------------------------

/**
 * Give a character a Transformation: its Item, then its Transformation Traits as Items of their own. A Trait of a `group` (Traits
 * of which one is chosen - Super Saiyan Style) is not made here: chosen on its row.
 */
export async function addTransformation(actor, id) {
  const file = transformationFile(id);
  if (!actor || !file) return null;
  const sort = Math.max(0, ...transformationItems(actor).map(item => Number(item.sort) || 0)) + 1000;
  const [item] = await actor.createEmbeddedDocuments("Item", [{
    name: file.name,
    type: TRANSFORMATION_TYPE,
    img: file.img || "icons/magic/lightning/bolt-strike-blue.webp",
    sort,
    system: { transformationId: file.id, active: false, stacks: (kindOf(file) === "awakening") ? 1 : 0 }
  }]);
  if (!item) return null;
  await makeTraits(actor, item, file);
  return item;
}

/** Its Traits, as Items - each through the Racial Traits' own adding (Options asked, what it grants given). */
async function makeTraits(actor, item, file) {
  const { addRacialTrait } = await import("./racial.mjs");
  for (const trait of traitFilesFor(file).filter(each => !each.group)) {
    await addRacialTrait(actor, trait, { transformation: item.id });
  }
}

/** Take a Transformation away, with its Traits and whatever they gave (those `grantedBy` them). */
export async function removeTransformation(actor, itemId) {
  const items = Array.from(actor?.items ?? []);
  const traits = items.filter(each => each.system?.transformation === itemId).map(each => each.id);
  const given = items.filter(each => traits.includes(each.flags?.["dbu-ttrpg"]?.grantedBy)).map(each => each.id);
  const ids = [itemId, ...traits, ...given].filter(id => actor.items.has(id));
  if (ids.length) await actor.deleteEmbeddedDocuments("Item", ids);
}
