/**
 * The Dirty Trick Maneuver, and the two firsts it drags in behind it.
 *
 * "A Clash (Bluff vs Intuition)" is the first Skill Clash in these rules with a different
 * Skill on each side, and "until the end of your turn or until they are hit by an Attacking
 * Maneuver (whichever comes first)" is the first duration with two ways to end. Both are
 * run rather than read: one answers per side, and the other has to end a clock kept by
 * somebody other than the character it is about.
 *
 * Building it also turned up that `on` - written by `lasting` since Analysis was built -
 * was declared by nobody, so the schema threw it away and every clock one character kept
 * over another took the Condition off the wrong person. That is checked in the durations
 * harness, where the schema is.
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
// setCondition relays a write through the GM when the character is not yours. These
// characters are, so it never gets that far - but the check is made before the branch.
globalThis.game = { combat: null, users: { activeGM: null } };
// `canvas?.` still throws on a name that was never declared, and Foundry declares this one.
globalThis.canvas = null;
// A clock kept over somebody else names them by uuid, and taking it off looks them up.
const SCENE = new Map();
globalThis.fromUuidSync = uuid => SCENE.get(uuid) ?? null;

const TRAITS = path.join(ROOT, "traits");
globalThis.foundry.utils.fetchJsonWithTimeout = async () =>
  JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));
globalThis.fetch = async url => {
  const file = path.join(TRAITS, String(url).replace("systems/dbu-ttrpg/traits/", ""));
  if (!fs.existsSync(file)) return { ok: false, status: 404, statusText: "missing" };
  return { ok: true, status: 200, text: async () => fs.readFileSync(file, "utf8") };
};

const { loadTraits } = await import(modUrl("effects/traits.mjs"));
const { loadManeuvers, getManeuver, whyNotSpecial, effectUsesLeft, recordEffectUse } =
  await import(modUrl("maneuvers.mjs"));
const { maneuverItemFrom, definitionOf } = await import(modUrl("use-maneuver.mjs"));
const { EDGES, KINDS, endedBy, lasting } = await import(modUrl("durations.mjs"));
const { default: DBUCharacterData } = await import(modUrl("data/actor-character.mjs"));
await loadTraits();
await loadManeuvers();

const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
const USE = fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8");
const INDEX = JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

/** One top-level function out of chat.mjs, to be run rather than read. */
function source(name) {
  let at = CHAT.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`chat.mjs has no ${name}`);
  if (CHAT.slice(at - 6, at) === "async ") at -= 6;
  return CHAT.slice(at, CHAT.indexOf("\n}\n", at) + 2);
}

// --- The Maneuver as the rulebook lists it ------------------------------------------------
{
  check("listed", INDEX.traits.includes("maneuvers/dirty-trick.dbu"), true);

  const trick = getManeuver("dirty-trick");
  check("loaded as a Standard Maneuver", trick?.type, "standard");
  check("costing an Action", trick.actionCost, 1);
  check("and no Ki", trick.kiCost, 0);
  check("once a Combat Round", trick.usageLimit, { amount: 1, per: "round" });
  check("it is Special", trick.special, true);
  check("and it is aimed at somebody", trick.requiresTarget, true);
  check("but it is not an attack", Boolean(trick.attacking), false);
  check("nothing is Exploitable about it", trick.exploitable ?? "", "");

  for (const line of [
    "target a Character within a Sphere AoE",
    "Make a Clash (Bluff vs Intuition) against that Character",
    "If you\n  win, apply one of the following effects",
    "Pocket Sand: Your target gains the Blinded Combat Condition until the end of your",
    "Made ya look!: Your target gains the Guard Down Combat Condition until the end of",
    "your turn or until they are hit by an Attacking Maneuver (whichever comes first)",
    "Compelled Combat Condition until the end\n  of their turn against a target of your choice",
    "they must either use the\n  Transformation Maneuver or Power Up Maneuver during their next turn",
    "You can only use\n  this effect once per Combat Encounter"
  ]) {
    const file = fs.readFileSync(path.join(TRAITS, "maneuvers", "dirty-trick.dbu"), "utf8");
    check(`the entry says "${line.slice(0, 42).replace(/\n\s+/g, " ")}"`,
      file.includes(line), true);
  }

  // A Character, not an Opponent - which the third effect leans on.
  check("it targets a Character rather than an Opponent",
    trick.text.includes("target a Character within"), true);

  // Special, and opened by nothing that has been read yet. Not Bluff, which was the
  // obvious guess: Bluff's entry opens the Feint Maneuver and says nothing about this one,
  // and this one is a Clash made with Bluff all the same.
  check("no Skill opens it",
    Object.values(DBUCharacterData.SKILLS).some(s => s.specialManeuver === "dirty-trick"),
    false);
  check("not even the one its Clash is made with",
    DBUCharacterData.SKILLS.bluff.specialManeuver, "feint");
  check("so it is an effect's to give",
    whyNotSpecial({ name: "Tizi", system: { effects: { slots: {} }, specialManeuvers: [] } },
      trick),
    "Tizi has not been granted access to Dirty Trick. A Special Maneuver is gained "
    + "through an effect.");
}

