/**
 * Tuffles (a Minion Race): Petite Genius, Need for Revenge, Skills of a Genius, Team Reliance.
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
const COND = await import(modUrl("effects/conditions.mjs"));
const P = COND.PREDICATES;
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

/** A token on a 100-pixel grid, for an Actor. */
const token = (actor, x, y = 0) => ({ x, y, width: 1, height: 1, parent: { id: "s" }, actor, document: { x, y, width: 1, height: 1, parent: { id: "s" } } });
const scene = list => { globalThis.canvas = { grid: { size: 100 }, tokens: { placeables: list } }; };

/** A Tuffle with these Items, its Allies listed, prepared - standing at `x` on the scene, with that much Spite. */
function tuffle(items, { x = 0, others = [], spite = 0, allies = ["pal"] } = {}) {
  const parent = new ActorStub({}, { strict: false });
  Object.assign(parent, { type: "character", items, getFlag: () => undefined, uuid: "A.me", id: "me", documentName: "Actor" });
  const mine = token(parent, x);
  parent.getActiveTokens = () => [mine];
  scene([mine, ...others]);
  const model = new DBUCharacterData({ powerLevel: 10, race: "tuffle", allies, ...(spite ? { resources: { spite: { stacks: spite } } } : {}) },
    { strict: false, parent });
  parent.system = model;
  model.prepareBaseData?.();
  model.prepareDerivedData();
  return model;
}
const add = (model, key) => Number(model.effects.slots[key]?.add) || 0;
const pal = { documentName: "Actor", uuid: "A.pal", id: "pal", type: "character", system: { allies: ["me"] }, items: [] };
const foe = { documentName: "Actor", uuid: "A.foe", id: "foe", type: "character", system: { allies: [] }, items: [] };

// --- The race and the Traits ---------------------------------------------------------------------------------------------------
{
  const race = RACES.getRace("tuffle");
  check("the Tuffles: Scholarship or Insight +2, Agility +1; Life Modifier -2; Cognitive; 3 Skill Ranks; Small; a Minion Race",
    [race.attributeChoices, race.attributeIncrease, race.lifeModifier, race.savingThrow, race.skillRanks, race.sizes, race.minionRace],
    [[{ amount: 2, options: ["scholarship", "insight"] }], { agility: 1 }, -2, "cognitive", 3, ["small"], true]);
  const t = getTrait("petite-genius");
  const blocks = compile(t.script).program.blocks.filter(b => b.mode !== "passive")
    .map(b => `${b.mode}/${b.moment}${b.modifiers?.outOfSequence ? "+oos" : ""}`);
  check("Petite Genius: Body, Primary, first - compiling; the Movement out of sequence at the Round's start, never Automatic",
    [t.owner, t.category, t.importance, Number(t.order), compile(t.script).errors.length, blocks],
    ["tuffle", "body", "primary", 1, 0, ["triggered/start-of-round+oos"]]);
}

// --- Petite Genius -------------------------------------------------------------------------------------------------------------
{
  const item = () => [traitItem("petite-genius", 0)];
  const beside = tuffle(item(), { others: [token(pal, 100), token(foe, 500)] });
  const apart = tuffle(item(), { others: [token(pal, 300), token(foe, 100)] });
  check("(1) an Ally adjacent: Defense Value 1(bT), Grapple Checks as the Grappled 2(bT); none apart, an Opponent adjacent not counting",
    [add(beside, "defenseValue"), add(beside, "grapple.defending"), add(apart, "defenseValue"), add(apart, "grapple.defending"),
     beside.effects.slots["petite.swap"]],
    [beside.baseTierOfPower, 2 * beside.baseTierOfPower, 0, 0, true]);
  const rook = tuffle([...item(), traitItem("caste-combat", 1, { option: "rook-caste" })], { others: [token(pal, 300), token(foe, 100)] });
  check("Caste Combat's Rook is for Arlian Racial Traits: an Opponent adjacent counts for allyBeside, not for Petite Genius's allyAdjacent",
    [P.allyBeside({ data: { parent: rook.parent } }), P.allyAdjacent({ data: { parent: rook.parent } }), add(rook, "defenseValue")],
    [true, false, 0]);
  const CH = read("module", "chat.mjs");
  check("wired: the swap button on the attack's card, once a Round, the Ally asked, tokens swapped and the target moved; the Movement verb",
    [CH.includes("  petiteSwapButtons(message, container, attack);"),
     CH.includes("if (!attack || attack.result || attackArea(attack)) return;\n  for (const entry of attackTargets(attack)) {\n    const actor = fromUuidSync(entry.uuid);\n    if (!actor?.isOwner || (actor.system?.effects?.slots?.[\"petite.swap\"] !== true)"),
     CH.includes("const willing = await askPlayerChoice(ally, `${ally.name}: swap places with ${actor.name} and take ${attack.maneuverName}?`,"),
     CH.includes("await requestSwap(actor.uuid, ally.uuid);"),
     CH.includes("export async function maneuverOutOfSequence(actor, id) {"),
     read("module", "effects", "moments-runtime.mjs").includes("case \"maneuverOutOfSequence\": return (await import(\"../chat.mjs\")).maneuverOutOfSequence(actor, String(args[0] ?? \"\"));")],
    Array(6).fill(true));
}

