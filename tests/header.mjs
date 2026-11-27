/**
 * The sheet's header as the user designed it (2026-11-15): a 96px square portrait, the whole picture; the name with Race, Level, BToP and
 * ToP beside it; no Health Threshold; Life with its Threshold lines (the lowest under the bar), Ki with the Capacity under it - the Capacity
 * unnamed, written on its own, as the Combat tab's is the form's.
 * With a second argument, also writes a preview page with the real stylesheet there.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = process.argv[2];
const PREVIEW = process.argv[3] ?? "";
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

const SH = read("module", "sheets", "actor-character-sheet.mjs"), TP = read("templates", "parts", "actor-header.hbs");

// The lines, as the sheet builds them.
const at = SH.indexOf("    // The header's Life bar (the user's design)");
const block = SH.slice(SH.indexOf("{", at), SH.indexOf("\n    }\n", at) + 6);
const THRESHOLDS = { healthy: { label: "Healthy", above: 0.5 }, bruised: { label: "Bruised", above: 0.25 }, injured: { label: "Injured", above: 0.1 },
  critical: { label: "Critical", above: -Infinity } };
const AD = read("module", "adversary.mjs");
const helper = AD.slice(AD.indexOf("export function thresholdLines("), AD.indexOf("\n}\n", AD.indexOf("function lineLabel(")) + 3).replace(/export /g, "");
const linesFor = (max, minion = false) => {
  const context = {};
  new Function("context", "DBUCharacterData", "typicalMinion", `${helper}\nconst self = { actor: { system: { life: { max: ${max} } } } };\n`
    + block.replaceAll("this.actor", "self.actor"))(context, { THRESHOLDS }, () => minion);
  return context.lifeLines;
};
check("Life 96: Bruised 48 at a half, Injured 24 at a quarter, Critical 9 at a tenth - the lowest under the bar",
  linesFor(96).map(line => [line.label, line.at, line.percent, line.low]),
  [["Bruised", 48, 50, false], ["Injured", 24, 25, false], ["Critical", 9, 10, true]]);
check("a typical Minion's: Injured alone, at a quarter, over the bar; no Life Maximum, no lines",
  [linesFor(40, true).map(line => [line.label, line.at, line.low]), linesFor(0)], [[["Injured", 10, false]], []]);

// Drawn.
const render = (extra = {}) => Handlebars.compile(TP)({ actor: { img: "icons/svg/mystery-man.svg", name: "Kakarot" }, raceName: "Saiyan",
  system: { powerLevel: 7, baseTierOfPower: 3, tierOfPower: 3, life: { value: 84, max: 96 }, ki: { value: 52, max: 70 },
    threshold: { key: "healthy", label: "Healthy" } },
  lifePercent: 88, kiPercent: 74, capacityPercent: 29, capacity: { spent: 4, max: 14 }, lifeLines: linesFor(96), ...extra });
const html = render();
check("the header: the portrait, the name with Race/Level/BToP/ToP, no Health; Life's and Ki's own inputs; three Threshold lines",
  [html.includes('class="dbu-portrait"'), html.includes('data-edit="img"'), html.includes("<em>Race</em>"), html.includes("<em>ToP</em>"),
   html.includes("Health"), html.includes('name="system.life.value" value="84"'), html.includes('name="system.ki.value" value="52"'),
   (html.match(/class="dbu-pool-line/g) ?? []).length, html.includes('class="dbu-pool-line low" style="left: 10%"')],
  [true, true, true, true, false, true, true, 3, true]);
check("the Capacity, its only place (off the Combat tab): what is left of its Maximum, unnamed; what was spent on hover; past it, warned",
  [/<input type="number" data-capacity-left value="10" step="1"/.test(render({ capacity: { spent: 4, max: 14, left: 10 } })), html.includes("dbu-pool-capbar"),
   html.includes('name="system.capacity.spent"'), render({ capacity: { spent: 4, max: 14, left: 10 } }).includes("4 Ki spent of it"),
   render({ capacity: { spent: 18, max: 14, left: -4, over: 4, ignored: true } }).includes("dbu-pool-capacity over"),
   render({ capacity: { spent: 18, max: 14, left: -4, over: 4, ignored: true } }).includes("Ignored, and counted: over by 4")], [true, true, false, true, true, true]);
check("its bar full as the Round starts, emptied by what is spent; what is typed written as the Maximum less it, never below 0, never submitting",
  [SH.includes("value: (Number(capacity.max) || 0) - (Number(capacity.spent) || 0),"),
   SH.includes("left: (Number(system.capacity?.max) || 0) - (Number(system.capacity?.spent) || 0),"),
   SH.includes('return this.actor.update({ "system.capacity.spent": Math.max(0, max - Math.floor(Number(field.value) || 0)) });'),
   SH.includes("        event.stopPropagation();\n        const max = Number(this.actor.system.capacity?.max) || 0;")], [true, true, true, true]);
check("no field of its name on the Combat tab, no stepping by buttons left behind",
  [(read("templates", "parts", "actor-combat.hbs").match(/name="system\.capacity\.spent"/g) ?? []).length, SH.includes("stepCapacity")], [0, false]);
check("Defeated still on Life's name", render({ system: { defeated: true, life: { value: 0, max: 96 }, ki: { value: 0, max: 70 } } }).includes('data-action="toggleDefeated"'), true);
{
  const CSS = read("styles", "dbu-ttrpg.css");
  const frame = CSS.slice(CSS.indexOf(".dbu-ttrpg .dbu-portrait {"), CSS.indexOf("}", CSS.indexOf(".dbu-ttrpg .dbu-portrait {")));
  check("the 96px square, the whole picture; no frame, no ground of its own (the user's: a round picture showed it)",
    [/\.dbu-ttrpg \.dbu-portrait \.profile-img \{[^}]*object-fit: contain;/.test(CSS), frame.includes("width: 96px;"), frame.includes("height: 96px;"),
     frame.includes("border: 0;"), frame.includes("background: none;")], [true, true, true, true, true]);
}
check("Critical's name under where Injured's line ends (the user's, seen in Foundry); the bars raised for it; Ki's level with Life's",
  [/\.dbu-ttrpg \.dbu-pool-line\.low \{ top: -3px; bottom: -15px; \}/.test(read("styles", "dbu-ttrpg.css")),
   /\.dbu-ttrpg \.dbu-pool-bars \{[^}]*padding-bottom: 6px;/.test(read("styles", "dbu-ttrpg.css")),
   read("styles", "dbu-ttrpg.css").includes(".dbu-ttrpg .dbu-pool-ki .dbu-pool-bars { padding-top: 10px; }")], [true, true, true]);

// Karma Points on Biography: a Character's alone - not a Minion's (Minion Rules), nor an Adversary's, whose Villainous Karma is its own tab's
// (the user's).
{
  const BIO = read("templates", "parts", "actor-biography.hbs");
  const bio = Handlebars.compile(BIO.slice(BIO.indexOf("{{#unless isMinion}}"), BIO.indexOf("{{/unless}}{{/unless}}") + "{{/unless}}{{/unless}}".length));
  const shows = context => bio({ system: { karma: 2 }, karmaMax: 4, ...context }).includes("Karma Points</span>");
  check("Karma Points on Biography for a Character; not for a Minion, nor an Adversary",
    [shows({}), shows({ isMinion: true }), shows({ isAdversary: true }), read("templates", "parts", "actor-adversary.hbs").includes("<span>Villainous Karma</span>")],
    [true, false, false, true]);
}

// God Ki's Divine Ki on the header (the user's, 2026-11-15): KP, DKP, Cap - DKP and its bar only with God Ki; its whether-it-pays box
// the Maneuvers tab's; neither on the Combat tab any more.
{
  const god = render({ system: { powerLevel: 7, baseTierOfPower: 3, tierOfPower: 3, life: { value: 84, max: 96 }, ki: { value: 52, max: 70 },
    divineKi: { active: true, access: true, value: 40, max: 79 } }, divineKiPercent: 51 });
  // A way into God Ki, not in it yet: the same DKP on the header (the user's) - the pay box needs the State.
  const way = render({ system: { powerLevel: 7, baseTierOfPower: 3, tierOfPower: 3, life: { value: 84, max: 96 }, ki: { value: 52, max: 70 },
    divineKi: { active: false, access: true, value: 40, max: 79 } }, divineKiPercent: 51 });
  const MAN = read("templates", "parts", "actor-maneuvers.hbs"), COMBAT = read("templates", "parts", "actor-combat.hbs");
  check("KP, DKP, Cap in the God Ki State - else Ki Points and Capacity, by their names; DKP and its bar with God Ki alone; its pay box beside the Maneuvers title; none of it on the Combat tab",
    [[...god.matchAll(/class="dbu-pool-name"[^>]*>([A-Za-z]+)/g)].map(m => m[1]).filter(n => n !== "Life"), god.includes('name="system.divineKi.value" value="40"'),
     god.includes('class="dbu-pool-bar dbu-pool-divbar"><i style="width: 51%">'), god.includes("dbu-pool-ki has-divine"),
     [...html.matchAll(/class="dbu-pool-name"[^>]*>([A-Za-z ]+?)\s*</g)].map(m => m[1]).filter(n => n !== "Life Points"), html.includes("dbu-pool-divbar"),
     /<h3 class="panel-title">Maneuvers\s*\{\{#if system\.divineKi\.active\}\}[\s\S]*?Pay with Divine Ki Points <input type="checkbox" name="system\.divineKi\.use"/.test(MAN),
     COMBAT.includes("system.divineKi")],
    [["KP", "DKP", "Cap"], true, true, true, ["Ki Points", "Capacity"], false, true, false]);
  check("a way into God Ki, not in it yet: DKP and the short names all the same",
    [way.includes('name="system.divineKi.value" value="40"'), way.includes("dbu-pool-ki has-divine"), way.includes('data-tooltip="Ki Points">KP')], [true, true, true]);
  // Its own red, winning over Ki's blue on the same bars (measured in the browser: it came out blue at first).
  check("Divine Ki's bar its own red, over the Ki bar's blue", read("styles", "dbu-ttrpg.css").includes(".dbu-ttrpg .dbu-pool-ki .dbu-pool-bar.dbu-pool-divbar > i { background: #c2185b; }"), true);
}

if (PREVIEW) {
  const css = read("styles", "dbu-ttrpg.css");
  fs.writeFileSync(PREVIEW, `<!doctype html><meta charset="utf-8"><title>Header preview</title><style>${css}
    body { background: #222; margin: 20px; font-family: Signika, system-ui, sans-serif; }
    .window-content { width: 676px; padding: 8px; background: #1b1b1d; }</style>
    <div class="dbu-ttrpg"><div class="window-content">${render({ actor: { img: "portrait.svg", name: "Kakarot" },
      system: { powerLevel: 30, baseTierOfPower: 7, tierOfPower: 9, life: { value: 840, max: 960 }, ki: { value: 520, max: 700 },
        divineKi: { active: true, access: true, value: 400, max: 790 } }, capacity: { spent: 40, max: 140, left: 100 }, divineKiPercent: 51 })}</div></div>`);
}
console.log(failed ? `${failed} failing` : "all passing");
process.exit(failed ? 1 : 0);
