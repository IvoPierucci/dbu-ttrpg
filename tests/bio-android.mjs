/**
 * Bio Androids: Artificial Warrior, Uncanny Monster, Combat Blueprint, Offensive Design, Defensive Design.
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

const { getTrait, resourceCeiling, resourceDefinitions } = await import(modUrl("effects/traits.mjs"));
const { compile } = await import(modUrl("effects/parser.mjs"));
const RACES = await import(modUrl("races.mjs"));
{
  const keep = foundry.utils.fetchJsonWithTimeout;
  foundry.utils.fetchJsonWithTimeout = async url => JSON.parse(read("races", String(url).split("/races/")[1]));
  await RACES.loadRaces();
  foundry.utils.fetchJsonWithTimeout = keep;
}

/** A Racial Trait's Item, as adding it makes one: its script, an Option's added between markers, the Option kept as chosen. */
function traitItem(id, n, { option = "" } = {}) {
  const trait = getTrait(id);
  const chosen = option ? getTrait(option) : null;
  return { id: `r${n}`, uuid: `A.r${n}`, type: "racial", name: trait.name, flags: { "dbu-ttrpg": { sourceId: id } },
    system: { script: [trait.script, chosen ? `#@ option ${chosen.id} | ${chosen.name}\n${chosen.script}\n#@ end` : ""].filter(Boolean).join("\n\n"),
      chosen: chosen ? [{ key: "option", value: chosen.id, label: chosen.name }] : [] } };
}

/** A Bio Android with these Items, prepared at full Life. */
function bio(items) {
  const parent = new ActorStub({}, { strict: false });
  Object.assign(parent, { type: "character", items, getFlag: () => undefined, uuid: "A.b", id: "b", documentName: "Actor" });
  const make = life => {
    const model = new DBUCharacterData({ powerLevel: 10, race: "bio-android", ...(life === null ? {} : { life: { value: life } }) },
      { strict: false, parent });
    parent.system = model;
    model.prepareBaseData?.();
    model.prepareDerivedData();
    return model;
  };
  const first = make(null);
  return make(first.life.max);
}
const add = (model, key) => Number(model.effects.slots[key]?.add) || 0;
const blocks = script => compile(script).program.blocks.filter(b => b.mode !== "passive").map(b => `${b.mode}/${b.moment}`);

// --- The race -------------------------------------------------------------------------------------------------------------------
{
  const race = RACES.getRace("bio-android");
  check("Bio Android: two different +2s and a +1, never Force and Magic both; Life Modifier +3; Corporeal; 3 Skill Ranks",
    [race.attributeChoices.map(each => each.amount), race.exclusiveAttributes, race.lifeModifier, race.savingThrow, race.skillRanks],
    [[2, 2, 1], [["force", "magic"]], 3, "corporeal", 3]);
}

// --- Artificial Warrior ---------------------------------------------------------------------------------------------------------
{
  const t = getTrait("artificial-warrior");
  const options = ["genetic-survivor", "genetic-aggressor", "genetic-agility", "pursuit-of-perfection"];
  check("Artificial Warrior: Body, Primary, first - compiling; Adaptation Points (3); the Power Up's and the Combat Roll's; its four Options "
    + "with their (5); Absorbed Perfection its Addendum",
    [t.owner, t.category, t.importance, Number(t.order), compile(t.script).errors.length, t.resource, Number(t.resourceMax), Number(t.optionEffect),
     blocks(t.script), options.map(id => [getTrait(id)?.optionOf, compile(getTrait(id)?.script ?? "x").errors.length, blocks(getTrait(id).script)]),
     String(t.addendum).includes("Perfection Target")],
    ["bio-android", "body", "primary", 1, 0, "adaptation", 3, 4, ["triggered/power", "triggered/combat-roll"],
     [["artificial-warrior", 0, ["triggered/hit-not-knocked"]], ["artificial-warrior", 0, ["triggered/damaged-opponent"]],
      ["artificial-warrior", 0, ["triggered/dodged-attack"]], ["artificial-warrior", 0, []]], true]);
  const plain = bio([]);
  const of = option => bio([traitItem("artificial-warrior", 0, { option })]);
  const [survivor, aggressor, agility, pursuit] = options.map(of);
  const T = plain.tierOfPower;
  const def = { name: "adaptation", max: 3 };
  check("Genetic Survivor: Life Modifier 2, Soak 1(T); Aggressor: Strike and Wound 1(T); Agility: Dodge and both Speeds 1(T); Pursuit: the "
    + "Absorb Maneuver, Adaptation Points 4 at most; (3)'s flag on each",
    [survivor.racialLifeModifier - plain.racialLifeModifier, add(survivor, "soakValue"), add(aggressor, "strike"), add(aggressor, "wound"),
     [add(agility, "dodge"), add(agility, "speed.normal"), add(agility, "speed.boosted")], pursuit.effects.slots["maneuver.absorb"],
     resourceCeiling(def, { system: pursuit }), resourceCeiling(def, { system: survivor }), survivor.effects.slots["adaptationSpend.hit"]],
    [2, T, T, T, [T, T, T], true, 4, 3, true]);
  const CH = read("module", "chat.mjs");
  check("wired: the Combat Roll's Adaptation Points asked and on its Dice Score; the hit's on the Damage Reduction; the two new Moments fired",
    [CH.includes('const adapted = (answered?.slots?.["adaptationSpend.roll"] === true) ? await spendAdaptation(actor, "this Combat Roll") : 0;'),
     CH.includes("const adapt = hit ? await adaptationReductionFor(target, attack, uuid) : { value: 0, step: 0, soak: 0 };"),
     CH.includes("+ (Number(own.greedReduction) || 0) + (Number(own.adaptationReduction) || 0)"),
     CH.includes('if (own.hit && !isAbsoluteMiss(own) && !knockedThrough) await answerFor(target, "hit-not-knocked");'),
     CH.includes('await answerFor(armsUser, "damaged-opponent", { targetUuid: target.uuid, ...(effectSignature(fromUuidSync(attack.attackerUuid ?? ""), attack) ? { bySignature: true } : {}),')],
    [true, true, true, true, true]);
}

