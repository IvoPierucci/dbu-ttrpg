/**
 * Debug's Maneuver Access (the user's, 2026-11-16, in place of 2026-11-15's God Maneuvers): a button on the Settings tab's Debug opens
 * a window ticking which Special and God Maneuvers the character has - Villainous on an Adversary's - open as an effect's grant opens
 * them, a God Maneuver usable only in the God Ki State. Sections and types filter it, hidden where every one is open; the search
 * ignores them.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = process.argv[2];
const APP = (process.env.FOUNDRY_APP || String.raw`C:\Program Files\Foundry Virtual Tabletop\resources\app`);
const require = createRequire(path.join(APP, "package.json"));
const Handlebars = require("handlebars");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");
let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};
const MAN = read("module", "maneuvers.mjs"), SH = read("module", "sheets", "actor-character-sheet.mjs"), ST = read("templates", "parts", "actor-settings.hbs");
const fn = name => { const at = MAN.indexOf(`function ${name}(`); return MAN.slice(at, MAN.indexOf("\n}\n", at) + 3).replace(/^export /, ""); };
const whyNotGod = new Function("permits", "granted",
  `const DEBUG_GOD_MANEUVERS = "debugGodManeuvers";\nconst DEBUG_MANEUVERS = "debugManeuvers";\n${fn("debugManeuvers")}\n${fn("whyNotGod")}\nreturn whyNotGod;`)(
  (slots, key) => slots?.[key] !== false, (slots, key) => slots?.[key] === true);
const actor = ({ ticked = [], old = [], inGod = false, slots = {} } = {}) => ({ name: "Goku", system: { effects: { slots }, divineKi: { active: inGod } },
  getFlag: (scope, key) => ((key === "debugManeuvers") ? ticked : ((key === "debugGodManeuvers") ? old : undefined)) });
const strike = { id: "god-strike", name: "God Strike" };
check("not granted, not ticked: closed; ticked, out of God Ki: the State asked; ticked in God Ki: open (the older list read too); an effect's grant as before",
  [Boolean(whyNotGod(actor({ inGod: true }), strike)), whyNotGod(actor({ ticked: ["god-strike"] }), strike), whyNotGod(actor({ ticked: ["god-strike"], inGod: true }), strike),
   whyNotGod(actor({ old: ["god-strike"], inGod: true }), strike),
   whyNotGod(actor({ inGod: true, slots: { "maneuver.god-strike": true } }), strike), Boolean(whyNotGod(actor({ ticked: ["god-strike"], inGod: true, slots: { "maneuver.god-strike": false } }), strike))],
  [true, "God Strike is a God Maneuver: only in the God Ki State.", null, null, null, true]);

const page = Handlebars.compile(ST.slice(ST.indexOf("{{#if combatWindow.maneuverAccess}}"), ST.indexOf("{{#if combatWindow.stateTriggers}}")));
const drawn = page({ combatWindow: { maneuverAccess: true }, editable: true, maneuverAccess: {
  sections: [{ key: "special", label: "Special" }, { key: "god", label: "God" }],
  types: [{ key: "standard", label: "Standard" }, { key: "instant", label: "Instant" }],
  rows: [{ id: "dance", name: "Dance", key: "dance", section: "special", sectionLabel: "Special", type: "standard", typeLabel: "Standard", lock: "", ticked: true, open: true },
    { id: "feint", name: "Feint", key: "feint", section: "special", sectionLabel: "Special", type: "instant", typeLabel: "Instant", lock: "Skill: Bluff 2", ticked: false, open: true },
    { id: "god-bind", name: "God Bind", key: "god bind", section: "god", sectionLabel: "God", type: "standard", typeLabel: "Standard", lock: "", ticked: false, open: false }] } });
check("the window: a search, a button a section and a type, a row each - ticked, opened by something else (ticked, locked, said what), or not - and Untick all",
  [drawn.includes("data-access-search"), (drawn.match(/data-access-section="/g) ?? []).length, (drawn.match(/data-access-type="/g) ?? []).length,
   /data-id="dance"\s*checked\/>/.test(drawn), /data-id="feint"\s*checked disabled\/>/.test(drawn), drawn.includes("Skill: Bluff 2"),
   /data-id="god-bind"\s*\/>/.test(drawn), drawn.includes('data-section="god" data-type="standard"'), drawn.includes('data-name="god bind" data-open="0"'),
   (drawn.match(/data-action="toggleDebugManeuver"/g) ?? []).length, drawn.includes('data-action="clearDebugManeuvers"')],
  [true, 2, 3, true, true, true, true, true, true, 3, true]);
check("opened from Debug's button; Villainous on an Adversary's sheet alone; sections and types hidden where every one is open, the search ignoring them; the toggle gives the Item it opens and folds the older list in",
  [ST.includes('data-action="openCombatWindow" data-window="maneuverAccess" class="capacity-reset"'), SH.includes('maneuverAccess: windowIs === "maneuverAccess",'),
   SH.includes('.filter(([key]) => (key !== "villainous") || isAdversary(this.actor))'), MAN.includes('.filter(({ section }) => adversary || (section !== "villainous"))'),
   SH.includes("const shown = sections.map(button => button.dataset.accessSection).filter(key => left(key) > 0);"),
   SH.includes('button.hidden = (key !== "all") && !typesLeft.has(key);'), SH.includes("const show = query ? row.dataset.name.includes(query)"),
   SH.includes('if (definition) await this.actor.createEmbeddedDocuments("Item", [maneuverItemFrom(definition)]);'),
   SH.includes("[`flags.dbu-ttrpg.-=${DEBUG_GOD_MANEUVERS}`]: null"), MAN.includes("if (debugManeuvers(actor).includes(maneuver.id)) return null;")],
  [true, true, true, true, true, true, true, true, true, true]);

console.log(failed ? `${failed} failing` : "all passing");
process.exit(failed ? 1 : 0);
