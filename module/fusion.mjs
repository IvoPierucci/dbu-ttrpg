/**
 * Fusion (the Fusion page and Fusion Methods & Modifiers; the user's, 2026-11-16): a Character made of two or more others - its
 * Fused Characters - as an Actor of its own type, "fusion", on the Character's data model and sheet, without a Progression and with
 * a Fusion tab. What it is made from is copied onto it as it is fused (Character Combination) and taken again as it is fused once
 * more (Repeating Fusions); fusing and splitting on the map and in a Combat, and the Round Limit, are the table's (the user's).
 *
 * This module holds what a Fusion is and how it is worked out. No imports but the races' own reader, so the data model reads it.
 */

import { racialLifeModifier, racialSavingThrows } from "./races.mjs";

/** Whether an Actor is a Fusion. */
export function isFusion(actor) {
  return actor?.type === "fusion";
}

/**
 * The Fusion Methods: their type, Round Limit, how many Fused Characters, and the Method Trait each gives (its file's id).
 * "Fusion Methods are split into two types: Temporary or Lasting."
 */
export const FUSION_METHODS = Object.freeze({
  metamorese: { label: "Metamorese Fusion", type: "temporary", rounds: 10, fused: [2, 2], trait: "metamoran-style" },
  potara: { label: "Potara Fusion", type: "temporary", rounds: 20, fused: [2, 2], trait: "divine-fusion-method" },
  maxi: { label: "Maxi Fusion", type: "temporary", rounds: 1, fused: [5, 5], trait: "maximum-metamorese" },
  merge: { label: "Merge Fusion", type: "lasting", rounds: 0, fused: [2, 4], trait: "bio-fusion" },
  ex: { label: "EX Fusion", type: "lasting", rounds: 0, fused: [2, 2], trait: "fusion-of-fusion-methods" },
  parasitic: { label: "Parasitic Fusion", type: "lasting", rounds: 0, fused: [2, 2], trait: "merged-tuffle" }
});

/** "Temporary. You can select up to 2 Fusion Modifiers ... Lasting. You can select a Fusion Modifier." */
export function modifiersAllowed(method) {
  return (FUSION_METHODS[method]?.type === "temporary") ? 2 : 1;
}

/** The Fusion Awakening Table: Lesser and Greater Awakening Limits by base Tier of Power. */
export const FUSION_AWAKENINGS = Object.freeze({
  1: [3, 1], 2: [4, 2], 3: [5, 3], 4: [6, 3], 5: [7, 4], 6: [8, 5], 7: [10, 6]
});

/** "The Fusion's base Tier of Power does not exceed 7." */
export const FUSION_MAX_BASE_TIER = 7;

/** The Fused Character with the highest Power Level - "for any reference to (bT), use the base ToP of" them. */
export function leadFused(fused = []) {
  return [...fused].sort((a, b) => (Number(b.powerLevel) || 0) - (Number(a.powerLevel) || 0))[0] ?? null;
}

/** A Power Level's base Tier of Power, 1 to 7. */
export function baseTierFor(powerLevel) {
  return Math.min(FUSION_MAX_BASE_TIER, Math.floor((Number(powerLevel) || 1) / 5) + 1);
}

/**
 * Fusion Power Level: "1(bT) higher than the highest Power Level among its Fused Characters, as long as the Power Levels of all
 * Fused Characters are within 5 Power Levels of the highest" - not "if any Fused Character is a Minion" (Minion Fusion); and
 * Synergistic Fusion's "Increase your Power Level by 3". It may pass 30.
 *
 * @returns {{ powerLevel: number, bonus: number, why: string }}
 */
export function fusionPowerLevel(fused = [], { synergistic = false } = {}) {
  const lead = leadFused(fused);
  const highest = Number(lead?.powerLevel) || 1;
  const bT = baseTierFor(highest);
  const close = fused.every(each => (highest - (Number(each.powerLevel) || 0)) <= 5);
  const minion = fused.some(each => each.minion);
  const bonus = (close && !minion) ? bT : 0;
  const why = minion ? "a Minion among them: no increase" : !close ? "not all within 5 Power Levels: no increase" : `+1(bT) = +${bT}`;
  return { powerLevel: highest + bonus + (synergistic ? 3 : 0), bonus, why };
}

/** "The Fusion uses the highest Racial Life Modifier among its Races." */
export function fusionRacialLife(races = []) {
  return races.reduce((best, entry) => Math.max(best, racialLifeModifier(entry.race)), races.length ? -Infinity : 0);
}

/** "... and gains the Racial Saving Throw Bonus of all of its Races." */
export function fusionRacialSaves(races = []) {
  return [...new Set(races.flatMap(entry => racialSavingThrows(entry.race, entry.save ?? "")))];
}

/** Whether a Character is of a race - every one of a Fusion's ("the Fusion gains all the Races (and Subraces)"). */
export function hasRace(actor, race, subrace = "") {
  const system = actor?.system;
  if (!system) return false;
  const all = (isFusion(actor) && (system.fusion?.races ?? []).length) ? system.fusion.races : [{ race: system.race, subrace: system.subrace }];
  return all.some(entry => (entry.race === race) && (!subrace || (entry.subrace === subrace)));
}

