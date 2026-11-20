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
import { transformationQuestion, useTransformationGate, useTransformationQuestion } from "./aside.mjs";
import { FUSION_AWAKENINGS, FUSION_MAX_BASE_TIER } from "./fusion.mjs";

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
  // Not an Option of one of them (`optionOf`), which is chosen as that one is gained.
  return traitsOfKind("transformations").filter(each => (each.owner === file.transformation) && !each.optionOf)
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

/**
 * An Awakening's Stacks: its own - or, one whose file says they are a Combat Condition's stacks (`stacksFromCondition:` - Absorption's,
 * Unified's, kept as the marks the Absorb and Unify Maneuvers give), that Condition's on its character.
 */
export function stacksOf(item, file = fileOf(item)) {
  if (file?.stacksFromCondition) return Math.max(0, Number(item?.parent?.system?.conditions?.[file.stacksFromCondition]) || 0);
  return Math.max(0, Number(item?.system?.stacks) || 0);
}

/** G, Z, S and M for one Transformation Item: its Grade, Stacks, Stage and Mastery. */
export function lettersOf(item, file = fileOf(item)) {
  return {
    G: Math.max(1, Number(item?.system?.grade) || 1),
    Z: stacksOf(item, file),
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
  const own = [...parseAspects(file.aspects), ...gradeRow(file, letters.G).aspects, ...chosenAspects(item, file)];
  const changes = Array.from(items ?? []).filter(each => (each.type === "racial") && (each.system?.transformation === item.id)
    && !transformationTraitAside(each, items))
    .flatMap(each => {
      const trait = getTrait(each.flags?.["dbu-ttrpg"]?.sourceId ?? "");
      // [Acclimated] (an Evolved Stage's, the user's 2026-11-16): "If the Original Form is Mastered: Remove the Rampaging Aspect from this
      // Evolved Stage" - `aspectsAcclimated:`, read only while the Form it is on is Mastered.
      const acclimated = (kindOf(file) === "evolved") && isMastered(originalFormOf(Array.from(items ?? []).filter(other => other.id !== item.id)))
        ? parseAspects(trait?.aspectsAcclimated) : [];
      return [...parseAspects(trait?.aspects), ...acclimated];
    });
  // Given by a Trait of another of them in use - Divine Candidate (1): "All of your Transformations with the God Ki Aspect gain the
  // Perfect Ki Control Aspect" (`grantsAspect: Perfect Ki Control`, `grantsAspectIf: God Ki` - what the one given it must have).
  const ownIds = new Set(own.map(aspect => aspect.id));
  const given = Array.from(items ?? []).filter(each => (each.type === "racial") && each.system?.transformation
    && (each.system.transformation !== item.id) && !transformationTraitAside(each, items))
    .map(each => getTrait(each.flags?.["dbu-ttrpg"]?.sourceId ?? "")).filter(trait => trait?.grantsAspect)
    .filter(trait => !trait.grantsAspectIf || ownIds.has(aspectId(trait.grantsAspectIf)))
    .flatMap(trait => parseAspects(trait.grantsAspect).map(aspect => ({ ...aspect, sign: 1 })));
  // Given to this one by any Trait or Talent had - `grantsAspectTo:` (aspectsGivenTo).
  given.push(...aspectsGivenTo(item, file, items).map(aspect => ({ ...aspect, sign: 1 })));
  const held = new Map();
  for (const aspect of [...own.map(each => ({ ...each, sign: 1 })), ...changes, ...given]) {
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
    // "Choose between 0~3 levels of the Growth Aspect": none of it at 0.
    if ((level === 0) && /^\d+$/.test(String(aspect.level ?? ""))) continue;
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
  // Draining's T: "the highest Tier of Power Requirement for any Transformation(s) you are currently in".
  const owner = aspect.items?.[0]?.parent;
  const topReq = Math.max(1, ...transformationsInUse(owner).map(item => tierRequirementOf(item, fileOf(item), owner?.items)));
  script = script.replaceAll("$topReq", String(topReq));
  // Absorbed Apparel: "the Apparel Bonus of the highest piece of Apparel you had equipped" as it was entered (its row's `absorbedBonus`).
  const absorbed = Math.max(0, ...(aspect.items ?? []).map(item => Number(rowChoice(item, "absorbedBonus")) || 0));
  script = script.replaceAll("$absorbedBonus", String(absorbed));
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
  // Monstrous Ascension (1): "Choose an Attribute (AG/TE or FO+MA). Increase the Attribute Modifier Bonus of that Attribute(s) by 1(T)" -
  // `bonusChosen: <choice> 1(T)`, its value the Attributes ("ag", "fo-ma").
  const [bonusKey, bonusAmount] = String(file.bonusChosen ?? "").split(/\s+/);
  const extraFor = new Map();
  if (bonusKey) {
    for (const code of String(rowChoice(item, bonusKey)).split("-").map(each => each.toUpperCase()).filter(each => each in BONUS_ATTRIBUTES)) {
      extraFor.set(BONUS_ATTRIBUTES[code], readBonus(bonusAmount, letters));
    }
  }
  for (const [attribute, extra] of extraFor) {
    const had = readBonus(table[attribute], letters);
    if (!extra) continue;
    table[attribute] = had ? `${had.coefficient + extra.coefficient}(${had.unit || extra.unit})` : bonusWritten(extra);
  }
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
  // Weakening: "If your current Ki Point Pool is below 1/4 of your Maximum ... reduce this Transformation's Attribute Modifier Bonuses
  // (after all calculations) by 1/2" (rounded down).
  const ki = item?.parent?.system?.ki;
  // "This does not apply if you entered this Transformation through the Heartbeat Aspect."
  if (ki && !heartbeatOf(item) && (Number(ki.value) < (Number(ki.max) || 0) / 4)
    && aspectsOf(item, item.parent?.items).some(aspect => aspect.id === "weakening")) {
    for (const bonus of Object.values(bonuses)) bonus.coefficient = Math.floor(bonus.coefficient / 2);
  }
  // Fused Transformation (4): "Increase the Attribute Modifier Bonus (AG/FO/TE/MA) of your Fused Form ... Alternate Form: 1(T), Legendary
  // Form: 2(T)" (`fusedFormBonus: alternate 1; legendary 2` on the Fusion Modifier).
  if ((kindOf(file) === "form") && item?.parent) {
    const rule = Array.from(item.parent.items ?? []).map(each => getTrait(each.flags?.["dbu-ttrpg"]?.sourceId ?? "")?.fusedFormBonus).find(Boolean);
    if (rule && fusedFormIds(item.parent).includes(file.id)) {
      const amount = Number(new RegExp(`${formTypeOf(file) || "alternate"}\\s+(\\d+)`).exec(String(rule))?.[1]) || 0;
      for (const attribute of ["agility", "force", "tenacity", "magic"].filter(() => amount)) {
        const had = bonuses[attribute] ?? { coefficient: 0, unit: "T" };
        bonuses[attribute] = { coefficient: had.coefficient + amount, unit: had.unit || "T" };
      }
    }
  }
  // "+N in the three Attributes with the highest Attribute Scores" of each of its Characters (`bonusesPerOwner: top3 N` - an
  // Absorbed Character's +1 a stack, the Possessing Character's or the Past Life's +2). A tie: the first of them.
  const [rule, amount] = String(file.bonusesPerOwner ?? "").split(/\s+/);
  if (rule === "top3") {
    for (const owner of ownersOf(item, file)) {
      const scores = Object.entries(owner.actor?.system?.attributes ?? {}).map(([key, value]) => [key, Number(value?.score) || 0])
        .sort((a, b) => b[1] - a[1]).slice(0, 3);
      for (const [attribute] of scores) {
        const had = bonuses[attribute] ?? { coefficient: 0, unit: "" };
        bonuses[attribute] = { coefficient: had.coefficient + (Number(amount) || 1), unit: had.unit };
      }
    }
  }
  return bonuses;
}

/**
 * The Characters an Awakening is held through - each stack's own (the Absorbed, the Merged), read off its character's flag
 * (`ownersFromFlag:` - the Absorb and Unify Maneuvers' lists) - or the one chosen on its row (`ownerChoice: true` - the Possessing
 * Character, the Past Life). Each { uuid, name, temporary, actor }.
 */
export function ownersOf(item, file = fileOf(item)) {
  const find = uuid => (uuid && globalThis.fromUuidSync) ? globalThis.fromUuidSync(uuid) : null;
  if (file?.ownersFromFlag) {
    return Array.from(item?.parent?.getFlag?.("dbu-ttrpg", file.ownersFromFlag) ?? [])
      .map(entry => ({ uuid: entry?.uuid ?? "", name: entry?.name ?? "", temporary: Boolean(entry?.temporary), actor: find(entry?.uuid) }));
  }
  if (file?.ownerChoice) {
    const uuid = (item?.system?.choices ?? []).find(entry => entry?.key === "owner")?.value ?? "";
    const actor = find(uuid);
    return uuid ? [{ uuid, name: actor?.name ?? uuid, temporary: false, actor }] : [];
  }
  return [];
}

/**
 * A Combat Condition's stacks gained that an Awakening is made of (`stacksFromCondition:`): its Item made where the character has none,
 * so its Traits and bonuses come with it (the Absorb and Unify Maneuvers').
 */
export async function ensureConditionAwakening(actor, conditionKey) {
  const file = transformationFiles().find(each => each.stacksFromCondition === conditionKey);
  if (!actor || !file || transformationItems(actor).some(item => item.system?.transformationId === file.id)) return null;
  return addTransformation(actor, file.id);
}

/** One of an Awakening's Characters let go (Release): off its list, a stack of its Condition with it. */
export async function releaseOwner(actor, itemId, uuid) {
  const item = actor?.items.get(itemId);
  const file = fileOf(item);
  if (!item || !file?.ownersFromFlag) return;
  const list = Array.from(actor.getFlag("dbu-ttrpg", file.ownersFromFlag) ?? []);
  const at = list.findIndex(entry => entry?.uuid === uuid);
  if (at < 0) return;
  list.splice(at, 1);
  await actor.setFlag("dbu-ttrpg", file.ownersFromFlag, list);
  if (file.stacksFromCondition) {
    const { setCondition } = await import("./conditions.mjs");
    await setCondition(actor, file.stacksFromCondition, Math.max(0, (Number(actor.system.conditions?.[file.stacksFromCondition]) || 0) - 1));
  }
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
  if (kindOf(file) === "awakening") return stacksOf(item, file) > 0;
  return Boolean(item.system?.active);
}

/**
 * The Form an Evolved Stage in use is on: the Form you are in (the user's, 2026-11-19) - a Null Stage too, which is not a Form for
 * Stacking but takes Evolved Stages as one. Null where you are in no Form.
 */
export function originalFormOf(items) {
  return Array.from(items ?? []).find(each => (each.type === TRANSFORMATION_TYPE) && each.system?.active && (kindOf(fileOf(each)) === "form")) ?? null;
}

/**
 * What else changes as one Transformation is put in use or by, ticked by hand (the user's) - the changes to the others; null where it
 * may not be done:
 * - an Evolved Stage is ticked and unticked as an Enhancement is, on whatever Form you are in - none, and it may not be entered.
 *   Another Evolved Stage put by, but where either is Pinnacle;
 * - a Form puts any other Form by - an Evolved Stage in use stays, on the Form now in use;
 * - an Enhancement puts any other Enhancement by;
 * - the last Form put by takes the Evolved Stages with it.
 */
export function inUseChanges(items, item, on) {
  const kind = kindOf(fileOf(item));
  const all = Array.from(items ?? []).filter(each => (each.type === TRANSFORMATION_TYPE) && (each.id !== item.id));
  const kindOfEach = each => kindOf(fileOf(each));
  // Pinnacle: "this Evolved Stage may be applied on top of another Evolved Stage of the same Original Form ... it cannot be applied on top
  // of another Evolved Stage with the Pinnacle Aspect"; at level 2 "you may choose whether to apply it" - so two with it go together
  // where one of them is at level 2, its own left aside (my reading).
  const pinnacle = each => {
    const found = parseAspects(fileOf(each)?.aspects).find(aspect => aspect.id === "pinnacle");
    return found ? (Number(found.level) || 1) : 0;
  };
  const together = (a, b) => {
    const [pa, pb] = [pinnacle(a), pinnacle(b)];
    return Boolean(pa || pb) && !(pa && pb && (pa < 2) && (pb < 2));
  };
  const putBy = list => list.map(each => ({ _id: each.id, "system.active": false }));
  if (on && (kind === "evolved")) {
    if (!originalFormOf(all)) return null;
    return putBy(all.filter(each => each.system?.active && (kindOfEach(each) === "evolved") && !together(item, each)));
  }
  if (on && ((kind === "form") || (kind === "enhancement"))) {
    return putBy(all.filter(each => each.system?.active && (kindOfEach(each) === kind)));
  }
  if (!on && (kind === "form") && !originalFormOf(all)) {
    return putBy(all.filter(each => each.system?.active && (kindOfEach(each) === "evolved")));
  }
  return [];
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
  const line = lineOf(file, items);
  const list = Array.from(items ?? []).filter(each => each.type === TRANSFORMATION_TYPE);
  if (line && list.some(each => inUse(each) && (lineOf(fileOf(each), items) === line)
    && (stageOf(fileOf(each), items) > stageOf(file, items)))) return "inherited";
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
  if (trait?.stacks && (stacksOf(owner, ownerFile) < Number(trait.stacks))) return "stacks";
  if (trait?.mastery && ((Number(owner.system?.mastery) || 0) < Number(trait.mastery))) return "mastery";
  if (kind === "awakening") return "";
  // "A Legendary Trait applies only while the Form is Legendary" (the user's, 2026-11-16) - Pure Form's once Pure Chaos makes it one.
  if (trait?.slot === "legendary") return (formTypeFor(owner, list) === "legendary") ? "" : "legendary";
  const using = traitsInUse(owner, list);
  if ((using === "inherited") && trait?.mastery) return "mastery";
  // Prelude: "you do not benefit from the last Transformation Trait of this Transformation while in this Transformation (any Permanent
  // effects are still in effect)".
  if (using && preludeDrops(owner, ownerFile, trait)) return effectsOutside(trait).length ? "" : "prelude";
  if (using && ((trait?.slot !== "transcendent") || owner.system?.transcended)) return "";
  return effectsOutside(trait).length ? "" : "outside";
}

/**
 * Prelude's: the Trait it leaves out - "the last Transformation Trait of this Transformation" in its own list (the user's): not a Mastery,
 * Legendary, Burst Limit or Transcendent Trait, nor one of a group chosen, nor a lower Stage's - while it is entered with Prelude.
 */
export function preludeDrops(owner, file, trait) {
  if (!owner?.system?.prelude || !trait || !file) return false;
  const own = traitFilesOf(file).filter(each => (!each.slot || (each.slot === "trait")) && !each.group);
  return own.length > 0 && (own[own.length - 1].id === trait.id);
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
  if (trait?.slot === "legendary") return (formTypeFor(owner, items) === "legendary") ? program : { ...program, blocks: [] };
  const using = owner ? traitsInUse(owner, items) : false;
  if (using && !preludeDrops(owner, fileOf(owner), trait) && ((trait?.slot !== "transcendent") || owner.system?.transcended)) return program;
  const kept = new Set(effectsOutside(trait));
  return { ...program, blocks: (program.blocks ?? []).filter(block => kept.has(Number(block.modifiers?.effect) || 0)) };
}

/**
 * A Transformation Trait Item's script: its file's, read every time (the plan - a file put right reaches every character that has
 * it), with what was chosen for it as it was gained written in ($choice, $choice2, $choice3; each Option chosen, as its own
 * `#@ option` part) and its Transformation's G, Z, S and M ($G, $Z, $S, $M). An Item whose file is gone keeps its own.
 */
export function transformationTraitScript(item, items = item?.parent?.items) {
  const trait = getTrait(item?.flags?.["dbu-ttrpg"]?.sourceId ?? "");
  if (!trait) return String(item?.system?.script ?? "");
  const chosen = Array.from(item.system?.chosen ?? []);
  const pick = key => chosen.find(entry => entry?.key === key)?.value;
  const written = (source, script) => {
    let text = String(script ?? "");
    for (const [token, key] of [["$choice3", `${source.id}#3`], ["$choice2", `${source.id}#2`], ["$choice", source.id]]) {
      const value = pick(key);
      if (value !== undefined) text = text.replaceAll(token, value);
    }
    return text.trim();
  };
  const parts = [written(trait, trait.script)];
  for (const entry of chosen.filter(each => each?.key === "option")) {
    const option = getTrait(entry.value);
    if (option) parts.push(`#@ option ${option.id} | ${option.name}\n${written(option, option.script)}\n#@ end`);
  }
  const owner = Array.from(items ?? []).find(each => each.id === item.system?.transformation);
  const letters = lettersOf(owner, fileOf(owner));
  // "For each level of the Rampaging Aspect this Transformation possesses" - $aspect.<id>, its level on its Transformation (0 without it).
  const levels = owner ? aspectsOf(owner, items) : [];
  return rowWritten(owner, fileOf(owner), parts.filter(Boolean).join("\n\n"))
    .replace(/\$aspect\.([a-z0-9-]+)/g, (all, id) => String((found => found ? (found.level ?? 1) : 0)(levels.find(aspect => aspect.id === id))))
    .replace(/\$([GZSM])\b/g, (all, letter) => String(letters[letter] ?? 0));
}

useTransformationGate((item, items) => transformationTraitAside(item, items));

/**
 * How a Transformation Trait Item stands now, for the list of them: "in" (all of it applies), "permanent" (its Transformation not
 * in use: its [Permanent] effects alone), "constant" (not in use, with a [Constant] effect to use from outside it), "aside".
 */
export function traitStanding(item, items = item?.parent?.items) {
  if (transformationTraitAside(item, items)) return "aside";
  const list = Array.from(items ?? []);
  const owner = list.find(each => each.id === item?.system?.transformation);
  const trait = getTrait(item.flags?.["dbu-ttrpg"]?.sourceId ?? "");
  const file = fileOf(owner);
  if ((kindOf(file) === "awakening") || ((trait?.slot === "legendary") && (formTypeFor(owner, list) === "legendary"))) return "in";
  if (traitsInUse(owner, list) && !preludeDrops(owner, file, trait)) return "in";
  return numbersOf(trait?.constant).length ? "constant" : "permanent";
}

// --- What the tab shows ------------------------------------------------------------------------------------------------------

/** Its Racial Requirement - "Same as the 1st Stage of this Transformation Line" read off that Stage. */
export function racialRequirementOf(file) {
  const own = String(file?.racial ?? "").trim();
  if (!/^same as/i.test(own) || !file?.line) return own;
  const first = transformationFiles().find(each => (String(each.line ?? "") === String(file.line)) && ((Number(each.stage) || 0) === 1));
  return String(first?.racial ?? own).trim();
}

/** Why a character's Races do not meet its Racial Requirement - said, never refused (the user's) - or "". */
export function racialUnmet(file, races = []) {
  const need = racialRequirementOf(file);
  if (!need || /^any\b/i.test(need) || (kindOf(file) === "evolved")) return "";
  const wanted = aspectId(need);
  return races.map(race => aspectId(race)).includes(wanted) ? "" : `not a${/^[aeiou]/i.test(need) ? "n" : ""} ${need}`;
}

/** The most it may be Mastered: once, a time more for each level of Difficult, and once more for a Transcendent Trait. None if Peaked. */
export function masteryMax(file) {
  const aspects = parseAspects(file?.aspects);
  if (aspects.some(aspect => aspect.id === "peaked") || (kindOf(file) === "awakening")) return 0;
  const difficult = Number(aspects.find(aspect => aspect.id === "difficult")?.level) || 0;
  const transcendent = traitFilesOf(file).some(trait => trait.slot === "transcendent") ? 1 : 0;
  return 1 + difficult + transcendent;
}

/** Its number of Grades, or 0 for one not Graded. */
export function gradesOf(file) {
  return Math.max(0, Number(file?.grades) || 0);
}

/** Its Stress Test Requirement as written for its Grade now - its Grade's line first. */
export function stressOf(item, file = fileOf(item)) {
  const row = gradeRow(file, lettersOf(item, file).G);
  return String(row.values.stress ?? file?.stress ?? "");
}

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

// --- Awakenings ---------------------------------------------------------------------------------------------------------------

/** The Awakening Limit by base Tier of Power (Lesser, Greater): "1 -> 2/1, 2 -> 3/1, 3 -> 4/2, 4 -> 5/2, 5 -> 6/3, 6 -> 7/3, 7 -> 7/4". */
export const AWAKENING_LIMIT = Object.freeze({ 1: [2, 1], 2: [3, 1], 3: [4, 2], 4: [5, 2], 5: [6, 3], 6: [7, 3], 7: [7, 4] });

/**
 * How many Lesser and Greater Awakenings count toward the Awakening Limit, and the Limit - said, never refused (the user's). Each
 * Stack one; a Temporary Awakening's not ("does not count towards your Awakening Limit"); nor one whose file says it is free of
 * it beside another the character has (`limitFreeWith:` - Class Up beside Class Avatar).
 */
export function awakeningCount(actor) {
  const items = transformationItems(actor);
  const had = new Set(items.map(item => item.system?.transformationId));
  const count = { lesser: 0, greater: 0 };
  for (const item of items) {
    const file = fileOf(item);
    if (kindOf(file) !== "awakening") continue;
    if (listOf(file.limitFreeWith).some(id => had.has(id))) continue;
    const type = String(file.subtype ?? "").toLowerCase();
    if (!(type in count)) continue;
    count[type] += Math.max(0, (Number(item.system?.stacks) || 0) - (Number(item.system?.temporaryStacks) || 0));
  }
  const base = Math.min(7, Math.max(1, Number(actor?.system?.baseTierOfPower) || 1));
  // An Adversary "ignores the Awakening Limit"; a Fusion has its own ("Fusion Awakenings": "up to its own limit by base Tier of Power").
  if (actor?.type === "adversary") return { lesser: count.lesser, greater: count.greater, lesserMax: null, greaterMax: null, none: true };
  const [lesser, greater] = (actor?.type === "fusion") ? FUSION_AWAKENINGS[Math.min(FUSION_MAX_BASE_TIER, base)] : AWAKENING_LIMIT[base];
  return { lesser: count.lesser, greater: count.greater, lesserMax: lesser, greaterMax: greater };
}

/** A stack of an Awakening as a Temporary Awakening of a level (Born for Battle (4)'s Zenkai), or the Awakening itself so. */
export async function gainTemporaryAwakening(actor, id, level = 1) {
  const file = transformationFile(id);
  if (!actor || !file || (kindOf(file) !== "awakening")) return null;
  const had = transformationItems(actor).find(item => item.system?.transformationId === file.id);
  if (!had) {
    const item = await addTransformation(actor, file.id);
    return item?.update({ "system.temporaryStacks": 1, "system.temporary": Math.max(1, level) });
  }
  return had.update({ "system.stacks": (Number(had.system.stacks) || 0) + 1,
    "system.temporaryStacks": (Number(had.system.temporaryStacks) || 0) + 1,
    "system.temporary": Math.max(Number(had.system.temporary) || 0, level) });
}

/**
 * "Temporary Awakenings last until the end of the Combat Encounter": a Level 2's Stacks go "without discussion"; a Level 1's the ARC
 * may let stay - kept, said on its row with Keep and End (keepTemporary, endTemporary).
 */
export async function endTemporaryAwakenings(actor) {
  for (const item of transformationItems(actor).filter(each => (Number(each.system?.temporaryStacks) || 0) > 0)) {
    if ((Number(item.system.temporary) || 0) >= 2) await endTemporary(actor, item.id);
  }
}

/** A Temporary Awakening's Stacks kept: no longer temporary. */
export async function keepTemporary(actor, itemId) {
  return actor?.items.get(itemId)?.update({ "system.temporaryStacks": 0, "system.temporary": 0 });
}

/** A Temporary Awakening's Stacks ended - the Awakening with them where they were all it had. */
export async function endTemporary(actor, itemId) {
  const item = actor?.items.get(itemId);
  if (!item) return;
  const left = (Number(item.system.stacks) || 0) - (Number(item.system.temporaryStacks) || 0);
  if (left <= 0) return removeTransformation(actor, item.id);
  return item.update({ "system.stacks": left, "system.temporaryStacks": 0, "system.temporary": 0 });
}

// --- Traits of which some are chosen ---------------------------------------------------------------------------------------------

/**
 * The groups of Traits of which some are chosen on a Transformation (`group:` - Demonic Traits, Super Saiyan Style, Perfect Traits,
 * Domain Traits): how many (its file's `groupPicks: <group> Z` - Perfection's one a Stack - else one), those chosen (its Trait Items)
 * and those that may be.
 */
export function groupsOf(item, items = item?.parent?.items) {
  const file = fileOf(item);
  if (!file) return [];
  const letters = lettersOf(item, file);
  const counts = Object.fromEntries(listOf(file.groupPicks).map(entry => entry.split(/\s+/))
    .map(([group, count]) => [group, /^\d+$/.test(count ?? "") ? Number(count) : (letters[String(count ?? "").toUpperCase()] ?? 1)]));
  const all = traitFilesFor(file).filter(trait => trait.group);
  const groups = [...new Set(all.map(trait => trait.group))];
  const owned = Array.from(items ?? []).filter(each => (each.type === "racial") && (each.system?.transformation === item.id));
  return groups.map(group => {
    const members = all.filter(trait => trait.group === group);
    const chosen = owned.filter(each => members.some(trait => trait.id === each.flags?.["dbu-ttrpg"]?.sourceId));
    const had = new Set(chosen.map(each => each.flags?.["dbu-ttrpg"]?.sourceId));
    return { group, label: String(members[0]?.groupLabel ?? group), picks: counts[group] ?? 1,
      chosen: chosen.map(each => ({ itemId: each.id, name: each.name })),
      offered: members.filter(trait => !had.has(trait.id)).map(trait => ({ id: trait.id, name: trait.name,
        prerequisite: (/\(\d+\)-\[Prerequisite\]:\s*([^\n]*)/.exec(String(trait.text ?? "")) ?? [])[1] ?? "" })) };
  });
}

/** One of a group's Traits chosen: made as its Transformation's Traits are. */
export async function chooseGroupTrait(actor, itemId, traitId) {
  const trait = getTrait(traitId);
  if (!actor || !trait?.group || !actor.items.has(itemId)) return null;
  const { addRacialTrait } = await import("./racial.mjs");
  return addRacialTrait(actor, trait, { transformation: itemId });
}

// --- Entering and leaving (stage 4) ----------------------------------------------------------------------------------------------

/** The Transformations the Transformation Maneuver can enter: Enhancements, Forms and Evolved Stages had. */
export function enterableItems(actor) {
  return transformationItems(actor).filter(item => ["enhancement", "form", "evolved"].includes(kindOf(fileOf(item))));
}

/** A Tier of Power Requirement as a number: "2+" is 2; an Evolved Stage's "+1"/"Same as Original" read off its Original. */
export function tierRequirementOf(item, file = fileOf(item), items = item?.parent?.items, original = undefined) {
  const written = writtenTier(item, file);
  const own = /^(\d+)/.exec(written);
  let tier = own ? Number(own[1]) : 0;
  if (kindOf(file) === "evolved") {
    // "Relative to the Original Form's Tier of Power Requirement - before what changes it, its Higher Scales" (the user's, 2026-11-12):
    // "+1 higher than that of Original Form", "Same as Original Form"; a number of its own (Golden Oozaru's 3+) is that number.
    const on = (original !== undefined) ? original : originalFormOf(Array.from(items ?? []).filter(each => each.id !== item?.id));
    const base = on ? (Number(/^(\d+)/.exec(writtenTier(on))?.[1]) || 0) : 0;
    const plus = /\+\s*(\d+)/.exec(written);
    if (plus && !own) tier = base + Number(plus[1]);
    else if (/same/i.test(written)) tier = base;
  }
  const scales = Math.max(0, Number(item?.system?.scales) || 0);
  return Math.max(0, tier + scales - (item?.system?.prelude ? 1 : 0));
}

/**
 * One Transformation's own Stress Test Requirement at a Grade, with Higher Scales and Prelude: its Grade's line or its file's; Scaling
 * "+2 a Higher Scale", Prelude "-3"; an Evolved Stage's "+N" over its Original Form's (the Form you are in). NaN where none is written.
 */
export function ownStressRequirement(item, { grade, scales, prelude } = {}, items = item?.parent?.items, original = undefined) {
  const file = fileOf(item);
  if (kindOf(file) === "evolved") {
    const on = (original !== undefined) ? original : originalFormOf(Array.from(items ?? []).filter(each => each.id !== item?.id));
    return on ? ownStressRequirement(on, {}, items) + evolvedAdd(item, { grade, scales, prelude }, items) : NaN;
  }
  const g = Math.max(1, Number(grade ?? item?.system?.grade) || 1);
  const written = String(gradeRow(file, g).values.stress ?? file?.stress ?? "").trim();
  const base = Number(/^-?\d+/.exec(written)?.[0]);
  const s = Math.max(0, Number(scales ?? item?.system?.scales) || 0);
  // Pure Chaos (1): "Increase the Stress Test Requirement of this Transformation by 9" - its Traits that apply (`stressAdd:`).
  const added = ownTraitHeaders(item, items, "stressAdd").reduce((sum, value) => sum + (Number(value) || 0), 0);
  return base + added + (2 * s) - ((prelude ?? item?.system?.prelude) ? 3 : 0) - stressTakenOff(item, items);
}

/** A header's values on the Transformation Traits of one Transformation that apply now - set aside, not (a Mastery not reached). */
function ownTraitHeaders(item, items, key) {
  return Array.from(items ?? []).filter(each => (each.type === "racial") && (each.system?.transformation === item?.id))
    .map(each => [each, getTrait(each.flags?.["dbu-ttrpg"]?.sourceId ?? "")])
    .filter(([each, trait]) => (trait?.[key] !== undefined) && (trait.slot !== "legendary") && !transformationTraitAside(each, items))
    .map(([, trait]) => trait[key]);
}

/**
 * An Evolved Stage's own part of a Stress Test Requirement: "Its Stress Test Requirement is a sum over the Original Form's" - its "+N",
 * with its own Higher Scales and Prelude, less what others take off it.
 */
export function evolvedAdd(item, { grade, scales, prelude } = {}, items = item?.parent?.items) {
  const file = fileOf(item);
  const g = Math.max(1, Number(grade ?? item?.system?.grade) || 1);
  const written = String(gradeRow(file, g).values.stress ?? file?.stress ?? "").trim();
  const add = Number(/\+\s*(\d+)/.exec(written)?.[1]) || 0;
  const s = Math.max(0, Number(scales ?? item?.system?.scales) || 0);
  return add + (2 * s) - ((prelude ?? item?.system?.prelude) ? 3 : 0) - stressTakenOff(item, items);
}

/**
 * What a Trait or Talent had takes off one Transformation's Stress Test Requirement (`stressFor: <transformation id> N`, a list) -
 * Searing Anger's "Reduce the Stress Test Requirement for Seething Fury by 2"; a Transformation Trait's while it applies (True God of
 * Time's 4 off Time Power, in Divinity Unleashed). An Evolved Stage's from a Trait of the Form it is on (`stressForOn:` - Legendary
 * Super Saiyan's "the Legendary Evolved Stage with this Transformation as its Original Form").
 */
export function stressTakenOff(item, items = item?.parent?.items) {
  const id = item?.system?.transformationId;
  if (!id) return 0;
  const sum = list => list.reduce((total, rest) => total + (Number(/-?\d+/.exec(rest)?.[0]) || 0), 0);
  const file = fileOf(item);
  let off = sum(grantsFor(items, "stressFor", file));
  if (kindOf(file) === "evolved") {
    const on = originalFormOf(Array.from(items ?? []).filter(each => each.id !== item.id));
    if (on) off += sum(grantsFor(items, "stressForOn", file, each => each.system?.transformation === on.id));
  }
  return Math.abs(off);
}

/**
 * What the Traits and Talents a character has say of one Transformation in a header that names it first - `stressFor: seething-fury 2`,
 * `grantsAspectTo: evil-saiyan Natural (LV2)` - the rest of each entry naming that one. A Transformation Trait set aside, or a Racial Trait
 * set aside, says nothing.
 */
function grantsFor(items, key, file, only = null, item = null) {
  const out = [];
  for (const each of Array.from(items ?? [])) {
    if (!["racial", "talent"].includes(each.type) || (only && !only(each))) continue;
    const trait = getTrait(each.flags?.["dbu-ttrpg"]?.sourceId ?? "");
    if (!trait?.[key]) continue;
    if (each.system?.transformation && transformationTraitAside(each, items)) continue;
    for (const entry of headerEntries(trait[key])) {
      const named = namedEntry(entry);
      if (!named) continue;
      // "This": the Transformation the Trait is of - a Variant's inherited Trait its own ("This Transformation gains the Armored Aspect").
      const own = /^this$/i.test(named.target) ? Boolean(item && each.system?.transformation && (each.system.transformation === item.id))
        : namesTransformation(named.target, file, items);
      if (own) out.push(named.rest);
    }
  }
  return out;
}

/** A header's entries, parted by ";" - a value with commas in it comes as a list, put back together. */
function headerEntries(value) {
  return [].concat(value ?? []).join(", ").split(";").map(part => part.trim()).filter(Boolean);
}

/**
 * One entry naming a Transformation, then what is said of it: "Pure Form = Prelude" (its name or its id, then "="), or the older
 * "pure-form Prelude" (its id, then the rest). Null where it is neither.
 */
function namedEntry(entry) {
  const at = entry.indexOf("=");
  if (at > 0) return { target: entry.slice(0, at).trim(), rest: entry.slice(at + 1).trim() };
  const [first, ...rest] = entry.split(/\s+/);
  return first ? { target: first, rest: rest.join(" ") } : null;
}

/**
 * Whether a name in a header means this Transformation: its id (pure-form), its name (Pure Form), any of a Line ("line:metamorphosis"),
 * or any at all ("any").
 */
export function namesTransformation(target, file, items = []) {
  const wanted = String(target ?? "").trim();
  if (!wanted || !file) return false;
  if (wanted.toLowerCase() === "any") return true;
  if (/^line:/i.test(wanted)) return lineOf(file, items) === aspectId(wanted.slice(5));
  return [file.id, aspectId(file.name)].includes(aspectId(wanted));
}

/**
 * The Aspects every Trait and Talent had gives this Transformation (`grantsAspectTo:`, entries parted by ";"): "<Transformation> = <Aspect(s)>",
 * the Transformation by its name or its id (Pure Form, pure-form), any of a Line ("line:pure-majin") or "any"; the Aspects as a page
 * writes them ("Natural (LV1)", "Enhanced Save (Cognitive)", several parted by ","). And after them, when: "if mastered", "if fully
 * mastered", "if has <Aspect>" - Absolute Chaos (3)'s "Upon mastering Pure Form, it gains the Natural (LV1) Aspect. Increase the level of
 * this Aspect by 1 if it is Fully Mastered". The older "<id> <Aspect>" too (Heart of Evil's).
 */
function aspectsGivenTo(item, file, items) {
  const letters = lettersOf(item, file);
  const own = new Set([...parseAspects(file.aspects), ...gradeRow(file, letters.G).aspects].map(aspect => aspect.id));
  const out = [];
  for (const rest of grantsFor(items, "grantsAspectTo", file, null, item)) {
    const [aspects, when = ""] = rest.split(/\s+if\s+/i);
    const condition = when.trim();
    const lower = condition.toLowerCase();
    if (lower === "mastered") { if (!isMastered(item)) continue; }
    else if (lower === "fully mastered") { if (!isFullyMastered(item)) continue; }
    else if (lower.startsWith("has ")) { if (!own.has(aspectId(condition.slice(4)))) continue; }
    // Anything else, as the effects language reads it - "inState(\"undying\")", "demonicpower.stacks >= 2", "$G >= 3" (its Grade,
    // Stacks, Stage or Mastery written in). Read as the character's Items are gathered: what is worked out later in the same preparing
    // - the Size - is not there yet; a State, a Resource, a Condition is.
    else if (condition) {
      const written = rowWritten(item, file, condition).replace(/\$([GZSM])\b/g, (all, letter) => String(letters[letter] ?? 0));
      if (transformationQuestion("scriptCondition", item?.parent, written) !== true) continue;
    }
    out.push(...parseAspects(aspects));
  }
  return out;
}

/**
 * The Stress Test Requirement to enter one, as the rules put it together: "the Requirement of the Transformation with the highest Stress
 * Test Requirement is increased by 1/2 (rounded down) of the Requirement of the others used with it" - those still in use once it is
 * entered; Step-by-Step - from a Form into another of a higher Tier of Power Requirement, 1 lower (2 within its Line); none to roll
 * where it and every other in use have the Natural Aspect. Each part said, for its window.
 */
export function stressRequirementFor(actor, item, options = {}) {
  const items = Array.from(actor?.items ?? []);
  const file = fileOf(item);
  const kind = kindOf(file);
  const leaving = new Set((inUseChanges(items, item, true) ?? []).filter(change => change["system.active"] === false).map(change => change._id));
  const others = transformationItems(actor).filter(each => (each.id !== item.id) && inUse(each) && !leaving.has(each.id)
    && (kindOf(fileOf(each)) !== "awakening"));
  const worked = combinedRequirement([item, ...others], items, item, options);
  let { requirement } = worked;
  const parts = [...worked.parts];
  // Step-by-Step: in a Form, into another Form of a higher Tier of Power Requirement - 2 lower within its Line. An Evolved Stage is "always
  // 1 Stage higher than its Original Form" and "a part of its Line": from the Form it is on, 2 lower where it asks a higher Tier of Power
  // than all of what it goes on (my reading).
  const formOf = list => list.find(each => kindOf(fileOf(each)) === "form") ?? null;
  const nowIn = transformationItems(actor).filter(each => (each.id !== item.id) && inUse(each));
  if (kind === "form") {
    const from = formOf(nowIn);
    if (from && (tierRequirementOf(item, file, items) > tierRequirementOf(from, fileOf(from), items))) {
      const line = lineOf(file, items);
      const sameLine = Boolean(line) && (lineOf(fileOf(from), items) === line);
      requirement -= sameLine ? 2 : 1;
      parts.push(`Step-by-Step -${sameLine ? 2 : 1}`);
    }
  }
  if (kind === "evolved") {
    const under = nowIn.filter(each => ["form", "evolved"].includes(kindOf(fileOf(each))));
    const top = Math.max(0, ...under.map(each => tierRequirementOf(each, fileOf(each), items)));
    if (under.length && (tierRequirementOf(item, file, items, formOf(under)) > top)) {
      requirement -= 2;
      parts.push("Step-by-Step -2");
    }
  }
  // Natural: every one of them; "an Evolved Stage does not gain ... Natural" from its Original. Narrative Transformation (1): the Form or
  // Line chosen (`naturalForChosen:`) - "You do not need to roll Stress Tests for that Transformation or Transformation Line unless you are
  // using another Transformation in conjunction with them".
  const natural = [item, ...others].every(each => aspectsOf(each, items).some(aspect => aspect.id === "natural"))
    || (!others.length && narrativeFor(item, items));
  return { requirement, parts, natural };
}

/**
 * The Stress Test Requirement of those in use now - for a Stress Test to remain in them (one forced on failing a Steadfast Check, Straining's).
 */
export function stressRequirementInUse(actor) {
  const items = Array.from(actor?.items ?? []);
  const using = transformationsInUse(actor).filter(each => kindOf(fileOf(each)) !== "awakening");
  if (!using.length) return { requirement: NaN, parts: [], natural: true };
  const worked = combinedRequirement(using, items, null, {});
  const natural = using.every(each => aspectsOf(each, items).some(aspect => aspect.id === "natural"));
  return { ...worked, natural };
}

/**
 * Those used together as one Requirement: "the Requirement of the Transformation with the highest Stress Test Requirement is increased by
 * 1/2 (rounded down) of the Requirement of the others used with it". A Form and the Evolved Stages on it are one ("counts as its Original
 * Form for all effects") - the Form's and each Evolved Stage's sum on it (Pinnacle: "the two sums", the user's). One whose file says it
 * is added whole (`stressWhole:` - Autonomous Ultra Instinct's "added completely onto any Transformation used in conjunction with it,
 * rather than being halved, even when it has the lower") is added whole, less `stressLessPerTier:` times the highest Tier of Power
 * Requirement of the others.
 */
function combinedRequirement(list, items, entered, options) {
  const optionsFor = each => ((entered && (each.id === entered.id)) ? options : {});
  const form = list.find(each => kindOf(fileOf(each)) === "form") ?? null;
  const evolved = list.filter(each => kindOf(fileOf(each)) === "evolved");
  const entries = [];
  if (form) {
    const value = ownStressRequirement(form, optionsFor(form), items)
      + evolved.reduce((sum, each) => sum + evolvedAdd(each, optionsFor(each), items), 0);
    entries.push({ name: [form, ...evolved].map(each => each.name).join(" + "), value, whole: false, item: form });
  }
  for (const each of list.filter(one => !["form", "evolved"].includes(kindOf(fileOf(one))))) {
    entries.push({ name: each.name, value: ownStressRequirement(each, optionsFor(each), items), whole: Boolean(fileOf(each)?.stressWhole),
      item: each });
  }
  const valid = entries.filter(entry => Number.isFinite(entry.value));
  for (const entry of valid.filter(one => one.whole)) {
    const per = Number(fileOf(entry.item)?.stressLessPerTier) || 0;
    const rest = valid.filter(one => one !== entry);
    if (per && rest.length) {
      const top = Math.max(0, ...rest.flatMap(one => (one.item === form) ? [form, ...evolved] : [one.item])
        .map(each => tierRequirementOf(each, fileOf(each), items, form)));
      entry.value -= per * top;
      entry.less = per * top;
    }
  }
  const halved = valid.filter(entry => !entry.whole || (valid.length === 1)).sort((a, b) => b.value - a.value);
  const whole = valid.filter(entry => entry.whole && (valid.length > 1));
  const parts = [];
  let requirement = halved[0]?.value ?? 0;
  if (halved.length) parts.push(`${halved[0].name} ${halved[0].value}`);
  for (const other of halved.slice(1)) {
    requirement += Math.floor(other.value / 2);
    parts.push(`half of ${other.name}'s ${other.value}`);
  }
  for (const other of whole) {
    requirement += other.value;
    parts.push(`${other.name}'s ${other.value} whole${other.less ? ` (less ${other.less})` : ""}`);
  }
  if (!valid.length) requirement = NaN;
  return { requirement, parts };
}

/**
 * Entered: in use with what was chosen - Grade, Higher Scales, Prelude, Transcended - and what that puts by (inUseChanges). Null where
 * it may not be (an Evolved Stage in no Form).
 */
export async function enterTransformation(actor, item, { grade, scales, prelude, transcended } = {}) {
  const changes = inUseChanges(Array.from(actor.items), item, true);
  if (!changes) return null;
  const own = { _id: item.id, "system.active": true };
  if (grade !== undefined) own["system.grade"] = Math.max(1, Number(grade) || 1);
  if (scales !== undefined) own["system.scales"] = Math.max(0, Number(scales) || 0);
  if (prelude !== undefined) own["system.prelude"] = Boolean(prelude);
  if (transcended !== undefined) own["system.transcended"] = Boolean(transcended);
  // Linked: "Upon entering this Form, you also enter the listed Enhancement in brackets ... If you were already using an Enhancement, you
  // leave that Enhancement to enter the listed Enhancement" - the one had of that name.
  const linked = aspectsOf(item, actor.items).filter(aspect => aspect.id === "linked").flatMap(aspect => aspect.params)
    .map(name => transformationItems(actor).find(each => (each.system?.transformationId === aspectId(name)) || (aspectId(each.name) === aspectId(name))))
    .filter(each => each && (each.id !== item.id) && (kindOf(fileOf(each)) === "enhancement"));
  for (const enhancement of linked) {
    if (enhancement.system?.active) continue;
    changes.push({ _id: enhancement.id, "system.active": true });
    for (const other of transformationItems(actor).filter(each => each.system?.active && (each.id !== enhancement.id)
      && (kindOf(fileOf(each)) === "enhancement") && !each.system?.transcended)) changes.push({ _id: other.id, "system.active": false });
  }
  const leaving = changes.filter(change => change["system.active"] === false).map(change => actor.items.get(change._id)).filter(Boolean);
  await actor.updateEmbeddedDocuments("Item", [own, ...changes]);
  // What leaving those does - Exhausting, Fading - but into a higher Tier of Power Requirement, Exhausting's exception.
  for (const left of leaving) await leftTransformation(actor, left, { into: item });
  // Bursting: "Upon entering this Transformation, destroy your Top Layer of Apparel" - as the Transformation Maneuver enters it (a tick on its
  // row destroys nothing). Its Apparel Bonus kept on its row (Style of Super Saiyan (4)'s).
  if (aspectsOf(actor.items.get(item.id), actor.items).some(aspect => aspect.id === "bursting")) await burstTopLayer(actor, actor.items.get(item.id));
  return actor.items.get(item.id);
}

/**
 * Left - by the Revert Maneuver, a failed Stress Test, or another taking its place: what its Aspects do as it is left. Exhausting:
 * "Stress Exhaustion and Impediment until the end of your next turn" - not into one of a higher Tier of Power Requirement through the
 * Transformation Maneuver. Fading 1: not again this Encounter (said); Fading 2: access lost.
 */
export async function leftTransformation(actor, item, { into = null } = {}) {
  const items = Array.from(actor.items);
  const aspects = aspectsOf(item, items);
  const level = id => aspects.find(aspect => aspect.id === id)?.level ?? (aspects.some(aspect => aspect.id === id) ? 1 : 0);
  const higher = into && (tierRequirementOf(into, fileOf(into), items) > tierRequirementOf(item, fileOf(item), items));
  if (level("exhausting") && !higher) {
    const { setCondition } = await import("./conditions.mjs");
    await setCondition(actor, "stress-exhaustion", 1);
    await setCondition(actor, "impediment", 1);
  }
  if (level("fading") >= 2) return removeTransformation(actor, item.id);
  if (level("fading") === 1) await item.update({ "system.choices": [...(item.system.choices ?? []).filter(entry => entry.key !== "fadedIn"),
    { key: "fadedIn", value: String(globalThis.game?.combat?.id ?? "none") }] });
}

/** Leave Transformations - the Revert Maneuver's, a failed Stress Test's: put by, and what leaving each does. */
export async function leaveTransformations(actor, ids) {
  // Linked: "If you have to leave the Linked Enhancement due to any effects, also leave this Transformation."
  const leavingIds = new Set(ids);
  for (const each of transformationsInUse(actor).filter(one => !leavingIds.has(one.id))) {
    const links = aspectsOf(each, actor.items).filter(aspect => aspect.id === "linked").flatMap(aspect => aspect.params).map(aspectId);
    if (links.some(link => ids.some(id => { const left = actor.items.get(id); return left && ((left.system?.transformationId === link)
      || (aspectId(left.name) === link)); }))) leavingIds.add(each.id);
  }
  ids = [...leavingIds];
  const items = ids.map(id => actor.items.get(id)).filter(Boolean);
  if (!items.length) return;
  const extra = items.flatMap(item => inUseChanges(Array.from(actor.items), item, false) ?? []);
  await actor.updateEmbeddedDocuments("Item", [...items.map(item => ({ _id: item.id, "system.active": false, "system.prelude": false })),
    ...extra]);
  for (const item of items) await leftTransformation(actor, actor.items.get(item.id) ?? item);
}

/** Whether Fading 1 shut it for this Combat Encounter. */
export function fadedOut(item) {
  const faded = (item?.system?.choices ?? []).find(entry => entry.key === "fadedIn")?.value;
  return Boolean(faded) && (faded === String(globalThis.game?.combat?.id ?? "none"));
}

/** In a Form for Ki Multiplier: a Form or an Evolved Stage in use - not a Null Stage, which has none of a Form's rules but its Traits. */
export function inAForm(actor) {
  return transformationsInUse(actor).some(item => {
    const file = fileOf(item);
    const kind = kindOf(file);
    return (kind === "evolved") || ((kind === "form") && (String(file?.stage ?? "") !== "0"));
  });
}

/** Its Tier of Power Requirement as its file writes it for its Grade - before Higher Scales, Prelude or an Original. */
function writtenTier(item, file = fileOf(item)) {
  return String(gradeRow(file, lettersOf(item, file).G).values.tier ?? file?.tier ?? "").trim();
}

/** Mastered - once or more, or Peaked ("cannot be Mastered, but counts as Mastered"). */
export function isMastered(item) {
  const file = fileOf(item);
  if (!file) return false;
  return parseAspects(file.aspects).some(aspect => aspect.id === "peaked") || ((Number(item.system?.mastery) || 0) >= 1);
}

/** Fully Mastered: "each level of Difficult is an extra Mastery ... all of them is Fully Mastered" - or Peaked. Not the Transcendent Trait's. */
export function isFullyMastered(item) {
  const file = fileOf(item);
  if (!file) return false;
  const aspects = parseAspects(file.aspects);
  if (aspects.some(aspect => aspect.id === "peaked")) return true;
  const difficult = Number(aspects.find(aspect => aspect.id === "difficult")?.level) || 0;
  return (Number(item.system?.mastery) || 0) >= 1 + difficult;
}

/**
 * A Form's Form Type for one in use: its own - an Evolved Stage's "Transformation Type: Same as Original Form" (`subtype: same`) read off
 * the Form it is on.
 */
export function formTypeFor(item, items = item?.parent?.items) {
  const file = fileOf(item);
  // Pure Chaos (1): "Pure Form becomes a Legendary Form" - one of its Traits that applies (`formTypeBecomes:`).
  const becomes = ownTraitHeaders(item, items, "formTypeBecomes")[0];
  if (becomes) return String(becomes).trim().toLowerCase();
  const own = formTypeOf(file);
  if (own || (kindOf(file) !== "evolved")) return own;
  const on = originalFormOf(Array.from(items ?? []).filter(each => each.id !== item?.id));
  return on ? formTypeFor(on, items) : "";
}

/**
 * Its Aspects with its Original Form's, for an Evolved Stage ("it gains the Aspects of the Original Form ... except Prelude, Natural and
 * Scaling") - what asks whether "a Transformation with the Super Saiyan Form Aspect" is the one in use.
 */
export function aspectsWithOriginal(item, items = item?.parent?.items) {
  const own = aspectsOf(item, items);
  if (kindOf(fileOf(item)) !== "evolved") return own;
  const on = originalFormOf(Array.from(items ?? []).filter(each => each.id !== item?.id));
  const ids = new Set(own.map(aspect => aspect.id));
  const theirs = on ? aspectsOf(on, items).filter(aspect => !["prelude", "natural", "scaling"].includes(aspect.id) && !ids.has(aspect.id)) : [];
  return [...own, ...theirs];
}

/**
 * Why an Evolved Stage does not fit the Form it would go on - said, never refused (the user's): Unique to another Form ("only on the Form
 * listed in brackets, and its Variants"), "Original Form is Mastered", "Fully Mastered <Form>". "" where nothing is amiss.
 */
export function evolvedUnmet(item, items = item?.parent?.items) {
  const file = fileOf(item);
  if (kindOf(file) !== "evolved") return "";
  const on = originalFormOf(Array.from(items ?? []).filter(each => each.id !== item?.id));
  if (!on) return "it goes on the Form you are in, and you are in none";
  const onFile = fileOf(on);
  const said = [];
  const unique = /unique\s*\(([^)]+)\)/i.exec(String(file.evolvedType ?? ""));
  if (unique) {
    const wanted = aspectId(unique[1]);
    const names = [onFile?.id, aspectId(onFile?.name), String(onFile?.variantOf ?? "")].map(each => aspectId(each));
    if (!names.includes(wanted)) said.push(`Unique to ${unique[1].trim()}`);
  }
  const prerequisites = String(file.prerequisites ?? "");
  if (/original form is mastered/i.test(prerequisites) && !isMastered(on)) said.push(`${on.name} is not Mastered`);
  const fully = /fully mastered\s+([^,]+)/i.exec(prerequisites);
  if (fully && !isFullyMastered(on)) said.push(`${on.name} is not Fully Mastered`);
  return said.join("; ");
}

// What the effects language asks of Transformations (conditions.mjs), through aside.mjs so that it imports nothing of them:
// - originalMastered / originalFullyMastered: [Acclimated] - "If the Original Form is Mastered (or Fully Mastered)" - the Form in use;
// - aspectInUse: one with that Aspect in use - an Evolved Stage with its Original's ("While in a Transformation with the Super Saiyan Form
//   Aspect").
useTransformationQuestion("originalMastered", actor => isMastered(originalFormOf(actor?.items)));
useTransformationQuestion("originalFullyMastered", actor => isFullyMastered(originalFormOf(actor?.items)));
useTransformationQuestion("aspectInUse", (actor, name) => transformationsInUse(actor)
  .some(item => aspectsWithOriginal(item, actor.items).some(aspect => aspect.id === aspectId(name))));

/**
 * The Normal State: "not using an Enhancement or a Form" - a Null Stage "counts as your Normal State" (Restricted - Untransformed's).
 */
export function inNormalState(actor) {
  return !transformationsInUse(actor).some(item => {
    const file = fileOf(item);
    const kind = kindOf(file);
    return (kind === "enhancement") || (kind === "evolved") || ((kind === "form") && (String(file?.stage ?? "") !== "0"));
  });
}

/**
 * In the Transformation a Restricted - Transformation chose: "enhancement" or "form" (a Form not a Null Stage, which is the Normal State;
 * an Evolved Stage, which counts as its Original); "line:<line>", a Form of that Line; or one by its id - a Variant of it counting as it
 * ("its name counts as the listed one's").
 */
export function inTransformationOf(actor, wanted) {
  const using = transformationsInUse(actor);
  const kinds = item => kindOf(fileOf(item));
  if (wanted === "enhancement") return using.some(item => kinds(item) === "enhancement");
  if (wanted === "form") return using.some(item => (kinds(item) === "evolved")
    || ((kinds(item) === "form") && (String(fileOf(item)?.stage ?? "") !== "0")));
  if (String(wanted).startsWith("line:")) {
    const line = String(wanted).slice(5);
    return using.some(item => (kinds(item) === "form") && (lineOf(fileOf(item), actor?.items) === line));
  }
  return using.some(item => (item.system?.transformationId === wanted) || (String(fileOf(item)?.variantOf ?? "") === wanted));
}

/**
 * The Transformation Line a Form is part of "for your effects": its own, or the one a Trait had puts it in - Emperor (2)'s "All of your
 * Forms with a Racial Requirement of Arcosian are considered to be a part of the Metamorphosis Transformation Line" (`formsOfRaceInLine:
 * <race> <line>`).
 */
export function lineOf(file, items = []) {
  const own = String(file?.line ?? "");
  if (own || (kindOf(file) !== "form")) return own;
  // Absolute Chaos (4): "Pure Form becomes part of the Pure Majin Transformation Line" (`addsToLine: Pure Form = pure-majin 1`).
  const added = lineAddedTo(file, items);
  if (added) return added.line;
  const race = aspectId(racialRequirementOf(file));
  for (const each of Array.from(items ?? [])) {
    if (!["racial", "talent"].includes(each.type)) continue;
    const [forRace, line] = String(getTrait(each.flags?.["dbu-ttrpg"]?.sourceId ?? "")?.formsOfRaceInLine ?? "").split(/\s+/);
    if (forRace && line && (aspectId(forRace) === race)) return line;
  }
  return "";
}

/** A Line, and its Stage there, a Trait had puts a Form in (`addsToLine: <Form> = <line> <stage>`) - or null. */
function lineAddedTo(file, items = []) {
  for (const each of Array.from(items ?? [])) {
    if (!["racial", "talent"].includes(each.type)) continue;
    const trait = getTrait(each.flags?.["dbu-ttrpg"]?.sourceId ?? "");
    for (const entry of headerEntries(trait?.addsToLine)) {
      const named = namedEntry(entry);
      if (!named || !namesTransformation(named.target, file, [])) continue;
      const [line, stage] = named.rest.split(/\s+/);
      if (line) return { line: aspectId(line), stage: Number(stage) || 1 };
    }
  }
  return null;
}

/** Its Stage in its Line - a Trait's `addsToLine:` too. */
export function stageOf(file, items = []) {
  if (String(file?.stage ?? "") !== "") return Number(file.stage) || 0;
  return lineAddedTo(file, items)?.stage ?? 0;
}

/** The highest Tier of Power Requirement among those in use - 0 in none (Conserving Strength's "a Transformation with ... 4+"). */
export function topTierInUse(actor) {
  return Math.max(0, ...transformationsInUse(actor).filter(item => kindOf(fileOf(item)) !== "awakening")
    .map(item => tierRequirementOf(item, fileOf(item), actor?.items)));
}

/**
 * A Transformation deleted any way at all - its Traits with it, and what they gave: kept on no Item it no longer belongs to (a Factor
 * Trait's `grantsTransformation` going, the sidebar).
 */
export function registerTransformationHooks() {
  // Ki at 0 in a Form or Enhancement: said to whoever plays them, from the client that brought it there (chat.mjs kiEmptied).
  Hooks.on("updateActor", async (actor, changes, options, userId) => {
    if ((userId !== game.user.id) || !foundry.utils.hasProperty(changes, "system.ki.value")) return;
    if ((Number(foundry.utils.getProperty(changes, "system.ki.value")) || 0) > 0) return;
    (await import("./chat.mjs")).kiEmptied(actor);
  });
  Hooks.on("deleteItem", async (item, options, userId) => {
    if ((item.type !== TRANSFORMATION_TYPE) || !item.parent || (userId !== game.user.id)) return;
    const actor = item.parent;
    // The Awakening a Possessing Character holds them through gone (the Possess Maneuver's): the possession over (chat.mjs).
    const owner = (item.system?.choices ?? []).find(entry => entry?.key === "owner")?.value;
    if (owner && (actor.getFlag?.("dbu-ttrpg", "possessedBy")?.uuid === owner)) (await import("./chat.mjs")).releasePossession(actor);
    const traits = Array.from(actor.items).filter(each => each.system?.transformation === item.id).map(each => each.id);
    const given = Array.from(actor.items).filter(each => traits.includes(each.flags?.["dbu-ttrpg"]?.grantedBy)).map(each => each.id);
    const ids = [...traits, ...given].filter(id => actor.items.has(id));
    if (ids.length) await actor.deleteEmbeddedDocuments("Item", ids);
  });
}

// More of what the effects language asks (conditions.mjs):
// - inTransformation(id): that one in use - a Variant of it counting (Tail Proficiency's "While in the Oozaru Transformation");
// - inFormOrTranscended: a Form - not a Null Stage - an Evolved Stage, or a Transcended Enhancement (Transformation Training's);
// - inEnhancement: an Enhancement not Transcended (Enhanced Fusion's "a non-Transcended Enhancement");
// - enhancementsAtLeast(n): that many Enhancements in use together (Enhanced Fusion's "2+ Enhancements");
// - transformedTierAtLeast(n): in one asking that Tier of Power or more (Conserving Strength's).
useTransformationQuestion("inTransformation", (actor, id) => inTransformationOf(actor, String(id ?? "")));
useTransformationQuestion("inFormOrTranscended", actor => inTransformationOf(actor, "form")
  || transformationsInUse(actor).some(item => (kindOf(fileOf(item)) === "enhancement") && item.system?.transcended));
useTransformationQuestion("inEnhancement", actor => transformationsInUse(actor)
  .some(item => (kindOf(fileOf(item)) === "enhancement") && !item.system?.transcended));
useTransformationQuestion("enhancementsAtLeast", (actor, n) => transformationsInUse(actor)
  .filter(item => kindOf(fileOf(item)) === "enhancement").length >= (Number(n) || 0));
useTransformationQuestion("transformedTierAtLeast", (actor, n) => topTierInUse(actor) >= (Number(n) || 0));

/** Whether a Trait had names this one, or its Line, as the one with no Stress Tests alone (`naturalForChosen:` - its choice). */
function narrativeFor(item, items) {
  const file = fileOf(item);
  const line = lineOf(file, items);
  return Array.from(items ?? []).some(each => {
    if (each.type !== "racial") return false;
    const trait = getTrait(each.flags?.["dbu-ttrpg"]?.sourceId ?? "");
    if (!trait?.naturalForChosen) return false;
    const chosen = (each.system?.chosen ?? []).find(entry => entry?.key === trait.id)?.value ?? "";
    return Boolean(chosen) && ((chosen === file?.id) || (line && (chosen === `line:${line}`)));
  });
}

/**
 * Fused Transformation: "Any Forms that are possessed by all Fused Characters are known as the 'Fused Form'" - the ids of those, read off
 * the Fusion's Fused Characters (system.fusion.fused); none where they cannot be read.
 */
export function fusedFormIds(actor) {
  const fused = Array.from(actor?.system?.fusion?.fused ?? []).map(entry => globalThis.fromUuidSync?.(entry?.uuid ?? "")).filter(Boolean);
  if (fused.length < 2) return [];
  const formsOf = each => new Set(transformationItems(each).filter(item => kindOf(fileOf(item)) === "form").map(item => item.system?.transformationId));
  const [first, ...rest] = fused.map(formsOf);
  return [...first].filter(id => rest.every(set => set.has(id)));
}
useTransformationQuestion("normalState", actor => inNormalState(actor));
// This is a Super Saiyan (3), Deeper into the Depths (3): a Trait of one in use, wholly in use (not by its [Permanent] effects alone), whose
// file says `superiorAsRaging: true`.
useTransformationQuestion("superiorAsRaging", actor => Array.from(actor?.items ?? []).some(each => (each.type === "racial") && each.system?.transformation
  && getTrait(each.flags?.["dbu-ttrpg"]?.sourceId ?? "")?.superiorAsRaging && (traitStanding(each, actor.items) === "in")));

// --- Choices on its row ----------------------------------------------------------------------------------------------------------

/**
 * What a Transformation asks to be chosen "upon gaining access" (Monster Form's Attribute, Aspect, Saves, Growth and Rampaging) - its file's
 * `choice1:` ... `choice9:`, each "key | Label | value=Label; value=Label" - with what its Item holds for each (`system.choices`), on its row.
 */
export function rowChoicesOf(item, file = fileOf(item)) {
  if (!file) return [];
  return Object.keys(file).filter(key => /^choice\d+$/.test(key)).sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)))
    .map(key => [].concat(file[key]).join(", ").split("|").map(part => part.trim()))
    .filter(([key]) => key)
    .map(([key, label = key, list = ""]) => ({ key, label,
      options: list.split(";").map(part => part.trim()).filter(Boolean).map(part => {
        const [value, shown] = part.split("=").map(each => each.trim());
        return { value, label: shown || value };
      }),
      chosen: rowChoice(item, key) }));
}

