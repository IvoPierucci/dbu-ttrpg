/**
 * Fusion (the Fusion page and Fusion Methods & Modifiers; the user's, 2026-11-16): an Actor type of its own, on the Character's model
 * and sheet, without a Progression and with a Fusion tab. Stage 1 - the type, what it reads in place of a Progression, the tab.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
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

const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");
const TRAITS = path.join(ROOT, "traits");
globalThis.foundry.utils.fetchJsonWithTimeout = async url => (String(url).includes("/races/")
  ? JSON.parse(read("races", String(url).split("/races/")[1])) : JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8")));
globalThis.fetch = async url => {
  const file = path.join(TRAITS, String(url).replace("systems/dbu-ttrpg/traits/", ""));
  if (!fs.existsSync(file)) return { ok: false, status: 404, statusText: "missing" };
  return { ok: true, status: 200, text: async () => fs.readFileSync(file, "utf8") };
};

const { loadTraits } = await import(modUrl("effects/traits.mjs"));
const RACES = await import(modUrl("races.mjs"));
const F = await import(modUrl("fusion.mjs"));
const TYPES = await import(modUrl("actor-types.mjs"));
const { default: DBUCharacterData } = await import(modUrl("data/actor-character.mjs"));
await loadTraits();
await RACES.loadRaces();

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

/** A prepared Actor of a kind, holding what is given. */
function made(type, data = {}) {
  const parent = new ActorStub({}, { strict: false });
  parent.items = [];
  parent.uuid = "Actor.fusion";
  parent.type = type;
  const model = new DBUCharacterData({ progression: [], ...data }, { parent, strict: false });
  parent.system = model;
  model.prepareBaseData?.();
  model.prepareDerivedData();
  return parent;
}

// --- The type ------------------------------------------------------------------------------------------------------------------
const MAIN = read("module", "dbu-ttrpg.mjs");
check("an Actor type of its own, named, on the Character's model and sheet - a Character to every rule",
  [Object.keys(JSON.parse(read("system.json")).documentTypes.Actor).includes("fusion"), JSON.parse(read("lang", "en.json"))["TYPES.Actor.fusion"],
   MAIN.includes("CONFIG.Actor.dataModels.fusion = DBUCharacterData;"), MAIN.includes('types: ["character", "minion", "adversary", "fusion"],'),
   TYPES.isFusion({ type: "fusion" }), TYPES.isCharacter({ type: "fusion" }), TYPES.isPlayerCharacter({ type: "fusion" }),
   TYPES.isPlayerCharacter({ type: "fusion", system: { fusion: { minion: true } } }),
   TYPES.mayBeMaster({ type: "fusion" }), TYPES.mayBeMaster({ type: "fusion", system: { fusion: { minion: true } } }), TYPES.mayBeMaster({ type: "minion" })],
  // A Fusion of Player Characters is one ("any non-Minion Characters controlled by a player"), and may be a Master; one of Minions neither.
  [true, "Fusion", true, true, true, true, true, false, true, false, false]);
check("made with no Progression: \"you do not follow typical Character Creation rules\"",
  [MAIN.includes('if (fusion) updates["system.progression"] = [];')], [true]);

// --- The rules it is worked out by ----------------------------------------------------------------------------------------------
const goku = { uuid: "Actor.g", name: "Goku", powerLevel: 18, race: "saiyan", size: "medium", alignment: 1 };
const vegeta = { uuid: "Actor.v", name: "Vegeta", powerLevel: 17, race: "saiyan", size: "medium", alignment: -1 };
check("Fusion Power Level: the highest + 1(bT) - (bT) the highest's base ToP; none with one more than 5 below, or a Minion; Synergistic's +3",
  [F.fusionPowerLevel([goku, vegeta]), F.fusionPowerLevel([goku, { ...vegeta, powerLevel: 12 }]).powerLevel,
   F.fusionPowerLevel([goku, { ...vegeta, minion: true }]).powerLevel, F.fusionPowerLevel([goku, vegeta], { synergistic: true }).powerLevel,
   F.fusionPowerLevel([{ ...goku, powerLevel: 30 }, { ...vegeta, powerLevel: 29 }]).powerLevel],
  [{ powerLevel: 22, bonus: 4, why: "+1(bT) = +4" }, 18, 18, 25, 37]);
check("base ToP: never above 7", [F.baseTierFor(22), F.baseTierFor(37), F.baseTierFor(100)], [5, 7, 7]);
check("Size and Alignment: anything between the Fused Characters'",
  [F.sizeRange([{ size: "small" }, { size: "large" }]), F.alignmentRange([goku, vegeta]), F.sizeRange([])],
  [["small", "medium", "large"], [1, 0, -1], ["medium"]]);
check("every Race's Saving Throw; the highest Racial Life Modifier",
  [F.fusionRacialSaves([{ race: "saiyan" }, { race: "earthling" }]), F.fusionRacialLife([{ race: "saiyan" }, { race: "earthling" }])],
  [["corporeal", "morale"], 4]);
check("the Fusion Methods: their type, Round Limit and Fused; Modifiers 2 for a Temporary one, 1 for a Lasting one",
  [F.FUSION_METHODS.potara.rounds, F.FUSION_METHODS.maxi.fused, F.FUSION_METHODS.merge.type, F.modifiersAllowed("metamorese"), F.modifiersAllowed("ex")],
  [20, [5, 5], "lasting", 2, 1]);
check("the Fusion Awakening Table", [F.FUSION_AWAKENINGS[1], F.FUSION_AWAKENINGS[7]], [[3, 1], [10, 6]]);

// --- What it reads in place of a Progression ------------------------------------------------------------------------------------
const fused = made("fusion", { race: "saiyan", fusion: {
  fused: [goku, vegeta], method: "potara", powerLevel: 37,
  scores: { agility: 9, force: 12, tenacity: 8, scholarship: 3, insight: 6, magic: 2, personality: 5 },
  ranks: ["perception", "perception", "intimidation"],
  races: [{ race: "saiyan" }, { race: "earthling" }]
} });
const S = fused.system;
check("its Scores the ones taken - no Progression's; its Skill Ranks the ones taken",
  [S.attributes.force.score, S.attributes.magic.score, S.skills.perception.ranks, S.skills.intimidation.ranks, S.skills.stealth.ranks],
  [12, 2, 2, 1, 0]);
check("its Power Level past 30, its base ToP 7 at most; Life, Ki and Capacity from it",
  [S.powerLevel, S.baseTierOfPower, S.capacity.max], [37, 7, 20 + (4 * 36)]);
check("the highest Racial Life Modifier among its Races, and every Race's Saving Throw",
  [S.racialLifeModifier, ["corporeal", "morale"].map(save => S.savingThrows[save].racial), S.savingThrows.impulsive.racial], [4, [true, true], false]);
check("all its Races its own: a race asked about is any of them", [F.hasRace(fused, "earthling"), F.hasRace(fused, "namekian")], [true, false]);
const minionFusion = made("fusion", { fusion: { minion: true, powerLevel: 5, fused: [] } });
check("Minion Fusion: \"the resultant Fusion is also a Minion\"", [minionFusion.system.minion, TYPES.isMinion(minionFusion), TYPES.isMinion(fused)], [true, true, false]);
const plain = made("character", { powerLevel: 37 });
check("a Character's Power Level still stops at 30", plain.system.powerLevel, 30);

// --- Its tab ---------------------------------------------------------------------------------------------------------------------
const require = createRequire(path.join(APP, "package.json"));
const Handlebars = require("handlebars");
Handlebars.registerHelper("eq", (a, b) => a === b);
const lookups = { actorAt: uuid => ({ "Actor.g": { name: "Goku", img: "g.webp", system: { karma: 2 } }, "Actor.v": { name: "Vegeta", img: "v.webp", system: { karma: 1 } } })[uuid] ?? null,
  raceName: id => ({ saiyan: "Saiyan", earthling: "Earthling" })[id] ?? id, subraceName: () => "", sizeLabel: key => DBUCharacterData.SIZES[key]?.label ?? key,
  alignments: DBUCharacterData.ALIGNMENTS, trait: () => null };
fused.items = { get: () => null };
const context = F.fusionContext(fused, lookups);
check("the tab's: Fused Characters, the Method, Modifiers 0 of 2, its power, Karma of each",
  [context.fused.map(each => [each.name, each.powerLevel, each.karma]), context.method.temporary, context.method.rounds, context.modifiers.allowed,
   context.power.powerLevel, context.power.bT, context.power.races, context.power.alignments.map(each => each.value), context.awakenings],
  [[["Goku", 18, 2], ["Vegeta", 17, 1]], true, 20, 2, 37, 4, ["Saiyan", "Earthling"], [1, 0, -1], { lesser: 10, greater: 6 }]);
{
  const sized = size => F.fusionContext({ ...fused, system: fused.system, items: fused.items, type: "fusion",
    _source: { system: { size } } }, lookups).power.sizes.filter(each => each.selected).map(each => each.value);
  check("review: its base Size picked in the select (the derived `size` is an object) - not the smallest sent back on the next change",
    [sized(context.power.sizes[context.power.sizes.length - 1].value), sized(context.power.sizes[0].value).length], [[context.power.sizes[context.power.sizes.length - 1].value], 1]);
  check("review: a Score before an effect moved it, a Skill's Ranks without an effect's - what a Fusion takes",
    [typeof S.attributes.force.unmoved, S.attributes.force.unmoved, S.skills.perception.ownRanks], ["number", 12, 2]);
}
const html = Handlebars.compile(read("templates", "parts", "actor-fusion.hbs"))({ tabs: { fusion: { cssClass: "active" } }, editable: true, fusion: context });
check("drawn: Fuse again (recalculate), the Method's select, the Size within its range, the Alignment unnamed (Biography has the name)",
  [html.includes("Fuse again (recalculate)"), html.includes('name="system.fusion.method"'), html.includes('name="system.size"'),
   html.includes("data-fusion-alignment"), html.includes('name="system.alignment"'), html.includes("Temporary &middot; 20 Rounds")],
  [true, true, true, true, false, true]);
