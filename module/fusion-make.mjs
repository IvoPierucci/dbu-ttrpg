/**
 * Fusing (the Fusion page's Character Combination and Repeating Fusions; the user's, 2026-11-16): a Fusion made, or made again, from
 * its Fused Characters - from a Character's Settings tab ("Fuse") or a Fusion's own tab ("Fuse", "Fuse again (recalculate)").
 *
 * Everything is asked first (with whom, by which Method, and - the first time - its Racial Traits), then done in one go: what is
 * taken from the Fused Characters is copied onto the Fusion. A player who may not make Actors has the GM make it, with what they
 * answered. Fusing and splitting on the map and in a Combat are the table's (the user's).
 */

import DBUCharacterData from "./data/actor-character.mjs";
import { isCharacter, isFusion, isMinion } from "./actor-types.mjs";
import { FUSION_METHODS, baseTierFor, fusionPowerLevel, leadFused, modifiersAllowed } from "./fusion.mjs";
import { isVillainous } from "./racial.mjs";
import { APPAREL_LAYERS, GEAR_ICON, composeEffects, gearItemFrom, qualityInactive } from "./gear.mjs";

/** The flags an Item copied onto a Fusion carries: taken again as it is fused again; its Racial Traits, chosen once and kept. */
export const FUSED_COPY = "fusedCopy";
export const FUSED_RACIAL = "fusedRacial";

/** Where it came from, on what is copied: the Fused Character's uuid. */
export const FUSED_FROM = "fusedFrom";

/** A Fused Character as the Fusion keeps it: who, their Power Level, Race, base Size, Alignment, whether a Minion. */
export function snapshotOf(actor) {
  const source = actor._source?.system ?? {};
  return {
    uuid: actor.uuid,
    name: actor.name,
    img: actor.img ?? "",
    powerLevel: Math.max(1, Number(actor.system?.powerLevel) || 1),
    race: String(actor.system?.race ?? ""),
    subrace: String(actor.system?.subrace ?? ""),
    size: String(source.size ?? actor.system?.size?.chosen ?? actor.system?.size?.key ?? "medium"),
    alignment: Number(actor.system?.alignment) || 0,
    minion: isMinion(actor)
  };
}

/** "The highest Attribute Score for each Attribute among the Fused Characters." */
export function highestScores(actors) {
  return Object.fromEntries(Object.keys(DBUCharacterData.ATTRIBUTE_ABBREVIATIONS).map(key =>
    [key, actors.reduce((best, actor) => Math.max(best, Number(actor.system?.attributes?.[key]?.score) || 0), 0)]));
}

/** "The amount of Skill Ranks in each Skill ... is equal to the highest number of Skill Ranks in that Skill" - one entry a Rank. */
export function highestRanks(actors) {
  const keys = new Set(actors.flatMap(actor => Object.keys(actor.system?.skills ?? {})));
  return [...keys].flatMap(key => {
    const most = actors.reduce((best, actor) => Math.max(best, Number(actor.system?.skills?.[key]?.ranks) || 0), 0);
    return Array.from({ length: most }, () => key);
  });
}

/** Whether an Item is one of the Core Maneuvers every Character carries - the Fusion has its own. */
function coreManeuver(item) {
  return (item.type === "maneuver") && (String(item.system?.source ?? "") === "Core Rule");
}

/** Whether a Racial Trait Item is a race's own (Primary, Secondary, Subrace) - not an Other, Factor or Villainous Trait. */
function raceTrait(item) {
  return (item.type === "racial") && !item.system?.factor && !item.system?.other && !isVillainous(item)
    && !item.flags?.["dbu-ttrpg"]?.grantedBy;
}

/** The Racial Traits a Fusion may choose among: every Fused Character's, each once, Primary / Secondary / Subrace. */
export function racialChoices(actors) {
  const seen = new Map();
  for (const actor of actors) {
    for (const item of Array.from(actor.items ?? []).filter(raceTrait)) {
      const key = item.flags?.["dbu-ttrpg"]?.sourceId || item.name;
      if (seen.has(key)) continue;
      const group = item.system?.subrace ? "subrace" : (String(item.system?.importance ?? "") === "primary") ? "primary" : "secondary";
      seen.set(key, { key, id: item.id, from: actor.uuid, fromName: actor.name, name: item.name, group });
    }
  }
  return [...seen.values()];
}

/** "A Fusion cannot possess more than 7 Racial Traits. Select up to 4 Primary Traits (minimum 2)" - what is off, said (never refused). */
export function racialWarnings(picked) {
  const primary = picked.filter(each => each.group === "primary").length;
  const said = [];
  if (picked.length > 7) said.push(`${picked.length} Racial Traits: no more than 7.`);
  if (primary < 2) said.push(`${primary} Primary Traits: at least 2.`);
  if (primary > 4) said.push(`${primary} Primary Traits: no more than 4.`);
  return said;
}

/**
 * The Items copied onto a Fusion: "all Talents, ... Signature Techniques, and Unique Abilities (including any Advancements)" - each
 * once (two of one Talent are one, Double Dip) - "any Apparel, Accessories, Weapons, and any other Items", and their Other and Factor
 * Traits; not their Core Maneuvers. A Signature Technique or Unique Ability copied comes Free (the user's): none of the Fusion's
 * Technique Points spent on it.
 */
export function copiedItems(actors) {
  const talents = new Set();
  const out = [];
  for (const actor of actors) {
    for (const item of Array.from(actor.items ?? [])) {
      if (coreManeuver(item) || raceTrait(item)) continue;
      const data = item.toObject();
      delete data._id;
      if (item.type === "talent") {
        const key = item.flags?.["dbu-ttrpg"]?.sourceId || item.name;
        if (talents.has(key)) continue;
        talents.add(key);
      }
      else if (item.type === "maneuver") {
        const signature = (data.system?.tags ?? []).includes("signature") && !data.system?.signatureTechnique;
        const unique = Boolean(data.system?.unique);
        // Only what is theirs to bring: a Signature Technique, a Unique Ability. A Maneuver a Trait or Talent gives comes with it.
        if (!signature && !unique) continue;
        if (unique) {
          data.system.unique.free = true;
          data.system.unique.advancements = (data.system.unique.advancements ?? []).map(entry => ({ ...entry, free: true }));
        }
      }
      else if (!["gear", "racial"].includes(item.type)) continue;
      data.flags = { ...(data.flags ?? {}), "dbu-ttrpg": { ...(data.flags?.["dbu-ttrpg"] ?? {}), [FUSED_COPY]: true, [FUSED_FROM]: actor.uuid } };
      out.push(data);
    }
  }
  return out;
}

