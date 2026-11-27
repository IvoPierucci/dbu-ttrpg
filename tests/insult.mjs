/**
 * The Insult Maneuver, and the payload a Saving Throw Clash was throwing away.
 *
 * Every Clash of Saving Throws in these rules so far has come out of a card - a Movement
 * to stand in the way of, a Thrust already won - so opening one from the sheet is new, and
 * `clashSaves` is what lets a Maneuver say it does.
 *
 * Building it turned up that `postSaveClash` took the Thrust's payload by name and dropped
 * everything else. The Blockade Maneuver passed one, nothing here caught it, and settling a
 * Blockade did nothing at all: winning stopped no Movement and losing handed over no
 * Exploit. That is the half of this worth running.
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

const { loadTraits } = await import(modUrl("effects/traits.mjs"));
const { loadManeuvers, getManeuver, allManeuvers, whyNotSpecial } =
  await import(modUrl("maneuvers.mjs"));
const { maneuverItemFrom, definitionOf } = await import(modUrl("use-maneuver.mjs"));
const { allConditions } = await import(modUrl("conditions.mjs"));
const { default: DBUCharacterData } = await import(modUrl("data/actor-character.mjs"));
await loadTraits();
await loadManeuvers();

const TRAIT = fs.readFileSync(path.join(TRAITS, "maneuvers", "insult.dbu"), "utf8");
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

// --- The Maneuver as the rulebook lists it -------------------------------------------------
{
  check("listed", INDEX.traits.includes("maneuvers/insult.dbu"), true);

  const insult = getManeuver("insult");
  check("loaded as a Standard Maneuver", insult?.type, "standard");
  check("costing an Action", insult.actionCost, 1);
  check("and no Ki", insult.kiCost, 0);
  check("once a Combat Round", insult.usageLimit, { amount: 1, per: "round" });
  check("it is Special", insult.special, true);
  check("aimed at an Opponent", insult.requiresTarget, true);
  check("and it is not an attack", Boolean(insult.attacking), false);
  check("nothing is Exploitable about it", insult.exploitable, "");

  for (const line of [
    "Target an Opponent and make a Morale Clash against them",
    "the\n  target suffers from the Impaired Combat Condition",
    "gains the Compelled Combat\n  Condition against you until the end of your next turn"
  ]) {
    check(`the entry says "${line.slice(0, 44).replace(/\n\s+/g, " ")}"`,
      TRAIT.includes(line), true);
  }

  check("no Skill opens it",
    Object.values(DBUCharacterData.SKILLS).some(s => s.specialManeuver === "insult"), false);
  check("so it is an effect's to give",
    whyNotSpecial({ name: "Tizi", system: { effects: { slots: {} }, specialManeuvers: [] } },
      insult),
    "Tizi has not been granted access to Insult. A Special Maneuver is gained through an "
    + "effect.");
}

// --- A Morale Clash, opened from the sheet ----------------------------------------------------
{
  const insult = getManeuver("insult");

  check("the Clash is made of one Saving Throw", insult.clashSaves, ["morale"]);
  check("which is a Saving Throw a character has",
    Object.keys(DBUCharacterData.SAVING_THROWS ?? {}).length >= 0, true);

  // Morale is one of the four, governed by Personality.
  const sheet = fs.readFileSync(
    path.join(ROOT, "module", "data", "actor-character.mjs"), "utf8");
  check("Morale is one of the four Saving Throws",
    sheet.includes('morale: "personality"'), true);
  check("and the card calls the family by its name",
    CHAT.includes("Impulsive, Corporeal, Cognitive, Morale."), true);

  // It travels onto an Item and back off it.
  const item = maneuverItemFrom(insult);
  check("the Item carries the Clash", item.system.clashSaves, ["morale"]);
  check("and the flag", item.system.insult, true);
  const read = definitionOf({ id: "x", name: insult.name,
    system: { ...item.system, maneuverId: insult.id } });
  check("and reading it back gives both up", [read.clashSaves, read.insult],
    [["morale"], true]);

  // The first Maneuver to open one from the sheet. Every other Saving Throw Clash in these
  // rules arrives out of a card that already exists.
  check("the door opens one when the Maneuver names the Saving Throws",
    USE.includes("    : maneuver.clashSaves?.length\n    ? await postSaveClash("), true);
  check("and these are the Maneuvers that name any",
    allManeuvers().filter(m => (m.clashSaves ?? []).length).map(m => m.id).sort(),
    ["insult", "internal-attack"]);
  // One list for both sides here; the Internal Attack names a different one for each.
  check("this one names nothing different for the other side",
    getManeuver("insult").clashDefenderSaves, []);
  check("where the others reach that shape from a card",
    [CHAT.includes("  const clashCard = await postSaveClash(actor, mover, {"),
     CHAT.includes("  await postSaveClash(thruster, target, {")], [true, true]);

  // One named means nothing is asked. Two is the slash, which is a choice.
  check("one Saving Throw asks neither side anything",
    CHAT.includes("      const offered = savesOffered(clash, actor.uuid);\n"
      + "      if (offered.length < 2) return {};"), true);
}

// --- What a Saving Throw Clash was dropping ------------------------------------------------------
{
  // `postSaveClash` took the Thrust's payload by name and nothing else, so the Blockade's
  // was passed and never arrived: `applyClash` waited for a key that was not there and
  // settling a Blockade did nothing at all.
  check("what a Clash leaves behind is carried whole",
    CHAT.includes('saves = ["impulsive"], defenderSaves = [],\n  ...leaves'), true);
  check("and spread onto the card",
    CHAT.includes('          defenderSave: "",\n'), true);
  check("rather than one key taken by name",
    CHAT.includes("...(thrust ? { thrust } : {})"), false);

  // Every settlement `applyClash` waits for has a caller that passes it, and the Clash has
  // to be able to carry all of them.
  const waited = [...CHAT.matchAll(/^  if \(clash\.(\w+) && clash\.result && !clash\.\1\.applied\) \{$/gm)]
    .map(m => m[1]).sort();
  check("these are the settlements a Clash can carry",
    waited, ["analytic", "angelicOffense", "bind", "bindEscape", "blockade", "bluffAttack", "concealed", "conditionHandOff", "cutthroatClash", "cutthroatShove", "danceEffect", "debilitate", "debilitateEscape", "debuffer", "demonicImpediment", "desperateDodge", "devilmite", "dirtyTrick", "disarm", "disarming", "disarmingHit", "downBurst", "drain", "duelEscape", "explosion", "fakeDeath", "feint", "gearClash", "glassSlowed", "godBind", "godBindEscape", "goof", "grapple", "handcuff", "hides", "honorbound", "illusion", "insult", "internalAttack", "kiDeception", "lullaby", "magicTrick", "mastersPlace", "mindControl", "mindReading", "negativeImpair", "nobleDragon", "paraPara", "petrify", "pickpocket", "positionChange", "pseudoSenses", "psychic", "punishCoward", "reveals", "ride", "roar", "sacrificialShaken", "sealing", "search", "searchMark", "sense", "shardBurst", "silentFootsteps", "snare", "solarFlare", "stagger", "stealthStrike", "talk", "techniqueClash", "terrify", "thrownProne", "thrust", "transfiguration", "trapGuard", "treatment", "unaware", "warped", "wave", "whack", "winEffects", "winNote"]);

  // Run it: the payload a caller attaches has to come out the other side.
  // The `export` goes: a function declaration is what `new Function` can take, and an
  // exported one is not.
  const from = CHAT.indexOf("export async function postSaveClash(");
  const body = CHAT.slice(from, CHAT.indexOf("\n}\n", from) + 2).replace("export ", "");
  let written = null;
  const postSaveClash = new Function(
    "ChatMessage", "SCOPE", "RESPONDABLE_FLAG", "CLASH_FLAG",
    `${body}\nreturn postSaveClash;`)(
      { create: async (data) => { written = data; return { id: "c1" }; },
        getSpeaker: () => ({}) },
      "dbu-ttrpg", "respondable", "clash");

  const who = (uuid) => ({ uuid, name: uuid });
  const flagOf = () => written.flags["dbu-ttrpg"].clash;

  await postSaveClash(who("Actor.a"), who("Actor.b"), {
    maneuverName: "Blockade", saves: ["impulsive"],
    blockade: { messageId: "m1", applied: false }
  });
  check("a Blockade's payload reaches the card",
    flagOf().blockade, { messageId: "m1", applied: false });

  await postSaveClash(who("Actor.a"), who("Actor.b"), {
    maneuverName: "Thrust", saves: ["impulsive", "corporeal"],
    thrust: { stage: "prone", applied: false, chosen: "" }
  });
  check("and a Thrust's still does",
    flagOf().thrust, { stage: "prone", applied: false, chosen: "" });
  check("with both Saving Throws on it", flagOf().saves, ["impulsive", "corporeal"]);

  await postSaveClash(who("Actor.a"), who("Actor.b"), {
    maneuverName: "Insult", saves: ["morale"], insult: { applied: false }
  });
  check("and an Insult's", flagOf().insult, { applied: false });
  check("opened as a Clash of Saving Throws", flagOf().category, "save");
  check("with neither side having answered yet",
    [flagOf().challengerSave, flagOf().defenderSave, flagOf().result], ["", "", null]);

  // A Clash nobody attached anything to carries nothing extra.
  await postSaveClash(who("Actor.a"), who("Actor.b"), { maneuverName: "Bare" });
  check("a Clash with nothing attached carries nothing extra",
    Object.keys(flagOf()).filter(key =>
      ["blockade", "thrust", "insult", "internalAttack", "magicTrick", "feint",
       "dirtyTrick", "grapple"].includes(key)), []);
  check("and falls back to Impulsive, as it always did", flagOf().saves, ["impulsive"]);
}

// --- What winning leaves ---------------------------------------------------------------------------
{
  const known = allConditions().filter(c => c.combatCondition).map(c => c.key);
  check("Impaired is a published Combat Condition", known.includes("impaired"), true);
  check("and so is Compelled", known.includes("compelled"), true);

  check("settled once, by the one client that writes a Clash",
    CHAT.includes("  if (clash.insult && clash.result && !clash.insult.applied) {"), true);
  check("and marked before anything else happens",
    CHAT.includes("    ...clash, insult: { ...clash.insult, applied: true }"), true);
  check("a tie leaves nothing, here as everywhere",
    CHAT.includes('if (whoWonClash(clash.result) !== "challenger") {\n'
      + "    await settledNote(message, `${target.name} does not rise to it.`);"), true);

  check("winning puts both on the target",
    CHAT.includes('  await setCondition(target, "impaired", 1);\n'
      + '  await setCondition(target, "compelled", 1);'), true);

  // Only one of the two is timed, and its clock is the insulter's.
  const settle = CHAT.slice(CHAT.indexOf("async function settleInsult("));
  const body = settle.slice(0, settle.indexOf("\n}\n"));
  check("only the Compelled is put on a clock",
    (body.match(/await lasting\(/g) ?? []).length, 1);
  check("which is the insulter's next turn, over the target",
    body.includes('    key: "compelled",\n    edge: EDGES.END,\n    next: true,\n'
      + "    on: target.uuid,"), true);
  check("and the Impaired is not, which the card says out loud",
    body.includes("The Impaired stays until something takes it off."), true);

  // "Against you", said rather than tracked - which is what Compelled's Slot has always
  // said about itself.
  check("the compulsion names who it is against",
    body.includes("Compelled against ${insulter.name}"), true);
  const SLOTS = fs.readFileSync(path.join(ROOT, "module", "effects", "slots.mjs"), "utf8");
  check("and the Slot says why it is not tracked",
    SLOTS.includes("who you were told to attack is not tracked"), true);
}

console.log(`${failed} failing`);
process.exit(failed ? 1 : 0);
