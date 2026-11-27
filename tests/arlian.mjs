/**
 * Arlians (a Minion Race): Insect Shell, Pieces of the Hive and its six Options, Difference in Shell and Caste Combat - their Choices following it.
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
const ALLY = await import(modUrl("allies.mjs"));
const GEAR = await import(modUrl("gear.mjs"));
const COND = await import(modUrl("effects/conditions.mjs"));
const P = COND.PREDICATES;

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

/** An Arlian with these Items, prepared - standing where its token is. */
function arlian(items, { at = null } = {}) {
  const parent = new ActorStub({}, { strict: false });
  parent.type = "character";
  parent.items = items;
  parent.getFlag = () => undefined;
  parent.uuid = "Actor.arlian";
  parent.id = "arlian";
  parent.documentName = "Actor";
  parent.getActiveTokens = () => (at ? [at] : []);
  const model = new DBUCharacterData({ powerLevel: 10, race: "arlian" }, { strict: false, parent });
  parent.system = model;
  model.prepareBaseData?.();
  model.prepareDerivedData();
  return model;
}

// --- The Traits ---------------------------------------------------------------------------------------------------------------
{
  const row = id => { const t = getTrait(id); return [t.owner, t.category, t.importance, Number(t.order), compile(t.script).errors.length]; };
  check("the Arlians' four: Insect Shell and Pieces of the Hive Primary, Difference in Shell and Caste Combat Secondary - compiling",
    ["insect-shell", "pieces-of-the-hive", "difference-in-shell", "caste-combat"].map(row),
    [["arlian", "body", "primary", 1, 0], ["arlian", "mind", "primary", 2, 0], ["arlian", "body", "secondary", 3, 0],
     ["arlian", "mind", "secondary", 4, 0]]);
  const pieces = ["king", "queen", "rook", "bishop", "knight", "pawn"];
  const opts = (suffix, of) => pieces.map(p => getTrait(`${p}${suffix}`)).map(o => [o?.optionOf, Number(o?.optionEffect), o?.follows ?? "",
    compile(o?.script ?? "x").errors.length]);
  check("their Options: Pieces of the Hive's six, and Difference in Shell's and Caste Combat's each following the one Pieces of the Hive had",
    [opts("", "pieces-of-the-hive"), opts("-shell"), opts("-caste"),
     [getTrait("difference-in-shell").optionsFollow, getTrait("caste-combat").optionsFollow, getTrait("insect-shell").naturalArmor]],
    [pieces.map(() => ["pieces-of-the-hive", 2, "", 0]), pieces.map(p => ["difference-in-shell", 2, p, 0]),
     pieces.map(p => ["caste-combat", 3, p, 0]), ["pieces-of-the-hive", "pieces-of-the-hive", "Insect Shell"]]);
  const blocks = id => compile(getTrait(id).script).program.blocks.filter(b => b.mode !== "passive")
    .map(b => `${b.mode}/${b.moment}${b.modifiers?.toggle ? "+toggle" : ""}${b.modifiers?.outOfSequence ? "+oos" : ""}`);
  check("what each answers: the Healing Surge with its button (the user's), the Power Up; an adjacent Ally knocked through, out of sequence; "
    + "Pawn at Injured; Caste Combat's turn start, Knight's dodge, Pawn's Defeat",
    [blocks("insect-shell"), blocks("pieces-of-the-hive"), blocks("pawn"), blocks("caste-combat"), blocks("knight-caste"), blocks("pawn-caste")],
    [["triggered/healing-surge+toggle", "triggered/power"], ["triggered/ally-knocked+oos"], ["triggered/threshold+oos"],
     ["triggered/start-of-turn"], ["triggered/dodged-attack+oos"], ["triggered/defeated+oos"]]);
}