/** One of its row's choices, or "". */
export function rowChoice(item, key) {
  return String((item?.system?.choices ?? []).find(entry => entry?.key === `choice:${key}`)?.value ?? "");
}

/** One of its row's choices set (an empty value takes it off). */
export async function setRowChoice(item, key, value) {
  const choices = (item.system.choices ?? []).filter(entry => entry?.key !== `choice:${key}`);
  if (value) choices.push({ key: `choice:${key}`, value: String(value) });
  return item.update({ "system.choices": choices });
}

/**
 * Its row's choices written into a text: $row.<key> its value, $label.<key> its label, $is.<key>.<value> 1 where that one is chosen and 0
 * where not. One not chosen: nothing.
 */
function rowWritten(item, file, text) {
  if (!String(text ?? "").includes("$")) return String(text ?? "");
  const choices = rowChoicesOf(item, file);
  const of = key => choices.find(choice => choice.key === key);
  return String(text)
    .replace(/\$is\.([\w]+)\.([\w-]+)/g, (all, key, value) => (rowChoice(item, key) === value) ? "1" : "0")
    .replace(/\$label\.([\w]+)/g, (all, key) => (choice => choice?.options.find(option => option.value === choice.chosen)?.label ?? "")(of(key)))
    .replace(/\$row\.([\w]+)/g, (all, key) => rowChoice(item, key) || "0");
}