// --- Two Skills in one Clash ----------------------------------------------------------------
{
  const trick = getManeuver("dirty-trick");
  check("the Clash is made with Bluff", trick.clashSkill, "bluff");
  check("and answered with Intuition", trick.clashDefenderSkills, ["intuition"]);
  check("which is a list because the Feint names two with a slash between them",
    getManeuver("feint").clashDefenderSkills, ["intuition", "perception"]);
  check("both of which are Skills a character has",
    [Boolean(DBUCharacterData.SKILLS.bluff), Boolean(DBUCharacterData.SKILLS.intuition)],
    [true, true]);
  check("and neither needs a Rank before it can be rolled at all",
    [Boolean(DBUCharacterData.SKILLS.bluff.required),
     Boolean(DBUCharacterData.SKILLS.intuition.required)],
    [false, false]);

  // The field travels onto an Item and back off it, which is two lists a field added to
  // the schema alone would be missing from.
  const item = maneuverItemFrom(trick);
  check("the Item carries the second Skill", item.system.clashDefenderSkills, ["intuition"]);
  check("and the flag", item.system.dirtyTrick, true);
  const read = definitionOf({ id: "x", name: trick.name,
    system: { ...item.system, maneuverId: trick.id } });
  check("reading it back gives up the Clash", read.clash,
    { skill: "bluff", defenderSkills: ["intuition"] });
  check("and the flag", read.dirtyTrick, true);

  // The roll each side makes, run. Every Skill Clash before this named one Skill and both
  // sides rolled it, and that has to go on being true.
  const at = CHAT.indexOf("of: (actor, clash, uuid) => {");
  const start = CHAT.indexOf("(actor", at);
  const end = CHAT.indexOf("\n    },", start);
  // It asks `skillPicked` which Skill this side is rolling, so that comes along too - the
  // real one, or the answer would be checked against a copy of the question.
  const picked = CHAT.indexOf("function skillPicked(");
  const of = new Function(
    `${CHAT.slice(picked, CHAT.indexOf("\n}\n", picked) + 2)}
     return ${CHAT.slice(start, end + 6)};`)();

  const who = (bluff, intuition) => ({
    system: { skills: { bluff: { roll: bluff, label: "Bluff" },
                        intuition: { roll: intuition, label: "Intuition" } } }
  });
  const two = { challengerUuid: "Actor.a", defenderUuid: "Actor.b",
                skill: "bluff", skillLabel: "Bluff",
                defenderSkills: ["intuition"] };

  check("the challenger rolls Bluff", of(who(7, 3), two, "Actor.a"),
    { label: "Bluff", value: 7 });
  check("and the defender rolls their own Intuition", of(who(7, 3), two, "Actor.b"),
    { label: "Intuition", value: 3 });

  // Every other Skill Clash, unchanged.
  const one = { challengerUuid: "Actor.a", defenderUuid: "Actor.b",
                skill: "bluff", skillLabel: "Bluff", defenderSkills: [] };
  check("a Clash naming one Skill still has both sides roll it",
    [of(who(7, 3), one, "Actor.a"), of(who(7, 3), one, "Actor.b")],
    [{ label: "Bluff", value: 7 }, { label: "Bluff", value: 7 }]);
  check("and a card opened before the second Skill existed carries none",
    of(who(7, 3), { challengerUuid: "Actor.a", defenderUuid: "Actor.b",
                    skill: "bluff", skillLabel: "Bluff" }, "Actor.b"),
    { label: "Bluff", value: 7 });

  // Written onto the card from the target's own sheet, since it is their Skill.
  check("the card carries what the other side may answer with",
    CHAT.includes("          defenderSkills: offered,"), true);
  check("labelled off the character who rolls it, from their own sheet",
    CHAT.includes("        label: actor.system.skills[key]?.label ?? clash.skillLabel,"), true);
  check("and the door hands the list over",
    USE.includes("defenderSkills: [...(item.system.clashDefenderSkills ?? [])]"), true);
}

