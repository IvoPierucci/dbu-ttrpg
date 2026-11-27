/**
 * Weapons: built as Apparel is - a Grade, a Type, a Size, a Category and Qualities - and wielded,
 * two at most. What an attack made with one carries is worked out when it is declared.
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
const { maneuverKiCost } = await import(modUrl("maneuvers.mjs"));
await loadTraits();

const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");
const INDEX = JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));

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
  const rows = [{ lvl: 1, choice: "Skill Improvement", locked: true, attributes: {},
    skillRanks: ["perception", "perception"] }];
  for (let lvl = 2; lvl <= powerLevel; lvl++) {
    rows.push({ lvl, choice: "Attribute Addition", locked: false,
      attributes: { insight: 1, agility: 1 }, skillRanks: [] });
  }
  return rows;
}

/** A character holding these Items, run through every phase - and the Actor around it. */
function holding(items, { powerLevel = 30 } = {}) {
  const parent = new ActorStub({}, { strict: false });
  parent.items = items;
  parent.uuid = "Actor.me";
  const model = new DBUCharacterData({ powerLevel, progression: progressionTo(powerLevel) },
    { parent, strict: false });
  parent.system = model;
  model.prepareBaseData?.();
  model.prepareDerivedData();
  return parent;
}

let n = 0;
/** A Weapon, as Add Weapon makes one, then changed. */
function weapon({ category = "bludgeoning", type = "physical", size = "standard", grade = 1,
  qualities = [], wielded = false, destroyed = false, lifeLost = 0, name = null } = {}) {
  const data = GEAR.craftedItemFrom("weapon", null, getTrait);
  n++;
  const crafted = { ...data.system.crafted, category, weaponType: type, weaponSize: size, grade,
    qualities, destroyed, lifeLost };
  crafted.effects = GEAR.composeEffects(crafted, "", { getTrait });
  return { ...data, id: `w${n}`, uuid: `Actor.me.Item.w${n}`, name: name ?? `Weapon ${n}`,
    system: { ...data.system, equipped: wielded, crafted } };
}

// --- The table -------------------------------------------------------------------------------------
{
  const { CRAFTED, WEAPON_TYPES, WEAPON_SIZES } = GEAR;
  check("the Craftsmanship Grades: Apprentice 0 Slots up to Grandmaster 4",
    Object.values(CRAFTED.weapon.grades).map(row => [row.craftDC, row.slots]),
    [["apprentice", 0], ["qualified", 1], ["expert", 2], ["master", 3], ["grandmaster", 4]]);
  check("Physical, Energy, Magic", Object.keys(WEAPON_TYPES), ["physical", "energy", "magic"]);
  check("Small +1(T) Strike -2(T) Wound; Standard nothing; Big the other way",
    Object.values(WEAPON_SIZES).map(size => [size.strike, size.wound, size.rank]),
    [[1, -2, 1], [0, 0, 2], [-1, 2, 3]]);
  check("32 Life Points and 8 each Power Level, 6(bT) Damage Reduction, Hardness Rank 2",
    [CRAFTED.weapon.lifeBase, CRAFTED.weapon.lifePerLevel, CRAFTED.weapon.damageReductionPerBaseTier,
     CRAFTED.weapon.hardnessRank], [32, 8, 6, 2]);
  check("two in hand at most", GEAR.WEAPONS_WIELDED, 2);
}

// --- The Categories --------------------------------------------------------------------------------
{
  const ids = ["bludgeoning", "slashing", "piercing", "shield", "efficient", "precision",
    "high-power", "magic-staff", "elemental-tool", "magic-orb"];
  check("every Weapon Category, in the index", ids.every(id =>
    INDEX.traits.includes(`crafting/weapon-categories/${id}.dbu`)), true);
  check("read as the Weapon's Categories", traitsOfKind("crafting", "weapon-categories").map(t => t.id).sort(),
    [...ids].sort());
  check("each under its Type", ids.map(id => [id, getTrait(id)?.weaponType]),
    [["bludgeoning", "physical"], ["slashing", "physical"], ["piercing", "physical"],
     ["shield", "physical"], ["efficient", "energy"], ["precision", "energy"],
     ["high-power", "energy"], ["magic-staff", "magic"], ["elemental-tool", "magic"],
     ["magic-orb", "magic"]]);
  check("the Qualities three of them come with",
    ["bludgeoning", "piercing", "precision", "magic-orb"].map(id => getTrait(id)?.possesses),
    ["staggering", "lasting-wounds", "far-sight", "spiritual-weapon"]);
  check("its text as printed",
    getTrait("slashing")?.text.includes("–Effects: Apply any Diminishing Defense from Attacking Maneuvers made with this Weapon at Attack Declaration."),
    true);
  const physical = { kind: "weapon", weaponType: "physical" };
  check("offered by Type", traitsOfKind("crafting", "weapon-categories")
    .filter(trait => GEAR.categoryFitsPiece(trait, physical)).map(t => t.id).sort(),
    ["bludgeoning", "piercing", "shield", "slashing"]);
  check("any Apparel Category on any piece of Apparel",
    GEAR.categoryFitsPiece(getTrait("armor"), { kind: "apparel" }), true);
}

// --- Add Weapon -------------------------------------------------------------------------------------
{
  const made = GEAR.craftedItemFrom("weapon", null, getTrait);
  check("Grade 1, Physical, Standard, Bludgeoning, nothing on it, whole, not in hand",
    [made.name, made.system.itemType, made.system.crafted.kind, made.system.crafted.grade,
     made.system.crafted.weaponType, made.system.crafted.weaponSize, made.system.crafted.category,
     made.system.crafted.qualities, made.system.crafted.lifeLost, made.system.crafted.destroyed,
     made.system.equipped ?? false],
    ["Bludgeoning", "weapon", "weapon", 1, "physical", "standard", "bludgeoning", [], 0, false, false]);
  check("its Effects start as its Category writes them",
    made.system.crafted.effects.startsWith("#@ category bludgeoning | Bludgeoning\n[passive]\nweapon.damageReductionIgnored = 1/2;"),
    true);
  const kept = new DBUGearData(structuredClone(made.system), { strict: false }).toObject();
  check("which the schema keeps", [kept.crafted.weaponType, kept.crafted.weaponSize, kept.crafted.lifeLost],
    ["physical", "standard", 0]);
  check("a Category not of its Type writes nothing",
    GEAR.composeEffects({ kind: "weapon", weaponType: "energy", category: "bludgeoning", qualities: [] },
      "", { getTrait }), "");
}

// --- What it is --------------------------------------------------------------------------------------
{
  const reading = (w, powerLevel = 1) => GEAR.craftedReading(w.system.crafted,
    { getTrait, difficulties: {}, data: { powerLevel }, baseTier: 2 });
  check("40 Life Points at Power Level 1, by the table's ruling; 72 at 5",
    [reading(weapon()).lifeMax, reading(weapon(), 5).lifeMax], [40, 72]);
  check("a Shield: x more for each Power Level - 1, 2, 3 by its Size",
    ["small", "standard", "big"].map(size => reading(weapon({ category: "shield", size }), 2).lifeMax),
    [32 + 2 * 9, 32 + 2 * 10, 32 + 2 * 11]);
  check("what is left, and broken is nothing left",
    [reading(weapon({ lifeLost: 15 })).lifeLeft, reading(weapon({ destroyed: true })).lifeLeft], [25, 0]);
  check("6(bT) Damage Reduction, Hardness Rank 2", [reading(weapon()).damageReduction,
    reading(weapon()).hardnessRank], [12, 2]);
  check("a Shield gives the Block", [reading(weapon({ category: "shield" })).blocks,
    reading(weapon()).blocks], [true, false]);
  check("Type and Size named", [reading(weapon({ size: "small" })).weaponTypeLabel,
    reading(weapon({ size: "small" })).weaponSizeLabel], ["Physical", "Small"]);
  check("no Grade band, no Bonus", [reading(weapon()).gradeLabel, reading(weapon()).perBaseTier], ["", 0]);
}

