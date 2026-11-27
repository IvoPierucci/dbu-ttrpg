/**
 * The two Attributes that carry a rule of their own.
 *
 * Gifted Student on Scholarship and Determination on Personality, both written to the
 * same pattern: it turns on at a Score of 4 and doubles at 8.
 *
 * Built as a real character and read off the model rather than checked as source: the
 * question that matters is what a sheet shows, and three of the four numbers involved -
 * the Technique Points, the Skill roll, the Stress Bonus - are the ends of long
 * derivations that a bonus can be added to in the wrong place without anything failing
 * to compile.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
const APP = (process.env.FOUNDRY_APP || String.raw`C:\Program Files\Foundry Virtual Tabletop\resources\app`);
const appUrl = p => pathToFileURL(path.join(APP, p)).href;
const modUrl = p => pathToFileURL(path.join(ROOT, "module", p)).href;

globalThis.CONST = {};
globalThis.foundry = {};
await import(appUrl("common/primitives/_module.mjs"));
globalThis.foundry.utils = { ...await import(appUrl("common/utils/_module.mjs")) };
globalThis.foundry.data = await import(appUrl("common/data/_module.mjs"));
const { default: DataModel } = await import(appUrl("common/abstract/data.mjs"));
globalThis.foundry.abstract = { DataModel, TypeDataModel: DataModel };
globalThis.ui = { notifications: { warn: () => {}, error: () => {}, info: () => {} } };

const TRAITS = path.join(ROOT, "traits");
globalThis.foundry.utils.fetchJsonWithTimeout = async () =>
  JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));
globalThis.fetch = async url => {
  const file = path.join(TRAITS, String(url).replace("systems/dbu-ttrpg/traits/", ""));
  if (!fs.existsSync(file)) return { ok: false, status: 404, statusText: "missing" };
  return { ok: true, status: 200, text: async () => fs.readFileSync(file, "utf8") };
};

const { default: DBUCharacterData } = await import(modUrl("data/actor-character.mjs"));

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

/**
 * A character with every Attribute Addition poured into one Attribute, and a number of
 * Skill Improvements beside them.
 *
 * An Addition is worth 2, so the Scores this reaches are odd: 1, 3, 5, 7, 9. That covers
 * either side of both thresholds without landing on them, which is why the boundaries
 * themselves are asked of the rule directly further down.
 */
function build({ attribute, additions = 0, improvements = 0, powerLevel = 20 }) {
  const progression = [
    // The fixed Level 1 Skill Improvement, worth 25 where the rest are worth 15.
    { lvl: 1, choice: "Skill Improvement", locked: true, attributes: {}, skillRanks: [] }
  ];

  let lvl = 2;
  for (let i = 0; i < additions; i++) {
    progression.push({ lvl: lvl++, choice: "Attribute Addition", locked: false,
      attributes: { [attribute]: 2 }, skillRanks: [] });
  }
  for (let i = 0; i < improvements; i++) {
    progression.push({ lvl: lvl++, choice: "Skill Improvement", locked: false,
      attributes: {}, skillRanks: [] });
  }

  const model = new DBUCharacterData({ powerLevel, progression }, { strict: false });
  model.prepareBaseData?.();
  model.prepareDerivedData();
  return model;
}

// --- The shape both rules share ---------------------------------------------------------
// "If your X Score is 4+, <bonus>. Double this bonus if your X Score is 8+." Asked at the
// boundaries, which a character built out of Attribute Additions cannot land on.
{
  const worth = DBUCharacterData.attributeRule;

  check("below 4 it is worth nothing", [worth(0, 3), worth(3, 3)], [0, 0]);
  check("at 4 it is worth the whole of it", worth(4, 3), 3);
  check("and stays there up to 7", [worth(5, 3), worth(7, 3)], [3, 3]);
  check("at 8 it doubles", worth(8, 3), 6);
  check("and stays doubled above it", [worth(9, 3), worth(20, 3)], [6, 6]);

  check("the thresholds are named",
    [DBUCharacterData.ATTRIBUTE_RULE_SCORE, DBUCharacterData.ATTRIBUTE_RULE_DOUBLED_SCORE],
    [4, 8]);
  check("and so are the three amounts", [
    DBUCharacterData.GIFTED_STUDENT_SKILL_CHECK,
    DBUCharacterData.GIFTED_STUDENT_TECHNIQUE_POINTS,
    DBUCharacterData.DETERMINATION_STRESS_BONUS
  ], [1, 3, 1]);
}