/**
 * The Aspects its row's choices give it (`aspectsChosen:` - "$label.aspect; Enhanced Save ($label.save1/$label.save2); Growth (LV$row.growth)")
 * - one whose choice is not made yet left out.
 */
function chosenAspects(item, file) {
  return headerEntries(file?.aspectsChosen).map(entry => rowWritten(item, file, entry).trim())
    .filter(entry => entry && !/\(\s*LV\s*\)/i.test(entry))
    .map(entry => entry.replace(/\(\s*\/\s*/, "(").replace(/\s*\/\s*\)/, ")").replace(/\(\s*\)/, "").trim())
    .filter(entry => entry && !/^(enhanced save)$/i.test(entry))
    .flatMap(entry => parseAspects(entry));
}

// A Trait or Talent had whose effects say to "Ignore the effects of the <Aspect>" (`ignoresAspect:` - Controlled Monster's Rampaging,
// Overtaken's): its Aspect's own file asks (ignoresAspect).
useTransformationQuestion("ignoresAspect", (actor, id) => Array.from(actor?.items ?? []).some(each => {
  if (!["racial", "talent"].includes(each.type)) return false;
  const trait = getTrait(each.flags?.["dbu-ttrpg"]?.sourceId ?? "");
  if (!trait?.ignoresAspect) return false;
  if (each.system?.transformation && (traitStanding(each, actor.items) !== "in")) return false;
  return headerEntries(trait.ignoresAspect).flatMap(entry => entry.split(",")).map(aspectId).includes(aspectId(id));
}));
// A Trait given by a Transformation Trait "while you are in this Transformation" (Monstrous Ascension's Monstrous and Bestial Traits):
// whether that one applies wholly now.
useTransformationQuestion("traitApplies", (giver, items) => traitStanding(giver, items) === "in");

