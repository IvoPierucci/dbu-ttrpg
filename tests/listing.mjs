/**
 * Which Maneuvers are listed, and the promise that goes with hiding one.
 *
 * Two kinds of Maneuver a character owns and cannot always reach: a Special Maneuver
 * nothing has opened, and a Maneuver that is one of a Trait's own numbered effects while
 * that Trait is not on them. Neither is drawn in the list.
 *
 * The promise is that the Item is never taken away. It is what remembers a name the player
 * gave it, so the row that comes back when the State does is theirs and not a fresh one -
 * which is the whole reason this is a filter on the list rather than an Item created and
 * deleted as the State comes and goes.
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

const { loadTraits, getTrait } = await import(modUrl("effects/traits.mjs"));
const { loadManeuvers, getManeuver, allManeuvers, whyNotSpecial } =
  await import(modUrl("maneuvers.mjs"));
const { traitActive } = await import(modUrl("conditions.mjs"));
const { maneuverItemFrom, coreManeuverItems, definitionOf } =
  await import(modUrl("use-maneuver.mjs"));
const { default: DBUCharacterData } = await import(modUrl("data/actor-character.mjs"));
await loadTraits();
await loadManeuvers();

const SHEET = fs.readFileSync(
  path.join(ROOT, "module", "sheets", "actor-character-sheet.mjs"), "utf8");
const MANEUVERS = fs.readFileSync(
  path.join(ROOT, "templates", "parts", "actor-maneuvers.hbs"), "utf8");
const SHEET_SRC = fs.readFileSync(path.join(ROOT, "module", "conditions.mjs"), "utf8");

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

/** The sheet's own question, run: is this one the character cannot reach yet. */
const notYetOpen = (() => {
  const at = SHEET.indexOf("  #notYetOpen(maneuver) {");
  const body = SHEET.slice(at, SHEET.indexOf("\n  }", at) + 4)
    .replace("#notYetOpen(maneuver) {", "function notYetOpen(actor, maneuver) {")
    .replace(/this\.actor/g, "actor");
  return new Function("traitActive", "whyNotSpecial", `${body}\nreturn notYetOpen;`)(
    traitActive, whyNotSpecial);
})();

/** A character, as little of one as the question needs. */
const who = ({ states = {}, conditions = {}, slots = {}, skills = [], racial = [] } = {}) => ({
  name: "Tizi",
  items: [],
  system: {
    states, conditions, racialTraits: racial,
    effects: { slots },
    specialManeuvers: skills
  }
});

// --- A Maneuver that is a Trait's own effect ------------------------------------------------
{
  const sixth = getManeuver("liquid-sixth-effect");
  check("the Liquid State's sixth effect is a Maneuver", Boolean(sixth), true);
  check("named after the effect it is", sixth.name, "6th effect of Liquid State");
  check("which names the Trait it came out of", sixth.fromTrait, "liquid");
  check("and which of that Trait's effects", sixth.fromEffect, 6);
  check("pointing at a Trait the library has", Boolean(getTrait(sixth.fromTrait)), true);

  // The stat block, from the line the State prints.
  check("a Standard Maneuver", sixth.type, "standard");
  check("costing one Action", sixth.actionCost, 1);
  check("once a Combat Round", sixth.usageLimit, { amount: 1, per: "round" });
  check("and it takes a Surge", sixth.surge, true);
  check("the Healing one, which the rule names", sixth.surgeKind, "healing");
  check("so nobody is asked which", sixth.surgeKind !== "", true);

  // Not Special: being Liquid is what opens it, not an effect granting access.
  check("it is not a Special Maneuver", Boolean(sixth.special), false);
}

// --- Owned always, listed sometimes -----------------------------------------------------------
{
  const sixth = getManeuver("liquid-sixth-effect");

  // Every character has it from the day they are made, which is what makes their edits to
  // it stick: there is nothing to create when the State begins and nothing to delete when
  // it ends.
  const core = coreManeuverItems().map(item => item.system.maneuverId);
  check("every character owns it from the start",
    core.includes("liquid-sixth-effect"), true);
  check("like the Basic Attack does", core.includes("basic-attack"), true);
  check("and the Item carries what it is",
    [maneuverItemFrom(sixth).system.fromTrait, maneuverItemFrom(sixth).system.fromEffect],
    ["liquid", 6]);
  check("read back off the Item unchanged",
    definitionOf({ id: "x", name: "Whatever they called it",
      system: { ...maneuverItemFrom(sixth).system, maneuverId: sixth.id } }).fromTrait,
    "liquid");

  // Listed only while they are Liquid.
  check("not listed when they are solid", notYetOpen(who(), sixth), true);
  check("and listed when they are Liquid",
    notYetOpen(who({ states: { liquid: 1 } }), sixth), false);
  check("another State does not open it",
    notYetOpen(who({ states: { superior: 1 } }), sixth), true);
  check("nor a Condition of the same name being absent",
    notYetOpen(who({ conditions: { liquid: 1 } }), sixth), true);

  // And a Maneuver that is nobody's effect is listed either way.
  check("an ordinary Maneuver is listed regardless",
    [notYetOpen(who(), getManeuver("basic-attack")),
     notYetOpen(who({ states: { liquid: 1 } }), getManeuver("basic-attack"))],
    [false, false]);
}

