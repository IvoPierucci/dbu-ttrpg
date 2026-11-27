// The Adventure tab, rendered with Foundry's own Handlebars: its folds, what they say closed, and what
// opens where.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = process.argv[2];
const require = createRequire(`${(process.env.FOUNDRY_APP || (process.env.FOUNDRY_APP || String.raw`C:\Program Files\Foundry Virtual Tabletop\resources\app`))}/package.json`);
const Handlebars = require("handlebars");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

let failed = 0;
const check = (label, ok) => { if (!ok) failed++; console.log(`${ok ? "ok  " : "FAIL"}  ${label}`); };

const template = Handlebars.compile(read("templates", "parts", "actor-adventure.hbs"));
const stages = active => ["Fed", "Hungry", "Ravenous", "Starving"].map((label, stage) =>
  ({ stage, label, tip: label, active: stage === active }));
const subjects = open => [["reputation", "Reputation"], ["training", "Training"],
  ["wealth", "Wealth"]].map(([key, label]) => ({ key, label, open: open.includes(key), isReputation: key === "reputation",
    isTraining: key === "training", isWealth: key === "wealth" }));
const context = ({ open = {}, hunger = 0, subjectsOpen = [] } = {}) => ({
  tabs: { adventure: { cssClass: "active" } },
  system: { adventuring: true },
  openSections: open,
  adventuringManeuvers: [{ id: "rest", name: "Rest", timeCost: "8 Hours", limit: 1, left: 1,
    open: Boolean(open["maneuver-adv-rest"]),
    lines: [{ text: "Rest: With a full night’s rest, you feel refreshed and ready to go." },
      { text: "–Prerequisite: N/A" }, { text: "–Effect: Regain Life and Ki Points equal to half of their respective maximums." }] }],
  hungerStages: stages(hunger),
  hungerNow: hunger ? stages(hunger)[hunger].label : "",
  adventureSubjects: subjects(subjectsOpen),
  wealth: { own: 4, scammed: 1, total: 5, status: { label: "Comfortable", tip: "basics" } },
  trainingBonuses: [{ id: "t", key: "speed-training", name: "Speed Training", tip: "Speed Training: ...", length: "Until the fight with Cell" }],
  reputation: [{ id: "r", kind: "faction", kindLabel: "Faction", name: "Red Ribbon Army", member: false,
    affection: 0, affectionLabel: "Hated", affectionTip: "hates", alarm: 3, alarmLabel: "Feared", alarmTip: "fears",
    persuasionTN: "+2", intimidationTN: "-1" },
    { id: "s", kind: "individual", kindLabel: "Individual", name: "General Blue", member: true,
      affection: 1, affectionLabel: "Disliked", affectionTip: "", alarm: 4, alarmLabel: "Terrified", alarmTip: "",
      persuasionTN: "+1", intimidationTN: "-2" }]
});
const folds = html => [...html.matchAll(/<details class="condition-group" data-section="([\w-]+)"\s*(open)?>/g)]
  .map(m => [m[1], Boolean(m[2])]);

const closed = template(context({ hunger: 2 }));
check("five folds, in order, every one closed until opened - none empty, so no Crafting",
  JSON.stringify(folds(closed)) === JSON.stringify([["adventure-maneuvers", false], ["adventure-cooking", false],
    ["adventure-reputation", false], ["adventure-training", false], ["adventure-wealth", false]])
    && !closed.includes("Not built yet"));
check("the top stays open: Adventuring, Travel and New Session outside every fold",
  ['name="system.adventuring"', 'data-action="travel"', 'data-action="newAdventureSession"']
    .every(bit => closed.indexOf(bit) < closed.indexOf("<details")));
check("Cooking says the Hunger stage while closed, and nothing when Fed",
  /Cooking\s*<span class="panel-note">Ravenous<\/span>/.test(closed)
    && /Cooking\s*<span class="panel-note"><\/span>/.test(template(context())));
check("the Maneuvers fold says how many",
  /Adventuring Maneuvers\s*<span class="panel-note">1<\/span>/.test(closed));

const opened = template(context({ open: { "adventure-maneuvers": true, "adventure-cooking": true },
  subjectsOpen: ["wealth"] }));
check("opened ones render open - the hyphenated keys read",
  JSON.stringify(folds(opened).filter(([, open]) => open).map(([key]) => key))
    === JSON.stringify(["adventure-maneuvers", "adventure-cooking", "adventure-wealth"]));
check("the Hunger stages inside Cooking, the one held lit",
  opened.indexOf('data-action="setHunger"') > opened.indexOf('data-section="adventure-cooking"')
    && /class="hunger-stage active" data-action="setHunger"\s*data-stage="0"/.test(opened));

const rowOpen = template(context({ open: { "adventure-maneuvers": true, "maneuver-adv-rest": true } }));
check("a Maneuver's row: closed until clicked, then its entry line by line",
  !/class="maneuver maneuver-open"/.test(opened) && /class="maneuver maneuver-open"\s*data-item-id="adv-rest"/.test(rowOpen)
    && /<div class="dbu-profile-line">–Prerequisite: N\/A<\/div>/.test(rowOpen));

const withRep = template(context({ subjectsOpen: ["reputation"] }));
check("Reputation: its count on the fold, its buttons and rows inside - the others still empty",
  /Reputation\s*<span class="panel-note">2<\/span>/.test(withRep)
    && withRep.includes('data-action="addReputation" data-kind="faction"')
    && /class="reputation-row reputation-member"/.test(withRep)
    && withRep.includes("Feared (3)") && withRep.includes("TN +1 / -2")
);
const withWealth = template(context({ subjectsOpen: ["wealth"] }));
check("Wealth: its Status on the fold; Riches stepped, Scam's 1 said, and the Wealth Check",
  /Wealth\s*<span class="panel-note">Comfortable<\/span>/.test(withWealth)
    && /<span class="karma-count">5<span class="karma-max">\/10<\/span><\/span>/.test(withWealth)
    && withWealth.includes("+1 Scam") && withWealth.includes('data-action="wealthCheck"'));
const withTraining = template(context({ subjectsOpen: ["training"] }));
check("Training: its count on the fold, Gain, and each Bonus with how long and End",
  /Training\s*<span class="panel-note">1<\/span>/.test(withTraining)
    && withTraining.includes('data-action="gainTrainingBonus"') && withTraining.includes("Until the fight with Cell")
    && withTraining.includes('data-action="endTrainingBonus" data-id="t"'));

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
