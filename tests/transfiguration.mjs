/**
 * The Transfiguration Maneuver: the largest entry in these rules so far, and five separate
 * things worth running.
 *
 * Two Clashes in sequence, of two different categories - the Thrust's shape, except that
 * nothing is chosen between them.
 *
 * A branch that undoes an earlier use instead of rolling at all, which has to tell being
 * an Item from being merely Transfigured: they are two different outcomes of the same
 * Maneuver, and only one of them is what the reversal names.
 *
 * "Cannot make any type of Maneuver", which is a Slot that already existed and had no way
 * to be written from on a clock nobody else's could take off.
 *
 * A Counter Action that turns the Maneuver on its user - one character on both sides of a
 * Clash, which nothing here had done.
 *
 * And a death with a Karma Point in front of it, where being Defeated is not a field: it
 * is derived from Life Points, and the first version of this wrote `system.defeated` and
 * wrote nothing at all.
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

const { loadTraits, getTrait, resourceDefinitions } =
  await import(modUrl("effects/traits.mjs"));
const { loadManeuvers, getManeuver, whyNotSpecial, maneuverKiCost, MANEUVER_TYPES } =
  await import(modUrl("maneuvers.mjs"));
const { maneuverItemFrom, definitionOf } = await import(modUrl("use-maneuver.mjs"));
const { EDGES, KINDS } = await import(modUrl("durations.mjs"));
const { allSlots } = await import(modUrl("effects/slots.mjs"));
const { default: DBUCharacterData } = await import(modUrl("data/actor-character.mjs"));
await loadTraits();
await loadManeuvers();

const TRAIT = fs.readFileSync(path.join(TRAITS, "maneuvers", "transfiguration.dbu"), "utf8");
const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
const USE = fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8");
const DUR = fs.readFileSync(path.join(ROOT, "module", "durations.mjs"), "utf8");
const CHARACTER = fs.readFileSync(
  path.join(ROOT, "module", "data", "actor-character.mjs"), "utf8");
const INDEX = JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

/** One top-level function out of a module, sliced so it can be run. */
function source(text, name) {
  let at = text.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`no ${name}`);
  if (text.slice(at - 6, at) === "async ") at -= 6;
  return text.slice(at, text.indexOf("\n}\n", at) + 2);
}

const who = (tier) => ({
  name: "Tizi",
  system: { tierOfPower: tier, baseTierOfPower: tier, effects: { slots: {} } }
});

// --- The Maneuver as the rulebook lists it ----------------------------------------------------
{
  check("listed", INDEX.traits.includes("maneuvers/transfiguration.dbu"), true);

  const tf = getManeuver("transfiguration");
  check("loaded as a Standard Maneuver", tf?.type, "standard");
  check("costing two Actions", tf.actionCost, 2);
  check("and not a range of them, which is a different thing",
    [tf.actionCostMax ?? 0, Boolean(tf.actionCostOpen)], [0, false]);
  check("once a Combat Round", tf.usageLimit, { amount: 1, per: "round" });
  check("it is Special", tf.special, true);
  check("aimed at somebody", tf.requiresTarget, true);
  check("and it is not itself an attack", Boolean(tf.attacking), false);
  check("it is the flag it is", tf.transfiguration, true);

  // "KP Cost: 10(T)", the dearest Maneuver in the library.
  check("priced in Tiers of Power", tf.kiCostPerTier, 10);
  check("so 10 a Tier", [maneuverKiCost(tf, null, who(1)), maneuverKiCost(tf, null, who(4))],
    [10, 40]);

  for (const line of [
    "Make a Clash (Physical Strike vs Strike/Dodge) against an Opponent within your",
    "choose an Item – your Opponent becomes that Item until the end",
    "has their Size Category changed to suit this Item (your ARC",
    "make a Might Clash against that Opponent",
    "reduce your Dice Score for this\n  Clash by 1(T)",
    "cannot make any type of Maneuver until the end of",
    "If\n  that Item would be destroyed or used up (such as a Snack), that Character dies",
    "must spend a Karma Point to avoid dying",
    "They are still Defeated",
    "If you target a Character turned into an Item with the Transfiguration Maneuver, turn\n  them back to normal",
    "may spend 1 Counter Action",
    "all rolls involved become Urgent"
  ]) {
    check(`the entry says "${line.slice(0, 44).replace(/\n\s+/g, " ")}"`,
      TRAIT.includes(line), true);
  }

  const item = maneuverItemFrom(tf);
  check("the Item carries the flag", item.system.transfiguration, true);
  check("and reading it back gives it up",
    definitionOf({ id: "x", name: tf.name,
      system: { ...item.system, maneuverId: tf.id } }).transfiguration, true);

  check("no Skill opens it",
    Object.values(DBUCharacterData.SKILLS).some(s => s.specialManeuver === "transfiguration"),
    false);
  check("so an effect has to grant it",
    whyNotSpecial({ name: "Tizi", system: { effects: { slots: {} }, specialManeuvers: [] } },
      tf),
    "Tizi has not been granted access to Transfiguration. A Special Maneuver is gained "
    + "through an effect.");
}