const SHEET = read("module", "sheets", "actor-character-sheet.mjs");
check("its sheet: the Fusion tab in its Progression's place, on its sheet only",
  [SHEET.includes('if (isFusion(this.actor)) return ["adversary", "progression"];'), SHEET.includes('return ["adversary", "fusion"];'),
   SHEET.includes('fusion: { id: "fusion", group: "primary", label: "Fusion" },')], [true, true, true]);

// --- Stage 2: Fuse, and Fuse again (recalculate) --------------------------------------------------------------------------------
{
  const MAKE = await import(modUrl("fusion-make.mjs"));
  const item = (id, type, name, extra = {}) => ({ id, type, name, flags: { "dbu-ttrpg": extra.flags ?? {} }, system: extra.system ?? {},
    toObject() { return JSON.parse(JSON.stringify({ _id: id, type, name, flags: this.flags, system: this.system })); } });
  const skills = (ranks) => Object.fromEntries(Object.entries(ranks).map(([key, value]) => [key, { ranks: value }]));
  const attrs = (scores) => Object.fromEntries(Object.entries(scores).map(([key, value]) => [key, { score: value }]));
  const actor = (uuid, name, system, items = [], source = {}) => ({ uuid, name, img: `${name}.webp`, type: "character", system, items,
    _source: { system: source } });
  const goku = actor("Actor.g", "Goku", { powerLevel: 18, race: "saiyan", subrace: "", alignment: 1, threshold: { key: "injured" },
    attributes: attrs({ agility: 9, force: 12, tenacity: 6, scholarship: 2, insight: 5, magic: 1, personality: 4 }),
    skills: skills({ perception: 2, intimidation: 0, stealth: 1 }) }, [
    item("core", "maneuver", "Basic Attack", { system: { source: "Core Rule" } }),
    item("kame", "maneuver", "Kamehameha", { system: { tags: ["signature"] } }),
    item("it", "maneuver", "Instant Transmission", { system: { tags: ["uniqueAbility"], unique: { free: false, advancements: [{ id: "a", free: false }] } } }),
    item("given", "maneuver", "Soar Burst", { system: { fromTrait: "x" } }),
    item("t1", "talent", "Quick Learner", { flags: { sourceId: "quick-learner" } }),
    item("sh", "racial", "Saiyan Heritage", { flags: { sourceId: "saiyan-heritage" }, system: { importance: "primary" } }),
    item("bb", "racial", "Born for Battle", { flags: { sourceId: "born-for-battle" }, system: { importance: "primary" } }),
    item("pp", "racial", "Powerful Physique", { flags: { sourceId: "powerful-physique" }, system: { importance: "secondary" } }),
    item("ev", "racial", "Some Evolution", { flags: { sourceId: "some-evo" }, system: { other: "evolution" } }),
    item("gi", "gear", "Weighted Gi", { system: { itemType: "apparel" } })
  ], { size: "medium" });
  const vegeta = actor("Actor.v", "Vegeta", { powerLevel: 17, race: "saiyan", subrace: "", alignment: -1, threshold: { key: "critical" },
    attributes: attrs({ agility: 10, force: 11, tenacity: 8, scholarship: 3, insight: 4, magic: 1, personality: 5 }),
    skills: skills({ perception: 1, intimidation: 3 }) }, [
    item("core2", "maneuver", "Basic Attack", { system: { source: "Core Rule" } }),
    item("t2", "talent", "Quick Learner", { flags: { sourceId: "quick-learner" } }),
    item("sh2", "racial", "Saiyan Heritage", { flags: { sourceId: "saiyan-heritage" }, system: { importance: "primary" } }),
    item("wp", "racial", "Warrior's Pride", { flags: { sourceId: "warriors-pride" }, system: { importance: "secondary" } })
  ], { size: "large" });

  check("Character Combination's Scores and Skill Ranks: the highest of each among them",
    [MAKE.highestScores([goku, vegeta]), MAKE.highestRanks([goku, vegeta]).sort()],
    [{ agility: 10, force: 12, tenacity: 8, scholarship: 3, insight: 5, magic: 1, personality: 5 },
     ["intimidation", "intimidation", "intimidation", "perception", "perception", "stealth"]]);
  check("review: the highest before effects - a copied Trait's or Talent's +Score and +Ranks not counted twice on the Fusion",
    [MAKE.highestScores([{ system: { attributes: { force: { score: 15, unmoved: 12 } } } }, { system: { attributes: { force: { score: 11 } } } }]).force,
     MAKE.highestRanks([{ system: { skills: { perception: { ranks: 4, ownRanks: 1 } } } }, { system: { skills: { perception: { ranks: 2 } } } }])],
    [12, ["perception", "perception"]]);
  check("Racial Traits to choose among: every one of theirs once, Primary and Secondary - no Other Trait",
    MAKE.racialChoices([goku, vegeta]).map(each => [each.name, each.group, each.fromName]),
    [["Saiyan Heritage", "primary", "Goku"], ["Born for Battle", "primary", "Goku"], ["Powerful Physique", "secondary", "Goku"],
     ["Warrior's Pride", "secondary", "Vegeta"]]);
  check("the limits said, never refused: 2 to 4 Primary, 7 at most",
    [MAKE.racialWarnings([{ group: "primary" }]), MAKE.racialWarnings(Array.from({ length: 8 }, () => ({ group: "primary" }))),
     MAKE.racialWarnings([{ group: "primary" }, { group: "primary" }, { group: "secondary" }])],
    [["1 Primary Traits: at least 2."], ["8 Racial Traits: no more than 7.", "8 Primary Traits: no more than 4."], []]);
  const copied = MAKE.copiedItems([goku, vegeta]);
  check("copied: a Talent once, the Signature Technique and Unique Ability (Free, its Advancements too), Gear, Other Traits - "
    + "no Core Maneuver, nothing a Trait gives, no race's Racial Trait (chosen apart)",
    [copied.map(each => each.name), copied.find(each => each.name === "Instant Transmission").system.unique,
     copied.every(each => each.flags["dbu-ttrpg"].fusedCopy === true), copied.map(each => each.flags["dbu-ttrpg"].copiedId),
     copied.every(each => /^[A-Za-z0-9]{16}$/.test(each._id) && !["kame", "it", "t1", "ev", "gi"].includes(each._id)),
     new Set(copied.map(each => each._id)).size],
    [["Kamehameha", "Instant Transmission", "Quick Learner", "Some Evolution", "Weighted Gi"], { free: true, advancements: [{ id: "a", free: true }] },
     true, ["kame", "it", "t1", "ev", "gi"], true, 5]);
  // What one gave another still says so on the Fusion: the giver's copy, made now or kept (its Racial Traits).
  {
    const giver = item("claws-trait", "racial", "Claws", { flags: { sourceId: "claws" }, system: { other: "bestial" } });
    const given = item("claws-weapon", "gear", "Claws", { flags: { grantedBy: "claws-trait" }, system: { itemType: "weapon" } });
    const fromRace = item("tal", "talent", "Given Talent", { flags: { grantedBy: "sh" } });
    const stray = item("lost", "gear", "Lost", { flags: { grantedBy: "nobody" }, system: { itemType: "weapon" } });
    const piccolo = actor("Actor.p", "Piccolo", { powerLevel: 10 }, [giver, given, fromRace, stray]);
    const made = MAKE.copiedItems([piccolo]);
    const at = name => made.find(each => each.name === name && each.type !== "racial") ?? made.find(each => each.name === name);
    const kept = [{ id: "keptRace", flags: { "dbu-ttrpg": { fusedFrom: "Actor.p", copiedId: "sh" } } }];
    MAKE.relinkCopies(made, kept);
    check("a copy given by another points at the giver's copy - made now, or kept (a Racial Trait); a giver not copied, left as it was",
      [at("Claws").flags["dbu-ttrpg"].grantedBy === made.find(each => each.type === "racial")._id,
       at("Given Talent").flags["dbu-ttrpg"].grantedBy, at("Lost").flags["dbu-ttrpg"].grantedBy],
      [true, "keptRace", "nobody"]);
  }
  // The same Talent answered differently: whose the Fusion keeps, asked; a choice naming one of their Items, pointed at its copy.
  {
    const elem = (id, profile) => item(id, "talent", "Elementalist", { flags: { sourceId: "elementalist" },
      system: { chosen: [{ key: "elementalist", value: profile, label: profile === "fire" ? "Fire Element" : "Water Element" }] } });
    const favored = (id, technique) => item(id, "talent", "Favored Technique", { flags: { sourceId: "favored-technique" },
      system: { chosen: [{ key: "favored-technique", value: technique, label: "Kamehameha" }] } });
    const same = id => item(id, "talent", "Quick Learner", { flags: { sourceId: "quick-learner" }, system: { chosen: [] } });
    const a = actor("Actor.a", "Goten", { powerLevel: 10 }, [elem("e1", "fire"), same("q1"), item("kame", "maneuver", "Kamehameha", { system: { tags: ["signature"] } }),
      favored("f1", "kame")]);
    const b = actor("Actor.b", "Trunks", { powerLevel: 10 }, [elem("e2", "water"), same("q2")]);
    check("review: a Talent both have with different choices is asked (whose and what); the same one, answered the same, is not",
      MAKE.talentConflicts([a, b]), [{ key: "elementalist", name: "Elementalist",
        versions: [{ from: "Actor.a", fromName: "Goten", answer: "Fire Element" }, { from: "Actor.b", fromName: "Trunks", answer: "Water Element" }] }]);
    const kept = picks => MAKE.copiedItems([a, b], { talentPicks: picks }).filter(each => each.name === "Elementalist")
      .map(each => each.system.chosen[0].value);
    check("review: the one picked kept - Trunks's Water - once; none picked, the first had", [kept({ elementalist: "Actor.b" }), kept({})], [["water"], ["fire"]]);
    const made = MAKE.relinkCopies(MAKE.copiedItems([a, b]));
    check("review: Favored Technique's Signature Technique, its copy on the Fusion",
      made.find(each => each.name === "Favored Technique").system.chosen[0].value === made.find(each => each.name === "Kamehameha")._id, true);
    const buddyOwner = actor("Actor.c", "Gohan", { powerLevel: 10 }, [item("masenko", "maneuver", "Masenko", { system: { tags: ["signature"] } }),
      item("bud", "gear", "Assault Buddy", { system: { itemType: "buddy", buddy: { technique: "masenko", skill: "perception" } } })]);
    const withBuddy = MAKE.relinkCopies(MAKE.copiedItems([buddyOwner]));
    const buddy = withBuddy.find(each => each.name === "Assault Buddy");
    check("review: any value naming one of their copied Items - a Buddy's Signature Technique - its copy's; anything else, and where it came from, as it was",
      [buddy.system.buddy.technique === withBuddy.find(each => each.name === "Masenko")._id, buddy.system.buddy.skill,
       buddy.flags["dbu-ttrpg"].copiedId, buddy.flags["dbu-ttrpg"].fusedFrom], [true, "perception", "bud", "Actor.c"]);
    check("review: whose Talents asked as it is fused, after its Fusion Modifiers",
      read("module", "fusion-make.mjs").includes("const talentPicks = await askTalentChoices(actors, existing);"), true);
  }
  const plan = MAKE.fusionPlan([goku, vegeta], "potara");
  check("the plan: its Fused Characters as they are, every Race once, the Fusion Power Level, (bT) the lead's, and every Fused one below Injured",
    [plan.fused.map(each => [each.name, each.powerLevel, each.size]), plan.races, plan.powerLevel, plan.bT, plan.lead.name, plan.minion, plan.allBelowInjured],
    [[["Goku", 18, "medium"], ["Vegeta", 17, "large"]], [{ race: "saiyan", subrace: "", save: "" }], 22, 4, "Goku", false, true]);
  check("Technique Points: 10(bT), 15(bT) with no Fused Technique, doubled by Dominant Personality",
    [MAKE.combinationTP(4), MAKE.combinationTP(4, { noFusedTechnique: true }), MAKE.combinationTP(4, { dominant: true })], [40, 60, 80]);
  check("Minion Fusion: their Masters, every one", MAKE.fusionPlan([{ ...goku, system: { ...goku.system, master: "m1" }, items: [] },
    { ...vegeta, system: { ...vegeta.system, master: "m2" }, items: [] }].map(each => ({ ...each, type: "minion" })), "metamorese").masters,
    ["m1", "m2"]);

  // Applied onto a Fusion: copies made again, Racial Traits kept, Life 1 above Bruised's line (all were below Injured).
  const written = { created: [], deleted: [], updates: [] };
  const fusion = { name: "Vegito", isOwner: true, items: [
      { id: "old", flags: { "dbu-ttrpg": { fusedCopy: true } } }, { id: "race", flags: { "dbu-ttrpg": { fusedRacial: true } } }, { id: "bought", flags: {} }],
    system: { fusion: { modifiers: [], noFusedTechnique: false }, life: { max: 300 }, ki: { max: 200 } },
    deleteEmbeddedDocuments: async (kind, ids) => written.deleted.push(...ids),
    createEmbeddedDocuments: async (kind, data) => written.created.push(...data.map(each => each.name)),
    update: async data => written.updates.push(data) };
  await MAKE.applyFusion(fusion, { ...plan, racial: [{ name: "Saiyan Heritage" }] }, false);
  check("fused again: only its copies taken away and made again; its Racial Traits and what it bought kept; Scores, Ranks, Power Level, "
    + "Technique Points written; Life 1 above Bruised's line, Ki full",
    [written.deleted, written.created, written.updates[0]["system.fusion.powerLevel"], written.updates[0]["system.fusion.tpGained"],
     "system.size" in written.updates[0], written.updates[1]],
    [["old"], ["Kamehameha", "Instant Transmission", "Quick Learner", "Some Evolution", "Weighted Gi", "Divine Fusion Method"], 22, 40, false,
     { "system.life.value": 151, "system.ki.value": 200 }]);
  written.updates.length = 0;
  written.created.length = 0;
  await MAKE.applyFusion(fusion, { ...plan, racial: [{ name: "Saiyan Heritage" }], allBelowInjured: false }, true);
  check("the first time: its chosen Racial Traits too, its Size and Alignment the lead's, Life full",
    [written.created.includes("Saiyan Heritage"), written.updates[0]["system.size"], written.updates[0]["system.alignment"], written.updates[1]["system.life.value"]],
    [true, "medium", 1, 300]);
  globalThis.game.actors = [{ type: "fusion", system: { fusion: { method: "potara", fused: [{ uuid: "Actor.v" }, { uuid: "Actor.g" }] } }, name: "Vegito" }];
  check("Repeating Fusions: the same Fused Characters by the same Method are the same Fusion; another Method another",
    [MAKE.existingFusion(["Actor.g", "Actor.v"], "potara")?.name, MAKE.existingFusion(["Actor.g", "Actor.v"], "metamorese")], ["Vegito", null]);
  globalThis.game.actors = [];
}
const SH2 = read("module", "sheets", "actor-character-sheet.mjs"), CH2 = read("module", "chat.mjs");
check("wired: Settings' Fuse; a Fusion's tab Fuse / Fuse again; the GM makes it for a player who may not; copies counted out of its TP; "
  + "its Technique Points; a race asked of a Fusion any of its Races",
  [read("templates", "parts", "actor-settings.hbs").includes('data-action="fuseWith"'), SH2.includes("fuseWith: DBUCharacterSheet._onFuseWith,"),
   CH2.includes('case "makeFusion": return import("./fusion-make.mjs").then(make => make.createFusion(request.plan, request.name));'),
   SH2.includes('&& !item.getFlag?.("dbu-ttrpg", "fusedCopy") && !item.getFlag?.("dbu-ttrpg", "fusedTechnique"))'), read("module", "data", "actor-character.mjs").includes("+ (this.fusionMade ? Math.max(0, Number(this.fusion?.tpGained) || 0) : 0);"),
   CH2.includes('!hasRace(target, "neo-tuffle", "parasite")'), CH2.includes('hasRace(actor, "android")')],
  [true, true, true, true, true, true, true]);

