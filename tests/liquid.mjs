/**
 * The Liquid Form Maneuver and the Special State it throws.
 *
 * Six effects, five of them built and one of them said - and four of the five needed a
 * Slot that did not exist. A Slot nobody reads is an effect that quietly does nothing, so
 * each new one is run against the thing that reads it rather than checked for being
 * declared.
 *
 * The sixth is the interesting refusal: written as an effect it would be a block with a
 * budget and an Action cost and no Moment, and a block with no Moment is collected by
 * nothing. It would compile and never run. That is demonstrated here rather than asserted,
 * so nobody writes one later believing it works.
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
const { loadManeuvers, getManeuver, whyNotSpecial } = await import(modUrl("maneuvers.mjs"));
const { compile } = await import(modUrl("effects/parser.mjs"));
const { applyPassives, applySlot, permits, collectReactive } =
  await import(modUrl("effects/interpreter.mjs"));
const { getSlot } = await import(modUrl("effects/slots.mjs"));
const { maneuverItemFrom, definitionOf } = await import(modUrl("use-maneuver.mjs"));
const { default: DBUCharacterData } = await import(modUrl("data/actor-character.mjs"));
await loadTraits();
await loadManeuvers();

const TRAIT = fs.readFileSync(path.join(TRAITS, "maneuvers", "liquid-form.dbu"), "utf8");
const STATE = fs.readFileSync(path.join(TRAITS, "states", "liquid.dbu"), "utf8");
const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
const USE = fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8");
const CHAR = fs.readFileSync(path.join(ROOT, "module", "data", "actor-character.mjs"), "utf8");
const INDEX = JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

/** The Slots the Liquid State settles for a character at this Tier of Power. */
const liquid = (() => {
  const { program, errors } = compile(String(getTrait("liquid").script ?? ""), null);
  if (errors.length) throw new Error(errors.map(e => e.message).join("; "));
  return (phase, tier = 3, baseTier = 2) => {
    const entry = { program, priority: 6, sourceId: "liquid", sourceName: "Liquid",
                    level: 1, stacks: 1, armed: true, available: true };
    return applyPassives([entry], phase, {
      data: { tierOfPower: tier, baseTierOfPower: baseTier,
              skills: { stealth: { ranks: 0, label: "Stealth" } } },
      errors: [], context: {}, queue: []
    }).slots;
  };
})();

// --- The Maneuver as the rulebook lists it -----------------------------------------------
{
  check("listed", INDEX.traits.includes("maneuvers/liquid-form.dbu"), true);
  check("and so is the State", INDEX.traits.includes("states/liquid.dbu"), true);

  const form = getManeuver("liquid-form");
  check("loaded as an Instant Maneuver", form?.type, "instant");
  check("costing no Action and no Ki", [form.actionCost, form.kiCost], [0, 0]);
  check("once a Combat Round", form.usageLimit, { amount: 1, per: "round" });
  check("it is Special", form.special, true);
  check("aimed at nobody", Boolean(form.requiresTarget), false);
  check("and it is not an attack", Boolean(form.attacking), false);

  for (const line of [
    "You enter the Liquid Special State",
    "If you use this Maneuver while in the\n  Liquid Special State, you exit the Liquid Special State"
  ]) {
    check(`the entry says "${line.slice(0, 44).replace(/\n\s+/g, " ")}"`,
      TRAIT.includes(line), true);
  }

  check("it names the State it throws", form.togglesState, "liquid");
  check("which is a State the library has", Boolean(getTrait("liquid")), true);

  const item = maneuverItemFrom(form);
  check("the Item carries it", item.system.togglesState, "liquid");
  check("and reading it back gives it up",
    definitionOf({ id: "x", name: form.name,
      system: { ...item.system, maneuverId: form.id } }).togglesState, "liquid");

  check("no Skill opens it",
    Object.values(DBUCharacterData.SKILLS).some(s => s.specialManeuver === "liquid-form"),
    false);
}

