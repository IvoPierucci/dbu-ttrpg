// The Technique's three tabs render, and its Effects are composed from its features.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
const APP = (process.env.FOUNDRY_APP || String.raw`C:\Program Files\Foundry Virtual Tabletop\resources\app`);
const require = createRequire(path.join(APP, "package.json"));
const Handlebars = require("handlebars");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");
const appUrl = p => pathToFileURL(path.join(APP, p)).href;
const modUrl = p => pathToFileURL(path.join(ROOT, "module", p)).href;

let failed = 0;
// With an expected value, compared with it (an array passed alone was always truthy, so it checked nothing).
const check = (label, got, expected) => {
  const ok = (expected === undefined) ? Boolean(got) : (JSON.stringify(got) === JSON.stringify(expected));
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok && (expected !== undefined)) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(got)}`);
};

const creation = Handlebars.compile(read("templates", "parts", "technique-creation.hbs"));
const technique = {
  levels: [{ value: "super", label: "Super", chosen: false }, { value: "dramatic", label: "Dramatic Finisher", chosen: true }],
  foundations: [{ value: "energy", label: "Energy", chosen: true }],
  profiles: [{ value: "beam", label: "Beam (8(T))", chosen: true }],
  dramatic: true,
  multi: true,
  superProfiles: [{ value: "multi-profile", label: "Multi-Profile", chosen: true }],
  secondProfiles: [{ value: "simple", label: "Simple (2(T))", chosen: true }],
  fromTransformation: false,
  reading: { tp: 31, cap: 30, over: "Over the 30 TP a Technique may be worth at base Tier 2.",
    profileKi: 8, techniqueKi: 7, superKi: 1, totalPerTier: 16, total: 48, tier: 3, superProblem: "" },
  rows: [
    { index: 0, id: "power-shot", name: "Power Shot", side: "Advantage", ranks: 2, ranked: true, canUp: true,
      canDown: true, tp: 10, choose: "", choiceLabel: "", problem: "", tip: "Wound +2(T) per rank.",
      lines: [{ text: "Power Shot: Your attack is empowered." }, { gap: true },
        { text: "–Effect: Increase your Wound Roll by 2(T) for each rank." }] },
    { index: 1, id: "widespread-assault", name: "Widespread Assault", side: "Advantage", ranks: 1, ranked: false,
      choose: "shape", choiceLabel: "Cone", tp: 8, problem: "Requirement: Attacking Maneuver does not possess an AoE.", tip: "",
      lines: [] },
    { index: 2, id: "backlash", name: "Backlash", side: "Disadvantage", disadvantage: true, ranks: 1, ranked: true,
      canUp: true, tp: -2, choose: "", choiceLabel: "", problem: "", tip: "", lines: [{ text: "Backlash: It hurts." }] }
  ],
  groups: [{ label: "Advantages", choices: [{ value: "accurate", name: "Accurate", label: "Accurate (3/5/7 TP)", blocked: "" },
    { value: "maximum-charge", name: "Maximum Charge", label: "Maximum Charge (6 TP)", blocked: "Requirement: Ultimate Signature Technique." }] }],
  script: "#@ advantage power-shot | Power Shot (2 ranks)\n# Wound +2(T) per rank. - built in\n#@ end",
  errors: []
};
const tabs = { creation: { cssClass: "active" }, features: { cssClass: "" }, techniqueEffects: { cssClass: "" } };
const page = creation({ tabs, technique });
check("Sig Creation: Level, Foundation, Profile, Super Profile, Second Profile, From a Transformation",
  ['name="system.signature.level"', 'name="system.signature.foundation"', 'name="system.signature.profile"',
   'name="system.signature.superProfile"', 'name="system.signature.secondProfile"',
   'name="system.signature.fromTransformation"'].every(bit => page.includes(bit)));
check("the Super Profile and Second Profile shown on a Dramatic Multi-Profile",
  [page.includes('name="system.signature.superProfile">'), page.includes('name="system.signature.secondProfile">')],
  [true, true]);
const plainPage = creation({ tabs, technique: { ...technique, dramatic: false, multi: false } });
const superOnly = creation({ tabs, technique: { ...technique, dramatic: true, multi: false } });
check("not shown where they do not apply (the user's, 2026-11-17): neither without a Dramatic Finisher, the Second Profile without Multi-Profile",
  [plainPage.includes('name="system.signature.superProfile"'), plainPage.includes('name="system.signature.secondProfile"'),
   superOnly.includes('name="system.signature.superProfile"'), superOnly.includes('name="system.signature.secondProfile"')],
  [false, false, true, false]);
const order = ["system.signature.level", "system.signature.foundation", "system.signature.profile",
  "system.signature.freeTP", "system.signature.superProfile", "system.signature.secondProfile",
  "system.signature.fromTransformation"].map(name => page.indexOf(`name="${name}"`));
check("in a fixed order", order.every((at, i) => (at > 0) && (!i || (at > order[i - 1]))), true);
check("and what it costs, warned when over the cap",
  ["TP: <b>31</b> / 30", "KP: <b>16(T)</b> = 48 at Tier 3", "Over the 30 TP"].every(bit => page.includes(bit)));

const features = Handlebars.compile(read("templates", "parts", "technique-features.hbs"))({ tabs, technique });
check("Adv & Disadv: the search, the rows, ranks, a choice, a Requirement not met, remove",
  ['data-feature-search', 'data-feature-option="accurate"', 'data-action="rankFeature"', 'data-step="1"',
   'data-action="chooseFeature"', ">Cone</button>", "Requirement not met", 'data-action="removeFeature"',
   "10 TP"].every(bit => features.includes(bit)));
check("each in a card of its own, edged by which side it is on",
  [(features.match(/class="technique-feature-card technique-advantage-card/g) ?? []).length,
   (features.match(/class="technique-feature-card technique-disadvantage-card/g) ?? []).length], [2, 1]);
check("with its text under the controls, as printed",
  ['<div class="dbu-profile-line">Power Shot: Your attack is empowered.</div>', '<div class="dbu-entry-break"></div>',
   "–Effect: Increase your Wound Roll by 2(T) for each rank.", "Backlash: It hurts."].every(bit => features.includes(bit))
  && (features.indexOf('data-action="removeFeature"') < features.indexOf("Power Shot: Your attack is empowered.")));
const MSHEET = read("module", "sheets", "item-maneuver-sheet.mjs");
check("the sheet hands over the feature's own text, a line an entry",
  MSHEET.includes('lines: String(def?.text ?? "").split("\\n").map(line => line.trim())'));
check("an option whose Requirement fails is shown dimmed with its reason",
  features.includes('gear-quality-option blocked" data-feature-option="maximum-charge"')
  && features.includes('data-tooltip="Requirement: Ultimate Signature Technique."'));

// The user's 2026-11-14 layout: what it costs on top of both tabs (KP left, TP right), above the boxes and the search; no Cost
// panel, no TP at the foot; the chosen Profile's, Super Profile's and Second Profile's text at the foot of Sig Creation.
check("what it costs on top of Sig Creation, before the boxes - and no Cost panel",
  [page.indexOf('class="technique-totals"') > 0, page.indexOf('class="technique-totals"') < page.indexOf('name="system.signature.level"'),
   page.indexOf("KP: <b>16(T)</b>") < page.indexOf("TP: <b>31</b>"), page.includes(">Cost</h3>")], [true, true, true, false]);
check("and on top of Adv & Disadv, before the search - none at the foot",
  [features.indexOf('class="technique-totals"') > 0, features.indexOf('class="technique-totals"') < features.indexOf("data-feature-search"),
   features.includes('class="technique-total"')], [true, true, false]);
const texts = creation({ tabs, technique: { ...technique, chosenTexts: [
  { title: "Profile", name: "Beam", lines: [{ text: "Beam: A concentrated beam of energy." }] },
  { title: "Super Profile", name: "Multi-Profile", lines: [{ text: "Multi-Profile: Two at once." }] },
  { title: "Second Profile", name: "Simple", lines: [{ text: "Simple: The plain one." }] }] } });
check("the chosen Profile's, Super Profile's and Second Profile's text at the foot, in that order, after the warnings",
  [texts.indexOf("Over the 30 TP") < texts.indexOf("Beam: A concentrated"),
   texts.indexOf("Beam: A concentrated") < texts.indexOf("Multi-Profile: Two at once."),
   texts.indexOf("Multi-Profile: Two at once.") < texts.indexOf("Simple: The plain one.")], [true, true, true]);
check("the sheet hands over only what was chosen - a Super Profile only on a Dramatic Finisher, a Second only with Multi-Profile",
  [MSHEET.includes("dramatic && SUPER_PROFILES[sig.superProfile]"), MSHEET.includes("multi && PROFILES[sig.secondProfile]"),
   MSHEET.includes("chosenTexts,")], [true, true, true]);

const effects = Handlebars.compile(read("templates", "parts", "technique-effects.hbs"))({ tabs, technique });
check("Effects: the script and Re-sync",
  effects.includes('name="system.script"') && effects.includes('data-action="resyncTechnique"')
  && effects.includes("Compiles."));

// --- The composer -------------------------------------------------------------------------------
globalThis.CONST = {};
globalThis.foundry = {};
await import(appUrl("common/primitives/_module.mjs"));
globalThis.foundry.utils = { ...await import(appUrl("common/utils/_module.mjs")) };
globalThis.ui = { notifications: { warn: () => {}, error: () => {}, info: () => {} } };
const TRAITS = path.join(ROOT, "traits");
globalThis.foundry.utils.fetchJsonWithTimeout = async () => JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));
globalThis.fetch = async url => {
  const file = path.join(TRAITS, String(url).replace("systems/dbu-ttrpg/traits/", ""));
  return fs.existsSync(file) ? { ok: true, text: async () => fs.readFileSync(file, "utf8") } : { ok: false };
};
await (await import(modUrl("effects/traits.mjs"))).loadTraits();
const T = await import(modUrl("technique.mjs"));
const { compile } = await import(modUrl("effects/parser.mjs"));
const base = { level: "super", profile: "beam", foundation: "energy", features: [] };
const one = T.composeTechniqueEffects({ ...base, features: [{ id: "power-shot", ranks: 2, choice: "" }] }, "");
check("a feature writes its part, named with its ranks",
  one.startsWith("#@ advantage power-shot | Power Shot (2 ranks)\n# Wound +2(T) per rank. - built in\n#@ end"));
const edited = one + "\n\n[passive]\nstrike += 1;";
const two = T.composeTechniqueEffects({ ...base, features: [{ id: "power-shot", ranks: 2, choice: "" },
  { id: "backlash", ranks: 1, choice: "" }] }, edited);
check("a new one is added after the last part, the owner's own text kept",
  two.includes("#@ disadvantage backlash | Backlash (1 rank)") && two.endsWith("[passive]\nstrike += 1;")
  && two.indexOf("backlash") < two.indexOf("[passive]"));
const three = T.composeTechniqueEffects({ ...base, features: [{ id: "backlash", ranks: 1, choice: "" }] }, two);
check("a removed one's part goes", !three.includes("power-shot") && three.includes("backlash"));
check("and a choice is named", T.composeTechniqueEffects({ ...base, features: [{ id: "widespread-assault",
  ranks: 1, choice: "cone" }] }, "").includes("Widespread Assault - Cone"));
check("what it writes compiles", compile(two, null).errors.length === 0);

console.log(`${failed} failing`);
process.exit(failed ? 1 : 0);