// --- Stage 3: the Fused Technique ------------------------------------------------------------------------------------------------
{
  const MAKE = await import(modUrl("fusion-make.mjs"));
  const TECH = await import(modUrl("technique.mjs"));
  const MAN = await import(modUrl("maneuvers.mjs"));
  check("Super Profiles a Fused Technique may take: Complete Annihilation, Multi-Profile, and the 'Super' one listing its base's Profile",
    [MAKE.fusedSuperProfiles("beam", MAN.SUPER_PROFILES).map(each => each.value).sort(),
     MAKE.fusedSuperProfiles("simple", MAN.SUPER_PROFILES).map(each => each.value).sort()],
    [["complete-annihilation", "multi-profile", "super-beam"], ["complete-annihilation", "multi-profile"]]);
  const tech = (id, name, features, profile, from) => ({ id, name, system: { signature: { level: "super", profile, features } },
    flags: { "dbu-ttrpg": { fusedCopy: true, fusedFrom: from } },
    toObject() { return JSON.parse(JSON.stringify({ _id: id, name, system: this.system, flags: this.flags })); } });
  const defs = { power: { owner: "advantages", ranks: 3 }, fast: { owner: "advantages" }, slow: { owner: "disadvantages" } };
  const lookups = { featureDef: id => defs[id], maxRanks: def => Number(def?.ranks) || 1 };
  const base = tech("k", "Kamehameha", [{ id: "power", ranks: 2 }, { id: "slow", ranks: 1 }], "beam", "Actor.g");
  const other = tech("f", "Final Flash", [{ id: "power", ranks: 2 }, { id: "fast", ranks: 1 }, { id: "slow", ranks: 1 }], "beam", "Actor.v");
  const made = MAKE.buildFusedTechnique(base, other, { advantages: ["power", "fast", "slow"], superProfile: "multi-profile", name: "Final Kamehameha" }, lookups);
  check("the Fused Technique: the base with no Disadvantage, the other's Advantages picked (ranks summed, no more than the most), "
    + "an Ultimate with its Super Profile and the other's Profile for Multi-Profile, 4(T) off, renamed, kept and none of its copy flags",
    [made.name, made.system.signature.features, made.system.signature.level, made.system.signature.superProfile,
     made.system.signature.secondProfile, made.system.signature.kiPerTierOff, made.flags["dbu-ttrpg"], "_id" in made],
    ["Final Kamehameha", [{ id: "power", ranks: 3 }, { id: "fast", ranks: 1 }], "ultimate", "multi-profile", "beam", 4,
     { fusedTechnique: true }, false]);
  check("unnamed, it is the base's (Fused); another Super Profile, no second Profile",
    [MAKE.buildFusedTechnique(base, other, { superProfile: "super-beam" }, lookups).name,
     MAKE.buildFusedTechnique(base, other, { superProfile: "super-beam" }, lookups).system.signature.secondProfile], ["Kamehameha (Fused)", ""]);
  const sig = { profile: "beam", features: [], superProfile: "", kiPerTierOff: 0 };
  const plain = TECH.techniqueKiPerTier(sig);
  check("its Ki Point Cost 4(T) less, never below nothing",
    [TECH.techniqueKiPerTier({ ...sig, superProfile: "complete-annihilation" }) - TECH.techniqueKiPerTier({ ...sig, superProfile: "complete-annihilation", kiPerTierOff: 4 }),
     TECH.techniqueKiPerTier({ ...sig, kiPerTierOff: 99 })], [4, 0]);
  check("the Fusion's copies of Signature Techniques, with whose each was",
    MAKE.fusedTechniques({ items: [{ id: "a", type: "maneuver", flags: { "dbu-ttrpg": { fusedCopy: true, fusedFrom: "Actor.g" } }, system: { tags: ["signature"] } },
      { id: "b", type: "maneuver", flags: { "dbu-ttrpg": { fusedCopy: true, fusedFrom: "Actor.v" } }, system: { tags: ["uniqueAbility"] } },
      { id: "c", type: "maneuver", flags: { "dbu-ttrpg": { fusedTechnique: true } }, system: { tags: ["signature"] } }] }).map(each => [each.item.id, each.from]),
    [["a", "Actor.g"]]);
}
{
  const SH3 = read("module", "sheets", "actor-character-sheet.mjs"), MS3 = read("module", "sheets", "item-maneuver-sheet.mjs");
  check("wired: the Fusion tab's Create; the Fused Technique out of its Technique Points; its Super Profile kept on an Ultimate; asked after a first fuse",
    [read("templates", "parts", "actor-fusion.hbs").includes('data-action="fusedTechnique"'), SH3.includes("fusedTechnique: DBUCharacterSheet._onFusedTechnique,"),
     SH3.includes('!item.getFlag?.("dbu-ttrpg", "fusedTechnique"))'), MS3.includes('Boolean(this.item.getFlag?.("dbu-ttrpg", "fusedTechnique"))'),
     read("module", "fusion-make.mjs").includes("if (made) await askFusedTechnique(made);")],
    [true, true, true, true, true]);
}

