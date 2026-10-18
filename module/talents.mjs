/**
 * Seeding the world with the Talents that ship with the system.
 *
 * A character's Talents are the Talent Items they own, not entries here: this only puts
 * the published ones into the compendium so a GM can drag them onto a character instead
 * of typing each in by hand. They come from the files under `traits/talents/`, which is
 * also where someone writing their own puts theirs.
 */

import { getTrait, traitsOfKind } from "./effects/traits.mjs";
import { compareTalents, talentCategoryOf } from "./talent-categories.mjs";

/** Every Talent written - not a Talent's Options, which are files beside it (Show Stopping Performance's). */
function talentFiles() {
  return traitsOfKind("talents").filter(trait => !trait.optionOf);
}

/**
 * Talents are taken on the Progression tab (the user's, 2026-10-15): a Talent Addition row - fixed, or a Character Perk made
 * one - names a Talent by its file's id, and once its Level is reached the Talent is on the character, made from its file and
 * marked as the Progression tab's (`fromProgression`). Another picked, the row emptied, or the Level left behind, it goes.
 * Not added by hand, nor removed from the Traits tab: only a Racial Trait gives one besides (`fromTrait`), and keeps it.
 */
export const FROM_PROGRESSION = "fromProgression";

/** What the reached Talent Addition rows name, in row order. */
export function progressionTalentIds(system) {
  const level = Number(system?.powerLevel) || 1;
  return (system?.progression ?? [])
    .filter(entry => (entry.choice === "Talent Addition") && ((Number(entry.lvl) || 1) <= level) && entry.talent)
    .map(entry => entry.talent);
}

/**
 * The character's Talents made to match their Progression tab: each reached row's Talent made where it is missing, each the
 * tab gave and no row names any more removed. A row written before this - an owned Talent's Item id - is turned into that
 * Talent's file id, and the Talent is the tab's from then on; so is one added by hand before, once a row names it.
 */
export async function syncProgressionTalents(actor) {
  if (!actor?.isOwner || (actor.type !== "character")) return;
  const owned = Array.from(actor.items ?? []).filter(item => item.type === "talent");
  const sourceOf = item => item.flags?.["dbu-ttrpg"]?.sourceId ?? "";
  const rows = actor.system.progression ?? [];
  const adopted = new Set();
  let rewritten = false;
  const fixed = rows.map(entry => {
    const item = entry.talent ? actor.items.get(entry.talent) : null;
    if (item?.type !== "talent") return entry;
    rewritten = true;
    if (sourceOf(item)) adopted.add(item.id);
    return { ...entry, talent: sourceOf(item) };
  });
  const wanted = new Set(progressionTalentIds({ powerLevel: actor.system.powerLevel, progression: fixed }));

  const ours = item => adopted.has(item.id) || Boolean(item.flags?.["dbu-ttrpg"]?.[FROM_PROGRESSION]);
  const removed = owned.filter(item => ours(item) && !wanted.has(sourceOf(item))).map(item => item.id);
  const kept = owned.filter(item => !removed.includes(item.id));
  // Held already, not by a Racial Trait - the tab's from now on.
  const adopt = kept.filter(item => wanted.has(sourceOf(item)) && !ours(item) && !item.flags?.["dbu-ttrpg"]?.fromTrait)
    .map(item => item.id);
  const held = new Set(kept.map(sourceOf));
  // What a Talent asks as it is gained - Elementalist's Elemental Profile - asked of whoever made the change; backed out of,
  // not given (asked again the next time the tab is touched).
  const { answeredTalent } = await import("./racial.mjs");
  const created = [];
  for (const trait of [...wanted].filter(id => !held.has(id)).map(id => getTrait(id)).filter(each => (each?.kind === "talents") && !each.optionOf)) {
    const data = await answeredTalent(itemFrom(trait), trait, actor);
    if (!data) continue;
    data.flags["dbu-ttrpg"][FROM_PROGRESSION] = true;
    created.push(data);
  }

  if (rewritten) await actor.update({ "system.progression": fixed });
  const marks = [...adopted, ...adopt].filter(id => !removed.includes(id))
    .map(id => ({ _id: id, [`flags.dbu-ttrpg.${FROM_PROGRESSION}`]: true }));
  if (marks.length) await actor.updateEmbeddedDocuments("Item", marks);
  if (removed.length) await actor.deleteEmbeddedDocuments("Item", removed);
  if (!created.length) return;
  // Their Triggered effects start Automatic, as a Racial Trait's do - each in turn, the list being one flag.
  const { automateAll } = await import("./racial.mjs");
  for (const made of (await actor.createEmbeddedDocuments("Item", created)) ?? []) await automateAll(actor, made);
}

/**
 * What a Talent Addition row offers: every Talent written, by Category in the published order - but those another row took
 * and those a Racial Trait gave ("You can take each Talent only once").
 */
