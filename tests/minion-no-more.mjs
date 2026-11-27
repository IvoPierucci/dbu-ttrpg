/**
 * Minion No More: More than a Minion and its Option for each Minion Race.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

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

const { loadTraits } = await import(modUrl("effects/traits.mjs"));
const { default: DBUCharacterData } = await import(modUrl("data/actor-character.mjs"));
const ALLIES = await import(modUrl("allies.mjs"));
const TYPES = await import(modUrl("actor-types.mjs"));
await loadTraits();

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

/** What a model's parent has to be: a DataModel - the Actor, with its type. */
class ActorStub extends DataModel {
  static defineSchema() { return {}; }
}

const { getTrait } = await import(modUrl("effects/traits.mjs"));
const { compile } = await import(modUrl("effects/parser.mjs"));
const RACES = await import(modUrl("races.mjs"));
{
  const keep = foundry.utils.fetchJsonWithTimeout;
  foundry.utils.fetchJsonWithTimeout = async url => JSON.parse(read("races", String(url).split("/races/")[1]));
  await RACES.loadRaces();
  foundry.utils.fetchJsonWithTimeout = keep;
}

/** More than a Minion's Item as adding it makes one: its script, the race's Option added between markers, the Option kept as chosen. */
function mtmItem(option) {
  const trait = getTrait("more-than-a-minion"), chosen = option ? getTrait(option) : null;
  return { id: "m", uuid: "A.m", type: "racial", name: trait.name, flags: { "dbu-ttrpg": { sourceId: trait.id } },
    system: { script: [trait.script, chosen ? `#@ option ${chosen.id} | ${chosen.name}\n${chosen.script}\n#@ end` : ""].filter(Boolean).join("\n\n"),
      chosen: chosen ? [{ key: "option", value: chosen.id, label: chosen.name }] : [] } };
}

/** A character of that race with these Items, prepared - at that share of its Life Points, with that progression. */
function build(race, items, { lifeShare = 1, progression = null } = {}) {
  const parent = new ActorStub({}, { strict: false });
  Object.assign(parent, { type: "character", items, getFlag: () => undefined, uuid: "A.c", id: "c", documentName: "Actor" });
  const make = life => {
    const model = new DBUCharacterData({ powerLevel: 10, race, ...(progression ? { progression } : {}),
      ...(life === null ? {} : { life: { value: life } }) }, { strict: false, parent });
    parent.system = model;
    model.prepareBaseData?.();
    model.prepareDerivedData();
    return model;
  };
  const first = make(null);
  return make(Math.floor(first.life.max * lifeShare));
}
const add = (model, key) => Number(model.effects.slots[key]?.add) || 0;
const RACE_OPTION = { alien: "mtm-alien", arlian: "mtm-arlians", animal: "mtm-animal", creature: "mtm-creature", oni: "mtm-oni", robot: "mtm-robot",
  saibaman: "mtm-saibaman", tuffle: "mtm-tuffle", zooner: "mtm-zooners" };

// --- The Factor, its Factor Trait, its Options -----------------------------------------------------------------------------------
{
  const factor = getTrait("minion-no-more"), trait = getTrait("more-than-a-minion");
  check("Minion No More (Any Minion Race, 1, You are not a Minion.): More than a Minion - Body, compiling; three Perks; its Option by race",
    [[String(factor.requirement).trim(), Number(factor.maximumFactor), factor.prerequisites, Boolean(String(factor.note ?? "").trim())],
     [trait.owner, trait.category, compile(trait.script).errors.length, trait.grantsPerk, trait.optionsByRace, Number(trait.optionEffect)]],
    [["Any Minion Race", 1, "You are not a Minion.", true],
     ["minion-no-more", "body", 0, ["Attribute Addition", "Skill Improvement", "Talent Addition"], true, 3]]);
  const races = Object.keys(RACE_OPTION);
  check("each Minion Race has its Option, named for it - compiling; the Arlians' a Bestial Trait; the Zooners' a Triggered out of sequence",
    [races.map(race => [getTrait(RACE_OPTION[race])?.optionOf, getTrait(RACE_OPTION[race])?.forRace, RACES.isMinionRace(race),
      compile(getTrait(RACE_OPTION[race])?.script ?? "x").errors.length]),
     getTrait("mtm-arlians").grantsOther,
     compile(getTrait("mtm-zooners").script).program.blocks.map(b => `${b.mode}/${b.moment}${b.modifiers?.outOfSequence ? "+oos" : ""}`)],
    [races.map(race => ["more-than-a-minion", race, true, 0]), "bestial", ["triggered/knock-through+oos"]]);
}

