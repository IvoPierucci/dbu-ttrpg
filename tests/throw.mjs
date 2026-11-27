/**
 * The Throw Maneuver: what is thrown, the attack it is, and what it does on a hit.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
const APP = (process.env.FOUNDRY_APP || String.raw`C:\Program Files\Foundry Virtual Tabletop\resources\app`);
const appUrl = p => pathToFileURL(path.join(APP, p)).href;
const modUrl = p => pathToFileURL(path.join(ROOT, "module", p)).href;

globalThis.CONST = {};
globalThis.foundry = {};
await import(appUrl("common/primitives/_module.mjs"));
globalThis.foundry.utils = { ...await import(appUrl("common/utils/_module.mjs")) };
globalThis.foundry.data = { ...await import(appUrl("common/data/_module.mjs")) };
globalThis.foundry.data.operators = { ForcedReplacement: { create: value => value } };
const { default: DataModel } = await import(appUrl("common/abstract/data.mjs"));
globalThis.foundry.abstract = { DataModel, TypeDataModel: DataModel };
globalThis.ui = { notifications: { warn: () => {}, error: () => {}, info: () => {} } };
globalThis.Handlebars = { escapeExpression: String };
globalThis.game = { combat: null, users: { activeGM: null } };

const TRAITS = path.join(ROOT, "traits");
globalThis.foundry.utils.fetchJsonWithTimeout = async () =>
  JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));
globalThis.fetch = async url => {
  const file = path.join(TRAITS, String(url).replace("systems/dbu-ttrpg/traits/", ""));
  if (!fs.existsSync(file)) return { ok: false, status: 404, statusText: "missing" };
  return { ok: true, status: 200, text: async () => fs.readFileSync(file, "utf8") };
};

const { loadTraits, getTrait, printedLines } = await import(modUrl("effects/traits.mjs"));
const { default: DBUCharacterData } = await import(modUrl("data/actor-character.mjs"));
const { programsFor } = await import(modUrl("effects/registry.mjs"));
const { gearItemFrom, typeOf } = await import(modUrl("gear.mjs"));
const { default: DBUGearData } = await import(modUrl("data/item-gear.mjs"));
const { PROFILES: PROFILES_ALL } = await import(modUrl("maneuvers.mjs"));
await loadTraits();

const INDEX = JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

/** The least a parent can be and still be one the base class accepts. */
class ActorStub extends DataModel {
  static defineSchema() { return {}; }
}

// Built up past Power Level 1, so the base Tier is more than 1 and a (bT) that was read as
// a flat 1 shows.
function progressionTo(powerLevel) {
  const rows = [
    { lvl: 1, choice: "Skill Improvement", locked: true, attributes: {},
      skillRanks: ["perception", "perception"] }
  ];
  for (let lvl = 2; lvl <= powerLevel; lvl++) {
    rows.push({ lvl, choice: "Attribute Addition", locked: false,
      attributes: { insight: 1, agility: 1 }, skillRanks: [] });
  }
  return rows;
}

/** The character every check here is about. */
const ME = "Actor.me";

/** A character holding these Items, run through every phase. */
function holding(items, { powerLevel = 30, conditions = {}, states = {}, tierOfPowerModifier = 0 } = {}) {
  const parent = new ActorStub({}, { strict: false });
  parent.items = items;
  // Whose it is, for an Item made for somebody - the Eyeglasses.
  parent.uuid = ME;
  const model = new DBUCharacterData(
    { powerLevel, progression: progressionTo(powerLevel), conditions, states, tierOfPowerModifier },
    { parent, strict: false });
  parent.system = model;
  model.prepareBaseData?.();
  model.prepareDerivedData();
  return model;
}

/** A character's copy of a file, worn or not. */
let made = 0;
function given(id, { equipped = true, storedIn = "" } = {}) {
  const data = gearItemFrom(getTrait(id), null);
  made++;
  return { ...data, id: `item${made}`, uuid: `Actor.a.Item.item${made}`,
    system: { ...data.system, equipped, storedIn } };
}

// =================================================================================================
// The Throw Maneuver.
// =================================================================================================
const { loadManeuvers, getManeuver } = await import(modUrl("maneuvers.mjs"));
await loadManeuvers();
const { coreManeuverItems } = await import(modUrl("use-maneuver.mjs"));
const { thrownAs, throwables, craftedItemFrom } = await import(modUrl("gear.mjs"));
const { hardnessValue, HARDNESS_RANKS } = await import(modUrl("features.mjs"));
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");
const USE = read("module", "use-maneuver.mjs");
const CHAT = read("module", "chat.mjs");
const ITEM = read("module", "data", "item-maneuver.mjs");

