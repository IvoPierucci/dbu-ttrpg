/**
 * A Unique Ability copied - Advanced Learner (2) - comes Free, its Advancements too: access till the Encounter ends, none of the
 * character's TP spent on it (the user's). Kept as the Encounter ends, its TP Cost is theirs: Free no more.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");
let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};
const CH = read("module", "chat.mjs"), CB = read("module", "combat.mjs");

// The copy's own lines, run on a Unique Ability's data.
const at = CH.indexOf("  if (data.system?.unique) {", CH.indexOf("async function copyTechnique("));
const block = CH.slice(at, CH.indexOf("\n  }\n", at) + 4);
const copyOf = system => { const data = { system: structuredClone(system) }; new Function("data", block)(data); return data.system; };
const source = { tags: ["uniqueAbility"], unique: { tpCost: 20, free: false, advancements: [{ id: "a", bought: true, tp: 5, free: false }] } };
const copied = copyOf(source);

let uniqueTPOf = null;
try { ({ uniqueTPOf } = await import(pathToFileURL(path.join(ROOT, "module", "unique.mjs")).href)); } catch { uniqueTPOf = null; }
const cost = unique => uniqueTPOf ? uniqueTPOf(unique).total : null;
check("copied: Free, its Advancements Free; nothing of the character's TP spent - the source's own untouched",
  [copied.unique.free, copied.unique.advancements.map(entry => entry.free), cost(copied.unique), source.unique.free, cost(source.unique)],
  [true, [true], uniqueTPOf ? 0 : null, false, uniqueTPOf ? 25 : null]);
check("a Signature Technique copied: nothing of it changed (counted out of the TP otherwise)", copyOf({ tags: ["signature"], signature: { freeTP: 0 } }),
  { tags: ["signature"], signature: { freeTP: 0 } });
check("kept as the Encounter ends: Free no more, nor its Advancements - with Advanced Learner (1)'s 3 off still",
  [CB.includes('const paid = (item.system?.tags ?? []).includes("uniqueAbility") ? { "system.unique.free": false,'),
   CB.includes("map(entry => ({ ...entry, free: false })) } : {};"), CB.includes('"flags.dbu-ttrpg.-=copied": null, ...paid, ...off });')],
  [true, true, true]);
console.log(failed ? `${failed} failing` : "all passing");
process.exit(failed ? 1 : 0);