// --- Aspects about Apparel: Bursting, Absorbed Apparel, Battle Uniform ---------------------------------------------------------

/** Whether a piece of Apparel has the Free Flowing Quality: "not destroyed by the effects of the Bursting Aspect ... nor replaced by a Battle Uniform". */
function freeFlowing(piece) {
  return (piece?.system?.crafted?.qualities ?? []).some(quality => quality?.id === "free-flowing");
}

/** A piece's Apparel Bonus now. */
async function apparelBonusOfPiece(piece, actor) {
  const { craftedReading } = await import("./gear.mjs");
  return Number(craftedReading(piece?.system?.crafted, { getTrait, difficulties: {}, baseTier: actor?.system?.baseTierOfPower ?? 1 })?.bonus) || 0;
}

/** Bursting: the Top Layer destroyed - not Free Flowing - its Apparel Bonus kept on the row. Said. */
async function burstTopLayer(actor, item) {
  const { topLayerPiece, brokenChanges } = await import("./gear.mjs");
  const top = topLayerPiece(Array.from(actor.items ?? []));
  if (!top || freeFlowing(top)) return;
  const bonus = await apparelBonusOfPiece(top, actor);
  await actor.updateEmbeddedDocuments("Item", [{ _id: top.id, ...brokenChanges(top, getTrait), "system.equipped": false, "system.layer": "" }]);
  await setRowChoice(item, "burstBonus", bonus);
  ui.notifications.info(`${item.name}: Bursting - ${top.name} destroyed (Apparel Bonus ${bonus}).`);
}

