// What an Automatic effect gave back, said (the user's: Primitive Durability's Life, Legendary Saiyan's Ki on a stack of Battle
// Born): by what wrote it, as much as it came to once capped, the number for Observers alone; and in the Automatic message, not
// a second one.
import fs from "node:fs";
import path from "node:path";
const ROOT = process.argv[2];
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");
const RUNTIME = read("module", "effects", "moments-runtime.mjs");
const CHAT = read("module", "chat.mjs");
let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};
const at = RUNTIME.indexOf("export function regainedLines(");
const regainedLines = new Function(`${RUNTIME.slice(at, RUNTIME.indexOf("\n}\n", at) + 3).replace("export ", "")}; return regainedLines;`)();
const actor = { uuid: "Actor.k", system: { life: { value: 50 }, ki: { value: 40 } } };
const slots = { "life.value": { parts: [{ op: "add", value: 6, source: "Primitive Durability" }] },
  "ki.value": { parts: [{ op: "add", value: 9, source: "Legendary Saiyan" }] } };
check("each by what wrote it, the number kept to Observers", regainedLines(actor, slots, { life: 44, ki: 31 }), [
  'Primitive Durability: <span data-private-of="Actor.k">6 </span>Life Points regained',
  'Legendary Saiyan: <span data-private-of="Actor.k">9 </span>Ki Points regained'].map(line => `<li>${line}</li>`));
check("as much as it came to: capped at 2 of the 6", regainedLines(actor, { "life.value": slots["life.value"] }, { life: 48, ki: 40 })
  .map(line => line.includes(">2 </span>Life")), [true]);
check("nothing regained, at its most already: nothing said", regainedLines(actor, slots, { life: 50, ki: 40 }), []);
check("a loss is not said", regainedLines(actor, { "life.value": { parts: [{ op: "add", value: -5, source: "Poisoned" }] } }, { life: 55, ki: 40 }), []);
check("written before Life and Ki change, said in the Automatic message", [
  RUNTIME.includes("const pools = quiet ? null : { life: Number(actor.system.life?.value) || 0, ki: Number(actor.system.ki?.value) || 0 };\n  await writeStateful(actor, slots);\n  const regained = pools ? regainedLines(actor, slots, pools) : [];"),
  RUNTIME.includes("if (!quiet) await announce(actor, entries, spent, moment, regained);")], [true, true]);
check("the number taken off for whoever may not watch them",
  CHAT.includes('for (const number of html.querySelectorAll("[data-private-of]")) {\n    if (!maySeeRolls(fromUuidSync(number.dataset.privateOf))) number.remove();'), true);
console.log(failed ? `${failed} failing` : "all passing");
process.exit(failed ? 1 : 0);