// --- In hand --------------------------------------------------------------------------------------
{
  const a = weapon({ wielded: true });
  const b = weapon({ wielded: true, category: "efficient", type: "energy" });
  const c = weapon();
  const broken = weapon({ wielded: true, destroyed: true });
  const items = [a, b, c, broken];
  check("wielded, whole: two here - the broken one is as if not there",
    GEAR.wieldedWeapons(items).map(w => w.id), [a.id, b.id]);
  check("a third is refused; a broken one is too", [GEAR.wieldProblem(items, c),
    GEAR.wieldProblem([a], broken)], ["Already wielding 2 Weapons.", "Broken: repair it first."]);
  check("and taking one again, or one with a hand free, is not", [GEAR.wieldProblem(items, a),
    GEAR.wieldProblem([a], c)], ["", ""]);
  check("the ones an attack may be made with, by its Attack Type",
    [GEAR.weaponsFor(items, "physical").map(w => w.id), GEAR.weaponsFor(items, "energy").map(w => w.id),
     GEAR.weaponsFor(items, "magic")], [[a.id], [b.id], []]);
  check("never Apparel to the Apparel rules",
    GEAR.apparelQualitiesInEffect(items).length, 0);
  check("in hand is throwable", GEAR.throwables(items).map(w => w.id).includes(a.id), true);
}

// --- An attack made with it --------------------------------------------------------------------------
{
  const me = holding([]);
  const tier = me.system.tierOfPower;
  check("a Tier above 1, so (T) shows", tier > 1, true);
  const at = (w, context = {}) => GEAR.weaponAttack(w, me, { getTrait,
    sizes: Object.keys(DBUCharacterData.SIZES), ...context });
  const rows = parts => parts.map(part => [part.label, part.written ?? null, part.value]);

  const plain = at(weapon({ name: "Club" }));
  check("Standard: the Weapon Penalty alone on the Strike, nothing on the Wound",
    [rows(plain.strike), rows(plain.wound)], [[["Weapon Penalty", "-2(T)", -2 * tier]], []]);
  const small = at(weapon({ size: "small", category: "slashing", name: "Knife" }));
  check("Small and Slashing: +1(T) and the Penalty on the Strike; -2(T) and Slashing's 2(T) on the Wound",
    [rows(small.strike), rows(small.wound)],
    [[["Small Weapon", "+1(T)", tier], ["Weapon Penalty", "-2(T)", -2 * tier]],
     [["Small Weapon", "-2(T)", -2 * tier], ["Knife", null, 2 * tier]]]);
  check("Slashing's Diminishing Defense at declaration", small.diminishingAtDeclaration, true);
  check("Bludgeoning half the Damage Reduction, Piercing a quarter of the Soak Value",
    [plain.damageReductionIgnored, at(weapon({ category: "piercing" })).soakIgnored], [0.5, 0.25]);
  check("which it is, by name", [plain.itemId, plain.name, plain.categoryName], [plain.itemId, "Club", "Bludgeoning"]);

  const efficient = weapon({ category: "efficient", type: "energy", name: "Blaster" });
  check("Efficient: 2(T) less Ki; and 2(T) on the Wound, with the Simple Profile only",
    [at(efficient).kiCost, rows(at(efficient, { profile: "simple" }).wound), rows(at(efficient, { profile: "blast" }).wound)],
    [-2 * tier, [["Blaster", null, 2 * tier]], []]);
  const precision = weapon({ category: "precision", type: "energy", name: "Rifle" });
  check("Precision: on a Called Shot only",
    [rows(at(precision).strike).length, rows(at(precision, { calledShot: true }).strike).at(-1),
     rows(at(precision, { calledShot: true }).wound)],
    [1, ["Rifle", null, tier], [["Rifle", null, 2 * tier]]]);
  const high = weapon({ category: "high-power", type: "energy" });
  const half = Math.floor(me.system.capacity.max / 2);
  check("High Power: an Energy Charge wagering half the Max Capacity; a Magnitude, with an Area",
    [at(high, { kiWager: half }).energyCharges, at(high, { kiWager: half - 1 }).energyCharges,
     at(high, { area: { shape: "cone" } }).magnitude, at(high).magnitude], [1, 0, 1, 0]);
  check("the Magic Orb: 2(T) on the Wound", rows(at(weapon({ category: "magic-orb", type: "magic",
    name: "Orb" })).wound), [["Orb", null, 2 * tier]]);

  const specialist = { ...me, items: [{ type: "talent", name: "Weapon Specialist" }] };
  check("the Weapon Specialist Talent takes the Penalty away",
    rows(GEAR.weaponAttack(weapon(), specialist, { getTrait }).strike), []);
  check("not a Weapon: nothing", GEAR.weaponAttack({ system: { crafted: { kind: "apparel" } } }, me,
    { getTrait }), null);
}

// --- Its price -----------------------------------------------------------------------------------------
{
  const staff = weapon({ category: "magic-staff", type: "magic", wielded: true, name: "Staff" });
  const me = holding([staff]);
  const bare = holding([]);
  const tier = me.system.tierOfPower;
  const basic = { id: "basic-attack", attacking: true, kiCost: 0 };
  const price = (actor, declared) => maneuverKiCost(basic, declared, actor);
  const magic = { profile: "simple", foundation: "magic", kiWager: 0 };
  const energy = { profile: "simple", foundation: "energy", kiWager: 0 };
  check("the Magic Staff wielded: every Magic Attack 2(T) cheaper, an Energy one not",
    [price(bare, magic) - price(me, magic), price(bare, energy) - price(me, energy)],
    [Math.min(2 * tier, price(bare, magic) - Math.floor(price(bare, magic) / 2)), 0]);
  check("and Use Magic 2 higher", (me.system.effects.slots["skill.useMagic"]?.add ?? 0), 2);
  const away = holding([{ ...staff, system: { ...staff.system, equipped: false } }]);
  check("put away, nothing", [price(bare, magic) - price(away, magic),
    away.system.effects.slots["skill.useMagic"]?.add ?? 0], [0, 0]);
  const withIt = { ...energy, weapon: { kiCost: -3 } };
  check("an attack's own Weapon's cost change, held to the Minimum as any is",
    price(bare, withIt), Math.max(price(bare, energy) - 3, price(bare, energy) - (price(bare, energy)
      - Math.floor(price(bare, energy) / 2))));
}