// --- (1) A Size Category down, run against the thing that reads it ---------------------------
{
  check("the Slot exists", Boolean(getSlot("size.steps", {})), true);
  // Settled in the Tier pass, which is the one that has run by the time a Size is
  // resolved - so an effect that moves a Size may be written in (bT) and never in (T).
  check("and is settled before the Tiers are known", getSlot("size.steps", {}).phase, "tier");
  check("the State takes one Category off", applySlot(liquid("tier"), "size.steps", 0), -1);

  // Read where the Size is resolved, which is what makes everything a Size decides follow.
  check("read where the Size is resolved",
    CHAR.includes('const sizeShift = Math.round(applySlot(this.effects?.slots, "size.steps", 0));'),
    true);
  check("and clamped to the ends of the list",
    CHAR.includes("sizeKeys[Math.min(sizeKeys.length - 1, Math.max(0, chosenAt + sizeShift))]"),
    true);
  check("with what they were built as kept beside it",
    CHAR.includes("      chosen: chosenSize,"), true);
  check("and the steps counted from where they actually are",
    CHAR.includes("steps: sizeKeys.indexOf(sizeKey) - sizeKeys.indexOf(DBUCharacterData.DEFAULT_SIZE),"),
    true);

  // The list, and what a step down is worth at each end of it.
  const sizes = Object.keys(DBUCharacterData.SIZES);
  check("the Sizes are in order, smallest first",
    [sizes[0], sizes[sizes.length - 1]], ["nano", "colossal"]);
  check("and Medium is what everything is measured against",
    DBUCharacterData.DEFAULT_SIZE, "medium");
  check("a step down from Medium is Small", sizes[sizes.indexOf("medium") - 1], "small");
  check("and a step down from Nano is nowhere to go",
    Math.max(0, sizes.indexOf("nano") - 1), 0);

  // What that step is worth: Small is a point of Defense per Tier and a point of Soak off.
  check("which is worth Defense and costs Soak",
    [DBUCharacterData.SIZES.small.defensePerTier - DBUCharacterData.SIZES.medium.defensePerTier,
     DBUCharacterData.SIZES.small.soakPerTier - DBUCharacterData.SIZES.medium.soakPerTier],
    [1, -1]);
}

// --- (2) A Grapple Check made as the Grappled -------------------------------------------------
{
  check("the Slot exists", Boolean(getSlot("grapple.defending", {})), true);
  check("settled with the rest of the Combat Rolls",
    getSlot("grapple.defending", {}).phase, "late");
  check("the State is worth 1(T) on it, which at Tier 3 is three",
    applySlot(liquid("late", 3), "grapple.defending", 0), 3);
  check("and at Tier 1, one", applySlot(liquid("late", 1), "grapple.defending", 0), 1);

  // Read on the Defender's side of a Grapple Check and nowhere else: a Grapple Check made
  // as the Grappler is a Strike Roll like any other.
  check("read where a Grapple Check's parts are built",
    CHAT.includes("      ...(((uuid === clash.defenderUuid) && clash.grapple)\n"
      + "        ? grappleDefenceParts(actor)\n        : []),"), true);

  const parts = new Function("applySlot",
    `${CHAT.slice(CHAT.indexOf("function grappleDefenceParts("),
                  CHAT.indexOf("\n}\n", CHAT.indexOf("function grappleDefenceParts(")) + 2)}
     return grappleDefenceParts;`)(applySlot);

  const who = (value) => ({ system: { effects: { slots: { "grapple.defending": { add: value } } } } });
  check("a character with nothing gets no row",
    parts({ system: { effects: { slots: {} } } }), []);
  check("and one with something gets one, named for the side it is about",
    parts(who(3)), [{ label: "Grappled", value: 3 }]);

  // "And you cannot be Pinned", which is immunity to the Condition itself.
  check("Pinned is forbidden outright", permits(liquid("core"), "condition.pinned"), false);
  check("which is the Slot setCondition asks",
    fs.readFileSync(path.join(ROOT, "module", "conditions.mjs"), "utf8")
      .includes("actor.system.effects?.slots?.[`condition.${key}`] === false"), true);
  check("and Pinned is a Condition the library knows", Boolean(getTrait("pinned")), true);
}