/** The Racial Trait Items chosen, copied from whoever had them - kept on the Fusion as it is fused again. */
export function racialItems(actors, picked) {
  return picked.map(choice => {
    const actor = actors.find(each => each.uuid === choice.from);
    const item = actor?.items?.get?.(choice.id);
    if (!item) return null;
    const data = item.toObject();
    delete data._id;
    data.flags = { ...(data.flags ?? {}), "dbu-ttrpg": { ...(data.flags?.["dbu-ttrpg"] ?? {}), [FUSED_RACIAL]: true, [FUSED_FROM]: actor.uuid } };
    return data;
  }).filter(Boolean);
}

/**
 * What fusing makes, from the Fused Characters - Character Combination's steps 4, 6, 7, 8 and 10, which are also what Repeating
 * Fusions takes again - and, the first time, its Race, base Size and Alignment.
 *
 * @param {Actor[]} actors   the Fused Characters
 * @param {string} method    a FUSION_METHODS key
 * @param {object} [options]
 * @param {string[]} [options.modifiers]  the Fusion Modifiers it has (Synergistic Fusion's +3 Power Level)
 */
export function fusionPlan(actors, method, { modifiers = [] } = {}) {
  const fused = actors.map(snapshotOf);
  const lead = leadFused(fused);
  const power = fusionPowerLevel(fused, { synergistic: modifiers.includes("synergistic-fusion") });
  const races = [];
  for (const actor of actors) {
    const entry = { race: String(actor.system?.race ?? ""), subrace: String(actor.system?.subrace ?? ""), save: String(actor.system?.racialSavingThrow ?? "") };
    if (entry.race && !races.some(each => (each.race === entry.race) && (each.subrace === entry.subrace))) races.push(entry);
  }
  const allMinions = fused.length > 0 && fused.every(each => each.minion);
  return {
    method,
    modifiers: [...modifiers],
    fused,
    scores: highestScores(actors),
    ranks: highestRanks(actors),
    races,
    powerLevel: power.powerLevel,
    lead,
    // "If a Minion fuses with another Minion, the resultant Fusion is also a Minion (if they had separate Masters, then both Masters
    // may serve as the Master for the Fusion)."
    minion: allMinions,
    masters: allMinions ? [...new Set(actors.map(actor => String(actor.system?.master ?? "")).filter(Boolean))] : [],
    // "The Fusion gains 10(bT) Technique Points" - (bT) "the base ToP of the Fused Character with the highest Power Level".
    bT: lead ? baseTierFor(lead.powerLevel) : 1,
    items: copiedItems(actors),
    // "If all of their Fused Characters had their Life Points below the Injured Health Threshold, set that Fusion's Life Points to 1
    // Life Point above the Bruised Health Threshold."
    allBelowInjured: actors.length > 0 && actors.every(actor => ["injured", "critical"].includes(actor.system?.threshold?.key))
  };
}

/** The Technique Points Character Combination gives: 10(bT), or 15(bT) with no Fused Technique; Dominant Personality doubles it. */
export function combinationTP(bT, { noFusedTechnique = false, dominant = false } = {}) {
  return (10 + (noFusedTechnique ? 5 : 0)) * Math.max(1, bT) * (dominant ? 2 : 1);
}

/** The players of its Fused Characters: the Fusion's owners. */
function ownersOf(fusedUuids) {
  const actors = fusedUuids.map(uuid => globalThis.fromUuidSync?.(uuid)).filter(Boolean);
  return Object.fromEntries(Array.from(globalThis.game?.users ?? []).filter(user => !user.isGM
    && actors.some(actor => actor.testUserPermission?.(user, "OWNER"))).map(user => [user.id, 3]));
}

/** The Fusion these Fused Characters already make by this Method, if any - "use the same Fusion character". */
export function existingFusion(fusedUuids, method) {
  const wanted = [...fusedUuids].sort().join("|");
  return Array.from(globalThis.game?.actors ?? []).find(actor => isFusion(actor) && (actor.system.fusion?.method === method)
    && ((actor.system.fusion?.fused ?? []).map(each => each.uuid).sort().join("|") === wanted)) ?? null;
}

/**
 * What is fused, written onto a Fusion: its copies taken away and made again, what is kept kept (Racial Traits, Size, Alignment, the
 * Fused Technique and what it bought), its Life and Ki full. Run by whoever may change it - or the GM.
 *
 * @param {Actor} fusion
 * @param {object} plan     fusionPlan's, with `racial` (the chosen Racial Trait Items' data) the first time
 * @param {boolean} first   whether it is the first time these Fused Characters make it
 */
export async function applyFusion(fusion, plan, first) {
  const old = Array.from(fusion.items ?? []).filter(item => item.flags?.["dbu-ttrpg"]?.[FUSED_COPY]).map(item => item.id);
  if (old.length) await fusion.deleteEmbeddedDocuments("Item", old);
  const items = [...plan.items, ...(first ? (plan.racial ?? []) : [])];
  if (items.length) await fusion.createEmbeddedDocuments("Item", items);
  const kept = fusion.system.fusion ?? {};
  const modifiers = plan.modifiers ?? kept.modifiers ?? [];
  const balanced = plan.balanced ?? kept.balanced ?? [];
  const update = {
    "system.fusion.fused": plan.fused,
    "system.fusion.method": plan.method,
    "system.fusion.modifiers": modifiers,
    "system.fusion.balanced": balanced,
    "system.fusion.scores": plan.scores,
    "system.fusion.ranks": plan.ranks,
    "system.fusion.races": plan.races,
    "system.fusion.powerLevel": plan.powerLevel,
    "system.fusion.minion": plan.minion,
    "system.fusion.masters": plan.masters,
    "system.fusion.tpGained": combinationTP(plan.bT, { noFusedTechnique: kept.noFusedTechnique, dominant: modifiers.includes("dominant-personality") }),
    "system.race": plan.lead?.race ?? "",
    "system.subrace": plan.lead?.subrace ?? "",
    "system.progression": []
  };
  if (first) {
    update["system.size"] = plan.lead?.size || "medium";
    update["system.alignment"] = plan.lead?.alignment ?? 0;
  }
  await fusion.update(update);
  // Its Method Trait and its Fusion Modifiers, as Traits of its own.
  await syncFusionTraits(fusion, plan.method, modifiers, balanced);
  // "A Fusion is a completely new Character and thus has all of their Life and Ki Points" - but 1 above Bruised's line where every
  // Fused Character was below Injured's.
  const lifeMax = Number(fusion.system.life?.max) || 0;
  const bruisedLine = Math.floor(lifeMax * DBUCharacterData.THRESHOLDS.healthy.above);
  await fusion.update({ "system.life.value": plan.allBelowInjured ? Math.min(lifeMax, bruisedLine + 1) : lifeMax,
    "system.ki.value": Number(fusion.system.ki?.max) || 0 });
  return fusion;
}