// --- The sheets and the declaration ---------------------------------------------------------------------
{
  const SHEET = read("module", "sheets", "actor-character-sheet.mjs");
  const TAB = read("templates", "parts", "actor-gear.hbs");
  const ITEM_SHEET = read("module", "sheets", "item-gear-sheet.mjs");
  const CRAFTED_PAGE = read("templates", "parts", "gear-crafted.hbs");
  const USE = read("module", "use-maneuver.mjs");
  const CHAT = read("module", "chat.mjs");
  check("Add Weapon, and each row Wield or Sheathe",
    [TAB.includes('data-action="addWeapon"'), TAB.includes('data-action="wieldGear"'),
     SHEET.includes("addWeapon: DBUCharacterSheet._onAddWeapon"),
     SHEET.includes("wieldGear: DBUCharacterSheet._onWieldGear")], [true, true, true, true]);
  const wield = SHEET.slice(SHEET.indexOf("static async _onWieldGear("), SHEET.indexOf("  /**\n   * Put a piece of Apparel on a Layer"));
  check("in a Combat Encounter, the No Effort Maneuver: their turn, once a Round",
    [wield.includes('getManeuver("no-effort")'), wield.includes("isTheirTurn(this.actor)"),
     wield.includes("maneuverUsesLeft(this.actor, noEffort) <= 0"),
     wield.includes("await recordManeuverUse(this.actor, noEffort);")], [true, true, true, true]);
  check("Repair is the Full Repair Adventuring Maneuver",
    SHEET.includes("return this.#startFullRepair(entry, definition, item.id);"), true);
  check("the Weapon tab: Grade, Type, Size, Category, in the order the rules build one",
    ["system.crafted.grade", "system.crafted.weaponType", "system.crafted.weaponSize", "system.crafted.category"]
      .map(name => CRAFTED_PAGE.indexOf(`name="${name}"`, CRAFTED_PAGE.indexOf("{{#if crafted.weapon}}")))
      .every((at, i, all) => (at > 0) && (!i || (at > all[i - 1]))), true);
  check("a new Type takes the Category with it where it must",
    ITEM_SHEET.includes("if (!categoryFitsPiece(getTrait(category ?? crafted.category), now)) {"), true);
  check("the Weapon asked at declaration, among the ones for its Attack Type; not for a Throw",
    [USE.includes("const offered = weaponsFor(actor.items.contents, declared?.foundation, getTrait)"),
     USE.includes('if (!thrown && !(maneuver.tags ?? []).includes("unarmed") && !unassisted && !maneuver.buddyAttack && (armedAs !== "unarmed")) {')], [true, true]);
  check("and worked out again once the Modifiers are known",
    USE.includes("declared = { ...declared, weapon: armedWith(actor, weaponItem, declared, modifiers, targetActor, weaponForm) };"), true);
  check("its reach, when a Physical Attack's is measured",
    USE.includes("whyNotInReach(actor, targetActor, declared ?? {}, (declared?.weapon?.meleeRange ?? 0) + whipReach)"), true);
  check("the rolls read it: Strike, Natural Result, Wound",
    [CHAT.includes("...(attack.weapon?.strike ?? []),"),
     CHAT.includes("naturalAdd: (Number(attack.weapon?.strikeNatural) || 0)"),
     CHAT.includes("...(attack.weapon?.wound ?? []),")], [true, true, true]);
  check("and what gets through: Soak, Damage Reduction",
    [CHAT.includes("Math.ceil(Math.max(0, base) * ((Number(attack.weapon?.soakIgnored) || 0) + (attack.pierceQuarter ? 0.25 : 0)))"),
     CHAT.includes("Math.floor(afterPierce * (Number(attack.weapon?.damageReductionIgnored) || 0))")], [true, true]);
  check("its Energy Charges and Damage Category ride on the attack",
    [CHAT.includes("+ (Number(weapon?.energyCharges) || 0)\n"),
     CHAT.includes("+ (Number(weapon?.damageCategory) || 0)\n")], [true, true]);
}

// --- The Weapon Qualities: their files ------------------------------------------------------------
const QUALITIES = traitsOfKind("crafting", "weapon-qualities");
{
  check("each one in the index", QUALITIES.every(trait =>
    INDEX.traits.includes(`crafting/weapon-qualities/${trait.id}.dbu`)), true);
  const flat = text => String(text ?? "").replace(/\s+/g, " ").trim();
  const effectsOf = trait => {
    const text = flat(trait.text);
    return text.slice(text.indexOf("–Effects: ") + "–Effects: ".length);
  };
  check("what each does is its Effects line word for word, tagged as the rulebook does",
    QUALITIES.filter(trait => {
      const lines = String(trait.summary ?? "").split("\n").map(line => line.trim()).filter(Boolean);
      return !lines.length || lines.some(line => {
        const [, tag, said] = line.match(/^\[([^\]]+)\]:\s*(.+)$/) ?? [];
        return !tag || !effectsOf(trait).includes(flat(said));
      });
    }).map(trait => trait.id), []);
  check("its Prerequisites as printed, where it has any",
    QUALITIES.filter(trait => {
      const printed = (flat(trait.text).match(/–Prerequisites: (.*?) –Quality Slots:/) ?? [])[1];
      return printed && (printed !== "N/A") && (flat([].concat(trait.prerequisites ?? []).join(", ")) !== printed);
    }).map(trait => trait.id), []);
  check("its Slots as printed",
    QUALITIES.filter(trait => {
      const printed = (flat(trait.text).match(/–Quality Slots: (\S+)/) ?? [])[1];
      return String(trait.slots) !== printed;
    }).map(trait => trait.id), []);
  const typesOf = trait => {
    const printed = (flat(trait.text).match(/–Weapon Type: (\S+)/) ?? [])[1] ?? "";
    return /^(All|Any)$/.test(printed) ? "" : printed.toLowerCase().split("/").join(", ");
  };
  check("its Types as printed - All and Any, every one",
    QUALITIES.filter(trait => [].concat(trait.types ?? []).join(",").split(",").map(t => t.trim())
      .filter(Boolean).join(", ") !== typesOf(trait)).map(trait => trait.id), []);
  check("the Special ones say so", QUALITIES.filter(trait => trait.special === true).map(t => t.id).sort(),
    ["elongation", "super-heavy"].filter(id => QUALITIES.some(t => t.id === id)).concat(
      QUALITIES.filter(t => t.special === true && !["elongation", "super-heavy"].includes(t.id)).map(t => t.id))
      .sort());
  check("an id of its own where an Apparel Quality has the name",
    [getTrait("weapon-durable")?.name, getTrait("durable")?.kind], ["Durable", "crafting"]);
  check("offered by Type: Durable on a Physical Weapon, not an Energy one",
    [GEAR.qualityFitsPiece(getTrait("weapon-durable"), { kind: "weapon", weaponType: "physical" }),
     GEAR.qualityFitsPiece(getTrait("weapon-durable"), { kind: "weapon", weaponType: "energy" }),
     GEAR.qualityFitsPiece(getTrait("artisan"), { kind: "weapon", weaponType: "magic" })], [true, false, true]);
  check("a Quality of the wrong Type is kept, inactive, and says it is the Type",
    GEAR.qualityInactive({ id: "weapon-durable" }, { kind: "weapon", weaponType: "energy",
      qualities: [{ id: "weapon-durable" }] }, getTrait), "type");
}

