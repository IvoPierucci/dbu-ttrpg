/**
 * Vehicles (the Vehicles page; the user's, 2026-11-15): an Actor type of its own, made from nothing a Character has. Stage 1 - the
 * type, its model and what it works out, the Vehicle Qualities' files, and its sheet (header, Main, Qualities, Creation).
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
const ACTORS = new Map();
globalThis.fromUuidSync = uuid => ACTORS.get(uuid) ?? null;

const TRAITS = path.join(ROOT, "traits");
globalThis.foundry.utils.fetchJsonWithTimeout = async () => JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));
globalThis.fetch = async url => {
  const file = path.join(TRAITS, String(url).replace("systems/dbu-ttrpg/traits/", ""));
  if (!fs.existsSync(file)) return { ok: false, status: 404, statusText: "missing" };
  return { ok: true, status: 200, text: async () => fs.readFileSync(file, "utf8") };
};

const { loadTraits, getTrait, printedLines } = await import(modUrl("effects/traits.mjs"));
const V = await import(modUrl("vehicles.mjs"));
const { default: DBUVehicleData } = await import(modUrl("data/actor-vehicle.mjs"));
const TYPES = await import(modUrl("actor-types.mjs"));
await loadTraits();

const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");
let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

/** A Vehicle's data, prepared. */
function vehicle(source = {}) {
  const model = new DBUVehicleData(source, { strict: false });
  model.prepareDerivedData();
  return model;
}
const q = (id, slots = 1, choices = []) => ({ id: `vehicle-${id}`, slots, choices });

// --- The type ------------------------------------------------------------------------------------------------------------------
const MAIN = read("module", "dbu-ttrpg.mjs");
check("an Actor type of its own, named, with a model and a sheet of its own - no Character",
  [Object.keys(JSON.parse(read("system.json")).documentTypes.Actor).includes("vehicle"), JSON.parse(read("lang", "en.json"))["TYPES.Actor.vehicle"],
   MAIN.includes("CONFIG.Actor.dataModels.vehicle = DBUVehicleData;"), MAIN.includes('types: ["vehicle"],'), MAIN.includes("registerVehicleHooks();"),
   TYPES.isVehicle({ type: "vehicle" }), TYPES.isCharacter({ type: "vehicle" }), TYPES.CHARACTER_TYPES.includes("vehicle")],
  [true, "Vehicle", true, true, true, true, false, false]);

// --- The Vehicle Qualities' files ----------------------------------------------------------------------------------------------
const QUALITY_NAMES = ["Adjustable", "Air-Tight", "Armored Plating", "Big Blaster", "Blutz Wave Generator", "Boost Speed", "Brutal Design",
  "Capsule", "Colony Ship", "Countermeasures", "Energy Shield", "Extra Space", "Favored Environment", "Heavy Vehicle", "Hikou", "Jacket Dock",
  "Living Quarters", "Remote Controlled", "Scanner", "Ultra-Massive", "Weapon Installed"];
check("all 21 Vehicle Qualities, each its file, in the index, of the kind 'vehicles'",
  [V.vehicleQualities().map(each => each.name), V.vehicleQualities().every(each => each.id.startsWith("vehicle-") && (each.owner === "qualities"))],
  [QUALITY_NAMES, true]);
const index = JSON.parse(read("traits", "index.json")).traits.filter(file => file.startsWith("vehicles/"));
check("the index and the folder agree", index.sort(), fs.readdirSync(path.join(TRAITS, "vehicles", "qualities")).map(file => `vehicles/qualities/${file}`).sort());
check("its entry printed as the page prints it: name and flavour, Prerequisites, Quality Slots, Effects",
  printedLines(getTrait("vehicle-weapon-installed").text).slice(0, 4).map(line => line.slice(0, 40)),
  ["Weapon Installed: This Vehicle has an in", "–Prerequisites: This Vehicle's Creator h", "–Quality Slots: 1~3", "–Effects: For each Quality Slot this Veh"]);
check("Slots: one, or a range to choose in", [V.qualitySlotRange(getTrait("vehicle-hikou")), V.qualitySlotRange(getTrait("vehicle-extra-space"))],
  [{ min: 1, max: 1 }, { min: 1, max: 3 }]);

// --- What it works out ---------------------------------------------------------------------------------------------------------
// The mockup's: Vehicle Level 3, Grade 3, Enormous.
const air = vehicle({ vehicleLevel: 3, grade: 3, size: "enormous" });
check("Level 3, Grade 3, Enormous: Output 9 = 3 + 2x3; Life 60, Ki 46, Capacity 28 (a Power Level 3 Character's); Tier 1",
  [air.output, air.life.max, air.ki.max, air.capacity.max, air.tierOfPower, air.baseTierOfPower],
  [9, 60, 46, 28, 1, 1]);
check("Speed = Output, Boosted 1.5x (down), Might = Output; Soak and DV Output with the Size's per Tier after it (Enormous +2 / -2)",
  [air.speed, air.might, air.soakValue, air.defenseValue, air.damageReduction],
  [{ normal: 9, boosted: 13 }, 9, 11, 7, 0]);
check("Hardness Rank 3, its value by Tier (6 a Tier); Enormous 2x2, a Pilot Seat to pick",
  [air.hardnessRank, air.hardness, air.squares, air.reading.size.squares], [3, 6, { cols: 2, rows: 2 }, 4]);
check("Level 1 Grade 1 Large: the least - Output 3, Life 50, Ki 30, Capacity 20; Large's Soak +1 and DV -1 (floor 2)",
  (({ output, life, ki, capacity, soakValue, defenseValue, squares }) => [output, life.max, ki.max, capacity.max, soakValue, defenseValue, squares])(vehicle()),
  [3, 50, 30, 20, 4, 2, { cols: 1, rows: 1 }]);
check("Level 10 (Tier 3), Grade 5, Gigantic: Output 20, Life 95, Ki 102, Capacity 56; Soak 20 + 9, DV 20 - 9; Hardness 6 x 3",
  (({ output, life, ki, capacity, soakValue, defenseValue, hardness, tierOfPower }) => [output, tierOfPower, life.max, ki.max, capacity.max, soakValue, defenseValue, hardness])(
    vehicle({ vehicleLevel: 10, grade: 5, size: "gigantic" })),
  [20, 3, 95, 102, 56, 29, 11, 18]);

// The Qualities' numbers.
const built = vehicle({ vehicleLevel: 3, grade: 3, size: "enormous", qualities: [q("armored-plating"), q("heavy-vehicle"), q("boost-speed"), q("brutal-design", 2), q("extra-space", 2)] });
check("Armored Plating DR 1/2 Output; Heavy Vehicle Soak + Level and Speeds halved; Boost Speed Boosted 2x Output (then halved)",
  [built.damageReduction, built.soakValue, built.speed], [4, 14, { normal: 4, boosted: 9 }]);
check("Brutal Design: Hardness Rank + its Slots (to 5 at most); Extra Space: a row more a Slot",
  [built.hardnessRank, built.hardness, built.squares, built.reading.size.squares], [5, 10, { cols: 2, rows: 4 }, 8]);
check("Quality Slots: the Grade's (3 -> 2), every Slot used counted, over said",
  built.reading.slots, { have: 2, used: 7, over: 5 });
check("each Quality says what it does", built.reading.qualities.map(each => each.effect),
  ["DR +4", "Soak +3, Speeds halved", "Boosted 18", "Hardness Rank +2", "Rows +2"]);
const massive = vehicle({ vehicleLevel: 1, grade: 3, size: "gigantic", qualities: [q("ultra-massive", 2)] });
check("Ultra-Massive: Gigantic made Colossal - its Squares, Soak and DV the Colossal's",
  [massive.reading.size.label, massive.squares, massive.soakValue, massive.defenseValue, massive.reading.madeSize], ["Colossal", { cols: 7, rows: 7 }, 12, 2, "gigantic"]);
check("a range's Slots kept within it", vehicle({ qualities: [q("extra-space", 9), q("brutal-design", 0)] }).reading.qualities.map(each => each.slots), [3, 1]);

// What each asks: warned, never refused (the user's).
const creator = { name: "Bulma", system: { skills: { knowledge: { ranks: 5 }, craftWeapons: { ranks: 1 } } } };
ACTORS.set("Actor.bulma", creator);
const asks = vehicle({ grade: 1, size: "large", creator: "Actor.bulma",
  qualities: [q("colony-ship", 2), q("adjustable"), q("scanner"), q("weapon-installed"), q("ultra-massive", 2), q("living-quarters", 2)] });
