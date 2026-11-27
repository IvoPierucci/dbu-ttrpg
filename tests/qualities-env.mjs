/**
 * Environmental Qualities.
 *
 * Nine of them, and they are not one kind of thing: four do something to a character
 * standing in the Square, two change what the ground is made of, two only matter when
 * somebody hits it, and one does all its work on a Movement Maneuver this system does not
 * have. So what is checked is each of those four shapes, run where it can be run.
 *
 * The shape most likely to go wrong is the split between the ground and a Feature standing
 * on it. Bouncy and Dangerous both say "this Square", and the collision window has to keep
 * telling the two apart - which is the distinction the Soft Environment introduced and
 * these two are the first to lean on.
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

const { loadTraits, getTrait, traitsOfKind } = await import(modUrl("effects/traits.mjs"));
await loadTraits();

const { default: DBUCharacterData } = await import(modUrl("data/actor-character.mjs"));
const { qualitiesOf, groundHardnessWith } = await import(modUrl("environments.mjs"));
const { reactiveFor } = await import(modUrl("effects/registry.mjs"));
const { collectReactive } = await import(modUrl("effects/interpreter.mjs"));
class ActorStub extends DataModel { static defineSchema() { return {}; } }

const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
const TAB = fs.readFileSync(
  path.join(ROOT, "templates", "parts", "actor-battlefields.hbs"), "utf8");
const SHEET = fs.readFileSync(
  path.join(ROOT, "module", "sheets", "actor-character-sheet.mjs"), "utf8");
const REGISTRY = fs.readFileSync(
  path.join(ROOT, "module", "effects", "registry.mjs"), "utf8");

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

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

/** A character standing on a Square with these Qualities. */
function inSquare({ qualities = [], environment = "standard-environment",
                    conditions = {}, groundHardness = 2 } = {}) {
  const parent = new ActorStub({}, { strict: false });
  parent.items = [];
  const model = new DBUCharacterData(
    { powerLevel: 10, progression: progressionTo(10), conditions,
      battlefield: { environment, qualities, groundHardness } },
    { parent, strict: false });
  parent.system = model;
  model.prepareBaseData?.();
  model.prepareDerivedData();
  return model;
}

/** What a Moment brings, by Slot; and the verbs it queues. */
const atMoment = (model, moment) => {
  const scope = { data: model, errors: [], context: {}, queue: [] };
  const { slots } = collectReactive(reactiveFor(model.parent), moment, scope);
  return { slots, queue: scope.queue };
};

// --- The nine, as the rulebook lists them -------------------------------------------------------
{
  check("nine Environmental Qualities",
    traitsOfKind("qualities").map(quality => quality.id).sort(),
    ["aflame", "bouncy", "dangerous", "electrified", "frozen", "glass", "metallic",
     "obscured", "poisonous"]);
  check("and every one of them says it is one",
    traitsOfKind("qualities").every(quality => quality.envQuality === true), true);

  const says = (id, phrase) => getTrait(id).text.includes(phrase);

  check("Aflame, whole", [
    says("aflame", "If you start or end your Turn in this Battle Environment, reduce your "
      + "Life Points by 2(bT)"),
    says("aflame", "Increase this reduction by 1(bT) for every stack of the Broken Combat "
      + "Condition you're suffering from")
  ], [true, true]);

  check("Bouncy, whole", [
    says("bouncy", "If you would Collide with this Square, halve the amount of Collision "
      + "Damage you would receive"),
    says("bouncy", "then you may move a number of Squares in any direction up to the "
      + "Hardness Rank of this Square")
  ], [true, true]);

  check("Dangerous, whole",
    says("dangerous", "Double any Collision Damage you receive from this Environment"),
    true);

  check("Electrified, whole", [
    says("electrified", "If you start or end your Turn in this Battle Environment, reduce "
      + "your Life Points by 2(bT)"),
    says("electrified", "If you end your turn in this Battle Environment, gain the "
      + "Impediment Combat Condition until the start of your next turn")
  ], [true, true]);

  check("Frozen, whole", [
    says("frozen", "reduce your Ki Points by 4(bT)"),
    says("frozen", "either halve your Speed for the duration of that Maneuver or make an "
      + "Acrobatics Skill Check with a Difficulty of Qualified"),
    says("frozen", "If you fail, you are knocked Prone instead (regain the Action and any "
      + "Ki Points spent on this Maneuver)")
  ], [true, true, true]);

  check("Glass, whole", [
    says("glass", "This Square is encased in glass, increasing its Hardness Rank by 1"),
    says("glass", "remove all other Environmental Qualities on this Feature")
  ], [true, true]);

  check("Metallic, whole", [
    says("metallic", "This Square is made of metal. It must have a Hardness Rank of 3+"),
    says("metallic", "remove all other Environmental Qualities on this Feature")
  ], [true, true]);

  check("Obscured, whole", [
    says("obscured", "While you occupy this Square, reduce your Strike Rolls, Dodge Rolls, "
      + "and Impulsive Saves by 2(bT)"),
    says("obscured", "This Environmental Quality can be applied to Squares within High "
      + "Environments")
  ], [true, true]);

  check("Poisonous, whole",
    says("poisonous", "If you end your Turn in this Battle Environment, gain the Poisoned "
      + "Combat Condition"), true);
}