// --- A Trait's Addendum box, folded under its effects ----------------------------------------------------------------------------
{
  const RACIAL = await import(modUrl("racial.mjs"));
  globalThis.Handlebars ??= { escapeExpression: text => String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") };
  // An Item made before the box had a place of its own: its text still carrying it after the Addendum effect.
  const oldText = ["Roomy Biology: Learning to make the best use of your supernatural anatomy.", "(1)-[Passive]: Increase your Racial Life Modifier by 2.",
    "(3)-[Addendum]: Please refer to the ‘Inner Room’ box below.", "Inner Room: You may store Items and willing or Defeated Characters within your body.",
    "While Adventuring, you can freely store or remove Items/Characters."].join("\n");
  const roomy = RACIAL.racialTraitLines({ flags: { "dbu-ttrpg": { sourceId: "roomy-biology" } }, system: { text: oldText, chosen: [] } });
  const box = roomy.find(line => line.addendum)?.addendum;
  const dna = RACIAL.racialTraitLines({ flags: { "dbu-ttrpg": { sourceId: "dna-absorption" } }, system: { text: getTrait("dna-absorption").text, chosen: [] } })
    .find(line => line.addendum)?.addendum;
  const shown = roomy.filter(line => line.html).map(line => line.html).join(" ");
  const TR = read("templates", "parts", "actor-traits.hbs"), TD = read("templates", "parts", "talent-description.hbs"), TO = read("templates", "parts", "talent-options.hbs");
  check("the Addendum box: after the effects, folded under its title; an old Item's inline copy left out; bullets kept; drawn in the Traits tab's three "
    + "lists and the Item's Description, nowhere else",
    [box?.title, box?.lines.filter(line => line.html).length, shown.includes("You may store Items"), shown.includes("box below"),
     dna?.title, dna?.lines.some(line => line.bullet), getTrait("mimicry-program").addendumTitle,
     (TR.match(/<details class="dbu-addendum">/g) ?? []).length, TD.includes('<details class="dbu-addendum">'), TO.includes("racial.addendum")],
    ["Inner Room", 4, false, true, "DNA Copy", true, "Cyber Copy", 3, true, false]);

  // The Option effect with the Option's own line alone: its (5) line, in its file too, shown under the (5) only (the user's: Genetic Survivor's
  // (5) read twice, once right after its (4)).
  const warrior = option => ({ flags: { "dbu-ttrpg": { sourceId: "artificial-warrior" } },
    system: { text: getTrait("artificial-warrior").text, chosen: [{ key: "option", value: option }] } });
  const shownOf = option => RACIAL.racialTraitLines(warrior(option)).filter(line => line.html).map(line => line.html);
  const counts = ["genetic-survivor", "genetic-aggressor", "genetic-agility", "pursuit-of-perfection"].map(option => {
    const name = getTrait(option).name;
    const lines = shownOf(option);
    return [lines.filter(line => line.includes(`${name} [Passive]`)).length, lines.filter(line => line.includes(`${name} [Triggered`) || line.includes(`${name} [Addendum]`)).length];
  });
  const survivorLines = shownOf("genetic-survivor");
  const four = survivorLines.findIndex(line => line.startsWith("(4)-"));
  check("Artificial Warrior's chosen Option: its [Passive] under the (4), its (5) once, under the (5); the (4)'s hover the same",
    [counts, survivorLines[four + 1]?.includes("[Triggered"), RACIAL.effectLineOf(warrior("genetic-survivor"), 4).includes("[Triggered"),
     RACIAL.effectLineOf(warrior("genetic-survivor"), 4).includes("Genetic Survivor [Passive]"), RACIAL.effectLineOf(warrior("genetic-survivor"), 5).includes("[Triggered, 1/Round]")],
    [[[1, 1], [1, 1], [1, 1], [1, 1]], false, false, true, true]);
}

// --- Uncanny Monster -------------------------------------------------------------------------------------------------------------
{
  const t = getTrait("uncanny-monster");
  const um = bio([traitItem("uncanny-monster", 0, { option: "two-bestial-traits" })]);
  const RAC = read("module", "racial.mjs"), CH = read("module", "chat.mjs");
  check("Uncanny Monster: Body, Primary, second - compiling; Intimidation 2; the Draining Attack (and so Drain Life); its (2) two Options, Bestial "
    + "twice or Monstrous once; the Power Up out of sequence on a strong Draining",
    [t.owner, t.category, t.importance, Number(t.order), compile(t.script).errors.length, add(um, "skill.intimidation"),
     um.effects.slots["maneuver.draining-attack"], getTrait("drain-life").requires,
     [getTrait("two-bestial-traits").grantsOther, Number(getTrait("two-bestial-traits").grantsOtherCount), getTrait("a-monstrous-trait").grantsOther,
      Number(getTrait("a-monstrous-trait").grantsOtherCount)],
     compile(t.script).program.blocks.filter(b => b.mode !== "passive").map(b => `${b.mode}/${b.moment}${b.modifiers?.outOfSequence ? "+oos" : ""}`)],
    ["bio-android", "body", "primary", 2, 0, 2, true, ["foundation:physical", "maneuver:draining-attack"], ["bestial", 2, "monstrous", 1],
     ["triggered/draining-ki+oos"]]);
  check("wired: an Option's Other Traits as many as it says, each marked its Option's; the Draining's Ki truly regained, past 5(bT), from one of "
    + "your Tier or higher",
    [RAC.includes("for (let n = 0; n < Math.max(1, Number(option.grantsOtherCount) || 1); n++) {"),
     RAC.includes('if (given) await given.setFlag("dbu-ttrpg", "grantedByOption", option.id);'),
     CH.includes("const recovered = Math.min(ki, Math.max(0, (Number(kiPool.max) || 0) - (Number(kiPool.value) || 0)));"),
     CH.includes('if (strong) await answerFor(armsUser, "draining-ki", { targetUuid: target.uuid });')],
    [true, true, true, true]);
}

// --- Combat Blueprint ------------------------------------------------------------------------------------------------------------
{
  const t = getTrait("combat-blueprint"), m = getTrait("combat-blueprint-first-effect");
  const ids = ["blueprint-survivor", "blueprint-aggressor", "blueprint-agility", "blueprint-perfection"];
  check("Combat Blueprint: Mind, Secondary, third - compiling; (1) its own Instant Maneuver, 1/Round, blueprintPower; (2) four Options "
    + "following Artificial Warrior's",
    [t.owner, t.category, t.importance, Number(t.order), compile(t.script).errors.length, t.optionsFollow, Number(t.optionEffect),
     [m.type, m.usageLimit, m.fromTrait, Number(m.fromEffect), compile(m.script).errors.length, m.script.includes("blueprintPower();")],
     ids.map(id => [getTrait(id).optionOf, getTrait(id).follows, compile(getTrait(id).script).errors.length, blocks(getTrait(id).script)])],
    ["bio-android", "mind", "secondary", 3, 0, "artificial-warrior", 2, ["instant", "1/round", "combat-blueprint", 1, 0, true],
     [["combat-blueprint", "genetic-survivor", 0, []], ["combat-blueprint", "genetic-aggressor", 0, []],
      ["combat-blueprint", "genetic-agility", 0, []], ["combat-blueprint", "pursuit-of-perfection", 0, ["triggered/start-of-round"]]]]);
  const flagOf = (warrior, option) => bio([traitItem("artificial-warrior", 0, { option: warrior }), traitItem("combat-blueprint", 1, { option })])
    .effects.slots;
  const s = flagOf("genetic-survivor", "blueprint-survivor"), g = flagOf("genetic-aggressor", "blueprint-aggressor"),
    a = flagOf("genetic-agility", "blueprint-agility");
  check("each Option's flag held, and only its own",
    [s["blueprint.survivor"], s["blueprint.aggressor"] ?? false, g["blueprint.aggressor"], a["blueprint.agility"], a["blueprint.survivor"] ?? false],
    [true, false, true, true, false]);
  const CH = read("module", "chat.mjs"), UM = read("module", "use-maneuver.mjs");
  check("wired: (1) not out of your turn nor with no Power, refused before the use; Power spent, 2(bT) Life and Ki each, 2+ an Adaptation "
    + "Point. Survivor's step on the Category; Aggressor's charge on the stored attack; Agility's Diminishing rows off",
    [UM.includes('if (maneuver.id === "combat-blueprint-first-effect") {'),
     CH.includes("const each = 2 * Math.max(1, Number(actor.system.baseTierOfPower) || 1);"),
     CH.includes("if ((spent >= 2) && resourceLimits(actor).adaptation) {"),
     CH.includes("categoryShift: shift - tough.step - adapt.step,"),
     CH.includes('(target.system.effects?.slots?.["blueprint.survivor"] === true)'),
     CH.includes("...(strike.blueprintCharge ? { energyCharges: (Number(attack.energyCharges) || 0) + 1 } : {}),"),
     CH.includes('if (String(parts[index].label).startsWith("Dim. Defense")) parts.splice(index, 1);'),
     CH.includes("if (first.blueprintCharge) kept.blueprintCharge = true;")],
    [true, true, true, true, true, true, true, true]);
}

// --- Offensive Design ------------------------------------------------------------------------------------------------------------
{
  const t = getTrait("offensive-design");
  const od = bio([traitItem("artificial-warrior", 0, { option: "genetic-aggressor" }), traitItem("offensive-design", 1)]);
  const { PREDICATES } = await import(modUrl("effects/conditions.mjs"));
  const kinds = ["strike", "wound", "dodge", undefined].map(rollKind => PREDICATES.strikeOrWound({ context: { rollKind } }));
  check("Offensive Design: Mind, Secondary, fourth - compiling; Strike and Wound Critical Targets 1 lower; (2) Ki on an Adaptation Point "
    + "gained, (3) one on a Strike or Wound Critical, 3/Round each; (4)'s flag; strikeOrWound reads the roll",
    [t.owner, t.category, t.importance, Number(t.order), compile(t.script).errors.length, add(od, "criticalTarget.strike"),
     add(od, "criticalTarget.wound"), od.effects.slots["offensiveDesign.category"],
     compile(t.script).program.blocks.filter(b => b.mode !== "passive").map(b => `${b.mode}/${b.moment}/${b.budget?.round ?? ""}`),
     kinds],
    ["bio-android", "mind", "secondary", 4, 0, -1, -1, true, ["triggered/adaptation-gained/3", "triggered/critical-scored/3"], [true, true, false, false]]);
  const CH = read("module", "chat.mjs"), RT = read("module", "effects", "moments-runtime.mjs"), MO = read("module", "effects", "moments.mjs");
  check("wired: adaptation-gained a Moment, fired on an effect's gain and on Combat Blueprint's; the Critical's roll named; the Combat Rolls' "
    + "Adaptation Points counted together for the Category, once an Encounter",
    [MO.includes('{ key: "adaptation-gained",'), RT.includes('["adaptation", "adaptation-gained"]'), RT.includes('"sunlight", "adaptation"]'),
     CH.includes('.stacksGained(actor, ["adaptation"], { adaptation: 1 });'), CH.includes("...(slot ? { rollKind: slot } : {})"),
     CH.includes('await answerFor(attacker, "critical-scored", { rollKind: "wound" });'),
     CH.includes('await answerFor(attacker, "critical-scored", { rollKind: "strike", attackRoll: true });'),
     CH.includes("const spent = (Number(attack.result?.strike?.adapted) || 0) + (Number(wound?.adapted) || 0);"),
     CH.includes("+ (attack.impaled ? 1 : 0) + (designed ? 1 : 0);")],
    [true, true, true, true, true, true, true, true, true]);
}

// --- Defensive Design ------------------------------------------------------------------------------------------------------------
{
  const t = getTrait("defensive-design");
  const plain = bio([traitItem("artificial-warrior", 0, { option: "genetic-agility" })]);
  const dd = bio([traitItem("artificial-warrior", 0, { option: "genetic-agility" }), traitItem("defensive-design", 1)]);
  const { PREDICATES } = await import(modUrl("effects/conditions.mjs"));
  const T = dd.tierOfPower;
  check("Defensive Design: Mind, Secondary, fifth - compiling; Dodge Critical Target 1 lower; Damage Reduction 1(T); (3) Life on an "
    + "Adaptation Point gained and (4) one on a Dodge Critical, 3/Round each; (5) the Defend free for 2 of them, once an Encounter",
    [t.owner, t.category, t.importance, Number(t.order), compile(t.script).errors.length, add(dd, "criticalTarget.dodge"),
     dd.damageReduction - plain.damageReduction,
     compile(t.script).program.blocks.filter(b => b.mode !== "passive").map(b => `${b.moment}/${b.budget?.round ?? b.budget?.encounter ?? ""}`),
     ["dodge", "strike", undefined].map(rollKind => PREDICATES.dodgeRolled({ context: { rollKind } })),
     dd.effects.slots["defensiveDesign.defend"] && read("module", "chat.mjs").includes("const designed = !free && !perfect && !dual && !angel && !shinjin && await defensiveFreeDefend(target);"),
     read("module", "chat.mjs").includes('await answerFor(target, "critical-scored", { rollKind: "dodge" });')],
    ["bio-android", "mind", "secondary", 5, 0, -1, T, ["adaptation-gained/3", "critical-scored/3"], [true, false, false], true, true]);
}

// --- Weapon of Mass Destruction: Biological Weapon -------------------------------------------------------------------------------
{
  const f = getTrait("weapon-of-mass-destruction"), t = getTrait("biological-weapon");
  check("Weapon of Mass Destruction: Bio-Android, 1, N/A; Biological Weapon: Body, Primary (for Uncanny Monster) - compiling; its "
    + "Signature Technique made; (4) as a Signature Technique is declared, 1/Round; (5) at the Power Up, 1/Encounter",
    [f.requirement, Number(f.maximumFactor), f.prerequisites, t.factor ?? t.owner, t.category, t.importance, compile(t.script).errors.length,
     t.grantsSignature, compile(t.script).program.blocks.filter(b => b.mode !== "passive").map(b => `${b.moment}/${b.budget?.round ?? b.budget?.encounter ?? ""}`)],
    ["Bio-Android", 1, "N/A", t.factor ?? t.owner, "body", "primary", 0, "Biological Weapon Technique", ["declare-maneuver/1", "power/1"]]);
  const bw = bio([traitItem("artificial-warrior", 0, { option: "pursuit-of-perfection" }), traitItem("biological-weapon", 1)]);
  const def = { name: "adaptation", max: 3 };
  const { PREDICATES } = await import(modUrl("effects/conditions.mjs"));
  const round = n => ({ data: { parent: { getFlag: () => ({ round: "c:2", count: n }) } } });
  globalThis.game = { ...(globalThis.game ?? {}), combat: { started: true, id: "c", round: 2 } };
  const twice = [PREDICATES.adaptationTwiceThisRound(round(2)), PREDICATES.adaptationTwiceThisRound(round(1))];
  globalThis.game.combat = { started: true, id: "c", round: 3 };
  twice.push(PREDICATES.adaptationTwiceThisRound(round(5)));
  globalThis.game.combat = null;
  check("(2) Adaptation Points one higher - 5 with Pursuit of Perfection; (3) 2+ gained this Round, not 1, not last Round",
    [resourceCeiling(def, { system: bw }), twice], [5, [true, false, false]]);
  const CH = read("module", "chat.mjs"), UM = read("module", "use-maneuver.mjs"), RT = read("module", "effects", "moments-runtime.mjs"),
    RAC = read("module", "racial.mjs");
  check("wired: the Technique made with its free TP; the declaration's Charges; Ki 1(bT) a point; gained ones counted per Round; (5) all "
    + "of them spent",
    [RAC.includes("if (trait.grantsSignature) await grantSignature(actor, item, String(trait.grantsSignature));"),
     RAC.includes('signature: { level: "super", freeTP: cap }'),
     UM.includes('+ bioCharges\n    + (declared.glassForced ? 1 : 0) : 0;'), CH.includes("return Math.floor(spent / 2);"),
     CH.includes("await regainPools(actor, 0, spent * Math.max(1, Number(actor.system.baseTierOfPower) || 1));"),
     RT.includes('await actor.setFlag?.("dbu-ttrpg", "adaptationRound", { round, count });'),
     t.script.includes("life.value += adaptation.stacks * 2(bT);\nki.value += adaptation.stacks * 2(bT);\nadaptation.stacks = 0;")],
    [true, true, true, true, true, true, true]);
}

// --- Genetic Splicing: Arcosian Genes ---------------------------------------------------------------------------------------------
{
  const t = getTrait("arcosian-genes");
  const ids = ["arcosian-genes-survivor", "arcosian-genes-aggressor", "arcosian-genes-agility", "arcosian-genes-perfection"];
  check("Arcosian Genes: Body, Secondary - compiling; its Saving Throw chosen; its Plating; following Artificial Warrior's Option; (5) "
    + "the Healing Surge's 1 Break Value, 1/Round; its four Options",
    [t.factor ?? t.owner, t.category, t.importance, compile(t.script.replaceAll("$choice", "morale")).errors.length, t.choose, t.naturalArmor, t.optionsFollow, Number(t.optionEffect),
     compile(t.script).program.blocks.filter(b => b.mode !== "passive").map(b => `${b.moment}/${b.budget?.round ?? ""}`),
     ids.map(id => [getTrait(id).optionOf, getTrait(id).follows, compile(getTrait(id).script).errors.length, blocks(getTrait(id).script)])],
    [t.factor ?? t.owner, "body", "secondary", 0, "savingThrow", "Plating", "artificial-warrior", 4, ["healing-surge/1"],
     [["arcosian-genes", "genetic-survivor", 0, ["triggered/plating-reduced"]], ["arcosian-genes", "genetic-aggressor", 0, ["triggered/adaptation-on-roll"]],
      ["arcosian-genes", "genetic-agility", 0, ["triggered/adaptation-on-roll"]], ["arcosian-genes", "pursuit-of-perfection", 0, ["triggered/start-of-turn"]]]]);
  const item = traitItem("arcosian-genes", 1, { option: "arcosian-genes-agility" });
  item.system.script = item.system.script.replaceAll("$choice", "morale");
  const ag = bio([traitItem("artificial-warrior", 0, { option: "genetic-agility" }), item]);
  check("its chosen Saving Throw's Racial Bonus; the Tail Attack; no Suffocating; its Option's flag",
    [ag.effects.slots["save.racial.morale"], ag.effects.slots["maneuver.tail-attack"], ag.effects.slots["condition.suffocating"],
     blocks(getTrait("arcosian-genes-agility").script), blocks(getTrait("arcosian-genes-aggressor").script)],
    [true, true, false, ["triggered/adaptation-on-roll"], ["triggered/adaptation-on-roll"]]);
  const CH = read("module", "chat.mjs"), NA = read("module", "natural-armor.mjs");
  check("wired: the Plating's Break Value lowered fires plating-reduced; the Wound's Strike spending passed; the Plating's bonus, broken "
    + "nothing, half on a Dodge",
    [NA.includes('await (await import("./chat.mjs")).answerFor(item.parent, "plating-reduced", {});'),
     CH.includes("strikeAdapted: Number(attack.result?.strike?.adapted) || 0,"),
     CH.includes("return Number(actor?.system?.naturalArmor?.apparelBonus) || 0;"),
     CH.includes('if (onRoll?.slots?.["arcosianDodge.plating"] === true) {')],
    [true, true, true, true]);
}

// --- Genetic Splicing: Majin Genes, Namekian Genes ---------------------------------------------------------------------------------
{
  const mg = getTrait("majin-genes"), ng = getTrait("namekian-genes"), sm = getTrait("namekian-genes-second-effect");
  const m = bio([traitItem("majin-genes", 1)]);
  check("Majin Genes: Body, Secondary - compiling; Morale's Racial Saving Throw Bonus; Unnatural; (3)'s flag; (4) targeted, 1/Round",
    [mg.category, mg.importance, compile(mg.script).errors.length, m.effects.slots["save.racial.morale"], m.effects.slots.unnatural,
     m.effects.slots["majinGenes.collision"], compile(mg.script).program.blocks.filter(b => b.mode !== "passive").map(b => `${b.moment}/${b.budget?.round ?? ""}`)],
    ["body", "secondary", 0, true, true, true, ["targeted-by-attack/1"]]);
  const item = traitItem("namekian-genes", 1, { option: "genes-of-a-warrior-clan" });
  item.system.script = item.system.script.replaceAll("$choice", "cognitive");
  const plain = bio([]), n = bio([item]);
  check("Namekian Genes: compiling; its Saving Throw chosen; Surgency 1(T); (2) its Healing Surge Maneuver, 1 Action, 4(bT) Ki, 1/Round; "
    + "(3) the Round's start; its two Options - the Dragon Clan's Healing Hands",
    [compile(ng.script.replaceAll("$choice", "cognitive")).errors.length, ng.choose, n.effects.slots["save.racial.cognitive"],
     n.surgency - plain.surgency, [sm.type, Number(sm.actionCost), Number(sm.kiCostPerBaseTier), sm.usageLimit, sm.surgeKind, sm.fromTrait],
     blocks(ng.script), n.effects.slots["namekianGenes.warrior"], getTrait("genes-of-a-dragon-clan").grantsUnique,
     compile(getTrait("genes-of-a-dragon-clan").script).errors.length],
    [0, "savingThrow", true, plain.tierOfPower, ["standard", 1, 4, "1/round", "healing", "namekian-genes"], ["triggered/start-of-round"], true,
     "healing-hands", 0]);
  const CH = read("module", "chat.mjs"), UM = read("module", "use-maneuver.mjs");
  // Three ways it is taken now: a Vehicle that hits them is the third (chat.mjs collisionTaken).
  check("wired: targeted-by-attack fired for each one aimed at; Collision ignored for a point, every way it is taken; the Warrior Clan's "
    + "half Surgency once a Round; the Dragon Clan's 4(bT) a point on Healing Hands",
    [CH.includes('await answerFor(other, "targeted-by-attack", { attackerUuid: actor.uuid });'),
     (CH.match(/const ignored = await majinCollision\(target, /g) ?? []).length,
     CH.includes('const clanAdd = ((slot === "wound") && attackingManeuver && (adapted >= 2)'),
     UM.includes("clanLife = spent * 4 * baseTier;"), CH.includes("+ (Number(plan.clanLife) || 0);")],
    [true, 3, true, true, true]);
}

// --- Genetic Splicing: Android Cybernetics -----------------------------------------------------------------------------------------
{
  const t = getTrait("android-cybernetics");
  const plain = bio([]), a = bio([traitItem("android-cybernetics", 1)]);
  const CH = read("module", "chat.mjs");
  check("Android Cybernetics: Body, Secondary - compiling; Cognitive's Racial Saving Throw Bonus; Damage Reduction 1(bT); Maximum Ki 2 a "
    + "Power Level; (3), (5) flags; (4) the Round's start",
    [t.category, t.importance, compile(t.script).errors.length, a.effects.slots["save.racial.cognitive"], a.damageReduction - plain.damageReduction,
     a.ki.max - plain.ki.max, a.effects.slots["androidCybernetics.kiSurge"], a.effects.slots["androidCybernetics.charge"], blocks(t.script)],
    ["body", "secondary", 0, true, plain.baseTierOfPower, 2 * plain.powerLevel, true, true, ["triggered/start-of-round"]]);
  check("wired: the Ki Surge's Surgency, half of it a point, 2 at most; a Signature Technique's Wound - one Charge's dice on it, once an "
    + "Encounter",
    [CH.includes("surgency += spent * Math.floor((Number(actor.system.surgency) || 0) / 2);"),
     CH.includes("const most = Math.min(2, adaptationHeld);"),
     CH.includes('oneCharge: effectSignature(attacker, attack) ? energyChargeDice(attacker, { ...attack, energyCharges: 1 }) : "",'),
     CH.includes('extraDice = [...asDiceGroups(extraDice), { label: "Energy Charge (Android Cybernetics)", formula: oneCharge }];')],
    [true, true, true, true]);
}

// --- Genetic Splicing: Cerealian Genes ------------------------------------------------------------------------------------------------
{
  const t = getTrait("cerealian-genes");
  const c = bio([traitItem("cerealian-genes", 1)]);
  const { PREDICATES } = await import(modUrl("effects/conditions.mjs"));
  const TQ = await import(modUrl("technique.mjs"));
  const holder = { system: { effects: { slots: c.effects.slots } } };
  check("Cerealian Genes: compiling; Impulsive's Racial Saving Throw Bonus; Strike's Critical Target 1 lower; no Long Range Penalty; Short "
    + "Range refused in the builder; (3), (5) flags; (4) an attack's Critical Strike",
    [compile(t.script).errors.length, c.effects.slots["save.racial.impulsive"], add(c, "criticalTarget.strike"), c.effects.slots["longRange.ignore"],
     TQ.featureProblem("short-range", { features: [] }, { actor: holder }).startsWith("Cerealian Genes"),
     TQ.featureProblem("short-range", { features: [] }, { actor: { system: { effects: { slots: {} } } } }).startsWith("Cerealian Genes"),
     c.effects.slots["cerealianGenes.wound"], c.effects.slots["cerealianGenes.calledShot"], blocks(t.script),
     [{ rollKind: "strike", attackRoll: true }, { rollKind: "strike" }, { rollKind: "wound", attackRoll: true }].map(context => PREDICATES.attackStrikeRolled({ context }))],
    [0, true, -1, true, true, false, true, true, ["triggered/critical-scored"], [true, false, false]]);
  const CH = read("module", "chat.mjs"), UM = read("module", "use-maneuver.mjs");
  check("wired: the Critical Strike's Wound 3(T) for a point, as it hits; the Called Shot for 2 points, paid with the rest, once a Round",
    [CH.includes("if (cerealian) answer.marks.cerealianWound = cerealian;"), CH.includes('label: "Cerealian Genes", written: "+3(T)"'),
     UM.includes('await actor.setFlag("dbu-ttrpg", "cerealianCalledRound", round);'), UM.includes("if (called && !byEyes && !byAdaptation && weak) {")],
    [true, true, true, true]);
}

// --- Genetic Splicing: Demon Genes -------------------------------------------------------------------------------------------------
{
  const t = getTrait("demon-genes");
  const opts = ["demon-person-genes", "makyan-genes", "phantom-genes"];
  const d = bio([traitItem("demon-genes", 1, { option: "makyan-genes" })]);
  const { PREDICATES } = await import(modUrl("effects/conditions.mjs"));
  check("Demon Genes: compiling; Cognitive's Racial Saving Throw Bonus; (1) the roll at the turn's start; (2) on its Moment; (4) Superior, "
    + "out of sequence, 1/Round; three Options, each its flag",
    [compile(t.script).errors.length, d.effects.slots["save.racial.cognitive"], Number(t.optionEffect),
     compile(t.script).program.blocks.filter(b => b.mode !== "passive").map(b => `${b.moment}/${b.budget?.round ?? ""}${b.modifiers?.outOfSequence ? "+oos" : ""}`),
     opts.map(id => [getTrait(id).optionOf, compile(getTrait(id).script).errors.length]), d.effects.slots["demonGenes.makyan"],
     [7, 8, 10].map(natural => PREDICATES.naturalAtLeast({ context: { natural } }, 8))],
    [0, true, 5, ["start-of-turn/", "demon-genes-rolled/", "state/superior/1+oos"], opts.map(() => ["demon-genes", 0]), true, [false, true, true]]);
  const CH = read("module", "chat.mjs");
  check("wired: the Option's change to the Natural Result; Superior or Impediment this turn; a 1 or less - the points, or Fatigued; the Moment",
    [CH.includes("const natural = rolled + (person ? 1 : 0) - (makyan ? 1 : 0);"),
     CH.includes('if (superior) await enterState(actor, "superior", 1, "turn", "Demon Genes");'),
     CH.includes('else await markUntilNextTurn(actor, actor, "impediment", 1, "end", "Demon Genes", false);'),
     CH.includes('else if (one) await markUntilNextTurn(actor, actor, "fatigued", 1, "end", "Demon Genes", false);'),
     CH.includes('await answerFor(actor, "demon-genes-rolled", { natural });')],
    [true, true, true, true, true]);
}

// --- Genetic Splicing: Earthling Genes ------------------------------------------------------------------------------------------------
{
  const t = getTrait("earthling-genes");
  const e = bio([traitItem("earthling-genes", 1)]);
  const { PREDICATES } = await import(modUrl("effects/conditions.mjs"));
  const CH = read("module", "chat.mjs");
  check("Earthling Genes: compiling; Morale's Racial Saving Throw Bonus; 3 TP a Skill Improvement; (2) below Injured; (3)'s flag; (4) a "
    + "Signature Technique's Damage, 1/Round; wired",
    [compile(t.script).errors.length, e.effects.slots["save.racial.morale"], add(e, "techniquePoints.perSkillImprovement"),
     t.script.includes('if (belowThreshold("injured")) {\n    combatRolls += 1(T);\n    soakValue += 1(T);'), e.effects.slots["earthlingGenes.signatureWound"],
     compile(t.script).program.blocks.filter(b => b.mode !== "passive").map(b => `${b.moment}/${b.budget?.round ?? ""}`),
     [PREDICATES.bySignatureTechnique({ context: { bySignature: true } }), PREDICATES.bySignatureTechnique({ context: {} })],
     CH.includes("value: adapted * Math.max(1, Number(actor.system.tierOfPower) || 1) * (adaptDoubled ? 2 : 1) });"),
     CH.includes('...(effectSignature(fromUuidSync(attack.attackerUuid ?? ""), attack) ? { bySignature: true } : {}),'),
     CH.includes("signatureRoll: effectSignature(attacker, attack),")],
    [0, true, 3, true, true, ["damaged-opponent/1"], [true, false], true, true, true]);
}

// --- Genetic Splicing: Glass Genes ---------------------------------------------------------------------------------------------------
{
  const t = getTrait("glass-genes");
  const item = traitItem("glass-genes", 1);
  item.system.script = item.system.script.replaceAll("$choice", "impulsive");
  const plain = bio([]), g = bio([item]);
  const UM = read("module", "use-maneuver.mjs");
  check("Glass Genes: compiling; its Saving Throw chosen; Glassification and the Glass Profile; Damage Reduction 1(T); (3) on a Glass "
    + "Square; (4) chosen on a Glass Square; (5) a Glass attack declared, 1/Round; the declaration says it is Glass",
    [compile(t.script.replaceAll("$choice", "impulsive")).errors.length, t.choose, g.effects.slots["save.racial.impulsive"],
     g.effects.slots["maneuver.glassification"], g.effects.slots["profile.glass"], g.damageReduction - plain.damageReduction,
     t.script.includes('if (onSquare("glass")) {\n    combatRolls += 1(T);\n    surgency += 2(T);'),
     compile(t.script.replaceAll("$choice", "impulsive")).program.blocks.filter(b => b.mode !== "passive").map(b => `${b.moment}/${b.budget?.round ?? ""}`),
     UM.includes("...(glassDeclared ? { glass: true } : {})")],
    [0, "savingThrow", true, true, true, plain.tierOfPower, true, ["start-of-turn/", "declare-maneuver/1"], true]);
}

// --- Genetic Splicing: Heran Genes ----------------------------------------------------------------------------------------------------
{
  const t = getTrait("heran-genes");
  const item = traitItem("heran-genes", 1);
  item.system.script = item.system.script.replaceAll("$choice", "morale");
  const h = bio([item]);
  const MN = read("module", "maneuvers.mjs"), SH = read("module", "sheets", "actor-character-sheet.mjs"), CH = read("module", "chat.mjs");
  check("Heran Genes: compiling; its Saving Throw chosen; Soak 1(T) at 2+ Power; (2), (3), (4) flags; (5) the turn's start with Power; wired",
    [compile(t.script.replaceAll("$choice", "morale")).errors.length, h.effects.slots["save.racial.morale"],
     t.script.includes('if (stacksAtLeast(2, "power")) {\n    soakValue += 1(T);'),
     [h.effects.slots["heranGenes.powerInstant"], h.effects.slots["heranGenes.area"], h.effects.slots["heranGenes.magnitude"]],
     blocks(t.script.replaceAll("$choice", "morale")),
     MN.includes('{ title: "Heran Genes", flag: "heranAreaRound", ki: 0, adaptation: 2 }'),
     MN.includes('{ title: "Heran Genes", flag: "heranMagnitudeRound", step: 1, adaptation: true }'),
     SH.includes('return this.actor.setFlag("dbu-ttrpg", "heranInstantRound", round);'),
     CH.includes('await setResource(actor, "power", power - lost);')],
    [0, true, true, [true, true, true], ["triggered/start-of-turn"], true, true, true, true]);
}

// --- Genetic Splicing: Konatsian Genes -------------------------------------------------------------------------------------------------
{
  const t = getTrait("konatsian-genes"), mark = getTrait("konatsian-superior-mark");
  const k = bio([traitItem("konatsian-genes", 1)]);
  const CH = read("module", "chat.mjs");
  check("Konatsian Genes: compiling; Morale's Racial Saving Throw Bonus; (1), (2) flags; (4) an Ally Defeated; (5) the turn's start below "
    + "Injured; (6) knocked through or at the turn's start, 1/Encounter - its mark waiving Superior's 2nd; wired",
    [compile(t.script).errors.length, k.effects.slots["save.racial.morale"], true, true,
     compile(t.script).program.blocks.filter(b => b.mode !== "passive").map(b => `${b.moment}/${b.budget?.encounter ?? ""}`),
     [mark.combatCondition, compile(mark.script).errors.length, mark.script.includes("allow superior.noExtraDamage;")],
     CH.includes('parts.push({ label: "Konatsian Genes", value });'), CH.includes("+ (Number(own.adaptationSoak) || 0)"),
     CH.includes("adaptationSoak: adapt.soak,")],
    [0, true, true, true, ["adaptation-on-roll/", "adaptation-on-hit/", "ally-defeated/", "start-of-turn/"], [false, 0, true], true, true, true]);
  check("Konatsian Genes (6) no button: asked as knocked through and as the turn begins, once an Encounter",
    [k.effects.slots["konatsianSuperior.ask"], (read("module", "combat.mjs").match(/konatsianSuperior\(actor\)/g) ?? []).length,
     CH.includes('await enterState(actor, "superior", 1, "next-turn", "Konatsian Genes");')], [true, 2, true]);
}

// --- Genetic Splicing: Neko Majin Genes -----------------------------------------------------------------------------------------------
{
  const t = getTrait("neko-majin-genes");
  const item = traitItem("neko-majin-genes", 1);
  item.system.script = item.system.script.replaceAll("$choice", "morale");
  const n = bio([item]);
  const CH = read("module", "chat.mjs");
  check("Neko Majin Genes: compiling; Cognitive or Morale; Illusion and Shapeshift; Unique Abilities' Ki 2(T) less; (3) its reroll beside the "
    + "Karmic Effects, 3/Round, not a Clash's; (4) the turn's start",
    [compile(t.script.replaceAll("$choice", "morale")).errors.length, t.choose, t.choices, n.effects.slots["save.racial.morale"], t.grantsUnique,
     add(n, "unique.kiCost"), n.effects.slots["nekoMajinGenes.reroll"], blocks(t.script.replaceAll("$choice", "morale")),
     CH.includes("...damaRerollOption(situation.actor), ...nekoGenesRerollOption(situation),"),
     CH.includes("if (key === NEKO_GENES_REROLL) return takeNekoGenesReroll(message, situation);"),
     CH.includes('if ((situation?.kind === "clash") || (actor?.system?.effects?.slots?.["nekoMajinGenes.reroll"] !== true)) return [];')],
    [0, "list", ["Cognitive", "Morale"], true, ["illusion", "shapeshift"], -2 * n.tierOfPower, true, ["triggered/start-of-turn"], true, true, true]);
}

// --- Genetic Splicing: Neo-Tuffle Genes -----------------------------------------------------------------------------------------------
{
  const t = getTrait("neo-tuffle-genes");
  const n = bio([traitItem("neo-tuffle-genes", 1, { option: "genes-of-hatred" })]);
  const CH = read("module", "chat.mjs");
  check("Neo-Tuffle Genes: compiling; Cognitive's Racial Saving Throw Bonus; (1) an Opponent's Damage; (2) the Basic Attack back on its card, "
    + "2 Adaptation Points paid as taken; its two Options; wired",
    [compile(t.script).errors.length, n.effects.slots["save.racial.cognitive"], blocks(t.script), n.effects.slots["neoTuffleGenes.strike"],
     n.effects.slots["neoTuffleGenes.hatred"], ["genes-of-hatred", "genes-of-a-parasite"].map(id => [getTrait(id).optionOf, compile(getTrait(id).script).errors.length]),
     CH.includes('grants: { roundFlag: "neoTuffleStrikeRound", adaptationCost: cost } } });'),
     CH.includes("Number(offer.grants.adaptationCost)));"), CH.includes("await parasiteGenesFor(attacker, attack, struck);"),
     CH.includes("const value = strikeAdapted * Math.max(1, Number(actor.system.tierOfPower) || 1);")],
    [0, true, ["triggered/opponent-damage"], true, true, [["neo-tuffle-genes", 0], ["neo-tuffle-genes", 0]], true, true, true, true]);
}

// --- Genetic Splicing: Saiyan Genes ---------------------------------------------------------------------------------------------------
{
  const t = getTrait("saiyan-genes"), mark = getTrait("battle-creation-mark");
  const item = traitItem("saiyan-genes", 1);
  item.system.script = item.system.script.replaceAll("$choice", "corporeal");
  const s = bio([item]);
  const def = { name: "battlecreation", max: 2 };
  const CH = read("module", "chat.mjs"), RT = read("module", "effects", "moments-runtime.mjs");
  check("Saiyan Genes: compiling; its Saving Throw chosen; Battle Creation (2), 3 with its mark; (1) knocked through; (4) Defeated with 3 "
    + "points, a Steadfast Check 2 off; wired",
    [compile(t.script.replaceAll("$choice", "corporeal")).errors.length, t.choose, s.effects.slots["save.racial.corporeal"], t.resource,
     Number(t.resourceMax), resourceCeiling(def, { system: s }), [mark.combatCondition, compile(mark.script).errors.length],
     blocks(t.script.replaceAll("$choice", "corporeal")).slice(0, 2), t.script.includes("steadfastEnter(-2, saiyan-genes);"),
     RT.includes('if (passed && (String(args[1]) === "saiyan-genes")) return (await import("../chat.mjs")).saiyanGenesPassed(actor);'),
     CH.includes('await setResource(actor, "battlecreation", 3);')],
    [0, "savingThrow", true, "battlecreation", 2, 2, [false, 0], ["triggered/threshold", "triggered/defeated"], true, true, true]);
}

// --- Genetic Splicing: Shadow Dragon Genes --------------------------------------------------------------------------------------------
{
  const t = getTrait("shadow-dragon-genes");
  const plain = bio([]), s = bio([traitItem("shadow-dragon-genes", 1)]);
  const { PREDICATES } = await import(modUrl("effects/conditions.mjs"));
  const CH = read("module", "chat.mjs");
  check("Shadow Dragon Genes: compiling; Morale's Racial Saving Throw Bonus; Racial Life Modifier 2; (2) the trade at the turn's start; (3) "
    + "Ki on a point gained; (5) 4(bT)+ 1/Round, (6) 8(bT)+ 1/Encounter; (4) a Botch not at Long Range; wired",
    [compile(t.script).errors.length, s.effects.slots["save.racial.morale"], s.racialLifeModifier - plain.racialLifeModifier,
     compile(t.script).program.blocks.filter(b => b.mode !== "passive").map(b => `${b.moment}/${b.budget?.round ?? b.budget?.encounter ?? ""}`),
     [3, 4, 8].map(lostBT => PREDICATES.lostAtLeastBT({ context: { lostBT } }, 4)), s.effects.slots["shadowDragonGenes.impair"],
     CH.includes("    shadowGenesImpair(dragon, botcher);"), CH.includes('await answerFor(actor, "life-for-ki", { lostBT: lost / bT });'),
     CH.includes('await markUntilNextTurn(opponent, opponent, "impaired", 1, "start", "Shadow Dragon Genes");')],
    [0, true, 2, ["start-of-turn/", "adaptation-gained/", "life-for-ki/1"], [false, true, true], true, true, true, true]);
  check("Shadow Dragon Genes (6) no button: asked after an 8(bT) trade, once an Encounter",
    [s.effects.slots["shadowDragonGenes.eight"], CH.includes('[{ value: "yes", label: "2 Adaptation Points (1/Encounter)" }')], [true, true]);
}

// --- Genetic Splicing: Shinjin Genes ----------------------------------------------------------------------------------------------------
{
  const t = getTrait("shinjin-genes");
  const s = bio([traitItem("shinjin-genes", 1)]);
  const CH = read("module", "chat.mjs");
  check("Shinjin Genes: compiling; Cognitive's Racial Saving Throw Bonus; God Ki; Unique Abilities' TP 2 less; attacks' Ki 1(T) less; (4) "
    + "Shinjin-Raised's Counter mark; (5) the Round's end; (6) the Defend and the Intervene for 2 points",
    [compile(t.script).errors.length, s.effects.slots["save.racial.cognitive"], s.effects.slots["sense.godKi"],
     [add(s, "unique.technical.tpCost"), add(s, "unique.magical.tpCost")], add(s, "attack.kiCost"), s.effects.slots["shinjinRaised.counter"],
     blocks(t.script), CH.includes('await shinjinFreeCounter(target, "the Defend Maneuver");'),
     CH.includes('await shinjinFreeCounter(actor, "the Intervene Maneuver");')],
    [0, true, true, [-2, -2], -s.tierOfPower, true, ["triggered/end-of-round"], true, true]);
}

// --- Genetic Splicing: Yardrat Genes ----------------------------------------------------------------------------------------------------
{
  const t = getTrait("yardrat-genes");
  const item = traitItem("yardrat-genes", 1, { option: "tall-yardrat-genes" });
  item.system.script = item.system.script.replaceAll("$choice", "impulsive");
  const plain = bio([]), y = bio([item]);
  const CH = read("module", "chat.mjs"), UM = read("module", "use-maneuver.mjs");
  check("Yardrat Genes: compiling; Cognitive or Impulsive; Maximum Ki 2 a Power Level; (2) an Ally's roll; (3) Power of the Weak's button; "
    + "(4) the Empower's Actions, 1/Round; Tall - Spiritual Warrior's Soak; Bulbous - any Power, once a Round; wired",
    [compile(t.script.replaceAll("$choice", "impulsive")).errors.length, t.choices, y.effects.slots["save.racial.impulsive"], y.ki.max - plain.ki.max,
     y.effects.slots["yardratGenes.allyRoll"], y.effects.slots["weak.targeted"], y.effects.slots["warrior.weakSoak"],
     compile(t.script.replaceAll("$choice", "impulsive")).program.blocks.filter(b => b.mode !== "passive").map(b => `${b.moment}/${b.budget?.round ?? ""}`),
     compile(getTrait("bulbous-yardrat-genes").script).errors.length,
     UM.includes('await answerFor(actor, "empowered-ally", { allyUuid: ally.uuid, gained, actionsSpent });'),
     CH.includes('if (ally.system?.defeated || (held <= 0) || (ally.system?.effects?.slots?.["yardratGenes.allyRoll"] !== true)) continue;'),
     CH.includes('await actor.setFlag(SCOPE, bulbous ? "bulbousPowerRound" : "pacifistPowerRound", roundKey());')],
    [0, ["Cognitive", "Impulsive"], true, 2 * plain.powerLevel, true, true, true, ["empowered-ally/1"], 0, true, true, true]);
}

// --- Bio-Focus: Genetic Focus: Android -----------------------------------------------------------------------------------------------
{
  const t = getTrait("genetic-focus-android");
  const ids = ["surging-power", "weapon-ports", "power-absorption", "hyper-resilience", "enhanced-reflexes", "weapon-style", "heroic-style",
    "calculating-style", "alternate-scale-structure", "extension-feature"].map(id => `focus-${id}`);
  const plain = bio([]), g = bio([traitItem("genetic-focus-android", 1, { option: "focus-power-absorption" })]);
  const ac = getTrait("android-cybernetics");
  check("Genetic Focus: Android - Body, Primary, its name with a colon; Surgency 2(T); ten Options copied from Technological Being, (4)'s, "
    + "compiling; Android Cybernetics' Ki doubled where it is held; replaces Uncanny Monster",
    [t.name, t.category, t.importance, compile(t.script).errors.length, g.surgency - plain.surgency,
     ids.map(id => [getTrait(id)?.optionOf, Number(getTrait(id)?.optionEffect), compile(String(getTrait(id)?.script ?? "x").replaceAll("$choice", "tiny").replaceAll("$tiny", "1").replaceAll("$enormous", "0")).errors.length]),
     g.effects.slots["maneuver.power-drain"], ac.script.includes('if (holdsTrait("genetic-focus-android")) {\n    ki.value += 2(bT);'),
     read("module", "racial.mjs").includes("const named = /^[^\\n]*?\\)\\s*\\[([^\\]]+)\\]\\s*:/.exec(")],
    ["Genetic Focus: Android", "body", "primary", 0, 2 * plain.tierOfPower, ids.map(() => ["genetic-focus-android", 4, 0]), true, true, true]);
}

// --- Bio-Focus: Genetic Focus: Angel -------------------------------------------------------------------------------------------------
{
  const t = getTrait("genetic-focus-angel");
  const plain = bio([]), g = bio([traitItem("genetic-focus-angel", 1)]);
  const CH = read("module", "chat.mjs"), RT = read("module", "effects", "moments-runtime.mjs");
  check("Genetic Focus: Angel - Primary, compiling; with no Adaptation Points Defense and Soak 1(T); (4) on points spent, 2(bT) each; (6) "
    + "knocked to Injured, a Healing Surge out of sequence; (5)'s flag; points spent fire adaptation-spent, lost ones not",
    [t.importance, compile(t.script).errors.length, g.defenseValue - plain.defenseValue, CH.includes('if (onRoll?.slots?.["focusAngel.natural"] === true)'),
     compile(t.script).program.blocks.filter(b => b.mode !== "passive").map(b => `${b.moment}${b.modifiers?.outOfSequence ? "+oos" : ""}`),
     CH.includes('if ((name === "adaptation") && !lost && (capped < before)) await answerFor(actor, "adaptation-spent", { spent: before - capped });'),
     CH.includes('await setResource(actor, "adaptation", 0, { lost: true });'),
     RT.includes('await (await import("../chat.mjs")).answerFor(actor, "adaptation-spent", { spent: spentAdaptation });')],
    ["primary", 0, plain.tierOfPower, true, ["adaptation-spent", "adaptation-on-roll", "threshold+oos"], true, true, true]);
}

// --- Bio-Focus: Genetic Focus: Arcosian ----------------------------------------------------------------------------------------------
{
  const t = getTrait("genetic-focus-arcosian");
  const g = bio([traitItem("genetic-focus-arcosian", 1)]);
  const CH = read("module", "chat.mjs");
  check("Genetic Focus: Arcosian - Primary, compiling; the Plating 1(T) per Tier as Bio-Suit's; (3)'s flag, the Tail Attack's Wound; (4) "
    + "once an attack; (5) knocked through or Defeated, once an Encounter between them; wired",
    [t.importance, compile(t.script).errors.length, Number(t.platingBonusPerTier), g.effects.slots["focusArcosian.tailWound"], blocks(t.script),
     CH.includes('tailRoll: attack.maneuverId === "tail-attack",'), CH.includes('await answerFor(woundMaker, "adaptation-wound-damage", { spent: woundSpent });'),
     CH.includes('await ownOutOfSequence(actor, "energy-charge");'), CH.includes("return Number(actor?.system?.naturalArmor?.apparelBonus) || 0;")],
    ["primary", 0, 1, true, ["triggered/adaptation-wound-damage"], true, true, true, true]);
  check("(5) no button - asked, once an Encounter, as an Opponent is knocked through or Defeated by your attack",
    [g.effects.slots["focusArcosian.surge"], (read("module", "combat.mjs").match(/focusArcosianSurge\(knocker\)/g) ?? []).length,
     CH.includes('if (!actor || (actor.system?.effects?.slots?.["focusArcosian.surge"] !== true)')],
    [true, 2, true]);
}

// --- Saiyan Genes (5) with its button ---------------------------------------------------------------------------------------------
{
  const t = getTrait("saiyan-genes");
  check("Saiyan Genes (5): its Moment after the Check, 1/Encounter, its button; the code reads its answer",
    [compile(t.script.replaceAll("$choice", "corporeal")).program.blocks.filter(b => b.mode !== "passive").map(b => `${b.moment}/${b.budget?.encounter ?? ""}`),
     read("module", "chat.mjs").includes('if (passed?.slots?.["battleCreation.three"] !== true) return;')],
    [["threshold/", "defeated/", "saiyan-genes-passed/1"], true]);
}

// --- The user's button criteria applied (2026-11-06) ----------------------------------------------------------------------------
{
  const { chosenAsItHappens } = await import(modUrl("effects/registry.mjs"));
  const first = id => compile(getTrait(id).script.replaceAll("$choice", "morale")).program.blocks.filter(b => b.mode !== "passive");
  check("no button (chosen, a window, out of sequence, Defeated) - Hyper Resilience, Demon Genes (1), Heran Genes (5), Artificial Warrior "
    + "(2), Angel Genes (3), Glass Genes (5), Saiyan Genes (4), Biological Weapon (4)(5), Demon Genes (4), Enhanced Reflexes, Uncanny "
    + "Monster (4), Genetic Focus: Angel (6); a button - Surging Power (both), Shadow Dragon Genes (2), Phantom Genes",
    [chosenAsItHappens(first("focus-hyper-resilience")[0]), chosenAsItHappens(first("demon-genes")[0]), chosenAsItHappens(first("heran-genes")[0]),
     chosenAsItHappens(first("artificial-warrior")[1]), chosenAsItHappens(first("angel-genes")[0]), chosenAsItHappens(first("glass-genes")[1]),
     chosenAsItHappens(first("saiyan-genes")[1]), chosenAsItHappens(first("biological-weapon")[0]), chosenAsItHappens(first("biological-weapon")[1]),
     chosenAsItHappens(first("demon-genes")[2]), chosenAsItHappens(first("focus-enhanced-reflexes")[0]), chosenAsItHappens(first("uncanny-monster")[0]),
     chosenAsItHappens(first("genetic-focus-angel")[2]),
     chosenAsItHappens(first("focus-surging-power")[0]), chosenAsItHappens(first("surging-power")[0]), !chosenAsItHappens(first("shadow-dragon-genes")[0]),
     chosenAsItHappens(first("phantom-genes")[0])],
    [true, true, true, true, true, true, true, true, true, true, true, true, true, false, false, false, false]);
}

// --- Bio-Focus: Genetic Focus: Cerealian -------------------------------------------------------------------------------------------
{
  const t = getTrait("genetic-focus-cerealian");
  const g = bio([traitItem("genetic-focus-cerealian", 1)]);
  const CH = read("module", "chat.mjs");
  check("Genetic Focus: Cerealian - Primary, compiling; Called Shots' and Exploits' Wound 2(T); (2) Cerealian Genes (3) free, its button; (4), "
    + "(5) asked; wired",
    [t.importance, compile(t.script).errors.length, add(g, "wound.calledOrExploit"), blocks(t.script),
     [g.effects.slots["focusCerealian.exploit"], g.effects.slots["focusCerealian.critical"]],
     CH.includes('const free = await answerFor(attacker, "cerealian-critical", {});'),
     CH.includes('await actor.setFlag(SCOPE, "focusCerealianExploitRound", roundKey());'),
     CH.includes("    forceCritical = true;\n  }")],
    ["primary", 0, 2 * g.tierOfPower, ["triggered/cerealian-critical"], [true, true], true, true, true]);
}

// --- Bio-Focus: Genetic Focus: Demon ----------------------------------------------------------------------------------------------
{
  const t = getTrait("genetic-focus-demon");
  const g = bio([traitItem("genetic-focus-demon", 1)]);
  const CH = read("module", "chat.mjs");
  check("Genetic Focus: Demon - Primary, compiling; Combat Rolls and Damage Reduction 1(T) against the Conditioned; (4), (5), (6) asked, no "
    + "button; wired",
    [t.importance, compile(t.script).errors.length, add(g, "combatRolls.vsConditioned"), add(g, "damageReduction.vsConditioned"), blocks(t.script),
     [g.effects.slots["focusDemon.reroll"], g.effects.slots["focusDemon.clash"], g.effects.slots["focusDemon.powerUp"]],
     CH.includes('first = roll.total;\n    roll = await new Roll("1d10").evaluate();'),
     CH.includes('impede: { applied: false, choose: "focus-demon", source: "Genetic Focus: Demon" } });'),
     CH.includes('if (clash.impede.choose === "focus-demon") {'), CH.includes('await requestActorUpdate(actor, { [`flags.${SCOPE}.focusDemonPowerEncounter`]: encounter });')],
    ["primary", 0, g.tierOfPower, g.tierOfPower, [], [true, true, true], true, true, true, true]);
}

// --- Bio-Focus: Genetic Focus: Earthling -------------------------------------------------------------------------------------------
{
  const t = getTrait("genetic-focus-earthling");
  const g = bio([traitItem("genetic-focus-earthling", 1)]);
  const CH = read("module", "chat.mjs"), UM = read("module", "use-maneuver.mjs");
  check("Genetic Focus: Earthling - Primary, compiling; Wound and Surgency per Threshold below; 2 TP a Skill Improvement; (4) Quick to Master's "
    + "search for a point; (5) up to 3 boxes in the Steadfast window, once an Encounter; no buttons",
    [t.importance, compile(t.script).errors.length, add(g, "techniquePoints.perSkillImprovement"), blocks(t.script),
     t.script.includes("wound += threshold.depth * 1(T);\nsurgency += threshold.depth * 1(T);"),
     UM.includes('const earthlingPaid = !earthlingFree && (actor.system.effects?.slots?.["focusEarthling.signature"] === true)'),
     CH.includes("const focusSpent = (ready?.boxes ?? []).filter(name => /^focusEarthling\\d$/.test(name)).length;"),
     CH.includes("focusSpent ? `${focusSpent}[Genetic Focus: Earthling]` : \"\",")],
    ["primary", 0, 2, [], true, true, true, true]);
}

// --- Bio-Focus: Genetic Focus: Glass -----------------------------------------------------------------------------------------------
{
  const t = getTrait("genetic-focus-glass");
  const g = bio([traitItem("genetic-focus-glass", 1)]);
  const UM = read("module", "use-maneuver.mjs");
  const { PREDICATES } = await import(modUrl("effects/conditions.mjs"));
  check("Genetic Focus: Glass - Primary, compiling; Soak halved, as much Damage Reduction; (4) Multi-Profile with Glass, asked once a Round, Glass "
    + "Genes (5) forced; (5) ticked, no button",
    [t.importance, compile(t.script).errors.length, g.effects.slots["damageReduction.soak"], g.effects.slots["focusGlass.multi"],
     compile(t.script).program.blocks.filter(b => b.mode !== "passive").map(b => `${b.moment}/${b.modifiers?.chosen ? "chosen" : ""}`),
     UM.includes('const next = { ...maneuver, superProfile: "multi-profile", secondProfile: "glass" };'), UM.includes("+ (declared.glassForced ? 1 : 0) : 0;"),
     getTrait("glass-genes").script.includes("requires glassAttack && !glassForcedCharge"),
     [PREDICATES.glassForcedCharge({ context: { glassForced: true } }), PREDICATES.glassForcedCharge({ context: {} })]],
    ["primary", 0, true, true, ["start-of-turn/chosen"], true, true, true, [true, false]]);
}

// --- Bio-Focus: Genetic Focus: Herans ----------------------------------------------------------------------------------------------
{
  const t = getTrait("genetic-focus-herans");
  const plain = bio([]), g = bio([traitItem("genetic-focus-herans", 1)]);
  const CH = read("module", "chat.mjs");
  const def = { name: "power", max: 2 };
  check("Genetic Focus: Herans - Primary, compiling; Wound per Power stack; Power one higher; (4) in the Power Up's window, 1/Round; (5) asked "
    + "once an Encounter, the Ally's Basic Attack offered on the card",
    [t.importance, compile(t.script).errors.length, t.script.includes("wound += power.stacks * 1(T);"),
     resourceCeiling(def, { system: g }) - resourceCeiling(def, { system: plain }),
     compile(t.script).program.blocks.filter(b => b.mode !== "passive").map(b => `${b.moment}/${b.budget?.round ?? ""}`),
     g.effects.slots["focusHerans.allyStrike"], CH.includes('reason: `Genetic Focus: Herans - ${attacker.name}\'s` } });')],
    ["primary", 0, true, 1, ["power/1"], true, true]);
}

// --- Bio-Focus: Genetic Focus: Konatsians -----------------------------------------------------------------------------------------
{
  const t = getTrait("genetic-focus-konatsians");
  const g = bio([traitItem("genetic-focus-konatsians", 1)]);
  const CH = read("module", "chat.mjs");
  check("Genetic Focus: Konatsians - Primary, compiling; (3)'s flag; a Vocation's Tension counts 3 Adaptation Points and 3(bT) Ki each, Injured "
    + "or Critical, spent after Inherited Tension",
    [t.importance, compile(t.script).errors.length, g.effects.slots["focusKonatsians.tension"], blocks(t.script),
     CH.includes("+ focusKonatsianTension(actor);"), CH.includes("const converted = Math.min(rest - fromInherited, focusKonatsianTension(actor));")],
    ["primary", 0, true, [], true, true]);
}

// --- Bio-Focus: Genetic Focus: Majins -----------------------------------------------------------------------------------------------
{
  const t = getTrait("genetic-focus-majins");
  const plain = bio([]), g = bio([traitItem("genetic-focus-majins", 1)]);
  const CH = read("module", "chat.mjs"), SH = read("module", "sheets", "actor-character-sheet.mjs");
  check("Genetic Focus: Majins - Primary, compiling; Surgency by Magic; Soak and Defense 1(T); (5) knocked through, out of sequence; (6) after "
    + "a Healing Surge, asked once an Encounter, then a Standard Maneuver's Out of Sequence button",
    [t.importance, compile(t.script).errors.length, g.effects.slots["surgency.magic"], g.defenseValue - plain.defenseValue,
     compile(t.script).program.blocks.filter(b => b.mode !== "passive").map(b => `${b.moment}${b.modifiers?.outOfSequence ? "+oos" : ""}`),
     CH.includes("    await focusMajinSurge(actor);"), CH.includes("[`flags.${SCOPE}.focusMajinEncounter`]: encounter, ...outOfSequenceGranted(1) });") && !SH.includes("focusMajinOOS")],
    ["primary", 0, true, plain.tierOfPower, ["threshold+oos"], true, true]);

  // Its window (the user's): the (6) as printed above the buttons, Use and Close - not its text on a button; a long label wraps in its button.
  const fn = CH.slice(CH.indexOf("async function focusMajinSurge("), CH.indexOf("\n}\n", CH.indexOf("async function focusMajinSurge(")));
  const CSS = read("styles", "dbu-ttrpg.css");
  const RACIAL = await import(modUrl("racial.mjs"));
  const six = RACIAL.effectLineOf({ system: { text: t.text, chosen: [] } }, 6);
  check("Genetic Focus: Majins (6)'s window: its line above, Use and Close; the line shown in the choice window; long labels wrap",
    [fn.includes('traitEffectLine(actor, "genetic-focus-majins", 6)'), fn.includes('[{ value: "yes", label: "Use" }, { value: "no", label: "Close" }], { text })'),
     six.startsWith("(6)-[Triggered, 1/Encounter]: If you use a Healing Surge"),
     CH.includes('content: text ? `<p class="dbu-choice-text">${Handlebars.escapeExpression(text)}</p>` : "",'),
     CH.includes("return await player.query(CHOICE_QUERY, { title, options, text }"), /\.dialog-buttons button \{[^}]*white-space: normal;/.test(CSS)],
    [true, true, true, true, true, true]);
}

// --- Bio-Focus: Genetic Focus: Namekians ---------------------------------------------------------------------------------------------
{
  const t = getTrait("genetic-focus-namekians");
  const plain = bio([]), g = bio([traitItem("genetic-focus-namekians", 1)]);
  const CH = read("module", "chat.mjs");
  check("Genetic Focus: Namekians - Primary, compiling; Surgency 1(T), by Magic; Namekian Biology's stretch and move; (6) points on a Healing "
    + "Surge, asked; (7) above a Threshold, once an Encounter, its button",
    [t.importance, compile(t.script).errors.length, g.surgency - plain.surgency, g.effects.slots["surgency.magic"], add(g, "meleeRange.stretch"),
     g.effects.slots["rubbery.move"], compile(t.script).program.blocks.filter(b => b.mode !== "passive").map(b => `${b.moment}/${b.budget?.encounter ?? ""}`),
     CH.includes('...(adaptedLife ? ["@adapted[Genetic Focus: Namekians]"] : [])].join(" + ");')],
    ["primary", 0, plain.tierOfPower, true, 3, true, ["stretch/", "surge-threshold/1"], true]);
}

// --- Bio-Focus: Genetic Focus: Neko Majins -----------------------------------------------------------------------------------------
{
  const t = getTrait("genetic-focus-neko-majins");
  const ids = ["genetic-focus-neko-majins-fourth-effect", "genetic-focus-neko-majins-fifth-effect"];
  const MD = read("module", "majin-dama.mjs");
  check("Genetic Focus: Neko Majins - Primary, compiling; its Majin-Dama made; (4), (5) Neko Majin-Dama's Maneuvers copied; (6) -2(T) with none "
    + "Integrated; (8) a Surge use more; (7) in Neko Majin Genes' (4)",
    [t.importance, compile(t.script).errors.length, t.grantsGear,
     ids.map(id => [getTrait(id)?.fromTrait, getTrait(id)?.type, compile(getTrait(id)?.script ?? "x").errors.length]),
     MD.includes('const EXPEL_IDS = [EXPEL_DAMA, "genetic-focus-neko-majins-fifth-effect"];'),
     t.script.includes("if (majinDama.integrated >= 1) {\n  surge.uses += 1;"),
     getTrait("neko-majin-genes").script.includes('if (holdsTrait("genetic-focus-neko-majins") && (majinDama.integrated >= 1)) {')],
    ["primary", 0, "majin-dama", [["genetic-focus-neko-majins", "standard", 0], ["genetic-focus-neko-majins", "instant", 0]], true, true, true]);
}

// --- Bio-Focus: Genetic Focus: Neo-Tuffle --------------------------------------------------------------------------------------------
{
  const t = getTrait("genetic-focus-neo-tuffle");
  const ids = ["focus-genes-of-hatred", "focus-genes-of-a-parasite"];
  const g = bio([traitItem("genetic-focus-neo-tuffle", 1, { option: "focus-genes-of-a-parasite" })]);
  const CH = read("module", "chat.mjs");
  check("Genetic Focus: Neo-Tuffle - Primary, compiling; following Neo-Tuffle Genes' Option; (2) the Round's start, its button; (3) Combat Rolls "
    + "against the Specimen; (4) Neo-Tuffle Genes (2) for 1 at the Specimen; Hatred's button on the Energy Charge; Parasite's Liquid Form",
    [t.importance, compile(t.script).errors.length, t.optionsFollow, blocks(t.script),
     ids.map(id => [getTrait(id).optionOf, getTrait(id).follows, compile(getTrait(id).script).errors.length]),
     g.effects.slots["maneuver.liquid-form"], CH.includes("...specimenParts(attacker, target?.uuid),"),
     CH.includes("const cost = isSpecimenOf(target, attacker?.uuid) ? 1 : 2;"),
     compile(getTrait("focus-genes-of-hatred").script).program.blocks[0]?.modifiers?.toggle === true],
    ["primary", 0, "neo-tuffle-genes", ["triggered/start-of-round"],
     [["genetic-focus-neo-tuffle", "genes-of-hatred", 0], ["genetic-focus-neo-tuffle", "genes-of-a-parasite", 0]], true, true, true, true]);
}

// --- Bio-Focus: Genetic Focus: Custom ------------------------------------------------------------------------------------------------
{
  const t = getTrait("genetic-focus-custom");
  check("Genetic Focus: Custom - Primary, compiling; a Character Perk of any kind (`any`); (5) the Power Up's, once an Encounter, its button",
    [t.importance, compile(t.script).errors.length, t.grantsPerk,
     compile(t.script).program.blocks.filter(b => b.mode !== "passive").map(b => `${b.moment}/${b.budget?.encounter ?? ""}/${b.modifiers?.toggle ? "toggle" : ""}`),
     read("module", "racial.mjs").includes('const choice = (named === "any") ? "" : named;')],
    ["primary", 0, "any", ["power/1/toggle"], true]);
}

// --- Bio-Focus: Genetic Focus: Saiyan -------------------------------------------------------------------------------------------------
{
  const t = getTrait("genetic-focus-saiyan");
  const { PREDICATES } = await import(modUrl("effects/conditions.mjs"));
  globalThis.game ??= {};
  const keep = globalThis.game.combat;
  const at = round => { globalThis.game.combat = { started: true, round }; return PREDICATES.evenRound({}); };
  const even = [at(2), at(3), at(4)];
  globalThis.game.combat = keep;
  check("Genetic Focus: Saiyan - Primary, compiling; Soak per Battle Creation; (3) even Rounds, its button, counted; (4) at the Maximum, out of "
    + "sequence, 1/Round; (5) after (3) twice, once an Encounter, its button",
    [t.importance, compile(t.script).errors.length, t.script.includes("soakValue += battlecreation.stacks * 1(T);"), even,
     compile(t.script).program.blocks.filter(b => b.mode !== "passive").map(b => `${b.moment}/${b.budget?.round ?? b.budget?.encounter ?? ""}${b.modifiers?.outOfSequence ? "+oos" : ""}`)],
    ["primary", 0, true, [true, false, true], ["start-of-round/", "threshold/1+oos", "start-of-turn/1"]]);
}

// --- Bio-Focus: Genetic Focus: Shadow Dragon --------------------------------------------------------------------------------------
{
  const t = getTrait("genetic-focus-shadow-dragon");
  const g = bio([traitItem("genetic-focus-shadow-dragon", 1)]);
  const CH = read("module", "chat.mjs");
  check("Genetic Focus: Shadow Dragon - Primary, compiling; a Bestial Trait; Draconic Physique (2)'s; the Unify, a Shadow Dragon's Race for it, a "
    + "Defeated one unasked",
    [t.importance, compile(t.script).errors.length, t.grantsOther, g.effects.slots["draconic.vsImpaired"], g.effects.slots["maneuver.unify"],
     g.effects.slots["unify.asShadowDragon"], CH.includes("if (!racesFor(other).some(race => racesFor(actor).includes(race))) return"),
     CH.includes('|| (actor.system.effects?.slots?.["unify.asShadowDragon"] === true))')],
    ["primary", 0, "bestial", true, true, true, true, true]);
}

// --- Bio-Focus: Genetic Focus: Shinjin ---------------------------------------------------------------------------------------------
{
  const t = getTrait("genetic-focus-shinjin");
  const plain = bio([]), g = bio([traitItem("genetic-focus-shinjin", 1)]);
  const CH = read("module", "chat.mjs");
  check("Genetic Focus: Shinjin - Primary, compiling; four Unique Abilities; a Skill Rank in five; Combat Recovery from 1 Action; (5) asked, "
    + "no button",
    [t.importance, compile(t.script).errors.length, t.grantsUnique,
     ["creatureHandling", "clairvoyance", "perception", "useMagic", "investigation"].map(key =>
       (Number(g.skills?.[key]?.ranks) || 0) - (Number(plain.skills?.[key]?.ranks) || 0)),
     t.script.includes("combat-recovery.actionCost.minimum = 1;"), blocks(t.script),
     CH.includes('if ((maneuver.id === "combat-recovery") && (held >= 2) && (actor.system.effects?.slots?.["focusShinjin.noExploit"] === true)')],
    ["primary", 0, ["magical-materialization", "telepathy", "telekinesis", "second-sight"], [1, 1, 1, 1, 1], true, [], true]);
}

// --- Bio-Focus: Genetic Focus: Yardrat -------------------------------------------------------------------------------------------------
{
  const t = getTrait("genetic-focus-yardrat");
  const g = bio([traitItem("genetic-focus-yardrat", 1, { option: "focus-tall-yardrat-genes" })]);
  const CH = read("module", "chat.mjs");
  check("Genetic Focus: Yardrat - Primary, compiling; following Yardrat Genes' Option; (3) Bio-Bonded on an Empower, 1/Round, its button; (4) "
    + "the card's button; (5) Tall and Bulbous on Strike, Dodge, Wound and Soak; Bio-Bonded Damage Reduction summed",
    [t.importance, compile(t.script).errors.length, t.optionsFollow,
     compile(t.script).program.blocks.filter(b => b.mode !== "passive").map(b => `${b.moment}/${b.budget?.round ?? ""}`),
     ["focus-tall-yardrat-genes", "focus-bulbous-yardrat-genes"].map(id => [getTrait(id).follows, compile(getTrait(id).script).errors.length]),
     g.effects.slots["focusYardrat.tall"], g.effects.slots["focusYardrat.bioBond"],
     ["strike", "dodge", "wound", "soak"].map(kind => CH.includes(`bioBondParts(${(kind === "soak") ? "target" : ((kind === "dodge") ? "actor" : "attacker")}, "${kind}")`)),
     CH.includes("+ (attack.bioBondReduction ?? []).filter(entry => entry.uuid === target.uuid)"), CH.includes("  bioBondButtons(message, attack, container);")],
    ["primary", 0, "yardrat-genes", ["empowered-ally/1"], [["tall-yardrat-genes", 0], ["bulbous-yardrat-genes", 0]], true, true,
     [true, true, true, true], true, true]);
}

// --- Genetic Catalogue: one Donor for each Gene, of its race ----------------------------------------------------------------------
{
  const G = await import(modUrl("genetic.mjs"));
  const who = race => ({ system: { race } });
  const races = ["saiyan", "namekian", "*"];
  check("Genetic Catalogue's Donors: as many as the Genes, each of a Gene's race - Other Genes' any race no Gene names",
    [G.donorsFit([who("saiyan"), who("namekian")], races), G.donorsFit([who("saiyan"), who("saiyan")], races),
     G.donorsFit([who("alien")], races), G.donorsFit([who("earthling")], races),
     G.donorsFit([who("saiyan"), who("namekian"), who("alien"), who("alien")], races),
     G.geneRaces({ items: [{ flags: { "dbu-ttrpg": { sourceId: "glass-genes" } } }, { flags: { "dbu-ttrpg": { sourceId: "genetic-focus-glass" } } }] })],
    [true, false, true, false, false, ["glass-tribe"]]);
}

// --- Updated texts: Magic Blaster (2) -----------------------------------------------------------------------------------------------
{
  const t = getTrait("magic-blaster");
  const MN = read("module", "maneuvers.mjs");
  check("Magic Blaster: its new (2) - a Magic attack's AoE of your choice, or a Magnitude more, asked once a Round; the Energy Charge now (3)",
    [compile(t.script).errors.length, t.text.includes("(3)-[Triggered, 1/Round]: After using a Magical Unique Ability"),
     t.script.includes("allow magicBlaster.area;"), MN.includes('if (magic && (slots["magicBlaster.area"] === true)) {'),
     MN.includes('return { ...declared, area: { shape }, areaAdded: true };')],
    [0, true, true, true, true]);
}

// --- Vehicle Shift / Weapon Shift: destroyed except by Damage ------------------------------------------------------------------
{
  const CH = await import(modUrl("chat.mjs"));
  const who = (value, key, minion = false) => ({ system: { life: { value, max: 100 }, threshold: { key }, typicalMinion: minion } });
  const TPL = read("templates", "parts", "actor-unique-abilities.hbs");
  check("Vehicle/Weapon Shift destroyed not by Damage: 1 below the next Health Threshold's line - Healthy 49, Bruised 24, Injured 9, Critical "
    + "as it is; a Minion's next is Injured; the button on the shape row",
    [CH.shapeDestroyedLife(who(80, "healthy")), CH.shapeDestroyedLife(who(40, "bruised")), CH.shapeDestroyedLife(who(20, "injured")),
     CH.shapeDestroyedLife(who(5, "critical")), CH.shapeDestroyedLife(who(80, "healthy", true)), CH.shapeDestroyedLife(who(20, "injured", true)),
     TPL.includes('data-action="shapeDestroyed"'), getTrait("vehicle-shift").shapeVehicle],
    [49, 24, 9, 5, 24, 20, true, true]);
}

// --- Weapon Shift: the new text -------------------------------------------------------------------------------------------------
{
  const M = await import(modUrl("maneuvers.mjs"));
  const CH = read("module", "chat.mjs"), UM = read("module", "use-maneuver.mjs");
  const shaped = (wielder = "") => ({ name: "W", system: { specialManeuvers: [{ maneuver: "sk", open: true }] },
    items: { get: id => ({ s1: { system: { unique: { libraryId: "shapeshift" } } }, ua: { system: { unique: { libraryId: "barrier" } } } })[id],
      [Symbol.iterator]: function* () { yield { id: "s1", type: "maneuver", system: { unique: { shapeshift: true, applied: true, shapeForm: "weapon", shapeWielder: wielder } } }; } } });
  const why = (actor, maneuver) => Boolean(M.whyNotWeaponShape(actor, maneuver));
  check("Weapon Shift: the nine refused, a Special only where a Skill opens it, no Standard UA but Shapeshift, Movement only unwielded; "
    + "Grade 2 + bT; each one's Wound 1/4 of the other's Might",
    [M.WEAPON_SHAPE_BARRED.length, why(shaped(), { id: "grapple", name: "Grapple" }), why(shaped(), { id: "basic-attack", name: "Basic Attack" }),
     why(shaped(), { id: "sk", name: "Sk", special: true }), why(shaped(), { id: "fx", name: "Fx", special: true }),
     why(shaped(), { id: "barrier", name: "Barrier", type: "standard", itemId: "ua" }), why(shaped(), { id: "shapeshift", name: "Shapeshift", type: "standard", itemId: "s1" }),
     why(shaped(), { id: "movement", name: "Movement" }), why(shaped("Actor.x"), { id: "movement", name: "Movement" }),
     getTrait("weapon-shift").text.includes("2 + your base Tier of Power"), CH.includes("Craftsmanship Grade ${2 + Math.max(1, Number(actor?.system?.baseTierOfPower) || 1)}"),
     CH.includes('...bioBondParts(attacker, "wound"), ...weaponShiftParts(attacker),'), UM.includes("const notAsWeapon = whyNotWeaponShape(actor, maneuver);")],
    [9, true, false, false, true, true, false, false, true, true, true, true, true]);
}

// --- High Environmental Qualities: written with the rest, nothing refused ---------------------------------------------------
{
  const E = await import(modUrl("environments.mjs"));
  const rule = E.ENVIRONMENT_RULES.find(entry => entry.key === "high-qualities");
  check("High Environmental Qualities: written with the Environments' rules, the table's",
    [rule?.text, E.ENVIRONMENT_RULES.findIndex(entry => entry.key === "high-qualities") - E.ENVIRONMENT_RULES.findIndex(entry => entry.key === "collision")],
    ["Environmental Qualities do not typically apply to squares within a High Environment.", 1]);
}

// --- Assimilation: the new text ----------------------------------------------------------------------------------------------
{
  const A = await import(modUrl("assimilation.mjs"));
  const t = getTrait("assimilation");
  const MN = read("module", "maneuvers.mjs"), CH = read("module", "chat.mjs"), UM = read("module", "use-maneuver.mjs");
  const piece = qualities => ({ system: { crafted: { qualities: qualities.map(id => ({ id })) } } });
  const look = id => ({ shiny: { special: true }, plain: {}, glow: { special: true } })[id] ?? null;
  const items = [{ flags: { "dbu-ttrpg": { assimilated: { stack: 1 } } } }, { flags: { "dbu-ttrpg": { assimilated: { stack: 2 } } } }, { flags: {} }];
  check("Assimilation: (3) no Primordial Majin, Goops Absorb with their Master's rolls and are Defeated; (4) its Apparel copy while the stack "
    + "lasts, the Special Qualities asked onto it",
    [compile(t.script).errors.length, t.text.includes("If you have the Primordial Majin Factor"), t.text.includes("(if lost, you regain"),
     A.specialsToGain(piece(["shiny", "plain", "glow"]), piece(["glow"]), look).map(entry => entry.id),
     A.copiesLost(items, 1).length, A.copiesLost(items, 0).length, A.copiesLost(items, 2).length,
     MN.includes('if ((maneuver.id === "absorb") && goopAbsorbs(actor)) return null;\n  if (minionLine(actor, maneuver) === "non-minion")'),
     UM.includes("postAbsorbClash(master, aimedFirst, maneuver, { goop: actor })"), CH.includes("if (goop) await requestDismissDuplicates([goop]);"),
     CH.includes('await (await import("./assimilation.mjs")).assimilateApparel(actor, target);')],
    [0, false, true, ["shiny"], 1, 2, 0, true, true, true, true]);
}

// --- Angel's Unique Rule: Angels cannot be Minions -----------------------------------------------------------------------------
{
  const M = await import(modUrl("maneuvers.mjs"));
  const angel = JSON.parse(read("races", "angel.json"));
  const SH = read("module", "sheets", "actor-character-sheet.mjs"), MM = read("module", "minion-make.mjs"), UM = read("module", "use-maneuver.mjs");
  const cannot = race => race === "angel";
  const who = (race, library) => ({ name: race, system: { race }, items: { get: () => ({ system: { unique: { libraryId: library } } }) } });
  check("Angels cannot be Minions: the race's rule, off a Minion's race list, no Duplicate made of one - refused before paying",
    [angel.uniqueRule, angel.noMinion, SH.includes("!(onMinion && option.noMinion && !option.selected)"),
     MM.includes("if (options.duplicate && racesOf(copy ?? master).some(race => cannotBeMinion(race))) {"),
     UM.includes("const angelDuplicate = whyNoAngelDuplicate(actor, maneuver, null, cannotBeMinion);"),
     Boolean(M.whyNoAngelDuplicate(who("angel", "multi-form-technique"), { name: "MF", itemId: "x" }, null, cannot)),
     Boolean(M.whyNoAngelDuplicate(who("saiyan", "multi-form-technique"), { name: "MF", itemId: "x" }, null, cannot)),
     Boolean(M.whyNoAngelDuplicate(who("saiyan", "copy-clone"), { name: "CC", itemId: "x" }, { name: "A", system: { race: "angel" } }, cannot)),
     Boolean(M.whyNoAngelDuplicate(who("angel", "barrier"), { name: "B", itemId: "x" }, null, cannot))],
    ["Angels cannot be Minions.", true, true, true, true, true, false, true, false]);
}

// --- A Combat Roll's hover: the sheet's number, then what the roll brought -----------------------------------------------------
{
  const B = await import(modUrl("breakdown.mjs"));
  const pen = { offense: 2, defense: 3, muscle: 4, threshold: 5 };
  const strike = B.foldSheetParts("strike", [{ label: "Energy Strike", value: 30, workingsKey: "strike.energy" }, { label: "Favored Element", value: 2 },
    { label: "Muscle Penalty", value: -4 }, { label: "Dim. Offense", value: -2 }, { label: "Thresholds", value: -5 }], pen);
  const burst = B.foldSheetParts("strike", [{ label: "Strike", value: 30, workingsKey: "strike" }, { label: "Dim. Offense", value: -2 },
    { label: "Thresholds", value: -5 }], pen);
  const dodge = B.foldSheetParts("dodge", [{ label: "Dodge", value: 20 }, { label: "Dim. Defense", value: -3 }, { label: "Dim. Defense (Rapid Fist)", value: -3 },
    { label: "Muscle Penalty", value: -4 }, { label: "Thresholds", value: -5 }], pen);
  const wound = B.foldSheetParts("wound", [{ label: "Wound", value: 40, workingsKey: "wound.energy" }, { label: "Critical Specialist", value: 4 },
    { label: "Thresholds", value: -5 }], pen);
  const sum = list => list.reduce((total, part) => total + part.value, 0);
  check("Combat Roll hover: the sheet's Strike/Dodge/Wound folded into one row, only the roll's own effects over it, the same total",
    [strike.map(part => [part.label, part.value]), burst.map(part => [part.label, part.value]), dodge.map(part => [part.label, part.value]),
     wound.map(part => [part.label, part.value]), sum(strike), sum(burst), sum(dodge), sum(wound),
     read("module", "chat.mjs").includes("for (const part of shownParts) {")],
    [[["Energy Strike (sheet)", 19], ["Favored Element", 2]], [["Strike (sheet)", 19], ["Not on this roll: Muscle Penalty", 4]],
     [["Dodge (sheet)", 8], ["Dim. Defense (Rapid Fist)", -3]], [["Wound (sheet)", 35], ["Critical Specialist", 4]], 21, 23, 5, 39, true]);
}

// --- A Skill's hover on the sheet: one sum, Score, Ranks, Size and every effect -------------------------------------------------
{
  const B = await import(modUrl("breakdown.mjs"));
  globalThis.Handlebars ??= { escapeExpression: text => String(text) };
  const system = { skills: { athletics: { roll: 10 } }, effects: { workings: {
    "skill.athletics.bonus": { base: 8, value: 9, parts: [{ label: "1/2 Agility Score", value: 4 }, { label: "2 Ranks", value: 4 }, { label: "Size", value: 0 }],
      contributions: [{ source: "Thief", value: 1, op: "add" }] },
    "skill.athletics": { base: 9, value: 10, parts: [{ label: "Skill Bonus", value: 9 }, { label: "Gifted Student", value: 1 }], contributions: [] } } } };
  const text = B.skillWorkingsTable(system, "athletics").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  check("Skill hover on the sheet: 1/2 Score, Ranks, then Thief and Gifted Student alike - no Skill Bonus row, no Size at 0, totalled at the roll",
    [text.includes("(1/2 Agility Score)"), text.includes("(2 Ranks)"), text.includes("(Thief)") && text.includes("Gifted Student"), text.includes("(Skill Bonus)"), text.includes("(Size)"),
     /\[10\] \(Total\)/.test(text), B.skillWorkingsTable({ effects: { workings: {} } }, "athletics")],
    [true, true, true, false, false, true, ""]);
}

// --- A Skill Check's card: the sheet's Skill as one row, then what the Check brought -------------------------------------------
{
  const SH = read("module", "sheets", "actor-character-sheet.mjs");
  check("Skill Check card and window: the Skill as the sheet shows it, one \"(sheet)\" row - no Bonus/Effects split",
    [(SH.match(/\{ label: `\$\{name\} \(sheet\)`, value: skill\.roll \}/g) ?? []).length, SH.includes('{ label: "Effects", value: skill.roll - skill.bonus }'),
     SH.includes("{ label: name, value: total, workings: skillWorkingsTable(this.actor.system, target.dataset.skill) }")],
    [2, false, true]);
}

// --- A Saving Throw's box: Check and Clash, what adds only sometimes told under the total, Critical Targets ------------------
{
  const B = await import(modUrl("breakdown.mjs"));
  globalThis.Handlebars ??= { escapeExpression: text => String(text) };
  const system = { tierOfPower: 3, timed: [], effects: { slots: {
    "clash.morale": { add: 3, parts: [{ source: "Improved Taunt", value: 3 }] },
    "clash.saveDefending": { add: 3, parts: [{ source: "Attentive Warrior", value: 3 }] },
    "clash.unique": { add: 3, parts: [{ source: "Frigid Tricks", value: 3 }] },
    "willpower.save.cognitive": true, "clash.vsShardCarrier": true } } };
  const morale = B.saveClashBonuses(system, "morale");
  const cognitive = B.saveClashBonuses(system, "cognitive");
  const impulsive = B.saveClashBonuses(system, "impulsive");
  const flat = html => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const table = flat(B.breakdownTable([B.partLine({ label: "Morale (Check)", value: 7 })], 10, { aside: morale.sometimes }));
  check("Saving Throw Clash: Improved Taunt in Morale's, Willpower in its own; Attentive Warrior, Frigid Tricks, Glass Shards only told",
    [morale.always.map(part => part.label).join(), cognitive.always.map(part => part.label).join(), impulsive.always.length,
     impulsive.sometimes.map(part => part.label.split(":")[0]).join(),
     table.includes("Only in some Clashes, not added"), /\[10\] \(Total\)/.test(table), table.includes("(Frigid Tricks: if your Unique Ability opened it)"),
     flat(B.breakdownTable([B.partLine({ label: "X", value: 1 })], 1)).includes("Only in some")],
    ["Improved Taunt", "Willpower", 0, "Attentive Warrior,Frigid Tricks,Glass Shards", true, true, true, false]);
  const SH = read("module", "sheets", "actor-character-sheet.mjs");
  const T = read("templates", "parts", "actor-combat.hbs");
  const M = read("templates", "parts", "actor-main.hbs");
  check("Saving Throw box: one number where Check = Clash, halves where not, (N+) by its name; Skills' (N+) beside the Bonus",
    [SH.includes("const split = clash !== save.value;"), T.includes("{{#if save.split}}"), T.includes('<div class="dbu-save-one" data-tooltip-html="{{save.workings}}">'),
     T.includes("({{save.criticalTarget}}+)"), M.includes("({{skill.critical}}+)"), SH.includes("aside: split ? [] : sometimes")],
    [true, true, true, true, true, true]);
}

// --- Roll windows: the Base Die apart, the other dice gathered by faces; one fixed box, one scroll -----------------------------
{
  const B = await import(modUrl("breakdown.mjs"));
  globalThis.Handlebars ??= { escapeExpression: text => String(text) };
  const flat = html => html.replace(/data-tooltip(-html)?="[^"]*"/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const merged = B.mergedDice([{ label: "Extra Dice (Tier of Power)", formula: "1d10" }, { label: "Greater Dice", formula: "1d10+1d4" },
    { label: "Energy charges", formula: "5d6" }, { label: "Kept high", formula: "2d10kh" }]);
  check("Roll formula: Base Die apart, the rest gathered by faces largest first (2d10, 5d6, 1d4), an odd one kept whole",
    [flat(B.formulaHtml({ base: "1d10", dice: [{ label: "Extra", formula: "1d10" }, { label: "Greater", formula: "1d10+1d4" }], parts: [{ label: "Dodge", value: 9 }] })),
     merged.map(group => group.formula).join(" "), merged[0].tip.includes("1d10: Greater Dice")],
    ["1d10 + 2d10 + 1d4 + 9", "2d10 5d6 1d4 2d10kh", true]);
  const C = read("module", "chat.mjs");
  check("Roll window: the box (rollBoxHtml) fixed on top, every option in one scroll (rollWindowHtml) - prepareRoll and Respond",
    [C.includes("content: rollWindowHtml({\n      top:"), C.includes("content: rollWindowHtml({ top: entry.top, body: entry.body }),"),
     (C.match(/this roll totals 0/g) ?? []).length, read("styles", "dbu-ttrpg.css").includes(".application.dbu-dialog .dbu-roll-scroll {")],
    [true, true, 2, true]);
}

