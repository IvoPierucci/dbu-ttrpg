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

// Greater Mutation (3) / Mastered Reincarnated (1): `restoreReplaced.<factor>` keeps the exchanged Factor Trait and has the race Trait again.
{
  const brute = { id: "i-brute", type: "racial", system: { factor: "mutation" }, flags: { "dbu-ttrpg": { sourceId: "brute", exchangedFor: "powerful-physique" } } };
  const saiyanItems = () => RT.raceTraitPlan(actor("character", { race: "saiyan" })).auto.filter(file => file.id !== "powerful-physique").map(file => item(file.id));
  const without = actor("character", { race: "saiyan", effects: { slots: {} } }, [...saiyanItems(), brute]);
  const withIt = actor("character", { race: "saiyan", effects: { slots: { "restoreReplaced.mutation": true } } }, [...saiyanItems(), brute]);
  const both = actor("character", { race: "saiyan", effects: { slots: {} } }, [...saiyanItems(), brute, item("powerful-physique")]);
  const bothOn = actor("character", { race: "saiyan", effects: { slots: { "restoreReplaced.mutation": true } } }, [...saiyanItems(), brute, item("powerful-physique")]);
  const other = actor("character", { race: "saiyan", effects: { slots: { "restoreReplaced.reincarnated": true } } }, [...saiyanItems(), brute]);
  check("a replaced race Trait back while its Factor is restored: Brute kept, Powerful Physique given; put by again when not; another Factor's restoring does nothing",
    [RT.raceTraitChanges(without), RT.raceTraitChanges(withIt), RT.raceTraitChanges(both), RT.raceTraitChanges(bothOn), RT.raceTraitChanges(other),
     [...RT.restoredFactors(withIt)]],
    [{ remove: [], add: [] }, { remove: [], add: ["powerful-physique"] }, { remove: ["i-powerful-physique"], add: [] }, { remove: [], add: [] },
     { remove: [], add: [] }, ["mutation"]]);
  check("the race Trait had again does not exchange (its Factor Trait's row does)", [RT.exchangeable(bothOn, bothOn.items.at(-1)), RT.exchangeable(bothOn, brute)],
    [false, true]);
  check("written: Greater Mutation (3) allows restoreReplaced.mutation; Mastered Reincarnated (1) restoreReplaced.reincarnated; the hooks on a Transformation had or put by",
    [/\[passive, effect 3\]\s*allow restoreReplaced\.mutation;/.test(getTrait("greater-mutation-evolutionary-peak")?.script ?? read("traits", "transformations", "awakenings", "greater-mutation", "traits", "evolutionary-peak.dbu")),
     read("traits", "transformations", "awakenings", "inherited-life", "traits", "mastered-reincarnated.dbu").includes("allow restoreReplaced.reincarnated;"),
     read("module", "race-traits.mjs").includes('Hooks.on("createItem", transformationChanged);')], [true, true, true]);
}

// An exchanged Factor Trait listed where the race Trait it replaced stood, not last (the user's, 2026-11-27).
{
  const RAC = await import(modUrl("racial.mjs"));
  const auto = RT.raceTraitPlan(actor("character", { race: "saiyan" })).auto.map(file => file.id);
  const at = auto.indexOf("powerful-physique");
  const brute = { id: "i-brute", name: "Brute", type: "racial", system: { factor: "mutation" }, flags: { "dbu-ttrpg": { sourceId: "brute", exchangedFor: "powerful-physique" } } };
  const rows = [brute, ...auto.filter(id => id !== "powerful-physique").map(id => ({ ...item(id, { system: { race: "saiyan" } }), name: getTrait(id).name }))];
  const listed = RAC.ownedRacialTraits(actor("character", { race: "saiyan", effects: { slots: {} } }, rows)).map(row => row.flags["dbu-ttrpg"].sourceId);
  const order = RAC.ownedRacialTraits(actor("character", { race: "saiyan", effects: { slots: {} } }, auto.map(id => ({ ...item(id, { system: { race: "saiyan" } }), name: getTrait(id).name }))))
    .map(row => row.flags["dbu-ttrpg"].sourceId);
  check("Brute, exchanged for Powerful Physique, listed in its place", [at >= 0, listed.indexOf("brute") === order.indexOf("powerful-physique")], [true, true]);
}