check("what a Quality asks and this one lacks, said: Size, Grade, another Quality, its Creator's Skill Ranks",
  asks.reading.qualities.map(each => each.warnings),
  [["Needs a Size Category of Gigantic or larger.", "Needs a Craftsmanship Grade of 3 or higher."],
   ["Needs the Favored Environment Vehicle Quality."],
   [],
   ["Needs its Creator to have 2+ Skill Ranks in Craft (Weapons): Bulma has 1."],
   ["Needs the Size Category to be Gigantic before it applies."],
   ["Needs a Size Category of Enormous or larger."]]);
check("no Creator chosen: the Skill asked said as unknown", vehicle({ qualities: [q("scanner")] }).reading.qualities[0].warnings,
  ["Needs its Creator to have 2+ Skill Ranks in Knowledge (Science) - no Creator chosen in Creation."]);
check("a Favored Environment chooses one Battle Environment, Adjustable two; Weapon Installed a Vehicle Weapon a Slot",
  vehicle({ qualities: [q("favored-environment", 1, ["bog-environment"]), q("adjustable"), q("weapon-installed", 3)] }).reading.qualities
    .map(each => [each.choose, each.choices, each.weapons]),
  [[1, ["bog-environment"], 0], [2, [], 0], [0, [], 3]]);
check("Battle Environments to choose from: the Battlefields' Environments", V.battleEnvironments().some(each => each.id === "bog-environment"), true);
check("a file that is no Vehicle Quality ignored", vehicle({ qualities: [{ id: "artisan", slots: 1, choices: [] }] }).reading.qualities, []);

// A target's names: what reads one reads a Vehicle the same way.
check("no Character: no effects, no Combat Conditions, never Defeated; destroyed at 0 Life Points",
  [air.effects.slots, air.conditions, air.defeated, air.destroyed, vehicle({ life: { value: 0 } }).destroyed], [{}, {}, false, false, true]);

// --- Its token --------------------------------------------------------------------------------------------------------------------
check("its token as big as its Squares, Extra Space's rows too", [V.tokenSizeOf(air.reading), V.tokenSizeOf(built.reading)],
  [{ width: 2, height: 2 }, { width: 2, height: 4 }]);

// --- Its sheet ------------------------------------------------------------------------------------------------------------------
const require = createRequire(path.join(APP, "package.json"));
const Handlebars = require("handlebars");
Handlebars.registerHelper("eq", (a, b) => a === b);
const tpl = name => Handlebars.compile(read("templates", "parts", `${name}.hbs`));
const SHEET = read("module", "sheets", "actor-vehicle-sheet.mjs");
check("its sheet: header, then Main, Qualities and Creation (the user's)",
  ["main: { id: \"main\"", "qualities: { id: \"qualities\"", "creation: { id: \"creation\"", "vehicle-header.hbs"].map(text => SHEET.includes(text)),
  [true, true, true, true]);
const reading = built.reading;
const header = tpl("vehicle-header")({ actor: { name: "Air Car", img: "car.webp" }, system: { ...built, destroyed: true }, reading, lifePercent: 0,
  kiPercent: 40, capacity: reading.capacity, capacityPercent: 100 });
check("header: Level, Grade, Size and Output beside the name; Life with no Threshold lines, Destroyed at 0; Ki with the Capacity left",
  [header.includes("<em>Level</em> <span class=\"computed-value\">3</span>"), header.includes("<em>Output</em> <span class=\"computed-value\">9</span>"),
   header.includes("dbu-pool-line"), header.includes("dbu-vehicle-destroyed"), header.includes('data-capacity-left value="28"'),
   header.includes('name="system.life.value"'), header.includes('name="system.ki.value"')],
  [true, true, false, true, true, true, true]);
const main = tpl("vehicle-main")({ tabs: { main: { cssClass: "active" } }, reading,
  crew: { pilot: { uuid: "Actor.b", name: "Bulma", img: "b.webp" }, passengers: [{ uuid: "Actor.g", name: "Goku", img: "g.webp" }], inside: 2, squares: 8,
    seatNeeded: true, seat: "Row 1, Square 1" },
  aptitudes: [{ label: "Speed", value: "4 sq.", tip: "x" }, { label: "Might", value: 9, tip: "y" }] });
check("Main: the Pilot with the Pilot Seat, the Passengers, how many are in it; the Aptitudes",
  [main.includes("Pilot Seat: Row 1, Square 1"), (main.match(/data-action="openCrew"/g) ?? []).length, main.includes("8 Squares, 2 in it"),
   (main.match(/<div class="stat">/g) ?? []).length, main.includes("No Pilot")],
  [true, 2, true, 2, false]);
check("Main with nobody in it: told how to get in",
  tpl("vehicle-main")({ tabs: { main: {} }, reading, crew: { passengers: [], inside: 0, squares: 1 }, aptitudes: [] }).includes("No Pilot. Use the Ride Maneuver"), true);
const qualities = tpl("vehicle-qualities")({ tabs: { qualities: {} }, reading, editable: true, slots: reading.slots, qualities: [
  { index: 0, name: "Extra Space", effect: "Rows +2", slots: 2, ranged: true, range: { min: 1, max: 3 }, warnings: [], chooses: [], weaponRows: [], text: [] },
  { index: 1, name: "Favored Environment", effect: "DV +4 there", slots: 1, ranged: false, warnings: ["Needs x."], open: true, waits: "",
    text: [{ text: "Favored Environment: ..." }], weaponRows: [],
    chooses: [{ at: 0, options: [{ value: "", label: "-" }, { value: "bog-environment", label: "Bog Environment", selected: true }] }] },
  { index: 2, name: "Weapon Installed", effect: "", slots: 2, ranged: true, range: { min: 1, max: 3 }, warnings: [], chooses: [], text: [],
    weaponRows: [{ at: 0, id: "w1", name: "Twin Ki Cannon", built: true, type: "Energy", profiles: [{ value: "blast", label: "Profile: Blast", selected: true }] },
      { at: 1, id: "", name: "Vehicle Weapon 2", built: false, profiles: [] }] }] });
check("Qualities: Slots of the Grade's, over in red; a range's box, a choice's select, a warning, its text opened; the Vehicle Weapons with Build",
  [qualities.includes("Quality Slots 7 of 2 (Grade 3) &middot; 5 over"), qualities.includes('data-quality-slots="0" value="2"'),
   qualities.includes('data-quality-choice="1:0"'), qualities.includes("Needs x."), qualities.includes("Favored Environment: ..."),
   (qualities.match(/data-action="buildWeapon"/g) ?? []).length, qualities.includes("Vehicle Weapon 2 - not built yet"), qualities.includes('data-weapon-profile="w1"')],
  [true, true, true, true, true, 2, true, true]);
const creation = tpl("vehicle-creation")({ tabs: { creation: {} }, reading, editable: true, slots: reading.slots, system: { vehicleLevel: 3 },
  grades: [{ value: 3, label: "3 · Expert", selected: true }], gradeNote: "Craft DC Expert (18) · 2 Quality Slots", sizes: [{ value: "enormous", label: "Enormous", selected: true }],
  sizeNote: "2×2 Squares", maxLevel: 30, creators: [{ value: "", label: "-" }], creatorNote: "",
  seat: { cols: 2, cells: [{ index: 0, on: true }, { index: 1 }, { index: 2 }, { index: 3 }, { index: 4, extra: true }, { index: 5, extra: true }] } });
check("Creation: Grade, Size, Vehicle Level with Tune Up, Creator; the Pilot Seat's grid, Extra Space's rows marked",
  [creation.includes('name="system.grade"'), creation.includes('name="system.size"'), creation.includes('name="system.vehicleLevel"'), creation.includes('data-action="tuneUp"'),
   creation.includes('name="system.creator"'), (creation.match(/data-action="pickSeat"/g) ?? []).length, (creation.match(/dbu-vehicle-cell extra/g) ?? []).length,
   creation.includes("2 used on the Qualities tab") || creation.includes("used on the Qualities tab")],
  [true, true, true, true, true, 6, 2, true]);

