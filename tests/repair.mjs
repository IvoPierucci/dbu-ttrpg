// The Repair Maneuver: what it can mend, at what DC, and what it gives back.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
const APP = (process.env.FOUNDRY_APP || String.raw`C:\Program Files\Foundry Virtual Tabletop\resources\app`);
const appUrl = p => pathToFileURL(path.join(APP, p)).href;
const modUrl = p => pathToFileURL(path.join(ROOT, "module", p)).href;
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

globalThis.CONST = {};
globalThis.foundry = {};
await import(appUrl("common/primitives/_module.mjs"));
globalThis.foundry.utils = { ...await import(appUrl("common/utils/_module.mjs")) };
globalThis.foundry.data = await import(appUrl("common/data/_module.mjs"));
const { default: DataModel } = await import(appUrl("common/abstract/data.mjs"));
globalThis.foundry.abstract = { DataModel, TypeDataModel: DataModel };
globalThis.ui = { notifications: { warn: () => {}, error: () => {}, info: () => {} } };
globalThis.Handlebars = { escapeExpression: text => String(text) };
const TRAITS = path.join(ROOT, "traits");
globalThis.foundry.utils.fetchJsonWithTimeout = async () => JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));
globalThis.fetch = async url => {
  const file = path.join(TRAITS, String(url).replace("systems/dbu-ttrpg/traits/", ""));
  return fs.existsSync(file) ? { ok: true, text: async () => fs.readFileSync(file, "utf8") } : { ok: false };
};
const traits = await import(modUrl("effects/traits.mjs"));
await traits.loadTraits();
const { default: DBUCharacterData } = await import(modUrl("data/actor-character.mjs"));
const gear = await import(modUrl("gear.mjs"));

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};
function source(text, name) {
  const at = text.search(new RegExp(`(export )?(async )?function ${name}\\(`));
  if (at < 0) return "";
  const next = text.slice(at + 1).search(/\n(export )?(async )?function |\n\/\*\*/);
  return (next < 0 ? text.slice(at) : text.slice(at, at + 1 + next)).replace(/^export /, "");
}
const USE = read("module", "use-maneuver.mjs");
const CHAT = read("module", "chat.mjs");

// --- The file, and what opens it ----------------------------------------------------------------------
{
  const trait = traits.getTrait("repair");
  check("the Maneuver: Standard, 2 Actions, once an Encounter, Special",
    [trait?.name, trait?.type, trait?.actionCost, String(trait?.usageLimit), trait?.special, trait?.repair],
    ["Repair", "standard", 2, "1/encounter", true, true]);
  check("its text as given", String(trait?.text ?? "").includes("regain 2 Break Value for that piece of Apparel"), true);
  check("two Ranks of any Craft open it",
    ["craft", "craftApparel", "craftWeapons", "craftVehicles"].map(key => DBUCharacterData.SKILLS[key].specialManeuver),
    ["repair", "repair", "repair", "repair"]);
}

// --- What it can mend ---------------------------------------------------------------------------------
{
  const repairables = new Function("DBUCharacterData", "gearReadingModule", "getTrait",
    `${source(USE, "repairables")}; return repairables;`)(DBUCharacterData, gear, traits.getTrait);
  const piece = (id, kind, crafted = {}) => ({ id, name: id, system: { crafted: {
    kind, grade: 2, category: kind === "weapon" ? "swords" : "standard-clothing", lifeLost: 0, breakLost: 0,
    destroyed: false, qualities: [], ...crafted } } });
  // Ranks in the Crafts named - "weapons,apparel" is a Rank in Craft (Weapons) and one in Craft (Apparel).
  const actor = (specialties, items) => ({ items, system: { powerLevel: 1, skills: Object.fromEntries(
    specialties.split(",").map(each => [{ weapons: "craftWeapons", apparel: "craftApparel" }[each], { ranks: 1 }])) } });
  const items = [piece("Sword", "weapon", { lifeLost: 12 }), piece("Coat", "apparel", { breakLost: 1 }),
    piece("Shield", "weapon")];
  const both = repairables(actor("weapons,apparel", items));
  check("a hurt Weapon and a worn piece of Apparel: both, with their Craft DC",
    both.slice(0, 2).map(entry => [entry.item.id, entry.why, Boolean(DBUCharacterData.DIFFICULTIES[entry.craftDC])]),
    [["Sword", "", true], ["Coat", "", true]]);
  check("a whole one has nothing to repair", both[2].why, "nothing to repair");
  const weaponsOnly = repairables(actor("weapons", items));
  check("without Ranks in Craft (Apparel), the Apparel is refused (the table's ruling)",
    weaponsOnly[1].why, "needs Ranks in Craft (Apparel)");
  check("and without Craft (Weapons), the Weapon", repairables(actor("apparel", items))[0].why, "needs Ranks in Craft (Weapons)");
  const broken = repairables(actor("weapons", [piece("Axe", "weapon", { destroyed: true })]));
  check("a broken one can be mended (the table's ruling)", broken[0].why, "");
}

// --- What it gives back -------------------------------------------------------------------------------
{
  const amount = new Function("REPAIR_BREAK_VALUE", `${source(CHAT, "repairAmount")}; return repairAmount;`)(2);
  check("a Weapon: 2d10(bT) plus the Craft Skill Bonus", amount("weapon", { dice: 11, skillBonus: 6 }), 17);
  check("Apparel: 2 Break Value", amount("apparel", {}), 2);
  const mend = source(CHAT, "repairGear");
  check("the dice are 2d10 a base Tier", mend.includes("const roll = await new Roll(`${2 * baseTier}d10`).evaluate();"), true);
  check("a broken one is whole again", (mend.match(/"system\.crafted\.destroyed": false/g) ?? []).length, 2);
  check("one press, one repair", mend.indexOf("applied: true") < mend.indexOf("await item.update("), true);
  check("the Item is picked before anything is paid",
    USE.indexOf("repairing = await askRepair(actor);") > 0
      && (USE.indexOf("repairing = await askRepair(actor);") < USE.indexOf("? await postRepair(actor, maneuver, repairing)")),
    true);
}

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
