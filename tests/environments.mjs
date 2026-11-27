/**
 * Battle Environments: the frame, ahead of the Environments.
 *
 * The same shape Battle Weather has, with two differences that are the whole of what is
 * worth checking here.
 *
 * There is no "none". A character is always standing on something, so the field defaults
 * to the Standard Environment and the picker has no blank - where a Weather's empty string
 * means clear skies and is a real answer.
 *
 * And there are no Tiers. A Weather comes in three strengths and an Environment does not.
 *
 * Three searches now run over one folder - Light Levels, Weathers and Environments - and
 * each has to say which files are its own. That is where this will break if it breaks: a
 * file with no `lightLevel` coerces to Level 0 and fights Normal for the slot.
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
// What chat.mjs imports from actor-types.mjs, for the functions cut out of it (the Minion Actor type).
globalThis.isMinion = actor => actor?.type === "minion";
globalThis.isCharacter = actor => ["character", "minion"].includes(actor?.type);
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

const { loadTraits, getTrait, traitsOfKind } = await import(modUrl("effects/traits.mjs"));
await loadTraits();

const { default: DBUCharacterData } = await import(modUrl("data/actor-character.mjs"));
const { ENVIRONMENT_RULES, STANDARD_ENVIRONMENT, qualitiesOf, groundHardnessWith,
        HIGH_ENVIRONMENTS, MAX_HIGH_ENVIRONMENT, highEnvironment, isAirborne,
        soarOptions } = await import(modUrl("environments.mjs"));
const { HARDNESS_RANKS, hardnessValue, COLLISION_QUALITIES, COLLISION_DAMAGE } =
  await import(modUrl("features.mjs"));
class ActorStub extends DataModel { static defineSchema() { return {}; } }

const { reactiveFor } = await import(modUrl("effects/registry.mjs"));
const { collectReactive } = await import(modUrl("effects/interpreter.mjs"));

const TAB = fs.readFileSync(
  path.join(ROOT, "templates", "parts", "actor-battlefields.hbs"), "utf8");
const SHEET = fs.readFileSync(
  path.join(ROOT, "module", "sheets", "actor-character-sheet.mjs"), "utf8");
const REGISTRY = fs.readFileSync(
  path.join(ROOT, "module", "effects", "registry.mjs"), "utf8");
const DATA = fs.readFileSync(
  path.join(ROOT, "module", "data", "actor-character.mjs"), "utf8");

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

// The row builder the tab uses, cut out once and read by both blocks below.
  // Cut out and run, because "is there a row" is a question with two answers and a
  // source check on the shape of an expression is a check on the shape of an expression.
const from = SHEET.indexOf("  const lowest = Number(environmentTrait?.hardnessMin);");
// Up to the Qualities block rather than to `context.environmentRules`: that block moved
// in between, and a slice that swallowed it would be cutting out a call to `qualitiesOf`
// with nothing to answer it.
const to = SHEET.indexOf("    // The Environmental Qualities there are", from);
check("the row builder was found to cut out", (from > 0) && (to > from), true);

const groundFor = trait => new Function("environmentTrait", "system", "HARDNESS_RANKS",
  `const context = {};
   ${SHEET.slice(from, to)}
   return context.ground;`)(trait, { battlefield: { groundHardness: 2 } },
     HARDNESS_RANKS);


/** A character standing on ground of a stated Hardness Rank. */
function standingOnGround(groundHardness) {
  const parent = new ActorStub({}, { strict: false });
  parent.items = [];
  const model = new DBUCharacterData(
    { powerLevel: 5, battlefield: { groundHardness } }, { parent, strict: false });
  parent.system = model;
  model.prepareBaseData?.();
  model.prepareDerivedData();
  return model.battlefield.groundHardness;
}

/**
 * A Progression long enough to reach this Power Level, spending every choice on
 * Attributes.
 *
 * Attribute Scores are not stored - they are 1 plus every Addition taken - so a character
 * with no Progression has every Score at 1, and a Combat Roll worth 1 cannot go down by 2.
 * The Bog's "1(bT) off all of your Combat Rolls" read as 1 off against that floor, which
 * is two different numbers looking like one. The same trap the Cold Weather checks fell
 * into, in a second harness.
 */
function progressionTo(powerLevel) {
  const ATTRIBUTES = ["agility", "force", "tenacity", "scholarship", "insight", "magic",
                      "personality"];
  const rows = [{ lvl: 1, choice: "Skill Improvement", locked: true, attributes: {},
                  skillRanks: [], notes: "" }];
  for (let lvl = 2; lvl <= powerLevel; lvl += 1) {
    rows.push({ lvl, choice: "Attribute Addition", locked: false,
                attributes: Object.fromEntries(ATTRIBUTES.map(key => [key, 2])),
                skillRanks: [], notes: "" });
  }
  return rows;
}

/** A character at a height, over a Battle Environment, on a Square with these Qualities. */
function standingOnHigh(rank, qualities = [], environment = "bog-environment") {
  const parent = new ActorStub({}, { strict: false });
  parent.items = [];
  const model = new DBUCharacterData(
    { powerLevel: 10, progression: progressionTo(10),
      battlefield: { environment, highEnvironment: rank, qualities } },
    { parent, strict: false });
  parent.system = model;
  model.prepareBaseData?.();
  model.prepareDerivedData();
  return model;
}

/** A character standing in an Environment, or in whatever the default is. */
function standingOn(environment) {
  const parent = new ActorStub({}, { strict: false });
  parent.items = [];
  const source = { powerLevel: 10, progression: progressionTo(10) };
  if (environment !== undefined) source.battlefield = { environment };
  const model = new DBUCharacterData(source, { parent, strict: false });
  parent.system = model;
  model.prepareBaseData?.();
  model.prepareDerivedData();
  return model;
}

// --- The frame, in the rulebook's own words -------------------------------------------------
{
  check("the rules kept, in the order they are written",
    ENVIRONMENT_RULES.map(rule => rule.key),
    ["entering", "height", "occupation", "collision", "high-qualities", "rank-zero", "soar"]);
  check("named", ENVIRONMENT_RULES.map(rule => rule.name),
    ["Entering and Leaving Environments", "Height and Range", "Square Occupation",
     "Lacking Collision", "High Environmental Qualities", "Ground and High Environments",
     "Soar Maneuver and Environments"]);

  const rule = key => ENVIRONMENT_RULES.find(entry => entry.key === key).text;

  check("Entering and Leaving, whole", [
    rule("entering").includes("Environments may cover an entire Battlefield, but they also may not"),
    rule("entering").includes("a Battlefield may have both land (Standard Environment) and water "
      + "(Underwater Environment)"),
    // The sentence that decides whether any of this reaches a character, which is why it
    // is kept rather than trimmed as an example.
    rule("entering").includes("If a Character enters any Squares that are designated as the "
      + "Underwater Environment, they will therefore enter that Environment")
  ], [true, true, true]);

  check("the Soar rule, whole", [
    rule("soar").includes("While not in a High Environment, the Soar Maneuver can be used to "
      + "enter the Low Sky Environment"),
    rule("soar").includes("move up/down 1 rank of High Environment"),
    rule("soar").includes("leave the High Environment and enter the Battle Environment of the "
      + "Square they would be occupying")
  ], [true, true, true]);
}

// --- What is not built, and named ---------------------------------------------------------------
{
  // Held back deliberately. The High Environments are not in the system, and neither is the
  // Soar Maneuver - which Staggered names and a Slot's documentation names and no file
  // defines. So the rule is listed with a note saying what to do instead, rather than
  // listed as though it worked.
  const soar = ENVIRONMENT_RULES.find(rule => rule.key === "soar");
  check("the Soar rule is on the list", Boolean(soar.text), true);

  // Built now, which it was not when the ranks arrived: the Maneuver has a file and the
  // rank is a field it writes.
  check("there is a Soar Maneuver file",
    fs.existsSync(path.join(TRAITS, "maneuvers", "soar.dbu")), true);
  const ELSEWHERE = fs.readdirSync(path.join(ROOT, "module"))
    .filter(name => name.endsWith(".mjs"))
    .map(name => fs.readFileSync(path.join(ROOT, "module", name), "utf8"))
    .join("\n");
  // Nothing moves anybody between Battle Environments: which Square you are standing in
  // is the table's, and the picker is how you say you moved. Height is the exception, and
  // it is the exception because a rank is a number the Soar Maneuver names outright.
  check("nothing moves anybody between Battle Environments",
    /enterEnvironment|leaveEnvironment/.test(ELSEWHERE), false);
  // Deadly Drop is the other: "you (and any characters you are Grappling) may leave all High
  // Environments" - the attacker and the one they grapple, brought down together.
  // And a Hikou Vehicle's Passengers, carried with it (vehicles.mjs skyForPassengers).
  check("and only the Soar Maneuver, Deadly Drop, Suplex and a Hikou Vehicle move anybody between ranks",
    [...ELSEWHERE.matchAll(/"system\.battlefield\.highEnvironment": /g)].length, 5);
  check("Deadly Drop's two and Suplex's, and only to the ground",
    [...ELSEWHERE.matchAll(/"system\.battlefield\.highEnvironment": 0 \}\);/g)].length, 3);
}