// --- The Weapon Qualities: what each does ----------------------------------------------------------
{
  const me = holding([]);
  const tier = me.system.tierOfPower;
  const baseTier = me.system.baseTierOfPower;
  const at = (w, context = {}) => GEAR.weaponAttack(w, me, { getTrait,
    sizes: Object.keys(DBUCharacterData.SIZES), ...context });
  const with_ = (qualities, more = {}) => weapon({ grade: 5, qualities, name: "It", ...more });
  const sum = parts => parts.filter(part => part.label === "It").reduce((total, part) => total + part.value, 0);

  check("Artisan: 1(T) on the Wound for each Slot",
    [sum(at(with_([{ id: "artisan", slots: 1 }])).wound), sum(at(with_([{ id: "artisan", slots: 2 }])).wound)],
    [tier, 2 * tier]);
  const life = w => GEAR.craftedReading(w.system.crafted, { getTrait, difficulties: {}, data: { powerLevel: 2 } }).lifeMax;
  check("Durable: 2 more Life Points each Power Level, 4 with 2 Slots",
    [life(with_([{ id: "weapon-durable", slots: 1 }])), life(with_([{ id: "weapon-durable", slots: 2 }]))],
    [32 + 2 * 10, 32 + 2 * 12]);
  const extending = with_([{ id: "extending" }]);
  check("Extending: Melee Range 3; with an Area a Magnitude instead; a Line, neither",
    [[at(extending).meleeRange, at(extending).magnitude],
     [at(extending, { area: { shape: "cone" } }).meleeRange, at(extending, { area: { shape: "cone" } }).magnitude],
     [at(extending, { area: { shape: "line" } }).meleeRange, at(extending, { area: { shape: "line" } }).magnitude]],
    [[3, 0], [0, 1], [0, 0]]);
  const elongated = with_([{ id: "extending" }, { id: "elongation" }]);
  check("Elongation: the whole Battlefield, 2 Magnitudes even on a Line - and Extending does nothing",
    [at(elongated).wholeBattlefield, at(elongated).meleeRange, at(elongated, { area: { shape: "line" } }).magnitude,
     GEAR.qualityInactive({ id: "extending" }, elongated.system.crafted, getTrait)],
    [true, 0, 2, "has Elongation"]);
  check("and Elongation with no Extending does nothing at all",
    GEAR.qualityInactive({ id: "elongation" }, with_([{ id: "elongation" }]).system.crafted, getTrait),
    "needs Extending");
  const energy = { type: "energy", category: "efficient" };
  check("Far Sight, and Precision's own: no Long Range penalty",
    [at(with_([{ id: "far-sight" }], energy)).ignoresLongRange,
     at(weapon({ type: "energy", category: "precision" })).ignoresLongRange,
     at(weapon({ type: "energy", category: "efficient" })).ignoresLongRange], [true, true, false]);
  check("Long Range Weapon: 1(T) against the far ones", at(with_([{ id: "long-range-weapon" }], energy)).longRangeStrike,
    tier);
  const medium = me.system.size.key;
  check("Giant Weapon: 3(T) on the Wound, and 1(T) off the Strike for each Size under Enormous",
    [medium, sum(at(with_([{ id: "giant-weapon" }])).wound), sum(at(with_([{ id: "giant-weapon" }])).strike)],
    ["medium", 3 * tier, -2 * tier]);
  check("High-Tech, Lasting Wounds, Staggering say so - and Bludgeoning and Piercing come with theirs",
    [at(with_([{ id: "high-tech" }])).scholarshipDamage, at(with_([{ id: "lasting-wounds" }])).lastingWounds,
     at(with_([{ id: "staggering" }], { category: "slashing" })).staggering,
     at(weapon({ category: "bludgeoning" })).staggering, at(weapon({ category: "piercing" })).lastingWounds,
     at(weapon({ category: "slashing" })).staggering],
    [true, true, true, true, true, false]);
  check("possessed, it takes no Slot",
    GEAR.craftedReading(weapon({ category: "bludgeoning" }).system.crafted, { getTrait, difficulties: {} }).used, 0);
  check("Targeting System: the Natural Result 1 higher for each Slot",
    [at(with_([{ id: "targeting-system", slots: 1 }])).strikeNatural,
     at(with_([{ id: "targeting-system", slots: 2 }])).strikeNatural], [1, 2]);
  const heavy = with_([{ id: "super-heavy", on: false }]);
  const accustomed = with_([{ id: "super-heavy", on: true }]);
  const heavyRead = w => GEAR.craftedReading(w.system.crafted, { getTrait, difficulties: {} }).hardnessRank;
  check("Super Heavy: 2(bT) off the Strike, 5(bT) on the Wound, Hardness Rank 4",
    [sum(at(heavy).strike), sum(at(heavy).wound), heavyRead(heavy)], [-2 * baseTier, 5 * baseTier, 4]);
  check("accustomed: the Strike's alone goes",
    [sum(at(accustomed).strike), sum(at(accustomed).wound), heavyRead(accustomed),
     accustomed.system.crafted.effects.includes("#off weapon.strike -= 2(bT); # until switched on")],
    [0, 5 * baseTier, 4, true]);
  const duelist = holding([with_([{ id: "duelist" }], { wielded: true })]);
  const two = holding([with_([{ id: "duelist" }], { wielded: true }), with_([{ id: "duelist" }], { wielded: true })]);
  check("Duelist, wielded: the Parry 1(T) higher - once, with two",
    [duelist.system.effects.slots["parry"]?.add, two.system.effects.slots["parry"]?.add],
    [duelist.system.tierOfPower, two.system.tierOfPower]);

  const kinetic = with_([{ id: "telekinetic" }], { wielded: true });
  const hands = [weapon({ wielded: true }), weapon({ wielded: true })];
  const mind = { type: "maneuver", name: "Telekinesis" };
  check("Telekinetic, with Telekinesis: a third Weapon, from anywhere around them",
    [GEAR.wieldProblem([...hands, mind], kinetic, getTrait), GEAR.wieldProblem([...hands, kinetic, mind],
      weapon(), getTrait), GEAR.weaponAttack(kinetic, { system: me.system, items: [mind] }, { getTrait }).telekinetic],
    ["", "Already wielding 2 Weapons.", true]);
  check("without it, a Weapon like any",
    [GEAR.wieldProblem(hands, kinetic, getTrait), at(kinetic).telekinetic], ["Already wielding 2 Weapons.", false]);

  const CHAT = read("module", "chat.mjs");
  const USE = read("module", "use-maneuver.mjs");
  check("the attack reads them: Long Range, Staggering, Lasting Wounds, reach, High-Tech",
    [CHAT.includes("- (atLongRange(attacker, target) ? (Number(weapon.longRangeStrike) || 0) : 0)"),
     CHAT.includes("if (attack.weapon?.staggering && knockedThrough && !isAbsoluteMiss(own)) {"),
     CHAT.includes("if (attacker && attack.weapon?.lastingWounds) await leaveLastingWound(attack, attacker, target);"),
     USE.includes("const unbounded = declared?.weapon?.wholeBattlefield || declared?.weapon?.telekinetic;"),
     USE.includes("if (declared.weapon?.scholarshipDamage) {")], [true, true, true, true, true]);
}

