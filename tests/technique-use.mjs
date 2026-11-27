// Whether a Technique may be used, and against whom; the character tab renders; the use flow asks.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
const APP = (process.env.FOUNDRY_APP || String.raw`C:\Program Files\Foundry Virtual Tabletop\resources\app`);
const appUrl = p => pathToFileURL(path.join(APP, p)).href;
const modUrl = p => pathToFileURL(path.join(ROOT, "module", p)).href;
const require = createRequire(path.join(APP, "package.json"));
const Handlebars = require("handlebars");

globalThis.CONST = {};
globalThis.foundry = {};
await import(appUrl("common/primitives/_module.mjs"));
globalThis.foundry.utils = { ...await import(appUrl("common/utils/_module.mjs")) };
globalThis.ui = { notifications: { warn: () => {}, error: () => {}, info: () => {} } };
globalThis.game = { combat: { started: true, round: 3 } };

const U = await import(modUrl("technique-use.mjs"));

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};
const actor = (over = {}) => ({ name: "Goku", uuid: "A", items: { get: () => null },
  system: { usedManeuvers: [], threshold: { key: "healthy" }, battlefield: { highEnvironment: 0,
    environment: "standard-environment", weather: { id: "" } }, states: {}, charging: {}, grapple: {},
    lastManeuver: { maneuverId: "", profile: "", round: 0, hit: [] }, ...over } });
const tech = (advantages = [], over = {}) => ({ id: "t1", itemId: "t1", name: "Kamehameha", advantages,
  featureChoices: {}, ultimate: false, ...over });
const target = (over = {}) => ({ name: "Vegeta", uuid: "B", system: { battlefield: { highEnvironment: 0 }, ...over } });

// --- Ultimates ------------------------------------------------------------------------------------
check("a fresh Ultimate is usable", U.whyNotTechnique(actor(), tech([], { ultimate: true })), "");
check("once per Combat Encounter, each", Boolean(U.whyNotTechnique(
  actor({ usedManeuvers: ["encounter:t1"] }), tech([], { ultimate: true }))), true);
check("three Ultimates in all", Boolean(U.whyNotTechnique(
  actor({ usedManeuvers: Array(3).fill(U.ULTIMATE_USE) }), tech([], { id: "t2", ultimate: true }))), true);
check("an Ascended Super counts towards the three",
  Boolean(U.whyNotTechnique(actor({ usedManeuvers: Array(3).fill(U.ULTIMATE_USE) }), tech(), { ascended: true })), true);
check("and after ascending, not again this Encounter",
  Boolean(U.whyNotTechnique(actor({ usedManeuvers: ["encounter:t1.ascended"] }), tech())), true);
check("a use writes its own Round's use (Technique Master's), the Ultimate count, the Ascension and Fake Out",
  U.techniqueUseEntries(tech(["fake-out"]), { ascended: true }),
  ["round:t1.technique", U.ULTIMATE_USE, "encounter:t1.ascended", U.FAKE_OUT_USE]);

// --- The door-level Disadvantages ------------------------------------------------------------------
check("Fake Out once a Round", [U.whyNotTechnique(actor(), tech(["fake-out"])),
  Boolean(U.whyNotTechnique(actor({ usedManeuvers: [U.FAKE_OUT_USE] }), tech(["fake-out"])))], ["", true]);
check("Required Counter only through Counter",
  [Boolean(U.whyNotTechnique(actor(), tech(["required-counter"]))),
   U.whyNotTechnique(actor(), tech(["required-counter"]), { via: "counter" })], [true, ""]);
check("Climax Attack 2: Injured or worse",
  [Boolean(U.whyNotTechnique(actor({ threshold: { key: "bruised" } }), tech(["climax-attack", "climax-attack"]))),
   U.whyNotTechnique(actor({ threshold: { key: "injured" } }), tech(["climax-attack", "climax-attack"])),
   U.whyNotTechnique(actor({ threshold: { key: "critical" } }), tech(["climax-attack", "climax-attack"]))],
  [true, "", ""]);
const restricted = (id, choice) => tech([id], { featureChoices: { [id]: choice } });
check("Restricted - Environment: High means any High Environment",
  [Boolean(U.whyNotTechnique(actor(), restricted("restricted-environment", "high"))),
   U.whyNotTechnique(actor({ battlefield: { highEnvironment: 2, environment: "standard-environment" } }),
     restricted("restricted-environment", "high"))], [true, ""]);
check("and the ground's Environment does not reach you up high",
  [U.whyNotTechnique(actor({ battlefield: { highEnvironment: 0, environment: "lava-environment" } }),
     restricted("restricted-environment", "lava-environment")),
   Boolean(U.whyNotTechnique(actor({ battlefield: { highEnvironment: 1, environment: "lava-environment" } }),
     restricted("restricted-environment", "lava-environment")))], ["", true]);
