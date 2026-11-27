/**
 * The Flip Maneuver: a Maneuver whose whole effect this system will not carry out.
 *
 * "Move a number of Squares up to twice your number of Skill Ranks in Acrobatics." Nothing
 * here moves a token - that is a thing the table kept on purpose - so what is built is the
 * number and the two sentences that go with it, and what is checked is that the card
 * actually says them.
 *
 * The other half is what it does NOT do: "this movement does not provoke the Exploit
 * Maneuver". Nothing had to be switched off for that, and a check that says so is worth
 * more than the switch would have been - it is the kind of thing that gets "fixed" into
 * existence later.
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
const { default: DBUCharacterData } = await import(modUrl("data/actor-character.mjs"));
await loadTraits();
await loadManeuvers();

const TRAIT = fs.readFileSync(path.join(TRAITS, "maneuvers", "flip.dbu"), "utf8");
const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
const USE = fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8");
const ITEM = fs.readFileSync(path.join(ROOT, "module", "data", "item-maneuver.mjs"), "utf8");
const INDEX = JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

/** One top-level function out of a module, to be run rather than read. */
function source(text, name) {
  let at = text.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`no ${name}`);
  if (text.slice(at - 6, at) === "async ") at -= 6;
  return text.slice(at, text.indexOf("\n}\n", at) + 2);
}

// --- The Maneuver as the rulebook lists it ------------------------------------------------
{
  check("listed", INDEX.traits.includes("maneuvers/flip.dbu"), true);

  const flip = getManeuver("flip");
  check("loaded as a Standard Maneuver", flip?.type, "standard");
  check("costing an Action", flip.actionCost, 1);
  check("and no Ki", flip.kiCost, 0);
  check("once a Combat Round", flip.usageLimit, { amount: 1, per: "round" });
  check("it is Special", flip.special, true);
  check("aimed at nobody", Boolean(flip.requiresTarget), false);
  check("and it is not an attack", Boolean(flip.attacking), false);

  for (const line of [
    "Move a number of Squares up to twice your number of Skill Ranks in Acrobatics",
    "you may move through Squares occupied by an Opponent, as long as you do not end your\n  movement on an occupied Square",
    "This movement does not provoke the Exploit Maneuver,\n  even if you leave the Melee Range of an Opponent"
  ]) {
    check(`the entry says "${line.slice(0, 44).replace(/\n\s+/g, " ")}"`,
      TRAIT.includes(line), true);
  }

  // The rule is in the file as a Skill and a multiplier, not as code.
  check("the Skill it counts", flip.moveSkill, "acrobatics");
  check("and what a Rank of it is worth", flip.movePerRank, 2);
  check("which is a Skill a character has", Boolean(DBUCharacterData.SKILLS.acrobatics), true);
  check("and one that needs no Rank before it can be rolled at all",
    Boolean(DBUCharacterData.SKILLS.acrobatics.required), false);

  // And the rest of the rule in the entry's own words, to be said rather than done.
  check("what it tells the table is carried whole", flip.says.includes(
    "you do not end your movement on an occupied Square"), true);
  check("including the half about the Exploit", flip.says.includes(
    "does not provoke the Exploit Maneuver"), true);

  // Onto an Item and back off it.
  const item = maneuverItemFrom(flip);
  check("the Item carries all three",
    [item.system.moveSkill, item.system.movePerRank, Boolean(item.system.says)],
    ["acrobatics", 2, true]);
  const read = definitionOf({ id: "x", name: flip.name,
    system: { ...item.system, maneuverId: flip.id } });
  check("and reading it back gives them up",
    [read.moveSkill, read.movePerRank, read.says === flip.says], ["acrobatics", 2, true]);
}

