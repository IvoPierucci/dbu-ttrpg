/**
 * That the sheets' tabs agree with themselves.
 *
 * A tab is declared in four places and every one of them has to match the other three: a
 * PART naming a template file, a TAB naming a part, the template's own `data-tab`, and the
 * `{{tabs.<id>.cssClass}}` it reads to know whether it is the one on show.
 *
 * Which is the shape of every bug I keep finding - something declared in one place and
 * read in none - and none of it fails loudly. A PART whose file is missing throws at the
 * table; a TAB with no PART is a tab that opens nothing; a template whose `data-tab` is
 * spelled differently is a tab that never shows.
 *
 * Checked for every sheet in the system rather than the one that just gained a tab.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.argv[2];
const SHEETS = path.join(ROOT, "module", "sheets");

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

/**
 * The `key: { ... }` entries of a static block, by name, with the text of each.
 *
 * Braces counted rather than matched with a pattern. The first version of this wanted a
 * closing brace on a line of its own, which every multi-line entry has and no single-line
 * one does - so it found nothing at all, and "found nothing" came out looking exactly like
 * "this sheet has no tabs". Which is why the caller below insists on knowing which sheets
 * have them.
 */
function entriesOf(text, block) {
  const opens = text.indexOf(`  static ${block} = {`);
  if (opens < 0) return null;

  const from = text.indexOf("{", opens);
  const found = {};
  let depth = 0;
  let key = "";
  let start = 0;

  for (let at = from; at < text.length; at += 1) {
    const ch = text[at];
    if (ch === "{") {
      depth += 1;
      if (depth === 2) {
        const before = text.slice(0, at);
        key = before.match(/(\w+)\s*:\s*$/)?.[1] ?? "";
        start = at + 1;
      }
      continue;
    }
    if (ch !== "}") continue;

    depth -= 1;
    if ((depth === 1) && key) {
      found[key] = text.slice(start, at);
      key = "";
    }
    if (depth === 0) break;
  }

  return found;
}

const sheets = fs.readdirSync(SHEETS).filter(name => name.endsWith(".mjs"));
check("there are sheets to check", sheets.length > 0, true);

// Which sheets have tabs, named. Without this, a parser that suddenly reads nothing is a
// harness that passes every check by finding nothing to check.
check("and these are the ones with tabs",
  sheets.filter(name => {
    const tabs = entriesOf(fs.readFileSync(path.join(SHEETS, name), "utf8"), "TABS");
    return tabs && Object.keys(tabs).length;
  }),
  ["actor-character-sheet.mjs", "actor-vehicle-sheet.mjs", "item-gear-sheet.mjs", "item-maneuver-sheet.mjs", "item-talent-sheet.mjs"]);

for (const name of sheets) {
  const text = fs.readFileSync(path.join(SHEETS, name), "utf8");
  const parts = entriesOf(text, "PARTS") ?? {};
  const tabs = entriesOf(text, "TABS") ?? {};

  if (!Object.keys(tabs).length) continue;

  check(`${name}: its tabs were read`, Object.keys(tabs).length > 0, true);

  // Every tab has a part to draw it.
  check(`${name}: every tab has a part`,
    Object.keys(tabs).filter(id => !parts[id]), []);

  // Every part names a template, and every template is on disk. A part whose file is
  // missing is an error at the table and nothing sooner.
  const templates = Object.fromEntries(Object.entries(parts).map(([key, body]) => {
    const found = body.match(/template: "systems\/dbu-ttrpg\/(.*?\.hbs)"/);
    return [key, found?.[1] ?? ""];
  }));
  check(`${name}: every part names a template`,
    Object.entries(templates).filter(([, file]) => !file).map(([key]) => key), []);
  check(`${name}: every template is on disk`,
    Object.entries(templates)
      .filter(([, file]) => file && !fs.existsSync(path.join(ROOT, file)))
      .map(([key]) => key), []);

  // And each tab's own template knows which tab it is. Both halves: the `data-tab` the
  // tab strip matches on, and the `cssClass` that decides whether it is drawn at all.
  for (const id of Object.keys(tabs)) {
    const file = templates[id];
    if (!file || !fs.existsSync(path.join(ROOT, file))) continue;
    const markup = fs.readFileSync(path.join(ROOT, file), "utf8");

    check(`${name}: ${id}'s template says it is the ${id} tab`,
      markup.includes(`data-tab="${id}"`), true);
    check(`${name}: ${id}'s template reads its own cssClass`,
      markup.includes(`{{tabs.${id}.cssClass}}`), true);
    check(`${name}: ${id}'s template is in the primary group`,
      markup.includes('data-group="primary"'), true);
    // The id inside the TAB entry is the key it is filed under, since the strip reads
    // one and the template is found by the other.
    check(`${name}: ${id}'s TAB entry is filed under its own id`,
      tabs[id].includes(`id: "${id}"`), true);
  }
}

