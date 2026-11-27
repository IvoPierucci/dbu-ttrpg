/**
 * The Sense Maneuver: the first in this system whose whole effect is that one person now
 * knows something.
 *
 * Three halves worth running, and one of them is a gap rather than a rule.
 *
 * The reading itself - "how many stacks of Holding Back they possess" - is a count off
 * somebody else's Resource, and none is as much of an answer as two.
 *
 * The Transformation half cannot be answered by anything, because this system has no
 * Transformations in it. Checked as a fact rather than trusted as a comment, so the day
 * one exists this harness says so.
 *
 * And the note is whispered, where every other settled Clash reads its outcome out. That
 * change is to a function eight other settlements call, so what is pinned hardest is that
 * the other eight are unchanged.
 *
 * Clairvoyance opens it, and both sides of its Clash are Required Skills - the only Clash
 * here of which that is true whatever the defender picks. Which turns up an older gap:
 * the sheet will not roll a Required Skill at no Ranks and a Clash never asks.
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
const { loadManeuvers, getManeuver, allManeuvers, whyNotSpecial, MANEUVER_TYPES } =
  await import(modUrl("maneuvers.mjs"));
const { maneuverItemFrom, definitionOf } = await import(modUrl("use-maneuver.mjs"));
const { default: DBUCharacterData } = await import(modUrl("data/actor-character.mjs"));
await loadTraits();
await loadManeuvers();

const TRAIT = fs.readFileSync(path.join(TRAITS, "maneuvers", "sense.dbu"), "utf8");
const HOLDING = fs.readFileSync(path.join(TRAITS, "maneuvers", "holding-back.dbu"), "utf8");
const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
const USE = fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8");
const CHARACTER = fs.readFileSync(
  path.join(ROOT, "module", "data", "actor-character.mjs"), "utf8");
const SHEET = fs.readFileSync(
  path.join(ROOT, "module", "sheets", "actor-character-sheet.mjs"), "utf8");
const INDEX = JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

/** One top-level function out of a module, sliced so it can be run. */
function source(text, name) {
  let at = text.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`no ${name}`);
  if (text.slice(at - 6, at) === "async ") at -= 6;
  return text.slice(at, text.indexOf("\n}\n", at) + 2);
}

// --- The Maneuver as the rulebook lists it -----------------------------------------------
{
  check("listed", INDEX.traits.includes("maneuvers/sense.dbu"), true);

  const sense = getManeuver("sense");
  check("loaded as a Standard Maneuver", sense?.type, "standard");
  check("costing one Action", sense.actionCost, 1);
  check("which is what a Standard Maneuver spends",
    MANEUVER_TYPES.standard.action, "standard");
  check("once a Combat Round", sense.usageLimit, { amount: 1, per: "round" });
  check("it is Special", sense.special, true);
  check("aimed at somebody", sense.requiresTarget, true);
  check("and it is not itself an attack", Boolean(sense.attacking), false);
  check("no Ki", sense.kiCost, 0);
  check("and none per Tier either", sense.kiCostPerTier ?? 0, 0);
  check("it is the flag it is", sense.sense, true);

  for (const line of [
    "Target an Opponent. Make a Skill Clash (Clairvoyance vs Concealment) against",
    "you can tell how many stacks of Holding Back they possess",
    "if\n  they are currently in their Transformation with the highest Tier of Power Requirement",
    "you do not know which Transformation they possess"
  ]) {
    check(`the entry says "${line.slice(0, 44).replace(/\n\s+/g, " ")}"`,
      TRAIT.includes(line), true);
  }

  const item = maneuverItemFrom(sense);
  check("the Item carries the flag", item.system.sense, true);
  check("and reading it back gives it up",
    definitionOf({ id: "x", name: sense.name,
      system: { ...item.system, maneuverId: sense.id } }).sense, true);
}

