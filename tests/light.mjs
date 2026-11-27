/**
 * Light Levels: the first Battlefield rule, and the first thing that changes a character
 * from outside them.
 *
 * What is worth running is the arithmetic, on a real character, through the real effects
 * engine - not that the files exist. Three values move, two of them in (bT) and one flat,
 * and at the ends of the table they are halved instead. A halving lands on the finished
 * number and an addition does not, which is the difference between Dark and Pitch Black
 * and the thing a hand-written version would get wrong.
 *
 * The table is symmetrical: -2 and 2 do the same thing, -1 and 1 do the same thing. That
 * is the entry's own shape rather than a slip, so it is checked as a pair rather than
 * written out twice and trusted.
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
globalThis.foundry.data = { ...await import(appUrl("common/data/_module.mjs")) };
globalThis.foundry.data.operators = { ForcedReplacement: { create: value => value } };
const { default: DataModel } = await import(appUrl("common/abstract/data.mjs"));
globalThis.foundry.abstract = { DataModel, TypeDataModel: DataModel };
globalThis.ui = { notifications: { warn: () => {}, error: () => {}, info: () => {} } };
globalThis.Handlebars = { escapeExpression: String };
globalThis.game = { combat: null, users: { activeGM: null } };

const TRAITS = path.join(ROOT, "traits");
globalThis.foundry.utils.fetchJsonWithTimeout = async () =>
  JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));
globalThis.fetch = async url => {
  const file = path.join(TRAITS, String(url).replace("systems/dbu-ttrpg/traits/", ""));
  if (!fs.existsSync(file)) return { ok: false, status: 404, statusText: "missing" };
  return { ok: true, status: 200, text: async () => fs.readFileSync(file, "utf8") };
};

const { loadTraits, traitsOfKind, getTrait, KINDS } =
  await import(modUrl("effects/traits.mjs"));
const { default: DBUCharacterData } = await import(modUrl("data/actor-character.mjs"));
await loadTraits();

const INDEX = JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));
const REGISTRY = fs.readFileSync(path.join(ROOT, "module", "effects", "registry.mjs"), "utf8");
const SHEET = fs.readFileSync(
  path.join(ROOT, "module", "sheets", "actor-character-sheet.mjs"), "utf8");
const TAB = fs.readFileSync(
  path.join(ROOT, "templates", "parts", "actor-battlefields.hbs"), "utf8");
const BLINDED = fs.readFileSync(path.join(TRAITS, "conditions", "blinded.dbu"), "utf8");

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

/** The least a parent can be and still be one the base class accepts. */
class ActorStub extends DataModel {
  static defineSchema() { return {}; }
}

/**
 * A character standing in a given Light Level, run through the whole engine.
 *
 * Built the way every other harness here builds one, with the Light Level set before the
 * phases run - which is the only thing that differs between the calls below.
 */
// Built up rather than left at the minimum. A character with an Awareness of 1 has every
// one of these effects clamped at nothing, and a check that passes because both sides
// bottomed out is a check that measured nothing.
function progressionTo(powerLevel) {
  const rows = [
    { lvl: 1, choice: "Skill Improvement", locked: true, attributes: {},
      skillRanks: ["perception", "perception"] }
  ];
  for (let lvl = 2; lvl <= powerLevel; lvl++) {
    rows.push({ lvl, choice: "Attribute Addition", locked: false,
      attributes: { insight: 1, agility: 1 }, skillRanks: [] });
  }
  return rows;
}

function standing(lightLevel, { powerLevel = 10, conditions = {} } = {}) {
  // A parent, because that is where the effects engine looks: `programsFor(this.parent)`
  // reads the Items, the Conditions and - now - the Light Level off the Actor, not off
  // the model. A model with no parent has no effects at all, which would make every check
  // below pass by measuring nothing.
  //
  // A DataModel rather than a plain object, which is what the base class insists on - and
  // the Actor it stands in for is one too.
  const parent = new ActorStub({}, { strict: false });
  parent.items = [];
  const model = new DBUCharacterData(
    { powerLevel, progression: progressionTo(powerLevel), battlefield: { lightLevel }, conditions },
    { parent, strict: false });
  parent.system = model;
  model.prepareBaseData?.();
  model.prepareDerivedData();
  return model;
}

