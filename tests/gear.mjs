/**
 * Gear: the Item type, its library, and the Add Item window.
 *
 * The library is empty until the Items are given, so what is run here is the machinery
 * against a file made up for the purpose - the one thing it cannot be tested on is a file
 * that does not exist. Every file that does exist is checked as well, so the first real one
 * is held to the same shape.
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

const { loadTraits, traitsOfKind, KINDS, parseTraitFile } = await import(modUrl("effects/traits.mjs"));
await loadTraits();
const { GEAR_TYPES, GEAR_TAGS, GEAR_FOLDERS, GEAR_TRIGGERS, typeOf, tagsOf, gearOfList,
        gearItemFrom, triggersOf, recordedFrom, tickCountdowns, hazardFormula, heldBy, isStored,
        storable, encounterUseKey, usedThisEncounter, tierDice, connectable, connectedItem,
        canTrigger, hiddenKey, holdingBackStacks, stillHidden, scanReading, sizesOf,
        conditionsRestored, setGathered, gearGranting, drainStore, canPayAttack, portionsOf,
        portionEffects, ACCESSORIES_WORN, EQUIP_COST, isAccessory, wornAccessories,
        equipProblem, accessoriesInEffect } = await import(modUrl("gear.mjs"));
const { getTrait, printedLines } = await import(modUrl("effects/traits.mjs"));
const { default: DBUGearData } = await import(modUrl("data/item-gear.mjs"));

const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");
const SYSTEM = JSON.parse(read("system.json"));
const INIT = read("module", "dbu-ttrpg.mjs");
const SHEET = read("module", "sheets", "actor-character-sheet.mjs");
const TAB = read("templates", "parts", "actor-gear.hbs");
const ITEM_SHEET = read("module", "sheets", "item-gear-sheet.mjs");
const ITEM_PAGE = ["gear-header", "gear-sheet", "gear-description", "gear-crafted", "gear-qualities"].map(name => read("templates", "parts", `${name}.hbs`)).join("\n");
const INDEX = JSON.parse(read("traits", "index.json"));

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

// --- The Item type, registered -------------------------------------------------------------
check("the system declares a gear Item type", Object.keys(SYSTEM.documentTypes.Item).sort(),
  ["gear", "maneuver", "racial", "talent", "transformation"]);
check("with its data model and its sheet", [
  INIT.includes("CONFIG.Item.dataModels.gear = DBUGearData;"),
  /registerSheet\(foundry\.documents\.Item, "dbu-ttrpg", DBUGearSheet, \{\s*types: \["gear"\]/.test(INIT)
], [true, true]);
check("and a character takes one dropped on them", SHEET.includes(
  'static ACCEPTS = ["talent", "maneuver", "gear"];'), true);
check("the files have a folder of their own", KINDS.gear?.label, "Gear");

// --- The four Item Types, and the three lists -----------------------------------------------
check("four Item Types, and the Buddies", Object.keys(GEAR_TYPES), ["basic", "accessory", "apparel", "weapon", "buddy"]);
check("Accessories share the Basic Items' list",
  Object.values(GEAR_TYPES).map(type => type.list), ["basic", "basic", "apparel", "weapon", "buddy"]);
check("three tags, two of them naming the Skill that makes the Item",
  Object.fromEntries(Object.entries(GEAR_TAGS).map(([key, tag]) => [key, tag.craftSkill ?? null])),
  { tech: null, med: "medicine", food: "cooking" });

// --- A file, made into an Item -----------------------------------------------------------------
{
  // Made up for the purpose: the library is empty until the Items are given. Written the
  // way a real one will be, and read by the real parser.
  const sample = parseTraitFile(`id: sample-scouter
name: Sample Scouter
kind: gear
itemType: accessory
tags: tech, med
craftDC: Expert
source: Core Rule
text: >
  A made-up Item, for the harness.

---
`, "gear/sample-scouter.dbu");
  const plain = parseTraitFile(`id: sample-rope
name: Sample Rope
kind: gear
tags: food
text: >
  Another.

---
`, "gear/sample-rope.dbu");

  check("its Item Type, read off the header", [typeOf(sample), typeOf(plain)], ["accessory", "basic"]);
  check("an unknown Item Type is a Basic Item", typeOf({ itemType: "vehicle" }), "basic");
  check("its tags, from one value or several, and only the ones the rules name", [
    tagsOf(sample), tagsOf(plain), tagsOf({ tags: "Tech, magic" }), tagsOf({})
  ], [["tech", "med"], ["food"], ["tech"], []]);

  const item = gearItemFrom(sample);
  check("the Item it becomes", {
    name: item.name, type: item.type, gearId: item.system.gearId,
    itemType: item.system.itemType, tags: item.system.tags, craftDC: item.system.craftDC,
    description: item.system.description, hasText: item.system.text.includes("made-up Item")
  }, {
    name: "Sample Scouter", type: "gear", gearId: "sample-scouter", itemType: "accessory",
    tags: ["tech", "med"], craftDC: "Expert", description: "", hasText: true
  });

  // Through the real schema: a SchemaField drops any key it does not declare, silently.
  // Handed a copy, because the model cleans what it is given in place - handed the Item
  // itself, it took the dropped key off both sides and the comparison measured nothing.
  const model = new DBUGearData(structuredClone(item.system), { strict: false });
  const kept = model.toObject();
  // Value by value: a key the schema dropped reads back undefined, and one it kept reads
  // back as it went in - null included, which is what an Item that records nothing holds.
  check("every key the Item is given survives the schema",
    Object.keys(item.system).filter(key =>
      JSON.stringify(kept[key]) !== JSON.stringify(item.system[key])), []);
  check("and comes out as it went in",
    [kept.gearId, kept.itemType, kept.tags, kept.craftDC], ["sample-scouter", "accessory",
      ["tech", "med"], "Expert"]);

  // The lists: Basic Items and Accessories together, by name; nothing else in them.
  const weapon = { id: "w", name: "A Weapon", itemType: "weapon" };
  const listed = gearOfList([sample, weapon, plain], "basic").map(entry => entry.id);
  check("the Basic list offers Basic Items and Accessories, by name",
    listed, ["sample-rope", "sample-scouter"]);
  check("and the Weapons list the Weapon", gearOfList([sample, weapon], "weapon").map(e => e.id),
    ["w"]);
}

// --- The folders ------------------------------------------------------------------------------
{
  check("one folder per list", Object.keys(GEAR_FOLDERS), ["basic", "apparel", "weapons", "buddies"]);
  check("and each folder is there",
    Object.keys(GEAR_FOLDERS).filter(folder => !fs.existsSync(path.join(TRAITS, "gear", folder))),
    []);
  check("each folder's types are the ones its list draws", Object.fromEntries(
    Object.entries(GEAR_FOLDERS).map(([folder, types]) =>
      [folder, [...new Set(types.map(type => GEAR_TYPES[type].list))]])),
    { basic: ["basic"], apparel: ["apparel"], weapons: ["weapon"], buddies: ["buddy"] });

  // The folder decides, and the header only tells an Accessory from a Basic Item.
  check("a file in basic/ is a Basic Item unless it says Accessory", [
    typeOf({ owner: "basic" }), typeOf({ owner: "basic", itemType: "accessory" }),
    typeOf({ owner: "basic", itemType: "weapon" })
  ], ["basic", "accessory", "basic"]);
  check("a file in apparel/ or weapons/ is what its folder is, whatever it says", [
    typeOf({ owner: "apparel" }), typeOf({ owner: "weapons" }),
    typeOf({ owner: "weapons", itemType: "accessory" })
  ], ["apparel", "weapon", "weapon"]);
  check("and one outside them is what it says, or a Basic Item",
    [typeOf({ itemType: "apparel" }), typeOf({})], ["apparel", "basic"]);
}

// --- The library, as it stands -----------------------------------------------------------------
{
  const library = traitsOfKind("gear");
  const listedFiles = INDEX.traits.filter(file => file.startsWith("gear/"));
  const onDisk = [];
  for (const folder of ["", ...Object.keys(GEAR_FOLDERS)]) {
    const dir = path.join(TRAITS, "gear", folder);
    for (const file of fs.readdirSync(dir).filter(name => name.endsWith(".dbu"))) {
      onDisk.push(["gear", folder, file].filter(Boolean).join("/"));
    }
  }
  check("every file in the folders is in the index",
    onDisk.filter(file => !INDEX.traits.includes(file)), []);
  check("and every one sits in one of the three folders",
    listedFiles.filter(file => !GEAR_FOLDERS[file.split("/")[1]] || file.split("/").length !== 3),
    []);
  // A header that says something its folder cannot hold is a file in the wrong folder.
  check("no file says it is a type its folder does not hold",
    traitsOfKind("gear").filter(entry => entry.itemType
      && !(GEAR_FOLDERS[entry.owner] ?? []).includes(String(entry.itemType).toLowerCase()))
      .map(entry => entry.id), []);
  check("and every one loads", library.length, listedFiles.length);
  check("every Item names a type there is, or none",
    library.filter(entry => entry.itemType && !GEAR_TYPES[entry.itemType]).map(e => e.id), []);
  check("and only tags the rules name",
    library.filter(entry => {
      const raw = Array.isArray(entry.tags) ? entry.tags : String(entry.tags ?? "").split(",");
      return raw.map(t => t.trim().toLowerCase()).filter(Boolean).some(t => !GEAR_TAGS[t]);
    }).map(e => e.id), []);
  check("with an entry to show", library.filter(entry => !String(entry.text ?? "").trim())
    .map(e => e.id), []);
}

// --- The Gear tab: the rows and the button ------------------------------------------------------
{
  check("the tab draws a row per Basic Item or Accessory",
    TAB.includes("{{#each gear.basic as |row|}}"), true);
  check("a pencil opens its sheet, where it can be renamed - the name itself opens nothing",
    [TAB.includes('<button type="button" class="gear-control" data-action="editItem"\n'
      + '                data-item-id="{{row.itemId}}" data-tooltip="Edit">&#9998;</button>'),
     TAB.includes('<span class="gear-name">{{row.name}}</span>'),
     /data-action="editItem" data-item-id="\{\{row\.itemId\}\}">\{\{row\.name\}\}/.test(TAB)],
    [true, true, false]);
  check("and it can be taken off",
    TAB.includes('data-action="deleteItem"') && TAB.includes('data-item-id="{{row.itemId}}"'), true);
  check("the Add Item button, on the Basic list",
    TAB.includes('data-action="addGear" data-list="basic"'), true);
  check("the button is an action the sheet has",
    SHEET.includes("addGear: DBUCharacterSheet._onAddGear,"), true);
  check("the sheet builds the rows from the character's own Items",
    SHEET.includes('this.actor.items.filter(owned => owned.type === "gear")'), true);
  check("drawn by the Item's name, so a renamed one shows renamed",
    SHEET.includes("name: item.name,"), true);

  const add = SHEET.slice(SHEET.indexOf("static async _onAddGear("),
    SHEET.indexOf("static async _onArmTalent("));
  check("the window offers the files for that list", add.includes(
    'const offered = gearOfList(traitsOfKind("gear"), list);'), true);
  check("as a dropdown", add.includes('<select name="gear" class="dbu-gear-pick">'), true);
  check("grouped by the Item Type the files are read as, Special ones apart",
    [add.includes("items: offered.filter(entry => (typeOf(entry) === key) && (entry.special !== true)) },"),
     add.includes("items: offered.filter(entry => (typeOf(entry) === key) && (entry.special === true)) }")],
    [true, true]);
  check("and says so when there is nothing to offer", add.includes("if (!offered.length) {"), true);
  check("the one picked becomes the character's, made by them",
    add.includes("const data = gearItemFrom(definition, this.actor);")
      && add.includes("return give([data]);"), true);
  check("and an Item with a choice of trigger asks which",
    add.includes("if (data.system.triggers.length > 1) {"), true);
  check("and nothing counts what was taken",
    /equipmentPoints|gearKit(?!Ingenuity)|\bEP\b/.test(add), false);
}

// --- The Item's own sheet ---------------------------------------------------------------------
{
  check("the name is an input", ITEM_PAGE.includes('<input type="text" name="name" value="{{item.name}}"'),
    true);
  check("the description is the player's to write",
    ITEM_PAGE.includes("{{formInput fields.description value=system.description"), true);
  // The file's first, then - for an Item built rather than given from a file - its
  // Category's, then the copy's.
  check("the entry is read from the file while there is one",
    ITEM_SHEET.replace(/\r\n/g, "\n").includes("const entry = getTrait(system.gearId)?.text\n"
      + "      || (context.crafted ? getTrait(system.crafted.category)?.text : \"\")\n"
      + "      || system.text;"), true);
  check("and drawn, not edited", ITEM_PAGE.includes("{{#each entry as |line|}}")
    && !/name="system\.text"/.test(ITEM_PAGE), true);
}

// --- The Bomb -------------------------------------------------------------------------------------
{
  const bomb = getTrait("bomb");
  check("the Bomb is there, a Basic Item in basic/", [bomb?.kind, bomb?.owner, typeOf(bomb)],
    ["gear", "basic", "basic"]);
  check("[Tech], Craft DC Qualified", [tagsOf(bomb), bomb.craftDC], [["tech"], "Qualified"]);
  check("the entry, as printed", printedLines(bomb.text), [
    "Bomb: An explosive device that you place in a specific location.",
    "\u2013Craft DC: Qualified",
    "\u2013Details: Technology, Consumable, Device",
    "\u2013Effects: When you create this Basic Item, select a trigger:",
    "",
    "* Remote Controlled. You can trigger this Bomb using a Remote Control Basic Item.",
    "* Timed. When you place this Bomb, you can select any number of Combat Rounds. This "
      + "Bomb will trigger once that number of Combat Rounds have passed.",
    "* Proximity. After you have placed this Bomb, if any Character except the Character "
      + "that placed this Bomb moves on a Square within a Sphere AoE (centered on the Bomb), "
      + "the Bomb is triggered.",
    "",
    "A Bomb can be placed on any Square, Feature, or unoccupied Vehicle/Battle jacket by "
      + "spending 1 Action while adjacent to your chosen position to place the bomb.",
    "",
    "Once a Bomb is triggered, it uses the Basic Attack Maneuver of the Clearing (Energy) "
      + "Profile as an Out-of-Sequence Maneuver, using the Recorded Ingenuity as its Damage "
      + "Attribute for this Attacking Maneuver. A Bomb\u2019s Strike Roll for this Attacking "
      + "Maneuver will automatically succeed."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/bomb.dbu"), true);

  check("its three triggers, in the order written", triggersOf(bomb),
    ["remote", "timed", "proximity"]);
  check("named as the entry names them", triggersOf(bomb).map(t => GEAR_TRIGGERS[t].label),
    ["Remote Controlled", "Timed", "Proximity"]);
  // Timed goes off by the Round's card, Remote Controlled from the Remote Control: only
  // Proximity is set off from the Bomb's own row.
  check("only Proximity is set off from the Bomb's own row",
    Object.entries(GEAR_TRIGGERS).filter(([, t]) => t.row).map(([key]) => key), ["proximity"]);

  // Recorded off whoever makes it.
  // "The Recorded Ingenuity": the maker's Ingenuity, which is their Scholarship Modifier.
  const maker = { system: { ingenuity: 4, attributes: { scholarship: { mod: 4 }, force: { mod: 9 } } } };
  check("it records the maker's Ingenuity", recordedFrom(bomb, maker), 4);
  check("Ingenuity, not the Modifier, where the two part",
    recordedFrom(bomb, { system: { ingenuity: 2, attributes: { scholarship: { mod: 5 } } } }), 2);
  check("an Item that records nothing records nothing", recordedFrom({}, maker), null);

  const item = gearItemFrom(bomb, maker);
  check("the Item it becomes carries what going off needs", {
    records: item.system.records, recorded: item.system.recorded,
    triggers: item.system.triggers, trigger: item.system.trigger,
    placeCost: item.system.placeCost, placed: item.system.placed,
    detonation: item.system.detonation
  }, {
    records: "ingenuity", recorded: 4, triggers: ["remote", "timed", "proximity"],
    trigger: "remote", placeCost: 1, placed: false,
    detonation: { profile: "clearing", foundation: "energy", autoHit: true }
  });
  const kept = new DBUGearData(structuredClone(item.system), { strict: false }).toObject();
  check("and every one of those survives the schema",
    Object.keys(item.system).filter(key =>
      JSON.stringify(kept[key]) !== JSON.stringify(item.system[key])), []);

  // The countdown: one Round off every placed Timed one, held at zero, and due at zero.
  const timed = (countdown, placed = true, trigger = "timed") =>
    ({ id: `i${countdown}${trigger}`, system: { placed, trigger, countdown } });
  const tick = tickCountdowns([timed(3), timed(1), timed(0), timed(2, false),
    timed(2, true, "remote")]);
  check("a placed Timed one comes a Round closer",
    tick.updates, [{ _id: "i3timed", "system.countdown": 2 },
      { _id: "i1timed", "system.countdown": 0 }]);
  check("and is due once its Rounds have passed, staying due until set off",
    tick.due.map(entry => entry.id), ["i1timed", "i0timed"]);

  // Wired: counted at the start of the Round, offered on its card, set off in the placer's
  // name with the Bomb's Damage Attribute and a Strike that lands.
  const COMBAT = read("module", "combat.mjs");
  const CHAT = read("module", "chat.mjs");
  check("counted at the start of each Combat Round",
    COMBAT.slice(COMBAT.indexOf("async function startRound("), COMBAT.indexOf("await announce(\"start-of-round\""))
      .includes("tickCountdowns(actor.items.filter(item => item.type === \"gear\"))"), true);
  check("and offered on the Round's card once due",
    CHAT.includes("for (const { actor, item } of gearDue(card)) {"), true);

  const det = CHAT.slice(CHAT.indexOf("export async function detonateGear("),
    CHAT.indexOf("function gearDue("));
  check("set off as the placer's Out-of-Sequence Basic Attack",
    det.includes("return postAttack(actor, target, { ...basic, name: item.name }, {")
      && det.includes("}, { asOutOfSequence: true }).then(async card => {"), true);
  // Consumable: "A Basic Item with this Detail is destroyed once it is used" - once its attack is made.
  check("and a Consumable one is gone once its attack is made",
    det.includes("if (card && isConsumable(item, getTrait)) await item.delete();"), true);
  check("with the Bomb's Profile and Foundation, no Ki wagered",
    [det.includes("profile: detonation.profile,"),
     det.includes('foundation: detonation.foundation || "energy",'),
     det.includes("kiWager: 0,")], [true, true, true]);
  check("its recorded Modifier as the Damage Attribute, and a Strike that lands",
    [det.includes("value: item.system.recorded ?? 0"), det.includes("autoHit: detonation.autoHit")],
    [true, true]);
  check("taken out of play before the attack, so it cannot go off twice",
    det.indexOf('"system.placed": false') < det.indexOf("return postAttack("), true);
  check("and not charged for",
    /spendManeuverCost|maneuverKiCost/.test(det), false);

  // The Wound Roll swaps the Attribute and keeps what the attacker's effects add.
  check("the Wound line swaps the Attribute and keeps the rest",
    CHAT.includes("return { label: `Wound (${own.label})`, value: wound - theirs + (Number(own.value) || 0) + raised };"),
    true);
  check("and the Strike lands on the attack's own say",
    CHAT.includes("const forced = attack.autoHit"), true);
  check("both carried on the attack", [CHAT.includes("          damageAttribute,"),
    CHAT.includes("          autoHit: Boolean(autoHit),")], [true, true]);

  // Placed: an Action, a count of Rounds for a Timed one, and said at the table.
  const place = SHEET.slice(SHEET.indexOf("static async _onPlaceGear("),
    SHEET.indexOf("static async _onDetonateGear("));
  check("placing costs its Actions",
    place.includes("if (!await spendActions(this.actor, item.system.placeCost ?? 0)) return;"), true);
  check("a Timed one asks how many Rounds",
    place.includes('if (item.system.trigger === "timed") {'), true);
  check("and it is marked out, with its count",
    place.includes('await item.update({ "system.placed": true, "system.countdown": rounds });'), true);
  check("the row offers Place, then Detonate",
    [TAB.includes('data-action="placeGear"'), TAB.includes('data-action="detonateGear"')],
    [true, true]);
}

// --- Caltrops -------------------------------------------------------------------------------------
{
  const caltrops = getTrait("caltrops");
  check("Caltrops are there, a Basic Item in basic/, no tags",
    [caltrops?.kind, caltrops?.owner, typeOf(caltrops), tagsOf(caltrops)],
    ["gear", "basic", "basic", []]);
  check("Craft DC Qualified", caltrops.craftDC, "Qualified");
  check("the entry, as printed", printedLines(caltrops.text), [
    "Caltrops: A handful of spikes you scatter across the ground to prevent pursuit.",
    "\u2013Craft DC: Qualified",
    "\u2013Details: Consumable",
    "\u2013Effects: Spend 1 Action to select a Square within a Destructive Sphere AoE (centered "
      + "on you). Create a Sphere AoE centered on that Square. Any Character (except those in a High "
      + "Environment) who moves through any Square in that AoE has their Life Points reduced "
      + "by 1d4(bT). This effect does not stack if they move through multiple Squares."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/caltrops.dbu"), true);

  const item = gearItemFrom(caltrops, null);
  check("the Item carries what the ground does, and what scattering costs",
    [item.system.hazard, item.system.placeCost],
    [{ dice: "1d4", scale: "bT", sparesAirborne: true }, 1]);
  check("and neither records anything nor goes off",
    [item.system.recorded, item.system.triggers, item.system.detonation.profile],
    [null, [], ""]);
  const kept = new DBUGearData(structuredClone(item.system), { strict: false }).toObject();
  check("every key survives the schema",
    Object.keys(item.system).filter(key =>
      JSON.stringify(kept[key]) !== JSON.stringify(item.system[key])), []);

  // A d4 per base Tier of Power of whoever moves through - theirs, not the scatterer's.
  const at = baseTierOfPower => hazardFormula(item.system.hazard,
    { system: { baseTierOfPower, tierOfPower: baseTierOfPower + 4 } });
  check("a d4 per base Tier of whoever moves through", [at(1), at(3), at(6)],
    ["1d4", "3d4", "6d4"]);
  check("their base Tier, not their Tier", at(2), "2d4");
  check("and nothing to roll for an Item with no hazard", hazardFormula({}, {}), "");

  const CHAT = read("module", "chat.mjs");
  const suffer = CHAT.slice(CHAT.indexOf("export async function sufferGearHazard("),
    CHAT.indexOf("/**", CHAT.indexOf("export async function sufferGearHazard(")));
  check("nothing in a High Environment",
    suffer.includes("if (hazard.sparesAirborne && isAirborne(victim.system)) {"), true);
  check("rolled with the one who moved through, and taken off as a reduction",
    [suffer.includes("const formula = hazardFormula(hazard, victim);"),
     suffer.includes("await reduceLifePoints(victim, roll.total, { reason: hazard.itemName });")],
    [true, true]);
  check("the card is drawn from its flag, for whoever moved",
    [CHAT.includes("  renderGearHazard(message, html);"),
     CHAT.includes("const victim = canvas?.tokens?.controlled?.[0]?.actor ?? game.user.character;")],
    [true, true]);

  const scatter = SHEET.slice(SHEET.indexOf("static async _onScatterGear("),
    SHEET.indexOf("static async _onDetonateGear("));
  check("scattering costs its Action, and posts the card",
    [scatter.includes("if (!await spendActions(this.actor, item.system.placeCost ?? 0)) return;"),
     scatter.includes("const card = await postGearHazard(this.actor, item);")], [true, true]);
  // Consumable: "destroyed once it is used" - gone once scattered, the card carrying what it needs.
  check("and Caltrops, Consumable, are gone once scattered",
    [scatter.includes("if (card && isConsumable(item, getTrait)) await item.delete();"),
     gearItemFrom(getTrait("caltrops"), null).system.consumed], [true, true]);
  check("the row offers Scatter", TAB.includes('data-action="scatterGear"'), true);
  check("and the sheet has the action", SHEET.includes("scatterGear: DBUCharacterSheet._onScatterGear,"),
    true);
}

// --- Capsule ---------------------------------------------------------------------------------------
{
  const capsule = getTrait("capsule");
  check("the Capsule is there, a [Tech] Basic Item in basic/, Craft DC Qualified",
    [capsule?.owner, typeOf(capsule), tagsOf(capsule), capsule.craftDC],
    ["basic", "basic", ["tech"], "Qualified"]);
  check("the entry, as printed", printedLines(capsule.text), [
    "Capsule: An item that can hold almost anything in it, keeping it in a compact, easy to "
      + "carry device.",
    "\u2013Craft DC: Qualified",
    "\u2013Details: Technology",
    "\u2013Effects: You can store any Basic Item into a Capsule. Vehicles and Bases can also "
      + "be stored within Capsules through the Capsule Quality. You cannot store a living "
      + "thing or a Capsule within a Capsule, and can only store one thing in each Capsule "
      + "Basic Item you possess.",
    "",
    "You can spend 1 Action to throw the Capsule into an unoccupied Square within a "
      + "Destructive Sphere AoE (centered on you). If you do, and there\u2019s enough space for "
      + "the size of the item, it appears instantly in that position with its central "
      + "occupied square (if possible \u2013 any Square of your choice, if not) being the "
      + "Square you threw the Capsule to."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/capsule.dbu"), true);

  const made = gearItemFrom(capsule, null);
  check("the Item is a Capsule, empty, and throwing it costs an Action",
    [made.system.capsule, made.system.storedIn, made.system.placeCost], [true, "", 1]);
  const kept = new DBUGearData(structuredClone(made.system), { strict: false }).toObject();
  check("every key survives the schema",
    Object.keys(made.system).filter(key =>
      JSON.stringify(kept[key]) !== JSON.stringify(made.system[key])), []);
  check("and no other Item is a Capsule",
    traitsOfKind("gear").filter(entry => entry.capsule === true).map(entry => entry.id), ["capsule"]);

  // A character's Items, to put one in and take it out.
  const item = (id, extra = {}) => ({ id, type: "gear",
    system: { itemType: "basic", capsule: false, storedIn: "", ...extra } });
  const box = item("box", { capsule: true });
  const other = item("other-box", { capsule: true });
  const bomb = item("bomb");
  const ring = item("ring", { itemType: "accessory" });
  const coat = item("coat", { itemType: "apparel" });
  const inside = item("inside", { storedIn: "other-box" });
  const orphan = item("orphan", { storedIn: "gone" });
  const items = [box, other, bomb, ring, coat, inside, orphan];

  check("a Capsule takes a Basic Item or an Accessory - not Apparel, not a Capsule, not one "
    + "already inside another", storable(items, box).map(entry => entry.id),
    ["bomb", "ring", "orphan"]);
  check("what a Capsule holds is found by the mark on it",
    [heldBy(items, other)?.id ?? null, heldBy(items, box)], ["inside", null]);
  check("an Item inside a Capsule the character still has is stored",
    [isStored(items, inside), isStored(items, bomb)], [true, false]);
  check("and one marked with a Capsule that is gone is in their hands",
    isStored(items, orphan), false);

  // Wired: the row shows what it holds, Store and Throw do what they say.
  const store = SHEET.slice(SHEET.indexOf("static async _onStoreGear("),
    SHEET.indexOf("static async _onThrowGear("));
  check("Store offers what the Capsule can take, and marks the one picked",
    [store.includes("const offered = storable(items, capsule);"),
     store.includes('return item.update({ "system.storedIn": capsule.id });')], [true, true]);
  check("and not while it already holds something", store.includes('if (heldBy(items, capsule) || capsule.getFlag("dbu-ttrpg", "vehicleStored")) return;'),
    true);
  const toss = SHEET.slice(SHEET.indexOf("static async _onThrowGear("),
    SHEET.indexOf("static async _onDetonateGear("));
  check("Throw spends its Action, and lets out what it held",
    [toss.includes("if (!await spendActions(this.actor, capsule.system.placeCost ?? 0)) return;"),
     toss.includes('await held.update({ "system.storedIn": "" });')], [true, true]);
  check("an Item inside is drawn on the Capsule's row, not its own",
    SHEET.includes("if (isStored(gearItems, item) && !item.flags?.[\"dbu-ttrpg\"]?.innerRoom) continue;")
      && TAB.includes("holds {{row.heldName}}"), true);
  check("the row offers Store, then Throw",
    [TAB.includes('data-action="storeGear"'), TAB.includes('data-action="throwGear"')],
    [true, true]);
}

// --- Communicator ----------------------------------------------------------------------------------
{
  const communicator = getTrait("communicator");
  check("the Communicator is there, a [Tech] Basic Item in basic/, Craft DC Apprentice",
    [communicator?.owner, typeOf(communicator), tagsOf(communicator), communicator?.craftDC],
    ["basic", "basic", ["tech"], "Apprentice"]);
  check("the entry, as printed", printedLines(communicator?.text), [
    "Communicator [Tech]: A long-range communications device enabling real-time "
      + "communication across vast distances.",
    "\u2013Craft DC: Apprentice",
    "\u2013Details: Technology",
    "\u2013Effects: With this device, you can communicate with anyone else that has a "
      + "Communicator as long as they are within the same galaxy!",
    "",
    "Anything that treats itself as a Communicator can contact Communicators or one another "
      + "in the same way."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/communicator.dbu"), true);

  // Nothing to automate: it neither goes off, nor holds anything, nor lies on the ground.
  const made = gearItemFrom(communicator, null);
  check("an Item with nothing to do but be had",
    [made.system.triggers, made.system.detonation.profile, made.system.capsule,
     made.system.hazard.dice, made.system.placeCost, made.system.recorded],
    [[], "", false, "", 0, null]);
}

// --- Dragon Radar ----------------------------------------------------------------------------------
{
  const radar = getTrait("dragon-radar");
  check("the Dragon Radar is there, a [Tech] Basic Item in basic/, Craft DC Master",
    [radar?.owner, typeOf(radar), tagsOf(radar), radar?.craftDC],
    ["basic", "basic", ["tech"], "Master"]);
  check("the entry, as printed", printedLines(radar?.text), [
    "Dragon Radar [Tech]: A radar for finding the notorious Dragon Balls.",
    "\u2013Craft DC: Master",
    "\u2013Details: Technology",
    "\u2013Effects: A portable device that helps you locate Dragon Balls by scanning for the "
      + "electromagnetic pulse emitted by them. Notably, the radar gives a visual "
      + "representation of depth and height, but it doesn\u2019t give actual values for those "
      + "metrics. Pressing the button on the top causes the view to zoom in and show a more "
      + "detailed map of the area, helping narrow down the precise location. The radar can "
      + "locate Dragon Balls at great distances, such as across a continent, planet, or even "
      + "the universe.",
    "",
    "You gain access to the Item Search Adventure Maneuver, but you can only target a Dragon "
      + "Ball with its effects."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/dragon-radar.dbu"), true);

  // The Maneuver it grants does not exist yet, and the file says so rather than naming one
  // nothing would read.
  check("no Item Search Maneuver to grant yet",
    fs.existsSync(path.join(TRAITS, "maneuvers", "item-search.dbu")), false);
  check("and the file says what waits on it",
    // Read as prose: the comment wraps wherever the line ends, so the markers and the
    // breaks come out before the sentence is looked for.
    radar.script.split("\n").map(line => line.replace(/^#\s?/, "").trim()).join(" ")
      .includes("there is no Item Search to grant"), true);
  check("with no header pretending to grant it",
    Object.keys(radar).filter(key => /grant|maneuver/i.test(key)), []);
}

// --- Flash Bang ------------------------------------------------------------------------------------
{
  const flash = getTrait("flash-bang");
  check("the Flash Bang is there, a [Tech] Basic Item in basic/, Craft DC Qualified",
    [flash?.owner, typeOf(flash), tagsOf(flash), flash?.craftDC],
    ["basic", "basic", ["tech"], "Qualified"]);
  check("the entry, as printed", printedLines(flash?.text), [
    "Flash Bang [Tech]: A thrown weapon that blinds and deafens targets.",
    "\u2013Craft DC: Qualified",
    "\u2013Details: Technology, Consumable",
    "\u2013Effects: Spend 1 Action to target a Square within a Destructive Sphere AoE "
      + "(centered on yourself). Make a Clash (Impulsive) against all Characters within a "
      + "Sphere AoE of your targeted Square. If you win, they gain the Blinded Combat "
      + "Condition until the start of your next turn."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/flash-bang.dbu"), true);

  const made = gearItemFrom(flash, null);
  check("the Item carries its Clash, and throwing it costs an Action",
    [made.system.clash, made.system.placeCost],
    [{ save: "impulsive", roll: "", reach: "", condition: "blinded", until: "start", hold: "",
       damage: "", second: "" }, 1]);
  const kept = new DBUGearData(structuredClone(made.system), { strict: false }).toObject();
  check("every key survives the schema",
    Object.keys(made.system).filter(key =>
      JSON.stringify(kept[key]) !== JSON.stringify(made.system[key])), []);
  check("the Condition it leaves is one there is", Boolean(getTrait(made.system.clash.condition)),
    true);
  // Consumable: "destroyed once it is used" - gone once its Clashes are posted.
  check("Consumable, and gone once thrown",
    [made.system.consumed, made.system.details,
     read("module", "sheets", "actor-character-sheet.mjs").includes(
       "for (const actor of caught) await postGearClash(this.actor, actor, item);\n"
       + "    // Consumable: \"destroyed once it is used\" - the cards carry what they need, so it can go now.\n"
       + "    if (isConsumable(item, getTrait)) await item.delete();")],
    [true, ["technology", "consumable"], true]);
  const SAVES = read("module", "data", "actor-character.mjs");
  check("and the Saving Throw it Clashes with is one there is",
    /\bimpulsive: "agility"/.test(SAVES), true);

  const CHAT = read("module", "chat.mjs");
  const post = CHAT.slice(CHAT.indexOf("export async function postGearClash("),
    CHAT.indexOf("async function settleGearClash("));
  check("a Saving Throw Clash, the save named on both sides, carrying what it leaves",
    [post.includes("return postSaveClash(thrower, target, {"),
     post.includes("saves: [clash.save],"), post.includes("gearClash: leaves")], [true, true, true]);
  check("settled where every Clash's payload is",
    CHAT.includes("if (clash.gearClash && clash.result && !clash.gearClash.applied) {"), true);

  const settle = CHAT.slice(CHAT.indexOf("async function settleGearClash("),
    CHAT.indexOf("/**", CHAT.indexOf("async function settleGearClash(")));
  check("only a win leaves it", settle.includes('if (whoWonClash(clash.result) !== "challenger") {'),
    true);
  check("marked settled before anything else",
    settle.indexOf("applied: true") < settle.indexOf("await markUntilNextTurn("), true);
  check("on the thrower's clock, to the start of their next turn",
    settle.includes('const edge = (until === "end") ? "end" : "start";')
      && settle.includes("await markUntilNextTurn(thrower, target, condition, 1, edge, itemName);"),
    true);

  const toss = SHEET.slice(SHEET.indexOf("static async _onClashGear("),
    SHEET.indexOf("static async _onDetonateGear("));
  check("thrown at whoever is targeted, never the thrower",
    toss.includes(".filter(actor => actor && (actor.uuid !== this.actor.uuid));"), true);
  check("and asks for a target before anything is spent",
    toss.indexOf("if (!caught.length) {") < toss.indexOf("spendActions("), true);
  check("one Clash each",
    toss.includes("for (const actor of caught) await postGearClash(this.actor, actor, item);"), true);
  check("the row offers Throw", TAB.includes('data-action="clashGear"'), true);
}

// --- Grenade ---------------------------------------------------------------------------------------
{
  const grenade = getTrait("grenade");
  check("the Grenade is there, a [Tech] Basic Item in basic/, Craft DC Qualified",
    [grenade?.owner, typeOf(grenade), tagsOf(grenade), grenade?.craftDC],
    ["basic", "basic", ["tech"], "Qualified"]);
  check("the entry, as printed", printedLines(grenade?.text), [
    "Grenade [Tech]: A hand-held explosive that you lob at an enemy.",
    "\u2013Craft DC: Qualified",
    "\u2013Details: Technology, Consumable, Device",
    "\u2013Effects: When using the Throw Maneuver, that Attacking Maneuver has a Minor Sphere AoE "
      + "(centered on the initial target of this Maneuver) and the Damage Attribute for that "
      + "Attacking Maneuver is the Recorded Ingenuity."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/grenade.dbu"), true);

  // Recorded off its maker, the way the Bomb is - and nothing else, until there is a Throw.
  const maker = { system: { ingenuity: 3, attributes: { scholarship: { mod: 3 } } } };
  const made = gearItemFrom(grenade, maker);
  // Consumable, read off the file as well: a Grenade or Bomb given before its entry said so is used up too.
  const { isConsumable } = await import(modUrl("gear.mjs"));
  check("Consumable, off the Item or off its file",
    [isConsumable({ system: { consumed: false, gearId: "grenade" } }, getTrait),
     isConsumable({ system: { consumed: false, gearId: "bomb" } }, getTrait),
     isConsumable({ system: { consumed: false, gearId: "capsule" } }, getTrait),
     isConsumable({ system: { consumed: true, gearId: "snack" } }, getTrait)], [true, true, false, true]);
  check("it records the maker's Ingenuity, and is Consumable",
    [made.system.records, made.system.recorded, made.system.consumed, made.system.details],
    ["ingenuity", 3, true, ["technology", "consumable", "device"]]);

  // Device: "records the creator's Ingenuity at its time of creation or, if it is gained from a Gear
  // Kit, it records a value equal to the Score Limit for your starting Tier of Power".
  const { recordsOf, gearKitIngenuity } = await import(modUrl("gear.mjs"));
  check("a Device records Ingenuity with no header saying so, and nothing else does",
    [recordsOf({ details: "technology, device" }), recordsOf({ details: "technology, consumable" }),
     recordsOf({ records: "scholarship", details: "device" })], ["ingenuity", "", "scholarship"]);
  check("from a Gear Kit: the Score Limit of the starting Tier - 8, and 3 more a Tier",
    [1, 2, 3, 0].map(gearKitIngenuity), [8, 11, 14, 8]);
  const ADD = read("module", "sheets", "actor-character-sheet.mjs");
  check("asked when it is given: made by them, or from a Gear Kit with the starting Tier - not when Created",
    [ADD.includes('if ((data.system.records === "ingenuity") && !made) {'),
     ADD.includes('if (typeof kit === "object") data.system.recorded = gearKitIngenuity(kit.tier);')], [true, true]);
  check("and neither goes off by itself nor is thrown by anything here yet",
    [made.system.detonation.profile, made.system.clash.save, made.system.placeCost],
    ["", "", 0]);
  check("thrown with the Throw Maneuver, which is there",
    fs.existsSync(path.join(TRAITS, "maneuvers", "throw.dbu")), true);
  const { thrownAs } = await import(modUrl("gear.mjs"));
  const lobbed = thrownAs({ id: "g1", name: "Grenade", system: made.system }, null, getTrait);
  check("a Minor Sphere around the one it is thrown at, the recorded Modifier its Damage Attribute, "
    + "gone once thrown, and a Basic Item's Rank 1",
    [lobbed.area, lobbed.damageAttribute, lobbed.destroyed, lobbed.rank],
    [{ shape: "sphere", magnitude: "minor", centredOnTarget: true },
     { label: "Grenade, Recorded Ingenuity", value: 3 }, true, 1]);
}

// --- Longevity Supplement --------------------------------------------------------------------------
{
  const supplement = getTrait("longevity-supplement");
  check("the Longevity Supplement is there, a Basic Item in basic/, no tags, Craft DC Expert",
    [supplement?.owner, typeOf(supplement), tagsOf(supplement), supplement?.craftDC],
    ["basic", "basic", [], "Expert"]);
  check("the entry, as printed", printedLines(supplement?.text), [
    "Longevity Supplement: An aid to health, this item extends your expected lifespan.",
    "\u2013Craft DC: Expert",
    "\u2013Effects: You can spend 1 Action to consume this item. If you do, stop suffering from "
      + "the Fatigued or Stress Exhaustion Combat Conditions. You can only use this Basic Item "
      + "once per Combat Encounter."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/longevity-supplement.dbu"), true);

  const made = gearItemFrom(supplement, null);
  check("an Action to take Fatigued and Stress Exhaustion off, once an Encounter, used up",
    [made.system.placeCost, made.system.removes, made.system.oncePerEncounter,
     made.system.consumed], [1, ["fatigued", "stress-exhaustion"], true, true]);
  check("both are Conditions there are",
    made.system.removes.filter(key => !getTrait(key)), []);
  const kept = new DBUGearData(structuredClone(made.system), { strict: false }).toObject();
  check("every key survives the schema",
    Object.keys(made.system).filter(key =>
      JSON.stringify(kept[key]) !== JSON.stringify(made.system[key])), []);

  // Once an Encounter, counted with the others, keyed by the file.
  const copy = { id: "a", system: { gearId: "longevity-supplement" } };
  const other = { id: "b", system: { gearId: "longevity-supplement" } };
  check("the use is an Encounter entry", encounterUseKey(copy), "encounter:gear.longevity-supplement");
  check("a second copy is the same Item used again",
    usedThisEncounter({ system: { usedManeuvers: [encounterUseKey(copy)] } }, other), true);
  check("and nothing used is nothing used",
    usedThisEncounter({ system: { usedManeuvers: ["round:gear.longevity-supplement"] } }, copy), false);
  const COMBAT = read("module", "combat.mjs");
  check("cleared when an Encounter begins and when it ends",
    (COMBAT.match(/"system\.usedManeuvers": \[\],/g) ?? []).length, 2);

  const eat = SHEET.slice(SHEET.indexOf("static async _onConsumeGear("),
    SHEET.indexOf("static async _onDetonateGear("));
  check("refused a second time in an Encounter, before anything is spent",
    eat.indexOf("usedThisEncounter(this.actor, item)") < eat.indexOf("spendActions("), true);
  check("and not used up for nothing",
    eat.indexOf("if (!held.length) {") < eat.indexOf("spendActions("), true);
  check("takes every stack of each off",
    eat.includes("for (const key of held) await setCondition(this.actor, key, 0);"), true);
  check("records the use, and is gone",
    [eat.includes("encounterUseKey(item)"), eat.includes("if (isConsumable(item, getTrait)) await item.delete();")],
    [true, true]);
  check("the row offers Consume, or says it was used",
    [TAB.includes('data-action="consumeGear"'), TAB.includes("Used this Encounter")], [true, true]);
}

// --- Medicine --------------------------------------------------------------------------------------
{
  const medicine = getTrait("medicine");
  check("Medicine is there, a [Med] Basic Item in basic/, Craft DC Qualified",
    [medicine?.owner, typeOf(medicine), tagsOf(medicine), medicine?.craftDC],
    ["basic", "basic", ["med"], "Qualified"]);
  check("the entry, as printed", printedLines(medicine?.text), [
    "Medicine [Med]: A drug designed to treat your wounds.",
    "\u2013Craft DC: Qualified",
    "\u2013Details: Medicine, Consumable",
    "\u2013Effects: Spend an Action to consume this Basic Item and regain 2d10(bT) Life Points. "
      + "If you were suffering from the Poisoned Combat Condition, remove that Combat Condition."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/medicine.dbu"), true);

  const made = gearItemFrom(medicine, null);
  check("an Action, used up, healing 2d10(bT) and taking Poisoned off, with no Encounter limit",
    [made.system.placeCost, made.system.consumed, made.system.heal, made.system.removes,
     made.system.oncePerEncounter],
    [1, true, { dice: "2d10", scale: "bT", ki: false, full: false }, ["poisoned"], false]);
  const kept = new DBUGearData(structuredClone(made.system), { strict: false }).toObject();
  check("every key survives the schema",
    Object.keys(made.system).filter(key =>
      JSON.stringify(kept[key]) !== JSON.stringify(made.system[key])), []);

  // Two d10 per base Tier of whoever takes it.
  const at = baseTierOfPower => tierDice(made.system.heal, { system: { baseTierOfPower, tierOfPower: 9 } });
  check("two d10 per base Tier of the one who takes it", [at(1), at(3)], ["2d10", "6d10"]);
  check("the ground's dice read the same way",
    hazardFormula({ dice: "1d4", scale: "bT" }, { system: { baseTierOfPower: 3 } }), "3d4");

  const eat = SHEET.slice(SHEET.indexOf("static async _onConsumeGear("),
    SHEET.indexOf("static async _onDetonateGear("));
  check("rolled with the one who takes it",
    eat.includes("const heal = tierDice(item?.system.heal, this.actor);"), true);
  check("regained, never past the maximum",
    eat.includes("changes[`system.${pool}.value`] = Math.min(now.max, now.value + Math.max(0, roll.total) * (doubled ? 2 : 1));"),
    true);
  check("and never refused for having nothing to do, when it heals",
    eat.includes("if (!held.length && !heal && !note) {"), true);
  check("the row offers Consume for something that heals",
    SHEET.includes("consumable: ((item.system.removes ?? []).length > 0) || Boolean(item.system.heal?.dice)\n"),
    true);
}

// --- Net -------------------------------------------------------------------------------------------
{
  const net = getTrait("net");
  check("the Net is there, a Basic Item in basic/, no tags, Craft DC Expert",
    [net?.owner, typeOf(net), tagsOf(net), net?.craftDC], ["basic", "basic", [], "Expert"]);
  check("the entry, as printed", printedLines(net?.text), [
    "Net: A grid of rope created to capture and secure a target.",
    "\u2013Craft DC: Expert",
    "\u2013Details: N/A",
    "\u2013Effects: Upon creating this Item, record your Scholarship Modifier, substitute your "
      + "Might with this recorded Scholarship Modifier for any Might Clashes made through the "
      + "effects of this Basic Item or the Pinned Combat Condition inflicted through it.",
    "",
    "Spend 2 Actions to target a Character who is not at Long Range. Make a Clash (Energy "
      + "Strike/Magic Strike vs Dodge). If you win, reduce their Defense Value by 1(T) until "
      + "the end of your next turn and make a Might Clash against that same Character. If you "
      + "win, that target is Pinned."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/net.dbu"), true);

  const maker = { system: { attributes: { scholarship: { mod: 5 } } } };
  const made = gearItemFrom(net, maker);
  check("records Scholarship, costs 2 Actions, Strike with Energy or Magic, Entangled then Pinned",
    [made.system.recorded, made.system.placeCost, made.system.snare],
    [5, 2, { foundations: ["energy", "magic"], mark: "entangled", condition: "pinned" }]);
  const kept = new DBUGearData(structuredClone(made.system), { strict: false }).toObject();
  check("every key survives the schema",
    Object.keys(made.system).filter(key =>
      JSON.stringify(kept[key]) !== JSON.stringify(made.system[key])), []);
  check("the mark and the Condition are ones there are",
    [Boolean(getTrait("entangled")), Boolean(getTrait("pinned"))], [true, true]);

  const CHAT = read("module", "chat.mjs");
  const post = CHAT.slice(CHAT.indexOf("export async function postSnare("),
    CHAT.indexOf("async function settleSnare("));
  check("a Strike Clash, answered with Dodge alone",
    [post.includes('category: "strike",'), post.includes('defenderRoll: "dodge",'),
     post.includes("dodgeOnly: true,")], [true, true, true]);
  check("with the thrower's Tier and recorded Modifier taken when thrown",
    [post.includes("const tier = Math.max(1, thrower.system.tierOfPower ?? 1);"),
     post.includes("mark: snare.mark, condition: snare.condition, tier, might")], [true, true]);
  check("the Defender is not asked to choose when it is Dodge alone",
    CHAT.includes('if (clash.dodgeOnly) return { defenderRoll: "dodge" };'), true);
  check("settled where every Clash's payload is",
    CHAT.includes("if (clash.snare && clash.result && !clash.snare.applied) {"), true);

  const settle = CHAT.slice(CHAT.indexOf("async function settleSnare("),
    CHAT.indexOf("/**", CHAT.indexOf("async function settleSnare(")));
  check("only a win goes on", settle.includes('if (whoWonClash(clash.result) !== "challenger") {'),
    true);
  check("the Strike won: the thrower's Tier in stacks, to the end of their next turn",
    settle.includes('await markUntilNextTurn(thrower, target, snare.mark, snare.tier, "end", snare.itemName);'),
    true);
  check("then a Might Clash, with the recorded Modifier as the thrower's Might",
    [settle.includes("return postMightClash(thrower, target, {"),
     settle.includes("mightFor: { [thrower.uuid]: snare.might },"),
     settle.includes('snare: { ...snare, stage: "might", applied: false }')], [true, true, true]);
  check("the Might Clash won: Pinned, and a note of who and with what",
    [settle.includes("await setCondition(target, snare.condition, 1)"),
     settle.includes("[`flags.${SCOPE}.snaredBy`]: {")], [true, true]);

  // The Might Clash reads the stand-in where there is one.
  const MIGHT = CHAT.slice(CHAT.indexOf("  might: {\n    label: \"Might Clash\","),
    CHAT.indexOf("\n  },", CHAT.indexOf("  might: {\n    label: \"Might Clash\",")));
  check("a Might Clash reads the card's stand-in for the side it names",
    MIGHT.includes("const own = clash?.mightFor?.[uuid];"), true);

  // Getting free: the Pinned's own Might Clash reads the note, against the one who threw it.
  const RUNTIME = read("module", "effects", "moments-runtime.mjs");
  check("getting free Clashes with the recorded Modifier on the thrower's side",
    [RUNTIME.includes('const snared = actor.getFlag?.("dbu-ttrpg", "snaredBy");'),
     RUNTIME.includes("const netted = snared && (snared.by === against.uuid)"),
     RUNTIME.includes("{ mightFor: { [against.uuid]: snared.might },")], [true, true, true]);
  const CONDITIONS = read("module", "conditions.mjs");
  check("and the note goes when the Condition does",
    CONDITIONS.includes('await actor.unsetFlag("dbu-ttrpg", "snaredBy");'), true);

  const toss = SHEET.slice(SHEET.indexOf("static async _onSnareGear("),
    SHEET.indexOf("static async _onDetonateGear("));
  check("thrown at the one targeted, never the thrower, before anything is spent",
    [toss.includes("if (!caught || (caught.uuid === this.actor.uuid)) {"),
     toss.indexOf("if (!caught") < toss.indexOf("spendActions(")], [true, true]);
  // Anyone may throw it: the Score of 3 is the Attacking Profiles', not the Strike's.
  check("no Foundation Score asked of whoever throws it",
    /whyNotThisFoundation|FOUNDATION_RULES/.test(toss), false);
  // And nothing yet raises one Foundation's Strike, which is why the throw does not ask.
  const SLOTS = read("module", "effects", "slots.mjs");
  check("the Strike is one number: no Foundation's Strike to raise",
    /key: "strike\.(physical|energy|magic)"/.test(SLOTS), false);
  check("the row offers Throw", TAB.includes('data-action="snareGear"'), true);
}

// --- Poison Vial -----------------------------------------------------------------------------------
{
  const vial = getTrait("poison-vial");
  check("the Poison Vial is there, a Basic Item in basic/, no tags, Craft DC Expert",
    [vial?.owner, typeOf(vial), tagsOf(vial), vial?.craftDC], ["basic", "basic", [], "Expert"]);
  check("the entry, as printed", printedLines(vial?.text), [
    "Poison Vial: A vial containing a deadly poison to use against your enemies.",
    "\u2013Craft DC: Expert",
    "\u2013Effects: When you create this Basic Item, it has 1d6 Poison Drops. You may spend 1 "
      + "Action and 1 Poison Drop to Poison a Weapon. A Poisoned Weapon inflicts the Poisoned "
      + "Combat Condition to a Character if you knock them through a Health Threshold with an "
      + "Attacking Maneuver using that Weapon.",
    "",
    "A Weapon stops being Poisoned at the end of the Combat Encounter."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/poison-vial.dbu"), true);

  const made = gearItemFrom(vial, null);
  check("made with 1d6 Poison Drops, rolled when given",
    [made.system.chargesDice, made.system.chargesLabel, made.system.charges],
    ["1d6", "Poison Drops", 0]);
  const kept = new DBUGearData(structuredClone(made.system), { strict: false }).toObject();
  check("every key survives the schema",
    Object.keys(made.system).filter(key =>
      JSON.stringify(kept[key]) !== JSON.stringify(made.system[key])), []);

  const add = SHEET.slice(SHEET.indexOf("static async _onAddGear("),
    SHEET.indexOf("static async #askTrigger("));
  check("rolled when it is given, and said",
    [add.includes("const roll = await new Roll(data.system.chargesDice).evaluate();"),
     add.includes("data.system.charges = Math.max(0, roll.total);")], [true, true]);
  check("shown on its row, editable on the Item",
    [TAB.includes("{{row.charges}} {{row.chargesLabel}}"),
     ITEM_PAGE.includes('name="system.charges"')], [true, true]);

  // Weapons are built, not picked from files - see the weapons harness for the poisoning itself.
  check("no Weapon files: Weapons are built",
    fs.readdirSync(path.join(TRAITS, "gear", "weapons")).filter(f => f.endsWith(".dbu")), []);
  check("and the file says what it does to one",
    vial.script.split("\n").map(line => line.replace(/^#\s?/, "").trim()).join(" ")
      .includes("an Action and a Drop mark one of the character's Weapons Poisoned"), true);
}

// --- Remote Control --------------------------------------------------------------------------------
{
  const remote = getTrait("remote-control");
  check("the Remote Control is there, a [Tech] Basic Item in basic/, Craft DC Expert",
    [remote?.owner, typeOf(remote), tagsOf(remote), remote?.craftDC],
    ["basic", "basic", ["tech"], "Expert"]);
  check("the entry, as printed", printedLines(remote?.text), [
    "Remote Control [Tech]: A portable device capable of wireless communication with the "
      + "advanced computational systems of a Battle Jacket, allowing for remote operation.",
    "\u2013Craft DC: Expert",
    "\u2013Details: Technology",
    "\u2013Effects: Upon creating this Basic Item, select an Item (Bomb/Collar/Vehicle/Battle "
      + "Jacket) you possess for it to be connected to. This Remote Control can be used to "
      + "control that Item, allowing you to spend your Actions as if you are Piloting a "
      + "Vehicle or Battle Jacket that can be controlled with this Remote Control. For a Bomb, "
      + "you can spend 1 Action to trigger that Bomb. For a Collar Accessory, you can spend 1 "
      + "Action to trigger the effects of that Accessory.",
    "",
    "You cannot use this effect if the Vehicle or Battle Jacket has a Pilot."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/remote-control.dbu"), true);

  const made = gearItemFrom(remote, null);
  check("connects to a Bomb or a Shock Collar, not yet connected, and triggering costs an Action",
    [made.system.connects, made.system.connectedTo, made.system.placeCost],
    [["bomb", "shock-collar"], "", 1]);
  check("everything it connects to is an Item there is",
    made.system.connects.filter(id => !getTrait(id)), []);
  const kept = new DBUGearData(structuredClone(made.system), { strict: false }).toObject();
  check("every key survives the schema",
    Object.keys(made.system).filter(key =>
      JSON.stringify(kept[key]) !== JSON.stringify(made.system[key])), []);

  // A character's Items, connected and set off.
  const item = (id, gearId, extra = {}) => ({ id, system: { gearId, ...extra } });
  const control = item("rc", "remote-control", { connects: ["bomb"], connectedTo: "b1" });
  const bomb = item("b1", "bomb", { placed: true, trigger: "remote",
    detonation: { profile: "clearing" } });
  const other = item("b2", "bomb", { placed: false, trigger: "remote",
    detonation: { profile: "clearing" } });
  const rope = item("r", "caltrops");
  const items = [control, bomb, other, rope];
  check("it connects to the character's own Bombs, and nothing else",
    connectable(items, control).map(entry => entry.id), ["b1", "b2"]);
  check("what it is connected to is found by id", connectedItem(items, control)?.id, "b1");
  check("and nothing, once that Item is gone",
    connectedItem([control, rope], control), null);
  check("it triggers a placed Remote Controlled Bomb and nothing else", [
    canTrigger(bomb), canTrigger(other),
    canTrigger(item("b3", "bomb", { placed: true, trigger: "timed",
      detonation: { profile: "clearing" } })),
    canTrigger(rope), canTrigger(null)
  ], [true, false, false, false, false]);

  // Wired: connected when given, Trigger for an Action, set off in the placer's name.
  const add = SHEET.slice(SHEET.indexOf("static async _onAddGear("),
    SHEET.indexOf("static async #askTrigger("));
  check("connected when given, among the character's own, refused with nothing to connect",
    [add.includes("if (data.system.connects.length) {"), add.includes("if (!offered.length) {"),
     add.includes("data.system.connectedTo = chosen;")], [true, true, true]);
  const fire = SHEET.slice(SHEET.indexOf("static async _onRemoteGear("),
    SHEET.indexOf("static async _onDetonateGear("));
  check("a Bomb's Trigger asks for a target before the Action is spent",
    fire.indexOf("game.user.targets.first()") < fire.lastIndexOf("spendActions("), true);
  check("spends its Action, and sets off the Bomb",
    [fire.includes("if (!await spendActions(this.actor, remoteCost(remote))) return;"),
     fire.includes("return detonateGear(this.actor, bomb);")], [true, true]);
  check("the row says what it is connected to, and offers Trigger",
    [TAB.includes("&rarr; {{row.connectedName}}"), TAB.includes('data-action="remoteGear"')],
    [true, true]);
  check("the connection can be changed on the Item",
    ITEM_PAGE.includes('<select name="system.connectedTo">'), true);
}

// --- Scout Scope -----------------------------------------------------------------------------------
{
  const scope = getTrait("scout-scope");
  check("the Scout Scope is there, a [Tech] Basic Item in basic/, Craft DC Apprentice",
    [scope?.owner, typeOf(scope), tagsOf(scope), scope?.craftDC],
    ["basic", "basic", ["tech"], "Apprentice"]);
  check("the entry, as printed", printedLines(scope?.text), [
    "Scout Scope [Tech]: A handheld device capable of indicating a combatant\u2019s individual "
      + "combat strength.",
    "\u2013Craft DC: Apprentice",
    "\u2013Details: Technology",
    "\u2013Effects: You can spend 3 Actions to attempt to scan the strength of another "
      + "Character. Any Character that is using the Holding Back Maneuver or is aware of the "
      + "scanning can make a Qualified Concealment Skill Check. If they succeed, nothing "
      + "happens and they automatically succeed on any further Concealment Skill Checks to "
      + "avoid being spotted by a Scout Scope for the remainder of the Combat Encounter. If "
      + "their number of Holding Back stacks would decrease below their current number, they "
      + "lose this benefit. If they fail, you become aware of their current Tier of Power. If "
      + "their current Tier of Power is the same as their base Tier of Power, you also learn "
      + "of their Power Level.",
    "",
    "While you hold this Basic Item, you have access to the Scan Adventuring Maneuver."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/scout-scope.dbu"), true);

  const made = gearItemFrom(scope, null);
  check("3 Actions, and a Qualified Concealment Check to hide from it",
    [made.system.placeCost, made.system.scan], [3, { skill: "concealment", difficulty: "qualified",
      combatOnly: false, holdingBack: true, breaksAt: 0 }]);
  const kept = new DBUGearData(structuredClone(made.system), { strict: false }).toObject();
  check("every key survives the schema",
    Object.keys(made.system).filter(key =>
      JSON.stringify(kept[key]) !== JSON.stringify(made.system[key])), []);
  const MODEL = read("module", "data", "actor-character.mjs");
  check("Concealment is a Skill there is, and Qualified a Difficulty there is",
    [/\bconcealment:\s*\{/.test(MODEL), /\bqualified:\s*\{\s*label: "Qualified",\s*tn: 14\s*\}/.test(MODEL)],
    [true, true]);

  // Hidden, for the Encounter, while the Holding Back stacks hold.
  const who = (stacks, used = []) => ({ system: {
    resources: { holdingback: { stacks } }, usedManeuvers: used } });
  const hid = hiddenKey("scout-scope", 2);
  check("the note is an Encounter entry, with the stacks held", hid,
    "encounter:gear.scout-scope.hidden.2");
  check("still hidden while the stacks hold, or grow",
    [stillHidden(who(2, [hid]), "scout-scope"), stillHidden(who(3, [hid]), "scout-scope")],
    [true, true]);
  check("no longer once they drop below", stillHidden(who(1, [hid]), "scout-scope"), false);
  check("and never without having hidden", stillHidden(who(5, []), "scout-scope"), false);
  check("Holding Back read off its Resource", [holdingBackStacks(who(4)), holdingBackStacks({})],
    [4, 0]);

  // Read: the current Tier, and the Power Level only at the base Tier.
  check("at their base Tier, the Power Level too",
    scanReading({ system: { tierOfPower: 3, baseTierOfPower: 3, powerLevel: 14 } }),
    { tier: 3, powerLevel: 14 });
  check("above it, the Tier alone",
    scanReading({ system: { tierOfPower: 5, baseTierOfPower: 3, powerLevel: 14 } }),
    { tier: 5, powerLevel: null });

  const CHAT = read("module", "chat.mjs");
  const post = CHAT.slice(CHAT.indexOf("export async function postScan("),
    CHAT.indexOf("function renderGearScan("));
  check("a scan of someone still hidden settles itself",
    [post.includes("const hidden = stillHidden(scanned, item.system.gearId);"),
     post.includes("settled: hidden")], [true, true]);
  const settle = CHAT.slice(CHAT.indexOf("async function settleScan("),
    CHAT.indexOf("/** Post the card an Item scattered"));
  check("Hidden remembers them, with the stacks they hold now, one entry for this Item",
    [settle.includes("hiddenKey(scan.gearId, (scan.holdingBack !== false) ? holdingBackStacks(scanned) : 0)"),
     settle.includes("!used.startsWith(prefix)")], [true, true]);
  check("Read is whispered to whoever plays the scanner",
    [settle.includes("scanner.testUserPermission(user, \"OWNER\")"), settle.includes("whisper,")],
    [true, true]);
  check("the answers are for whoever plays the one scanned, and the GM",
    CHAT.includes("if (!game.user.isGM && !scanned?.isOwner) return;"), true);
  check("and a settled scan is written back so its buttons go",
    [CHAT.includes('case "scan": return applyScan(request.messageId, request.scan);'),
     settle.includes('await requestEdit(message, { type: "scan", scan: { ...scan, settled: true } });')],
    [true, true]);

  const aim = SHEET.slice(SHEET.indexOf("static async _onScanGear("),
    SHEET.indexOf("static async _onDetonateGear("));
  check("aimed at the one targeted, never the scanner, before the Actions are spent",
    [aim.includes("if (!scanned || (scanned.uuid === this.actor.uuid)) {"),
     aim.indexOf("if (!scanned") < aim.indexOf("spendActions(")], [true, true]);
  check("the row offers Scan", TAB.includes('data-action="scanGear"'), true);
}

// --- Smoke Bomb ------------------------------------------------------------------------------------
{
  const smoke = getTrait("smoke-bomb");
  check("the Smoke Bomb is there, a Basic Item in basic/, no tags, Craft DC Apprentice",
    [smoke?.owner, typeOf(smoke), tagsOf(smoke), smoke?.craftDC],
    ["basic", "basic", [], "Apprentice"]);
  check("the entry, as printed", printedLines(smoke?.text), [
    "Smoke Bomb: A mixture of black powder and chemicals set to ignite upon physical impact, "
      + "this object creates a thick black cloud of smoke when used.",
    "\u2013Craft DC: Apprentice",
    "\u2013Details: Consumable",
    "\u2013Effects: You may spend 1 Action to throw the Smoke Bomb at any Square within a "
      + "Destructive Sphere AoE (centered on you). Create a Destructive Sphere AoE centered on "
      + "your chosen Square. In this AoE, all Squares gain the Obscured Environmental Quality "
      + "until the end of your next turn."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/smoke-bomb.dbu"), true);

  const made = gearItemFrom(smoke, null);
  check("an Action, and Smoked on everyone in it to the end of the thrower's next turn",
    [made.system.placeCost, made.system.areaMark], [1, { condition: "smoked", until: "end" }]);
  const kept = new DBUGearData(structuredClone(made.system), { strict: false }).toObject();
  check("every key survives the schema",
    Object.keys(made.system).filter(key =>
      JSON.stringify(kept[key]) !== JSON.stringify(made.system[key])), []);

  // The mark stands for Obscured, the way Ignited stands for Aflame.
  const mark = getTrait("smoked");
  check("the mark is there, not a Combat Condition, naming Obscured",
    [mark?.kind, mark?.combatCondition, mark?.quality], ["conditions", false, "obscured"]);
  check("and Obscured is an Environmental Quality there is", getTrait("obscured")?.envQuality, true);
  check("in the index", INDEX.traits.includes("conditions/smoked.dbu"), true);
  const { qualitiesOf } = await import(modUrl("environments.mjs"));
  check("held, the Square is Obscured",
    qualitiesOf({ battlefield: { qualities: [] }, conditions: { smoked: 1 } }, null, getTrait),
    ["obscured"]);

  const CHAT = read("module", "chat.mjs");
  const burst = CHAT.slice(CHAT.indexOf("export async function burstGear("),
    CHAT.indexOf("/** Post the card an Item scattered"));
  check("on everyone caught, on the thrower's clock",
    burst.includes("await markUntilNextTurn(thrower, actor, mark.condition, 1, edge, item.name);"),
    true);
  const toss = SHEET.slice(SHEET.indexOf("static async _onBurstGear("),
    SHEET.indexOf("static async _onScanGear("));
  check("an Action, then everyone targeted",
    toss.indexOf("spendActions(") < toss.indexOf("game.user.targets"), true);
  check("the row offers Throw", TAB.includes('data-action="burstGear"'), true);
}

// --- Snack -----------------------------------------------------------------------------------------
{
  const snack = getTrait("snack");
  check("the Snack is there, a [Food] Basic Item in basic/, Craft DC Apprentice",
    [snack?.owner, typeOf(snack), tagsOf(snack), snack?.craftDC],
    ["basic", "basic", ["food"], "Apprentice"]);
  check("the entry, as printed", printedLines(snack?.text), [
    "Snack [Food]: A delicious and satisfying treat to keep you going when your energy is low.",
    "\u2013Craft DC: Apprentice",
    "\u2013Details: Food, Consumable",
    "\u2013Effects: You can spend 1 Action to consume this Item and regain 1d10(bT) Life and Ki "
      + "Points. Consuming a Snack will also reduce your Hunger by 1 until the end of the "
      + "Combat Encounter."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/snack.dbu"), true);

  const made = gearItemFrom(snack, null);
  check("an Action, eaten, 1d10(bT) Life and Ki, nothing taken off, no Encounter limit",
    [made.system.placeCost, made.system.consumed, made.system.heal, made.system.removes,
     made.system.oncePerEncounter],
    [1, true, { dice: "1d10", scale: "bT", ki: true, full: false }, [], false]);
  const kept = new DBUGearData(structuredClone(made.system), { strict: false }).toObject();
  check("every key survives the schema",
    Object.keys(made.system).filter(key =>
      JSON.stringify(kept[key]) !== JSON.stringify(made.system[key])), []);
  check("a d10 per base Tier of the one who eats it",
    tierDice(made.system.heal, { system: { baseTierOfPower: 4, tierOfPower: 9 } }), "4d10");

  const eat = SHEET.slice(SHEET.indexOf("static async _onConsumeGear("),
    SHEET.indexOf("static async _onDetonateGear("));
  check("Life and Ki, a roll for each",
    [eat.includes('const pools = item.system.heal.ki ? ["life", "ki"] : ["life"];'),
     eat.includes("const roll = await new Roll(heal).evaluate();")], [true, true]);

  // Hunger is not a thing here yet, and the file says so.
  check("no Hunger in this system yet",
    /hunger/i.test(read("module", "data", "actor-character.mjs")), false);
  check("and the file says what waits on it",
    snack.script.split("\n").map(line => line.replace(/^#\s?/, "").trim()).join(" ")
      .includes("There is no Hunger in this system yet"), true);
}

// --- Taser -----------------------------------------------------------------------------------------
{
  const taser = getTrait("taser");
  check("the Taser is there, a [Tech] Basic Item in basic/, Craft DC Qualified",
    [taser?.owner, typeOf(taser), tagsOf(taser), taser?.craftDC],
    ["basic", "basic", ["tech"], "Qualified"]);
  check("the entry, as printed", printedLines(taser?.text), [
    "Taser [Tech]: A handheld object that can be used to incapacitate an enemy.",
    "\u2013Craft DC: Qualified",
    "\u2013Details: Technology, Device",
    "\u2013Effects: You can spend 1 Action while you possess this Item to target a Character "
      + "within your Melee Range. Make a Clash (Strike vs Strike/Dodge). If you win, that "
      + "Character has their Life Points reduced by the Recorded Ingenuity and then you make a "
      + "Clash (Recorded Ingenuity vs Corporeal) against that character. If you win, that "
      + "Character is knocked Prone until the start of your next turn. They cannot remove the "
      + "Prone Combat Condition inflicted by a Taser until then.",
    "",
    "You can increase the Craft DC to Expert to increase your Melee Range by 3 when using this "
      + "Basic Item."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/taser.dbu"), true);

  const made = gearItemFrom(taser, null);
  check("an Action, a Strike Clash in Melee Range, Prone held by Tased to the start of your turn",
    [made.system.placeCost, made.system.clash],
    [1, { save: "", roll: "strike", reach: "melee", condition: "prone", until: "start",
          hold: "tased", damage: "recorded", second: "corporeal" }]);
  // Device: it records Ingenuity, which both steps read.
  check("a Device, recording the maker's Ingenuity",
    [made.system.details, made.system.records], [["technology", "device"], "ingenuity"]);
  const CHAT_T = read("module", "chat.mjs");
  const settleT = CHAT_T.slice(CHAT_T.indexOf("async function settleGearClash("),
    CHAT_T.indexOf("async function settleStagger("));
  check("won, the Recorded Ingenuity off their Life Points, then the second Clash for the Prone",
    [settleT.includes("await reduceLifePoints(target, recorded, { reason: `${itemName}, Recorded Ingenuity` });"),
     settleT.includes("valueFor: { [thrower.uuid]: { label: \"Recorded Ingenuity\", value: recorded } },"),
     settleT.indexOf("await reduceLifePoints(target, recorded") < settleT.indexOf("await markUntilNextTurn(thrower, target, condition")],
    [true, true, true]);
  check("the second Clash rolls the Recorded Ingenuity for its challenger",
    CHAT_T.includes("const own = clash?.valueFor?.[uuid];\n      if (own) return { label: own.label, value: Number(own.value) || 0 };"),
    true);
  check("and the Expert Taser, not chosen until it is",
    made.system.upgrade, { craftDC: "Expert", reach: 3, chosen: false });
  const kept = new DBUGearData(structuredClone(made.system), { strict: false }).toObject();
  check("every key survives the schema",
    Object.keys(made.system).filter(key =>
      JSON.stringify(kept[key]) !== JSON.stringify(made.system[key])), []);

  // Tased holds Prone: removals refused while it is held, and only then.
  const mark = getTrait("tased");
  check("the mark is there, not a Combat Condition, holding Prone",
    [mark?.kind, mark?.combatCondition, mark?.holds], ["conditions", false, "prone"]);
  check("in the index", INDEX.traits.includes("conditions/tased.dbu"), true);
  const CONDITIONS = read("module", "conditions.mjs");
  const held = CONDITIONS.slice(CONDITIONS.indexOf("function heldInPlace("),
    CONDITIONS.indexOf("export async function setCondition("));
  check("a removal is refused while a mark holding it is held",
    [held.includes("const holding = getTrait(mark);"), held.includes("if (holds.includes(key) && !(floor && (wanted >= floor))) {")],
    [true, true]);
  check("and no mark or Condition is named where it is refused",
    /"tased"|"prone"/.test(held), false);

  // The hold before the Condition, on the same clock, so it runs out first.
  const CHAT = read("module", "chat.mjs");
  const settle = CHAT.slice(CHAT.indexOf("async function settleGearClash("),
    CHAT.indexOf("/**", CHAT.indexOf("async function settleGearClash(")));
  check("the hold goes on before the Condition, on the same clock",
    settle.indexOf("clash.gearClash.hold, 1, edge, itemName") > 0
      && settle.indexOf("clash.gearClash.hold, 1, edge, itemName")
        < settle.indexOf("await markUntilNextTurn(thrower, target, condition, 1, edge, itemName);"),
    true);
  const post = CHAT.slice(CHAT.indexOf("export async function postGearClash("),
    CHAT.indexOf("async function settleGearClash("));
  check("a Strike Clash, the Defender choosing Strike or Dodge",
    [post.includes('if (clash.roll === "strike") {'), post.includes('clashLabel: "Clash (Strike vs Strike/Dodge)",'),
     post.includes('defenderRoll: "",'), /dodgeOnly/.test(post)], [true, true, true, false]);

  // One character, within Melee Range - further with the Expert Taser.
  const use = SHEET.slice(SHEET.indexOf("static async _onClashGear("),
    SHEET.indexOf("static async _onConsumeGear("));
  check("a Strike is at one character, a Saving Throw Clash at everyone caught",
    use.includes("const caught = clash.roll ? targeted.slice(0, 1) : targeted;"), true);
  check("measured against Melee Range, with the Expert reach on top, before the Action",
    [use.includes('if (clash.reach === "melee") {'),
     use.includes("const extra = item.system.upgrade?.chosen ? (item.system.upgrade.reach ?? 0) : 0;"),
     use.indexOf("whyNotWithinMelee(") < use.indexOf("spendActions(")], [true, true, true]);
  const MANEUVERS = read("module", "maneuvers.mjs");
  check("Melee Range takes what the thing being used adds",
    MANEUVERS.includes("const reach = Math.max(0, (actor.system.meleeRange ?? 0) + (Number(extra) || 0), ally ? guidanceRangeGap(actor) : 0);"),
    true);
  check("the Expert Taser is chosen on the Item, and its Craft DC shown",
    [ITEM_PAGE.includes('name="system.upgrade.chosen"'), ITEM_PAGE.includes("Craft DC: {{craftDCNow}}")],
    [true, true]);
}

// --- Torch -----------------------------------------------------------------------------------------
{
  const torch = getTrait("torch");
  check("the Torch is there, a Basic Item in basic/, no tags, Craft DC Novice",
    [torch?.owner, typeOf(torch), tagsOf(torch), torch?.craftDC], ["basic", "basic", [], "Novice"]);
  check("the entry, as printed", printedLines(torch?.text), [
    "Torch: A handheld light source you can carry with you.",
    "\u2013Craft DC: Novice",
    "\u2013Details: N/A",
    "\u2013Effects: You can spend 1 Action to turn on a Torch. While you are holding a Torch, you "
      + "are a Light Source. Increase the Light Level of all Squares within a Sphere AoE "
      + "(centered on you) by 1 Level."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/torch.dbu"), true);

  const made = gearItemFrom(torch, null);
  check("an Action to light, Torchlit while it burns, not lit yet",
    [made.system.placeCost, made.system.lightMark, made.system.lit], [1, "torchlit", false]);
  const kept = new DBUGearData(structuredClone(made.system), { strict: false }).toObject();
  check("every key survives the schema",
    Object.keys(made.system).filter(key =>
      JSON.stringify(kept[key]) !== JSON.stringify(made.system[key])), []);

  const mark = getTrait("torchlit");
  check("the mark is there, not a Combat Condition, a Level up, stacking per Torch",
    [mark?.kind, mark?.combatCondition, Number(mark?.lightShift), Number(mark?.maxStacks) > 1],
    ["conditions", false, 1, true]);
  check("in the index", INDEX.traits.includes("conditions/torchlit.dbu"), true);
  const { lightLevelOf } = await import(modUrl("light.mjs"));
  const at = (set, torchlit) => lightLevelOf(
    { battlefield: { lightLevel: set }, conditions: { torchlit } }, getTrait);
  check("a lit Torch is a Level up, two are two, never past Blinding",
    [at(-1, 1), at(-2, 2), at(1, 3)], [0, 0, 2]);

  const light = SHEET.slice(SHEET.indexOf("static async _onLightGear("),
    SHEET.indexOf("static async _onBurstGear("));
  check("lighting costs the Action and gives the mark; putting it out is free",
    [light.indexOf("if (item.system.lit) return DBUCharacterSheet.#putOut(this.actor, item);")
      < light.indexOf("spendActions("),
     light.includes("await gainCondition(this.actor, item.system.lightMark, 1)")], [true, true]);
  check("put out takes one stack off, the Torch's own",
    light.includes("if (held > 0) await setCondition(actor, item.system.lightMark, held - 1);"), true);
  check("stored in a Capsule, or taken off the character, it goes out",
    [SHEET.includes("    if (item.system.lit) await DBUCharacterSheet.#putOut(this.actor, item);\n    return item.update({ \"system.storedIn\": capsule.id });"),
     SHEET.includes("if (item?.system?.lit) await DBUCharacterSheet.#putOut(this.actor, item);")],
    [true, true]);
  check("the row offers Light, then Put out",
    TAB.includes("{{#if row.lit}}Put out{{else}}Light{{/if}}"), true);
}

// --- Bag of Senzu Beans ----------------------------------------------------------------------------
{
  const bag = getTrait("bag-of-senzu-beans");
  check("the Bag is there, a Special Basic Item in basic/, with no Craft DC",
    [bag?.owner, typeOf(bag), bag?.special, bag?.craftDC ?? ""], ["basic", "basic", true, ""]);
  check("the entry, as printed", printedLines(bag?.text), [
    "Bag of Senzu Beans: A bag containing the miraculous Senzu Beans.",
    "\u2013Details: N/A",
    "\u2013Effects: You can spend 1 Action to consume a Senzu Bean or feed it to an adjacent, "
      + "Defeated Character. Consuming a Senzu Bean removes all Combat Conditions (except Pinned "
      + "or Suffocating) and you fully regain your Life and Ki Points, up to their maximum.",
    "",
    "Bags of Senzu Beans come in various sizes:",
    "",
    "* Small. Roll a 1d4, that\u2019s how many Senzu Beans are in the bag.",
    "* Standard. Roll a 1d6, that\u2019s how many Senzu Beans are in the bag.",
    "* Large. Roll a solid 1d10, that\u2019s how many Senzu Beans are in the bag.",
    "* Extra Large. Roll a 2d6, that\u2019s how many Senzu Beans are in the bag."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/bag-of-senzu-beans.dbu"), true);
  check("the only Special Basic Item with a Craft DC is none",
    traitsOfKind("gear").filter(entry => entry.special === true && entry.craftDC).map(e => e.id), []);

  const made = gearItemFrom(bag, null);
  check("four sizes, each with its dice", made.system.sizes, [
    { label: "Small", dice: "1d4" }, { label: "Standard", dice: "1d6" },
    { label: "Large", dice: "1d10" }, { label: "Extra Large", dice: "2d6" }
  ]);
  check("a full restore, keeping Pinned and Suffocating, that may be fed to the Defeated",
    [made.system.special, made.system.restore, made.system.chargesLabel, made.system.placeCost],
    [true, { full: true, keeps: ["pinned", "suffocating"], feedsDefeated: true }, "Senzu Beans", 1]);
  const kept = new DBUGearData(structuredClone(made.system), { strict: false }).toObject();
  check("every key survives the schema",
    Object.keys(made.system).filter(key =>
      JSON.stringify(kept[key]) !== JSON.stringify(made.system[key])), []);
  check("a size written wrong is left out",
    sizesOf({ sizes: "Small=1d4, Huge, Big=lots" }), [{ label: "Small", dice: "1d4" }]);

  // Every Combat Condition held comes off, but those it keeps; marks are not Combat Conditions.
  const defs = [
    { key: "prone", combatCondition: true }, { key: "pinned", combatCondition: true },
    { key: "poisoned", combatCondition: true }, { key: "soaring", combatCondition: false },
    { key: "suffocating", combatCondition: true }
  ];
  check("every Combat Condition held, but Pinned and Suffocating, and no mark", conditionsRestored(
    { prone: 1, pinned: 1, poisoned: 2, soaring: 1, suffocating: 1, broken: 0 }, defs,
    ["pinned", "suffocating"]), ["prone", "poisoned"]);
  check("both files it keeps are Conditions there are",
    made.system.restore.keeps.filter(key => !getTrait(key)), []);

  const CHAT = read("module", "chat.mjs");
  const full = CHAT.slice(CHAT.indexOf("export async function restoreFully("),
    CHAT.indexOf("/** Post the card an Item scattered"));
  check("Life and Ki set to their maximum",
    full.includes('"system.life.value": who.system.life.max,')
      && full.includes('"system.ki.value": who.system.ki.max'), true);
  check("the Combat Conditions off, but those kept",
    full.includes("const cleared = conditionsRestored(who.system.conditions, allConditions(),"), true);

  const eat = SHEET.slice(SHEET.indexOf("static async _onRestoreGear("),
    SHEET.indexOf("static async _onLightGear("));
  check("fed only to someone Defeated, beside you, checked before the Action",
    [eat.includes("if (!who.system.defeated) {"), eat.includes("if ((apart !== null) && (apart > 0)) {"),
     eat.indexOf("who.system.defeated") < eat.indexOf("spendActions(")], [true, true, true]);
  check("a Bean taken for each",
    eat.includes('await item.update({ "system.charges": Math.max(0, (item.system.charges ?? 0) - 1) });'),
    true);
  check("the row offers Eat and Feed while there are Beans",
    [TAB.includes('data-action="restoreGear"'), TAB.includes('data-feed="1"'),
     SHEET.includes("restores: Boolean(item.system.restore?.full) && ((item.system.charges ?? 0) > 0),")],
    [true, true, true]);
  const add = SHEET.slice(SHEET.indexOf("static async _onAddGear("),
    SHEET.indexOf("static async #askTrigger("));
  check("its size asked when given, and its dice are what is rolled",
    [add.includes("const size = await DBUCharacterSheet.#askSize(definition.name, data.system.sizes);"),
     add.includes("data.system.chargesDice = size.dice;")], [true, true]);
}

// --- Dragon Ball -----------------------------------------------------------------------------------
{
  const ball = getTrait("dragon-ball");
  check("the Dragon Ball is there, a Special Basic Item in basic/, no Craft DC",
    [ball?.owner, typeOf(ball), ball?.special, ball?.craftDC ?? ""], ["basic", "basic", true, ""]);
  check("the entry, as printed", printedLines(ball?.text), [
    "Dragon Ball: One of the magic dragon balls. You can find them all.",
    "\u2013Effects: Dragon Balls come in sets of 2~7 balls. Once you gather all of them, you may "
      + "spend all the Actions in your turn (minimum 3) to summon an Eternal Dragon in a Combat "
      + "Encounter."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/dragon-ball.dbu"), true);

  const made = gearItemFrom(ball, null);
  check("a set of 2 to 7, not chosen yet, and three Actions at least to summon",
    made.system.set, { min: 2, max: 7, size: 0, number: 0, actionsMin: 3 });
  const kept = new DBUGearData(structuredClone(made.system), { strict: false }).toObject();
  check("every key survives the schema",
    Object.keys(made.system).filter(key =>
      JSON.stringify(kept[key]) !== JSON.stringify(made.system[key])), []);

  // Gathered: every number of the set, from the same file, in a set of the same size.
  const one = (id, number, size = 3, gearId = "dragon-ball") =>
    ({ id, system: { gearId, set: { size, number } } });
  const a = one("a", 1), b = one("b", 2), c = one("c", 3);
  check("every ball of a set of three is gathered", setGathered([a, b, c], a), true);
  check("two of three are not", setGathered([a, b], a), false);
  check("a second copy of one ball is not the missing one", setGathered([a, b, one("d", 2)], a),
    false);
  check("a ball from a set of another size does not count",
    setGathered([a, b, one("e", 3, 7)], a), false);
  check("nor does an Item from another file",
    setGathered([a, b, one("f", 3, 3, "other")], a), false);
  check("and an Item in no set is never gathered", setGathered([one("g", 0, 0)], one("g", 0, 0)),
    false);

  const call = SHEET.slice(SHEET.indexOf("static async _onSummonGear("),
    SHEET.indexOf("static async _onLightGear("));
  check("only with the set gathered", call.includes("if (!item || !setGathered(gear, item)) return;"),
    true);
  check("in an Encounter, every Action left, and three at least",
    [call.includes("if (left < least) {"), call.includes("if (!await spendActions(this.actor, left)) return;")],
    [true, true]);
  check("outside one, no Actions counted", call.includes("if (game.combat?.started) {"), true);
  const add = SHEET.slice(SHEET.indexOf("static async _onAddGear("),
    SHEET.indexOf("static async #askTrigger("));
  check("its set asked when given, and the ball named for its number",
    [add.includes("const set = await DBUCharacterSheet.#askSet(definition.name, data.system.set);"),
     add.includes("data.name = `${definition.name} (${set.number}-Star)`;")], [true, true]);
  check("the ball held to its set",
    SHEET.includes("const number = Math.min(size, Math.max(1, chosen.number || 1));"), true);
  check("Summon offered on the first of a gathered set",
    SHEET.includes("summons: Boolean(item.system.set?.size) && (item.system.set.number === 1)")
      && TAB.includes('data-action="summonGear"'), true);
}

// --- Energy-Suction Device -------------------------------------------------------------------------
{
  const device = getTrait("energy-suction-device");
  check("the Device is there, a Special Basic Item in basic/, no Craft DC",
    [device?.owner, typeOf(device), device?.special, device?.craftDC ?? ""],
    ["basic", "basic", true, ""]);
  check("the entry, as printed", printedLines(device?.text), [
    "Energy-Suction Device: An item for gathering and storing energy, the utility of this item "
      + "cannot be underestimated.",
    "\u2013Details: N/A",
    "\u2013Effects: While you possess this Item, gain access to the Power Drain Special "
      + "Maneuver, but you may use its effects even if you are not in a Grapple. If you do, you "
      + "must win a Clash (Physical Strike vs Strike/Dodge) against your target before using "
      + "the effects of the Power Drain Special Maneuver. You do not regain any Ki Points from "
      + "the Power Drain Special Maneuver used through this Item, however, but they are instead "
      + "stored inside the Energy-Suction Device. You can spend 1 Action to regain any number "
      + "of Ki Points that are stored in the Energy-Suction Device or, when making an Unarmed "
      + "Energy or Magic Attacking Maneuver, you may instead spend the Ki Points stored in the "
      + "Energy-Suction Device."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/energy-suction-device.dbu"), true);

  const made = gearItemFrom(device, null);
  check("Power Drain anywhere, stored Ki, drawn for an Action, paying Energy and Magic attacks",
    [made.system.grantsManeuver, made.system.drainsAnywhere, made.system.storesDrain,
     made.system.chargesLabel, made.system.charges, made.system.placeCost, made.system.paysAttacks],
    ["power-drain", true, true, "Stored Ki", 0, 1, ["energy", "magic"]]);
  check("and Power Drain is a Special Maneuver there is",
    fs.existsSync(path.join(TRAITS, "maneuvers", "power-drain.dbu")), true);
  const kept = new DBUGearData(structuredClone(made.system), { strict: false }).toObject();
  check("every key survives the schema",
    Object.keys(made.system).filter(key =>
      JSON.stringify(kept[key]) !== JSON.stringify(made.system[key])), []);

  // Holding it opens Power Drain; not holding it, nothing does - unless something else did.
  const item = { type: "gear", system: { ...made.system, charges: 12 } };
  const { whyNotSpecial, whyNotDrain, openedWithoutGear } = await import(modUrl("maneuvers.mjs"));
  const drain = { id: "power-drain", name: "Power Drain", special: true, powerDrain: true };
  const who = (items, extra = {}) => ({ name: "Tester", items,
    system: { effects: { slots: {} }, specialManeuvers: [], grapple: {}, ...extra } });
  check("holding it opens Power Drain", whyNotSpecial(who([item]), drain), null);
  check("without it, Power Drain is not open", typeof whyNotSpecial(who([]), drain), "string");
  check("and the Device is not counted as having it already", openedWithoutGear(who([item]), drain),
    false);
  check("the Skill Ranks that open it still do",
    openedWithoutGear(who([], { specialManeuvers: [{ maneuver: "power-drain", open: true }] }), drain),
    true);
  check("with it, Power Drain is not refused for want of a Grapple",
    whyNotDrain(who([item]), drain), null);
  check("without it, it still is", typeof whyNotDrain(who([]), drain), "string");

  // The store, and what it pays for.
  check("the Item that stores it, and the Item that grants it",
    [drainStore([{ type: "gear", system: { storesDrain: false } }, item]) === item,
     gearGranting([item], "power-drain") === item], [true, true]);
  check("an Energy or Magic attack whose whole price is stored, and nothing less",
    [canPayAttack(item, "energy", 12), canPayAttack(item, "magic", 5),
     canPayAttack(item, "physical", 5), canPayAttack(item, "energy", 13), canPayAttack(item, "energy", 0)],
    [true, true, false, false, false]);

  const USE = read("module", "use-maneuver.mjs");
  const CHAT = read("module", "chat.mjs");
  check("without a Grapple: at the one targeted, the Actions paid, and the Clash",
    [USE.includes("if (!holding) {"), USE.includes("await postDrainClash(actor, aimed, maneuver, actionsSpent, store);")],
    [true, true]);
  const destination = USE.slice(USE.indexOf("async function drainDestination("),
    USE.indexOf("export async function payFromStore("));
  check("from a Grapple: into the Device when it is what gives Power Drain, a choice if not",
    [destination.includes("if (!openedWithoutGear(actor, maneuver)) return store;"),
     destination.includes('{ action: "store", label: store.name },')], [true, true]);
  const from = USE.slice(USE.indexOf("export async function drainFrom("),
    USE.indexOf("/**", USE.indexOf("export async function drainFrom(")));
  check("into the Device, the Ki is stored and not regained",
    from.indexOf('await into.update({ "system.charges": (Number(into.system.charges) || 0) + lost });')
      < from.indexOf('"system.ki.value": value + regained'), true);
  const settle = CHAT.slice(CHAT.indexOf("async function settleDrain("),
    CHAT.indexOf("/**", CHAT.indexOf("async function settleDrain(")));
  check("the Clash won drains into the Device; lost, nothing",
    [settle.includes('if (whoWonClash(clash.result) !== "challenger") {'),
     settle.includes("return drainFrom(actor, target, maneuver, clash.drain.actions, store);")],
    [true, true]);
  check("a Physical Strike against Strike or Dodge",
    CHAT.includes('clashLabel: "Clash (Physical Strike vs Strike/Dodge)",'), true);

  const pay = USE.slice(USE.indexOf("export async function payFromStore("),
    USE.indexOf("export async function drainFrom("));
  check("paying from it takes the whole price from the Device",
    pay.includes('await store.update({ "system.charges": (Number(store.system.charges) || 0) - price });'),
    true);
  check("and off the character's Capacity: their own Ki is not spent",
    USE.includes("if (!fromStore && !await spendManeuverCost(actor, maneuver, moving.fromSelf)) return false;")
      && CHAT.includes("if (price && !fromStore && !await spendManeuverCost(actor, maneuver, price)) return;"),
    true);

  const pull = SHEET.slice(SHEET.indexOf("static async _onDrawGear("),
    SHEET.indexOf("static async _onLightGear("));
  check("drawn for an Action, up to the room there is, the rest left in it",
    [pull.includes("const most = Math.min(stored, room);"),
     pull.includes('await item.update({ "system.charges": stored - amount });')], [true, true]);
  check("the row shows the stored Ki and offers Draw",
    [TAB.includes('data-action="drawGear"'),
     SHEET.includes("draws: Boolean(item.system.storesDrain) && ((item.system.charges ?? 0) > 0),")],
    [true, true]);
}

// --- Medibugs --------------------------------------------------------------------------------------
{
  const bugs = getTrait("medibugs");
  check("the Medibugs are there, a Special Basic Item in basic/, no Craft DC",
    [bugs?.owner, typeOf(bugs), bugs?.special, bugs?.craftDC ?? ""], ["basic", "basic", true, ""]);
  check("the entry, as printed", printedLines(bugs?.text), [
    "Medibugs: These bugs have medicinal properties when consumed. Slimy, but satisfying.",
    "\u2013Details: Consumable",
    "\u2013Effects: Upon gaining this Basic Item, select up to 1d6 Medibugs from the categories "
      + "below. You gain those Medibugs. You can spend 1 Action to consume a Medibug and apply "
      + "the benefits listed:",
    "",
    "* Revive Bug. Regain Life Points and Ki Points up to their maximums.",
    "* Achichi Bug. Remove any stacks of Damage Over Time and/or the Broken Combat Condition.",
    "* Zutsu Bug. Remove the Impaired and/or the Impediment Combat Conditions.",
    "* Beaut Bug. Increase your Persuasion Skill Checks by 2 for an hour."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/medibugs.dbu"), true);
  check("Consumable", [gearItemFrom(bugs, null).system.details, (await import(modUrl("gear.mjs"))).isConsumable(gearItemFrom(bugs, null), getTrait)],
    [["consumable"], true]);
  {
    const SHEET_M = read("module", "sheets", "actor-character-sheet.mjs");
    check("the Item goes with its last bug",
      SHEET_M.includes("const gone = isConsumable(item, getTrait) && left.every(entry => !(entry.count > 0));"),
      true);
  }

  const made = gearItemFrom(bugs, null);
  check("1d6, shared among four kinds, an Action each",
    [made.system.portionsDice, made.system.portions.map(p => p.key), made.system.placeCost],
    ["1d6", ["revive", "achichi", "zutsu", "beaut"], 1]);
  check("each kind named, with what it does", made.system.portions.map(p =>
    [p.label, p.full, p.dot, p.removes, p.gains]), [
    ["Revive Bug", true, false, [], ""],
    ["Achichi Bug", false, true, ["broken"], ""],
    ["Zutsu Bug", false, false, ["impaired", "impediment"], ""],
    ["Beaut Bug", false, false, [], "beautified"]
  ]);
  check("every Condition and mark they name is one there is",
    made.system.portions.flatMap(p => [...p.removes, ...(p.gains ? [p.gains] : [])])
      .filter(key => !getTrait(key)), []);
  const kept = new DBUGearData(structuredClone(made.system), { strict: false }).toObject();
  check("every key survives the schema",
    Object.keys(made.system).filter(key =>
      JSON.stringify(kept[key]) !== JSON.stringify(made.system[key])), []);

  // What eating each one writes.
  const system = { life: { value: 3, max: 40 }, ki: { value: 1, max: 30 }, dotStacks: 4,
    timed: [{ kind: "dot", key: "dot" }, { kind: "condition", key: "prone" }],
    conditions: { broken: 2, impaired: 1, impediment: 0 } };
  const [revive, achichi, zutsu, beaut] = made.system.portions;
  check("Revive: Life and Ki to their maximum", portionEffects(revive, system).update,
    { "system.life.value": 40, "system.ki.value": 30 });
  check("Achichi: every stack of Damage Over Time and its clocks, and Broken",
    [portionEffects(achichi, system).update, portionEffects(achichi, system).removes],
    [{ "system.dotStacks": 0, "system.timed": [{ kind: "condition", key: "prone" }] }, ["broken"]]);
  check("Zutsu: Impaired and Impediment, the ones held",
    portionEffects(zutsu, system).removes, ["impaired"]);
  check("Beaut: the mark", portionEffects(beaut, system).gains, "beautified");

  const add = SHEET.slice(SHEET.indexOf("static async _onAddGear("),
    SHEET.indexOf("static async #askTrigger("));
  check("rolled when given, and shared out", add.includes(
    "const counts = await DBUCharacterSheet.#askPortions(definition.name, data.system.portions,"),
    true);
  check("never more than the roll",
    SHEET.includes("const kept = Math.min(count, left);"), true);
  const eat = SHEET.slice(SHEET.indexOf("static async _onEatPortion("),
    SHEET.indexOf("static async _onEndMark("));
  check("an Action, the effects, and one fewer of that kind",
    [eat.includes("spendActions(this.actor, item.system.placeCost ?? 0)"),
     eat.includes("(i === index) ? { ...entry, count: entry.count - 1 } : entry")], [true, true]);
  check("a button for each kind left, and a mark ended by hand",
    [TAB.includes('data-action="eatPortion"'),
     read("templates", "parts", "actor-combat.hbs").includes('data-action="endMark"')], [true, true]);
  check("only a mark that says it is ended by hand",
    SHEET.includes("if (getTrait(key)?.endedByHand !== true) return;"), true);
}

// --- Saibamen Capsule ------------------------------------------------------------------------------
{
  const capsule = getTrait("saibamen-capsule");
  check("the Saibamen Capsule is there, a Special Basic Item in basic/, no Craft DC",
    [capsule?.owner, typeOf(capsule), capsule?.special, capsule?.craftDC ?? ""],
    ["basic", "basic", true, ""]);
  check("the entry, as printed", printedLines(capsule?.text), [
    "Saibamen Capsule: A container for seeds, these alien plants grow quickly into "
      + "semi-intelligent creatures capable of following basic instructions.",
    "\u2013Details: N/A",
    "\u2013Effects: When you first gain this Basic Item, roll a 1d8. The Dice Score is the "
      + "amount of Saibamen you possess. You can spend 1 Action to plant a Saibamen Seed. At the "
      + "start of the next Combat Round, all Saibamen Seeds planted during this Combat Round "
      + "will sprout on any Square within 2 Squares of you (you decide) and turn into a number "
      + "of Saibamen equal to the number of seeds planted.",
    "",
    "Saibamen are Minions made through the Minion Creation Rules and must select Saibamen as "
      + "their race."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/saibamen-capsule.dbu"), true);

  // The roll, and nothing else: planting and the Saibamen are done by hand.
  const made = gearItemFrom(capsule, null);
  check("1d8 Saibamen, rolled when given",
    [made.system.chargesDice, made.system.chargesLabel, made.system.charges], ["1d8", "Saibamen", 0]);
  check("and nothing that plants, sprouts or builds a Minion",
    [made.system.placeCost, made.system.clash.save, made.system.portions, made.system.restore.full],
    [0, "", [], false]);
}

// --- Teleport Remote -------------------------------------------------------------------------------
{
  const remote = getTrait("teleport-remote");
  check("the Teleport Remote is there, a Special Basic Item in basic/, no Craft DC",
    [remote?.owner, typeOf(remote), remote?.special, remote?.craftDC ?? ""],
    ["basic", "basic", true, ""]);
  check("the entry, as printed", printedLines(remote?.text), [
    "Teleport Remote: Via this magical device, you are able to teleport yourself directly to a "
      + "specific person, or teleport that person to you.",
    "\u2013Effects: Upon gaining this Special Item, a Character is assigned with this. By "
      + "spending 1 Action, you may either move to a Square of your choice adjacent to that "
      + "Character, or move that Character to a Square of your choice adjacent to you."
  ]);
  check("in the index", INDEX.traits.includes("gear/basic/teleport-remote.dbu"), true);

  const made = gearItemFrom(remote, null);
  check("tied to a Character not yet picked, an Action to teleport",
    [made.system.assignsCharacter, made.system.assigned, made.system.teleports, made.system.placeCost],
    [true, { uuid: "", name: "" }, true, 1]);
  const kept = new DBUGearData(structuredClone(made.system), { strict: false }).toObject();
  check("every key survives the schema",
    Object.keys(made.system).filter(key =>
      JSON.stringify(kept[key]) !== JSON.stringify(made.system[key])), []);

  const add = SHEET.slice(SHEET.indexOf("static async _onAddGear("),
    SHEET.indexOf("static async #askTrigger("));
  check("the Character picked when given, never the holder",
    [add.includes("const chosen = await DBUCharacterSheet.#askCharacter(definition.name, this.actor);"),
     SHEET.includes("&& (actor.uuid !== holder.uuid));")], [true, true]);
  const port = SHEET.slice(SHEET.indexOf("static async _onTeleportGear("),
    SHEET.indexOf("static async _onEndMark("));
  check("which way asked before the Action, and nothing moved",
    [port.indexOf('{ action: "bring"') < port.indexOf("spendActions("),
     /\.update\(\{[^}]*"x"|setPosition|token\.update|\.move\(/.test(port)], [true, false]);
  check("Teleport offered only once someone is assigned",
    SHEET.includes("teleports: Boolean(item.system.teleports) && Boolean(item.system.assigned?.uuid),"),
    true);
  check("the assigned Character can be changed on the Item, their name kept with them",
    [ITEM_PAGE.includes('<select name="system.assigned.uuid">'),
     ITEM_SHEET.includes('for (const field of ["assigned", "intended"]) {')
       && ITEM_SHEET.includes("foundry.utils.setProperty(submitData, `system.${field}.name`,")],
    [true, true]);
}

// --- Accessories: worn, two at most, never two of the same ---------------------------------------
{
  const accessory = (id, gearId, equipped = false, extra = {}) =>
    ({ id, name: `${gearId} ${id}`, type: "gear",
       system: { itemType: "accessory", gearId, equipped, ...extra } });
  const basic = { id: "b", name: "Bomb", type: "gear", system: { itemType: "basic", gearId: "bomb" } };

  check("two worn at most, an Action to put one on or take it off",
    [ACCESSORIES_WORN, EQUIP_COST], [2, 1]);
  check("an Accessory is one; a Basic Item is not",
    [isAccessory(accessory("a", "collar")), isAccessory(basic)], [true, false]);

  const a = accessory("a", "ring", true);
  const b = accessory("b", "cape", true);
  const c = accessory("c", "belt");
  const twin = accessory("t", "ring");
  check("a third refused while two are worn",
    equipProblem([a, b, c], c) !== "", true);
  check("a second of the same refused, whatever it is called",
    equipProblem([a, twin, c], twin) !== "", true);
  check("a different one allowed beside one worn", equipProblem([a, twin, c], c), "");
  check("one already worn can always come off", equipProblem([a, b, c], a), "");
  check("a Basic Item is not put on", equipProblem([basic], basic) !== "", true);
  const capsule = { id: "k", name: "Capsule", type: "gear",
    system: { itemType: "basic", gearId: "capsule", capsule: true } };
  const inside = accessory("i", "hat", false, { storedIn: "k" });
  check("one inside a Capsule is not to hand",
    [isStored([capsule, inside], inside), equipProblem([capsule, inside], inside) !== ""],
    [true, true]);
  check("and one being worn is not put in a Capsule",
    storable([capsule, a, c], capsule).map(item => item.id), ["c"]);

  check("worn ones listed", wornAccessories([a, b, c, basic]).map(item => item.id), ["a", "b"]);
  check("effects from the worn ones, one of each",
    accessoriesInEffect([a, accessory("a2", "ring", true), b, c]).map(item => item.id),
    ["a", "b"]);

  const made = gearItemFrom({ id: "x", name: "X", owner: "basic", itemType: "accessory" }, null);
  check("given unworn, as an Accessory", [made.system.itemType, made.system.equipped],
    ["accessory", false]);
  const kept = new DBUGearData(structuredClone(made.system), { strict: false }).toObject();
  check("which the schema keeps", kept.equipped, false);

  const equip = SHEET.slice(SHEET.indexOf("static async _onEquipGear("),
    SHEET.indexOf("static async _onEndMark("));
  check("refused before the Action is spent, and taking off never refused",
    [equip.indexOf("equipProblem(") < equip.indexOf("spendActions("),
     equip.includes("if (!wearing) {")], [true, true]);
  check("the Action is the Accessory cost",
    equip.includes("spendActions(this.actor, EQUIP_COST)"), true);
  check("the row's button, and Equipped shown",
    [TAB.includes('data-action="equipGear"'), TAB.includes("{{#if row.equipped}}<span class=\"gear-type\">Equipped</span>{{/if}}"),
     SHEET.includes("equipGear: DBUCharacterSheet._onEquipGear,")], [true, true, true]);
}

// --- Performance Enhancer ---------------------------------------------------------------------------
{
  const perf = getTrait("performance-enhancer");
  check("the Performance Enhancer is there: [Med], Craft DC Master, Medicine and Consumable",
    [perf?.owner, tagsOf(perf), perf?.craftDC], ["basic", ["med"], "Master"]);
  const made = gearItemFrom(perf, null);
  check("consumed for an Action, saying what it does",
    [made.system.placeCost, made.system.consumed, made.system.details, made.system.consumeNote],
    [1, true, ["medicine", "consumable"], "enters the Doping Enhancement (even without access to it)"]);
  const kept = new DBUGearData(structuredClone(made.system), { strict: false }).toObject();
  check("its note kept by the schema", kept.consumeNote, made.system.consumeNote);
  const SHEET_C = read("module", "sheets", "actor-character-sheet.mjs");
  check("the row offers Consume, and the card says it",
    [SHEET_C.includes("|| Boolean(item.system.consumeNote)\n          || Boolean(item.system.gamble?.save),"),
     SHEET_C.includes('note ? `, and ${Handlebars.escapeExpression(note)}` : ""}.</p>`')], [true, true]);
  check("in the index", INDEX.traits.includes("gear/basic/performance-enhancer.dbu"), true);
}

// --- Sake Bottle -------------------------------------------------------------------------------------
{
  const sake = getTrait("sake-bottle");
  check("the Sake Bottle is there: [Food], Craft DC Qualified, Food",
    [sake?.owner, tagsOf(sake), sake?.craftDC], ["basic", ["food"], "Qualified"]);
  const made = gearItemFrom(sake, null);
  check("4 Alcohol, and Drink for an Action saying what it does",
    [made.system.chargesDice, made.system.chargesLabel, made.system.placeCost, made.system.details,
     made.system.chargeUseLabel, made.system.chargeUseNote],
    ["4", "Alcohol", 1, ["food"], "Drink", "enters the Drunk Special State until the start of their next turn"]);
  const kept = new DBUGearData(structuredClone(made.system), { strict: false }).toObject();
  check("its fields kept by the schema", [kept.chargeUseLabel, kept.chargeUseNote],
    [made.system.chargeUseLabel, made.system.chargeUseNote]);
  const SHEET_S = read("module", "sheets", "actor-character-sheet.mjs");
  const TAB_S = read("templates", "parts", "actor-gear.hbs");
  check("its row offers Drink while there is Alcohol, and spends one",
    [TAB_S.includes('data-action="chargeGear"'), SHEET_S.includes("chargeGear: DBUCharacterSheet._onChargeGear,"),
     SHEET_S.includes('await item.update({ "system.charges": left });')], [true, true, true]);
  check("in the index", INDEX.traits.includes("gear/basic/sake-bottle.dbu"), true);
}

// --- Smoke Bomb, Consumable -------------------------------------------------------------------------
{
  const made = gearItemFrom(getTrait("smoke-bomb"), null);
  const SHEET_B = read("module", "sheets", "actor-character-sheet.mjs");
  check("the Smoke Bomb is Consumable, gone once thrown",
    [made.system.consumed, made.system.details,
     SHEET_B.includes("const done = await burstGear(this.actor, item, caught);\n"
       + "    // Consumable: \"destroyed once it is used\" - gone once thrown.\n"
       + "    if (isConsumable(item, getTrait)) await item.delete();")], [true, ["consumable"], true]);
}

// --- Ensenji ---------------------------------------------------------------------------------------
{
  const fruit = getTrait("ensenji");
  check("the Ensenji is there: [Food], Food and Consumable", [fruit?.owner, tagsOf(fruit)], ["basic", ["food"]]);
  const made = gearItemFrom(fruit, null);
  check("consumed for an Action: all Life and Ki back, saying the Awakening",
    [made.system.placeCost, made.system.consumed, made.system.details, made.system.heal.full, made.system.heal.ki,
     made.system.consumeNote],
    [1, true, ["food", "consumable"], true, true,
     "gains a stack of the Unlocked Potential Awakening as a Level 1 Temporary Awakening"]);
  const kept = new DBUGearData(structuredClone(made.system), { strict: false }).toObject();
  check("its full heal kept by the schema", kept.heal.full, true);
  const SHEET_E = read("module", "sheets", "actor-character-sheet.mjs");
  check("to their maximum, with no roll",
    SHEET_E.includes("[`system.${pool}.value`, this.actor.system[pool].max])));"), true);
  check("in the index", INDEX.traits.includes("gear/basic/ensenji.dbu"), true);
}

// --- Ultra Divine Water -------------------------------------------------------------------------
{
  const water = getTrait("ultra-divine-water");
  check("the Ultra Divine Water is there: [Food], no Craft DC", [water?.owner, tagsOf(water), water?.craftDC ?? ""],
    ["basic", ["food"], ""]);
  check("the entry, as printed", printedLines(water?.text), [
    "Ultra Divine Water:",
    "\u2013Details: Food, Consumable",
    "\u2013Effects: You can spend 1 Action to consume this Basic Item. If you do, make a Corporeal check "
      + "against a DC of 10 (increased by double your base Tier of Power \u2013 so, at ToP1, the DC would be "
      + "12, 14 at ToP2, etc). If you succeed, you gain a stack of the Unlocked Potential Awakening as a "
      + "Level 1 Temporary Awakening and have your Life and Ki Points set to their respective maximums. "
      + "If you fail, your Life Points are set to their minimum value and you are Defeated. If outside of "
      + "a Combat Encounter, you die immediately, but if not, then you will die if you remain Defeated at "
      + "the end of that Combat Encounter."
  ]);
  const made = gearItemFrom(water, null);
  check("an Action, Consumable, a Corporeal Check against 10 plus 2 a Tier",
    [made.system.placeCost, made.system.consumed, made.system.details, made.system.gamble],
    [1, true, ["food", "consumable"], { save: "corporeal", dc: 10, perTier: 2 }]);
  const { gambleDC } = await import(modUrl("gear.mjs"));
  check("12 at ToP1, 14 at ToP2", [gambleDC(made.system.gamble, 1), gambleDC(made.system.gamble, 2)], [12, 14]);
  const kept = new DBUGearData(structuredClone(made.system), { strict: false }).toObject();
  check("its Saving Throw kept by the schema", kept.gamble, { save: "corporeal", dc: 10, perTier: 2 });
  const SHEET_U = read("module", "sheets", "actor-character-sheet.mjs");
  check("consuming it posts the card and uses it up",
    SHEET_U.includes("await postGamble(this.actor, item);\n      const { getTrait } = await import(\"../effects/traits.mjs\");\n      if (isConsumable(item, getTrait)) await item.delete();"),
    true);
  const CHAT_U = read("module", "chat.mjs");
  check("made: Life and Ki to their maximums; failed: Life to nothing",
    [CHAT_U.includes('await actor.update({ "system.life.value": actor.system.life.max, "system.ki.value": actor.system.ki.max });'),
     CHAT_U.includes("await reduceLifePoints(actor, Math.max(0, Number(actor.system.life.value) || 0),"),
     CHAT_U.includes("await cardRoll(message, { actorUuid: actor.uuid, type: \"save\", key: gamble.save, against: dc,")],
    [true, true, true]);
  check("in the index", INDEX.traits.includes("gear/basic/ultra-divine-water.dbu"), true);
}

console.log(`${failed} failing`);
process.exit(failed ? 1 : 0);