// --- One Skill each side ------------------------------------------------------------------
{
  const sense = getManeuver("sense");
  check("made with Clairvoyance", sense.clashSkill, "clairvoyance");
  check("and answered with Concealment", sense.clashDefenderSkills, ["concealment"]);
  check("both of which are Skills a character has",
    [Boolean(DBUCharacterData.SKILLS.clairvoyance),
     Boolean(DBUCharacterData.SKILLS.concealment)],
    [true, true]);

  // The library's copy and the Item's copy carry the same Clash. They did not once: the
  // defender's Skill was written onto the Item and nowhere else, so two copies of one
  // Maneuver disagreed and only the door that reads the Item was right.
  check("the library's copy carries both halves", sense.clash,
    { skill: "clairvoyance", defenderSkills: ["concealment"] });
  const item = maneuverItemFrom(sense);
  check("and the Item's copy says the same",
    item.system.clashDefenderSkills, ["concealment"]);
  check("read back off the Item unchanged",
    definitionOf({ id: "x", name: sense.name,
      system: { ...item.system, maneuverId: sense.id } }).clash,
    { skill: "clairvoyance", defenderSkills: ["concealment"] });

  // Which Skill each side rolls, run - and nobody is asked, because there is nothing to
  // choose between. That is the Feint's slash, and this entry has none.
  const skillPicked = new Function(`${source(CHAT, "skillPicked")}\nreturn skillPicked;`)();
  const clash = { challengerUuid: "Actor.a", defenderUuid: "Actor.b", skill: "clairvoyance",
                  defenderSkills: ["concealment"], defenderSkill: "" };
  check("the challenger rolls Clairvoyance", skillPicked(clash, "Actor.a"), "clairvoyance");
  check("and the defender rolls Concealment without being asked",
    skillPicked(clash, "Actor.b"), "concealment");
  check("since the question is only put when there are two to choose from",
    CHAT.includes("      if ((actor.uuid !== clash.defenderUuid) || (offered.length < 2)) return {};"),
    true);
}

// --- The thing being looked for is what hides it ------------------------------------------
{
  // Concealment is the Skill the Holding Back Maneuver's own stacks improve. So this
  // Clash's defender rolls better at hiding the very Resource this Clash is counting,
  // which is the one place in these rules where a Resource defends itself. Pinned because
  // it is a coupling rather than a coincidence: change either side and look at the other.
  check("Holding Back raises Concealment",
    HOLDING.includes("skill.concealment.bonus += min(holdingback.stacks, 3);"), true);
  check("and Concealment is what Sense is answered with",
    getManeuver("sense").clashDefenderSkills, ["concealment"]);
  check("Holding Back is the Maneuver that holds the stacks",
    getManeuver("holding-back").holdingBack, true);
  check("and they are a Resource, which is what makes them countable",
    getTrait("holding-back").resource, "holdingback");
  check("whose ceiling is the character's own base Tier of Power",
    getTrait("holding-back").resourceMaxFrom, "baseTierOfPower");
}