// --- The character sheet's tabs, named -----------------------------------------------------
{
  const text = fs.readFileSync(path.join(SHEETS, "actor-character-sheet.mjs"), "utf8");
  const tabs = Object.keys(entriesOf(text, "TABS"));

  // Named and in order, so a tab appearing or moving is a thing somebody decided rather
  // than something that happened. The user's: a mirror, by the length of the names - five over
  // four, five over five since Adventure, and six over five since Unique Abilities, beside the
  // Signature Techniques in the middle of the top row.
  check("the character sheet's tabs, in the order they are drawn", tabs,
    ["main", "adversary", "combat", "techniques", "uniqueAbilities", "transformations", "traits", "gear", "battlefields", "maneuvers", "customBuffs", "fusion", "adventure",
     "biography", "progression", "settings"]);
  const ADVENTURE_HBS = fs.readFileSync(path.join(ROOT, "templates", "parts", "actor-adventure.hbs"), "utf8");
  const BIOGRAPHY_HBS = fs.readFileSync(path.join(ROOT, "templates", "parts", "actor-biography.hbs"), "utf8");
  check("the Adventuring switch is on the Adventure tab, and off the Biography",
    [ADVENTURE_HBS.includes('name="system.adventuring"'), BIOGRAPHY_HBS.includes('name="system.adventuring"'),
     ADVENTURE_HBS.includes('data-tab="adventure"')], [true, false, true]);
  const TAB_CSS = fs.readFileSync(path.join(ROOT, "styles", "dbu-ttrpg.css"), "utf8");
  check("fourteen tabs, seven and seven since the Transformations (the user's): the strip breaks after the seventh",
    TAB_CSS.includes(".dbu-ttrpg .sheet-tabs > .item:nth-child(n+8) { order: 2; }"), true);

  // Battlefields holds the Light Level now. What is checked here is the wiring - that the
  // picker writes to a field the schema has, and that everything it reads is something
  // `_prepareContext` builds. What the Levels do is `light.mjs`'s to say.
  const markup = fs.readFileSync(
    path.join(ROOT, "templates", "parts", "actor-battlefields.hbs"), "utf8");
  const sheet = fs.readFileSync(
    path.join(ROOT, "module", "sheets", "actor-character-sheet.mjs"), "utf8");
  const character = fs.readFileSync(
    path.join(ROOT, "module", "data", "actor-character.mjs"), "utf8");

  check("the Light Level picker writes to a field",
    markup.includes('name="system.battlefield.lightLevel"'), true);
  check("as a number rather than as text",
    markup.includes('data-dtype="Number"'), true);
  check("and the schema has that field",
    /schema\.battlefield = new fields\.SchemaField/.test(character), true);

  // Every context key the page reads is one the sheet puts there. A page reading a key
  // nobody builds draws nothing and says nothing about why.
  //
  // Block parameters are not context keys: `{{#each lightLevels as |level|}}` names
  // `level` itself, and looking for a `context.level` would be looking for something that
  // should not exist.
  const bound = new Set([...markup.matchAll(/as \|(\w+)\|/g)].map(m => m[1]));
  const read = [...markup.matchAll(/\{\{#?(?:each|if)?\s*([a-z][\w.]*)/g)]
    .map(m => m[1].split(".")[0])
    // `else`, `unless` and their relatives are Handlebars' own words, not keys anybody
    // builds. `system` is the document's and `tabs` is the mixin's.
    .filter(key => !["tabs", "this", "system", "else", "unless", "with", "each", "if",
                     "lookup", "log"].includes(key) && !bound.has(key));
  check("every context key the page reads is one the sheet builds",
    [...new Set(read)].filter(key => !sheet.includes(`context.${key} =`)), []);
  check("and it does read some", read.length > 0, true);
}

console.log(`${failed} failing`);
process.exit(failed ? 1 : 0);