// --- Gifted Student -----------------------------------------------------------------------
{
  const at = additions => build({ attribute: "scholarship", additions, improvements: 3 });

  const below = at(1);
  const over = at(2);
  const doubled = at(4);

  check("the Scores these reach",
    [below, over, doubled].map(m => m.attributes.scholarship.score), [3, 5, 9]);

  check("nothing below a Score of 4",
    [below.giftedStudent.skillCheck, below.giftedStudent.perSkillImprovement], [0, 0]);
  check("from 4, +1 and +3",
    [over.giftedStudent.skillCheck, over.giftedStudent.perSkillImprovement], [1, 3]);
  check("from 8, both doubled",
    [doubled.giftedStudent.skillCheck, doubled.giftedStudent.perSkillImprovement], [2, 6]);

  // Ingenuity: "a unique Aptitude that is equal to your Scholarship Modifier at the time of
  // creating/modifying an Item" - the Modifier, whatever the Score's rules.
  check("Ingenuity is the Scholarship Modifier",
    [below, over, doubled].map(m => [m.ingenuity, m.attributes.scholarship.mod]),
    [below, over, doubled].map(m => [m.attributes.scholarship.mod, m.attributes.scholarship.mod]));
  check("and a number", [below, over, doubled].every(m => Number.isFinite(m.ingenuity)), true);
  // On the Gear tab since the Aptitudes left Main (the user's).
  const GEARTAB = fs.readFileSync(path.join(ROOT, "templates", "parts", "actor-gear.hbs"), "utf8");
  check("shown on the Gear tab", GEARTAB.includes("<em>Ingenuity</em><span>{{system.ingenuity}}</span>"), true);

  // "Increase the Dice Score of your Skill Checks by 1." The roll, not the Skill Bonus -
  // so an effect that halves the Bonus does not halve this.
  check("the Skill Bonus is untouched",
    [below.skills.craft.bonus, over.skills.craft.bonus, doubled.skills.craft.bonus], [1, 2, 4]);
  check("and the roll carries the bonus",
    [below.skills.craft.roll, over.skills.craft.roll, doubled.skills.craft.roll], [1, 3, 6]);
  check("on every Skill, not just one",
    Object.values(over.skills).every(skill => skill.roll === skill.bonus + 1), true);

  // "Increase the amount of Technique Points you gain from Skill Improvements by 3."
  // Four Improvements here: the fixed Level 1 one worth 25, and three worth 15.
  check("the Improvements are worth what they were",
    below.techniquePoints, 25 + (3 * 15));
  check("+3 each from a Score of 4", over.techniquePoints, below.techniquePoints + (4 * 3));
  check("and +6 each from 8", doubled.techniquePoints, below.techniquePoints + (4 * 6));

  // Per row rather than per total, which is where the rule puts it - and what the
  // progression table shows.
  const improvements = over.progression.filter(e => e.choice === "Skill Improvement");
  check("each row shows what it granted",
    improvements.map(e => e.technique).sort((a, b) => a - b), [18, 18, 18, 28]);
  // The fixed Level 1 Improvement takes it like any other: it is a Skill Improvement,
  // and the rule names no exception.
  check("the Level 1 Improvement takes it too",
    improvements.find(e => e.lvl === 1).technique, 28);
  // And nothing else does.
  check("nothing but a Skill Improvement grants any",
    over.progression.filter(e => e.choice !== "Skill Improvement")
      .every(e => e.technique === 0), true);

  // "The bonus to your Technique Points is retroactive": raising the Score raises every
  // Improvement already taken. Nothing is migrated for that - the total is counted from
  // the rows on every pass, so it simply is the new number.
  check("raising the Score raises what is already earned",
    [below.techniquePoints, over.techniquePoints, doubled.techniquePoints], [70, 82, 94]);
}

// --- Determination --------------------------------------------------------------------------
{
  const at = additions => build({ attribute: "personality", additions });

  const below = at(1);
  const over = at(2);
  const doubled = at(4);

  check("the Scores these reach",
    [below, over, doubled].map(m => m.attributes.personality.score), [3, 5, 9]);

  check("nothing below a Score of 4", below.determination, 0);
  check("+1 from 4", over.determination, 1);
  check("+2 from 8", doubled.determination, 2);

  // The Stress Bonus is what a Transformation's Stress Test is measured against.
  check("and the Stress Bonus carries it",
    [below.stressBonus, over.stressBonus, doubled.stressBonus],
    [below.stressBonus, below.stressBonus + 1, below.stressBonus + 2]);

  // The only rule Personality has, so nothing else moved.
  check("Scholarship's rule is not Personality's",
    [over.giftedStudent.skillCheck, over.giftedStudent.perSkillImprovement], [0, 0]);
  check("and Personality's is not Scholarship's",
    build({ attribute: "scholarship", additions: 2 }).determination, 0);
}

// --- Craft's Specialties, each a Skill of its own (the user's ruling) ---------------------------------
{
  const SK = DBUCharacterData.SKILLS;
  check("four Crafts, one to a Specialty, each Required and Scholarship's, each opening Repair",
    ["craft", "craftApparel", "craftWeapons", "craftVehicles"].map(key =>
      [SK[key]?.label, SK[key]?.attribute, SK[key]?.required, SK[key]?.specialManeuver, Boolean(SK[key]?.specialties)]),
    [["Craft (Basic Item)", "scholarship", true, "repair", false], ["Craft (Apparel)", "scholarship", true, "repair", false],
     ["Craft (Weapons)", "scholarship", true, "repair", false], ["Craft (Vehicles)", "scholarship", true, "repair", false]]);
  const rows = [{ lvl: 1, choice: "Skill Improvement", locked: true, attributes: {},
    skillRanks: ["craftWeapons", "craftWeapons", "craft"] }];
  const model = new DBUCharacterData({ progression: rows, skillSpecializations: { craft: "vehicles", knowledge: "History" } },
    { strict: false });
  model.prepareBaseData?.();
  model.prepareDerivedData();
  check("each with its own Ranks - the old Craft's are Craft (Basic Item)'s",
    ["craft", "craftApparel", "craftWeapons", "craftVehicles"].map(key => model.skills[key].ranks), [1, 0, 2, 0]);
  check("no ticked Specialties or written ones left: Knowledge's three are Skills too",
    [model.skills.craft.specialties, model.skills.craft.specialization, model.skills.knowledge.specialization,
     ["knowledge", "knowledgeProfession", "knowledgeHistory"].map(key => DBUCharacterData.SKILLS[key]?.label)],
    [null, "", "", ["Knowledge (Science)", "Knowledge (Profession)", "Knowledge (History)"]]);
  check("Repair once in the Special Maneuvers, open at 2 in any Craft",
    model.specialManeuvers.filter(entry => entry.maneuver === "repair").map(entry => [entry.open, entry.ranks]), [[true, 2]]);
}

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