/** Size Categories, smallest first. */
const SIZE_ORDER = Object.freeze(["nano", "tiny", "small", "medium", "large", "enormous", "gigantic", "colossal"]);

/** "Any base Size Category within a range between the smallest and largest base Size Categories among the Fused Characters." */
export function sizeRange(fused = []) {
  const at = fused.map(each => SIZE_ORDER.indexOf(each.size || "medium")).filter(index => index >= 0);
  if (!at.length) return ["medium"];
  return SIZE_ORDER.slice(Math.min(...at), Math.max(...at) + 1);
}

/** "Their Alignment should be between the lowest Alignment and the highest Alignment among the Z-Souls of the Fused Characters." */
export function alignmentRange(fused = []) {
  const all = fused.map(each => Number(each.alignment) || 0);
  if (!all.length) return [0];
  const low = Math.min(...all);
  const high = Math.max(...all);
  return Array.from({ length: high - low + 1 }, (each, at) => high - at);
}

/**
 * What the Fusion tab shows (the user's mockup, 2026-11-16): its Fused Characters, Method, Fusion Modifiers, Fusion Power, Technique
 * Points and Fused Technique, and the Awakening Limits.
 *
 * @param {Actor} actor
 * @param {object} lookups   { actorAt(uuid), raceName(id), subraceName(race, sub), sizeLabel(key), alignments, trait(id) }
 */
export function fusionContext(actor, lookups) {
  const system = actor.system;
  const fusion = system.fusion ?? {};
  const fused = fusion.fused ?? [];
  const method = FUSION_METHODS[fusion.method] ?? null;
  const lead = leadFused(fused);
  const power = fusionPowerLevel(fused, { synergistic: (fusion.modifiers ?? []).includes("synergistic-fusion") });
  const races = (fusion.races ?? []).map(entry => [lookups.raceName(entry.race), lookups.subraceName(entry.race, entry.subrace)]
    .filter(Boolean).join(" - ")).filter(Boolean);
  const sizes = sizeRange(fused);
  const alignments = alignmentRange(fused);
  const awakening = FUSION_AWAKENINGS[Math.max(1, Math.min(FUSION_MAX_BASE_TIER, Number(system.baseTierOfPower) || 1))];
  const fusedTechnique = fusion.fusedTechnique ? actor.items?.get?.(fusion.fusedTechnique) : null;
  return {
    fused: fused.map(entry => {
      const now = lookups.actorAt(entry.uuid);
      return { uuid: entry.uuid, name: now?.name ?? entry.name, img: now?.img ?? entry.img, missing: !now,
        race: [lookups.raceName(entry.race), lookups.subraceName(entry.race, entry.subrace)].filter(Boolean).join(" - "),
        powerLevel: entry.powerLevel, size: lookups.sizeLabel(entry.size || "medium"), minion: entry.minion,
        karma: entry.minion ? null : (Number(now?.system?.karma) || 0) };
    }),
    hasFused: fused.length > 0,
    methods: [{ value: "", label: "-", selected: !method },
      ...Object.entries(FUSION_METHODS).map(([value, each]) => ({ value, label: each.label, selected: value === fusion.method }))],
    method: method ? { ...method, temporary: method.type === "temporary", traitName: lookups.trait(method.trait)?.name ?? "",
      fusedSaid: (method.fused[0] === method.fused[1]) ? String(method.fused[0]) : `${method.fused[0]}~${method.fused[1]}` } : null,
    modifiers: { allowed: modifiersAllowed(fusion.method), chosen: (fusion.modifiers ?? []).map(id => ({ id, name: lookups.trait(id)?.name ?? id })) },
    power: {
      powerLevel: Number(fusion.powerLevel) || 1,
      bT: lead ? baseTierFor(lead.powerLevel) : 1,
      leadName: lead?.name ?? "",
      said: lead ? `${lead.powerLevel} ${power.bonus ? `+ 1(bT)` : ""}${(fusion.modifiers ?? []).includes("synergistic-fusion") ? " + 3" : ""}`.trim() : "",
      why: power.why,
      baseTier: system.baseTierOfPower,
      races: races.length ? races : ["-"],
      lifeModifier: system.racialLifeModifier,
      sizes: sizes.map(key => ({ value: key, label: lookups.sizeLabel(key), selected: key === system.size })),
      sizeRange: `${lookups.sizeLabel(sizes[0])} to ${lookups.sizeLabel(sizes[sizes.length - 1])}`,
      alignments: alignments.map(value => ({ value, label: lookups.alignments[value]?.label ?? String(value), selected: value === system.alignment })),
      alignmentRange: `${lookups.alignments[alignments[alignments.length - 1]]?.label ?? ""} to ${lookups.alignments[alignments[0]]?.label ?? ""}`
    },
    tp: { gained: Number(fusion.tpGained) || 0, fusedTechnique: fusedTechnique ? { id: fusedTechnique.id, name: fusedTechnique.name } : null,
      none: Boolean(fusion.noFusedTechnique) },
    awakenings: { lesser: awakening?.[0] ?? 0, greater: awakening?.[1] ?? 0 }
  };
}

/** The highest of each among the Fused: "A Fusion's Attribute Scores are equal to the highest Attribute Score". */
export function highestOf(values = []) {
  return values.reduce((best, value) => Math.max(best, Number(value) || 0), 0);
}