// --- Stage 4: Fusion Methods & Modifiers -----------------------------------------------------------------------------------------
{
  const MAKE = await import(modUrl("fusion-make.mjs"));
  const TR = await import(modUrl("effects/traits.mjs"));
  const RAC = await import(modUrl("racial.mjs"));
  const GEAR = await import(modUrl("gear.mjs"));
  const FT = await import(modUrl("fusion-traits.mjs"));
  const files = ["metamoran-style", "divine-fusion-method", "maximum-metamorese", "bio-fusion", "fusion-of-fusion-methods", "merged-tuffle",
    ...MAKE.FUSION_MODIFIERS];
  check("every Method Trait (each its Method's) and Fusion Modifier is a file, of its group, in the page's words",
    [files.every(id => TR.getTrait(id)?.kind === "other"), Object.values(F.FUSION_METHODS).map(each => TR.getTrait(each.trait)?.owner),
     MAKE.FUSION_MODIFIERS.every(id => TR.getTrait(id)?.owner === "fusion-modifier"),
     TR.getTrait("metamoran-style").text.includes("(5)-[Triggered/Start of Combat Encounter]: Gain 2 Karma Points. You lose these Karma Points if they are not spent before the Fusion splits back into its Fused Characters."),
     TR.getTrait("fused-transformation").text.includes("Legendary Form: 2(T)")],
    [true, Array(6).fill("fusion-method"), true, true, true]);
  check("given by fusing, never in the Other Traits' picker", RAC.otherTraitsInOrder().some(trait => RAC.FUSION_TRAIT_GROUPS.includes(trait.owner)), false);
  const pupil = (uuid, name, scores, { pl = 10, race = "saiyan", talents = [], minion = false } = {}) => ({ uuid, name, type: minion ? "minion" : "character",
    system: { powerLevel: pl, race, attributes: Object.fromEntries(Object.entries(scores).map(([key, score]) => [key, { score }])) },
    items: talents.map(id => ({ type: "talent", name: id, flags: { "dbu-ttrpg": { sourceId: id } } })) });
  const base = { agility: 5, force: 8, tenacity: 6, scholarship: 2, insight: 4, magic: 1, personality: 3 };
  const a = pupil("Actor.a", "A", base, { pl: 12, talents: ["t1", "t2", "t3", "t4", "t5"] });
  const b = pupil("Actor.b", "B", { ...base, force: 9, tenacity: 9, magic: 3 }, { pl: 11, talents: ["t1", "t2", "t3", "t4", "t9"] });
  check("Balanced Fusion's Attributes: equal or within 1 among them", MAKE.balancedAttributes([a, b]), ["agility", "force", "scholarship", "insight", "personality"]);
  const checks = MAKE.modifierChecks([a, b], { racialCount: 5, bT: 3, partnerOf: who => (who === a ? b : a), rivalOf: () => null });
  check("each Prerequisite, of these Fused Characters - met or not (Enhanced Fusion: no Form among them; Fused Transformation: none shared)",
    MAKE.FUSION_MODIFIERS.map(id => checks[id].ok), [true, true, true, false, true, true, false, false]);
  check("Dominant Personality: 1 Non-Minion, or one alone at the highest Power Level; Synergistic: 2+1(bT) Talents the same",
    [MAKE.modifierChecks([a, { ...b, system: { ...b.system, powerLevel: 12 } }])["dominant-personality"].ok,
     MAKE.modifierChecks([a, { ...b, type: "minion", system: { ...b.system, powerLevel: 12 } }])["dominant-personality"].ok,
     MAKE.modifierChecks([a, b], { bT: 2 })["synergistic-fusion"].ok],
    [false, true, true]);
  check("the Modifiers' limits said, never refused: 2 Temporary, 1 Lasting; fused again, 1 changed",
    [MAKE.modifierWarnings(["x", "y"], "potara"), MAKE.modifierWarnings(["x", "y"], "merge").length,
     MAKE.modifierWarnings(["x", "z"], "potara", { was: ["x", "y"] }), MAKE.modifierWarnings(["z", "w"], "potara", { was: ["x", "y"] }).length],
    [[], 1, [], 1]);
  // Given as Traits of its own: the Method's, the Modifiers', Balanced Fusion's two Attributes written in; taken away as they change.
  const made = [], gone = [];
  const fusion = { name: "Gotenks", items: [{ id: "old-mod", flags: { "dbu-ttrpg": { fusionTrait: true, sourceId: "shared-heritage" } } },
      { id: "kept", flags: { "dbu-ttrpg": { fusionTrait: true, sourceId: "metamoran-style" } } }],
    createEmbeddedDocuments: async (kind, data) => made.push(...data), deleteEmbeddedDocuments: async (kind, ids) => gone.push(...ids) };
  await MAKE.syncFusionTraits(fusion, "metamorese", ["balanced-fusion"], ["force", "magic"]);
  check("its Method Trait and Fusion Modifiers as Traits of its own: one no longer had taken away, one still had kept, Balanced Fusion's Attributes written in",
    [gone, made.map(each => each.name), made[0].flags["dbu-ttrpg"], /force\.mod \+= 2\(bT\);\s*magic\.mod \+= 2\(bT\);/.test(made[0].system.script), made[0].system.other],
    [["old-mod"], ["Balanced Fusion"], { sourceId: "balanced-fusion", fusionTrait: true, balanced: "force,magic" }, true, "fusion-modifier"]);
  check("Divine Fusion Method, Fusion of Fusion Methods: \"Ignore all Apparel Penalties\"",
    [GEAR.ignoresApparelPenalties([{ type: "racial", flags: { "dbu-ttrpg": { sourceId: "divine-fusion-method" } } }], TR.getTrait),
     GEAR.ignoresApparelPenalties([{ type: "racial", flags: { "dbu-ttrpg": { sourceId: "metamoran-style" } } }], TR.getTrait)], [true, false]);
  const grow = (own, sizes) => FT.bioFusionSteps({ _source: { system: { size: own } }, system: { fusion: { fused: sizes.map(size => ({ size })) } } }, 1);
  check("Bio-Fusion (1): 1 above the largest base among the Fused Characters, from its own base; never past Colossal",
    [grow("medium", ["medium", "large"]), grow("enormous", ["medium", "large"]), grow("large", ["colossal", "medium"]),
     FT.bioFusionSteps({ _source: { system: { size: "medium" } }, system: { fusion: { fused: [{ size: "large" }, { size: "medium" }, { size: "small" }] } } }, 2)],
    [2, 0, 3, 3]);
}
{
  const CH4 = read("module", "chat.mjs"), CO4 = read("module", "effects", "conditions.mjs");
  check("wired: Stress Tests passed (Maximum Metamorese) or rescued (Divine Fusion Method); the Fused Technique's Wound for each Fused; its own Partner and Rival; "
    + "the Fusion tab's Choose; Merged Tuffle's mark gone with the Encounter; fusing asks the Modifiers",
    [CH4.includes('actor.system.effects?.slots?.["stress.autoSucceed"] === true'), CH4.includes("await stressRescue(actor, into.name)"),
     CH4.includes("value: fusedWound * fusedCount"), CO4.includes('slots?.["fusion.ownPartner"] === true) return actor;'), CO4.includes('slots?.["fusion.ownRival"] === true) return actor;'),
     read("templates", "parts", "actor-fusion.hbs").includes('data-action="fusionModifiers"'), read("module", "combat.mjs").includes('setCondition(actor, "merged-tuffle-mark", 0)'),
     read("module", "fusion-make.mjs").includes("const modifiers = dance ? { modifiers: [], balanced: [] } : await askModifiers(actors, method,")],
    [true, true, true, true, true, true, true, true]);
}