// --- (3) Stealth, flat -------------------------------------------------------------------------
{
  const slots = liquid("core", 5);
  check("two points of Stealth", applySlot(slots, "skill.stealth.bonus", 10), 12);
  // "By 2" and not "by 2(T)", which is what the entry says - so the Tier makes no
  // difference to it, where it makes all the difference to the Grapple bonus above.
  check("flat, not scaled by the Tier of Power",
    applySlot(liquid("core", 1), "skill.stealth.bonus", 10), 12);
  check("and it touches Stealth and nothing else",
    applySlot(slots, "skill.perception.bonus", 10), 10);
}

// --- (4) A Movement that provokes nothing --------------------------------------------------------
{
  check("the Slot exists", Boolean(getSlot("movement.provokes", {})), true);
  check("the State forbids it", permits(liquid("core"), "movement.provokes"), false);
  check("and a character without the State provokes as before",
    permits({}, "movement.provokes"), true);

  // Asked where an Exploit is offered, which is the only place one is ever offered from.
  check("asked at the one door an Exploit comes through",
    CHAT.includes('if (maneuver.movement && !permits(actor.system.effects?.slots, "movement.provokes")) return;'),
    true);
  check("of the Movement alone, which is what the rule names",
    CHAT.includes("if (maneuver.movement &&"), true);
  check("and after the Exploitable line, which is the other half of the condition",
    CHAT.indexOf("if (!card || !maneuver?.exploitable) return;")
      < CHAT.indexOf('"movement.provokes")) return;'), true);
  check("the Movement Maneuver has an Exploitable line to be stopped from using",
    getManeuver("movement").exploitable, "If you leave the Melee Range of an Opponent.");
}

// --- (5) No attacking, no Unique Abilities ----------------------------------------------------------
{
  const slots = liquid("core");
  check("Attacking Maneuvers are forbidden", permits(slots, "attackingManeuvers"), false);
  check("and Unique Abilities", permits(slots, "uniqueAbilities"), false);
  // Narrow: it closes those two and not Maneuvers in general.
  check("but not Maneuvers in general", permits(slots, "maneuvers"), true);
  check("nor Signature Techniques, which the entry does not name",
    permits(slots, "signatureTechniques"), true);
  check("nor Special Maneuvers", permits(slots, "specialManeuvers"), true);
}

// --- (6), which is said rather than half-built ---------------------------------------------------
{
  check("the entry's sixth effect is carried in the State's text",
    getTrait("liquid").text.includes(
      "As a Standard Action with an Action Cost of 1 Action, you may use a"), true);
  check("and the Maneuver it became carries the same line",
    getManeuver("liquid-sixth-effect").text.includes(
      "As a Standard Action with an Action Cost of 1 Action, you may use a"), true);
  check("and the file says why it is not written as an effect",
    STATE.includes("that block would compile and"), true);
  check("and where it is written instead",
    STATE.includes("maneuvers/liquid-sixth-effect.dbu"), true);

  // Demonstrated rather than asserted: a block with a budget and a cost and no Moment is
  // collected by nothing, so it would never fire.
  const { program, errors } = compile("[1/round, costs 1 action]\nsurge(healing);", null);
  check("such a block compiles", errors.map(e => e.message), []);

  const entry = { program, priority: 6, sourceId: "t", sourceName: "Test",
                  level: 0, stacks: 1, armed: true, available: true };
  const collected = collectReactive([entry], "start-of-turn",
    { data: {}, errors: [], context: {}, queue: [] });
  check("and answers no Moment at all", collected.fired ?? 0, 0);

  // Where a block that names one does answer it.
  const named = compile("[triggered/start-of-turn, costs 1 action]\nsurge(healing);", null);
  check("where one that names a Moment does", named.errors.map(e => e.message), []);
  check("which is the shape Pinned and Prone already use",
    fs.readFileSync(path.join(TRAITS, "conditions", "pinned.dbu"), "utf8")
      .includes("[triggered/start-of-turn, costs 1 action]"), true);

  // And the other half of why: `costs` is parsed and spent by nobody, so even a block
  // that did fire would be free.
  const MODULE = ["parser.mjs", "moments-runtime.mjs", "registry.mjs", "interpreter.mjs"]
    .map(f => fs.readFileSync(path.join(ROOT, "module", "effects", f), "utf8")).join("\n");
  check("`costs` is written into the block", MODULE.includes("budget.actions = Number("), true);
  check("and spent by nobody", MODULE.includes("budget.actions"), true);
  check("which the State's file says outright",
    STATE.includes("parsed and spent by nobody either"), true);
}

