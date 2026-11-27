/**
 * Animals (a Minion Race): Beast of a Kind and its four Options, Fight or Flight, Ferocious Assault, Bestial Presence.
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


/** A Racial Trait's Item, as adding it makes one: its script, an Option's added between markers, the Option kept as chosen. */
function traitItem(id, n, { option = "", grantedBy = "" } = {}) {
  const trait = getTrait(id);
  const chosen = option ? getTrait(option) : null;
  return { id: `r${n}`, uuid: `A.r${n}`, type: "racial", name: trait.name,
    flags: { "dbu-ttrpg": { sourceId: id, ...(grantedBy ? { grantedBy } : {}) } },
    system: { script: [trait.script, chosen ? `#@ option ${chosen.id} | ${chosen.name}\n${chosen.script}\n#@ end` : ""].filter(Boolean).join("\n\n"),
      chosen: chosen ? [{ key: "option", value: chosen.id, label: chosen.name }] : [] } };
}

/** A Animal with these Items, prepared - again at that share of its Life Points where asked. */
function animal(items, { lifeShare = 1, scholarship = 0 } = {}) {
  const parent = new ActorStub({}, { strict: false });
  parent.type = "character";
  parent.items = items;
  parent.getFlag = () => undefined;
  parent.uuid = "Actor.animal";
  const progression = [1, 2].map(lvl => ({ lvl, stepType: "Skill Improvement", choice: "Skill Improvement" }))
    .concat(scholarship ? [{ lvl: 3, stepType: "Attribute Addition", choice: "Attribute Addition", attributes: { scholarship } }] : []);
  const make = life => {
    const model = new DBUCharacterData({ powerLevel: 10, race: "animal", progression, ...(life === null ? {} : { life: { value: life } }) },
      { strict: false, parent });
    parent.system = model;
    model.prepareBaseData?.();
    model.prepareDerivedData();
    return model;
  };
  const first = make(null);
  return (lifeShare === 1) ? first : make(Math.floor(first.life.max * lifeShare));
}

// --- The Traits ---------------------------------------------------------------------------------------------------------------
{
  const RACES = await import(modUrl("races.mjs"));
  const keep = foundry.utils.fetchJsonWithTimeout;
  foundry.utils.fetchJsonWithTimeout = async url => JSON.parse(read("races", String(url).split("/races/")[1]));
  await RACES.loadRaces();
  foundry.utils.fetchJsonWithTimeout = keep;
  const row = id => { const t = getTrait(id); return [t.owner, t.category, t.importance, Number(t.order), compile(t.script).errors.length]; };
  check("the Animals' four: Beast of a Kind and Fight or Flight Primary, Ferocious Assault and Bestial Presence Secondary - compiling",
    ["beast-of-a-kind", "fight-or-flight", "ferocious-assault", "bestial-presence"].map(row),
    [["animal", "body", "primary", 1, 0], ["animal", "mind", "primary", 2, 0], ["animal", "mind", "secondary", 3, 0],
     ["animal", "body", "secondary", 4, 0]]);
  const options = ["savage-animal", "pack-animal", "clever", "mystical-animal"].map(id => getTrait(id));
  check("Beast of a Kind: two Bestial Traits; its 2nd effect's four Options, compiling - Savage held Feral and Scholarship 0, Pack Animal's "
    + "Flexible Flanker, Clever's Skill Improvement, Mystical's Elemental Profile",
    [getTrait("beast-of-a-kind").grantsOther, Number(getTrait("beast-of-a-kind").grantsOtherCount),
     // The Elemental Profile Mystical asks for, as it is answered.
     options.map(o => [o.optionOf, Number(o.optionEffect), compile(o.script.replaceAll("$choice", "elementalFire")).errors.length]),
     [options[0].holdsState, options[0].zeroScore, options[1].grantsTalent, options[2].grantsPerk, options[3].choose,
      Boolean(getTrait("flexible-flanker"))]],
    ["bestial", 2, options.map(() => ["beast-of-a-kind", 2, 0]),
     ["feral", "scholarship", "flexible-flanker", "Skill Improvement", "elementalProfile", true]]);
}

// --- Beast of a Kind's Options -----------------------------------------------------------------------------------------------
{
  const plain = animal([traitItem("beast-of-a-kind", 0)], { scholarship: 2 });
  const savage = animal([traitItem("beast-of-a-kind", 0, { option: "savage-animal" })], { scholarship: 2 });
  check("Savage: always Feral, Scholarship 0 whatever was spent on it, the Basic Attack's Wound 2(T)",
    [plain.states?.feral ?? 0, plain.attributes.scholarship.score > 0, Number(savage.states?.feral) >= 1, savage.attributes.scholarship.score,
     Number(savage.effects.slots["wound.basicAttack"]?.add) || 0],
    [0, true, true, 0, 2 * savage.tierOfPower]);
  const clever = animal([traitItem("beast-of-a-kind", 0, { option: "clever" })]);
  check("Clever: 5 more Technique Points from each Skill Improvement", clever.techniquePoints - plain.techniquePoints
    + (plain.giftedStudent.perSkillImprovement - clever.giftedStudent.perSkillImprovement) * 2, 10);
  const pack = animal([traitItem("beast-of-a-kind", 0, { option: "pack-animal" })]);
  const mystic = getTrait("mystical-animal");
  check("Pack Animal's 1(T) against an Opponent flanked by two Allies; Mystical's Favored Element",
    [Number(pack.effects.slots["wound.packFlank"]?.add) || 0, mystic.script.includes("favored.$choice = true;")],
    [pack.tierOfPower, true]);
}