// --- Stage 5: the Methods' Apparel -----------------------------------------------------------------------------------------------
{
  const MAKE = await import(modUrl("fusion-make.mjs"));
  const TR = await import(modUrl("effects/traits.mjs"));
  const [clothing, sash] = MAKE.metamoranClothing(TR.getTrait);
  check("the Metamoran Clothing: Combat Clothing, High, worn on the Top Layer, Durable, Free Flowing and Stretching (none of its Slots), and its Sash worn - "
    + "made again as the Fusion is fused again",
    [clothing.name, clothing.system.crafted.category, clothing.system.crafted.grade, clothing.system.equipped, clothing.system.layer,
     clothing.system.crafted.qualities.map(each => [each.id, each.free]), /strike \+= \$apparelBonus\(bT\);/.test(clothing.system.crafted.effects),
     sash.name, sash.system.itemType, sash.system.equipped, clothing.flags["dbu-ttrpg"], sash.flags["dbu-ttrpg"].fusedCopy],
    ["Metamoran Clothing", "combat-clothing", 5, true, "top", [["durable", true], ["free-flowing", true], ["stretching", true]], true,
     "Sash", "accessory", true, { fusedCopy: true, methodApparel: true }, true]);
  check("Maxi Fusion's: \"The Metamoran Clothing gains the Divine Apparel Special Apparel Quality\"",
    MAKE.metamoranClothing(TR.getTrait, { divine: true })[0].system.crafted.qualities.map(each => each.id).includes("divine-apparel"), true);
  const piece = (uuid, name, layer, category, qualities, equipped = true) => ({ uuid, name, type: "gear",
    system: { itemType: "apparel", equipped, layer, crafted: { kind: "apparel", category, grade: 3, qualities: qualities.map(id => ({ id, slots: 0 })), effects: "" } },
    toObject() { return JSON.parse(JSON.stringify({ _id: "x", name, type: "gear", flags: {}, system: this.system })); } });
  const goku = { uuid: "Actor.g", name: "Goku", items: [piece("I.g1", "Gi", "top", "combat-clothing", ["durable"]), piece("I.g2", "Undershirt", "bottom", "standard-clothing", []),
    piece("I.g3", "Spare", "middle", "armor", [], false)] };
  const vegeta = { uuid: "Actor.v", name: "Vegeta", items: [piece("I.v1", "Battle Armor", "top", "armor", ["stretching", "durable"])] };
  const combined = MAKE.combinedApparel([goku, vegeta], { top: "I.v1" }, TR.getTrait);
  check("Potara and EX: a Layer at a time, the piece picked with the other's Qualities it qualifies for; a Layer only one wears, theirs; "
    + "a piece not worn, not gained",
    combined.map(each => [each.name, each.system.layer, each.system.equipped, each.system.crafted.qualities.map(entry => entry.id), each.flags["dbu-ttrpg"].fusedFrom]),
    [["Battle Armor", "top", true, ["stretching", "durable"], "Actor.v"], ["Undershirt", "bottom", true, [], "Actor.g"]]);
  check("the same Layer, the first worn where none is picked", MAKE.combinedApparel([goku, vegeta], {}, TR.getTrait)[0].name, "Gi");
  {
    const worn = (name, from, layer, extra = {}) => ({ name, type: "gear", flags: { "dbu-ttrpg": { fusedFrom: from, ...(extra.flags ?? {}) } },
      system: { itemType: "apparel", equipped: true, layer, ...(extra.system ?? {}) } });
    const after = MAKE.onePerLayer([worn("Gi", "Actor.g", "top"), worn("Armor", "Actor.v", "top"), worn("Shirt", "Actor.v", "bottom"),
      worn("Plating", "Actor.g", "", { flags: { naturalArmor: true } }), worn("Dama", "Actor.v", "top", { system: { integrated: true } }),
      { name: "Sword", type: "gear", flags: {}, system: { itemType: "weapon", equipped: true } }], "Actor.v");
    check("review: Merge and Parasitic - one piece worn a Layer, the lead's where both wore it, the other's carried; Natural Armor, Integrated, a Weapon as they were",
      after.map(each => [each.name, each.system.equipped]),
      [["Gi", false], ["Armor", true], ["Shirt", true], ["Plating", true], ["Dama", true], ["Sword", true]]);
  }
  check("review: a Fusion's base Tier for its effects never above 7",
    read("module", "data", "actor-character.mjs").includes("baseTier: this.fusionMade ? Math.min(FUSION_MAX_BASE_TIER, DBUCharacterData.tierOfPowerFor(this.powerLevel))"), true);
}
check("wired: fusing gives the Method's Apparel in place of the Fused Characters'",
  read("module", "fusion-make.mjs").includes("plan.items = await methodItems(actors, method, plan.items);"), true);

// --- Stage 6: Karma, Copy Clone / Copy Being, Tuffle Fusion ----------------------------------------------------------------------
{
  const K = await import(modUrl("karma.mjs"));
  const M = await import(modUrl("maneuvers.mjs"));
  const goku = { uuid: "Actor.g", name: "Goku", system: { karma: 3 } };
  const saiba = { uuid: "Actor.s", name: "Saibaman", system: { karma: 0 } };
  globalThis.fromUuidSync = uuid => ({ "Actor.g": goku, "Actor.s": saiba })[uuid] ?? null;
  const fusion = { type: "fusion", name: "Gokuman", system: { karma: 2, fusion: { fused: [{ uuid: "Actor.g" }, { uuid: "Actor.s", minion: true }] } } };
  check("a Fusion's Karma: its own and each Fused Character's - not a Minion's",
    K.karmaPools(fusion).map(pool => [pool.name, pool.karma]), [["Gokuman (its own)", 2], ["Goku", 3]]);
  check("a Character's, its own alone", K.karmaPools({ type: "character", name: "Goku", system: { karma: 3 } }).length, 1);
  delete globalThis.fromUuidSync;
  const own = library => ({ items: { get: () => ({ system: { unique: { libraryId: library } } }) } });
  check("Copy Clone and Copy Being: \"Target a Character (except a Fusion)\"",
    [Boolean(M.whyNotCopyingFusion(own("copy-clone"), { name: "Copy Clone", itemId: "x" }, [{ type: "fusion", name: "Vegito" }])),
     Boolean(M.whyNotCopyingFusion(own("copy-being"), { name: "Copy Being", itemId: "x" }, [{ type: "fusion", name: "Vegito" }])),
     M.whyNotCopyingFusion(own("copy-being"), { name: "Copy Being", itemId: "x" }, [{ type: "character", name: "Goku" }]),
     M.whyNotCopyingFusion(own("instant-transmission"), { name: "IT", itemId: "x" }, [{ type: "fusion", name: "Vegito" }])],
    [true, true, null, null]);
}
check("wired: Karma asked from which; Copy Being refused at a Fusion before anything is paid; Tuffle Fusion (2) makes the Parasitic Fusion",
  [read("module", "karma.mjs").includes("const pool = await karmaSource(actor, cost, effect.name);"),
   read("module", "use-maneuver.mjs").includes("const copyingFusion = whyNotCopyingFusion(actor, maneuver,"),
   read("module", "chat.mjs").includes('return fuseTogether([actor, target], "parasitic");')],
  [true, true, true]);