// --- Stage 2: the Ride Maneuver and the Crew -----------------------------------------------------------------------------------
check("room in a Vehicle: the first unoccupied place from its front left, the Pilot Seat tried first; none, none",
  [V.roomIn({ x: 0, y: 0, w: 2, h: 2 }, { w: 1, h: 1 }, [{ x: 0, y: 0, w: 1, h: 1 }]),
   V.roomIn({ x: 0, y: 0, w: 2, h: 2 }, { w: 1, h: 1 }, [], 3),
   V.roomIn({ x: 0, y: 0, w: 2, h: 2 }, { w: 1, h: 1 }, [{ x: 0, y: 0, w: 2, h: 2 }]),
   V.roomIn({ x: 0, y: 0, w: 2, h: 2 }, { w: 2, h: 2 }, [{ x: 1, y: 1, w: 1, h: 1 }])],
  [{ x: 1, y: 0 }, { x: 1, y: 1 }, null, null]);
check("room beside one: unoccupied, touching its Squares, never off the map",
  [V.roomBeside({ x: 5, y: 5, w: 2, h: 2 }, { w: 1, h: 1 }, []), V.roomBeside({ x: 0, y: 0, w: 1, h: 1 }, { w: 1, h: 1 }, [{ x: 1, y: 0, w: 1, h: 1 }])],
  [{ x: 4, y: 4 }, { x: 0, y: 1 }]);
check("the crew a change leaves: in as Pilot or Passenger, one place each, out",
  [V.crewWith({ pilot: "", passengers: ["a"], remote: false }, "a", "pilot"), V.crewWith({ pilot: "a", passengers: [], remote: false }, "a", "passenger"),
   V.crewWith({ pilot: "a", passengers: ["b"], remote: false }, "b", null), V.crewWith({ pilot: "a", passengers: ["b"], remote: false }, "a", null)],
  [{ pilot: "a", passengers: [], remote: false }, { pilot: "", passengers: ["a"], remote: false }, { pilot: "a", passengers: [], remote: false }, { pilot: "", passengers: ["b"], remote: false }]);

// A scene: a 2x2 Vehicle at (1,0), Bulma (1 Pilot Rank) beside it at (3,0), Goku (none) at (0,0).
{
  const answers = [];
  globalThis.foundry.applications = { api: { DialogV2: { wait: async () => answers.shift() ?? null } } };
  const warned = [];
  globalThis.ui.notifications.warn = text => warned.push(text);
  const user = { id: "u1", active: true, isGM: true };
  globalThis.game.user = user;
  globalThis.game.users = Object.assign([user], { activeGM: user });
  const scene = { id: "s1", grid: { size: 100 }, tokens: [] };
  scene.tokens.get = id => scene.tokens.find(token => token.id === id);
  scene.updateEmbeddedDocuments = async (kind, updates) => {
    for (const update of updates) Object.assign(scene.tokens.get(update._id), update);
  };
  globalThis.canvas = { scene, grid: { size: 100 } };
  const token = (id, x, y, w = 1, h = 1) => {
    const doc = { id, x: x * 100, y: y * 100, width: w, height: h, hidden: false, parent: scene, isOwner: true, documentName: "Token" };
    scene.tokens.push(doc);
    return doc;
  };
  const actor = (id, name, ranks, x, y, extra = {}) => {
    const doc = token(id, x, y, extra.w, extra.h);
    const made = { uuid: `Actor.${id}`, id, name, type: extra.type ?? "character", isOwner: true, testUserPermission: () => true,
      system: { skills: { pilot: { ranks } }, ...(extra.system ?? {}) }, getActiveTokens: () => [doc],
      update: async changes => { for (const [key, value] of Object.entries(changes)) foundry.utils.setProperty(made, key, value); } };
    doc.actor = made;
    ACTORS.set(made.uuid, made);
    return made;
  };
  const car = actor("car", "Air Car", 0, 1, 0, { type: "vehicle", w: 2, h: 2,
    system: { crew: { pilot: "", passengers: [], remote: false }, pilotSeat: 1, life: { value: 50 }, reading: { size: { cols: 2 } } } });
  const bulma = actor("bulma", "Bulma", 1, 3, 0);
  const goku = actor("goku", "Goku", 0, 0, 0);
  globalThis.game.actors = [car, bulma, goku];
  const at = who => { const doc = who.getActiveTokens()[0]; return [doc.x / 100, doc.y / 100]; };
  const maneuver = { id: "ride", name: "Ride" };

  check("beside it: Bulma and Goku next to the Air Car", [V.vehiclesBeside(bulma).map(each => each.name), V.vehiclesBeside(goku).map(each => each.name)],
    [["Air Car"], ["Air Car"]]);
  answers.push("pilot");
  const bulmaIn = await V.askRide(bulma);
  const saidIn = await V.doRide(bulma, maneuver, bulmaIn);
  check("Bulma rides in as its Pilot (1 Pilot Rank, nobody at the controls): to the Pilot Seat, the crew written",
    [bulmaIn.action, bulmaIn.asPilot, saidIn, car.system.crew, at(bulma)],
    ["enter", true, "Bulma gets into Air Car as its Pilot.", { pilot: "Actor.bulma", passengers: [], remote: false }, [2, 0]]);
  const gokuIn = await V.askRide(goku);
  await V.doRide(goku, maneuver, gokuIn);
  check("Goku, no Pilot Rank: no question, in as a Passenger, the first room from its front left",
    [gokuIn.asPilot, car.system.crew, at(goku), V.vehicleOf(goku)?.role, V.pilotedBy(bulma)?.name],
    [false, { pilot: "Actor.bulma", passengers: ["Actor.goku"], remote: false }, [1, 0], "passenger", "Air Car"]);
  answers.push("pilot");
  check("Goku in it, to become its Pilot without a Pilot Rank: refused, said", [await V.askRide(goku), warned.at(-1)],
    [null, "Goku needs at least 1 Skill Rank in Pilot to Pilot a Vehicle."]);
  answers.push("leave");
  const gokuOut = await V.askRide(goku);
  const saidOut = await V.doRide(goku, maneuver, gokuOut);
  check("Goku leaves: off the crew, onto an unoccupied Square beside it", [saidOut, car.system.crew, at(goku)],
    ["Goku leaves Air Car.", { pilot: "Actor.bulma", passengers: [], remote: false }, [0, 0]]);
  answers.push("stop");
  await V.doRide(bulma, maneuver, await V.askRide(bulma));
  check("Bulma stops Piloting: a Passenger, still in it", [car.system.crew, V.standsIn(bulma.getActiveTokens()[0], car.getActiveTokens()[0])],
    [{ pilot: "", passengers: ["Actor.bulma"], remote: false }, true]);
  // At the controls again, then Goku (given a Rank) in and asking her for them.
  answers.push("pilot");
  await V.doRide(bulma, maneuver, await V.askRide(bulma));
  goku.system.skills.pilot.ranks = 2;
  await V.doRide(goku, maneuver, await V.askRide(goku));
  answers.push("pilot", "yes");
  const swapped = await V.doRide(goku, maneuver, await V.askRide(goku));
  check("a willing Pilot: the other takes the controls, the two swap Squares",
    [swapped, car.system.crew, at(goku), at(bulma)],
    ["Bulma lets Goku take Air Car's controls - they swap places.", { pilot: "Actor.goku", passengers: ["Actor.bulma"], remote: false }, [2, 0], [1, 0]]);
  // Not willing: the Clash's card, then settled - Bulma wins it back and puts Goku out.
  let card = null;
  globalThis.ChatMessage = { create: async data => (card = data), getSpeaker: () => ({}) };
  answers.push("pilot", "no");
  await V.doRide(bulma, maneuver, await V.askRide(bulma));
  const clash = card?.flags?.["dbu-ttrpg"]?.clash;
  check("not willing: a Clash (Physical Strike vs Physical Strike/Dodge), its card the Ride's",
    [clash?.category, clash?.strikeFoundations, clash?.challengerUuid, clash?.defenderUuid, clash?.ride], ["strike", ["physical"], "Actor.bulma", "Actor.goku",
      { applied: false, vehicleUuid: "Actor.car" }]);
  answers.push("out");
  const settled = await V.settleRideClash(clash, true);
  check("won: Bulma the Pilot, in the Pilot Seat; the winner puts the other out, beside it",
    [settled, car.system.crew, at(bulma), V.standsIn(goku.getActiveTokens()[0], car.getActiveTokens()[0])],
    ["Bulma takes Air Car's controls. Bulma puts Goku out of it.", { pilot: "Actor.bulma", passengers: [], remote: false }, [2, 0], false]);
  car.system.life.value = 0;
  check("a destroyed Vehicle: nobody Pilots it till it is repaired", V.whyNotPilot(goku, car), "Air Car is destroyed: nobody can Pilot it till it is repaired.");

  // The tokens kept with it: the Vehicle moved, its crew moved as far; one moved off its Squares, out of it.
  const hooks = {};
  globalThis.Hooks = { on: (name, fn) => { (hooks[name] ??= []).push(fn); } };
  V.registerVehicleHooks();
  const move = async (who, x, y, options = {}) => {
    const doc = who.getActiveTokens()[0];
    const change = { x: x * 100, y: y * 100 };
    for (const fn of hooks.preUpdateToken ?? []) fn(doc, change, options);
    Object.assign(doc, change);
    for (const fn of hooks.updateToken ?? []) await fn(doc, change, options, "u1");
  };
  car.update = async changes => { for (const [key, value] of Object.entries(changes)) foundry.utils.setProperty(car, key, value); };
  await move(car, 3, 2);
  check("the Vehicle moved two Squares right and two down: its Pilot with it, still in it", [at(car), at(bulma), at(goku), car.system.crew.pilot],
    [[3, 2], [4, 2], [0, 0], "Actor.bulma"]);
  await move(bulma, 9, 9);
  check("its Pilot moved off its Squares by other means: in it no more", car.system.crew, { pilot: "", passengers: [], remote: false });
}
const UM = read("module", "use-maneuver.mjs"), CHAT = read("module", "chat.mjs");
check("the Ride Maneuver: a core Maneuver of its own, asked before it is paid, done on its card; the Clash settled; tokens through the GM",
  [getTrait("ride")?.usageLimit, getTrait("ride")?.source, getTrait("ride")?.exploitable, UM.includes('riding = await (await import("./vehicles.mjs")).askRide(actor);'),
   UM.includes("? await postRide(actor, maneuver, riding)"), CHAT.includes('const said = await settleRideClash(clash, whoWonClash(clash.result) === "challenger");'),
   CHAT.includes('case "tokens": return game.scenes.get(request.sceneId)?.updateEmbeddedDocuments("Token", request.updates ?? [], request.options ?? {});'),
   read("module", "vehicles.mjs").includes("  registerCrewHooks();")],
  ["2/round", "Core Rule", "If you are in the Melee Range of an Opponent", true, true, true, true, true]);