// --- Clairvoyance opens it ------------------------------------------------------------------
{
  const sense = getManeuver("sense");
  check("Clairvoyance is the Skill that opens it",
    DBUCharacterData.SKILLS.clairvoyance.specialManeuver, "sense");
  check("which is also the Skill its Clash is rolled with, though those are two questions",
    sense.clashSkill, "clairvoyance");
  check("and Bluff is the pair that shows they are two",
    [DBUCharacterData.SKILLS.bluff.specialManeuver, getManeuver("dirty-trick").clashSkill],
    ["feint", "bluff"]);

  const who = (ranks) => ({
    name: "Tizi",
    system: {
      effects: { slots: {} },
      specialManeuvers: [{ maneuver: "sense", skill: "Clairvoyance", ranks, needs: 2,
                           open: ranks >= 2 }]
    }
  });
  check("one Rank short, and the reason says by how much",
    whyNotSpecial(who(1), sense), "Sense opens at 2 Ranks of Clairvoyance, and Tizi has 1.");
  check("two Ranks opens it", whyNotSpecial(who(2), sense), null);
  check("and more than enough still opens it", whyNotSpecial(who(4), sense), null);

  // Required, which the entry marks as "Clairvoyance (R)": no Rank, no roll at all. So the
  // Maneuver opens one Rank after the Skill becomes rollable rather than one Rank after
  // nothing.
  check("Clairvoyance is a Required Skill", DBUCharacterData.SKILLS.clairvoyance.required,
    true);
  check("and so is the Skill it is answered with",
    DBUCharacterData.SKILLS.concealment.required, true);

  // Six left that no Skill opens, which keeps the effect-granted half of the gate from
  // being dead code nobody notices going stale.
  const opened = new Set(Object.values(DBUCharacterData.SKILLS)
    .map(s => s.specialManeuver).filter(Boolean));
  check("eight Special Maneuvers no Skill opens",
    allManeuvers().filter(m => m.special && !opened.has(m.id)).map(m => m.id).sort(),
    ["absorb", "act-again", "amplified-power-up", "area-wipe", "attack-absorption", "aura-tail", "back-to-basics-power-up", "bite-attack", "boom", "class-up-berserker-choice", "class-up-elite-choice", "class-up-hero-choice", "coup-de-grace-strike", "dance", "dark-saiya-evil-points", "darkness-mixer", "demonic-battle-strike", "dirty-trick", "draining-attack", "energy-synchronize", "erratic-basic-attack", "face-me-at-full-power", "float-mirror", "full-awakening", "get-up", "glassification", "goof", "greater-super-class-choice", "healing-surge-instant", "hocus-pocus", "insta-kill", "insult", "internal-attack", "junior-creation", "legendary-chaos-surge", "limit-of-the-super-saiyan-recovery", "limit-of-the-super-saiyan-surge", "liquid-form", "movement-instant", "movement-or-basic-instant", "mutants-resilience-counter", "one-man-army", "one-on-one-duel", "overflowing-surge", "pinnacle-of-legacy-power-up", "planet-burst", "possess", "power-drain", "rampaging-tail", "s-cells-power-up", "spiritual-master-surge", "stance", "stop-wasting-my-time", "tail-attack", "tides-of-time", "time-lag", "time-prison", "time-to-get-serious", "transfiguration", "unify", "unkillable-majin-from-goop", "unkillable-majin-regeneration", "whack", "zoom"]);

  // "Adventuring Maneuver: you gain access to the Gauge Maneuver." A seventh named and
  // none of them built, so the table carries none of them: a field naming a Maneuver the
  // library has not got is the one thing it refuses to hold.
  check("the Gauge Maneuver is not in the library", getManeuver("gauge") ?? null, null);
  check("and the Skill table names no Adventuring Maneuver at all",
    Object.values(DBUCharacterData.SKILLS).some(s => s.adventuringManeuver), false);
  check("which the entry is recorded as saying instead",
    CHARACTER.includes("It grants the Gauge Adventuring Maneuver as well"), true);
}

// --- A Clash that names a Skill you may not be able to roll ---------------------------------
{
  // Every Skill on either side of this one is Required, whatever the defender picks. Two
  // Clashes in the library are like that now, and they are not alike: the Treatment's door
  // asks whether its Medicine can be rolled before it opens the Clash, and this one has no
  // door of its own to ask at - Concealment is the answer and nothing else is offered.
  const clashes = allManeuvers()
    .filter(m => m.clash)
    .map(m => ({ id: m.id,
                 both: [m.clash.skill, ...(m.clash.defenderSkills ?? [])]
                   .every(key => DBUCharacterData.SKILLS[key]?.required) }));
  check("two Clashes are Required on both sides whatever is chosen",
    clashes.filter(c => c.both).map(c => c.id).sort(), ["sense", "treatment"]);
  check("where the Magic Trick's defender has a way out",
    getManeuver("magic-trick").clashDefenderSkills
      .filter(key => !DBUCharacterData.SKILLS[key].required),
    ["intuition"]);
  check("and the Treatment asks at its own door before it opens one",
    fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8")
      .includes("  const untrained = Boolean(actor.system.skills?.medicine?.untrained);"),
    true);

  // And the gap that turns up behind it, which was here before this Maneuver was: the
  // sheet refuses to roll a Required Skill at no Ranks and a Clash never asks. Pinned as
  // it stands rather than papered over - what happens when a Clash names a Skill you
  // cannot roll is in no entry here, so nothing picks a reading.
  check("the sheet refuses an untrained Required Skill",
    SHEET.includes("      `${skill.label} is a Required Skill and cannot be rolled without at least one Rank.`"),
    true);
  check("off a flag the character works out for itself",
    CHARACTER.includes("        untrained: Boolean(skill.required) && (ranks === 0),"), true);
  check("and no Clash asks it", CHAT.includes("untrained"), false);
  check("which the file records rather than deciding",
    TRAIT.includes("it is asked nowhere in a Clash"), true);
}