// --- What winning buys ------------------------------------------------------------------------
{
  const TRICKS = new Function(
    `${CHAT.slice(CHAT.indexOf("const TRICKS = Object.freeze({"),
                  CHAT.indexOf("\n});", CHAT.indexOf("const TRICKS = Object.freeze({")) + 4)}
     return TRICKS;`)();

  check("there are three of them", Object.keys(TRICKS).sort(), ["look", "sand", "tragedy"]);
  check("named as the entry names them",
    Object.values(TRICKS).map(t => t.label),
    ["Pocket Sand", "Made ya look!", "It's Such a Tragedy!"]);
  check("each hanging a Combat Condition the system has",
    Object.values(TRICKS).map(t => t.condition), ["blinded", "guard-down", "compelled"]);

  // Whose turn counts it. Two are "until the end of your turn" and one is "until the end of
  // their turn", and getting that backwards is a whole turn either way.
  check("two are counted by the trickster's turn and one by the target's",
    Object.entries(TRICKS).map(([key, t]) => [key, Boolean(t.theirClock)]),
    [["sand", false], ["look", false], ["tragedy", true]]);

  // Only one ends early, and only one has a limit of its own.
  check("only Made ya look! ends on being hit",
    Object.entries(TRICKS).filter(([, t]) => t.until).map(([key, t]) => [key, t.until]),
    [["look", "being-hit"]]);
  check("and only It's Such a Tragedy! runs out for the Encounter",
    Object.entries(TRICKS).filter(([, t]) => t.once).map(([key, t]) => [key, t.once]),
    [["tragedy", "encounter"]]);

  // The Conditions it hangs are real ones the checklist knows.
  const { allConditions } = await import(modUrl("conditions.mjs"));
  const known = allConditions().filter(c => c.combatCondition).map(c => c.key);
  check("all three are published Combat Conditions",
    Object.values(TRICKS).every(t => known.includes(t.condition)), true);
}

// --- The rider, and what it is read off ---------------------------------------------------------
{
  const forcedToPower = new Function(`${source("forcedToPower")}\nreturn forcedToPower;`)();

  const clash = (mine, theirs) => ({
    result: { challenger: { outcome: mine }, defender: { outcome: theirs } }
  });

  check("an ordinary Clash forces nothing", forcedToPower(clash("", "")), false);
  check("your Critical forces it", forcedToPower(clash("critical", "")), true);
  check("their Botch forces it", forcedToPower(clash("", "botch")), true);
  check("either one is enough", forcedToPower(clash("critical", "botch")), true);
  // The other way round is neither: their Critical and your Botch are not this rule.
  check("their Critical is not it", forcedToPower(clash("", "critical")), false);
  check("and your Botch is not it", forcedToPower(clash("botch", "")), false);
  check("a Clash with no result at all forces nothing", forcedToPower({}), false);
}

// --- What the table is told -----------------------------------------------------------------------
{
  // It asks `forcedToPower` for the rider, so that comes along - the real one, not a
  // stand-in, or the rider would be checked against a copy of itself.
  const run = new Function(
    `${source("forcedToPower")}\n${source("trickNote")}\nreturn trickNote;`)();
  const tricker = { name: "Tizi" };
  const target = { name: "Kuro" };
  const quiet = { result: { challenger: { outcome: "" }, defender: { outcome: "" } } };
  const crit = { result: { challenger: { outcome: "critical" }, defender: { outcome: "" } } };

  check("Pocket Sand says whose turn it lifts on",
    run({ condition: "blinded" }, tricker, target, null, quiet),
    "Kuro is Blinded until the end of Tizi's turn.");
  check("Made ya look! says both ways it can end",
    run({ condition: "guard-down" }, tricker, target, null, quiet),
    "Kuro is Guard Down until the end of Tizi's turn, or until they are hit by an "
    + "Attacking Maneuver - whichever comes first.");

  // The third names whoever was targeted, and says so plainly when nobody was.
  check("It's Such a Tragedy! names the target of the compulsion",
    run({ condition: "compelled", theirClock: true }, tricker, target, { name: "Goro" }, quiet),
    "Kuro is Compelled against Goro until the end of Kuro's turn.");
  check("and leaves the choice to the table when none was picked",
    run({ condition: "compelled", theirClock: true }, tricker, target, null, quiet),
    "Kuro is Compelled against a target of Tizi's choice until the end of Kuro's turn.");
  check("the clock on it is theirs, not yours",
    run({ condition: "compelled", theirClock: true }, tricker, target, null, quiet)
      .includes("until the end of Kuro's turn"), true);

  check("and the rider is said when the Clash asks for it",
    run({ condition: "compelled", theirClock: true }, tricker, target, { name: "Goro" }, crit),
    "Kuro is Compelled against Goro until the end of Kuro's turn. Kuro must also use the "
    + "Transformation Maneuver or the Power Up Maneuver during their next turn.");
  check("and not when it does not",
    run({ condition: "compelled", theirClock: true }, tricker, target, { name: "Goro" }, quiet)
      .includes("Transformation"), false);

  // Both halves of the choice exist; which is used is still said, not enforced.
  check("the Transformation Maneuver exists to be used",
    Boolean(getManeuver("transformation")), true);
  check("where the Power Up Maneuver does", Boolean(getManeuver("power-up")), true);
}