// --- Stage 3: Piloting ---------------------------------------------------------------------------------------------------------
{
  const warned = [];
  globalThis.ui.notifications.warn = text => warned.push(text);
  const user = { id: "u1", active: true, isGM: true };
  globalThis.game.user = user;
  globalThis.game.users = Object.assign([user], { activeGM: user });
  const flagged = (data, flags) => ({ ...data, getFlag: (scope, key) => flags[key] });
  const weapon = (id, name, type, profile, extra = {}) => flagged({ id, name, type: "gear",
    system: { crafted: { kind: "weapon", weaponType: type, destroyed: false, ...extra } } }, { vehicleWeapon: 0, vehicleProfile: profile });
  const made = (uuid, name, system) => {
    const actor = { uuid, name, isOwner: true, system, items: [],
      update: async changes => { for (const [key, value] of Object.entries(changes)) foundry.utils.setProperty(actor, key, value); } };
    ACTORS.set(uuid, actor);
    return actor;
  };
  const jet = made("Actor.jet", "Jet", { ki: { value: 46, max: 46 }, capacity: { spent: 0, remaining: 28, max: 28 }, output: 9,
    speed: { normal: 9, boosted: 13 }, qualities: [{ id: "vehicle-weapon-installed" }] });
  jet.items = [weapon("w1", "Ki Cannon", "energy", "blast"), weapon("w2", "Broken Gun", "energy", "beam", { destroyed: true }),
    weapon("w3", "Spell Lance", "magic", "beam"), flagged({ id: "w4", name: "Pilot's own sword", type: "gear",
      system: { crafted: { kind: "weapon", weaponType: "energy" } } }, {})];
  const pilot = { uuid: "Actor.vegeta", name: "Vegeta" };

  check("Vehicle Weapons for an attack: built, whole, of its Foundation, made for its Profile - nothing else of the Vehicle's",
    [V.vehicleWeaponsFor(jet, "energy", "blast").map(item => item.name), V.vehicleWeaponsFor(jet, "energy", "beam").map(item => item.name),
     V.vehicleWeaponsFor(jet, "magic", "beam").map(item => item.name), V.vehicleWeaponsFor(jet, "physical", "simple").length],
    [["Ki Cannon"], [], ["Spell Lance"], 0]);
  check("a Pilot's attack: with a Vehicle Weapon of its Profile, or of the Blitz Profile - anything else refused, said",
    [V.whyNotPilotAttack(pilot, jet, { profile: "blast", foundation: "energy" }), V.whyNotPilotAttack(pilot, jet, { profile: "blitz", foundation: "physical" }),
     V.whyNotPilotAttack(pilot, jet, { profile: "simple", foundation: "energy" })],
    ["", "", "Vegeta is Piloting Jet: only an Attacking Maneuver with one of its Vehicle Weapons (of the Profile it was made for), or of the Blitz Profile."]);
  check("what the attack carries: the Vehicle's Output (its Damage Attribute) and Normal Speed (a Blitz's measure)",
    V.pilotingOf(jet), { vehicleUuid: "Actor.jet", name: "Jet", output: 9, normalSpeed: 9 });

  // Its Ki and Capacity pay.
  const maneuver = { id: "basic-attack", name: "Basic Attack" };
  const paid = await V.spendVehicleCost(pilot, jet, maneuver, 12);
  check("paid by the Vehicle: its Ki Points, and as much of its Capacity", [paid, jet.system.ki.value, jet.system.capacity.spent], [true, 34, 12]);
  jet.system.capacity.remaining = 16;
  check("given back when it is taken back", [await V.refundVehicleCost(pilot, maneuver), jet.system.ki.value, jet.system.capacity.spent,
    await V.refundVehicleCost(pilot, maneuver)], [true, 46, 0, false]);
  jet.system.ki.value = 5;
  check("not enough Ki in it: refused, said", [await V.spendVehicleCost(pilot, jet, maneuver, 6), warned.at(-1)],
    [false, "Jet needs 6 Ki Points for Basic Attack and has 5."]);
  jet.system.ki.value = 46;
  jet.system.capacity.remaining = 3;
  check("not enough Capacity left in it: refused, said", [await V.spendVehicleCost(pilot, jet, maneuver, 6), warned.at(-1)],
    [false, "Jet has 3 Capacity left this round and Basic Attack costs 6."]);
  check("nothing to pay: nothing asked", await V.spendVehicleCost(pilot, jet, maneuver, 0), true);

  // What a Pilot may not use, and anyone in it.
  check("piloting: no Unique Ability; no Soar without Hikou, with it yes; anything else judged as it is",
    [V.whyNotPiloting(pilot, jet, { tags: ["uniqueAbility"], name: "Kamehameha" }), V.whyNotPiloting(pilot, jet, { id: "soar" }),
     V.whyNotPiloting(pilot, { ...jet, system: { qualities: [{ id: "vehicle-hikou" }] } }, { id: "soar" }), V.whyNotPiloting(pilot, jet, { id: "basic-attack" })],
    ["Vegeta is Piloting Jet: no Unique Abilities.", "Vegeta is Piloting Jet: no Soar Maneuver - it has no Hikou.", "", ""]);
}
const UM3 = read("module", "use-maneuver.mjs"), CH3 = read("module", "chat.mjs"), MN3 = read("module", "maneuvers.mjs");
check("wired: the gate before anything; the Movement asked of the Vehicle (Rapid only with Boost Speed), priced at its Tier, paid by it; the "
  + "attack with its Vehicle Weapon or Blitz, the Output its Damage Attribute; a refund back to it; Blitz with its Output",
  [UM3.includes("const inVehicle = whyNotInVehicle(actor, maneuver) || whyNotVehicleAttack(actor, maneuver);"),
   UM3.includes('if (vehicle) crossing = await askMovement(vehicle, { rapid: hasVehicleQuality(vehicle, "boost-speed"), pilot: actor });'),
   UM3.includes("if (crossing && pilotedBy(actor)) price = movementKiCost(pilotedBy(actor), crossing);"),
   MN3.includes('if (vehicle) return (await import("./vehicles.mjs")).spendVehicleCost(actor, vehicle, maneuver, costOverride ?? maneuver.kiCost ?? 0);'),
   UM3.includes("const why = whyNotPilotAttack(actor, vehicle, declared);"),
   UM3.includes("damageAttribute: { label: `${vehicle.name}'s Output`, value: Number(vehicle.system.output) || 0 } };"),
   MN3.includes('if (await (await import("./vehicles.mjs")).refundVehicleCost(actor, maneuver)) return;'),
   CH3.includes("const bonus = Math.floor((attack.piloting ? attack.piloting.output : (attacker.system.attributes?.agility?.mod ?? 0)) / 2);"),
   CH3.includes("adamantineHeal = false, piloting = null,")],
  [true, true, true, true, true, true, true, true, true]);