// --- Strike and Wound windows in Respond's shape; the hit's questions one section of the Wound's ----------------------------
{
  const C = read("module", "chat.mjs");
  const cut = name => { const at = C.indexOf(`function ${name}(`); let depth = 0, i = C.indexOf(") {", at) + 2;
    for (; i < C.length; i++) { if (C[i] === "{") depth++; else if (C[i] === "}" && !--depth) break; } return C.slice(at, i + 1); };
  const questionName = new Function(`${cut("questionName")}; return questionName;`)();
  const hitAnswerScript = new Function(`${cut("hitAnswerScript")}; return hitAnswerScript;`)();
  const questions = [{ kind: "amount", title: "Goku: Critical Eye", max: 2 },
    { kind: "choice", title: "Goku: Furious Flex", options: [{ value: "yes" }, { value: "no" }] },
    { kind: "choice", title: "Goku: Burning Fury", options: [{ value: "uuid-a" }, { value: "none" }] }];
  const script = hitAnswerScript(questions, { q0: 2, q1: true, q2: "uuid-a" });
  const none = hitAnswerScript(questions, {});
  check("Wound's questions: named without the asker, answered from the window by title - an amount, a yes, a pick; nothing said is none",
    [questionName({ name: "Goku" }, "Goku: Critical Eye"), script.amount({ title: "Goku: Critical Eye" }),
     script.choice(questions[1]), script.choice(questions[2]), none.amount({ title: "Goku: Critical Eye" }), none.choice(questions[1])],
    ["Critical Eye", 2, "yes", "uuid-a", 0, null]);
  check("Strike window: Strike Roll - name, Strike slot previewed, Ready; Wound window: Wound Roll - name, its Category, Spend on this roll",
    [C.includes("prepareRoll(attacker, triggers, `Strike Roll - ${attacker.name}`"), C.includes('slot: "strike", confirmLabel: "Ready",'),
     C.includes("prepareRoll(attacker, triggers, `Wound Roll - ${attacker.name}`"), C.includes("spend: hitSpendRows(attacker, questions),"),
     C.includes("await answerHit(message, attack, attacker, struck, questions.length ? hitAnswerScript(questions, ready?.spent ?? {}) : null);"),
     C.includes("if (askScript) return askScript.amount({ title, max, label, per });"), C.includes("if (askScript) return askScript.choice({ title, options, per, text });")],
    [true, true, true, true, true, true, true]);
  const B = await import(modUrl("breakdown.mjs"));
  const flat = html => html.replace(/data-tooltip(-html)?="[^"]*"/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  check("A Base Die set rather than rolled shows its number, and a Critical its tag",
    flat(B.formulaHtml({ base: "1d10", dice: [{ label: "Extra", formula: "1d10" }, { label: "Critical", formula: "1d10+1d4" }],
      parts: [{ label: "Strike", value: 12 }], fixedBase: 10, tags: [{ kind: "critical", label: "Critical" }] })),
    "10 + 2d10 + 1d4 + 12 Critical");
}