// --- Breaking Weapons ------------------------------------------------------------------------------
{
  const owner = { system: { powerLevel: 1, baseTierOfPower: 2 } };
  const with_ = qualities => weapon({ grade: 5, qualities, name: "Blade" });
  check("a blow on a Weapon: the Wound Roll less its 6(bT) Damage Reduction",
    [GEAR.weaponHit(weapon({ name: "Club" }), owner, 30, { getTrait }).damage,
     GEAR.weaponHit(weapon(), owner, 5, { getTrait }).damage], [18, 0]);
  check("Breaker: a quarter more, rounded up, before the Damage Reduction",
    GEAR.weaponHit(weapon(), owner, 30, { getTrait, breaker: true }).damage, 30 + 8 - 12);
  const unbreakable = with_([{ id: "weapon-unbreakable" }]);
  check("Unbreakable: nothing, ever", [GEAR.weaponHit(unbreakable, owner, 300, { getTrait }).damage,
    GEAR.weaponHit(unbreakable, owner, 300, { getTrait }).unbreakable], [0, true]);

  const writes = [];
  const holder = { isOwner: true, system: owner.system, update: async changes => { writes.push(changes); } };
  const run = async (item, amount) => {
    writes.length = 0;
    const said = await GEAR.damageWeapon(holder, item, amount, getTrait);
    return [said, structuredClone(writes)];
  };
  const blade = weapon({ wielded: true, name: "Blade" });
  check("losing Life Points, and what is left",
    await run(blade, 15), ["Blade loses 15 Life Points: 25/40.",
      [{ items: [{ _id: blade.id, "system.crafted.lifeLost": 15 }] }]]);
  const worn = weapon({ wielded: true, lifeLost: 30, name: "Old" });
  check("brought to 0 it breaks - and is out of hand, as if not there",
    await run(worn, 15), ["Old loses 15 Life Points and breaks.",
      [{ items: [{ _id: worn.id, "system.crafted.lifeLost": 45, "system.crafted.destroyed": true,
        "system.equipped": false }] }]]);
  check("Unbreakable loses nothing; a broken one takes nothing more",
    [(await run(unbreakable, 99))[0], (await run(weapon({ destroyed: true }), 5))[0]],
    ["Blade is Unbreakable: it loses nothing.", ""]);

  const me = holding([]);
  const at = w => GEAR.weaponAttack(w, me, { getTrait });
  check("Breaker says so on the attack", [at(with_([{ id: "breaker" }])).breaker, at(weapon()).breaker], [true, false]);
  const dimension = with_([{ id: "dimension-blade" }]);
  const tenth = Math.floor(GEAR.craftedReading(dimension.system.crafted, { getTrait, difficulties: {},
    data: me.system }).lifeMax / 10);
  check("Dimension Blade: a Damage Category up, and a tenth of its most, rounded down, each attack",
    [at(dimension).damageCategory, at(dimension).selfDamage], [1, tenth]);
  const both = with_([{ id: "dimension-blade" }, { id: "weapon-unbreakable" }]);
  check("with Unbreakable, Dimension Blade does nothing at all",
    [at(both).damageCategory, at(both).selfDamage,
     GEAR.qualityInactive({ id: "dimension-blade" }, both.system.crafted, getTrait)], [0, 0, "has Unbreakable"]);

  const regen = with_([{ id: "regenerating" }]);
  const hurt = { ...regen, system: { ...regen.system, crafted: { ...regen.system.crafted, lifeLost: 9 } } };
  const gone = { ...regen, id: "gone", system: { ...regen.system, crafted: { ...regen.system.crafted, destroyed: true } } };
  check("Regenerating: the hurt and the broken made whole at the Encounter's end; the whole, and others, not",
    GEAR.regenerating([regen, hurt, gone, weapon({ lifeLost: 9 })], getTrait).map(w => w.id), [hurt.id, "gone"]);
  const COMBAT = read("module", "combat.mjs");
  check("asked when the Combat ends", COMBAT.includes("  await regenerateWeapons(actor);")
    && COMBAT.includes("for (const actor of combatants(combat)) await endEncounterFor(actor);"), true);

  const warding = holding([with_([{ id: "warding-weapon" }].concat()), weapon()].map((w, i) =>
    i ? w : { ...w, system: { ...w.system, equipped: true } }));
  const bare = holding([]);
  check("Warding Weapon, wielded: Damage Reduction 2(bT), and 1(T) in a Clash opened against you",
    [warding.system.damageReduction - bare.system.damageReduction,
     warding.system.effects.slots["clash.defending"]?.add], [2 * warding.system.baseTierOfPower, warding.system.tierOfPower]);

  const evil = { system: { alignment: -2 } };
  const good = { system: { alignment: 1 } };
  const neutral = { system: { alignment: 0 } };
  const edge = choice => with_([{ id: "karmic-edge", choice }]);
  const charges = (w, target) => GEAR.weaponAttack(w, me, { getTrait, target }).energyCharges;
  check("Karmic Edge: an Energy Charge against the Alignment chosen, none otherwise",
    [charges(edge("evil"), evil), charges(edge("evil"), good), charges(edge("good"), good),
     charges(edge("good"), neutral), charges(edge("good"), null)], [1, 0, 1, 0, 0]);

  const CHAT = read("module", "chat.mjs");
  const USE = read("module", "use-maneuver.mjs");
  check("a Called Shot may be aimed at one of the target's Weapons",
    [USE.includes("const weapons = (modifier.targetsApparel && target) ? wieldedWeapons(target.items.contents) : [];"),
     USE.includes("atWeapon: item ? { itemId: item.id, name: item.name, ownerUuid: target.uuid } : null")], [true, true]);
  check("the Weapon takes the blow, and its holder nothing",
    [CHAT.includes("const struck = struckWeapon(attack, uuid, own);"),
     CHAT.includes("damage: 0, weaponHit: landed ?? { itemId: struck.itemId, name: struck.name, damage: 0 } });"),
     CHAT.includes("button.addEventListener(\"click\", () => applyWeaponHit(message, target, attack));")], [true, true, true]);
  check("Block: hit, having only Dodged, a Shield in hand and a Counter Action",
    [CHAT.includes('if (!own?.hit || own.block || isAbsoluteMiss(own) || ((own.defense ?? "dodge") !== "dodge")) continue;'),
     CHAT.includes('if ((game.combat?.started && (actionsWithin(target, "counter") < 1)) || timeFrozen(target)) continue;'),
     CHAT.includes('if (!await spendActions(target, 1, "counter")) return;')], [true, true, true]);
  check("a Strike with the Shield against the attack's; a tie is the Defender's",
    [CHAT.includes("...(withIt?.strike ?? []),"), CHAT.includes("const won = roll.total >= against;")], [true, true]);
  check("Warding's number on the Dodge, the Parry and any Clash's defending side",
    [(CHAT.match(/openedAgainst\(actor\)/g) ?? []).length >= 3,
     CHAT.includes("...((uuid === clash.defenderUuid) ? openedAgainst(actor) : []),")], [true, true]);
  check("Breaker on Apparel: 2 off, both ways", CHAT.includes("const breaks = attack.weapon?.breaker ? 2 : 1;"), true);
  check("Dimension Blade paid as the attack is made, in sequence or out of it; thrown, on a hit",
    CHAT.includes("if (weapon?.selfDamage && weapon.itemId && !weapon.thrown && !reflecting) {"), true);
}