// --- Fusion Methods & Modifiers -------------------------------------------------------------------------------------------------
//
// "Fusion Methods grant additional Traits known as Method Traits" and "Fusion Modifiers are gained upon a Fusion being created ...
// Temporary. You can select up to 2 Fusion Modifiers that your Fusion meets the Prerequisite of. Lasting. You can select a Fusion
// Modifier" - files of their own (traits/other/fusion-method/, fusion-modifier/), given to it as Traits as it is fused. Picked in a
// window as it is fused, each Prerequisite shown met or not, never refused (the user's); fused again, "you may change 1 Fusion
// Modifier", said where more are.

/** The Fusion Modifiers, in the page's order. */
export const FUSION_MODIFIERS = Object.freeze(["balanced-fusion", "dominant-personality", "enhanced-fusion", "fused-transformation",
  "power-of-friendship", "shared-heritage", "synergistic-fusion", "the-mightiest-fusion"]);

/** The flag a Fusion's Method Trait and Fusion Modifiers carry - kept as it is fused again, changed with them. */
export const FUSION_TRAIT = "fusionTrait";

const ATTRIBUTES = Object.keys(DBUCharacterData.ATTRIBUTE_ABBREVIATIONS);
const titled = key => key.charAt(0).toUpperCase() + key.slice(1);

/** Balanced Fusion (1): "Attributes of which the Fused Character's Attribute Score for those respective Attributes is equal or within 1". */
export function balancedAttributes(actors) {
  return ATTRIBUTES.filter(key => {
    const scores = actors.map(actor => Number(actor.system?.attributes?.[key]?.score) || 0);
    return scores.length && ((Math.max(...scores) - Math.min(...scores)) <= 1);
  });
}

/**
 * Each Fusion Modifier's Prerequisite, of these Fused Characters: met (true), not (false), or the table's to say (null - what waits on
 * the Transformations), and why.
 *
 * @param {Actor[]} actors
 * @param {object} lookups  { racialCount, bT, partnerOf(actor), rivalOf(actor) }
 */
export function modifierChecks(actors, { racialCount = 0, bT = 1, partnerOf = () => null, rivalOf = () => null } = {}) {
  const balanced = balancedAttributes(actors);
  const levels = actors.map(actor => Number(actor.system?.powerLevel) || 0);
  const top = Math.max(0, ...levels);
  const nonMinions = actors.filter(actor => !isMinion(actor)).length;
  const races = new Set(actors.map(actor => String(actor.system?.race ?? "")));
  const talentSets = actors.map(actor => new Set(Array.from(actor.items ?? []).filter(item => item.type === "talent")
    .map(item => item.flags?.["dbu-ttrpg"]?.sourceId || item.name)));
  const shared = talentSets.length ? [...talentSets[0]].filter(key => talentSets.every(set => set.has(key))).length : 0;
  const pair = (actors.length === 2) ? actors : null;
  const mutual = ask => Boolean(pair) && (ask(pair[0])?.uuid === pair[1].uuid) && (ask(pair[1])?.uuid === pair[0].uuid);
  const waits = { ok: null, why: "Waits on the Transformations: the table's to say." };
  return {
    "balanced-fusion": { ok: balanced.length >= 2,
      why: balanced.length ? `Within 1 of each other: ${balanced.map(titled).join(", ")}.` : "No Attribute within 1 among them." },
    "dominant-personality": { ok: (nonMinions === 1) || (levels.filter(level => level === top).length === 1),
      why: (nonMinions === 1) ? "1 Non-Minion Fused Character." : `Highest Power Level ${top}${(levels.filter(level => level === top).length === 1) ? ", one alone" : ", shared"}.` },
    "enhanced-fusion": waits,
    "fused-transformation": waits,
    "power-of-friendship": { ok: mutual(partnerOf), why: pair ? "Each the other's 'Partner' (Synchronized Combatant (1))." : "2 Fused Characters only." },
    "shared-heritage": { ok: (races.size === 1) && (racialCount < 7),
      why: `${(races.size === 1) ? "All of one Race" : `${races.size} Races`}; ${racialCount} Racial Trait${(racialCount === 1) ? "" : "s"} (less than 7).` },
    "synergistic-fusion": { ok: shared >= (2 + bT), why: `${shared} Talent${(shared === 1) ? "" : "s"} the same; 2+1(bT) = ${2 + bT}.` },
    "the-mightiest-fusion": { ok: mutual(rivalOf), why: pair ? "Each the other's 'Rival' (Chosen Rival (1))." : "2 Fused Characters only." }
  };
}

/** What is off in a pick of Modifiers - said, never refused. */
export function modifierWarnings(picked, method, { was = null } = {}) {
  const said = [];
  const allowed = modifiersAllowed(method);
  if (picked.length > allowed) said.push(`${picked.length} Fusion Modifiers: ${FUSION_METHODS[method]?.type === "temporary" ? "up to 2 (Temporary)" : "1 (Lasting)"}.`);
  if (Array.isArray(was)) {
    const changed = picked.filter(id => !was.includes(id)).length + was.filter(id => !picked.includes(id)).length;
    if (changed > 2) said.push("Repeating Fusions: \"you may change 1 Fusion Modifier\".");
  }
  return said;
}