// --- The Maneuver -----------------------------------------------------------------------------------
{
  const throwing = getManeuver("throw");
  check("the Throw Maneuver is there", Boolean(throwing), true);
  check("a Standard Attacking Maneuver of the Simple Profile, once a Round, 1 Action, no KP, at a target",
    [throwing?.type, throwing?.usageLimit, throwing?.actionCost,
     throwing?.kiCost, throwing?.attacking, throwing?.requiresTarget, throwing?.profile, throwing?.throws],
    ["standard", { amount: 1, per: "round" }, 1, 0, true, true, "simple", true]);
  const lines = printedLines(getTrait("throw")?.text);
  check("the entry, as printed: its lines and its four paragraphs",
    [lines[0], lines[1], lines[2], lines[3], lines[4], lines.filter(line => line === "").length],
    ["Throw Maneuver [1/Round]: Throw an object you have on your person or in your hands.",
     "–Maneuver Type: Standard", "–Action Cost: 1 Action", "–KP Cost: N/A", "–Exploitable: N/A", 3]);
  check("and its last word on the Ki Wager",
    lines.at(-1), "You cannot Ki Wager more than 1/4 (rounded up) of your Ki Points on an Attacking "
      + "Maneuver made through the Throw Maneuver.");
  check("in the index, and a Core Maneuver every character is given",
    [INDEX.traits.includes("maneuvers/throw.dbu"),
     coreManeuverItems().some(item => item.system?.maneuverId === "throw" && item.system?.throws)],
    [true, true]);
  check("which the Item keeps", ITEM.includes("throws: new fields.BooleanField"), true);
}

// --- What is thrown ------------------------------------------------------------------------------
{
  const capsule = given("capsule", { equipped: false });
  const loose = given("net", { equipped: false });
  const inside = given("net", { equipped: false, storedIn: capsule.id });
  const worn = given("helmet", { equipped: true });
  const apparel = craftedItemFrom("apparel", null, getTrait);
  const onLayer = { ...apparel, id: "gi", name: "Gi", type: "gear",
    system: { ...apparel.system, equipped: true, layer: "top" } };
  const offLayer = { ...apparel, id: "coat", name: "Coat", type: "gear", system: { ...apparel.system } };
  const items = [capsule, loose, inside, worn, onLayer, offLayer];
  check("whatever they hold: not what they wear, nor what is in a Capsule",
    throwables(items).map(item => item.id).sort(), [capsule.id, loose.id, offLayer.id].sort());

  check("a Basic Item is Rank 1", [thrownAs(loose, null, getTrait).rank, thrownAs(loose, null, getTrait).value],
    [1, null]);
  check("a Weapon Rank 2", thrownAs({ id: "w", name: "Sword", system: { itemType: "weapon" } }, null, getTrait).rank,
    2);
  check("Apparel is read as a Basic Item, unless its Effects set its Hardness Value",
    [thrownAs(offLayer, null, getTrait).rank, thrownAs(offLayer, null, getTrait).value,
     thrownAs({ ...offLayer, system: { ...offLayer.system, crafted: { ...offLayer.system.crafted,
       effects: "[passive]\npiece.hardnessValue = 7;" } } }, null, getTrait).value], [1, null, 7]);

  const escape = [...USE.matchAll(/HARDNESS_RANKS\.filter\(hardness => hardness\.rank > 0\)/g)].length;
  check("or a Feature, at the Hardness Rank the player gives it - never 0", escape, 1);
  check("asked before the attack is declared, and putting it away stops the Maneuver",
    [USE.indexOf("thrown = presetThrown ?? await askThrown(actor, maneuver);")
      < USE.indexOf("declared = await declareAttack(locked, foundationsOffered, actor,"),
     USE.includes("    thrown = presetThrown ?? await askThrown(actor, maneuver);\n    if (!thrown) return false;")],
    [true, true]);
}

// --- The attack -------------------------------------------------------------------------------------
{
  check("its Ki Wager at most 1/4 of the Ki Points they have, rounded up",
    USE.includes("maneuver.throws ? { wagerCap: Math.ceil((actor.system.ki?.value ?? 0) / 4) } : {}"), true);
  check("not held to the Melee Range: any number of Squares",
    // Area Wipe's own since (a Villainous Maneuver): "no matter how many Squares they are away from you".
    USE.includes('let outOfReach = targetActor && !maneuver.throws && !unbounded && !["area-wipe", "planet-burst"].includes(maneuver.id)\n      && whyNotInReach('), true);
  check("what is thrown travels with the attack, with an Area and a Damage Attribute of its own where it has one",
    [USE.includes("declared = { ...declared, thrown,"),
     CHAT.includes("advantages = [], squaresCharged = 0, thrown = null,\n                                   area = null, weapon = null,"),
     /\n          thrown,\n/.test(CHAT), CHAT.includes("area: greedArea(overwhelmedArea(sizedArea(actor, target, technique ? (technique.area ?? (areaAdded ? area : null)) : (area ?? PROFILES[profile]?.area ?? null),")], [true, true, true, true]);
  check("every reader of an attack's Area reads one it brings for itself",
    [(CHAT.match(/profileFor\(attack\)\?\.area/g) ?? []).length,
     CHAT.includes("return attack?.area ?? PROFILES[attack?.profile]?.area ?? null;")], [0, true]);
  check("the Grenade is gone once the attack is made",
    USE.includes("if (thrown?.destroyed && card) await actor.items.get(thrown.itemId)?.delete();"), true);
}

