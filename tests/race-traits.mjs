/**
 * A character's Racial Traits by its race (the user's, 2026-11-27): what each race gives by itself, what is picked on the Progression tab
 * (the Majins' 4, a Minion's 2), what a race Trait may be exchanged for, and the wiring - the sheet, the hooks, the one-time reset.
 */

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
globalThis.foundry.data = { ...await import(appUrl("common/data/_module.mjs")) };
const { default: DataModel } = await import(appUrl("common/abstract/data.mjs"));
globalThis.foundry.abstract = { DataModel, TypeDataModel: DataModel };
globalThis.ui = { notifications: { warn: () => {}, error: () => {}, info: () => {} } };
globalThis.Handlebars = { escapeExpression: String };
globalThis.game = { combat: null, users: { activeGM: null } };

// The traits' and the races' files, as Foundry would fetch them.
globalThis.foundry.utils.fetchJsonWithTimeout = async url => JSON.parse(fs.readFileSync(String(url).includes("/races/")
  ? path.join(ROOT, "races", String(url).split("/races/")[1]) : path.join(ROOT, "traits", "index.json"), "utf8"));
globalThis.fetch = async url => {
  const relative = String(url).replace("systems/dbu-ttrpg/", "");
  const file = path.join(ROOT, relative);
  if (!fs.existsSync(file)) return { ok: false, status: 404, statusText: "missing" };
  return { ok: true, status: 200, text: async () => fs.readFileSync(file, "utf8"), json: async () => JSON.parse(fs.readFileSync(file, "utf8")) };
};
const warn = console.warn;
console.warn = () => {};
const { loadTraits, getTrait } = await import(modUrl("effects/traits.mjs"));
const { loadRaces, getRace } = await import(modUrl("races.mjs"));
await loadTraits();
await loadRaces();
console.warn = warn;
const RT = await import(modUrl("race-traits.mjs"));

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

const actor = (type, system, items = []) => ({ type, system: { racialPicks: [], ...system }, items, getFlag: () => undefined });
const ids = files => files.map(file => file.id).sort();
const item = (sourceId, extra = {}) => ({ id: `i-${sourceId}`, type: "racial", system: { ...(extra.system ?? {}) },
  flags: { "dbu-ttrpg": { sourceId, ...(extra.flags ?? {}) } } });

check("races read: the Majins pick 4 Secondary Racial Traits", getRace("majin")?.secondaryChoices, 4);

const saiyan = RT.raceTraitPlan(actor("character", { race: "saiyan" }));
check("a Saiyan: all its Primary and Secondary by itself, nothing to pick", [ids(saiyan.auto), saiyan.pool.length, saiyan.choose],
  [["blood-of-the-warrior", "born-for-battle", "powerful-physique", "saiyan-heritage", "warriors-pride"], 0, 0]);

const majin = RT.raceTraitPlan(actor("character", { race: "majin", racialPicks: ["bouncy-physique", "majin-malice", "born-for-battle"] }));
check("a Majin: its 2 Primary by itself, 4 of its 16 Secondary picked - a pick not its race's not counted",
  [ids(majin.auto), majin.pool.length, majin.choose, majin.picked, majin.wanted.length],
  [["majin-regeneration", "rubbery-body"], 16, 4, ["bouncy-physique", "majin-malice"], 4]);

const namekian = RT.raceTraitPlan(actor("character", { race: "namekian", subrace: "warrior-clan" }));
check("a Namekian of the Warrior Clan: its Subrace Trait, not the Dragon Clan's", [ids(namekian.auto).includes("refined-combat"),
  ids(namekian.auto).includes("spirit-of-namek")], [true, false]);

const minion = RT.raceTraitPlan(actor("minion", { race: "saiyan" }));
check("a Saiyan Minion: its Primary by itself, 2 of its Secondary (and Subrace) Traits picked", [ids(minion.auto), minion.pool.length, minion.choose, minion.minion],
  [["born-for-battle", "saiyan-heritage"], 3, 2, true]);
