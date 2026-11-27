/**
 * The Maneuvers tab's Out of Sequence (the user's, 2026-11-15): in place of a button on each Maneuver, a toggle in Manage with the
 * most Actions beside it; "OOS" on the rows within it; the next one used goes out of sequence and the toggle off. Effects that gave
 * an Out-of-Sequence Maneuver (Genetic Focus: Majins (6), Winged Beast (4)) turn it on at 1. Hide Maneuvers, the list Manage was,
 * in a window of its own.
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

const UM = read("module", "use-maneuver.mjs"), CH = read("module", "chat.mjs");
const SH = read("module", "sheets", "actor-character-sheet.mjs"), TP = read("templates", "parts", "actor-maneuvers.hbs");
const fn = (src, name) => {
  const at = src.indexOf(`export function ${name}(`);
  if (at < 0) throw new Error(`no function ${name}`);
  return src.slice(at, src.indexOf("\n}\n", at) + 3).replace(/^export /, "");
};
const { outOfSequenceMode, fitsOutOfSequence, outOfSequenceGranted } = new Function("OOS_MODE",
  `${["outOfSequenceMode", "fitsOutOfSequence", "outOfSequenceGranted"].map(name => fn(UM, name)).join("\n")}
   return { outOfSequenceMode, fitsOutOfSequence, outOfSequenceGranted };`)("outOfSequenceMode");

const actor = mode => ({ getFlag: (scope, key) => ((key === "outOfSequenceMode") ? mode : undefined) });
check("the mode as held: off by default, at least 1 Action, whole numbers",
  [outOfSequenceMode(actor(undefined)), outOfSequenceMode(actor({ on: true, actions: 2 })), outOfSequenceMode(actor({ on: true, actions: "0" })),
   outOfSequenceMode(actor({ on: true, actions: 2.7 }))],
  [{ on: false, actions: 1 }, { on: true, actions: 2 }, { on: true, actions: 1 }, { on: true, actions: 2 }]);

const on2 = { on: true, actions: 2 };
const m = (type, actionCost, extra = {}) => ({ type, actionCost, actionCostMax: 0, actionCostOpen: false, ...extra });
check("what fits: a Standard Maneuver of that many Actions or fewer; off, nothing; Instant/Counter never; an open cost never; a range by its most",
  [fitsOutOfSequence(m("standard", 1), on2), fitsOutOfSequence(m("standard", 2), on2), fitsOutOfSequence(m("standard", 3), on2),
   fitsOutOfSequence(m("standard", 1), { on: false, actions: 9 }), fitsOutOfSequence(m("instant", 0), on2), fitsOutOfSequence(m("counter", 1), on2),
   fitsOutOfSequence(m("standard", 1, { actionCostOpen: true }), on2), fitsOutOfSequence(m("standard", 1, { actionCostMax: 3 }), on2),
   fitsOutOfSequence(m("standard", 1, { actionCostMax: 2 }), on2)],
  [true, true, false, false, false, false, false, false, true]);
check("an effect's grant: on, at that many Actions", outOfSequenceGranted(1), { "flags.dbu-ttrpg.outOfSequenceMode": { on: true, actions: 1 } });

const owned = UM.slice(UM.indexOf("export async function useOwnedManeuver("), UM.indexOf("\n}\n", UM.indexOf("export async function useOwnedManeuver(")));
check("used from the sheet or the hotbar: out of sequence where it fits - a Signature Technique by its door - and the toggle off after",
  [owned.includes("const outOfSequence = Boolean(door) && fitsOutOfSequence(definitionOf(door), mode);"),
   owned.includes("useTechnique(actor, item.id, { atFeature, outOfSequence })"), owned.includes("useManeuver(actor, definitionOf(item), { atFeature, outOfSequence })"),
   owned.includes("if (used && outOfSequence) await actor.setFlag(\"dbu-ttrpg\", OOS_MODE, { on: false, actions: mode.actions });")],
  [true, true, true, true]);
check("Genetic Focus: Majins (6) and Winged Beast (4) turn it on at 1; their buttons and Demonic Creativity's gone",
  [CH.includes("...outOfSequenceGranted(1) });"), UM.includes('await actor.update({ ...outOfSequenceGranted(1), "flags.dbu-ttrpg.wingedRound": round });'),
   ["majinOutOfSequence", "wingedOutOfSequence", "creativeOutOfSequence", "focusMajinOOS", "wingedSoared"].map(word => SH.includes(word) || TP.includes(word) || UM.includes(word) || CH.includes(word)),
   read("traits", "races", "demon", "demonic-creativity.dbu").includes("allow demonicPower.outOfSequence;")],
  [true, true, [false, false, false, false, false], false]);
check("the sheet: each row asks it; Manage carries it; Hide Maneuvers a window of its own",
  [SH.includes("outOfSequence: fitsOutOfSequence(maneuver, outOfSequenceMode(this.actor)),"), SH.includes("outOfSequence: outOfSequenceMode(this.actor) };"),
   SH.includes('maneuverHide: windowIs === "maneuverHide" };')], [true, true, true]);

// Drawn.
const template = Handlebars.compile(TP);
const row = { itemId: "m1", name: "Basic Attack", playable: true, actionLabel: "1 Action", kiCost: 0 };
const render = (extra = {}) => template({ tabs: { maneuvers: { cssClass: "" } }, editable: true,
  maneuverGroups: [{ key: "standard", label: "Standard", active: true, count: 2,
    maneuvers: [{ ...row, outOfSequence: true }, { ...row, itemId: "m2", name: "Power Up", outOfSequence: false }] }],
  maneuverManage: { label: "Standard", picks: [{ itemId: "m1", name: "Basic Attack", shown: true }], outOfSequence: { on: true, actions: 2 } },
  combatWindow: {}, ...extra });
const list = render();
check("the rows: OOS on the one within it alone, no button for it",
  [(list.match(/class="maneuver-oos dbu-mchip"/g) ?? []).length, /data-action="\w+OutOfSequence"/.test(list)], [1, false]);
const manage = render({ combatWindow: { maneuvers: true } });
check("Manage: the toggle ticked, its Actions, Hide Maneuvers and Close; not the list",
  [manage.includes('name="flags.dbu-ttrpg.outOfSequenceMode.on" checked'), /name="flags\.dbu-ttrpg\.outOfSequenceMode\.actions" value="2"/.test(manage),
   manage.includes('data-window="maneuverHide">Hide Maneuvers</button>'), manage.includes('data-action="pickManeuver"')],
  [true, true, true, false]);
const hide = render({ combatWindow: { maneuverHide: true } });
check("Hide Maneuvers: the list as it was, Show all, Back to Manage, Close",
  [hide.includes("Hide Maneuvers &middot; Standard"), hide.includes('data-action="pickManeuver" data-id="m1" checked'),
   hide.includes('data-action="showAllManeuvers"'), hide.includes('data-window="maneuvers">Back</button>'), hide.includes("outOfSequenceMode.on")],
  [true, true, true, true, false]);

console.log(failed ? `${failed} failing` : "all passing");
process.exit(failed ? 1 : 0);