// --- A limit inside a limit ---------------------------------------------------------------------
{
  // The Maneuver is 1/Round and this one effect is once an Encounter. Counted against its
  // own name so that neither can spend the other.
  const trick = getManeuver("dirty-trick");
  const held = [];
  const actor = {
    system: { usedManeuvers: held },
    async update(changes) { held.length = 0; held.push(...changes["system.usedManeuvers"]); }
  };

  check("it starts available", effectUsesLeft(actor, trick, "tragedy"), 1);
  await recordEffectUse(actor, trick, "tragedy");
  check("and is gone once used", effectUsesLeft(actor, trick, "tragedy"), 0);
  check("written with its period and its own name", held, ["encounter:dirty-trick.tragedy"]);

  // Which a new Combat Round leaves alone: the reset hands back what is written `round:`.
  const COMBAT = fs.readFileSync(path.join(ROOT, "module", "combat.mjs"), "utf8");
  check("a new Round hands back only the Round's own uses",
    COMBAT.includes('.filter(entry => !entry.startsWith("round:"))'), true);
  check("and a new Encounter clears the lot",
    COMBAT.includes('"system.usedManeuvers": [],'), true);

  // And the Maneuver's own 1/Round is a different tally, untouched by this one.
  const { maneuverUsesLeft } = await import(modUrl("maneuvers.mjs"));
  check("using the effect does not spend the Maneuver",
    maneuverUsesLeft(actor, trick), 1);
  check("and the other two effects are not spent either",
    [effectUsesLeft(actor, trick, "sand"), effectUsesLeft(actor, trick, "look")], [1, 1]);
}

// --- Whichever comes first, run --------------------------------------------------------------------
{
  // The Guard Down is counted by whoever played the trick and is about whoever it was
  // played on, so ending it early means reaching into somebody else's clock.
  const made = (uuid, timed) => {
    const actor = {
      uuid,
      name: uuid,
      isOwner: true,
      system: { timed: [...timed], states: {}, conditions: { "guard-down": 1 }, resources: {} },
      async update(changes) {
        for (const [key, value] of Object.entries(changes)) {
          if (key === "system.timed") actor.system.timed = [...value];
          if (key === "system.conditions") actor.system.conditions = { ...value };
        }
      }
    };
    SCENE.set(uuid, actor);
    return actor;
  };

  const entry = (extra) => ({ kind: KINDS.CONDITION, key: "guard-down", edge: EDGES.END,
                              edges: 1, source: "Dirty Trick", on: "", until: "", ...extra });

  // Their own clock, ending on the moment.
  const alone = made("Actor.kuro", [entry({ until: "being-hit" })]);
  check("a clock of your own with a second way out ends on it",
    await endedBy(alone, "being-hit"), ["Dirty Trick"]);
  check("and comes off the list", alone.system.timed, []);

  // A moment nothing is waiting on changes nothing.
  const other = made("Actor.kuro", [entry({ until: "being-hit" })]);
  check("a different moment ends nothing", await endedBy(other, "damage-applied"), []);
  check("and leaves the clock where it was", other.system.timed.length, 1);

  // A clock with no second way out is only ever ended by its edge.
  const plain = made("Actor.kuro", [entry({})]);
  check("a clock with one way out is untouched", await endedBy(plain, "being-hit"), []);
  check("and stays on the list", plain.system.timed.length, 1);

  // Somebody else's clock, about this character. This is the shape Dirty Trick actually
  // writes, and the one an actor's own list can never answer.
  const target = made("Actor.kuro", []);
  const tricker = made("Actor.tizi",
    [entry({ on: "Actor.kuro", until: "being-hit" })]);
  globalThis.canvas = { tokens: { placeables: [{ actor: tricker }, { actor: target }] } };

  check("a clock somebody else keeps over you ends on your moment",
    await endedBy(target, "being-hit"), ["Dirty Trick"]);
  check("and comes off their list", tricker.system.timed, []);

  // And not off somebody else's: an entry naming a third character is not yours to end.
  const third = made("Actor.goro", []);
  const keeper = made("Actor.tizi", [entry({ on: "Actor.goro", until: "being-hit" })]);
  globalThis.canvas = { tokens: { placeables: [{ actor: keeper }, { actor: third }] } };
  const bystander = made("Actor.kuro", []);
  check("a clock about somebody else is not ended by your being hit",
    await endedBy(bystander, "being-hit"), []);
  check("and stays on their list", keeper.system.timed.length, 1);

  globalThis.canvas = null;
}