// --- Which Qualities a Square has ------------------------------------------------------------------
{
  // Two sources added together: what the Environment's own file declares, and what the
  // player ticked. "A certain Environment has elements that apply to every space" is the
  // first; "decided by the ARC" is the second.
  check("nothing by default", qualitiesOf({ battlefield: { qualities: [] } }, null), []);
  check("what the player ticked",
    qualitiesOf({ battlefield: { qualities: ["frozen"] } }, null), ["frozen"]);
  check("what the Environment brings",
    qualitiesOf({ battlefield: { qualities: [] } }, getTrait("lava-environment")),
    ["aflame"]);
  check("and both, without repeating one",
    qualitiesOf({ battlefield: { qualities: ["aflame", "frozen"] } },
      getTrait("lava-environment")).sort(),
    ["aflame", "frozen"]);

  check("the registry gathers them", REGISTRY.includes("function qualityPrograms("), true);
  check("all of them rather than choosing one",
    REGISTRY.includes("for (const id of ids) {"), true);
  check("refusing a Trait that is not one",
    REGISTRY.includes("if (trait.envQuality !== true) {"), true);
  check("and reading the one function that answers which they are",
    REGISTRY.includes("qualitiesOf(actor.system, standing, getTrait)"), true);
}

// --- The four that do something to somebody standing there --------------------------------------------
{
  const plain = inSquare();

  // Aflame: both edges of the turn, and hungrier the more Broken you are.
  {
    const burning = inSquare({ qualities: ["aflame"] });
    const bT = burning.baseTierOfPower;

    check("nothing burns on an ordinary Square", [
      atMoment(plain, "start-of-turn").slots["life.value"] ?? null,
      atMoment(plain, "end-of-turn").slots["life.value"] ?? null
    ], [null, null]);
    check("Aflame burns at both edges of the turn", [
      atMoment(burning, "start-of-turn").slots["life.value"]?.add,
      atMoment(burning, "end-of-turn").slots["life.value"]?.add
    ], [-2 * bT, -2 * bT]);

    // "Increase this reduction by 1(bT) for every stack of the Broken Combat Condition."
    const broken = inSquare({ qualities: ["aflame"], conditions: { broken: 2 } });
    check("and more for every stack of Broken",
      atMoment(broken, "end-of-turn").slots["life.value"]?.add, -4 * bT);
    check("read off the character, so a stack from anywhere counts",
      getTrait("aflame").script.includes("conditions.broken"), true);
  }

  // Electrified: the same damage, and a Condition on the way out only.
  {
    const live = inSquare({ qualities: ["electrified"] });
    const bT = live.baseTierOfPower;

    check("Electrified burns at both edges too", [
      atMoment(live, "start-of-turn").slots["life.value"]?.add,
      atMoment(live, "end-of-turn").slots["life.value"]?.add
    ], [-2 * bT, -2 * bT]);
    // The damage is "start or end" and the Impediment is "end" alone, which is the half
    // that a single block would have got wrong.
    check("and leaves Impediment at the end of the turn only", [
      atMoment(live, "start-of-turn").queue.length,
      atMoment(live, "end-of-turn").queue.map(call => [call.verb, call.args[0]])
    ], [0, [["gain", "impediment"], ["expires", "impediment"]]]);
    check("on a clock to the start of their next turn",
      atMoment(live, "end-of-turn").queue[1]?.args,
      ["impediment", "start-of-next-turn"]);
    // Not Broken: Aflame's rider is Broken and this one's Condition is not, which is the
    // pair most likely to be copied into each other.
    check("and it is not the Broken that Aflame feeds on",
      getTrait("electrified").script.includes("conditions.broken"), false);
  }

  // Frozen: Ki rather than Life, which is the whole of what it does here.
  {
    const ice = inSquare({ qualities: ["frozen"] });
    const bT = ice.baseTierOfPower;

    check("Frozen drains Ki at both edges of the turn", [
      atMoment(ice, "start-of-turn").slots["ki.value"]?.add,
      atMoment(ice, "end-of-turn").slots["ki.value"]?.add
    ], [-4 * bT, -4 * bT]);
    check("and no Life at all", [
      atMoment(ice, "start-of-turn").slots["life.value"] ?? null,
      atMoment(ice, "end-of-turn").slots["life.value"] ?? null
    ], [null, null]);
    // The Movement Maneuver rider is the table's: this system has no Movement Maneuver to
    // hang a choice on, and `movement` is a Slot written and not enforced.
    check("the Movement rider is not built",
      /speed|acrobatics|prone/i.test(getTrait("frozen").script
        .split(/\r?\n/).filter(line => !line.trim().startsWith("#")).join(" ")), false);
    check("and the file says whose it is",
      getTrait("frozen").script.includes("the choice is the table's"), true);
  }

  // Poisonous: the end of the turn, and no clock.
  {
    const fumes = inSquare({ qualities: ["poisonous"] });
    check("Poisonous does nothing at the start of a turn",
      atMoment(fumes, "start-of-turn").queue.length, 0);
    check("and Poisons at the end of it",
      atMoment(fumes, "end-of-turn").queue.map(call => [call.verb, call.args[0]]),
      [["gain", "poisoned"]]);
    // No clock: the entry gives none, so it stays until something takes it off - which is
    // what makes it worse than Electrified's Impediment rather than the same thing.
    check("with no clock on it",
      atMoment(fumes, "end-of-turn").queue.some(call => call.verb === "expires"), false);
  }

  // Obscured: three named rolls, and not every Combat Roll.
  {
    const smoke = inSquare({ qualities: ["obscured"] });
    const bT = smoke.baseTierOfPower;

    check("Obscured takes 2(bT) off the Strike and the Dodge", [
      plain.combat.strike - smoke.combat.strike,
      plain.combat.dodge - smoke.combat.dodge
    ], [2 * bT, 2 * bT]);
    // The Wound Roll is a Combat Roll and is deliberately not among them: smoke makes you
    // harder to aim and harder to dodge with, and does not make your fist softer.
    check("and nothing off the Wound Rolls",
      Object.values(smoke.combat.wound),
      Object.values(plain.combat.wound));
    check("the Impulsive Save alone among the Saving Throws", [
      plain.savingThrows.impulsive.value - smoke.savingThrows.impulsive.value,
      plain.savingThrows.corporeal.value - smoke.savingThrows.corporeal.value,
      plain.savingThrows.cognitive.value - smoke.savingThrows.cognitive.value,
      plain.savingThrows.morale.value - smoke.savingThrows.morale.value
    ], [2 * bT, 0, 0, 0]);
    // Asked of the statements, not of the file: the comment above them says the word,
    // because saying why it is not `combatRolls` is the point of the comment.
    const lines = getTrait("obscured").script
      .split("\n").filter(line => !line.trim().startsWith("#")).join(" ");
    check("which is three lines rather than combatRolls",
      lines.includes("combatRolls"), false);
    check("and those three", lines.replace(/\s+/g, " ").trim(),
      "[passive] strike -= 2(bT); dodge -= 2(bT); save.impulsive -= 2(bT);");
  }
}