// --- Two Clashes, of two different categories --------------------------------------------------
{
  // The first is the Grapple Check's pair of rolls. There is one Strike Roll in this
  // system - a Foundation decides what the Wound reads, not what Strike is - so "Physical
  // Strike" names the kind of attack this stands in for rather than a second value.
  check("the first Clash is opened on the Strike category",
    CHAT.includes('          category: "strike",\n          clashLabel: "Transfiguration",'),
    true);
  check("which is the pair the Grapple Check and the Thrust use",
    CHAT.includes('    label: "Strike Clash",'), true);
  check("and the defender picks which of the two they answer with",
    CHAT.includes('((uuid === clash.defenderUuid) && (clash.defenderRoll === "dodge"))'),
    true);
  check("there being one Strike Roll to read",
    /strike:\s*combatStrike,/.test(CHARACTER), true);

  // The second is a Might Clash, which follows rather than being chosen - where the
  // Thrust's second Clash is one of two effects a player picks between.
  check("the second is a Might Clash",
    CHAT.includes('    maneuverName: clash.maneuverName,\n'
      + '    clashLabel: "Transfiguration",'), true);
  check("opened from naming the Item rather than from a choice",
    CHAT.indexOf("async function chooseTransfiguredItem")
      < CHAT.indexOf("  await postMightClash(caster, target, {"), true);
  check("where the Thrust's second Clash is one of two effects chosen between",
    CHAT.includes('if (clash.thrust?.chosen) return;'), true);

  // A Might Clash can carry what settling it leaves behind now, the way a Skill Clash and
  // a Saving Throw Clash already could. It could not: it took `collision` and `grapple` by
  // name and nothing else, which is the shape the Blockade's payload went missing through.
  check("a Might Clash carries whatever it is handed",
    CHAT.includes("collision = null, grapple = null, ...leaves } = {}) {"), true);
  check("and spreads it onto the card", CHAT.includes("          ...leaves,\n"), true);
}

// --- The Might Clash's penalty for punching up, run ---------------------------------------------
{
  const penalty = new Function("fromUuidSync",
    `${source(CHAT, "transfigurationPenalty")}\nreturn transfigurationPenalty;`)(
      uuid => (uuid === "Actor.kuro") ? { system: { tierOfPower: THEIRS } } : null);

  globalThis.THEIRS = 1;
  const at = (mine, theirs, uuid = "Actor.a") => {
    globalThis.THEIRS = theirs;
    return penalty(
      { system: { tierOfPower: mine } },
      { transfiguration: { stage: "might" }, challengerUuid: "Actor.a",
        defenderUuid: "Actor.kuro" },
      uuid);
  };

  // "Reduce your Dice Score for this Clash by 1(T)" - the challenger's own Tier, which is
  // what (T) means on a number belonging to whoever is rolling it. Scaled, where the
  // Terrify's is flat.
  check("a target above you costs your own Tier",
    at(2, 3), [{ label: "Transfiguration - higher Tier", written: "-1(T)", value: -2 }]);
  check("which grows with you", at(5, 9)[0].value, -5);
  check("and the Terrify's is flat, which is the pair that shows these differ",
    source(CHAT, "terrifyPenalty").includes("value: -2 }]"), true);

  check("an equal Tier costs nothing, since equal is not higher", at(3, 3), []);
  check("and a target below you costs nothing", at(4, 2), []);
  check("the defender never takes it", at(1, 9, "Actor.kuro"), []);
  check("and a Clash that is not a Transfiguration carries nothing",
    penalty({ system: { tierOfPower: 1 } },
      { challengerUuid: "Actor.a", defenderUuid: "Actor.kuro" }, "Actor.a"), []);

  // On the Might Clash's own hook, which had none before this.
  // Two rows now: this penalty, and what Local Space and Deep Space add to a Knockback
  // that brought its own Advantage. This one is still first and is still unconditional.
  check("the Might category takes a row now",
    CHAT.includes("      ...transfigurationPenalty(actor, clash, uuid),"), true);
  check("read off the current Tier on both sides",
    (source(CHAT, "transfigurationPenalty").match(/tierOfPower/g) ?? []).length, 2);
  check("and never the Base Tier",
    source(CHAT, "transfigurationPenalty").includes("baseTierOfPower"), false);
}

