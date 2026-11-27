/**
 * The Maneuvers tab's search over every Maneuver of yours, not the open tab's alone (the user's, 2026-11-15): typed into, each type
 * with a match shown under its name - those hidden by Hide Maneuvers too; emptied, the open tab as it was.
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

const SH = read("module", "sheets", "actor-character-sheet.mjs"), TP = read("templates", "parts", "actor-maneuvers.hbs");
const at = SH.indexOf("  #applyManeuverSearch() {");
const body = SH.slice(SH.indexOf("{", at) + 1, SH.indexOf("\n  }\n", at)).replaceAll("this.#maneuverQuery", "self.query").replaceAll("this.element", "self.element");
const apply = new Function("self", body);

// A small DOM: what the search asks of it.
const el = (attrs = {}, children = []) => ({ attrs: { ...attrs }, children, hidden: "hidden" in attrs,
  hasAttribute(name) { return name in this.attrs; }, get dataset() { return this.attrs.dataset ?? {}; }, textContent: attrs.text ?? "" });
const all = (node, test) => [node, ...node.children.flatMap(child => all(child, test))].filter(test);
const finder = node => ({
  querySelectorAll: selector => {
    const attr = /^\[([\w-]+)\]$/.exec(selector)?.[1];
    if (selector === "li.maneuver") return all(node, each => each.attrs.row);
    return all(node, each => each.attrs.kind === attr);
  },
  querySelector: selector => {
    const count = /^\[data-maneuver-count="(\w+)"\]$/.exec(selector);
    if (count) return all(node, each => (each.attrs.kind === "data-maneuver-count") && (each.attrs.key === count[1]))[0] ?? null;
    if (selector === "[data-maneuver-name]") return all(node, each => each.attrs.kind === "data-maneuver-name")[0] ?? null;
    return all(node, each => each.attrs.kind === /^\[([\w-]+)\]$/.exec(selector)?.[1])[0] ?? null;
  }
});
const wrap = node => { Object.assign(node, finder(node)); node.children.forEach(wrap); return node; };
const row = (name, managed = false) => el({ row: true, ...(managed ? { "data-manage-hidden": true, hidden: true } : {}) },
  [el({ kind: "data-maneuver-name", dataset: { maneuverName: name } })]);
const pane = (key, active, rows) => el({ kind: "data-maneuver-pane", dataset: { maneuverPane: key }, ...(active ? { "data-maneuver-active": true } : { hidden: true }) },
  [el({ kind: "data-maneuver-pane-title", hidden: true }), el({ kind: "data-maneuver-tabonly" }), ...rows]);
const counts = ["standard", "counter", "instant"].map(key => el({ kind: "data-maneuver-count", key }));
const panes = [pane("standard", true, [row("Basic Attack"), row("Power Up"), row("Power Burst", true)]),
  pane("counter", false, [row("Parry"), row("Power Clash")]), pane("instant", false, [row("Dodge")])];
const noresult = el({ kind: "data-maneuver-noresult", hidden: true });
const root = wrap(el({}, [...counts, ...panes, noresult]));
const state = () => [panes.map(each => each.hidden), panes.map(each => each.children.filter(child => child.attrs.row).map(child => child.hidden)),
  counts.map(each => each.textContent), panes.map(each => each.children[0].hidden), panes.map(each => each.children[1].hidden), noresult.hidden];

apply({ query: "power", element: root });
check("\"power\": every type with a match shown under its name, the hidden-by-Manage one too; counts its matches; tab-only notes away",
  state(), [[false, false, true], [[true, false, false], [true, false], [true]], ["2", "1", "0"], [false, false, false], [true, true, true], true]);
apply({ query: "zzz", element: root });
check("nothing found: every type away, and said once", [panes.map(each => each.hidden), noresult.hidden], [[true, true, true], false]);
apply({ query: "", element: root });
check("emptied: the open tab again, the hidden-by-Manage one hidden again, counts as they were",
  state(), [[false, true, true], [[false, false, true], [false, false], [false]], ["2", "2", "1"], [true, true, true], [false, false, false], true]);

// Drawn: every one of yours, the hidden ones marked; the open pane marked; one "nothing found" for all.
const html = Handlebars.compile(TP)({ tabs: { maneuvers: { cssClass: "" } }, editable: true, combatWindow: {}, maneuverManage: { picks: [], outOfSequence: {} },
  maneuverGroups: [{ key: "standard", label: "Standard", active: true, count: 1, hidden: 1,
    maneuvers: [{ itemId: "a", name: "Basic Attack", playable: true }, { itemId: "b", name: "Power Burst", playable: true, manageHidden: true }] },
  { key: "counter", label: "Counter", active: false, count: 0, hidden: 0, maneuvers: [] }] });
check("drawn: the hidden one there but hidden, the open pane marked, each type's name, \"None of this type\" tab-only, one no-result line",
  [/data-item-id="b" draggable="true" data-manage-hidden hidden>/.test(html), /data-maneuver-pane="standard"\s+data-maneuver-active>/.test(html),
   /data-maneuver-pane="counter"\s+hidden>/.test(html), (html.match(/data-maneuver-pane-title hidden>/g) ?? []).length,
   html.includes('<li class="dbu-clist-empty" data-maneuver-tabonly>None of this type.</li>'), (html.match(/data-maneuver-noresult hidden/g) ?? []).length],
  [true, true, true, 2, true, 1]);
check("the sheet draws every one, marking those Hide Maneuvers hid",
  SH.includes("maneuvers: maneuvers.map(maneuver => ({ ...maneuver, manageHidden: hidden.has(maneuver.itemId) })) };"), true);

console.log(failed ? `${failed} failing` : "all passing");
process.exit(failed ? 1 : 0);