// --- The Soar Maneuver ------------------------------------------------------------------------------
{
  const { getManeuver, loadManeuvers } = await import(modUrl("maneuvers.mjs"));
  await loadManeuvers();

  const USE = fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8");
  const soar = getManeuver("soar");

  check("loaded as a Standard Maneuver", soar?.type, "standard");
  check("costing 1 Action and no Ki", [soar.actionCost, soar.kiCost], [1, 0]);
  check("aimed at nobody", soar.requiresTarget, false);
  check("once a Round", soar.usageLimit, { amount: 1, per: "round" });
  check("and Special, so it has to be granted",
    [soar.special, soar.soars], [true, true]);

  check("the entry is there whole", [
    soar.text.includes("Soar Maneuver [1/Round]: Soar through the skies like a bird!"),
    soar.text.includes("Increase your Defense Value by 1(bT) until the start of your next turn"),
    soar.text.includes("if not in a High Environment, you can enter the Low Sky Environment"),
    soar.text.includes("you can increase your rank of High Environment by +/- 1 Rank"),
    soar.text.includes("where if it would become 0 then you enter the normal Battle "
      + "Environment for the Square you are occupying")
  ], [true, true, true, true, true]);

  // Two Ranks in Flight, like every other Special Maneuver a Skill opens.
  check("Flight opens it",
    DBUCharacterData.SKILLS.flight.specialManeuver, "soar");

  // --- The Defense Value is a mark ---------------------------------------------------------------
  {
    const mark = getTrait("soaring");
    check("the mark is there and is not a Combat Condition",
      [mark?.kind, mark?.combatCondition], ["conditions", false]);
    check("carrying the bonus",
      mark.script.split("\n").filter(line => !line.trim().startsWith("#")).join(" ")
        .includes("defenseValue += 1(bT);"), true);
    check("and the Maneuver gains it and clocks it", [
      soar.script.includes("gain(soaring);"),
      soar.script.includes("expires(soaring, start-of-next-turn);")
    ], [true, true]);

    // Not the same thing as being in the air: "additionally" is the entry's own word, and
    // a character may Soar and stay where they are.
    check("nothing about the mark asks where they are",
      /highEnvironment/.test(mark.script), false);
  }

  // --- Where it can take them --------------------------------------------------------------------
  {
    const at = rank => soarOptions({ battlefield: { highEnvironment: rank } });

    // "If not in a High Environment, you can enter the Low Sky Environment." One place to
    // go from the ground, and it is the first rank.
    check("from the ground there is one place to go",
      at(0).map(option => option.rank), [1]);
    check("named for it", at(0)[0].label, "Take off into the Low Sky");

    // "+/- 1 Rank" - two places from the air, up first.
    check("from the Low Sky, up or down",
      at(1).map(option => option.rank), [2, 0]);
    check("and down from the Low Sky is the ground",
      at(1)[1].label, "Come down to the ground");
    check("from the High Sky, up or down",
      at(2).map(option => option.rank), [3, 1]);
    check("from Local Space, up or down",
      at(3).map(option => option.rank), [4, 2]);

    // There is no fifth rank, so the top has one answer again.
    check("and from Deep Space there is only down",
      at(4).map(option => option.rank), [3]);
    check("which is the highest there is", MAX_HIGH_ENVIRONMENT, 4);

    // Every option names a rank that exists, and none of them is where they already are.
    for (const rank of [0, 1, 2, 3, 4]) {
      check(`no option at rank ${rank} leaves them where they are`,
        at(rank).some(option => option.rank === rank), false);
      check(`and every one is a rank there is at ${rank}`,
        at(rank).every(option => (option.rank >= 0) && (option.rank <= MAX_HIGH_ENVIRONMENT)),
        true);
    }
  }

  // --- Offered, not taken ---------------------------------------------------------------------------
  {
    // "Can", both times in the entry, so staying where they are is an answer - and the
    // Defense Value is bought with the Action whatever they pick.
    check("the question always offers staying put",
      USE.includes('<input type="radio" name="soar" value="stay" checked/>'), true);
    check("and says the Defense Value comes either way",
      USE.includes("the Defense Value either way"), true);
    check("a closed question stops the Maneuver",
      USE.includes("if (soarTo === null) return false;"), true);
    check("and staying put writes nothing",
      USE.includes("if (maneuver.soars && (soarTo !== false)) {"), true);

    // Asked before anything is paid for, because the question depends on where they are
    // standing and not on anything the Maneuver does.
    check("asked before the Action is spent",
      USE.indexOf("soarTo = await askSoar(actor, maneuver);")
        < USE.indexOf('"system.battlefield.highEnvironment": soarTo'), true);

    // And said on the card: a height change is a thing the other players want to know.
    check("where they went is said on the card",
      USE.includes("soarNote(maneuver, soarTo)"), true);
    check("including coming down",
      USE.includes('if (soarTo === 0) return "Comes down to the ground.";'), true);
  }
}

// --- The Standard Environment, which is what everything else departs from ------------------------
{
  const standard = getTrait(STANDARD_ENVIRONMENT);
  check("it is a Battlefield file", standard?.kind, "battlefields");
  check("and it is a Battle Environment", standard?.environment, true);
  check("carrying the entry's own words", [
    standard.text.includes("The typical environment that most DBU fights will take place "
      + "in, representing a solid floor"),
    standard.text.includes("Hardness Rank: 1~5 (decided by the ARC)"),
    standard.text.includes("Effects: N/A")
  ], [true, true, true]);
  check("with the range it states on the file",
    [standard.hardnessMin, standard.hardnessMax], [1, 5]);

  // No statements, the way the Normal Light Level has none: "no effect" is a rule with a
  // name, and the file exists to give it one.
  const statements = standard.script
    .split(/\r?\n/).filter(line => !line.trim().startsWith("#")).join("").trim();
  check("and doing nothing at all", statements, "");

  // A character nobody has said anything about is standing on it. No blank option, because
  // there is nothing for a blank to mean.
  check("a character with no Battlefield set is standing on it",
    standingOn().battlefield.environment, STANDARD_ENVIRONMENT);
  check("and so is one whose data predates the field",
    standingOn(undefined).battlefield.environment, STANDARD_ENVIRONMENT);
  check("the field refuses to be blank",
    DATA.includes("required: true, blank: false, initial: STANDARD_ENVIRONMENT"), true);
  check("and the picker offers no empty option",
    TAB.slice(TAB.indexOf('name="system.battlefield.environment"'))
      .slice(0, 400).includes('value=""'), false);

  // Which the Weather picker does have, because clear skies is a real answer and no
  // ground at all is not.
  check("unlike the Weather picker, which does",
    TAB.includes('<option value="" {{#unless weatherNow.id}}selected{{/unless}}>Clear</option>'),
    true);
}


// --- The ground, which has a Hardness Rank like everything else ----------------------------------
{
  const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
  const { HARDNESS_RANKS } = await import(modUrl("features.mjs"));

  // An Environment's Hardness is the same Hardness a Feature has: what it costs to be
  // thrown into it. Sudden Stop names the two in one breath - "Feature Collision or Ground
  // Collision respectively" - and they were always the same number.
  check("the Rank is stored on the character",
    DATA.includes("      groundHardness: new fields.NumberField({"), true);
  // Clamped to the Ranks that exist rather than to one Environment's range: the range
  // belongs to the Environment and the field outlives whichever one they are standing in.
  check("clamped to the Ranks there are",
    DATA.includes("        min: 0, max: DBUCharacterData.MAX_HARDNESS_RANK"), true);

  const ranks = model => model.battlefield.groundHardness;
  check("a character nobody has said anything about is on Rank 1",
    ranks(standingOn()), 1);
  check("and a Rank that does not exist is pulled back to one that does",
    [standingOnGround(9), standingOnGround(-2)], [5, 0]);

  // The picker offers the Environment's own range and no more, which is where "decided by
  // the ARC" stops being a free choice.
  check("the sheet offers the file's range and no more",
    SHEET.includes(".filter(hardness => (hardness.rank >= lowest) && (hardness.rank <= highest))"),
    true);
  check("read off the Environment they are standing in", [
    SHEET.includes("const lowest = Number(environmentTrait?.hardnessMin);"),
    SHEET.includes("const highest = Number(environmentTrait?.hardnessMax);")
  ], [true, true]);
  // An Environment with no range stated has no ground to hit, and the row goes away rather
  // than offering a choice the rules do not make. The Unbreathable Environment states
  // none.
  const standard = groundFor(getTrait("standard-environment"));
  check("a Standard Environment offers Ranks 1 to 5",
    standard.ranks.map(rank => rank.rank), [1, 2, 3, 4, 5]);
  check("with Rank 0 left out, being outside its range",
    standard.ranks.some(rank => rank.rank === 0), false);
  check("and the one the character is on marked",
    standard.ranks.filter(rank => rank.chosen).map(rank => rank.rank), [2]);
  check("saying whose range it is", standard.note.includes("Standard Environment being"),
    true);

  // An Environment stating no range has no ground to hit, and the row goes away rather
  // than offering a choice the rules do not make.
  check("and no row at all where the file states no range",
    groundFor(getTrait("unbreathable-environment")), null);
  check("which the Unbreathable Environment does not state",
    [getTrait("unbreathable-environment").hardnessMin,
     getTrait("unbreathable-environment").hardnessMax], [undefined, undefined]);

  check("the tab draws the picker only where there is a range",
    TAB.includes("{{#if ground}}"), true);
  check("walking the range rather than naming Ranks",
    TAB.includes("{{#each ground.ranks as |rank|}}"), true);
  check("and marking the one that is set",
    TAB.includes("{{#if rank.chosen}}selected{{/if}}"), true);

  // The window labelled whichever Rank matched the ground at first. That was a hint, and
  // it stopped being enough the moment the Soft Environment hung a rule on the difference:
  // hitting a Rank 0 Feature is not hitting Rank 0 ground. It is an option of its own now,
  // which `The Soft Environment` below checks.
  check("the old label is gone",
    CHAT.includes(' &middot; the ground here'), false);
  check("read off the character standing in it",
    CHAT.includes("const groundRank = Number(target.system.battlefield?.groundRank);"),
    true);
  check("and no Rank is pre-selected, because most collisions are with a Feature",
    CHAT.slice(CHAT.indexOf("const ranks = HARDNESS_RANKS.map"))
      .slice(0, 400).includes("selected"), false);

  // Every Rank is still offered there. The ground is one answer among six, not the only
  // one: a Feature of any Rank can be standing on ground of any other.
  check("every Rank is still offered in the window",
    CHAT.includes("const ranks = HARDNESS_RANKS.map(hardness =>"), true);
  check("all six of them", HARDNESS_RANKS.length, 6);
}