// --- The two that change what the ground is made of ------------------------------------------------
{
  const MAX = DBUCharacterData.MAX_HARDNESS_RANK;
  const glass = getTrait("glass");
  const metallic = getTrait("metallic");

  // Glass is a shift and Metallic is a floor, which is the distinction: glass over stone
  // is harder than stone, and metal is metal whatever was there before.
  check("Glass shifts", [glass.hardnessShift, glass.hardnessMin], [1, undefined]);
  check("and Metallic floors", [metallic.hardnessShift, metallic.hardnessMin],
    [undefined, 3]);

  check("plain ground is what the ARC picked",
    groundHardnessWith(2, [], MAX), 2);
  check("Glass is one harder", groundHardnessWith(2, [glass], MAX), 3);
  check("Metallic pulls a soft Square up to three",
    groundHardnessWith(1, [metallic], MAX), 3);
  check("and leaves a harder one alone", groundHardnessWith(5, [metallic], MAX), 5);
  check("both together shift and then floor",
    groundHardnessWith(1, [glass, metallic], MAX), 3);
  check("glass over Katchin is still the hardest there is",
    groundHardnessWith(5, [glass], MAX), MAX);
  check("and nothing goes below nothing", groundHardnessWith(0, [], MAX), 0);

  // Derived on the character, so the tab and the collision window read one number.
  check("the character carries the Rank the Qualities leave",
    inSquare({ groundHardness: 2, qualities: ["glass"] }).battlefield.groundRank, 3);
  check("beside the one the ARC picked",
    inSquare({ groundHardness: 2, qualities: ["glass"] }).battlefield.groundHardness, 2);
  check("and the window reads the first",
    CHAT.includes("const groundRank = Number(target.system.battlefield?.groundRank);"),
    true);
  check("while the tab shows both when they differ",
    TAB.includes("{{#if ground.shifted}}") && TAB.includes("{{ground.shifted.rank}}"),
    true);

  // "If this Environmental Quality is applied through an effect, remove all other
  // Environmental Qualities." Carried on both files, and read when an effect applies one.
  check("the exclusivity is carried on both files", [glass.appliedAlone, metallic.appliedAlone],
    [true, true]);
  check("and on no other Quality",
    traitsOfKind("qualities").filter(q => q.appliedAlone).map(q => q.id).sort(),
    ["glass", "metallic"]);
}