/**
 * The window: each Fusion Modifier, its Prerequisite met or not, and Balanced Fusion's two 'Balanced Attributes'.
 *
 * @returns {Promise<{ modifiers: string[], balanced: string[] }|null>}
 */
async function askModifiers(actors, method, { current = [], balanced = [], racialCount = 0, repeating = false } = {}) {
  const { getTrait } = await import("./effects/traits.mjs");
  const { partnerOf, rivalOf } = await import("./effects/conditions.mjs");
  const lead = leadFused(actors.map(snapshotOf));
  const checks = modifierChecks(actors, { racialCount, bT: lead ? baseTierFor(lead.powerLevel) : 1, partnerOf, rivalOf });
  const escape = foundry.utils.escapeHTML;
  const mark = ok => (ok === true) ? "&#10003;" : (ok === false) ? "&#10007;" : "?";
  const even = balancedAttributes(actors);
  const offered = even.length >= 2 ? even : ATTRIBUTES;
  const select = (name, at) => `<select name="${name}">${offered.map(key => `<option value="${key}" ${((balanced[at] ?? offered[at]) === key) ? "selected" : ""}>${
    titled(key)}</option>`).join("")}</select>`;
  const rows = FUSION_MODIFIERS.map(id => `<label class="dbu-pick" data-tooltip="${escape(checks[id].why)}"><input type="checkbox" name="modifier" value="${id}"
    ${current.includes(id) ? "checked" : ""}/> ${mark(checks[id].ok)} ${escape(getTrait(id)?.name ?? id)} <em class="dbu-pick-note">${escape(checks[id].why)}</em></label>`).join("");
  const picked = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"], window: { title: "Fusion: Fusion Modifiers" },
    content: `<p class="dbu-respond-hint">${escape(FUSION_METHODS[method]?.label ?? "")}: ${(modifiersAllowed(method) === 2) ? "up to 2" : "1"} Fusion
      Modifier${(modifiersAllowed(method) === 2) ? "s" : ""} it meets the Prerequisite of${repeating ? " - fused again, \"you may change 1 Fusion Modifier\"" : ""}.</p>
      <div class="dbu-picks">${rows}</div>
      <label class="dbu-wager"><span>Balanced Attributes</span>${select("balanced1", 0)}${select("balanced2", 1)}</label>
      <p class="dbu-vq-warning" data-modifier-warning></p>`,
    buttons: [{ action: "ok", label: "Take these", default: true, callback: (event, button) => ({
      modifiers: Array.from(button.form.querySelectorAll('input[name="modifier"]:checked')).map(input => input.value),
      balanced: [button.form.elements.balanced1.value, button.form.elements.balanced2.value] }) },
      { action: "cancel", label: "Cancel" }],
    render: (event, dialog) => {
      const root = dialog.element;
      const say = () => {
        const now = Array.from(root.querySelectorAll('input[name="modifier"]:checked')).map(input => input.value);
        const line = root.querySelector("[data-modifier-warning]");
        if (line) line.textContent = modifierWarnings(now, method, { was: repeating ? current : null }).join(" ");
      };
      for (const input of root.querySelectorAll('input[name="modifier"]')) input.addEventListener("change", say);
      say();
    },
    rejectClose: false
  }).catch(() => null);
  if (!picked || (typeof picked !== "object")) return null;
  if (picked.balanced[0] === picked.balanced[1]) picked.balanced = [picked.balanced[0], offered.find(key => key !== picked.balanced[0]) ?? picked.balanced[0]];
  return picked;
}

/**
 * Its Method Trait and its Fusion Modifiers, as Traits of its own: those no longer had taken away, the rest made - Balanced Fusion's
 * with its two Attributes written in, made again where they changed.
 */
export async function syncFusionTraits(fusion, method, modifiers = [], balanced = []) {
  const { getTrait } = await import("./effects/traits.mjs");
  const wanted = [FUSION_METHODS[method]?.trait, ...modifiers].filter(id => id && getTrait(id));
  const balancedKey = balanced.join(",");
  const had = Array.from(fusion.items ?? []).filter(item => item.flags?.["dbu-ttrpg"]?.[FUSION_TRAIT]);
  const stale = had.filter(item => { const id = item.flags["dbu-ttrpg"].sourceId;
    return !wanted.includes(id) || ((id === "balanced-fusion") && (item.flags["dbu-ttrpg"].balanced !== balancedKey)); });
  if (stale.length) await fusion.deleteEmbeddedDocuments("Item", stale.map(item => item.id));
  const keep = new Set(had.filter(item => !stale.includes(item)).map(item => item.flags["dbu-ttrpg"].sourceId));
  const { racialItemFrom } = await import("./racial.mjs");
  const made = [];
  for (const id of wanted.filter(each => !keep.has(each))) {
    const built = await racialItemFrom(getTrait(id), fusion);
    if (!built) continue;
    const data = built.data;
    data.flags["dbu-ttrpg"][FUSION_TRAIT] = true;
    if (id === "balanced-fusion") {
      data.flags["dbu-ttrpg"].balanced = balancedKey;
      data.system.script = String(data.system.script ?? "").replaceAll("$balanced1", balanced[0] ?? "agility")
        .replaceAll("$balanced2", balanced[1] ?? "force");
    }
    made.push(data);
  }
  if (made.length) await fusion.createEmbeddedDocuments("Item", made);
}

/** The Fusion tab's Choose: its Fusion Modifiers picked again, and what they change worked out again. */
export async function chooseModifiers(fusion) {
  if (!fusion?.isOwner) return null;
  const had = fusion.system.fusion?.fused ?? [];
  const actors = had.map(entry => fromUuidSync(entry.uuid)).filter(Boolean);
  if (!actors.length || (actors.length < had.length)) return ui.notifications.warn(`${fusion.name}: its Fused Characters are needed to see their Prerequisites.`);
  const method = fusion.system.fusion?.method ?? "";
  const racialCount = Array.from(fusion.items ?? []).filter(item => item.flags?.["dbu-ttrpg"]?.[FUSED_RACIAL]).length;
  const asked = await askModifiers(actors, method, { current: fusion.system.fusion?.modifiers ?? [],
    balanced: fusion.system.fusion?.balanced ?? [], racialCount });
  if (!asked) return null;
  const power = fusionPowerLevel(had, { synergistic: asked.modifiers.includes("synergistic-fusion") });
  const lead = leadFused(had);
  await fusion.update({ "system.fusion.modifiers": asked.modifiers, "system.fusion.balanced": asked.balanced,
    "system.fusion.powerLevel": power.powerLevel,
    "system.fusion.tpGained": combinationTP(lead ? baseTierFor(lead.powerLevel) : 1,
      { noFusedTechnique: fusion.system.fusion?.noFusedTechnique, dominant: asked.modifiers.includes("dominant-personality") }) });
  await syncFusionTraits(fusion, method, asked.modifiers, asked.balanced);
  return asked;
}