// --- The five Levels, as the table prints them ------------------------------------------------
{
  // The Levels, which is not every Battlefield Trait: Cover is one too and has no Light
  // Level at all. Filtered on the header that carries the number, which is the same test
  // the registry makes.
  const all = traitsOfKind("battlefields");
  const levels = all.filter(t => t.lightLevel !== undefined);

  check("five of them", levels.length, 5);
  check("and the Battlefield Traits that are not Levels", 
    all.filter(t => t.lightLevel === undefined).map(t => t.id).sort(),
    ["bog-environment", "cold-weather", "cover", "earthquake-weather", "hot-weather",
     "lava-environment",
     "magma-environment", "soft-environment", "standard-environment", "storm-weather",
     "tornado-weather",
     "unbreathable-environment", "underwater-environment", "vile-weather"]);

  // And the sheet's own picker is the same five. It was not: it mapped every Battlefield
  // file, and `Number(undefined) || 0` put Cover in the list as "Cover (0)" beside Normal.
  // A Battle Weather would have joined it.
  check("the sheet's picker filters on the same header",
    SHEET.includes(".filter(trait => trait.lightLevel !== undefined)"), true);
  check("named and numbered as the table prints them",
    levels.map(t => [t.id, t.name, Number(t.lightLevel)]).sort((a, b) => a[2] - b[2]),
    [["pitch-black", "Pitch Black", -2],
     ["dark", "Dark", -1],
     ["normal", "Normal", 0],
     ["bright", "Bright", 1],
     ["blinding", "Blinding", 2]]);

  check("every one of them is in the index",
    levels.every(t => INDEX.traits.includes(`battlefields/${t.id}.dbu`)), true);
  check("the folder is a kind of Trait", Boolean(KINDS.battlefields), true);
  check("called what a reader would call it", KINDS.battlefields.label, "Battlefield");

  // Normal has no passive on purpose. Asked of what compiles rather than of the file's
  // text: everything after the `---` is the script, comments included, so every one of
  // these files has a `script` and only four of them have a statement in it.
  check("every file has a script, comments being part of one",
    levels.filter(t => t.script).length, 5);
  check("and only Normal's says nothing",
    levels.filter(t => !/^[a-z]/m.test(t.script.replace(/^#.*$/gm, "").trim()))
      .map(t => t.id),
    ["normal"]);

  // The range the field will take, read off the same table.
  check("the field's ends are the table's ends",
    [DBUCharacterData.LIGHT_LEVEL_MIN, DBUCharacterData.LIGHT_LEVEL_MAX], [-2, 2]);
}

// --- What each Level does to a character, run ---------------------------------------------------
{
  const plain = standing(0);
  const base = {
    awareness: plain.awareness,
    defenseValue: plain.defenseValue,
    perception: plain.skills.perception.bonus
  };

  check("Normal changes nothing at all",
    [base.awareness > 0, base.defenseValue > 0, base.perception > 0], [true, true, true]);

  // The Base Tier this character is at, which is what (bT) means for them.
  const bT = plain.baseTierOfPower;
  check("and they are past Base Tier 1, so 2(bT) is not 2", bT > 1, true);

  // Dark and Bright: two in (bT) off the Combat values, two flat off the Skill Bonus.
  for (const level of [-1, 1]) {
    const it = standing(level);
    check(`at ${level}, Awareness is down 2(bT)`,
      it.awareness, base.awareness - (2 * bT));
    check(`at ${level}, Defense Value is down 2(bT)`,
      it.defenseValue, base.defenseValue - (2 * bT));
    check(`at ${level}, the Perception Bonus is down a flat 2`,
      it.skills.perception.bonus, base.perception - 2);
  }

  // Pitch Black and Blinding: halved, and halved on the finished number.
  for (const level of [-2, 2]) {
    const it = standing(level);
    check(`at ${level}, Awareness is halved`,
      it.awareness, Math.floor(base.awareness / 2));
    check(`at ${level}, Defense Value is halved`,
      it.defenseValue, Math.floor(base.defenseValue / 2));
    check(`at ${level}, the Perception Bonus is halved`,
      it.skills.perception.bonus, Math.floor(base.perception / 2));
  }

  // The table is symmetrical about Normal, which is the entry's own shape.
  const pairs = [[-1, 1], [-2, 2]];
  for (const [low, high] of pairs) {
    const a = standing(low);
    const b = standing(high);
    check(`${low} and ${high} come to the same three numbers`,
      [a.awareness, a.defenseValue, a.skills.perception.bonus],
      [b.awareness, b.defenseValue, b.skills.perception.bonus]);
  }

  // Halving is not subtracting, and which of the two hurts more is not fixed: a halving
  // takes more than 2(bT) only once the value is above 4(bT). This character's Defense
  // Value is below that, so Dark costs them more than Pitch Black does - which looks
  // wrong and is what the table says.
  check("halving and subtracting cross over at 4(bT)", 4 * bT, 12);
  check("and this character is under it, so the middle bites harder",
    [base.defenseValue < (4 * bT), standing(-1).defenseValue < standing(-2).defenseValue],
    [true, true]);

  // Above the crossover it goes the other way round, which is the half worth proving:
  // otherwise the line above reads as the rule rather than as one side of it.
  const strong = standing(0, { powerLevel: 30 });
  const strongDark = standing(-1, { powerLevel: 30 });
  const strongBlack = standing(-2, { powerLevel: 30 });
  check("a bigger character is over it",
    strong.defenseValue > (4 * strong.baseTierOfPower), true);
  check("and for them Pitch Black is the worse of the two",
    strongBlack.defenseValue < strongDark.defenseValue, true);

  // What else moves, which is not nothing. A Light Level writes three Slots, and two of
  // the values the rest of the sheet is built from are made out of them: the Strike Roll
  // is Haste plus Awareness, and the Dodge Roll is the Defense Value. So standing in the
  // dark makes you worse at hitting as well as at seeing - which the entry does not spell
  // out and follows from it anyway.
  const dark = standing(-1);
  check("the Strike Roll goes with the Awareness",
    plain.combat.strike - dark.combat.strike, base.awareness - dark.awareness);
  check("and the Dodge Roll with the Defense Value",
    plain.combat.dodge - dark.combat.dodge, base.defenseValue - dark.defenseValue);

  // And nothing that is not built out of those three moves at all.
  check("Life is untouched", dark.life.max, plain.life.max);
  check("so is Ki", dark.ki.max, plain.ki.max);
  check("so is the Wound Roll", dark.combat.wound.physical, plain.combat.wound.physical);
  check("so is Might", dark.might, plain.might);
  check("and so is every Skill but the one named",
    Object.entries(dark.skills)
      .filter(([key, skill]) => skill.bonus !== plain.skills[key].bonus)
      .map(([key]) => key),
    ["perception"]);
}

// --- Standing in the dark while Blinded ------------------------------------------------------------
{
  // Blinded writes the Blinding Light Level's three lines itself, because it applies
  // whatever the light is doing. So a Blinded Character in Blinding light halves twice -
  // two multiplications, which is what this engine does with two halvings.
  check("Blinded says which Level it copies",
    BLINDED.includes("the effects of the\n  Blinding Light Level"), true);
  check("and writes the same three lines",
    ["awareness *= 0.5;", "defenseValue *= 0.5;", "skill.perception.bonus *= 0.5;"]
      .every(line => BLINDED.includes(line)), true);
  check("which the Blinding file says is deliberate",
    getTrait("blinding").notes?.includes("halves all three\n# twice")
      ?? fs.readFileSync(path.join(TRAITS, "battlefields", "blinding.dbu"), "utf8")
        .includes("halves all three\n# twice"), true);

  const lit = standing(0);
  const blind = standing(0, { conditions: { blinded: 1 } });
  check("Blinded alone halves them", blind.defenseValue, Math.floor(lit.defenseValue / 2));

  const both = standing(2, { conditions: { blinded: 1 } });
  check("and Blinded in Blinding light halves them twice",
    both.defenseValue, Math.floor(lit.defenseValue / 4));
  check("which is not the same as halving once",
    both.defenseValue < blind.defenseValue, true);

  // Blinded plus Dark is a halving and a subtraction, and the halving lands last.
  const darkBlind = standing(-1, { conditions: { blinded: 1 } });
  check("a subtraction and a halving fold in that order",
    darkBlind.defenseValue,
    Math.floor((lit.defenseValue - (2 * lit.baseTierOfPower)) / 2));
}

// --- Read off the character, and set by hand -----------------------------------------------------
{
  // The field refuses what is not on the table.
  check("the schema is bounded by the table's ends",
    fs.readFileSync(path.join(ROOT, "module", "data", "actor-character.mjs"), "utf8")
      .includes("min: DBUCharacterData.LIGHT_LEVEL_MIN, max: DBUCharacterData.LIGHT_LEVEL_MAX"),
    true);
  check("and Normal is where a character starts", standing(0).battlefield.lightLevel, 0);

  // Which Trait is which Level lives in the files, not in a table in the code.
  check("the Level is read off the Trait rather than mapped in code",
    REGISTRY.includes(".find(candidate => Number(candidate.lightLevel) === level);"), true);
  check("and the picker is built from the same files",
    SHEET.includes('const levels = traitsOfKind("battlefields")'), true);
  check("so a Level nobody wrote a file for is not offered",
    REGISTRY.includes("is not one this system has a Battlefield file for."), true);

  // The picker, built.
  const levels = traitsOfKind("battlefields")
    .filter(trait => trait.lightLevel !== undefined)
    .map(trait => ({ value: Number(trait.lightLevel) || 0, trait }))
    .sort((a, b) => a.value - b.value);
  check("offered lowest first",
    levels.map(l => l.value), [-2, -1, 0, 1, 2]);
  check("and Cover is not among them, having no Level",
    levels.some(l => l.trait.id === "cover"), false);
  check("and labelled with their sign",
    levels.map(({ value, trait }) =>
      `${trait.name} (${value > 0 ? "+" : ""}${value})`),
    ["Pitch Black (-2)", "Dark (-1)", "Normal (0)", "Bright (+1)", "Blinding (+2)"]);

  // Set by the player, which is what the tab says and what the field is for.
  check("the tab writes straight to the field",
    TAB.includes('<select name="system.battlefield.lightLevel" data-dtype="Number" data-tooltip="{{lightLevel.effect}}">'), true);
  check("what the Level does is on hover, not under the row",
    TAB.includes("<p class=\"tab-placeholder\">{{lightLevel.effect}}</p>"), false);
  // Scale and Light Sources used to be printed under the picker, saying that Squares and
  // areas are the table's. They were four paragraphs standing where somebody was looking
  // for a control, and they are gone.
  //
  // What that leaves is the thing worth pinning either way: the Level is set by hand and
  // nothing here works one out, so there is no Square for the tab to have been talking
  // about.
  // From the picker to the end of the panel it sits in - it shares a row with Battle
  // Weather now, so the panel is the unit rather than a heading.
  const LIGHT = TAB.slice(TAB.indexOf('name="system.battlefield.lightLevel"'),
    TAB.indexOf("</section>", TAB.indexOf('name="system.battlefield.lightLevel"')));
  check("nothing beside the picker claims to know about Squares",
    /Square/.test(LIGHT), false);
  check("nor about areas",
    /Area of Effect/.test(LIGHT), false);
  check("and the section was really found to look at",
    LIGHT.includes('name="system.battlefield.lightLevel"'), true);
  check("and no Level is worked out anywhere",
    SHEET.includes("context.lightLevel = ") && !SHEET.includes("lightLevelFor("), true);
}

console.log(`${failed} failing`);
process.exit(failed ? 1 : 0);
