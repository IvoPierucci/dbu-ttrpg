/**
 * Loading Traits from files.
 *
 * One file per Trait, so adding one is copying a file and editing it - which is the
 * whole point. The folder a file sits in says two things at once: what the Trait
 * attaches to, and where it sits on the Priority ladder. Those turn out to be the same
 * ordering, which is why the tree mirrors the rulebook's list rather than inventing one.
 *
 * Discovery goes through an index rather than by scanning the directory, and that is a
 * constraint rather than a preference: `FilePicker.browse` needs the FILES_BROWSE
 * permission, whose default role is TRUSTED, so an ordinary player cannot use it.
 * Fetching a file by name needs no permission at all. The index is generated at release
 * rather than maintained by hand.
 */

import { PRIORITY } from "./interpreter.mjs";

const ROOT = "systems/dbu-ttrpg/traits";

/** Which folder means which kind of Trait, and what Priority that carries. */
export const KINDS = Object.freeze({
  aspects: { label: "Aspect", priority: PRIORITY.aspect },
  states: { label: "State", priority: PRIORITY.state },
  transformations: { label: "Transformation Trait", priority: PRIORITY.transformation },
  races: { label: "Racial Trait", priority: PRIORITY.racial },
  talents: { label: "Talent", priority: PRIORITY.talent },
  conditions: { label: "Combat Condition", priority: PRIORITY.condition },
  maneuvers: { label: "Maneuver", priority: PRIORITY.base },
  // A Karmic Effect is bought with a Karma Point rather than granted by anything, so
  // it sits at base Priority - nothing else is competing with it for a Slot.
  karma: { label: "Karmic Effect", priority: PRIORITY.base }
});

/** Everything loaded, keyed by id. */
const traits = new Map();

/** One Trait definition, or undefined. */
export function getTrait(id) {
  return traits.get(id);
}

/** Every Trait of one kind, in name order. Optionally narrowed to one owner. */
export function traitsOfKind(kind, owner = null) {
  return [...traits.values()]
    .filter(t => (t.kind === kind) && (!owner || (t.owner === owner)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Split a file into its header and its script.
 *
 * The header is `key: value` lines, with `>` starting a block of text that runs until
 * the indentation stops. Not YAML - just enough of its shape to be familiar, since the
 * alternative was a script escaped inside a JSON string, which nobody can edit by hand.
 */
export function parseTraitFile(text, path = "") {
  const [head, ...rest] = String(text).split(/^---\s*$/m);
  const script = rest.join("---").replace(/^\n/, "");

  const meta = {};
  const lines = head.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const match = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
    if (!match) continue;

    const [, key, value] = match;
    if (value.trim() !== ">") {
      meta[key] = coerce(value.trim());
      continue;
    }

    // A folded block: every following indented line belongs to it.
    const block = [];
    while ((i + 1 < lines.length) && /^\s+\S/.test(lines[i + 1])) {
      block.push(lines[++i].trim());
    }
    meta[key] = block.join(" ");
  }

  if (!meta.id) meta.id = path.split("/").pop()?.replace(/\.\w+$/, "") ?? "";
  return { ...meta, script };
}

/** Numbers stay numbers, true/false stay booleans, lists split on commas. */
function coerce(value) {
  if (value === "") return "";
  if ((value === "true") || (value === "yes")) return true;
  if ((value === "false") || (value === "no")) return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value.includes(",")) return value.split(",").map(part => part.trim()).filter(Boolean);
  return value;
}

/**
 * Read every Trait named by the index.
 *
 * A file that cannot be read is reported by name and skipped: one bad Trait must not
 * take the rest of the system with it, and least of all silently.
 */
export async function loadTraits() {
  traits.clear();

  let index;
  try {
    index = await foundry.utils.fetchJsonWithTimeout(`${ROOT}/index.json`);
  }
  catch (error) {
    console.error("DBU TTRPG | Could not read the trait index; no Traits will be available.", error);
    // Said out loud, not only to the console: with no index nothing works, and the
    // symptom - empty compendiums, no Maneuvers on a sheet - points nowhere near here.
    ui.notifications?.error("DBU TTRPG | traits/index.json could not be read. No Traits are available.");
    return;
  }

  const wanted = Array.isArray(index?.traits) ? index.traits : [];
  const loaded = await Promise.all(wanted.map(async relative => {
    try {
      const response = await fetch(`${ROOT}/${relative}`);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return { relative, text: await response.text() };
    }
    catch (error) {
      console.error(`DBU TTRPG | Could not read ${relative}.`, error);
      return null;
    }
  }));

  for (const file of loaded) {
    if (!file) continue;

    // The folder is the Trait's kind, and the one after it - when there is one - is
    // what it belongs to: traits/races/android/… are the Android's Racial Traits.
    const parts = file.relative.split("/");
    const kind = parts[0];
    const owner = (parts.length > 2) ? parts[1] : null;

    if (!KINDS[kind]) {
      console.warn(`DBU TTRPG | "${file.relative}" is in a folder this system does not know.`);
      continue;
    }

    const trait = parseTraitFile(file.text, file.relative);
    if (!trait.id || !trait.name) {
      console.warn(`DBU TTRPG | "${file.relative}" has no id or no name; skipping.`);
      continue;
    }
    if (traits.has(trait.id)) {
      console.warn(`DBU TTRPG | Trait id "${trait.id}" is defined more than once; keeping the first.`);
      continue;
    }

    traits.set(trait.id, {
      ...trait,
      kind,
      owner,
      priority: KINDS[kind].priority,
      path: file.relative
    });
  }

  const failed = loaded.filter(file => !file).length;
  if (failed) {
    ui.notifications?.warn(`DBU TTRPG | ${failed} trait file(s) could not be read. See the console.`);
  }
  console.log(`DBU TTRPG | Loaded ${traits.size} trait(s) from files`
    + (failed ? `, ${failed} failed` : ""));
}