// --- What beating it with a Counter Action does, run --------------------------------------------
{
  const notes = [];
  const opened = [];
  let flagged = null;

  const message = {
    speaker: { alias: "Tizi" },
    setFlag: async (scope, key, value) => { flagged = value; }
  };

  const body = source(CHAT, "settleTransfiguration");
  const settle = new Function(
    "fromUuidSync", "SCOPE", "CLASH_FLAG", "whoWonClash", "settledNote",
    "settleTransfigurationMight", "postTransfiguration",
    `${body}\nreturn settleTransfiguration;`)(
      uuid => ({
        "Actor.tizi": { name: "Tizi", uuid: "Actor.tizi" },
        "Actor.kuro": { name: "Kuro", uuid: "Actor.kuro" }
      }[uuid] ?? null),
      "dbu-ttrpg", "clash",
      new Function(`${source(CHAT, "whoWonClash")}\nreturn whoWonClash;`)(),
      async (msg, text) => { notes.push(text); },
      async () => { notes.push("(the Might stage)"); },
      async (actor, target, maneuver, options = {}) => {
        opened.push({ from: actor.uuid, at: target.uuid, urgent: Boolean(options.urgent) });
      });

  const run = async ({ counter = false, challenger, defender, stage = "strike" }) => {
    notes.length = 0; opened.length = 0; flagged = null;
    await settle(message, {
      maneuverName: "Transfiguration",
      challengerUuid: "Actor.tizi", challengerName: "Tizi", defenderUuid: "Actor.kuro",
      transfiguration: { stage, applied: false, item: "", counter, counterOffered: true },
      result: { challenger, defender }
    });
    return { notes: [...notes], opened: [...opened], flagged };
  };

  // Winning the first Clash: the Item is named on the card, by whoever won it.
  const won = await run({ challenger: { succeeded: false, total: 9 },
                          defender: { succeeded: false, total: 4 } });
  check("winning leaves the naming to the winner",
    won.notes[0], "Tizi has Kuro. They choose what Kuro has become.");
  check("and nothing is turned back", won.opened, []);

  // Losing it with no Counter Action spent: nothing.
  const lost = await run({ challenger: { succeeded: false, total: 3 },
                           defender: { succeeded: false, total: 8 } });
  check("losing does nothing at all", lost.notes, ["Kuro holds their shape."]);
  check("with nothing opened", lost.opened, []);

  // A tie goes to the Defender, so the Maneuver fails - and a tie is not a beat.
  const tied = await run({ counter: true, challenger: { succeeded: false, total: 7 },
                           defender: { succeeded: false, total: 7 } });
  check("a tie is the Defender's, so the Maneuver fails", tied.opened, []);
  check("but a tie is not beating it, and the Counter Action is spent anyway",
    tied.notes[0].includes("did not beat it outright"), true);

  // Beating it with a Counter Action spent: the whole use turns round.
  const turned = await run({ counter: true, challenger: { succeeded: false, total: 3 },
                             defender: { succeeded: false, total: 8 } });
  check("beating it turns the Maneuver back on whoever threw it",
    turned.opened, [{ from: "Actor.tizi", at: "Actor.tizi", urgent: true }]);
  check("which is the caster on both sides of it",
    turned.opened[0].from === turned.opened[0].at, true);
  check("and Urgently", turned.opened[0].urgent, true);
  check("said at the table", turned.notes[0].includes("turns back on Tizi"), true);

  // A Karmic Save on the defender's side is a beat too: it says they succeed.
  const saved = await run({ counter: true, challenger: { succeeded: false, total: 9 },
                            defender: { succeeded: true, total: 2 } });
  check("a Karmic Save beats it, whatever the numbers said", saved.opened.length, 1);
  // And one on the challenger's side is not beaten at all.
  const casterSaved = await run({ counter: true, challenger: { succeeded: true, total: 1 },
                                  defender: { succeeded: false, total: 9 } });
  check("and a Karmic Save on the caster's side is not beaten",
    casterSaved.opened, []);

  // The Might stage goes somewhere else entirely.
  const might = await run({ stage: "might", challenger: { succeeded: false, total: 9 },
                            defender: { succeeded: false, total: 1 } });
  check("the second stage is settled apart", might.notes, ["(the Might stage)"]);

  // Marked before anything else.
  check("the card is marked settled", won.flagged.transfiguration.applied, true);
  check("and the dispatch will not come back to it",
    CHAT.includes("  if (clash.transfiguration && clash.result && !clash.transfiguration.applied) {"),
    true);

  // A re-aimed Clash is not itself a Maneuver being used, so nothing answers it.
  check("nothing may be played in answer to the re-aimed one",
    CHAT.includes("        [RESPONDABLE_FLAG]: !urgent && isRespondable(maneuver),"), true);
  // And one button per side, not one per uuid - the same character is on both.
  check("one roll button per side, since both sides can be one character",
    CHAT.includes("  for (const uuid of new Set(clashParticipants(clash))) {"), true);
  // The urgency reaches the roll, which is where a willing failure is refused.
  check("Urgent reaches where a willing failure is asked for",
    CHAT.includes("    { urgent: Boolean(opened.urgent), senses,\n"), true);
  check("and Urgent already meant this", CHAT.includes("  if (urgent) return URGENT;"), true);

  // The Counter Action is spent, not offered back, and only while the Clash is open.
  check("spent before the dice", CHAT.includes("  if (clash.result || clash.transfiguration?.counter) return;"),
    true);
  check("out of the Counter pool", CHAT.includes('await spendActions(target, 1, "counter")'),
    true);
  check("and never offered on a Clash already aimed at its own user",
    CHAT.includes("            counterOffered: !aimedAtSelf"), true);
}

