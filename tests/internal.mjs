/**
 * The Internal Attack Maneuver: a state held by two characters at once.
 *
 * "Remove yourself from the Combat Encounter (record your Initiative) and while you are not
 * a member of the Combat Encounter, reduce their Soak Value and Defense Value by 2(T)."
 *
 * The Initiative Order is the ARC's and this system does not add or remove combatants, so
 * what is built is the record and the pair of marks - the attacker is inside somebody, the
 * target is Internalized - and that pair is what "while you are not a member" comes to
 * here. The penalty hangs off the mark, so it is run rather than read.
 *
 * "(Impulsive vs Impulsive/Corporeal)" is also the first Saving Throw Clash with a
 * different throw on each side.
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
const { loadManeuvers, getManeuver, maneuverKiCost, whyNotSpecial } =
  await import(modUrl("maneuvers.mjs"));
const { compile } = await import(modUrl("effects/parser.mjs"));
const { applyPassives, applySlot } = await import(modUrl("effects/interpreter.mjs"));
const { allConditions, combatConditionsFor, marksFor } = await import(modUrl("conditions.mjs"));
const { maneuverItemFrom, definitionOf } = await import(modUrl("use-maneuver.mjs"));
const { default: DBUCharacterData } = await import(modUrl("data/actor-character.mjs"));
await loadTraits();
await loadManeuvers();

const TRAIT = fs.readFileSync(path.join(TRAITS, "maneuvers", "internal-attack.dbu"), "utf8");
const MARK = fs.readFileSync(path.join(TRAITS, "conditions", "internalized.dbu"), "utf8");
const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
const USE = fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8");
const SHEET = fs.readFileSync(
  path.join(ROOT, "module", "sheets", "actor-character-sheet.mjs"), "utf8");
const COMBATHBS = fs.readFileSync(
  path.join(ROOT, "templates", "parts", "actor-combat.hbs"), "utf8");
const INDEX = JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

/** One top-level function out of chat.mjs, sliced so it can be run. */
function source(name) {
  let at = CHAT.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`chat.mjs has no ${name}`);
  if (CHAT.slice(at - 6, at) === "async ") at -= 6;
  return CHAT.slice(at, CHAT.indexOf("\n}\n", at) + 2);
}

// --- The Maneuver as the rulebook lists it -----------------------------------------------------
{
  check("listed", INDEX.traits.includes("maneuvers/internal-attack.dbu"), true);

  const inside = getManeuver("internal-attack");
  check("loaded as a Standard Maneuver", inside?.type, "standard");
  check("costing two Actions", inside.actionCost, 2);
  check("once a Combat Round", inside.usageLimit, { amount: 1, per: "round" });
  check("it is Special", inside.special, true);
  check("aimed at an Opponent", inside.requiresTarget, true);
  check("and it is not an attack", Boolean(inside.attacking), false);

  // "KP Cost: 6(T)", which is the Tier of Power and not the Base Tier - the dearest
  // Maneuver in the library so far.
  const at = (tier) => maneuverKiCost(inside, null,
    { system: { tierOfPower: tier, baseTierOfPower: tier, effects: { slots: {} } } });
  check("priced in Tiers of Power", inside.kiCostPerTier, 6);
  check("so it costs 6 a Tier", [at(1), at(3), at(5)], [6, 18, 30]);

  for (const line of [
    "Target an Opponent within your Melee Range",
    "Make a Clash (Impulsive vs\n  Impulsive/Corporeal) against them",
    "remove yourself from the Combat Encounter\n  (record your Initiative)",
    "while you are not a member of the Combat Encounter, reduce\n  their Soak Value and Defense Value by 2(T)",
    "As an Instant Maneuver, despite not being\n  involved in the Combat Encounter",
    "you can appear on a Square adjacent to the target of\n  this Maneuver",
    "re-enter the Combat Encounter (using your recorded Initiative)",
    "reduce their Life Points by 2x your Might"
  ]) {
    check(`the entry says "${line.slice(0, 44).replace(/\n\s+/g, " ")}"`,
      TRAIT.includes(line), true);
  }

  // "Minions: Non-Minion" - the first entry to name that restriction rather than Free or
  // N/A, and there are no Minions here to refuse.
  check("the Minions line is carried as printed",
    TRAIT.includes("\u2013Minions: Non-Minion"), true);

  check("no Skill opens it",
    Object.values(DBUCharacterData.SKILLS).some(s => s.specialManeuver === "internal-attack"),
    false);
  check("so it is an effect's to give",
    whyNotSpecial({ name: "Tizi", system: { effects: { slots: {} }, specialManeuvers: [] } },
      inside),
    "Tizi has not been granted access to Internal Attack. A Special Maneuver is gained "
    + "through an effect.");
}