// --- Whether a Trait is on somebody, per kind ----------------------------------------------------
{
  // One question, and each kind of Trait is held somewhere different.
  check("a State is a count in a bag",
    [traitActive(who({ states: { liquid: 1 } }), "liquid"),
     traitActive(who({ states: { liquid: 0 } }), "liquid"),
     traitActive(who(), "liquid")],
    [true, false, false]);

  check("so is a Condition",
    [traitActive(who({ conditions: { prone: 1 } }), "prone"),
     traitActive(who(), "prone")],
    [true, false]);

  // The other two kinds are read rather than run, and this says which: there are no Racial
  // Trait files in the library yet and no Talent declares itself a Trait, so nothing can be
  // handed to `traitActive` that would reach those branches. Saying so is better than a
  // check that quietly exercises neither.
  const { traitsOfKind } = await import(modUrl("effects/traits.mjs"));
  check("the Racial Traits in the library are files of their own kind - Shinjin's first",
    traitsOfKind("races").some(trait => trait.owner === "shinjin"), true);
  check("so a Racial Trait is a branch waiting for one",
    SHEET_SRC.includes("return (actor.system?.racialTraits ?? []).includes(id) || (trait.optionOf"), true);
  check("and a Talent is another",
    SHEET_SRC.includes('    case "talents":'), true);
  check("while the two that exist are the two that are run",
    [traitsOfKind("states").length > 0, traitsOfKind("conditions").length > 0],
    [true, true]);

  // A name nothing in the library knows is not active, rather than being taken on trust.
  check("a Trait the library never heard of is not on anybody",
    traitActive(who({ states: { nonsense: 1 } }), "nonsense"), false);
  check("and neither is nothing at all",
    [traitActive(who(), ""), traitActive(null, "liquid")], [false, false]);
}

// --- A Special Maneuver nothing has opened ---------------------------------------------------------
{
  // "If you meet the Skill Ranks it appears, and otherwise it does not." Which is a change
  // from listing it greyed out with the reason beside it - what is lost is the row that
  // told you what would open it, and what is gained is a list of what you can actually do.
  const analysis = getManeuver("analysis");
  const ranks = (n) => who({
    skills: [{ maneuver: "analysis", skill: "Investigation", ranks: n, needs: 2, open: n >= 2 }]
  });

  check("one Rank short and it is not listed", notYetOpen(ranks(1), analysis), true);
  check("two Ranks and it is", notYetOpen(ranks(2), analysis), false);
  check("more than enough, still listed", notYetOpen(ranks(5), analysis), false);

  // An effect opens one no Skill does.
  const absorption = getManeuver("attack-absorption");
  check("a Special Maneuver no Skill opens is not listed",
    notYetOpen(who(), absorption), true);
  check("and is once an effect has granted it",
    notYetOpen(who({ slots: { "maneuver.attack-absorption": true } }), absorption), false);

  // A forbid closes it again, and closing it takes the row away.
  check("a forbid takes it off the list",
    notYetOpen(who({ slots: { "maneuver.attack-absorption": false } }), absorption), true);
  check("as does forbidding the class",
    notYetOpen(who({ slots: { specialManeuvers: false, "maneuver.attack-absorption": true } }),
      absorption), true);

  // Every Special Maneuver is subject to this, and no ordinary one is.
  check("all of them are Special enough to be hidden",
    allManeuvers().filter(m => m.special).every(m => notYetOpen(who(), m)), true);
  check("and no ordinary Maneuver is hidden by it",
    allManeuvers().filter(m => !m.special && !m.fromTrait && !m.godManeuver)
      .every(m => !notYetOpen(who(), m)), true);
}

// --- The list asks it, and the Item survives ---------------------------------------------------------
{
  check("the list filters on it",
    SHEET.includes("          .filter(maneuver => !this.#notYetOpen(maneuver))"), true);
  check("after grouping by type, so a hidden one empties its group",
    SHEET.indexOf("filter(maneuver => maneuver.type === group.key)")
      < SHEET.indexOf("filter(maneuver => !this.#notYetOpen(maneuver))"), true);
  // A tab for each type now (the user's): an empty one is a tab with 0 and "None of this type", not left out.
  check("and every type keeps its tab, an empty one saying so",
    [SHEET.includes("      .filter(group => group.maneuvers.length > 0);"),
     fs.readFileSync(path.join(ROOT, "templates", "parts", "actor-maneuvers.hbs"), "utf8").includes("None of this type.")], [false, true]);

  // Nothing deletes the Item. The whole point of hiding rather than deleting is that a
  // name the player gave it comes back with it.
  check("nothing in the sheet deletes a Maneuver for being closed",
    /deleteEmbeddedDocuments\([^)]*\)[^;]*notYetOpen/.test(SHEET), false);
  check("and the row can be renamed, which is what an Item is for",
    MANEUVERS.includes('data-action="editItem"'), true);

  // The two questions are asked in one place, so the list and the door cannot disagree
  // about a Special Maneuver.
  check("the door asks the same question about access",
    fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8")
      .includes("const closed = whyNotSpecial(actor, maneuver);"), true);
}

console.log(`${failed} failing`);
process.exit(failed ? 1 : 0);