// --- Natural Armor: doubled, and more per base Tier -------------------------------------------------------------------------------
{
  const wearer = (marked, items = []) => ({ items, system: { conditions: marked ? { "insect-shell-doubled": 1 } : {} } });
  check("Insect Shell (4): the Apparel Bonus doubled while marked - the whole of it, once",
    [GEAR.naturalArmorFactor(wearer(true)), GEAR.naturalArmorFactor(wearer(false)),
     GEAR.scriptWithPiece("soakValue += $apparelBonus(bT);", { perBaseTier: 2 }, { apparelBonusFactor: 2, apparelBonusPerTier: 1, apparelBonusPerBaseTier: 1 }),
     GEAR.scriptWithPiece("soakValue += $apparelBonus(bT);", { perBaseTier: 2 }, { apparelBonusPerTier: 1 }),
     GEAR.scriptWithPiece("soakValue += ceil($apparelBonus / 2);", { perBaseTier: 3 }, { apparelBonusFactor: 2 })],
    [2, 1, "soakValue += ((2(bT) + 1(T) + 1(bT)) * 2);", "soakValue += (2(bT) + 1(T));", "soakValue += ceil(6 / 2);"]);
  const me = { documentName: "Actor", uuid: "A.me", id: "me", type: "character", system: { allies: ["pal"] },
    items: [traitItem("difference-in-shell", 0, { option: "king-shell" })] };
  const pal = { documentName: "Actor", uuid: "A.pal", id: "pal", type: "character", system: { allies: [] }, items: [] };
  const foe = { documentName: "Actor", uuid: "A.foe", id: "foe", type: "character", system: { allies: [] }, items: [] };
  const mine = token(me, 0);
  me.getActiveTokens = () => [mine];
  scene([mine, token(pal, 100), token(foe, 500)]);
  const beside = GEAR.platingBonusPerBaseTier(me, getTrait);
  scene([mine, token(pal, 300), token(foe, 100)]);
  const apart = GEAR.platingBonusPerBaseTier(me, getTrait);
  const foeOnly = ALLY.besideAnAlly(me);
  me.items.push(traitItem("caste-combat", 1, { option: "rook-caste" }));
  const rook = ALLY.besideAnAlly(me);
  check("Difference in Shell's King: 1(bT) on the Apparel Bonus with an Ally adjacent - an Opponent counting as one with Caste Combat's Rook",
    [beside, apart, foeOnly, rook, ALLY.opponentsCountAsAllies(me)], [1, 0, false, true, true]);
}

// --- Predicates ----------------------------------------------------------------------------------------------------------------
{
  const atts = scores => ({ data: { attributes: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, { score: v }])) } });
  check("Queen's 'Personality has the highest Attribute Score' - a tie included",
    [P.highestScore(atts({ personality: 4, force: 3 }), "personality"), P.highestScore(atts({ personality: 3, force: 3 }), "personality"),
     P.highestScore(atts({ personality: 2, force: 3 }), "personality")], [true, true, false]);
  const me = { documentName: "Actor", uuid: "A.me", id: "me", type: "character", system: { allies: ["pal"] }, items: [] };
  const pal = { documentName: "Actor", uuid: "A.pal", id: "pal", type: "character", system: { allies: [] }, items: [] };
  const foe = { documentName: "Actor", uuid: "A.foe", id: "foe", type: "character", system: { allies: [] }, items: [] };
  const all = [me, pal, foe];
  globalThis.fromUuidSync = uuid => all.find(each => each.uuid === uuid) ?? null;
  globalThis.game = { ...(globalThis.game ?? {}), actors: { contents: all, get: id => all.find(each => each.id === id) } };
  check("Knight's 'an Opponent's Attacking Maneuver' dodged - not an Ally's, not your own",
    [P.dodgedOpponent({ data: { parent: me }, context: { attackerUuid: "A.foe" } }),
     P.dodgedOpponent({ data: { parent: me }, context: { attackerUuid: "A.pal" } }),
     P.dodgedOpponent({ data: { parent: me }, context: { attackerUuid: "A.me" } })], [true, false, false]);
}