// --- The Methods' Apparel -------------------------------------------------------------------------------------------------------
//
// Metamoran Style (1) and Maximum Metamorese (2): "Instead of gaining the Apparel of the Fused Characters, this Fusion gains and equips
// the Metamoran Clothing" - Divine Apparel with it for Maxi. Divine Fusion Method (1) and Fusion of Fusion Methods (1): "a combined
// version of their Apparel. For each layer ... select one of those Apparel pieces and apply any qualifying Apparel Qualities from the
// other Fused Character's Apparel of the same Layer" - a window, a Layer at a time (the user's). Made as it is fused, by the system (the
// user's); Merged Tuffle's, forgone or not as the Encounter begins (fusion-traits.mjs).

/** The flag the Methods' Apparel carries - with the copies', so it is made again as the Fusion is fused again. */
export const METHOD_APPAREL = "methodApparel";

/** Whether an Item's data is a piece of Apparel. */
const isApparel = data => (data?.type === "gear") && (data.system?.itemType === "apparel");

/** "Metamoran Clothing - Category: Combat Clothing, Grade: High, Accessories: Sash" - Durable, Free Flowing, Stretching; worn. */
export function metamoranClothing(getTrait, { divine = false } = {}) {
  const qualities = ["durable", "free-flowing", "stretching", ...(divine ? ["divine-apparel"] : [])]
    .map(id => ({ id, slots: 0, choice: "", on: false, name: "", free: true, granted: false }));
  // Grade 5: the High Apparel Bonus.
  const crafted = { kind: "apparel", category: "combat-clothing", grade: 5, size: "", qualities };
  const flags = { "dbu-ttrpg": { [FUSED_COPY]: true, [METHOD_APPAREL]: true } };
  const sash = getTrait("sash");
  return [
    { name: "Metamoran Clothing", type: "gear", img: GEAR_ICON, flags,
      system: { gearId: "", itemType: "apparel", equipped: true, layer: "top",
        crafted: { ...crafted, effects: composeEffects(crafted, "", { getTrait }), breakLost: 0, destroyed: false } } },
    ...(sash ? [foundry.utils.mergeObject(gearItemFrom(sash), { flags, system: { equipped: true } }, { inplace: false })] : [])
  ];
}

/** The Apparel the Fused Characters wear, a Layer at a time: { top: [{ actor, item }], ... }. */
export function wornLayers(actors) {
  return Object.fromEntries(Object.keys(APPAREL_LAYERS).map(layer => [layer, actors.flatMap(actor => Array.from(actor.items ?? [])
    .filter(item => isApparel(item) && item.system?.equipped && (item.system?.layer === layer)).map(item => ({ actor, item })))]));
}

/**
 * The combined Apparel: for each Layer worn, the piece picked - its uuid in `picks`, the first where none is - with every Quality of the
 * other pieces of that Layer it qualifies for and does not have; worn on that Layer.
 */
export function combinedApparel(actors, picks, getTrait) {
  const out = [];
  for (const [layer, worn] of Object.entries(wornLayers(actors))) {
    if (!worn.length) continue;
    const base = worn.find(each => each.item.uuid === picks?.[layer]) ?? worn[0];
    const data = base.item.toObject();
    delete data._id;
    const crafted = foundry.utils.deepClone(data.system.crafted ?? {});
    crafted.qualities = [...(crafted.qualities ?? [])];
    for (const other of worn.filter(each => each !== base)) {
      for (const entry of (other.item.system?.crafted?.qualities ?? [])) {
        if (crafted.qualities.some(had => had.id === entry.id)) continue;
        const tried = { ...crafted, qualities: [...crafted.qualities, { ...entry }] };
        if (!qualityInactive(entry, tried, getTrait)) crafted.qualities.push({ ...entry });
      }
    }
    crafted.effects = composeEffects(crafted, crafted.effects ?? "", { getTrait });
    data.system.crafted = crafted;
    data.system.equipped = true;
    data.system.layer = layer;
    data.flags = { ...(data.flags ?? {}), "dbu-ttrpg": { ...(data.flags?.["dbu-ttrpg"] ?? {}), [FUSED_COPY]: true,
      [FUSED_FROM]: base.actor.uuid, [METHOD_APPAREL]: true } };
    out.push(data);
  }
  return out;
}

/** Potara and EX: which piece of each Layer worn by more than one is the one kept. Null where backed out of. */
async function askCombinedApparel(actors) {
  const layers = Object.entries(wornLayers(actors)).filter(([, worn]) => worn.length > 1);
  if (!layers.length) return {};
  const escape = foundry.utils.escapeHTML;
  const picked = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"], window: { title: "Fusion: combined Apparel" },
    content: `<p class="dbu-respond-hint">"For each layer of Apparel worn by the Fused Characters, select one of those Apparel pieces and apply any
      qualifying Apparel Qualities from the other Fused Character's Apparel of the same Layer."</p>
      ${layers.map(([layer, worn]) => `<label class="dbu-wager"><span>${APPAREL_LAYERS[layer].label} Layer</span><select name="${layer}">${worn.map(each =>
        `<option value="${escape(each.item.uuid)}">${escape(each.item.name)} (${escape(each.actor.name)})</option>`).join("")}</select></label>`).join("")}`,
    buttons: [{ action: "ok", label: "Combine", default: true, callback: (event, button) =>
      Object.fromEntries(layers.map(([layer]) => [layer, button.form.elements[layer].value])) },
      { action: "cancel", label: "Cancel" }],
    rejectClose: false
  }).catch(() => null);
  return (picked && (typeof picked === "object")) ? picked : null;
}

