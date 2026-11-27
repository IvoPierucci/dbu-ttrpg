/**
 * Minions (the rulebook's Minion Rules; the user's design, 2026-10-30): an Actor type of its own, the same model reading it -
 * Weakness, a quarter of the Life, half the Ki, 2 Actions and no Counter Action, Healthy and Injured alone, no Karma - a
 * Character's Minions and a Minion's one Master on Settings, either side enough, the two Allies, and the Minion placed
 * straight after its Master in the Initiative order.
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

/** A Character or a Minion of a Power Level, prepared as Foundry prepares one. */
function build(type, powerLevel = 10, life = null) {
  const parent = new ActorStub({}, { strict: false });
  parent.type = type;
  parent.items = [];
  parent.getFlag = () => undefined;
  const model = new DBUCharacterData({ powerLevel, ...(life === null ? {} : { life: { value: life } }) }, { strict: false, parent });
  parent.system = model;
  model.prepareBaseData?.();
  model.prepareDerivedData();
  return model;
}

// --- The Actor type -------------------------------------------------------------------------------------------------------
const SYSTEM = JSON.parse(read("system.json"));
check("an Actor type of its own, named, the same model and sheet as a Character's",
  [Object.keys(SYSTEM.documentTypes.Actor), JSON.parse(read("lang", "en.json"))["TYPES.Actor.minion"],
   read("module", "dbu-ttrpg.mjs").includes("CONFIG.Actor.dataModels.minion = DBUCharacterData;"),
   read("module", "dbu-ttrpg.mjs").includes('types: ["character", "minion", "adversary", "fusion"],')],
  [["character", "minion", "adversary", "fusion", "vehicle"], "Minion", true, true]);
check("a Minion a Character to every rule that asks, and told apart where its own rules do",
  [TYPES.isCharacter({ type: "minion" }), TYPES.isCharacter({ type: "character" }), TYPES.isCharacter({ type: "vehicle" }),
   TYPES.isMinion({ type: "minion" }), TYPES.isMinion({ type: "character" })], [true, true, false, true, false]);
check("no type check left that a Minion would fail",
  ["chat.mjs", "combat.mjs", "use-maneuver.mjs", "conditions.mjs", "dbu-ttrpg.mjs"]
    .filter(file => /\.type (===|!==) "character"/.test(read("module", file))), []);

// --- Its own numbers ------------------------------------------------------------------------------------------------------
const pc = build("character", 10);
const minion = build("minion", 10);
check("Weakness: its base Tier of Power 1 lower", [pc.baseTierOfPower, minion.baseTierOfPower], [3, 2]);
// The Life and the Ki worked out with the Minion's lower base Tier, then a quarter (up) and a half (down) of that.
// Neither pool is worked out from the base Tier, so a Character of the same Power Level is what it "would usually be".
check("Life Points a quarter (rounded up) of what they would be; Ki a half (down) - the Capacity as usual",
  [minion.life.max, minion.ki.max, minion.capacity.max],
  [Math.ceil(pc.life.max / 4), Math.floor(pc.ki.max / 2), pc.capacity.max]);
check("2 Actions and no Counter Action a Round", [minion.actions.standard, minion.actions.counter, pc.actions.standard], [2, 0, 3]);
check("no Karma Points", [minion.karma, pc.karma], [0, 2]);
check("a Character's Minion flag off, a Minion's on", [pc.minion, minion.minion], [false, true]);

// Healthy and Injured alone: Healthy down to the Injured line, Injured under it.
check("Healthy and Injured its only Health Thresholds",
  [DBUCharacterData.thresholdKey(60, 100, true), DBUCharacterData.thresholdKey(40, 100, true),
   DBUCharacterData.thresholdKey(20, 100, true), DBUCharacterData.thresholdKey(5, 100, true),
   DBUCharacterData.thresholdKey(40, 100)], ["healthy", "healthy", "injured", "injured", "bruised"]);

// Weakness at base Tier 1: Saving Throws and Combat Rolls 1 lower - an effect named on the workings.
const low = build("minion", 1);
const lowPc = build("character", 1);
check("at base Tier 1 already: Saving Throws and Combat Rolls 1 lower instead",
  [low.baseTierOfPower, lowPc.combat.strike - low.combat.strike, lowPc.combat.dodge - low.combat.dodge,
   lowPc.savingThrows.morale.value - low.savingThrows.morale.value,
   low.effects.programs.some(entry => entry.sourceId === "minion-weakness"),
   build("minion", 10).effects.programs.some(entry => entry.sourceId === "minion-weakness")],
  [1, 1, 1, 1, true, false]);

// --- Master and Minions -----------------------------------------------------------------------------------------------------
const actor = (id, type, system = {}) => ({ id, type, documentName: "Actor", system: { allies: [], minions: [], master: "", ...system } });
const boss = actor("boss", "character", { minions: ["saiba1"] });
const saiba1 = actor("saiba1", "minion");
const saiba2 = actor("saiba2", "minion", { master: "boss" });
const loner = actor("loner", "minion");
const other = actor("other", "character");
globalThis.game = { actors: { contents: [boss, saiba1, saiba2, loner, other], get: id => [boss, saiba1, saiba2, loner, other].find(a => a.id === id) } };
check("a Minion's Master from either side - its own Settings, or the Character's list",
  [ALLIES.masterOf(saiba1), ALLIES.masterOf(saiba2), ALLIES.masterOf(loner), ALLIES.masterOf(boss)], ["boss", "boss", "", ""]);
check("a Character's Minions from either side; a Minion has none",
  [ALLIES.minionsOf(boss), ALLIES.minionsOf(other), ALLIES.minionsOf(saiba1)], [["saiba1", "saiba2"], [], []]);
check("Master and Minion are Allies, both ways; a stranger is not",
  [ALLIES.areAllies(boss, saiba1), ALLIES.areAllies(saiba2, boss), ALLIES.areAllies(other, saiba1), ALLIES.areAllies(loner, boss)],
  [true, true, false, false]);

// --- The Initiative order -------------------------------------------------------------------------------------------------------
const combat = { combatants: { contents: [] } };
const combatant = (id, who, initiative) => ({ id, actor: who, initiative, parent: combat });
combat.combatants.contents = [combatant("c-boss", boss, 12), combatant("c-s1", saiba1, 18), combatant("c-s2", saiba2, 4),
  combatant("c-other", other, 10), combatant("c-loner", loner, 15), combatant("c-late", other, null)];
check("each Minion straight after its Master, among them by their own Initiative; the rest by theirs",
  [...combat.combatants.contents].sort(ALLIES.initiativeOrder).map(c => c.id),
  ["c-loner", "c-boss", "c-s1", "c-s2", "c-other", "c-late"]);

// --- The sheet ----------------------------------------------------------------------------------------------------------------
const require = createRequire(`${(process.env.FOUNDRY_APP || (process.env.FOUNDRY_APP || String.raw`C:\Program Files\Foundry Virtual Tabletop\resources\app`))}/package.json`);
const Handlebars = require("handlebars");
const SETTINGS = read("templates", "parts", "actor-settings.hbs");
const SHEET = read("module", "sheets", "actor-character-sheet.mjs");
const settings = context => Handlebars.compile(SETTINGS)({ allies: [], editable: true, stateTriggers: [], combatWindow: {}, ...context });
const ofCharacter = settings({ isMinion: false, minionsList: [{ id: "saiba1", name: "Saibaman", img: "", theirs: false },
  { id: "saiba2", name: "Saibaman 2", img: "", theirs: true }] });
const ofMinion = settings({ isMinion: true, masterEntry: { id: "boss", name: "Nappa", img: "", theirs: true } });
const minionsOpen = settings({ isMinion: false, combatWindow: { minions: true }, minionPicks: [{ id: "saiba1", name: "Saibaman", on: true },
  { id: "saiba2", name: "Saibaman 2", on: true, locked: true, note: "from their sheet" }, { id: "saiba3", name: "Saibaman 3", on: false }] });
check("a Character's Settings: Allies and Minions side by side, each with Manage; the Minions added and taken off in its window - one named from the Minion's sheet marked",
  [ofCharacter.indexOf("<h3>Allies</h3>") < ofCharacter.indexOf("<h3>Minions</h3>"), ofCharacter.includes('data-window="minions"'),
   ofCharacter.includes("Saibaman 2") && ofCharacter.includes("from their sheet"), !ofCharacter.includes('data-action="addMinions"'),
   /data-action="pickMinion" data-id="saiba1" checked\s+\/>/.test(minionsOpen), /data-id="saiba2" checked\s+disabled/.test(minionsOpen),
   /data-action="pickMinion" data-id="saiba3"\s+\/>/.test(minionsOpen), !ofCharacter.includes("<h3>Master</h3>")],
  [true, true, true, true, true, true, true, true]);
check("a Minion's: its one Master beside the Allies, no list of its own; set in its window",
  [ofMinion.includes("<h3>Master</h3>"), ofMinion.includes("Nappa"), !ofMinion.includes("addMinions"), ofMinion.includes('data-window="master"'),
   settings({ isMinion: true, masterEntry: null, combatWindow: { master: true }, masterPicks: [{ id: "boss", name: "Nappa", on: false }] })
     .includes('data-action="pickMaster" data-id="boss"')], [true, true, true, true, true]);
check("one with a Master is changed by no list - not offered, not set over",
  [SHEET.includes("&& !listed.has(actor.id) && !masterOf(actor)"), SHEET.includes("if (masterOf(this.actor)) return ui.notifications.warn("),
   SHEET.includes('if (!mayBeMaster(this.actor)) return ui.notifications.warn("A Minion cannot be the Master of a Minion.");')],
  [true, true, true]);
