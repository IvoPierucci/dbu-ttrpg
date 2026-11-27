/**
 * The Blockade Maneuver: the first Counter that answers something other than an attack.
 *
 * Two things are worth running rather than reading. A Ki Point Cost written in Tiers of
 * Power, which no Maneuver in the library had ever been given - the field did not exist,
 * so "2(T)" had nowhere to go. And the forbid, which is the interesting half: "cannot use
 * the Movement Maneuver for the remainder of their Turn" is written in the Movement
 * Maneuver's own file, because a forbid has to be written by a passive on the character it
 * binds and the Character being blocked does not own somebody else's Blockade.
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
globalThis.game = { combat: null };

const TRAITS = path.join(ROOT, "traits");
globalThis.foundry.utils.fetchJsonWithTimeout = async () =>
  JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));
globalThis.fetch = async url => {
  const file = path.join(TRAITS, String(url).replace("systems/dbu-ttrpg/traits/", ""));
  if (!fs.existsSync(file)) return { ok: false, status: 404, statusText: "missing" };
  return { ok: true, status: 200, text: async () => fs.readFileSync(file, "utf8") };
};

const { loadTraits, resourceDefinitions } = await import(modUrl("effects/traits.mjs"));
const { loadManeuvers, getManeuver, maneuverKiCost, movementSquares } =
  await import(modUrl("maneuvers.mjs"));
const { compile } = await import(modUrl("effects/parser.mjs"));
const { applyPassives, permits } = await import(modUrl("effects/interpreter.mjs"));
await loadTraits();
await loadManeuvers();

const TRAIT = fs.readFileSync(path.join(TRAITS, "maneuvers", "blockade.dbu"), "utf8");
const MOVEMENT = fs.readFileSync(path.join(TRAITS, "maneuvers", "movement.dbu"), "utf8");
const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
const USE = fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8");
const INDEX = JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

const script = text => text.slice(text.indexOf("\n---") + 4);

// --- The Maneuver as the rulebook lists it ------------------------------------------------
{
  check("listed", INDEX.traits.includes("maneuvers/blockade.dbu"), true);

  const blockade = getManeuver("blockade");
  check("loaded as a Counter Maneuver", blockade?.type, "counter");
  check("costing 1 Counter Action", blockade.actionCost, 1);
  check("aimed at nobody, because it answers a card", blockade.requiresTarget, false);
  check("and not an attack", blockade.attacking, false);

  check("the entry is there whole", [
    blockade.text.includes("Blockade Maneuver: Protect your allies by standing in the way."),
    blockade.text.includes("make a Clash (Impulsive) against that Character"),
    blockade.text.includes("cannot use the Movement Maneuver for the remainder of their Turn"),
    blockade.text.includes("(they regain any Actions or Ki Points spent)"),
    blockade.text.includes("you trigger their Exploit Maneuver.")
  ], [true, true, true, true, true]);
}

// --- A Ki Point Cost in Tiers of Power, which no Maneuver had ever had ------------------------
{
  // "KP Cost: 2(T)". The schema had a flat cost and one per Base Tier, because those were
  // the two the rulebook had used on a Maneuver - the Profiles have had a (T) since they
  // were built and no Maneuver did.
  const blockade = getManeuver("blockade");
  check("the file prices it in Tiers of Power", blockade.kiCostPerTier, 2);
  check("and not flat", blockade.kiCost, 0);

  const at = tier => maneuverKiCost(blockade, null, { system: { tierOfPower: tier } });
  check("so it costs 2 a Tier", [at(1), at(3), at(5)], [2, 6, 10]);

  // Breakthrough: "When you temporarily increase your Tier of Power, you do not increase your Ki Point Costs" (the user's
  // report) - a Tier raised above the Base prices it at the Base; one lowered below it, at the lower.
  check("a Tier raised above the Base Tier prices it at the Base (Breakthrough); lowered, at the Tier",
    [maneuverKiCost(blockade, null, { system: { tierOfPower: 4, baseTierOfPower: 1 } }),
     maneuverKiCost(blockade, null, { system: { tierOfPower: 2, baseTierOfPower: 3 } })], [2, 4]);

  // The order in baseKiCost: a Maneuver priced in (bT) is still priced in (bT).
  check("a Maneuver priced in Base Tiers is untouched",
    maneuverKiCost(getManeuver("energy-charge"), null,
      { system: { tierOfPower: 9, baseTierOfPower: 2 } }), 4);
}

// --- The forbid, run -------------------------------------------------------------------------
{
  // "That Character stops using the Movement Maneuver and cannot use the Movement Maneuver
  // for the remainder of their Turn." Written in movement.dbu because a forbid is written
  // by a passive on the character it binds, and the blocked Character owns their own
  // Movement Maneuver and not somebody else's Blockade.
  const { program, errors } = compile(script(MOVEMENT), null);
  check("the Movement Maneuver's script compiles", errors.map(e => e.message), []);

  const entry = { program, priority: 6, sourceId: "movement", sourceName: "Movement",
                  level: 0, stacks: 1, armed: true, available: true };

  const slotsWith = resources => applyPassives([entry], "core",
    { data: { resources, tierOfPower: 3 }, errors: [], context: {}, queue: [] }).slots;

  const free = slotsWith({});
  check("nobody blockaded may use the Movement Maneuver",
    permits(free, "maneuver.movement"), true);

  const held = slotsWith({ blockaded: { stacks: 1, max: 1 } });
  check("and somebody blockaded may not",
    permits(held, "maneuver.movement"), false);

  // Narrow: it forbids the Maneuver by name and not movement in general, and not
  // everything else a character might do.
  check("nothing else is closed off with it",
    [permits(held, "maneuvers"), permits(held, "attackingManeuvers"),
     permits(held, "maneuver.basic-attack")],
    [true, true, true]);

  // And the gate that reads it is the one use-maneuver already had.
  check("read by the gate that names a Maneuver outright",
    USE.includes("if (maneuver.id && !permits(slots, `maneuver.${maneuver.id}`)) {"), true);
}

// --- The Resource it is held as -----------------------------------------------------------------
{
  const declared = resourceDefinitions();
  check("declared by the file whose rule hands it out", declared.blockaded?.source, "Blockade");
  check("one stack and no more", declared.blockaded?.max, 1);
  check("and named for the sheet", declared.blockaded?.label, "Blockaded");

  // Both files say where the other half is, because the rule is split across two of them.
  check("Blockade says why its forbid is not in it",
    TRAIT.includes("it cannot be here: a Trait's passives run on whoever owns it"), true);
  check("and Movement says whose rule it is carrying",
    MOVEMENT.includes("The Resource is declared in maneuvers/blockade.dbu"), true);

  // The clock is theirs: "for the remainder of their Turn".
  check("with a clock to the end of their own turn",
    CHAT.includes('kind: KINDS.RESOURCE, key: "blockaded", edge: EDGES.END, source: "Blockade"'),
    true);
}

// --- The Movement card, which is what it is played from ----------------------------------------
{
  check("a Movement card says who moved and what it cost",
    CHAT.includes("[MOVEMENT_FLAG]: {\n                actorUuid: actor.uuid,"), true);
  check("and the cost is what was actually paid, not the listed price",
    USE.includes("          ki: moving.fromSelf,\n          store: moving.store ? { itemId: moving.store.id, ki: moving.fromStore } : null\n        }"), true);

  // Out of sequence too, which this first said the opposite of. "If a Character within
  // range of your Normal Speed uses the Movement Maneuver" is the whole of the condition
  // and it says nothing about whose turn it is - the restriction was mine, not the
  // rulebook's, and the Sudden Stop Maneuver handing out an Out-of-Sequence Movement is
  // what turned it up.
  check("an Out-of-Sequence Movement is one to block like any other",
    CHAT.includes("...((maneuver.movement)"), true);

  // One Movement is stopped once, however many people stood in the way.
  check("a stopped Movement cannot be stopped again",
    CHAT.includes('? "this Movement has already been stopped"'), true);
  check("and you cannot stand in your own way",
    CHAT.includes("? \"you cannot stand in your own way\""), true);
  check("the Counter group opens on a Movement card too",
    CHAT.includes("const counterGroup = (attack || canBlock"), true);
}

// --- Played, and settled -------------------------------------------------------------------------
{
  // Reached before the guard that says a Counter has to answer an attack, since this one
  // does not.
  check("the Blockade is reached before the attack guard",
    CHAT.indexOf("if (blockade?.blockade) return playBlockade(message, actor, blockade);")
      < CHAT.indexOf("  if (!attack || attack.result) return;"), true);

  // Ki first, then the Action, so somebody who cannot pay has spent neither.
  check("it pays its own way",
    CHAT.includes("if (!await spendManeuverCost(actor, maneuver, maneuverKiCost(maneuver, null, actor))) return;"),
    true);
  check("and hands the Ki back if the Action cannot be spent",
    CHAT.includes("    await refundManeuverCost(actor, maneuver);"), true);

  // "A Clash (Impulsive)" - one named, so neither side is asked anything.
  check("one Saving Throw, so there is nothing to choose",
    CHAT.includes('saves: ["impulsive"],'), true);

  // Winning.
  check("winning stops the Movement",
    CHAT.includes("await moved.setFlag(SCOPE, MOVEMENT_FLAG, { ...movement, stopped: true });"),
    true);
  check("hands back the Actions",
    CHAT.includes('if (spent.actions > 0) await refundActions(mover, spent.actions, spent.kind || "standard");'),
    true);
  check("hands back the Ki",
    CHAT.includes('await refundManeuverCost(mover, { name: "Movement", kiCost: spent.ki });'), true);
  check("and says how far the blocker may step",
    CHAT.includes('const speed = movementSquares(blocker, "normal");'), true);

  // Losing.
  check("losing provokes their Exploit, aimed at whoever stepped in",
    CHAT.includes("          targetUuid: blocker.uuid,\n          reason: \"Blockade - they stepped into your path and lost the Clash\""),
    true);
  check("and settles once, like the other two",
    CHAT.includes("if (clash.blockade && clash.result && !clash.blockade.applied) {"), true);
}

// --- Normal Speed, which the card says because the map is the table's -----------------------------
{
  const blocker = { system: { speed: { normal: 7, boosted: 14 } } };
  check("a blocker's Normal Speed is what the card reports",
    movementSquares(blocker, "normal"), 7);
  // The sentence wraps in the file, so the half carrying the claim is what is looked for.
  check("the map is left to them", TRAIT.includes("system moves nobody"), true);
}

console.log(failed ? `\n${failed} failing` : "\nall good");
process.exit(failed ? 1 : 0);