// --- What the card says, run ------------------------------------------------------------------
{
  const maneuverNote = new Function(`${source(USE, "moveRanks")}\n${source(USE, "maneuverNote")}\nreturn maneuverNote;`)();
  const flip = getManeuver("flip");
  const who = (ranks) => ({
    system: { skills: { acrobatics: { ranks, label: "Acrobatics" } } }
  });

  check("four Ranks is eight Squares",
    maneuverNote(who(4), flip).startsWith("Move up to 8 Squares - 2 per Rank of Acrobatics, "
      + "and you have 4."), true);
  check("one Rank is two",
    maneuverNote(who(1), flip).startsWith("Move up to 2 Squares"), true);

  // A single Square is singular, which is the sort of thing nobody checks and everybody
  // notices. There is no half-Rank, so this needs a multiplier of one to reach.
  check("and one Square is a Square, not Squares",
    maneuverNote(who(1), { ...flip, movePerRank: 1 })
      .startsWith("Move up to 1 Square - "), true);

  // No Ranks is no allowance, said as that rather than as an offer of zero.
  check("no Ranks moves you nowhere, and says so",
    maneuverNote(who(0), flip),
    "No Ranks in Acrobatics, so this moves you nowhere. " + flip.says.trim());

  // The rest of the rule rides along with the number.
  check("the sentence the entry prints goes with it",
    maneuverNote(who(3), flip).includes("do not end your movement on an occupied Square"),
    true);
  check("and the one about the Exploit",
    maneuverNote(who(3), flip).includes("does not provoke the Exploit Maneuver"), true);

  // Everything else is unchanged: a Maneuver with nothing to say says nothing.
  check("a Maneuver that says nothing prints nothing",
    maneuverNote(who(4), getManeuver("basic-attack")), "");
  check("and one with a sentence but no Squares prints the sentence",
    maneuverNote(who(4), { says: "Something the table rules on." }),
    "Something the table rules on.");

  // The card takes it, beside anything else the Maneuver has to say for itself - which
  // since the Liquid Form Maneuver is which way a State was thrown.
  // Three notes on the list now - the Soar Maneuver says where it took them - and they
  // are still joined rather than one overwriting the next, which is what this is about.
  check("the card is given the note",
    USE.includes("        note: [stood ? \"Stops being Prone instead of moving (Acrobat Star).\" : maneuverNote(actor, maneuver), stateNote(maneuver, toggled),"),
    true);
  check("joined rather than one overwriting the other",
    USE.includes('          .filter(Boolean).join(" "),'), true);
  check("and prints it under the Maneuver's name",
    CHAT.includes('${note ? `<div class="dbu-maneuver-note">'), true);
}

// --- What it does not provoke -------------------------------------------------------------------
{
  const flip = getManeuver("flip");

  // "Exploitable: N/A", so there is no line, so nothing is offered. Nothing had to be
  // switched off - and this check is here so nothing switches it on later.
  check("its Exploitable line is empty", flip.exploitable, "");
  check("and an Exploit is offered off that line alone",
    CHAT.includes("  if (!card || !maneuver?.exploitable) return;"), true);

  // Which is the door the Movement Maneuver goes through, and it has a line.
  check("where the Movement Maneuver does have one",
    getManeuver("movement").exploitable, "If you leave the Melee Range of an Opponent.");
  check("so this is not that", flip.exploitable === getManeuver("movement").exploitable,
    false);

  // And it is not the Movement Maneuver, which matters for more than the Exploit: a
  // Movement can be Blockaded, can be paid for at Boosted Speed, and can buy Rapid
  // Movement. None of those are this.
  check("it is not the Movement Maneuver", Boolean(flip.movement), false);
  check("so nothing asks it how fast it went",
    USE.includes("  if (maneuver.movement) {"), true);
}