// --- Stage 4: sheltered in it ------------------------------------------------------------------------------------------------
{
  const CREW = await import(modUrl("vehicle-crew.mjs"));
  const plain = { type: "vehicle", system: { crew: { pilot: "Actor.p", passengers: ["Actor.q"], remote: false }, qualities: [] } };
  const sealed = { type: "vehicle", system: { crew: { pilot: "Actor.r", passengers: [], remote: false }, qualities: [{ id: "vehicle-air-tight" }] } };
  globalThis.game.actors = [plain, sealed];
  check("in a Vehicle: the Battle Environment and its Qualities ignored, Weather and the air not; Air-Tight, those too; out of one, nothing",
    [CREW.shelteredBy({ uuid: "Actor.p" }), CREW.shelteredBy({ uuid: "Actor.q" }), CREW.shelteredBy({ uuid: "Actor.r" }), CREW.shelteredBy({ uuid: "Actor.z" })],
    [{ ground: true, airTight: false }, { ground: true, airTight: false }, { ground: true, airTight: true }, { ground: false, airTight: false }]);
  check("who Pilots, who rides", [CREW.pilotedVehicle({ uuid: "Actor.p" }) === plain, CREW.pilotedVehicle({ uuid: "Actor.q" }), CREW.vehicleHolding({ uuid: "Actor.q" })?.role],
    [true, null, "passenger"]);
  const REG = read("module", "effects", "registry.mjs"), BR = read("module", "breath.mjs");
  check("read where the ground, its Qualities, the Weather and the air reach a character",
    [(REG.match(/if \(shelteredBy\(actor\)\.ground\) return \[\];/g) ?? []).length, REG.includes("if (shelteredBy(actor).airTight) return [];"),
     BR.includes("if (shelteredBy(actor).airTight) return false;")], [2, true, true]);
  globalThis.game.actors = [];
}

// --- Stage 4: attacked ------------------------------------------------------------------------------------------------------------
{
  const CREW = await import(modUrl("vehicle-crew.mjs"));
  const answers = [];
  globalThis.foundry.applications = { api: { DialogV2: { wait: async () => answers.shift() ?? null } } };
  const user = { id: "u1", active: true, isGM: true, isActiveGM: true };
  globalThis.game.user = user;
  globalThis.game.users = Object.assign([user], { activeGM: user });
  globalThis.game.combat = null;
  const made = (uuid, name, system, type = "character") => {
    const actor = { uuid, name, type, isOwner: true, testUserPermission: () => true, system, items: [], getActiveTokens: () => [],
      update: async changes => { for (const [key, value] of Object.entries(changes)) foundry.utils.setProperty(actor, key, value); } };
    ACTORS.set(uuid, actor);
    return actor;
  };
  const pilot = made("Actor.pi", "Bulma", { battlefield: { environment: "bog-environment" }, life: { value: 100, max: 100 }, effects: { slots: {} } });
  const rider = made("Actor.ri", "Goku", { life: { value: 100, max: 100 }, effects: { slots: {} } });
  const outsider = made("Actor.ou", "Krillin", { life: { value: 100, max: 100 } });
  const car = made("Actor.car", "Air Car", { crew: { pilot: "Actor.pi", passengers: ["Actor.ri"], remote: false }, output: 9, defenseValue: 7, soakValue: 11,
    ki: { value: 46 }, life: { value: 60, max: 60 },
    qualities: [{ id: "vehicle-favored-environment", choices: ["bog-environment"] }, { id: "vehicle-countermeasures" }] }, "vehicle");
  const empty = made("Actor.empty", "Old Truck", { crew: { pilot: "", passengers: [], remote: false }, output: 5, defenseValue: 4, qualities: [] }, "vehicle");
  globalThis.game.actors = [car, empty, pilot, rider, outsider];

  const aimed = CREW.vehicleTargets(rider, [{ uuid: "Actor.pi", name: "Bulma" }, { uuid: "Actor.ou", name: "Krillin" }]);
  check("an attack at those in a Vehicle is at the Vehicle - once, an area's too; the rest as they were",
    [aimed.target.name, aimed.extraTargets.map(entry => entry.name)], ["Air Car", ["Krillin"]]);
  const called = CREW.vehicleTargets(rider, [], true);
  check("a Called Shot at one in it: at them; their Damage Reduction its Soak Value higher; none out of one or without a Called Shot",
    [called.target.name, CREW.calledShotShelter(rider, true), CREW.calledShotShelter(rider, false), CREW.calledShotShelter(outsider, true)],
    ["Goku", 11, 0, 0]);

  answers.push("yes");
  const side = await V.vehicleDefences([car, empty, outsider]);
  check("its Pilot's Dodge Roll answers for it, ready at once: its Defense Value, Favored Environment's 1/2 Output in the Pilot's Battle "
    + "Environment, Countermeasures' asked and taken; with no Pilot, hit as a Feature is",
    [side.ready, side.defences, side.autoHit, side.dodges],
    [["Actor.car", "Actor.empty"], [{ uuid: "Actor.car", defence: "dodge" }], ["Actor.empty"],
     [{ uuid: "Actor.car", pilotUuid: "Actor.pi", name: "Air Car", defenseValue: 15, notes: ["Favored Environment +4", "Countermeasures +4"] }]]);
  check("the Pilot's own Dodge Roll reads the Vehicle's Defense Value", [CREW.vehicleDodgeOf({ vehicleDodges: side.dodges }, "Actor.pi")?.defenseValue,
    CREW.vehicleDodgeOf({ vehicleDodges: side.dodges }, "Actor.ri")], [15, null]);
  check("Energy Shield: nothing without the Quality", await V.energyShield(car), 0);

  // Destroyed: its Life Points to 0 - everyone in it a quarter of its Maximum, said.
  const hooks = {};
  globalThis.Hooks = { on: (name, fn) => { (hooks[name] ??= []).push(fn); } };
  V.registerVehicleHooks();
  let said = "";
  globalThis.ChatMessage = { create: async data => { said = data.content; return data; }, getSpeaker: () => ({}) };
  const change = { system: { life: { value: 0 } } };
  const options = {};
  for (const fn of hooks.preUpdateActor ?? []) fn(car, change, options);
  car.system.life.value = 0;
  for (const fn of hooks.updateActor ?? []) await fn(car, change, options, "u1");
  check("destroyed: everyone in it loses 1/4 of its Maximum Life Points, said once",
    [pilot.system.life.value, rider.system.life.value, outsider.system.life.value, said.includes("Air Car</strong> is destroyed.")],
    [85, 85, 100, true]);
  globalThis.game.actors = [];
}
const CH4 = read("module", "chat.mjs");
check("wired: targets turned to the Vehicle as the attack is made; its Pilot's roll; nothing of a Character's after its Damage; the Called "
  + "Shot's and Energy Shield's Damage Reduction; the Pilot's Dodge Roll its Defense Value",
  [CH4.includes("({ target, extraTargets } = vehicleTargets(target, extraTargets, isCalledShot({ modifiers })));"),
   CH4.includes("ready: [...(vehicleSide?.ready ?? [])],"), CH4.includes("defences: [...(vehicleSide?.defences ?? [])],"),
   CH4.includes(": await defence.answer(roller, options, attack);"), CH4.includes("const knockedThrough = !isVehicle(target) && thresholds.indexOf("),
   CH4.includes("const afterPierce = Math.max(0, (target.system.damageReduction ?? 0) + shelter - pierced);"),
   CH4.includes("const defenseValue = forVehicle ? forVehicle.defenseValue : actor.system.defenseValue;")],
  [true, true, true, true, true, true, true]);