check("Restricted - State", [Boolean(U.whyNotTechnique(actor(), restricted("restricted-state", "raging"))),
  U.whyNotTechnique(actor({ states: { raging: 1 } }), restricted("restricted-state", "raging"))], [true, ""]);
check("Restricted - Weather, whatever its Tier",
  [Boolean(U.whyNotTechnique(actor(), restricted("restricted-weather", "hot-weather"))),
   U.whyNotTechnique(actor({ battlefield: { highEnvironment: 0, weather: { id: "hot-weather", tier: 1 } } }),
     restricted("restricted-weather", "hot-weather"))], [true, ""]);
check("Mandatory Charge 2: four uses of Energy Charge on it",
  [Boolean(U.whyNotTechnique(actor({ charging: { maneuverId: "t1", charges: 3 } }), tech(["mandatory-charge", "mandatory-charge"]))),
   U.whyNotTechnique(actor({ charging: { maneuverId: "t1", charges: 4 } }), tech(["mandatory-charge", "mandatory-charge"]))],
  [true, ""]);
check("Special Set Up: its Special Maneuver, last, this Round",
  [U.whyNotTechnique(actor({ lastManeuver: { maneuverId: "analysis", round: 3 } }), restricted("special-set-up", "analysis")),
   Boolean(U.whyNotTechnique(actor({ lastManeuver: { maneuverId: "analysis", round: 2 } }), restricted("special-set-up", "analysis"))),
   Boolean(U.whyNotTechnique(actor({ lastManeuver: { maneuverId: "movement", round: 3 } }), restricted("special-set-up", "analysis")))],
  ["", true, true]);

// --- Against a target -----------------------------------------------------------------------------
check("Grappling: only somebody you are the Grappler of",
  [Boolean(U.whyNotTechniqueAgainst(actor({ grapple: { role: "grappled", partner: "B" } }), tech(["grappling"]), target())),
   U.whyNotTechniqueAgainst(actor({ grapple: { role: "grappler", partner: "B" } }), tech(["grappling"]), target())],
  [true, ""]);
const high = rank => ({ battlefield: { highEnvironment: rank } });
check("Drop Down: from up high, at a lower rank",
  [U.whyNotTechniqueAgainst(actor(high(2)), tech(["drop-down"]), target(high(1))),
   Boolean(U.whyNotTechniqueAgainst(actor(high(1)), tech(["drop-down"]), target(high(1)))),
   Boolean(U.whyNotTechniqueAgainst(actor(high(0)), tech(["drop-down"]), target(high(0))))], ["", true, true]);
check("Skyward Strike: a higher target, or from the ground at anyone; both in Deep Space waived",
  [U.whyNotTechniqueAgainst(actor(high(1)), tech(["skyward-strike"]), target(high(2))),
   U.whyNotTechniqueAgainst(actor(high(0)), tech(["skyward-strike"]), target(high(0))),
   Boolean(U.whyNotTechniqueAgainst(actor(high(2)), tech(["skyward-strike"]), target(high(1)))),
   U.whyNotTechniqueAgainst(actor(high(4)), tech(["skyward-strike"]), target(high(4)))], ["", "", true, ""]);
check("Short Range 2 refuses one out of reach",
  [Boolean(U.whyNotTechniqueAgainst(actor(), tech(["short-range", "short-range"]), target(), { reach: "too far" })),
   U.whyNotTechniqueAgainst(actor(), tech(["short-range"]), target(), { reach: "too far" })], [true, ""]);
check("Lead Up: your last Maneuver hit them with its Profile",
  [U.whyNotTechniqueAgainst(actor({ lastManeuver: { profile: "simple", hit: ["B"] } }), restricted("lead-up", "simple"), target()),
   Boolean(U.whyNotTechniqueAgainst(actor({ lastManeuver: { profile: "simple", hit: ["C"] } }), restricted("lead-up", "simple"), target())),
   Boolean(U.whyNotTechniqueAgainst(actor({ lastManeuver: { profile: "beam", hit: ["B"] } }), restricted("lead-up", "simple"), target()))],
  ["", true, true]);

// --- Wiring --------------------------------------------------------------------------------------
const USE = fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8");
check("the door's 1/Round waits for the Technique, and Low Stakes neither needs nor spends it",
  [USE.includes("if (doorSpent && !lowStakes) {"), USE.includes("if (lowStakes) maneuver = { ...maneuver, usageLimit: null };")],
  [true, true]);
check("the Technique's own refusals, then its targets', then the table's questions",
  [USE.includes("const refused = whyNotTechnique(actor, technique, { via });"),
   USE.includes("const refused = whyNotTechniqueAgainst(actor, maneuver, target, { reach });"),
   USE.includes("if (!await techniqueTableQuestions(actor, maneuver)) return false;")], [true, true, true]);
check("a use writes its entries, and the last Maneuver is recorded with its Profile",
  [USE.includes("const entries = techniqueUseEntries(ownItem ? { ...maneuver, id: definitionOf(ownItem).id } : maneuver, { ascended: Boolean(maneuver.ascended) })"),
   USE.includes("maneuverId: maneuver.through?.id ?? maneuver.id, profile: declared?.profile ?? \"\" });")], [true, true]);