/** What the Fusion is given in place of the Fused Characters' Apparel, by its Method - asked where it asks. Null where backed out of. */
async function methodItems(actors, method, items) {
  const { getTrait } = await import("./effects/traits.mjs");
  if ((method === "metamorese") || (method === "maxi")) {
    return [...items.filter(data => !isApparel(data)), ...metamoranClothing(getTrait, { divine: method === "maxi" })];
  }
  if ((method === "potara") || (method === "ex")) {
    const picks = await askCombinedApparel(actors);
    if (picks === null) return null;
    return [...items.filter(data => !isApparel(data)), ...combinedApparel(actors, picks, getTrait)];
  }
  return items;
}

/** A new Fusion's Actor, made with its owners - by the GM where the player may not make Actors (chat.mjs "makeFusion"). */
async function makeFusionActor(plan, name) {
  return Actor.create({ name, type: "fusion", img: plan.fused[0]?.img || undefined, ownership: ownersOf(plan.fused.map(each => each.uuid)),
    system: { progression: [] } });
}

/** Made and filled, wherever it is done. */
export async function createFusion(plan, name) {
  const fusion = await makeFusionActor(plan, name);
  if (!fusion) return null;
  await applyFusion(fusion, plan, true);
  fusion.sheet?.render?.(true);
  return fusion;
}

/**
 * With whom, and by which Method - "Each Fusion Method has a certain number of Fused Characters ... If the number is a set number,
 * then you require that many". Characters only, no Fusion ("A Fusion cannot be a Fused Character for another Fusion").
 *
 * @returns {Promise<{ actors: Actor[], method: string, name: string }|null>}
 */
async function askFusing(start = null, { method: current = "" } = {}) {
  const candidates = Array.from(game.actors ?? []).filter(actor => isCharacter(actor) && !isFusion(actor) && actor.visible
    && (actor.uuid !== start?.uuid)).sort((a, b) => a.name.localeCompare(b.name));
  const escape = foundry.utils.escapeHTML;
  const methods = Object.entries(FUSION_METHODS).map(([value, method]) => `<option value="${value}" ${value === current ? "selected" : ""}>${
    escape(method.label)} (${method.fused[0] === method.fused[1] ? method.fused[0] : `${method.fused[0]}~${method.fused[1]}`} Fused)</option>`).join("");
  const rows = candidates.map(actor => `<label class="dbu-pick"><input type="checkbox" name="with" value="${actor.uuid}"/> ${escape(actor.name)}</label>`).join("");
  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"], window: { title: start ? `${start.name}: Fuse` : "Fuse" },
    content: `<label class="dbu-wager"><span>Fusion Method</span><select name="method">${methods}</select></label>
      <p class="dbu-respond-hint">${start ? `${escape(start.name)} fuses with:` : "The Fused Characters:"}</p>
      <div class="dbu-picks">${rows || "<p>No other Character.</p>"}</div>
      <label class="dbu-wager"><span>Its name</span><input type="text" name="name" placeholder="A new Fusion's name"/></label>`,
    buttons: [{ action: "fuse", label: "Fuse", default: true, callback: (event, button) => ({
      method: button.form.elements.method.value,
      uuids: Array.from(button.form.querySelectorAll('input[name="with"]:checked')).map(input => input.value),
      name: String(button.form.elements.name.value ?? "").trim() }) },
      { action: "cancel", label: "Cancel" }],
    rejectClose: false
  }).catch(() => null);
  if (!chosen || (typeof chosen !== "object")) return null;
  const actors = [...(start ? [start] : []), ...chosen.uuids.map(uuid => fromUuidSync(uuid)).filter(Boolean)];
  const method = FUSION_METHODS[chosen.method];
  if (!method) return null;
  if ((actors.length < method.fused[0]) || (actors.length > method.fused[1])) {
    ui.notifications.warn(`${method.label} takes ${method.fused[0] === method.fused[1] ? method.fused[0] : `${method.fused[0]} to ${method.fused[1]}`} Fused Characters: ${actors.length} picked.`);
    return null;
  }
  return { actors, method: chosen.method, name: chosen.name || actors.map(actor => actor.name).join(" + ") };
}

/** Step 3 - "Decide the Racial Traits of the Fusion": a box each, the limits said as they are passed, never refused (the user's). */
async function askRacialTraits(actors) {
  const choices = racialChoices(actors);
  if (!choices.length) return [];
  const escape = foundry.utils.escapeHTML;
  const group = key => choices.filter(each => each.group === key).map(each => `<label class="dbu-pick"><input type="checkbox" name="trait"
    value="${escape(each.key)}" data-group="${each.group}"/> ${escape(each.name)} <em class="dbu-pick-note">${escape(each.fromName)}</em></label>`).join("");
  const section = (key, label) => (choices.some(each => each.group === key) ? `<h4>${label}</h4><div class="dbu-picks">${group(key)}</div>` : "");
  const picked = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"], window: { title: "Fusion: Racial Traits" },
    content: `<p class="dbu-respond-hint">"A Fusion cannot possess more than 7 Racial Traits. Select up to 4 Primary Traits (minimum 2) ... for the
      remaining Racial Traits you may select any of the Secondary Racial Traits or Subrace Racial Traits."</p>
      ${section("primary", "Primary")}${section("secondary", "Secondary")}${section("subrace", "Subrace")}
      <p class="dbu-vq-warning" data-racial-warning></p>`,
    buttons: [{ action: "ok", label: "Take these", default: true, callback: (event, button) =>
      Array.from(button.form.querySelectorAll('input[name="trait"]:checked')).map(input => input.value) },
      { action: "cancel", label: "Cancel" }],
    render: (event, dialog) => {
      const root = dialog.element;
      const say = () => {
        const now = Array.from(root.querySelectorAll('input[name="trait"]:checked'))
          .map(input => choices.find(each => each.key === input.value)).filter(Boolean);
        const line = root.querySelector("[data-racial-warning]");
        if (line) line.textContent = racialWarnings(now).join(" ");
      };
      for (const input of root.querySelectorAll('input[name="trait"]')) input.addEventListener("change", say);
      say();
    },
    rejectClose: false
  }).catch(() => null);
  if (!Array.isArray(picked)) return null;
  return choices.filter(each => picked.includes(each.key));
}