check("a Vehicle as a target reads as nothing where a Character's would be read: no dice, no Diminishing Defense, no Threshold",
  (({ dice, diminishing, threshold, effects }) => [dice.extra.formula, diminishing.defense.perAttack, threshold.key, effects.programs])(vehicle()),
  ["", 0, "healthy", []]);

// --- Stage 5: what waited on Vehicles -------------------------------------------------------------------------------------------
{
  const answers = [];
  globalThis.foundry.applications = { api: { DialogV2: { wait: async () => answers.shift() ?? null } } };
  const user = { id: "u1", active: true, isGM: true, isActiveGM: true, can: () => true };
  globalThis.game.user = user;
  globalThis.game.users = Object.assign([user], { activeGM: user });
  globalThis.game.combat = null;
  const scene = { id: "s5", grid: { size: 100 }, tokens: [] };
  scene.tokens.get = id => scene.tokens.find(token => token.id === id);
  scene.updateEmbeddedDocuments = async (kind, updates) => { for (const update of updates) Object.assign(scene.tokens.get(update._id), update); };
  globalThis.canvas = { scene, grid: { size: 100 } };
  const flags = {};
  const made = (uuid, name, system, { type = "character", items = [], x = null, y = null, w = 1 } = {}) => {
    const doc = (x === null) ? null : { id: uuid, x: x * 100, y: y * 100, width: w, height: w, hidden: false, parent: scene, isOwner: true, documentName: "Token" };
    if (doc) scene.tokens.push(doc);
    const actor = { uuid, name, type, isOwner: true, testUserPermission: () => true, system, items, getActiveTokens: () => (doc ? [doc] : []),
      getFlag: (scope, key) => flags[`${uuid}:${key}`], setFlag: async (scope, key, value) => { flags[`${uuid}:${key}`] = value; },
      update: async changes => { for (const [key, value] of Object.entries(changes)) foundry.utils.setProperty(actor, key, value); } };
    ACTORS.set(uuid, actor);
    return actor;
  };
  const expert = { type: "talent", name: "Expert Pilot", flags: { "dbu-ttrpg": { sourceId: "expert-pilot" } } };
  const eye = { type: "racial", name: "Eye of the Dragon", flags: { "dbu-ttrpg": { sourceId: "eye-of-the-dragon" } } };
  const quick = { type: "racial", name: "Quick to Master", system: { chosen: [{ key: "option", value: "way-of-the-pilot" }] } };
  const ace = made("Actor.ace", "Yamcha", { skills: { pilot: { ranks: 5 }, craftVehicles: { ranks: 2, bonus: 7 } }, tierOfPower: 2,
    baseTierOfPower: 2, powerLevel: 9 }, { items: [expert, eye, quick], x: 3, y: 0 });
  const novice = made("Actor.nov", "Oolong", { skills: { pilot: { ranks: 1 } }, tierOfPower: 1 }, { x: 0, y: 5 });
  const car = made("Actor.car5", "Air Car", { crew: { pilot: "Actor.ace", passengers: [], remote: false }, grade: 3, output: 9, defenseValue: 7,
    life: { value: 30, max: 60 }, qualities: [] }, { type: "vehicle", x: 1, y: 0, w: 2 });
  globalThis.game.actors = [car, ace, novice];

  check("Expert Pilot: the 5th Pilot Rank counted as 2; its Dodge Rolls with a Vehicle 1(T) for every 2 - Yamcha's 6 Ranks, Tier 2: +6",
    [V.hasExpertPilot(ace), V.expertPilotRanks(ace), V.expertPilotDodge(ace), V.hasExpertPilot(novice), V.expertPilotDodge(novice)],
    [true, 6, 6, false, 0]);
  check("and on the Dodge Roll its Pilot makes for it", (await V.vehicleDefences([car])).dodges[0].notes, ["Expert Pilot +6"]);
  answers.push("instant");
  const instant = await V.rideAsInstant(ace, { id: "ride", type: "standard", actionCost: 1 });
  check("Expert Pilot (4): the Ride as an Instant, once a Round - asked, the second time not",
    [instant.type, instant.actionCost, (await V.rideAsInstant(ace, { id: "ride", type: "standard" })).type,
     (await V.rideAsInstant(novice, { id: "ride", type: "standard" })).type], ["instant", 0, "standard", "standard"]);
  check("Vehicle Attack: only while Piloting a Vehicle", [V.whyNotVehicleAttack(ace, { name: "Ram", advantages: ["vehicle-attack"] }),
    V.whyNotVehicleAttack(novice, { name: "Ram", advantages: ["vehicle-attack"] }), V.whyNotVehicleAttack(novice, { name: "Kick", advantages: [] })],
    ["", "Ram is a Vehicle Attack: only while Piloting a Vehicle.", ""]);

  // Way of the Pilot: up to 10(bT) of its Life Points onto the Wound, at an Opponent, once a Round.
  check("Way of the Pilot: Eye of the Dragon with Quick to Master's Way of the Pilot", [V.wayOfThePilot(ace), V.wayOfThePilot(novice)], [true, false]);
  globalThis.foundry.applications.api.DialogV2.wait = async options => {
    const callback = options.buttons?.find(button => button.default || button.callback)?.callback;
    return callback ? 12 : (answers.shift() ?? null);
  };

  // Eject: out of it, straight away from its middle, a Square for each Pilot Rank.
  const said = await V.doEject(ace);
  const doc = ace.getActiveTokens()[0];
  check("Eject: out of the crew, its token 5 Squares straight away from the Vehicle (out of it first)",
    [car.system.crew, [doc.x / 100, doc.y / 100], said], [{ pilot: "", passengers: [], remote: false }, [8, 0],
      "Yamcha ejects from Air Car, 5 Squares away from it in a straight line."]);
  check("not in one: nothing to eject from", await V.doEject(novice), null);

  // Repair beside it; Full Repair; Tune Up; Create.
  doc.x = 300; doc.y = 0;
  check("Repair: a Vehicle beside them, with Craft (Vehicles) at its Grade's Craft DC; nothing to repair when whole; none without the Ranks",
    [V.vehicleRepairables(ace).map(entry => [entry.item.name, entry.kind, entry.specialty, entry.craftDC, entry.why]), V.vehicleRepairables(novice).length],
    [[["Air Car", "vehicle", "craftVehicles", "expert", ""]], 0]);
  globalThis.Roll = class { constructor(formula) { this.formula = formula; } async evaluate() { this.total = 13; return this; } };
  const repaired = await V.repairVehicle(ace, "Actor.car5");
  check("repaired: 2d10(bT) plus Craft (Vehicles) back in its Life Points, no more than its Maximum",
    [repaired.text, car.system.life.value], ["Air Car: 13 (4d10) + 7 (Craft (Vehicles)) = 20 Life Points back.", 50]);
  check("Full Repair: a fifth of its Maximum Life Points for each 2 hours", [await V.fullRepairVehicle("Actor.car5", 1), car.system.life.value],
    ["Air Car regains 10 Life Points (1/5 of its Maximum)", 60]);
  check("Tune Up: its Vehicle Level the Power Level of who did it", [await V.tuneUpVehicle("Actor.car5", ace), car.system.vehicleLevel],
    ["Air Car is Vehicle Level 9", 9]);
  check("Create: a Vehicle Actor - its Grade the Difficulty's, its Vehicle Level and Creator its maker",
    [V.vehicleDataFor(ace, { difficulty: "master" }).system, V.vehicleDataFor(ace, { difficulty: "novice" }).system.grade, V.vehicleDataFor(ace).name],
    [{ grade: 4, vehicleLevel: 9, creator: "Actor.ace" }, 1, "Yamcha's Vehicle"]);
  globalThis.game.actors = [];
}
const UM5 = read("module", "use-maneuver.mjs"), CH5 = read("module", "chat.mjs"), SH5 = read("module", "sheets", "actor-character-sheet.mjs");
check("wired: the Ride asked as an Instant first; Eject only from a Vehicle, done on its card; Way of the Pilot asked; Repair's, Full "
  + "Repair's, Tune Up's and Create's Vehicle; Travel's By Vehicle ticked in one",
  [UM5.includes('if (maneuver.id === "ride") maneuver = await rideAsInstant(actor, maneuver);'),
   UM5.includes('if ((maneuver.id === "eject") && !vehicleOf(actor)) {'), UM5.includes("declared = await askWayOfThePilot(actor, vehicle, declared, targetActor);"),
   UM5.includes("const options = [...repairables(actor), ...vehicleRepairables(actor)];"),
   CH5.includes('if (repair.kind === "vehicle") {'), CH5.includes("if (repair.vehicleUuid) return (await import(\"./vehicles.mjs\")).fullRepairVehicle("),
   CH5.includes("if (adventuring.tuneUp) said.push("), CH5.includes('if (create.kind === "vehicle") await (await import("./vehicles.mjs")).makeVehicle('),
   SH5.includes('if (definition.id === "tune-up") {'), SH5.includes('<input type="checkbox" name="vehicle" ${vehicleHolding(this.actor) ? "checked" : ""}/>')],
  [true, true, true, true, true, true, true, true, true, true]);

