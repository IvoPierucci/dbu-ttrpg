/**
 * Seeding the world with the Talents that ship with the system.
 *
 * A character's Talents are the Talent Items they own, not entries here: this only puts
 * the published ones into the compendium so a GM can drag them onto a character instead
 * of typing each in by hand. They come from the files under `traits/talents/`, which is
 * also where someone writing their own puts theirs.
 */

import { traitsOfKind } from "./effects/traits.mjs";

/** The Talent Items a character owns, in name order. */
export function ownedTalents(actor) {
  return actor.items
    .filter(item => item.type === "talent")
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Where the published Talents live once imported. */
const PACK = "dbu-ttrpg.talents";

/** What a Trait file becomes as an Item. */
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
      prerequisites: trait.prerequisites ?? "",
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

  const available = traitsOfKind("talents");
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

  for (const trait of traitsOfKind("talents")) {
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