/** The Apparel worn that a Transformation sets aside: equipped, not Integrated, not Natural Armor - and for a Battle Uniform, not Free Flowing. */
function wornApparel(actor, { uniform = false } = {}) {
  return Array.from(actor.items ?? []).filter(piece => (piece.type === "gear") && (piece.system?.itemType === "apparel") && piece.system?.equipped
    && !piece.system?.integrated && !piece.flags?.["dbu-ttrpg"]?.battleUniformOf && !piece.flags?.["dbu-ttrpg"]?.naturalArmor
    && !(uniform && freeFlowing(piece)));
}

/**
 * Entered: Absorbed Apparel's "You lose all of your equipped Apparel while in this Transformation (it is returned and equipped upon leaving)",
 * the highest Apparel Bonus of it kept; Battle Uniform's "you lose access to your Apparel ... you are equipped with the Apparel described"
 * (`battleUniform:` - "Name | Category | Grade | Qualities", Stretching besides) - a Free Flowing piece kept on. Each piece remembers its Layer
 * and what set it aside.
 */
async function setApparelAside(actor, item) {
  const aspects = aspectsOf(item, actor.items).map(aspect => aspect.id);
  const absorbed = aspects.includes("absorbed-apparel");
  const uniformLine = aspects.includes("battle-uniform") ? String(fileOf(item)?.battleUniform ?? "") : "";
  if (!absorbed && !uniformLine) return;
  const pieces = wornApparel(actor, { uniform: !absorbed });
  if (absorbed && pieces.length) {
    const bonuses = await Promise.all(pieces.map(piece => apparelBonusOfPiece(piece, actor)));
    await setRowChoice(item, "absorbedBonus", Math.max(0, ...bonuses));
  }
  if (pieces.length) await actor.updateEmbeddedDocuments("Item", pieces.map(piece => ({ _id: piece.id, "system.equipped": false, "system.layer": "",
    "flags.dbu-ttrpg.asideFor": { item: item.id, layer: String(piece.system.layer || "top") } })));
  if (uniformLine) {
    const [name, category = "combat-clothing", grade = "1", qualities = ""] = uniformLine.split("|").map(part => part.trim());
    const { craftedItemFrom, composeEffects } = await import("./gear.mjs");
    const data = craftedItemFrom("apparel", actor, getTrait);
    if (!data) return;
    data.name = name || "Battle Uniform";
    const ids = [...new Set([...qualities.split(";").map(each => each.trim()).filter(Boolean), "stretching"])];
    Object.assign(data.system.crafted, { category, grade: Math.max(1, Number(grade) || 1),
      qualities: ids.map(id => ({ id, slots: 0, choice: "", on: false, name: "", free: true, granted: true })) });
    data.system.crafted.effects = composeEffects(data.system.crafted, "", { getTrait });
    data.system.equipped = true;
    data.system.layer = "top";
    data.flags = { "dbu-ttrpg": { battleUniformOf: item.id } };
    await actor.createEmbeddedDocuments("Item", [data]);
  }
}