check("review: Merged Tuffle's Apparel worn again as the Encounter ends; copies made with the ids their links were pointed at; "
  + "a Fusion not one's own said before anything is asked",
  [read("module", "fusion-traits.mjs").includes('"flags.dbu-ttrpg.mergedTuffleLayer": String(item.system.layer || "top")'),
   read("module", "combat.mjs").includes('"system.layer": item.flags["dbu-ttrpg"].mergedTuffleLayer, "flags.dbu-ttrpg.mergedTuffleLayer": ""'),
   read("module", "fusion-make.mjs").includes('await fusion.createEmbeddedDocuments("Item", items, { keepId: true });'),
   read("module", "fusion-make.mjs").indexOf("is not yours to fuse") < read("module", "fusion-make.mjs").indexOf("const picked = await askRacialTraits(actors);")],
  [true, true, true, true]);
{
  // A Fusion's copied Talents carry their Fused Character's `fromProgression`; a Fusion has no Progression. Fusing writes
  // `system.progression: []`, which runs the Talents' sync - it took every copied Talent off.
  const T = await import(modUrl("talents.mjs"));
  const deleted = [];
  const talent = (id, flags) => ({ id, type: "talent", name: id, flags: { "dbu-ttrpg": { sourceId: id, ...flags } }, system: {} });
  const items = [talent("quick-learner", { fromProgression: true, fusedCopy: true }), talent("own-row", { fromProgression: true })];
  items.get = id => items.find(each => each.id === id);
  const fusionActor = { isOwner: true, type: "fusion", name: "Vegito", items,
    system: { progression: [], powerLevel: 22, characterPerks: [] },
    deleteEmbeddedDocuments: async (kind, ids) => { deleted.push(...ids); }, createEmbeddedDocuments: async () => [], update: async () => {} };
  await T.syncProgressionTalents(fusionActor);
  check("review: a Fusion's copied Talents stay as its (empty) Progression is synced - one of its own rows' still goes; and none is an orphan",
    [deleted, T.orphanTalents(items).map(each => each.id)], [["own-row"], []]);
}

{
  // A Fusion is of every one of its Races, wherever a Race is asked about.
  const F2 = await import(modUrl("fusion.mjs"));
  const G = await import(modUrl("genetic.mjs"));
  const RA = await import(modUrl("racial.mjs"));
  const M2 = await import(modUrl("maneuvers.mjs"));
  const saiyanAndroid = { type: "fusion", name: "Gokunteen", system: { race: "saiyan", fusion: { races: [{ race: "saiyan" }, { race: "android" }] } } };
  const plainSaiyan = { type: "character", name: "Goku", system: { race: "saiyan" } };
  check("races: a Fusion's all of them, anyone else's own; none, none",
    [F2.racesOf(saiyanAndroid), F2.racesOf(plainSaiyan), F2.racesOf({ type: "character", system: { race: "" } })], [["saiyan", "android"], ["saiyan"], []]);
  check("a Gene's Donor: a Fusion of any of its Races; '*' where one of them is no Gene's race; a raceless one still '*'",
    [G.fitsGene(saiyanAndroid, "android"), G.fitsGene(plainSaiyan, "android"), G.fitsGene({ system: { race: "" } }, "*")], [true, false, true]);
  check("Evolution: a Fusion with an Arcosian among its Races, not greyed",
    [RA.otherTraitUnfit({ owner: "evolution" }, ["saiyan", "arcosian"]), RA.otherTraitUnfit({ owner: "evolution" }, ["saiyan"]), RA.otherTraitUnfit({ owner: "evolution" }, "arcosian")],
    ["", "Arcosians' alone", ""]);
  const order = RA.racialTraitsInOrder(["saiyan", "android"], [{ id: "x", name: "Zed", owner: "namekian" }, { id: "y", name: "Bolt", owner: "android" },
    { id: "z", name: "Pride", owner: "saiyan" }]).map(each => each.name);
  check("the Racial Traits' picker: every one of a Fusion's Races' first", order.indexOf("Zed"), 2);
  const multiForm = { get: () => ({ system: { unique: { libraryId: "multi-form-technique" } } }) };
  const angelFusion = { type: "fusion", name: "Whisgoku", items: multiForm, system: { race: "saiyan", fusion: { races: [{ race: "saiyan" }, { race: "angel" }] } } };
  const noAngel = { ...angelFusion, system: { race: "saiyan", fusion: { races: [{ race: "saiyan" }, { race: "android" }] } } };
  check("Angels cannot be Minions: a Fusion with an Angel among its Races, though its lead is not one",
    [Boolean(M2.whyNoAngelDuplicate(angelFusion, { name: "Multi-Form", itemId: "x" }, null, race => race === "angel")),
     M2.whyNoAngelDuplicate(noAngel, { name: "Multi-Form", itemId: "x" }, null, race => race === "angel")], [true, null]);
  check("wired: Unify reads every Race; the Angel checks and More than a Minion (3) any of them; the pickers a Fusion's Races",
    [read("module", "chat.mjs").includes("if (!racesFor(other).some(race => racesFor(actor).includes(race)))"),
     read("module", "chat.mjs").includes("if (racesOf(attacker).some(race => getRace(race)?.noMinion === true))"),
     read("module", "minion-make.mjs").includes("racesOf(copy ?? master).some(race => cannotBeMinion(race))"),
     read("module", "maneuvers.mjs").includes("racesOf(of).some(race => cannot(race))"),
     read("module", "racial.mjs").includes("presetOption = (fitting.length === 1) ? fitting[0].id : \"\";"),
     read("module", "sheets", "actor-character-sheet.mjs").includes("racialTraitsInOrder(racesOf(this.actor), undefined")],
    [true, true, true, true, true, true]);
}

{
  // Karma paid outside the Karma window, and whether there is any to pay: a Fusion's own or a Fused Character's.
  const F3 = await import(modUrl("fusion.mjs"));
  const K3 = await import(modUrl("karma.mjs"));
  const goku = { uuid: "Actor.g", name: "Goku", isOwner: true, system: { karma: 3 }, update: async data => { goku.paid = data; } };
  const saiba = { uuid: "Actor.s", name: "Saibaman", system: { karma: 4 } };
  globalThis.fromUuidSync = uuid => ({ "Actor.g": goku, "Actor.s": saiba })[uuid] ?? null;
  const fusionK = { type: "fusion", name: "Gokuman", isOwner: true, system: { karma: 0, fusion: { fused: [{ uuid: "Actor.g" }, { uuid: "Actor.s", minion: true }] } },
    update: async data => { fusionK.paid = data; } };
  check("what a Character may spend: its own; a Fusion's, the most of its own and a non-Minion Fused Character's",
    [F3.karmaAvailable({ type: "character", system: { karma: 2 } }), F3.karmaAvailable(fusionK)], [2, 3]);
  const paid = await K3.payKarma(fusionK, 1, "Survive");
  check("paid outside the window: from the one pool able, off that Character; nothing to pay, nothing asked",
    [paid, goku.paid, fusionK.paid, await K3.payKarma(fusionK, 0, "Honorbound")], [true, { "system.karma": 2 }, undefined, true]);
  delete globalThis.fromUuidSync;
  check("wired: surviving Death, keeping a Minion alive, Desperation Effects, a new Majin-Dama pay through payKarma; the Karma checks read karmaAvailable",
    [read("module", "chat.mjs").includes('payKarma(subject, 1, "Survive")'), read("module", "chat.mjs").includes("payKarma(master, 1, `Keep ${subject.name} alive`)"),
     read("module", "desperation.mjs").includes("payKarma(holder, cost,"), read("module", "majin-dama.mjs").includes('payKarma(actor, RENEW_KARMA, "A new Majin-Dama")'),
     read("module", "use-maneuver.mjs").includes("(karmaAvailable(actor) < (effect.cost ?? 0))"), read("module", "chat.mjs").includes("if (karmaAvailable(caster) > 0) {")],
    [true, true, true, true, true, true]);
}