// --- The Fused Technique ---------------------------------------------------------------------------------------------------------
//
// "At creation, Fusions gain an Ultimate Signature Technique known as a Fused Technique": two Signature Techniques of different Fused
// Characters, one the base - a copy, "remove all Disadvantages" - with the other's Advantages it qualifies for ("You may choose to
// ignore the TP Limit"), a Super Profile (Complete Annihilation, a 'Super' one that lists the base's Profile, or Multi-Profile with the
// other's), "Reduce the Ki Point Cost ... by 4(T)", renamed. Or none: "You may choose not to create a Fused Technique to gain an
// additional 5(bT) Technique Points instead." A guided window (the user's).

/** The flag the Fused Technique carries: kept as the Fusion is fused again, none of its Technique Points spent on it. */
export const FUSED_TECHNIQUE = "fusedTechnique";

/** A Fusion's copies of its Fused Characters' Signature Techniques, with whose each was. */
export function fusedTechniques(fusion) {
  return Array.from(fusion?.items ?? []).filter(item => (item.type === "maneuver") && item.flags?.["dbu-ttrpg"]?.[FUSED_COPY]
    && (item.system?.tags ?? []).includes("signature") && !item.system?.signatureTechnique)
    .map(item => ({ item, from: item.flags["dbu-ttrpg"][FUSED_FROM] ?? "" }));
}

/** The Super Profiles a Fused Technique may take, by its base's Profile: Complete Annihilation, its 'Super' one, Multi-Profile. */
export function fusedSuperProfiles(baseProfile, superProfiles) {
  return Object.entries(superProfiles).filter(([id, entry]) => (id === "complete-annihilation") || (id === "multi-profile")
    || (/super/i.test(entry.label) && (entry.prerequisite === `profile:${baseProfile}`)))
    .map(([value, entry]) => ({ value, label: entry.label }));
}

/**
 * The Fused Technique's data, from its base and the other: the base copied with no Disadvantage, the other's Advantages picked added
 * (ranks summed, no more than the most it may have), an Ultimate with its Super Profile, 4(T) off its Ki Point Cost, named.
 *
 * @param {object} base      the base Technique's Item
 * @param {object} other     the other Technique's Item
 * @param {object} choice    { advantages: [ids], superProfile, name }
 * @param {object} lookups   { featureDef(id), maxRanks(def) }
 */
export function buildFusedTechnique(base, other, { advantages = [], superProfile = "", name = "" } = {}, lookups) {
  const data = base.toObject();
  delete data._id;
  const sig = data.system.signature ?? {};
  const advantage = id => lookups.featureDef(id)?.owner !== "disadvantages";
  const features = (sig.features ?? []).filter(entry => advantage(entry.id)).map(entry => ({ ...entry }));
  for (const entry of (other.system?.signature?.features ?? []).filter(each => advantages.includes(each.id) && advantage(each.id))) {
    const had = features.find(each => each.id === entry.id);
    const most = lookups.maxRanks(lookups.featureDef(entry.id));
    if (had) had.ranks = Math.min(most, (Number(had.ranks) || 1) + (Number(entry.ranks) || 1));
    else features.push({ ...entry });
  }
  data.system.signature = { ...sig, features, level: "ultimate", superProfile,
    secondProfile: (superProfile === "multi-profile") ? (other.system?.signature?.profile ?? "") : "", kiPerTierOff: 4 };
  data.name = String(name || "").trim() || `${base.name} (Fused)`;
  const own = { ...(data.flags?.["dbu-ttrpg"] ?? {}) };
  delete own[FUSED_COPY];
  delete own[FUSED_FROM];
  data.flags = { ...(data.flags ?? {}), "dbu-ttrpg": { ...own, [FUSED_TECHNIQUE]: true } };
  return data;
}

/** Its Technique Points written again: 10(bT), 15(bT) with no Fused Technique, Dominant Personality's double. */
async function rewriteTP(fusion, noFusedTechnique) {
  const lead = leadFused(fusion.system.fusion?.fused ?? []);
  return combinationTP(lead ? baseTierFor(lead.powerLevel) : 1,
    { noFusedTechnique, dominant: (fusion.system.fusion?.modifiers ?? []).includes("dominant-personality") });
}