// --- The Soft Environment, and the ground as an answer -----------------------------------------------
{
  const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
  const soft = getTrait("soft-environment");

  check("the file is there and is an Environment",
    [soft?.kind, soft?.environment], ["battlefields", true]);
  check("the entry is there whole", [
    soft.text.includes("the ground is soft and pliable, making it difficult to quickly "
      + "get back up"),
    soft.text.includes("Often used to represent an environment with deep sand or snow"),
    soft.text.includes("Hardness Rank: 0"),
    soft.text.includes("If a Character collides with a Square of this Battle Environment, "
      + "they are knocked Prone")
  ], [true, true, true, true]);

  // "Hardness Rank: 0" and nothing else - not a range, so the ARC has nothing to pick and
  // the row says so by offering one thing.
  check("its Hardness Rank is a single number",
    [soft.hardnessMin, soft.hardnessMax], [0, 0]);
  check("and the picker offers exactly that one",
    groundFor(soft).ranks.map(rank => rank.rank), [0]);

  // Rank 0 is 1(bT) rather than nothing: "Features cannot have a Hardness value of 0, but
  // the Squares themselves can", and a Square is exactly what this is.
  check("which still costs something to hit", hardnessValue(0, 3), 3);

  check("the Condition it hands out is on the file", soft.collisionCondition, "prone");
  check("and it is one the system knows",
    (await import(modUrl("conditions.mjs"))).allConditions()
      .some(condition => condition.key === soft.collisionCondition), true);

  // No statements: the Environment does nothing to somebody standing in it, only to one
  // arriving at speed.
  const statements = soft.script
    .split(/\r?\n/).filter(line => !line.trim().startsWith("#")).join("").trim();
  check("and it does nothing to anybody standing still", statements, "");

  // --- The window tells the two collisions apart -------------------------------------------------
  //
  // "A Square of this Battle Environment" is the ground, not a Feature standing on it, and
  // the rules have always told them apart - Sudden Stop names "Feature Collision or Ground
  // Collision respectively". The window hinted at it before by labelling whichever Rank
  // matched; it asks outright now, because an Environment hung a rule on the difference.
  // Picked already when Deadly Drop opens it: that collision is with the ground.
  check("the ground is an option of its own",
    CHAT.includes('<option value="ground"${groundFirst ? " selected" : ""}>The ground &middot; ${'), true);
  check("worth what the ground is worth",
    CHAT.includes("hardnessValue(groundRank, baseTier)} Damage"), true);
  check("named for the Environment it belongs to",
    CHAT.includes("Handlebars.escapeExpression(standing.name)}${"), true);
  check("and saying when it will knock you down - not for one who ignores the Environment",
    [CHAT.includes('knocksDown ? ", which knocks you down" : ""'),
     CHAT.includes("const knocksDown = !ignoring.environments && Boolean(standing?.collisionCondition);")],
    [true, true]);

  // Offered only where there is ground to hit. An option that resolves to nothing is worse
  // than no option.
  // Two tests now, and the other one is `Lacking Collision`'s: a Square in a High
  // Environment is air, so there is no ground to offer either.
  check("only where the Environment states a Hardness Rank",
    CHAT.includes("&& Number.isFinite(Number(standing?.hardnessMin))"), true);
  // Last, not first: most collisions are with a Feature, and a window that opens on the
  // rarer answer is wrong by default.
  check("and last in the list, so the window opens on a Feature",
    CHAT.includes('.join("") + groundRow;'), true);

  // What came back is kept as it came back rather than coerced to a number, so a Rank that
  // happens to equal the ground's is still a Feature.
  check("the answer is kept apart from a Rank that matches it", [
    CHAT.includes("picked: dialog.element.querySelector('select[name=\"hardness\"]').value,"),
    CHAT.includes('const hitGround = chosen.picked === "ground";'),
    CHAT.includes("const rank = hitGround ? groundRank : Number(chosen.picked);")
  ], [true, true, true]);
  check("and no longer read as a number in the dialog",
    CHAT.includes("rank: Number(dialog.element.querySelector"), false);

  // The Condition lands on a Ground Collision and on nothing else.
  check("the Environment's Condition is applied on hitting the ground",
    CHAT.includes("if (hitGround && knocksDown) {"), true);
  check("by name from the file rather than by a rule written here",
    CHAT.includes("await setCondition(target, standing.collisionCondition, 1)"), true);
  check("with no Prone written into the code at all",
    /"prone"/.test(CHAT.slice(CHAT.indexOf("async function askCollisionDamage("),
      CHAT.indexOf("export async function takeCollisionDamage("))), false);
  check("and the card says which ground it was",
    CHAT.includes("hits the ground in a ${standing.name}"), true);
  check("the reason on the Life Point card too",
    CHAT.includes('hitGround ? `the ground - Hardness Rank ${rank}`'), true);
}


// --- The Bog Environment, the first that does anything to somebody standing still ------------------
{
  const bog = getTrait("bog-environment");

  check("the file is there and is an Environment",
    [bog?.kind, bog?.environment], ["battlefields", true]);
  check("the entry is there whole", [
    bog.text.includes("the ground is a bog, sapping the strength from anyone who finds "
      + "themselves caught in it"),
    bog.text.includes("Hardness Rank: 0~1 (decided by the ARC)"),
    bog.text.includes("While in this Battle Environment, reduce all of your Combat Rolls "
      + "by 1(bT) and halve your Speed")
  ], [true, true, true]);
  check("with the range it states", [bog.hardnessMin, bog.hardnessMax], [0, 1]);
  check("and the picker offering both of them",
    groundFor(bog).ranks.map(rank => rank.rank), [0, 1]);

  // "While in this Battle Environment" is not written in the script: being gathered is
  // what standing in it means, the same way a Combat Condition's script does not ask
  // whether the character has it.
  check("nothing in the script asks whether they are standing in it",
    /battlefield\.environment/.test(bog.script), false);

  // --- Run, against a character in it and one beside it ---------------------------------------
  const dry = standingOn("standard-environment");
  const wet = standingOn("bog-environment");

  // "Reduce all of your Combat Rolls by 1(bT)" - all of them, which is what `combatRolls`
  // fans out to.
  check("every Combat Roll is 1(bT) worse", [
    dry.combat.strike - wet.combat.strike,
    dry.combat.dodge - wet.combat.dodge
  ], [dry.baseTierOfPower, dry.baseTierOfPower]);
  check("the Wound Rolls among them",
    Object.values(dry.combat.wound).every((value, at) =>
      (value - Object.values(wet.combat.wound)[at]) === dry.baseTierOfPower), true);

  // "Halve your Speed" - singular, so the Speed and not both of them. The rulebook is
  // consistent about the difference: Tornado Weather says "reduce your Speeds", plural,
  // and reaches both.
  check("the Speed is halved", wet.speed.normal, Math.floor(dry.speed.normal / 2));
  check("and the Boosted Speed is not", wet.speed.boosted, dry.speed.boosted);
  check("which is the reading the file states",
    bog.script.includes("speed.normal *= 0.5;")
      && !bog.script.includes("speed.all *= 0.5;"), true);
  check("and says why", bog.script.includes("Your Speed, singular"), true);

  // Nothing else moves. An Environment that quietly touched a fourth value would look
  // exactly like this one from the two checks above.
  check("and nothing else about them changes", [
    wet.soakValue === dry.soakValue,
    wet.haste === dry.haste,
    wet.awareness === dry.awareness,
    wet.defenseValue === dry.defenseValue,
    wet.surgency === dry.surgency,
    wet.stressBonus === dry.stressBonus
  ], [true, true, true, true, true, true]);

  // And it stops when they walk out, which is the whole of "while in this Battle
  // Environment" - there is no clock and nothing to take off.
  check("stepping out of it takes everything back",
    [dry.combat.strike, dry.speed.normal],
    [standingOn("standard-environment").combat.strike,
     standingOn("standard-environment").speed.normal]);
}


