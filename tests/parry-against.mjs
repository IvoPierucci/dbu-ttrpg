/**
 * A Parry's Strike against the one attacking (the user's: Lock On's 2(T) and Neo-Tuffle-Raised's 1(T), 3(T) together): what
 * raises your Strike - or Combat Rolls - against one Opponent raises it, and nothing against anybody else.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.argv[2];
const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8").replace(/\r\n/g, "\n");
let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};
// A top-level function's own text, to its closing brace at the start of a line.
const fn = name => {
  const at = CHAT.indexOf(`\nfunction ${name}(`);
  if (at < 0) throw new Error(`no function ${name}`);
  return CHAT.slice(at, CHAT.indexOf("\n}\n", at) + 3);
};
const names = ["parryAgainst", "lockOnParts", "foresightBonus", "inferiorParts", "superiorityParts", "namekianFocusParts", "onboardParts"];
const ROUND = "c1:2";
const make = new Function("SCOPE", "roundKey", "analysisBonus", "specimenParts",
  `${names.map(fn).join("\n")}; return { parryAgainst, namekianFocusParts };`);
const { parryAgainst } = make("dbu-ttrpg", () => ROUND, () => [], () => []);

const actor = (uuid, flags = {}) => ({ uuid, system: { tierOfPower: 3, effects: { slots: {} }, foresight: {} }, items: [],
  getFlag: (scope, key) => flags[key] });
const raditz = actor("Actor.raditz");
const nappa = actor("Actor.nappa");
const defender = actor("Actor.def", {
  lockOn: { uuid: raditz.uuid },
  namekianFocus: { uuid: raditz.uuid, name: "Raditz", round: ROUND, source: "Neo-Tuffle-Raised" }
});
const parts = parryAgainst(defender, raditz);
check("Lock On's Target and Neo-Tuffle-Raised's Opponent: 2(T) + 1(T), each named",
  parts.map(part => [part.label, part.value]), [["Lock On", 6], ["Neo-Tuffle-Raised (Raditz)", 3]]);
check("3(T) in all at Tier 3", parts.reduce((sum, part) => sum + part.value, 0), 9);
check("against anybody else: nothing", parryAgainst(defender, nappa), []);
check("last Round's Opponent: no longer", parryAgainst(actor("Actor.d2", { namekianFocus: { uuid: raditz.uuid, name: "Raditz", round: "c1:1" } }), raditz), []);
check("Namekian-Raised's own, no source kept: named as before",
  parryAgainst(actor("Actor.d3", { namekianFocus: { uuid: raditz.uuid, name: "Raditz", round: ROUND } }), raditz).map(part => part.label),
  ["Namekian-Raised (Raditz)"]);

const parry = CHAT.slice(CHAT.indexOf("  parry: {\n    label: \"Parry\","), CHAT.indexOf("    answer: (actor, options, attack) => rollSide(actor, DEFENCES.parry.parts"));
check("on the Parry's own parts, against its attacker", parry.includes("...parryAgainst(actor, fromUuidSync(attack?.attackerUuid ?? \"\"))"), true);

console.log(failed ? `${failed} failing` : "all passing");
process.exit(failed ? 1 : 0);