// --- The switch ------------------------------------------------------------------------------------
{
  check("the door throws the State",
    USE.includes("    if (maneuver.togglesState) {"), true);
  check("reading which way to throw it off the character",
    USE.includes("const wasIn = (Number(actor.system.states?.[maneuver.togglesState]) || 0) > 0;"),
    true);
  check("and setting the other one",
    USE.includes("if (!await setState(actor, maneuver.togglesState, wasIn ? 0 : 1)) return false;"),
    true);
  check("a State that refuses to move leaves the Maneuver unused",
    USE.includes(") return false;\n      toggled = wasIn ? \"out\" : \"in\";"), true);

  // Which way it went is the one thing a reader cannot work out from the card.
  const note = new Function(
    `${USE.slice(USE.indexOf("function stateNote("),
                 USE.indexOf("\n}\n", USE.indexOf("function stateNote(")) + 2)}
     return stateNote;`)();

  check("going in says so", note({ togglesState: "liquid" }, "in"),
    "Now in the Liquid Special State.");
  check("and coming out says so", note({ togglesState: "liquid" }, "out"),
    "Out of the Liquid Special State.");
  check("a Maneuver that throws nothing says nothing", note({}, ""), "");
  check("and one that threw nothing this time says nothing either",
    note({ togglesState: "liquid" }, ""), "");
}

// --- The Spectator State's forbid, which now has something to forbid ------------------------------
{
  // "You cannot use ... any Attacking Maneuvers, Special Maneuvers, or Unique Abilities."
  // That line said nothing for as long as there was no such category here to close.
  const spectator = compile(String(getTrait("spectator").script ?? ""), null);
  check("the Spectator State compiles", spectator.errors.map(e => e.message), []);

  const entry = { program: spectator.program, priority: 6, sourceId: "spectator",
                  sourceName: "Spectator", level: 1, stacks: 1, armed: true, available: true };
  const slots = applyPassives([entry], "core",
    { data: {}, errors: [], context: {}, queue: [] }).slots;

  check("a Spectator may not use Special Maneuvers", permits(slots, "specialManeuvers"), false);
  check("nor Attacking Maneuvers", permits(slots, "attackingManeuvers"), false);
  check("nor Unique Abilities", permits(slots, "uniqueAbilities"), false);

  // The class, which is a different question from one Maneuver by name.
  const who = (bag) => ({ name: "Tizi", system: { effects: { slots: bag }, specialManeuvers: [] } });
  check("and the gate asks it",
    whyNotSpecial(who({ specialManeuvers: false, "maneuver.analysis": true }),
      getManeuver("analysis")),
    "Tizi cannot use Special Maneuvers right now.");
  check("before it asks about the one by name",
    whyNotSpecial(who({ specialManeuvers: false, "maneuver.analysis": false }),
      getManeuver("analysis")),
    "Tizi cannot use Special Maneuvers right now.");
  check("and a character nobody closed it on is unaffected",
    whyNotSpecial(who({ "maneuver.analysis": true }), getManeuver("analysis")), null);
  check("as is one who is not using a Special Maneuver at all",
    whyNotSpecial(who({ specialManeuvers: false }), getManeuver("basic-attack")), null);
}

console.log(`${failed} failing`);
process.exit(failed ? 1 : 0);
