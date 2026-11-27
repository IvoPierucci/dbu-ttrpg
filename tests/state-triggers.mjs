// The Settings tab's Triggered / Automatic for States (the user's, 2026-10-30): every State's Triggered effects, one button
// an effect named by its level and number, set beforehand the way a Racial Trait's are - and the ones that may never be
// Automatic (an Out-of-Sequence Maneuver's, Raging's Apoplectic) left out.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const ROOT = process.argv[2];
const APP = (process.env.FOUNDRY_APP || String.raw`C:\Program Files\Foundry Virtual Tabletop\resources\app`);
const appUrl = p => pathToFileURL(path.join(APP, p)).href;
const modUrl = p => pathToFileURL(path.join(ROOT, "module", p)).href;

globalThis.CONST = {};
globalThis.foundry = {};
await import(appUrl("common/primitives/_module.mjs"));
globalThis.foundry.utils = { ...await import(appUrl("common/utils/_module.mjs")) };
globalThis.foundry.data = { ...await import(appUrl("common/data/_module.mjs")) };
globalThis.foundry.data.operators = { ForcedReplacement: { create: value => value } };
const { default: DataModel } = await import(appUrl("common/abstract/data.mjs"));
globalThis.foundry.abstract = { DataModel, TypeDataModel: DataModel };
globalThis.ui = { notifications: { warn: () => {}, error: () => {}, info: () => {} } };
globalThis.game = { combat: null };
const TRAITS = path.join(ROOT, "traits");
globalThis.foundry.utils.fetchJsonWithTimeout = async () =>
  JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));
globalThis.fetch = async url => {
  const file = path.join(TRAITS, String(url).replace("systems/dbu-ttrpg/traits/", ""));
  if (!fs.existsSync(file)) return { ok: false, status: 404, statusText: "missing" };
  return { ok: true, status: 200, text: async () => fs.readFileSync(file, "utf8") };
};

const { loadTraits, traitsOfKind } = await import(modUrl("effects/traits.mjs"));
const { automaticIds, STATE_CODE_TRIGGERS, stateTriggerBlocks, reactiveFor } = await import(modUrl("effects/registry.mjs"));
await loadTraits();

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

// The sheet's own method, cut out and run against a character's flags: what they set Automatic, and set back to Triggered.
const SHEET = fs.readFileSync(path.join(ROOT, "module", "sheets", "actor-character-sheet.mjs"), "utf8");
const from = SHEET.indexOf("  #stateTriggers() {");
const to = SHEET.indexOf("  #toggleButtons(item, triggered) {", from);
const body = SHEET.slice(SHEET.indexOf("{", from) + 1, SHEET.lastIndexOf("}", to)).replaceAll("this.actor", "actor");
const ordinalFrom = SHEET.indexOf("function ordinal(n) {");
const ordinalSource = SHEET.slice(ordinalFrom, SHEET.indexOf("\n}\n", ordinalFrom) + 2);
const fn = new Function("actor", "traitsOfKind", "automaticIds", "STATE_CODE_TRIGGERS", "stateTriggerBlocks",
  `${ordinalSource}\n${body}`);
const actorWith = (automatic = [], triggered = []) =>
  ({ getFlag: (scope, key) => ({ automatic, triggered })[key] });
const run = actor => fn(actor, traitsOfKind, automaticIds, STATE_CODE_TRIGGERS, stateTriggerBlocks);
const automaticOf = rows => rows.map(row => [row.key, row.buttons.map(button => button.automatic)]);

const rows = run(actorWith());
check("the States with a Triggered effect that may be Automatic, and only those",
  rows.map(row => row.name), ["Entrusted", "Feral", "Incorporeal", "Mindful", "Multiple Arms", "Spectator", "Surging"]);
check("Raging's Apoplectic hands over an Out-of-Sequence Maneuver, so it is never offered",
  rows.some(row => row.key === "raging"), false);
check("one button an effect, named by its level and number",
  rows.map(row => row.buttons.map(button => button.label)),
  [["3rd effect"], ["Unhinged \u00b7 1st effect"], ["1st effect"], ["Zen \u00b7 1st effect", "Tranquil \u00b7 1st effect"],
    ["2nd effect"], ["1st effect"], ["5th effect"]]);
check("Tranquil's three moments - entering, a level reached, a Round's start - are one button, set together",
  rows.find(row => row.key === "mindful").buttons[1].id, "state:mindful#4,state:mindful#5,state:mindful#6");
