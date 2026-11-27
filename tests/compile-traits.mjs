/**
 * Compile every trait file, the way Foundry would.
 *
 * The effects core imports nothing from Foundry, so it runs unchanged here. This is the
 * first time the .dbu files have actually been through the parser rather than only being
 * written to look right.
 *
 * Three checks per file:
 *   parse      - the lexer and parser accept the script
 *   validate   - every slot, moment and amount is one the system knows
 *   roundtrip  - decompile(program) compiles back to the same program
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
const MODULES = pathToFileURL(path.join(ROOT, "module", "effects")).href;

const { parseTraitFile } = await import(`${MODULES}/traits.mjs`);
const { compile } = await import(`${MODULES}/parser.mjs`);
const { decompile } = await import(`${MODULES}/decompile.mjs`);

/**
 * A character's data, only as far as the validator reads it.
 *
 * Slot names are checked against what a character actually has - `skill.stelth` has to
 * fail - so the check is only as good as this shape.
 */
const model = fs.readFileSync(
  path.join(ROOT, "module", "data", "actor-character.mjs"), "utf8");

/** Keys read out of the data model, so an invented one cannot pass the check. */
function keysOf(name, close) {
  const start = model.indexOf(name);
  const body = model.slice(start, model.indexOf(close, start));
  return [...body.matchAll(/^\s{4}(\w+):/gm)].map(m => m[1]);
}

const ATTRIBUTES = Object.keys(
  JSON.parse("{" + model.slice(
    model.indexOf("ATTRIBUTE_ABBREVIATIONS"), model.indexOf("});", model.indexOf("ATTRIBUTE_ABBREVIATIONS")))
    .match(/\{([\s\S]*)/)[1]
    .replace(/(\w+):/g, '"$1":').replace(/,\s*$/, "") + "}"));

const SKILLS = keysOf("static SKILLS = Object.freeze({", "});");
const SAVES = ["impulsive", "corporeal", "cognitive", "morale"];

if (!ATTRIBUTES.length || !SKILLS.length) {
  console.error("Could not read the attribute or skill keys out of the data model.");
  process.exit(2);
}

/**
 * A character, only as far as the validator reads it.
 *
 * Slot names are checked against what a character actually has - `skill.stelth` has to
 * fail - so the check is only as good as this shape, which is why the keys come from
 * the model rather than from memory.
 */
const DATA = {
  attributes: Object.fromEntries(ATTRIBUTES.map(k => [k, { score: 10, mod: 0 }])),
  skills: Object.fromEntries(SKILLS.map(k => [k, { bonus: 0, ranks: 0 }])),
  savingThrows: Object.fromEntries(SAVES.map(k => [k, { value: 0 }])),
  tierOfPower: 3,
  baseTierOfPower: 3
};

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith(".dbu") ? [full] : [];
  });
}

const traitsDir = path.join(ROOT, "traits");
const files = walk(traitsDir).sort();
// Every id once: getTrait finds a Trait by its id alone, so two files sharing one hand every
// caller whichever loaded last - a Karma asked for as an Apparel Quality.
{
  const ids = new Map();
  for (const file of files) {
    const relative = path.relative(traitsDir, file).replaceAll("\\", "/");
    const { id } = parseTraitFile(fs.readFileSync(file, "utf8"), relative);
    ids.set(id, [...(ids.get(id) ?? []), relative]);
  }
  const shared = [...ids].filter(([, where]) => where.length > 1);
  for (const [id, where] of shared) console.log(`FAIL id "${id}" is in ${where.join(" and ")}`);
  if (shared.length) process.exitCode = 1;
  console.log(`${ids.size} id(s), ${shared.length} shared`);
}

// The Battle Weathers, by id, for a Quality that has one chosen for it.
const WEATHERS = files.map(file => parseTraitFile(fs.readFileSync(file, "utf8"),
  path.relative(traitsDir, file).replaceAll("\\", "/")))
  .filter(trait => trait.weather === true).map(trait => trait.id);

let failures = 0;
let compiled = 0;
let scripted = 0;

