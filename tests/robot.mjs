/**
 * Robots (a Minion Race): Lifeless Weapon, Purpose and its four Options, Combat Mode, Full Metal Body; Mecha Mimicry and Robot Ripoff.
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

/** A Racial Trait's Item, as adding it makes one - an Option's script added. */
function traitItem(id, n, { option = "" } = {}) {
  const trait = getTrait(id);
  const chosen = option ? getTrait(option) : null;
  return { id: `r${n}`, uuid: `A.r${n}`, type: "racial", name: trait.name, flags: { "dbu-ttrpg": { sourceId: id } },
    system: { script: [trait.script, chosen ? `#@ option ${chosen.id} | ${chosen.name}\n${chosen.script}\n#@ end` : ""].filter(Boolean).join("\n\n"),
      chosen: chosen ? [{ key: "option", value: chosen.id, label: chosen.name }] : [] } };
}
const token = (actor, x) => ({ x, y: 0, width: 1, height: 1, parent: { id: "s" }, actor, document: { x, y: 0, width: 1, height: 1, parent: { id: "s" } } });
const scene = list => { globalThis.canvas = { grid: { size: 100 }, tokens: { placeables: list } }; };

/** A Robot with these Items and that much Power, prepared - at that share of its Life Points where asked, standing where its token is. */
function robot(items, { power = 0, lifeShare = 1, at = null } = {}) {
  const parent = new ActorStub({}, { strict: false });
  Object.assign(parent, { type: "character", items, getFlag: () => undefined, uuid: "Actor.robot", id: "robot", documentName: "Actor",
    getActiveTokens: () => (at ? [at] : []) });
  if (at) at.actor = parent;
  const make = life => {
    const model = new DBUCharacterData({ powerLevel: 10, race: "robot", ...(power ? { resources: { power: { stacks: power } } } : {}),
      ...(life === null ? {} : { life: { value: life } }) }, { strict: false, parent });
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
  const row = id => { const t = getTrait(id); return [t.owner, t.category, t.importance, Number(t.order), compile(t.script).errors.length]; };
  check("the Robots' four: Lifeless Weapon and Purpose Primary, Combat Mode and Full Metal Body Secondary - compiling",
    ["lifeless-weapon", "purpose", "combat-mode", "full-metal-body"].map(row),
    [["robot", "body", "primary", 1, 0], ["robot", "mind", "primary", 2, 0], ["robot", "mind", "secondary", 3, 0], ["robot", "body", "secondary", 4, 0]]);
  const opts = ["assault", "guard", "friend", "aid"].map(o => getTrait(`${o}-robot`));
  const blocks = t => compile(t.script).program.blocks.filter(b => b.mode !== "passive").map(b => `${b.mode}/${b.moment}`);
  const factor = getTrait("mecha-mimicry"), ripoff = getTrait("robot-ripoff");
  check("Purpose's four Options; Combat Mode on the Power Up; Mecha Mimicry - Robot, 1, N/A - and Robot Ripoff, Primary, an Alternate "
    + "Upbringing Factor Trait given",
    [opts.map(o => [o.optionOf, Number(o.optionEffect), compile(o.script).errors.length, blocks(o)]), blocks(getTrait("combat-mode")),
     [String(factor.requirement).trim(), Number(factor.maximumFactor), factor.prerequisites],
     [ripoff.owner, ripoff.importance, ripoff.race, ripoff.grantsFactorTraitOf, compile(ripoff.script).errors.length]],
    [[["purpose", 2, 0, []], ["purpose", 2, 0, ["triggered/power"]], ["purpose", 2, 0, []], ["purpose", 2, 0, ["triggered/start-of-turn"]]],
     ["triggered/power"], ["Robot", 1, "N/A"], ["mecha-mimicry", "primary", "robot", "alternate-upbringing", 0]]);
}

// --- On a Robot -----------------------------------------------------------------------------------------------------------------
{
  const plain = robot([]);
  const well = robot([traitItem("lifeless-weapon", 0)]);
  const hurt = robot([traitItem("lifeless-weapon", 0)], { lifeShare: 0.2 });
  check("Lifeless Weapon: no Threshold's penalties, Unnatural, Cognitive Clashes; Damage Reduction 1(T) above Injured alone",
    [well.effects.slots["threshold.penalty"]?.set ?? well.effects.slots["threshold.penalty"], well.effects.slots.unnatural,
     well.effects.slots["lifeless.cognitive"], well.effects.slots["lifeless.lifeToZero"], add(well, "damageReduction"), add(hurt, "damageReduction")],
    [0, false, true, true, well.tierOfPower, 0]);
  const charged = robot([traitItem("purpose", 0, { option: "assault-robot" }), traitItem("full-metal-body", 1),
    traitItem("robot-ripoff", 2)], { power: 2 });
  const spent = robot([traitItem("purpose", 0, { option: "assault-robot" }), traitItem("full-metal-body", 1),
    traitItem("robot-ripoff", 2)], { power: 1 });
  check("with 2+ stacks of Power: Might 1(T) (Purpose), Wound 2(T) (Assault Robot), Damage Reduction 1(T) (Full Metal Body), Force and Magic "
    + "Modifiers 1(T) (Robot Ripoff) - none with 1",
    [[add(charged, "might"), add(charged, "wound"), add(charged, "damageReduction"),
      charged.attributes.force.mod - plain.attributes.force.mod, charged.attributes.magic.mod - plain.attributes.magic.mod],
     [add(spent, "might"), add(spent, "wound"), add(spent, "damageReduction")]],
    [[1, 2, 1, 1, 1].map(n => n * charged.tierOfPower), [0, 0, 0]]);
  const healthy = robot([traitItem("full-metal-body", 0)]);
  const bruised = robot([traitItem("full-metal-body", 0)], { lifeShare: 0.4 });
  const injured = robot([traitItem("full-metal-body", 0)], { lifeShare: 0.2 });
  check("Full Metal Body: no Collision Damage above Injured; Corporeal Clashes won while Healthy; its Power for the Wound offered",
    [[healthy.effects.slots["fullMetal.noCollision"], healthy.effects.slots["fullMetal.corporeal"], healthy.effects.slots["fullMetal.spend"]],
     [bruised.threshold.key, bruised.effects.slots["fullMetal.noCollision"], bruised.effects.slots["fullMetal.corporeal"]],
     [injured.effects.slots["fullMetal.noCollision"], injured.effects.slots["fullMetal.corporeal"]]],
    [[true, true, true], ["bruised", true, undefined], [undefined, undefined]]);
  // Friend Robot: an Ally within 3 Squares holding it, read by the one it reaches.
  const at = token(null, 0);
  const friend = { documentName: "Actor", uuid: "A.friend", id: "friend", name: "friend", type: "character", items: [],
    system: { allies: ["robot"], effects: { slots: { "purpose.friend": true } }, tierOfPower: 2, defeated: false } };
  const near = token(friend, 300);
  friend.getActiveTokens = () => [near];
  scene([at, near]);
  const helped = robot([], { at });
  const away = token(friend, 500);
  friend.getActiveTokens = () => [away];
  scene([at, away]);
  const alone = robot([], { at });
  check("Friend Robot: an Ally within a Large Sphere of one with 2+ Power - Combat Rolls 1(T), their Tier; farther, nothing",
    [add(helped, "strike") - add(alone, "strike"), add(helped, "dodge") - add(alone, "dodge")], [2, 2]);
}

// --- Wired --------------------------------------------------------------------------------------------------------------------
{
  const CH = read("module", "chat.mjs"), UM = read("module", "use-maneuver.mjs");
  check("wired: Lifeless Weapon's Cognitive and Full Metal Body's Corporeal Clashes won, Lifeless (3)'s Life to 0 held; Guard Robot's Compelled, "
    + "Aid Robot's Life and Ki; Friend Robot read again with the Power; Combat Mode's Charges and Fatigued; no Collision; Full Metal Body's "
    + "button, its Wound and its Power after; Robot Ripoff's Factor Trait",
    [CH.includes("((answer === \"cognitive\")") || CH.includes("(((answered === \"cognitive\") && (defender.system.effects?.slots?.[\"lifeless.cognitive\"] === true))"),
     CH.includes("|| ((answered === \"corporeal\") && (defender.system.effects?.slots?.[\"fullMetal.corporeal\"] === true)));"),
     UM.includes("if (declared?.lifelessLife) {"),
     CH.includes("if (clash.guardCompel && clash.result && !clash.guardCompel.applied) await settleGuardCompel(message, clash);"),
     CH.includes("for (const ally of near) await regainPools(ally, each, each);"),
     read("module", "dbu-ttrpg.mjs").includes("changes.system?.resources) conduitRefresh(); });"),
     CH.includes("await gainCondition(actor, \"fatigued\", powerHeld);"),
     CH.includes("if (target?.system?.effects?.slots?.[\"fullMetal.noCollision\"] === true) return 0;"),
     CH.includes("if (result && !result.wound) metalButtons(message, attack, container);"),
     CH.includes("...metalParts(attack, target),"),
     CH.includes("if (pledged && target?.isOwner) await setResource(target, \"power\","),
     read("module", "racial.mjs").includes("if (trait.grantsFactorTraitOf) await grantFactorTrait(actor, item, String(trait.grantsFactorTraitOf));")],
    Array(12).fill(true));
}

console.log(failed ? `\n${failed} failing` : "\n0 failing");