// --- A different Saving Throw on each side, run --------------------------------------------------
{
  const inside = getManeuver("internal-attack");
  check("the challenger rolls Impulsive", inside.clashSaves, ["impulsive"]);
  check("and the defender chooses between two", inside.clashDefenderSaves,
    ["impulsive", "corporeal"]);

  // Onto an Item and back off it.
  const item = maneuverItemFrom(inside);
  check("the Item carries both halves",
    [item.system.clashSaves, item.system.clashDefenderSaves],
    [["impulsive"], ["impulsive", "corporeal"]]);
  const read = definitionOf({ id: "x", name: inside.name,
    system: { ...item.system, maneuverId: inside.id } });
  check("and reading it back gives them up",
    [read.clashSaves, read.clashDefenderSaves, read.internalAttack],
    [["impulsive"], ["impulsive", "corporeal"], true]);

  // Which side is offered what, run.
  const savesOffered = new Function(`${source("savesOffered")}\nreturn savesOffered;`)();
  const savePicked = new Function(
    `${source("savesOffered")}\n${source("savePicked")}\nreturn savePicked;`)();

  const clash = { challengerUuid: "Actor.a", defenderUuid: "Actor.b",
                  saves: ["impulsive"], defenderSaves: ["impulsive", "corporeal"],
                  challengerSave: "", defenderSave: "" };

  check("the challenger is offered one", savesOffered(clash, "Actor.a"), ["impulsive"]);
  check("and the defender two", savesOffered(clash, "Actor.b"), ["impulsive", "corporeal"]);
  check("so the challenger rolls it with nothing asked",
    savePicked(clash, "Actor.a"), "impulsive");
  check("and the defender rolls the first until they say",
    savePicked(clash, "Actor.b"), "impulsive");
  check("and what they chose once they have",
    savePicked({ ...clash, defenderSave: "corporeal" }, "Actor.b"), "corporeal");

  // "(Impulsive/Corporeal)" with no `vs` is one list for both, which is the Thrust and has
  // to go on being true.
  const both = { challengerUuid: "Actor.a", defenderUuid: "Actor.b",
                 saves: ["impulsive", "corporeal"], defenderSaves: [],
                 challengerSave: "", defenderSave: "" };
  check("a Clash naming one list offers it to both",
    [savesOffered(both, "Actor.a"), savesOffered(both, "Actor.b")],
    [["impulsive", "corporeal"], ["impulsive", "corporeal"]]);
  check("and a card from before any of this carries none",
    savesOffered({ defenderUuid: "Actor.b", saves: ["impulsive"] }, "Actor.b"), ["impulsive"]);
  check("falling back to Impulsive where there is nothing at all",
    savePicked({ defenderUuid: "Actor.b" }, "Actor.b"), "impulsive");

  // Whoever was offered a choice is the one asked.
  check("the question goes to whoever has one",
    CHAT.includes("      const offered = savesOffered(clash, actor.uuid);"), true);
  check("and the prompt says what they may answer with",
    CHAT.includes("    prompt: (actor, clash, uuid) => (savesOffered(clash, uuid).length > 1)"),
    true);
}

// --- What being Internalized costs, run ----------------------------------------------------------
{
  const { program, errors } = compile(String(getTrait("internalized").script ?? ""), null);
  check("the mark's passive compiles", errors.map(e => e.message), []);

  const at = (tier) => {
    const entry = { program, priority: 6, sourceId: "internalized", sourceName: "Internalized",
                    level: 0, stacks: 1, armed: true, available: true };
    return applyPassives([entry], "core",
      { data: { tierOfPower: tier }, errors: [], context: {}, queue: [] }).slots;
  };

  // "Reduce their Soak Value and Defense Value by 2(T)", read as the Tier of whoever is
  // suffering it - which is how every other inflicted penalty in this system reads.
  check("two a Tier off the Soak Value", applySlot(at(3), "soakValue", 20), 14);
  check("and two a Tier off the Defense Value", applySlot(at(3), "defenseValue", 20), 14);
  check("at Tier 1 that is two of each",
    [applySlot(at(1), "soakValue", 20), applySlot(at(1), "defenseValue", 20)], [18, 18]);
  check("and at Tier 5, ten",
    [applySlot(at(5), "soakValue", 20), applySlot(at(5), "defenseValue", 20)], [10, 10]);

  // It touches those two and nothing else - not the Dodge Roll, which a Defense Value
  // feeds but is not.
  check("and nothing else",
    Object.keys(at(3)).sort(), ["defenseValue", "soakValue"]);

  // A mark rather than a Combat Condition, like Hyped, Analyzed and Braced.
  const all = allConditions();
  const mark = all.find(c => c.key === "internalized");
  check("it is not a Combat Condition", mark.combatCondition, false);
  check("so the checklist is still the published eighteen",
    all.filter(c => c.combatCondition).length, 18);
  check("and it is listed with the marks when somebody has it",
    marksFor({ system: { conditions: { internalized: 1 }, timed: [] } }).map(m => m.key),
    ["internalized"]);

  // No clock: it ends when the one inside comes out, not on a turn edge.
  check("nothing puts it on a clock", MARK.includes("expires("), false);
}