for (const file of files) {
  const relative = path.relative(traitsDir, file).replaceAll("\\", "/");
  const trait = parseTraitFile(fs.readFileSync(file, "utf8"), relative);

  const problems = [];
  if (!trait.id) problems.push("no id");
  if (!trait.name) problems.push("no name");

  // A Quality that has something chosen for it names it as `$choice`: compiled with each thing
  // it offers - its own list, a Battle Weather, or a Skill. One that reads its own piece's
  // Apparel Bonus names it `$apparelBonus`, compiled with a 2; its Quality Slots `$slots`, a 1.
  // And the rest of what a piece's Effects name about the piece - Armor's multiplier, the Rolls
  // Weights reach, whether they are waived - at 1 each.
  const written = (trait.script ?? "").trim().replaceAll("$apparelBonus", "2")
    .replaceAll("$slots", "1")
    .replace(/\$(armorFactor|reachesStrike|reachesDodge|reachesWound|waived)\b/g, "1")
    // And a Weapon's, for the attack being made with it.
    .replace(/\$(simple|calledShot|aoe|lineAoe|halfWager|belowEnormous|sizeRank)\b/g, "1")
    // And a Buddy's: whether it is Active, its Buddy Attribute, its choices.
    .replace(/\$(active|flyin|dodgin|shiftedRide|buddyAttribute|applied)\b/g, "1")
    .replaceAll("skill.$choice2", "skill.craft")
    .replaceAll("skill.$insightSkill", "skill.perception")
    .replaceAll("skill.$skill", "skill.perception")
    // Lingering Power's Past Life, as answered.
    .replaceAll("skill.$pastSkill", "skill.perception")
    .replaceAll("$pastAttribute.score", "insight.score")
    // Balanced Fusion's 'Balanced Attributes', as chosen.
    .replaceAll("$balanced1.mod", "agility.mod").replaceAll("$balanced2.mod", "force.mod")
    // An Aspect's (transformations.mjs aspectScript): its bracketed part, its level, the highest Agility Bonus it came with.
    .replaceAll("save.$param", "save.impulsive").replaceAll("$agBonus", "1(T)").replaceAll("$level", "1").replaceAll("$topReq", "2").replaceAll("enterState($param", "enterState(raging")
    // A Transformation Trait's (transformations.mjs transformationTraitScript): its Transformation's G, Z, S and M.
    // Its row's choices and its Transformation's Aspect levels (transformations.mjs rowWritten): a 1 or a 0, a level.
    .replace(/\$is\.[a-z]+\.[a-z0-9-]+/g, "1").replace(/\$aspect\.[a-z0-9-]+/g, "1").replace(/\$row\.\w+/g, "1").replaceAll("$absorbedBonus", "2").replaceAll("$scales", "1").replace(/\$self\b/g, "evil-saiyan").replace(/\$besideTier\b/g, "2")
    // Its Adversary's Player Character Count (transformationTraitScript's $PCC, Overflowing Power's).
    .replace(/\$PCC\b/g, "1")
    .replace(/\$([GZSM])\b/g, "1");
  // A Racial Trait's `choose: list` - its own values, as slugs, each `$<value>` a 1 or a 0 (Alternate Scale Structure's).
  const listed = (String(trait.choose ?? "").trim() === "list");
  const own = String(trait.choices ?? "").split(",").map(entry => entry.split("=")[0].trim())
    .filter(Boolean).map(entry => (listed ? entry.toLowerCase().replace(/[^a-z0-9]+/g, "-") : entry));
  const offered = own.length ? own
    : (String(trait.chooses ?? "").trim() === "weather") ? WEATHERS
    // A Racial Trait's `choose:` - a Knowledge, or an Elemental Profile.
    : (String(trait.choose ?? "").trim() === "knowledge") ? ["knowledge", "knowledgeHistory"]
    : (String(trait.choose ?? "").trim() === "elementalProfile") ? ["elementalFire", "elementalEarth"]
    : (String(trait.choose ?? "").trim() === "savingThrow") ? ["cognitive", "corporeal"]
    // A Foundation - Super Specialist's.
    : (String(trait.choose ?? "").trim() === "foundation") ? ["physical", "energy", "magic"]
    : SKILLS;
  const flagged = key => (listed ? own.reduce((text, value) => text.replaceAll(`$${value}`, (value === key) ? "1" : "0"),
    written.replaceAll("$choice", key)) : written.replaceAll("$choice", key));
  const scripts = (written.includes("$choice") || listed)
    ? offered.map(flagged)
    : [written];
  for (const script of scripts) {
  if (script) {
    if (script === scripts[0]) scripted++;
    const { program, errors } = compile(script, DATA);
    for (const e of errors) {
      problems.push(`${e.line ? `line ${e.line}: ` : ""}${e.message}`);
    }

    if (!errors.length) {
      if (script === scripts[0]) compiled++;
      // Round trip: what the program prints as must parse back to the same program.
      const text = decompile(program);
      const again = compile(text, DATA);
      if (again.errors.length) {
        problems.push(`decompiled form does not compile: ${again.errors[0].message}`);
        problems.push(`  produced: ${text.split("\n").join(" | ")}`);
      }
      else if (JSON.stringify(again.program) !== JSON.stringify(program)) {
        problems.push("round trip changed the program");
        problems.push(`  produced: ${text.split("\n").join(" | ")}`);
      }
    }
  }
  }

  if (problems.length) {
    failures++;
    console.log(`\nFAIL ${relative}`);
    for (const p of problems) console.log(`  ${p}`);
  }
}

console.log(`\n${files.length} file(s), ${scripted} with a script, `
  + `${compiled} compiled, ${failures} failing`);
process.exit((failures || process.exitCode) ? 1 : 0);