check("not a Duplicate's (its Master's copied), nor a Fusion's, nor one with no race",
  [RT.raceTraitPlan(actor("minion", { race: "saiyan", duplicate: true })), RT.raceTraitPlan(actor("fusion", { race: "saiyan" })),
   RT.raceTraitPlan(actor("character", { race: "" }))], [null, null, null]);

// Exchanging: a Primary only for a Factor Trait that names it; a Secondary for a Secondary Factor Trait.
const goopy = actor("character", { race: "majin", subrace: "", effects: { slots: {} } }, [item("majin-regeneration"), item("rubbery-body"), item("bouncy-physique")]);
const regeneration = RT.exchangeChoices(goopy, goopy.items[0]);
const bouncy = RT.exchangeChoices(goopy, goopy.items[2]);
check("Majin Regeneration may be exchanged (From Goop names it), Rubbery Body not, a Secondary always",
  [RT.exchangeable(goopy, goopy.items[0]), RT.exchangeable(goopy, goopy.items[1]), RT.exchangeable(goopy, goopy.items[2])], [true, false, true]);
check("its choices: Traces of Majin and From Goop for Majin Regeneration (both name it); for a Secondary, Secondary Factor Traits - a Saiyan's dimmed with why",
  [regeneration.choices.map(choice => choice.id), bouncy.choices.length > 10, bouncy.choices.every(choice => getTrait(choice.id)?.importance === "secondary"),
   bouncy.choices.some(choice => (choice.id === "warrior-of-two-worlds") && Boolean(choice.why))],
  [["traces-of-majin", "from-goop"], true, true, true]);
const exchanged = { id: "i-from-goop", type: "racial", system: { factor: "primordial-majin" },
  flags: { "dbu-ttrpg": { sourceId: "from-goop", exchangedFor: "majin-regeneration" } } };
check("an exchanged Factor Trait stands for what it replaced: exchangeable again, to restore it", [RT.slotOf(exchanged), RT.exchangeable(goopy, exchanged),
  RT.exchangeChoices(goopy, exchanged).original?.id], ["majin-regeneration", true, "majin-regeneration"]);

// Its text names what it replaced in brackets, as a Primary's Factor Trait prints it - not where it names one already.
{
  const RAC = await import(modUrl("racial.mjs"));
  const first = (id, exchangedFor) => RAC.racialTraitLines({ type: "racial", system: { factor: getTrait(id).owner, text: getTrait(id).text, chosen: [] },
    flags: { "dbu-ttrpg": { sourceId: id, exchangedFor } } })[0]?.html ?? "";
  check("an exchanged Factor Trait's text: \"Dormant Saiya Power (Body) [Blood of the Warrior]:\"; Alternative Warrior Race keeps its own [Powerful Physique]",
    [first("dormant-saiya-power", "blood-of-the-warrior").startsWith("Dormant Saiya Power (Body) [Blood of the Warrior]: "),
     first("alternative-warrior-race", "warriors-pride").startsWith("Alternative Warrior Race (Body) [Powerful Physique]: "),
     first("dormant-saiya-power", "").startsWith("Dormant Saiya Power (Body): ")], [true, true, true]);
}

const SHEET = read("module", "sheets", "actor-character-sheet.mjs");
const ENTRY = read("module", "dbu-ttrpg.mjs");
const TRAITS = read("templates", "parts", "actor-traits.hbs");
check("wired: Add Racial Trait only with Debug's toggle; the exchange button in place of the cross on a race Trait; the picks on Progression; the hooks; the reset once",
  [TRAITS.includes("{{#if system.debug.showAddRacialTrait}}"), TRAITS.includes('data-action="exchangeRacialTrait"'),
   read("templates", "parts", "actor-progression.hbs").includes('data-action="pickRacialTraits"'),
   read("templates", "parts", "actor-settings.hbs").includes('name="system.debug.showAddRacialTrait"'),
   SHEET.includes("exchangeRacialTrait: DBUCharacterSheet._onExchangeRacialTrait,"), ENTRY.includes("  registerRaceTraitHooks();"),
   ENTRY.includes('game.settings.get("dbu-ttrpg", "raceTraitsReset")')],
  [true, true, true, true, true, true, true]);

console.log(failed ? `\n${failed} failing` : "\n0 failing");
if (failed) process.exitCode = 1;
