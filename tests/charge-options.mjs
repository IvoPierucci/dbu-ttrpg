/**
 * The Energy Charge's list of Attacking Maneuvers (the user's: every one carried was offered - Bite Attack, God Strike and the rest
 * they have no access to): those the character can use, as the Maneuvers tab lists them, and not the Signature Technique Maneuver.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.argv[2];
const UM = fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8").replace(/\r\n/g, "\n");
let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

const at = UM.indexOf("  // Only an Attacking Maneuver can be fed");
const block = UM.slice(UM.indexOf("  const options = actor.items", at), UM.indexOf(".map(item => ({ id: item.id, name: item.name }));", at))
  + ".map(item => item.name);";
const optionsFor = new Function("actor", "definitionOf", "traitActive", "whyNotSpecial", `${block}\nreturn options;`);

const item = (name, system = {}) => ({ id: name, name, type: "maneuver", system: { attacking: true, ...system } });
const items = [
  item("Basic Attack"), item("Throw"), item("Reflect"),
  item("Bite Attack", { fromTrait: "bestial-bite" }),            // a Trait's effect - not on them
  item("Tail Attack", { fromTrait: "saiyan-tail" }),             // a Trait's effect - on them
  item("God Strike", { godManeuver: true }), item("Divine Attack", { godManeuver: true }),
  item("Mimicry of the Whipping Tail", { special: true }),       // a Special Maneuver nothing has opened
  item("Signature Technique", { signatureTechnique: true }),
  item("Kamehameha", { tags: ["signature"] }),
  item("Power Up", { attacking: false })
];
const definitionOf = it => ({ ...it.system, name: it.name, id: it.id });
const on = new Set(["saiyan-tail"]);
const traitActive = (actor, id) => on.has(id);
const whyNotSpecial = (actor, d) => (d.godManeuver || d.special) ? "no access" : null;
check("offered: what can be used and is an attack - a Trait's effect only while the Trait is on them; no God or unopened Special; not the door",
  optionsFor({ items }, definitionOf, traitActive, whyNotSpecial),
  ["Basic Attack", "Throw", "Reflect", "Tail Attack", "Kamehameha"]);
check("God Ki opening the God Maneuvers: offered then",
  optionsFor({ items }, definitionOf, traitActive, (actor, d) => d.special ? "no access" : null).includes("God Strike"), true);
check("the Maneuvers tab's own rule, the same helpers",
  [UM.includes('const { traitActive } = await import("./conditions.mjs");'),
   UM.includes("return !(definition.fromTrait && !traitActive(actor, definition.fromTrait)) && !whyNotSpecial(actor, definition);")], [true, true]);

console.log(failed ? `${failed} failing` : "all passing");
process.exit(failed ? 1 : 0);