// --- On a character ---------------------------------------------------------------------------------------------------------
{
  const plain = arlian([]);
  const queen = arlian([traitItem("caste-combat", 0, { option: "queen-caste" })]);
  const bishop = arlian([traitItem("caste-combat", 0, { option: "bishop-caste" })]);
  const add = (model, key) => Number(model.effects.slots[key]?.add) || 0;
  check("Queen: Combat Rolls and Initiative 1(bT) - Personality as high as any (the Arlians' +1 on it); Bishop: the Ki Point Cost of "
    + "Attacking Maneuvers and Unique Abilities 2(T) lower",
    [plain.attributes.personality.score >= Math.max(...Object.values(plain.attributes).map(each => each.score)),
     add(queen, "initiative"), add(bishop, "attack.kiCost"), add(bishop, "unique.kiCost")],
    [true, queen.baseTierOfPower, -2 * bishop.tierOfPower, -2 * bishop.tierOfPower]);
  const me = token(null, 0);
  const pal = { documentName: "Actor", uuid: "A.pal", id: "pal", type: "character", system: { allies: ["arlian"] }, items: [] };
  scene([me, token(pal, 100)]);
  const together = arlian([traitItem("caste-combat", 0, { option: "knight-caste" })], { at: me });
  scene([me, token(pal, 400)]);
  const alone = arlian([traitItem("caste-combat", 0, { option: "knight-caste" })], { at: me });
  check("Caste Combat (1): Combat Rolls 1(bT) with an Ally adjacent alone",
    [["strike", "dodge", "wound"].map(key => add(together, key)), add(alone, "strike")], [[1, 1, 1].map(n => n * together.baseTierOfPower), 0]);
}

// --- Wired --------------------------------------------------------------------------------------------------------------------
{
  const CH = read("module", "chat.mjs"), MAN = read("module", "maneuvers.mjs"), CB = read("module", "combat.mjs"), RAC = read("module", "racial.mjs");
  check("wired: Insect Shell (3) by its armor's name, (4)'s mark; the ally-knocked Moment, Rook's Opponents; Pawn's broken Shell; the Choice "
    + "following Pieces of the Hive; the Qualities on another's Natural Armor; Shell Burst for the Insect Shell; King's Damage Attribute; "
    + "Knight's dodge, said whose; Pawn's Advantages carried",
    [CH.includes("if ((await askPlayerChoice(target, `${target.name}: ${armor?.name ?? \"Natural Armor\"}`,"),
     CH.includes("await markUntilNextTurn(actor, actor, \"insect-shell-doubled\", 1, \"start\", \"Insect Shell\");"),
     CB.includes("await fireMoment(ally, \"ally-knocked\", { knockedUuid: actor.uuid });"),
     CB.includes("&& (areAllies(token.actor, actor) || opponentsCountAsAllies(token.actor)))"),
     read("module", "natural-armor.mjs").includes("await item.update({ \"system.crafted.breakLost\": (Number(item.system.crafted?.breakLost) || 0) + left });"),
     RAC.includes("presetOption = racialOptionsOf(trait.id).find(option => held && (String(option.follows ?? \"\") === held))?.id ?? \"\";"),
     RAC.includes("?? Array.from(actor?.items ?? []).find(each => (each.id !== item.id) && (each.flags?.[\"dbu-ttrpg\"]?.naturalArmor === true));"),
     read("module", "dbu-ttrpg.mjs").includes("if (![\"sturdy-shell\", \"insect-shell\"].includes(giver?.flags?.[\"dbu-ttrpg\"]?.sourceId)) return;"),
     MAN.includes("return { ...declared, damageAttribute: { label: `${label} + Caste Combat`, value: value + bonus } };"),
     read("module", "use-maneuver.mjs").includes("declared = await (await import(\"./maneuvers.mjs\")).askCasteKing(actor, declared);"),
     CH.includes("await answerFor(fromUuidSync(entry.uuid), \"dodged-attack\", { attackerUuid: attack.attackerUuid ?? \"\" });"),
     CH.includes("if (granted?.borrowedAdvantages?.length) declared = { ...declared, borrowedAdvantages: [...granted.borrowedAdvantages] };"),
     CH.includes("...borrowedAdvantages], weapon, thrown, charges, squaresCharged },")],
    Array(13).fill(true));
}

console.log(failed ? `\n${failed} failing` : "\n0 failing");