// --- After stage 5: Adjustable, Hikou, the Capsule, a Pilot's stores -------------------------------------------------------------
{
  const user = { id: "u1", active: true, isGM: true, isActiveGM: true };
  globalThis.game.user = user;
  globalThis.game.users = Object.assign([user], { activeGM: user });
  check("Adjustable: Favored Environment set to its own, or one of Adjustable's two as the sheet says; nothing without Favored Environment",
    [V.favoredEnvironment({ system: { qualities: [{ id: "vehicle-favored-environment", choices: ["bog-environment"] }], activeEnvironment: "" } }),
     V.favoredEnvironment({ system: { qualities: [{ id: "vehicle-favored-environment", choices: ["bog-environment"] },
       { id: "vehicle-adjustable", choices: ["lava-environment", "underwater-environment"] }], activeEnvironment: "lava-environment" } }),
     V.favoredEnvironment({ system: { qualities: [{ id: "vehicle-favored-environment", choices: ["bog-environment"] }], activeEnvironment: "lava-environment" } }),
     V.favoredEnvironment({ system: { qualities: [], activeEnvironment: "lava-environment" } })],
    ["bog-environment", "lava-environment", "bog-environment", ""]);

  const scene = { id: "s6", grid: { size: 100 }, tokens: [] };
  scene.tokens.get = id => scene.tokens.find(token => token.id === id);
  const deleted = [];
  const created = [];
  scene.deleteEmbeddedDocuments = async (kind, ids) => { deleted.push(...ids); };
  scene.createEmbeddedDocuments = async (kind, data) => { created.push(...data); };
  globalThis.canvas = { scene, grid: { size: 100 } };
  globalThis.game.scenes = [scene];
  const made = (uuid, name, system, { type = "character", x = null, y = null, owner = true } = {}) => {
    const doc = (x === null) ? null : { id: `t-${uuid}`, actorId: uuid, x: x * 100, y: y * 100, width: 1, height: 1, hidden: false, parent: scene,
      isOwner: true, documentName: "Token" };
    if (doc) scene.tokens.push(doc);
    const flags = {};
    const actor = { id: uuid, uuid, name, type, isOwner: owner, testUserPermission: () => true, system, items: [], getActiveTokens: () => (doc ? [doc] : []),
      getFlag: (scope, key) => flags[key], setFlag: async (scope, key, value) => { flags[key] = value; }, unsetFlag: async (scope, key) => { delete flags[key]; },
      getTokenDocument: async at => ({ toObject: () => ({ actorId: uuid, ...at }) }),
      update: async changes => { for (const [key, value] of Object.entries(changes)) foundry.utils.setProperty(actor, key, value); } };
    ACTORS.set(uuid, actor);
    return actor;
  };
  const bike = made("Actor.bike", "Capsule Bike", { crew: { pilot: "", passengers: [], remote: false }, qualities: [{ id: "vehicle-capsule" }],
    reading: { size: { cols: 1, rows: 1 } } }, { type: "vehicle", x: 6, y: 6 });
  const busy = made("Actor.busy", "Busy Bike", { crew: { pilot: "Actor.x", passengers: [], remote: false }, qualities: [{ id: "vehicle-capsule" }] }, { type: "vehicle" });
  const plain = made("Actor.plain", "Plain Car", { crew: { pilot: "", passengers: [], remote: false }, qualities: [] }, { type: "vehicle" });
  const theirs = made("Actor.theirs", "Their Bike", { crew: { pilot: "", passengers: [], remote: false }, qualities: [{ id: "vehicle-capsule" }] }, { type: "vehicle", owner: false });
  const bulma = made("Actor.bul", "Bulma", {}, { x: 2, y: 2 });
  globalThis.game.actors = [bike, busy, plain, theirs, bulma];
  check("a Capsule takes a Vehicle of theirs with the Capsule Quality and nobody in it", V.capsuleVehicles(bulma).map(each => each.name), ["Capsule Bike"]);
  const capsule = made("Item.cap", "Capsule", {});
  bulma.items = [capsule];
  await V.storeVehicle(capsule, bike);
  check("stored: the Capsule holds it, its token off the scene, and no other Capsule takes it",
    [capsule.getFlag("dbu-ttrpg", "vehicleStored"), deleted, V.capsuleVehicles(bulma).length], ["Actor.bike", ["t-Actor.bike"], 0]);
  const thrown = await V.throwVehicle(bulma, capsule);
  check("thrown: its token beside its thrower, the Capsule empty again",
    [thrown, created, capsule.getFlag("dbu-ttrpg", "vehicleStored")],
    ["Bulma throws Capsule, and Capsule Bike appears beside them.", [{ actorId: "Actor.bike", x: 100, y: 100 }], undefined]);

  // Hikou: its Pilot's High Environment its Passengers'.
  const sky = made("Actor.sky", "Sky Car", { crew: { pilot: "Actor.p6", passengers: ["Actor.q6"], remote: false }, qualities: [{ id: "vehicle-hikou" }] }, { type: "vehicle" });
  const pilot = made("Actor.p6", "Pilot", { battlefield: { highEnvironment: 2 } });
  const rider = made("Actor.q6", "Rider", { battlefield: { highEnvironment: 0 } });
  globalThis.game.actors = [sky, pilot, rider];
  const hooks = {};
  globalThis.Hooks = { on: (name, fn) => { (hooks[name] ??= []).push(fn); } };
  V.registerVehicleHooks();
  for (const fn of hooks.updateActor ?? []) await fn(pilot, { system: { battlefield: { highEnvironment: 2 } } }, {}, "u1");
  check("Hikou: its Pilot Soars it, its Passengers with it", rider.system.battlefield.highEnvironment, 2);
  sky.system.qualities = [];
  pilot.system.battlefield.highEnvironment = 3;
  for (const fn of hooks.updateActor ?? []) await fn(pilot, { system: { battlefield: { highEnvironment: 3 } } }, {}, "u1");
  check("without Hikou, nothing carried", rider.system.battlefield.highEnvironment, 2);
  globalThis.game.actors = [];
}
const UM6 = read("module", "use-maneuver.mjs");
check("a Pilot's Jetpack pays nothing of the Vehicle's Movement, nor their Energy-Suction Device of its attacks",
  [UM6.includes("const moving = (crossing && !pilotedBy(actor)) ? movementPayment("), UM6.includes("  if (pilotedBy(actor)) return false;")], [true, true]);