// --- There are no Transformations, which is why half of this is a question ----------------
{
  // The reason the second half of the reading is asked rather than answered, as a fact
  // instead of a comment. The day a Transformation exists, this fails and points here.
  // Transformations exist as files since 2026-11-19 (stage 1) - read, given, their bonuses and Aspects applied. What this Sense
  // would read of one, its ToP Requirement in use, waits on entering them (stage 4): still the ARC's.
  check("the library has them now, as files", traitsOfKind("transformations").length > 0, true);
  check("each under transformations/",
    INDEX.traits.filter(file => file.startsWith("transformations/")).length > 0, true);
  // Every Transformation-named field a character has, enumerated rather than asserted
  // about: the only one is a pair of per-Power-Level bonuses waiting for a Transformation
  // to write them. Nothing says which Transformation somebody is in, and nothing gives one
  // a Tier of Power Requirement to be the highest of.
  check("one Transformation-named field on a character, and it is not that",
    [...CHARACTER.matchAll(/schema\.(\w*[Tt]ransformation\w*)\s*=/g)].map(m => m[1]),
    ["transformationBonuses"]);
  check("which holds Life and Ki per Power Level and no requirement",
    CHARACTER.slice(CHARACTER.indexOf("schema.transformationBonuses"))
      .slice(0, 280).match(/(\w+): new fields/g),
    ["lifePerLevel: new fields", "kiPerLevel: new fields"]);
  check("so the card says the ARC tells it",
    CHAT.includes("what they sense, the ARC tells."), true);
  check("and the file says why rather than leaving the line out",
    TRAIT.includes("There are no Transformations in this system."), true);
}

// --- What a settled Sense leaves, run ------------------------------------------------------
{
  const notes = [];
  let flagged = null;
  const message = {
    speaker: { alias: "Tizi" },
    setFlag: async (scope, key, value) => { flagged = value; }
  };
  const settleSense = new Function(
    "fromUuidSync", "SCOPE", "CLASH_FLAG", "whoWonClash", "settledNote",
    `${source(CHAT, "settleSense")}\nreturn settleSense;`)(
      uuid => ({ "Actor.tizi": { name: "Tizi", uuid: "Actor.tizi" },
                 "Actor.kuro": { name: "Kuro", uuid: "Actor.kuro" } }[uuid] ?? null),
      "dbu-ttrpg", "clash",
      new Function(`${source(CHAT, "whoWonClash")}\nreturn whoWonClash;`)(),
      async (msg, text, options = {}) => { notes.push({ text, to: options.to?.name ?? null }); });

  const clash = (challenger, defender) => ({
    challengerUuid: "Actor.tizi", defenderUuid: "Actor.kuro",
    sense: { applied: false },
    result: { challenger, defender }
  });
  const run = async (c) => {
    notes.length = 0; flagged = null;
    await settleSense(message, c);
    return notes;
  };

  // Winning: one line for the room - what is read, the ARC's to tell (the user's).
  const won = await run(clash({ succeeded: true, total: 9 }, { succeeded: false, total: 4 }));
  check("one note on a win", won.length, 1);
  check("the room is told it landed and no more",
    won[0], { text: "Tizi gets a read on Kuro - what they sense, the ARC tells.", to: null });

  // A tie goes to the Defender, here as everywhere else.
  const tied = await run(clash({ succeeded: false, total: 7 }, { succeeded: false, total: 7 }));
  check("a tie is a loss for the sensor", tied.length, 1);
  check("and is said out loud, since nothing private happened",
    tied[0], { text: "Tizi cannot get a fix on Kuro.", to: null });
  const lost = await run(clash({ succeeded: false, total: 3 }, { succeeded: true, total: 8 }));
  check("as is losing outright",
    lost[0], { text: "Tizi cannot get a fix on Kuro.", to: null });
  check("and nothing is read on a loss", lost.length, 1);

  // Marked before anything else, so a failure halfway through does not settle twice.
  check("the card is marked settled", flagged.sense.applied, true);
  check("and the dispatch will not come back to it",
    CHAT.includes("  if (clash.sense && clash.result && !clash.sense.applied) {"), true);
  check("nor reach it before the dice are in",
    CHAT.includes("clash.sense && clash.result"), true);

  // A card for somebody who has left the scene settles into nothing rather than throwing.
  notes.length = 0;
  await settleSense(message, { ...clash({ succeeded: true }, {}), defenderUuid: "Actor.gone" });
  check("a missing side leaves no note", notes.length, 0);
}

