const ROOT = "systems/dbu-ttrpg/races";

/** Loaded race definitions, keyed by id. Populated by loadRaces(). */
const races = new Map();

/** A race definition, or undefined if the id is unknown. */
export function getRace(id) {
  return races.get(id);
}

/** Every loaded race, sorted by name, ready for a select element. */
export function raceOptions() {
  return [...races.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(race => ({ value: race.id, label: race.name, description: race.description ?? "" }));
}

/** The Racial Life Modifier for a race id; 0 when the race is unknown. */
export function racialLifeModifier(id) {
  return races.get(id)?.lifeModifier ?? 0;
}

/** The Attribute Score increase a race grants for one Attribute; 0 if it grants none. */
export function racialAttributeIncrease(id, attribute) {
  return races.get(id)?.attributeIncrease?.[attribute] ?? 0;
}

/**
 * The Saving Throws a race focuses. Always an array: most races name one, but a few
 * name two, and the file may write either a string or a list.
 */
export function racialSavingThrows(id) {
  const save = races.get(id)?.savingThrow;
  if (!save) return [];
  return Array.isArray(save) ? save : [save];
}

/**
 * The Attribute Score increases a race lets the player choose, as a list of
 * { amount, options } - where options is a list of Attribute keys, or "any".
 */
export function racialAttributeChoices(id) {
  return races.get(id)?.attributeChoices ?? [];
}

/**
 * Groups of Attributes from which at most one may be chosen, e.g. the Bio Android
 * may not take both Force and Magic.
 */
export function exclusiveAttributeGroups(id) {
  return races.get(id)?.exclusiveAttributes ?? [];
}

/** How many Skill Ranks a race grants. */
export function racialSkillRankCount(id) {
  return races.get(id)?.skillRanks ?? 0;
}

/**
 * Load every race listed in races/index.json. A browser cannot enumerate a
 * directory, so the manifest is what makes each file discoverable.
 *
 * One bad file must not cost us the rest, so every race is validated and loaded
 * independently; failures are logged and skipped.
 */
export async function loadRaces() {
  races.clear();

  let manifest;
  try {
    manifest = await foundry.utils.fetchJsonWithTimeout(`${ROOT}/index.json`);
  }
  catch (error) {
    console.error("DBU TTRPG | Could not read races/index.json; no races will be available.", error);
    return;
  }

  const files = Array.isArray(manifest?.races) ? manifest.races : [];
  await Promise.all(files.map(file => loadRace(file)));

  console.log(`DBU TTRPG | Loaded ${races.size} race(s)`);
}

async function loadRace(file) {
  try {
    const race = await foundry.utils.fetchJsonWithTimeout(`${ROOT}/${file}`);

    if (!race?.id || !race?.name) {
      console.warn(`DBU TTRPG | Race "${file}" is missing an id or a name; skipping.`);
      return;
    }
    if (!Number.isFinite(race.lifeModifier)) {
      console.warn(`DBU TTRPG | Race "${file}" has no numeric lifeModifier; skipping.`);
      return;
    }
    if (races.has(race.id)) {
      console.warn(`DBU TTRPG | Race id "${race.id}" is defined more than once; keeping the first.`);
      return;
    }

    races.set(race.id, race);
  }
  catch (error) {
    console.warn(`DBU TTRPG | Could not load race "${file}"; skipping.`, error);
  }
}