// --- Remote Controlled, the Energy Charge --------------------------------------------------------------------------------------
{
  const CREW = await import(modUrl("vehicle-crew.mjs"));
  const answers = [];
  globalThis.foundry.applications = { api: { DialogV2: { wait: async () => answers.shift() ?? null } } };
  const user = { id: "u1", active: true, isGM: true, isActiveGM: true };
  globalThis.game.user = user;
  globalThis.game.users = Object.assign([user], { activeGM: user });
  globalThis.ui.notifications.warn = () => {};
  const made = (uuid, name, system, type = "character") => {
    const flags = {};
    const actor = { uuid, name, type, isOwner: true, testUserPermission: () => true, system, items: [], getActiveTokens: () => [],
      getFlag: (scope, key) => flags[key], setFlag: async (scope, key, value) => { flags[key] = value; },
      update: async changes => { for (const [key, value] of Object.entries(changes)) foundry.utils.setProperty(actor, key, value); } };
    ACTORS.set(uuid, actor);
    return actor;
  };
  const drone = made("Actor.drone", "Drone", { crew: { pilot: "", passengers: [], remote: false }, life: { value: 50, max: 50 },
    qualities: [{ id: "vehicle-remote-controlled" }] }, "vehicle");
  const plain = made("Actor.plain7", "Plain Car", { crew: { pilot: "", passengers: [], remote: false }, life: { value: 50 }, qualities: [] }, "vehicle");
  const bulma = made("Actor.b7", "Bulma", { skills: { pilot: { ranks: 1 } } });
  const goku = made("Actor.g7", "Goku", { skills: { pilot: { ranks: 2 } } });
  globalThis.game.actors = [drone, plain, bulma, goku];
  const remote = made("Item.remote", "Remote Control", {});
  check("a Remote Control connects to a Vehicle with Remote Controlled", V.remoteVehicles().map(each => each.name), ["Drone"]);
  await remote.setFlag("dbu-ttrpg", V.REMOTE_VEHICLE, "Actor.drone");
  check("Piloting it from afar: Bulma its Pilot, not in it", [await V.toggleRemotePilot(bulma, remote), drone.system.crew,
    V.pilotedBy(bulma)?.name, V.vehicleOf(bulma), CREW.pilotedVehicle(bulma)?.name, CREW.vehicleHolding(bulma), V.aboard(drone)],
    ["Bulma Pilots Drone from afar, by Remote Control.", { pilot: "Actor.b7", passengers: [], remote: true }, "Drone", null, "Drone", null, []]);
  check("a Pilot in every way - bound as one, no Unique Ability - but not sheltered, nor an attack at them turned to it",
    [V.whyNotInVehicle(bulma, { tags: ["uniqueAbility"] }), CREW.shelteredBy(bulma), CREW.vehicleTargets(bulma).target.name],
    ["Bulma is Piloting Drone: no Unique Abilities.", { ground: false, airTight: false }, "Bulma"]);
  check("not while it has a Pilot", V.whyNotRemote(goku, drone), 'Drone has a Pilot: "You cannot use this effect if the Vehicle ... has a Pilot."');
  check("nor one without the Quality", V.whyNotRemote(goku, plain), "Plain Car has no Remote Controlled Quality.");
  // Goku gets in and takes its controls from her: willing - nothing to swap; she is in nothing.
  drone.system.crew = { pilot: "Actor.b7", passengers: ["Actor.g7"], remote: true };
  answers.push("yes");
  const taken = await V.doRide(goku, { id: "ride", name: "Ride" }, { vehicle: drone, action: "pilot" });
  check("one in it takes the controls from afar's Pilot: theirs, in it", [taken, drone.system.crew],
    ["Bulma lets Goku take Drone's controls from afar.", { pilot: "Actor.g7", passengers: [], remote: false }]);
  drone.system.crew = { pilot: "Actor.b7", passengers: [], remote: true };
  check("stopped", [await V.toggleRemotePilot(bulma, remote), drone.system.crew], ["Bulma stops Piloting Drone from afar.",
    { pilot: "", passengers: [], remote: false }]);
  globalThis.game.actors = [];
}
check("the Energy Charge Maneuver paid by the Vehicle too (the user's)",
  read("module", "maneuvers.mjs").includes("(maneuver?.attacking || maneuver?.movement || maneuver?.profile || maneuver?.charge) ? pilotedBy(actor) : null;"), true);
check("the Remote Control's row: a Vehicle to connect, and Pilot it / Stop Piloting",
  [read("templates", "parts", "actor-gear.hbs").includes('data-action="connectRemoteVehicle"'), read("templates", "parts", "actor-gear.hbs").includes('data-action="remotePilot"'),
   read("module", "sheets", "actor-character-sheet.mjs").includes("remotePilot: DBUCharacterSheet._onRemotePilot")], [true, true, true]);

// --- Big Blaster, the Weapons' Grade, every remote, collisions ------------------------------------------------------------------
{
  const weapon = at => ({ getFlag: (scope, key) => (key === "vehicleWeapon" ? at : undefined) });
  const blasting = slots => ({ uuid: "Actor.gun", system: { qualities: [{ id: "vehicle-big-blaster", slots, choices: ["1"] }] } });
  check("Big Blaster: the Vehicle Weapon picked for it - a Minor Sphere, not on its own Squares; an Absolute Attack at 2 Slots; none for another",
    [V.bigBlasterFor(blasting(1), weapon(1)), V.bigBlasterFor(blasting(2), weapon(1))?.absolute, V.bigBlasterFor(blasting(2), weapon(0))],
    [{ area: { shape: "sphere", magnitude: "minor", centredOnSquare: true, notOn: "Actor.gun", source: "Big Blaster" }, absolute: false }, true, null]);
  const reading = vehicle({ qualities: [q("big-blaster", 1, ["0"])] }).reading.qualities[0];
  check("Big Blaster chooses one Vehicle Weapon", [reading.choose, reading.chooseWeapon, reading.choices], [1, true, ["0"]]);

  // The Weapons' Grade its Vehicle's.
  const hooks = {};
  globalThis.Hooks = { on: (name, fn) => { (hooks[name] ??= []).push(fn); } };
  globalThis.game.user = { id: "u1", isGM: true };
  V.registerVehicleHooks();
  const written = [];
  const car = { type: "vehicle", system: { grade: 4, crew: { pilot: "", passengers: [] }, qualities: [] },
    items: [{ id: "w1", system: { crafted: { grade: 3 } }, getFlag: (s, k) => (k === "vehicleWeapon" ? 0 : undefined) },
      { id: "w2", system: { crafted: { grade: 4 } }, getFlag: (s, k) => (k === "vehicleWeapon" ? 1 : undefined) },
      { id: "x", system: { crafted: { grade: 1 } }, getFlag: () => undefined }],
    updateEmbeddedDocuments: async (kind, updates) => written.push(...updates) };
  for (const fn of hooks.updateActor ?? []) await fn(car, { system: { grade: 4 } }, {}, "u1");
  check("its Grade changed: its Vehicle Weapons' with it, nothing else's", written, [{ _id: "w1", "system.crafted.grade": 4 }]);

  // Every device that reaches a Vehicle.
  check("what reaches a Vehicle from afar: the Remote Control one connected; a Support Buddy any of theirs; a Controller Weapon one, or any at 2 Slots; anything else none",
    [V.vehicleRemoteMode({ system: { gearId: "remote-control" } }), V.vehicleRemoteMode({ system: { itemType: "buddy" } }, ["bomb"]),
     V.vehicleRemoteMode({ system: { itemType: "buddy" } }, []), V.vehicleRemoteMode({ system: {} }, ["vehicle"], false),
     V.vehicleRemoteMode({ system: {} }, ["vehicle"], true), V.vehicleRemoteMode({ system: {} }, ["bomb"])],
    ["one", "any", "", "one", "any", ""]);
  check("the Controller Weapon may be attuned to Vehicles", getTrait("controller-weapon").choices, ["bomb=Bomb", "shock-collar=Collar", "vehicle=Vehicle"]);

  // Collisions: its own Damage off a Feature or the ground, theirs off it.
  const truck = { system: { hardnessRank: 4, baseTierOfPower: 2 } };
  const hit = [{ name: "Goku", system: { baseTierOfPower: 3 } }];
  check("a Feature or the ground: its Life Points by that Hardness Value at its own Tier; a Character: theirs by its Hardness at theirs",
    [V.collisionCosts(truck, { kind: "feature", rank: 3 }).map(each => each.amount), V.collisionCosts(truck, { kind: "ground", rank: 0 }).map(each => each.amount),
     V.collisionCosts(truck, { kind: "character" }, hit).map(each => [each.target.name, each.amount])],
    [[12], [2], [["Goku", 24]]]);
}
const T8 = read("templates", "parts", "actor-gear.hbs"), UM8 = read("module", "use-maneuver.mjs");
check("wired: Big Blaster on the attack; the remote buttons on every device's row; the Collision button; a Character's Collision Damage as any",
  [UM8.includes("const blaster = bigBlasterFor(vehicle, item);"), (T8.match(/\{\{#if row\.vehicleRemote\}\}/g) ?? []).length,
   read("templates", "parts", "vehicle-main.hbs").includes('data-action="collide"'), read("module", "chat.mjs").includes("export async function collisionTaken(target, amount")],
  [true, 3, true, true]);

console.log(failed ? `${failed} failing` : "all passing");
process.exit(failed ? 1 : 0);
