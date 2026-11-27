/**
 * Oni (a Minion Race): Afterlife Officials and its five Options, Life Among the Dead, Skilled Ogre, Bureaucratic Beatdown - the Area of Rule.
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
const T = await import(modUrl("technique.mjs"));
const FP = await import(modUrl("full-power.mjs"));
const M = await import(modUrl("maneuvers.mjs"));

/** A Character with these Racial Traits on, prepared as Foundry prepares one - at that share of its Life Points where asked. */
function build(traits, { powerLevel = 10, lifeShare = 1 } = {}) {
  const parent = new ActorStub({}, { strict: false });
  parent.type = "character";
  parent.items = traits.map((id, n) => ({ id: `r${n}`, uuid: `A.r${n}`, type: "racial", name: getTrait(id).name,
    flags: { "dbu-ttrpg": { sourceId: id } }, system: { script: getTrait(id).script } }));
  parent.getFlag = () => undefined;
  parent.uuid = "Actor.alien";
  // Technique Points granted on the way: a Skill Improvement at Power Levels 1 and 2 (each row's grant derived from its choice).
  const progression = [1, 2].map(lvl => ({ lvl, stepType: "Skill Improvement", choice: "Skill Improvement" }));
  const make = life => {
    const model = new DBUCharacterData({ powerLevel, race: "alien", progression, ...(life === null ? {} : { life: { value: life } }) },
      { strict: false, parent });
    parent.system = model;
    model.prepareBaseData?.();
    model.prepareDerivedData();
    return model;
  };
  const first = make(null);
  // The same Actor again, so the early Threshold reads the Maximum it kept.
  return (lifeShare === 1) ? first : make(Math.floor(first.life.max * lifeShare));
}


const RACES = await import(modUrl("races.mjs"));
{
  const keep = foundry.utils.fetchJsonWithTimeout;
  foundry.utils.fetchJsonWithTimeout = async url => JSON.parse(read("races", String(url).split("/races/")[1]));
  await RACES.loadRaces();
  foundry.utils.fetchJsonWithTimeout = keep;
}
const G = await import(modUrl("guidance.mjs"));
const COND = await import(modUrl("effects/conditions.mjs"));
const P = COND.PREDICATES;

/** A Racial Trait's Item, as adding it makes one - an Option's script added, `$choice` answered. */
function traitItem(id, n, { option = "", choice = "" } = {}) {
  const trait = getTrait(id);
  const chosen = option ? getTrait(option) : null;
  const script = [trait.script, chosen ? `#@ option ${chosen.id} | ${chosen.name}\n${chosen.script}\n#@ end` : ""].filter(Boolean).join("\n\n");
  return { id: `r${n}`, uuid: `A.r${n}`, type: "racial", name: trait.name, flags: { "dbu-ttrpg": { sourceId: id } },
    system: { script: choice ? script.replaceAll("$choice", choice) : script,
      chosen: chosen ? [{ key: "option", value: chosen.id, label: chosen.name }] : [] } };
}
const token = (actor, x) => ({ x, y: 0, width: 1, height: 1, parent: { id: "s" }, actor, document: { x, y: 0, width: 1, height: 1, parent: { id: "s" } } });
const scene = list => { globalThis.canvas = { grid: { size: 100 }, tokens: { placeables: list } }; };
const stub = (id, { allies = [], slots = {}, type = "character", tier = 2 } = {}) => {
  const actor = { documentName: "Actor", uuid: `A.${id}`, id, name: id, type, items: [],
    system: { allies, effects: { slots }, tierOfPower: tier, baseTierOfPower: tier, defeated: false } };
  return actor;
};

/** An Oni with these Items, prepared - standing where its token is, at that share of its Life Points where asked. */
function oni(items, { at = null, lifeShare = 1, states = {} } = {}) {
  const parent = new ActorStub({}, { strict: false });
  Object.assign(parent, { type: "character", items, getFlag: () => undefined, uuid: "Actor.oni", id: "oni", documentName: "Actor",
    getActiveTokens: () => (at ? [at] : []) });
  if (at) at.actor = parent;
  const progression = [1, 2].map(lvl => ({ lvl, stepType: "Skill Improvement", choice: "Skill Improvement" }));
  const make = life => {
    const model = new DBUCharacterData({ powerLevel: 10, race: "oni", progression, states, ...(life === null ? {} : { life: { value: life } }) },
      { strict: false, parent });
    parent.system = model;
    model.prepareBaseData?.();
    model.prepareDerivedData();
    return model;
  };
  const first = make(null);
  return (lifeShare === 1) ? first : make(Math.floor(first.life.max * lifeShare));
}
const add = (model, key) => Number(model.effects.slots[key]?.add) || 0;