// --- Where the early end is swept from --------------------------------------------------------------
{
  check("swept where an attack is settled against a target",
    CHAT.includes('const ran = await endedBy(target, "being-hit");'), true);
  check("only when they were actually hit",
    CHAT.includes('if (hit && (game.users.activeGM === game.user)) {'), true);
  check("and by the GM's client alone, as the turn edges are",
    CHAT.includes("(game.users.activeGM === game.user)"), true);
  check("said at the table when something ends",
    CHAT.includes("is hit, and that ends ${ran.join(\", \")}."), true);

  // The turn edge goes on counting either way: `until` is the other half of a whichever,
  // not a replacement for the edge.
  const DURATIONS = fs.readFileSync(path.join(ROOT, "module", "durations.mjs"), "utf8");
  check("the edge is still what edgeReached counts",
    DURATIONS.includes("    if (entry.edge !== edge) {"), true);
  // And the edge does not read the other half: a clock with both ends at whichever comes
  // first, not at the one that happens to be asked about. (The word itself is in there, in
  // a comment quoting a duration - so this asks about the field being read.)
  check("and the edge does not look at `until`",
    DURATIONS.slice(DURATIONS.indexOf("export async function edgeReached("),
      DURATIONS.indexOf("export async function endedBy(")).includes("entry.until"), false);
  check("where ending early does",
    DURATIONS.slice(DURATIONS.indexOf("export async function endedBy("))
      .includes("(entry.until === moment)"), true);
}

// --- The card, and the choice on it ----------------------------------------------------------------
{
  check("the Clash carries the choice",
    CHAT.includes('dirtyTrick: maneuver.dirtyTrick ? { chosen: "", applied: false } : null,'),
    true);
  check("settled once, by the one client that writes a Clash",
    CHAT.includes("  if (clash.dirtyTrick && clash.result && !clash.dirtyTrick.applied) {"),
    true);
  check("and marked before anything else happens",
    CHAT.includes("    ...clash, dirtyTrick: { ...clash.dirtyTrick, applied: true }"), true);

  // Offered to whoever won it, once, and a tie is not a win.
  check("offered only to the winner",
    CHAT.includes("if (clash.dirtyTrick && wonIt && !clash.dirtyTrick.chosen && challenger?.isOwner) {"),
    true);
  check("where a tie goes to the defender, here as everywhere",
    CHAT.includes('const wonIt = whoWonClash(result) === "challenger";'), true);
  check("and taken once", CHAT.includes("  if (clash.dirtyTrick?.chosen) return;"), true);

  // An option spent for the Encounter is shown and refused rather than quietly missing.
  check("a spent option is disabled rather than hidden",
    CHAT.includes("        button.disabled = Boolean(spent);"), true);
  check("and says why", CHAT.includes("has already been used this Combat Encounter."), true);

  // The refusal is also asked where the effect is applied, not only where it is drawn:
  // a card is rendered on every client and only one of them is clicking.
  check("and the choice refuses it again when it is taken",
    CHAT.includes("  if (trick.once && maneuver\n    && !effectUsesLeft(tricker, maneuver, choice, { per: trick.once })) {"),
    true);
}

console.log(`${failed} failing`);
process.exit(failed ? 1 : 0);