// --- Need for Revenge ----------------------------------------------------------------------------------------------------------
{
  const t = getTrait("need-for-revenge");
  const blocks = compile(t.script).program.blocks.filter(b => b.mode !== "passive").map(b => `${b.mode}/${b.moment}`);
  check("Need for Revenge: Mind, Primary, second - compiling; Spite its Resource; a Threshold and an Ally (not a Minion) Defeated, then "
    + "Defeated's Ally",
    [t.owner, t.category, t.importance, Number(t.order), compile(t.script).errors.length, t.resource, blocks,
     t.script.includes("requires !defeatedMinion;"), t.script.includes("tuffleLegacy(spite);")],
    ["tuffle", "mind", "primary", 2, 0, "spite", ["triggered/threshold", "triggered/ally-defeated", "triggered/defeated"], true, true]);
  const none = tuffle([traitItem("need-for-revenge", 0)]);
  const three = tuffle([traitItem("need-for-revenge", 0)], { spite: 3 });
  // "1/2 of x(T)": half of x times T, rounded down (the user's, 2026-11-21, on "1/2 of G(T)") - no longer half of x, then (T).
  check("x the Spite stacks: Attacking Maneuvers' Ki Point Cost x(T) lower; Defense Value 1/2 of x(T), rounded down",
    [add(none, "attack.kiCost"), add(none, "defenseValue"), add(three, "attack.kiCost"), add(three, "defenseValue")],
    [0, 0, -3 * three.tierOfPower, Math.floor(3 * three.tierOfPower / 2)]);
  const mark = getTrait("need-for-revenge-mark");
  const CH = read("module", "chat.mjs");
  check("(4) Tuffle-Raised's own, by the Resource: its mark, not a Combat Condition, a Combat Roll a stack",
    [mark.combatCondition, compile(mark.script).errors.length,
     CH.includes("spite: { name: \"Need for Revenge\", mark: \"need-for-revenge-mark\" } };"),
     CH.includes("const times = Number(actor?.system?.resources?.[resource]?.stacks) || 0;"),
     read("module", "effects", "moments-runtime.mjs").includes("tuffleLegacy(actor, String(args[0] ?? \"grudge\"));")],
    [false, 0, true, true, true]);
}

// --- Skills of a Genius ---------------------------------------------------------------------------------------------------------
{
  const t = getTrait("skills-of-a-genius");
  const mind = Object.entries(DBUCharacterData.SKILLS).filter(([, s]) => ["scholarship", "insight"].includes(s.attribute)).map(([k]) => k);
  const [a, b, c] = mind;
  const script = t.script.replaceAll("$choice3", c).replaceAll("$choice2", b).replaceAll("$choice", a);
  const blocks = compile(script).program.blocks.filter(x => x.mode !== "passive").map(x => `${x.mode}/${x.moment}`);
  check("Skills of a Genius: Mind, Secondary, third - three Skills of Scholarship or Insight chosen, compiling; a Clash won",
    [t.owner, t.category, t.importance, Number(t.order), [t.choose, t.choose2, t.choose3], t.chooseAttribute, mind.length >= 3,
     compile(script).errors.length, blocks],
    ["tuffle", "mind", "secondary", 3, ["skill", "skill", "skill"], ["scholarship", "insight"], true, 0, ["triggered/clash-win"]]);
  const item = { id: "g", uuid: "A.g", type: "racial", name: t.name, flags: { "dbu-ttrpg": { sourceId: t.id } }, system: { script, chosen: [] } };
  const plain = tuffle([]);
  const calm = tuffle([item]);
  const spiteful = tuffle([item, traitItem("need-for-revenge", 1)], { spite: 1 });
  check("(1) a Rank in each; (2) every Skill's Natural Result 1 higher with no Spite, not with; (4) its flag",
    [[a, b, c].map(k => calm.skills[k].ranks - plain.skills[k].ranks), calm.skills[a].natural, calm.skills.acrobatics?.natural ?? calm.skills[Object.keys(calm.skills)[0]].natural,
     spiteful.skills[a].natural, calm.effects.slots["genius.woundKi"]],
    [[1, 1, 1], 1, 1, 0, true]);
  check("(3) any Skill's Clash won, not another's",
    [P.wonWithAnySkill({ context: { skill: "stealth" } }), P.wonWithAnySkill({ context: { skill: "" } })], [true, false]);
  const RC = read("module", "racial.mjs"), CH = read("module", "chat.mjs");
  check("wired: choose3 asked after the other two and kept apart from them, its row on the sheet; an Attribute list; the Ki on the Wound, not the Capacity",
    [RC.includes("const last = (preset3 !== undefined) ? preset3 : await askChoice(source, source.choose3, { actor, earlier: [choice.value, second.value] });"),
     RC.includes("...(file.choose3 ? [await row(3, file.choose3, third, [first, second].filter(Boolean))] : []),"),
     RC.includes("if (file.choose3) own = fillChoice(own, \"$choice3\", third);"),
     RC.includes(".filter(([, skill]) => !attributes.length || attributes.includes(skill.attribute))"),
     CH.includes("const genius = await geniusWoundKi(attacker, struck);"),
     CH.includes("await requestActorUpdate(attacker, { \"system.ki.value\": attacker.system.ki.value - spent, [`flags.${SCOPE}.geniusWoundRound`]: roundKey() });"),
     CH.includes("...((Number(attack.geniusWound) || 0) ? [{ label: \"Skills of a Genius\", value: Number(attack.geniusWound) }] : []),")],
    Array(7).fill(true));
}