// --- Going in ---------------------------------------------------------------------------------------
{
  check("the Clash knows what winning buys",
    USE.includes("...(maneuver.internalAttack ? { internalAttack: { applied: false, "
      + "inside: false } } : {})"), true);
  check("settled once, by the one client that writes a Clash",
    CHAT.includes("  if (clash.internalAttack && clash.result && !clash.internalAttack.applied) {"),
    true);
  check("and marked before anything else happens",
    CHAT.includes("    ...clash, internalAttack: { ...clash.internalAttack, applied: true }"),
    true);
  check("a tie keeps them out, here as everywhere",
    CHAT.includes("await settledNote(message, `${target.name} keeps ${attacker.name} out.`);"),
    true);

  const settle = source("settleInternalAttack");
  check("winning marks the target",
    settle.includes('await setCondition(target, "internalized", 1);'), true);
  check("and records where the attacker was in the Order",
    settle.includes("entry.actor?.uuid === attacker.uuid)?.initiative"), true);
  check("read before it stops being true",
    settle.indexOf("?.initiative") < settle.indexOf('setCondition(target, "internalized"'),
    true);
  check("with who they are inside", settle.includes("      targetUuid: target.uuid,"), true);
  check("and the card it happened on, which is where the way out is",
    settle.includes("      messageId: message.id"), true);

  // The Order itself is the table's.
  check("and the card asks the table to take them out of the Order",
    settle.includes("Take ${attacker.name} out of the Initiative Order"), true);
  check("this system adds and removes no combatants",
    CHAT.includes("combat.combatants.delete") || CHAT.includes("Combatant.create"), false);

  // Outside an Encounter there is no Order to record, and the card does not invent one.
  check("no Initiative recorded is said by saying nothing",
    settle.includes('${initiative ? ` at Initiative ${initiative}` : ""}'), true);
}

// --- Coming back out --------------------------------------------------------------------------------
{
  const out = source("burstOut");

  check("only while they are in there",
    out.includes("if (!attacker || !target || !clash.internalAttack?.inside) return;"), true);

  // "As an Instant Maneuver", so the Instant rule applies to it like any other.
  check("it is an Instant, and the Instant rule is asked",
    out.includes("const held = whyNotAnotherInstant(attacker);"), true);
  check("and recorded as one, so it holds you in turn",
    out.includes('await recordManeuverType(attacker, "instant", { messageId: message.id });'),
    true);

  check("the mark comes off", out.includes('await setCondition(target, "internalized", 0);'),
    true);
  check("and the attacker is no longer inside anybody",
    out.includes('"system.inside": { targetUuid: "", targetName: "", initiative: "", messageId: "" }'),
    true);

  // "Reduce their Life Points by 2x your Might", and a Life Point reduction in these rules
  // is straight off the Life Points past the Soak Value and the Damage Reduction.
  check("twice their Might comes off the Life Points",
    out.includes("await reduceLifePoints(target, 2 * (attacker.system.might ?? 0),"), true);
  check("read when they come out rather than when they went in",
    out.includes("attacker.system.might"), true);
  check("through the same function a collision goes through",
    CHAT.includes("export async function reduceLifePoints(target, amount,"), true);
  check("which says what it is for",
    out.includes("Internal Attack - twice ${attacker.name}'s Might"), true);

  // The button is on the card that put them there, and belongs to them alone.
  check("offered for as long as they are inside",
    CHAT.includes("    if (clash.internalAttack?.inside && challenger?.isOwner) {"), true);
  check("and taken from the card that put them there",
    CHAT.includes('out.addEventListener("click", () => burstOut(message, clash));'), true);
  check("the card is closed to it once they are out",
    out.includes("clash: { ...clash, internalAttack: { ...clash.internalAttack, inside: false } }"),
    true);

  // Where they appear is the table's, like every Square here.
  check("where they appear is said, not done",
    out.includes("Put them on a Square adjacent to ${target.name}."), true);
}

// --- Said on the sheet, since a card scrolls away -------------------------------------------------------
{
  check("the sheet says who they are inside",
    SHEET.includes("    const inside = this.actor.system.inside;"), true);
  check("and where they left the Order",
    SHEET.includes("            ? `Back in the Order at Initiative ${inside.initiative}`"),
    true);
  check("saying so plainly when there was none",
    SHEET.includes('            : "No Initiative was recorded"'), true);
  check("nothing is said when they are inside nobody",
    SHEET.includes("      : null;\n"), true);

  check("the row is drawn", COMBATHBS.includes("{{#if inside}}"), true);
  check("beside the rest of what you are in the middle of",
    COMBATHBS.indexOf("{{#each marks as |mark|}}") < COMBATHBS.indexOf("{{#if inside}}"), true);

  // And the state is declared, or the schema would eat it - which it has done before.
  const CHAR = fs.readFileSync(
    path.join(ROOT, "module", "data", "actor-character.mjs"), "utf8");
  check("the state is a declared field",
    CHAR.includes("    schema.inside = new fields.SchemaField({"), true);
  for (const key of ["targetUuid", "targetName", "initiative", "messageId"]) {
    check(`and ${key} is declared on it`,
      CHAR.slice(CHAR.indexOf("schema.inside = new fields.SchemaField({"))
        .slice(0, 900).includes(`${key}: new fields.StringField(`), true);
  }
}

console.log(`${failed} failing`);
process.exit(failed ? 1 : 0);
