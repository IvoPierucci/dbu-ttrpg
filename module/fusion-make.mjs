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
import { FUSION_METHODS, baseTierFor, fusionPowerLevel, leadFused } from "./fusion.mjs";
import { isVillainous } from "./racial.mjs";

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
  const modifiers = kept.modifiers ?? [];
  const update = {
    "system.fusion.fused": plan.fused,
    "system.fusion.method": plan.method,
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
  // "A Fusion is a completely new Character and thus has all of their Life and Ki Points" - but 1 above Bruised's line where every
  // Fused Character was below Injured's.
  const lifeMax = Number(fusion.system.life?.max) || 0;
  const bruisedLine = Math.floor(lifeMax * DBUCharacterData.THRESHOLDS.healthy.above);
  await fusion.update({ "system.life.value": plan.allBelowInjured ? Math.min(lifeMax, bruisedLine + 1) : lifeMax,
    "system.ki.value": Number(fusion.system.ki?.max) || 0 });
  return fusion;
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

/** Fused, by whoever may - the GM making the Actor for a player who may not (chat.mjs relay). */
async function fuse(actors, method, name, fusion = null) {
  const existing = fusion ?? existingFusion(actors.map(actor => actor.uuid), method);
  const first = !existing || !(existing.system.fusion?.fused ?? []).length;
  const plan = fusionPlan(actors, method, { modifiers: existing?.system?.fusion?.modifiers ?? [] });
  if (first) {
    const picked = await askRacialTraits(actors);
    if (picked === null) return null;
    plan.racial = racialItems(actors, picked);
  }
  if (existing) {
    if (!existing.isOwner) return ui.notifications.warn(`${existing.name} is not yours to fuse.`);
    await applyFusion(existing, plan, first);
    ui.notifications.info(`${existing.name}: ${first ? "fused" : "fused again - recalculated from its Fused Characters"}.`);
    return existing;
  }
  if (game.user.isGM || game.user.can?.("ACTOR_CREATE")) return createFusion(plan, name);
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