// --- Becoming the Item outright ------------------------------------------------------------------
{
  // "Cannot make any type of Maneuver until the end of the Combat Encounter." The Slot
  // existed and was read at the door; what it needed was somewhere to be written from.
  const slots = Object.fromEntries(allSlots().map(s => [s.key, s]));
  check("there is a Slot for using no Maneuver at all", Boolean(slots.maneuvers), true);
  check("and the door reads it",
    USE.includes('ui.notifications.warn(`${actor.name} cannot use any Maneuver right now.`);'),
    true);
  check("the Maneuver's own passive writes it",
    TRAIT.includes("if (anitem.stacks > 0) {\n    forbid maneuvers;\n}"), true);

  // Held as a Resource, because that is the thing here that takes a clock - the Blockade's
  // arrangement, and for the same reason.
  const declared = resourceDefinitions();
  check("the Resource is declared by this Maneuver", declared.anitem?.source,
    "Transfiguration");
  check("one of them at a time", declared.anitem?.max, 1);
  check("and not a Resource the rulebook names", declared.anitem?.internal, true);
  check("named for a reader all the same", declared.anitem?.label, "An Item");
  check("where the Blockade does the same thing",
    declared.blockaded?.source, "Blockade");

  // The clock runs to the end of the Encounter and is kept by whoever cast it.
  check("an Encounter clock, kept by the caster and naming the target",
    CHAT.includes("  await lasting(caster, {\n"
      + "    kind: KINDS.RESOURCE,\n"
      + '    key: "anitem",\n'
      + "    edge: EDGES.ENCOUNTER,\n"
      + "    on: target.uuid,"), true);
  check("as the Transfigured Condition's clock is",
    CHAT.includes("    kind: KINDS.CONDITION,\n"
      + '    key: "transfigured",\n'
      + "    edge: EDGES.ENCOUNTER,"), true);
  check("which is an edge that waits for nothing",
    (await import(modUrl("durations.mjs"))).edgesToWait(EDGES.ENCOUNTER), 0);

  // Not folded into the Transfigured Combat Condition, which is about somebody who can
  // still act.
  const transfigured = fs.readFileSync(
    path.join(TRAITS, "conditions", "transfigured.dbu"), "utf8");
  check("Transfigured itself forbids no Maneuvers",
    transfigured.includes("forbid maneuvers;"), false);
  check("what it does is blunt them", transfigured.includes("combatRolls -= 2(bT);"), true);
  check("and shut three narrower doors",
    ["signatureTechniques", "uniqueAbilities", "nonPhysicalAttacks"]
      .every(key => transfigured.includes(`forbid ${key};`)), true);
  check("which the file says is the difference between the two Clashes",
    TRAIT.includes("Transfigured is what losing the FIRST"), true);
}