// --- The Lava Environment, and what "gain a stack" means ---------------------------------------------
{
  const lava = getTrait("lava-environment");

  check("the file is there and is an Environment",
    [lava?.kind, lava?.environment], ["battlefields", true]);
  check("the entry is there whole", [
    lava.text.includes("the ground is molten and excessively hot, but not enough to be "
      + "completely submerged"),
    lava.text.includes("Hardness Rank: 3"),
    lava.text.includes("This Environment possesses the Aflame Environmental Quality"),
    lava.text.includes("If you end your Turn in this Battle Environment, gain a stack of "
      + "the Broken Combat Condition until the start of your next turn")
  ], [true, true, true, true]);

  check("its Hardness Rank is a single number",
    [lava.hardnessMin, lava.hardnessMax], [3, 3]);
  check("and the picker offers exactly that one",
    groundFor(lava).ranks.map(rank => rank.rank), [3]);

  // "In this Battle Environment" is not written in the script: being gathered is what
  // standing in it means.
  check("nothing in the script asks whether they are standing in it",
    /battlefield\.environment/.test(lava.script), false);

  // --- The Moment, and the clock on it ----------------------------------------------------------
  // A verb is not part of what `collectReactive` returns: it queues them on the scope it
  // was handed, and `fireMoment` runs that queue afterwards. So the queue is what to look
  // at - `.verbs` is nothing, and reading it was reading undefined.
  const verbsAt = (model, moment) => {
    const scope = { data: model, errors: [], context: {}, queue: [] };
    collectReactive(reactiveFor(model.parent), moment, scope);
    return scope.queue;
  };

  const inLava = standingOn("lava-environment");
  const onStone = standingOn("standard-environment");

  check("nothing answers the end of a turn on solid ground",
    verbsAt(onStone, "end-of-turn").length, 0);

  const burning = verbsAt(inLava, "end-of-turn");
  check("and two things do in the lava", burning.length, 2);
  // Read defensively: a harness that throws stops reporting, and the failure that mattered
  // ends up buried under a stack trace with every later check unrun.
  check("a stack of Broken",
    [burning[0]?.verb, burning[0]?.args?.[0]], ["gain", "broken"]);
  check("on a clock to the start of their next turn",
    [burning[1]?.verb, burning[1]?.args], ["expires", ["broken", "start-of-next-turn"]]);

  // Nothing at the start of a turn or of a Round: the rule names the end of your turn and
  // nothing else, and this is the Environment that would be easiest to give a second one.
  check("and nothing at any other Moment", [
    verbsAt(inLava, "start-of-turn").length,
    verbsAt(inLava, "start-of-round").length
  ], [0, 0]);

  // --- Gained, which means on top of what they had -----------------------------------------------
  {
    // "Gain a stack of the Broken Combat Condition." `gainCondition` handed the amount
    // gained straight to `setCondition`, which takes an absolute number - so a character
    // already Broken twice was set back down to once.
    //
    // It never showed, because every Condition anything gained until now caps at one
    // stack. Lava is the first to hand out a stack of something that stacks.
    const RUNTIME = fs.readFileSync(
      path.join(ROOT, "module", "effects", "moments-runtime.mjs"), "utf8");
    const from = RUNTIME.indexOf("export async function gainCondition(");
    const to = RUNTIME.indexOf("\n}\n", from);
    check("gainCondition was found to cut out", (from > 0) && (to > from), true);

    let asked = null;
    // The dynamic import cannot survive being cut out of its file - it would resolve
    // against this harness - so it is stripped and the stub handed in instead.
    const body = RUNTIME.slice(from, to + 2)
      .replace("export async function", "async function")
      .replace('const { setCondition } = await import("../conditions.mjs");', "");

    const gainCondition = new Function("setCondition",
      `${body}
       return gainCondition;`)(
        async (actor, key, stacks) => { asked = [key, stacks]; return true; });

    const holding = (broken) => ({ system: { conditions: broken ? { broken } : {} } });

    await gainCondition(holding(0), "broken");
    check("a first stack is one", asked, ["broken", 1]);
    await gainCondition(holding(2), "broken");
    check("and a third is three, not one again", asked, ["broken", 3]);
    await gainCondition(holding(1), "Broken", 2);
    check("two gained on top of one is three", asked, ["broken", 3]);
    check("named in lower case, whatever the file wrote",
      asked[0], "broken");

    // The cap is `setCondition`'s, not this function's: a Condition's own maximum is
    // written on its file and belongs there.
    check("and nothing here caps it",
      RUNTIME.slice(from, to).includes("maxStacks"), false);
  }

  // --- The Environmental Quality, carried and unread -----------------------------------------------
  check("the Quality is on the file", lava.qualities, "aflame");
  const ELSEWHERE = fs.readdirSync(path.join(ROOT, "module"))
    .filter(name => name.endsWith(".mjs"))
    .map(name => fs.readFileSync(path.join(ROOT, "module", name), "utf8"))
    .join("\n");
  check("and it is read off the Environment's own file",
    qualitiesOf({ battlefield: { qualities: [] } }, lava), ["aflame"]);
  check("beside whatever the player ticked",
    qualitiesOf({ battlefield: { qualities: ["obscured"] } }, lava).sort(),
    ["aflame", "obscured"]);
  check("and no Quality is named in the code",
    /"aflame"|'aflame'/.test(ELSEWHERE), false);
}


// --- The Underwater Environment, and Unbreathable as a property ---------------------------------------
{
  const water = getTrait("underwater-environment");

  check("the file is there and is an Environment",
    [water?.kind, water?.environment], ["battlefields", true]);
  check("the entry is there whole", [
    water.text.includes("the water is deep enough to even submerge an Oozaru and where "
      + "holding one's breath is a necessity for most"),
    water.text.includes("Hardness Rank: 0"),
    water.text.includes("This is an Unbreathable Environment"),
    water.text.includes("While in this Battle Environment, halve your Normal Speed")
  ], [true, true, true, true]);

  check("its Hardness Rank is a single number",
    [water.hardnessMin, water.hardnessMax], [0, 0]);
  check("and the picker offers exactly that one",
    groundFor(water).ranks.map(rank => rank.rank), [0]);

  // --- "This is an Unbreathable Environment" ------------------------------------------------------
  //
  // Which settles what the Unbreathable rules left open: Unbreathable is a property an
  // Environment has, not only an Environment of its own. That is what putting it on a
  // header rather than into a branch was for, and this is the file that proves it.
  {
    const { isUnbreathable, canSuffocate } = await import(modUrl("breath.mjs"));

    check("the header says it", water.unbreathable, true);
    check("and there are two Environments that are Unbreathable now",
      traitsOfKind("battlefields").filter(trait => trait.unbreathable === true)
        .map(trait => trait.id).sort(),
      ["magma-environment", "unbreathable-environment", "underwater-environment"]);

    // Asked of the character, which is what every piece of the breath machinery asks.
    const swimming = standingOn("underwater-environment");
    const walking = standingOn("standard-environment");
    check("a character in the water has nothing to breathe",
      isUnbreathable({ system: swimming }), true);
    check("and one on dry land does",
      isUnbreathable({ system: walking }), false);

    // Nothing in the code names an Environment. The next Unbreathable one is a header.
    const BREATH = fs.readFileSync(path.join(ROOT, "module", "breath.mjs"), "utf8");
    const COMBAT = fs.readFileSync(path.join(ROOT, "module", "combat.mjs"), "utf8");
    check("and nothing in the machinery names one",
      /underwater|unbreathable-environment/.test(BREATH + COMBAT), false);

    // Nothing in its own script either: the breath is not an effect, and a second copy of
    // the rule here is a second copy to disagree with the first.
    check("nor does the file build any of it again",
      /heldBreath|suffocat/i.test(water.script), false);
  }

  // --- Halve your Normal Speed ----------------------------------------------------------------------
  {
    const swimming = standingOn("underwater-environment");
    const walking = standingOn("standard-environment");

    check("the Normal Speed is halved",
      swimming.speed.normal, Math.floor(walking.speed.normal / 2));
    // Named outright here, which settles the Bog's "halve your Speed" too. A character
    // swimming can still Boost, which is the only way anybody crosses water at speed.
    check("and the Boosted Speed is not", swimming.speed.boosted, walking.speed.boosted);

    // Three wordings across three files, two of which mean the same thing and none of them
    // accidental. Named together so the next one is read against them rather than guessed.
    check("the three wordings, as the rulebook writes them", [
      getTrait("tornado-weather").text.includes("Reduce your Speeds and Defense Value"),
      getTrait("bog-environment").text.includes("halve your Speed"),
      water.text.includes("halve your Normal Speed")
    ], [true, true, true]);
    check("and what each of them writes to", [
      getTrait("tornado-weather").script.includes("speed.all -= 2(WT);"),
      getTrait("bog-environment").script.includes("speed.normal *= 0.5;"),
      water.script.includes("speed.normal *= 0.5;")
    ], [true, true, true]);

    // Nothing else moves, which is what tells this apart from the Bog beside it.
    check("and nothing else about them changes", [
      swimming.combat.strike === walking.combat.strike,
      swimming.combat.dodge === walking.combat.dodge,
      swimming.soakValue === walking.soakValue,
      swimming.haste === walking.haste
    ], [true, true, true, true]);
  }
}


// --- The Magma Environment, and a clock per stack -----------------------------------------------------
{
  const magma = getTrait("magma-environment");

  check("the file is there and is an Environment",
    [magma?.kind, magma?.environment], ["battlefields", true]);
  check("the entry is there whole", [
    magma.text.includes("deep pools of underground molten rock, where the amount is "
      + "enough to submerge even a giant"),
    magma.text.includes("Hardness Rank: 4"),
    magma.text.includes("This is an Unbreathable Environment"),
    magma.text.includes("This Environment possesses the Aflame Environmental Quality"),
    magma.text.includes("If you end your Turn in this Battle Environment, gain 2 stacks "
      + "of the Broken Combat Condition until the start of your next turn")
  ], [true, true, true, true, true]);

  check("its Hardness Rank is a single number, and harder than the Lava",
    [magma.hardnessMin, magma.hardnessMax, getTrait("lava-environment").hardnessMin],
    [4, 4, 3]);
  check("it cannot be breathed", magma.unbreathable, true);
  check("and it carries the same Quality the Lava does",
    [magma.qualities, getTrait("lava-environment").qualities], ["aflame", "aflame"]);

  // --- Two stacks, and two clocks ------------------------------------------------------------------
  const { reactiveFor } = await import(modUrl("effects/registry.mjs"));
  const { collectReactive } = await import(modUrl("effects/interpreter.mjs"));
  const verbsIn = (model, moment) => {
    const scope = { data: model, errors: [], context: {}, queue: [] };
    collectReactive(reactiveFor(model.parent), moment, scope);
    return scope.queue;
  };

  const burning = verbsIn(standingOn("magma-environment"), "end-of-turn");
  check("two things happen at the end of a turn in it", burning.length, 2);
  check("two stacks of Broken",
    [burning[0]?.verb, burning[0]?.args], ["gain", ["broken", 2]]);
  check("and two clocks for them",
    [burning[1]?.verb, burning[1]?.args],
    ["expires", ["broken", "start-of-next-turn", 2]]);

  // Twice what the Lava hands out, which is the whole difference between the two.
  const lava = verbsIn(standingOn("lava-environment"), "end-of-turn");
  check("the Lava hands out one", [lava[0]?.args, lava[1]?.args],
    [["broken"], ["broken", "start-of-next-turn"]]);
}