// --- The Traits ---------------------------------------------------------------------------------------------------------------
{
  const row = id => { const t = getTrait(id); return [t.owner, t.category, t.importance, Number(t.order),
    compile(t.script.replaceAll("$choice", "agility")).errors.length]; };
  check("the Oni's four: Afterlife Officials and Life Among the Dead Primary, Skilled Ogre and Bureaucratic Beatdown Secondary - compiling",
    ["afterlife-officials", "life-among-the-dead", "skilled-ogre", "bureaucratic-beatdown"].map(row),
    [["oni", "body", "primary", 1, 0], ["oni", "body", "primary", 2, 0], ["oni", "mind", "secondary", 3, 0], ["oni", "mind", "secondary", 4, 0]]);
  const opts = ["strength", "speed", "skill", "size", "smarts"].map(o => getTrait(`employed-for-${o}`));
  const blocks = t => compile(t.script).program.blocks.filter(b => b.mode !== "passive").map(b => `${b.mode}/${b.moment}`);
  check("Afterlife Officials' five Options, each its (3) and its (4); Life Among the Dead's Defeat, Skilled Ogre's Undying",
    [opts.map(o => [o.optionOf, Number(o.optionEffect), compile(o.script).errors.length, blocks(o)]),
     blocks(getTrait("life-among-the-dead")), blocks(getTrait("skilled-ogre")), getTrait("skilled-ogre").choices],
    [[["afterlife-officials", 3, 0, ["triggered/start-of-turn"]], ["afterlife-officials", 3, 0, ["triggered/start-of-turn"]],
      ["afterlife-officials", 3, 0, []], ["afterlife-officials", 3, 0, []], ["afterlife-officials", 3, 0, ["triggered/analysis"]]],
     ["triggered/defeated"], ["triggered/state/undying"], ["Agility", "Scholarship", "Insight", "Magic", "Personality"]]);
}

// --- The Area of Rule ---------------------------------------------------------------------------------------------------------
{
  const me = stub("me", { allies: ["pal", "pet"] });
  const big = stub("big", { allies: ["pal"], slots: { "areaOfRule.magnitude": { add: 1 } } });
  const pal = stub("pal"), far = stub("far", { allies: ["me"] }), foe = stub("foe"), pet = stub("pet", { type: "minion" });
  const mine = token(me, 0);
  me.getActiveTokens = () => [mine];
  const bigs = token(big, 0);
  big.getActiveTokens = () => [bigs];
  scene([mine, token(pal, 300), token(far, 400), token(foe, 200), token(pet, 100)]);
  const ids = list => list.map(each => each.id).sort();
  check("the Area of Rule: a Standard Sphere - 2 Squares between - a Large one with Employed for Size; everyone in it but you",
    [G.areaOfRuleGap(me), G.areaOfRuleGap(big), ids(G.withinAreaOfRule(me)), ids(G.withinAreaOfRule(me, other => other.id !== "foe"))],
    [2, 3, ["foe", "pal", "pet"], ["pal", "pet"]]);
  check("an Ally not a Minion within it (Afterlife Officials (2)); any Ally (Skilled Ogre (2))",
    [P.allyInAreaOfRule({ data: { parent: me } }), P.allyRuled({ data: { parent: me } })], [true, true]);
  scene([mine, token(pet, 100), token(pal, 500)]);
  check("a Minion alone within it: Skilled Ogre's, not Afterlife Officials'",
    [P.allyInAreaOfRule({ data: { parent: me } }), P.allyRuled({ data: { parent: me } })], [false, true]);
}