// --- Respond: a picker for several, a window each - Maneuvers and Effects, the Defend's option beside it, Actions turned by hand --
{
  const C = read("module", "chat.mjs");
  const cut = name => { const at = C.indexOf(`function ${name}(`); let depth = 0, i = C.indexOf(") {", at) + 2;
    for (; i < C.length; i++) { if (C[i] === "{") depth++; else if (C[i] === "}" && !--depth) break; } return C.slice(at, i + 1); };
  const open = new Function("DEFEND_OPTIONS", `${cut("openDefendOptions")}; return openDefendOptions;`)({
    parry: {}, directHit: {}, powerFlare: {}, crossCounter: {}, crossCounterSignature: { needsCounterTechnique: true }, guard: {} });
  const target = { uuid: "t", items: [] };
  const keys = attack => open(target, attack).map(([key]) => key).join(",");
  check("Defend's options in Respond: all but Counter's without its Technique; Cross Counter only where narrowed; no Parry at Encompassing 2; only Guard after a lost Fake Out",
    [keys({}), keys({ defencesAllowed: ["crossCounter"] }), keys({ technique: { features: ["encompassing-attack", "encompassing-attack"] } }),
     keys({ fakeOutLosers: ["t"] })],
    ["parry,directHit,powerFlare,crossCounter,guard", "crossCounter", "directHit,powerFlare,crossCounter,guard", "guard"]);
  check("Respond: one window when one can answer, a picker for several; Intervene left to the hit; the Defend's option preset; Actions turned first",
    [C.includes("if (entries.length === 1 || usable.length === 1) {"), C.includes("chosen = await respondPicker(message, entries, initials);"),
     C.includes('(maneuver.id !== "intervene")'), C.includes("if (maneuver.defend && attack) return defendOptionRow("),
     C.includes("const presetOpen = preset?.defence && open.some(([key]) => key === preset.defence);"),
     C.includes("if (choice.convert > 0) await convertActions(choice.actor, choice.convert);"),
     C.includes('label: fromPicker ? "Save" : "Ready"'), C.includes('{ action: "confirm", label: "Done", default: true,'),
     C.includes('? { actor: entry.actor, counter: "dodge", instant: null, willing: null, karma: null, triggers: [], convert: 0 } : null)')],
    [true, true, true, true, true, true, true, true, true]);
  check("Karmic Desperation: off but with the Defend, ticked and kept where no Counter Action is left; Counters greyed without one but the Defend",
    [C.includes("} else if (counters < 1) {\n        desperation.checked = true;\n        desperation.disabled = true;"),
     C.includes("const short = (counters < 1) && !isDefend;"),
     C.includes(`'<span class="dbu-karma-tag">Karmic Desperation</span> 1 Karma Point'`)],
    [true, true, true]);
}