// --- A schema that declares a field twice ---------------------------------------------------------
{
  // A duplicate key in an object literal is legal JavaScript and the last one wins, so a
  // field declared twice is silent - which is exactly what happened here when a script that
  // failed halfway was rerun. Two fields ended up with two declarations each and nothing
  // said a word.
  const declared = [...ITEM.matchAll(/^ {6}(\w+): new fields\./gm)].map(m => m[1]);
  const twice = [...new Set(declared.filter(name =>
    declared.filter(other => other === name).length > 1))].sort();

  check("the Maneuver schema declares each field once", twice, []);
  check("and there are plenty of them to get wrong", declared.length > 40, true);

  // The character's own schema too, which is the bigger of the two.
  const CHAR = fs.readFileSync(
    path.join(ROOT, "module", "data", "actor-character.mjs"), "utf8");
  const chars = [...CHAR.matchAll(/^ {4}schema\.(\w+) = new fields\./gm)].map(m => m[1]);
  const charTwice = [...new Set(chars.filter(name =>
    chars.filter(other => other === name).length > 1))].sort();
  check("and so does the character's", charTwice, []);
}

// --- Special, and opened by nothing read yet --------------------------------------------------------
{
  const flip = getManeuver("flip");

  // "Special Maneuver: you gain access to the Flip Maneuver", in Acrobatics' own entry.
  check("Acrobatics opens it",
    DBUCharacterData.SKILLS.acrobatics.specialManeuver, "flip");

  const who = (ranks) => ({
    name: "Tizi",
    system: {
      effects: { slots: {} },
      specialManeuvers: [{ maneuver: "flip", skill: "Acrobatics", ranks, needs: 2,
                           open: ranks >= 2 }]
    }
  });
  check("one Rank is short, and says by how much",
    whyNotSpecial(who(1), flip), "Flip opens at 2 Ranks of Acrobatics, and Tizi has 1.");
  check("two Ranks opens it", whyNotSpecial(who(2), flip), null);

  // Which is also the Skill this entry counts for distance - a coincidence of this
  // Maneuver rather than a rule, and the pair that proves it is still there.
  check("the Skill that opens it and the Skill it counts are the same here",
    [DBUCharacterData.SKILLS.acrobatics.specialManeuver, flip.moveSkill],
    ["flip", "acrobatics"]);
  check("which they need not be, as Bluff shows",
    [DBUCharacterData.SKILLS.bluff.specialManeuver, getManeuver("dirty-trick").clashSkill],
    ["feint", "bluff"]);
  check("so nothing opens the Dirty Trick", Object.values(DBUCharacterData.SKILLS)
    .some(s => s.specialManeuver === "dirty-trick"), false);

  // Nineteen of them now, across three kinds.
  check("and these are the Special ones",
    allManeuvers().filter(m => m.special).map(m => m.id).sort(),
    ["absorb", "act-again", "amplified-power-up", "analysis", "area-wipe", "attack-absorption", "aura-tail", "back-to-basics-power-up", "bite-attack", "boom", "brace", "class-up-berserker-choice", "class-up-elite-choice", "class-up-hero-choice", "coup-de-grace-strike", "dance", "dark-saiya-evil-points", "darkness-mixer", "demonic-battle-strike", "dirty-trick", "draining-attack", "eject", "energy-synchronize", "erratic-basic-attack", "face-me-at-full-power", "feint", "flip", "float-mirror", "full-awakening", "get-up", "glassification", "goof", "greater-super-class-choice", "healing-surge-instant", "hide", "hocus-pocus", "holding-back", "hype", "insta-kill", "insult", "internal-attack", "intuit", "junior-creation", "legendary-chaos-surge", "limit-of-the-super-saiyan-recovery", "limit-of-the-super-saiyan-surge", "liquid-form", "magic-trick", "movement-instant", "movement-or-basic-instant", "mutants-resilience-counter", "one-man-army", "one-on-one-duel", "overflowing-surge", "pinnacle-of-legacy-power-up", "planet-burst", "possess", "power-drain", "rampaging-tail", "repair", "s-cells-power-up", "search", "sense", "snatch", "soar", "spiritual-master-surge", "stance", "stop-wasting-my-time", "tail-attack", "talk", "terrify", "tides-of-time", "time-lag", "time-prison", "time-to-get-serious", "transfiguration", "treatment", "unify", "unkillable-majin-from-goop", "unkillable-majin-regeneration", "whack", "zoom"]);
}

console.log(`${failed} failing`);
process.exit(failed ? 1 : 0);