// --- On an Oni ----------------------------------------------------------------------------------------------------------------
{
  const plain = oni([]);
  const strength = oni([traitItem("afterlife-officials", 0, { option: "employed-for-strength" })]);
  const skill = oni([traitItem("afterlife-officials", 0, { option: "employed-for-skill" })]);
  const size = oni([traitItem("afterlife-officials", 0, { option: "employed-for-size" })]);
  check("Employed for Strength's Force Modifier 1(T); Skill's 3 TP a Skill Improvement and its trim; Size Gigantic, Large for its Defense, "
    + "its Area of Rule a Magnitude larger",
    [strength.attributes.force.mod - plain.attributes.force.mod, skill.techniquePoints - plain.techniquePoints,
     skill.effects.slots["employed.skillTrim"], size.size.key, size.size.defenseModifier === -size.tierOfPower, add(size, "areaOfRule.magnitude")],
    [strength.tierOfPower, 6, true, "gigantic", true, 1]);
  const undying = oni([traitItem("life-among-the-dead", 0)], { states: { undying: 1 } });
  const undyingPlain = oni([], { states: { undying: 1 } });
  const ogre = oni([traitItem("skilled-ogre", 0, { choice: "agility" })]);
  check("Life Among the Dead: Undying's 1(T) off the Combat Rolls given back, Steadfast 1; Skilled Ogre: every Agility Skill 1 higher",
    [add(undying, "strike") - add(undyingPlain, "strike"), add(undying, "steadfast.dice"),
     Object.values(ogre.skills).filter(s => s.attribute === "agility").every(s => s.bonus === plain.skills[s.key].bonus + 1),
     Object.values(ogre.skills).filter(s => s.attribute !== "agility").every(s => s.bonus === plain.skills[s.key].bonus)],
    [undying.tierOfPower, 1, true, true]);
  const hurt = oni([traitItem("bureaucratic-beatdown", 0)], { lifeShare: 0.2 });
  const well = oni([traitItem("bureaucratic-beatdown", 0)]);
  check("Bureaucratic Beatdown below Injured: your Wound 2(T), Soak and Defense 1(T), and your Allies' within your Area of Rule - not above",
    [[add(hurt, "wound"), add(hurt, "soakValue"), add(hurt, "defenseValue"), hurt.effects.slots["beatdown.allies"]],
     [add(well, "wound"), well.effects.slots["beatdown.allies"]]],
    [[2 * hurt.tierOfPower, hurt.tierOfPower, hurt.tierOfPower, true], [0, undefined]]);
  // Its Allies': an Oni beside this one holding both, at Tier 2.
  const at = token(null, 0);
  const helper = stub("helper", { allies: ["oni"], slots: { "lifeAmongDead.allySoak": true, "beatdown.allies": true }, tier: 2 });
  const there = token(helper, 100);
  helper.getActiveTokens = () => [there];
  scene([at, there]);
  const helped = oni([], { at });
  const away = token(helper, 900);
  helper.getActiveTokens = () => [away];
  scene([at, away]);
  const alone = oni([], { at });
  check("an Ally's Life Among the Dead (3) and Bureaucratic Beatdown (2) within whose Area of Rule one stands: Soak 1(T) each, Defense 1(T) - "
    + "their Tier; out of it, nothing",
    [helped.soakValue - alone.soakValue, helped.defenseValue - alone.defenseValue], [4, 2]);
}

// --- Giant Gene's, read in time ------------------------------------------------------------------------------------------------
{
  const parent = new ActorStub({}, { strict: false });
  Object.assign(parent, { type: "character", items: [traitItem("giant-gene", 0)], getFlag: () => undefined, uuid: "Actor.g", id: "g" });
  const model = new DBUCharacterData({ powerLevel: 10, race: "saiyan", size: "enormous" }, { strict: false, parent });
  parent.system = model;
  model.prepareBaseData?.();
  model.prepareDerivedData();
  check("Giant Gene (2): an Enormous one's Defense Value from its Size as Large's - its flag read before the Size is (it came too late)",
    [model.size.key, model.size.defenseModifier], ["enormous", -model.tierOfPower]);
}

// --- Wired --------------------------------------------------------------------------------------------------------------------
{
  const CH = read("module", "chat.mjs"), MAN = read("module", "maneuvers.mjs"), UM = read("module", "use-maneuver.mjs");
  check("wired: Strength's Might Clash and its Life; Speed's move offered; Skill's trim and its Ki; Smarts' Ki and Power Up; Size as Large for "
    + "Punching Up; Skilled Ogre's lent Skill Bonus; Bureaucratic Beatdown's Wound for Allies, its Charges past the most and what follows",
    [CH.includes("reason: `Win and they lose ${amount} Life Points (your Force Modifier).`, ruleLife: { applied: false, amount } });"),
     CH.includes("if (clash.ruleLife && clash.result && !clash.ruleLife.applied) await settleRuleLife(message, clash);"),
     CH.includes("offerMove(card, actor, { key: `employedSpeed:${actor.uuid}`, flag: \"employedSpeedRound\", name: \"Employed for Speed\","),
     UM.includes("const trimmed = await (await import(\"./maneuvers.mjs\")).askEmployedSkill(actor, declared);"),
     MAN.includes("kiPerTier: advantagesOff ? 0 : gone.size"),
     CH.includes("if (ally) await offerPowerOrTransform(ally, `Employed for Smarts - ${actor.name}'s Analysis`, [\"power-up\"]);"),
     CH.includes("(slots[\"employed.sizeAsLarge\"] === true)"),
     CH.includes("...fairyClashBonus(actor, clash, uuid), ...ogreClashBonus(actor, clash, uuid)];"),
     CH.includes("...(ogre ? [{ name: \"ogre\", label: `Skilled Ogre: ${ogre.lender.name}'s Skill Bonus, +${ogre.value}`,"),
     CH.includes("...championWoundParts(attacker), ...beatdownWoundParts(attacker),"),
     CH.includes("...(beatdownSpent ? { beatdownSpent: true } : {}),"),
     CH.includes("if ((Number(attacker.system.life?.value) || 0) > 1) await attacker.update({ \"system.life.value\": 1 });")],
    Array(12).fill(true));
}

console.log(failed ? `\n${failed} failing` : "\n0 failing");