check("a Technique used from anywhere goes through the door",
  USE.includes("const used = technique ? await useTechnique(actor, item.id, { atFeature, outOfSequence })"), true);
const MAN = fs.readFileSync(path.join(ROOT, "module", "maneuvers.mjs"), "utf8");
check("every Maneuver recorded is the last one, whatever else it does",
  MAN.includes("const lastUpdate = actor.system?.lastManeuver ? { \"system.lastManeuver\": last } : {};"), true);

// --- The tab ---------------------------------------------------------------------------------------
const page = Handlebars.compile(fs.readFileSync(path.join(ROOT, "templates", "parts", "actor-techniques.hbs"), "utf8"))({
  tabs: { techniques: { cssClass: "active" } },
  tpSummary: { total: 40, left: -3, over: true },
  techniques: { spent: 43, available: 40, ultimates: 2, ultimateCap: 1, usedThisEncounter: 1, encounterCap: 3,
    warnings: ["43 TP spent on Techniques, and 40 TP to spend."],
    rows: [{ itemId: "k1", name: "Kamehameha", level: "Super", profile: "Beam", tp: 18, kp: "30", kpTip: "10(T)",
      advantages: [{ label: "Power Shot 2", summary: "Wound +2(T) a rank" }],
      disadvantages: [{ label: "Restricted - Weather (Storm)", summary: "Only in its Weather" }],
      open: true, refused: "", charged: "", delayed: false },
    { itemId: "k2", name: "Spirit Bomb", level: "Ultimate", profile: "Blast", tp: 25, kp: "33", delayed: true,
      refused: "Spirit Bomb has been used this Combat Encounter.", charged: "Charged 1 / 2" },
    { itemId: "k3", name: "Buddy Beam", buddyOnly: true, level: "Super", profile: "Beam", tp: 8, kp: "20" }] } });
check("the tab: New, the TP spent on them and the TP left (red, overspent), the Ultimates at the far right, a warning (the user's, 2026-11-17)",
  ['data-action="newTechnique"', "TP spent on Signature Techniques <b>43</b>", 'class="dbu-tp-over"', "TP left <b>-3</b>",
   'class="technique-summary-right"', "Ultimates <b>2</b> / 1", "Used this Encounter <b>1</b> / 3",
   "43 TP spent on Techniques"].every(bit => page.includes(bit)), true);
check("a row: use, level, Profile, TP, KP, edit, its features",
  ['data-action="useManeuver" data-item-id="k1"', "18 TP", 'data-tooltip="10(T)"', "30 KP", "Power Shot 2",
   'data-action="editItem" data-item-id="k1"'].every(bit => page.includes(bit)), true);
check("the row opens like a Maneuver's, and one left open stays open",
  [(page.match(/data-action="toggleManeuver"/g) ?? []).length, page.includes('maneuver-open"')], [3, true]);
check("to its Advantages in green and its Disadvantages in red, each summary on hover",
  ['class="dbu-profile-line technique-advantage" data-tooltip="Wound +2(T) a rank">Power Shot 2</div>',
   'class="dbu-profile-line technique-disadvantage" data-tooltip="Only in its Weather">Restricted - Weather (Storm)</div>']
    .every(bit => page.includes(bit)), true);
check("with no heading saying which is which", [page.includes("Advantages</p>"), page.includes("Disadvantages</p>")],
  [false, false]);
const CSS = fs.readFileSync(path.join(ROOT, "styles", "dbu-ttrpg.css"), "utf8");
check("the colours are there", [/\.technique-advantage \{\s*color: #4caf50;/.test(CSS),
  /\.technique-disadvantage \{\s*color: #e0564a;/.test(CSS)], [true, true]);
check("and says so when there are none", page.includes("No Advantages or Disadvantages yet."), true);
check("each row can be deleted", page.includes('data-action="deleteTechnique" data-item-id="k1"'), true);
const SHEET = fs.readFileSync(path.join(ROOT, "module", "sheets", "actor-character-sheet.mjs"), "utf8");
check("asked first, and wired to a handler",
  [SHEET.includes("deleteTechnique: DBUCharacterSheet._onDeleteTechnique,"),
   SHEET.includes("const sure = await foundry.applications.api.DialogV2.confirm({\n      window: { title: `Delete ${item.name}` },"),
   SHEET.includes("if (!sure) return;")], [true, true, true]);
check("a refused one says why, a charged one how far, a Delayed one Detonates",
  ['data-tooltip="Spirit Bomb has been used this Combat Encounter."', "Charged 1 / 2",
   'data-action="detonateTechnique" data-item-id="k2"'].every(bit => page.includes(bit)), true);
check("a Warrior Buddy's is not used from here", !page.includes('data-action="useManeuver" data-item-id="k3"'), true);

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
