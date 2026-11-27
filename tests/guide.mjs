/**
 * Compile every example in the author guide.
 *
 * The guide is the contract an author writes against, so an example in it that the
 * parser refuses is worse than no example - and section 6 had drifted that far without
 * anything noticing.
 *
 * An example is an indented run of lines beginning with a [header].
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
const MODULES = pathToFileURL(path.join(ROOT, "module", "effects")).href;
const { compile } = await import(`${MODULES}/parser.mjs`);

const model = fs.readFileSync(path.join(ROOT, "module", "data", "actor-character.mjs"), "utf8");
const keys = (from, to) => {
  const start = model.indexOf(from);
  return [...model.slice(start, model.indexOf(to, start)).matchAll(/^\s{4}(\w+):/gm)]
    .map(m => m[1]);
};

const DATA = {
  attributes: Object.fromEntries(
    keys("ATTRIBUTE_ABBREVIATIONS", "});").map(k => [k, { score: 10, mod: 0 }])),
  skills: Object.fromEntries(
    keys("static SKILLS = Object.freeze({", "});").map(k => [k, { bonus: 0, ranks: 0 }])),
  savingThrows: Object.fromEntries(
    ["impulsive", "corporeal", "cognitive", "morale"].map(k => [k, { value: 0 }])),
  conditions: {}, states: {}, resources: {},
  tierOfPower: 3, baseTierOfPower: 3
};

const lines = fs.readFileSync(path.join(ROOT, "WRITING-EFFECTS.txt"), "utf8").split("\n");

const examples = [];
let current = null;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const indented = /^ {4,}\S/.test(line);

  if (!current) {
    // An example starts at a bracketed header, or at a comment directly above one.
    if (indented && /^ {4}(\[|\/\/)/.test(line)) current = { at: i + 1, body: [line] };
    continue;
  }

  if (indented || !line.trim()) {
    current.body.push(line);
    continue;
  }

  examples.push(current);
  current = null;
}
if (current) examples.push(current);

let failed = 0;

for (const example of examples) {
  const src = example.body.join("\n").trimEnd();
  // Only the ones that are whole effects; a fragment showing one line is not.
  if (!/^\s*\[/m.test(src)) continue;

  const { errors } = compile(src, DATA);
  if (!errors.length) continue;

  failed++;
  console.log(`\nFAIL  WRITING-EFFECTS.txt:${example.at}`);
  for (const line of src.split("\n")) console.log(`  | ${line.trim()}`);
  for (const e of errors) console.log(`  -> ${e.line ? `line ${e.line}: ` : ""}${e.message}`);
}

console.log(`\n${examples.length} example(s) found, ${failed} failing`);
process.exit(failed ? 1 : 0);