// --- Reroll: its own button and window for any roll lost; the Wound Roll waits on whoever still has one ------------------------
{
  const C = read("module", "chat.mjs");
  const cut = name => { const at = C.indexOf(`function ${name}(`); let depth = 0, i = C.indexOf(") {", at) + 2;
    for (; i < C.length; i++) { if (C[i] === "{") depth++; else if (C[i] === "}" && !--depth) break; } return C.slice(at, i + 1); };
  const rerollKind = new Function("LUCKY_REROLL", "RESOLVE_REROLL", "DAMA_REROLL", "NEKO_GENES_REROLL", "TAI_CHI_REROLL", "FORTITUDE_REROLL",
    `${cut("rerollKind")}; return rerollKind;`)("lucky", "earthling-resolve", "neko-majin-dama", "neko-majin-genes", "tai-chi-master", "fortitude");
  const diceSpan = new Function(`${cut("diceSpan")}; return diceSpan;`)();
  check("Reroll kinds: Karmic Chance the Base Die keeping the higher, Lucky's and Earthling Resolve's the Base Die, Boost dice added, a nudge none; 1d10+1d4 is 2 to 14",
    [JSON.stringify(rerollKind("karmic-chance")), JSON.stringify(rerollKind("lucky:Actor.x")), JSON.stringify(rerollKind("earthling-resolve")),
     JSON.stringify(rerollKind("karmic-boost")), rerollKind("nudge:x"), JSON.stringify(diceSpan("1d10+1d4"))],
    ['{"base":true,"keepHigher":true}', '{"base":true}', '{"base":true}', '{"boost":true}', null, '{"low":2,"high":14}']);
  check("Reroll: orange button for a side that lost, the same window for Strike, Dodge, Clash and lone Check; No reroll relayed; the Wound waits",
    [C.includes("if (karmic?.situation?.lost && !rerollsClosed(message, target)) container.append(rerollButton(message, target, karmic.situation, karmic.options));"),
     C.includes("if (karmic?.situation?.lost && !rerollsClosed(message, attacker)) container.append(rerollButton(message, attacker, karmic.situation, karmic.options));"),
     C.includes("container.append(rerollButton(message, situation.actor, situation, options, `${situation.actor.name}: Reroll`));"),
     C.includes("button.addEventListener(\"click\", () => rerollWindow(message, actor, { check, options }));"),
     C.includes('case "rerollDone": {'), C.includes("const waiting = pendingRerolls(message);"),
     C.includes("if (!actor || (!actor.isOwner && !everySide.on)) return [];")],
    [true, true, true, true, true, true, true]);
}