// --- Turning them back ----------------------------------------------------------------------------
{
  const isAnItem = new Function(`${source(USE, "isAnItem")}\nreturn isAnItem;`)();

  check("somebody who is an Item is one",
    isAnItem({ system: { resources: { anitem: { stacks: 1 } } } }), true);
  check("somebody merely Transfigured is not",
    isAnItem({ system: { conditions: { transfigured: 1 }, resources: {} } }), false);
  check("nor is somebody at nothing",
    isAnItem({ system: { resources: { anitem: { stacks: 0 } } } }), false);
  check("nor nobody at all", isAnItem(null), false);
  check("which is the reading the file argues for",
    TRAIT.includes('"A Character turned into an Item" is read as one who has been through '
      + "the second Clash"), true);

  // The branch is taken before the Clash is opened, and takes the cost like any other use.
  check("the reversal comes before the Clash in the routing",
    USE.indexOf("    : (maneuver.transfiguration && isAnItem(targetActor))")
      < USE.indexOf("    : maneuver.transfiguration\n    ? await postTransfiguration("), true);
  check("after everything has been paid for",
    USE.indexOf("await payActions(actor, maneuver, actionsSpent);")
      < USE.indexOf("isAnItem(targetActor)"), true);

  // Both halves come off, and so do both clocks.
  for (const line of [
    'await setResource(target, "anitem", 0);',
    'await setCondition(target, "transfigured", 0);',
    'await clockOff(target, KINDS.RESOURCE, ["anitem"]);',
    'await clockOff(target, KINDS.CONDITION, ["transfigured"]);'
  ]) {
    check(`the reversal does: ${line}`, USE.includes(`  ${line}`), true);
  }
  check("and forgets which Item they were",
    USE.includes('    "system.transfigured.item": "",'), true);

  // Why the clocks matter: one left behind announces itself for something long gone.
  check("a clock that runs out is named whether or not the thing was there",
    DUR.includes("    ran.push(entry.source || entry.key);"), true);
  check("so there is a way to drop one that was undone early",
    DUR.includes("export async function clockOff(subject, kind, keys = []) {"), true);
  check("which sweeps for it, since the clock is not kept by the one it is about",
    source(DUR, "clockOff").includes("((entry.on || owner.uuid) === subject.uuid)"), true);

  // Run it: a clock kept by somebody else about this character comes off.
  const clockOff = new Function("globalThis",
    `${source(DUR, "clockOff")}\nreturn clockOff;`)({ canvas: { tokens: { placeables: [] } } });
  const held = (entries) => {
    const actor = { uuid: "Actor.kuro", system: { timed: entries } };
    actor.update = async (changes) => { actor.system.timed = changes["system.timed"]; };
    return actor;
  };

  const own = held([
    { kind: "resource", key: "anitem", edge: "encounter" },
    { kind: "condition", key: "prone", edge: "end" }
  ]);
  check("one of their own comes off", await clockOff(own, "resource", ["anitem"]), 1);
  check("and the rest stays", own.system.timed.map(e => e.key), ["prone"]);

  const other = held([{ kind: "resource", key: "anitem", edge: "encounter", on: "Actor.goro" }]);
  check("one about somebody else does not come off",
    await clockOff(other, "resource", ["anitem"]), 0);
  check("asking for nothing takes nothing", await clockOff(own, "resource", []), 0);
  check("and neither does asking about nobody", await clockOff(null, "resource", ["anitem"]), 0);
}