// One window for a race's questions (choice-wizard.mjs); Enhanced Organism exchanges Functional Purpose for an Alternate Upbringing Trait.
{
  const WIZ = read("module", "choice-wizard.mjs");
  const RTS = read("module", "race-traits.mjs");
  check("Enhanced Organism names the exchange; chosen, Functional Purpose is exchanged for an Alternate Upbringing Factor Trait; not chosen, nothing",
    [getTrait("enhanced-organism")?.exchangesRaceTrait, getTrait("enhanced-organism")?.exchangeFactor,
     RT.forcedExchange("functional-purpose", [[{ key: "option", value: "construct" }], [{ key: "option", value: "enhanced-organism" }]]),
     RT.forcedExchange("functional-purpose", [[{ key: "option", value: "construct" }]]), RT.forcedExchange("technological-being", [[{ key: "option", value: "enhanced-organism" }]])],
    ["functional-purpose", "alternate-upbringing", "alternate-upbringing", "", ""]);
  const RACSRC = read("module", "racial.mjs");
  check("the race's Traits asked in one window (Last, Next, its close), made only after; the sync gives them through it; only their own questions drawn there - Foundry's dialogs (an Actor's delete) never taken over",
    [WIZ.includes("if (active && !active.session.finished) return active.session.ask(config);"), !WIZ.includes("DialogV2.wait ="), WIZ.includes('data-wizard="last"'),
     WIZ.includes('data-wizard="next"'), RTS.includes("if (files.length) await addRaceTraitFiles(actor, files);"), !RACSRC.includes("DialogV2.wait(") && !RTS.includes("DialogV2.wait("),
     RTS.includes("const entries = await wizard.rewindable(async () => {"), RTS.includes("made.data.flags[SCOPE].exchangedFor = file.id;"),
     read("module", "racial.mjs").includes("const made = given ?? await racialItemFrom(trait, actor, { presetOption, presetChoice });")],
    [true, true, true, true, true, true, true, true, true]);
}

// The window closed before all is answered (the user's, 2026-11-27): the Trait given all the same, what was not answered empty; Set Racial
// Options finds just that (unansweredOf), and its button goes once all is answered.
{
  const RAC = await import(modUrl("racial.mjs"));
  globalThis.foundry.applications = { api: { DialogV2: { wait: async () => null } } };
  const closed = await RAC.racialItemFrom(getTrait("technological-being"), null, { partial: true });
  const whole = await RAC.racialItemFrom(getTrait("technological-being"), null);
  const purpose = await RAC.racialItemFrom(getTrait("functional-purpose"), null, { partial: true });
  const asItem = made => ({ type: "racial", system: made.data.system, flags: made.data.flags });
  const gaps = item => RAC.unansweredOf(item).map(gap => (gap.kind === "option") ? `option ${gap.group.effect}:${gap.missing}` : `choice ${gap.which}`);
  const answeredItem = { type: "racial", flags: { "dbu-ttrpg": { sourceId: "functional-purpose" } }, system: { chosen: [{ key: "functional-purpose", value: "stealth" },
    { key: "functional-purpose#2", value: "stealth" }, { key: "option", value: "destroyer" }] } };
  check("closed: Technological Being given with no Option and its (1) kept (not given at all without `partial`); Functional Purpose without its choices' part",
    [Boolean(closed), whole, closed?.data.system.chosen, closed?.data.system.script.includes("#@ option"), purpose?.data.system.script.includes("$choice"),
     purpose?.data.system.script],
    [true, null, [], false, false, ""]);
  check("what is left unanswered: Technological Being's (2) one and (3) two; Functional Purpose's two choices and its Option; none once answered",
    [gaps(asItem(closed)), gaps(asItem(purpose)), gaps(answeredItem)],
    [["option 2:1", "option 3:2"], ["choice 1", "choice 2", "option 2:1"], []]);
  delete globalThis.foundry.applications;
  const P = read("templates", "parts", "actor-progression.hbs"), W = read("module", "choice-wizard.mjs");
  check("Set Racial Options on the Racial Grants while any is left; the last question's Next said Done, closing the window at once; a Multi-Option's Next, pressed short of its count, staying on it",
    [P.includes('data-action="setRacialOptions"'), P.includes("{{#if racialUnanswered}}"), read("module", "sheets", "actor-character-sheet.mjs").includes("setRacialOptions: DBUCharacterSheet._onSetRacialOptions,"),
     typeof RT.answerRaceTraitQuestions, W.includes("const last = await this.isLast(index, value);"), W.includes("Done <i class=\"fa-solid fa-check\"></i>"),
     W.includes("if (done && !this.pending && (root.querySelector(\".dbu-wizard-body\") === body)) this.hide();"),
     read("module", "racial.mjs").includes("(picked => (picked.length === count) ? picked : Symbol.for(\"dbu-ttrpg.notYet\"))("), W.includes('export const NOT_YET = Symbol.for("dbu-ttrpg.notYet");')],
    [true, true, true, "function", true, true, true, true, true]);
}