// --- A hit answered: one Apply effects - Block, Barrier, the Intervene, effects for being hit, Power Flare's Ki Wager ----------------
{
  const C = read("module", "chat.mjs");
  check("Hit: one Apply effects after the rerolls, a picker for several, each window Maneuvers and Effects; the old buttons gone",
    [C.includes("  if (!result.wound && !attack.woundHeld) {\n    const entries = hitEntries(message, attack);"), C.includes("apply.addEventListener(\"click\", () => openHitWindows(message));"),
     C.includes("chosen = await hitPicker(message, attack, entries, initials);"), C.includes('step.textContent = "Intervene";'),
     C.includes("block.textContent = `${target.name}: Block`;"),
     C.includes('return playIntervene(message, attack, { who: actor.uuid, ally: choice.ally, effect: choice.effect });'),
     C.includes("return blockStage(message, attack, actor, [shield]);"), C.includes("return barrierStage(message, attack, entry.barrier);")],
    [true, true, true, false, false, true, true, true]);
  check("Power Flare's Ki Wager chosen once it is hit: capped by maxKiWager, paid, written on its line of the card",
    [C.includes("const wagerMax = entry.flare ? maxKiWager(actor) : 0;"), C.includes("const wager = Math.min(choice.wager, maxKiWager(actor));"),
     C.includes('await requestEdit(message, { type: "flareWager", uuid: actor.uuid, wager, foundation: entry.own?.defenceFoundation ?? "energy" });'),
     C.includes('case "flareWager": {'), C.includes("const flare = Boolean(own && (own.defense === \"powerFlare\") && !own.flareWagered);")],
    [true, true, true, true, true]);
}

// --- Deal Damage: the one hit sees what reaches them; what cancels it is no Damage for an effect; nothing to choose, dealt by itself --
{
  const C = read("module", "chat.mjs");
  check("Deal Damage: always its button for the one hit, never dealt by itself; with nothing to choose its click deals it",
    [C.includes("button.textContent = `Deal Damage - ${target.name}`;"), C.includes("if (choices.any) return dealDamageWindow(message, target, attack);"), !C.includes("autoDealDamage("),
     C.includes("button.textContent = `Apply ${entry.own.damage} damage to ${target.name}`;")],
    [true, true, true, false]);
  check("Before the Damage: Hyper Resilience left to the window unless Automatic; ticked, the Damage nothing, what answers taking it off, being hit for none on",
    [C.includes('const lightOffer = (light && !resilient) ? unarmedTriggers(target, "light-damage").map(entry => entry.blockId) : [];'),
     C.includes("const damageOverride = chosen.before.length ? 0 : null;"),
     C.includes('takenBox.querySelectorAll("input").forEach(input => { input.disabled = !damage; if (!damage) input.checked = false; });'),
     C.includes('if (noneBox) noneBox.hidden = Boolean(damage);'),
     C.includes("if (offersAnswered.moments.has(String(moment).split(/[(/]/)[0])) return;"),
     C.includes("const settledDamage = (damageOverride !== null) ? damageOverride : (atApparel ? Math.floor(own.damage / 2) : own.damage);")],
    [true, true, true, true, true, true]);
}

// --- Change: nothing paid on confirming, the answers carried out once every side is ready; till then, taken back ---------------------
{
  const C = read("module", "chat.mjs");
  const cut = name => { const at = C.indexOf(`function ${name}(`); let depth = 0, i = C.indexOf(") {", at) + 2;
    for (; i < C.length; i++) { if (C[i] === "{") depth++; else if (C[i] === "}" && !--depth) break; } return C.slice(at, i + 1); };
  const answerOf = new Function(`${cut("answerOf")}; return answerOf;`)();
  check("An answer kept on the card: the Dodge a target's; a bystander who picked nothing, none",
    [answerOf({ counter: "dodge", triggers: [] })?.counter, answerOf({ counter: null, instant: "none", triggers: [] }),
     answerOf({ counter: null, instant: "feint", triggers: [] })?.instant, answerOf({ counter: "defend", defendOption: "parry", convert: 1, triggers: [] })?.convert],
    ["dodge", null, "feint", 1]);
  check("Change: on an attack, confirming writes the answer and readies - nothing paid; every side ready, carried out one at a time, then rolled",
    [C.includes('await requestEdit(message, { type: "pendingAnswer", uuid: choice.actor.uuid, answer });'),
     C.includes("if (!attackIsReady(attack) || (attack.pending ?? []).length || duelRunning(attack)"),
     C.includes("const executor = actor ? playerOf(actor) : game.users.activeGM;"),
     C.includes('await requestEdit(message, { type: "answerDone", id: next.id });'),
     C.includes("if (!attack || attack.result || attackIsReady(attack)) return;\n  return message.setFlag(SCOPE, ATTACK_FLAG, { ...attack,\n    ready: (attack.ready ?? []).filter(each => each !== uuid),"),
     C.includes('note.textContent = "Everyone is ready - no changes now.";'),
     C.includes("container.append(readyRow(() => changeAnswer(message, [...ready, ...bystanders])));"),
     C.includes("for (const actor of actors.filter(each => each?.isOwner)) await requestEdit(message, { type: \"unready\", uuid: actor.uuid });"),
     C.includes("container.append(readyRow(() => changeAttacker(message, attacker)));")],
    [true, true, true, true, true, true, true, true, true]);
}

// --- A reroll never after the hit is answered: No reroll or Apply effects closes the Reroll button --------------------------------
{
  const C = read("module", "chat.mjs");
  check("Reroll closed once No reroll is said or the hit answered; Apply effects only after the rerolls",
    [C.includes("return kept || (message.getFlag(SCOPE, REROLLS_DONE_FLAG) ?? []).includes(actor?.uuid);"),
     C.includes("const kept = (message.getFlag(SCOPE, ATTACK_FLAG)?.hitPending ?? []).some(entry => entry.uuid === actor?.uuid);"),
     C.includes("  if (!result.wound && !attack.woundHeld) {\n    const entries = hitEntries(message, attack);"),
     C.includes("const stepping = new Map(interveners.map(actor => [actor.uuid, shieldableTargets(attack, actor)]));")],
    [true, true, true, true]);
}

// --- A hit's answers kept on the card till the Wound Roll is confirmed, with Change; taken back, the Reroll open again -----------------
{
  const C = read("module", "chat.mjs");
  check("Hit answers: kept, nothing spent; the Wound confirmed holds the roll till they are carried out, one at a time; Change till then",
    [C.includes('await requestEdit(message, { type: "hitPending", uuid: choice.actor.uuid, answer: hitAnswerOf(choice) });'),
     C.includes('if ((message.getFlag(SCOPE, ATTACK_FLAG)?.hitPending ?? []).length) return requestEdit(message, { type: "woundHeld" });'),
     C.includes("if (!attack?.result || attack.result.wound || !attack.woundHeld) return;"),
     C.includes("if (entry) await applyHitChoice(message, fresh, { ...next.answer, actor, entry });"),
     C.includes("setTimeout(() => rollAttackWound(message, message.getFlag(SCOPE, ATTACK_FLAG)).catch(error => {"),
     C.includes("container.append(readyRow(() => changeHitAnswer(message, mine.map(entry => entry.actor))));"),
     C.includes("    if (attack.woundHeld) return;\n    // Not before the rerolls"),
     C.includes('if (entry.isHit) await requestEdit(message, { type: "rerollDone", uuid: actor.uuid });')],
    [true, true, true, true, true, true, true, false]);
}

// --- Cancel, not Change: the card as though nothing had been picked, no window opened -------------------------------------------------
{
  const C = read("module", "chat.mjs");
  check("Ready's Cancel: Respond's, the attacker's and the hit's taken back, no window opened again",
    [C.includes('change.textContent = "Cancel";'), C.includes("return respondDialog(message, Boolean(message.getFlag(SCOPE, RESPONDABLE_FLAG)), { initials });"),
     C.includes("return attackerStage(message, message.getFlag(SCOPE, ATTACK_FLAG) ?? attack, attacker);"), C.includes("return openHitWindows(message, initials);")],
    [true, false, false, false]);
}

// --- The GM's Targets: change the targets, or Instantaneous Control's Cancel with all it cost given back ---------------------------------
{
  const C = read("module", "chat.mjs");
  const U = read("module", "use-maneuver.mjs");
  check("Targets: the GM's alone, beside the name till rolled; × / Undo / Add; Cancel greyed for an AoE with a target left",
    [C.includes("(game.user.isGM && !result && !attack.icCancelled)"), C.includes('card.querySelector(".dbu-gm-targets")?.addEventListener("click", () => targetsWindow(message));'),
     C.includes('holder.querySelector("[data-x]").textContent = out ? "Undo" : "×";'), C.includes("const blocked = area && (left > 0);")],
    [true, true, true, true]);
  check("Cancel: Actions, Ki, Capacity, Divine Ki and the uses it added given back; the card cancelled; what making it took recorded",
    [C.includes('...(refund.used?.length ? { "system.usedManeuvers": without(actor.system.usedManeuvers, refund.used) } : {}),'),
     C.includes('return requestEdit(message, { type: "attack", attack: { ...attack, icCancelled: true, pending: [] } });'),
     U.includes("used: added(usesBefore.used, actor.system.usedManeuvers ?? []),"), C.includes("          refund,\n")],
    [true, true, true, true]);
  check("Change the targets: kept as they were, added waiting; who leaves loses their ready and kept answer",
    [C.includes("const targets = wanted.map(actor => before.get(actor.uuid) ?? { uuid: actor.uuid, name: actor.name });"),
     C.includes("ready: (attack.ready ?? []).filter(uuid => (uuid === attack.attackerUuid) || kept.has(uuid)),")],
    [true, true]);
}

// --- No Instant stage (the user's): the Instant row at the card's foot, played at once; the order the table's -----------------------
{
  const C = read("module", "chat.mjs");
  check("No stage, nothing held for Instants: the row at an attack's foot while open; the window plays at once; Instant Assault, frozen, last an Instant",
    [["instantStageOf(", "instantWaiting(", "renderInstantStage(", "applyInstantDecide(", "instantsInOrder("].some(name => C.includes(name)),
     C.includes("renderInstantRow(message, html);"), C.includes('button.addEventListener("click", () => instantWindows(message, attack));'),
     C.includes("const open = respondable && !message.getFlag(SCOPE, MANEUVER_USE_FLAG)?.cancelled && !clash?.icCancelled && !clash?.result")
       && !C.includes('instant.textContent = "Instant Maneuver";'),
     C.includes("if (id && actor) await useCardInstant(message, actor, id);"), !C.includes("else await playInstant(message, actor, id);"),
     C.includes("<summary>Instant Maneuvers</summary>"), C.includes('else if (whyNotAnotherInstant(actor)) reason = "your last Maneuver was an Instant";'),
     C.includes('if (attack?.technique?.features?.includes("instant-assault")) reason = "Instant Assault";')],
    [false, true, true, true, true, true, false, true, true]);
}

// --- Each Instant by its own Use, one after the other; its card before the Maneuver it answers ---------------------------------------
{
  const C = read("module", "chat.mjs");
  const cut = name => { const at = C.indexOf(`function ${name}(`); let depth = 0, i = C.indexOf(") {", at) + 2;
    for (; i < C.length; i++) { if (C[i] === "{") depth++; else if (C[i] === "}" && !--depth) break; } return C.slice(at, i + 1); };
  const chatAnchor = { before: 50000, count: 0 };
  const anchor = new Function("chatAnchor", `${cut("anchorNewMessage")}; return anchorNewMessage;`)(chatAnchor);
  const made = [];
  for (let i = 0; i < 2; i++) { const data = { updateSource(change) { made.push(change.timestamp); } }; anchor(data); }
  chatAnchor.before = null;
  const untouched = []; anchor({ updateSource(change) { untouched.push(change); } });
  check("A card made for an Instant goes before the Maneuver: its timestamp under that card's, in the order made; none moved otherwise",
    [made.join(","), untouched.length], ["49001,49002", 0]);
  check("Played on a card: used as from the sheet, its card anchored before the Maneuver in the order played",
    [C.includes("used = Boolean(await useOwnedManeuver(actor, owned.id));"),
     C.includes('Hooks.on("preCreateChatMessage", document => { anchorNewMessage(document); stampManeuverUse(document); });'),
     C.includes("chatAnchor.before = before - 1000 + ((message.getFlag(SCOPE, INSTANTS_ON_FLAG) ?? []).length + 1) * 100;")],
    [true, true, true]);
}

// --- Instants in the order things resolved: the last Maneuver *you* used; one Instant each on a Maneuver --------------------------
{
  const M = read("module", "maneuvers.mjs");
  const C = read("module", "chat.mjs");
  const cut = (text, name) => { const at = text.indexOf(`function ${name}(`); let depth = 0, i = text.indexOf(") {", at) + 2;
    for (; i < text.length; i++) { if (text[i] === "{") depth++; else if (text[i] === "}" && !--depth) break; }
    return text.slice(at, i + 1).replace(/^export /, ""); };
  // The Instant options' reasons, with what they read stood in for.
  const options = new Function("ownInstants", "godListed", "frozenBy", "frozenTurnOf", "whyNotSpecial", "whyNotAnotherInstant", "messageMaker",
    "SCOPE", "INSTANTS_ON_FLAG", "whyNotThisTurn", `${cut(C, "instantOptions")}; return instantOptions;`)(
    () => [{ id: "zoom", name: "Zoom" }], () => true, () => false, () => false, () => null,
    actor => (actor.system.instantPlayed.held ? "held" : null), (message, attack) => attack.attackerUuid, "dbu-ttrpg", "instantsOn", () => "");
  const actor = (uuid, held) => ({ uuid, system: { instantPlayed: { held } } });
  const card = (flags = {}) => ({ getFlag: (scope, key) => flags[key] });
  const attack = { attackerUuid: "goku" };
  const why = (who, flags) => options(who, card(flags), attack)[0].reason;
  check("Instant on a card: Vegeta held by a Zoom of his is refused; a Counter after it freed him; one Instant each on a Maneuver; the maker's own card asks what came before it",
    [why(actor("vegeta", true)), why(actor("vegeta", false)), why(actor("vegeta", false), { instantsOn: ["vegeta"] }),
     why(actor("goku", true)), why(actor("goku", false), { makerInstantHeld: true })],
    ["your last Maneuver was an Instant", "", "you already played an Instant on this Maneuver", "",
     "your last Maneuver before this one was an Instant"]);
  check("After a card Instant: its maker not held by it (it comes before their Maneuver), anyone else held as always; the card keeps who played one",
    [C.includes('if (messageMaker(message, attack) === actor.uuid) {\n    await requestActorUpdate(actor, { "system.instantPlayed": { held: false, messageId: "" } });'),
     C.includes('await requestEdit(message, { type: "instantUsedOn", uuid: actor.uuid, actorName: actor.name, name });'),
     M.includes('await globalThis.game?.messages?.get?.(messageId)?.setFlag?.("dbu-ttrpg", "makerInstantHeld", true); }'),
     C.includes("before: true")],
    [true, true, true, false]);
}

// --- "Cannot be used if your last Maneuver during this Turn was an Instant Maneuver": held only within its Turn ----------------------
{
  const M = read("module", "maneuvers.mjs");
  const cut = name => { const at = M.indexOf(`function ${name}(`); let depth = 0, i = M.indexOf(") {", at) + 2;
    for (; i < M.length; i++) { if (M[i] === "{") depth++; else if (M[i] === "}" && !--depth) break; } return M.slice(at, i + 1); };
  const held = new Function(`${cut("instantTurnKey")}; ${cut("instantHeld")}; return instantHeld;`)();
  globalThis.game ??= {};
  const saved = globalThis.game.combat;
  globalThis.game.combat = { started: true, id: "c1", round: 2, turn: 3 };
  const results = [held({ held: true, turn: "c1:2:3" }), held({ held: true, turn: "c1:2:2" }), held({ held: true, turn: "" }),
    held({ held: false, turn: "c1:2:3" })];
  globalThis.game.combat = saved;
  check("An Instant holds within the Turn it was played in; another Turn's holds nothing; outside a Combat, till another kind",
    results, [true, false, true, false]);
  check("Recorded with its Turn; read through instantHeld everywhere",
    [M.includes('? { held: true, messageId: messageId ?? "", turn: instantTurnKey() }'),
     M.includes("if (!instantHeld(actor?.system?.instantPlayed)) return null;"),
     M.includes("const held = instantHeld(stored) ? stored : { held: false, messageId: \"\" };")],
    [true, true, true]);
}