// --- On a hit -------------------------------------------------------------------------------------
{
  const hook = CHAT.slice(CHAT.indexOf("// The Throw Maneuver: \"If you hit another Character"),
    CHAT.indexOf("await landThrown(attack, attacker, target);"));
  check("on a hit - not a miss, not an Absolute Attack's - and on the one it was thrown at alone",
    [hook.includes("attack.thrown && own.hit && !isAbsoluteMiss(own)"),
     hook.includes("(target.uuid === attack.targetUuid)")], [true, true]);

  const from = CHAT.indexOf("async function landThrown(");
  const to = CHAT.indexOf("\n}\n", from) + 2;
  const calls = [];
  const landThrown = new Function("hardnessValue", "reduceLifePoints", "ChatMessage", "Handlebars",
    "postMightClash", "bouncyMovementOffer", "SCOPE", "OOS_OFFERS_FLAG", "collisionHalved", "collisionAmount", "majinCollision", `${CHAT.slice(from, to)}\nreturn landThrown;`)(
      hardnessValue,
      async (target, amount, { reason }) => { calls.push(["life", amount, reason]); },
      { create: async ({ content }) => { calls.push(["card", content]); }, getSpeaker: () => ({}) },
      { escapeExpression: String },
      async (a, t, spec) => { calls.push(["clash", spec.thrownProne, spec.reason]); },
      () => null, "dbu-ttrpg", "oosOffers", who => who?.system?.effects?.slots?.["collision.halved"] === true, (who, amount) => (who?.system?.effects?.slots?.["collision.halved"] === true) ? Math.floor(amount / 2) : amount,
      async () => false);
  const target = { name: "Raditz", system: { baseTierOfPower: 3 } };
  const thrower = { name: "Kale" };
  const land = async thrown => {
    calls.length = 0;
    await landThrown({ maneuverName: "Throw", thrown }, thrower, target);
    return [...calls];
  };
  const rock = await land({ name: "Feature", rank: 3, value: null, mightClash: false });
  check("Collision Damage: the Life Points the Feature's Hardness Value takes, at the base Tier of the one hit",
    rock[0], ["life", hardnessValue(3, 3), "Feature (Collision Damage)"]);
  check("and the card says it, and where it lands",
    /Collision Damage \d+ \(Hardness Rank 3\)\. It lands on a Square beside them, Kale's choice\./.test(rock[1][1]),
    true);
  const basic = await land({ name: "Net", rank: 1, value: null, mightClash: false });
  check("a Basic Item: Rank 1's", basic[0][1], HARDNESS_RANKS.find(h => h.rank === 1).perBaseTier * 3);
  const heavy = await land({ name: "Heavy Gi", rank: 1, value: 4, mightClash: true });
  check("a piece setting its own Hardness Value: that, whatever the Rank - and its Might Clash",
    [heavy[0][1], heavy[2]], [4, ["clash", { applied: false, itemName: "Heavy Gi" }, "Win and Raditz is knocked Prone."]]);
  check("no Clash for anything that does not open one", basic.some(([kind]) => kind === "clash"), false);
}

// --- Knocked Prone ----------------------------------------------------------------------------------
{
  const from = CHAT.indexOf("async function settleThrownProne(");
  const to = CHAT.indexOf("\n}\n", from) + 2;
  // Its import cannot survive being cut out - it would resolve against this harness - so it is
  // stripped, and the stub handed in.
  const cut = CHAT.slice(from, to).replace('const { setCondition } = await import("./conditions.mjs");', "");
  check("cut out, it imports nothing that would resolve here", /\bimport\(/.test(cut), false);
  const applied = [];
  const notes = [];
  const people = { "Actor.k": { name: "Kale" }, "Actor.r": { name: "Raditz" } };
  const settle = new Function("fromUuidSync", "SCOPE", "CLASH_FLAG", "whoWonClash", "settledNote",
    "setCondition", `${cut}\nreturn settleThrownProne;`)(
      uuid => people[uuid], "dbu", "clash", result => result.winner,
      async (message, text) => { notes.push(text); },
      async (target, key, stacks) => { applied.push([target.name, key, stacks]); return true; });
  const message = { setFlag: async () => {} };
  const clash = winner => ({ challengerUuid: "Actor.k", defenderUuid: "Actor.r",
    thrownProne: { applied: false, itemName: "Heavy Gi" }, result: { winner } });
  await settle(message, clash("challenger"));
  check("won: knocked Prone", [applied, notes], [[["Raditz", "prone", 1]], ["Raditz is knocked Prone."]]);
  applied.length = 0; notes.length = 0;
  await settle(message, clash("defender"));
  check("lost, or tied: nothing but the note", [applied, notes], [[], ["Raditz stays on their feet."]]);
  check("the Might Clash is settled where every Clash is", CHAT.includes(
    "if (clash.thrownProne && clash.result && !clash.thrownProne.applied) {\n    await settleThrownProne(message, clash);"),
    true);
  check("and there is a Prone to give", Boolean(getTrait("prone")), true);
}

console.log(`${failed} failing`);
process.exit(failed ? 1 : 0);