// --- On a character -------------------------------------------------------------------------------------------------------------
{
  const plain = build("robot", []), more = build("robot", [mtmItem("mtm-robot")]);
  const T = more.tierOfPower;
  check("(1) the Racial Life Modifier 2 higher; Robot: Healthy, Wound Rolls and Damage Reduction 1(T)",
    [more.racialLifeModifier - plain.racialLifeModifier, add(more, "wound"), add(more, "damageReduction")], [2, T, T]);
  const robotHurt = build("robot", [mtmItem("mtm-robot")], { lifeShare: 0.45 });
  const alien = build("alien", [mtmItem("mtm-alien")]);
  const animal = build("animal", [mtmItem("mtm-animal")]), animalHurt = build("animal", [mtmItem("mtm-animal")], { lifeShare: 0.2 });
  const creature = build("creature", [mtmItem("mtm-creature")]);
  const saiba = build("saibaman", [mtmItem("mtm-saibaman")]);
  check("Alien: Skill Improvement TP 3 more, Signature Strike 1(T); Animal: below Bruised, Damage Reduction, Initiative, Awareness 1(T); Robot not "
    + "below Healthy; Creature: half the higher of Agility and Tenacity Modifiers; Saibaman: half the Racial Life Modifier rounded up (T)",
    [add(robotHurt, "wound"), add(alien, "techniquePoints.perSkillImprovement"), add(alien, "strike.signature"),
     [add(animal, "damageReduction"), add(animalHurt, "damageReduction"), add(animalHurt, "initiative"), add(animalHurt, "awareness")],
     add(creature, "surgency"), add(saiba, "surgency")],
    [0, 3, alien.tierOfPower, [0, animalHurt.tierOfPower, animalHurt.tierOfPower, animalHurt.tierOfPower],
     Math.floor(Math.max(creature.attributes.agility.mod, creature.attributes.tenacity.mod) / 2),
     Math.ceil(Math.max(saiba.racialLifeModifier, 0) / 2) * saiba.tierOfPower]);
  // The Tuffle's point: a Character Perk row taken as a Skill Improvement, 1 Insight written on it - and 1 Agility, which no row of that kind gives.
  const rows = DBUCharacterData.buildDefaultProgression();
  const at = rows.findIndex(row => (row.stepType === "Character Perk") && (row.lvl > 1) && (row.lvl <= 10));
  const progression = rows.map((row, n) => (n === at) ? { ...row, choice: "Skill Improvement", attributes: { ...row.attributes, insight: 1, agility: 1 } } : row);
  const bare = build("tuffle", [], { progression: rows });
  const without = build("tuffle", [], { progression });
  const tuffle = build("tuffle", [mtmItem("mtm-tuffle")], { progression });
  check("Tuffle: a Character Perk turned Skill Improvement - its Insight, Personality or Scholarship point counted while it is had, nothing else",
    [at >= 0, tuffle.attributes.insight.score - bare.attributes.insight.score, without.attributes.insight.score - bare.attributes.insight.score,
     tuffle.attributes.agility.score - bare.attributes.agility.score, tuffle.effects.slots["moreThanMinion.tufflePoint"]],
    [true, 1, 0, 0, true]);
}

// --- Wired --------------------------------------------------------------------------------------------------------------------
{
  const RC = read("module", "racial.mjs"), AC = read("module", "data", "actor-character.mjs"), RG = read("module", "effects", "registry.mjs");
  const CH = read("module", "chat.mjs"), SH = read("module", "sheets", "actor-character-sheet.mjs"), TP = read("templates", "parts", "actor-progression.hbs");
  check("wired: the race's Option not asked; the Trait's own Perks made and taken back; the Oni's Strike and Dodge to those it rules; the Zooners' "
    + "Ki Surge; the Tuffle's pick in the row; read again by others",
    [RC.includes("presetOption = (fitting.length === 1) ? fitting[0].id : \"\";"),
     RC.includes("if (trait.grantsPerk) await grantPerks(actor, item.name, listOf(trait.grantsPerk));"),
     RC.includes("if (getTrait(item?.flags?.[\"dbu-ttrpg\"]?.sourceId ?? \"\")?.grantsPerk) named.add(item.name);"),
     AC.includes("const rulers = (this.parent ? alliesRuling(this.parent, \"moreThanMinion.oniRule\") : [])"),
     RG.includes("script: `[passive]\\nstrike += ${value};\\ndodge += ${value};`"),
     CH.includes("return (await useManeuver(actor, { ...surge, surgeKind: \"ki\" }, { outOfSequence: true })) ? undefined : UNSPENT;"),
     SH.includes("for (const select of this.element.querySelectorAll(\"[data-tuffle-point]\")) {"),
     TP.includes("<select class=\"tuffle-point\" data-tuffle-point"),
     read("module", "dbu-ttrpg.mjs").includes("\"team-reliance\", \"more-than-a-minion\"]);")],
    Array(9).fill(true));
}