// --- Thrown ----------------------------------------------------------------------------------------
{
  const me = holding([]);
  const with_ = (qualities, more = {}) => weapon({ grade: 5, qualities, name: "Knife", wielded: true, ...more });
  const plain = GEAR.thrownAs(weapon({ wielded: true, name: "Club" }), me, getTrait);
  check("a Weapon thrown: Rank 2, in hand, and nothing of its own", [plain.rank, plain.value, plain.wielded,
    plain.throwing, plain.barrage, plain.returns, plain.copies], [2, null, true, false, false, 0, false]);
  check("Super Heavy thrown: Hardness Rank 4, its Value the Rank's",
    [GEAR.thrownAs(with_([{ id: "super-heavy" }]), me, getTrait).rank,
     GEAR.thrownAs(with_([{ id: "super-heavy" }]), me, getTrait).value], [4, null]);
  const thrower = with_([{ id: "throwing-weapon" }, { id: "barrage-weapon" }, { id: "boomerang", slots: 2 }]);
  const read_ = GEAR.thrownAs(thrower, me, getTrait);
  check("Throwing Weapon, Barrage, Boomerang's 2 Slots", [read_.throwing, read_.barrage, read_.returns], [true, true, 2]);
  check("Barrage, Boomerang and Multi-Storage need Throwing Weapon; Boomerang and Multi-Storage not together",
    [GEAR.qualityInactive({ id: "barrage-weapon" }, with_([{ id: "barrage-weapon" }]).system.crafted, getTrait),
     GEAR.qualityInactive({ id: "boomerang" }, with_([{ id: "throwing-weapon" }, { id: "boomerang" },
       { id: "multi-storage" }]).system.crafted, getTrait)], ["needs Throwing Weapon", "has Multi-Storage"]);
  const copies = with_([{ id: "throwing-weapon" }, { id: "multi-storage" }]);
  check("Multi-Storage: three Throws a Round, one otherwise",
    [GEAR.throwsAllowed(GEAR.thrownAs(copies, me, getTrait)), GEAR.throwsAllowed(plain),
     GEAR.throwsCopies([copies], getTrait), GEAR.throwsCopies([thrower], getTrait)], [3, 1, true, false]);

  const armed = GEAR.weaponAttack(with_([{ id: "throwing-weapon" }, { id: "artisan", slots: 2 },
    { id: "targeting-system", slots: 2 }], { size: "small", category: "slashing" }), me,
    { getTrait, sizes: Object.keys(DBUCharacterData.SIZES) });
  const flying = GEAR.thrownWeaponAttack(armed);
  check("thrown, nothing on the Strike - not its Size, not the Penalty, not Targeting System",
    [armed.strike.length > 0, flying.strike, flying.strikeNatural], [true, [], 0]);
  check("and its Size nowhere; what it adds to the Wound, and the rest, once it hits",
    [flying.wound.map(part => part.label), flying.diminishingAtDeclaration],
    [["Knife"], true]);

  const USE = read("module", "use-maneuver.mjs");
  const CHAT = read("module", "chat.mjs");
  check("the Throw flow: held to its count, Barrage asked, Throwing Weapon's effects on the attack",
    [USE.includes("if (throwsThisRound(actor, maneuver) >= throwsAllowed(thrown)) {"),
     USE.includes("maneuver = { ...maneuver, profile };"),
     USE.includes("weapon: thrownWeaponAttack(armedWith(actor, item, declared, [], targetActor)) };")],
    [true, true, true]);
  check("thrown from the hand, out of it - but for a Boomerang taken back, and a copy",
    [USE.includes("if (card && thrown?.wielded && !thrown.copies) {"),
     USE.includes('if (!back) await actor.items.get(thrown.itemId)?.update({ "system.equipped": false });')],
    [true, true]);
  check("a thrown Dimension Blade pays only when it hits",
    CHAT.slice(CHAT.indexOf("async function landThrown("), CHAT.indexOf("async function landThrown(") + 600)
      .includes("if (attack.weapon?.selfDamage) {"), true);
  check("a Signature Technique asks no Weapon without Weapon Assisted",
    USE.includes('&& !(declared.advantages ?? []).includes("weapon-assisted");'), true);
  check("Spiked answers only an Unarmed blow",
    CHAT.includes('if (attacker && own.hit && !isAbsoluteMiss(own) && (attack.foundation === "physical")\n    && (!attack.weapon || attack.weapon.unarmed)) {'), true);
}

// --- Flexible, Transforming, Variable ---------------------------------------------------------------
{
  const me = holding([]);
  const tier = me.system.tierOfPower;
  const categories = traitsOfKind("crafting", "weapon-categories");
  const crafted = { kind: "weapon", weaponType: "physical", category: "bludgeoning", weaponSize: "standard" };
  check("what each chooses from: the Type's other Categories; other Types' Categories; the other Sizes",
    [GEAR.qualityChoices(getTrait("flexible"), {}, {}, { crafted, categories }).sort(),
     GEAR.qualityChoices(getTrait("transforming-weapon"), {}, {}, { crafted, categories }).length,
     GEAR.qualityChoices(getTrait("variable"), {}, {}, { crafted, categories })],
    [["piercing", "shield", "slashing"], 6, ["small", "big"]]);
  check("one for each Slot, and named", [getTrait("flexible").choosesPerSlot,
    GEAR.qualityChoiceLabel(getTrait("flexible"), "slashing,piercing", {}, {}, getTrait)], [true, "Slashing, Piercing"]);

  const flexible = weapon({ grade: 5, wielded: true, name: "Staff", qualities: [{ id: "flexible", slots: 2,
    choice: "slashing,piercing" }] });
  check("its other Categories written in, marked, and not run while it is its own",
    [flexible.system.crafted.effects.includes("#@ category slashing alternate | Slashing"),
     GEAR.weaponAttack(flexible, me, { getTrait }).categoryName,
     GEAR.weaponAttack(flexible, me, { getTrait }).wound.length,
     GEAR.weaponAttack(flexible, me, { getTrait }).staggering], [true, "Bludgeoning", 0, true]);
  const slashing = { ...flexible, system: { ...flexible.system, crafted: { ...flexible.system.crafted,
    activeCategory: "slashing" } } };
  check("switched: that Category's, and not the other's - Staggering goes with Bludgeoning",
    [GEAR.weaponAttack(slashing, me, { getTrait }).categoryName,
     GEAR.weaponAttack(slashing, me, { getTrait }).wound.map(part => part.value),
     GEAR.weaponAttack(slashing, me, { getTrait }).staggering,
     GEAR.weaponAttack(slashing, me, { getTrait }).damageReductionIgnored], ["Slashing", [2 * tier], false, 0]);
  check("offered on the row: its own and the ones chosen",
    GEAR.flexibleCategories(flexible, getTrait), ["bludgeoning", "slashing", "piercing"]);

  const staff = weapon({ grade: 5, wielded: true, name: "Rod", qualities: [
    { id: "transforming-weapon", slots: 1, choice: "magic-staff" }, { id: "weapon-durable", slots: 1 }] });
  const forms = GEAR.weaponForms(staff, getTrait);
  check("Transforming: its own form and one as the Magic Staff, at its Size",
    forms.map(form => [form.category, form.weaponType, form.size]),
    [["bludgeoning", "physical", "standard"], ["magic-staff", "magic", "standard"]]);
  check("offered for a Magic Attack, and for a Physical one", [GEAR.weaponsFor([staff], "magic", getTrait).length,
    GEAR.weaponsFor([staff], "physical", getTrait).length, GEAR.weaponsFor([staff], "energy", getTrait).length], [1, 1, 0]);
  const asStaff = GEAR.weaponAttack(staff, me, { getTrait, form: forms[1] });
  check("as that, only what takes that Type: Durable, a Physical Quality, does not run",
    [asStaff.categoryName, asStaff.weaponType,
     GEAR.formScript(staff.system.crafted.effects, forms[1], getTrait).includes("weapon.lifePerLevel"),
     GEAR.formScript(staff.system.crafted.effects, forms[0], getTrait).includes("weapon.lifePerLevel")],
    ["Magic Staff", "magic", false, true]);
  const wielding = holding([staff]);
  check("in hand in its own form, the Magic Staff's while-wielded lines do not run",
    wielding.system.effects.slots["skill.useMagic"]?.add ?? 0, 0);

  const variable = weapon({ grade: 5, wielded: true, name: "Pole", qualities: [{ id: "variable", slots: 1, choice: "big" }] });
  const big = { ...variable, system: { ...variable.system, crafted: { ...variable.system.crafted, activeSize: "big" } } };
  check("Variable: its own Size and the one chosen; changed, its attacks roll as that",
    [GEAR.variableSizes(variable, getTrait), GEAR.weaponAttack(big, me, { getTrait }).strike[0].label], [["standard", "big"], "Big Weapon"]);

  const COMBAT = read("module", "combat.mjs");
  const SHEET = read("module", "sheets", "actor-character-sheet.mjs");
  check("Flexible's back to its own when the turn ends; Variable's for the No Effort Maneuver",
    [COMBAT.includes('({ _id: item.id, "system.crafted.activeCategory": "" })));'),
     SHEET.slice(SHEET.indexOf("static async _onResizeGear("), SHEET.indexOf("static async _onResizeGear(") + 1200)
       .includes("await recordManeuverUse(this.actor, noEffort);")], [true, true]);
}

