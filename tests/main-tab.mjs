/**
 * The Main tab as the user designed it (2026-11-15): the Attributes' Modifiers as seven cards; the Skills in a block per Attribute in
 * the Attributes' order, Personality under Scholarship where it fits; Craft (Any) and Knowledge (Any) while alike - a sign: all at 0
 * a Required Skill without a Rank, alike any of them is the roll; the Ranks as pips; the Score cap on Progression.
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

const { foldSkills, rankPips, skillColumns, FOLDED_SKILLS } = await import(pathToFileURL(path.join(ROOT, "module", "skill-blocks.mjs")).href);

// The system's own Skills, by Attribute, as the sheet groups them.
const DATA = read("module", "data", "actor-character.mjs");
const table = DATA.slice(DATA.indexOf("static SKILLS = Object.freeze({"), DATA.indexOf("\n  });", DATA.indexOf("static SKILLS = Object.freeze({")));
const SKILLS = [...table.matchAll(/(\w+):\s*\{\s*label: "([^"]+)",\s*attribute: "(\w+)"(,\s*required: true)?/g)]
  .map(([, key, label, attribute, required]) => ({ key, label, attribute, required: Boolean(required) }));
const groupsWith = (ranks = {}) => ["agility", "force", "tenacity", "scholarship", "insight", "magic", "personality"]
  .map(attribute => ({ attribute, label: attribute[0].toUpperCase() + attribute.slice(1),
    skills: SKILLS.filter(skill => skill.attribute === attribute).map(skill => {
      const held = ranks[skill.key] ?? 0;
      return { ...skill, ranks: held, roll: held * 2, critical: 10, untrained: skill.required && !held };
    }) }))
  .filter(group => group.skills.length);
const names = columns => columns.map(column => column.map(block => block.attribute));

check("the folds name the system's own Skills", FOLDED_SKILLS.flatMap(fold => fold.keys).every(key => SKILLS.some(skill => skill.key === key)), true);
const plain = skillColumns(groupsWith(), 2, { agility: 2, scholarship: 1 });
const scholarship = plain[0].find(block => block.attribute === "scholarship");
check("all alike: Craft (Any) and Knowledge (Any), each the first of them - Craft's a Required Skill without a Rank",
  scholarship.skills.map(skill => [skill.label, skill.key, Boolean(skill.untrained)]),
  [["Craft (Any)", "craft", true], ["Investigation", "investigation", false], ["Knowledge (Any)", "knowledge", false], ["Medicine", "medicine", true]]);
check("in the Attributes' order; Personality under Scholarship, where it fits; each block its Modifier",
  [names(plain), plain[0][0].mod, scholarship.mod], [[["agility", "scholarship", "personality"], ["insight", "magic"]], 2, 1]);
const apart = skillColumns(groupsWith({ craftWeapons: 1 }), 2);
check("one Craft with a Rank of its own: Craft's four apart, Knowledge still one; Personality under Magic, not fitting",
  [apart[0][1].skills.map(skill => skill.label), names(apart)],
  [["Craft (Basic Item)", "Craft (Apparel)", "Craft (Weapons)", "Craft (Vehicles)", "Investigation", "Knowledge (Any)", "Medicine"],
   [["agility", "scholarship"], ["insight", "magic", "personality"]]]);
check("a specialisation written on one keeps them apart",
  foldSkills([{ key: "knowledge", ranks: 1, roll: 2, critical: 10, specialization: "Biology" }, { key: "knowledgeProfession", ranks: 1, roll: 2, critical: 10 },
    { key: "knowledgeHistory", ranks: 1, roll: 2, critical: 10 }]).length, 3);
check("all alike at a Rank: one row, rolled as any of them",
  foldSkills(groupsWith({ knowledge: 1, knowledgeProfession: 1, knowledgeHistory: 1 }).find(group => group.attribute === "scholarship").skills)
    .filter(skill => skill.folded).map(skill => [skill.label, skill.key, skill.ranks]), [["Craft (Any)", "craft", 0], ["Knowledge (Any)", "knowledge", 1]]);
check("the Ranks as pips to the cap; past it, more and marked",
  [rankPips(1, 2), rankPips(3, 2).map(pip => pip.over)], [[{ on: true, over: false }, { on: false, over: false }], [false, false, true]]);

// Drawn.
Handlebars.registerHelper("eq", (a, b) => a === b);
Handlebars.registerHelper("numberFormat", (value, options) => ((options.hash.sign && value >= 0) ? `+${value}` : String(value)));
const MAIN = read("templates", "parts", "actor-main.hbs");
const html = Handlebars.compile(MAIN)({ tabs: { main: { cssClass: "active" } }, system: { skillRankCap: 2 },
  attributeCards: [{ key: "agility", mod: 2, workings: "" }, { key: "force", mod: 7, workings: "" }], skillColumns: plain });
check("drawn: Attribute cards rolled from their name (as Might's box), the Modifier, no Score cap; blocks with their Modifier; pips; rolled rows; Craft (Any) not rolled",
  [(html.match(/<div class="dbu-main-attribute">\s*<button type="button" class="stat-roll dbu-main-attribute-name" data-action="rollAttribute"/g) ?? []).length
     - (html.includes("dbu-main-die") ? 10 : 0), html.includes("Score cap"), html.includes("<b>Agility</b><span>Mod <strong>2</strong></span>"),
   /class="dbu-main-pips skill-ranks"[^>]*><i class=""><\/i><i class=""><\/i><\/span>/.test(html), html.includes('data-skill="investigation"'),
   html.includes('<span class="skill-label">Craft (Any)</span>'), html.includes('data-skill="craft"')],
  [2, false, true, true, true, true, false]);

// The Score cap on Progression.
const PROG = read("templates", "parts", "actor-progression.hbs");
check("the Score cap on Progression: in the Scores' heading, its ToP on hover; beside the Stress Bonus where no race draws that row",
  [PROG.includes('data-tooltip="Score cap at ToP {{system.tierOfPower}}: {{system.attributeScoreCap}}">Attribute Scores <span class="dbu-score-cap">&middot; cap {{system.attributeScoreCap}}</span></th>'),
   /\{\{#unless racialGrants\}\}\s*<label class="dbu-readout"[^>]*>Score cap\s*<span class="dbu-readout-box">\{\{system\.attributeScoreCap\}\}<\/span>/.test(PROG)], [true, true]);
check("the sheet builds the blocks; the Adversary tab keeps its groups",
  [read("module", "sheets", "actor-character-sheet.mjs").includes("context.skillColumns = skillColumns(context.skillGroups, this.actor.system.skillRankCap,"),
   read("module", "sheets", "actor-character-sheet.mjs").includes("skillGroups: context.skillGroups.map(group =>")], [true, true]);

console.log(failed ? `${failed} failing` : "all passing");
process.exit(failed ? 1 : 0);