// --- What waited on Minions: Ruler (2), Exploiting Minions -------------------------------------------------------------------
{
  const COND = await import(modUrl("effects/conditions.mjs"));
  const blocks = id => compile(getTrait(id).script).program.blocks.filter(b => b.mode !== "passive")
    .map(b => `${b.mode}/${b.moment}${b.modifiers?.outOfSequence ? "+oos" : ""}`);
  const brood = { documentName: "Actor", type: "minion", id: "b", uuid: "A.b", system: { master: "boss", minion: true }, getFlag: (s, k) => (k === "minionKind") ? "brood" : undefined };
  const goop = { ...brood, getFlag: (s, k) => (k === "minionKind") ? "goop" : undefined };
  const other = { ...brood, system: { master: "someone", minion: true } };
  const keep = globalThis.fromUuidSync;
  globalThis.fromUuidSync = uuid => ({ "A.b": brood, "A.g": goop, "A.o": other })[uuid] ?? null;
  const ask = uuid => COND.PREDICATES.defeatedBrood({ data: { parent: { id: "boss" } }, context: { defeatedUuid: uuid } });
  const answers = [ask("A.b"), ask("A.g"), ask("A.o")];
  globalThis.fromUuidSync = keep;
  const CH = read("module", "chat.mjs");
  check("Ruler (2): a Minion's Damage to an Opponent, a stack of Overwhelm for its Master; Exploiting Minions: your Brood Minion Defeated - the "
    + "Basic Attack of the Clearing Profile out of sequence, once a Round",
    [blocks("ruler"), compile(getTrait("ruler").script).errors.length, blocks("exploiting-minions"), compile(getTrait("exploiting-minions").script).errors.length,
     answers, read("module", "effects", "parser.mjs").includes('"defeatedBrood",'),
     CH.includes('if (ruler && areOpponents(armsUser, target)) await answerFor(ruler, "minion-damage", { minionUuid: armsUser.uuid });'),
     CH.includes('return (await useManeuver(actor, { ...basic, profile: "clearing" }, { outOfSequence: true })) ? undefined : UNSPENT;')],
    [["triggered/minion-damage", "triggered/power"], 0, ["triggered/ally-defeated+oos"], 0, [true, false, false], true, true, true]);
}

// --- The race list: the Minion Races under their own divider, last --------------------------------------------------------------
{
  const options = RACES.raceOptions();
  const minion = options.filter(option => option.minionRace).map(option => option.value).sort();
  const SH = read("module", "sheets", "actor-character-sheet.mjs"), TP = read("templates", "parts", "actor-progression.hbs");
  check("the race list: the nine Minion Races marked, given apart, under a \"Minion Races\" group after the rest",
    [minion, SH.includes("context.raceOptions = races.filter(option => !option.minionRace && !(onMinion && option.noMinion && !option.selected));"),
     SH.includes("context.minionRaceOptions = races.filter(option => option.minionRace);"),
     TP.indexOf('<optgroup label="Minion Races">') > TP.indexOf("{{#each raceOptions as |race|}}")],
    [["alien", "animal", "arlian", "creature", "oni", "robot", "saibaman", "tuffle", "zooner"], true, true, true]);
}

// --- Who it is for: a Minion Race, not a Minion ----------------------------------------------------------------------------------
{
  const RACIAL = await import(modUrl("racial.mjs"));
  const trait = getTrait("more-than-a-minion");
  const minion = { type: "minion", system: { race: "saibaman", duplicate: false } };
  const character = { type: "character", system: { race: "saibaman" } };
  check("More than a Minion: dimmed for a race that is no Minion Race and on a Minion's sheet; not on a character of a Minion Race",
    [Boolean(RACIAL.racialTraitUnfit(trait, "saiyan")), RACIAL.racialTraitUnfit(trait, "saibaman"), RACIAL.racialTraitUnfit(trait, "tuffle"),
     RACIAL.minionRacialUnfit(trait, minion, []), RACIAL.minionRacialUnfit(trait, character, []), getTrait("minion-no-more").notMinion],
    [true, "", "", "Its Racial Factor's Prerequisite is not met: you are a Minion", "", true]);
}

// --- Found by its Factor's name ---------------------------------------------------------------------------------------------------
{
  const SE = read("module", "search.mjs"), SH = read("module", "sheets", "actor-character-sheet.mjs");
  const RACIAL = await import(modUrl("racial.mjs"));
  check("Add Racial Trait: a Factor Trait found by its Racial Factor's name too - More than a Minion by \"Minion No More\"",
    [RACIAL.factorName(getTrait("more-than-a-minion").owner),
     SH.includes('${(trait.kind === "factors") ? `data-also="${escape(factorName(trait.owner))}"` : ""}'),
     SE.includes("for (const option of options) option.hidden = !optionMatches(option, input.value);"),
     SE.includes('.find(option => optionMatches(option, input.value))?.dataset.featureOption ?? "";'),
     SE.includes('|| String(option.dataset.also ?? "").split("|").some(name => name && namePrefixMatches(name, typed));')],
    ["Minion No More", true, true, true, true]);
}

console.log(failed ? `\n${failed} failing` : "\n0 failing");