/** Left: its Battle Uniform gone, and what it set aside worn again on its Layer. */
async function restoreApparel(actor, item) {
  const uniform = Array.from(actor.items ?? []).filter(piece => piece.flags?.["dbu-ttrpg"]?.battleUniformOf === item.id).map(piece => piece.id);
  if (uniform.length) await actor.deleteEmbeddedDocuments("Item", uniform);
  const aside = Array.from(actor.items ?? []).filter(piece => piece.flags?.["dbu-ttrpg"]?.asideFor?.item === item.id);
  if (aside.length) await actor.updateEmbeddedDocuments("Item", aside.map(piece => ({ _id: piece.id,
    "system.equipped": !piece.system?.crafted?.destroyed, "system.layer": piece.flags["dbu-ttrpg"].asideFor.layer, "flags.dbu-ttrpg.asideFor": null })));
  if (rowChoice(item, "absorbedBonus")) await setRowChoice(item, "absorbedBonus", "");
}

// --- Limited --------------------------------------------------------------------------------------------------------------------

/**
 * Limited: "After entering this Transformation through the Transformation Maneuver, you are forced to leave it after N Combat Rounds (N being
 * the level) ... cannot enter it again until the end of your next turn" - the N counted from the Round it was entered (the user's), and said
 * on the card of the Round it runs out at (the user's: a notice). Each line, for that card.
 */