// A Trait's questions on one page (the user's, 2026-11-27): Functional Purpose's two Skills and its Option answered together; "a Skill you
// have 2+ Skill Ranks in" may be None, its line left out.
{
  const RAC = await import(modUrl("racial.mjs"));
  const asked = [];
  const answer = { "functional-purpose": { choices: { 1: "stealth", 2: "" }, options: { 2: ["destroyer"] }, optionChoices: {} },
    "technological-being": { choices: {}, options: { 2: ["enhanced-organism"], 3: ["surging-power", "hyper-resilience"] }, optionChoices: { "enhanced-organism": "impulsive" } } };
  globalThis.CSS = { escape: String };
  globalThis.foundry.applications = { api: { DialogV2: { wait: async config => { asked.push(config.window.title); return answer[config.window.title === "Functional Purpose" ? "functional-purpose" : "technological-being"]; } } } };
  const purpose = await RAC.racialItemFrom(getTrait("functional-purpose"), null, { partial: true });
  const being = await RAC.racialItemFrom(getTrait("technological-being"), null, { partial: true });
  delete globalThis.foundry.applications;
  const item = made => ({ type: "racial", system: made.data.system, flags: made.data.flags });
  check("one page each: Functional Purpose's Rank given, its Critical Target to None left out, Destroyer chosen; Technological Being's three Options and Enhanced Organism's Save",
    [asked, purpose.data.system.script.includes("skill.stealth.ranks += 1;"), purpose.data.system.script.includes("criticalTarget"),
     purpose.data.system.chosen.map(entry => [entry.key, entry.value]), RAC.unansweredOf(item(purpose)).length,
     being.data.system.chosen.filter(entry => entry.key === "option").map(entry => entry.value), being.data.system.script.includes("save.racial.impulsive"),
     RAC.unansweredOf(item(being)).length],
    [["Functional Purpose", "Technological Being"], true, false,
     [["functional-purpose", "stealth"], ["functional-purpose#2", ""], ["option", "destroyer"]], 0,
     ["enhanced-organism", "surging-power", "hyper-resilience"], true, 0]);
  check("None: a choice answered empty leaves out every line naming it", [RAC.fillChoice("a $choice2;\nb $choice;", "$choice2", ""), RAC.fillChoice("a $choice2;", "$choice2", "x")],
    ["b $choice;", "a x;"]);
}

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

check("the exchange window is Add Racial Trait's (a search over the list, the Factor beside each, the race Trait to restore first); no cross on a race Trait; Settings' Refresh Racial Traits",
  [SHEET.includes('window: { title: `${this.actor.name} - Exchange ${item.name}` },'), SHEET.includes('placeholder="Type a Factor Trait"'),
   TRAITS.includes("{{else if entry.removable}}"), SHEET.includes("removable: !exchangeable(this.actor, item) && !isRaceTraitItem(item),"),
   read("templates", "parts", "actor-settings.hbs").includes('data-action="refreshRacialTraits"'), typeof RT.refreshRaceTraits],
  [true, true, true, true, true, "function"]);

{
  const start = SHEET.indexOf("  static async _onPickRacialTraits() {");
  const body = SHEET.slice(start, SHEET.indexOf("\n  }\n", start));
  check("the picks drawn in the Racial Skill Ranks' window: tiles by Category, each saying Secondary or Subrace; full slots shut the rest; written as it closes",
    [start > 0, body.includes('overlay.className = "dbu-benefit-overlay";'), body.includes('class="dbu-benefit-toggle'),
     body.includes('<span class="step">${kindOf(file)}</span>'), body.includes("const shut = !on && (picks.length >= plan.choose);"),
     body.includes('this.actor.update({ "system.racialPicks": picks })'), body.includes("DialogV2")],
    [true, true, true, true, true, true, false]);
}

console.log(failed ? `\n${failed} failing` : "\n0 failing");
if (failed) process.exitCode = 1;
