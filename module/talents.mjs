/**
 * The core Talent list, used to seed the world with Talent Items.
 *
 * A character's Talents are the Talent Items they own, not entries in this file: this
 * is only where the published ones come from, so a GM can import them once instead of
 * typing each in by hand. Anything else - homebrew, a Talent edited in play - is just
 * another Item.
 */

const SOURCE = "systems/dbu-ttrpg/talents.json";

/** Loaded talent definitions, keyed by id. Populated by loadTalents(). */
const talents = new Map();

/**
 * Every effect entry of the given kind across the Talents a character has.
 *
 * Returns entries rather than a total, since what an entry means is the caller's
 * business: one rule sums them, another takes the largest, another cares about which
 * option they name.
 */
export function talentEffects(actor, key) {
  return ownedTalents(actor)
    .flatMap(item => item.system.effects ?? [])
    .filter(effect => effect.key === key);
}

/** The Talent Items a character owns, in name order. */
export function ownedTalents(actor) {
  return actor.items
    .filter(item => item.type === "talent")
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Load the talent list. One file: a Talent is a rule, not something a group extends. */
export async function loadTalents() {
  talents.clear();

  let file;
  try {
    file = await foundry.utils.fetchJsonWithTimeout(SOURCE);
  }
  catch (error) {
    console.error("DBU TTRPG | Could not read talents.json; no talents will be available.", error);
    return;
  }

  for (const talent of (Array.isArray(file?.talents) ? file.talents : [])) {
    if (!talent?.id || !talent?.name) {
      console.warn("DBU TTRPG | A talent is missing an id or a name; skipping.", talent);
      continue;
    }
    if (talents.has(talent.id)) {
      console.warn(`DBU TTRPG | Talent id "${talent.id}" is defined more than once; keeping the first.`);
      continue;
    }
    talents.set(talent.id, talent);
  }

  console.log(`DBU TTRPG | Loaded ${talents.size} core talent(s)`);
}

/** Where the published Talents live once imported. */
const PACK = "dbu-ttrpg.talents";

/**
 * Fill the Talents compendium with the published Talents, so there is something to
 * drag onto a character.
 *
 * The pack itself ships empty - a compendium is a binary database, not something that
 * can be written by hand - so it is populated here, once, from talents.json. Talents
 * already in the pack are left alone: a GM may have edited one, and re-importing must
 * not undo that.
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

  const index = await pack.getIndex();
  const existing = new Set(index.map(entry => entry.name));
  const missing = [...talents.values()].filter(talent => !existing.has(talent.name));

  if (!missing.length) {
    ui.notifications.info("Every core talent is already in the compendium.");
    return;
  }

  await Item.implementation.createDocuments(
    missing.map(talent => ({
      name: talent.name,
      type: "talent",
      system: {
        description: talent.description ?? "",
        prerequisites: talent.prerequisites ?? "",
        effects: talent.effects ?? []
      }
    })),
    { pack: PACK }
  );

  ui.notifications.info(`Imported ${missing.length} core talent(s) into the compendium.`);
}