// --- Team Reliance -------------------------------------------------------------------------------------------------------------
{
  const t = getTrait("team-reliance");
  check("Team Reliance: Mind, Secondary, fourth - compiling; its three flags",
    [t.owner, t.category, t.importance, Number(t.order), compile(t.script).errors.length],
    ["tuffle", "mind", "secondary", 4, 0]);
  const giver = (id, mods) => ({ documentName: "Actor", uuid: `A.${id}`, id, type: "character", items: [],
    system: { allies: ["me"], attributes: Object.fromEntries(Object.entries(mods).map(([k, mod]) => [k, { mod }])),
      effects: { slots: { "teamReliance.aura": true } } } });
  const sage = giver("sage", { insight: 2, personality: 9, scholarship: 1 });
  const kid = giver("kid", { insight: 1, personality: 0, scholarship: 3 });
  const at = (who, x, y = 0) => { const own = token(who, x, y); who.getActiveTokens = () => [own]; return own; };
  const both = tuffle([], { allies: ["sage", "kid"], others: [at(sage, 100), at(kid, 0, 100)] });
  const one = tuffle([], { allies: ["sage", "kid"], others: [at(sage, 300), at(kid, 0, 100)] });
  const none = tuffle([], { allies: ["sage", "kid"], others: [at(sage, 300), at(kid, 0, 300)] });
  const stranger = { ...giver("stranger", { personality: 9 }), system: { ...giver("stranger", { personality: 9 }).system, allies: [] } };
  const foe = tuffle([], { allies: [], others: [at(stranger, 100)] });
  check("(1) an adjacent Ally's: 1/4 rounded up of their highest of the three - the highest giver's, not added; none apart or an Opponent",
    [add(both, "combatRolls") || add(both, "strike"), add(one, "strike"), add(none, "strike"), add(foe, "strike")],
    [3, 1, 0, 0]);
  const UA = read("module", "united-attack.mjs"), CH = read("module", "chat.mjs"), MAIN = read("module", "dbu-ttrpg.mjs");
  check("wired: the United Attack's No Action box once a Round; the Basic Attack offered at the one who hit, once a Round, x(T) on its Wound; read again as tokens move",
    [UA.includes("const relyOpen = !free && !syncOpen && !rageOpen && (joiner.system?.effects?.slots?.[\"teamReliance.freeUnited\"] === true)"),
     UA.includes("const noAction = free || synced || raged || relied;"),
     UA.includes("if (relied) await joiner.setFlag(\"dbu-ttrpg\", \"relianceUnitedRound\", round);"),
     CH.includes("if (own.hit && !isAbsoluteMiss(own)) offerTeamReliance(message, attack, target);"),
     CH.includes("maneuverName: \"Basic Attack\", targetUuid: attacker.uuid, reason: `Team Reliance - ${target.name} hit, once a Round`,"),
     CH.includes("...(x ? { woundExtra: [{ label: \"Team Reliance\", written: `+${x}(T)`, value: x * tier }] } : {}) } } });"),
     MAIN.includes("\"skilled-ogre\", \"petite-genius\"]);"), MAIN.includes("\"recolored-saibaman\", \"team-reliance\", \"more-than-a-minion\"]);")],
    Array(8).fill(true));
}

console.log(failed ? `\n${failed} failing` : "\n0 failing");