// --- Dying as an Item ------------------------------------------------------------------------------
{
  // Being Defeated is derived from Life Points, not stored - so writing it writes nothing.
  // The first version of this wrote `system.defeated` and did exactly that.
  check("Defeated is worked out rather than written",
    CHARACTER.includes('    this.defeated = (this.life.value <= this.life.min) && permits(this.effects.slots, "defeat");'),
    true);
  check("and there is no field of that name to write",
    /schema\.defeated\s*=/.test(CHARACTER), false);
  check("so what the button writes is the Life",
    CHAT.includes("  await reduceLifePoints(target, target.system.life.value,"), true);
  check("in both branches, since they are Defeated either way",
    (source(CHAT, "transfigurationDestroyed").match(/reduceLifePoints/g) ?? []).length, 1);

  // The Karma Point is offered, not spent for them.
  check("the Karma Point is a choice with a price",
    CHAT.includes('      { action: "karma", label: `Spend a Karma Point (${karmaAvailable(target)} left)` },'),
    true);
  check("taken through the same spender every Karmic Effect goes through",
    CHAT.includes('await spendKarma(target, { name: "Transfiguration", cost: 1 })'), true);
  check("which refuses it when they have not got one",
    fs.readFileSync(path.join(ROOT, "module", "karma.mjs"), "utf8")
      .includes("  if (karma < cost) {"), true);
  check("and the card says which of the two happened",
    CHAT.includes("spends a Karma Point and lives"), true);

  // Nothing watches for a teacup breaking, so it is a button.
  check("pressed rather than watched for",
    CHAT.includes('      broken.textContent = `${clash.transfiguration.item || "The Item"} is destroyed`;'),
    true);
  check("by whoever is running the fight, or whoever owns the teacup",
    CHAT.includes("      && (defender?.isOwner || game.user.isGM)) {"), true);
}

// --- What Item they are, kept where it lasts ---------------------------------------------------------
{
  check("the character remembers what they were turned into",
    /schema\.transfigured\s*=\s*new fields\.SchemaField/.test(CHARACTER), true);
  check("as text, there being no objects here to point at",
    CHARACTER.includes('      item: new fields.StringField({ required: true, blank: true, initial: "" }),'),
    true);
  check("and who did it", CHARACTER.includes("      byName: new fields.StringField("), true);
  check("written when the Item is named",
    CHAT.includes('    "system.transfigured.item": named,'), true);

  // Drawn on the sheet, because the card that named it scrolls away inside a round.
  const SHEET = fs.readFileSync(
    path.join(ROOT, "module", "sheets", "actor-character-sheet.mjs"), "utf8");
  const COMBAT = fs.readFileSync(
    path.join(ROOT, "templates", "parts", "actor-combat.hbs"), "utf8");
  check("the sheet says what they are", SHEET.includes("    context.transfigured = system.transfigured?.item"),
    true);
  check("and whether the second Clash landed",
    SHEET.includes("            ? \"An Item outright: no Maneuvers of any kind until the Encounter ends\""),
    true);
  check("drawn as its own row", COMBAT.includes("        <em>Turned into</em>"), true);
}

// --- What is not built, recorded rather than guessed at ------------------------------------------------
{
  // The Exploitable line's rider needs three facts joined and the third does not exist.
  // One string, space-joined by the folded header block - which is what the comma in it
  // needs, since `coerce` splits an unfolded value on commas.
  check("the rider is carried as written",
    getManeuver("transfiguration").exploitable.endsWith(
      "you automatically fail the Strike Roll for this Maneuver's effects."), true);
  check("with no line break left in it",
    getManeuver("transfiguration").exploitable.includes("\n"), false);
  check("and nothing applies it",
    CHAT.includes("automaticallyFail") || CHAT.includes("thresholdCrossed"), false);
  check("the two facts that do exist: a Threshold is a Moment with a pending list",
    CHARACTER.includes("pending"), true);
  check("and an attack knows what opening it came through",
    CHAT.includes("          provokedBy,"), true);
  check("which the file says is two of the three",
    TRAIT.includes("The first two\n# exist"), true);

  // Minions, Squares and the ARC's Size Category call.
  check("Non-Minion is the first Minion line that restricts anything",
    TRAIT.includes("the first Minion line in these rules that is a restriction"), true);
  check("and there are no Minions to refuse",
    [...Object.keys(getTrait("transfiguration") ?? {})].includes("minions"), false);
  check("the Size Category is the ARC's, and the Slot for it is named on the card",
    CHAT.includes("<code>size.steps</code>"), true);
  check("which is a Slot that exists",
    Boolean(Object.fromEntries(allSlots().map(s => [s.key, s]))["size.steps"]), true);
}

console.log(`${failed} failing`);
process.exit(failed ? 1 : 0);