// --- The two that only matter when somebody hits it ----------------------------------------------------
{
  check("Bouncy halves a Ground Collision",
    getTrait("bouncy").groundCollision, "halves");
  check("and Dangerous doubles one",
    getTrait("dangerous").groundCollision, "doubles");
  check("and nothing else declares one",
    traitsOfKind("qualities").filter(q => q.groundCollision).map(q => q.id).sort(),
    ["bouncy", "dangerous"]);

  // Both say "this Square", so a Feature standing on a Bouncy Square is not bouncy. That
  // is the distinction the Soft Environment introduced, and these are the first to lean
  // on it.
  check("read only on a Ground Collision",
    CHAT.includes("const fromGround = hitGround ? groundQualities : [];"), true);
  check("gathered from the Square's own Qualities",
    CHAT.includes("const groundQualities = ignoring.qualities ? [] : qualitiesOf(target.system, standing, getTrait)"), true);
  check("filtered to the ones that say something about a collision",
    CHAT.includes(".filter(quality => quality?.groundCollision);"), true);

  // The arithmetic: both fold into the one multiply that already holds the Launching
  // doubling and the Sudden Stop halving, so it is one rounding.
  const settle = (value, doublings, halvings) =>
    Math.floor(value * (2 ** doublings) * (0.5 ** halvings));
  check("the source settles them all at once",
    CHAT.includes("const amount = Math.floor(value * (2 ** doublings) * (0.5 ** halvings));"),
    true);
  check("Bouncy halves", settle(12, 0, 1), 6);
  check("Dangerous doubles", settle(12, 1, 0), 24);
  // A Dangerous Square under a Launching attack is four times the Rank, because the two
  // multiply rather than stacking.
  check("and a Dangerous Square under a Launching attack is four times",
    settle(12, 2, 0), 48);
  check("while Bouncy against Launching leaves it where it started",
    settle(12, 1, 1), 12);
  check("and neither of them is counted twice",
    CHAT.includes('fromGround.filter(quality => quality.groundCollision === "halves").length')
    && CHAT.includes('fromGround.filter(quality => quality.groundCollision === "doubles").length'),
    true);
  check("with the card naming what moved the number",
    CHAT.includes('`${quality.groundCollision === "doubles" ? "doubled" : "halved"} by ${quality.name}`'),
    true);

  // Neither has any statements: a collision is an event, and a file with none is dropped
  // rather than gathered as an entry that contributes nothing.
  for (const id of ["bouncy", "dangerous"]) {
    const statements = getTrait(id).script
      .split(/\r?\n/).filter(line => !line.trim().startsWith("#")).join("").trim();
    check(`${id} has no script`, statements, "");
  }
}

// --- The tab -------------------------------------------------------------------------------------------
{
  check("the Qualities are ticked on the tab",
    TAB.includes('data-action="toggleQuality"'), true);
  check("walking the list rather than naming any of them",
    TAB.includes("{{#each qualities as |quality|}}"), true);
  check("collapsed, with what is on show in the summary",
    TAB.includes('data-section="qualities"') && TAB.includes("{{qualitySummary}}"), true);
  // An Environment's own come with the ground: shown so the player can see what they are
  // standing in, and not tickable, because untickable is what that means.
  check("and the Environment's own cannot be untocked",
    TAB.includes("{{#if quality.fixed}}disabled{{/if}}"), true);
  check("which the sheet works out from the Environment's file",
    SHEET.includes("fixed: environmentQualities.includes(quality.id)"), true);
  check("the toggle writes only what the player put there",
    SHEET.includes('return this.actor.update({ "system.battlefield.qualities": next });'),
    true);
}

console.log(`${failed} failing`);
process.exit(failed ? 1 : 0);