/** The guided window: which two, which the base, which Advantages, which Super Profile, its name - or none. */
export async function askFusedTechnique(fusion) {
  if (!fusion?.isOwner) return null;
  const { featureDef, maxRanks } = await import("./technique.mjs");
  const { SUPER_PROFILES } = await import("./maneuvers.mjs");
  const escape = foundry.utils.escapeHTML;
  const all = fusedTechniques(fusion);
  const sources = new Set(all.map(each => each.from));
  const none = async () => {
    await fusion.update({ "system.fusion.noFusedTechnique": true, "system.fusion.fusedTechnique": "",
      "system.fusion.tpGained": await rewriteTP(fusion, true) });
    ui.notifications.info(`${fusion.name}: no Fused Technique - 5(bT) more Technique Points.`);
    return null;
  };
  const options = all.map(each => `<option value="${each.item.id}">${escape(each.item.name)} (${escape(fromUuidSync(each.from)?.name ?? "?")})</option>`).join("");
  const first = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"], window: { title: `${fusion.name}: Fused Technique` },
    content: (sources.size >= 2)
      ? `<p class="dbu-respond-hint">"Select 2 Signature Techniques, each one must be from a different Fused Character" - one the base.</p>
        <label class="dbu-wager"><span>Base</span><select name="base">${options}</select></label>
        <label class="dbu-wager"><span>The other</span><select name="other">${options}</select></label>`
      : "<p>It needs Signature Techniques of two different Fused Characters: none to make.</p>",
    buttons: [
      ...((sources.size >= 2) ? [{ action: "next", label: "Next", default: true,
        callback: (event, button) => ({ base: button.form.elements.base.value, other: button.form.elements.other.value }) }] : []),
      { action: "none", label: "No Fused Technique (+5(bT) TP)" },
      { action: "cancel", label: "Cancel" }],
    rejectClose: false
  }).catch(() => null);
  if (first === "none") return none();
  if (!first || (typeof first !== "object")) return null;
  const base = all.find(each => each.item.id === first.base);
  const other = all.find(each => each.item.id === first.other);
  if (!base || !other || (base.from === other.from)) {
    ui.notifications.warn("The two must be of different Fused Characters.");
    return null;
  }
  const extra = (other.item.system?.signature?.features ?? []).filter(entry => featureDef(entry.id)?.owner !== "disadvantages");
  const supers = fusedSuperProfiles(base.item.system?.signature?.profile ?? "", SUPER_PROFILES);
  const second = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"], window: { title: `${fusion.name}: Fused Technique` },
    content: `<p class="dbu-respond-hint">${escape(base.item.name)}, with no Disadvantage, and of ${escape(other.item.name)}'s Advantages:</p>
      <div class="dbu-picks">${extra.map(entry => `<label class="dbu-pick"><input type="checkbox" name="adv" value="${entry.id}" checked/> ${
        escape(featureDef(entry.id)?.name ?? entry.id)}${(Number(entry.ranks) > 1) ? ` (${entry.ranks} ranks)` : ""}</label>`).join("") || "<p>None.</p>"}</div>
      <label class="dbu-wager"><span>Super Profile</span><select name="super">${supers.map(entry =>
        `<option value="${entry.value}">${escape(entry.label)}</option>`).join("")}</select></label>
      <label class="dbu-wager"><span>Its name</span><input type="text" name="name" value="${escape(base.item.name)}"/></label>
      <p class="dbu-respond-hint">An Ultimate Signature Technique, 4(T) off its Ki Point Cost. The TP Limit may be ignored.</p>`,
    buttons: [{ action: "make", label: "Make it", default: true, callback: (event, button) => ({
      advantages: Array.from(button.form.querySelectorAll('input[name="adv"]:checked')).map(input => input.value),
      superProfile: button.form.elements.super.value, name: button.form.elements.name.value }) },
      { action: "cancel", label: "Cancel" }],
    rejectClose: false
  }).catch(() => null);
  if (!second || (typeof second !== "object")) return null;
  const data = buildFusedTechnique(base.item, other.item, second, { featureDef, maxRanks });
  const old = fusion.system.fusion?.fusedTechnique ? fusion.items.get(fusion.system.fusion.fusedTechnique) : null;
  if (old) await old.delete();
  const [made] = await fusion.createEmbeddedDocuments("Item", [data]);
  await fusion.update({ "system.fusion.fusedTechnique": made?.id ?? "", "system.fusion.noFusedTechnique": false,
    "system.fusion.tpGained": await rewriteTP(fusion, false) });
  return made;
}

/** Fused, by whoever may - the GM making the Actor for a player who may not (chat.mjs relay). */
async function fuse(actors, method, name, fusion = null) {
  const existing = fusion ?? existingFusion(actors.map(actor => actor.uuid), method);
  const first = !existing || !(existing.system.fusion?.fused ?? []).length;
  let racial = [];
  if (first) {
    const picked = await askRacialTraits(actors);
    if (picked === null) return null;
    racial = racialItems(actors, picked);
  }
  // Its Fusion Modifiers: chosen the first time; fused again, "you may change 1".
  const kept = existing?.system?.fusion ?? {};
  const racialCount = first ? racial.length : Array.from(existing.items ?? []).filter(item => item.flags?.["dbu-ttrpg"]?.[FUSED_RACIAL]).length;
  const modifiers = await askModifiers(actors, method, { current: first ? [] : (kept.modifiers ?? []), balanced: kept.balanced ?? [],
    racialCount, repeating: !first });
  if (modifiers === null) return null;
  const plan = fusionPlan(actors, method, { modifiers: modifiers.modifiers });
  plan.balanced = modifiers.balanced;
  // In place of the Fused Characters' Apparel, the Method's.
  plan.items = await methodItems(actors, method, plan.items);
  if (plan.items === null) return null;
  if (first) plan.racial = racial;
  if (existing) {
    if (!existing.isOwner) return ui.notifications.warn(`${existing.name} is not yours to fuse.`);
    await applyFusion(existing, plan, first);
    ui.notifications.info(`${existing.name}: ${first ? "fused" : "fused again - recalculated from its Fused Characters"}.`);
    // "At creation, Fusions gain ... a Fused Technique" - asked now; fused again, it keeps its own.
    if (first) await askFusedTechnique(existing);
    return existing;
  }
  if (game.user.isGM || game.user.can?.("ACTOR_CREATE")) {
    const made = await createFusion(plan, name);
    if (made) await askFusedTechnique(made);
    return made;
  }
  if (!game.users.activeGM) return ui.notifications.warn("A GM must be connected to make the Fusion.");
  const { requestMakeFusion } = await import("./chat.mjs");
  return requestMakeFusion(plan, name);
}

/** The Settings tab's Fuse: this Character and the ones picked, by the Method picked - a new Fusion, or theirs fused again. */
export async function fuseFrom(character) {
  if (isFusion(character)) return ui.notifications.warn("A Fusion cannot be a Fused Character for another Fusion.");
  const asked = await askFusing(character);
  if (!asked) return null;
  return fuse(asked.actors, asked.method, asked.name);
}

/** A Fusion's tab: Fuse (its Fused Characters and Method picked), or Fuse again (recalculate) from the ones it has. */
export async function fuseOnto(fusion) {
  const had = fusion.system.fusion?.fused ?? [];
  if (had.length) {
    const actors = had.map(entry => fromUuidSync(entry.uuid));
    const gone = had.filter((entry, at) => !actors[at]).map(entry => entry.name);
    if (gone.length) return ui.notifications.warn(`${fusion.name}: ${gone.join(", ")} no longer here to fuse with.`);
    return fuse(actors, fusion.system.fusion.method, fusion.name, fusion);
  }
  const asked = await askFusing(null, { method: fusion.system.fusion?.method ?? "" });
  if (!asked) return null;
  const other = existingFusion(asked.actors.map(actor => actor.uuid), asked.method);
  if (other && (other !== fusion)) return ui.notifications.warn(`${other.name} is already their Fusion by this Method: fuse it again there.`);
  return fuse(asked.actors, asked.method, fusion.name, fusion);
}
