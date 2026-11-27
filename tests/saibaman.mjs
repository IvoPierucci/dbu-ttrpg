/**
 * Saibamen (a Minion Race): Seedling Biology - Acid Spit and Saibaman Bomb - Savagery, Surprise Tactics, Desperate Grip.
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

/** A Racial Trait's Item, as adding it makes one - `$choice` answered. */
const traitItem = (id, n, choice = "") => ({ id: `r${n}`, uuid: `A.r${n}`, type: "racial", name: getTrait(id).name,
  flags: { "dbu-ttrpg": { sourceId: id } }, system: { script: choice ? getTrait(id).script.replaceAll("$choice", choice) : getTrait(id).script,
    chosen: [] } });

/** A Saibaman with these Items, that Life Modifier gained, prepared - at that share of its Life Points where asked. */
function saibaman(items, { gained = 0, lifeShare = 1, type = "character" } = {}) {
  const parent = new ActorStub({}, { strict: false });
  Object.assign(parent, { type, items, getFlag: () => undefined, uuid: "Actor.saiba", id: "saiba" });
  const make = life => {
    const model = new DBUCharacterData({ powerLevel: 10, race: "saibaman", ...(gained ? { resources: { lifemodifier: { stacks: gained } } } : {}),
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
  const row = id => { const t = getTrait(id); return [t.owner, t.category, t.importance, Number(t.order),
    compile(t.script.replaceAll("$choice", "2")).errors.length]; };
  check("the Saibamen's four: Seedling Biology and Savagery Primary, Surprise Tactics and Desperate Grip Secondary - compiling",
    ["seedling-biology", "savagery", "surprise-tactics", "desperate-grip"].map(row),
    [["saibaman", "body", "primary", 1, 0], ["saibaman", "mind", "primary", 2, 0], ["saibaman", "mind", "secondary", 3, 0],
     ["saibaman", "body", "secondary", 4, 0]]);
  const blocks = id => compile(getTrait(id).script.replaceAll("$choice", "2")).program.blocks.filter(b => b.mode !== "passive")
    .map(b => `${b.mode}/${b.moment}${b.modifiers?.outOfSequence ? "+oos" : ""}`);
  check("what each answers: the turn's start; the Round's start (the closest Opponent), an Opponent Defeated, the Power Up twice (a Minion's "
    + "own); Injured's Grapple; the Round's end in a Grapple",
    [blocks("seedling-biology"), blocks("savagery"), blocks("surprise-tactics"), blocks("desperate-grip"),
     [getTrait("seedling-biology").choices, getTrait("savagery").resource, getTrait("desperate-grip").grantsOtherFrom]],
    [["triggered/start-of-turn"], ["triggered/start-of-round+oos", "triggered/defeat-opponent", "triggered/power", "triggered/power"],
     ["triggered/threshold+oos"], ["triggered/end-of-round+oos"], [["0", "1", "2", "3"], "lifemodifier", "claws"]]);
}

// --- Their Signature Techniques ---------------------------------------------------------------------------------------------------
{
  const FP = await import(modUrl("full-power.mjs"));
  const T = await import(modUrl("technique.mjs"));
  const items = FP.grantedTechniqueItems("saibaman", "r0");
  const sigs = items.map(item => T.signatureOf(item));
  check("Acid Spit and Saibaman Bomb (the Clearing Profile, once Explosion): their TP, their Ki as the rules make it - the Bomb's 9(T), not its "
    + "listed 10(T) (the user's) - none taken; the Bomb a Minion's too",
    [items.map(item => item.name), sigs.map(sig => T.techniqueTP(sig)), sigs.map(sig => T.profileKiPerTier(sig.profile) + T.techniqueKiPerTier(sig)),
     sigs.map(sig => T.techniqueTPCharged(sig)), items.map(item => Boolean(item.flags["dbu-ttrpg"].minionUltimate)),
     sigs.map(sig => sig.features.filter(entry => T.featureProblem(entry.id, sig)).length)],
    [["Acid Spit", "Saibaman Bomb"], [23, 12], [10, 9], [0, 0], [false, true], [0, 0]]);
  check("a Minion may still use the Bomb - no other Ultimate",
    [read("module", "technique-use.mjs").includes("const minionMay = actor.items?.get?.(technique.itemId)?.flags?.[\"dbu-ttrpg\"]?.minionUltimate === true;"),
     read("module", "racial.mjs").includes("const techniques = [...grantedTechniqueItems(String(trait.grantsTechniques ?? \"\"), item.id), ...techniqueItemsFrom(trait, item.id)];")], [true, true]);
}

// --- On a Saibaman ------------------------------------------------------------------------------------------------------------
{
  const soil = n => saibaman([traitItem("seedling-biology", 0, String(n))]);
  const [poor, rich] = [soil(0), soil(3)];
  check("Seedling Biology: the Soil Quality on the Racial Life Modifier; the Defense 1(T), 2(T) at 3+; Unify",
    [poor.racialLifeModifier, rich.racialLifeModifier, add(poor, "defenseValue"), add(rich, "defenseValue"), rich.effects.slots["maneuver.unify"]],
    [1, 4, poor.tierOfPower, 2 * rich.tierOfPower, true]);
  const fresh = saibaman([traitItem("savagery", 0)]);
  const fed = saibaman([traitItem("savagery", 0)], { gained: 3 });
  check("Savagery: the Life Modifier gained counted for what reads it, not for the Maximum Life Points; without Apparel, Defense and Soak 1(bT)",
    [fed.racialLifeModifier - fresh.racialLifeModifier, fed.life.max === fresh.life.max, add(fresh, "defenseValue"), add(fresh, "soakValue")],
    [3, true, fresh.baseTierOfPower, fresh.baseTierOfPower]);
  const tactics = saibaman([traitItem("surprise-tactics", 0)]);
  const plain = saibaman([]);
  const grip = saibaman([traitItem("desperate-grip", 0)], { lifeShare: 0.2 });
  check("Surprise Tactics: a Rank in Acrobatics and in Stealth; Desperate Grip: Grapple Checks 2(T) below Injured",
    [tactics.skills.acrobatics.ranks - plain.skills.acrobatics.ranks, tactics.skills.stealth.ranks - plain.skills.stealth.ranks,
     add(grip, "grapple.all")], [1, 1, 2 * grip.tierOfPower]);
}

// --- Wired --------------------------------------------------------------------------------------------------------------------
{
  const CH = read("module", "chat.mjs"), AC = read("module", "data", "actor-character.mjs");
  check("wired: the Racial Life Modifier whole before the Core phase and the gained left out of the Maximum; the closest Opponent's Basic Attack; "
    + "Surprise Tactics' Clashes holding the attack and their Strike and Wound; the Grapple; the Bomb at the Round's end",
    [AC.includes("this.racialLifeModifier = withEffects(this, \"racialLifeModifier\", this.racialLifeModifier, { min: null });"),
     AC.includes("racialLifeModifier: this.racialLifeModifier - (Number(this.lifeModifierGained) || 0),"),
     CH.includes("return (basic && await useManeuver(actor, basic, { outOfSequence: true, targetUuid: target.uuid })) ? undefined : UNSPENT;"),
     CH.includes("if (card && !reflecting) await surpriseClashes(card, actor);"),
     CH.includes("stealthHold: { pending: true, left: held + aimed.length,"),
     CH.includes("...surpriseParts(attack, target, \"strike\"),") && CH.includes("...surpriseParts(attack, target, \"wound\"),"),
     CH.includes("return (await ownOutOfSequence(actor, \"grapple\")) ? undefined : UNSPENT;"),
     CH.includes("return (await useTechnique(actor, bomb.id, { outOfSequence: true })) ? undefined : UNSPENT;")],
    Array(8).fill(true));
}

// --- Evolved Saibamen ----------------------------------------------------------------------------------------------------------
{
  const factor = getTrait("evolved-saibamen"), adapted = getTrait("adapted-saibaman");
  const blocks = compile(adapted.script).program.blocks.filter(b => b.mode !== "passive").map(b => `${b.mode}/${b.moment}`);
  check("Evolved Saibamen (Saibamen, 1, N/A): Adapted Saibaman [Seedling Biology] - Primary, compiling; Tiny to Large; two Bestial Traits; "
    + "Ki at the turn's start",
    [[String(factor.requirement).trim(), Number(factor.maximumFactor), factor.prerequisites],
     [adapted.owner, adapted.importance, adapted.race, compile(adapted.script).errors.length, adapted.creationSizes, adapted.grantsOther,
      Number(adapted.grantsOtherCount), blocks]],
    [["Saibamen", 1, "N/A"], ["evolved-saibamen", "primary", "saibaman", 0, ["tiny", "small", "medium", "large"], "bestial", 2,
      ["triggered/start-of-turn"]]]);
  const plainLarge = (() => { const parent = new ActorStub({}, { strict: false });
    Object.assign(parent, { type: "character", items: [], getFlag: () => undefined, uuid: "A.p", id: "p" });
    const m = new DBUCharacterData({ powerLevel: 10, race: "saibaman", size: "large" }, { strict: false, parent });
    parent.system = m; m.prepareBaseData?.(); m.prepareDerivedData(); return m; })();
  const adaptedLarge = (() => { const parent = new ActorStub({}, { strict: false });
    Object.assign(parent, { type: "character", items: [traitItem("adapted-saibaman", 0)], getFlag: () => undefined, uuid: "A.a", id: "a" });
    const m = new DBUCharacterData({ powerLevel: 10, race: "saibaman", size: "large" }, { strict: false, parent });
    parent.system = m; m.prepareBaseData?.(); m.prepareDerivedData(); return m; })();
  check("a Saibaman left at Large is Small - with Adapted Saibaman, Large; its Racial Life Modifier 2 higher",
    [plainLarge.size.key, adaptedLarge.size.key, adaptedLarge.racialLifeModifier - plainLarge.racialLifeModifier,
     read("module", "sheets", "actor-character-sheet.mjs").includes("const own = racialSizes(race, Object.keys(DBUCharacterData.SIZES), creationSizesOf(this.actor, getTrait));")],
    ["small", "large", 2, true]);
}

// --- Saiba-Type ---------------------------------------------------------------------------------------------------------------
{
  const factor = getTrait("saiba-type");
  const ids = ["recolored-saibaman", "copyman", "saibabrute"];
  const colors = ["red-pepperman", "blue-kawaireman", "yellow-kyukonman", "pink-tennenman", "white-jinkouman", "gold-kinkanman", "silver-ginnanman"];
  check("Saiba-Type (Saibamen, 1, N/A): Recolored Saibaman [Surprise Tactics] and its seven, Copyman, Saibabrute - compiling; Copy Being and Muscular "
    + "Warrior given",
    [[String(factor.requirement).trim(), Number(factor.maximumFactor), factor.prerequisites],
     ids.map(id => [getTrait(id).owner, getTrait(id).importance, compile(getTrait(id).script).errors.length]),
     colors.map(id => [getTrait(id)?.optionOf, compile(getTrait(id)?.script ?? "x").errors.length]),
     [getTrait("copyman").grantsUnique, getTrait("saibabrute").grantsTalent, Boolean(getTrait("copy-being")), Boolean(getTrait("muscular-warrior"))]],
    [["Saibamen", 1, "N/A"], ids.map(() => ["saiba-type", "secondary", 0]), colors.map(() => ["recolored-saibaman", 0]),
     ["copy-being", "muscular-warrior", true, true]]);
  const withOption = (id, option, n = 0) => {
    const trait = getTrait(id), chosen = option ? getTrait(option) : null;
    return { id: `r${n}`, uuid: `A.r${n}`, type: "racial", name: trait.name, flags: { "dbu-ttrpg": { sourceId: id } },
      system: { script: [trait.script, chosen ? `#@ option ${chosen.id} | ${chosen.name}\n${chosen.script}\n#@ end` : ""].filter(Boolean).join("\n\n"),
        chosen: chosen ? [{ key: "option", value: chosen.id, label: chosen.name }] : [] } };
  };
  const build = (items, { lifeShare = 1, copy = false, soil = 0 } = {}) => {
    const parent = new ActorStub({}, { strict: false });
    Object.assign(parent, { type: "character", items: [...items, traitItem("seedling-biology", 9, String(soil))], getFlag: () => undefined,
      uuid: "A.t", id: "t" });
    const make = life => {
      const m = new DBUCharacterData({ powerLevel: 10, race: "saibaman", ...(copy ? { conditions: { "being-a-copy": 1 } } : {}),
        ...(life === null ? {} : { life: { value: life } }) }, { strict: false, parent });
      parent.system = m; m.prepareBaseData?.(); m.prepareDerivedData(); return m;
    };
    const first = make(null);
    return (lifeShare === 1) ? first : make(Math.floor(first.life.max * lifeShare));
  };
  const well = build([withOption("recolored-saibaman", "red-pepperman")], { soil: 2 });
  const hurt = build([withOption("recolored-saibaman", "red-pepperman")], { soil: 2, lifeShare: 0.2 });
  check("Recolored Saibaman: 1 on the Racial Life Modifier below Injured, not on the Maximum; the Signature's Wound half of it (1 at least); "
    + "Red Pepperman at 3+",
    [well.racialLifeModifier, hurt.racialLifeModifier, hurt.life.max === well.life.max, add(well, "wound.signature"),
     add(well, "wound"), add(hurt, "wound"), add(hurt, "might")],
    [3, 4, true, 1 * well.tierOfPower, 2 * well.tierOfPower, 2 * hurt.tierOfPower, hurt.tierOfPower]);
  const copyman = build([withOption("copyman")]);
  const copying = build([withOption("copyman")], { copy: true });
  check("Copyman: 1 off the Racial Life Modifier, 2 back while not a Copy - not on the Maximum; a Copy, not",
    [copyman.racialLifeModifier, copying.racialLifeModifier, copyman.life.max === copying.life.max], [2, 0, true]);
  const brute = build([withOption("saibabrute")], { soil: 3 });
  check("Saibabrute: base Size Large; its Physical and Energy Damage Attribute half the Racial Life Modifier (bT), 3 at most; Steadfast 1 at 3+",
    [brute.size.key, add(brute, "damageAttribute.physical"), add(brute, "damageAttribute.energy"), add(brute, "steadfast.dice")],
    ["large", 2 * brute.baseTierOfPower, 2 * brute.baseTierOfPower, 1]);
  const CH = read("module", "chat.mjs");
  check("wired: the Damage Attribute raised wherever it is applied; Gold's and Silver's Surge; Being a Copy set, and gone",
    [CH.includes("const raised = Number(attacker?.system?.effects?.slots?.[`damageAttribute.${attack?.foundation}`]?.add) || 0;"),
     CH.includes("+ (Number(attacker.system.effects?.slots?.[`damageAttribute.${attack.foundation}`]?.add) || 0);"),
     CH.includes("await takeSurge(ally, { source: name, kind });"),
     read("module", "use-maneuver.mjs").includes("await (await import(\"./conditions.mjs\")).setCondition(actor, \"being-a-copy\", 1);"),
     CH.includes("await (await import(\"./conditions.mjs\")).setCondition(actor, \"being-a-copy\", 0);"),
     read("module", "data", "actor-character.mjs").includes("const pinks = this.parent ? alliesWithin(this.parent, \"recolored.pink\", 0) : [];")],
    [true, true, true, true, true, true]);
}

console.log(failed ? `\n${failed} failing` : "\n0 failing");