const BIO = read("templates", "parts", "actor-biography.hbs");
check("no Minion checkbox on Biography any more, and no Karma on a Minion's",
  [BIO.includes('name="system.minion"'), /\{\{#unless isMinion\}\}(\{\{#unless isAdversary\}\})?\s*<div class="karma">/.test(BIO)], [false, true]);
check("the Combat tab's Steadfast boxes a Minion's: Injured alone - a Special Minion's all of them",
  SHEET.includes('.filter(({ key }) => DBUCharacterData.THRESHOLDS[key].counts && (!system.typicalMinion || (key === "injured")))'), true);

// --- In a Combat Encounter -------------------------------------------------------------------------------------------------------
const { whyNotMinionAttack } = await import(modUrl("maneuvers.mjs"));
const { getTrait } = await import(modUrl("effects/traits.mjs"));
const { compile } = await import(modUrl("effects/parser.mjs"));
const flagged = (type, flags = {}, attacks = 0) => ({ type, name: "Saibaman", system: { attacksThisRound: attacks },
  getFlag: (scope, key) => flags[key] });
globalThis.game.combat = { id: "fight", round: 3, started: true };
const attack = { attacking: true };
check("Minion Acts: no Attacking Maneuver without its Master's Command this Round; Single Attack: one a Round",
  [Boolean(whyNotMinionAttack(flagged("minion"), attack)), Boolean(whyNotMinionAttack(flagged("minion", { commanded: "fight:2" }), attack)),
   whyNotMinionAttack(flagged("minion", { commanded: "fight:3" }), attack),
   Boolean(whyNotMinionAttack(flagged("minion", { commanded: "fight:3" }, 1), attack)),
   whyNotMinionAttack(flagged("character"), attack), whyNotMinionAttack(flagged("minion"), { attacking: false })],
  [true, true, null, true, null, null]);
globalThis.game.combat = null;
check("out of a Combat Encounter, no turn to have an Act Phase in: not held",
  whyNotMinionAttack(flagged("minion"), attack), null);
check("asked where an attack is declared, before anything is paid",
  read("module", "use-maneuver.mjs").includes("const minionHeld = whyNotMinionAttack(actor, maneuver);"), true);
check("no Ultimate Signature Technique; never the Spectator State; Empower at most 1/5 of its Ki",
  [read("module", "technique-use.mjs").includes('if ((technique.ultimate || ascended) && actor.system?.minion && !minionMay) return'),
   /function neverEnters\(actor, key\) \{\s*if \(!actor\?\.system\?\.minion \|\| \(key !== "spectator"\)\) return false;/.test(read("module", "conditions.mjs")),
   read("module", "conditions.mjs").includes("if ((wanted > 0) && neverEnters(actor, key)) return false;")
     && read("module", "conditions.mjs").includes("if (neverEnters(actor, key)) return 0;"),
   read("module", "use-maneuver.mjs").includes("actor.system.minion ? Math.floor((Number(actor.system.ki.value) || 0) / 5) : Infinity")],
  [true, true, true, true]);

const command = getTrait("command");
check("Command: an Instant every Character has, compiling, its effect the verb that does it",
  [command?.type, command?.source, compile(command?.script ?? "").errors.length, command?.script?.includes("commandMinions();"),
   read("module", "effects", "verbs.mjs").includes("commandMinions: {"),
   read("module", "effects", "moments-runtime.mjs").includes('case "commandMinions": return (await import("../chat.mjs")).commandMinions(actor);')],
  ["instant", "Core Rule", 0, true, true, true]);
const CHAT = read("module", "chat.mjs");
const commandBody = CHAT.slice(CHAT.indexOf("export async function commandMinions(actor) {"), CHAT.indexOf("export async function spectatorCheer(actor) {"));
check("its Minions up to the Standard Actions left, those Actions lost, each Commanded this Round with a Counter Action more",
  [commandBody.includes("const yours = minionsOf(actor)"), commandBody.includes('const most = actionsLeft(actor, "standard");'),
   commandBody.includes("if (picked.length > most)"), commandBody.includes('if (!await spendActions(actor, picked.length, "standard")) return UNSPENT;'),
   commandBody.includes("[`flags.${SCOPE}.commanded`]: roundKey(),"),
   commandBody.includes('"system.actionsSpent.converted": (Number(minion.system?.actionsSpent?.converted) || 0) + 1')],
  [true, true, true, true, true, true]);
const COMBAT = read("module", "combat.mjs");
check("Follower: a Minion not Commanded skips its Act Phase - its turn's start had, then on to the next",
  [COMBAT.includes("if (followerSkips(first)) return combat.nextTurn();"), COMBAT.includes("if (followerSkips(arriving)) return combat.nextTurn();"),
   /function followerSkips\(actor\) \{[^}]*?if \(!isMinion\(actor\) \|\| commandedNow\(actor\) \|\| actsFreely\(actor\)\) return false;/.test(COMBAT),
   COMBAT.indexOf("if (followerSkips(arriving))") > COMBAT.indexOf("!await beginTurn(arriving)")],
  [true, true, true, true]);

// --- Special Minions, Duplicates, and the rest of the Minion Rules ------------------------------------------------------------
{
  const special = (() => {
    const parent = new ActorStub({}, { strict: false });
    parent.type = "minion";
    parent.items = [];
    parent.getFlag = () => undefined;
    const model = new DBUCharacterData({ powerLevel: 10, specialMinion: true }, { strict: false, parent });
    parent.system = model;
    model.prepareBaseData?.();
    model.prepareDerivedData();
    return model;
  })();
  check("Special Minions ignore the Weakness and Ki Points & Capacity rules - not the Life Points one",
    [special.typicalMinion, special.baseTierOfPower, special.ki.max === pc.ki.max, special.life.max, minion.typicalMinion],
    [false, 3, true, Math.ceil(pc.life.max / 4), true]);
  check("and the Thresholds rule: every Health Threshold theirs; a Duplicate a Special Minion",
    [TYPES.typicalMinion({ type: "minion", system: { specialMinion: true } }), TYPES.typicalMinion({ type: "minion", system: { duplicate: true } }),
     TYPES.typicalMinion({ type: "minion", system: {} }), TYPES.typicalMinion({ type: "character", system: {} }),
     TYPES.isDuplicate({ type: "minion", system: { duplicate: true } }), TYPES.isDuplicate({ type: "character", system: { duplicate: true } }),
     read("module", "chat.mjs").includes("isMinion(target)"),
     /counts && \(!system\.typicalMinion \|\| \(key === "injured"\)\)/.test(read("module", "sheets", "actor-character-sheet.mjs"))],
    [false, false, true, false, true, false, false, true]);

  const M = await import(modUrl("maneuvers.mjs"));
  globalThis.game.combat = { id: "fight", round: 3, started: true };
  const commanded = { commanded: "fight:3" };
  const minionOf = system => ({ type: "minion", name: "Saibaman", system: { attacksThisRound: 1, ...system }, getFlag: (s, k) => commanded[k] });
  check("Single Attack: a Special Minion's, a Duplicate's second attack this Round not held",
    [Boolean(M.whyNotMinionAttack(minionOf({}), { attacking: true })), M.whyNotMinionAttack(minionOf({ specialMinion: true }), { attacking: true }),
     M.whyNotMinionAttack(minionOf({ duplicate: true }), { attacking: true })], [true, null, null]);
  globalThis.game.combat = null;

  // A family: a Master, a Minion, a Duplicate - and a stranger with uses of their own.
  const items = list => Object.assign(list, { get: id => list.find(item => item.id === id) });
  const who = (id, type, system = {}, own = []) => ({ id, type, name: id, documentName: "Actor", items: items(own),
    system: { allies: [], minions: [], master: "", usedManeuvers: [], effects: { slots: {} }, baseTierOfPower: 2, ...system } });
  const barrier = id => ({ id, type: "maneuver", system: { unique: { libraryId: "barrier" } } });
  const master = who("master", "character", { minions: ["grunt", "copy"] }, [barrier("m-barrier")]);
  const grunt = who("grunt", "minion", {}, [barrier("g-barrier")]);
  const copy = who("copy", "minion", { duplicate: true });
  const stranger = who("stranger", "character", { usedManeuvers: ["round:feint"] });
  const everyone = [master, grunt, copy, stranger];
  globalThis.game.actors = { contents: everyone, get: id => everyone.find(each => each.id === id) };
  const feint = { id: "feint", name: "Feint", special: true, usageLimit: { amount: 1, per: "round" } };
  const analysis = { id: "analysis", name: "Analysis", special: true, usageLimit: { amount: 1, per: "round" } };
  const plain = { id: "combat-recovery", name: "Combat Recovery", special: false, usageLimit: { amount: 1, per: "encounter" } };
  check("Maneuvers of Minions: each one's line as printed - a Unique Ability's from its own file",
    [M.minionLine(master, feint), M.minionLine(master, analysis), M.minionLine(master, { id: "talk" }),
     M.minionLine(master, { id: "m-barrier", itemId: "m-barrier" }), M.minionLine(master, { id: "nothing-here" })],
    ["n/a", "free", "non-minion", "n/a", ""]);

  master.system.usedManeuvers = ["round:feint", "round:analysis", "encounter:combat-recovery", "round:m-barrier"];
  const barrierOf = actor => ({ id: actor.items[0]?.id, itemId: actor.items[0]?.id, name: "Barrier", usageLimit: { amount: 1, per: "round" } });
  check("Special Allowance: a Master's use of a Special Maneuver or a Unique Ability counts for their Minions - not a Free one's, nor a stranger's",
    [M.maneuverUsesLeft(grunt, feint), M.maneuverUsesLeft(grunt, analysis), M.maneuverUsesLeft(grunt, barrierOf(grunt)),
     M.maneuverUsesLeft(stranger, analysis), M.maneuverUsesLeft(master, feint)], [0, 1, 0, 1, 0]);
  check("and only Duplicates share every other [x/Encounter] limit with their Master",
    [M.maneuverUsesLeft(copy, plain), M.maneuverUsesLeft(grunt, plain)], [0, 1]);
  master.system.usedManeuvers = [];
  grunt.system.usedManeuvers = ["round:feint", "round:g-barrier"];
  check("and vice-versa: a Minion's use counts for its Master, and for the other Minions",
    [M.maneuverUsesLeft(master, feint), M.maneuverUsesLeft(copy, feint), M.maneuverUsesLeft(master, barrierOf(master))], [0, 0, 0]);

  check("Non-Minion: never a Minion's, a Special or Duplicate one's included; a Duplicate no Empower",
    [Boolean(M.whyNotMinionManeuver(grunt, { id: "talk", name: "Talk" })), Boolean(M.whyNotMinionManeuver(copy, { id: "talk", name: "Talk" })),
     M.whyNotMinionManeuver(master, { id: "talk", name: "Talk" }), Boolean(M.whyNotMinionManeuver(copy, { id: "empower", name: "Empower" })),
     M.whyNotMinionManeuver(grunt, { id: "empower", name: "Empower" })], [true, true, null, true, null]);
  check("a Duplicate's Unique Abilities and Special Maneuvers never at its Master - anything else, and anyone else's, may",
    [Boolean(M.whyNotAtMaster(copy, feint, [master])), M.whyNotAtMaster(copy, feint, [stranger]), M.whyNotAtMaster(copy, plain, [master]),
     M.whyNotAtMaster(grunt, feint, [master])], [true, null, null, null]);
  check("a Duplicate is not its Master's Ally, nor they its; a Minion still is",
    [ALLIES.areAllies(copy, master), ALLIES.areAllies(master, copy), ALLIES.areAllies(grunt, master)], [false, false, true]);
  check("Limited Control: one Minion in a Combat Encounter, a Talent's more; outside of one, that plus the base Tier of Power",
    [M.minionCaps(master), M.minionCaps(who("x", "character", { effects: { slots: { "minions.combat": { add: 1 } } }, baseTierOfPower: 3 }))],
    [{ combat: 1, outside: 3 }, { combat: 2, outside: 5 }]);

  const CHAT = read("module", "chat.mjs");
  const commandBody = CHAT.slice(CHAT.indexOf("export async function commandMinions(actor) {"), CHAT.indexOf("export async function spectatorCheer(actor) {"));
  check("Command: once a Combat Round on each Minion, those in the Encounter; the Master's orders noted for the Recovery Period",
    [commandBody.includes("const free = yours.filter(minion => !commandedNow(minion));"),
     commandBody.includes("(!fighting || fighting.has(minion.id))"), commandBody.includes('await actor.setFlag(SCOPE, "commandedRound", roundKey());')],
    [true, true, true]);
  const death = CHAT.slice(CHAT.indexOf("function deathButtons(message, card, subject, buttons) {"), CHAT.indexOf("async function deathByAttack(target) {"));
  check("Minion Defeat: no intent asked - its Master's Karma Point, asked of the Master's player, or killed",
    [death.indexOf("if (isMinion(subject)) {") < death.indexOf("if (!card.intent"),
     death.includes('if (!await (await import("./karma.mjs")).payKarma(master, 1, `Keep ${subject.name} alive`)) return;'),
     death.includes('enterState(subject, "dead", 1, null, "Minion Defeat")')], [true, true, true]);

  const COMBAT = read("module", "combat.mjs");
  const recovery = COMBAT.slice(COMBAT.indexOf("async function recoveryPeriods(combat) {"), COMBAT.indexOf("export async function dismissDuplicates("));
  check("Recovery Periods: a Master who gave no orders the Round that ended - their Minions in it, one roll of 1d8(T), on the Round's card",
    [recovery.includes('if (master.getFlag?.("dbu-ttrpg", "commandedRound") === ended) continue;'),
     recovery.includes("const roll = await new Roll(`${tier * times}d8`).evaluate();"),
     COMBAT.includes("const recovered = [...(((combat.round ?? 0) > 1) ? await recoveryPeriods(combat) : []), ...await markedMinionsBleed(combat), ...advantaged];"),
     COMBAT.includes('...(recovered.length ? { detail: recovered.join(" ") } : {})')], [true, true, true, true]);
  check("Duplicates cease to exist - deleted - at the Encounter's end, and as their Master leaves it",
    [/await dismissDuplicates\(\[\.\.\.here\.filter\(actor => actor\.system\?\.duplicate\)/.test(COMBAT),
     /Hooks\.on\("deleteCombatant"[\s\S]{0,400}?dismissDuplicates\(duplicatesOf\(actor\)\)/.test(COMBAT),
     COMBAT.includes("await world.delete();")], [true, true, true]);

  const USE = read("module", "use-maneuver.mjs");
  check("asked where a Maneuver is used",
    [USE.includes("const notForMinions = whyNotMinionManeuver(actor, maneuver);"), USE.includes("const atMaster = whyNotAtMaster(actor, maneuver,")],
    [true, true]);
  const kinds = settings({ isMinion: true, masterEntry: null, specialMinionShown: true, system: { duplicate: true } });
  check("Settings: a Minion's Special Minion and Duplicate boxes - a Duplicate's Special box ticked and left to it",
    [/name="system\.specialMinion" checked\s+disabled/.test(kinds), /name="system\.duplicate" checked/.test(kinds),
     settings({ isMinion: false, minionsList: [], minionCaps: { combat: 1, outside: 3 } }).includes("1 in combat &middot; 3 in all")],
    [true, true, true]);
}

// --- Making Minions, and what a Master's effects give them ----------------------------------------------------------------------
{
  const MAKE = await import(modUrl("minion-make.mjs"));
  const M = await import(modUrl("maneuvers.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const { programsFor } = await import(modUrl("effects/registry.mjs"));
  const source = {
    name: "Buu", img: "buu.webp", ownership: { default: 0, player1: 3 }, prototypeToken: { name: "Buu", actorLink: false, texture: { src: "buu.webp" } },
    system: { attributes: { force: { score: 5 } }, powerLevel: 12, size: "medium", race: "majin", progression: [{ lvl: 1 }],
      usedManeuvers: ["round:feint"], life: { value: 3 }, minions: ["x"], master: "", allies: ["y"], karma: 2 },
    items: [{ _id: "t1", type: "talent", name: "Lucky" }, { _id: "r1", type: "racial", name: "From Goop", system: { chosen: [{ value: "a" }] } },
      { _id: "m1", type: "maneuver", name: "Barrier" }, { _id: "g1", type: "gear", name: "Gi", system: { crafted: { kind: "apparel" } } },
      { _id: "g2", type: "gear", name: "Sword", system: { itemType: "weapon" } }, { _id: "g3", type: "gear", name: "Ring", system: { itemType: "accessory" } },
      { _id: "g4", type: "gear", name: "Senzu", system: { itemType: "basic" } }, { _id: "g5", type: "gear", name: "Pet", system: { itemType: "buddy" } }]
  };
  const buu = { id: "buu", name: "Buu", toObject: () => structuredClone(source) };
  const dup = MAKE.minionData(buu, { name: "Mini Buu", duplicate: true, sizeSteps: 1, kind: "mini-majin", made: "fight:2" });
  check("a Duplicate: a Minion of its Master, the same Scores, Progression and Race; nothing of their Encounter, Minions or Allies",
    [dup.type, dup.name, dup.system.master, dup.system.duplicate, dup.system.attributes.force.score, dup.system.powerLevel, dup.system.race,
     dup.system.progression.length, "usedManeuvers" in dup.system, "minions" in dup.system, "allies" in dup.system, "life" in dup.system,
     dup.ownership.player1, dup.prototypeToken.actorLink, dup.prototypeToken.texture.src, dup.flags["dbu-ttrpg"]],
    ["minion", "Mini Buu", "buu", true, 5, 12, "majin", 1, false, false, false, false, 3, true, "buu.webp", { minionKind: "mini-majin", madeAt: "fight:2" }]);
  check("its base Size Category a step smaller; its Talents, Racial Traits with their Options, Maneuvers, Apparel, Weapons, Accessories - not the rest; their ids kept",
    [dup.system.size, dup.items.map(item => item.name), dup.items.every(item => "_id" in item), dup.items[1].system.chosen[0].value,
     dup.items.filter(item => item.flags?.["dbu-ttrpg"]?.duplicated).map(item => item.name)],
    ["small", ["Lucky", "From Goop", "Barrier", "Gi", "Sword", "Ring"], true, "a", ["Gi", "Sword", "Ring"]]);
  const goop = MAKE.minionData(buu, { name: "Goop", duplicate: true, gear: false, kind: "goop" });
  const knight = MAKE.minionData(buu, { name: "Glass Knight", kind: "glass-knight" });
  const vassal = MAKE.minionData(buu, { name: "Dark Vassal", kind: "poko", system: { race: "namekian" } });
  check("a Goop without its creator's Apparel, Accessories or Weapons; any other Minion its name alone, its sheet the GM's",
    [goop.items.map(item => item.name), knight.items.length, knight.system.duplicate, knight.system.master, "attributes" in knight.system,
     vassal.system.race, MAKE.smallerSize("medium", 2), MAKE.smallerSize("nano", 1), MAKE.smallerSize("", 1)],
    [["Lucky", "From Goop", "Barrier"], 0, false, "buu", false, "namekian", "tiny", "nano", "small"]);

  // A Master with the gifts, prepared as Foundry does; a Minion of theirs prepared after.
  const masterActor = { id: "boss2", type: "character", name: "Boss", documentName: "Actor", system: { minions: [],
    effects: { slots: { "minions.combatRolls": { add: 3 }, "minions.soakValue": { add: 2 }, "minions.lifeMax": { add: 10 },
      "minions.lifePerLevel": { add: 2 }, "goops.lifePerLevel": { add: 2 } } } }, getFlag: () => undefined };
  globalThis.game.actors = { contents: [masterActor], get: id => (id === "boss2" ? masterActor : undefined) };
  const prepared = (flags = {}) => {
    const parent = new ActorStub({}, { strict: false });
    Object.assign(parent, { type: "minion", items: [], id: `m-${Math.random()}`, documentName: "Actor", getFlag: (scope, key) => flags[key] });
    const model = new DBUCharacterData({ powerLevel: 10, master: "boss2" }, { strict: false, parent });
    parent.system = model;
    model.prepareBaseData?.();
    model.prepareDerivedData();
    return model;
  };
  const gifted = prepared();
  const gooped = prepared({ minionKind: "goop" });
  check("your Minions: the Master's Combat Rolls and Soak Value theirs, as an effect named; the Life after its quarter, and for each Power Level",
    [gifted.minionGifts, gifted.life.max - minion.life.max, gooped.life.max - minion.life.max,
     gifted.effects.programs.some(entry => (entry.sourceId === "minion-gifts") && (entry.sourceName === "Master's effects")),
     gifted.combat.strike - minion.combat.strike],
    [{ combatRolls: 3, soakValue: 2, wound: 0, lifeMax: 10, lifePerLevel: 2, allows: [] }, 10 + 20, 10 + 40, true, 3]);
  check("Mini Minions: 1(T) off the Soak Value and 1(T) on the Defense Value for each Category more",
    [programsFor({ items: [] }, { miniMinions: 2 }).find(entry => entry.sourceId === "minion-gifts")?.sourceName,
     programsFor({ items: [] }, {}).some(entry => entry.sourceId === "minion-gifts")], ["Mini Minions", false]);

  const ALLY = await import(modUrl("allies.mjs"));
  const bondMaster = { id: "yard", type: "character", documentName: "Actor", system: { minions: [], effects: { slots: { "leadership.minionActs": true,
    "battleGoo.maneuvers": true } } }, getFlag: (s, k) => (k === "bonded" ? { uuid: "Actor.pal" } : undefined) };
  const pal = { id: "pal", uuid: "Actor.pal", type: "minion", documentName: "Actor", system: { master: "yard" }, getFlag: () => undefined };
  const other2 = { id: "oth", uuid: "Actor.oth", type: "minion", documentName: "Actor", system: { master: "yard" }, getFlag: () => undefined };
  const blob = { id: "blob", uuid: "Actor.blob", type: "minion", name: "Goop", documentName: "Actor", system: { master: "nobody" },
    getFlag: (s, k) => (k === "minionKind" ? "goop" : undefined) };
  const battleBlob = { ...blob, id: "bb", system: { master: "yard" } };
  globalThis.game.actors = { contents: [bondMaster, pal, other2, blob, battleBlob], get: id => [bondMaster, pal, other2, blob, battleBlob].find(a => a.id === id) };
  check("an Act Phase without the Command: a Goop's always; Spiritual Leadership (2)'s Minion Bonded to its Master",
    [ALLY.actsFreely(blob), ALLY.actsFreely(pal), ALLY.actsFreely(other2), ALLY.actsFreely(bondMaster)], [true, true, false, false]);
  check("a Goop: the Movement Maneuver alone - with Battle Goo (3), the Basic Attack and the Intervene too",
    [M.whyNotMinionManeuver(blob, { id: "movement" }), Boolean(M.whyNotMinionManeuver(blob, { id: "basic-attack", name: "Basic Attack" })),
     M.whyNotMinionManeuver(battleBlob, { id: "basic-attack" }), M.whyNotMinionManeuver(battleBlob, { id: "intervene" }),
     Boolean(M.whyNotMinionManeuver(battleBlob, { id: "feint", name: "Feint" }))], [null, true, null, null, true]);
  check("Ruler (1): no limit, 10 in a Combat Encounter not Defeated",
    M.minionCaps({ system: { effects: { slots: { "minions.ruler": true } } } }), { combat: 10, outside: Infinity, notDefeated: true });

  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const scripted = ["leader", "god-of-many", "spiritual-leadership", "marauding-captain", "battle-goo", "tuffle-parasite", "ruler",
    "leaders-insignia", "from-goop", "poko-priest-maneuver", "from-goop-sixth-effect"];
  check("every Trait that gives its Minions something, or makes them, compiles",
    scripted.map(id => [id, Boolean(getTrait(id)), compile(getTrait(id)?.script ?? "").errors.length]),
    scripted.map(id => [id, true, 0]));
  check("and says it: the Slots each writes",
    [getTrait("leader").script.includes("minions.combatRolls += 1(T);"), getTrait("leader").script.includes("minions.lifeMax += 5(bT);"),
     getTrait("battle-goo").script.includes("minions.combat += 2;"), getTrait("from-goop").script.includes("reabsorbGoops(1);\nsurge(healing);"),
     getTrait("from-goop-sixth-effect").script.includes("reabsorbGoops(0);"), getTrait("poko-priest-maneuver").script.includes("pokoMinion();")],
    [true, true, true, true, true, true]);

  const CHAT = read("module", "chat.mjs");
  const COMBAT = read("module", "combat.mjs");
  check("the effects that create Minions make them - on the GM's client, asked of it from a player's",
    [CHAT.includes('await requestMakeMinion(actor, { name: `Mini ${actor.name}`, duplicate: true, sizeSteps: 1, kind: "mini-majin" });'),
     CHAT.includes('await requestMakeMinion(actor, { name: `${actor.name}\'s Brood`, duplicate: true, sizeSteps: 1 + more, kind: "brood",'),
     CHAT.includes('if (copies) await requestMakeMinion(actor, { name: "Glass Copy", count: copies, duplicate: true, kind: "glass-copy" });'),
     CHAT.includes('await requestMakeMinion(actor, { name: "Yaki", count, kind: "yaki" });'),
     CHAT.includes('await requestMakeMinion(actor, { name: "Goop", duplicate: true, gear: false, kind: "goop",'),
     CHAT.includes('case "makeMinion": return import("./minion-make.mjs")'),
     CHAT.includes('game.socket.emit(CHANNEL, { type: "makeMinion", masterUuid: master.uuid, options });')],
    [true, true, true, true, true, true, true]);
  check("Duplicated Items destroyed as a Duplicate's Defeat settles, wherever it settles",
    [(CHAT.match(/destroyDuplicatedItems\(actor\)/g) ?? []).length, (COMBAT.match(/destroyDuplicatedItems\(actor\)/g) ?? []).length], [1, 1]);
  check("From Goop (8) as the Encounter ends; Battle Goo (3)'s Goop gone once it Intervened",
    [/fromGoop\.goop"\] === true\)\)\) \{[\s\S]{0,700}?Math\.floor\(left \/ 2\)/.test(COMBAT),
     COMBAT.includes('const spent = combatants(combat).filter(actor => actor.getFlag?.("dbu-ttrpg", "goopIntervened"));'),
     CHAT.includes('if (whyNotMinionManeuver(actor, { id: "intervene", name: "Intervene" })) continue;')], [true, true, true]);
  check("a Master changed, their Minions prepared again",
    ["updateActor", "createItem", "updateItem", "deleteItem"].map(hook => read("module", "dbu-ttrpg.mjs").includes(`Hooks.on("${hook}", `)
      && read("module", "dbu-ttrpg.mjs").includes("minionsRefresh(")), [true, true, true, true]);
}

// --- Brood Parent's Options, the Yaki, Mental Supercomputer -----------------------------------------------------------------------
{
  const ALLY = await import(modUrl("allies.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const { programsFor } = await import(modUrl("effects/registry.mjs"));
  const flagsOf = flags => (scope, key) => flags[key];
  const yard = { id: "yard2", uuid: "Actor.yard2", type: "character", documentName: "Actor",
    system: { minions: [], effects: { slots: { "yaki.bondedRolls": { add: 4 }, "yakiMaster.allBonded": true, "brood.drain": true } } },
    getFlag: flagsOf({}) };
  const yaki = { id: "yk", uuid: "Actor.yk", type: "minion", documentName: "Actor", system: { master: "yard2" }, getFlag: flagsOf({ minionKind: "yaki" }) };
  const brood = { id: "br", uuid: "Actor.br", type: "minion", documentName: "Actor", system: { master: "yard2" }, getFlag: flagsOf({ minionKind: "brood" }) };
  globalThis.game.actors = { contents: [yard, yaki, brood], get: id => [yard, yaki, brood].find(a => a.id === id) };
  const unbonded = ALLY.minionGifts(yaki).combatRolls;
  yard.getFlag = flagsOf({ bonded: { uuid: "Actor.someone" } });
  const elsewhere = ALLY.minionGifts(yaki).combatRolls;
  yard.getFlag = flagsOf({ bonded: { uuid: "Actor.yk" } });
  const toIt = ALLY.minionGifts(yaki).combatRolls;
  check("Yaki Swarm (3): a Yaki Bonded to its Master 1(T) higher; Yaki Master (1): every Yaki, its Master Bonded to nobody",
    [unbonded, elsewhere, toIt, ALLY.minionGifts(brood).combatRolls], [4, 0, 4, 0]);
  check("Draining Minions: a Brood Parent Minion has the Power Drain Maneuver - nobody else",
    [ALLY.minionGifts(brood).allows, ALLY.minionGifts(yaki).allows,
     programsFor({ items: [] }, { gifts: { combatRolls: 0, soakValue: 0, allows: ["maneuver.power-drain"] } })
       .some(entry => entry.sourceId === "minion-gifts")], [["maneuver.power-drain"], [], true]);
  const scripted = ["draining-minions", "consumable-minions-maneuver", "yaki-swarm", "yaki-master", "mental-supercomputer",
    "supercomputer-command-mark"];
  check("and every Trait it took compiles", scripted.map(id => [id, Boolean(getTrait(id)), compile(getTrait(id)?.script ?? "").errors.length]),
    scripted.map(id => [id, true, 0]));
  const CHAT = read("module", "chat.mjs");
  const COND = read("module", "effects", "conditions.mjs");
  check("Mental Supercomputer (3) on the Command's window, once a Round; Yaki Master (2), Consumable Minions as theirs; Yaki Swarm (2)'s Bond",
    [CHAT.includes('await markUntilNextTurn(minion, minion, "supercomputer-command-mark", tier, "end", "Mental Supercomputer");'),
     CHAT.includes('(actor.getFlag?.(SCOPE, "supercomputerCommandRound") !== roundKey())'),
     /export async function yakiMaster\(actor\) \{[\s\S]{0,900}?\[`flags\.\$\{SCOPE\}\.commanded`\]: roundKey\(\)/.test(CHAT),
     /export async function consumeBrood\(actor\) \{[\s\S]{0,2400}?Math\.ceil\([\s\S]{0,200}?\/ 4\)/.test(CHAT),
     COND.includes('&& (self.system?.effects?.slots?.["yaki.bond"] === true);')], [true, true, true, true, true]);
}

// --- Minion Creation ------------------------------------------------------------------------------------------------------------
{
  const D = DBUCharacterData;
  check("Minion PL: at 1 a Perk, 2 Attribute and 2 Talent Additions, a Skill Improvement; then a Perk a Level, an Attribute Addition more as the base Tier rises",
    [D.minionGrantsForLevel(1).slice().sort(), D.minionGrantsForLevel(2), D.minionGrantsForLevel(4), D.minionGrantsForLevel(5),
     D.minionGrantsForLevel(10), D.minionGrantsForLevel(30)],
    [["Attribute Addition", "Attribute Addition", "Character Perk", "Skill Improvement", "Talent Addition", "Talent Addition"],
     ["Character Perk"], ["Character Perk"], ["Character Perk", "Attribute Addition"], ["Character Perk", "Attribute Addition"],
     ["Character Perk", "Attribute Addition"]]);
  const table = D.buildDefaultProgression({ minion: true });
  const count = type => table.filter(row => row.stepType === type).length;
  check("its table: 30 Perks, 2 + 6 Attribute Additions, 2 Talent Additions, 1 Skill Improvement - a Character's as before",
    [count("Character Perk"), count("Attribute Addition"), count("Talent Addition"), count("Skill Improvement"),
     table.filter(row => row.lvl === 1).every(row => row.locked === (row.stepType !== "Character Perk")),
     D.buildDefaultProgression().length > table.length], [30, 8, 2, 1, true, true]);
  check("made at creation for a Minion - a Duplicate's copied from its Master",
    read("module", "dbu-ttrpg.mjs").includes('DBUCharacterData.buildDefaultProgression({ minion: actor.type === "minion" })'), true);

  const stepped = (() => {
    const parent = new ActorStub({}, { strict: false });
    Object.assign(parent, { type: "minion", items: [], getFlag: () => undefined });
    const model = new DBUCharacterData({ powerLevel: 10, minionLifeStep: true }, { strict: false, parent });
    parent.system = model;
    model.prepareBaseData?.();
    model.prepareDerivedData();
    return model;
  })();
  check("Step 11: 2 Life Points for every Power Level, after all calculation - its Settings box",
    [stepped.life.max - minion.life.max, /name="system\.minionLifeStep"/.test(settings({ isMinion: true, masterEntry: null, system: {} })),
     /name="system\.minionLifeStep"/.test(settings({ isMinion: true, masterEntry: null, system: { duplicate: true } }))], [20, true, false]);

  const { minionRacialUnfit } = await import(modUrl("racial.mjs"));
  const t = (id, importance, subrace = "") => ({ id, owner: "saiyan", importance, subrace, name: id });
  const made = { type: "minion", system: { race: "saiyan", duplicate: false } };
  const prim = t("p", "primary"), sec1 = t("s1", "secondary"), sec2 = t("s2", "secondary"), sec3 = t("s3", "secondary");
  const sub1 = t("u1", "primary", "elite"), sub2 = t("u2", "primary", "low");
  check("Step 2: Primary Racial Traits, and two Secondary - or one and a Subrace Trait; another race's and a Duplicate's not counted",
    [minionRacialUnfit(prim, made, [sec1, sec2]), minionRacialUnfit(sec2, made, [sec1]), Boolean(minionRacialUnfit(sec3, made, [sec1, sec2])),
     minionRacialUnfit(sub1, made, [sec1]), Boolean(minionRacialUnfit(sub2, made, [sub1])), Boolean(minionRacialUnfit(sec2, made, [sec1, sub1])),
     minionRacialUnfit(sec3, { type: "minion", system: { race: "saiyan", duplicate: true } }, [sec1, sec2]),
     minionRacialUnfit(sec3, { type: "character", system: { race: "saiyan" } }, [sec1, sec2]),
     minionRacialUnfit({ ...sec3, owner: "majin" }, made, [sec1, sec2])],
    ["", "", true, "", true, true, "", "", ""]);
  check("half the race's Skill Ranks (up) - asked where the slots are shown and where the Ranks are counted",
    [read("module", "races.mjs").includes("return minion ? Math.ceil(ranks / 2) : ranks;"),
     (read("module", "data", "actor-character.mjs").match(/\.\.\.this\.racialRanksHad\(\)/g) ?? []).length,
     (read("module", "sheets", "actor-character-sheet.mjs").match(/racialSkillRankCount\(this\.actor\.system\.race, this\.#minionMade\(\)\)/g) ?? []).length],
    [true, 2, 2]);

  const MAKE = await import(modUrl("minion-make.mjs"));
  const lord = { id: "lord", name: "Lord", toObject: () => ({ name: "Lord", system: { powerLevel: 14, attributes: { force: { score: 6 } } }, items: [] }) };
  const raw = MAKE.minionData(lord, { name: "Grunt" });
  check("made through Minion Creation: its Master's Power Level, nothing else of theirs",
    [raw.system.powerLevel, "attributes" in raw.system], [14, false]);
  const BOOT = read("module", "dbu-ttrpg.mjs");
  check("Growing Minions: a Power Level each time their Master does - set as they are tied, put back if set by hand",
    [/if \(!\("powerLevel" in system\) && !\("minions" in system\) && !\("master" in system\)\) return;/.test(BOOT),
     BOOT.includes('if ((Number(minion.system.powerLevel) || 1) !== level) await minion.update({ "system.powerLevel": level });'),
     read("templates", "parts", "actor-progression.hbs").includes("{{#if powerLevelFromMaster}}disabled")], [true, true, true]);
  check("Step 12: a Gear Kit's Device at its Master's base Tier of Power",
    read("module", "sheets", "actor-character-sheet.mjs").includes('<input type="number" name="tier" value="${kitTier}" min="1" step="1"/>'), true);
}

// --- Multi-Form Technique, Copy Clone, Super Ghost Kamikaze Attack ------------------------------------------------------------
{
  const MAKE = await import(modUrl("minion-make.mjs"));
  const M = await import(modUrl("maneuvers.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const { getTrait } = await import(modUrl("effects/traits.mjs"));
  const user = { id: "piccolo", name: "Piccolo", toObject: () => ({ name: "Piccolo", img: "p.webp", ownership: { player2: 3 },
    system: { powerLevel: 9, attributes: { magic: { score: 7 } } }, items: [] }) };
  const goku = { id: "goku", name: "Goku", toObject: () => ({ name: "Goku", img: "g.webp", ownership: { player9: 3 },
    prototypeToken: { texture: { src: "g.webp" } }, system: { powerLevel: 12, attributes: { force: { score: 9 } } },
    items: [{ _id: "k", type: "maneuver", name: "Kamehameha" }] }) };
  const clone = MAKE.minionData(user, { name: "Goku (Copy Clone)", duplicate: true, copy: goku, kind: "copy-clone" });
  check("Copy Clone: a Duplicate of the one targeted - their Scores, Items and look - its Master and its players the user's",
    [clone.system.master, clone.system.attributes.force?.score, clone.system.powerLevel, clone.items.map(item => item.name), clone.img,
     clone.ownership, clone.prototypeToken.texture.src], ["piccolo", 9, 12, ["Kamehameha"], "g.webp", { player2: 3 }, "g.webp"]);

  const cc = { itemId: "cc", name: "Copy Clone" };
  const caster = { type: "character", name: "Piccolo", system: { tierOfPower: 2 }, items: { get: id => ((id === "cc")
    ? { system: { unique: { libraryId: "copy-clone" } } } : null) } };
  check("its target a Character not at Long Range, no higher a Tier of Power; any other Unique Ability not asked",
    [M.whyNotCopyClone(caster, cc, { type: "character", name: "Krillin", system: { tierOfPower: 2 } }),
     Boolean(M.whyNotCopyClone(caster, cc, { type: "character", name: "Goku", system: { tierOfPower: 3 } })),
     Boolean(M.whyNotCopyClone(caster, cc, null)), M.whyNotCopyClone(caster, { itemId: "x", name: "Barrier" }, null)],
    [null, true, true, null]);
  check("Copy Clone: targets, compiles, makes its copy",
    [getTrait("copy-clone")?.requiresTarget, compile(getTrait("copy-clone")?.script ?? "").errors.length,
     getTrait("copy-clone")?.script?.includes("copyClone();")], [true, 0, true]);

  const ghost = (() => {
    const parent = new ActorStub({}, { strict: false });
    Object.assign(parent, { type: "minion", items: [], getFlag: (scope, key) => ((key === "minionKind") ? "kamikaze" : undefined) });
    const model = new DBUCharacterData({ powerLevel: 10, duplicate: true }, { strict: false, parent });
    parent.system = model;
    model.prepareBaseData?.();
    model.prepareDerivedData();
    return model;
  })();
  // A Duplicate keeps the Minion's quarter of the Life Points - Special Minions do not ignore that rule.
  check("a Kamikaze Ghost: a Duplicate with half its Life Points (down) - half the Minion's quarter", ghost.life.max, Math.floor(Math.ceil(pc.life.max / 4) / 2));

  // Counted down on its Master's Unique Ability as it is Defeated or ceases to be - once.
  const updates = [];
  const item = { id: "mf", system: { unique: { duplicates: 2 } }, update: async changes => updates.push(changes) };
  const lord = { id: "lord", type: "character", isOwner: true, documentName: "Actor", system: { minions: [] }, items: { get: id => ((id === "mf") ? item : null) } };
  let flags = { countedOn: { itemId: "mf", field: "duplicates" } };
  const split = { id: "split", type: "minion", documentName: "Actor", system: { master: "lord" }, getFlag: (scope, key) => flags[key],
    unsetFlag: async (scope, key) => { delete flags[key]; } };
  globalThis.game.actors = { contents: [lord, split], get: id => [lord, split].find(a => a.id === id) };
  await MAKE.countDown(split);
  await MAKE.countDown(split);
  item.system.unique.duplicates = 1;
  flags = { countedOn: { itemId: "mf", field: "duplicates" } };
  await MAKE.countDown(split);
  check("one fewer on its Master's Item, once; Multi-Form's row no longer Applied with none left",
    updates, [{ "system.unique.duplicates": 1 }, { "system.unique.duplicates": 0, "system.unique.applied": false }]);

  const CHAT = read("module", "chat.mjs");
  const COMBAT = read("module", "combat.mjs");
  check("Multi-Form and the Kamikaze make theirs, counted first; Steadfast failed or erased, Multi-Form's gone; a Ghost's blast its own",
    [/"system\.unique\.duplicates": now, "system\.unique\.applied": true \}\);[\s\S]{0,200}?requestMakeMinion\(actor, \{ name: actor\.name, count: plan\.count, duplicate: true, kind: "multi-form",/.test(CHAT),
     CHAT.includes('await requestMakeMinion(actor, { name: "Kamikaze Ghost", count: plan.count, duplicate: true, kind: "kamikaze",'),
     /export async function endMultiForm[\s\S]{0,700}?requestDismissDuplicates\(made\)/.test(CHAT),
     CHAT.includes('const offer = { actorUuid: bomber.uuid, actorName: bomber.name, maneuverId: "basic-attack"'),
     /await \(await import\("\.\/minion-make\.mjs"\)\)\.countDown\(world\);\s*const name = world\.name;\s*await world\.delete\(\);/.test(COMBAT),
     COMBAT.includes('&& !each.getFlag?.("dbu-ttrpg", "outsideCap")).map(each => each.id));')], [true, true, true, true, true, true]);
}

// --- Duplicates made right; Mirrored Attack's a real one ---------------------------------------------------------------------------
{
  const MAKE = await import(modUrl("minion-make.mjs"));
  const DUEL = await import(modUrl("duel.mjs"));
  const CHAT = read("module", "chat.mjs");
  const cutOut = name => {
    const from = CHAT.indexOf(name);
    const to = CHAT.indexOf("\n}\n", from) + 3;
    return CHAT.slice(from, to).replace(/^export /, "");
  };

  // Items keep their ids - what names one still does - and how the original's Triggered effects go comes along.
  const lord = { id: "lord", name: "Lord", toObject: () => ({ name: "Lord", img: "l.webp", ownership: { p1: 3 },
    flags: { "dbu-ttrpg": { automatic: ["apparelA#0", "talentB#1"], triggered: ["talentB#2"], commandedRound: "c:3" } },
    system: { powerLevel: 9, attributes: {} },
    items: [{ _id: "apparelA", type: "gear", name: "Coat", system: { crafted: { kind: "apparel" } } },
      { _id: "weaponW", type: "gear", name: "Blade", system: { itemType: "weapon", integratedWith: "apparelA" } },
      { _id: "talentB", type: "talent", name: "Tough", flags: { "dbu-ttrpg": { primaryOption: "two" } } }] }) };
  const dup = MAKE.minionData(lord, { duplicate: true, kind: "multi-form" });
  const grunt = MAKE.minionData(lord, { name: "Grunt" });
  check("a Duplicate's Items keep their ids (an Integrated Item's Apparel found), their Options; Automatic and asked copied - nothing of the Encounter",
    [dup.items.map(item => item._id), dup.items[1].system.integratedWith, dup.items[2].flags["dbu-ttrpg"].primaryOption,
     dup.flags["dbu-ttrpg"].automatic, dup.flags["dbu-ttrpg"].triggered, "commandedRound" in dup.flags["dbu-ttrpg"],
     "automatic" in grunt.flags["dbu-ttrpg"], "copied" in dup.flags["dbu-ttrpg"]],
    [["apparelA", "weaponW", "talentB"], "apparelA", "two", ["apparelA#0", "talentB#1"], ["talentB#2"], false, false, false]);
  const target = { id: "goku", name: "Goku", toObject: () => ({ name: "Goku", system: { powerLevel: 14 }, items: [] }) };
  check("Copy Clone's marked a copy of another - its Power Level not grown with its Master's, its input free",
    [MAKE.minionData(lord, { duplicate: true, copy: target }).flags["dbu-ttrpg"].copied,
     MAKE.minionData(lord, { duplicate: true, copy: target }).system.powerLevel,
     read("module", "dbu-ttrpg.mjs").includes('if (!master || !minion || minion.getFlag?.("dbu-ttrpg", "copied") || (minion.type === "fusion")) continue;'),
     read("module", "sheets", "actor-character-sheet.mjs").includes('&& !this.actor.getFlag?.("dbu-ttrpg", "copied");')],
    [true, 14, true, true]);
  const FIELDS = Object.keys(DBUCharacterData.defineSchema());
  check("every field a Duplicate copies is one a character has; what it leaves is the Encounter's, its Minion links or its story",
    [MAKE.DUPLICATED_FIELDS.filter(key => !FIELDS.includes(key)),
     FIELDS.filter(key => !MAKE.DUPLICATED_FIELDS.includes(key)).filter(key => !["life", "ki", "divineKi", "capacity", "instantPlayed",
       "attacksThisRound", "absoluteAttacksThisRound", "enteredEncounter", "hiddenFrom", "diminishingDefense", "superStacks",
       "dotStacks", "attackActionsThisTurn", "thresholdChecks", "armedTalents", "talentUses", "willingFailure", "momentum",
       "actionsSpent", "conditions", "states", "resources", "timed", "karma", "narrativeStamina", "inside", "battlefield", "transfigured", "delayed",
       "charging", "minions", "master", "specialMinion", "duplicate", "adversaryMinion", "duplicateOf", "minionLifeStep", "adventuring", "defeatsEscaped",
       "foresight", "grapple", "doffBonus", "usedManeuvers", "adventureUses", "riches", "reputation", "statDrain", "lastManeuver",
       "biography", "allies", "alliesHidden", "hideUnfitTraits", "hideRealValues", "fusion"].includes(key))], [[], []]);

  // Mirrored Attack, run: the attacker's Duplicate in its user's place, the Duel begun with it - or, none possible, a target.
  const edits = [], notes = [], dismissed = [];
  const userA = { uuid: "Actor.piccolo", name: "Piccolo" };
  const copyOf = { uuid: "Actor.copy", id: "copy", name: "Goku (Mirrored Attack)", system: { baseTierOfPower: 2 },
    items: { get: id => ((id === "kame") ? { id } : null) } };
  let flag = null;
  const message = { id: "m1", getFlag: () => flag };
  const take = new Function("game", "SCOPE", "ATTACK_FLAG", "ui", "fromUuidSync", "attackTargets", "mirroredInitiating", "settledNote",
    "requestEdit", "returnInitialWagers", "requestDismissDuplicates",
    `return (${cutOut("export async function mirrorTakesAttack")});`)(
    { messages: { get: id => ((id === "m1") ? message : null) } }, "dbu-ttrpg", "attack", { notifications: { warn: () => {} } },
    uuid => ((uuid === userA.uuid) ? userA : null),
    attack => attack.targets ?? [{ uuid: attack.targetUuid, name: attack.targetName }],
    new Function("profileFor", `return (${cutOut("function mirroredInitiating(")});`)(attack => ({ beam: { woundCriticalTarget: 9 } })[attack.profile]),
    async (msg, text) => notes.push(text), async (msg, edit) => edits.push(edit.attack), async () => [{ uuid: "Actor.goku", amount: 30 }],
    async list => dismissed.push(...list.map(each => each.id)));
  const mirror = { messageId: "m1", userUuid: userA.uuid, itemId: "cc" };
  flag = { attackerUuid: "Actor.goku", attackerName: "Goku", maneuverName: "Kamehameha", kiWager: 25, energyCharges: 3,
    profile: "beam", foundation: "energy", advantages: ["power-shot"], powerShotRanks: 1, technique: { itemId: "kame" },
    targets: [{ uuid: userA.uuid, name: "Piccolo", longRange: 0 }, { uuid: "Actor.krillin", name: "Krillin" }],
    defences: [{ uuid: userA.uuid, defence: "dodge" }], ready: [userA.uuid, "Actor.goku"] };
  await take(mirror, copyOf);
  const dueled = edits.at(-1);
  check("Mirrored Attack: the Duplicate takes its user's place - not hit, whoever wins - and Duels as the Initiator with the same Signature Technique, its own copy",
    [dueled.targets, dueled.defences, dueled.ready, dueled.kiWager, dueled.duel.initiatorUuid, dueled.duel.initiating,
     dueled.duel.originalWager, dueled.duel.mirror, dueled.duel.returned],
    [[{ uuid: "Actor.copy", name: "Goku (Mirrored Attack)", longRange: 0 }, { uuid: "Actor.krillin", name: "Krillin" }], [],
     ["Actor.goku"], 0, "Actor.copy", { kind: "technique", itemId: "kame", name: "Kamehameha", cost: 0, profile: "beam",
       foundation: "energy", advantages: ["power-shot"], charges: 3, powerShotRanks: 1, woundCriticalTarget: 9 },
     25, { userUuid: userA.uuid, itemId: "cc", duplicateUuid: "Actor.copy" }, [{ uuid: "Actor.goku", amount: 30 }]]);
  flag = { attackerUuid: "Actor.goku", attackerName: "Goku", maneuverName: "Basic Attack", kiWager: 0, energyCharges: 0,
    profile: "jab", foundation: "physical", targetUuid: userA.uuid, targetName: "Piccolo" };
  await take(mirror, copyOf);
  check("the Duel always (the user's ruling) - an attack too small for one too - mirrored with the same Profile where no Technique",
    [edits.at(-1).targets, edits.at(-1).targetUuid, edits.at(-1).duel?.initiatorUuid, edits.at(-1).duel?.initiating],
    [[{ uuid: "Actor.copy", name: "Goku (Mirrored Attack)" }], "Actor.copy", "Actor.copy",
     { kind: "profile", name: "Basic Attack", cost: 0, profile: "jab", foundation: "physical", advantages: [], charges: 0,
       powerShotRanks: 0, woundCriticalTarget: null }]);
  flag = { attackerUuid: "Actor.goku", targets: [{ uuid: userA.uuid }], result: { strike: 4 } };
  await take(mirror, copyOf);
  check("the attack gone on without it by the time it is made: it ceases to be", dismissed, ["copy"]);

  let room = 1;
  const whyNot = new Function("attackTargets", "fromUuidSync", "whyNotCopyClone", "isMinion", "minionRoom", "getRace", "racesOf",
    `return (${cutOut("function whyNotMirror(")});`)(attack => attack.targets ?? [], uuid => ((uuid === "Actor.goku") ? { name: "Goku" } : null),
    (actor, maneuver, target) => ((actor.tier < 3) ? `${maneuver.name}: ${target.name}'s Tier of Power is higher than ${actor.name}'s.` : null),
    TYPES.isMinion, () => room, () => null, who => [who?.system?.race].filter(Boolean));
  const me = { uuid: userA.uuid, name: "Piccolo", tier: 3 };
  const aimed = { attackerUuid: "Actor.goku", targets: [{ uuid: userA.uuid }] };
  check("offered to a target of the attack, before it resolves, no Duel on it, a Counter Action left - and Copy Clone's own limits",
    [whyNot(me, aimed, { id: "cc", name: "Copy Clone" }, 1), whyNot(me, { ...aimed, targets: [] }, null, 1),
     whyNot(me, { ...aimed, duel: {} }, null, 1), whyNot(me, aimed, null, 0), whyNot(me, { ...aimed, result: {} }, null, 1),
     whyNot({ ...me, tier: 2 }, aimed, { id: "cc", name: "Copy Clone" }, 1), whyNot({ ...me, type: "minion" }, aimed, null, 1),
     (() => { room = 0; const why = whyNot(me, aimed, null, 1); room = 1; return why; })()],
    ["", "only a target of this attack", "a Duel is already on this attack", "no Counter Actions left", "only before the attack resolves",
     "Copy Clone: Goku's Tier of Power is higher than Piccolo's.", "a Minion cannot create a Minion",
     "no room for another Minion (Limited Control)"]);

  const COMBAT = read("module", "combat.mjs");
  check("made on the GM's client, then put in place; its Clashes, wagers and Wound its own; gone as the attack concludes, ties, is escaped, or the turn moves on",
    [/requestMakeMinion\(actor, \{ name: `\$\{attack\.attackerName\} \(Mirrored Attack\)`, duplicate: true, copyOf: attack\.attackerUuid,/.test(CHAT),
     read("module", "minion-make.mjs").includes("if (options.mirror && made[0]) await (await import(\"./chat.mjs\")).mirrorTakesAttack(options.mirror, made[0]);"),
     /mirroredBy|bonusOf|outcome === "mirrored"/.test(CHAT),
     /await endFrozenTurn\(attacker\);\n  await mirrorEnds\(attack, message\);/.test(CHAT),
     /"The Duel tied" \}\);\n    await mirrorGone\(duel\);/.test(CHAT),
     /its Ki and its wager do not\.`\);\n  await mirrorGone\(attack\.duel\);/.test(CHAT),
     COMBAT.includes('const mirrored = combatants(combat).filter(actor => actor.getFlag?.("dbu-ttrpg", "mirrorOf"));'),
     (CHAT.match(/game\.socket\.emit\(CHANNEL, \{ type: "dismissDuplicates"/g) ?? []).length],
    [true, true, false, true, true, true, true, 1]);
}

// --- A Minion's Level 1 Skill Improvement: like any other (the user's) ------------------------------------------------------------
{
  const D = DBUCharacterData;
  const row = D.buildDefaultProgression({ minion: true }).find(entry => entry.choice === "Skill Improvement");
  const own = D.buildDefaultProgression().find(entry => (entry.lvl === 1) && (entry.choice === "Skill Improvement"));
  const made = (duplicate, progression) => {
    const parent = new ActorStub({}, { strict: false });
    Object.assign(parent, { type: "minion", items: [], getFlag: () => undefined });
    const model = new DBUCharacterData({ powerLevel: 1, duplicate, progression }, { strict: false, parent });
    parent.system = model;
    model.prepareBaseData?.();
    model.prepareDerivedData();
    return model;
  };
  // One kept from before, six Ranks long: four counted.
  const six = D.buildDefaultProgression({ minion: true }).map(entry => ((entry.choice === "Skill Improvement")
    ? { ...entry, skillRanks: ["athletics", "perception", "stealth", "insight", "survival", "medicine"] } : entry));
  const minion = made(false, six);
  const copy = made(true, D.buildDefaultProgression().map(entry => (((entry.lvl === 1) && (entry.choice === "Skill Improvement"))
    ? { ...entry, skillRanks: ["athletics", "athletics", "stealth", "insight", "survival", "medicine"] } : entry)));
  const level1 = model => model.progression.find(entry => (entry.lvl === 1) && (entry.choice === "Skill Improvement"));
  check("a Minion's: 4 Ranks, none twice, 15 TP - a Character's still 6, one twice, 25; a Duplicate's its Master's",
    [row.skillRanks.length, D.skillRankSlotsFor(row, true), D.isLevel1SkillImprovement(row, true), own.skillRanks.length,
     D.isLevel1SkillImprovement(own), level1(minion).technique, minion.rowSkillRanks(level1(minion)).length,
     level1(copy).technique, copy.rowSkillRanks(level1(copy)).length],
    [4, 4, false, 6, true, D.SKILL_IMPROVEMENT_TP, 4, D.SKILL_IMPROVEMENT_TP_LEVEL_1, 6]);
  const SHEET = read("module", "sheets", "actor-character-sheet.mjs");
  check("the sheet's slots, its window's pairs and its tally ask the same",
    [SHEET.includes("DBUCharacterData.skillRankSlotsFor(entry, this.#minionMade())"),
     SHEET.includes("DBUCharacterSheet.#skillBenefit(entry, ranksBeforeRow[index], SKILLS, false, this.#minionMade())"),
     SHEET.includes("DBUCharacterData.isLevel1SkillImprovement(entry, minion) ? DBUCharacterData.PAIRED_SKILL_RANKS_LEVEL_1 : 0"),
     SHEET.includes("for (const key of this.actor.system.rowSkillRanks?.(entry) ?? entry.skillRanks) {")], [true, true, true, true]);
}

// --- Minions cannot create Minions -------------------------------------------------------------------------------------------------
{
  const M = await import(modUrl("maneuvers.mjs"));
  const ua = library => ({ items: { get: id => ((id === "ua") ? { system: { unique: { libraryId: library } } } : null) } });
  const as = (type, extra = {}) => ({ type, name: "Grunt", system: { duplicate: true }, getFlag: () => undefined, ...extra });
  const makers = ["autonomous-glass-soldiers-first-effect", "brood-parent-first-effect", "mini-majin-first-effect",
    "poko-priest-maneuver", "yaki-swarm-first-effect"];
  check("a Maneuver that makes Minions - a Trait's that calls a verb that does, Multi-Form, the Kamikaze, Copy Clone - and none else",
    [makers.map(id => M.makesMinions({ items: { get: () => null } }, { id })),
     ["multi-form-technique", "super-ghost-kamikaze-attack", "copy-clone"].map(library => M.makesMinions(ua(library), { id: "x", itemId: "ua" })),
     M.makesMinions(ua("barrier"), { id: "x", itemId: "ua" }), M.makesMinions({ items: { get: () => null } }, { id: "basic-attack" })],
    [makers.map(() => true), [true, true, true], false, false]);
  check("refused a Minion - a Duplicate copying its Master's too - before anything is paid; a Character not",
    [Boolean(M.whyNotMinionManeuver(as("minion", ua("multi-form-technique")), { id: "x", itemId: "ua", name: "Multi-Form Technique" })),
     Boolean(M.whyNotMinionManeuver(as("minion", { items: { get: () => null } }), { id: "brood-parent-first-effect", name: "Brood" })),
     M.whyNotMinionManeuver(as("character", ua("multi-form-technique")), { id: "x", itemId: "ua", name: "Multi-Form Technique" })],
    [true, true, null]);
  const CHAT = read("module", "chat.mjs");
  check("and wherever else one is made: never by a Minion - Mirrored Attack not offered, From Goop's split not asked, the making refused",
    [/export async function requestMakeMinion\(master, options = \{\}\) \{\n  if \(!master\) return \[\];\n  \/\/ "Minions cannot create or be the Master of a Minion\."\n  if \(isMinion\(master\)\) \{/.test(CHAT),
     CHAT.includes('if (isMinion(actor)) return "a Minion cannot create a Minion";'),
     CHAT.includes('|| isMinion(actor)) return false;'),
     read("module", "minion-make.mjs").includes('if (!master || !game.user.isGM || isMinion(master)) return [];')],
    [true, true, true, true]);
}

// --- Limited Control kept by what makes Minions (the user's: refused) -----------------------------------------------------------------
{
  const M = await import(modUrl("maneuvers.mjs"));
  const flagged = flags => (scope, key) => flags[key];
  const boss = { id: "boss", type: "character", documentName: "Actor", name: "Boss", system: { baseTierOfPower: 2, minions: ["a", "b", "c"], effects: { slots: {} } },
    getFlag: () => undefined, items: { get: () => null } };
  const a = { id: "a", type: "minion", documentName: "Actor", system: { master: "boss" }, getFlag: flagged({}) };
  const b = { id: "b", type: "minion", documentName: "Actor", system: { master: "boss", defeated: true }, getFlag: flagged({}) };
  const c = { id: "c", type: "minion", documentName: "Actor", system: { master: "boss" }, getFlag: flagged({ outsideCap: true }) };
  const all = [boss, a, b, c];
  globalThis.game.actors = { contents: all, get: id => all.find(each => each.id === id) };
  const fight = ids => ({ combatants: ids.map(actorId => ({ actorId })) });
  globalThis.game.combats = { contents: [] };
  const outside = M.minionRoom(boss);
  globalThis.game.combats = { contents: [fight(["boss", "a"])] };
  const inOne = M.minionRoom(boss);
  globalThis.game.combats = { contents: [fight(["boss"])] };
  const noneIn = M.minionRoom(boss);
  boss.system.effects.slots = { "minions.combat": { add: 2 } };
  globalThis.game.combats = { contents: [fight(["boss", "a", "b"])] };
  const talent = M.minionRoom(boss);
  boss.system.effects.slots = { "minions.ruler": true };
  const ruler = M.minionRoom(boss);
  check("room for more: outside a Combat, 1 + base Tier less every Minion held; in one, its maximum less those in it; Mass Multi-Form's never counted; Ruler's Defeated not",
    [outside, inOne, noneIn, talent, ruler], [1, 0, 1, 1, 9]);
  boss.system.effects.slots = {};
  globalThis.game.combats = { contents: [fight(["boss", "a"])] };
  const ua = library => ({ ...boss, items: { get: id => ((id === "ua") ? { system: { unique: { libraryId: library } } } : null) } });
  check("refused before paid where none can be made - Multi-Form left to its own count, Mass Multi-Form outside the maximum; a Maneuver that makes none never",
    [Boolean(M.whyNoMinionRoom(boss, { id: "brood-parent-first-effect", name: "Brood" })),
     Boolean(M.whyNoMinionRoom(ua("copy-clone"), { id: "x", itemId: "ua", name: "Copy Clone" })),
     M.whyNoMinionRoom(ua("multi-form-technique"), { id: "x", itemId: "ua", name: "Multi-Form Technique" }),
     M.whyNoMinionRoom(boss, { id: "basic-attack", name: "Basic Attack" })], [true, true, null, null]);
  globalThis.game.combats = { contents: [] };
  const CHAT = read("module", "chat.mjs");
  const USE = read("module", "use-maneuver.mjs");
  check("asked where it is used, Multi-Form's own count, the Kamikaze's Ghosts, the Yaki and Glass Knights offered, From Goop's Goop - and the making never past it",
    [/const noRoom = whyNoMinionRoom\(actor, maneuver\);\n  if \(noRoom\) \{/.test(USE),
     USE.includes("const capped = mass ? Infinity : minionRoom(actor);"),
     CHAT.includes("const doubles = boughtTraits(unique, getTrait).some(trait => trait.ghostsDouble === true) && (room >= 2 * actions);"),
     CHAT.includes("[{ value: \"1\", label: `1 Yaki - ${each} Ki` }, { value: \"2\", label: `2 Yaki - ${2 * each} Ki` }].slice(0, room)"),
     CHAT.includes("const most = Math.min(2, Math.floor(ki / step), room);"),
     CHAT.includes("  if (minionRoom(actor) < 1) return false;"),
     /if \(!options\.extra\?\.outsideCap\) \{\n    const room = minionRoom\(master\);/.test(CHAT)], [true, true, true, true, true, true, true]);
}

// --- On their Master's side: no Allies for an effect, never Opponents ---------------------------------------------------------------
{
  const ALLY = await import(modUrl("allies.mjs"));
  const actorAt = (id, type, system = {}) => ({ documentName: "Actor", id, type, system: { allies: [], minions: [], ...system } });
  const lord = actorAt("lord", "character", { allies: ["pal"] });
  const pal = actorAt("pal", "character", { allies: ["lord"] });
  const foe = actorAt("foe", "character");
  const copy = actorAt("copy", "minion", { master: "lord", duplicate: true });
  const twin = actorAt("twin", "minion", { master: "lord", duplicate: true });
  const grunt = actorAt("grunt", "minion", { master: "lord" });
  const theirs = actorAt("theirs", "minion", { master: "foe", duplicate: true });
  const all = [lord, pal, foe, copy, twin, grunt, theirs];
  globalThis.game.actors = { contents: all, get: id => all.find(each => each.id === id) };
  check("a Duplicate: no Ally of its Master for any effect, yet never their Opponent - nor its fellow Minions'; another Master's an Opponent",
    [ALLY.areAllies(copy, lord), ALLY.areOpponents(copy, lord), ALLY.areOpponents(lord, copy), ALLY.areOpponents(copy, twin),
     ALLY.areOpponents(copy, grunt), ALLY.areAllies(grunt, lord), ALLY.areOpponents(grunt, lord), ALLY.areOpponents(copy, foe),
     ALLY.areOpponents(copy, theirs), ALLY.areOpponents(lord, foe), ALLY.areOpponents(lord, pal), ALLY.areOpponents(lord, lord)],
    [false, false, false, false, false, true, false, true, true, true, false, true]);
  const CH = read("module", "chat.mjs"), UM = read("module", "use-maneuver.mjs"), COND = read("module", "effects", "conditions.mjs");
  check("what asks for an Opponent asks areOpponents; what asks for an Ally still the Allies (healing them, 'you or an Ally', United Attack)",
    [CH.includes("const struckOpponents = struck.filter(({ actor: hit }) => areOpponents(hit, attacker));"),
     read("module", "guidance.mjs").includes("&& areOpponents(token.actor, actor) && ((gapBetween("),
     UM.includes('if ((side === "opponent") && !areOpponents(targetActor, actor)) {'),
     COND.includes("if ((knocker.uuid !== self.uuid) && !areAllies(knocker, self)) return false;"),
     CH.includes('const heal = (actor.system.effects?.slots?.["glassification.healAllies"] === true) && areAllies(target, actor);'),
     read("module", "united-attack.mjs").includes("if (attacker && !areAllies(joiner, attacker)) return")], [true, true, true, true, true, true]);
}

// --- A Minion has its Master's Allies (the user's default) ---------------------------------------------------------------------------
{
  const ALLY = await import(modUrl("allies.mjs"));
  const actorAt = (id, type, system = {}) => ({ documentName: "Actor", id, type, system: { allies: [], minions: [], ...system } });
  const goku = actorAt("goku", "character", { allies: ["krillin"] });
  const krillin = actorAt("krillin", "character");
  const foe = actorAt("foe", "character");
  const copy = actorAt("copy", "minion", { master: "goku", duplicate: true });
  const twin = actorAt("twin", "minion", { master: "goku", duplicate: true });
  const grunt = actorAt("grunt", "minion", { master: "goku" });
  const pet = actorAt("pet", "minion", { master: "krillin" });
  const goon = actorAt("goon", "minion", { master: "foe" });
  const all = [goku, krillin, foe, copy, twin, grunt, pet, goon];
  globalThis.game.actors = { contents: all, get: id => all.find(each => each.id === id) };
  const A = ALLY.areAllies;
  check("a Minion's Allies its Master's - the listed, their other Minions, those Allies' Minions; never a Duplicate's own Master, nor a stranger",
    [A(grunt, krillin), A(krillin, grunt), A(copy, krillin), A(krillin, copy), A(copy, grunt), A(grunt, copy), A(grunt, pet), A(pet, goku),
     A(copy, goku), A(goku, copy), A(copy, twin), A(grunt, foe), A(goon, krillin), A(goon, grunt), A(grunt, goku)],
    [true, true, true, true, true, true, true, true, false, false, false, false, false, false, true]);
  krillin.system.allies = [];
  goku.system.allies = [];
  check("read as they stand: the Master's Ally gone, gone for their Minions too", [A(grunt, krillin), A(copy, krillin)], [false, false]);
}

// --- The Allies no list names, shown on Settings ---------------------------------------------------------------------------------------
{
  const SHEET = read("module", "sheets", "actor-character-sheet.mjs");
  const from = SHEET.indexOf("  #prepareAllies() {");
  const body = SHEET.slice(from, SHEET.indexOf("\n  }\n", from) + 4).replace("  #prepareAllies() {", "function prepareAllies() {")
    .replace("DBUCharacterSheet.#inheritedNote(", "inheritedNote(");
  const noteFrom = SHEET.indexOf("  static #inheritedNote(actor, master) {");
  const note = SHEET.slice(noteFrom, SHEET.indexOf("\n  }\n", noteFrom) + 4).replace("  static #inheritedNote(actor, master) {", "function inheritedNote(actor, master) {");
  const ALLY = await import(modUrl("allies.mjs"));
  const actorAt = (id, type, system = {}) => ({ documentName: "Actor", id, type, name: id, img: "", system: { allies: [], minions: [], ...system },
    testUserPermission: () => true });
  const goku = actorAt("goku", "character", { allies: ["krillin"] });
  const krillin = actorAt("krillin", "character");
  const grunt = actorAt("grunt", "minion", { master: "goku" });
  const copy = actorAt("copy", "minion", { master: "goku", duplicate: true });
  const pet = actorAt("pet", "minion", { master: "krillin" });
  const all = [goku, krillin, grunt, copy, pet];
  const game = { user: { isGM: true }, actors: { contents: all, get: id => all.find(each => each.id === id) } };
  globalThis.game.actors = game.actors;
  const run = actor => new Function("game", "masterOf", "minionsOf", "areAllies", `${note}\n${body}\nreturn prepareAllies;`)(
    game, ALLY.masterOf, ALLY.minionsOf, ALLY.areAllies).call({ actor })
    .map(entry => [entry.id, entry.inherited ? entry.note : (entry.theirs ? "theirs" : "own")]);
  check("Settings shows the Allies no list names, marked and not taken off: a Minion's Master's Allies and Minions, an Ally's Minions - its Master and own Minions on their panel",
    [run(grunt), run(copy), run(krillin), run(goku)],
    [[["copy", "Master's Minion"], ["krillin", "Master's Ally"], ["pet", "an Ally's Minion"]],
     [["grunt", "Master's Minion"], ["krillin", "Master's Ally"], ["pet", "an Ally's Minion"]],
     [["copy", "an Ally's Minion"], ["goku", "theirs"], ["grunt", "an Ally's Minion"]],
     [["krillin", "own"], ["pet", "an Ally's Minion"]]]);
  check("its line: the reason, its hover - no ✕, no eye", read("templates", "parts", "actor-settings.hbs")
    .includes('{{#if ally.inherited}}<span class="dbu-temp" data-tooltip="{{ally.why}}">{{ally.note}}</span>'), true);
}

// --- Minion Races ------------------------------------------------------------------------------------------------------------------
{
  const RACES = await import(modUrl("races.mjs"));
  const RACIAL = await import(modUrl("racial.mjs"));
  const keep = foundry.utils.fetchJsonWithTimeout;
  foundry.utils.fetchJsonWithTimeout = async url => JSON.parse(read("races", String(url).split("/races/")[1]));
  await RACES.loadRaces();
  foundry.utils.fetchJsonWithTimeout = keep;
  const MINION_RACES = ["alien", "animal", "arlian", "creature", "oni", "robot", "saibaman", "tuffle", "zooner"];
  check("the nine Minion Races, each a Minion Race - the others not",
    [MINION_RACES.map(id => RACES.isMinionRace(id)), ["saiyan", "earthling", "neo-tuffle"].map(id => RACES.isMinionRace(id))],
    [MINION_RACES.map(() => true), [false, false, false]]);
  check("their numbers as the site gives them: Racial Life Modifier, Skill Ranks, Saving Throw",
    MINION_RACES.map(id => [RACES.racialLifeModifier(id), RACES.racialSkillRankCount(id), RACES.racialSavingThrows(id).join()]),
    [[1, 2, ""], [2, 0, "impulsive"], [2, 2, "corporeal"], [3, 0, "corporeal"], [2, 3, "corporeal"], [3, 1, "corporeal"],
     [1, 0, "impulsive"], [-2, 3, "cognitive"], [0, 2, "impulsive"]]);
  const order = Object.keys(DBUCharacterData.SIZES);
  check("Minion Size: each its own selection - the usual Small to Large for the rest",
    [RACES.racialSizes("saibaman", order), RACES.racialSizes("oni", order), RACES.racialSizes("robot", order),
     RACES.racialSizes("creature", order).length, RACES.racialSizes("saiyan", order)],
    [["small"], ["small", "medium", "large", "enormous"], ["tiny", "small", "medium", "large", "enormous"], order.length, null]);

  const at = (type, race, system = {}) => {
    const parent = new ActorStub({}, { strict: false });
    parent.type = type;
    parent.items = [];
    parent.getFlag = () => undefined;
    const model = new DBUCharacterData({ powerLevel: 10, race, ...system }, { strict: false, parent });
    parent.system = model;
    model.prepareBaseData?.();
    model.prepareDerivedData();
    return model;
  };
  const full = race => at("character", race).life.max;
  check("as a Minion, a Minion Race's Life Points 1/2 rather than 1/4 - rounded up as the Minion Rules' are; a Character's whole",
    [at("minion", "saibaman").life.max, at("minion", "robot").life.max, at("minion", "saiyan").life.max,
     at("character", "saibaman").life.max],
    [Math.ceil(full("saibaman") / 2), Math.ceil(full("robot") / 2), Math.ceil(full("saiyan") / 4), full("saibaman")]);
  check("built within the race's Sizes: a Saibaman left at Medium is Small; a Robot Tiny stays; a Saiyan as before",
    [at("character", "saibaman").size.key, at("minion", "saibaman", { size: "large" }).size.chosen,
     at("character", "robot", { size: "tiny" }).size.key, at("character", "robot", { size: "colossal" }).size.key,
     at("character", "saiyan", { size: "tiny" }).size.key, at("character", "creature", { size: "colossal" }).size.key],
    ["small", "small", "tiny", "enormous", "tiny", "colossal"]);
  const saves = model => Object.entries(model.savingThrows).filter(([, save]) => save.racial).map(([key]) => key);
  check("the Aliens' 'Saving Throw: Any (select one)': the one picked, none until it is; their Attributes any 3 by 1",
    [saves(at("character", "alien", { racialSavingThrow: "morale" })), saves(at("character", "alien")),
     saves(at("character", "saiyan", { racialSavingThrow: "morale" })), RACES.racialSavingThrowChosen("alien"),
     RACES.racialAttributeChoices("alien")],
    [["morale"], [], ["corporeal"], true, [1, 1, 1].map(amount => ({ amount, options: "any" }))]);
  const minionOf = race => ({ type: "minion", system: { race } });
  const trait = (id, owner, importance) => ({ id, owner, importance, kind: "races" });
  const held = race => [trait("a", race, "secondary"), trait("b", race, "secondary")];
  check("a Minion Race keeps all its Racial Traits - a Minion of another race still two Secondary at most",
    [RACIAL.minionRacialUnfit(trait("c", "saibaman", "secondary"), minionOf("saibaman"), held("saibaman")),
     RACIAL.minionRacialUnfit(trait("c", "saiyan", "secondary"), minionOf("saiyan"), held("saiyan"))],
    ["", "A Minion has two Secondary Racial Traits, or one and a Subrace Trait, at most"]);
  const SHEET = read("module", "sheets", "actor-character-sheet.mjs");
  const PROG = read("templates", "parts", "actor-progression.hbs");
  check("the sheet offers the race's own Sizes and the Saving Throw to pick; the Racial Grants shown for any grant, the Ranks' row for Ranks",
    [SHEET.includes(".filter(([key, definition]) => (own ? own.includes(key) : definition.selectable) || (key === built))"),
     PROG.includes('<select name="system.racialSavingThrow">'), PROG.includes("{{#if racialGrants}}"),
     SHEET.includes("context.racialGrants = Boolean(context.racialSkillRanks.length || context.racialAttributeChoices.length || context.racialSavingThrow);"),
     read("module", "minion-make.mjs").includes('"racialAttributeChoices", "racialSavingThrow",')], [true, true, true, true, true]);
}

console.log(failed ? `\n${failed} failing` : "\n0 failing");
process.exit(failed ? 1 : 0);