export function limitedNotices(combat) {
  const said = [];
  for (const actor of (combat?.combatants?.contents ?? []).map(each => each.actor).filter(Boolean)) {
    for (const item of transformationsInUse(actor)) {
      const level = aspectsOf(item, actor.items).find(aspect => aspect.id === "limited")?.level ?? 0;
      const [combatId, round] = String(rowChoice(item, "enteredRound")).split(":");
      if (!level || (combatId !== combat.id)) continue;
      if ((Number(combat.round) || 0) - (Number(round) || 0) >= level) {
        said.push(`${actor.name}: ${item.name} is Limited (${level}) - left now; no Stress Exhaustion (but Exhausting's), not entered again till the end of their next turn.`);
      }
    }
  }
  return said;
}

// --- Heartbeat -------------------------------------------------------------------------------------------------------------------

/** What Heartbeat put it in with, where it did: { by: ids put by, grade: the Grade it had } - or null. */
export function heartbeatOf(item) {
  const raw = rowChoice(item, "heartbeat");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/**
 * Heartbeat: "If your Stress Bonus is equal to or higher than the Stress Test Requirement - 4 ... you may enter this Transformation for the
 * duration of any Maneuver you use or that targets you" - no Stress Test, no Legend Realized, no Burst Limit (the user's); "you cannot leave
 * a Transformation to enter one through Heartbeat, unless it's a lower Stage of the same Transformation"; a Graded one already in use, a
 * higher Grade; "you may use Heartbeat a number of times per Combat Round equal to its level". Long Transformation "ignores Heartbeat".
 * Why it may not be, or "".
 */
export function heartbeatRefused(actor, item, grade = undefined) {
  const aspects = aspectsOf(item, actor?.items);
  const level = aspects.find(aspect => aspect.id === "heartbeat")?.level ?? 0;
  if (!level) return "it has no Heartbeat";
  if (aspects.some(aspect => aspect.id === "long-transformation")) return "Long Transformation ignores Heartbeat";
  const round = `${globalThis.game?.combat?.id ?? "none"}:${globalThis.game?.combat?.round ?? 0}`;
  const used = actor.getFlag?.("dbu-ttrpg", "heartbeatRound");
  if (((used?.round === round) ? Number(used.n) || 0 : 0) >= level) return `Heartbeat used ${level} time${(level === 1) ? "" : "s"} this Combat Round`;
  const items = Array.from(actor.items ?? []);
  const graded = inUse(item) && gradesOf(fileOf(item));
  if (inUse(item) && !graded) return "it is in use already";
  const changes = graded ? [] : (inUseChanges(items, item, true) ?? null);
  if (!changes) return "an Evolved Stage goes on the Form you are in";
  const file = fileOf(item);
  const line = lineOf(file, items);
  const leaving = changes.filter(change => change["system.active"] === false).map(change => actor.items.get(change._id)).filter(Boolean);
  if (leaving.some(each => !line || (lineOf(fileOf(each), items) !== line) || (stageOf(fileOf(each), items) >= stageOf(file, items)))) {
    return "Heartbeat leaves no Transformation but a lower Stage of the same";
  }
  const requirement = stressRequirementFor(actor, item, (grade !== undefined) ? { grade } : {}).requirement;
  if (Number.isFinite(requirement) && ((Number(actor.system?.stressBonus) || 0) < requirement - 4)) {
    return `its Stress Test Requirement is ${requirement}: the Stress Bonus must be ${requirement - 4} or more`;
  }
  return "";
}

/** Entered through Heartbeat - for a Maneuver's duration, its use this Round counted; what it put by and its Grade kept to give back. */
export async function heartbeatEnter(actor, item, grade = undefined) {
  const why = heartbeatRefused(actor, item, grade);
  if (why) return void ui.notifications.warn(`${item.name}: ${why}.`);
  const items = Array.from(actor.items ?? []);
  const graded = inUse(item) && gradesOf(fileOf(item));
  const changes = graded ? [] : (inUseChanges(items, item, true) ?? []);
  const by = changes.filter(change => change["system.active"] === false).map(change => change._id);
  const round = `${globalThis.game?.combat?.id ?? "none"}:${globalThis.game?.combat?.round ?? 0}`;
  const used = actor.getFlag?.("dbu-ttrpg", "heartbeatRound");
  await actor.setFlag("dbu-ttrpg", "heartbeatRound", { round, n: ((used?.round === round) ? Number(used.n) || 0 : 0) + 1 });
  await setRowChoice(item, "heartbeat", JSON.stringify({ by, grade: Number(item.system.grade) || 1, wasIn: inUse(item) }));
  await actor.updateEmbeddedDocuments("Item", [{ _id: item.id, "system.active": true,
    ...((grade !== undefined) ? { "system.grade": Math.max(1, Number(grade) || 1) } : {}) }, ...changes]);
}

/** Its Maneuver over: left again - its Grade as it was, the lower Stage it was entered from back in use. */
export async function heartbeatEnd(actor, item) {
  const held = heartbeatOf(item);
  if (!held) return;
  await setRowChoice(item, "heartbeat", "");
  const updates = held.wasIn ? [{ _id: item.id, "system.grade": held.grade }]
    : [{ _id: item.id, "system.active": false }, ...(held.by ?? []).filter(id => actor.items.has(id)).map(id => ({ _id: id, "system.active": true }))];
  await actor.updateEmbeddedDocuments("Item", updates);
}

// --- Beyond, Blutz Wave: said as one is entered ------------------------------------------------------------------------------

/**
 * Beyond: "cannot be used while you have any stacks of Holding Back, unless it is Fully Mastered"; Blutz Wave: "only ... while you possess the
 * Tailed option of Saiyan Heritage" - said, never refused (the user's). "" where neither applies.
 */
export function aspectWarnings(actor, item) {
  const aspects = aspectsOf(item, actor?.items).map(aspect => aspect.id);
  const said = [];
  if (aspects.includes("beyond") && ((Number(actor?.system?.resources?.holdingback?.stacks) || 0) > 0) && !isFullyMastered(item)) {
    said.push("Beyond: not with Holding Back stacks unless Fully Mastered");
  }
  if (aspects.includes("blutz-wave") && actor?.getFlag?.("dbu-ttrpg", "tailLost")) said.push("Blutz Wave: you have no tail");
  return said.join("; ");
}

/** Long Transformation's level of one - the Actions more and the Exploit it brings. */
export function longTransformationLevel(actor, item) {
  return aspectsOf(item, actor?.items).find(aspect => aspect.id === "long-transformation")?.level ?? 0;
}

/**
 * The hooks Aspects need beyond a Trait's script: a Transformation put in use or by - Absorbed Apparel's and Battle Uniform's Apparel, the
 * Round it was entered (Limited's); the tail lost in one with Blutz Wave - "If your tail is removed, you leave this Transformation and suffer
 * from Stress Exhaustion".
 */
export function registerAspectHooks() {
  Hooks.on("updateItem", async (item, changes, options, userId) => {
    if ((item.type !== TRANSFORMATION_TYPE) || !item.parent || (userId !== game.user.id)) return;
    if (!foundry.utils.hasProperty(changes, "system.active")) return;
    const actor = item.parent;
    if (item.system.active) {
      if (game.combat?.started) await setRowChoice(item, "enteredRound", `${game.combat.id}:${game.combat.round ?? 0}`);
      await setApparelAside(actor, item);
    }
    else {
      await restoreApparel(actor, item);
      if (rowChoice(item, "enteredRound")) await setRowChoice(item, "enteredRound", "");
      if (rowChoice(item, "burstBonus")) await setRowChoice(item, "burstBonus", "");
    }
  });
  Hooks.on("updateActor", async (actor, changes, options, userId) => {
    if ((userId !== game.user.id) || !foundry.utils.getProperty(changes, "flags.dbu-ttrpg.tailLost")) return;
    const tailed = transformationsInUse(actor).filter(item => aspectsOf(item, actor.items).some(aspect => aspect.id === "blutz-wave"));
    if (!tailed.length) return;
    const { setCondition } = await import("./conditions.mjs");
    await setCondition(actor, "stress-exhaustion", 1);
    await leaveTransformations(actor, tailed.map(item => item.id));
    ui.notifications.info(`${actor.name}: the tail lost - ${tailed.map(item => item.name).join(", ")} left (Blutz Wave), Stress Exhaustion.`);
  });
}

/**
 * What Heartbeat offers a character now, for a roll window's choice (the user's: on the first roll of a Maneuver's card - the Strike, the
 * answer to an attack, a Clash's side): each Transformation it may enter (its value its id), and a Graded one already in use at each higher
 * Grade ("id:grade").
 */
export function heartbeatOptions(actor) {
  const out = [];
  for (const item of transformationItems(actor)) {
    if (!aspectsOf(item, actor.items).some(aspect => aspect.id === "heartbeat") || heartbeatOf(item)) continue;
    const grades = gradesOf(fileOf(item));
    if (inUse(item) && grades) {
      for (let grade = (Number(item.system.grade) || 1) + 1; grade <= grades; grade++) {
        // A Grade a Mastery opens: offered, what it needs said (the user's: never refused).
        const needs = gradeRow(fileOf(item), grade).values.needs;
        if (!heartbeatRefused(actor, item, grade)) out.push({ value: `${item.id}:${grade}`, label: `${item.name}, Grade ${grade}${needs ? ` (needs ${needs})` : ""}` });
      }
    }
    else if (!heartbeatRefused(actor, item)) out.push({ value: item.id, label: item.name });
  }
  return out;
}

/** The one chosen in a roll window ("id" or "id:grade") entered through Heartbeat. */
export async function takeHeartbeat(actor, value) {
  const [id, grade] = String(value ?? "").split(":");
  const item = id ? actor?.items?.get(id) : null;
  if (!item) return;
  return heartbeatEnter(actor, item, grade ? Number(grade) : undefined);
}
