/**
 * A sheet turned into another kind (the user's: a Settings button, Character -> Adversary and the rest, keeping everything shared).
 * The same Actor, its system data written whole (Foundry's rule for a type change), the Villainous Maneuvers given or taken off,
 * the token's link following a Minion's; and the Settings panel, the GM's alone, asking before it is done.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

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

globalThis.foundry = {
  utils: { deepClone: value => structuredClone(value) },
  data: { operators: { ForcedReplacement: { create: value => ({ forced: value }) } } }
};
const { SHEET_TYPES, sheetTypeLabel, typeChangePlan } = await import(pathToFileURL(path.join(ROOT, "module", "change-type.mjs")).href);

const system = { powerLevel: 7, progression: [{ level: 2, choice: "Talent Addition", talent: "quick-learner" }], adversary: { category: "villain", pcc: 4 } };
const maneuver = (id, source = "Core Rule") => ({ id: `i-${id}`, type: "maneuver", name: id, system: { maneuverId: id, source } });
const actorOf = (type, items = [], extra = {}) => ({ type, name: "Raditz", isToken: false, items,
  toObject: () => ({ system: structuredClone(system) }), ...extra });
const villainous = ["act-again", "get-up"].map(id => ({ name: id, type: "maneuver", system: { maneuverId: id, source: "Villainous Maneuver" } }));

const toAdversary = typeChangePlan(actorOf("character", [maneuver("strike"), maneuver("get-up", "Villainous Maneuver")]), "adversary", villainous);
check("Character -> Adversary: its system data written whole, as it is", [toAdversary.update.type, toAdversary.update.system.forced], ["adversary", system]);
check("and the Villainous Maneuvers it lacks given, none taken off", [toAdversary.add.map(entry => entry.name), toAdversary.remove], [["act-again"], []]);
check("the token's link left as it was between Character and Adversary", "prototypeToken" in toAdversary.update, false);

const back = typeChangePlan(actorOf("adversary", [maneuver("strike"), maneuver("act-again", "Villainous Maneuver")]), "character", villainous);
check("Adversary -> Character: the Villainous Maneuvers taken off, nothing given", [back.remove, back.add], [["i-act-again"], []]);

check("into a Minion: its token a copy; out of one: the sheet",
  [typeChangePlan(actorOf("character"), "minion").update.prototypeToken, typeChangePlan(actorOf("minion"), "adversary", villainous).update.prototypeToken],
  [{ actorLink: false }, { actorLink: true }]);

check("refused: the same kind, an unlinked token's copy, an unknown kind",
  [typeChangePlan(actorOf("character"), "character").refused, Boolean(typeChangePlan(actorOf("character", [], { isToken: true }), "adversary").refused),
   Boolean(typeChangePlan(actorOf("character"), "npc").refused)],
  ["Raditz is already a Character.", true, true]);
check("the kinds, each with its article", [Object.keys(SHEET_TYPES), sheetTypeLabel("adversary"), sheetTypeLabel("minion")],
  [["character", "adversary", "minion"], "an Adversary", "a Minion"]);

// The sheet: asked first, then done - closed and opened again, since which tabs it has is the kind's.
const SHEET = read("module", "sheets", "actor-character-sheet.mjs");
check("the sheet's actions and its GM-only context",
  ["changeSheetType: DBUCharacterSheet._onChangeSheetType,", "keepSheetType: DBUCharacterSheet._onKeepSheetType,",
   "context.sheetType = game.user?.isGM ? {", "await this.close();\n    const refused = await changeActorType(actor, type);"].map(text => SHEET.includes(text)),
  [true, true, true, true]);

const settings = Handlebars.compile(read("templates", "parts", "actor-settings.hbs"));
const render = sheetType => settings({ tabs: { settings: { cssClass: "" } }, system: { debug: {} }, specialties: [], editable: true, sheetType });
const asked = { name: "Raditz", current: "a Character", options: [{ key: "adversary", label: "Adversary" }, { key: "minion", label: "Minion" }], confirm: null };
const shown = render(asked);
check("the panel: what it is, the other kinds offered, the button",
  [shown.includes("This sheet is a Character"), (shown.match(/<option value="(\w+)"/g) ?? []).length, shown.includes('data-action="changeSheetType"'),
   shown.includes('data-sure="1"')], [true, 2, true, false]);
const confirming = render({ ...asked, confirm: { key: "adversary", label: "an Adversary" } });
check("asked before it is done", [confirming.includes("Turn Raditz into an Adversary?"), confirming.includes('data-action="keepSheetType"')], [true, true]);
check("not drawn for a player", render(null).includes("Sheet type"), false);

console.log(failed ? `${failed} failing` : "all passing");
process.exit(failed ? 1 : 0);
