/**
 * The Minion Talents: Master of Minions, Minion Coordinator, Minion Mark, Sacrificial Minion, Minion Army, Minion Supporter.
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
const CATS = await import(modUrl("talent-categories.mjs"));
const RACES = await import(modUrl("races.mjs"));
{
  const keep = foundry.utils.fetchJsonWithTimeout;
  foundry.utils.fetchJsonWithTimeout = async url => JSON.parse(read("races", String(url).split("/races/")[1]));
  await RACES.loadRaces();
  foundry.utils.fetchJsonWithTimeout = keep;
}

/** A Talent's Item, as the Progression tab puts one on. */
const talentItem = (id, n = 0) => ({ id: `t${n}`, uuid: `A.t${n}`, type: "talent", name: getTrait(id).name, flags: { "dbu-ttrpg": { sourceId: id } },
  system: { script: getTrait(id).script, chosen: [] } });

/** A Character with these Items, prepared at full Life. */
function build(items) {
  const parent = new ActorStub({}, { strict: false });
  Object.assign(parent, { type: "character", items, getFlag: () => undefined, uuid: "A.c", id: "boss", documentName: "Actor" });
  const make = life => {
    const model = new DBUCharacterData({ powerLevel: 10, race: "earthling", ...(life === null ? {} : { life: { value: life } }) },
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
const blocks = id => compile(getTrait(id).script).program.blocks.filter(b => b.mode !== "passive")
  .map(b => `${b.mode}/${b.moment}${b.modifiers?.outOfSequence ? "+oos" : ""}`);

// --- Master of Minions -----------------------------------------------------------------------------------------------------------
{
  const t = getTrait("master-of-minions");
  check("Master of Minions: the Minion Category, N/A - compiling; the Command's Action back",
    [t.talentCategory, t.prerequisites, compile(t.script).errors.length, blocks("master-of-minions"),
     CATS.talentsInCategory("minion").includes("Master of Minions")],
    ["minion", "N/A", 0, ["triggered/command-used"], true]);
  const master = build([talentItem("master-of-minions")]);
  const best = Math.max(master.attributes.personality.mod, master.attributes.scholarship.mod, 0);
  check("(1) 2 more Minions; (2) its Minions' Wound Rolls 1/4 (rounded up) of the higher of its Personality and Scholarship Modifiers",
    [add(master, "minions.combat"), add(master, "minions.wound")], [2, Math.ceil(best / 4)]);
  const boss = { id: "boss", system: { effects: { slots: { "minions.wound": { add: 2 } } } }, getFlag: () => undefined };
  const keep = globalThis.game;
  globalThis.game = { actors: { get: id => (id === "boss") ? boss : null, contents: [boss] } };
  const gifts = ALLIES.minionGifts({ documentName: "Actor", type: "minion", id: "m", system: { master: "boss" }, getFlag: () => undefined });
  globalThis.game = keep;
  const CH = read("module", "chat.mjs");
  check("the Minion given it as it is prepared, as a Wound Roll; the Command's moment fired once its Minions are Commanded",
    [gifts.wound, read("module", "effects", "registry.mjs").includes("gifts?.wound ? `wound += ${gifts.wound};` : \"\","),
     CH.includes("await answerFor(actor, \"command-used\", { minions: picked.length });"),
     read("module", "effects", "moments.mjs").includes('{ key: "command-used",')],
    [2, true, true, true]);
}

// --- Minion Coordinator ---------------------------------------------------------------------------------------------------------
{
  const t = getTrait("minion-coordinator"), m = getTrait("minion-coordinator-second-effect");
  const coord = build([talentItem("minion-coordinator")]);
  const CH = read("module", "chat.mjs"), CB = read("module", "combat.mjs");
  check("Minion Coordinator (Master of Minions): (1) a d8(T) more on the Recovery Period; (2) its Instant Maneuver, once a Round; (3) 2 more Minions",
    [t.talentCategory, t.prerequisites, compile(t.script).errors.length, add(coord, "minions.recoveryDice"), add(coord, "minions.combat"),
     [m.type, Number(m.actionCost), m.usageLimit, m.fromTrait, Number(m.fromEffect), compile(m.script).errors.length],
     CATS.talentsInCategory("minion").includes("Minion Coordinator")],
    ["minion", "Master of Minions", 0, 1, 2, ["instant", 0, "1/round", "minion-coordinator", 2, 0], true]);
  check("wired: the Recovery Period's roll that many times the Tier in d8s; one of your Minions Superior till the end of its turn",
    [CB.includes("const roll = await new Roll(`${tier * times}d8`).evaluate();"),
     CB.includes('const times = 1 + Math.max(0, Number(master.system?.effects?.slots?.["minions.recoveryDice"]?.add) || 0);'),
     CH.includes('if (!await enterState(minion, "superior", 1, "turn", "Minion Coordinator")) return UNSPENT;')],
    [true, true, true]);
}

// --- Minion Mark ------------------------------------------------------------------------------------------------------------------
{
  const t = getTrait("minion-mark"), m = getTrait("minion-mark-first-effect"), mark = getTrait("marked-minion");
  const marker = build([talentItem("minion-mark")]);
  const CH = read("module", "chat.mjs"), CB = read("module", "combat.mjs");
  check("Minion Mark (Master of Minions): (1) its Instant Maneuver once a Round, the mark a Combat Roll a stack, not a Combat Condition; (2) its flag; "
    + "(3) 2 more Minions",
    [t.talentCategory, t.prerequisites, compile(t.script).errors.length, marker.effects.slots["minionMark.wall"], add(marker, "minions.combat"),
     [m.type, Number(m.actionCost), m.usageLimit, m.fromTrait, Number(m.fromEffect), compile(m.script).errors.length],
     [mark.combatCondition, compile(mark.script).errors.length], CATS.talentsInCategory("minion").includes("Minion Mark")],
    ["minion", "Master of Minions", 0, true, 2, ["instant", 0, "1/round", "minion-mark", 1, 0], [false, 0], true]);
  check("wired: a typical Minion of yours not Marked, your base Tier its stacks; 4 a stack lost as each Round starts, said on its card; gone with the "
    + "Encounter; its Defense Wall for you with no Counter Action, half its Life Points instead",
    [CH.includes('await setCondition(minion, "marked-minion", Math.max(1, Number(actor.system.baseTierOfPower) || 1));'),
     CH.includes("minion && typicalMinion(minion) && !minion.system?.defeated"),
     CB.includes('const { taken } = await reduceLifePoints(minion, 4 * stacks, { reason: "Minion Mark", own: true });'),
     CB.includes("...await markedMinionsBleed(combat), ...advantaged];"),
     CB.includes('if ((Number(actor.system.conditions?.["marked-minion"]) || 0) > 0) await setCondition(actor, "marked-minion", 0);'),
     CH.includes('&& (markMaster.uuid === allyActor.uuid) && (markMaster.system?.effects?.slots?.["minionMark.wall"] === true)'),
     CH.includes("const half = Math.floor((Number(actor.system.life?.value) || 0) / 2);"),
     CH.includes('!furyFree && !markWall && !shinjinFree\n    && !await payCounter(actor, maneuver, maneuver.actionCost ?? 1)) return;')],
    Array(8).fill(true));
}

// --- Sacrificial Minion ---------------------------------------------------------------------------------------------------------
{
  const t = getTrait("sacrificial-minion"), m = getTrait("sacrificial-minion-second-effect"), mark = getTrait("sacrificial-mark");
  const giver = build([talentItem("sacrificial-minion")]);
  const CH = read("module", "chat.mjs");
  check("Sacrificial Minion (Minion Mark): (1) its flag; (2) its Instant Maneuver once a Round; the third choice's mark a Combat Roll a stack",
    [t.talentCategory, t.prerequisites, compile(t.script).errors.length, giver.effects.slots["sacrificial.ownMinion"],
     [m.type, Number(m.actionCost), m.usageLimit, m.fromTrait, Number(m.fromEffect), compile(m.script).errors.length],
     [mark.combatCondition, compile(mark.script).errors.length], CATS.talentsInCategory("minion").includes("Sacrificial Minion")],
    ["minion", "Minion Mark", 0, true, ["instant", 0, "1/round", "sacrificial-minion", 2, 0], [false, 0], true]);
  check("wired: one of your Minions among its targets, Strike and Wound 1(T); a typical Minion of yours Defeated, then the choice - a Morale Clash "
    + "at each Opponent (Shaken), half its Life back, or the mark set till the turn ends",
    [CH.includes('&& everyone.some(who => who && isMinion(who) && (masterOf(who) === actor.id))) {'),
     CH.includes('woundExtra = [...woundExtra, { label: "Sacrificial Minion", written: "+1(T)", value: mimicTier }];'),
     CH.includes('await requestActorUpdate(minion, { "system.life.value": Math.min(0, Number(minion.system.life?.min) || 0) });'),
     CH.includes('saves: ["morale"], defenderSaves: ["morale"], sacrificialShaken: { applied: false } });'),
     CH.includes('if (await gainCondition(target, "shaken", 1) === false) return;'),
     CH.includes('await setCondition(actor, "sacrificial-mark", 2 * Math.max(1, Number(actor.system.tierOfPower) || 1));'),
     CH.includes('await expiresAt(actor, "sacrificial-mark", "turn");')],
    Array(7).fill(true));
}

// --- Minion Army ----------------------------------------------------------------------------------------------------------------
{
  const t = getTrait("minion-army");
  const army = build([talentItem("minion-army")]);
  const CH = read("module", "chat.mjs");
  check("Minion Army (Minion Coordinator or Minion Mark): (1) Ruler (1)'s limit; (2) its flag; (3) the table's - compiling",
    [t.talentCategory, t.prerequisites, compile(t.script).errors.length, army.effects.slots["minions.ruler"], army.effects.slots["minionArmy.wound"],
     CATS.talentsInCategory("minion").includes("Minion Army")],
    ["minion", "Minion Coordinator or Minion Mark Talents", 0, true, true, true]);
  check("wired: a Minion's attack - its Master asked once a Round; 1(T) of theirs for each other Minion of theirs fighting, not Defeated, yet to "
    + "attack, 4 at most",
    [CH.includes('const army = (!reflecting && isMinion(actor)) ? game.actors?.get(masterOf(actor)) : null;'),
     CH.includes("&& !minion.system?.defeated && !((Number(minion.system?.attacksThisRound) || 0) > 0)).length;"),
     CH.includes("const count = Math.min(4, idle);"),
     CH.includes('woundExtra = [...woundExtra, { label: "Minion Army", written: `+${count}(T)`, value: count * armyTier }];')],
    [true, true, true, true]);
}

// --- Minion Supporter -----------------------------------------------------------------------------------------------------------
{
  const t = getTrait("minion-supporter"), m = getTrait("minion-supporter-second-effect"), mark = getTrait("supporter-mark");
  const giver = build([talentItem("minion-supporter")]);
  const CH = read("module", "chat.mjs");
  check("Minion Supporter (Minion Coordinator, ToP 2+): (1) its flag; (2) its Instant Maneuver once a Round; the mark a Combat Roll a stack",
    [t.talentCategory, t.prerequisites, compile(t.script).errors.length, giver.effects.slots["minionSupporter.dice"],
     [m.type, Number(m.actionCost), m.usageLimit, m.fromTrait, Number(m.fromEffect), compile(m.script).errors.length],
     [mark.combatCondition, compile(mark.script).errors.length], CATS.talentsInCategory("minion").includes("Minion Supporter")],
    ["minion", ["Minion Coordinator", "ToP 2+"], 0, true, ["instant", 0, "1/round", "minion-supporter", 2, 0], [false, 0], true]);
  check("wired: your own Minion Cheered by you marked supported - its Combat Rolls given your ToP Extra Dice as a group of their own, in the roll "
    + "and in its window; the Empower as if 1 Action at one of your Minions, then its mark till the start of your next turn",
    [CH.includes('const supported = (actor.system?.effects?.slots?.["minionSupporter.dice"] === true) && isMinion(ally) && (masterOf(ally) === actor.id);'),
     CH.includes('return formula ? [{ source: "Minion Supporter", formula }] : [];'),
     CH.includes('? [...(actor.system.effects?.slots?.["combatRolls.dice"] ?? []), ...supporterDice(actor)]'),
     CH.includes('...[...(actor.system.effects?.slots?.["combatRolls.dice"] ?? []), ...supporterDice(actor)]'),
     CH.includes("if (!await empowerAs(actor, minion, 1)) return UNSPENT;"),
     CH.includes('await lasting(actor, { kind: KINDS.CONDITION, key: "supporter-mark", edge: EDGES.START, on: minion.uuid, source: "Minion Supporter" });')],
    Array(6).fill(true));
}

// --- A Factor Trait in the place of the one it replaces; a granted Talent's choice on the Options tab ---------------------------
{
  const RACIAL = await import(modUrl("racial.mjs"));
  const racialItem = (id, n) => ({ id: `r${n}`, type: "racial", name: getTrait(id).name, flags: { "dbu-ttrpg": { sourceId: id } },
    system: { race: (getTrait(id).kind === "factors") ? "" : getTrait(id).owner, factor: (getTrait(id).kind === "factors") ? getTrait(id).owner : "",
      chosen: (id === "from-goop") ? [{ key: "from-goop#talent", value: "master-of-minions", label: "From Goop: Master of Minions" }] : [] } });
  const ids = ["rubbery-body", "dangerous-liquid", "majin-see-majin-do", "quick-sleep", "from-goop", "earthling-raised"].filter(id => getTrait(id));
  const actor = { system: { race: "majin", effects: { slots: {} } }, items: ids.map(racialItem) };
  const order = RACIAL.ownedRacialTraits(actor).map(item => item.flags["dbu-ttrpg"].sourceId);
  const regeneration = getTrait("majin-regeneration");
  const goopRow = await RACIAL.choiceRowsOf({ ...racialItem("from-goop", 9), actor: { items: [] } });
  check("From Goop [Majin Regeneration] listed where Majin Regeneration would be - among the Majin's, by its order; its Talent a row of its Options",
    [Boolean(regeneration), order.indexOf("from-goop") < order.indexOf("dangerous-liquid"), order.indexOf("from-goop") > order.indexOf("rubbery-body"),
     order[order.length - 1], goopRow.map(row => [row.which, row.label, row.current]), goopRow[0]?.options.some(option => option.value === "minion-army")],
    [true, true, true, "earthling-raised", [["talent", "Talent", "master-of-minions"]], true]);
}

// --- The Duplicate band on a Duplicate Minion's token ------------------------------------------------------------------------------
{
  class Node { constructor() { this.children = []; this.position = { set: (x, y) => { this.x = x; this.y = y; } }; this.anchor = { set: () => {} };
    this.destroyed = false; } addChild(c) { this.children.push(c); return c; } destroy() { this.destroyed = true; } }
  class Graphics extends Node { constructor() { super(); this.rects = []; } beginFill(color, alpha = 1) { this.fill = [color, alpha]; return this; }
    drawRect(...r) { this.rects.push([...r, ...this.fill]); return this; } endFill() { return this; } }
  class Text extends Node { constructor(text, style) { super(); this.text = text; this.style = style; } }
  const keep = globalThis.PIXI;
  globalThis.PIXI = { Container: Node, Graphics, Text };
  const TM = await import(modUrl("token-marks.mjs"));
  const token = (actor) => ({ w: 100, h: 100, actor, destroyed: false, children: [], addChild(c) { this.children.push(c); } });
  const dup = token({ type: "minion", system: { duplicate: true } });
  TM.drawDuplicateBand(dup);
  const band = dup._dbuDuplicateBand, strip = band?.children[0], fill = strip?.children[0], label = strip?.children[1];
  TM.drawDuplicateBand(dup);
  const plain = token({ type: "minion", system: { duplicate: false } });
  TM.drawDuplicateBand(plain);
  dup.actor.system.duplicate = false;
  TM.drawDuplicateBand(dup);
  globalThis.PIXI = keep;
  check("the Duplicate band: on a Duplicate's token, gray at 0.55 with light edges, rotated -35 degrees, \"DUPLICATE\" at 0.8, clipped to it; drawn once; "
    + "none on another Minion; gone as the box is unticked; registered at start",
    [dup.children.length, Math.round(strip.rotation * 180 / Math.PI), fill.rects[0].slice(4), label.text, label.alpha, Boolean(band.mask),
     band.destroyed, plain._dbuDuplicateBand ?? null,
     read("module", "dbu-ttrpg.mjs").includes("  registerTokenMarks();")],
    [1, -35, [0x444441, 0.55], "DUPLICATE", 0.8, true, true, null, true]);
}

// --- From Goop's Talent goes with it ("while you possess this Factor Trait"); a Racial Trait's usual one stays ---------------------
{
  const RACIAL = await import(modUrl("racial.mjs"));
  const handlers = {};
  const keepHooks = globalThis.Hooks, keepGame = globalThis.game;
  globalThis.Hooks = { on: (name, fn) => { handlers[name] = fn; } };
  globalThis.game = { user: { id: "u" } };
  RACIAL.registerRacialHooks();
  const run = async (traitId, talentFrom) => {
    const deleted = [];
    const actor = { items: [], deleteEmbeddedDocuments: async (type, ids) => { deleted.push(...ids); } };
    const trait = { id: "tr", type: "racial", parent: actor, flags: { "dbu-ttrpg": { sourceId: traitId } }, system: { chosen: [] } };
    const talent = { id: "ta", type: "talent", flags: { "dbu-ttrpg": { sourceId: "master-of-minions", fromTrait: talentFrom } } };
    actor.items = [talent];
    await handlers.deleteItem(trait, {}, "u");
    return deleted;
  };
  const goop = await run("from-goop", "from-goop");
  const usual = await run("battle-goo", "battle-goo");
  globalThis.Hooks = keepHooks;
  globalThis.game = keepGame;
  check("From Goop's Talent leaves with it; a Trait without talentsGoWithIt keeps its own",
    [getTrait("from-goop").talentsGoWithIt, goop, usual], [true, ["ta"], []]);
}

// --- The Turn State's Reset -------------------------------------------------------------------------------------------------------
{
  const CB = read("module", "combat.mjs"), SH = read("module", "sheets", "actor-character-sheet.mjs"), TP = read("templates", "parts", "actor-combat.hbs");
  const body = CB.slice(CB.indexOf("export async function resetTurnState(actor) {"), CB.indexOf("\n}\n", CB.indexOf("export async function resetTurnState(actor) {")));
  check("Reset: a button in the Turn State, asked first; only what cannot be taken off by hand - marks and clocks; States, Combat "
    + "Conditions, Actions, Resources, uses spent, the Triggered/Automatic buttons untouched (the user's)",
    [TP.includes('data-action="resetTurnState"'), SH.includes("resetTurnState: DBUCharacterSheet._onResetTurnState,"),
     SH.includes("const yes = await foundry.applications.api.DialogV2.confirm({ classes: [\"dbu-dialog\"], window: { title: `${this.actor.name} - Reset` },"),
     body.includes("const marks = new Set(allConditions().filter(condition => !condition.combatCondition).map(condition => condition.key));"),
     body.includes('await actor.update({ "system.conditions": replaceObject(conditions) });'), body.includes("await encounterEnded(actor);"),
     /"system\.states"|actionsSpent|"system\.resources"|stopCharging|usedManeuvers|talentUses|armedTalents|automatic|life|karma|imminent/.test(body.split("*/")[1] ?? "")],
    [true, true, true, true, true, true, false]);
}

// --- A Duplicate made by hand: whom it copies, chosen on Settings; its Progression tab locked --------------------------------------
{
  const MM = await import(modUrl("minion-make.mjs"));
  const log = { deleted: [], updated: null, created: null, keepId: null };
  const original = { id: "o", toObject: () => ({ system: { race: "saiyan", progression: [{ lvl: 1 }], powerLevel: 5, karma: 9 },
    items: [{ _id: "t1", type: "talent", name: "Lucky" }, { _id: "g1", type: "gear", name: "Scouter", system: { itemType: "accessory" } },
      { _id: "c1", type: "gear", name: "Senzu", system: { itemType: "consumable" } }],
    flags: { "dbu-ttrpg": { automatic: ["t1#0"] } } }) };
  const item = (id, data) => ({ id, toObject: () => data });
  const actor = { id: "m", documentName: "Actor", type: "minion", system: { master: "boss" },
    items: [item("old", { type: "racial", name: "Old Trait" }), item("own", { type: "gear", name: "Bean", system: { itemType: "consumable" } })],
    deleteEmbeddedDocuments: async (type, ids) => { log.deleted.push(...ids); },
    update: async data => { log.updated = data; },
    createEmbeddedDocuments: async (type, items, options) => { log.created = items.map(each => each._id); log.keepId = options?.keepId; } };
  await MM.copyOntoDuplicate(actor, original);
  const SH = read("module", "sheets", "actor-character-sheet.mjs"), ST = read("templates", "parts", "actor-settings.hbs");
  check("a Duplicate made by hand: its Traits and the rest replaced with its original's - their defining fields, Talents and gear (not a "
    + "consumable), ids kept with their Triggered/Automatic choices; not Karma; its Progression tab locked while it is set",
    [log.deleted, log.created, log.keepId, log.updated?.system?.duplicateOf, log.updated?.system?.race, log.updated?.system?.progression,
     "karma" in (log.updated?.system ?? {}), log.updated?.["flags.dbu-ttrpg.automatic"], log.updated?.["flags.dbu-ttrpg.copied"],
     ST.includes("<select data-duplicate-of"), SH.includes('for (const control of progression.querySelectorAll("input, select, textarea, button")) control.disabled = true;'),
     read("module", "minion-make.mjs").includes("...(duplicate ? { duplicateOf: (copy ?? master).id } : {}) };")],
    [["old"], ["t1", "g1"], true, "o", "saiyan", [{ lvl: 1 }], false, ["t1#0"], true, true, true, true]);
}

console.log(failed ? `\n${failed} failing` : "\n0 failing");