// --- Burst Fire, Concealed, Shishkebab, Controller Weapon ------------------------------------------
{
  const me = holding([]);
  const with_ = (qualities, more = {}) => weapon({ grade: 5, qualities, name: "Gun", wielded: true,
    type: "energy", category: "efficient", ...more });
  check("Burst Fire and Concealed say so on the attack",
    [GEAR.weaponAttack(with_([{ id: "burst-fire" }]), me, { getTrait }).burstFire,
     GEAR.weaponAttack(with_([{ id: "concealed" }]), me, { getTrait }).concealed], [true, true]);
  const kebab = with_([{ id: "shishkebab", slots: 3 }]);
  const eater = id => ({ system: { usedManeuvers: [`encounter:snack.${kebab.id}`, `encounter:snack.${kebab.id}`] } });
  globalThis.game.combat = { started: true };
  check("Shishkebab: a Snack a Slot, a Combat Encounter", [GEAR.snacksLeft({ system: { usedManeuvers: [] } }, kebab, getTrait),
    GEAR.snacksLeft(eater(), kebab, getTrait), GEAR.snacksLeft(eater(), with_([]), getTrait)], [3, 1, 0]);
  globalThis.game.combat = null;
  const one = with_([{ id: "controller-weapon", slots: 1, choice: "bomb" }]);
  const all = with_([{ id: "controller-weapon", slots: 2, choice: "shock-collar" }]);
  check("Controller Weapon: a Remote Control for what it is attuned to - every one of it, with 2 Slots",
    [GEAR.remoteKinds(one, getTrait), GEAR.remotesAll(one, getTrait), GEAR.remoteKinds(all, getTrait),
     GEAR.remotesAll(all, getTrait), GEAR.remoteKinds(with_([]), getTrait), GEAR.remoteCost(one)],
    [["bomb"], false, ["shock-collar"], true, [], 1]);
  const bomb = { id: "b1", type: "gear", system: { gearId: "bomb" } };
  check("and reaches what a Remote Control of that type reaches",
    GEAR.connectable([bomb, { id: "x", system: { gearId: "snack" } }], one, getTrait).map(item => item.id), ["b1"]);

  const USE = read("module", "use-maneuver.mjs");
  const CHAT = read("module", "chat.mjs");
  const SHEET = read("module", "sheets", "actor-character-sheet.mjs");
  check("Burst Fire asked, the Charges on the attack, the Actions paid with the Maneuver's",
    [USE.includes("burstActions = await askBurstFire(actor, maneuver, actionsSpent, declared.weapon.name);"),
     USE.includes("energyCharges: (declared.weapon.energyCharges ?? 0) + burstActions } };"),
     USE.includes("if (burstActions) await spendActions(actor, burstActions);")], [true, true, true]);
  check("Concealed: once a Round, Stealth against Perception, Guard Down on a win",
    [USE.includes("const concealedKey = `round:concealed.${weaponItem?.id ?? \"\"}`;"),
     USE.includes('clash: { skill: "stealth", defenderSkills: ["perception"] }'),
     CHAT.includes('if (await setCondition(target, "guard-down", 1) === false) return;\n  await lasting(attacker, { kind: KINDS.CONDITION, key: "guard-down"')],
    [true, true, true]);
  check("the Weapon's row: Attune, Trigger, Snack",
    [SHEET.includes("attuneGear: DBUCharacterSheet._onAttuneGear"), SHEET.includes("snackGear: DBUCharacterSheet._onSnackGear"),
     SHEET.includes("if (remotesAll(remote, getTrait)) {")], [true, true, true]);
}