// --- The sheet's "Last was Instant": the real hold, this Turn's; set by hand in edit mode -----------------------------------------
{
  const S = read("module", "sheets", "actor-character-sheet.mjs");
  const T = read("templates", "parts", "actor-combat.hbs");
  check("Last was Instant reads the hold this Turn and sets it by hand, not a field nothing writes",
    [S.includes("context.instantHeld = instantHeld(this.actor.system.instantPlayed);"), S.includes("toggleInstantHeld: DBUCharacterSheet._onToggleInstantHeld,"),
     T.includes('<input type="checkbox" data-action="toggleInstantHeld" {{#if instantHeld}}checked{{/if}}/>'),
     T.includes("<span>{{#if instantHeld}}Yes{{else}}No{{/if}}</span>"), T.includes("system.lastManeuverWasInstant")],
    [true, true, true, true, false]);
}

// --- useManeuverOnce reads targetActor only after it is declared (a ReferenceError there stops every Maneuver) ----------------------
{
  const U = read("module", "use-maneuver.mjs");
  const at = U.indexOf("async function useManeuverOnce(");
  const end = U.indexOf("\nasync function ", at + 10);
  const body = U.slice(at, end > 0 ? end : undefined);
  const declared = body.indexOf("let targetActor = null;");
  check("targetActor is not read in useManeuverOnce before its declaration; Copy Clone's Angel check after the target is known",
    [declared > 0, body.search(/\btargetActor\b/) === declared + 4,
     U.includes("whyNotCopyClone(actor, maneuver, targetActor) ?? whyNoAngelDuplicate(actor, maneuver, targetActor, cannotBeMinion)")],
    [true, true, true]);
}

// --- The Instant window lists the character's own Instants, as the sheet does - not every Instant there is ------------------------
{
  const C = read("module", "chat.mjs");
  const cut = name => { const at = C.indexOf(`function ${name}(`); let depth = 0, i = C.indexOf(") {", at) + 2;
    for (; i < C.length; i++) { if (C[i] === "{") depth++; else if (C[i] === "}" && !--depth) break; } return C.slice(at, i + 1); };
  const own = new Function("definitionOf", "traitActive", "whyNotSpecial", `${cut("ownInstants")}; return ownInstants;`)(
    item => ({ id: item.system.maneuverId || item.id, name: item.name, type: item.system.type, fromTrait: item.system.fromTrait,
      signature: item.system.signature, signatureTechnique: item.system.signatureTechnique }),
    (actor, trait) => trait === "on", (actor, maneuver) => (maneuver.id === "god" ? "not yours" : null));
  const item = (id, type, extra = {}) => ({ id, type: "maneuver", name: id, system: { maneuverId: id, type, ...extra } });
  const actor = { items: [item("zoom", "instant"), item("dodge", "counter"), item("liquid", "instant", { fromTrait: "off" }),
    item("uproot", "instant", { fromTrait: "on" }), item("god", "instant"), item("tech", "instant", { signature: true }),
    { id: "x", type: "talent", name: "x", system: { type: "instant" } }] };
  check("Instant window: only the character's own Instant Maneuver Items, open ones, as on the sheet",
    [own(actor).map(each => each.id).join(","), C.includes("return ownInstants(actor).map(maneuver => {"),
     C.includes("((item.system.maneuverId || item.id) === maneuverId)")],
    ["uproot,zoom", true, true]);
}

// --- United Attack is an Instant: played from the Instant Maneuver window, no buttons of its own on the card ------------------------
{
  const C = read("module", "chat.mjs");
  const cut = name => { const at = C.indexOf(`function ${name}(`); let depth = 0, i = C.indexOf(") {", at) + 2;
    for (; i < C.length; i++) { if (C[i] === "{") depth++; else if (C[i] === "}" && !--depth) break; } return C.slice(at, i + 1); };
  const options = new Function("ownInstants", "frozenBy", "frozenTurnOf", "getManeuver", "whyNotAnotherInstant", "messageMaker",
    "duelSideOf", "SCOPE", "INSTANTS_ON_FLAG", "whyNotThisTurn", `${cut("instantOptions")}; return instantOptions;`)(
    () => [{ id: "united-attack-maneuver", name: "United Attack", united: true }], () => false, () => false, () => null, () => null,
    (message, attack) => attack?.attackerUuid ?? "", () => null, "dbu-ttrpg", "instantsOn", () => "");
  const card = { getFlag: () => undefined };
  const why = (uuid, attack) => options({ uuid }, card, attack)[0].reason;
  check("United Attack in the Instant window: an Ally's attack, not your own, joined once; no join button of its own",
    [why("ally", { attackerUuid: "goku" }), why("goku", { attackerUuid: "goku" }), why("ally", { attackerUuid: "goku", united: [{ uuid: "ally" }] }),
     why("ally", null), C.includes("() => uniteOnCard(message, attack, joiner)"), C.includes("if (owned?.system?.united) used = Boolean(await uniteOnCard(")],
    ["", "your own attack", "already joined", "joins an Ally's attack", false, true]);
}

// --- What a miss offered goes when a reroll turns it to a hit; a hit rerolled to a miss offers it ----------------------------------
{
  const C = read("module", "chat.mjs");
  const cut = name => { const at = C.indexOf(`function ${name}(`); let depth = 0, i = C.indexOf(") {", at) + 2;
    for (; i < C.length; i++) { if (C[i] === "{") depth++; else if (C[i] === "}" && !--depth) break; } return C.slice(at, i + 1); };
  const sent = [];
  const missContext = { uuid: "" };
  const make = (name, grants) => (message, target) => sent.push({ name, onMiss: missContext.uuid, grants, target: target?.uuid });
  const onMiss = new Function("missContext", "fromUuidSync", "offerWatchfulGaze", "offerFlowExploit", "offerUnscathedExploit", "offerAngelicCounter",
    "offerGravityTechnique", "offerFelineTechnique", "offerRebuke", "offerSinisterUnharmed", `${cut("offerOnMiss")}; return offerOnMiss;`)(
    missContext, uuid => ({ uuid }), make("watchful"), make("flow"), make("unscathed"), make("angelic"), make("gravity"), make("feline"),
    make("rebuke"), make("sinister"));
  onMiss({}, { attackerUuid: "a" }, { uuid: "angel", hit: false, defense: "dodge", answer: { total: 15 } }, { uuid: "a" });
  onMiss({}, { attackerUuid: "a" }, { uuid: "b", hit: true }, { uuid: "a" });
  const afterward = missContext.uuid;
  // The relayed drop: only the offers that miss made, and not one taken.
  const flags = { oosOffers: [{ actorUuid: "angel", onMiss: "angel" }, { actorUuid: "sereh", maneuverId: "move" }, { actorUuid: "ally", onMiss: "angel" }],
    oosTaken: ["ally"] };
  let written = null;
  const card = { getFlag: (scope, key) => flags[key], setFlag: (scope, key, value) => { written = value; } };
  const at = C.indexOf('case "missOffersDropped": {');
  const body = C.slice(at + 'case "missOffersDropped": {'.length, C.indexOf("\n    }", at));
  new Function("game", "takenOffers", "SCOPE", "OOS_OFFERS_FLAG", "request", body)(
    { messages: { get: () => card } }, message => message.getFlag("", "oosTaken"), "dbu-ttrpg", "oosOffers", { messageId: "m", uuid: "angel" });
  check("A miss's offers tagged with whom it missed (Watchful Gaze for a Dodge too); none for a hit; a reroll to a hit drops the untaken ones",
    [sent.map(each => `${each.name}:${each.onMiss}`).join(","), afterward, (written ?? []).map(offer => offer.actorUuid).join(","),
     C.includes('if ((request?.type === "offer") && missContext.uuid) request = { ...request, offer: { ...request.offer, onMiss: missContext.uuid } };'),
     C.includes('if (now.hit) await requestEdit(message, { type: "missOffersDropped", uuid: entry.uuid });'),
     C.includes("else offerOnMiss(message, next, { ...now, uuid: entry.uuid }, attacker);")],
    ["watchful:angel,flow:angel,unscathed:angel,angelic:angel,gravity:angel,feline:angel,rebuke:angel,sinister:angel", "", "sereh,ally",
     true, true, true]);
}