// --- Whispered, and only this one ----------------------------------------------------------
{
  const whisperTo = new Function("game", `${source(CHAT, "whisperTo")}\nreturn whisperTo;`);
  const users = [
    { id: "gm", isGM: true }, { id: "ivo", isGM: false }, { id: "other", isGM: false }
  ];
  const owned = (...ids) => whisperTo({ users: { filter: f => users.filter(f) } })({
    testUserPermission: (user, level) => (level === "OWNER") && ids.includes(user.id)
  });

  check("the owner and the GM", owned("ivo").sort(), ["gm", "ivo"]);
  check("the GM whether or not anybody owns them", owned().sort(), ["gm"]);
  check("two owners and the GM", owned("ivo", "other").sort(), ["gm", "ivo", "other"]);
  check("and a GM who also owns them appears once", owned("gm", "ivo").sort(), ["gm", "ivo"]);

  // The other eight settlements read their outcome out, and that is the point of them.
  // This change touched the function all nine call, so what is pinned is that exactly one
  // call keeps its note back.
  const settledNote = new Function(
    "ChatMessage", "Handlebars", "whisperTo",
    `${source(CHAT, "settledNote")}\nreturn settledNote;`);
  let made = null;
  const say = (...args) => settledNote(
    { create: async data => { made = data; } },
    { escapeExpression: String },
    () => ["gm", "ivo"])(...args);

  await say({ speaker: { alias: "Tizi" } }, "Kuro is Prone.");
  check("a note with nobody named is public",
    Object.prototype.hasOwnProperty.call(made, "whisper"), false);
  check("and carries the text", made.content.includes("Kuro is Prone."), true);

  await say({ speaker: { alias: "Tizi" } }, "secret", { to: { name: "Tizi" } });
  check("a note with somebody named is kept to them", made.whisper, ["gm", "ivo"]);

  // One: Power Regulation's - what Gauge and the Sense read is the ARC's to tell (the user's).
  check("and exactly one settlement keeps one back",
    (CHAT.match(/settledNote\([^;]*\{ to:/g) ?? []).length, 1);
  check("Power Regulation's",
    CHAT.includes("{ to: actor });\n    });\n    at.append(button);"), true);
  check("not Gauge's", CHAT.includes("{ to: gauger });"), false);
  check("and the Sense keeps none: what it reads is the ARC's",
    CHAT.includes("senseReading"), false);
  check("the escaping is still done, secret or not",
    CHAT.includes("${Handlebars.escapeExpression(text)}"), true);
}

// --- The payload reaches the card ----------------------------------------------------------
{
  // Through `leaves` rather than a key of its own in postSkillClash. Naming them one at a
  // time is how the Blockade's payload went missing for a session.
  check("the Clash carries it",
    USE.includes("        ...(maneuver.sense ? { sense: { applied: false } } : {})"), true);
  check("down the Skill Clash branch",
    USE.indexOf("...(maneuver.sense") >
      USE.indexOf("    : maneuver.clash\n    ? await postSkillClash("), true);
  check("and postSkillClash spreads whatever it is handed",
    CHAT.includes("          ...leaves,"), true);
}

console.log(`${failed} failing`);
process.exit(failed ? 1 : 0);
