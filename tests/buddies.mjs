/**
 * Buddies: Items from traits/gear/buddies/, one Active at a time, whose scripts run while Active
 * and while Adventuring - a Greater one's Original's with its own.
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

const { loadTraits, getTrait, traitsOfKind } = await import(modUrl("effects/traits.mjs"));
const { default: DBUCharacterData } = await import(modUrl("data/actor-character.mjs"));
const { default: DBUGearData } = await import(modUrl("data/item-gear.mjs"));
const GEAR = await import(modUrl("gear.mjs"));
await loadTraits();

const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");
const INDEX = JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));
const RULES = fs.readFileSync(new URL("./buddies-rules.txt", import.meta.url), "utf8");

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

class ActorStub extends DataModel {
  static defineSchema() { return {}; }
}

function progressionTo(powerLevel) {
  const rows = [{ lvl: 1, choice: "Skill Improvement", locked: true, attributes: {}, skillRanks: ["perception", "perception"] }];
  for (let lvl = 2; lvl <= powerLevel; lvl++) {
    rows.push({ lvl, choice: "Attribute Addition", locked: false, attributes: { insight: 1, agility: 1 }, skillRanks: [] });
  }
  return rows;
}

function holding(items, { powerLevel = 30, adventuring = false, alignment = 0 } = {}) {
  const parent = new ActorStub({}, { strict: false });
  parent.items = items;
  parent.uuid = "Actor.me";
  const model = new DBUCharacterData({ powerLevel, progression: progressionTo(powerLevel), adventuring, alignment },
    { parent, strict: false });
  parent.system = model;
  model.prepareBaseData?.();
  model.prepareDerivedData();
  return parent;
}

let n = 0;
function buddy(id, { active = false, destroyed = false, locked = false, ...chosen } = {}) {
  const data = GEAR.gearItemFrom(getTrait(id), null);
  n++;
  return { ...data, id: `b${n}`, uuid: `Actor.me.Item.b${n}`,
    system: { ...data.system, buddy: { ...data.system.buddy, active, destroyed, locked, ...chosen } } };
}
const slots = (actor, key) => actor.system.effects.slots[key]?.add ?? 0;

// --- The files ---------------------------------------------------------------------------------------
const ALL = traitsOfKind("gear").filter(trait => GEAR.typeOf(trait) === "buddy");
{
  check("nine Buddies and eleven Special ones", [ALL.filter(t => t.special !== true).length,
    ALL.filter(t => t.special === true).length], [9, 11]);
  check("each in the index, under buddies/", ALL.every(trait => INDEX.traits.includes(`gear/buddies/${trait.id}.dbu`)), true);
  check("Greater and Unique", [ALL.filter(t => t.buddyKind === "greater").map(t => t.id).sort(),
    ALL.filter(t => t.buddyKind === "unique").map(t => t.id).sort()],
    [["cruise-buddy", "invincibuddy", "nimbus", "senzu-farmer", "studied-shifting-buddy", "team-buddy",
      "technique-hermit", "warrior-buddy"], ["guiding-spirit", "oracle-fish", "zen-o"]]);
  const flat = text => String(text ?? "").replace(/\s+/g, " ").trim();
  const rules = flat(RULES);
  check("each one's text word for word", ALL.filter(trait => !rules.includes(flat(trait.text))).map(t => t.id), []);
  check("a Greater one's Original", ["cruise-buddy", "nimbus", "studied-shifting-buddy", "technique-hermit",
    "warrior-buddy", "invincibuddy"].map(id => getTrait(id).original),
    ["ride-buddy", "ride-buddy", "shifting-buddy", "mentor-buddy", "assault-buddy", "any"]);
  const made = GEAR.gearItemFrom(getTrait("ride-buddy"), null);
  check("given as a Buddy, called by nobody yet", [made.system.itemType, made.system.buddy?.active ?? null],
    ["buddy", null]);
  const kept = new DBUGearData({ ...structuredClone(made.system), buddy: { active: true, ride: "flyin" } },
    { strict: false }).toObject();
  check("which the schema keeps", [kept.buddy.active, kept.buddy.ride, kept.buddy.destroyed], [true, "flyin", false]);
}

// --- The Buddy Attribute, and calling one ------------------------------------------------------------
{
  check("the Attribute Score Limit at the base Tier: 8, and 3 a Tier", [1, 2, 3, 6].map(GEAR.buddyAttribute), [8, 11, 14, 23]);
  const a = buddy("companion-buddy", { active: true });
  const b = buddy("mentor-buddy");
  check("one Active at a time; destroyed and locked never",
    [GEAR.callProblem([a, b], b), GEAR.callProblem([a, b], a), GEAR.callProblem([buddy("mentor-buddy", { destroyed: true })],
      buddy("mentor-buddy", { destroyed: true })), GEAR.callProblem([], buddy("mentor-buddy", { locked: true }))],
    ["Companion Buddy is Active: dismiss it first.", "", "Destroyed.", "It cannot be called again this Combat Encounter."]);
  check("the Active one", GEAR.activeBuddy([b, a]).id, a.id);
}

// --- What each does ------------------------------------------------------------------------------------
{
  const bare = holding([]);
  const bT = bare.system.baseTierOfPower;
  const diff = (actor, key) => slots(actor, key) - slots(bare, key);
  const companion = holding([buddy("companion-buddy", { active: true })]);
  check("Companion, Active: Morale and Cognitive 1(bT), Persuasion 2",
    [diff(companion, "save.morale"), diff(companion, "save.cognitive"), diff(companion, "skill.persuasion")], [bT, bT, 2]);
  check("not Active, not Adventuring: nothing", diff(holding([buddy("companion-buddy")]), "skill.persuasion"), 0);
  check("Adventuring as well: 4 on Persuasion",
    diff(holding([buddy("companion-buddy", { active: true })], { adventuring: true }), "skill.persuasion"), 4);
  check("a destroyed one does nothing, Adventuring or not",
    diff(holding([buddy("companion-buddy", { active: true, destroyed: true })], { adventuring: true }), "skill.persuasion"), 0);
  const mentor = holding([buddy("mentor-buddy")], { adventuring: true });
  const insight = Object.entries(DBUCharacterData.SKILLS).filter(([, s]) => s.attribute === "insight").map(([k]) => k);
  check("Mentor, Adventuring: Insight 1(bT), and every Insight Skill 1",
    [diff(mentor, "insight.mod"), insight.every(key => diff(mentor, `skill.${key}`) === 1), insight.length > 3], [bT, true, true]);
  check("Mentor, Active: Combat Rolls 1(bT) - the Strike among them", diff(holding([buddy("mentor-buddy", { active: true })]), "strike"), bT);
  const skill = holding([buddy("skill-buddy", { active: true, skill: "stealth" })], { adventuring: true });
  check("Skill Buddy: a quarter of the Buddy Attribute, rounded up, twice when both",
    diff(skill, "skill.stealth"), 2 * Math.ceil(GEAR.buddyAttribute(bT) / 4));
  const flyin = holding([buddy("ride-buddy", { active: true, ride: "flyin" })]);
  const dodgin = holding([buddy("ride-buddy", { active: true, ride: "dodgin" })]);
  check("Ride: Flyin' opens the Soar Maneuver; Dodgin' Dodge 1(bT) - while Active",
    [flyin.system.effects.slots["maneuver.soar"]?.allow ?? flyin.system.effects.slots["maneuver.soar"] ?? null,
     diff(dodgin, "dodge"), diff(holding([buddy("ride-buddy", { ride: "dodgin" })]), "dodge")].map(v => Boolean(v) ? (typeof v === "number" ? v : true) : v),
    [true, bT, 0]);
  const cruise = holding([buddy("cruise-buddy", { active: true, ride: "dodgin" })]);
  check("a Greater one is its Original too: the Cruise Buddy's Dodgin'", diff(cruise, "dodge"), bT);
  const invincible = holding([buddy("invincibuddy", { active: true, original: "companion-buddy" })]);
  check("and an Invincibuddy the one chosen", diff(invincible, "skill.persuasion"), 2);
  const smart = holding([buddy("smart-buddy", { active: true })], { adventuring: true });
  check("Smart: the Analysis Maneuver opened; Knowledge a quarter of the Buddy Attribute Adventuring",
    [Boolean(smart.system.effects.slots["maneuver.analysis"]), diff(smart, "skills.family.knowledge")],
    [true, Math.ceil(GEAR.buddyAttribute(bT) / 4)]);
  const assault = holding([buddy("assault-buddy")], { adventuring: true });
  check("Assault, Adventuring: Force and Magic 1(bT)", [diff(assault, "force.mod"), diff(assault, "magic.mod")], [bT, bT]);

  const spirit = { system: { baseTierOfPower: 4, skills: { stealth: { ranks: 3 }, medicine: { ranks: 1 }, cooking: { ranks: 0 } } } };
  const guide = buddy("guiding-spirit", { active: true, spiritUuid: "Actor.ghost", spiritName: "Ghost" });
  const script = GEAR.buddyScript(guide, getTrait, { baseTier: 2, spirit });
  check("Guiding Spirit: the Spirit's Ranks on each Skill, and Combat Rolls at their base Tier",
    [script.includes("combatRolls += 4;"), script.includes("skill.stealth += 3;"), script.includes("skill.medicine += 1;"),
     script.includes("skill.cooking"), (script.match(/skill\.stealth \+= 3;/g) ?? []).length], [true, true, true, false, 2]);
  check("and a Shifting Buddy only as a Ride Buddy this Round",
    [GEAR.buddyScript(buddy("shifting-buddy", { active: true, ride: "dodgin", shiftedTo: "ride", shiftRound: 2 }), getTrait,
      { round: 2 }).includes("if (1 == 1 && 1 == 1)"),
     GEAR.buddyScript(buddy("shifting-buddy", { active: true, ride: "dodgin", shiftedTo: "ride", shiftRound: 1 }), getTrait,
      { round: 2 }).includes("if (1 == 1 && 1 == 1)")], [true, false]);
}

// --- The sheet ----------------------------------------------------------------------------------------
{
  const SHEET = read("module", "sheets", "actor-character-sheet.mjs");
  const TAB = read("templates", "parts", "actor-gear.hbs");
  const USE = read("module", "use-maneuver.mjs");
  const COMBAT = read("module", "combat.mjs");
  check("a Buddies list, Add Buddy, and Call or Dismiss",
    [TAB.includes('data-section="gearBuddies"'), TAB.includes('data-action="addGear" data-list="buddy"'),
     TAB.includes('data-action="callBuddy"'), SHEET.includes("callBuddy: DBUCharacterSheet._onCallBuddy")],
    [true, true, true, true]);
  const call = SHEET.slice(SHEET.indexOf("static async _onCallBuddy("), SHEET.indexOf("static async _onCallBuddy(") + 1800);
  check("in a Combat Encounter, on their turn, as the Instant it is",
    [call.includes("isTheirTurn(this.actor)"), call.includes("whyNotAnotherInstant(this.actor)"),
     call.includes('await recordManeuverType(this.actor, "instant");')], [true, true, true]);
  check("Special ones apart, Greater and Unique", SHEET.includes('label: `Special ${type.label} - ${kind === "greater" ? "Greater" : "Unique"}`,'), true);
  check("what each asks when it is gained", ["Original Buddy", '"Profile"', '"Skill"', "Flyin' or Dodgin'",
    '"Signature Technique"', 'title: "Spirit"'].every(bit => SHEET.includes(bit)), true);
  check("a Warrior Buddy's Technique is thrown through it alone",
    USE.includes("&& !item.system.signatureTechnique && !buddys.has(item.id))"), true);
  check("at the Encounter's end: unlocked, and the Spirit decides",
    [COMBAT.includes('locked.map(item => ({ _id: item.id, "system.buddy.locked": false }))'),
     COMBAT.includes("decides whether to go on helping")], [true, true]);
}

// --- The Activated Buddy Effects -----------------------------------------------------------------------
{
  const keys = item => GEAR.buddyActions(item, getTrait, 2).map(a => [a.key, a.maneuverType, a.actionCost, a.form]);
  check("each one's, while Active: Standard for an Action, the Shift an Instant",
    [keys(buddy("assault-buddy", { active: true })), keys(buddy("healing-buddy", { active: true })),
     keys(buddy("ride-buddy", { active: true })), keys(buddy("shifting-buddy", { active: true })),
     keys(buddy("zen-o", { active: true })), keys(buddy("companion-buddy", { active: true }))],
    [[["assault", "standard", 1, false]], [["heal", "standard", 1, false]], [["ride", "standard", 1, false]],
     [["shift", "instant", 0, false]], [["zeno", "standard", 1, false]], []]);
  check("not Active, locked or destroyed: none", [keys(buddy("ride-buddy")), keys(buddy("ride-buddy", { active: true, locked: true })),
    keys(buddy("ride-buddy", { active: true, destroyed: true }))], [[], [], []]);
  check("a Greater one's, off its Original: the Warrior's Attack, the Nimbus' Ride",
    [keys(buddy("warrior-buddy", { active: true })), keys(buddy("nimbus", { active: true }))],
    [[["assault", "standard", 1, false]], [["ride", "standard", 1, false]]]);
  check("a Shifting Buddy turned into one this Round: that one's too, apart",
    [keys(buddy("shifting-buddy", { active: true, shiftedTo: "ride", shiftRound: 2 })),
     keys(buddy("shifting-buddy", { active: true, shiftedTo: "ride", shiftRound: 1 })),
     keys(buddy("shifting-buddy", { active: true, shiftedTo: "weapon", shiftRound: 2 }))],
    [[["shift", "instant", 0, false], ["ride", "standard", 1, true]], [["shift", "instant", 0, false]],
     [["shift", "instant", 0, false]]]);
  check("once a Round each, by keys of their own",
    [GEAR.buddyUseKey({ id: "x" }), GEAR.buddyUseKey({ id: "x" }, true)], ["round:buddy.x", "round:buddyform.x"]);

  const shifter = buddy("shifting-buddy", { active: true, shiftRound: 0 });
  const used = n => ({ system: { usedManeuvers: Array(n).fill(`encounter:shift.${shifter.id}`) } });
  check("Shifting: three an Encounter, never two Rounds running; a Studied one freely",
    [GEAR.shiftProblem(used(2), shifter, getTrait, 4), GEAR.shiftProblem(used(3), shifter, getTrait, 4),
     GEAR.shiftProblem(used(0), buddy("shifting-buddy", { shiftRound: 3 }), getTrait, 4),
     GEAR.shiftProblem(used(9), buddy("studied-shifting-buddy", { shiftRound: 3, original: "" }), getTrait, 4)],
    ["", "Shifted 3 times this Combat Encounter already.", "It shifted last Combat Round.", ""]);
  const sizes = Object.keys(DBUCharacterData.SIZES);
  check("Ride: the Buddy Attribute in Squares, 6 more for Cruise and Nimbus; Large, or Gigantic for Cruise",
    [GEAR.rideSquares(buddy("ride-buddy"), getTrait, 2), GEAR.rideSquares(buddy("cruise-buddy"), getTrait, 2),
     GEAR.rideSquares(buddy("nimbus"), getTrait, 2),
     GEAR.rideFits(buddy("ride-buddy"), getTrait, "enormous", sizes), GEAR.rideFits(buddy("ride-buddy"), getTrait, "large", sizes),
     GEAR.rideFits(buddy("cruise-buddy"), getTrait, "gigantic", sizes), GEAR.rideFits(buddy("cruise-buddy"), getTrait, "colossal", sizes)],
    [11, 17, 17, false, true, true, false]);
  check("Support, Active: a Remote Control for every Bomb and Collar",
    [GEAR.remoteKinds(buddy("support-buddy", { active: true }), getTrait), GEAR.remotesAll(buddy("support-buddy", { active: true }), getTrait),
     GEAR.remoteKinds(buddy("support-buddy"), getTrait), GEAR.remoteCost(buddy("support-buddy", { active: true }))],
    [["bomb", "shock-collar"], true, [], 1]);

  // A Shifting Buddy's Weapon: Life Points the Buddy Attribute, and the Buddy destroyed with it.
  const shifting = buddy("shifting-buddy", { active: true });
  const data = GEAR.craftedItemFrom("weapon", null, getTrait);
  const weapon = { ...data, id: "sw", name: "Shift (Weapon)", system: { ...data.system, equipped: true,
    crafted: { ...data.system.crafted, lifeFixed: 11, fromBuddy: shifting.id } } };
  check("its Weapon's Life Points are the Buddy Attribute",
    GEAR.craftedReading(weapon.system.crafted, { getTrait, difficulties: {}, data: { powerLevel: 9 } }).lifeMax, 11);
  const writes = [];
  const owner = { isOwner: true, system: { baseTierOfPower: 1, powerLevel: 1 }, items: [shifting, weapon],
    update: async changes => { writes.push(changes); } };
  const said = await GEAR.damageWeapon(owner, weapon, 20, getTrait);
  check("broken, the Buddy is Destroyed with it",
    [said, writes[0].items[1]], ["Shift (Weapon) loses 20 Life Points and breaks. Shifting Buddy is Destroyed.",
      { _id: shifting.id, "system.buddy.destroyed": true, "system.buddy.active": false }]);

  const SHEET = read("module", "sheets", "actor-character-sheet.mjs");
  const CHAT = read("module", "chat.mjs");
  const USE = read("module", "use-maneuver.mjs");
  const COMBAT = read("module", "combat.mjs");
  const use = SHEET.slice(SHEET.indexOf("static async _onUseBuddy("), SHEET.indexOf("static async _onGrowSenzu("));
  check("on the owner's turn, once a Round, paid as its type says",
    [use.includes("if (!isTheirTurn(actor)) {"), use.includes("if ((actor.system.usedManeuvers ?? []).includes(useKey)) {"),
     use.includes("if (!await spendActions(actor, action.actionCost)) return false;"),
     use.includes("const blocked = whyNotAnotherInstant(actor);")], [true, true, true, true]);
  check("Heal: 2d10 a base Tier on the one targeted, or themselves",
    [use.includes("const roll = await new Roll(`${2 * baseTier}d10`).evaluate();"),
     use.includes("const who = game.user.targets.first()?.actor ?? actor;")], [true, true]);
  check("Nimbus only for the Pure Good; the Weapon made at half the base Tier, the Buddy Attribute its Life",
    [use.includes("Number(actor.system.alignment ?? 0) !== Number(needs)"),
     use.includes("data.system.crafted.grade = Math.min(5, Math.max(1, 2 + baseTier));"),
     use.includes("data.system.crafted.lifeFixed = 5 * buddyAttribute(baseTier);")], [true, true, true]);
  check("the Assault's attack: the Buddy Attribute as the Damage Attribute, no Weapon asked, its Foundation",
    [USE.includes("declared = { ...declared, damageAttribute: { label: maneuver.buddyAttack.label,"),
     USE.includes("&& !maneuver.buddyAttack && (armedAs !== \"unarmed\")) {"), USE.includes("const foundationsOffered = maneuver.buddyAttack?.foundation")],
    [true, true, true]);
  check("the Technique Hermit's row, in (bT)", [USE.includes("strikePerBaseTier: 1, woundPerBaseTier: 1,"),
    CHAT.includes("written: `${entry.strikePerBaseTier > 0 ? \"+\" : \"\"}${entry.strikePerBaseTier}(bT)`,")], [true, true]);
  check("Ride: its card may be Exploited, and whoever it carried has 2(bT)",
    [CHAT.includes("return postManeuver(actor, { ...movement, name: buddy.name, actionCost: 1, kiCost: 0 },"),
     CHAT.includes('return [{ label: "Ride Buddy", written: "+2(bT)", value: 2 * baseTier }];'),
     CHAT.includes("parts.push(...rideExploitBonus(actor, attack));")], [true, true, true]);
  check("Zen-O: the Temperament card each Round's end, the ARC's; Annoyed dismisses and locks him",
    [COMBAT.includes("await postTemperament(actor, zen);"), CHAT.includes("if (!check || check.chosen || !game.user.isGM) return;"),
     CHAT.includes('await buddy.update({ "system.buddy.active": false, "system.buddy.locked": true });')], [true, true, true]);
  check("Entertained, on whoever the ARC marks, for the Round", CHAT.includes(
    'await lasting(actor, { kind: KINDS.CONDITION, key: "entertained", edge: EDGES.ROUND, source: "Zen-O" });'), true);
  check("the Shifting Buddy's Weapon gone at the Round's end", COMBAT.includes(
    "const shifted = actor.items.filter(item => item.system?.crafted?.fromBuddy).map(item => item.id);"), true);
  check("the Smart Buddy's Buddy Attribute in Analysis, where it is more",
    CHAT.includes("const quarter = Math.ceil(Math.max(scholarship, own) / 4);"), true);
}

// --- Destroying a Buddy ---------------------------------------------------------------------------------
{
  check("a Called Shot may claim the Active Buddy - never one that cannot be targeted",
    [GEAR.targetableBuddy([buddy("ride-buddy", { active: true })], getTrait)?.system.gearId,
     GEAR.targetableBuddy([buddy("ride-buddy")], getTrait),
     GEAR.targetableBuddy([buddy("guiding-spirit", { active: true })], getTrait),
     GEAR.targetableBuddy([buddy("invincibuddy", { active: true, original: "ride-buddy" })], getTrait),
     GEAR.targetableBuddy([buddy("zen-o", { active: true })], getTrait)],
    ["ride-buddy", null, null, null, null]);
  const flyer = buddy("ride-buddy", { active: true, ride: "flyin" });
  const jetpack = { type: "gear", system: { grantsManeuver: "soar", itemType: "accessory", equipped: true } };
  check("Flyin' with the Soar Maneuver already: by Skill Ranks, or an Item worn - not the Buddy's own",
    [GEAR.soarElsewhere({ system: { specialManeuvers: [] }, items: [flyer] }, flyer),
     GEAR.soarElsewhere({ system: { specialManeuvers: [{ maneuver: "soar", open: true }] }, items: [flyer] }, flyer),
     GEAR.soarElsewhere({ system: {}, items: [flyer, jetpack] }, flyer),
     GEAR.soarElsewhere({ system: {}, items: [flyer, { ...jetpack, system: { ...jetpack.system, equipped: false } }] }, flyer)],
    [false, true, true, false]);
  const CHAT = read("module", "chat.mjs");
  const USE = read("module", "use-maneuver.mjs");
  check("the Called Shot offers it, and carries it on the attack",
    [USE.includes('...(buddy ? [aim("buddy", `Their ${buddy.name}`,'), USE.includes("atBuddy: entry.atBuddy ?? null")],
    [true, true]);
  check("hit: nothing to them - unless they Guarded or took a Direct Hit",
    [CHAT.includes('if (atBuddy && !["guard", "directHit"].includes(own.defense)) {'),
     CHAT.includes("buddyHit: { itemId: atBuddy.itemId, name: atBuddy.name } });")], [true, true]);
  check("destroyed, or a Karma Point: dismissed and locked",
    [CHAT.includes('{ "system.buddy.active": false, "system.buddy.destroyed": true }'),
     CHAT.includes('saved ? { "system.buddy.active": false, "system.buddy.locked": true }'),
     CHAT.includes("await spendKarma(target, { name: `Save ${own.buddyHit.name}`, cost: 1 })")], [true, true, true]);
  check("Flyin's Dodge against a Called Shot at it", CHAT.includes("parts.push(...flyinDodge(actor, attack));"), true);
}

console.log(`${failed} failing`);
process.exit(failed ? 1 : 0);