// --- Quick Draw, and the Sheath/Holster -------------------------------------------------------------
{
  const quick = weapon({ grade: 5, qualities: [{ id: "quick-draw" }], name: "Fast" });
  const sheath = { id: "sh", type: "gear", name: "Scabbard", system: { gearId: "sheath-holster", equipped: true } };
  const actor = { system: { usedManeuvers: [] } };
  check("put away with Quick Draw: the Wound waits; into a Sheath/Holster worn and empty",
    [GEAR.drawChanges(actor, quick, false, { getTrait, sheath }).item,
     GEAR.emptySheath([sheath]).id, GEAR.emptySheath([sheath, { ...quick, system: { ...quick.system,
       crafted: { ...quick.system.crafted, sheathedIn: "sh" } } }])],
    [{ "system.equipped": false, "system.crafted.sheathedIn": "sh", "system.crafted.drawn.quick": false,
       "system.crafted.drawn.sheath": false, "system.crafted.drawn.sheathedWound": true }, "sh", null]);
  const inSheath = { ...quick, system: { ...quick.system, crafted: { ...quick.system.crafted, sheathedIn: "sh" } } };
  const drawn = GEAR.drawChanges(actor, inSheath, true, { getTrait, round: 2 });
  check("drawn out of it the first time this Encounter: its Strike this Round; Quick Draw's for the next Maneuver",
    [drawn.item, drawn.firstKey],
    [{ "system.equipped": true, "system.crafted.sheathedIn": "", "system.crafted.drawn.quick": true,
       "system.crafted.drawn.sheath": true, "system.crafted.drawn.round": 2 }, `encounter:sheath.${quick.id}`]);
  check("not the second time, and not out of a Combat Encounter",
    [GEAR.drawChanges({ system: { usedManeuvers: [`encounter:sheath.${quick.id}`] } }, inSheath, true,
      { getTrait, round: 2 }).item["system.crafted.drawn.sheath"],
     GEAR.drawChanges(actor, inSheath, true, { getTrait, round: 0 }).item["system.crafted.drawn.sheath"]],
    [false, false]);
  const marked = { ...quick, system: { ...quick.system, crafted: { ...quick.system.crafted,
    drawn: { quick: true, sheath: true, round: 2, sheathedWound: true } } } };
  const names = rows => rows.map(row => [row.name, row.strikePerTier, row.woundPerTier]);
  check("an attack with it takes all three, this Round",
    names(GEAR.drawnBonuses([marked], { attacking: true, weaponId: quick.id, round: 2 }).rows),
    [["Quick Draw (Fast)", 1, 0], ["Sheath/Holster", 2, 0], ["Quick Draw (Fast)", 0, 2]]);
  check("an attack with another: Quick Draw's Strike only; any other Maneuver spends it for nothing",
    [names(GEAR.drawnBonuses([marked], { attacking: true, weaponId: "other", round: 2 }).rows),
     GEAR.drawnBonuses([marked], { attacking: false, round: 2 }).rows,
     GEAR.drawnBonuses([marked], { attacking: false, round: 2 }).spent],
    [[["Quick Draw (Fast)", 1, 0]], [], [{ _id: quick.id, "system.crafted.drawn.quick": false }]]);
  check("the Sheath/Holster's Strike is gone once the Round is",
    names(GEAR.drawnBonuses([marked], { attacking: true, weaponId: quick.id, round: 3 }).rows).length, 2);
  const worn = { ...inSheath, system: { ...inSheath.system, crafted: { ...inSheath.system.crafted, lifeLost: 25 } } };
  const holder = { system: { powerLevel: 1 }, items: [worn, sheath] };
  check("in it at the Encounter's end: a quarter of its most back, rounded down; not broken",
    [GEAR.sheathMending(holder, getTrait).map(entry => entry.lifeLost),
     GEAR.sheathMending({ ...holder, items: [{ ...worn, system: { ...worn.system, crafted: { ...worn.system.crafted,
       destroyed: true } } }, sheath] }, getTrait).length], [[15], 0]);
  const USE = read("module", "use-maneuver.mjs");
  check("taken by the Maneuver after, and on the attack as rows",
    [USE.includes("const drawn = drawnBonuses(actor.items.contents, { attacking: Boolean(declared),"),
     USE.includes("{ modifiers: [...appliedModifiers(modifiers), ...drawn.rows], asOutOfSequence: outOfSequence || Boolean(maneuver.godStrike) })")], [true, true]);
}

// --- Borrowed Categories, the Parry, out of sequence ---------------------------------------------
{
  const { PROFILES } = await import(modUrl("maneuvers.mjs"));
  const me = holding([]);
  const tier = me.system.tierOfPower;
  check("Elemental (Earth) borrows Bludgeoning, (Wind) Slashing - nothing left waiting",
    [PROFILES.elementalEarth.borrowsCategory, PROFILES.elementalWind.borrowsCategory,
     PROFILES.elementalEarth.needs ?? null, PROFILES.elementalWind.needs ?? null],
    ["bludgeoning", "slashing", null, null]);
  const earth = GEAR.borrowedCategory("bludgeoning", me, { getTrait, source: "Elemental (Earth)" });
  const wind = GEAR.borrowedCategory("slashing", me, { getTrait, source: "Elemental (Wind)" });
  check("as though made with a Weapon: its Category and what it possesses - no Size, no Penalty",
    [earth.damageReductionIgnored, earth.staggering, earth.strike, earth.itemId, earth.borrowed],
    [0.5, true, [], "", true]);
  check("Slashing's Wound and Diminishing Defense", [wind.wound.map(part => [part.label, part.value]),
    wind.diminishingAtDeclaration], [[["Slashing (Elemental (Wind))", 2 * tier]], true]);
  const own = GEAR.weaponAttack(weapon({ grade: 5, category: "piercing", name: "Spear",
    qualities: [{ id: "artisan", slots: 1 }] }), me, { getTrait, form: { category: "", weaponType: "physical", size: "standard" } });
  const both = GEAR.withBorrowed(own, earth);
  check("with a Weapon, its own Category put aside for the one borrowed; its Qualities kept",
    [own.soakIgnored, own.lastingWounds, both.categoryName, both.damageReductionIgnored, both.staggering,
     both.wound.map(part => part.label)],
    [0, false, "Bludgeoning", 0.5, true, ["Spear"]]);
  const USE = read("module", "use-maneuver.mjs");
  const CHAT = read("module", "chat.mjs");
  check("the Category Limit asked where the Weapon has another",
    USE.includes("if (weaponItem && declared.weapon?.category && (declared.weapon.category !== lends)) {"), true);
  check("a Parry with a Weapon: its Size and the Penalty, nothing else",
    [CHAT.includes('const parryWeapon = (chosen.defence === "parry") ? await askParryWeapon(target) : [];'),
     CHAT.includes("...(defenceFor(attack, actor.uuid)?.parryWith ?? [])"),
     CHAT.includes("return (armed?.strike ?? []).filter(part => part.label !== item.name);")], [true, true, true]);
  check("out of sequence: the Weapon asked there too, and its reach",
    [CHAT.includes("declared = await armOutOfSequence(actor, maneuver, declared, target, granted?.modifiers ?? []);"),
     CHAT.includes("&& whyNotInReach(actor, target, declared, declared.weapon?.meleeRange ?? 0);")], [true, true]);
}

// --- The Poison Vial --------------------------------------------------------------------------------
{
  const me = holding([]);
  const sword = weapon({ name: "Sword" });
  const dipped = { ...sword, system: { ...sword.system, crafted: { ...sword.system.crafted, poisoned: true } } };
  check("a Poisoned Weapon says so on the attack", [GEAR.weaponAttack(sword, me, { getTrait }).poisoned,
    GEAR.weaponAttack(dipped, me, { getTrait }).poisoned], [false, true]);
  const CHAT = read("module", "chat.mjs");
  const COMBAT = read("module", "combat.mjs");
  const SHEET = read("module", "sheets", "actor-character-sheet.mjs");
  check("Poisoned off a Health Threshold with it; clean at the Encounter's end; an Action and a Drop",
    [CHAT.includes('if (attack.weapon?.poisoned && knockedThrough && !isAbsoluteMiss(own)) {'),
     COMBAT.includes('({ _id: item.id, "system.crafted.poisoned": false })));'),
     SHEET.includes('await vial.update({ "system.charges": vial.system.charges - 1 });')], [true, true, true]);
}

// --- Parrying Armor: with no Weapon in hand ----------------------------------------------------------
{
  const data = GEAR.craftedItemFrom("apparel", null, getTrait);
  const armor = { ...data, id: "pa", name: "Guard", type: "gear",
    system: { ...data.system, equipped: true, layer: "top",
      crafted: { ...data.system.crafted, category: "armor", grade: 5,
        qualities: [{ id: "parrying-armor", slots: 1 }], effects: null } } };
  const parry = items => holding(items).system.effects.slots["parry"]?.add ?? 0;
  check("its Parry bonus with nothing in hand, none with a Weapon, again with a broken one",
    [parry([armor]) > 0, parry([armor, weapon({ wielded: true })]),
     parry([armor, weapon({ wielded: true, destroyed: true })]) > 0], [true, 0, true]);
}

console.log(`${failed} failing`);
process.exit(failed ? 1 : 0);
