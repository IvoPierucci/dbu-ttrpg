/**
 * The Treatment Maneuver: the first thing here that puts Life Points on somebody else.
 *
 * Four things worth running.
 *
 * The healing. "2d10(bT) plus your Skill Bonus in Medicine", halved when the poison is
 * being gone after, capped at their maximum - and what is reported is what actually went
 * on rather than what was rolled.
 *
 * Which of the two poison routes it is, which turns on a fact this system does not hold:
 * who gave somebody a Condition. There is exactly one place that is ever recorded - a
 * Condition given on a clock names whoever keeps it - so `whoInflicted` reads that, and
 * the rest is asked.
 *
 * The Clash route's settlement, where the Condition comes off a third character: the Ally
 * is neither side of a Clash rolled against whoever poisoned them.
 *
 * And Medicine being a Required Skill, which makes the poison half unreachable without a
 * Rank - refused at this Maneuver's own door, since a Clash still never asks.
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

const { loadTraits, getTrait } = await import(modUrl("effects/traits.mjs"));
const { loadManeuvers, getManeuver, allManeuvers, whyNotSpecial, MANEUVER_TYPES } =
  await import(modUrl("maneuvers.mjs"));
const { maneuverItemFrom, definitionOf } = await import(modUrl("use-maneuver.mjs"));
const { KINDS, whoInflicted } = await import(modUrl("durations.mjs"));
const { default: DBUCharacterData } = await import(modUrl("data/actor-character.mjs"));
await loadTraits();
await loadManeuvers();

const TRAIT = fs.readFileSync(path.join(TRAITS, "maneuvers", "treatment.dbu"), "utf8");
const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
const USE = fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8");
const DUR = fs.readFileSync(path.join(ROOT, "module", "durations.mjs"), "utf8");
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

// --- The Maneuver as the rulebook lists it -----------------------------------------------------
{
  check("listed", INDEX.traits.includes("maneuvers/treatment.dbu"), true);

  const tr = getManeuver("treatment");
  check("loaded as a Standard Maneuver", tr?.type, "standard");
  check("costing two Actions", tr.actionCost, 2);
  check("which is what a Standard Maneuver spends",
    MANEUVER_TYPES.standard.action, "standard");
  check("once a Combat Round", tr.usageLimit, { amount: 1, per: "round" });
  check("it is Special", tr.special, true);
  check("aimed at somebody", tr.requiresTarget, true);
  check("and it is not an attack", Boolean(tr.attacking), false);
  check("no Ki, which is what N/A means", tr.kiCost, 0);
  check("and none per Tier either", tr.kiCostPerTier ?? 0, 0);
  check("it is the flag it is", tr.treatment, true);
  check("its Exploitable line is carried as printed",
    tr.exploitable, "All adjacent Opponents.");

  for (const line of [
    "Target an Ally within your Melee Range",
    "Increase their Life Points by\n  2d10(bT) plus your Skill Bonus in Medicine",
    "you can reduce the amount of Life Points they gain by 1/2",
    "Skill Clash (Medicine vs Medicine/Craft: Basic Item) against the Character who gave",
    "If you win, remove the Combat Condition",
    "other than through the effects of another\n  Character",
    "simply make an Medicine Skill Check with the Apprentice Difficulty"
  ]) {
    check(`the entry says "${line.slice(0, 44).replace(/\n\s+/g, " ")}"`,
      TRAIT.includes(line), true);
  }

  const item = maneuverItemFrom(tr);
  check("the Item carries the flag", item.system.treatment, true);
  check("and reading it back gives it up",
    definitionOf({ id: "x", name: tr.name,
      system: { ...item.system, maneuverId: tr.id } }).treatment, true);

  // "2 Skill Ranks in Medicine give the Treatment Maneuver" - which was the obvious guess,
  // and the guess was worth nothing until it was said: the Dirty Trick is a Clash made with
  // Bluff and Bluff opens the Feint instead.
  check("Medicine is the Skill that opens it",
    DBUCharacterData.SKILLS.medicine.specialManeuver, "treatment");
  check("which is also the Skill it rolls, and the one its healing reads a Bonus off",
    [tr.clashSkill, source(USE, "healAlly").includes("skills?.medicine?.bonus")],
    ["medicine", true]);
  check("and Bluff is the pair that shows those are two questions",
    [DBUCharacterData.SKILLS.bluff.specialManeuver, getManeuver("dirty-trick").clashSkill],
    ["feint", "bluff"]);

  const ranks = (n) => ({
    name: "Tizi",
    system: {
      effects: { slots: {} },
      specialManeuvers: [{ maneuver: "treatment", skill: "Medicine", ranks: n, needs: 2,
                           open: n >= 2 }]
    }
  });
  check("one Rank short, and the reason says by how much",
    whyNotSpecial(ranks(1), tr), "Treatment opens at 2 Ranks of Medicine, and Tizi has 1.");
  check("two Ranks opens it", whyNotSpecial(ranks(2), tr), null);
}

// --- Which makes one of its own refusals unreachable from that road -----------------------------
{
  // Medicine is Required, so Treatment opens one Rank after the Skill becomes rollable -
  // and two Ranks is one more than rolling it needs. Nobody who opened this Maneuver
  // through the Skill can meet its untrained refusal.
  check("Medicine is Required", DBUCharacterData.SKILLS.medicine.required, true);
  check("so the Skill becomes rollable at one Rank",
    DBUCharacterData.SKILLS.medicine.required && (DBUCharacterData.SKILL_MANEUVER_RANKS > 1),
    true);
  check("and the Maneuver opens at two", DBUCharacterData.SKILL_MANEUVER_RANKS, 2);

  // Which does not make the refusal dead: a Special Maneuver has two roads, and the other
  // one hands it to whoever an effect likes.
  const granted = {
    name: "Tizi",
    system: {
      effects: { slots: { "maneuver.treatment": true } },
      specialManeuvers: [{ maneuver: "treatment", skill: "Medicine", ranks: 0, needs: 2,
                           open: false }]
    }
  };
  check("an effect opens it at no Ranks at all",
    whyNotSpecial(granted, getManeuver("treatment")), null);
  check("which is the only way to meet the untrained refusal",
    TRAIT.includes("is the only way to meet the refusal"), true);
  check("and the refusal is still there to be met",
    USE.includes("  const untrained = Boolean(actor.system.skills?.medicine?.untrained);"),
    true);
}

// --- Healing somebody else, run ------------------------------------------------------------------
{
  // `healAlly` is where the arithmetic lives. Run with the Roll and the write stubbed, so
  // what is checked is the numbers rather than the plumbing.
  let took = null;
  const rolled = () => took.formula;

  const healAlly = new Function(
    "Roll", "ChatMessage", "stub",
    `${source(USE, "healAlly").replace(
      'const { requestActorUpdate } = await import("./chat.mjs");',
      "const { requestActorUpdate } = stub;")}
     return healAlly;`)(
      class {
        constructor(formula, data) { took.formula = formula; took.data = data; }
        async evaluate() { this.total = TOTAL; }
        async toMessage(options) { took.flavor = options.flavor; }
      },
      { getSpeaker: () => ({}) },
      { requestActorUpdate: (actor, changes) => { took.written = changes; } });

  globalThis.TOTAL = 0;
  const run = async (baseTier, medicine, life, total, halved = false) => {
    globalThis.TOTAL = total;
    took = { formula: "", data: null, written: null, flavor: "" };
    const actor = {
      name: "Tizi",
      system: {
        baseTierOfPower: baseTier,
        skills: { medicine: { bonus: medicine } }
      }
    };
    const ally = { name: "Kuro", system: { life } };
    const ok = await healAlly(actor, ally, { name: "Treatment" }, halved);
    return { ok, ...took };
  };

  // "2d10(bT)" is two dice per Base Tier of Power - the way every (bT) handful is read.
  check("two dice at Base Tier 1", (await run(1, 0, { value: 0, max: 99 }, 7)).formula,
    "2d10 + @bonus");
  check("four at Base Tier 2", (await run(2, 0, { value: 0, max: 99 }, 7)).formula,
    "4d10 + @bonus");
  check("ten at Base Tier 5", (await run(5, 0, { value: 0, max: 99 }, 7)).formula,
    "10d10 + @bonus");
  check("and never none, whatever the sheet says",
    (await run(0, 0, { value: 0, max: 99 }, 7)).formula, "2d10 + @bonus");

  // The Base Tier, not the current one: a Transformation does not make a doctor better at
  // medicine.
  check("read off the Base Tier of Power",
    source(USE, "healAlly").includes("actor.system.baseTierOfPower"), true);
  check("and never the current Tier",
    source(USE, "healAlly").includes("system.tierOfPower"), false);

  // "Plus your Skill Bonus in Medicine" - the Bonus, not a roll of it.
  check("the Medicine Skill Bonus rides the formula",
    (await run(1, 6, { value: 0, max: 99 }, 7)).data, { bonus: 6 });
  check("as a Bonus rather than a roll of the Skill",
    source(USE, "healAlly").includes("skills?.medicine?.bonus"), true);

  // What lands on them.
  check("what was rolled is what they get",
    (await run(1, 0, { value: 10, max: 99 }, 12)).written, { "system.life.value": 22 });
  check("capped at their maximum",
    (await run(1, 0, { value: 95, max: 99 }, 12)).written, { "system.life.value": 99 });
  check("and somebody already full is written nothing at all",
    (await run(1, 0, { value: 99, max: 99 }, 12)).written, null);
  check("which the card says rather than claiming a number that went nowhere",
    (await run(1, 0, { value: 95, max: 99 }, 12)).flavor.includes(
      "regains 4 Life Points - the rest had nowhere to go"), true);
  check("one Life Point is singular",
    (await run(1, 0, { value: 0, max: 99 }, 1)).flavor.includes("regains 1 Life Point"),
    true);

  // Halved when the poison is being gone after. Rounded down, which the entry does not say
  // - the halvings here that round up say so.
  check("halved for going after the poison",
    (await run(1, 0, { value: 0, max: 99 }, 12, true)).written,
    { "system.life.value": 6 });
  check("and rounded down on an odd number",
    (await run(1, 0, { value: 0, max: 99 }, 13, true)).written,
    { "system.life.value": 6 });
  check("which the card says, with what it was halved from",
    (await run(1, 0, { value: 0, max: 99 }, 13, true)).flavor.includes(
      "(half of 13, to go after the poison)"), true);
  check("and says nothing of the sort when it was not",
    (await run(1, 0, { value: 0, max: 99 }, 13)).flavor.includes("half of"), false);
}

// --- Who gave it to them, run ----------------------------------------------------------------------
{
  // The one place this is ever recorded: a Condition given on a clock names whoever keeps
  // the clock. Which is how the Terrify's Shaken works, so this is not dead code - it
  // reads a shape something in the library actually writes.
  const kuro = { uuid: "Actor.kuro", system: { timed: [] } };
  const goro = { uuid: "Actor.goro", system: { timed: [] } };
  const mika = { uuid: "Actor.mika", system: { timed: [] } };
  const scene = (...actors) => {
    globalThis.canvas = { tokens: { placeables: actors.map(actor => ({ actor })) } };
  };

  scene(kuro, goro, mika);
  check("nobody, when nothing recorded it",
    whoInflicted(kuro, KINDS.CONDITION, "poisoned"), null);

  goro.system.timed = [
    { kind: "condition", key: "poisoned", edge: "encounter", on: "Actor.kuro" }
  ];
  check("whoever is keeping a clock about them",
    whoInflicted(kuro, KINDS.CONDITION, "poisoned"), "Actor.goro");
  check("but not about a different Condition",
    whoInflicted(kuro, KINDS.CONDITION, "shaken"), null);
  check("nor about somebody else",
    whoInflicted(goro, KINDS.CONDITION, "poisoned"), null);

  // The case that tells a working sweep from one that matches on the kind and the key and
  // forgets who the clock is about. Goro is poisoning Kuro; ask about Mika, who is standing
  // right there and has nothing to do with it. A sweep that drops the `on` answers "Goro".
  check("and a clock about a third character answers for nobody else",
    whoInflicted(mika, KINDS.CONDITION, "poisoned"), null);
  check("while the one it is about still gets their answer",
    whoInflicted(kuro, KINDS.CONDITION, "poisoned"), "Actor.goro");

  // A Condition somebody put on themselves names themselves, which is true and is an
  // answer to the question that was asked.
  kuro.system.timed = [{ kind: "condition", key: "prone", edge: "end" }];
  goro.system.timed = [];
  check("and somebody who did it to themselves is themselves",
    whoInflicted(kuro, KINDS.CONDITION, "prone"), "Actor.kuro");
  check("nothing asked about is nobody",
    [whoInflicted(null, KINDS.CONDITION, "poisoned"),
     whoInflicted(kuro, KINDS.CONDITION, "")], [null, null]);

  // The shape it reads is the shape the Terrify writes.
  check("which is the shape the Terrify's Shaken is written in",
    CHAT.includes("  await lasting(terrifier, {\n"
      + "    kind: KINDS.CONDITION,\n"
      + '    key: "shaken",'), true);
  check("and nothing inflicts Poisoned at all yet",
    allManeuvers().filter(m => (m.script ?? "").includes("poisoned")).length, 0);
  check("so the answer is asked, with what the clock knows offered first",
    USE.includes('  const recorded = whoInflicted(ally, KINDS.CONDITION, "poisoned");'),
    true);
  check("which the file says is the only thing that can be right about it",
    TRAIT.includes("Asking is not a\n# fallback here"), true);
}

// --- Which of the two routes, run -----------------------------------------------------------------
{
  // `treatAlly` is the fork itself: whether the question is put at all, and what opening it
  // leads to. Run with the dialog and the healing stubbed, so what is checked is the
  // branching.
  const log = [];
  const treatAlly = new Function(
    "ui", "askTreatment", "healAlly", "fromUuidSync", "DBUCharacterData", "stub", "askDoctorRemoval",
    `${source(USE, "treatAlly").replace(
      'const { postSkillClash, postManeuver } = await import("./chat.mjs");',
      "const { postSkillClash, postManeuver } = stub;")}
     return treatAlly;`)(
      { notifications: { warn: (text) => { log.push(`warn:${text}`); } } },
      async () => { log.push("asked"); return ANSWER; },
      async (actor, ally, maneuver, halved) => { log.push(`healed:${halved}`); return true; },
      uuid => (uuid === "Actor.goro") ? { uuid, name: "Goro" } : null,
      DBUCharacterData,
      {
        postSkillClash: async (actor, target, maneuver, leaves) => {
          log.push(`clash:${target.name}:${leaves.treatment.allyName}`);
          return { id: "c1" };
        },
        postManeuver: async (actor, maneuver, options) => {
          log.push(`check:${options.curePoison.allyName}:${options.curePoison.treaterUuid}`);
          return { id: "c2" };
        }
      },
      async () => "");

  globalThis.ANSWER = { cure: false, byUuid: "" };
  let gave = null;
  const run = async (answer, poisoned, ally = true) => {
    globalThis.ANSWER = answer;
    log.length = 0;
    gave = await treatAlly(
      { uuid: "Actor.tizi", name: "Tizi" },
      ally ? { uuid: "Actor.kuro", name: "Kuro",
               system: { conditions: poisoned ? { poisoned: 1 } : {} } } : null,
      { name: "Treatment" });
    return [...log];
  };

  // "If an Ally is suffering from the Poisoned Combat Condition" is the whole of the
  // clause, so an Ally who is not is never asked - a question with one answer is a
  // question nobody should be put through.
  check("an Ally who is not Poisoned is never asked",
    await run({ cure: false, byUuid: "" }, false), ["healed:false"]);
  check("and is healed in full",
    (await run({ cure: false, byUuid: "" }, false)).includes("healed:true"), false);
  check("a Poisoned one is asked", (await run({ cure: false, byUuid: "" }, true))[0], "asked");
  check("and healed in full if they say no",
    await run({ cure: false, byUuid: "" }, true), ["asked", "healed:false"]);

  // Taking the poison route halves the healing and opens one of the two.
  check("somebody to blame opens the Clash against them",
    await run({ cure: true, byUuid: "Actor.goro" }, true),
    ["asked", "healed:true", "clash:Goro:Kuro"]);
  check("and nobody to blame opens the Check instead",
    await run({ cure: true, byUuid: "" }, true),
    ["asked", "healed:true", "check:Kuro:Actor.tizi"]);
  check("the healing is halved before either of them either way",
    (await run({ cure: true, byUuid: "Actor.goro" }, true)).indexOf("healed:true")
      < (await run({ cure: true, byUuid: "Actor.goro" }, true)).indexOf("clash:Goro:Kuro"),
    true);

  // Backing out of the question spends nothing - and says so, which is the half that is
  // not in the log: what comes back is the card the routing hands on, so a use that was
  // called off has to answer false rather than something truthy that is not a card.
  check("backing out heals nobody", await run(null, true), ["asked"]);
  check("and answers false rather than a card that does not exist",
    (await run(null, true), gave), false);
  check("where a use that went through hands back what it opened",
    (await run({ cure: true, byUuid: "Actor.goro" }, true), gave), { id: "c1" });
  check("and the Check route hands back its own card",
    (await run({ cure: true, byUuid: "" }, true), gave), { id: "c2" });

  // And no Ally at all is a refusal by name, the way the Empower refuses.
  check("no target is refused rather than guessed at",
    await run({ cure: false, byUuid: "" }, false, false),
    ["warn:Tizi needs an Ally to treat. Target a token first."]);
  check("and refused with a false, not a card",
    (await run({ cure: false, byUuid: "" }, false, false), gave), false);
}

// --- The two routes ----------------------------------------------------------------------------------
{
  const tr = getManeuver("treatment");

  // "A Skill Clash (Medicine vs Medicine/Craft: Basic Item)". The slash is a choice, and
  // one of the two is the challenger's own Skill - the Magic Trick's and the Terrify's are
  // the other two like that.
  check("made with Medicine", tr.clashSkill, "medicine");
  check("and answered with Medicine or Craft", tr.clashDefenderSkills,
    ["medicine", "craft"]);
  check("both of which are Skills a character has",
    tr.clashDefenderSkills.every(key => Boolean(DBUCharacterData.SKILLS[key])), true);
  check("the library's copy carries both halves", tr.clash,
    { skill: "medicine", defenderSkills: ["medicine", "craft"] });

  // "Craft: Basic Item" is a Skill of its own now - `craft` is Craft (Basic Item) - so the defender's
  // Craft is exactly the one the entry names.
  check("Craft is Craft (Basic Item), the one the entry names",
    DBUCharacterData.SKILLS.craft.label, "Craft (Basic Item)");
  // What would be checking it is code reading a specialisation - not the words "Basic Item",
  // which the Gear's own comments and messages now say throughout.
  check("and nothing checks what it is about",
    /speciali[sz]ation[^\n]*Basic Item/.test(CHAT) || /speciali[sz]ation[^\n]*Basic Item/.test(USE),
    false);
  check("and the card names it - no longer the table's to judge",
    USE.includes("Their side may answer with Medicine or with Craft (Basic Item)."), true);
  check("and that Craft is the Skill they roll either way",
    USE.includes("may answer with Medicine or with Craft"), true);

  // The Clash is only ever opened for the poison half, which is why the routing asks about
  // this Maneuver above the generic Clash branch.
  check("the Maneuver is routed above the generic Clash branch",
    USE.indexOf("    : maneuver.treatment") < USE.indexOf("    : maneuver.clash"), true);
  check("so an ordinary use opens none at all",
    USE.includes("  if (!chosen.cure) return healed;"), true);

  // And the other route opens no Clash either: there is nobody to Clash with.
  check("no culprit means no Clash", USE.includes("  if (culprit) {"), true);
  check("and a card that says which roll is owed instead",
    USE.includes("makes a Medicine Skill Check at the ${apprentice.label} Difficulty `"),
    true);
}

// --- The Apprentice Difficulty, which has a number now ------------------------------------------------
{
  // It did not when this Maneuver was built, and this was the entry that made the gap
  // load-bearing: Clairvoyance's ARC Tips had asked for a Difficulty Category too, and
  // that was advice where this is a stat line.
  check("Apprentice is a Difficulty the system knows",
    DBUCharacterData.DIFFICULTIES.apprentice, { label: "Apprentice", tn: 10 });

  // The card names it with its number, rather than calling it the ARC's.
  check("the card says which Difficulty is owed, and what it asks for",
    USE.includes("makes a Medicine Skill Check at the ${apprentice.label} Difficulty `")
      && USE.includes("- Target Number ${apprentice.tn}, matched or exceeded."), true);
  check("read off the table rather than written out again",
    USE.includes("  const apprentice = DBUCharacterData.DIFFICULTIES.apprentice;"), true);
  check("as the button's own tooltip is",
    CHAT.includes("  const apprentice = DBUCharacterData.DIFFICULTIES.apprentice;"), true);
  check("so neither can drift from the table",
    [USE, CHAT].every(text => !/Apprentice Difficulty - Target Number 10/.test(text)), true);
  check("and a button takes the poison off once it was made",
    CHAT.includes('  button.textContent = "The Check was made - remove the poison";'), true);
  check("drawn for whoever is owed the Check, not for whoever is Poisoned",
    CHAT.includes("  const treater = fromUuidSync(cure.treaterUuid);"), true);
  check("named on the card, since a speaker carries an id and not a uuid",
    USE.includes("      treaterUuid: actor.uuid,"), true);
  check("gone once it has been pressed",
    CHAT.includes("  if (!cure || cure.applied) return;"), true);
  check("through the relay, like every other edit to a card",
    CHAT.includes('    case "cure": return applyCure(request.messageId, request.cure);'),
    true);
  check("and the file records why the two cards are still separate",
    TRAIT.includes("The two are separate cards and nothing joins them"), true);
  check("which names the refactor that would join them",
    TRAIT.includes("lifting the sheet's roll out into something both can call"), true);
}

// --- What a settled Treatment Clash leaves, run -------------------------------------------------------
{
  const notes = [];
  const set = [];
  let flagged = null;

  const message = {
    speaker: { alias: "Tizi" },
    setFlag: async (scope, key, value) => { flagged = value; }
  };

  const body = source(CHAT, "settleTreatment").replace(
    'const { setCondition } = await import("./conditions.mjs");',
    "const { setCondition } = stub;");
  const settleTreatment = new Function(
    "fromUuidSync", "SCOPE", "CLASH_FLAG", "whoWonClash", "settledNote", "stub",
    `${body}\nreturn settleTreatment;`)(
      uuid => ({
        "Actor.tizi": { name: "Tizi", uuid: "Actor.tizi" },
        "Actor.goro": { name: "Goro", uuid: "Actor.goro" },
        "Actor.kuro": { name: "Kuro", uuid: "Actor.kuro" }
      }[uuid] ?? null),
      "dbu-ttrpg", "clash",
      new Function(`${source(CHAT, "whoWonClash")}\nreturn whoWonClash;`)(),
      async (msg, text) => { notes.push(text); },
      { setCondition: async (actor, key, value) => { set.push(`${actor.name}:${key}=${value}`); } });

  const run = async (challenger, defender, allyUuid = "Actor.kuro") => {
    notes.length = 0; set.length = 0; flagged = null;
    await settleTreatment(message, {
      challengerUuid: "Actor.tizi", defenderUuid: "Actor.goro",
      treatment: { applied: false, allyUuid, allyName: "Kuro" },
      result: { challenger, defender }
    });
    return { notes: [...notes], set: [...set], flagged };
  };

  // Winning takes the Condition off a third character: the Ally is neither side of it.
  const won = await run({ succeeded: false, total: 9 }, { succeeded: false, total: 4 });
  check("the poison comes off the Ally, not off either side of the Clash",
    won.set, ["Kuro:poisoned=0"]);
  check("and the card says so",
    won.notes, ["Tizi draws it out: Kuro is no longer Poisoned."]);

  // A tie goes to the Defender, and the Life Points that bought the attempt are spent.
  const tied = await run({ succeeded: false, total: 7 }, { succeeded: false, total: 7 });
  check("a tie leaves the poison where it is", tied.set, []);
  check("and says the halved Life Points are gone",
    tied.notes[0].includes("the Life Points that bought the attempt are spent"), true);
  check("which the entry hands back nowhere",
    TRAIT.includes("The entry spends them on the\n# attempt rather than on the result"), true);

  const lost = await run({ succeeded: false, total: 2 }, { succeeded: true, total: 1 });
  check("as does losing outright", lost.set, []);

  // An Ally who has left the scene leaves nothing to treat, rather than throwing.
  const gone = await run({ succeeded: false, total: 9 }, { succeeded: false, total: 1 },
    "Actor.nobody");
  check("an Ally who is no longer here leaves nothing to take off", gone.set, []);
  check("and is said rather than passed over",
    gone.notes[0].includes("no longer here to treat"), true);

  // Marked before anything else.
  check("the card is marked settled", won.flagged.treatment.applied, true);
  check("and the dispatch will not come back to it",
    CHAT.includes("  if (clash.treatment && clash.result && !clash.treatment.applied) {"),
    true);
}

// --- Medicine is Required, and both routes roll it ------------------------------------------------------
{
  check("Medicine is a Required Skill", DBUCharacterData.SKILLS.medicine.required, true);
  check("so is Craft, which is the other answer to its Clash",
    DBUCharacterData.SKILLS.craft.required, true);
  check("which makes this the second Clash Required on every side",
    allManeuvers().filter(m => m.clash
      && [m.clash.skill, ...(m.clash.defenderSkills ?? [])]
        .every(key => DBUCharacterData.SKILLS[key]?.required)).map(m => m.id).sort(),
    ["sense", "treatment"]);

  // Refused at this Maneuver's own door, where the choice is offered - both routes are a
  // Medicine roll and neither can be made.
  check("the door asks whether Medicine can be rolled",
    USE.includes("  const untrained = Boolean(actor.system.skills?.medicine?.untrained);"),
    true);
  check("and closes the poison half rather than the healing",
    USE.includes('<input type="radio" name="route" value="cure" ${untrained ? "disabled" : ""}/>'),
    true);
  check("saying which rule closed it",
    USE.includes('"Medicine is a Required Skill and cannot be rolled without at least one "'),
    true);
  check("while the healing is offered regardless, being a Bonus and not a roll",
    USE.includes('<input type="radio" name="route" value="heal" checked/>'), true);
  check("which the file follows through",
    TRAIT.includes("The healing is not refused: it adds the Skill Bonus rather than "
      + "rolling the Skill"), true);

  // And it does not fix the wider gap, which the Sense Maneuver's file records.
  check("a Clash still never asks", CHAT.includes("untrained"), false);
  check("said here as well as there",
    TRAIT.includes("Worth saying what this does not fix."), true);
}

console.log(`${failed} failing`);
process.exit(failed ? 1 : 0);