// --- Fifth review: a Fusion of Minions is each of its Masters' Minion; a Fusion of Player Characters a Master and a Player Character ---
{
  const A = await import(modUrl("allies.mjs"));
  const actor = (id, type, system = {}) => ({ documentName: "Actor", id, type, name: id, system: { allies: [], minions: [], ...system },
    getFlag: () => undefined });
  const nappa = actor("nappa", "character");
  const raditz = actor("raditz", "character");
  const saiA = actor("saiA", "minion", { master: "nappa" });
  const saiB = actor("saiB", "minion", { master: "raditz" });
  const fused = actor("saiFused", "fusion", { fusion: { minion: true, masters: ["nappa", "raditz"] } });
  const goku = actor("goku", "character");
  const vegito = actor("vegito", "fusion", { fusion: { minion: false }, minions: ["saiC"] });
  const saiC = actor("saiC", "minion");
  const all = [nappa, raditz, saiA, saiB, fused, goku, vegito, saiC];
  globalThis.game.actors = { contents: all, get: id => all.find(each => each.id === id) ?? null };
  check("a Fusion of Minions: each of its Masters' Minion, an Ally of both, no Opponent of either's Minions - an Opponent of anybody else",
    [A.minionsOf(nappa).includes("saiFused"), A.minionsOf(raditz).includes("saiFused"), A.mastersOf(fused), A.masterOf(fused),
     A.areAllies(fused, raditz), A.areOpponents(fused, saiA), A.areOpponents(fused, saiB), A.areOpponents(fused, goku), A.minionsOf(fused)],
    [true, true, ["nappa", "raditz"], "nappa", true, false, false, true, []]);
  check("a Fusion of Player Characters may hold a Minions list: its Minion's Master",
    [A.masterOf(saiC), A.minionsOf(vegito), A.areAllies(saiC, vegito)], ["vegito", ["saiC"], true]);
  globalThis.game.actors = [];
  const COMBAT = read("module", "combat.mjs");
  check("wired: a Fusion of Minions skips its Act Phase uncommanded, recovered once a Recovery Period; its Power Level not its Master's",
    [COMBAT.includes("if (!isMinion(actor) || commandedNow(actor) || actsFreely(actor)) return false;"),
     COMBAT.includes("!actor.system?.defeated && !recovered.has(actor.id));"),
     read("module", "dbu-ttrpg.mjs").includes('|| (minion.type === "fusion")) continue;'),
     read("module", "fusion-make.mjs").includes('actors.map(actor => masterOf(actor) || String(actor.system?.master ?? ""))'),
     read("module", "karma.mjs").includes('max="${Math.max(...karmaPools(actor).map(pool => pool.karma))}"')],
    [true, true, true, true, true]);
}

