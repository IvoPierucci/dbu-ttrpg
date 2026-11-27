// A Quality entry's Free (`free`) and Combat Plating's mark (`granted`) through DBUGearData's schema, Uses Foundry's own data layer
// and the system's real item-gear.mjs.
import { pathToFileURL } from "node:url";
import path from "node:path";
const APP = (process.env.FOUNDRY_APP || String.raw`C:\Program Files\Foundry Virtual Tabletop\resources\app`);
const ROOT = process.argv[2];
const url = p => pathToFileURL(path.join(APP, p)).href;
globalThis.CONST = {}; globalThis.foundry = {};
await import(url("common/primitives/_module.mjs"));
const utils = await import(url("common/utils/_module.mjs"));
globalThis.foundry.utils = utils;
const fields = await import(url("common/data/fields.mjs"));
const operators = await import(url("common/data/operators.mjs"));
const { default: DataModel } = await import(url("common/abstract/data.mjs"));
globalThis.foundry.abstract = { DataModel };
globalThis.foundry.data = { fields, operators };
const { default: TypeDataModel } = await import(url("common/abstract/type-data.mjs"));
globalThis.foundry.abstract.TypeDataModel = TypeDataModel;
const { default: DBUGearData } = await import(pathToFileURL(path.join(ROOT, "module/data/item-gear.mjs")).href);
const gear = await import(pathToFileURL(path.join(ROOT, "module/gear.mjs")).href);

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

const armed = { id: "armed", slots: 0, choice: "", on: false, name: "", free: true, granted: true };
const plain = { id: "durable", slots: 1, choice: "", on: false, name: "" };
const schema = DBUGearData.schema.fields.crafted.fields.qualities;
// What is stored: cleaned as on create and update.
const stored = schema.clean([armed, plain]);
check("free survives cleaning", stored.map(e => e.free), [true, false]);
check("granted survives cleaning", stored.map(e => e.granted), [true, false]);
const failure = schema.validate(stored);
check("cleaned entries validate", failure === undefined || failure === null, true);
// A whole model built from the source keeps both.
const model = new DBUGearData({ crafted: { qualities: [armed, plain] } });
check("model keeps free", model.crafted.qualities.map(e => e.free), [true, false]);
check("toObject keeps granted", model.toObject().crafted.qualities.map(e => e.granted), [true, false]);
// An entry written before the fields: read as neither.
const old = new DBUGearData({ crafted: { qualities: [plain] } });
check("old entry reads as not free, not granted", [old.crafted.qualities[0].free, old.crafted.qualities[0].granted], [false, false]);
const migrated = new DBUGearData(DBUGearData.migrateData({ crafted: { qualities: ["durable"] } }));
check("migrated string id neither", [migrated.crafted.qualities[0].free, migrated.crafted.qualities[0].granted], [false, false]);

// qualityEntries carries both, and slotsTaken reads free from there.
const entries = gear.qualityEntries(model.crafted);
check("qualityEntries carries free", entries.map(e => e.free), [true, false]);
check("qualityEntries carries granted", entries.map(e => e.granted), [true, false]);
check("qualityEntries of a string id", gear.qualityEntries({ qualities: ["x"] }).map(e => [e.free, e.granted]), [[false, false]]);
check("slotsTaken 0 for free", gear.slotsTaken(entries[0], { slots: "1" }), 0);
check("slotsTaken least for others", gear.slotsTaken(entries[1], { slots: "1" }), 1);

// The sheet's Free toggle, as _onFreeQuality maps it: the player's, both ways.
const toggle = (list, index) => list.map((e, at) => (at === index) ? { ...e, free: !e.free } : e);
const unticked = toggle(entries, 0);
check("Free unticked: takes its Slots", gear.slotsTaken(unticked[0], { slots: "1" }), 1);
check("Free unticked: still granted", unticked[0].granted, true);
const ticked = toggle(entries, 1);
check("Free ticked on the player's own: takes none", gear.slotsTaken(ticked[1], { slots: "1~2" }), 0);
check("Free ticked on the player's own: not granted", ticked[1].granted, false);
// And it survives saving, as the sheet's update stores it.
check("toggled entries survive cleaning", schema.clean(ticked).map(e => e.free), [true, true]);

// Free costs nothing but is as strong as its Slots: $slots reads what it was given.
check("slotsGiven held to range", gear.slotsGiven({ slots: 2, free: true }, { slots: "1~2" }), 2);
const getTrait = id => ({
  armor: { id: "armor", name: "Armor", kind: "crafting", script: "" },
  tough: { id: "tough", name: "Tough", kind: "crafting", slots: "1~3", script: "piece.lp += $slots" }
})[id];
const crafted = free => ({ kind: "apparel", category: "armor", grade: 1,
  qualities: [{ id: "tough", slots: 3, choice: "", on: false, name: "", free }] });
const paid = gear.composeEffects(crafted(false), "", { getTrait });
const gratis = gear.composeEffects(crafted(true), "", { getTrait });
check("$slots written as its 3 Slots", paid.includes("piece.lp += 3"), true);
check("and the same with Free ticked", gratis, paid);

// platingQuality's removal filter, on granted: Free's state does not matter.
const removal = list => list.filter(e => !((e.id === "armed") && e.granted)).map(e => e.id);
check("removal drops the granted entry", removal(entries), ["durable"]);
check("removal drops it with Free unticked too", removal(unticked), ["durable"]);
const own = gear.qualityEntries({ qualities: [{ id: "armed", slots: 0, free: true }] });
check("removal keeps the player's own Armed, Free or not", removal(own), ["armed"]);

console.log(failed ? `${failed} failing` : "all passing");
process.exit(failed ? 1 : 0);
