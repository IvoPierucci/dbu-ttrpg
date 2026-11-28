/**
 * Unique Abilities: their TP, their Restrictions' locks and floor, their Ki Point floor, their scripts run
 * through the whole engine, and the tabs that build them.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const ROOT = process.argv[2];
const APP = (process.env.FOUNDRY_APP || String.raw`C:\Program Files\Foundry Virtual Tabletop\resources\app`);
const appUrl = p => pathToFileURL(path.join(APP, p)).href;
const modUrl = p => pathToFileURL(path.join(ROOT, "module", p)).href;
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

globalThis.CONST = {};
globalThis.foundry = {};
await import(appUrl("common/primitives/_module.mjs"));
globalThis.foundry.utils = { ...await import(appUrl("common/utils/_module.mjs")) };
globalThis.foundry.data = { ...await import(appUrl("common/data/_module.mjs")) };
globalThis.foundry.data.operators = { ForcedReplacement: { create: value => value } };
const { default: DataModel } = await import(appUrl("common/abstract/data.mjs"));
globalThis.foundry.abstract = { DataModel, TypeDataModel: DataModel };
// What the modules import from actor-types.mjs, for the functions cut out of them (the Minion Actor type).
globalThis.isMinion = actor => actor?.type === "minion";
// And what chat.mjs has of its own for the effects that make Minions (requestMakeMinion): nothing made here.
globalThis.requestMakeMinion = async () => [];
globalThis.minionRoom = () => 1;
globalThis.isCharacter = actor => ["character", "minion"].includes(actor?.type);
globalThis.ui = { notifications: { warn: () => {}, error: () => {}, info: () => {} } };
globalThis.Handlebars = { escapeExpression: String };
globalThis.game = { combat: null, users: { activeGM: null } };

globalThis.fromUuidSync = () => null;
globalThis.canvas = { tokens: { placeables: [] } };

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
const { default: DBUManeuverData } = await import(modUrl("data/item-maneuver.mjs"));
await loadTraits();
const U = await import(modUrl("unique.mjs"));

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

// --- Neo-Tuffle: Violent Rebuke -------------------------------------------------------------------------------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const vr = getTrait("violent-rebuke");
  const block = compile(vr.script).program.blocks.find(b => b.moment === "steadfast-passed");
  const A = read("module", "data", "actor-character.mjs"), CH = read("module", "chat.mjs");
  // The Surgency's Modifier, as written, run on its own: the highest of those allowed.
  const at = A.indexOf("const surgencyFrom = [");
  const pick = new Function("atts", "slots", `const self = { effects: { slots } };
    return (function () { ${A.slice(at, A.indexOf("const surgencyBelow", at)).replaceAll("this.", "self.")} return surgencyFrom[0]; })();`);
  const atts = { force: { mod: 2 }, magic: { mod: 3 }, scholarship: { mod: 5 }, personality: { mod: 4 } };
  check("Violent Rebuke: neo-tuffle's, Body, Secondary, 4th; Surgency from Scholarship or Personality where higher; a Surge out of sequence on a Steadfast Check passed",
    [vr.owner, vr.category, vr.importance, vr.order, compile(vr.script).errors.length,
     pick(atts, {}), pick(atts, { "surgency.magic": true }), pick(atts, { "surgency.scholarshipOrPersonality": true }),
     pick({ ...atts, personality: { mod: 6 } }, { "surgency.scholarshipOrPersonality": true }),
     block?.mode, Boolean(block?.modifiers?.outOfSequence ?? block?.outOfSequence)],
    ["neo-tuffle", "body", "secondary", 4, 0, "force", "magic", "scholarship", "personality", "triggered", true]);
  check("(3) the Basic Attack back - missed, hit for nothing, hit for Damage - once a Round, no Ki Wager but at the Inferior",
    [CH.includes("    offerRebuke(message, target, attacker);"),
     CH.includes("offerRebuke(message, who, fromUuidSync(attack.attackerUuid ?? \"\"));"),
     CH.includes("if (armsUser && (armsUser.uuid !== target.uuid)) offerRebuke(message, target, armsUser);"),
     CH.includes("grants: { rebuke: true, ...(wagers ? {} : { wagerCap: 0 }) } } });"),
     CH.includes("if (offer.grants?.rebuke) await requestActorUpdate(actor, { [`flags.${SCOPE}.rebukeRound`]: roundKey() });"),
     CH.includes("    offerFelineTechnique(message, target);")],
    [true, true, true, true, true, true]);
}

// --- Neo-Tuffle: Hate Empowerment, Hatred Embodiment ----------------------------------------------------------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const { programsFor } = await import(modUrl("effects/registry.mjs"));
  const { applyPassives } = await import(modUrl("effects/interpreter.mjs"));
  const he = getTrait("hate-empowerment");
  const block = compile(he.script).program.blocks.find(b => b.moment === "declare-maneuver");
  const hated = getTrait("hated");
  const actor = { items: [], getFlag: () => null, system: { tierOfPower: 2, conditions: { hated: 3 } } };
  const marked = applyPassives(programsFor(actor).filter(e => e.sourceId === "condition:hated" || String(e.sourceId).includes("hated")), "core",
    { data: { tierOfPower: 2, baseTierOfPower: 2, parent: actor, conditions: { hated: 3 } }, errors: [] }).slots;
  const CH = read("module", "chat.mjs"), MA = read("module", "maneuvers.mjs"), SH = read("module", "sheets", "actor-character-sheet.mjs");
  check("Hate Empowerment: neo-tuffle's, Hatred Embodiment, Body, 5th; (3) toggled on the Power Up or the Energy Charge; Hated, 4 at most, Soak a stack",
    [he.owner, he.subrace, he.category, he.order, compile(he.script).errors.length, block?.mode,
     Boolean(block?.modifiers?.toggle ?? block?.toggle), hated?.combatCondition === false || hated?.combatCondition === "no",
     Number(hated?.maxStacks), compile(hated.script).errors.length, marked.soakValue?.add ?? null],
    ["neo-tuffle", "hatred-embodiment", "body", 5, 0, "triggered", true, true, 4, 0, 6]);
  check("its readers: (1) a Charge for 2+ at the Inferior, once a Round; (2) every spending through spendRevenge; (4) the Basic Attack's Instant button",
    [MA.includes("return { ...declared, revengeSpent: spent, ...(charge ? { revengeCharge: true } : {}) };"),
     CH.includes("if (revengeCharge && !reflecting) charges = (Number(charges) || 0) + 1;"),
     CH.includes("export async function spendRevenge(actor, amount) {"), CH.includes("await expiresAt(actor, \"hated\", \"start-of-next-turn\", added);"),
     SH.includes("hateInstant: (maneuver.id === \"basic-attack\") && (this.actor.system.effects?.slots?.[\"hate.instant\"] === true),"),
     read("templates", "parts", "actor-maneuvers.hbs").includes('data-action="hateInstant"')],
    [true, true, true, true, true, true]);
}

// --- Neo-Tuffle: Parasitic Biology, Parasite -------------------------------------------------------------------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const { evaluate } = await import(modUrl("effects/conditions.mjs"));
  const { programsFor } = await import(modUrl("effects/registry.mjs"));
  const { applyPassives } = await import(modUrl("effects/interpreter.mjs"));
  const pb = getTrait("parasitic-biology");
  const block = compile(pb.script).program.blocks.find(b => b.moment === "hit-opponent");
  const round = `${globalThis.game?.combat?.id ?? "none"}:${globalThis.game?.combat?.round ?? 0}`;
  const owner = { getFlag: () => ({ uuid: "I", round }) };
  const drained = failedKeys => {
    const actor = { items: [], getFlag: () => null, system: { tierOfPower: 2, conditions: { "parasite-drained-injured": 1 } } };
    const out = {};
    for (const phase of ["core", "late"]) Object.assign(out, applyPassives(programsFor(actor).filter(e => String(e.sourceId).includes("parasite-drained")), phase,
      { data: { tierOfPower: 2, baseTierOfPower: 2, parent: actor, conditions: { "parasite-drained-injured": 1 }, threshold: { failedKeys } }, errors: [] }).slots);
    return [out.strike?.add ?? 0, out.stressBonus?.add ?? 0];
  };
  const CH = read("module", "chat.mjs");
  check("Parasitic Biology: neo-tuffle's, Parasite, Body, 6th; (3) toggled, your Inferior among those hit; Parasite-Drained while that Threshold's penalties hold",
    [pb.owner, pb.subrace, pb.category, pb.order, compile(pb.script).errors.length, block?.mode,
     evaluate(block.requires, { data: { parent: owner }, context: { struck: ["J", "I"] } }),
     evaluate(block.requires, { data: { parent: owner }, context: { struck: ["J"] } }),
     ["bruised", "injured", "critical"].map(key => compile(getTrait(`parasite-drained-${key}`).script).errors.length),
     drained(["injured"]), drained(["bruised"])],
    ["neo-tuffle", "parasite", "body", 6, 0, "triggered", true, false, [0, 0, 0], [-2, -1], [0, 0]]);
  check("its readers: (3) 2(bT) + 1(bT) a Revenge Point off their Ki; (4) 3(bT) of Ki for each Revenge Point an attack gave; (5) marked as the Check fails, once a Round",
    [CH.includes("const drained = (2 + (Number(context.revengeSpent) || 0)) * Math.max(1, Number(actor.system.baseTierOfPower) || 1);"),
     CH.includes("(Number(target.system.ki?.value) || 0) + revengeGained * 3 * Math.max(1, Number(target.system.baseTierOfPower) || 1)) });"),
     read("module", "combat.mjs").includes("await actor.setFlag(\"dbu-ttrpg\", \"parasiteKnock\", { by: knocker.uuid, threshold: now, round });"),
     CH.includes("if (!passed || automatic.length) await steadfastFailed(actor, [...automatic, ...(passed ? [] : [rolled])]);")],
    [true, true, true, true]);
}

// --- Yardrat: People of the Spirit ----------------------------------------------------------------------------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const { programsFor } = await import(modUrl("effects/registry.mjs"));
  const { applyPassives } = await import(modUrl("effects/interpreter.mjs"));
  const ps = getTrait("people-of-the-spirit");
  const actor = { items: [{ type: "racial", id: "X", uuid: "A.X", name: ps.name, system: { script: ps.script } }],
    getFlag: () => null, system: { tierOfPower: 2 } };
  const slots = applyPassives(programsFor(actor).filter(e => e.sourceId === "X"), "core",
    { data: { tierOfPower: 2, baseTierOfPower: 2, parent: actor, skills: { clairvoyance: {} } }, errors: [] }).slots;
  const US = read("module", "use-maneuver.mjs"), SH = read("module", "sheets", "actor-character-sheet.mjs");
  check("People of the Spirit: yardrat's, Mind, Primary, 1st; Clairvoyance 2 Ranks; UAs 3 TP less; Empower within reach; its Instant",
    [ps.owner, ps.category, ps.importance, ps.order, compile(ps.script).errors.length, slots["skill.clairvoyance.ranks"]?.add,
     slots["unique.technical.tpCost"]?.add, slots["unique.magical.tpCost"]?.add, slots["empower.anyRange"], slots["empower.spiritInstant"]],
    ["yardrat", "mind", "primary", 1, 0, 2, -3, -3, true, true]);
  check("its readers: within Melee Range for the Empower; 3 Actions given, not asked; the Surge offered; once an Encounter from the row",
    [US.includes("const close = (actor.system.effects?.slots?.[\"empower.anyRange\"] === true) || ((squares !== null) && (squares <= reach));"),
     US.includes("if (Number(maneuver.presetActions) > 0) return Number(maneuver.presetActions);"),
     US.includes("reason: `People of the Spirit - ${actor.name}'s Empower`, surge: true }] : [])];"),
     SH.includes("if (!await useManeuver(this.actor, { ...definitionOf(item), type: \"instant\", presetActions: 3, spiritSurge: true })) return;")],
    [true, true, true, true]);
}

// --- Shadow Dragon: Negative Ki ---------------------------------------------------------------------------------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const nk = getTrait("negative-ki");
  const blocks = compile(nk.script).program.blocks;
  const at = moment => blocks.find(b => b.moment === moment);
  const CH = read("module", "chat.mjs");
  check("Negative Ki: shadow-dragon's, Body, Primary, 1st; Negative Energy (max 4); (1) Round start, (2) turn start, (4) as gained - toggled; (5) Automatic",
    [nk.owner, nk.category, nk.importance, nk.order, compile(nk.script).errors.length, nk.resource, Number(nk.resourceMax),
     [at("start-of-round")?.mode, at("start-of-turn")?.mode, at("negative-energy-gained")?.mode, at("end-of-round")?.mode]],
    ["shadow-dragon", "body", "primary", 1, 0, "negativeenergy", 4, ["triggered", "triggered", "triggered", "automatic"]]);
  check("its readers: (1) Life for Negative Energy, its gain a Moment; (2) a Morale Clash each, Impaired won; (3) an Impaired Opponent's Strike or Dodge lowered",
    [CH.includes("await reduceLifePoints(actor, n * step, { reason: \"Negative Ki\", own: true, momentum: false });"),
     CH.includes("return stacksGained(actor, [\"negativeenergy\"], { negativeenergy: n });"),
     CH.includes("saves: [\"morale\"], defenderSaves: [\"morale\"], negativeImpair: { applied: false } });"),
     CH.includes("if (!result) negativeKiButtons(message, attack, container);"),
     CH.includes("naturalAdd: (Number(options?.naturalAdd) || 0) + negativeNatural(attack, actor.uuid) }),"),
     CH.includes("+ sniperNatural(attacker, attack) + negativeNatural(attack, attacker.uuid)")],
    [true, true, true, true, true, true]);
}

// --- Racial Talents, Neko Majin: Cat's Paw, Feline Rally, Will of Nine Lives, Cat Burglar ----------------------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const { talentCategoryOf } = await import(modUrl("talent-categories.mjs"));
  const { snatchableDama } = await import(modUrl("majin-dama.mjs"));
  const ids = ["cats-paw", "feline-rally", "will-of-nine-lives", "cat-burglar"];
  const triggered = id => (compile(getTrait(id).script).program?.blocks ?? []).filter(b => b.mode === "triggered")
    .map(b => [b.moment, Boolean(b.modifiers?.outOfSequence ?? b.outOfSequence)]);
  const dama = { type: "gear", system: { gearId: "majin-dama", integrated: true, equipped: true } };
  const sleeper = burglar => ({ items: [dama], system: { defeated: false, conditions: { sleeping: 1 },
    effects: { slots: burglar ? { "catBurglar.dama": true } : {} } } });
  const CH = read("module", "chat.mjs");
  check("Neko Majin's Racial Talents: Cat's Paw's two Clashes (an attack's button, the Energy Charge's offer) and the Copied Technique; Feline Rally's Allies' Surgency, Ki at turn start and on a Surge; Will of Nine Lives' Steadfast, the Dama put aside, the Healing Surge out of sequence; Cat Burglar's Dama kept while Sleeping, Thievery answered, a Technique copied",
    [ids.map(id => [talentCategoryOf(getTrait(id))?.race, compile(getTrait(id).script).errors.length]),
     ids.map(triggered), snatchableDama(sleeper(false)).length, snatchableDama(sleeper(true)).length,
     CH.includes("if (!result?.wound) catsPawButtons(message, attack, container);"),
     CH.includes("if (clash.catsPaw && clash.result && !clash.catsPaw.applied) await settleCatsPaw(message, clash);"),
     read("module", "use-maneuver.mjs").includes("offerCatsPawCharge(card, actor, maneuverKiCost(maneuver, null, actor));"),
     (CH.match(/await felineRallySurge\(actor\);/g) ?? []).length, CH.includes("surgency += more;"),
     read("module", "combat.mjs").includes('actor.getFlag?.("dbu-ttrpg", "nineLivesDama")'),
     read("module", "dbu-ttrpg.mjs").includes('"feline-rally"'), CH.includes('offered = (burglar && !named.includes("thievery"))')],
    [ids.map(() => ["neko-majin", 0]), [[], [["start-of-turn", false]], [["threshold", true]], [["snatch-won", false]]], 1, 0,
     true, true, true, 2, true, true, true, true]);
}

// --- Racial Talents, Shinjin: Combat Observation, Dedicated Watcher ------------------------------------------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const { talentCategoryOf } = await import(modUrl("talent-categories.mjs"));
  const ids = ["combat-observation", "dedicated-watcher"];
  const CH = read("module", "chat.mjs");
  const cut = CH.slice(CH.indexOf("function balancedParts(actor, attack, label) {"), CH.indexOf("function observationButtons("));
  const balancedParts = new Function(`${cut}; return balancedParts;`)();
  const attack = { balanced: [{ uuid: "a", value: 3 }, { uuid: "a", value: 3, source: "Combat Observation" }, { uuid: "b", value: 2, source: "Dedicated Watcher - Kibito" }] };
  check("Shinjin's Racial Talents: Combat Observation - a Counter Action, Defense and Soak or Strike and Wound 1(T) for the attack; Dedicated Watcher - a second Cheered Ally, and the same for Allies while Spectating",
    [ids.map(id => [talentCategoryOf(getTrait(id))?.race, compile(getTrait(id).script).errors.length]),
     balancedParts({ uuid: "a" }, attack, "Soak").map(part => [part.label, part.value]),
     balancedParts({ uuid: "b" }, attack, "Defense Value").map(part => part.label),
     CH.includes("if (!result) observationButtons(message, attack, container);"),
     CH.includes('const count = (actor.system?.effects?.slots?.["watcher.extraAlly"] === true) ? 2 : 1;')],
    [ids.map(() => ["shinjin", 0]), [["Balanced Defender (Soak)", 3], ["Combat Observation (Soak)", 3]],
     ["Dedicated Watcher - Kibito (Defense Value)"], true, true]);
}

// --- Racial Talents, Yardrat: Spiritual Leadership, Twinned Spirits, Yaki Swarm, Yaki Master ------------------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const { talentCategoryOf } = await import(modUrl("talent-categories.mjs"));
  const { bondOf } = await import(modUrl("effects/conditions.mjs"));
  const ids = ["spiritual-leadership", "twinned-spirits", "yaki-swarm", "yaki-master"];
  const flagged = { getFlag: () => ({ uuid: "Actor.b", name: "B" }), items: [], system: { effects: { slots: {} } } };
  const twinned = { getFlag: () => ({ uuid: "Actor.b", name: "B" }), items: [], system: { effects: { slots: { "twinned.partner": true } } } };
  const yaki = getTrait("yaki-swarm-first-effect");
  const CH = read("module", "chat.mjs");
  const CO = read("module", "effects", "conditions.mjs");
  check("Yardrat's Racial Talents: Spiritual Leadership - a Minion Bonded; Twinned Spirits - Bonded to the Partner alone, the Partner's Combat Rolls 1(T); Yaki Swarm's Yaki paid and said; the Minions' effects wait",
    [ids.map(id => [talentCategoryOf(getTrait(id))?.race, compile(getTrait(id).script).errors.length]),
     bondOf(flagged)?.uuid, bondOf(twinned), [yaki?.type, yaki?.actionCost, yaki?.usageLimit],
     CO.includes('if (empowered?.system?.minion && !yaki && (self.system?.effects?.slots?.["leadership.bondMinion"] !== true)) return false;'),
     CH.includes('if (!actor || !ally || (actor.system?.effects?.slots?.["twinned.partner"] === true)) return;'),
     CH.includes('...(twinned ? [{ label: `Twinned Spirits (${twin.name})`, written: "+1(T)", value: twinned }] : [])'),
     (CH.match(/getFlag\?\.\(SCOPE, "bonded"\)/g) ?? []).length],
    // Twinned Spirits' and Yaki Master (2)'s "If you are not Bonded".
    [ids.map(() => ["yardrat", 0]), "Actor.b", null, ["standard", 1, "1/round"], true, true, true, 2]);
}

// --- Bestial Traits: Sturdy Shell, Tail, Treacherous Spikes, Underwater Beast, Weather Resilient, Winged Beast ----------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const { evaluate } = await import(modUrl("effects/conditions.mjs"));
  const { platingBonusPerTier } = await import(modUrl("gear.mjs"));
  const ids = ["sturdy-shell", "tail", "treacherous-spikes", "underwater-beast", "weather-resilient", "winged-beast"];
  const ask = (name, args, data) => evaluate({ type: "predicate", name, args }, { data });
  const spiky = power => ({ items: [{ type: "racial", flags: { "dbu-ttrpg": { sourceId: "treacherous-spikes" } } }],
    system: { resources: power ? { power: { stacks: 1 } } : {} } });
  const CH = read("module", "chat.mjs");
  check("Bestial Traits, the last six: compiling; the Shell and Quillset Natural Armor with their Quality; the Quillset 1(T) with Power; Sky, Weather and Underwater asked; the Shell's Collision, Steadfast box and Burst; Spikes' Clashes; Winged Beast's button",
    [ids.map(id => [getTrait(id)?.owner, compile(getTrait(id).script.replaceAll("$choice", "hot-weather")).errors.length]),
     [getTrait("sturdy-shell").naturalArmor, getTrait("sturdy-shell").naturalArmorQuality, getTrait("treacherous-spikes").naturalArmor,
      getTrait("treacherous-spikes").naturalArmorQuality], [platingBonusPerTier(spiky(true), getTrait), platingBonusPerTier(spiky(false), getTrait)],
     [ask("inSky", [], { battlefield: { highEnvironment: 1 } }), ask("inSky", [], { battlefield: { highEnvironment: 3 } }),
      ask("inWeather", ["hot-weather"], { battlefield: { weather: { id: "hot-weather" } } })],
     compile(getTrait("underwater-environment").script).errors.length,
     CH.includes('return (slots["collision.halved"] === true) || ((slots["shell.collision"] === true) && Boolean(target.system.naturalArmor?.active));'),
     CH.includes('shellSpent ? "1[Sturdy Shell]" : "",'), CH.includes("if (clash.quills && clash.result && !clash.quills.applied) await settleQuills(message, clash);"),
     read("module", "dbu-ttrpg.mjs").includes('return shellBroken(item);'), read("module", "use-maneuver.mjs").includes('await actor.update({ ...outOfSequenceGranted(1), "flags.dbu-ttrpg.wingedRound": round });')],
    [ids.map(() => ["bestial", 0]), ["Shell", "dense-armor", "Quillset", "spiked"], [1, 0], [true, false, true], 0, true, true, true, true, true]);
}

// --- Monstrous Traits, the last five: Super Elastic Body, Terrifying Visage, Unique Monstrosity, Unrelenting, Weather Environment -
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const { racialOptionsOf } = await import(modUrl("racial.mjs"));
  const { lightLevelOf } = await import(modUrl("light.mjs"));
  const ids = ["super-elastic-body", "terrifying-visage", "unique-monstrosity", "unrelenting", "weather-environment"];
  const lit = level => ({ battlefield: { lightLevel: level }, conditions: {},
    parent: { items: [{ id: "w", type: "racial", flags: { "dbu-ttrpg": { sourceId: "weather-environment" } }, system: { chosen: [{ key: "option", value: "light" }] } }] } });
  const CH = read("module", "chat.mjs");
  check("Monstrous Traits, the last five - all 19 built: compiling; Super Elastic Body's Damage Reduction, Reflect, Launch and Direct Hit; Terrifying Visage out of sequence; Unique Monstrosity's choice and Ki; Weather Environment's two Options, the Light treated Normal and read as it is",
    [ids.map(id => [getTrait(id)?.owner, compile(getTrait(id).script).errors.length]),
     racialOptionsOf("weather-environment").map(trait => [trait.id, compile(trait.script.replaceAll("$choice", "hot-weather")).errors.length]),
     [lightLevelOf(lit(-2), getTrait), lightLevelOf(lit(2), getTrait), lightLevelOf(lit(-2), getTrait, { treated: false })],
     Number(getTrait("unique-monstrosity").grantsUniqueChoice),
     read("module", "maneuvers.mjs").includes('if (given?.flags?.["dbu-ttrpg"]?.sourceId === "unique-monstrosity") cost -= 2 * Math.max(1, tier);'),
     CH.includes('if (offer.elasticLaunch) return takeElasticLaunch(message, actor, offer);'),
     CH.includes('if ((own.defense === "directHit") && (damage <= 0) && armsUser && (armsUser.uuid !== target.uuid)'),
     CH.includes('+ (((target.system.effects?.slots?.["elastic.reduction"] === true) && ["physical", "energy"].includes(attack.foundation))')],
    [ids.map(() => ["monstrous", 0]), [["battle-weather", 0], ["light", 0]], [0, 0, -2], 20, true, true, true, true]);
}

// --- Racial Factor: Beast-Man - Part Beast, Were-Beast; a Trait set aside (aside.mjs) ---------------------------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const { traitAside } = await import(modUrl("aside.mjs"));
  const flagged = flags => ({ id: "x", type: "racial", flags: { "dbu-ttrpg": flags } });
  const holder = choice => ({ getFlag: () => choice });
  const now = { round: "none:0", kind: "were" };
  check("Beast-Man: its Requirement; Part Beast two Bestial Traits, Perception 2, Strike and Dodge Critical 1 lower; Were-Beast's Were-Traits applying in a Round chosen for them, the Normal Trait in every other; the Trigger's Racial Life",
    [getTrait("beast-man")?.requirement, [getTrait("part-beast").grantsOther, Number(getTrait("part-beast").grantsOtherCount)],
     compile(getTrait("part-beast").script).errors.length, compile(getTrait("were-beast").script.replaceAll("$with-a-trigger", "1").replaceAll("$without-a-trigger", "0")).errors.length,
     [getTrait("were-beast").wereTraits, getTrait("were-beast").asksNormalTrait],
     [traitAside(flagged({ wereTrait: true }), [], holder(null)), traitAside(flagged({ wereTrait: true }), [], holder(now)),
      traitAside(flagged({ normalTrait: true }), [], holder(null)), traitAside(flagged({ normalTrait: true }), [], holder(now)),
      traitAside(flagged({ bestialOff: "y" }), [{ id: "y" }], holder(null))]],
    ["Android, Bio-Android, Custom Species, Demon, Earthling", ["bestial", 2], 0, 0, [true, true], ["were", "", "", "normal", "bestial"]]);
}

// --- Alternate Upbringing: Glass Tribe-, Heran-, Konatsian-, Majin-, Namekian-Raised; Inherited Tension --------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const ids = ["glass-tribe-raised", "heran-raised", "konatsian-raised", "majin-raised", "namekian-raised"];
  const CH = read("module", "chat.mjs");
  const cut = CH.slice(CH.indexOf("export function vocationTension(actor) {"), CH.indexOf("/** That much spent by a Vocation's effect"));
  const vocationTension = new Function(`${cut.replace("export ", "")}; return vocationTension;`)();
  check("Glass Tribe-, Heran-, Konatsian-, Majin-, Namekian-Raised: compiling, in order; Inherited Tension its own Resource (3), spent as Tension by a Vocation; Heran's offers by the giver's flag; Majin's Clash on a miss; Namekian's Opponent",
    [ids.map(id => [getTrait(id)?.owner, Number(getTrait(id)?.order), compile(getTrait(id).script.replaceAll("$choice", "bluff")).errors.length]),
     [getTrait("konatsian-raised").resource, Number(getTrait("konatsian-raised").resourceMax), getTrait("konatsian-raised").grantsOther],
     vocationTension({ system: { resources: { tension: { stacks: 2 }, inheritedtension: { stacks: 1 } } } }),
     (CH.match(/spendVocationTension\(/g) ?? []).length >= 9, CH.includes("if (offer.grants?.giverFlag) {"),
     CH.includes("if (clash.majinRaised && clash.result && !clash.majinRaised.applied) await settleMajinRaised(message, clash);"),
     CH.includes("return [...superiorityParts(attacker, target, roll), ...namekianFocusParts(attacker, target?.uuid),"),
     read("module", "maneuvers.mjs").includes('if (unpenalized) await (await import("./chat.mjs")).surgingSpare(actor);')],
    [[["alternate-upbringing", 6, 0], ["alternate-upbringing", 7, 0], ["alternate-upbringing", 8, 0], ["alternate-upbringing", 9, 0], ["alternate-upbringing", 10, 0]],
     ["inheritedtension", 3, "vocation"], 3, true, true, true, true, true]);
}

// --- Alternate Upbringing: Neko Majin-, Neo-Tuffle-, Oni-, Other-, Saiyan-, Shadow Dragon-, Shinjin-Raised -----------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const ids = ["neko-majin-raised", "neo-tuffle-raised", "oni-raised", "other-raised", "saiyan-raised", "shadow-dragon-raised", "shinjin-raised"];
  const CH = read("module", "chat.mjs");
  const mark = getTrait("shinjin-counter-mark");
  check("Neko Majin-, Neo-Tuffle-, Oni-, Other-, Saiyan-, Shadow Dragon-, Shinjin-Raised: compiling, in order; Neko's Quick Learner, Copied Wound and Ki; Neo-Tuffle's Opponent, Surging and Greater Dice; Oni's Clash and uncapped Charges, Life its least after; Saiyan's Basic Attack in Superior; Shadow Dragon's Botch, Exploit and Impaired Sphere; Shinjin's Counter mark and rest",
    [ids.map(id => [getTrait(id)?.owner, getTrait(id)?.category, Number(getTrait(id)?.order), compile(getTrait(id).script).errors.length]),
     getTrait("neko-majin-raised").grantsTalent, [mark?.kind, compile(mark.script).errors.length],
     CH.includes("if (!reflecting && maneuver.copiedEffects && (actor.system.effects?.slots?.[\"nekoRaised.copiedWound\"] === true)"),
     CH.includes("if (made && (actor.system?.effects?.slots?.[\"nekoRaised.copiedKi\"] === true)"),
     CH.includes("...neoGreaterDice(attacker, attack),"), CH.includes("uncappedCharges = (Number(uncappedCharges) || 0) + 2;"),
     CH.includes("if (attack.oniDrained) await attacker.update({ \"system.life.value\": Number(attacker.system.life?.min) || 0 });"),
     CH.includes("await attackDurationEnds(attack);"), CH.includes("if (offer.grants?.saiyanSuperior) {"),
     CH.includes("[\"karmic-reflection\", \"shadow-dragon-raised\"].includes(item.flags?.[\"dbu-ttrpg\"]?.sourceId)"),
     CH.includes("offerShadowRaised(message, dragon, botcher);"),
     CH.includes("impede: shadow ? { applied: false, condition: \"impaired\", edge: \"start\", next: true, source } : { applied: false } });"),
     read("module", "maneuvers.mjs").includes("await setCondition(actor, \"shinjin-counter-mark\", 1);")],
    [ids.map((id, i) => ["alternate-upbringing", "mind", 11 + i, 0]), "quick-learner", ["conditions", 0],
     true, true, true, true, true, true, true, true, true, true, true]);
}

// --- Alternate Upbringing: Yardrat-Raised, Zooner-Raised - the last of them ---------------------------------------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const CH = read("module", "chat.mjs"), US = read("module", "use-maneuver.mjs");
  check("Yardrat-, Zooner-Raised: in order, compiling; the Empower an Action more and half its Ki as Life; Zooner's Called Shot unpenalized and its Energy Charge, each paid for as the attack is done",
    [["yardrat-raised", "zooner-raised"].map(id => [getTrait(id)?.owner, Number(getTrait(id)?.order), compile(getTrait(id).script).errors.length]),
     compile(getTrait("zooner-raised-mark").script).errors.length,
     US.includes('if (actor.system.effects?.slots?.["yardratRaised.empower"] === true) actionsSpent += 1;'),
     US.includes('await actor.setFlag("dbu-ttrpg", "yardratHealEncounter", encounter);'),
     US.includes('answers.earthlingCharge = [].concat(answers.earthlingCharge || [], "Zooner-Raised");'),
     CH.includes("const up = ((Number(attack.punchingUp) || 0) > 0) || Boolean(attack.zoonerCalled);"),
     CH.includes('await markUntilNextTurn(attacker, attacker, "zooner-raised-mark", Number(attack.zoonerExposed), "start", "Zooner-Raised");')],
    [[["alternate-upbringing", 20, 0], ["alternate-upbringing", 21, 0]], 0, true, true, true, true, true]);
}

// --- Alternate Upbringing: Tuffle-Raised, Wild Child; the Pseudo-Bestial Traits ---------------------------------------
{
  const { getTrait, traitsOfKind } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const { traitAside } = await import(modUrl("aside.mjs"));
  const { PREDICATES } = await import(modUrl("effects/conditions.mjs"));
  const CH = read("module", "chat.mjs");
  const pseudo = traitsOfKind("other", "pseudo-bestial").sort((a, b) => Number(a.order) - Number(b.order));
  const held = id => ({ id, type: "racial", system: { other: "pseudo-bestial" }, flags: { "dbu-ttrpg": {} } });
  const holder = access => ({ getFlag: () => access });
  // Allies by the Allies list (allies.mjs): the knocker on it, or not.
  const knocked = listed => PREDICATES.knockedByOpponent({ context: { knockerUuid: "A.k" },
    data: { parent: { documentName: "Actor", id: "me", uuid: "A.me", system: { allies: listed ? ["k"] : [] } } } });
  const realFrom = globalThis.fromUuidSync;
  globalThis.fromUuidSync = () => ({ documentName: "Actor", id: "k", uuid: "A.k", system: { allies: [] } });
  const sides = [knocked(false), knocked(true)];
  globalThis.fromUuidSync = realFrom;
  check("Tuffle-Raised, Wild Child: in order, compiling; the Pseudo-Bestial Traits, eight, compiling, applying only with access - one, or all; knocked through by an Opponent; Wild Child's two of them; offerMove carrying every mark",
    [["tuffle-raised", "wild-child"].map(id => [getTrait(id)?.owner, Number(getTrait(id)?.order), compile(getTrait(id).script).errors.length]),
     pseudo.map(trait => [trait.id, compile(trait.script).errors.length]),
     [traitAside(held("x"), [], holder(null)), traitAside(held("x"), [], holder({ ids: ["x"] })), traitAside(held("x"), [], holder({ all: true }))],
     sides, [getTrait("wild-child").grantsOther, Number(getTrait("wild-child").grantsOtherCount)], getTrait("tuffle-raised").resource,
     CH.includes("const marked = Object.fromEntries(Object.entries(marks).filter(([, value]) => value === true));"),
     compile(getTrait("tuffle-raised-mark").script).errors.length],
    [[["alternate-upbringing", 18, 0], ["alternate-upbringing", 19, 0]],
     [["mimicry-of-bestial-hunger", 0], ["mimicry-of-bestial-movement", 0], ["mimicry-of-bestial-resilience", 0], ["mimicry-of-bestial-senses", 0],
      ["mimicry-of-flailing-limbs", 0], ["mimicry-of-penetrating-fangs", 0], ["mimicry-of-rending-claws", 0], ["mimicry-of-the-whipping-tail", 0]],
     ["pseudo", "", ""], [true, false], ["pseudo-bestial", 2], "grudge", true, 0]);
}

// --- Mutation: Brute, Captain, Giant Gene, Speedster, Tactician, Technician ------------------------------------------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const { movementKiCost } = await import(modUrl("maneuvers.mjs"));
  const CH = read("module", "chat.mjs"), US = read("module", "use-maneuver.mjs"), AC = read("module", "data", "actor-character.mjs");
  const ids = ["brute", "captain", "giant-gene", "speedster", "tactician", "technician"];
  const mover = free => movementKiCost({ system: { tierOfPower: 2, effects: { slots: {} } } }, { speed: "boosted", free });
  check("Mutation: Brute, Captain, Giant Gene, Speedster, Tactician, Technician - in order, compiling; the Boosted Speed at the Normal Speed's price; Giant Gene's Size read as Large and as Gigantic; the buttons and the Signature Technique's asks",
    [ids.map(id => [getTrait(id)?.owner, getTrait(id)?.category, Number(getTrait(id)?.order), compile(getTrait(id).script).errors.length]),
     compile(getTrait("rally-mark").script).errors.length, [mover(false), mover(true)],
     AC.includes('const defenseAt = (((this.effects?.slots?.["giantGene.size"] === true) || (this.effects?.slots?.["tremendous.size"] === true)\n'),
     CH.includes('+ (((attacker.system?.effects?.slots?.["giantGene.size"] === true) && (attacker.system.size?.key === "enormous")) ? 1 : 0);'),
     ["bruteButtons(message, attack, container);", "giantButtons(message, attack, container);", "speedsterButtons(message, attack, container);",
      "parts.push(...speedsterDodge(actor, attack));"].every(text => CH.includes(text)),
     US.includes('answers.earthlingCharge = [].concat(answers.earthlingCharge || [], "Technician");'),
     US.includes('.filter(id => featureDef(id)?.owner !== "disadvantages");'),
     read("module", "combat.mjs").includes('(await import("./chat.mjs")).speedsterTurnOffers(turnCard);')],
    [[["mutation", "body", 1, 0], ["mutation", "mind", 2, 0], ["mutation", "body", 3, 0], ["mutation", "body", 5, 0], ["mutation", "mind", 6, 0],
      ["mutation", "mind", 7, 0]], 0, [6, 0], true, true, true, true, true, true]);
}

// --- Mutation: Emperor, Tremendous Lord, Golden Fruit - every one of its Factor Traits ---------------------------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const CH = read("module", "chat.mjs");
  const ids = ["emperor", "tremendous-lord", "golden-fruit"];
  check("Emperor, Tremendous Lord, Golden Fruit: their races, in order, compiling; Overwhelm on the Stress Test and filled by Legend Realized; an Opponent's Punching Up and the Soak against the smaller; the Transformation after Namekian Biology; Divine Ki for a Counter Action, regained, God Ki or Superior",
    [ids.map(id => [getTrait(id)?.owner, getTrait(id)?.race, Number(getTrait(id)?.order), compile(getTrait(id).script).errors.length]),
     compile(getTrait("golden-fruit-first-effect").script).errors.length,
     CH.includes('...(spentOverwhelm ? [{ label: `Emperor (${spentOverwhelm} Overwhelm)`, value: spentOverwhelm / 2 }] : [])];'),
     CH.includes("const larger = target ? (trueSteps(target, true) - trueSteps(attacker)) : 0;"),
     CH.includes("if (!result?.wound) tremendousLordButtons(message, attack, container);"),
     CH.includes("if (offer.grants?.encounterFlag) await requestActorUpdate(actor,"),
     read("module", "effects", "moments-runtime.mjs").includes('case "fillResource": {')],
    [[["mutation", "arcosian", 8, 0], ["mutation", "namekian", 9, 0], ["mutation", "shinjin", 11, 0]], 0, true, true, true, true, true]);
}

// Golden Fruit (3) enters God Ki: a way into it, which shows its Divine Ki on the header before it is entered (the user's, 2026-11-15) -
// paying with it still the State's alone.
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { programsFor } = await import(modUrl("effects/registry.mjs"));
  const { applyPassives } = await import(modUrl("effects/interpreter.mjs"));
  const gf = getTrait("golden-fruit");
  const actor = { items: [{ type: "racial", id: "G", uuid: "A.G", name: gf.name, flags: { "dbu-ttrpg": { sourceId: "golden-fruit" } },
    system: { script: gf.script } }], getFlag: () => null, system: { tierOfPower: 2 } };
  const slots = applyPassives(programsFor(actor).filter(e => e.sourceId === "G"), "core",
    { data: { tierOfPower: 2, baseTierOfPower: 2, parent: actor }, errors: [] }).slots;
  const DM = read("module", "data", "actor-character.mjs"), HD = read("templates", "parts", "actor-header.hbs"), MN = read("templates", "parts", "actor-maneuvers.hbs");
  check("a way into God Ki: Golden Fruit's passive gives it; the header's DKP and short names by it, in the State or not; paying, the State's alone",
    [slots["godKi.access"] === true || slots["godKi.access"]?.value === true || Boolean(slots["godKi.access"]),
     DM.includes('this.divineKi.access = this.divineKi.active || (this.effects?.slots?.["godKi.access"] === true);'),
     (HD.match(/system\.divineKi\.access/g) ?? []).length, HD.includes("system.divineKi.active"), MN.includes("{{#if system.divineKi.active}}")],
    [true, true, 5, false, true]);
}

// --- Racial Factor: Reincarnated - Lingering Power ------------------------------------------------------------------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const { programsFor } = await import(modUrl("effects/registry.mjs"));
  const { applyPassives } = await import(modUrl("effects/interpreter.mjs"));
  const lp = getTrait("lingering-power");
  const script = lp.script.replaceAll("$pastSkill", "perception").replaceAll("$pastAttribute", "insight");
  const actor = { items: [{ type: "racial", id: "L", uuid: "A.L", name: lp.name, flags: { "dbu-ttrpg": { sourceId: "lingering-power" } },
    system: { script } }], getFlag: () => null, system: { tierOfPower: 2 } };
  const tierSlots = applyPassives(programsFor(actor).filter(e => e.sourceId === "L"), "tier",
    { data: { tierOfPower: 2, baseTierOfPower: 2, parent: actor }, errors: [] }).slots;
  const R = read("module", "racial.mjs");
  check("Reincarnated: Any, 1; Lingering Power - Mind, its Past Life asked as it is gained; the Skill Rank and the Attribute +2 as answered; the Talent given; the Power Up's 2(bT) by the Past Life's Tier",
    [getTrait("reincarnated")?.requirement, Number(getTrait("reincarnated")?.maximumFactor), [lp.owner, lp.category, lp.pastLife],
     compile(script).errors.length, script.includes("insight.score += 2;") ? 2 : 0, compile(getTrait("lingering-power-mark").script).errors.length,
     R.includes("const past = await askPastLife(actor, trait);"), R.includes("if (past.talent) made.grants.talents = [...(made.grants.talents ?? []), past.talent];"),
     read("module", "chat.mjs").includes('return markUntilNextTurn(actor, actor, "lingering-power-mark", 2 * tier, "end", "Lingering Power");')],
    ["Any", 1, ["reincarnated", "mind", true], 0, 2, 0, true, true, true]);
}

// --- Racial Factor: Cybernetic Enhancement - Armor Plating, Cloaking System, Emergency Energy Supplies, Integrated Weapon, Life Support
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const CH = read("module", "chat.mjs"), R = read("module", "racial.mjs");
  const ids = ["armor-plating", "cloaking-system", "emergency-energy-supplies", "integrated-weapon", "life-support"];
  const iw = getTrait("integrated-weapon");
  check("Cybernetic Enhancement: Any, 3; its first five Factor Traits - Body, in order, compiling; Cloaking System's two Maneuvers and its mark; Integrated Weapon's chosen Category, Grade 4, Regenerating in no Slot; the Damage Category step, the Wound, the Power Up after a Surge",
    [[getTrait("cybernetic-enhancement")?.requirement, Number(getTrait("cybernetic-enhancement")?.maximumFactor)],
     ids.map(id => [getTrait(id)?.owner, getTrait(id)?.category, Number(getTrait(id)?.order), compile(getTrait(id).script).errors.length]),
     ["cloaking-system-third-effect", "cloaking-system-fourth-effect"].map(id => [getTrait(id)?.fromTrait, compile(getTrait(id).script).errors.length]),
     [iw.choose, iw.grantsWeapon, Number(iw.grantsWeaponGrade), iw.grantsWeaponQualities],
     R.includes('qualities: listOf(trait.grantsWeaponQualities).map(id => ({ id, slots: 0, choice: "", on: false, name: "", free: true, granted: true })) });'),
     CH.includes("const steps = raised + vulnerable(entry) - ((attack.armorPlated ?? []).includes(entry.uuid) ? 1 : 0)"),
     CH.includes("    ...integratedWeaponWound(attacker, attack),"), (CH.match(/await emergencyPowerUp\(actor\);/g) ?? []).length],
    [["Any", 3], ids.map((id, i) => ["cybernetic-enhancement", "body", i + 1, 0]),
     [["cloaking-system", 0], ["cloaking-system", 0]], ["weaponCategory", "chosen", 4, "regenerating"], true, true, true, 2]);
}

// --- Cybernetic Enhancement: the last eight - Mental Supercomputer to Synthetic Muscle -------------------------------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const CH = read("module", "chat.mjs"), US = read("module", "use-maneuver.mjs");
  const ids = ["mental-supercomputer", "metallic-exoskeleton", "nanomachine-repair", "onboard-computer", "robotic-limb", "rocket-sleeves",
    "signature-amplifier", "synthetic-muscle"];
  const oc = getTrait("onboard-computer");
  check("Cybernetic Enhancement, the last eight: Body, in order, compiling, their marks too; the Metal Exoskeleton Natural Armor; the Scouter at Master, Integrated; Nanomachine Repair's turn; the Onboard focus, the Exoskeleton's Soak, the Greater Dice, Rocket Sleeves and the Amplifier's asks",
    [ids.map((id, i) => [getTrait(id)?.owner, getTrait(id)?.category, Number(getTrait(id)?.order), compile(getTrait(id).script).errors.length]),
     ["supercomputer-mark", "rocket-wound-mark", "rocket-dodge-mark"].map(id => compile(getTrait(id).script).errors.length),
     getTrait("metallic-exoskeleton").naturalArmor, [oc.grantsGear, oc.grantsGearDC, oc.grantsGearIntegrated],
     read("module", "combat.mjs").includes('const nano = actor.getFlag?.("dbu-ttrpg", "nanoRevive");'),
     CH.includes('...onboardParts(actor, attack?.attackerUuid, "dodge")];'), CH.includes("const exoSoak = await exoskeletonSoak(target, own);"),
     CH.includes("    ...syntheticDice(attacker, attack),"), US.includes('await expiresAt(actor, "rocket-dodge-mark", "start-of-next-turn");'),
     US.includes('answers.earthlingCharge = [].concat(answers.earthlingCharge || [], "Signature Amplifier");'),
     read("module", "racial.mjs").includes('await (await import("./talents.mjs")).grantTalentGear(actor, item, { ...trait, grantsGear: otherGear.join(",") });')],
    [ids.map((id, i) => ["cybernetic-enhancement", "body", i + 6, 0]), [0, 0, 0], "Metal Exoskeleton", ["scouter", "master", true],
     true, true, true, true, true, true, true]);
}

// --- Mental Supercomputer (2): once a Round between the Analysis and the Hype - one limit for its printed effect --------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { reactiveFor } = await import(modUrl("effects/registry.mjs"));
  const ms = getTrait("mental-supercomputer");
  const holder = used => ({ items: [{ type: "racial", id: "MS", uuid: "A.MS", name: ms.name, flags: { "dbu-ttrpg": { sourceId: "mental-supercomputer" } },
    system: { script: ms.script } }], getFlag: () => null,
    system: { tierOfPower: 1, talentUses: { round: used, encounter: used }, armedTalents: [] } });
  const momentOf = entry => String(entry.program?.blocks?.[0]?.moment ?? "").split(/[(/]/)[0];
  const blocksOf = actor => reactiveFor(actor).filter(entry => ["analysis", "hype"].includes(momentOf(entry)));
  const fresh = blocksOf(holder([]));
  const analysis = fresh.find(entry => momentOf(entry) === "analysis");
  const spent = analysis ? blocksOf(holder([analysis.blockId])) : [];
  check("Mental Supercomputer (2): the Analysis' and the Hype's blocks, both open; one used this Round, neither is",
    [fresh.length, fresh.every(entry => entry.available), spent.length, spent.some(entry => entry.available)],
    [2, true, 2, false]);
}

// --- Racial Factor: Demon Clansman - Heart of Evil and its five Options -------------------------------------------------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const R = await import(modUrl("racial.mjs"));
  const CH = read("module", "chat.mjs");
  const he = getTrait("heart-of-evil");
  const options = R.racialOptionsOf("heart-of-evil").map(option => option.id);
  check("Demon Clansman: Any, 1, its Pure Evil Prerequisite said; Heart of Evil - Mind, one Option of five, their Races shown; compiling; the Steadfast Check and the Stress Test, the knock's Clash and its three, Sadistic's Ki, Resilient's Soak, Demonic God's Maneuver",
    [[getTrait("demon-clansman")?.requirement, Number(getTrait("demon-clansman")?.maximumFactor), /Pure Evil/.test(getTrait("demon-clansman")?.prerequisites ?? "")],
     [he.owner, he.category, Number(he.options), compile(he.script).errors.length], options,
     options.map(id => [getTrait(id)?.race ?? "", compile(getTrait(id).script).errors.length]),
     compile(getTrait("demonic-god-option").script).errors.length,
     CH.includes('const evil = await heartOfEvilAgainst(actor, "Steadfast Check");'), CH.includes('if (evil) parts.push({ label: "Heart of Evil", value: -evil });'),
     CH.includes('if (clash.impede.choose === "heart-of-evil") {'), CH.includes("if (opponent && combat) sadisticCondition(by, actor, key);"),
     CH.includes('(((target.system.effects?.slots?.["resilientDemon.soak"] === true) && conditioned(attacker))')],
    [["Any", 1, true], ["demon-clansman", "mind", 1, 0],
     ["sadistic-demon-lord", "resilient-demon-lord", "evil-saiyan-of-legend", "demonic-skills", "demonic-god"],
     [["", 0], ["", 0], ["saiyan", 0], ["namekian", 0], ["shinjin", 0]], 0, true, true, true, true, true]);
}

// --- Racial Factor: Undead - Undead Survival --------------------------------------------------------------------------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const us = getTrait("undead-survival");
  const CH = read("module", "chat.mjs"), RT = read("module", "effects", "moments-runtime.mjs");
  check("Undead: Any, 1, its Prerequisite said; Undead Survival - Body, compiling; Unnatural, Racial Life 2 lower and below zero; Steadfast 1; no Life from its own effects while Undying; a Healing Surge then Undying for the Encounter on the Defeated card; left at minus half",
    [[getTrait("undead")?.requirement, Number(getTrait("undead")?.maximumFactor), /not Unnatural/.test(getTrait("undead")?.prerequisites ?? "")],
     [us.owner, us.category, compile(us.script).errors.length],
     ["allow unnatural;", "racialLifeModifier -= 2;", "steadfast.dice += 1;", "[triggered/defeated, effect 4]"].every(text => us.script.includes(text)),
     read("module", "data", "actor-character.mjs").includes('if (this.effects?.slots?.["racialLife.mayGoNegative"] !== true) this.racialLifeModifier = Math.max(0, this.racialLifeModifier);'),
     RT.includes('if ((key === "life.value") && (actor.system.effects?.slots?.["undead.noTraitHealing"] === true)'),
     CH.includes('if (!await takeSurge(actor, { source: "Undead Survival", kind: "healing" })) return UNSPENT;'),
     CH.includes('await enterState(actor, "undying", 1, "encounter", "Undead Survival");'),
     read("module", "combat.mjs").includes("<= -Math.ceil((Number(actor.system.life?.max) || 0) / 2))) {")],
    [["Any", 1, true], ["undead", "body", 0], true, true, true, true, true, true]);
}

// --- Racial Factor: Unstable Clone - Bio-Berserker: the Field of Aggression counted from the scene ----------------------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const { opponentsWithin, SPHERE_RADIUS } = await import(modUrl("guidance.mjs"));
  const { resolvePath } = await import(modUrl("effects/amounts.mjs"));
  const bb = getTrait("bio-berserker");
  // A scene: me at (0,0); Opponents 3 and 4 Squares between away, an Ally beside me, a Defeated Opponent beside me.
  const realCanvas = globalThis.canvas;
  const scene = { id: "S", grid: { size: 100 } };
  const doc = x => ({ parent: scene, x: x * 100, y: 0, width: 1, height: 1 });
  // Allies by the Allies list (allies.mjs): mine names A.ally.
  const token = (uuid, x, allies = [], defeated = false) => {
    const document = doc(x);
    const actor = { documentName: "Actor", id: uuid, uuid, system: { defeated, allies }, getActiveTokens: () => [document] };
    return { actor, document };
  };
  const me = token("A.me", 0, ["A.ally"]), near = token("A.near", 4), far = token("A.far", 5), ally = token("A.ally", 1),
    down = token("A.down", 1, [], true);
  globalThis.canvas = { tokens: { placeables: [me, near, far, ally, down] }, grid: { size: 100 } };
  const inField = opponentsWithin(me.actor, SPHERE_RADIUS.large - 1).map(each => each.uuid);
  const counted = resolvePath("fieldOfAggression", { data: { parent: me.actor } });
  globalThis.canvas = realCanvas;
  const CH = read("module", "chat.mjs");
  check("Unstable Clone: Any, 1, its Prerequisite said; Bio-Berserker - Body, compiling; its Field a Large Sphere - 3 Squares between, Opponents standing only; the Exploit, the d10's Compelled, half the Damage Attribute; read again as tokens move",
    [[getTrait("unstable-clone")?.requirement, Number(getTrait("unstable-clone")?.maximumFactor), /Character Creation/.test(getTrait("unstable-clone")?.prerequisites ?? "")],
     [bb.owner, bb.category, compile(bb.script).errors.length], inField, counted,
     CH.includes("if (!noExploit && maneuver?.movement) bioBerserkerExploits(card, actor, maneuver);"),
     CH.includes('await markUntilNextTurn(actor, actor, "compelled", 1, "start", "Bio-Berserker");'),
     CH.includes('woundExtra = [...woundExtra, { label: "Bio-Berserker", value: half }];'),
     read("module", "dbu-ttrpg.mjs").includes('"chosen-rival", "bio-berserker", "from-the-stars",'),
     CH.includes("if ((away === null) || (away > SPHERE_RADIUS.large - 1)) continue;")],
    [["Any", 1, true], ["unstable-clone", "body", 0], ["A.near"], 1, true, true, true, true, true]);
}

// --- Racial Factor: Monster - Custom Monstrosity, Devil, Fairy, Genie, Ghost, Goblin ---------------------------------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const CH = read("module", "chat.mjs"), R = read("module", "racial.mjs");
  const ids = ["custom-monstrosity", "devil", "fairy", "genie", "ghost", "goblin"];
  // A choose: list's flags, as racial.mjs writes them in.
  const flagged = (id, value) => {
    const trait = getTrait(id);
    const values = String(trait.choices ?? "").split(",").map(each => each.trim().toLowerCase()).filter(Boolean);
    return values.reduce((text, each) => text.replaceAll(`$${each}`, (each === value) ? "1" : "0"), String(trait.script).replaceAll("$choice", value));
  };
  check("Monster: Earthling or Demon, 1; its first six - Body, in order, compiling; their Other Traits and Unique Ability; Devil's any-TP Unique Monstrosity, Ghost's Frequent Flyer, its Damage Categories; Fairy's boxes, Genie's quarter Surge, Goblin's Soak and drop",
    [getTrait("monster")?.requirement, ids.map((id, i) => [getTrait(id)?.owner, getTrait(id)?.category, Number(getTrait(id)?.order)]),
     [compile(flagged("custom-monstrosity", "soak")).errors.length, compile(flagged("fairy", "tiny")).errors.length,
      ...["devil", "genie", "ghost", "goblin"].map(id => compile(getTrait(id).script).errors.length)],
     [getTrait("custom-monstrosity").grantsOther, getTrait("devil").grantsOtherFrom, getTrait("devil").grantsUnique,
      getTrait("ghost").grantsTalentIfManeuver, getTrait("goblin").grantsOtherFrom],
     R.includes('&& (actor.system?.effects?.slots?.["devil.anyUnique"] === true))'), R.includes("made.grants.talents = [...(made.grants.talents ?? []), insteadTalent];"),
     CH.includes("return ghostCategory((steps && entry.own?.hit)"), CH.includes('...(fairy ? [{ name: "fairy", label: `Fairy: +${fairy}`, tip: "Once a Round." }] : []),'),
     CH.includes("const used = surge ? await useManeuver(actor, { ...surge, surgencyShare: 0.25 }, { outOfSequence: true }) : null;"),
     CH.includes("const damage = previous?.goblinDrop ? dealtDamage : await goblinDrop(target, dealtDamage);"),
     read("module", "data", "actor-character.mjs").includes('soakModifier: (((this.effects?.slots?.["goblin.soakAsLarge"] === true)')],
    ["Earthling or Demon", ids.map((id, i) => ["monster", "body", i + 1]), [0, 0, 0, 0, 0, 0],
     [["monstrous", "bestial"], ["winged-beast", "unique-monstrosity"], "magical-materialization", "soar=frequent-flyer", "unrelenting"],
     true, true, true, true, true, true, true]);
}

// --- Monster: Mummy, Plant Monster, Troll, Vampire - all ten; a granted Other Trait's Option and choice named, not asked ---------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const R = await import(modUrl("racial.mjs"));
  const ids = ["mummy", "plant-monster", "troll", "vampire"];
  // What they name is not asked - only Counter Elemental's own Vulnerability is, answered Fire here.
  const realDialog = globalThis.foundry.applications;
  let asked = 0;
  globalThis.foundry.applications = { api: { DialogV2: { wait: async () => { asked++; return "elementalFire"; }, confirm: async () => { asked++; return false; } } } };
  const thick = await R.racialItemFrom(getTrait("bestial-build"), null, { presetOption: "thick-hide" });
  const plant = await R.racialItemFrom(getTrait("elemental-assault"), null, { presetOption: "counter-elemental", presetChoice: "elementalPlantlife" });
  globalThis.foundry.applications = realDialog;
  const CH = read("module", "chat.mjs");
  check("Monster, the last four: Body, in order, compiling; their Other Traits with the Options and choices they name - made without asking; Mummy's Steadfast Undying, Troll's Punching Down and Power Up, Vampire's Surgency on Life and its Bite",
    [ids.map((id, i) => [getTrait(id)?.owner, Number(getTrait(id)?.order), compile(getTrait(id).script).errors.length]),
     [getTrait("troll").grantsOtherOptions, getTrait("vampire").grantsOtherOptions, getTrait("plant-monster").grantsOtherChoices],
     asked, (thick?.data?.system?.chosen ?? []).map(entry => entry.value),
     (plant?.data?.system?.chosen ?? []).map(entry => entry.value).sort(),
     getTrait("mummy").script.includes("steadfastEnter(0, undying, next-turn);"),
     CH.includes('(gap >= ((attacker.system?.effects?.slots?.["troll.punchDown"] === true) ? 1 : 2))'),
     read("module", "combat.mjs").includes('if ((!isCharacter(actor)) || (userId !== game.user.id) || options.dbuSurge || options.dbuVampire) return;'),
     CH.includes('await actor.update({ "system.life.value": value + restored }, { dbuSurge: true });'),
     CH.includes("if ((damage > 0) && own.hit && !isAbsoluteMiss(own) && armsUser && (armsUser.uuid !== target.uuid)) vampireBite(message, armsUser, target);")],
    [ids.map((id, i) => ["monster", i + 7, 0]), ["bestial-build=thick-hide", "fangs=savage", "elemental-assault=elementalPlantlife"],
     1, ["thick-hide"], ["counter-elemental", "elementalFire", "elementalPlantlife"], true, true, true, true, true]);
}

// --- Racial Factor: Machine Mutant - Mutant Core ------------------------------------------------------------------------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const mc = getTrait("mutant-core");
  const CH = read("module", "chat.mjs");
  check("Machine Mutant: Android, 1; Mutant Core - Body, Primary (Energy Core's place), compiling; its two Maneuvers; Healthy, a Damage Category down; the Corporeal its Racial Save too; Integrate - a tenth of the Ki, the Exploit in a Standard Sphere; destroy - the Power Up or a Surge, three an Encounter, Masterful Integration after",
    [[getTrait("machine-mutant")?.requirement, Number(getTrait("machine-mutant")?.maximumFactor)], [mc.owner, mc.category, mc.importance, compile(mc.script).errors.length],
     ["mutant-core-third-effect", "mutant-core-fourth-effect"].map(id => [getTrait(id)?.fromTrait, getTrait(id)?.type, compile(getTrait(id).script).errors.length]),
     CH.includes('if ((slots["mutantCore.healthy"] === true) && ((target.system.threshold?.key ?? "healthy") === "healthy")) next = resolveDamageCategory(next, -1);'),
     mc.script.includes("allow save.racial.corporeal;"),
     CH.includes("const back = Math.floor((Number(actor.system.ki?.max) || 0) / 10);"),
     CH.includes("if ((squaresBetween(token.document ?? token, from) ?? 99) > SPHERE_RADIUS.standard - 1) continue;"),
     read("module", "use-maneuver.mjs").includes('if (card && (maneuver.id === "mutant-core-third-effect")) (await import("./chat.mjs")).mutantCoreExploits(card, actor, maneuver);'),
     CH.includes('if (["weapon", "apparel"].includes(integratedKind(item))) await masterfulMove(actor, item);')],
    [["Android", 1], ["machine-mutant", "body", "primary", 0], [["mutant-core", "standard", 0], ["mutant-core", "instant", 0]],
     true, true, true, true, true, true]);
}

// --- Racial Factor: OG Soldier - Mimicry Program: Cyber Copies kept, three at most; Copy Being any number of times ----------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const { maneuverUsesLeft } = await import(modUrl("maneuvers.mjs"));
  const mp = getTrait("mimicry-program");
  const CH = read("module", "chat.mjs");
  // cyberCopy, cut out and run: three held, a fourth replacing the one picked.
  const from = CH.indexOf("export async function cyberCopy(");
  const body = CH.slice(from, CH.indexOf("\n}\n", from) + 2).replace("export ", "").replace(
    'const { UNSPENT } = await import("./effects/moments-runtime.mjs");', 'const UNSPENT = "unspent";');
  const cyberCopy = new Function("fromUuidSync", "SCOPE", "Handlebars", "foundry", "ui", `${body}\nreturn cyberCopy;`);
  let flags = { cyberCopies: [{ uuid: "A.a", name: "A" }, { uuid: "A.b", name: "B" }, { uuid: "A.c", name: "C" }] };
  const holder = { name: "Me", getFlag: (scope, key) => flags[key], setFlag: async (scope, key, value) => { flags[key] = value; } };
  const run = cyberCopy(uuid => ({ uuid, name: "D" }), "dbu-ttrpg", { escapeExpression: String },
    { applications: { api: { DialogV2: { wait: async () => ({ forms: "Super Saiyan", replace: 1 }) } } } }, { notifications: { info: () => {} } });
  await run(holder, { grappledUuid: "A.d" });
  const after = flags.cyberCopies.map(entry => entry.name);
  const copyBeing = { id: "u1", itemId: "u1", usageLimit: { amount: 1, per: "encounter" } };
  const actor = slots => ({ system: { usedManeuvers: ["encounter:u1"], effects: { slots } },
    items: { get: () => ({ system: { unique: { libraryId: "copy-being" } } }) } });
  check("OG Soldier: Android, 1; Mimicry Program - Body, Copy Being given, compiling; a Cyber Copy at the Grapple - three at most, one replaced, its Forms noted; Copy Being again with it, not without",
    [[getTrait("og-soldier")?.requirement, Number(getTrait("og-soldier")?.maximumFactor)], [mp.owner, mp.category, mp.grantsUnique, compile(mp.script).errors.length],
     after, flags.cyberCopies.at(-1)?.forms, maneuverUsesLeft(actor({ "mimicry.copyAny": true }), copyBeing), maneuverUsesLeft(actor({}), copyBeing),
     CH.includes('await answerFor(grappler, "grappling", { grappledUuid: grappled.uuid });')],
    [["Android", 1], ["og-soldier", "body", "copy-being", 0], ["A", "C", "D"], "Super Saiyan", Infinity, 0, true]);
}

// --- Racial Factor: Tamagami - Protector of the Dragon Ball; Honorbound (3) -----------------------------------------------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const { PREDICATES } = await import(modUrl("effects/conditions.mjs"));
  const pd = getTrait("protector-of-the-dragon-ball");
  const CH = read("module", "chat.mjs"), CB = read("module", "combat.mjs");
  const flagged = value => ["force", "magic"].reduce((text, each) => text.replaceAll(`$${each}`, (each === value) ? "1" : "0"), pd.script);
  // (6), run: the preUpdateActor hook cut out - 10 regained is 15, capped at the most.
  const from = CB.indexOf("  Hooks.on(\"preUpdateActor\", (actor, changes, options) => {\n    if ((!isCharacter(actor)) || options.dbuKiRaw");
  const hookBody = CB.slice(CB.indexOf("{", CB.indexOf("=> {", from)) + 1, CB.indexOf("\n  });", from));
  const hook = new Function("actor", "changes", "options", "foundry", hookBody);
  const keeper = (integrated, value, max) => ({ type: "character", system: { ki: { value, max }, effects: { slots: { "tamagami.kiHalf": true } } },
    items: [{ type: "gear", system: { gearId: "dragon-ball", integrated } }] });
  const run = (actor, written) => {
    const changes = { system: { ki: { value: written } } };
    hook(actor, changes, {}, globalThis.foundry);
    return changes.system.ki.value;
  };
  check("Tamagami: Android, 1; Protector of the Dragon Ball - Body, compiling, its two Maneuvers; Integrated - Wound and Soak 1(T), Ki regained half again; the Force or Magic and a Talent of the four; Defeated - Honorbound's Clash first, then it falls",
    [[getTrait("tamagami")?.requirement, Number(getTrait("tamagami")?.maximumFactor)], [pd.owner, pd.category, compile(flagged("magic")).errors.length],
     ["protector-first-effect", "protector-second-effect"].map(id => [getTrait(id)?.fromTrait, Number(getTrait(id)?.actionCost), compile(getTrait(id).script).errors.length]),
     PREDICATES.hasIntegratedDragonBall({ data: { parent: keeper(true, 0, 0) } }), PREDICATES.hasIntegratedDragonBall({ data: { parent: keeper(false, 0, 0) } }),
     [run(keeper(true, 10, 100), 20), run(keeper(true, 95, 100), 100), run(keeper(false, 10, 100), 20), run(keeper(true, 50, 100), 40)],
     pd.grantsTalentChoiceFrom, compile(getTrait("honorbound").script).errors.length,
     CB.includes('if (now) await (await import("./chat.mjs")).tamagamiDefeat(actor, options.dbuKnockedBy ?? "");'),
     CH.includes("if (offer.dragonBallGift) return takeDragonBall(message, actor, offer);"),
     CH.includes("if (whoWonClash(clash.result) === \"challenger\") return settledNote(message, `Honorbound: ${actor.name} keeps ${ball.name}.`);")],
    [["Android", 1], ["tamagami", "body", 0], [["protector-of-the-dragon-ball", 2, 0], ["protector-of-the-dragon-ball", 3, 0]],
     true, false, [25, 100, 20, 40], ["weapon", "magic-attack", "physical-attack", "energy-attack"], 0, true, true, true]);
}

// --- Racial Factor: Megath - Colossal Demon ------------------------------------------------------------------------------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const cd = getTrait("colossal-demon");
  const CH = read("module", "chat.mjs");
  // Which base Size wins where two are named: the larger.
  const sizes = ["nano", "tiny", "small", "medium", "large", "enormous", "gigantic", "colossal"];
  const pick = slots => sizes.filter(key => slots[`size.base.${key}`] === true).pop();
  check("Megath: Demon, 1, its Prerequisite said; Colossal Demon - Body, compiling; Racial Life 4; Colossal over Gigantic Demon's Gigantic; the Soak 1(T) a Size Category, a button of its own; Punching Down's dice again, asked",
    [[getTrait("megath")?.requirement, Number(getTrait("megath")?.maximumFactor), /Gigantic Demon/.test(getTrait("megath")?.prerequisites ?? "")],
     [cd.owner, cd.category, compile(cd.script).errors.length], cd.script.includes("racialLifeModifier += 4;"),
     pick({ "size.base.gigantic": true, "size.base.colossal": true }),
     read("module", "data", "actor-character.mjs").includes("const chosenSize = Object.keys(DBUCharacterData.SIZES).filter(key => this.effects?.slots?.[`size.base.${key}`] === true).pop()"),
     CH.includes('{ slot: "colossal.soak", flag: "colossalRound", name: "Colossal Demon", base: false }'),
     CH.includes("const punchingAgain = (punchingRoll && colossalAnswer) ? await punchingDownRoll(attacker) : 0;")],
    [["Demon", 1, true], ["megath", "body", 0], true, "colossal", true, true, true]);
}

// --- Racial Factor: Dragon Ball Hero - Switch to a Hero: the Avatar's pools shared, the switch and its undoing ------------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const sh = getTrait("switch-to-a-hero");
  const CH = read("module", "chat.mjs"), CB = read("module", "combat.mjs");
  // The mirror hook, cut out and run: the hero's Life and Ki written to the Avatar, capped at its most; nothing back for a mirrored write.
  const from = CB.indexOf("  Hooks.on(\"updateActor\", async (actor, changes, options) => {\n    if ((!isCharacter(actor)) || options.dbuMirror");
  const body = CB.slice(CB.indexOf("{", CB.indexOf("=> {", from)) + 1, CB.indexOf("\n  });", from)).replace(
    'const { heroAvatarOf } = await import("./chat.mjs");', "");
  const mirror = new Function("game", "foundry", "heroAvatarOf", `return (async (actor, changes, options) => {${body}});`);
  let written = null;
  const avatar = { id: "AV", type: "character", system: { life: { max: 50 }, ki: { max: 80 } }, update: async (data, opts) => { written = [data, opts]; } };
  const hero = { id: "HE", type: "character", system: { life: { value: 70 }, ki: { value: 30 } } };
  const gm = { users: { activeGM: "me" }, user: "me", actors: [hero, avatar] };
  const run = mirror(gm, globalThis.foundry, actor => (actor === hero ? avatar : null));
  await run(hero, { system: { life: { value: 70 }, ki: { value: 30 } } }, {});
  const first = written;
  written = null;
  await run(hero, { system: { life: { value: 70 } } }, { dbuMirror: true });
  check("Dragon Ball Hero: Earthling, 1, its Hero Switch Prerequisite said; Switch to a Hero - Body, its Avatar a Character chosen, compiling, its Maneuver; the pools written each to the other, capped, a mirrored write not mirrored back; the switch by the GM, undone as the Encounter ends; the Avatar's Transformation offered",
    [[getTrait("dragon-ball-hero")?.requirement, Number(getTrait("dragon-ball-hero")?.maximumFactor), /Hero Switch/.test(getTrait("dragon-ball-hero")?.prerequisites ?? "")],
     [sh.owner, sh.category, sh.choose, compile(sh.script).errors.length],
     [getTrait("switch-to-a-hero-second-effect")?.fromTrait, compile(getTrait("switch-to-a-hero-second-effect").script).errors.length],
     first?.[0], Boolean(first?.[1]?.dbuMirror && first?.[1]?.dbuKiRaw), written,
     CH.includes('case "heroSwitch": return heroSwitchGM(request.heroUuid, request.avatarUuid);'),
     CB.includes('await (await import("./chat.mjs")).heroSwitchEnds();'),
     CH.includes('maneuverName: "Transformation", reason: `Switch to a Hero - if ${actor.name} was in a Transformation (once an Encounter)`,')],
    [["Earthling", 1, true], ["dragon-ball-hero", "body", "character", 0], ["switch-to-a-hero", 0],
     { "system.life.value": 50, "system.ki.value": 30 }, true, null, true, true, true]);
}

// --- Racial Factor: Saiyan Ancestry - Dormant Saiya Power -------------------------------------------------------------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const dp = getTrait("dormant-saiya-power");
  const CH = read("module", "chat.mjs"), RT = read("module", "effects", "moments-runtime.mjs");
  check("Saiyan Ancestry: Earthling, 1; Dormant Saiya Power - Body, compiling, Warrior Blood (3); the Bruised Check passed without a roll, never failed with another; Defeated - a Steadfast Check at 2 off, Life to 1",
    [[getTrait("saiyan-ancestry")?.requirement, Number(getTrait("saiyan-ancestry")?.maximumFactor)],
     [dp.owner, dp.category, compile(dp.script).errors.length, dp.resource, Number(dp.resourceMax)],
     CH.includes('flavor: `Steadfast Check - ${THRESHOLDS.bruised.label} - passed automatically (Dormant Saiya Power)` });'),
     CH.includes('automatic = automatic.filter(key => key !== "bruised");'),
     dp.script.includes("steadfastEnter(-2, life);"),
     RT.includes('if (passed && (String(args[1]) === "life")) return actor.update({ "system.life.value": 1 });')],
    [["Earthling", 1], ["saiyan-ancestry", "body", 0, "warriorblood", 3], true, true, true, true]);
}

// --- Racial Factor: Triclops - Three-Eyes ---------------------------------------------------------------------------------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const te = getTrait("three-eyes");
  const CH = read("module", "chat.mjs");
  // (6), cut out and run: at 100 Maximum Life, from 20 to 9 - 1 below the Critical line - its Check passed, the Ki Surge asked for.
  const from = CH.indexOf("export async function threeEyesDrop(");
  const body = CH.slice(from, CH.indexOf("\n}\n", from) + 2).replace("export ", "")
    .replace('const { UNSPENT } = await import("./effects/moments-runtime.mjs");', 'const UNSPENT = "unspent";')
    .replace('const { useManeuver, definitionOf } = await import("./use-maneuver.mjs");', "");
  let written = null, surged = null;
  const drop = new Function("DBUCharacterData", "SCOPE", "ui", "getManeuver", "useManeuver", "definitionOf", `${body}\nreturn threeEyesDrop;`)(
    DBUCharacterData, "dbu-ttrpg", { notifications: { info: () => {} } }, () => ({ id: "surge" }), async (actor, maneuver) => { surged = maneuver.surgeKind; return true; }, item => item);
  const holder = value => ({ name: "T", items: [], system: { life: { value, max: 100 } }, update: async data => { written = data; } });
  await drop(holder(20));
  const first = [written, surged];
  written = null;
  const deep = await drop(holder(5));
  check("Triclops: Earthling, 1; Three-Eyes - Body, compiling; Signature Wound by the Thresholds; the first Diminishing Defense from each Opponent and the first of Offense none; Power - 4(bT) Ki; (6) Life 1 below the Critical line, its Check passed, a Ki Surge - not where it is lower already",
    [[getTrait("triclops")?.requirement, Number(getTrait("triclops")?.maximumFactor)], [te.owner, te.category, compile(te.script).errors.length],
     ["wound.signature += threshold.depth * 1(T);", "attacks.free += 1;", "ki.value += 4(bT);"].every(text => te.script.includes(text)),
     CH.includes('await requestActorUpdate(dodger, { [`flags.${SCOPE}.threeEyesDefense`]: { round: roundKey(), from: [...seenThisRound, attack.attackerUuid] } });'),
     first, [deep, written]],
    [["Earthling", 1], ["triclops", "body", 0], true, true,
     [{ "system.life.value": 9, "system.thresholdChecks.critical": "pass" }, "ki"], ["unspent", null]]);
}

// --- Racial Factor: Diluted Majin - Traces of Majin ------------------------------------------------------------------------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const tm = getTrait("traces-of-majin"), low = getTrait("low-dilution"), high = getTrait("highly-diluted");
  const CH = read("module", "chat.mjs");
  // (4), cut out and run: a Lethal hit at Tier 2 and 20 Ki - 8 and 16 offered; a Direct one - 8 alone; a Standard one, none.
  const from = CH.indexOf("function dilutedButtons(");
  const body = CH.slice(from, CH.indexOf("\n}\n", from) + 2);
  const run = category => {
    const offered = [];
    const target = { name: "M", isOwner: true, getFlag: () => null, system: { ki: { value: 20 }, baseTierOfPower: 2, effects: { slots: { "diluted.category": true } } } };
    const buttons = new Function("attackTargets", "fromUuidSync", "targetResult", "SCOPE", "roundKey", "cardButton", `${body}\nreturn dilutedButtons;`)(
      () => [{ uuid: "M" }], () => target, () => ({ hit: true, damageCategory: category }), "dbu-ttrpg", () => "r1", (container, label) => offered.push(label));
    buttons({}, { result: {}, attackerUuid: "A" }, {});
    return offered;
  };
  check("Diluted Majin: Majin, 1; Traces of Majin - Body, Primary, an Option, compiling; Racial Life +4, Soak per Threshold, Wound per Power; (4) 8(bT) Ki a step off a Lethal hit, two for 16, one off a Direct, none off a Standard - taken off where the Category is worked out; Low Dilution once a Round; Highly Diluted - Rubbery Body's stretch off, Signature Wound at 2+ Power",
    [[getTrait("diluted-majin")?.requirement, Number(getTrait("diluted-majin")?.maximumFactor)], [tm.owner, tm.category, tm.importance, Number(tm.options), compile(tm.script).errors.length],
     ["racialLifeModifier += 4;", "soakValue.perThreshold += 1(T);", "wound += power.stacks * 1(T);"].every(text => tm.script.includes(text)),
     run("lethal"), run("direct"), run("standard"),
     CH.includes("- (attack.diluted ?? []).filter(each => each.uuid === entry.uuid).reduce((sum, each) => sum + (Number(each.steps) || 0), 0);"),
     [low.optionOf, compile(low.script).errors.length, /\[triggered\/opponent-damage, 1\/round, effect 5\]/.test(low.script)],
     [high.optionOf, compile(high.script).errors.length, high.script.includes("meleeRange.stretch -= 3;"), high.script.includes("wound.signature += 2(T);")]],
    [["Majin", 1], ["diluted-majin", "body", "primary", 1, 0], true,
     ["Traces of Majin - 8 Ki", "Traces of Majin - 16 Ki"], ["Traces of Majin - 8 Ki"], [], true,
     ["traces-of-majin", 0, true], ["traces-of-majin", 0, true, true]]);
}

// --- Racial Factor: Primordial Majin - From Goop ---------------------------------------------------------------------------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const fg = getTrait("from-goop"), third = getTrait("from-goop-third-effect");
  const CH = read("module", "chat.mjs"), RT = read("module", "effects", "moments-runtime.mjs");
  // (5), cut out and run: asked and taken - counted; the third of a Round the last; a "keep" not counted; without it, never asked.
  const from = CH.indexOf("async function goopSplit(");
  const body = CH.slice(from, CH.indexOf("\n}\n", from) + 2);
  const run = (flag, answer, slot = true) => {
    let asked = false, written = null;
    const actor = { name: "G", system: { effects: { slots: slot ? { "fromGoop.goop": true } : {} } },
      getFlag: () => flag, setFlag: async (scope, key, value) => { written = value; } };
    const split = new Function("SCOPE", "roundKey", "askPlayerChoice", `${body}\nreturn goopSplit;`)(
      "dbu-ttrpg", () => "r1", async () => { asked = true; return answer; });
    return split(actor).then(result => [result, asked, written]);
  };
  check("Primordial Majin: Majin, 1, not a Minion; From Goop - Body, Primary, a Minion Talent asked, compiling; Surgency by Magic; (3) a Maneuver of 1 Action and 4(bT) Ki, once a Round; (4) 2(bT) a Threshold below on its Surge alone; (5) halved for a Goop three times a Round, asked; (7) the Surge",
    [[getTrait("primordial-majin")?.requirement, Number(getTrait("primordial-majin")?.maximumFactor), getTrait("primordial-majin")?.prerequisites],
     [fg.owner, fg.category, fg.importance, fg.grantsTalentChoiceFrom, compile(fg.script).errors.length],
     ["allow surgency.magic;", "surge(healing, 1, 0, 2);", "surge(healing);"].every(text => fg.script.includes(text)),
     [third?.fromTrait, Number(third?.actionCost), Number(third?.kiCostPerBaseTier), third?.usageLimit, third?.surgeKind],
     RT.includes("lifePerThresholdBT: Number(args[3]) || 0") && CH.includes("+ (Number(lifePerThresholdBT) || 0) * Math.max(1, Number(actor.system.baseTierOfPower) || 1));"),
     await run(null, "goop"), await run({ round: "r1", count: 2 }, "goop"), await run({ round: "r1", count: 3 }, "goop"),
     await run(null, "keep"), await run(null, "goop", false)],
    [["Majin", 1, "You are not a Minion"], ["primordial-majin", "body", "primary", "minion", 0], true,
     ["from-goop", 1, 4, "1/round", "healing"], true,
     [true, true, { round: "r1", count: 1 }], [true, true, { round: "r1", count: 3 }], [false, false, null],
     [false, true, null], [false, false, null]]);
}

// --- Racial Factor: Dark Vassal - Dragon-like -----------------------------------------------------------------------------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const { PREDICATES } = await import(modUrl("effects/conditions.mjs"));
  const dl = getTrait("dragon-like"), fury = getTrait("dragon-lords-fury"), rage = getTrait("dragon-lords-rage");
  const CH = read("module", "chat.mjs"), UA = read("module", "united-attack.mjs");
  // (1)'s count: the Bestial Traits it gave, still held - none, one, two; another Trait's not counted.
  const items = given => ({ data: { parent: { items: [{ type: "racial", id: "DL", flags: { "dbu-ttrpg": { sourceId: "dragon-like" } } },
    ...Array.from({ length: given }, (_, n) => ({ type: "racial", id: `B${n}`, flags: { "dbu-ttrpg": { sourceId: `b${n}`, grantedBy: "DL" } } })),
    { type: "racial", id: "X", flags: { "dbu-ttrpg": { sourceId: "x", grantedBy: "OTHER" } } }] } } });
  const at = PREDICATES?.grantedOthersAtLeast;
  check("Dark Vassal: Namekian, 1; Dragon-like - Body, two Bestial Traits offered, an Option, compiling; Racial Life 1 down for each it gave; Wound against the Studied; Fury - an Intervene with no Counter Action, Studied attacker, once a Round; Rage - a United Attack with no Action, a Studied Ally, once a Round",
    [[getTrait("dark-vassal")?.requirement, Number(getTrait("dark-vassal")?.maximumFactor)],
     [dl.owner, dl.category, dl.grantsOther, Number(dl.grantsOtherCount), Number(dl.options), compile(dl.script).errors.length],
     [0, 1, 2].map(n => [at?.(items(n), 1, "dragon-like"), at?.(items(n), 2, "dragon-like")]),
     CH.includes("...dragonLikeParts(attacker, target),"),
     [fury.optionOf, compile(fury.script).errors.length, rage.optionOf, compile(rage.script).errors.length],
     CH.includes("!syncFree && !furyFree && !markWall && !shinjinFree\n    && !await payCounter(actor, maneuver, maneuver.actionCost ?? 1)) return;")
       && CH.includes("isStudiedBy(actor, attack?.attackerUuid ?? \"\")"),
     UA.includes("const noAction = free || synced || raged || relied;") && UA.includes("(await import(\"./chat.mjs\")).isStudiedBy(joiner, leader.uuid);")],
    [["Namekian", 1], ["dark-vassal", "body", "bestial", 2, 1, 0], [[false, false], [true, false], [true, true]], true,
     ["dragon-like", 0, "dragon-like", 0], true, true]);
}

// --- Racial Factor: Feline Warrior - Combat Cat ---------------------------------------------------------------------------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const cc = getTrait("combat-cat");
  const CH = read("module", "chat.mjs"), UM = read("module", "use-maneuver.mjs");
  const cut = name => { const from = CH.indexOf(`function ${name}(`); return CH.slice(from, CH.indexOf("\n}\n", from) + 2); };
  // (2), cut out and run: the defender of a Might Clash an Opponent opened, 1(T) at Tier 3; its opener, an Ally's, a Save Clash - none.
  const clashOf = new Function("alliesOnScene", `${cut("combatCatClash")}\nreturn combatCatClash;`)(actor => (actor.ally ? [{ uuid: "AL" }] : []));
  const cat = (ally = false) => ({ uuid: "C", ally, system: { tierOfPower: 3, effects: { slots: { "combatCat.might": true } } } });
  const might = { category: "might", challengerUuid: "O", defenderUuid: "C" };
  // (4): Superior and a Technique - the Greater Dice once more; not Superior, or not a Technique - none.
  const diceOf = new Function(`${cut("combatCatDice")}\nreturn combatCatDice;`)();
  const holder = superior => ({ system: { states: { superior }, dice: { greater: { formula: "1d8" } }, effects: { slots: { "combatCat.greater": true } } } });
  check("Feline Warrior: Neko Majin, 1; Combat Cat - Mind, Secondary, compiling; Attacking Ki 1(T) off, twice below Injured; Wound and Soak with a Majin-Dama; (2) 1(T) defending a Might Clash an Opponent opened; (4) the Greater Dice again on a Superior Signature Technique; (5), (6) asked as it is declared - 1 Action or none, the Superior State for the attack or a Charge, left as it ends",
    [[getTrait("feline-warrior")?.requirement, Number(getTrait("feline-warrior")?.maximumFactor)], [cc.owner, cc.category, cc.importance, compile(cc.script).errors.length],
     ["attack.kiCost -= 1(T);", "if (majinDama.integrated > 0) {", "soakValue += 1(T);"].every(text => cc.script.includes(text)),
     [clashOf(cat(), might, "C"), clashOf(cat(), might, "O").length, clashOf(cat(), { ...might, challengerUuid: "AL" }, "C").length,
      clashOf(cat(true), { ...might, challengerUuid: "AL" }, "C").length, clashOf(cat(), { ...might, category: "save" }, "C").length],
     [diceOf(holder(1), { technique: {} }), diceOf(holder(0), { technique: {} }).length, diceOf(holder(1), {}).length],
     UM.includes('await actor.setFlag("dbu-ttrpg", "combatCatSuperiorAttack", true);') && UM.includes("+ (answers.combatCatAction ?? 0);")
       && CH.includes('for (const flag of ["saiyanSuperiorAttack", "combatCatSuperiorAttack"]) {')],
    [["Neko Majin", 1], ["feline-warrior", "mind", "secondary", 0], true,
     [[{ label: "Combat Cat", written: "+1(T)", value: 3 }], 0, 1, 0, 0], [[{ label: "Combat Cat", formula: "1d8" }], 0, 0], true]);
}

// --- Racial Factor: Usagi Majin - Greedy Rabbit ---------------------------------------------------------------------------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const { activePool, integratedRoom } = await import(modUrl("integrated.mjs"));
  const { accessoriesInEffect } = await import(modUrl("gear.mjs"));
  const gr = getTrait("greedy-rabbit"), sixth = getTrait("greedy-rabbit-sixth-effect");
  const CH = read("module", "chat.mjs"), AC = read("module", "data", "actor-character.mjs");
  // (4): two Majin-Damas Active beside one other Accessory - a third not, a second other Accessory not; without it, one Accessory in all.
  const dama = (id, on) => ({ id, type: "gear", system: { gearId: "majin-dama", itemType: "accessory", integrated: true, equipped: on } });
  const other = (id, on) => ({ id, type: "gear", system: { gearId: `ring-${id}`, itemType: "accessory", integrated: true, equipped: on } });
  const rabbit = { id: "R", type: "racial", flags: { "dbu-ttrpg": { sourceId: "greedy-rabbit" } } };
  const withIt = [rabbit, dama("D1", true), other("O1", true), dama("D2", false), dama("D3", false), other("O2", false)];
  const without = withIt.filter(item => item !== rabbit);
  const twoOn = withIt.map(item => (item.id === "D2" ? dama("D2", true) : item));
  check("Usagi Majin: Neko Majin, 1; Greedy Rabbit - Body, Secondary, Bestial Build and Land-Based Beast granted, compiling; Life per Level and Speed, Defense by the Majin-Damas; (4) two Active beside one other Accessory, each one's effects; (5) 2(bT) each, 10(bT) at most; (6) its Maneuver - a Clash (Cognitive/Morale), won, Sleeping",
    [[getTrait("usagi-majin")?.requirement, Number(getTrait("usagi-majin")?.maximumFactor)],
     [gr.owner, gr.category, gr.importance, gr.grantsOther, Number(gr.grantsOtherCount), gr.grantsOtherFrom, compile(gr.script).errors.length],
     ["life.perLevel += majinDama.integrated;", "speed.all += majinDama.active * 1(T);", "ki.value += min(majinDama.integrated, 5) * 2(bT);"].every(text => gr.script.includes(text)),
     AC.includes("this.majinDama = { integrated: damas.length, active: damas.filter(item => item.system?.equipped).length };"),
     [integratedRoom(withIt, withIt[3]), integratedRoom(twoOn, dama("D3", false)), integratedRoom(withIt, withIt[5]), integratedRoom(without, without[2]),
      activePool(twoOn, dama("D3", false)).active.map(item => item.id)],
     [accessoriesInEffect(twoOn).filter(item => item.system.gearId === "majin-dama").length,
      accessoriesInEffect(twoOn.filter(item => item !== rabbit)).filter(item => item.system.gearId === "majin-dama").length],
     [sixth?.fromTrait, sixth?.type, sixth?.usageLimit, compile(sixth.script).errors.length],
     CH.includes('saves: ["cognitive", "morale"],') && CH.includes('if (await gainCondition(target, "sleeping", 1) === false) return;')],
    [["Neko Majin", 1], ["usagi-majin", "body", "secondary", "bestial", 2, ["bestial-build", "land-based-beast"], 0], true, true,
     [true, false, false, false, ["D1", "D2"]], [2, 1], ["greedy-rabbit", "outOfSequence", "1/encounter", 0], true]);
}

// --- Racial Factor: Alternate Universe Saiyan - Alternative Warrior Race --------------------------------------------------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const aw = getTrait("alternative-warrior-race");
  const CH = read("module", "chat.mjs");
  // (4)'s door, cut out and run: Bruised, unused - open; Healthy, used, an Ally's, a wager past half the Capacity, 3 Charges - shut.
  const from = CH.indexOf("function altWarriorOpen(");
  const open = new Function("SCOPE", "game", "alliesOnScene", `${CH.slice(from, CH.indexOf("\n}\n", from) + 2)}\nreturn altWarriorOpen;`)(
    "dbu-ttrpg", { combat: { id: "E1" } }, actor => (actor.allyOf ? [{ uuid: actor.allyOf }] : []));
  const saiyan = ({ key = "bruised", used = null, allyOf = null } = {}) => ({ uuid: "S", allyOf, getFlag: () => used,
    system: { threshold: { key }, effects: { slots: { "altWarrior.escape": true } } } });
  const attacker = { uuid: "A", system: { capacity: { max: 40 } } };
  check("Alternate Universe Saiyan: Saiyan, 1, its Tailless Prerequisite said; Alternative Warrior Race - Body, Secondary, compiling; Stress at 4 Battle Born, Strike and Dodge at 6, Extra Dice up at 2 Power; (4) open Bruised or worse, once an Encounter, at an Opponent, not past half the Capacity in Ki nor 3 Charges - then Strike or Dodge against the Strike, before the Wound",
    [[getTrait("alternate-universe-saiyan")?.requirement, Number(getTrait("alternate-universe-saiyan")?.maximumFactor), /Tailless/.test(getTrait("alternate-universe-saiyan")?.prerequisites ?? "")],
     [aw.owner, aw.category, aw.importance, compile(aw.script).errors.length],
     ["stressBonus += 1;", "dodge += 1(T);", "dice.extra.category += 1;"].every(text => aw.script.includes(text)),
     [open(saiyan(), attacker, { kiWager: 20 }), open(saiyan({ key: "critical" }), attacker, { energyCharges: 2 }),
      open(saiyan({ key: "healthy" }), attacker, {}), open(saiyan({ used: "E1" }), attacker, {}), open(saiyan({ allyOf: "A" }), attacker, {}),
      open(saiyan(), attacker, { kiWager: 21 }), open(saiyan(), attacker, { energyCharges: 3 })],
     CH.includes("altWarrior: (hit && !automatic && altWarriorOpen(target, attacker, attack)) ? \"offered\" : null,")
       && CH.includes("if (!result.wound && altWarriorButtons(message, container, attack)) return;")
       && CH.includes('await runVerbNamed(target, "gainOneOf", ["battlebornstrike", "battleborndodge", "battlebornwound"]);')],
    [["Saiyan", 1, true], ["alternate-universe-saiyan", "body", "secondary", 0], true,
     [true, true, false, false, false, false, false], true]);
}

// --- Racial Factor: Disguised Dragon - Disguised Shadow -------------------------------------------------------------------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const { traitAside } = await import(modUrl("aside.mjs"));
  const ds = getTrait("disguised-shadow");
  const CH = read("module", "chat.mjs"), NK = getTrait("negative-ki");
  // (2): Personified Dragon Ball's Bestial Trait aside with it held; another Bestial Trait, or without it, not.
  const pdb = { id: "P", type: "racial", flags: { "dbu-ttrpg": { sourceId: "personified-dragon-ball" } } };
  const shadow = { id: "D", type: "racial", flags: { "dbu-ttrpg": { sourceId: "disguised-shadow" } } };
  const beast = { id: "B", type: "racial", system: { other: "bestial" }, flags: { "dbu-ttrpg": { sourceId: "winged-beast", grantedBy: "P" } } };
  const own = { id: "O", type: "racial", system: { other: "bestial" }, flags: { "dbu-ttrpg": { sourceId: "land-based-beast" } } };
  // (4), cut out and run: at an Impaired Opponent in a Save or Might Clash, 1(T); not Impaired, an Ally, a Combat Roll Clash - none.
  const from = CH.indexOf("function disguisedClash(");
  const people = { O: { uuid: "O", system: { conditions: { impaired: 1 } } }, N: { uuid: "N", system: { conditions: {} } }, AL: { uuid: "AL", system: { conditions: { impaired: 1 } } } };
  const clashOf = new Function("fromUuidSync", "alliesOnScene", `${CH.slice(from, CH.indexOf("\n}\n", from) + 2)}\nreturn disguisedClash;`)(
    uuid => people[uuid] ?? null, () => [{ uuid: "AL" }]);
  const me = { uuid: "M", system: { tierOfPower: 2, effects: { slots: { "disguised.vsImpaired": true } } } };
  check("Disguised Dragon: Shadow Dragon, 1; Disguised Shadow - Body, Secondary, compiling; (2) Personified Dragon Ball's Bestial Trait aside; (3) Negative Ki (4) twice in the Normal State; (4) 1(T) in a Save or Might Clash at an Impaired Opponent; (5) Draconic Physique (3)'s, Hazy's Bog too",
    [[getTrait("disguised-dragon")?.requirement, Number(getTrait("disguised-dragon")?.maximumFactor)], [ds.owner, ds.category, ds.importance, compile(ds.script).errors.length],
     [traitAside(beast, [pdb, shadow, beast, own]), traitAside(own, [pdb, shadow, beast, own]), traitAside(beast, [pdb, beast, own])],
     [compile(NK.script).errors.length, NK.script.includes('if (holdsTrait("disguised-shadow") && normalState) {')],
     [clashOf(me, { category: "save", challengerUuid: "M", defenderUuid: "O" }, "M"), clashOf(me, { category: "might", challengerUuid: "O", defenderUuid: "M" }, "M").length,
      clashOf(me, { category: "save", challengerUuid: "M", defenderUuid: "N" }, "M").length, clashOf(me, { category: "might", challengerUuid: "M", defenderUuid: "AL" }, "M").length,
      clashOf(me, { category: "strike", challengerUuid: "M", defenderUuid: "O" }, "M").length],
     ["allow draconic.exploitWound;", "requires optionChosen(\"regenerative-dragon\") && hasResource(\"dragonslime\");", "impairKnocked();"].every(text => ds.script.includes(text))
       && read("module", "effects", "registry.mjs").includes('["draconic-physique", "disguised-shadow"].includes(')],
    [["Shadow Dragon", 1], ["disguised-dragon", "body", "secondary", 0], ["disguised", "", ""], [0, true],
     [[{ label: "Disguised Shadow (Impaired)", written: "+1(T)", value: 2 }], 1, 0, 0, 0], true]);
}

// --- Racial Factor: Inverted Shadow - Dragon of Light ---------------------------------------------------------------------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const dl = getTrait("dragon-of-light");
  const CH = read("module", "chat.mjs"), SH = read("module", "sheets", "actor-character-sheet.mjs"), MO = read("module", "effects", "moments.mjs");
  // (3), cut out and run: an Ally not at Long Range with a stack - offered; none held - shown, not open; at Long Range, the roller
  // themselves, a Clash - none.
  const from = CH.indexOf("function lightOptions(");
  const optionsOf = (allies, far = false) => new Function("LIGHT", "alliesOnScene", "atLongRange", `${CH.slice(from, CH.indexOf("\n}\n", from) + 2)}\nreturn lightOptions;`)(
    "dragon-of-light", () => allies, () => far);
  const holder = stacks => ({ uuid: "H", name: "Light", system: { resources: { negativeenergy: { stacks } }, effects: { slots: { "light.allyNatural": true } } } });
  const roller = { uuid: "R" };
  const situation = { actor: roller, kind: "attack", side: { natural: 6 } };
  check("Inverted Shadow: Shadow Dragon, 1; Dragon of Light - Body, Secondary, compiling; Positive Energy as the Negative Energy, named so; (2) Ki for Negative Ki (1); (3) an Ally's roll +1 Natural, a stack; (4) 1(bT) Life each gained; (5) its Critical or an Ally's, once a Round; (6) an Ally about to be Defeated - all of it, 2(bT) each",
    [[getTrait("inverted-shadow")?.requirement, Number(getTrait("inverted-shadow")?.maximumFactor)], [dl.owner, dl.category, dl.importance, compile(dl.script).errors.length],
     SH.includes('const name = ((key === "negativeenergy") && Array.from(system.parent?.items ?? []).some(item => (item.type === "racial")'),
     CH.includes('...steps(kiMost).map(n => ({ value: `ki:${n}`, label: `${n * step} Ki Points: ${n} ${energy}` }))]);'),
     [optionsOf([holder(2)])(situation).map(option => [option.key, option.available]), optionsOf([holder(0)])(situation).map(option => option.available),
      optionsOf([holder(2)], true)(situation).length, optionsOf([{ ...holder(2), uuid: "R" }])(situation).length,
      optionsOf([holder(2)])({ ...situation, kind: "clash" }).length],
     ["life.value += gained * 1(bT);", "[triggered/ally-critical-scored, 1/round, effect 5]", "[triggered/critical-scored, 1/round, effect 5]"].every(text => dl.script.includes(text)),
     MO.includes('key: "ally-critical-scored"') && CH.includes('await answerFor(ally, "ally-critical-scored", {});'),
     CH.includes("const damage = (own.hit && !isAbsoluteMiss(own) && (shielded > 0)) ? await lightRescue(target, shielded) : shielded;")
       && CH.includes('for (const holder of alliesWithin(target, "light.rescue", SPHERE_RADIUS.large - 1)) {')],
    [["Shadow Dragon", 1], ["inverted-shadow", "body", "secondary", 0], true, true,
     [[["dragon-of-light:H", true]], [false], 0, 0, 0], true, true, true]);
}

// --- The Absorb Maneuver, the Absorption Awakening's stack, Natural Dragon --------------------------------------------------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const { PREDICATES } = await import(modUrl("effects/conditions.mjs"));
  const ab = getTrait("absorb"), mark = getTrait("absorption-awakening"), nd = getTrait("natural-dragon");
  const CH = read("module", "chat.mjs"), UM = read("module", "use-maneuver.mjs");
  const big = (flag, stacks) => PREDICATES.absorbedGigantic({ data: { parent: { flags: { "dbu-ttrpg": { absorbedGigantic: flag } } },
    conditions: { "absorption-awakening": stacks } } });
  check("Absorb: Standard, 2 Actions, 2/Round, Special, lost - the Exploit; its door (Non-Minion, Melee Range); won, a Clash (Corporeal) - lost Shaken till the end of their next turn, won removed and a stack of the Absorption Awakening; Natural Dragon: the Maneuver in the Ball Form, Combat Rolls with a stack, the Ball Form left; Soak and Wound, Gigantic where chosen",
    [[ab.type, Number(ab.actionCost), ab.usageLimit, ab.special, ab.exploitOnLoss, compile(ab.script).errors.length],
     [mark.kind, mark.combatCondition, compile(mark.script).errors.length],
     UM.includes('if (maneuver.id === "absorb") {') && UM.includes("Minion: the Absorb Maneuver is not theirs."),
     CH.includes('offerExploitTo(message, target, goop ?? actor, `${clash.maneuverName} - the Clash was lost`, "absorb");')
       && CH.includes('return postSaveClash(actor, target, { maneuverName: "Absorb", saves: ["corporeal"],')
       && CH.includes('await lasting(target, { kind: KINDS.CONDITION, key: "shaken", edge: EDGES.END, next: true, on: target.uuid, source: "Absorb" });')
       && CH.includes('await setCondition(actor, "absorption-awakening", (Number(actor.system.conditions?.["absorption-awakening"]) || 0) + 1);')
       && CH.includes("await removeFromEncounter(target);"),
     [compile(nd.script).errors.length, nd.script.includes("allow maneuver.absorb;"), nd.script.includes("combatRolls += 1(T);")],
     ["draconic-physique", "disguised-shadow"].map(id => [compile(getTrait(id).script).errors.length, getTrait(id).script.includes("allow size.base.gigantic;")]),
     [big(true, 1), big(true, 0), big(false, 2)]],
    [["standard", 2, "2/round", true, true, 0], ["conditions", false, 0], true, true, [0, true, true], [[0, true], [0, true]], [true, false, false]]);
}

// --- Refresh talents: those with no source -----------------------------------------------------------------------------------------
{
  const { orphanTalents } = await import(modUrl("talents.mjs"));
  const TP = read("templates", "parts", "actor-settings.hbs"), SH = read("module", "sheets", "actor-character-sheet.mjs");
  const talent = (id, flags) => ({ id, type: "talent", flags: { "dbu-ttrpg": { sourceId: id, ...flags } } });
  const trait = { id: "T1", type: "racial", flags: { "dbu-ttrpg": { sourceId: "majin-see" } } };
  check("Refresh talents: a button for whoever may edit (Settings' Debug, the user's 2026-11-27); the Progression tab's and a held Racial Trait's kept (by its file or an older Item id); one from neither, or from a Trait no longer held, named to go; not a Talent, left alone",
    [TP.includes('data-action="refreshTalents"'), SH.includes("refreshTalents: DBUCharacterSheet._onRefreshTalents,"),
     orphanTalents([talent("a", { fromProgression: true }), talent("b", { fromTrait: "majin-see" }), talent("c", {}),
       talent("d", { fromTrait: "lingering-power" }), talent("e", { fromTrait: "T1" }), trait]).map(item => item.id)],
    [true, true, ["c", "d"]]);
}

// --- The Talent Addition row's list, typed into ------------------------------------------------------------------------------------
{
  const PR = read("templates", "parts", "actor-progression.hbs"), SH = read("module", "sheets", "actor-character-sheet.mjs");
  const CSS = read("styles", "dbu-ttrpg.css");
  const cell = PR.slice(PR.indexOf("{{#if row.isTalentAddition}}"), PR.indexOf("{{else}}", PR.indexOf("{{#if row.isTalentAddition}}")));
  check("Talent list typed into: the row's value a hidden field, the box unnamed, every Talent an option by Category, None first; bound on render, a pick submitting the field, the box's own change kept from the form; the old search box gone",
    [cell.includes('<input type="hidden" name="system.progression.{{row.index}}.talent" value="{{row.entry.talent}}"/>'),
     /<input type="text" class="dbu-combo-input"(?![^>]*name=)/.test(cell), cell.includes('data-value="{{option.value}}"'),
     cell.indexOf("dbu-combo-none") < cell.indexOf("{{#each row.talentGroups"), !cell.includes("<select"),
     SH.includes('for (const combo of this.element.querySelectorAll("[data-combo]")) DBUCharacterSheet.#bindCombo(combo);'),
     SH.includes('field.dispatchEvent(new Event("change", { bubbles: true }));'),
     SH.includes('box.addEventListener("change", event => event.stopPropagation());'),
     !SH.includes("data-talent-search") && !PR.includes("data-talent-search") && !CSS.includes("dbu-talent-search"),
     CSS.includes(".dbu-ttrpg .dbu-combo.up .dbu-combo-list {")],
    [true, true, true, true, true, true, true, true, true, true]);
}

// --- The Progression tab's Benefits: Attribute Additions and Skill Improvements in windows of toggles ------------------------------
{
  const SH = read("module", "sheets", "actor-character-sheet.mjs"), PR = read("templates", "parts", "actor-progression.hbs");
  // The cell's two builders, cut out and run as functions.
  const cut = name => {
    const from = SH.indexOf(`  static #${name}(`);
    const body = SH.slice(from, SH.indexOf("\n  }\n", from) + 4).replace(`static #${name}(`, `function ${name}(`);
    return body.replaceAll("DBUCharacterSheet.#attributeName(", "attributeName(");
  };
  const lib = new Function("DBUCharacterData", `${cut("attributeName")}\n${cut("attributeBenefit")}\n${cut("skillBenefit")}\n`
    + "return { attributeBenefit, skillBenefit };")(DBUCharacterData);
  const zero = Object.fromEntries(Object.keys(DBUCharacterData.ATTRIBUTE_ABBREVIATIONS).map(key => [key, 0]));
  const scores = { agility: 7, force: 8, tenacity: 6, scholarship: 3, insight: 5, magic: 7, personality: 4 };
  const two = lib.attributeBenefit({ lvl: 2, attributes: { ...zero, agility: 1, force: 1 } }, scores);
  const pair = lib.attributeBenefit({ lvl: 5, attributes: { ...zero, magic: 2 } }, scores);
  const none = lib.attributeBenefit({ lvl: 3, attributes: zero }, scores);
  const { SKILLS } = DBUCharacterData;
  const first = lib.skillBenefit({ lvl: 1, choice: "Skill Improvement", stepType: "skill1", locked: true,
    skillRanks: ["acrobatics", "perception", "perception", "stealth", "", ""] }, { perception: 1 }, SKILLS);
  const later = lib.skillBenefit({ lvl: 3, choice: "Skill Improvement", skillRanks: ["flight", "survival", "", ""] }, {}, SKILLS);
  check("Benefits: the column named so, the seven Attribute columns and the Skill Ranks one gone, TP kept; every row's points and slots hidden; an Attribute Addition said \"+1 Agility, +1 Force\" or \"+2 Magic\", over the cap where a Score passes it; a Skill Improvement by name, \"+2 Perception\" doubled, the Ranks left, over the Rank cap",
    [[PR.includes("<th>Benefits</th>"), PR.includes("<th>TP</th>"), !PR.includes("attr-input"), !PR.includes("skill-ranks-cell"),
      PR.includes('data-benefit-attribute="{{field.key}}"'), PR.includes("data-benefit-skill")],
     [two.label, two.over, JSON.parse(two.data).picks, JSON.parse(two.data).cap], [pair.label, pair.over, JSON.parse(pair.data).cap],
     [none.label, JSON.parse(none.data).picks],
     [first.label, first.over, first.left], [later.label, later.left, later.over, JSON.parse(later.data).slots],
     SH.includes('for (const button of this.element.querySelectorAll("[data-benefit]")) {')
       && SH.includes('changed[0]?.dispatchEvent(new Event("change", { bubbles: true }));')],
    [[true, true, true, true, true, true],
     ["+1 Agility, +1 Force", true, ["agility", "force"], 8], ["+2 Magic", false, 11], ["", []],
     ["Acrobatics, Stealth, +2 Perception", true, 2], ["Flight, Survival", 2, false, 4], true]);
}

// --- The race's Skill Ranks in the Skill Improvement's window -----------------------------------------------------------------------
{
  const SH = read("module", "sheets", "actor-character-sheet.mjs"), PR = read("templates", "parts", "actor-progression.hbs");
  const racial = PR.slice(PR.indexOf('<span class="racial-row-label">Skill Ranks</span>'), PR.indexOf("</section>", PR.indexOf('<span class="racial-row-label">Skill Ranks</span>')));
  check("Racial Skill Ranks: the slots hidden under one Benefits button (no select), scoped for the window; its data one each at the Tier 1 cap, no pair, the table's overflow red; the window titled by it and scoped to it",
    [racial.includes('<input type="hidden" name="{{slot.name}}" value="{{slot.value}}" data-benefit-skill/>'), !racial.includes("<select"),
     racial.includes("data-benefit-scope") && racial.includes('data-benefit-data="{{racialSkillBenefit.data}}"'),
     SH.includes('data: JSON.stringify({ title: "Racial Skill Ranks", cap, slots, pairs: 0, before: {}, picks, overflow })'),
     SH.includes('const cell = button.closest("[data-benefit-scope]");'), SH.includes('title.textContent = data.title ?? "Skill Improvement";'),
     SH.includes("|| (data.overflow ?? []).includes(key);"), PR.includes('<td class="benefit-cell" data-benefit-scope>')],
    [true, true, true, true, true, true, true, true]);
}

// --- Character Perks: the table's Choices without a Level, from any source ------------------------------------------------------
{
  const { progressionTalentIds } = await import(modUrl("talents.mjs"));
  const DM = read("module", "data", "actor-character.mjs"), SH = read("module", "sheets", "actor-character-sheet.mjs");
  const PR = read("templates", "parts", "actor-progression.hbs"), MAIN = read("module", "dbu-ttrpg.mjs"), TA = read("module", "talents.mjs");
  const system = { powerLevel: 2,
    progression: [{ lvl: 1, choice: "Talent Addition", talent: "roomy-biology" }, { lvl: 5, choice: "Talent Addition", talent: "late" }],
    characterPerks: [{ choice: "Talent Addition", talent: "focused-strike" }, { choice: "Skill Improvement", talent: "stale" },
      { choice: "Talent Addition", talent: "" }, { choice: "Talent Addition", talent: "later", lvl: 4 },
      { choice: "Talent Addition", talent: "artful-strike", lvl: 2 }] };
  const perks = [{ choice: "Attribute Addition" }, { choice: "Skill Improvement" }, { choice: "Attribute Addition", lvl: 3 }];
  check("Character Perks: a list of their own (source, Choice, the seven points, TP, four Rank slots); the Scores, Ranks, TP and Talents count them with no Level; the list under the table - add above the first, a cross to take one off, Source on hover, TP written; its Choice changed clears what it held and sets its TP; the window says the Level it is measured at",
    [DM.includes("schema.characterPerks = new fields.ArrayField("),
     DBUCharacterData.perksOf(perks, "Attribute Addition", 2).length, DBUCharacterData.perksOf(perks, "Attribute Addition", 3).length,
     DBUCharacterData.perksOf(undefined, "Skill Improvement", 2).length, DBUCharacterData.perksOf(perks, "", 2).length,
     progressionTalentIds(system),
     DM.includes('+ DBUCharacterData.perksOf(this.characterPerks, "Attribute Addition", this.powerLevel)')
       && (DM.match(/DBUCharacterData\.perksOf\(this\.characterPerks, "Skill Improvement", this\.powerLevel\)\.flatMap\(perk => perk\.skillRanks \?\? \[\]\)/g) ?? []).length === 2
       && DM.includes('+ DBUCharacterData.perksOf(this.characterPerks, "", this.powerLevel)'),
     PR.includes('name="system.characterPerks.{{perk.index}}.lvl" value="{{perk.lvl}}"') && PR.indexOf("<th>Source</th>") < PR.indexOf("<th>Level</th>", PR.indexOf("<th>Source</th>"))
       && SH.includes('perks.push({ source: "", lvl: Number(this.actor.system.powerLevel) || 1,'),
     TA.includes("...(actor.system.characterPerks ?? [])]") && MAIN.includes('("characterPerks" in changes.system)'),
     PR.indexOf('data-action="addPerk"') < PR.indexOf('<table class="progression-table perk-table">'),
     PR.includes('data-action="removePerk" data-index="{{perk.index}}"'), PR.includes('{{#if perk.entry.source}}data-tooltip="{{perk.entry.source}}"{{/if}}'),
     PR.includes('name="system.characterPerks.{{perk.index}}.technique"'),
     SH.includes('if (tp) tp.value = String((select.value === "Skill Improvement") ? DBUCharacterData.SKILL_IMPROVEMENT_TP : 0);'),
     SH.includes('const levelText = () => (data.lvl ? `${data.perk ? "Character Perk'),
     SH.includes("addPerk: DBUCharacterSheet._onAddPerk,") && SH.includes("removePerk: DBUCharacterSheet._onRemovePerk,")],
    [true, 1, 2, 0, 2, ["roomy-biology", "focused-strike", "artful-strike"], true, true, true, true, true, true, true, true, true, true]);
}

// --- The Progression tables' widths: set by their columns, Benefits on one line -----------------------------------------------------
{
  const PR = read("templates", "parts", "actor-progression.hbs"), CSS = read("styles", "dbu-ttrpg.css");
  check("Progression widths: every table fixed, their columns sized by a colgroup (Benefits the rest); a Benefits button one line, its text cut short and whole on hover, the counts beside it; no min-width stretching a column",
    [CSS.includes("  table-layout: fixed;"), (PR.match(/<colgroup>/g) ?? []).length, (PR.match(/<span class="benefit-text">/g) ?? []).length,
     (PR.match(/data-tooltip="\{\{(racialSkillBenefit|row\.benefit|perk\.benefit)\.label\}\}"/g) ?? []).length,
     CSS.includes(".dbu-ttrpg .benefit-pick .benefit-text {\n  flex: 1 1 auto;\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;"),
     !CSS.includes(".dbu-ttrpg .progression-table select {\n  width: 100%;\n  min-width: 130px;") && !CSS.includes(".dbu-ttrpg .dbu-combo {\n  position: relative;\n  min-width: 130px;") && !CSS.includes(".benefit-cell {\n  min-width: 200px;")],
    // Three colgroups: the Power Level table, the Character Perks, and the one row above them lined up with the first.
    // Five Benefits buttons: the Racial Grants' Skill Ranks, Racial Trait picks and Set Racial Options (2026-11-27), a row's, a Perk's.
    [true, 3, 5, 3, true, true]);
}

// --- Trait files read a few at a time, one failing asked for again ------------------------------------------------------------------
{
  const { loadTraits, getTrait, traitsOfKind } = await import(modUrl("effects/traits.mjs"));
  const before = ["races", "talents", "unique", "maneuvers", "factors"].map(kind => traitsOfKind(kind).length);
  const original = globalThis.fetch;
  let open = 0, most = 0, calls = 0, failedOnce = false;
  globalThis.fetch = async (url, ...rest) => {
    calls++;
    open++;
    most = Math.max(most, open);
    try {
      // The first ask for Mind Reading fails, as the browser's limit made it.
      if (!failedOnce && String(url).endsWith("unique/mind-reading.dbu")) {
        failedOnce = true;
        throw new TypeError("Failed to fetch");
      }
      await new Promise(resolve => setTimeout(resolve, 0));
      return await original(url, ...rest);
    }
    finally {
      open--;
    }
  };
  const errors = [];
  const consoleError = console.error;
  console.error = (...args) => errors.push(String(args[0]));
  try {
    await loadTraits();
  }
  finally {
    globalThis.fetch = original;
    console.error = consoleError;
  }
  const after = ["races", "talents", "unique", "maneuvers", "factors"].map(kind => traitsOfKind(kind).length);
  check("Trait loading: never more than 32 files asked for at once; one that fails asked for again and read; every Trait there as before, nothing reported",
    [most <= 32, most > 1, failedOnce, Boolean(getTrait("mind-reading")), JSON.stringify(after) === JSON.stringify(before),
     errors.filter(text => text.includes("Could not read")).length],
    [true, true, true, true, true, 0]);
}

// --- Allies: each character's Allies list, both ways, nothing else --------------------------------------------------------------
{
  const { areAllies, allyKey } = await import(modUrl("allies.mjs"));
  const fs = await import("node:fs");
  const path = await import("node:path");
  const actor = (id, allies = []) => ({ documentName: "Actor", id, uuid: `Actor.${id}`, system: { allies } });
  const a = actor("a", ["b"]), b = actor("b"), c = actor("c"), copyOfA = actor("a", ["b"]);
  const tokenOfB = { actor: b };
  const placeableOfC = { document: { actor: c }, actor: c };
  // Every module file: no disposition read to tell Allies from Opponents - only making a token keeps one.
  const dir = path.join(ROOT, "module");
  const files = fs.readdirSync(dir, { recursive: true }).filter(file => String(file).endsWith(".mjs"));
  const left = files.flatMap(file => fs.readFileSync(path.join(dir, String(file)), "utf8").split("\n")
    .filter(line => line.includes("disposition") && !/^\s*(\/\/|\*)/.test(line) && !line.includes("getTokenDocument"))
    .map(line => `${file}: ${line.trim()}`));
  const ST = read("templates", "parts", "actor-settings.hbs"), SH = read("module", "sheets", "actor-character-sheet.mjs"), DM = read("module", "data", "actor-character.mjs");
  check("Allies: on either one's list, both ways; never oneself, nor two copies of one Character; a token read as its Actor; nobody else; no disposition read anywhere; the Settings tab's list, Add Allies of those whose sheet the user may see, a cross for one's own, those whose list names them shown apart",
    [areAllies(a, b), areAllies(b, a), areAllies(a, c), areAllies(a, a), areAllies(a, copyOfA), areAllies(tokenOfB, a), areAllies(placeableOfC, b),
     allyKey(tokenOfB), areAllies(null, a), left,
     DM.includes("schema.allies = new fields.ArrayField("), ST.includes('data-action="pickAlly"'),
     SH.includes('&& actor.testUserPermission(game.user, "OBSERVER"))'), SH.includes("(actor.system?.allies ?? []).includes(this.actor.id))"),
     ST.includes("from their list")],
    [true, true, false, false, false, true, false, "b", false, [], true, true, true, true, true]);
}

// --- Unknown Ally: a name kept from the players, the ARC's toggle --------------------------------------------------------------------
{
  const SH = read("module", "sheets", "actor-character-sheet.mjs"), ST = read("templates", "parts", "actor-settings.hbs");
  // #prepareAllies, cut out and run as the ARC and as a player.
  const from = SH.indexOf("  #prepareAllies() {");
  const body = SH.slice(SH.indexOf("{", from) + 1, SH.indexOf("\n  }\n", from)).replace("DBUCharacterSheet.#inheritedNote(", "inheritedNote(");
  const { areAllies, masterOf, minionsOf } = await import(modUrl("allies.mjs"));
  const run = (gm, observable) => {
    const npc = (id, name, allies = []) => ({ id, name, img: `${id}.png`, system: { allies },
      testUserPermission: () => observable.includes(id) });
    const me = { id: "me", system: { allies: ["spy", "pal"], alliesHidden: ["spy"] } };
    const actors = [me, npc("spy", "The Spy"), npc("pal", "Pal"), npc("mole", "The Mole", ["me"]), npc("buddy", "Buddy", ["me"])];
    const game = { user: { isGM: gm }, actors: { get: id => actors.find(each => each.id === id), contents: actors } };
    globalThis.game.actors = game.actors;
    return new Function("game", "masterOf", "minionsOf", "areAllies", "inheritedNote", body).call({ actor: me }, game, masterOf, minionsOf,
      areAllies, () => ({})).map(each => [each.name, Boolean(each.theirs), Boolean(each.unknown)]);
  };
  check("Unknown Ally: a hidden one of the list, and one from another's list the player may not see, \"Unknown Ally\" with no picture - last; the ARC sees every name; Add Allies' Show name beside each, on where the sheet's players may see it; the ARC's eye in the list",
    [run(false, ["pal", "buddy"]), run(true, []),
     SH.includes("if (other && !this.#playersSee(other)) hidden.add(id);"),
     ST.includes('data-action="toggleAllyName"') && ST.includes("{{#if who.eye}}") && SH.includes("eye: gm && !entry.theirs"),
     SH.includes('"system.alliesHidden": (this.actor.system.alliesHidden ?? []).filter(each => each !== id) });')],
    [[["Buddy", true, false], ["Pal", false, false], ["Unknown Ally", false, true], ["Unknown Ally", true, true]],
     [["Buddy", true, false], ["Pal", false, false], ["The Mole", true, false], ["The Spy", false, false]], true, true, true]);
}

// --- Effects that ask Ally or Opponent of a target or a list: the Allies lists read ------------------------------------------------------
{
  const CH = read("module", "chat.mjs"), UM = read("module", "use-maneuver.mjs");
  const { allyKey } = await import(modUrl("allies.mjs"));
  // Talk's "Make allies changes", cut out and run: each off the other's list (and its hidden names), both ways.
  const from = CH.indexOf("async function takeAlliesChange(");
  const body = CH.slice(from, CH.indexOf("\n}\n", from) + 2).replace('const { allyKey } = await import("./allies.mjs");', "");
  const writes = [];
  const actor = (id, allies, hidden = []) => ({ documentName: "Actor", id, uuid: `Actor.${id}`, name: id, isToken: false,
    system: { allies, alliesHidden: hidden } });
  const one = actor("target", ["turner", "pal"], ["turner"]), other = actor("turner", ["target"]);
  const change = new Function("fromUuidSync", "requestActorUpdate", "allyKey", "game", "ui", `${body}\nreturn takeAlliesChange;`)(
    uuid => ({ "Actor.target": one, "Actor.turner": other })[uuid], async (who, data) => writes.push([who.id, data]), allyKey,
    { actors: { get: () => null } }, { notifications: { info: () => {} } });
  await change({ oneUuid: "Actor.target", otherUuid: "Actor.turner" });
  check("Allies read where a target or a list asks: Talk won against an Ally's turner - \"Make allies changes\" on its card, each off the other's list both ways; its turners one's Allies; Ruler and Entertained the Allies alone; Concentration worked out; Enhance and Web Save an Ally, Dimensional Hole, Spin to Win and Spring Trap an Opponent; Illusion's, Hide's and Tiny Target's Opponents",
    [writes, CH.includes('maneuverName: "Make allies changes"') && CH.includes("if (offer.alliesChange) return takeAlliesChange(offer.alliesChange);"),
     UM.includes("&& (other.uuid !== actor.uuid) && (other.uuid !== target.uuid) && areAllies(other, target))"),
     CH.includes('(other.uuid !== actor.uuid) && areAllies(other, actor))\n    .map(other => [other.uuid, other])).values()];\n  if (!pool.length) return ui.notifications.warn(`${actor.name}: Ruler'),
     CH.includes("((actor.uuid === owner.uuid) || areAllies(actor, owner)));"),
     UM.includes("Concentration - ${near.map(other => other.name).join") && !UM.includes("Is any of them an Opponent?"),
     UM.includes("${ally.name} is not your Ally.`);") && CH.includes("is not your Ally: Web Save moves a willing Ally.")
       && CH.includes("Dimensional Hole sends it to an Opponent.") && CH.includes("Spin to Win is for an Opponent.")
       && CH.includes("(other.uuid !== actor.uuid) && areOpponents(other, actor)).map(other => [other.uuid, other])).values()];"),
     UM.includes("&& areOpponents(other, actor)).map(other => [other.uuid, other])).values()];")
       && UM.includes("&& (burst || areOpponents(other, actor))).map(") && CH.includes("areOpponents(other, actor)\n    && (sizeDifference(other, actor) >= 2))")],
    [[["target", { "system.allies": ["pal"], "system.alliesHidden": [] }], ["turner", { "system.allies": [], "system.alliesHidden": [] }]],
     true, true, true, true, true, true, true]);
}

// --- Allies, the second sweep: Intervene, United Attack, and what names an Opponent or an Ally of a target --------------------------
{
  const CH = read("module", "chat.mjs"), UM = read("module", "use-maneuver.mjs"), MA = read("module", "maneuvers.mjs"), UA = read("module", "united-attack.mjs");
  const { whyNotIntervene } = await import(modUrl("maneuvers.mjs"));
  const actor = (id, allies = []) => ({ documentName: "Actor", id, uuid: `Actor.${id}`, name: id, system: { allies } });
  const me = actor("me", ["pal"]), pal = actor("pal"), foe = actor("foe");
  const realFrom = globalThis.fromUuidSync;
  globalThis.fromUuidSync = uuid => ({ "Actor.pal": pal, "Actor.foe": foe })[uuid] ?? null;
  const interveneFor = [whyNotIntervene(me, "Actor.pal"), whyNotIntervene(me, "Actor.foe")];
  globalThis.fromUuidSync = realFrom;
  check("Allies, second sweep: Intervene for an Ally alone, United Attack an Ally's; Hyper Tornado's Thrust, Para Para Dance, Splitting, Precognition, Angelic Offense at Opponents; Noble Dragon, the Explosive Web, Restrictive Weights and Illusion Smash (not Portal Control) refuse an Ally, Projectile Materialization one not an Ally",
    [interveneFor, UA.includes("if (attacker && !areAllies(joiner, attacker)) return"),
     CH.includes("&& areOpponents(other, actor) && !whyNotWithinMelee(actor, other, \"\"));"),
     CH.includes(".filter(other => other && (other.uuid !== dancer.uuid) && areOpponents(other, dancer)).slice(0, para.actions);"),
     UM.includes("(other.uuid !== actor.uuid) && areOpponents(other, actor)))];") && UM.includes("&& areOpponents(combatant.actor, actor));"),
     CH.includes("!target.system?.defeated && areOpponents(target, attacker));"),
     CH.includes("Noble Dragon needs an Opponent.`);") && CH.includes("the Explosive Web strikes an Opponent.`);")
       && UM.includes("the Weights go on an Opponent.`);") && UM.includes("Projectile Materialization arms an Ally.`);")
       && UM.includes("const ally = !control && targets.find(other => areAllies(other, actor));")],
    [[null, "foe is not me's Ally."], true, true, true, true, true, true]);
}

// --- Allies, the third sweep: every Maneuver whose entry targets "an Opponent" or "an Ally" -----------------------------------------
{
  const UM = read("module", "use-maneuver.mjs");
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const getManeuver = id => getTrait(id);
  // The table, cut out: each id a Maneuver of the library, each side one its entry names.
  const from = UM.indexOf("const TARGET_SIDE = Object.freeze({");
  const table = new Function(`return ${UM.slice(UM.indexOf("{", from), UM.indexOf("});", from) + 1)};`)();
  const said = Object.entries(table).map(([id, side]) => {
    const text = String(getManeuver(id)?.text ?? "").toLowerCase();
    return [id, Boolean(getManeuver(id)), getManeuver(id)?.requiresTarget === true, (text.includes(`target an ${side}`) || text.includes(`declare an ${side}`))];
  }).filter(([, known, aimed, named]) => !known || !aimed || !named);
  check("Allies, third sweep: a Maneuver that targets one Character refused at one of the wrong side - an Opponent's at an Ally, an Ally's at one not (Treatment's own user still); each in the table a library Maneuver aimed at one, its entry naming that side",
    [said, UM.includes("ui.notifications.warn(`${targetActor.name} is not an Opponent: ${maneuver.name} targets an Opponent.`);"),
     UM.includes("if ((side === \"ally\") && !allied && (targetActor.uuid !== actor.uuid)) {"), Object.keys(table).length],
    [[], true, true, 25]);
}

// --- Allies, the fourth sweep: what answers hitting, knocking, Defeating or being struck by "an Opponent" --------------------------------
{
  const CH = read("module", "chat.mjs"), CB = read("module", "combat.mjs");
  const cut = name => { const from = CH.indexOf(`function ${name}(`); return CH.slice(CH.lastIndexOf("\n", from), CH.indexOf("\n}\n", from)); };
  check("Allies, fourth sweep: an Ally hit is not \"an Opponent\" hit (hit-opponent's answers, Overwhelming Pressure, hit-concluded), nor Defeated (defeat-opponent) nor knocked through (knock-through); Fake Death, Flow of Combat, Rubbery Body's move (but a Grapple), Shock Tornado and Tornado Strike not for an Ally's attack",
    [CH.includes("const struckOpponents = struck.filter(({ actor: hit }) => areOpponents(hit, attacker));"),
     CH.includes("await answerHit(message, attack, attacker, struckOpponents);"),
     CH.includes('if (struckOpponents.length) await answerFor(attacker, "hit-concluded"'),
     CB.includes("if (knocker && (knocker.uuid !== actor.uuid) && areOpponents(knocker, actor)) {"),
     CB.includes("const theirs = !knockerDenied && areOpponents(knocker, actor);"),
     ["offerFakeDeath", "offerFlowExploit", "offerRubberyMove", "offerShockTornado", "offerTornadoStrike"].filter(name => !/areAllies\(|areOpponents\(/.test(cut(name)))],
    [true, true, true, true, true, []]);
}

// --- Allies, the fifth sweep: the Traits' own blocks that answer "an Opponent's" attack or Clash ----------------------------------------
{
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const CH = read("module", "chat.mjs");
  const ids = ["kings-stature", "miniature-warrior", "tai-chi-practitioner", "lingering-instincts", "flow-of-combat"];
  check("Allies, fifth sweep: King's Stature, Miniature Warrior, Tai Chi Practitioner (hit by an Opponent's attack), Lingering Instincts (3) and Flow of Combat (3) (targeted by an Opponent's) ask byOpponent, the Defend's moment naming the attacker; Lingering Instincts (1) not against an Ally's attack; a Unique Ability's Clash won against an Ally answers nothing",
    [ids.map(id => [getTrait(id)?.script?.includes("byOpponent") === true, compile(getTrait(id)?.script ?? "").errors.length]),
     CH.includes('const answered = atMoment(target, "defending", { attack: true, attacker: true, attackerUuid: attack?.attackerUuid ?? "",'),
     CH.includes("if (attack?.attackerUuid && !areOpponents(actor, fromUuidSync(attack.attackerUuid))) return [];")
       && !/respondingParts\((actor|target)\)/.test(CH),
     CH.includes("if (!areOpponents(winner, fromUuidSync(loser))) return;")],
    [ids.map(() => [true, 0]), true, true, true]);
}

// --- Allies, the sixth sweep: from each effect naming "an Opponent" to the code reading its slot ---------------------------------------
{
  const CH = read("module", "chat.mjs");
  const cut = name => { const from = CH.indexOf(`function ${name}(`); return CH.slice(from, CH.indexOf("\n}\n", from)); };
  check("Allies, sixth sweep: Claws (2), Elongated Tail (2), Disarming Demeanor (1), (2), (3), Extension Attack (2), Angelic Defense (2) and Protector at or by an Opponent alone",
    [["clawsButtons", "offerTailGrapple", "offerDisarming", "disarmingOpen", "angelicOpen", "protectorWaives"].filter(name => !/areAllies\(|areOpponents\(/.test(cut(name))),
     CH.includes("const swap = (defence in DEFEND_OPTIONS) && areOpponents(target, attacker) && disarmingSwapOpen(attacker, attack)"),
     CH.includes('const extended = (grappler.system?.effects?.slots?.["extension.noGuardDown"] === true) && areOpponents(grappler, grappled)'),
     CH.includes('const protector = await protectorWaives(actor, allyActor, fromUuidSync(attack?.attackerUuid ?? ""));')],
    [[], true, true, true]);
}

// --- Allies, the seventh sweep: the rules' own machinery - the Exploit offered, the Unique Abilities aimed ----------------------------------
{
  const CH = read("module", "chat.mjs"), UM = read("module", "use-maneuver.mjs");
  const from = CH.indexOf("function offerExploits(");
  const body = CH.slice(from, CH.indexOf("\n}\n", from));
  check("Allies, seventh sweep: the Exploit offered to Opponents alone (\"All adjacent Opponents\" - Para Para Dance's too); a Unique Ability aimed at the wrong side refused by its file's id (Bluff Attack, Devilmite Beam, Internal Assault, Mind Control, Petrification, Punisher Guard, Sealing at an Opponent; Warped Evolution at an Ally)",
    [body.includes("if (!areOpponents(other, actor)) continue;"),
     UM.includes('TARGET_SIDE[actor.items?.get(maneuver.itemId ?? "")?.system?.unique?.libraryId ?? ""]'),
     ["bluff-attack", "devilmite-beam", "internal-assault", "mind-control", "petrification", "punisher-guard", "sealing", "warped-evolution"]
       .every(id => UM.includes(`"${id}": "`))],
    [true, true, true]);
}

// --- Allies, the eighth sweep: a Signature Technique's or a Weapon's own "an Opponent" on each target ------------------------------------
{
  const CH = read("module", "chat.mjs"), UM = read("module", "use-maneuver.mjs");
  const cut = name => { const from = CH.indexOf(`function ${name}(`); return CH.slice(from, CH.indexOf("\n}\n", from)); };
  check("Allies, eighth sweep: an Ally caught by a Technique gains no Penetration or Pinpoint Precision Broken, no Condition, Sustained DOT, Express Ticket, Terrain Slam, Deadly Drop, Weather Calling or Transformation Flare, no Delayed hold, no Knockback or Staggering Attack Clash, no Staggering Weapon's Prone, no Trick Attack Clash; Fake Out still at every target",
    [cut("techniqueOnHit").includes("if (!tech || !areOpponents(target, attacker)) return [];"),
     cut("techniqueAfterDamage").includes("const landed = own.hit && !isAbsoluteMiss(own) && areOpponents(target, attacker);"),
     cut("techniqueAfterDamage").includes('if (has("terrain-slam") && areOpponents(target, attacker)) {'),
     CH.includes("const foe = attacker && areOpponents(target, attacker);") && CH.includes("if (foe && staggers(attack)) await openStagger"),
     CH.includes("if (striker && areOpponents(target, striker)) {"),
     cut("applyAttackDamage").includes('&& areOpponents(target, fromUuidSync(attack.attackerUuid ?? ""))) {'),
     UM.includes('if (list.includes("trick-attack") && areOpponents(target, actor) && !skip.has(`trick-attack:${target.uuid}`)) {') && UM.includes('    if (list.includes("fake-out") && !skip.has(`fake-out:${target.uuid}`)) {')],
    [true, true, true, true, true, true, true]);
}

// --- Allies, the ninth sweep: the Gear's Buddies and the sheet's own actions -------------------------------------------------------------
{
  const CH = read("module", "chat.mjs"), SH = read("module", "sheets", "actor-character-sheet.mjs");
  check("Allies, ninth sweep: a Buddy's heal at yourself or an Ally alone; Zen-O's Annoyed draws its erased one - heads among its owner and their Allies, tails among their Opponents - and names them",
    [SH.includes('if ((who.uuid !== actor.uuid) && !areAllies(who, actor)) return ui.notifications.warn(`${who.name} is not your Ally.`);'),
     CH.includes("const pool = (coin.total === 1) ? present.filter(each => (each.uuid === owner.uuid) || areAllies(each, owner))"),
     CH.includes(": present.filter(each => (each.uuid !== owner.uuid) && areOpponents(each, owner) && (isCharacter(each)));")],
    [true, true, true]);
}

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