// --- Skill Specialties: a character's own Craft and Knowledge Specialties, each a Skill of its own ---------------------------------
{
  const D = read("module", "data", "actor-character.mjs");
  const method = name => { const at = D.indexOf(`  static ${name}(`); let depth = 0, i = D.indexOf(") {", at) + 2;
    for (; i < D.length; i++) { if (D[i] === "{") depth++; else if (D[i] === "}" && !--depth) break; }
    return D.slice(at, i + 1).replace(/^  static /, "function "); };
  const Data = { SKILLS: { craft: { label: "Craft (Basic Item)", attribute: "scholarship" }, craftVehicles: { label: "Craft (Vehicles)" },
    investigation: { label: "Investigation" }, knowledge: { label: "Knowledge (Science)" }, knowledgeHistory: { label: "Knowledge (History)" },
    medicine: { label: "Medicine" } } };
  Data.SPECIALTY_BASES = { craft: { label: "Craft", after: "craftVehicles", skill: { attribute: "scholarship", required: true, specialManeuver: "repair" } },
    knowledge: { label: "Knowledge", after: "knowledgeHistory", skill: { attribute: "scholarship" } } };
  Data.skillTableOf = new Function("DBUCharacterData", `${method("skillTableOf")}; return skillTableOf;`)(Data);
  Data.skillFamily = new Function("DBUCharacterData", `${method("skillFamily")}; return skillFamily;`)(Data);
  const table = Data.skillTableOf([{ id: "knowledgeAb12", base: "knowledge", name: "Magic" }, { id: "craftZz9", base: "craft", name: "Cooking" },
    { id: "bad", base: "medicine", name: "X" }]);
  const A = read("module", "adventure.mjs");
  const cutA = name => { const at = A.indexOf(`function ${name}(`); let depth = 0, i = A.indexOf(") {", at) + 2;
    for (; i < A.length; i++) { if (A[i] === "{") depth++; else if (A[i] === "}" && !--depth) break; } return A.slice(at, i + 1); };
  const KS = ["knowledge", "knowledgeProfession", "knowledgeHistory"];
  const meets = new Function("KNOWLEDGE_SKILLS", `${cutA("meetsPrerequisite")}; return meetsPrerequisite;`)(KS);
  const held = new Function("KNOWLEDGE_SKILLS", `${cutA("knowledgeHeld")}; return knowledgeHeld;`)(KS);
  const system = { skills: { knowledge: { ranks: 0 }, knowledgeProfession: { ranks: 0 }, knowledgeHistory: { ranks: 0 },
    knowledgeAb12: { ranks: 2, base: "knowledge" } } };
  const S = read("module", "sheets", "actor-character-sheet.mjs");
  const T = read("templates", "parts", "actor-settings.hbs");
  const L = read("module", "effects", "slots.mjs");
  check("Skill Specialties: each after its Skill's Core ones, Craft's Required with Repair; family by key; any Knowledge counts them",
    [Object.keys(table).join(","), table.craftZz9.label, table.craftZz9.required, table.craftZz9.specialManeuver, table.knowledgeAb12.label,
     Data.skillTableOf([]) === Data.SKILLS, Data.skillFamily("craftZz9"), Data.skillFamily("knowledgeHistory"), Data.skillFamily("medicine"),
     meets({ requiresSkill: "knowledge, knowledgeProfession, knowledgeHistory", requiresRanks: 2 }, system), held(system).join(","),
     "Craft (Basic Item)".replace(/^[^(]*\(|\)$/g, ""),
     D.includes("this.skills = Object.fromEntries(Object.entries(this.skillTable).map(([key, skill]) => {"),
     L.includes("/^skills\\.family\\.(craft|knowledge)$/"), !L.includes("(data.skills ?? data.constructor?.SKILLS ?? {})"),
     T.includes('data-window="specialties"'), T.includes('data-action="addSpecialty" data-base="{{group.base}}"'),
     S.includes("static async _onAddSpecialty(event, target) {"), read("traits", "gear", "buddies", "smart-buddy.dbu").includes("skills.family.knowledge += ceil($buddyAttribute / 4);")],
    ["craft,craftVehicles,craftZz9,investigation,knowledge,knowledgeHistory,knowledgeAb12,medicine", "Craft (Cooking)", true, "repair",
     "Knowledge (Magic)", true, "craft", "knowledge", "", true, "knowledgeAb12", "Basic Item", true, true, true, true, true, true, true]);
}

// --- An Instant used during your own turn alone is none to play on another's - not waited on for it -----------------------------
{
  const C = read("module", "chat.mjs");
  const cut = name => { const at = C.indexOf(`function ${name}(`); let depth = 0, i = C.indexOf(") {", at) + 2;
    for (; i < C.length; i++) { if (C[i] === "{") depth++; else if (C[i] === "}" && !--depth) break; } return C.slice(at, i + 1); };
  const MAN = read("module", "maneuvers.mjs");
  const at = MAN.indexOf("export const OWN_TURN_INSTANTS = ");
  const list = MAN.slice(at, MAN.indexOf(");", at) + 2).replace(/^export /, "");
  const turn = new Function("alliesOnScene", `${list}; ${cut("whyNotThisTurn")}; return whyNotThisTurn;`)(
    actor => (actor.uuid === "sereh" ? [{ uuid: "ally" }] : []));
  const saved = globalThis.game;
  const on = uuid => { globalThis.game = { combat: { started: true, combatant: { actor: { uuid } } } }; };
  const sereh = { uuid: "sereh" };
  on("otro");
  const others = [turn(sereh, { id: "no-effort", noEffort: true }), turn(sereh, { id: "arboreal-fourth-effect" }), turn(sereh, { id: "zoom" }),
    turn(sereh, { id: "watchful-gaze-third-effect" })];
  on("sereh");
  const own = turn(sereh, { id: "no-effort", noEffort: true });
  on("ally");
  const ally = turn(sereh, { id: "watchful-gaze-third-effect" });
  globalThis.game = { combat: { started: false } };
  const outside = turn(sereh, { id: "no-effort", noEffort: true });
  globalThis.game = saved;
  check("On another's turn No Effort and the own-turn Instants are none to play (not waited on); on yours, or out of Combat, they are",
    [...others, own, ally, outside, C.includes("else if (whyNotThisTurn(actor, maneuver)) reason = whyNotThisTurn(actor, maneuver);")],
    ["only during your turn", "only during your turn", "", "only during your turn or an Ally's", "", "", "", true]);
}

// --- Jump, Thumb War and Crouch taken off the characters still holding them; the Instant stage's setting gone ----------------------
{
  const E = read("module", "dbu-ttrpg.mjs");
  check("The retired Maneuvers taken off at ready; nothing left of which Instants stop",
    [E.includes('export const RETIRED_MANEUVERS = Object.freeze(["jump", "thumb-war", "crouch"]);'),
     E.includes('if (ids.length) await actor.deleteEmbeddedDocuments("Item", ids)'),
     ["instantStops", "INSTANTS_NOT_STOPPING"].some(name => read("module", "maneuvers.mjs").includes(name)),
     read("templates", "parts", "actor-settings.hbs").includes("instantStopList")],
    [true, true, false, false]);
}

// --- Any targeted Maneuver: its cost on its cards, the GM's Targets on them - a Clash's target changed, or the Maneuver cancelled --------
{
  const C = read("module", "chat.mjs");
  const U = read("module", "use-maneuver.mjs");
  const cut = name => { const at = C.indexOf(`function ${name}(`); let depth = 0, i = C.indexOf(") {", at) + 2;
    for (; i < C.length; i++) { if (C[i] === "{") depth++; else if (C[i] === "}" && !--depth) break; } return C.slice(at, i + 1); };
  const snap = new Function(`${cut("useSnapshot")}; return useSnapshot;`)();
  const before = snap({ system: { ki: { value: 40 }, capacity: { spent: 2 }, divineKi: { value: 0 }, actionsSpent: { standard: 1, counter: 0 },
    usedManeuvers: ["a"], talentUses: { round: [], encounter: [] } } });
  // What endManeuverUse writes: the difference.
  const updates = [];
  const regained = [];
  const requestActorUpdate = async (actor, changes) => regained.push(changes);
  const regain = new Function("requestActorUpdate", `async ${cut("regainRefund")}; return regainRefund;`)(requestActorUpdate);
  const after = { system: { ki: { value: 30, max: 50 }, capacity: { spent: 6 }, divineKi: { value: 0 }, actionsSpent: { standard: 3, counter: 1 },
    usedManeuvers: ["a", "uproot"], talentUses: { round: ["x"], encounter: [] } } };
  {
    regain(after, { ki: 10, capacity: 4, actionsBy: { standard: 2, counter: 1 }, used: ["uproot"], round: ["x"] });
    const changes = regained[0];
    check("A use's refund given back by kind of Action, its Ki, Capacity and uses; the Instant row shut once a Clash is rolled or cancelled",
      [before.ki, before.actions.standard, changes["system.ki.value"], changes["system.capacity.spent"], changes["system.actionsSpent.standard"],
       changes["system.actionsSpent.counter"], changes["system.usedManeuvers"].join(","), changes["system.talentUses"].round.length,
       U.includes("const use = beginManeuverUse(actor, maneuver, aimed.filter(Boolean),"), U.includes("await endManeuverUse(use, used);"),
       C.includes("if (flags[ATTACK_FLAG] || flags[MANEUVER_USE_FLAG] || !(flags[RESPONDABLE_FLAG] || flags[CLASH_FLAG] || maneuverCard)) return;")
         && C.includes('...(("defenderRoll" in clash) ? { defenderRoll: "" } : {}),')
         && C.includes("String(clash.reason).split(clash.defenderName).join(to.name)"),
       C.includes("if (!game.user.isGM || clash?.result) return;"), C.includes("if (clash) await message.setFlag(SCOPE, CLASH_FLAG, { ...clash, icCancelled: true });")],
      [40, 1, 40, 2, 1, 0, "a", 0, true, true, true, true, true]);
  }
}

// --- Magic Warrior (2): the Combat tab's Physical and Energy Wound with the Magic Modifier where it is the higher, counted once ----
{
  const D = read("module", "data", "actor-character.mjs");
  const C = read("module", "chat.mjs");
  const cut = (text, name) => { const at = text.indexOf(`function ${name}(`); let depth = 0, i = text.indexOf(") {", at) + 2;
    for (; i < text.length; i++) { if (text[i] === "{") depth++; else if (text[i] === "}" && !--depth) break; } return text.slice(at, i + 1); };
  const base = new Function("DBUCharacterData", `${cut(read("module", "technique-attack.mjs"), "namedDamageAttribute")}\n${cut(C, "woundBase")}; return woundBase;`)({ FOUNDATIONS: { physical: { attribute: "force" } } });
  // Force 2, Magic 5: the sheet's Physical Wound holds 5; the attack names Magic (favoredDamage) - 5, not 8.
  const attacker = { system: { combat: { wound: { physical: 5 }, woundAttribute: { physical: 5 } }, attributes: { force: { mod: 2 }, magic: { mod: 5 } },
    effects: { slots: {} } } };
  const named = base(attacker, { foundation: "physical", damageAttribute: { label: "Magic Modifier (Magic Warrior)", value: 5 } });
  const plain = base({ system: { ...attacker.system, combat: { wound: { physical: 2 } } } }, { foundation: "physical" });
  check("Magic Warrior: the Combat tab's Wound with Magic where higher; the attack naming Magic counts it once",
    [named.value, plain.value, D.includes('return (atts.magic.mod > own.value) ? { label: "Magic Modifier (Magic Warrior)", value: atts.magic.mod } : own;'),
     D.includes('woundAttribute: Object.fromEntries(Object.entries(DBUCharacterData.FOUNDATIONS)')],
    [5, 2, true, true]);
}

// --- Not owned (Genetic Catalogue's "you may use"): no Passive Bonus, no TP; what using it does kept --------------------------------
{
  const UQ = read("module", "unique.mjs");
  const cut = name => { const at = UQ.indexOf(`function ${name}(`); let depth = 0, i = UQ.indexOf(") {", at) + 2;
    for (; i < UQ.length; i++) { if (UQ[i] === "{") depth++; else if (UQ[i] === "}" && !--depth) break; } return UQ.slice(at, i + 1); };
  const strip = new Function(`${cut("withoutPassives")}; return withoutPassives;`)();
  const tpOf = new Function("uniqueTypeOf", "advancementTPOf", `${cut("uniqueTPOf")}; return uniqueTPOf;`)(() => "", entry => Number(entry.tp) || 0);
  const scriptOf = file => { const text = read("traits", "unique", file); return text.slice(text.indexOf("\n---") + 4); };
  const afterimage = strip(scriptOf("afterimage-technique.dbu"));
  const bubble = strip(scriptOf("atmospheric-bubble.dbu"));
  const body = strip(scriptOf("body-change.dbu"));
  const bluff = strip(scriptOf("bluff-attack.dbu"));
  const owned = tpOf({ tpCost: 6, advancements: [{ bought: true, tp: 2 }] });
  const notOwned = tpOf({ tpCost: 6, notOwned: true, advancements: [{ bought: true, tp: 2 }] });
  check("Not owned: its Passive Bonuses gone (Afterimage's, Bluff Attack's), the Bubble applied and Unfamiliar kept, its other blocks kept; no TP",
    [afterimage.includes("strike += 1(T);"), bluff.includes("skill.bluff += 1;"), bubble.includes("forbid unbreathableEnvironments;"),
     body.includes("combatRolls -= (unfamiliar.stacks * 1(bT));"), strip("[passive]\nstrike += 1;\n\n[on used]\nki += 1;").includes("[on used]"),
     owned.total, notOwned.total, notOwned.free,
     UQ.includes("const own = part => (unique.notOwned ? withoutPassives(part) : part);"),
     read("module", "genetic.mjs").includes('if (kind === "unique") foundry.utils.setProperty(data, "system.unique.notOwned", true);'),
     !read("templates", "parts", "unique-stats.hbs").includes('name="system.unique.notOwned"')],
    [false, false, true, true, true, 8, 0, true, true, true, true]);
}

// --- The ready clean-up touches an unlinked token's own Items only, never its world actor's through it -------------------------------
{
  const E = read("module", "dbu-ttrpg.mjs");
  check("Unlinked tokens: only their delta's Items cleaned, and only ones still there",
    [E.includes("const own = Array.from(token.delta?.items ?? []);"), E.includes(".filter(id => actor.items?.has?.(id));"),
     E.includes("for (const token of scene.tokens ?? []) if (!token.actorLink && token.actor) actors.push(token.actor);")],
    [true, true, false]);
}

// --- Genetic Donor: shown on a Genetic Catalogue copy alone, never set by hand; no copy of one held; a Cancel frees the once a Round ----
{
  const G = read("module", "genetic.mjs");
  const T = read("templates", "parts", "unique-stats.hbs");
  const C = read("module", "chat.mjs");
  check("Genetic Donor read-only on a copy alone; one the character has not copied, nor twice; Instantaneous Control frees its once a Round",
    [T.includes("{{#if unique.geneticDonor}}"), T.includes('<input type="checkbox" checked disabled/>'), T.includes("Not owned"),
     G.includes("if (had.has(uaKey(item))) continue;"),
     C.includes("await freeGeneticUse(message);\n  return requestEdit(message, { type: \"attack\", attack: { ...attack, icCancelled: true, pending: [] } });"),
     C.includes("await regainRefund(fromUuidSync(use.actorUuid), refund);\n    await freeGeneticUse(message);"),
     read("module", "use-maneuver.mjs").includes("(geneticFlag && game.combat?.started) ? { flag: geneticFlag, round } : null);")],
    [true, true, false, true, true, true, true]);
}

// --- A hover's left column what the effect gives as written - 1(T), 2(bT), 3 - its bracket what that came to -----------------------
{
  const I = read("module", "effects", "interpreter.mjs");
  const B = read("module", "breakdown.mjs");
  const cutFrom = (text, name) => { const at = text.indexOf(`function ${name}(`); let depth = 0, i = text.indexOf(") {", at) + 2;
    for (; i < text.length; i++) { if (text[i] === "{") depth++; else if (text[i] === "}" && !--depth) break; }
    return text.slice(at, i + 1).replace(/^export /, ""); };
  const written = new Function(`${cutFrom(I, "writtenAmount")}; return writtenAmount;`)();
  globalThis.Handlebars ??= { escapeExpression: String };
  const LINE_ORDER = { positive: 1, negative: 2, botch: 3 };
  const signed = value => ((value >= 0) ? `+${value}` : String(value));
  const helpers = new Function("LINE_ORDER", "signed", `${cutFrom(B, "partLine")}; ${cutFrom(B, "contributionLine")}; return contributionLine;`);
  const line = helpers(LINE_ORDER, signed);
  check("Effects keep their amount as written; the hover's left column shows it, the bracket the number",
    [written({ type: "perTier", value: 1 }), written({ type: "perBaseTier", value: 2 }), written({ type: "flat", value: 3 }),
     written({ type: "binary", op: "-", left: { type: "flat", value: 0 }, right: { type: "perBaseTier", value: 2 } }),
     written({ type: "path", path: "x" }),
     written({ type: "binary", op: "*", left: { type: "perBaseTier", value: 1 }, right: { type: "path", path: "$slots" } }, () => 2),
     written({ type: "binary", op: "*", left: { type: "path", path: "$slots" }, right: { type: "perTier", value: 1 } }, () => 3),
     written({ type: "level", scale: "T" }, null, 2),
     written({ type: "binary", op: "*", left: { type: "path", path: "power.stacks" }, right: { type: "path", path: "tierOfPower" } }, () => 2),
     line({ op: "add", value: 4, written: "1(T)", source: "Rubbery Body" }).written, line({ op: "add", value: 4, written: "1(T)" }).value,
     line({ op: "add", value: 1, written: "1", source: "Plain" }).written, line({ op: "add", value: -6, written: "-2(bT)" }).written,
     read("module", "chat.mjs").includes("value: Number(slot.add), written: slotWritten(slot) }]")],
    ["1(T)", "2(bT)", "3", "-2(bT)", "", "2(bT)", "3(T)", "2(T)", "2(T)", "+1(T)", 4, "+1", "-2(bT)", true]);
}

// --- A sheet being worked out is not worked out again inside itself (an unlinked token's actor made twice, without end) ---------------
{
  const E = read("module", "dbu-ttrpg.mjs");
  const at = E.indexOf("const prepare = DBUCharacterData.prototype.prepareDerivedData;");
  const block = E.slice(at, E.indexOf("\n}\n", at));
  let depth = 0, max = 0;
  const Proto = { prepareDerivedData() { depth++; max = Math.max(max, depth); if (depth < 50) inner.prepareDerivedData(); depth--; } };
  const DBUCharacterData = { prototype: Proto };
  new Function("DBUCharacterData", "ui", "console", block)(DBUCharacterData, undefined, { error() {} });
  // A token's actor whose working out makes the same token's actor again.
  const parent = { token: { uuid: "Scene.s.Token.t" }, uuid: "Scene.s.Token.t.Actor.a" };
  const inner = { parent };
  Object.setPrototypeOf(inner, Proto);
  Proto.prepareDerivedData.call({ parent });
  check("A sheet being worked out is not worked out again inside itself: once in, the second left", max, 1);
}

// --- Speed: the Talent list sorted once, a script's hash kept by its text, a Maneuver's definition made once while unchanged ------------
{
  const U = read("module", "use-maneuver.mjs");
  const cut = name => { const at = U.indexOf(`function ${name}(`); let depth = 0, i = U.indexOf(") {", at) + 2;
    for (; i < U.length; i++) { if (U[i] === "{") depth++; else if (U[i] === "}" && !--depth) break; } return U.slice(at, i + 1).replace(/^export /, ""); };
  let made = 0;
  const definitionOf = new Function("makeDefinition", `const definitions = new WeakMap(); ${cut("definitionOf")}; return definitionOf;`)(
    item => { made++; return { id: item.system.maneuverId || item.id, name: item.name, list: [1] }; });
  const item = { id: "a", name: "Zoom", _stats: { modifiedTime: 1 }, system: { maneuverId: "zoom" } };
  const one = definitionOf(item), two = definitionOf(item);
  one.name = "changed";
  const afterName = definitionOf({ ...item, name: "Zoom 2" });
  item.system = { maneuverId: "zoom" };
  definitionOf(item);
  item._stats = { modifiedTime: 2 };
  definitionOf(item);
  check("A Maneuver's definition made once while its Item is unchanged, anew when its data, name or change time differ; each a copy",
    [made, two.name, afterName.name, two === one,
     read("module", "talents.mjs").includes("for (const { trait, label } of sortedTalents()) {"),
     read("module", "effects", "registry.mjs").includes("const known = hashes.get(text);")],
    [4, "Zoom", "Zoom 2", false, true, true]);
}

// --- No Respond button where nothing of yours answers the card; Instants are not Respond's -------------------------------------------
{
  const C = read("module", "chat.mjs");
  check("Respond shown only where something answers - asked of the window's own reckoning - and not said to play Instants",
    [C.includes("if (check) return usable.length > 0;"), C.includes("respondDialog(message, respondable, { check: true }).then(any => {"),
     C.includes('respond.dataset.tooltip = "Play a Counter or Instant Maneuver, or trigger an effect";')],
    [true, true, false]);
}

// --- The Maneuvers tab's search: every tab narrowed by name, each counting its matches, kept through a render -----------------------
{
  const T = read("templates", "parts", "actor-maneuvers.hbs");
  const S = read("module", "sheets", "actor-character-sheet.mjs");
  check("A search over every type's rows by name, counts per tab, kept through a render, never submitted",
    [T.includes("data-maneuver-search"), T.includes('{{#if group.active}}data-maneuver-active{{else}}hidden{{/if}}'), T.includes('data-maneuver-name="{{maneuver.name}}"'),
     S.includes("search.value = this.#maneuverQuery;"), S.includes('search.addEventListener("change", event => event.stopPropagation());'),
     S.includes('const hit = query ? name.includes(query) : !row.hasAttribute("data-manage-hidden");')],
    [true, true, true, true, true, true]);
}

// --- A character's token is the character: new ones linked, the old ones linked once; Minions left as copies ---------------------
{
  const E = read("module", "dbu-ttrpg.mjs");
  check("New characters' tokens linked; every character's token linked once by the GM, Minions' not",
    [E.includes('if (!isMinion(actor) && (data.prototypeToken?.actorLink === undefined)) updates["prototypeToken.actorLink"] = true;'),
     E.includes('game.settings.register("dbu-ttrpg", "charactersLinked"'),
     E.includes("token => !token.actorLink && characters.has(token.actorId)"),
     E.includes('await game.settings.set("dbu-ttrpg", "charactersLinked", true);')],
    [true, true, true, true]);
}

// --- An Option's own text box shown only where that Option is the one chosen (Artificial Warrior's Absorbed Perfection) ------------
{
  const { racialTraitLines } = await import(modUrl("racial.mjs"));
  const trait = getTrait("artificial-warrior");
  const item = option => ({ type: "racial", name: trait.name, flags: { "dbu-ttrpg": { sourceId: "artificial-warrior" } },
    system: { text: trait.text ?? "", chosen: [{ key: "option", value: option }] } });
  const boxed = option => racialTraitLines(item(option)).some(line => line.addendum);
  check("Absorbed Perfection's box with Pursuit of Perfection chosen, and not with Genetic Survivor",
    [boxed("pursuit-of-perfection"), boxed("genetic-survivor")], [true, false]);
}

// --- The Combat tab's Attack Type table: the Super Stacks' Massive Power in the Physical and Energy Wound, a row of its own --------
{
  const S = read("module", "sheets", "actor-character-sheet.mjs");
  check("Massive Power in the table the sheet draws (woundOf), in the number and as a row; the attack still adds it once",
    [S.includes("const value = (system.combat?.wound?.[key] ?? 0) + (reaches ? massive : 0);"),
     S.includes('partLine({ label: "Super Stacks (Massive Power)"'), read("module", "chat.mjs").includes("...superStackWoundParts(attacker, attack),")],
    [true, true, true]);
}

// --- The card's Wound: the Super Stacks held in its "(sheet)" row, as the sheet shows them; Power Burst's more a row of its own -----
{
  const B = read("module", "breakdown.mjs");
  const cut = name => { const at = B.indexOf(`function ${name}(`); let depth = 0, i = B.indexOf(") {", at) + 2;
    for (; i < B.length; i++) { if (B[i] === "{") depth++; else if (B[i] === "}" && !--depth) break; } return B.slice(at, i + 1).replace(/^export /, ""); };
  const fold = new Function(`${cut("foldSheetParts")}; return foldSheetParts;`)();
  const shown = fold("wound", [{ label: "Wound", value: 40 }, { label: "Super Stacks", value: 16 }, { label: "Super Stacks (Power Burst)", value: 8 },
    { label: "Ki Wager", value: 5 }]);
  check("Card Wound: held Super Stacks in the sheet row, Power Burst's more and the attack's own as rows",
    shown.map(part => `${part.label}=${part.value}`).join(","), "Wound (sheet)=56,Super Stacks (Power Burst)=8,Ki Wager=5");
}

// --- A State's Triggered block waiting on a Level offered only at it (Raging's Apoplectic, from 3) ---------------------------------
{
  const { reactiveFor } = await import(modUrl("effects/registry.mjs"));
  const raging = level => {
    const actor = { uuid: "Actor.r", name: "R", items: [], flags: {}, getFlag() { return undefined; },
      system: { states: { raging: level }, conditions: {}, effects: { slots: {} }, armedTalents: [], talentUses: { round: [], encounter: [] } } };
    return reactiveFor(actor).filter(entry => /state-level\/raging|state\/raging/.test(String(entry.program.blocks[0]?.moment ?? ""))).length;
  };
  check("Raging's Apoplectic blocks offered at Level 3 alone, not at 1 or 2", [raging(1), raging(2), raging(3) > 0], [0, 0, true]);
}

// --- The attack card: what was added against a target (Analysis, Lock On...) in hovers, not written on the lines --------------------
{
  const C = read("module", "chat.mjs");
  check("Analysis in the hovers: the Dodge line's 'Strike N against them' and the damage line's Wound, rows kept on the target",
    [C.includes("analysisRows: analysisParts.map(part => ({ label: part.label, value: part.value })),"),
     C.includes("woundRows: woundParts.map(part => ({ label: part.label, value: part.value }))"),
     C.includes("return attackSide(label, target.name, own.answer, strikeAgainstNote(moved), tip);"),
     C.includes("const named = (own.woundNamed?.length && !own.woundRows)"),
     C.includes('<span class="dbu-wound-against"${woundTip}>Wound ${effectiveWound}</span>')],
    [true, true, true, true, true]);
}

// --- Balanced Defender in the target's Respond window, not a button on the attack card -------------------------------------------
{
  const C = read("module", "chat.mjs");
  check("Balanced Defender: a row among Respond's Effects, kept in the answer, paid as it is carried out; no card button",
    [C.includes("const balanced = balancedOption(actor, attack, answersAttack);"),
     C.includes("balanced: Boolean(choice.balanced)"), C.includes("if (choice.balanced) await payBalanced(message, choice.actor);"),
     C.includes("balancedButtons(")],
    [true, true, true, false]);
}

// --- Respond: a target can always Dodge; one character that fails to read does not hide the others; no GM, the author edits --------
{
  const C = read("module", "chat.mjs");
  check("Respond's check true for a target still to answer; each character read apart; with no GM the card's author applies the edit",
    [C.includes("if (check && characters.some(answering)) return true;"),
     C.includes("console.error(`DBU TTRPG | Could not read what ${actor.name} can answer with`, error);"),
     C.includes("if (!game.users.activeGM && !message.author?.active) {"),
     C.includes("if (activeGM || !request?.messageId || !game.messages.get(request.messageId)?.isAuthor) return;")],
    [true, true, true, true]);
}

// --- Open cards drawn again once the scene is there: who answers is read off its tokens -------------------------------------------
{
  const C = read("module", "chat.mjs");
  check("canvasReady redraws the open attack cards (the chat is drawn before the scene)",
    [C.includes('Hooks.on("canvasReady", redrawOpenCards);'), C.includes("ui.chat?.updateMessage?.(message)")], [true, true]);
}

// --- Respond drawn at once for a target of yours still to answer, read off the attack -------------------------------------------
{
  const C = read("module", "chat.mjs");
  check("Respond for your waiting target without the check; the window lists them even off the scene's tokens",
    [C.includes("if (ownTargetsWaiting(attack).length) {\n    container.append(respondButton());\n    return;\n  }"),
     C.includes("const characters = [...onScene, ...ownTargetsWaiting(attack).filter(actor => !onScene.some(each => each.uuid === actor.uuid))]")],
    [true, true]);
}

// --- Balanced Defender ticked in Respond: its 1(T) in the Dodge Roll the box shows -----------------------------------------------
{
  const C = read("module", "chat.mjs");
  const at = C.indexOf("function livePreview(");
  let depth = 0, i = C.indexOf(") {", at) + 2;
  for (; i < C.length; i++) { if (C[i] === "{") depth++; else if (C[i] === "}" && !--depth) break; }
  const livePreview = new Function("multiFormRow", `${C.slice(at, i + 1)}; return livePreview;`)(() => []);
  const box = { tagName: "INPUT", type: "checkbox", checked: true, dataset: { spend: "balanced", per: "3", label: "Balanced Defender", slot: "dodge" } };
  const element = { querySelectorAll: selector => (selector === "[data-spend]") ? [box] : [] };
  const actor = { system: { criticalTarget: 10, dice: {} } };
  const rows = slot => livePreview(actor, { parts: [{ label: "Defense Value", value: 9 }] }, true, slot, {}, element, "trigger-x").parts
    .map(part => `${part.label}=${part.value}`).join(",");
  check("Balanced Defender ticked: +1(T) on the Dodge Roll's box, not on a Parry's Strike",
    [rows("dodge"), rows("strike"), C.includes('data-spend="balanced" data-per="${tier}" data-label="Balanced Defender" data-slot="dodge"')],
    ["Defense Value=9,Balanced Defender=3", "Defense Value=9", true]);
}

// --- Balanced Defender ticked in Respond: its 1(T) on the Soak the Guard and Direct Hit lines show --------------------------------
{
  const C = read("module", "chat.mjs");
  check("Guard and Direct Hit drawn with Balanced Defender's Soak where it is ticked",
    [C.includes('directHit: { ...damage("directHit"), balanced: balancedTier ? damage("directHit", balancedTier) : null },'),
     C.includes('guard: { ...damage("guard"), balanced: balancedTier ? damage("guard", balancedTier) : null },'),
     C.includes("const shown = (element.querySelector(`input[name=\"balanced-${id}\"]`)?.checked && roll[key].balanced) || roll[key];"),
     C.includes("const base = own + extra;")],
    [true, true, true, true]);
}

console.log(failed ? `\n${failed} failing` : "\n0 failing");
