/**
 * Aliens (a Minion Race): Nameless Horde and From the Stars, and the Full Power Signature Techniques - the user's rulings: High Power
 * Rush's listed 7(T), no Signature Technique made or gained but those, From the Stars (2) with an Ally on the scene at least.
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

// --- The Traits ---------------------------------------------------------------------------------------------------------------
{
  const horde = getTrait("nameless-horde");
  const stars = getTrait("from-the-stars");
  check("Nameless Horde and From the Stars: the Aliens', Primary, Body then Mind, compiling; the Full Power Techniques and a Talent of any Category",
    [[horde.owner, horde.category, horde.importance, Number(horde.order), compile(horde.script).errors.length, horde.grantsTechniques],
     [stars.owner, stars.category, stars.importance, Number(stars.order), compile(stars.script).errors.length, stars.grantsTalentChoiceFrom]],
    [["alien", "body", "primary", 1, 0, "full-power"], ["alien", "mind", "primary", 2, 0, "any"]]);
  const blocks = trait => compile(getTrait(trait).script).program.blocks.filter(b => b.mode === "triggered").map(b => b.moment);
  check("(5) on the Power Up; (3) on an Ally's Defeat; (4) on a Threshold",
    [blocks("nameless-horde"), blocks("from-the-stars")], [["power"], ["ally-defeated", "threshold"]]);
}

// --- Nameless Horde (1)-(3) -----------------------------------------------------------------------------------------------------
{
  const plain = build([]);
  const horde = build(["nameless-horde"]);
  check("(3) Maximum Life Points, after all modifications, by half the Technique Points granted, rounded down",
    [horde.life.max - plain.life.max, horde.techniquePoints > 0], [Math.floor(horde.techniquePoints / 2), true]);
  check("(2) no Signature Technique made or gained; (3)'s flag",
    [horde.effects.slots["namelessHorde.noSignature"], horde.effects.slots["namelessHorde.techniqueLife"],
     plain.effects.slots["namelessHorde.noSignature"]], [true, true, undefined]);
  const injured = build(["nameless-horde"], { lifeShare: 0.2 });
  check("(1) Wound Rolls of the Basic Attack 2(T), below the Injured Health Threshold alone",
    [Number(horde.effects.slots["wound.basicAttack"]?.add) || 0, ["injured", "critical"].includes(injured.threshold.key),
     Number(injured.effects.slots["wound.basicAttack"]?.add) || 0],
    [0, true, 2 * injured.tierOfPower]);
}

// --- The Full Power Signature Techniques ----------------------------------------------------------------------------------------
{
  const items = FP.fullPowerItems("r0");
  const sigs = items.map(item => T.signatureOf(item));
  check("six, as listed: given by the Trait, every feature known, no Requirement unmet",
    [items.map(item => item.name), items.every(item => item.flags["dbu-ttrpg"].grantedBy === "r0"),
     sigs.flatMap(sig => sig.features).filter(entry => !T.featureDef(entry.id)).length,
     sigs.map(sig => sig.features.filter(entry => T.featureProblem(entry.id, sig)).map(entry => entry.id))],
    [["Full Power Energy Wave", "Full Power Energy Ball", "Full Power Energy Volley", "Super Explosive Wave", "High Power Rush",
      "High Speed Rush"], true, 0, [[], [], [], [], [], []]]);
  check("their Ki Point Costs: 13(T), 4(T), 6(T), 10(T), High Power Rush's listed 7(T) (the user's), 6(T); no Technique Points taken",
    [sigs.map(sig => T.profileKiPerTier(sig.profile) + T.techniqueKiPerTier(sig)), sigs.map(sig => T.techniqueTPCharged(sig))],
    [[13, 4, 6, 10, 7, 6], [0, 0, 0, 0, 0, 0]]);
  check("the Basic Attack's for their maker's effects - a Full Power Technique's attack, or the Maneuver it is made through",
    [M.throughBasicAttack({ maneuverId: "basic-attack" }), M.throughBasicAttack({ maneuverId: "x", fullPower: true }),
     M.throughBasicAttack({ id: "basic-attack" }), M.throughBasicAttack({ maneuverId: "signature-technique" })],
    [true, true, true, false]);
  const barred = { name: "Zarbon", system: { effects: { slots: { "namelessHorde.noSignature": true } } } };
  check("(2) refused: a new Technique, not a Full Power one nor a Transformation's; anybody else free",
    [FP.whyNoNewTechnique(barred).includes("Nameless Horde (2)"), FP.whyNoNewTechnique(barred, items[0]),
     FP.whyNoNewTechnique(barred, { system: { signature: { fromTransformation: true } } }), FP.whyNoNewTechnique({ system: {} }),
     FP.isTechniqueData({ type: "maneuver", system: { tags: ["signature"] } }), FP.isTechniqueData({ type: "maneuver", system: {} })],
    [true, "", "", "", true, false]);
  const UM = read("module", "use-maneuver.mjs"), MAN = read("module", "maneuvers.mjs"), CH = read("module", "chat.mjs");
  check("an effect's Basic Attack offered as a Full Power Technique instead; the maker's effects that ask for the Basic Attack ask throughBasicAttack",
    [UM.includes('if (options.outOfSequence && ((maneuver?.id ?? "") === "basic-attack") && !options.techniqueId) {'),
     MAN.includes('if (!declared || !throughBasicAttack(maneuver) || (actor?.system?.effects?.slots?.["warrior.freeBasic"] !== true)) return declared;'),
     MAN.includes('if (!noArea && throughBasicAttack(maneuver) && (slots["greed.area"] === true)) {'),
     MAN.includes('if (!declared || !throughBasicAttack(maneuver) || (actor?.system?.effects?.slots?.["angelic.advantage"] !== true)) return declared;'),
     UM.includes('&& (actor.system.effects?.slots?.["lightWeapons.calledShot"] === true) && throughBasicAttack(maneuver)'),
     CH.includes("if (basic && throughBasicAttack(attack)) parts.push("),
     CH.includes("...(maneuver.fullPower ? { fullPower: true } : {}),"),
     // Dimensional Hole is the target's effect, not the maker's: still the Basic Attack alone.
     CH.includes('if (attack.result || attack.maneuverId !== "basic-attack" || !'),
     read("module", "racial.mjs").includes('const techniques = [...grantedTechniqueItems(String(trait.grantsTechniques ?? ""), item.id), ...techniqueItemsFrom(trait, item.id)];'),
     read("module", "sheets", "actor-character-sheet.mjs").includes("const counted = built.filter(sig => !sig.fromTransformation && !sig.fullPower);")],
    [true, true, true, true, true, true, true, true, true, true]);
}

// --- From the Stars ------------------------------------------------------------------------------------------------------------
{
  const COND = await import(modUrl("effects/conditions.mjs"));
  const predicates = COND.PREDICATES;
  const token = (id, defeated, x = 0, allies = []) => ({ x, y: 0, width: 1, height: 1, parent: { id: "s", grid: { size: 100 } },
    actor: { documentName: "Actor", id, uuid: `A.${id}`, name: id, type: "character", system: { defeated, allies } } });
  const me = token("me", false, 0, ["pal", "bud"]);
  const scene = list => { globalThis.canvas = { grid: { size: 100 }, tokens: { placeables: list } }; };
  scene([me, token("pal", true, 100), token("bud", true, 200), token("foe", false, 300)]);
  const all = predicates.alliesAllDefeated({ data: { parent: me.actor } });
  scene([me, token("pal", true, 100), token("bud", false, 200)]);
  const one = predicates.alliesAllDefeated({ data: { parent: me.actor } });
  scene([me, token("foe", false, 300)]);
  const none = predicates.alliesAllDefeated({ data: { parent: me.actor } });
  check("(2) every Ally on the scene Defeated - and one there at least (the user's)", [all, one, none], [true, false, false]);
  const through = (from, threshold) => predicates.knockedThrough({ context: { from, threshold } }, "injured");
  check("(4) the Injured Health Threshold crossed: from above it to it or below it - not from it, not to Bruised",
    [through("healthy", "injured"), through("bruised", "critical"), through("injured", "critical"), through("healthy", "bruised"),
     predicates.knockedThrough({ context: { threshold: "injured" } }, "injured")], [true, true, false, false, true]);
  const G = await import(modUrl("guidance.mjs"));
  me.actor.getActiveTokens = () => [me];
  scene([me, token("foe", false, 300), token("near", false, 200), token("tie", false, -200), token("pal", false, 100),
    token("down", true, 100)]);
  check("(3) the nearest Opponent - each of them where several are, no Ally, nobody Defeated",
    G.nearestOpponents(me.actor).map(each => each.id).sort(), ["near", "tie"]);
  const CH = read("module", "chat.mjs"), CB = read("module", "combat.mjs");
  check("(3) a Minion's Defeat answers it too - Battle Tension's and Konatsian-Raised's except Minions still; (4) Defeated with nothing answering",
    [/what answers it \(Battle Tension's\)[^\n]*\n[^\n]*\n    if \(now\) \{/.test(CB),
     read("traits", "races", "konatsian", "battle-tension.dbu").replace(/\r/g, "").includes("[triggered/ally-defeated, effect 3]\nrequires !defeatedMinion;"),
     read("traits", "factors", "alternate-upbringing", "konatsian-raised.dbu").includes("requires !defeatedMinion;"),
     CH.includes('await actor.update({ "system.life.value": Number(actor.system.life?.min) || 0 }, { dbuSilenced: true });'),
     CH.includes('await setCondition(ally, "from-the-stars-mark", Math.max(tier, Number(ally.system.conditions?.["from-the-stars-mark"]) || 0));'),
     CB.includes('await setCondition(actor, "from-the-stars-mark", 0);'),
     CH.includes('{ threshold: card.threshold, from: card.thresholdFrom ?? "", knockerUuid: card.knockedBy ?? "" }')],
    [true, true, true, true, true, true, true]);
}

console.log(failed ? `\n${failed} failing` : "\n0 failing");