// The user's: every one Automatic from the start but Surging's 5th.
check("Automatic from the start, every one but Surging's 5th",
  automaticOf(rows), [["entrusted", [true]], ["feral", [true]], ["incorporeal", [true]], ["mindful", [true, true]],
    ["multiple-arms", [true]], ["spectator", [true]], ["surging", [false]]]);
check("set back to Triggered, it stays so; Surging's set Automatic, it is",
  automaticOf(run(actorWith(["state:surging#4"], ["state:feral#unhinged", "state:entrusted#2"])))
    .filter(([key]) => ["entrusted", "feral", "surging"].includes(key)),
  [["entrusted", [false]], ["feral", [false]], ["surging", [true]]]);
check("a button is Automatic only when every one of its blocks is",
  run(actorWith([], ["state:mindful#5"])).find(row => row.key === "mindful").buttons[1].automatic, false);
check("Multiple Arms (2) Triggered, as printed - on entering and as each Round starts, one button",
  [rows.find(row => row.key === "multiple-arms").buttons[0].id.split(",").length,
   /\[passive\][^[]*actions\.counter \+= 1/.test(fs.readFileSync(path.join(ROOT, "traits", "states", "multiple-arms.dbu"), "utf8"))],
  [2, false]);

// One answer everywhere it is asked: the runtime's own question, and the code-built ones'.
const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
check("Feral's Unhinged and Incorporeal's no Damage answer through the same question, by default",
  [CHAT.includes('if (automaticOn(attacker, "state:feral#unhinged")) return true;'),
   CHAT.includes('if (automaticOn(target, "state:incorporeal#no-damage")) return true;'),
   CHAT.includes("return automaticIds(actor).has(id);"), CHAT.includes('getFlag?.(SCOPE, "automatic")'),
   automaticIds(actorWith()).has("state:feral#unhinged"), automaticIds(actorWith([], ["state:feral#unhinged"])).has("state:feral#unhinged")],
  [true, true, true, false, true, false]);
check("and the runtime: a State's Triggered block armed by default once the State is held",
  reactiveFor({ items: [], system: { states: { mindful: 3 } }, getFlag: actorWith().getFlag })
    .filter(entry => entry.sourceId === "state:mindful").map(entry => [entry.blockId, entry.armed]),
  [["state:mindful#2", true], ["state:mindful#4", true], ["state:mindful#5", true], ["state:mindful#6", true]]);
const SHEET_TOGGLE = SHEET.slice(SHEET.indexOf("static async _onAutomateTrigger("), SHEET.indexOf("static async _onArmTalent("));
check("the toggle remembers a default one set back, and forgets it once set Automatic again",
  SHEET_TOGGLE.includes("const all = ids.every(id => automaticIds(this.actor).has(id));")
    && SHEET_TOGGLE.includes("back.add(id);") && SHEET_TOGGLE.includes("back.delete(id);"), true);

const SETTINGS = fs.readFileSync(path.join(ROOT, "templates", "parts", "actor-settings.hbs"), "utf8");
const require = createRequire(`${(process.env.FOUNDRY_APP || (process.env.FOUNDRY_APP || String.raw`C:\Program Files\Foundry Virtual Tabletop\resources\app`))}/package.json`);
const Handlebars = require("handlebars");
// Shut, the tab holds a button; open, the window over the sheet holds the list (the user's: the list took the whole tab).
const shut = Handlebars.compile(SETTINGS)({ stateTriggers: rows, allies: [], editable: true, combatWindow: {} });
check("on the Settings tab a button, the list only in its window",
  [/data-action="openCombatWindow" data-window="stateTriggers"/.test(shut), shut.includes('data-action="automateTrigger"'),
   SHEET.includes('stateTriggers: windowIs === "stateTriggers",')],
  [true, false, true]);
const html = Handlebars.compile(SETTINGS)({ stateTriggers: rows, allies: [], editable: true, combatWindow: { stateTriggers: true } });
check("drawn on the Settings tab with the Racial Traits' own toggle",
  [/<div class="dbu-combat-overlay">[\s\S]*Triggered \/ Automatic &middot; States/.test(html),
   /data-action="automateTrigger" data-effect-id="state:entrusted#2"\s*data-tooltip="3rd effect">\s*Automatic/.test(html),
   /data-effect-id="state:surging#4"\s*data-tooltip="5th effect">\s*Triggered/.test(html)],
  [true, true, true]);

console.log(failed ? `\n${failed} failing` : "\n0 failing");
process.exit(failed ? 1 : 0);