// --- Fight or Flight, Ferocious Assault, Bestial Presence ---------------------------------------------------------------------
{
  const plain = animal([]);
  const hurt = animal([traitItem("fight-or-flight", 0), traitItem("ferocious-assault", 1)], { lifeShare: 0.2 });
  const well = animal([traitItem("fight-or-flight", 0), traitItem("ferocious-assault", 1)]);
  const add = (model, key) => Number(model.effects.slots[key]?.add) || 0;
  check("below the Injured Health Threshold: Speed, Soak and Defense 1(T) (Fight or Flight), Wound 2(T) (Ferocious Assault) - not above it",
    [["speed.all", "soakValue", "defenseValue", "wound"].map(key => add(hurt, key)), ["speed.all", "soakValue", "defenseValue", "wound"].map(key => add(well, key))],
    [[1, 1, 1, 2].map(n => n * hurt.tierOfPower), [0, 0, 0, 0]]);
  check("Fight or Flight's failed Check and Ferocious Assault (3) on, their flags", [well.effects.slots["fightOrFlight.steadfast"],
    well.effects.slots["ferociousAssault.lifeToOne"]], [true, true]);
  const blocks = id => compile(getTrait(id).script).program.blocks.filter(b => b.mode !== "passive").map(b => `${b.mode}/${b.moment}`);
  check("Fight or Flight (2) Automatic on a passed Check; Ferocious Assault (2) on a hit; Bestial Presence (2) on the Power Up",
    [blocks("fight-or-flight"), blocks("ferocious-assault"), blocks("bestial-presence")],
    [["automatic/steadfast-passed"], ["triggered/hit-opponent"], ["triggered/power"]]);
  const presence = traitItem("bestial-presence", 0);
  const gave = n => Array.from({ length: n }, (each, i) => traitItem("claws", i + 1, { grantedBy: "r0" }));
  check("Bestial Presence (1): the Racial Life Modifier 1 lower for each Bestial Trait it gave - 2, 1, 0",
    [0, 1, 2].map(n => animal([presence, ...gave(n)]).racialLifeModifier), [2, 1, 0]);
  const COND = await import(modUrl("effects/conditions.mjs"));
  check("a hit made through the Basic Attack Maneuver, said", [COND.PREDICATES.hitThroughBasicAttack({ context: { basicAttack: true } }),
    COND.PREDICATES.hitThroughBasicAttack({ context: {} })], [true, false]);
  const CH = read("module", "chat.mjs"), MAN = read("module", "maneuvers.mjs"), RAC = read("module", "racial.mjs"), CB = read("module", "combat.mjs");
  check("wired: Pack Animal's Wound, the hit's Basic Attack, Fight or Flight's Shaken and whom, Ferocious Assault (3) and its passed Check, "
    + "Bestial Presence's Clash and its two Conditions, Clever's Perk and its going",
    [CH.includes("...flankerParts(attacker, target, \"wound\"), ...packFlankParts(attacker, target),"),
     CH.includes("armed: armedHit, basicAttack,"),
     CH.includes("if ((actor.system.effects?.slots?.[\"fightOrFlight.steadfast\"] === true) && failed.length) await fightOrFlightShaken(actor, failed);"),
     CB.includes("await actor.setFlag(\"dbu-ttrpg\", \"fightOrFlightKnock\", { threshold: now, by: knockedBy ?? \"\" });"),
     read("module", "use-maneuver.mjs").includes("declared = await (await import(\"./maneuvers.mjs\")).askFerociousAssault(actor, declared);"),
     MAN.includes("await actor.setFlag(\"dbu-ttrpg\", \"steadfastAutoPass\", { threshold: \"critical\", by: \"Ferocious Assault\" });"),
     CH.includes("const passMark = actor.getFlag?.(SCOPE, \"steadfastAutoPass\");"),
     CH.includes("clash: { skill: \"intimidation\", defenderSkills: [\"intuition\", \"intimidation\"] } },"),
     CH.includes("{ impede: { applied: false, conditions: [\"broken\", \"shaken\"], edge: \"start\", next: true, source: \"Bestial Presence\" } }"),
     CH.includes("for (const each of conditions) await markUntilNextTurn(actor, target, each, 1, edge, source, next);"),
     RAC.includes("if (option?.grantsPerk) await grantPerks(actor, perkSource(option, item), listOf(option.grantsPerk));"),
     RAC.includes("await dropGrantedPerks(item.parent, item);")],
    Array(12).fill(true));
}

console.log(failed ? `\n${failed} failing` : "\n0 failing");
