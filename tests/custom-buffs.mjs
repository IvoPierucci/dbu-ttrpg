/**
 * Custom Buffs: rows a player writes in by hand, each Active one a source of effects of its own - gathered, named, and landing on
 * the value it says.
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

const { loadTraits } = await import(modUrl("effects/traits.mjs"));
const { default: DBUCharacterData } = await import(modUrl("data/actor-character.mjs"));
const { getSlot } = await import(modUrl("effects/slots.mjs"));
const { PRIORITY } = await import(modUrl("effects/interpreter.mjs"));
const BUFFS = await import(modUrl("custom-buffs.mjs"));
await loadTraits();

const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");

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

function holding(customBuffs = [], { powerLevel = 30, conditions = {} } = {}) {
  const parent = new ActorStub({}, { strict: false });
  parent.items = [];
  parent.uuid = "Actor.me";
  const model = new DBUCharacterData({ powerLevel, progression: progressionTo(powerLevel), customBuffs, conditions }, { parent, strict: false });
  parent.system = model;
  model.prepareBaseData?.();
  model.prepareDerivedData();
  return parent;
}

let n = 0;
const buff = (effect, rest = {}) => ({ id: `cb${++n}`, name: "", group: "", active: true, effect, flat: 0, perBase: 0, perTier: 0, ...rest });
// The Slots a row contributed to: a number's parts name it by id; a dice Slot is a list of what was added and by whom.
const partsFrom = (actor, row) => Object.entries(actor.system.effects.slots)
  .filter(([, slot]) => (slot?.parts ?? []).some(part => part.sourceId === `custom-buff:${row.id}`)
    || (Array.isArray(slot) && slot.some(each => each.source === BUFFS.customBuffName(row)))).map(([key]) => key);

// --- The list --------------------------------------------------------------------------------------------
{
  const ids = BUFFS.CUSTOM_BUFFS.map(option => option.id);
  check("every option has an id of its own, a label and a section",
    [new Set(ids).size === ids.length, BUFFS.CUSTOM_BUFFS.every(option => option.label && option.section)], [true, true]);
  check("a number or dice option is written against a Slot this system has; a toggle has its line, a quarter its lines",
    BUFFS.CUSTOM_BUFFS.filter(option => !option.direct).filter(option => (option.kind === "toggle") ? !option.line
      : (option.kind === "quarter") ? (typeof option.write !== "function") : !getSlot(option.slot)).map(option => option.id), []);
  check("those read straight off the rows have no script at all",
    BUFFS.CUSTOM_BUFFS.filter(option => option.direct).map(option => [option.id, BUFFS.customBuffScript({ active: true, effect: option.id, flat: 2 })]),
    [["naturalArmor.apparelBonus", ""], ["naturalArmor.double", ""], ["threshold.higher", ""], ["threshold.lower", ""], ["mark.hyped", ""],
     ["mark.rooted", ""], ["analysis.any", ""], ["intuit.any", ""], ["basicAsSignature", ""], ["wereTraits", ""]]);
  // A Slot nothing reads does nothing (ToP Extra Dice (All) was one): each of these is read where a roll is made, the rest
  // by the character's own values - checked below, one by one.
  check("no option is written to the Slot nothing reads yet", BUFFS.customBuffOption("dice.extra.instances"), null);
  check("the spreadsheet's toggles of this stage are toggles",
    ["insight.mod.double", "defenseValue.halve", "surgency.halve", "speed.normal.halve", "speed.boosted.halve", "speed.all.halve"]
      .map(id => BUFFS.customBuffOption(id)?.kind), ["toggle", "toggle", "toggle", "toggle", "toggle", "toggle"]);
  check("where the spreadsheet keeps bonuses and penalties apart, a negative one is a penalty (`split`)",
    ["capacity.flat", "soakValue", "defenseValue", "combatRolls", "strike", "strike.physical", "dodge", "wound", "wound.magic",
      "speed.normal", "speed.all", "strike.signature", "wound.signature", "strike.armed", "wound.armed", "life.max", "might"]
      .map(id => BUFFS.customBuffOption(id)?.split),
    [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, false, false]);
  check("what the user had taken out is not on the list",
    BUFFS.CUSTOM_BUFFS.filter(option => /Power Burst|Gravity|Surging Extra|Superior Dice Size|Transformation Lite|Bludgeoned/.test(option.label))
      .map(option => option.label), []);
}

// --- Every option, switched on: compiled, gathered, and landing on a Slot ---------------------------------
{
  const quiet = [];
  const silent = [];
  for (const option of BUFFS.CUSTOM_BUFFS.filter(each => !each.direct)) {
    const row = buff(option.id, { flat: 1, perBase: 1, perTier: 1 });
    const actor = holding([row]);
    const errors = (actor.system.effects.errors ?? []).filter(error => String(error).includes("Custom Buff"));
    if (errors.length) quiet.push(`${option.id}: ${errors[0]}`);
    else if ((option.kind === "toggle") && option.line.startsWith("allow ")) {
      // A flag: true or nothing, with no parts to name it by.
      if (actor.system.effects.slots[option.line.slice(6, -1)] !== true) silent.push(option.id);
    }
    else if (!partsFrom(actor, row).length) silent.push(option.id);
  }
  check("no option's script is refused", quiet, []);
  check("every option contributes to a Slot while Active", silent, []);
}

// --- Every option that is the character's own value changes one --------------------------------------------
{
  // Read where a roll or a cost is made (chat.mjs rollSide, maneuvers.mjs), not on the character.
  const atTheRoll = new Set(["combatRolls.d4", "combatRolls.d6", "combatRolls.d8", "combatRolls.d10", "charges.category",
    "criticalTarget.strike", "strike.natural", "criticalTarget.physical", "criticalTarget.energy", "criticalTarget.magic", "strike.signature",
    "strike.armed", "criticalTarget.dodge", "dodge.natural", "criticalTarget.wound", "wound.natural", "wound.signature", "wound.armed",
    "attack.kiCost", "unique.kiCost", "unique.magical.kiCost", "unique.technical.kiCost",
    // The dice of one roll alone, and those applied again (chat.mjs rollOwnDice) - checked on their own below.
    ...["dodge", "strike", "wound"].flatMap(roll => [`dice.greater.times.${roll}`, `dice.extra.times.${roll}`,
      ...[4, 6, 8, 10].map(die => `${roll}.d${die}`)]), "dice.greater.times", "dice.extra.times",
    // Read where an attack is measured, paid for or declared; and off the rows, with no Natural Armor worn here.
    "longRange.squares", "attack.kiCost.uncapped", "attack.damageCategory", "naturalArmor.apparelBonus", "naturalArmor.double",
    // Rooted has no rule of its own - what asks for it is an Arboreal's; Analyzed is an attack's; no Were-Beast here.
    "mark.rooted", "analysis.any", "intuit.any", "basicAsSignature", "wereTraits",
    // A Clash's, a Maneuver's price, and what an effect is asked - none of them a value of the character's.
    "clash.might", "clash.duel", "maneuvers.kiCost.times", "threshold.higher", "threshold.lower",
    // Left off as the roll is made.
    "strike.noPenalties", "dodge.noPenalties", "wound.noPenalties",
    // An attack's own: its Foundation's Wound Roll, an Unarmed one's, a Signature Technique's, its Damage Attribute.
    "charges.signatureCategory", "strike.unarmed", "wound.unarmed", "damageAttribute", "damageAttribute.times",
    ...["physical", "energy", "magic"].flatMap(key => [`criticalTarget.wound.${key}`, `wound.natural.${key}`]),
    ...["agility", "force", "tenacity", "scholarship", "insight", "magic", "personality", "surgency"].map(key => `damageAttribute.use.${key}`),
    "criticalTarget.signature.strike", "criticalTarget.signature.wound", "dice.extra.times.signature", "dice.extra.times.signature.strike",
    "dice.extra.times.signature.wound", ...["", "strike.", "wound."].flatMap(roll => [4, 6, 8, 10].map(die => `signature.${roll}d${die}`)),
    // With no Super Stacks, no Muscle Penalty; no Skill of Force's.
    "superStack.musclePenalty", "skills.of.force"]);
  const shown = actor => { const out = {};
    for (const key of Object.keys(actor.system)) { if (!["effects", "customBuffs", "parent"].includes(key)) out[key] = actor.system[key]; }
    return JSON.stringify(out, (key, value) => (key === "parent") ? undefined : value); };
  const plain = shown(holding());
  check("switched on, the character's own values are not what they were",
    BUFFS.CUSTOM_BUFFS.filter(option => !atTheRoll.has(option.id))
      .filter(option => shown(holding([buff(option.id, { flat: 2 })])) === plain).map(option => option.id), []);
  const chat = read("module", "chat.mjs");
  check("and those of a roll are read where it is made",
    [chat.includes('actor.system.effects?.slots?.["combatRolls.dice"]'), chat.includes("`${slot}.natural`"),
     chat.includes('slots?.["criticalTarget.strike"]'), chat.includes('slots?.["criticalTarget.wound"]'),
     chat.includes('slots?.["criticalTarget.dodge"]'), chat.includes("`criticalTarget.${attack.foundation}`"),
     chat.includes('slots?.["charges.category"]'), read("module", "technique-attack.mjs").includes('slots?.["strike.signature"]'),
     read("module", "maneuvers.mjs").includes("`unique.${maneuver.uniqueType}.kiCost`")],
    [true, true, true, true, true, true, true, true, true]);
}

// --- One roll's dice alone -----------------------------------------------------------------------------------
{
  const chat = read("module", "chat.mjs");
  const cut = name => {
    const at = chat.indexOf(`function ${name}(`);
    let depth = 0, i = chat.indexOf(") {", at) + 2;
    for (; i < chat.length; i++) { if (chat[i] === "{") depth++; else if (chat[i] === "}" && !--depth) break; }
    return chat.slice(at, i + 1);
  };
  const { combatRollOf, tierDice, rollOwnDice } = new Function(
    `${cut("combatRollOf")}\n${cut("tierDice")}\n${cut("rollOwnDice")}\nreturn { combatRollOf, tierDice, rollOwnDice };`)();
  const plain = holding();
  const base = plain.system.dice.extra.formula;
  const greater = plain.system.dice.greater.formula;

  const raised = holding([buff("dice.extra.strike.category", { flat: 1 })]);
  check("ToP Extra Dice Cat. (Strike): a Strike Roll's a Category higher; a Dodge's and a Wound's, and every roll's, as they were",
    [tierDice(raised, "strike") !== base, tierDice(raised, "dodge"), tierDice(raised, "wound"), tierDice(raised, null),
     tierDice(plain, "strike"), raised.system.dice.extraStrike.category - raised.system.dice.extra.category],
    [true, base, base, base, base, 1]);
  const both = holding([buff("dice.extra.category", { flat: 1 }), buff("dice.extra.wound.category", { flat: 1 })]);
  check("with what raises them all, under the one ceiling",
    [both.system.dice.extraWound.category - plain.system.dice.extra.category, both.system.dice.extraStrike.category - plain.system.dice.extra.category,
     holding([buff("dice.extra.dodge.category", { flat: 99 })]).system.dice.extraDodge.category - plain.system.dice.extra.category
       === plain.system.dice.maxCategoryIncrease], [2, 1, true]);

  const more = holding([buff("dice.extra.times", { name: "Twice", flat: 1 }), buff("dice.greater.times.dodge", { name: "Reflexes", flat: 2 }),
    buff("wound.d6", { name: "Sharp", flat: 2 }), buff("strike.d4", { name: "Quick", flat: 1, perBase: 1 })]);
  const said = (actor, roll) => rollOwnDice(actor, roll).map(group => `${group.label}=${group.formula}`);
  const bT = plain.system.baseTierOfPower;
  check("ToP Extra Dice (All): once more on every Combat Roll; Greater Dice (Dodge): on a Dodge alone; Extra dN on its own roll - each named",
    [said(more, "strike"), said(more, "dodge"), said(more, "wound"), said(more, null), said(plain, "strike")],
    [["Custom Buff: Quick=1d4", `Custom Buff: Quick=${bT}d4`, `Custom Buff: Twice=${base}`],
     [`Custom Buff: Twice=${base}`, `Custom Buff: Reflexes=${greater}`, `Custom Buff: Reflexes=${greater}`],
     ["Custom Buff: Sharp=2d6", `Custom Buff: Twice=${base}`], [`Custom Buff: Twice=${base}`], []]);
  check("a Parry's is a Strike Roll; any other roll is none of the three",
    [combatRollOf("parry"), combatRollOf("strike"), combatRollOf("dodge"), combatRollOf("wound"), combatRollOf("save.morale"), combatRollOf(null)],
    ["strike", "strike", "dodge", "wound", null, null]);
  check("fewer than none is none",
    said(holding([buff("dice.extra.times", { flat: -3 }), buff("dice.greater.times.strike", { flat: -1 })]), "strike"), []);
  check("read where the roll is made and where its window is drawn - the Strike's, the Wound's and each defence's knowing which they are",
    [chat.includes("&& (extraDice === actor?.system?.dice?.extra?.formula)) extraDice = tierDice(actor, combatRollOf(slot));"),
     chat.includes("...(combatRoll ? rollOwnDice(actor, combatRollOf(slot), signatureRoll) : []),"),
     chat.includes("...rollOwnDice(actor, combatRollOf(slot), signature)\n  ].filter(group => group.formula);"),
     chat.includes('{ label: "Extra dice", formula: tierDice(attacker, "wound") },'),
     chat.includes('dice: combatDiceGroups(attacker, null, "strike", effectSignature(attacker, attack)),'),
     (chat.match(/combatDiceGroups\((actor|attacker), woundDice\((actor|attacker), attack\), "wound"(, effectSignature\(attacker, attack\))?\)/g) ?? []).length,
     (chat.match(/combatDiceGroups\(actor, null, key\)/g) ?? []).length],
    [true, true, true, true, true, 3, 2]);
}

// --- An attack's own: a Signature Technique's, an Unarmed one's, a Wound by its Foundation, the Damage Attribute -----
{
  const chat = read("module", "chat.mjs");
  const cut = name => {
    const at = chat.indexOf(`function ${name}(`);
    let depth = 0, i = chat.indexOf(") {", at) + 2;
    for (; i < chat.length; i++) { if (chat[i] === "{") depth++; else if (chat[i] === "}" && !--depth) break; }
    return chat.slice(at, i + 1);
  };
  const { namedDamageAttribute, damageAttributeOf } = await import(modUrl("technique-attack.mjs"));
  const { rollOwnDice, woundBase } = new Function("DBUCharacterData", "namedDamageAttribute",
    `${cut("tierDice")}\n${cut("rollOwnDice")}\n${cut("woundBase")}\nreturn { rollOwnDice, woundBase };`)(DBUCharacterData, namedDamageAttribute);
  const plain = holding();
  const base = plain.system.dice.extra.formula;
  const said = (actor, roll, signature) => rollOwnDice(actor, roll, signature).map(group => `${group.label}=${group.formula}`);

  const tech = holding([buff("signature.d6", { name: "Finisher", flat: 1 }), buff("signature.wound.d8", { name: "Big", flat: 2 }),
    buff("dice.extra.times.signature.strike", { name: "Aimed", flat: 1 })]);
  check("a Signature Technique's dice: both rolls', the one named's, and its Tier of Power Extra Dice again - never another attack's",
    [said(tech, "strike", true), said(tech, "wound", true), said(tech, "strike", false), said(tech, "wound", false), said(tech, "dodge", true)],
    [["Custom Buff: Finisher=1d6", `Custom Buff: Aimed=${base}`], ["Custom Buff: Finisher=1d6", "Custom Buff: Big=2d8"], [], [], []]);
  check("its Critical Targets, a Wound's by its Foundation and that Wound's Natural Result, read as the roll is made",
    [chat.includes("(Number(actor.system.effects?.slots?.[`criticalTarget.signature.${combatRollOf(slot)}`]?.add) || 0) : 0)) : 0;"),
     chat.includes("(Number(actor.system.effects?.slots?.[`criticalTarget.wound.${foundation}`]?.add) || 0) : 0)"),
     chat.includes("applySlot(actor.system.effects?.slots, `wound.natural.${foundation}`, 0) : 0);"),
     chat.includes("    signatureRoll: effectSignature(attacker, attack),\n    forceCritical: Boolean(attack.profileCritical),"),
     chat.includes('slot: "wound", attackingManeuver: true, foundation: attack.foundation ?? "",'),
     chat.includes('slot: "wound", foundation: chosen.foundation ?? ""')], [true, true, true, true, true, true]);
  check("its Energy Charges a Category higher; an Unarmed Attack's Strike and Wound, beside an Armed one's",
    [chat.includes('? (Number(actor.system.effects?.slots?.["charges.signatureCategory"]?.add) || 0) : 0)')
       && chat.includes('+ (((maneuver.tags ?? []).includes("signature") || customBuffBasicIsSignature(actor.system, maneuver.id))'),
     chat.includes('const bare = (!attack.weapon || attack.weapon.unarmed) ? (Number(slots["strike.unarmed"]?.add) || 0) : 0;'),
     chat.includes('const bareWound = (!attack.weapon || attack.weapon.unarmed) ? (Number(attacker.system?.effects?.slots?.["wound.unarmed"]?.add) || 0) : 0;')],
    [true, true, true]);

  // The Damage Attribute.
  const physical = { foundation: "physical" };
  const magicAttack = { foundation: "magic" };
  const raised = holding([buff("damageAttribute", { name: "Heavy", flat: 3 })]);
  check("Damage Attribute: on a Physical, an Energy or a Magic Attack's - whichever it is",
    [woundBase(raised, physical).value - woundBase(plain, physical).value, woundBase(raised, magicAttack).value - woundBase(plain, magicAttack).value,
     woundBase(raised, { foundation: "energy" }).value - woundBase(plain, { foundation: "energy" }).value,
     BUFFS.customBuffScript(buff("damageAttribute", { flat: 3 }))],
    [3, 3, 3, "[passive]\ndamageAttribute.physical += 3;\ndamageAttribute.energy += 3;\ndamageAttribute.magic += 3;"]);
  const nimble = holding([buff("damageAttribute.use.agility")]);
  const surging = holding([buff("damageAttribute.use.surgency")]);
  const force = plain.system.attributes.force.mod;
  check("Use Damage Attribute (Agility): its Modifier in the Foundation's place; (Surgency): Surgency; one named on the attack kept",
    [namedDamageAttribute(plain, physical), namedDamageAttribute(nimble, physical),
     woundBase(nimble, physical).value - woundBase(plain, physical).value, namedDamageAttribute(surging, physical),
     namedDamageAttribute(nimble, { foundation: "physical", damageAttribute: { label: "Scholarship", value: 2 } })],
    [null, { label: "Agility", value: nimble.system.attributes.agility.mod }, nimble.system.attributes.agility.mod - force,
     { label: "Surgency", value: surging.system.surgency }, { label: "Scholarship", value: 2 }]);
  check("and where a Signature Technique's feature reads it (technique-attack.mjs damageAttributeOf)",
    [damageAttributeOf(plain, physical), damageAttributeOf(nimble, physical), damageAttributeOf(surging, magicAttack)],
    [force, nimble.system.attributes.agility.mod, surging.system.surgency]);
  check("Damage Attribute Times Applied: so many more times on the Wound Roll, named - beside a Profile's own once more",
    [chat.includes('const moreTimes = Math.max(0, Number(attacker.system.effects?.slots?.["damageAttribute.times"]?.add) || 0);'),
     chat.includes("parts.push({ label: `${giver} (${said}${moreTimes > 1 ? ` x${moreTimes}` : \"\"})`, value: modifier * moreTimes });"),
     chat.includes("if (profile?.extraDamageAttribute || attack.technique?.extraDamageAttribute || moreTimes) {")], [true, true, true]);
}

// --- Long Range, the Ki Point Cost past its Minimum, the Damage Category; Natural Armor -----------------------
{
  const on = holding([buff("longRange.squares", { flat: 3 }), buff("attack.kiCost.uncapped", { flat: -2 }), buff("attack.damageCategory", { flat: 1 })]);
  const added = key => on.system.effects.slots[key]?.add ?? 0;
  const maneuvers = read("module", "maneuvers.mjs");
  const chat = read("module", "chat.mjs");
  check("Long Range Distance: 9 + the buff; Ki Point Cost Attacks (no cap): past the Minimum, never below nothing; Attacking Damage Category: as it is declared",
    [added("longRange.squares"), added("attack.kiCost.uncapped"), added("attack.damageCategory"),
     maneuvers.includes('+ (Number(actor?.system?.effects?.slots?.["longRange.squares"]?.add) || 0)));'),
     maneuvers.includes('if (Number(slots?.["attack.kiCost.uncapped"]?.add) || 0) cost = Math.max(0, applySlot(slots, "attack.kiCost.uncapped", cost));'),
     maneuvers.indexOf('"attack.kiCost.uncapped", cost));') > maneuvers.indexOf("cost = Math.max(cost, minimumAttackKiCost(declared?.profile, actor));"),
     chat.includes('+ (reflecting ? 0 : (Number(actor.system.effects?.slots?.["attack.damageCategory"]?.add) || 0))')],
    [3, -2, 1, true, true, true, true]);

  // Natural Armor: read off the rows, as the piece is read before any effect has run.
  const GEAR = await import(modUrl("gear.mjs"));
  const { compile } = await import(modUrl("effects/parser.mjs"));
  const armored = holding([buff("naturalArmor.apparelBonus", { flat: -1, perBase: 2, perTier: 1 }),
    buff("naturalArmor.apparelBonus", { flat: 3 }), buff("naturalArmor.apparelBonus", { flat: 50, active: false }),
    buff("naturalArmor.double")]);
  const bare = holding();
  check("Natural Armor Apparel Bonus: its Flat, (bT) and (T), every Active row's together; Double Natural Armor AB: doubled",
    [BUFFS.customBuffAmounts(armored, "naturalArmor.apparelBonus"), GEAR.platingBonusFlat(armored), GEAR.platingBonusPerBaseTier(armored, () => null),
     GEAR.platingBonusPerTier(armored, () => null), GEAR.naturalArmorFactor(armored), GEAR.naturalArmorFactor(bare),
     GEAR.platingBonusFlat(bare), BUFFS.customBuffOn(armored, "naturalArmor.double"), BUFFS.customBuffOn(bare, "naturalArmor.double")],
    [{ flat: 2, perBase: 2, perTier: 1 }, 2, 2, 1, 2, 1, 0, true, false]);
  const written = tokens => GEAR.scriptWithPiece("[passive]\nsoakValue += $apparelBonus(bT);", { perBaseTier: 2 }, tokens);
  const lowered = written({ apparelBonusPerTier: -1, apparelBonusPerBaseTier: 2, apparelBonusFlat: -3, apparelBonusFactor: 2 });
  check("written into the piece's own script - what lowers it taken off - and a script the language takes",
    [written({}), written({ apparelBonusFlat: 2 }), lowered, compile(lowered).errors, compile(written({ apparelBonusFlat: 2 })).errors],
    ["[passive]\nsoakValue += 2(bT);", "[passive]\nsoakValue += (2(bT) + 2);",
     "[passive]\nsoakValue += ((2(bT) - 1(T) + 2(bT) - 3) * 2);", [], []]);
  const tiers = { baseTier: 3, tier: 3 };
  check("a number as any other on its row - Flat, (bT) and (T) - and a toggle",
    [BUFFS.customBuffTotal(buff("naturalArmor.apparelBonus", { flat: 1, perBase: 1, perTier: 1 }), tiers),
     BUFFS.customBuffTakesBase(BUFFS.customBuffOption("naturalArmor.apparelBonus")), BUFFS.customBuffTakesTier(BUFFS.customBuffOption("naturalArmor.apparelBonus")),
     BUFFS.customBuffTotal(buff("naturalArmor.double"), tiers), BUFFS.customBuffTakesBase(BUFFS.customBuffOption("naturalArmor.double"))],
    ["+7", true, true, "On", false]);
  const data = read("module", "data", "actor-character.mjs");
  check("and on the Natural Armor its owner's effects read",
    data.includes("? ((Number(reading.bonus) || 0) + perTier + perBase + platingBonusFlat(this.parent)) * naturalArmorFactor(this.parent) : 0 };"), true);
}

// --- The toggles that hold a mark on, or stand in for a Maneuver -----------------------------------------------
{
  const plain = holding();
  const marked = holding([], { conditions: { hyped: 1 } });
  const toggled = holding([buff("mark.hyped")]);
  const both = holding([buff("mark.hyped")], { conditions: { hyped: 1 } });
  // The Dodge: one of the three Combat Rolls the mark raises.
  const strike = actor => actor.system.combat.dodge;
  check("Hyped: as the Hype Maneuver's mark is - its Combat Rolls, once; nothing written to the character",
    [strike(toggled) - strike(plain), strike(toggled) === strike(marked), strike(both) === strike(marked), strike(marked) > strike(plain),
     toggled.system.conditions.hyped ?? 0, BUFFS.customBuffMarks(toggled.system), BUFFS.customBuffMarked(toggled.system, "Hyped"),
     BUFFS.customBuffMarked(plain.system, "hyped"), BUFFS.customBuffMarks(holding([buff("mark.rooted", { active: false })]).system)],
    [strike(marked) - strike(plain), true, true, true, 0, ["hyped"], true, false, []]);
  const conditions = read("module", "effects", "conditions.mjs");
  const chat = read("module", "chat.mjs");
  check("asked of every effect that asks for it; Rooted the same, and its Clash; Analyzed whoever the attack is aimed at",
    [conditions.includes('|| customBuffMarked(scope.data, name),'),
     chat.includes('|| customBuffMarked(actor?.system, "rooted"))'),
     chat.includes('const theirs = customBuffOn(actor, "analysis.any") || (actor.system.timed ?? []).some(entry =>'),
     BUFFS.customBuffOn(holding([buff("analysis.any")]), "analysis.any"), BUFFS.customBuffOn(plain, "analysis.any")],
    [true, true, true, true, false]);

  // Get Were-Traits.
  const { traitAside } = await import(modUrl("aside.mjs"));
  const were = { flags: { "dbu-ttrpg": { wereTrait: true } } };
  const normal = { flags: { "dbu-ttrpg": { normalTrait: true } } };
  const beast = rows => ({ getFlag: () => null, system: { customBuffs: rows } });
  const on = beast([buff("wereTraits")]);
  const off = beast([buff("wereTraits", { active: false })]);
  check("Get Were-Traits: the Were-Traits and not the Normal Trait, with no Round chosen for them - and as ever while it is off",
    [traitAside(were, [], on), traitAside(normal, [], on), traitAside(were, [], off), traitAside(normal, [], off)],
    ["", "normal", "were", ""]);
}

// --- No Strike / Dodge / Wound Penalties: every penalty of that roll left off ---------------------------------
{
  const chat = read("module", "chat.mjs");
  const at = chat.indexOf("function strikePenaltiesIgnored(");
  let depth = 0, i = chat.indexOf(") {", at) + 2;
  for (; i < chat.length; i++) { if (chat[i] === "{") depth++; else if (chat[i] === "}" && !--depth) break; }
  const ignored = new Function("customBuffOn", `${chat.slice(at, i + 1)}\nreturn strikePenaltiesIgnored;`)(BUFFS.customBuffOn);
  const said = parts => parts.map(part => `${part.label}=${part.value}`);
  const roll = [{ label: "Wound", value: 10 }, { label: "Health Threshold", value: -3 }, { label: "Ki Wager", value: 4 }];

  // A penalty an effect wrote to the Wound itself, beside one named at the roll.
  const hurt = holding([buff("wound", { name: "Curse", flat: -5 }), buff("wound.physical", { name: "Sprain", flat: -2 }), buff("wound.noPenalties")]);
  const plain = holding([buff("wound", { name: "Curse", flat: -5 }), buff("wound.physical", { name: "Sprain", flat: -2 })]);
  check("No Wound Penalties: what takes off the roll left off, and what effects took off the Wound - and off its Foundation's - given back",
    [said(ignored(hurt, "wound", roll, "physical")), said(ignored(hurt, "wound", roll, "energy")), said(ignored(plain, "wound", roll, "physical")),
     said(ignored(hurt, "strike", roll, "physical"))],
    [["Wound=10", "Ki Wager=4", "Custom Buff (penalties ignored)=7"], ["Wound=10", "Ki Wager=4", "Custom Buff (penalties ignored)=5"],
     ["Wound=10", "Health Threshold=-3", "Ki Wager=4"], ["Wound=10", "Health Threshold=-3", "Ki Wager=4"]]);
  const strikeRoll = [{ label: "Strike", value: 12, workingsKey: "strike.physical" }, { label: "Dim. Offense", value: -4 }];
  const dodgeRoll = [{ label: "Defense Value", value: 9 }, { label: "Dim. Defense", value: -2 }];
  const steady = holding([buff("strike", { name: "Curse", flat: -3 }), buff("defenseValue", { name: "Slowed", flat: -1 }),
    buff("strike.noPenalties"), buff("dodge.noPenalties")]);
  check("No Strike Penalties and No Dodge Penalties: the flags Masterful Strike and Masterful Dodge answer to, named for the row",
    [said(ignored(steady, "strike", strikeRoll)), said(ignored(steady, "dodge", dodgeRoll)),
     steady.system.effects.slots["strike.ignorePenalties"], steady.system.effects.slots["dodge.ignorePenalties"],
     hurt.system.effects.slots["wound.ignorePenalties"], said(ignored(holding(), "strike", strikeRoll))],
    [["Strike=12", "Custom Buff (penalties ignored)=3"], ["Defense Value=9", "Custom Buff (penalties ignored)=1"], true, true, true,
     ["Strike=12", "Dim. Offense=-4"]]);
  check("the roll says which Foundation it is",
    chat.includes("...multiFormRow(actor, combatRoll)],\n    foundation);"), true);
}

// --- The last of the spreadsheet's: the Ki Point Cost once more, a Duel's and a Might Clash, Seen, the Thresholds ------
{
  const MANEUVERS = await import(modUrl("maneuvers.mjs"));
  const chat = read("module", "chat.mjs");
  const plain = holding();
  const pricey = holding([buff("maneuvers.kiCost.times", { flat: 1 })]);
  const triple = holding([buff("maneuvers.kiCost.times", { flat: 2 })]);
  const free = holding([buff("maneuvers.kiCost.times", { flat: -1 })]);
  // Any Maneuver with a price of its own and no Profile: 6 Ki Points.
  const move = { id: "probe-maneuver", kiCost: 6, tags: [] };
  const cost = actor => MANEUVERS.maneuverKiCost(move, null, actor);
  check("Ki Point Cost Multiplier: the cost once more for each - 1 the double, 2 the triple - of any Maneuver; never the wager, never below nothing",
    [cost(plain) > 0, cost(pricey) === cost(plain) * 2, cost(triple) === cost(plain) * 3, cost(free),
     MANEUVERS.maneuverKiCost(move, { kiWager: 5 }, pricey) - cost(pricey)], [true, true, true, 0, 5]);

  const strong = holding([buff("clash.might", { name: "Grip", flat: 2, perBase: 1 }), buff("clash.duel", { name: "Nerve", flat: 4 })]);
  const cut = name => {
    const at = chat.indexOf(`function ${name}(`);
    let depth = 0, i = chat.indexOf(") {", at) + 2;
    for (; i < chat.length; i++) { if (chat[i] === "{") depth++; else if (chat[i] === "}" && !--depth) break; }
    return chat.slice(at, i + 1);
  };
  const { mightClashBonus, duelClashBonus } = new Function("slotWritten",
    `${cut("mightClashBonus")}\n${cut("duelClashBonus")}\nreturn { mightClashBonus, duelClashBonus };`)(() => "");
  const bT = plain.system.baseTierOfPower;
  const said = parts => parts.map(part => `${part.label}=${part.value}`);
  check("Might for Clashes: a roll of Might against another's - no other Clash's; Duel Clash Bonus: their side of a Duel's",
    [said(mightClashBonus(strong, { category: "might" })), said(mightClashBonus(strong, { category: "skill" })), said(mightClashBonus(plain, { category: "might" })),
     said(duelClashBonus(strong)), said(duelClashBonus(plain)),
     chat.includes("...beatdownClashBonus(actor, clash, uuid), ...mightClashBonus(actor, clash),"),
     chat.includes('...wagers("attacker"), ...duelClashBonus(attacker)], {'), chat.includes('...wagers("defender"), ...duelClashBonus(initiator)], {'),
     strong.system.might === plain.system.might],
    [[`Custom Buff: Grip=${2 + bT}`], [], [], ["Custom Buff: Nerve=4"], [], true, true, true, true]);
  check("Seen: the Intuit Maneuver's bonus whoever the Clash is against",
    [chat.includes('const theirs = customBuffOn(actor, "intuit.any") || (actor.system.timed ?? []).some(entry =>'),
     BUFFS.customBuffOn(holding([buff("intuit.any")]), "intuit.any")], [true, true]);

  // The Health Threshold an effect finds them in.
  const lower = n => ({ customBuffs: [buff("threshold.lower", { flat: n })] });
  const higher = n => ({ customBuffs: [buff("threshold.higher", { flat: n })] });
  check("Also count as X Thresholds Lower / Higher: so many steps along the line, never past its ends; both, the difference; off, the real one",
    [BUFFS.customBuffThresholdFor(lower(2), "healthy"), BUFFS.customBuffThresholdFor(lower(1), "injured"), BUFFS.customBuffThresholdFor(lower(9), "bruised"),
     BUFFS.customBuffThresholdFor(higher(1), "injured"), BUFFS.customBuffThresholdFor(higher(5), "critical"),
     BUFFS.customBuffThresholdFor({ customBuffs: [buff("threshold.lower", { flat: 3 }), buff("threshold.higher", { flat: 1 })] }, "healthy"),
     BUFFS.customBuffThresholdFor({ customBuffs: [buff("threshold.lower", { flat: 2, active: false })] }, "healthy"),
     BUFFS.customBuffThresholdFor({}, "bruised")],
    ["injured", "critical", "critical", "bruised", "healthy", "injured", "healthy", "bruised"]);
  const conditions = read("module", "effects", "conditions.mjs");
  const data = read("module", "data", "actor-character.mjs");
  const hurt = holding([buff("threshold.lower", { flat: 2 })]);
  check("asked by an effect's \"below the Injured Health Threshold\" and \"for each Health Threshold you are below\" - the Threshold's own penalties still the real one's",
    [conditions.includes('keys.indexOf(customBuffThresholdFor(scope.data, scope.data?.threshold?.key ?? "healthy")) >= wanted);'),
     // Arrogant and Unstoppable (2)'s Healthy before it since (adversary.mjs).
     conditions.includes('|| (customBuffThresholdFor(scope.data, scope.data?.threshold?.key ?? "healthy") === "healthy"),'),
     data.includes("const at = keys.indexOf(customBuffThresholdFor(data, DBUCharacterData.thresholdKey(data.life.value, data.life.max, data.typicalMinion)));"),
     hurt.system.threshold.key, hurt.system.threshold.penalty ?? 0, plain.system.threshold.penalty ?? 0],
    [true, true, true, plain.system.threshold.key, 0, 0]);
  const tiers = { baseTier: 3, tier: 3 };
  check("a count: Flat alone",
    [BUFFS.customBuffTotal(buff("threshold.lower", { flat: 2, perBase: 5, perTier: 5 }), tiers),
     BUFFS.customBuffTakesBase(BUFFS.customBuffOption("threshold.lower")), BUFFS.customBuffTakesTier(BUFFS.customBuffOption("threshold.lower"))],
    ["+2", false, false]);
}

// --- Count Basic Attack as Signature: for a Trait's or a Talent's effects, never a Signature Technique's own rules -----
{
  const MANEUVERS = await import(modUrl("maneuvers.mjs"));
  const chat = read("module", "chat.mjs");
  const counted = holding([buff("basicAsSignature"), buff("unique.kiCost", { flat: 0 })]);
  const plain = holding();
  check("the Basic Attack alone, and only while it is switched on",
    [BUFFS.customBuffBasicIsSignature(counted.system, "basic-attack"), BUFFS.customBuffBasicIsSignature(counted.system, "signature-technique"),
     BUFFS.customBuffBasicIsSignature(counted.system, "tail-attack"), BUFFS.customBuffBasicIsSignature(plain.system, "basic-attack"),
     BUFFS.customBuffBasicIsSignature(holding([buff("basicAsSignature", { active: false })]).system, "basic-attack")],
    [true, false, false, false, false]);
  const at = chat.indexOf("function effectSignature(");
  let depth = 0, i = chat.indexOf(") {", at) + 2;
  for (; i < chat.length; i++) { if (chat[i] === "{") depth++; else if (chat[i] === "}" && !--depth) break; }
  const effectSignature = new Function("customBuffBasicIsSignature", `${chat.slice(at, i + 1)}\nreturn effectSignature;`)(BUFFS.customBuffBasicIsSignature);
  check("an attack a Signature Technique's for effects: one made through its Maneuver, or the Basic Attack counted as one",
    [effectSignature(plain, { signature: true, maneuverId: "signature-technique" }), effectSignature(plain, { maneuverId: "basic-attack" }),
     effectSignature(counted, { maneuverId: "basic-attack" }), effectSignature(counted, { maneuverId: "tail-attack" })],
    [true, false, true, false]);
  // A Talent's discount on Signature Techniques, as Inherited Creativity's - written here through the same Slot.
  const cheap = rows => { const actor = holding(rows); actor.system.effects.slots["signature.kiCost"] = { add: -2, parts: [] }; return actor; };
  const basic = { id: "basic-attack", kiCost: 6, tags: [] };
  check("a Talent's Ki off Signature Techniques reaches it; nothing else's price moves",
    [MANEUVERS.maneuverKiCost(basic, null, cheap([])), MANEUVERS.maneuverKiCost(basic, null, cheap([buff("basicAsSignature")])),
     MANEUVERS.maneuverKiCost({ ...basic, id: "probe-maneuver" }, null, cheap([buff("basicAsSignature")]))], [6, 4, 6]);
  const conditions = read("module", "effects", "conditions.mjs");
  check("asked by every effect that asks - its rolls, its Strike and Wound, its Energy Charges' Category, what it damaged, an effect's own question",
    [(chat.match(/signatureRoll: effectSignature\(attacker, attack\),/g) ?? []).length,
     chat.includes('combatDiceGroups(attacker, null, "strike", effectSignature(attacker, attack)),'),
     chat.includes('"wound", effectSignature(attacker, attack)),'),
     chat.includes("oneCharge: effectSignature(attacker, attack) ? energyChargeDice("),
     chat.includes('...(effectSignature(fromUuidSync(attack.attackerUuid ?? ""), attack) ? { bySignature: true } : {}),'),
     chat.includes("|| customBuffBasicIsSignature(attacker.system, attack.maneuverId))) parts.push({"),
     chat.includes('(customBuffBasicIsSignature(attacker.system, attack.maneuverId) && (Number(attacker.system.effects?.slots?.["strike.signature"]?.add) || 0))'),
     chat.includes('|| customBuffBasicIsSignature(actor.system, maneuver.id))'),
     conditions.includes("|| customBuffBasicIsSignature(scope.data, scope.context?.maneuver?.id),")],
    [2, true, true, true, true, true, true, true, true]);
  check("and never by a Signature Technique's own rules: the size of its Energy Charges' dice still asks the attack itself",
    chat.includes("DBUCharacterData.energyChargeDie(attack.signature, attack.chargeCategories ?? 0);"), true);
}

// --- What a sweep of it found ----------------------------------------------------------------------------------
{
  const plain = holding();
  const base = plain.system.dice.extra.category;
  const lowered = holding([buff("dice.extra.category", { flat: -1 })]);
  const gone = holding([buff("dice.extra.category", { flat: -99 }), buff("dice.greater.category", { flat: -99 })]);
  const strikeLow = holding([buff("dice.extra.strike.category", { flat: -1 })]);
  check("a debuff lowers a dice Category too - a step down, never under no die at all; one roll's alone the same",
    [base > 0, lowered.system.dice.extra.category - base, gone.system.dice.extra.category, gone.system.dice.extra.formula,
     gone.system.dice.greater.category, strikeLow.system.dice.extraStrike.category - base, strikeLow.system.dice.extraDodge.category - base],
    [true, -1, 0, "", 0, -1, 0]);
  // Every option written as a debuff: a script the language takes, as its bonus is.
  const refused = [];
  for (const option of BUFFS.CUSTOM_BUFFS.filter(each => !each.direct)) {
    const actor = holding([buff(option.id, { flat: -2, perBase: -1, perTier: -1 })]);
    const errors = (actor.system.effects.errors ?? []).filter(error => String(error).includes("Custom Buff"));
    if (errors.length) refused.push(`${option.id}: ${errors[0]}`);
  }
  check("no option's script is refused as a debuff either", refused, []);
  const less = holding([buff("capacity.quarter", { flat: -2 })]);
  check("Max Capacity by quarters, taken off: half of it", less.system.capacity.max < plain.system.capacity.max, true);
  const chat = read("module", "chat.mjs");
  check("a Twin-Linked or Dead-Link attack's second roll is told its Foundation, as the first is",
    chat.includes("      criticalTarget, botchUnlessCritical, naturalAdd, foundation };"), true);
  // No window is left drawing a Combat Roll's dice without saying which roll it is - but a Deflect's, a Might Clash.
  const drawn = [...chat.matchAll(/combatDiceGroups\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)].map(match => match[1].trim())
    .filter(args => !args.startsWith("actor, groups"));
  check("every roll window says which roll it is: a Block's a Strike, a Barrier's and Power Flare's a Wound, a Clash's its kind's",
    [drawn.filter(args => args.split(",").length < 3), chat.includes('const diceOf = roll => combatDiceGroups(actor, null, roll);'),
     (chat.match(/dice: diceOf\("wound"\),/g) ?? []).length, (chat.match(/dice: diceOf\("strike"\),/g) ?? []).length,
     chat.includes("(made => (made?.combatRoll ? combatDiceGroups(actor, null, made.slot ?? null) : []))("),
     chat.includes('dice: combatDiceGroups(target, null, "strike"),')],
    [["actor"], true, 2, 1, true, true]);
  const sheet = read("module", "sheets", "actor-character-sheet.mjs");
  check("a Parry's window shows a Strike Roll's own dice, as its roll takes them; the Combat tab's Strike and Dodge show theirs",
    [chat.includes('formula: tierDice(actor, combatRollOf(slot)) }]),'),
     sheet.includes("const extraOf = slot => ({ strike: system.dice?.extraStrike, dodge: system.dice?.extraDodge, wound: system.dice?.extraWound })[slot]?.formula"),
     sheet.includes("line: `${die}${extraOf(slot) ? ` + ${extraOf(slot)}` : \"\"}`")], [true, true, true]);
}

// --- The quarters ("+-1/4"): so many quarters of the value ------------------------------------------------
{
  const plain = holding();
  const more = holding([buff("life.max.quarter", { flat: 1 })]);
  const less = holding([buff("life.max.quarter", { flat: -2 })]);
  check("Max Life Points: 1 a quarter more of it, -2 half of it - rounded down",
    [more.system.life.max, less.system.life.max], [Math.floor(plain.system.life.max * 1.25), Math.floor(plain.system.life.max / 2)]);
  check("Max Ki Pool the same way", holding([buff("ki.max.quarter", { flat: 2 })]).system.ki.max, Math.floor(plain.system.ki.max * 1.5));
  const roomy = holding([buff("capacity.quarter", { flat: 1 })]);
  check("Max Capacity: a quarter of it more",
    [roomy.system.capacity.max > plain.system.capacity.max, roomy.system.capacity.max <= Math.ceil(plain.system.capacity.max * 1.25)],
    [true, true]);
  const fast = holding([buff("speed.all.quarter", { flat: 2 })]);
  const slow = holding([buff("speed.normal.quarter", { flat: -1 })]);
  check("the Speeds: both, or the one named",
    [fast.system.speed.normal, fast.system.speed.boosted, slow.system.speed.normal, slow.system.speed.boosted],
    [Math.floor(plain.system.speed.normal * 1.5), Math.floor(plain.system.speed.boosted * 1.5),
     Math.floor(plain.system.speed.normal * 0.75), plain.system.speed.boosted]);
  const tiers = { baseTier: 3, tier: 3 };
  check("said in quarters; Flat alone - its (bT) and (T) count for nothing",
    [1, 2, 3, 4, 5, -2, -3, 0].map(flat => BUFFS.customBuffTotal(buff("life.max.quarter", { flat, perBase: 9, perTier: 9 }), tiers))
      .concat([BUFFS.customBuffTakesBase(BUFFS.customBuffOption("life.max.quarter")), BUFFS.customBuffTakesTier(BUFFS.customBuffOption("life.max.quarter")),
        BUFFS.customBuffTakesBase(BUFFS.customBuffOption("strike")), BUFFS.customBuffTakesBase(BUFFS.customBuffOption("defenseValue.halve"))]),
    ["+1/4", "+1/2", "+3/4", "+1", "+1 1/4", "−1/2", "−3/4", "0", false, false, true, false]);
  check("its script: the value multiplied once every other change is in; Capacity's fraction added; never below nothing",
    [BUFFS.customBuffScript(buff("life.max.quarter", { flat: 1, perBase: 3 })), BUFFS.customBuffScript(buff("speed.all.quarter", { flat: -1 })),
     BUFFS.customBuffScript(buff("capacity.quarter", { flat: -2 })), BUFFS.customBuffScript(buff("ki.max.quarter", { flat: -9 })),
     BUFFS.customBuffScript(buff("ki.max.quarter"))],
    ["[passive]\nlife.max *= 1.25;", "[passive]\nspeed.normal *= 0.75;\nspeed.boosted *= 0.75;", "[passive]\ncapacity.maxFraction -= 0.5;",
     "[passive]\nki.max *= 0;", ""]);
}

// --- The Effect, picked off a list typed into ------------------------------------------------------------------
{
  const labels = BUFFS.CUSTOM_BUFFS.map(option => option.label.toLowerCase());
  check("no two Effects are called the same, so a name is one Effect's",
    labels.filter((label, index) => labels.indexOf(label) !== index), []);
  const sheet = read("module", "sheets", "actor-character-sheet.mjs");
  const css = read("styles", "dbu-ttrpg.css");
  check("the Effect's list is the Talent Addition row's (the user's): bound by the same binder, the pick written from the hidden field",
    [sheet.includes('else if (field === "effect") buff.effect = String(input.value ?? "");'),
     sheet.includes('for (const combo of this.element.querySelectorAll("[data-combo]")) DBUCharacterSheet.#bindCombo(combo);'),
     sheet.includes("const sections = customBuffSections();"),
     sheet.includes("customBuffOptionByText"), sheet.includes("customBuffEffects"), "customBuffOptionByText" in BUFFS,
     sheet.includes('.replace("+/-", "' + String.fromCharCode(92) + 'u00b1").replace("+-", "' + String.fromCharCode(92) + 'u00b1");'),
     css.includes(".dbu-ttrpg .dbu-custom-buff-field .dbu-combo .dbu-combo-input { padding-right: 18px; cursor: pointer; }")],
    [true, true, true, false, false, false, true, true]);
}

// --- What a row comes to ---------------------------------------------------------------------------------
{
  const tiers = { baseTier: 3, tier: 3 };
  check("Total = Flat + (bT) x base Tier + (T) x Tier - the spreadsheet's own rows",
    [BUFFS.customBuffTotal(buff("strike", { flat: 3 }), tiers), BUFFS.customBuffTotal(buff("wound", { perBase: -2 }), tiers),
     BUFFS.customBuffTotal(buff("soakValue", { perTier: -7 }), tiers), BUFFS.customBuffTotal(buff("strike"), tiers),
     BUFFS.customBuffTotal(buff("defenseValue.halve"), tiers), BUFFS.customBuffTotal(buff("combatRolls.d6", { flat: 2 }), tiers),
     BUFFS.customBuffTotal(buff("nothing-such"), tiers)],
    ["+3", "\u22126", "\u221221", "0", "On", "2d6", ""]);
  check("the Tier of Power takes (bT) but never (T): settled before the Tier is known",
    [BUFFS.customBuffTakesTier(BUFFS.customBuffOption("tierOfPower")), BUFFS.customBuffTakesTier(BUFFS.customBuffOption("strike")),
     BUFFS.customBuffTotal(buff("tierOfPower", { flat: 1, perTier: 5 }), tiers),
     BUFFS.customBuffScript(buff("tierOfPower", { flat: 1, perTier: 5 }))],
    [false, true, "+1", "[passive]\ntierOfPower += 1;"]);
  check("the script of a row: one line per amount, a penalty subtracted, dice only ever added",
    [BUFFS.customBuffScript(buff("strike", { flat: 3, perBase: -2, perTier: 1 })),
     BUFFS.customBuffScript(buff("combatRolls.d4", { flat: 1, perTier: 1 })),
     BUFFS.customBuffScript(buff("combatRolls.d4", { flat: -1 })),
     BUFFS.customBuffScript(buff("surgency.halve")),
     BUFFS.customBuffScript(buff("strike")), BUFFS.customBuffScript(buff("strike", { flat: 3, active: false }))],
    ["[passive]\nstrike += 3;\nstrike -= 2(bT);\nstrike += 1(T);", "[passive]\ncombatRolls.dice += 1d4;\ncombatRolls.dice += 1d4(T);", "",
     "[passive]\nsurgency *= 0.5;", "", ""]);
  check("named as the row is, or as its option where it has no name",
    [BUFFS.customBuffName(buff("strike", { name: "Algo 1" })), BUFFS.customBuffName(buff("strike")), BUFFS.customBuffName(buff(""))],
    ["Custom Buff: Algo 1", "Custom Buff: Strike (All)", "Custom Buff"]);
}

// --- On the character ------------------------------------------------------------------------------------
{
  const plain = holding();
  const row = buff("soakValue", { name: "Algo 1", flat: -3, perBase: 2 });
  const buffed = holding([row]);
  const off = holding([{ ...row, active: false }]);
  const bT = plain.system.baseTierOfPower;
  check("an Active row lands on the value itself, its (bT) by the base Tier of Power; one switched off changes nothing",
    [buffed.system.soakValue - plain.system.soakValue, off.system.soakValue - plain.system.soakValue, bT > 1],
    [(2 * bT) - 3, 0, true]);
  check("and is named where the value is taken apart",
    (buffed.system.effects.slots.soakValue?.parts ?? []).filter(part => part.sourceId === `custom-buff:${row.id}`)
      .map(part => `${part.source} ${part.op} ${part.value}`), ["Custom Buff: Algo 1 add -3", `Custom Buff: Algo 1 add ${2 * bT}`]);
  check("gathered over everything else where two contradict",
    [buffed.system.effects.programs.find(entry => entry.sourceId === `custom-buff:${row.id}`)?.priority,
     PRIORITY.custom > Math.max(...Object.entries(PRIORITY).filter(([key]) => key !== "custom").map(([, value]) => value))],
    [PRIORITY.custom, true]);

  const tier = holding([buff("tierOfPower", { flat: 1 })]);
  check("ToP (Breakthrough): the Tier of Power one higher", tier.system.tierOfPower - plain.system.tierOfPower, 1);
  const halved = holding([buff("defenseValue.halve")]);
  check("Halve Defense Value: half of it, rounded down",
    halved.system.defenseValue, Math.floor(plain.system.defenseValue / 2));
  const score = holding([buff("force.score", { flat: 4 })]);
  check("FO Score: on the Score, and so on what is worked out from it",
    [score.system.attributes.force.score - plain.system.attributes.force.score,
     score.system.attributes.force.mod >= plain.system.attributes.force.mod], [4, true]);
}

// --- Groups ----------------------------------------------------------------------------------------------
{
  const rows = [buff("strike", { id: "a", group: "A", active: false }), buff("wound", { id: "b", group: "a", active: false }),
    buff("dodge", { id: "c", group: "B", active: false }), buff("might", { id: "d", active: false }),
    buff("haste", { id: "e", active: false })];
  const on = BUFFS.customBuffsToggled(rows, "a", true);
  check("rows sharing a Group letter are switched together, whatever its case; the others left",
    on.map(row => row.active), [true, true, false, false, false]);
  check("a row with no letter is its own", BUFFS.customBuffsToggled(rows, "d", true).map(row => row.active),
    [false, false, false, true, false]);
  check("and off the same way", BUFFS.customBuffsToggled(on, "b", false).map(row => row.active), [false, false, false, false, false]);
}

// --- The sheet -------------------------------------------------------------------------------------------
{
  const sheet = read("module", "sheets", "actor-character-sheet.mjs");
  const tabs = sheet.slice(sheet.indexOf("static TABS = {"), sheet.indexOf("};", sheet.indexOf("static TABS = {")));
  const order = [...tabs.matchAll(/^    (\w+): \{ id:/gm)].map(match => match[1]);
  check("a tab of its own, in the second row between Maneuvers and Adventure (the user's choice A)",
    // Main and the Adversary tab both listed: one of the two is on a sheet's strip, which breaks after its seventh (the Transformations').
    [order.slice(8), order.length],
    [["battlefields", "maneuvers", "customBuffs", "fusion", "adventure", "biography", "progression", "settings"], 16]);
  check("its part, its template and its actions",
    [sheet.includes('customBuffs: { template: "systems/dbu-ttrpg/templates/parts/actor-custom-buffs.hbs", scrollable: [""] }'),
     fs.existsSync(path.join(ROOT, "templates", "parts", "actor-custom-buffs.hbs")),
     sheet.includes("addCustomBuff: DBUCharacterSheet._onAddCustomBuff"),
     sheet.includes("deleteCustomBuff: DBUCharacterSheet._onDeleteCustomBuff")], [true, true, true, true]);
  const css = read("styles", "dbu-ttrpg.css");
  check("the tab strip breaks after the seventh since the Transformations", css.includes(".dbu-ttrpg .sheet-tabs > .item:nth-child(n+8) { order: 2; }"), true);
}

// --- The tab, drawn with Foundry's own Handlebars ---------------------------------------------------------
{
  const { createRequire } = await import("node:module");
  const require = createRequire(`${(process.env.FOUNDRY_APP || (process.env.FOUNDRY_APP || String.raw`C:\Program Files\Foundry Virtual Tabletop\resources\app`))}/package.json`);
  const Hbs = require("handlebars");
  const template = Hbs.compile(read("templates", "parts", "actor-custom-buffs.hbs"));
  const tiers = { baseTier: 3, tier: 3 };
  const sections = BUFFS.customBuffSections();
  // As the sheet makes them (actor-character-sheet.mjs #customBuffRows).
  const rowOf = row => {
    const option = BUFFS.customBuffOption(row.effect);
    return { ...row, total: BUFFS.customBuffTotal(row, tiers), toggle: option?.kind === "toggle", takesTier: BUFFS.customBuffTakesTier(option),
      takesBase: BUFFS.customBuffTakesBase(option), quarter: option?.kind === "quarter",
      gone: !option, sections: sections.map(section => ({ label: section.label,
        options: section.options.map(each => ({ id: each.id, label: each.label, selected: each.id === row.effect })) })) };
  };
  const rows = [buff("strike", { id: "r1", name: "Algo 1", flat: 3 }), buff("wound", { id: "r2", name: "Algo 2", group: "A", perBase: -2 }),
    buff("defenseValue.halve", { id: "r3", name: "Halved", active: false }), buff("tierOfPower", { id: "r4", name: "NLoP", flat: 1, active: false }),
    buff("long-gone", { id: "r5", name: "Old" }), buff("life.max.quarter", { id: "r6", name: "Quarter", flat: 1 })].map(rowOf);
  const html = template({ tabs: { customBuffs: { cssClass: "active" } }, editable: true, customBuffs: rows });
  const li = id => html.slice(html.indexOf(`data-buff-id="${id}"`), html.indexOf("</li>", html.indexOf(`data-buff-id="${id}"`)));
  check("a row for each buff, in the order they were added; one switched off drawn as off",
    [[...html.matchAll(/data-buff-id="(r\d)"/g)].map(match => match[1]), html.includes('class="dbu-custom-buff off" data-buff-id="r3"'),
     html.includes('class="dbu-custom-buff" data-buff-id="r1"')], [["r1", "r2", "r3", "r4", "r5", "r6"], true, true]);
  check("a quarter: counted under its own label, its (bT) and (T) shut",
    [li("r6").includes('<span class="center">x 1/4</span>'), li("r6").includes(">+1/4</b>"),
     (li("r6").match(/Not for this one: it is counted in quarters/g) ?? []).length, li("r1").includes("counted in quarters")],
    [true, true, 2, false]);
  check("every field under a label of its own (the user's): Active, Group, Name, Total; Effect, Flat, (bT), (T)",
    ["<span>Active</span>", "<span>Group</span>", "<span>Name</span>", '<span class="right">Total</span>', "<span>Effect</span>",
      '<span class="center">Flat</span>', '<span class="center">(bT)</span>', '<span class="center">(T)</span>']
      .map(label => li("r1").includes(label)), [true, true, true, true, true, true, true, true]);
  check("what each comes to, and its own option marked on the list",
    [li("r1").includes(">+3</b>"), li("r2").includes(">\u22126</b>"), li("r3").includes(">On</b>"),
     /<div class="dbu-combo-option chosen" role="option" data-value="strike"\s+data-group="Strike">Strike \(All\)<\/div>/.test(li("r1")),
     /<div class="dbu-combo-option" role="option" data-value="strike"\s+data-group="Strike">Strike \(All\)<\/div>/.test(li("r2")),
     li("r1").includes("<select"), html.includes("<datalist")],
    [true, true, true, true, true, false, false]);
  check("the Effect a list typed into, as a Talent Addition row's (the user's): its id in a hidden field, the box unnamed, every Effect under its section",
    [li("r1").includes('<div class="dbu-combo" data-combo>'), li("r1").includes('<input type="hidden" data-custom-buff="effect" value="strike"/>'),
     /<input type="text" class="dbu-combo-input"(?![^>]*(name=|data-custom-buff))/.test(li("r1")),
     (li("r1").match(/class="dbu-combo-option/g) ?? []).length === BUFFS.CUSTOM_BUFFS.length,
     (li("r1").match(/class="dbu-combo-group"/g) ?? []).length === sections.length,
     li("r1").includes('<div class="dbu-combo-group" data-group="Toggles">Toggles</div>'),
     li("r1").includes('placeholder="Choose an Effect"'), li("r1").includes("dbu-combo-none"),
     li("r1").includes('<div class="dbu-combo-empty" hidden>No Effect has that in its name or section.</div>'),
     // Not inside a label: a click on the list would be the box's.
     /<label class="dbu-custom-buff-field">\s*<span>Effect<\/span>/.test(li("r1"))],
    [true, true, true, true, true, true, true, false, true, false]);
  check("a toggle has no amounts; the Tier of Power's (T) is shut; one no longer on the list says so and comes to nothing",
    [li("r3").includes('data-custom-buff="flat"'), li("r3").includes("On or off: no number to it"),
     li("r4").includes('data-custom-buff="perTier"') && li("r4").includes("settled before the Tier of Power is"),
     li("r1").includes("settled before the Tier of Power is"),
     li("r5").includes("(no longer on the list)") && li("r5").includes(">-</b>")],
    [false, true, true, false, true]);
  check("the amounts take four characters at most; no field is the character's form's",
    [(li("r1").match(/maxlength="4"/g) ?? []).length, html.includes(" name=")], [3, false]);
  check("Add and delete where it may be edited, not where it may not",
    [html.includes('data-action="addCustomBuff"'), li("r1").includes('data-action="deleteCustomBuff"'),
     template({ tabs: { customBuffs: { cssClass: "" } }, editable: false, customBuffs: rows }).includes('data-action="addCustomBuff"'),
     template({ tabs: { customBuffs: { cssClass: "" } }, editable: true, customBuffs: [] }).includes("Nothing written in.")],
    [true, true, false, true]);
}

// --- Breakthrough: a temporary Tier of Power more raises no Ki Point Cost (the user's report) ---------------
{
  const MAN = await import(modUrl("maneuvers.mjs"));
  const plain = holding([], { powerLevel: 12 });
  const raised = holding([buff("tierOfPower", { flat: 1 })], { powerLevel: 12 });
  const lowered = holding([buff("tierOfPower", { flat: -1 })], { powerLevel: 12 });
  const priced = { id: "test-beam", name: "Beam", kiCostPerTier: 2, attacking: false };
  check("the Tier raised by a Custom Buff's \"ToP (Breakthrough)\", the Ki Point Cost not; lowered, it follows",
    [raised.system.tierOfPower - plain.system.tierOfPower, raised.system.kiCostTier, plain.system.kiCostTier, lowered.system.kiCostTier,
     MAN.maneuverKiCost(priced, null, raised), MAN.maneuverKiCost(priced, null, plain), MAN.maneuverKiCost(priced, null, lowered)],
    [1, plain.system.baseTierOfPower, plain.system.baseTierOfPower, plain.system.baseTierOfPower - 1,
     2 * plain.system.baseTierOfPower, 2 * plain.system.baseTierOfPower, 2 * (plain.system.baseTierOfPower - 1)]);
  const profileCost = actor => MAN.profileKiCost("megaFlare", { id: "x" }, actor);
  check("a Profile's Ki Point Cost and its Minimum the same", [profileCost(raised), MAN.minimumAttackKiCost("megaFlare", raised)],
    [profileCost(plain), MAN.minimumAttackKiCost("megaFlare", plain)]);
  // An effect's own "(T)" on a Ki Point Cost's Slot - a Talent's "increase the Ki Point Cost by 1(T)" - at the Base Tier too.
  const costly = holding([buff("tierOfPower", { flat: 1 }), buff("attack.kiCost", { perTier: 1 })], { powerLevel: 12 });
  check("an effect's (T) on a Ki Point Cost counted at no more than the Base Tier; on anything else, at the Tier as it is",
    [Number(costly.system.effects.slots["attack.kiCost"]?.add) || 0, raised.system.combat.strike - plain.system.combat.strike >= 0],
    [plain.system.baseTierOfPower, true]);
}

console.log(failed ? `${failed} failing` : "all passing");
process.exit(failed ? 1 : 0);