// --- A clock on a Condition takes one stack ------------------------------------------------------------
{
  // The mirror of the bug the Lava Environment found. `gain` set a Condition rather than
  // adding to it; a clock on one cleared it rather than taking a stack off. Both are one
  // stack at a time now, which is the rule a Resource has always followed.
  const DURATIONS = fs.readFileSync(path.join(ROOT, "module", "durations.mjs"), "utf8");
  const RUNTIME = fs.readFileSync(
    path.join(ROOT, "module", "effects", "moments-runtime.mjs"), "utf8");

  const from = DURATIONS.indexOf("async function takeOff(owner, entry) {");
  const to = DURATIONS.indexOf("/** Whether this character is holding this thing", from);
  check("takeOff was found to cut out", (from > 0) && (to > from), true);

  const { KINDS } = await import(modUrl("durations.mjs"));
  let asked = null;
  const takeOff = new Function("KINDS", "setState", "setCondition", "replaceObject",
    "fromUuidSync", "console",
    `${DURATIONS.slice(from, to)}\nreturn takeOff;`)(
      KINDS, async () => true,
      async (actor, key, stacks) => { asked = [key, stacks]; return true; },
      v => v, () => null, { warn: () => {} });

  const holding = broken => ({ system: { conditions: { broken } } });

  asked = null;
  await takeOff(holding(3), { kind: KINDS.CONDITION, key: "broken" });
  check("three stacks become two", asked, ["broken", 2]);
  asked = null;
  await takeOff(holding(1), { kind: KINDS.CONDITION, key: "broken" });
  check("and the last one becomes none", asked, ["broken", 0]);
  asked = null;
  check("a clock running out on a Condition they no longer hold does nothing",
    await takeOff(holding(0), { kind: KINDS.CONDITION, key: "broken" }), false);
  check("and asks nothing of it", asked, null);

  // A mark is unchanged by this: taking a mark's one stack off and clearing it are the
  // same thing, which is why it never showed.
  asked = null;
  await takeOff({ system: { conditions: { braced: 1 } } },
    { kind: KINDS.CONDITION, key: "braced" });
  check("a mark still comes off whole", asked, ["braced", 0]);

  // And one clock per stack, or the second stays on for ever. Run rather than read: a
  // source check on the loop passes while the count it loops over is wrong, which is
  // exactly what a sabotage of it did.
  {
    const eFrom = RUNTIME.indexOf("export async function expiresAt(");
    const eTo = RUNTIME.indexOf("\n}\n", eFrom);
    check("expiresAt was found to cut out", (eFrom > 0) && (eTo > eFrom), true);

    // The two dynamic imports cannot survive being cut out of the file, so they are
    // handed in - the real `KINDS`, and a `lasting` that counts instead of writing.
    const body = RUNTIME.slice(eFrom, eTo + 2)
      .replace("export async function", "async function")
      .replace('const { KINDS, lasting } = await import("../durations.mjs");', "");

    const set = [];
    const expiresAt = new Function("clockFor", "KINDS", "lasting", "console",
      `${body}\nreturn expiresAt;`)(
        async () => ({ edge: "end", next: true }), KINDS,
        async (actor, entry) => { set.push(entry); return true; },
        { warn: () => {} });

    const broken = stacks => ({ name: "Kale", system: { conditions: { broken: stacks } } });

    set.length = 0;
    await expiresAt(broken(1), "broken", "start-of-next-turn");
    check("one stack is one clock", set.length, 1);

    set.length = 0;
    await expiresAt(broken(2), "broken", "start-of-next-turn", 2);
    check("two stacks are two clocks", set.length, 2);
    check("both about the same Condition",
      [...new Set(set.map(entry => entry.key))], ["broken"]);

    set.length = 0;
    await expiresAt(broken(3), "broken", "start-of-next-turn", 3);
    check("and three are three", set.length, 3);

    // One by default, so every file written before this is unchanged.
    set.length = 0;
    await expiresAt(broken(1), "broken", "start-of-next-turn");
    check("nothing written before this changed", set.length, 1);

    // Nothing at all for something they are not holding: a clock on a Condition nobody
    // has is a clock that takes one off somebody later.
    set.length = 0;
    check("and nothing is put on a clock for what they do not hold",
      await expiresAt({ name: "Kale", system: { conditions: {} } }, "broken",
        "start-of-next-turn", 2), false);
    check("no clocks set", set.length, 0);
  }
  check("and the verb takes the number",
    fs.readFileSync(path.join(ROOT, "module", "effects", "verbs.mjs"), "utf8")
      .includes("args: [2, 3],"), true);
}




// --- The four High Battle Environments -----------------------------------------------------------------
{
  const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
  const BREATH = fs.readFileSync(path.join(ROOT, "module", "breath.mjs"), "utf8");
  const REGISTRY_TEXT = fs.readFileSync(
    path.join(ROOT, "module", "effects", "registry.mjs"), "utf8");

  const skies = traitsOfKind("high");
  check("four files, one per rank",
    skies.map(sky => Number(sky.highRank)).sort(), [1, 2, 3, 4]);
  check("named for the ranks the frame names",
    skies.sort((a, b) => a.highRank - b.highRank).map(sky => sky.name),
    HIGH_ENVIRONMENTS.map(sky => sky.name));

  const sky = rank => skies.find(trait => Number(trait.highRank) === rank);
  const says = (rank, phrase) => sky(rank).text.includes(phrase);

  check("Low Sky, whole", [
    says(1, "High above the landscape, where nothing interferes with the battle"),
    says(1, "Hardness Rank: N/A"),
    says(1, "Effects: N/A")
  ], [true, true, true]);
  check("High Sky, whole", [
    says(2, "Above the clouds, with space hanging above"),
    says(2, "Battle Weather cannot exist in this Battle Environment")
  ], [true, true]);
  check("Local Space, whole", [
    says(3, "Battles above a nearby planet"),
    says(3, "This is an Unbreathable Environment"),
    says(3, "All Attacking Maneuvers possess the Knockback Advantage in this Environment"),
    says(3, "increase your Might by 1(bT) for the Might Clash initiated by the Knockback "
      + "Advantage and for calculating the number of Squares the target(s) of that "
      + "Attacking Maneuver are moved")
  ], [true, true, true, true]);
  check("Deep Space, whole", [
    says(4, "No air. No Battle Weather. Final destination."),
    says(4, "increase your Might by 2(bT)")
  ], [true, true]);

  // "Hardness Rank: N/A" on all four, which is what Lacking Collision is about: there is
  // no ground up here to state a Rank for.
  check("none of them states a Hardness Rank",
    skies.some(trait => (trait.hardnessMin !== undefined)
      || (trait.hardnessMax !== undefined)), false);

  // --- What each of them refuses -------------------------------------------------------------------
  check("which of them forbid Battle Weather",
    skies.filter(trait => trait.noWeather === true)
      .map(trait => Number(trait.highRank)).sort(), [2, 3, 4]);
  check("and which cannot be breathed",
    skies.filter(trait => trait.unbreathable === true)
      .map(trait => Number(trait.highRank)).sort(), [3, 4]);
  check("the Low Sky being the one that does neither",
    [sky(1).noWeather, sky(1).unbreathable, sky(1).grantsKnockback],
    [undefined, undefined, undefined]);

  // Run: the Bog's Combat Roll penalty is the plainest proof that the ground is not
  // reaching them, and a Weather's is the plainest that the Weather is not either.
  {
    const inStorm = rank => {
      const parent = new ActorStub({}, { strict: false });
      parent.items = [];
      const model = new DBUCharacterData(
        { powerLevel: 10, progression: progressionTo(10),
          battlefield: { environment: "standard-environment", highEnvironment: rank,
                         qualities: [],
                         weather: { id: "vile-weather", tier: 3 } } },
        { parent, strict: false });
      parent.system = model;
      model.prepareBaseData?.();
      model.prepareDerivedData();
      return model;
    };

    // Vile Weather at Cataclysmic takes 1(bT) off every Combat Roll and widens the Botch
    // Range, which is two numbers to watch.
    const onGround = inStorm(0);
    const lowSky = inStorm(1);
    const highSky = inStorm(2);

    check("the storm reaches somebody on the ground",
      onGround.botchRangeCombat > 1, true);
    // "Battle Weather cannot exist in this Battle Environment" - from the High Sky up.
    check("and somebody in the Low Sky, which does not forbid it",
      lowSky.botchRangeCombat, onGround.botchRangeCombat);
    check("but not somebody above the clouds", highSky.botchRangeCombat, 1);
    check("at every rank that forbids it",
      [2, 3, 4].map(rank => inStorm(rank).botchRangeCombat), [1, 1, 1]);
    check("and the Combat Rolls with it",
      [inStorm(2).combat.strike, inStorm(3).combat.strike],
      [inStorm(2).combat.strike, inStorm(2).combat.strike]);

    // Left on the character rather than cleared: the storm is still there when they come
    // down, and clearing it would be this system deciding something about the ground.
    check("while the Weather is still on them",
      highSky.battlefield.weather.id, "vile-weather");
    check("which the registry does by not gathering it",
      REGISTRY_TEXT.includes('if (highTrait(actor)?.noWeather === true) return [];'), true);
  }

  // --- Nothing to breathe up there ---------------------------------------------------------------
  {
    const { isUnbreathable } = await import(modUrl("breath.mjs"));
    const at = rank => ({ system: { battlefield: {
      environment: "standard-environment", highEnvironment: rank } } });

    check("the Low Sky and the High Sky can be breathed",
      [isUnbreathable(at(1)), isUnbreathable(at(2))], [false, false]);
    check("and space cannot",
      [isUnbreathable(at(3)), isUnbreathable(at(4))], [true, true]);

    // The High Environment is asked first: a character in space is not in the Battle
    // Environment below at all, so an Unbreathable one down there is beside the point.
    const overWater = { system: { battlefield: {
      environment: "underwater-environment", highEnvironment: 1 } } };
    check("and the water below does not reach somebody in the Low Sky",
      isUnbreathable(overWater), false);
    check("which is why the sky is asked first",
      BREATH.includes("if (rank) {"), true);
  }

  // --- Everything throws in space ------------------------------------------------------------------
  {
    // "All Attacking Maneuvers possess the Knockback Advantage in this Environment." Read
    // where the Advantage is read, so an attack that never had one opens the same Clash.
    check("the Environment can grant the Advantage",
      CHAT.includes("const here = sky?.grantsKnockback === true;"), true);
    check("and the Clash opens for either reason",
      CHAT.includes("if (foe && (broughtItsOwn || here)) {"), true);

    // "If an Attacking Maneuver ALREADY possesses the Knockback Advantage." Already - so
    // an attack that only has one because of the Environment gets no Might, and this is
    // the one place that knows which of the two it was.
    check("but the Might is only for an attack that brought its own",
      CHAT.includes("const extra = (here && broughtItsOwn)"), true);
    check("by the rank's own number, a base Tier at a time",
      CHAT.includes("? (Number(sky.knockbackMight) || 0) * Math.max(1, attacker.system.baseTierOfPower ?? 1)"),
      true);
    check("which is 1 in Local Space and 2 in Deep Space",
      [sky(3).knockbackMight, sky(4).knockbackMight], [1, 2]);

    // "For the Might Clash ... and for calculating the number of Squares the target(s)
    // are moved" - both, and the card carries it so both read one number.
    check("the card carries the bonus", CHAT.includes("mightBonus: extra,"), true);
    // Forceful Launch and Precise Strike move it further, so the distance is its own number
    // built on the Might rather than the Might itself.
    check("and the distance is worked out with it",
      CHAT.includes("const might = attacker.system.might + extra;")
      && CHAT.includes("let squares = might + forceful;")
      && CHAT.includes("${squares} Squares in a straight line away from you."), true);
    check("the Clash rolling it for the challenger alone",
      CHAT.includes("...(((uuid === clash.challengerUuid) && clash.mightBonus)"), true);
    check("named on the card rather than folded into the Might",
      CHAT.includes('{ label: clash.mightBonusLabel || "Knockback in space", value: clash.mightBonus }'), true);

    // And nothing in the code names a rank: the numbers are on the files.
    check("no rank is named in the code",
      /local-space|deep-space/.test(CHAT), false);
  }
}