// --- The Metamoran Fusion Dance (a Unique Ability; the user's text, 2026-11-16) -------------------------------------------------------
{
  const { getTrait, traitsOfKind } = await import(modUrl("effects/traits.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const D = await import(modUrl("fusion-dance.mjs"));
  const ua = getTrait("metamoran-fusion-dance");
  const children = traitsOfKind("unique", "metamoran-fusion-dance").map(each => each.id).sort();
  check("the Unique Ability and its two Advancements, read from their files; Plump and Frail Traits of their own, compiling",
    [ua?.type, ua?.actionCost, ua?.tpCost, ua?.uaType, ua?.fusionDance, compile(ua?.script ?? "").errors.length,
     ua?.script?.includes("skill.performance.bonus += 1;"), children,
     getTrait("five-way-fusion")?.danceFive, getTrait("skill-in-fusion")?.danceAnyone,
     ["plump-fusion", "frail-fusion"].map(id => compile(getTrait(id)?.script ?? "x").errors.length),
     getTrait("frail-fusion")?.script?.includes("magic.mod *= 0.5;"), getTrait("plump-fusion")?.script?.includes("forbid uniqueAbilities;")],
    ["standard", 3, 15, "technical", true, 0, true, ["five-way-fusion", "skill-in-fusion"], true, true, [0, 0], true, true]);

  const dancer = (id, extra = {}) => ({ documentName: "Actor", id, uuid: `Actor.${id}`, name: id, type: "character",
    system: { powerLevel: 10, size: { key: "medium" }, allies: [], minions: [], resources: {}, effects: { slots: {} }, ...extra } });
  const goten = dancer("goten", { allies: ["trunks"] });
  const trunks = dancer("trunks");
  const all = [goten, trunks];
  globalThis.game.actors = { contents: all, get: id => all.find(each => each.id === id) ?? null };
  const why = (a, b, options = {}) => D.whyNotDance(a, b, options);
  check("an Ally, at your Power Level (Holding Back's stacks off it), within 1 Size Category - Skill in Fusion: any Character",
    [why(goten, trunks), Boolean(why(goten, dancer("vegeta"))), why(goten, dancer("vegeta"), { anyone: true }),
     Boolean(why(goten, dancer("trunks", { powerLevel: 11 }))),
     why(goten, dancer("trunks", { powerLevel: 11, resources: { holdingback: { stacks: 1 } } })),
     Boolean(why(goten, dancer("trunks", { size: { key: "enormous" } }))), why(goten, dancer("trunks", { size: { key: "large" } })),
     Boolean(why(goten, { ...trunks, type: "fusion" })), Boolean(why(goten, trunks, { melee: () => "too far" }))],
    [null, true, null, true, null, true, null, true, true]);
  check("its Difficulty: Master; a Size Category apart, one more; Superior Synchronization (1) with your Partner, Expert",
    [D.danceDifficulty(goten, trunks, () => null), D.danceDifficulty(goten, dancer("trunks", { size: { key: "large" } }), () => null),
     D.danceDifficulty(dancer("goten", { effects: { slots: { "sync.danceExpert": true } } }), trunks, () => trunks),
     D.danceDifficulty(dancer("goten", { effects: { slots: { "sync.danceExpert": true } } }), trunks, () => null),
     D.danceDifficulty(dancer("goten", { size: { key: "small" } }), dancer("trunks", { size: { key: "medium" } }), () => null)],
    ["master", "grandmaster", "expert", "master", "grandmaster"]);
  globalThis.game.actors = [];
  check("what both Checks make: both, one, none - not yet; one failed, its 1d4: 1 Frail, 2~4 Plump",
    [D.danceOutcome({ success: true }, { success: true }), D.danceOutcome({ success: true }, { success: false }),
     D.danceOutcome({ success: false }, { success: false }), D.danceOutcome(null, { success: true }), [1, 2, 3, 4].map(D.danceMishap)],
    ["both", "one", "none", "", ["frail", "plump", "plump", "plump"]]);
  const MAKE = read("module", "fusion-make.mjs");
  const CHAT = read("module", "chat.mjs");
  check("wired: asked before paying, posted after; each Check self-correcting; its target gone as the turn begins; no Fusion Modifiers for Plump or Frail",
    [read("module", "use-maneuver.mjs").includes('dancing = await (await import("./fusion-dance.mjs")).askDance(actor, maneuver);'),
     read("module", "use-maneuver.mjs").includes('? await (await import("./fusion-dance.mjs")).postDance(actor, maneuver, dancing)'),
     CHAT.includes('get danceA() { return [DANCE_SIDE.a, () => null,'), CHAT.includes("renderDance(message, html);"),
     read("module", "combat.mjs").includes('if (actor.getFlag?.("dbu-ttrpg", "fusionDance")) await actor.unsetFlag("dbu-ttrpg", "fusionDance");'),
     MAKE.includes("const modifiers = dance ? { modifiers: [], balanced: [] } : await askModifiers("),
     MAKE.includes('"system.fusion.dance": plan.dance ?? "",'), MAKE.includes("const danceTrait = ({ plump: \"plump-fusion\", frail: \"frail-fusion\" })[dance] ?? \"\";"),
     Object.keys(DBUCharacterData.defineSchema().fusion.fields).includes("dance"),
     read("traits", "talents", "superior-synchronization.dbu").includes("allow sync.danceExpert;")],
    [true, true, true, true, true, true, true, true, true, true]);

  // The Fusion tab's result select (the user's: Complete, Plump, Frail - a sub-result of the Metamorese Fusion).
  const MK = await import(modUrl("fusion-make.mjs"));
  const updates = [];
  const made = [];
  const fusionD = { isOwner: true, items: [], system: { fusion: { method: "metamorese", modifiers: ["dominant-personality"], balanced: [],
      fused: [{ uuid: "Actor.g", powerLevel: 10, minion: false }, { uuid: "Actor.t", powerLevel: 10, minion: false }], noFusedTechnique: false } },
    update: async data => updates.push(data), createEmbeddedDocuments: async (type, data) => made.push(...data.map(each => each.flags?.["dbu-ttrpg"]?.sourceId)),
    deleteEmbeddedDocuments: async () => {} };
  const back = await MK.setDance(fusionD, "frail");
  check("set by hand: Frail - its Fusion Modifiers taken off, what they changed worked out again, its Trait given; anything else is Complete",
    [back, updates[0]["system.fusion.dance"], updates[0]["system.fusion.modifiers"], Number.isFinite(updates[0]["system.fusion.tpGained"]),
     made.includes("frail-fusion"), made.includes("metamoran-style"), await MK.setDance(fusionD, "nonsense"), await MK.setDance({ isOwner: false }, "plump")],
    ["frail", "frail", [], true, true, true, "", null]);
  const ctx = F.fusionContext({ system: { fusion: { method: "metamorese", dance: "plump", fused: [] } }, items: { get: () => null } },
    { raceName: () => "", subraceName: () => "", sizeLabel: key => key, trait: () => null, actorAt: () => null, alignments: {} });
  const HBS = read("templates", "parts", "actor-fusion.hbs");
  check("the select beside the Metamorese Method: Complete, Plump, Frail; its change sets it (setDance)",
    [ctx.danceable, ctx.dances.map(each => `${each.label}${each.selected ? "*" : ""}`),
     F.fusionContext({ system: { fusion: { method: "potara", fused: [] } }, items: { get: () => null } },
       { raceName: () => "", subraceName: () => "", sizeLabel: key => key, trait: () => null, actorAt: () => null, alignments: {} }).danceable,
     HBS.includes("<select data-fusion-dance"), read("module", "sheets", "actor-character-sheet.mjs").includes("return setDance(this.actor, select.value);")],
    [true, ["Complete", "Plump*", "Frail"], false, true, true]);
  // Factor Traits (the user's): "count as the type of Racial Trait they replaced" - chosen among the Racial Traits, Secondary or Primary
  // (From Goop) by their importance; never copied by themselves; what an unchosen one gave left off with it.
  {
    const it = (id, name, system = {}, flags = {}) => { const data = { _id: id, name, type: "racial", system, flags: { "dbu-ttrpg": flags } };
      return { ...data, id, toObject: () => structuredClone(data) }; };
    const items = [it("mr", "Majin Regeneration", { importance: "primary" }, { sourceId: "majin-regeneration" }),
      it("fg", "From Goop", { importance: "primary", factor: "primordial-majin" }, { sourceId: "from-goop" }),
      it("pb", "Part Beast", { importance: "secondary", factor: "beast-man" }, { sourceId: "part-beast" }),
      it("cl", "Claws", { other: "bestial" }, { sourceId: "claws", grantedBy: "pb" })];
    const buu = { uuid: "Actor.buu", name: "Buu", items: Object.assign([...items], { get: id => items.find(each => each.id === id) }) };
    const choices = MK.racialChoices([buu]);
    const copied = MK.copiedItems([buu]);
    const claws = copied.find(each => each.name === "Claws");
    check("Factor Traits: chosen as the Racial Trait they replaced - From Goop Primary, Part Beast Secondary - not copied by themselves; "
      + "an Other Trait an unchosen one gave left off, a chosen one's kept",
      [choices.map(each => [each.name, each.group, each.factor]), copied.map(each => each.name),
       MK.withoutUnchosenGrants(copied, [buu], new Set()).length, MK.withoutUnchosenGrants(copied, [buu], new Set(["Actor.buu|pb"])).length,
       claws.flags["dbu-ttrpg"].fusedFrom],
      [[["Majin Regeneration", "primary", false], ["From Goop", "primary", true], ["Part Beast", "secondary", true]], ["Claws"], 0, 1, "Actor.buu"]);
  }
  // Majin Genes (2) and Genetic Focus: Majins (2): "a Majin Secondary Trait of your choice" - given by it (the user's), a row of its Options tab.
  {
    const RA = await import(modUrl("racial.mjs"));
    const { getTrait } = await import(modUrl("effects/traits.mjs"));
    const genes = getTrait("majin-genes");
    const focus = getTrait("genetic-focus-majins");
    const had = { items: [{ flags: { "dbu-ttrpg": { sourceId: "quick-sleep" } } }] };
    const offered = RA.racialGrantChoices(genes, had).map(each => each.id);
    const geneItem = { id: "g1", actor: had, flags: { "dbu-ttrpg": { sourceId: "majin-genes" } },
      system: { chosen: [{ key: "majin-genes#racial", value: "quick-sleep", label: "Majin Genes: Quick Sleep" }] } };
    const rows = await RA.choiceRowsOf(geneItem);
    check("Majin Genes and Genetic Focus: Majins give a Majin Secondary Trait - Secondary alone, not one had (but the one given); a row to change it",
      [genes?.grantsRacialOf, focus?.grantsRacialOf, focus?.grantsRacialImportance, offered.includes("majin-mentality"), offered.includes("majin-regeneration"),
       offered.includes("quick-sleep"), RA.racialGrantChoices(genes, had, "quick-sleep").some(each => each.id === "quick-sleep"),
       rows.map(row => [row.which, row.label, row.current, row.options.some(option => option.selected && (option.value === "quick-sleep"))])],
      ["majin", "majin", "secondary", true, false, false, true, [["racial", "Majin Secondary Trait", "quick-sleep", true]]]);
  }
  const MK2 = read("module", "fusion-make.mjs");
  const DA2 = read("module", "fusion-dance.mjs");
  check("review: fused again any other way, a Metamorese Fusion keeps its result - none by another Method; the card marked fused only when made or asked of the GM; its 1d4 rolled once",
    [MK2.includes('dance = (method !== "metamorese") ? "" : (dance ?? existing?.system?.fusion?.dance ?? "");'),
     MK2.includes("export async function fuseTogether(actors, method, { dance } = {}) {"), MK2.includes("return { name, requested: true };"),
     MK2.includes('if (existing && !existing.isOwner) return void ui.notifications.warn(`${existing.name} is not yours to fuse.`) ?? null;'),
     DA2.includes('if ((made?.documentName === "Actor") || made?.requested) {'), DA2.includes("ROLLED_D4.set(message.id, d4);")],
    [true, true, true, true, true, true]);
}

// --- Fusion of Ki and Energy Synchronize (the user's, 2026-11-16) ---
{
  const KI = await import(modUrl("fusion-of-ki.mjs"));
  const TR = await import(modUrl("effects/traits.mjs"));
  const pc = (uuid, kiMax, kiValue, states = {}, scores = {}) => ({ uuid, name: uuid, system: { ki: { max: kiMax, value: kiValue }, states,
    attributes: Object.fromEntries(Object.entries(scores).map(([key, score]) => [key, { score }])) } });
  const goku = pc("goku", 120, 80, {}, { force: 13, magic: 6, agility: 0, insight: 9 });
  const vegeta = pc("vegeta", 100, 100);
  check("Fusion of Ki: the pools summed (the value never past the Maximum), half of the Linked Ki Points (down) on leaving, 1/4 of the Linked Character's Scores (up) as a script, the Round it is entered the first of 3",
    [KI.linkedPools(goku, vegeta), KI.kiAfterFusion(37), KI.kiAfterFusion(0), KI.attributeShares(goku), KI.attributeShareScript(goku),
     KI.attributeShareScript(null), KI.FUSION_OF_KI_EXTRA_ROUNDS],
    [{ max: 220, value: 180 }, 18, 0, { force: 4, insight: 3, magic: 2 }, "[passive]\nforce.mod += 4;\ninsight.mod += 3;\nmagic.mod += 2;", "", 2]);
  const allied = () => true, foes = () => false;
  check("Energy Synchronize: refused without a target, on yourself, on a non-Ally, or with either in the Fusion of Ki already",
    [KI.whyNotSync(goku, null, { areAllies: allied }) !== null, KI.whyNotSync(goku, goku, { areAllies: allied }) !== null,
     KI.whyNotSync(goku, vegeta, { areAllies: foes }) !== null, KI.whyNotSync(goku, vegeta, { areAllies: allied }),
     KI.whyNotSync(pc("x", 1, 1, { "fusion-of-ki": 1 }), vegeta, { areAllies: allied }) !== null], [true, true, true, null, true]);
  const state = TR.getTrait("fusion-of-ki");
  const sync = TR.getTrait("energy-synchronize");
  check("its files: a Special State entered by the Maneuver alone, (4) on the besideKiLink predicate; a Special Maneuver, 2 Actions, 1/Encounter",
    [state?.kind, state?.specialState, state?.anyoneMayEnter ?? false, state?.script.includes("if (besideKiLink) {"),
     state?.text.includes("(5)-[Triggered, 1/Round]: If you use the United Attack Maneuver in response to their Linked Character’s Attacking Maneuver"),
     sync?.special, sync?.energySync, sync?.actionCost, sync?.usageLimit],
    ["states", true, false, true, true, true, true, 2, "1/encounter"]);
  const AC = read("module", "data", "actor-character.mjs");
  const UA = read("module", "united-attack.mjs");
  const CB = read("module", "combat.mjs");
  const UM = read("module", "use-maneuver.mjs");
  const CH = read("module", "chat.mjs");
  const PA = read("module", "effects", "parser.mjs");
  check("wired: the Maximum read off the flag, (5) a box doubling Additional Power and the Wager once a Round, the link and the State gone with the Encounter, asked before paying and posted, the GM's relay, the predicate registered",
    [AC.includes('if (kiLinked && ((Number(this.states?.["fusion-of-ki"]) || 0) > 0) && (Number(kiLinked.max) > 0)) this.ki.max = Number(kiLinked.max);'),
     UA.includes('if (kiFused) await joiner.setFlag("dbu-ttrpg", "kiFusionUnitedRound", round);'), UA.includes("bonus.value *= 2;"),
     UA.includes("cap * (kiFused ? 2 : 1)"), CB.includes('"flags.dbu-ttrpg.-=kiLink": null,'),
     CB.includes('if (actor.getFlag?.("dbu-ttrpg", "fusionOfKi")) await (await import("./chat.mjs")).requestKiFusion("end", actor.uuid);'),
     UM.includes("askSync(actor, maneuver, { kiLinkTo });"), UM.includes("postSync(actor, maneuver, syncing)"),
     CH.includes('case "kiFusion": return runKiFusion(request.op, request.a, request.b);'), CH.includes("renderKiSync(message, html);"),
     PA.includes('"besideKiLink",')],
    [true, true, true, true, true, true, true, true, true, true, true]);
}

console.log(failed ? `${failed} failing` : "all passing");
process.exit(failed ? 1 : 0);