export function talentChoicesFor(actor, entry) {
  const taken = new Set((actor.system.progression ?? []).filter(other => (other !== entry) && (other.choice === "Talent Addition"))
    .map(other => other.talent).filter(Boolean));
  for (const item of actor.items ?? []) {
    if ((item.type === "talent") && item.flags?.["dbu-ttrpg"]?.fromTrait) taken.add(item.flags["dbu-ttrpg"].sourceId);
  }
  const groups = new Map();
  for (const trait of [...talentFiles()].sort(compareTalents)) {
    if (taken.has(trait.id) && (trait.id !== entry.talent)) continue;
    const category = talentCategoryOf(trait);
    const label = category ? (category.raceLabel ? `${category.label} - ${category.raceLabel}` : category.label) : "Other";
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push({ value: trait.id, label: trait.name, selected: trait.id === entry.talent });
  }
  return [...groups].map(([label, options]) => ({ label, options }));
}

/** The Talent Items a character owns, in the order the Talents are published: by Category, then within it. */
export function ownedTalents(actor) {
  return actor.items
    .filter(item => item.type === "talent")
    .sort(compareTalents);
}

/** Where the published Talents live once imported. */
const PACK = "dbu-ttrpg.talents";

/** What a Trait file becomes as an Item - also a Talent a Racial Trait gives (racial.mjs). */
export function talentItemFrom(trait) {
  return itemFrom(trait);
}

function itemFrom(trait) {
  return {
    name: trait.name,
    type: "talent",
    // Kept so a re-import can recognise this Talent again. Matching by name meant a
    // renamed Talent came back as a duplicate and an edited one could never be updated,
    // because nothing tied the Item to the file it came from.
    flags: { "dbu-ttrpg": { sourceId: trait.id } },
    system: {
      description: trait.description ?? "",
      // Read off its file as a list where it names several ("Artful Strike, Insight Score of 6+") - written back as it reads.
      prerequisites: [].concat(trait.prerequisites ?? []).join(", "),
      // Its Talent Category: the file's `talentCategory:`, or its name's.
      category: talentCategoryOf(trait)?.id ?? "",
      race: talentCategoryOf(trait)?.race ?? "",
      text: trait.text ?? "",
      addendum: trait.addendum ?? "",
      script: trait.script ?? ""
    }
  };
}

/**
 * Fill the Talents compendium from the files, so there is something to drag.
 *
 * The pack ships empty - a compendium is a binary database, not something that can be
 * written by hand - so it is populated here. Talents already in it are left alone: a GM
 * may have edited one, and importing again must not undo that.
 */
export async function importCoreTalents() {
  const pack = game.packs.get(PACK);
  if (!pack) {
    ui.notifications.error("The DBU Talents compendium is missing.");
    return;
  }
  if (pack.locked) {
    ui.notifications.warn("The DBU Talents compendium is locked. Unlock it and try again.");
    return;
  }

  const index = await pack.getIndex({ fields: ["flags.dbu-ttrpg.sourceId"] });
  // getIndex returns a Collection, which is not an Array: it has map and filter but
  // not flatMap, so it is spread before being treated as one.
  const existing = new Set([...index].flatMap(entry =>
    [entry.flags?.["dbu-ttrpg"]?.sourceId, entry.name].filter(Boolean)));

  const available = talentFiles();
  if (!available.length) {
    ui.notifications.error(
      "No Talents were read from traits/talents/. Check the console for why."
    );
    return;
  }

  const missing = available.filter(trait =>
    !existing.has(trait.id) && !existing.has(trait.name));

  if (!missing.length) {
    ui.notifications.info("Every core talent is already in the compendium.");
    return;
  }

  await Item.implementation.createDocuments(missing.map(itemFrom), { pack: PACK });
  ui.notifications.info(`Imported ${missing.length} core talent(s) into the compendium.`);
}

/**
 * Read every Talent back from its file, overwriting what is in the compendium.
 *
 * The counterpart to leaving edits alone above. A file is the source a Trait was
 * written in, so there has to be a way to say "take that version" - and doing it on a
 * button rather than silently means a GM's own edits are never lost by surprise.
 */
export async function reloadCoreTalents() {
  const pack = game.packs.get(PACK);
  if (!pack || pack.locked) {
    ui.notifications.warn("The DBU Talents compendium is missing or locked.");
    return;
  }

  const index = await pack.getIndex({ fields: ["flags.dbu-ttrpg.sourceId"] });
  const byId = new Map([...index]
    .map(entry => [entry.flags?.["dbu-ttrpg"]?.sourceId ?? entry.name, entry._id])
    .filter(([key]) => key));

  const updates = [];
  const creations = [];

  for (const trait of talentFiles()) {
    const id = byId.get(trait.id) ?? byId.get(trait.name);
    if (id) updates.push({ _id: id, ...itemFrom(trait) });
    else creations.push(itemFrom(trait));
  }

  if (updates.length) await Item.implementation.updateDocuments(updates, { pack: PACK });
  if (creations.length) await Item.implementation.createDocuments(creations, { pack: PACK });

  ui.notifications.info(
    `Reloaded ${updates.length} talent(s) from their files, and added ${creations.length}.`
  );
}