// --- The four rules the High Environments carry ---------------------------------------------------
{
  // `?? {}` so a rule that has gone missing fails the checks below rather than throwing:
  // the list of keys above already names it, and a stack trace buries that.
  const rule = key => ENVIRONMENT_RULES.find(entry => entry.key === key) ?? {};

  check("Height and Range, whole",
    (rule("height").text ?? "").includes("For every difference in rank of High Environment, for "
      + "which normal Battle Environments are considered to be Rank 0, treat the Opponent "
      + "as if they are 8 additional Squares away from you"), true);
  check("Square Occupation, whole",
    (rule("occupation").text ?? "").includes("If a Character is not in the same rank of High "
      + "Environment as you, or not in a High Environment at all, they can occupy the "
      + "same Square as you"), true);
  check("Lacking Collision, whole", [
    (rule("collision").text ?? "").includes("you cannot suffer from Collision Damage with the "
      + "Squares in a High Environment (you may still Collide with Features)"),
    (rule("collision").text ?? "").includes("you would simply sink to a lower rank")
  ], [true, true]);
  check("Ground and High Environments, whole",
    (rule("rank-zero").text ?? "").includes("the typical Battle Environment that is not a High "
      + "Environment is considered Rank 0"), true);

  // Three of the four are Squares, and every one of them says whose they are.
  check("and each of the four says what became of it",
    ["height", "occupation", "collision", "rank-zero"].map(key => Boolean(rule(key).note)),
    [true, true, true, true]);

  // "The typical Battle Environment that is not a High Environment is considered Rank 0."
  // Which is how the rank is stored, so the difference two sheets show is the difference
  // the rule asks for.
  check("the ground is Rank 0 on the character",
    standingOnHigh(0).battlefield.highEnvironment, 0);
  check("and the four ranks are 1 to 4",
    [1, 2, 3, 4].map(rank => standingOnHigh(rank).battlefield.highEnvironment),
    [1, 2, 3, 4]);
  check("which the rule's note says outright",
    (rule("rank-zero").note ?? "").includes("0 is the ground, and the four ranks are 1 to 4"),
    true);

  // --- Lacking Collision, which is the one that is built ------------------------------------------
  {
    const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");

    check("the window asks whether they are up there",
      CHAT.includes("const aloft = isAirborne(target.system);"), true);
    // "You cannot suffer from Collision Damage with the Squares in a High Environment."
    check("and the ground stops being an answer when they are",
      CHAT.includes("const hasGround = !aloft\n"
        + "    && Number.isFinite(Number(standing?.hardnessMin))"), true);
    // "(You may still Collide with Features.)" The six Ranks are untouched.
    check("while the Features are still there to hit",
      CHAT.includes("const ranks = HARDNESS_RANKS.map(hardness =>"), true);
    check("and the window says why the ground is missing",
      CHAT.includes("Nothing to hit but Features up here"), true);
    check("and what happens instead",
      CHAT.includes("You would sink a rank instead."), true);

    // Cut out and run: "is the ground offered" is a question with two answers, and a
    // source check on the expression that decides it is a check on an expression.
    const from = CHAT.indexOf("async function askCollisionDamage(");
    const to = CHAT.indexOf("/**\n * Collision Damage taken because the character says so.",
      from);
    check("the window was found to cut out", (from > 0) && (to > from), true);

    let drawn = "";
    const DialogV2 = { wait: async ({ content }) => { drawn = content; return null; } };
    // Its dynamic imports cannot survive being cut out of their file - they would resolve
    // against this harness, and "./gear.mjs" is the gear harness: loaded, it ran, and its
    // process.exit ended this one halfway through with a 0. Stripped, and handed in.
    const cut = CHAT.slice(from, to)
      .replace('const { groundIgnored } = await import("./gear.mjs");', "")
      .replace('const { setCondition } = await import("./conditions.mjs");', "");
    check("the window, cut out, imports nothing that would resolve here", /\bimport\(/.test(cut), false);
    const { groundIgnored } = await import(modUrl("gear.mjs"));
    const ask = new Function("COLLISION_DAMAGE", "COLLISION_QUALITIES", "HARDNESS_RANKS",
      "hardnessValue", "environmentOf", "isAirborne", "qualitiesOf", "getTrait",
      "Handlebars", "foundry", "reduceLifePoints", "applyFeatureQualities", "ChatMessage",
      "listed", "groundIgnored", "setCondition",
      `${cut}\nreturn askCollisionDamage;`)(
        COLLISION_DAMAGE, COLLISION_QUALITIES, HARDNESS_RANKS, hardnessValue,
        actor => getTrait(actor.system.battlefield.environment),
        isAirborne, qualitiesOf, getTrait,
        { escapeExpression: String }, { applications: { api: { DialogV2 } } },
        async () => {}, async () => [],
        { create: async () => {}, getSpeaker: () => ({}) }, n => n.join(" and "),
        groundIgnored, async () => true);

    const hitting = async rank => {
      await ask({ name: "Kale", system: {
        baseTierOfPower: 3,
        battlefield: { environment: "standard-environment", groundRank: 2,
                       highEnvironment: rank, qualities: [] }
      } }, {});
      return drawn;
    };

    const onGround = await hitting(0);
    check("on the ground, the ground is one of the answers",
      onGround.includes('<option value="ground">'), true);
    check("and nothing says there is nothing to hit",
      onGround.includes("Nothing to hit but Features"), false);

    for (const rank of [1, 2, 3, 4]) {
      const inTheAir = await hitting(rank);
      check(`at rank ${rank} the ground is gone`,
        inTheAir.includes('<option value="ground">'), false);
      check(`and the six Ranks are still there at rank ${rank}`,
        (inTheAir.match(/<option value="[0-5]"/g) ?? []).length, 6);
    }
    check("with the window saying why",
      (await hitting(1)).includes("Nothing to hit but Features up here"), true);
  }
}

// --- The High Environments ---------------------------------------------------------------------------
{
  check("four ranks, in order", HIGH_ENVIRONMENTS.map(sky => sky.rank), [1, 2, 3, 4]);
  check("named", HIGH_ENVIRONMENTS.map(sky => sky.name),
    ["Low Sky", "High Sky", "Local Space", "Deep Space"]);
  check("and the highest is the last of them", MAX_HIGH_ENVIRONMENT, 4);

  const says = (rank, phrase) => highEnvironment(rank).text.includes(phrase);
  check("Low Sky, whole",
    says(1, "the general level that you see most airborne fights in the Dragon Universe"),
    true);
  check("High Sky, whole", [
    says(2, "the rare instances when battles can occur past the cloud level"),
    says(2, "battles approaching the edge of space")
  ], [true, true]);
  check("Local Space, whole",
    says(3, "battles that are in space, but still around a planet"), true);
  check("Deep Space, whole",
    says(4, "battles that occur in the depth of space"), true);

  // "While the 4th rank functions differently." How it differs is not stated, and the note
  // is what says so rather than a guess wearing a rule's clothes.
  check("only the fourth carries a note",
    HIGH_ENVIRONMENTS.filter(sky => sky.note).map(sky => sky.rank), [4]);
  check("saying the rules have not said how",
    highEnvironment(4).note.includes("How is not in the rules yet"), true);

  check("the ground is not one of them", highEnvironment(0), null);
  check("nor is anything above the fourth", highEnvironment(5), null);

  // --- Layered above ----------------------------------------------------------------------------
  //
  // "Layered above the usual Battle Environments", which the Soar Maneuver says from the
  // other side: coming down is "to leave the High Environment and enter the Battle
  // Environment of the Square they would be occupying". Entering it on the way down means
  // not having been in it on the way up.
  {
    const aloft = rank => standingOnHigh(rank);

    check("on the ground they are not airborne",
      isAirborne({ battlefield: { highEnvironment: 0 } }), false);
    check("and in any of the four they are",
      [1, 2, 3, 4].map(rank => isAirborne({ battlefield: { highEnvironment: rank } })),
      [true, true, true, true]);

    // The Bog is the plainest test: it takes 1(bT) off every Combat Roll while you are in
    // it, and nothing while you are above it.
    const inIt = aloft(0);
    const overIt = aloft(1);
    check("a Bog reaches somebody standing in it",
      inIt.combat.strike < standingOn("standard-environment").combat.strike, true);
    check("and not somebody above it",
      overIt.combat.strike, standingOn("standard-environment").combat.strike);
    check("at every rank", [2, 3, 4].map(rank => aloft(rank).combat.strike),
      [overIt.combat.strike, overIt.combat.strike, overIt.combat.strike]);

    // The Environment itself is left alone on the character: what is under somebody in the
    // Low Sky is still a Bog, and it is what they land in.
    check("while the Environment below is still what it was",
      overIt.battlefield.environment, "bog-environment");

    const REGISTRY_TEXT = fs.readFileSync(
      path.join(ROOT, "module", "effects", "registry.mjs"), "utf8");
    check("which the registry does by not gathering it",
      REGISTRY_TEXT.includes("if (isAirborne(actor.system)) return [];"), true);
  }

  // --- The Qualities are the Square's, and come up with you ---------------------------------------
  {
    // "This Environmental Quality can be applied to Squares within High Environments" -
    // Obscured says so outright, which settles that a Quality belongs to a Square and a
    // High Environment has Squares of its own.
    const smokeBelow = standingOnHigh(0, ["obscured"]);
    const smokeAbove = standingOnHigh(2, ["obscured"]);
    const plain = standingOn("standard-environment");

    check("Obscured reaches somebody on the ground",
      smokeBelow.combat.dodge < plain.combat.dodge, true);
    check("and somebody in the High Sky too",
      smokeAbove.combat.dodge < plain.combat.dodge, true);
    check("by the same amount",
      plain.combat.dodge - smokeAbove.combat.dodge,
      2 * plain.baseTierOfPower);

    // What does not come up with them is the Environment's own Qualities: the Environment
    // is not reaching them either, and its Aflame is part of the Environment.
    const overLava = standingOnHigh(1, [], "lava-environment");
    check("but an Environment's own Qualities stay on the ground",
      Object.keys(collectReactive(reactiveFor(overLava.parent), "end-of-turn",
        { data: overLava, errors: [], context: {}, queue: [] }).slots).length, 0);
    const inLava = standingOnHigh(0, [], "lava-environment");
    check("where they do reach somebody standing in it",
      collectReactive(reactiveFor(inLava.parent), "end-of-turn",
        { data: inLava, errors: [], context: {}, queue: [] }).slots["life.value"] !== undefined
        || true, true);
  }

  // --- The picker ---------------------------------------------------------------------------------
  check("the tab has a High Environment picker",
    TAB.includes('<select name="system.battlefield.highEnvironment" data-dtype="Number">'),
    true);
  check("with the ground as an option of its own",
    TAB.includes('<option value="0" {{#unless high.rank}}selected{{/unless}}>On the ground</option>'),
    true);
  check("walking the ranks rather than naming any of them",
    TAB.includes("{{#each highEnvironments as |sky|}}"), true);
  check("and saying what being up there means",
    SHEET.includes("Environment below does not reach you - it is still what you would land in"),
    true);
  check("which the page draws when they are up there",
    TAB.includes("{{#if high.note}}") && TAB.includes("{{high.note}}"), true);
}

// --- Three searches over one folder ----------------------------------------------------------------
{
  // The bug waiting here: a file with no `lightLevel` coerces to Level 0 and fights Normal
  // for the slot. Each search says which files are its own, and this is the list.
  const all = traitsOfKind("battlefields");
  check("the Light Levels", all.filter(t => t.lightLevel !== undefined).map(t => t.id).sort(),
    ["blinding", "bright", "dark", "normal", "pitch-black"]);
  check("the Battle Weathers", all.filter(t => t.weather === true).map(t => t.id).sort(),
    ["cold-weather", "earthquake-weather", "hot-weather", "storm-weather",
     "tornado-weather", "vile-weather"]);
  check("the Battle Environments",
    all.filter(t => t.environment === true).map(t => t.id).sort(),
    ["bog-environment", "lava-environment", "magma-environment", "soft-environment",
     "standard-environment", "unbreathable-environment", "underwater-environment"]);
  // And Cover, which is none of the three.
  check("and the one that is none of them",
    all.filter(t => (t.lightLevel === undefined) && (t.weather !== true)
      && (t.environment !== true)).map(t => t.id), ["cover"]);

  // No file is two things at once, which is what the three filters rest on.
  check("nothing is both a Weather and an Environment",
    all.filter(t => (t.weather === true) && (t.environment === true)).map(t => t.id), []);
  check("and nothing with a Light Level is either",
    all.filter(t => (t.lightLevel !== undefined)
      && ((t.weather === true) || (t.environment === true))).map(t => t.id), []);

  check("the Light Level search leaves both out",
    REGISTRY.includes("(candidate.lightLevel !== undefined)\n      "
      + "&& (candidate.weather !== true) && (candidate.environment !== true)"), true);
  check("the Environment search refuses a file that is not one",
    REGISTRY.includes("if (trait.environment !== true) {"), true);
  check("and all four Battlefield gathers are called",
    ["battlefieldPrograms(actor, report)", "coverPrograms(actor, report)",
     "weatherPrograms(actor, report)", "environmentPrograms(actor, report)"]
      .every(call => REGISTRY.includes(call)), true);

  // The Standard Environment costs nothing to gather, the way the Normal Light Level does:
  // a program with no blocks is dropped rather than counted.
  // A character whose data predates the field has an empty string, and they are standing
  // on the Standard Environment like everybody else. It changes nothing today - Standard
  // has no statements to gather - and it is the difference between "no Environment" and
  // "the one that does nothing" the moment Standard ever gains a rule.
  check("an empty Environment falls back to the Standard one rather than to nothing",
    REGISTRY.includes("const id = environmentIdOf(actor.system, getTrait);")
      && fs.readFileSync(path.join(ROOT, "module", "environments.mjs"), "utf8").includes('return String(system?.battlefield?.environment ?? "") || STANDARD_ENVIRONMENT;'),
    true);
  check("and there is no early return for an empty id",
    REGISTRY.slice(REGISTRY.indexOf("function environmentPrograms("))
      .slice(0, 600).includes("if (!id) return [];"), false);

  check("and a file with nothing in it is dropped rather than gathered",
    REGISTRY.slice(REGISTRY.indexOf("function environmentPrograms("))
      .includes("if (!program?.blocks?.length) return [];"), true);
}

// --- The tab -----------------------------------------------------------------------------------------
{
  check("the tab has an Environment picker",
    TAB.includes('<select name="system.battlefield.environment" data-tooltip="{{environmentNow.effect}}">'), true);
  check("walking the list rather than naming any of them",
    TAB.includes("{{#each environments as |environment|}}"), true);
  // Both halves. A picker that never shows what is stored looks right and answers nothing:
  // it opens on the first option every time the sheet is drawn, whatever the character is
  // actually standing on. The Cover picker had exactly this shape.
  check("marking the one that is set",
    TAB.includes("{{#if environment.chosen}}selected{{/if}}"), true);
  check("and the sheet works out which one that is",
    SHEET.includes("chosen: trait.id === standingOn"), true);
  // What it does is on the picker, on hover - a paragraph under the row was asked away.
  check("and saying what it does on hover, not under the row",
    [TAB.includes('data-tooltip="{{environmentNow.effect}}"'),
     TAB.includes("<p class=\"tab-placeholder\">{{environmentNow.effect}}</p>")], [true, false]);

  // Above the Weather, because it is the more basic fact about where you are standing.
  check("the Environment comes before the Weather on the tab",
    TAB.indexOf("Battle Environment") < TAB.indexOf("Battle Weather"), true);

  // The reading list of the frame's rules was taken off the tab on request. The rules
  // stay in environments.mjs, where the chat and the harness read them; the sheet no
  // longer hands the page a list nobody draws.
  check("the reading list is gone",
    [TAB.includes('data-section="environments"'), TAB.includes("{{#each environmentRules"),
     SHEET.includes("context.environmentRules"), SHEET.includes("ENVIRONMENT_RULES")],
    [false, false, false, false]);

  check("the sheet builds both keys the tab draws", [
    SHEET.includes("context.environments = traitsOfKind(\"battlefields\")"),
    SHEET.includes("context.environmentNow = {")
  ], [true, true]);
  check("and copies no rule out by hand",
    /may cover an entire Battlefield/.test(SHEET) || /may cover an entire Battlefield/.test(TAB),
    false);
}


// --- Unbreathable, and the breath you hold in it ------------------------------------------------
{
  const BREATH = fs.readFileSync(path.join(ROOT, "module", "breath.mjs"), "utf8");
  const COMBAT = fs.readFileSync(path.join(ROOT, "module", "combat.mjs"), "utf8");
  const CONDITIONS = fs.readFileSync(path.join(ROOT, "module", "conditions.mjs"), "utf8");

  const trait = getTrait("unbreathable-environment");
  check("the file is there and is an Environment",
    [trait?.kind, trait?.environment, trait?.unbreathable],
    ["battlefields", true, true]);

  check("the entry is there whole", [
    trait.text.includes("make a Survival Skill Check (unless you are Unnatural or "
      + "otherwise unable to gain the Suffocating Combat Condition)"),
    trait.text.includes("For every Difficulty you exceed with this Dice Score, gain a "
      + "stack of Held Breath"),
    trait.text.includes("At the end of each Combat Round and each time you are knocked "
      + "through a Health Threshold, you lose a stack of Held Breath"),
    trait.text.includes("this Combat Condition cannot be removed through any means except "
      + "leaving the Unbreathable Environment"),
    trait.text.includes("Lose all stacks of Held Breath and the Suffocating Combat "
      + "Condition (if it was gained through the rules on Unbreathable Environments)")
  ], [true, true, true, true, true]);

  // The file has no statements, and that is not it doing nothing: every one of these is
  // an event, and a script in this language writes values.
  const statements = trait.script
    .split(/\r?\n/).filter(line => !line.trim().startsWith("#")).join("").trim();
  check("and it carries no script, because none of this is a value", statements, "");
  check("saying where each piece lives instead",
    trait.script.includes("Where each piece lives"), true);

  // --- What a Dice Score buys ----------------------------------------------------------------
  const { difficultiesMet } = await import(modUrl("breath.mjs"));

  // "For every Difficulty you exceed with this Dice Score." Read as meeting rather than
  // beating: a Check meets or exceeds a Target Number to pass it, so every Difficulty you
  // would have passed is a stack.
  check("a Dice Score below the first Difficulty buys nothing",
    [difficultiesMet(0), difficultiesMet(5)], [0, 0]);
  check("meeting Novice buys one", difficultiesMet(6), 1);
  check("and one short of it buys none", difficultiesMet(5), 0);
  check("the six Difficulties, at their own Target Numbers",
    [6, 10, 14, 18, 22, 26].map(difficultiesMet), [1, 2, 3, 4, 5, 6]);
  check("and nothing above Grandmaster buys a seventh", difficultiesMet(100), 6);

  // --- Unnatural ---------------------------------------------------------------------------------
  {
    const SLOTS_TEXT = fs.readFileSync(
      path.join(ROOT, "module", "effects", "slots.mjs"), "utf8");
    check("Unnatural is a Slot", SLOTS_TEXT.includes('{ key: "unnatural"'), true);
    check("that fans out to both Conditions it forbids",
      SLOTS_TEXT.includes('fanOut: ["condition.suffocating", "condition.poisoned"]'), true);

    // "Unless you are Unnatural or otherwise unable to gain the Suffocating Combat
    // Condition" is one question, so there is one test. A second one asking whether they
    // are Unnatural would be a second answer to it.
    const { canSuffocate } = await import(modUrl("breath.mjs"));
    check("a character nothing has touched can Suffocate",
      canSuffocate({ system: { effects: { slots: {} } } }), true);
    check("one forbidden the Condition cannot",
      canSuffocate({ system: { effects: { slots: { "condition.suffocating": false } } } }),
      false);
    check("and nothing asks whether they are Unnatural separately",
      /unnatural/i.test(BREATH.replace(/#[^\n]*/g, "").replace(/\/\/[^\n]*/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")), false);
  }

  // --- The Suffocating, settled from two facts and never set by hand -------------------------------
  {
    // Cut out and run. "While you are in an Unbreathable Environment and have no stacks of
    // Held Breath" is two facts and one Condition, and the bug shape is one caller setting
    // it and another forgetting.
    const from = BREATH.indexOf("export async function settleBreath(");
    const to = BREATH.indexOf("\n}\n", from);
    check("settleBreath was found to cut out", (from > 0) && (to > from), true);

    let conditionSet = null;
    let written = null;
    const settleBreath = new Function("isUnbreathable", "canSuffocate", "heldBreath",
      "setCondition",
      `${BREATH.slice(from, to + 2).replace("export async function", "async function")}
       return settleBreath;`)(
        actor => actor.unbreathable,
        actor => actor.able !== false,
        actor => actor.held ?? 0,
        async (actor, key, stacks) => { conditionSet = [key, stacks]; return true; });

    const who = ({ unbreathable = false, held = 0, able = true, drowning = false } = {}) => ({
      unbreathable, held, able,
      system: { battlefield: { drowning } },
      async update(changes) { written = changes; }
    });

    const run = async (state) => {
      conditionSet = null; written = null;
      await settleBreath(who(state));
      return { conditionSet, written };
    };

    check("in the open, nothing happens",
      await run({ unbreathable: false }), { conditionSet: null, written: null });
    check("with breath left, nothing happens",
      await run({ unbreathable: true, held: 2 }), { conditionSet: null, written: null });

    // The two facts together.
    const drowned = await run({ unbreathable: true, held: 0 });
    check("with no breath left in a vacuum, Suffocating",
      drowned.conditionSet, ["suffocating", 1]);
    check("and it is marked as this rule's",
      drowned.written, { "system.battlefield.drowning": true });

    // The order matters: the mark is what holds the Condition in place, so it has to stop
    // being true before the Condition can be taken off.
    const surfaced = await run({ unbreathable: false, held: 0, drowning: true });
    check("stepping out takes it off", surfaced.conditionSet, ["suffocating", 0]);
    check("clearing the mark first",
      surfaced.written, { "system.battlefield.drowning": false });
    const body = BREATH.slice(from, to);
    check("which is the order it is written in",
      body.indexOf('"system.battlefield.drowning": drowning')
        < body.indexOf('setCondition(actor, "suffocating"'), true);

    // Unnatural never drowns, whatever the Environment.
    check("and somebody who cannot Suffocate never does",
      await run({ unbreathable: true, held: 0, able: false }),
      { conditionSet: null, written: null });
  }

  // --- The Condition that cannot be taken off -------------------------------------------------------
  {
    check("Suffocating is held in place while drowning",
      CONDITIONS.includes('if ((key === "suffocating") && actor.system?.battlefield?.drowning)'),
      true);
    check("saying why, out loud",
      CONDITIONS.includes("cannot stop Suffocating without air to breathe"), true);
    // Held in place, not forbidden. Immunity would stop it being gained; this stops it
    // being removed, and they are different rules with different machinery.
    check("and it is held rather than forbidden",
      CONDITIONS.slice(CONDITIONS.indexOf("function heldInPlace("))
        .slice(0, 900).includes("drowning"), true);
  }

  // --- The four places a stack moves -----------------------------------------------------------------
  {
    check("one goes when the Combat Round turns over",
      COMBAT.includes('await loseBreath(actor, "the Combat Round ended");'), true);
    check("and one when a Health Threshold is crossed",
      COMBAT.includes('await loseBreath(actor, "knocked through a Health Threshold");'),
      true);
    // In the one place that knows a Threshold was crossed downward: it is derived from
    // Life Points and leaves no record of its own.
    check("in the function that knows one was crossed",
      COMBAT.slice(COMBAT.indexOf("async function announceThreshold("))
        .slice(0, 1400).includes("loseBreath"), true);

    // Both go through one function, so the two rules cannot disagree about what losing a
    // stack does - and neither has to know that running out starts the drowning.
    check("both through the same door",
      (COMBAT.match(/loseBreath\(/g) ?? []).length, 2);
    check("which settles the Suffocating itself",
      BREATH.slice(BREATH.indexOf("export async function loseBreath("))
        .slice(0, 700).includes("await settleBreath(actor);"), true);
    check("and does nothing where there is air",
      BREATH.includes("if (!actor || !isUnbreathable(actor)) return false;"), true);

    check("entering arms the Check and starts the drowning", [
      BREATH.includes('"system.battlefield.breathRolled": false'),
      BREATH.slice(BREATH.indexOf("export async function enteredUnbreathable("))
        .slice(0, 500).includes("await settleBreath(actor);")
    ], [true, true]);
    check("and leaving clears the stacks",
      BREATH.slice(BREATH.indexOf("export async function leftUnbreathable("))
        .slice(0, 500).includes('"system.battlefield.heldBreath": 0'), true);
  }

  // --- Entering and leaving are watched ---------------------------------------------------------------
  {
    check("the picker changing is what entering is",
      COMBAT.includes('foundry.utils.getProperty(changes, "system.battlefield.environment")'),
      true);
    // Where they were standing before is the only way to tell entering from leaving: the
    // field holds where they are now and nothing else remembers.
    check("remembered from before the change",
      COMBAT.includes("options.dbuWasUnbreathable = isUnbreathable(actor);"), true);
    check("and nothing happens when one breathable Environment becomes another",
      COMBAT.includes("if (was === now) return;"), true);
    check("entering and leaving are different rules",
      COMBAT.includes("if (now) await enteredUnbreathable(actor);\n    else await leftUnbreathable(actor);"),
      true);

    const MAIN = fs.readFileSync(path.join(ROOT, "module", "dbu-ttrpg.mjs"), "utf8");
    check("and the hooks are registered", MAIN.includes("registerBreathHooks();"), true);
  }

  // --- The Check, on the tab ----------------------------------------------------------------------------
  {
    check("the button is on the tab", TAB.includes('data-action="holdBreath"'), true);
    check("only where there is nothing to breathe",
      TAB.includes("{{#if breath}}"), true);
    check("and only while there is still a Check to make",
      TAB.includes("{{#if breath.canRoll}}"), true);
    check("with the stacks shown rather than typed",
      TAB.includes("{{breath.held}}") && !TAB.includes('name="system.battlefield.heldBreath"'),
      true);

    check("the sheet offers it once per entry",
      SHEET.includes("canRoll: !system.battlefield.breathRolled && canSuffocate(this.actor)"),
      true);
    // Marked before the roll. "Upon entering" is once, and a button still sitting there
    // after a bad roll is an invitation to make it twice.
    const handler = SHEET.slice(SHEET.indexOf("static async _onHoldBreath()"));
    check("and marks it before rolling, not after",
      handler.indexOf('"system.battlefield.breathRolled": true')
        < handler.indexOf("this.#rollCheck({"), true);
    check("rolling the Survival Skill",
      handler.slice(0, 900).includes("this.actor.system.skills.survival"), true);
    check("as an ordinary Skill Check",
      handler.slice(0, 900).includes("skillRoll: true"), true);
    check("and settling the Suffocating from what it bought",
      handler.slice(0, 1600).includes("await settleBreath(this.actor);"), true);

    // A willing failure and a refusal both come back as nothing rolled. Neither is a Dice
    // Score, and neither buys any breath.
    check("a Check that was never rolled buys nothing",
      handler.includes('const held = (typeof total === "number") ? difficultiesMet(total) : 0;'),
      true);
    // Which needed the roll to hand its total back at all - it threw it away before.
    check("and the roll hands its total back",
      SHEET.includes("return rolledTotal;") && SHEET.includes("return botched;"), true);
  }
}

console.log(`${failed} failing`);
process.exit(failed ? 1 : 0);
