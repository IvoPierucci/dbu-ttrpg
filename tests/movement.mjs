/**
 * The Movement Maneuver.
 *
 * The first Maneuver whose own Ki Point Cost is a choice rather than a number: "N/A" until
 * you decide to go faster, and then 3(T) - or 5(T) with Rapid Movement on top. So the
 * price is worked out from the answer rather than read off the file, which is a thing
 * nothing else here does and worth pinning.
 *
 * The dialog is driven for real, with DialogV2.wait handing back the content it was about
 * to show: what is checked is the markup a player would be looking at, including the two
 * Speeds in Squares - "up to your Boosted Speed" is not a number, and the number is the
 * whole of what the system knows about a movement.
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
globalThis.ui = { notifications: { warn: () => {}, error: () => {}, info: () => {} } };
// dodgeBonus reaches for the attacker by uuid now, for the Analysis Maneuver s bonus.
globalThis.fromUuidSync = () => null;
globalThis.Handlebars = {
  escapeExpression: s => String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
};

const TRAITS = path.join(ROOT, "traits");
globalThis.foundry.utils.fetchJsonWithTimeout = async () =>
  JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));
globalThis.fetch = async url => {
  const file = path.join(TRAITS, String(url).replace("systems/dbu-ttrpg/traits/", ""));
  if (!fs.existsSync(file)) return { ok: false, status: 404, statusText: "missing" };
  return { ok: true, status: 200, text: async () => fs.readFileSync(file, "utf8") };
};

let shown = null;
let answer = null;
globalThis.foundry.applications = {
  api: { DialogV2: { wait: async options => { shown = options; return answer; } } }
};

const { MOVEMENT_SPEEDS, RAPID_MOVEMENT_PER_TIER, movementKiCost, movementSquares,
        loadManeuvers, getManeuver } = await import(modUrl("maneuvers.mjs"));
const { loadTraits, resourceLimits } = await import(modUrl("effects/traits.mjs"));
const { compile } = await import(modUrl("effects/parser.mjs"));
const { applyPassives, applySlot } = await import(modUrl("effects/interpreter.mjs"));

await loadTraits();
await loadManeuvers();

const TRAIT = fs.readFileSync(path.join(ROOT, "traits", "maneuvers", "movement.dbu"), "utf8");
const USE = fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8");
const INDEX = JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

const EN_DASH = "\u2013";

/** A character, as far as any of this reads one. */
const someone = (tier = 3, normal = 6, boosted = 12) => ({
  name: "Tizi",
  system: {
    tierOfPower: tier,
    speed: { normal, boosted },
    resources: {},
    effects: { slots: {} }
  }
});

// --- The Maneuver as the rulebook lists it ---------------------------------------------
{
  check("a Standard Maneuver", /^type: standard$/m.test(TRAIT), true);
  check("costing 1 Action", /^actionCost: 1$/m.test(TRAIT), true);
  check("twice a Combat Round", /^usageLimit: 2\/round$/m.test(TRAIT), true);
  check("listing no Ki Point Cost of its own", /^kiCost: 0$/m.test(TRAIT), true);
  check("and an opening for anybody whose Melee Range you leave",
    /^exploitable: If you leave the Melee Range of an Opponent\.$/m.test(TRAIT), true);
  check("listed", INDEX.traits.includes("maneuvers/movement.dbu"), true);

  const entry = getManeuver("movement").text;
  check("the entry is carried whole", [
    entry.includes("Movement Maneuver [2/Round]: Getting from point A to point B"),
    entry.includes(`${EN_DASH}Exploitable: If you leave the Melee Range of an Opponent.`),
    entry.includes("* Rapid Movement:"),
    entry.includes("* Exploit on Movement:"),
    // The worked example is the ruling, and the table reads it off the card.
    entry.includes("your 4th Square of movement as part of an 8 Square movement")
  ], [true, true, true, true, true]);

  // No target: the target is a Square.
  check("it asks for no target", /^requiresTarget: false$/m.test(TRAIT), true);
  check("and the file says why", TRAIT.includes("the target is a Square"), true);
}

// --- What the choice costs ----------------------------------------------------------------
{
  const tizi = someone(3);

  // "Move a number of Squares up to your Normal Speed." Nothing, which is what the entry's
  // "KP Cost: N/A" means.
  check("Normal Speed costs nothing", movementKiCost(tizi, { speed: "normal" }), 0);

  // "You may increase the KP Cost of this Maneuver to 3(T) to instead move up to your
  // Boosted Speed." To, not by: it is what the Maneuver costs once you have decided.
  check("Boosted Speed is 3(T)", movementKiCost(tizi, { speed: "boosted" }), 9);
  check("which grows with the Tier of Power",
    [1, 2, 5].map(tier => movementKiCost(someone(tier), { speed: "boosted" })), [3, 6, 15]);

  // "You can increase the Ki Point Cost by 2(T) to use Rapid Movement." By, this time -
  // on top of whichever Speed was chosen.
  check("Rapid Movement adds 2(T) to a Normal one",
    movementKiCost(tizi, { speed: "normal", rapid: true }), 6);
  check("and to a Boosted one", movementKiCost(tizi, { speed: "boosted", rapid: true }), 15);
  check("the two are not the same amount",
    [MOVEMENT_SPEEDS.boosted.kiCostPerTier, RAPID_MOVEMENT_PER_TIER], [3, 2]);

  // Asked with nothing chosen, it is the cheapest thing it could be.
  check("no choice is the Normal one", movementKiCost(tizi), 0);

  // Through the engine, so an effect can discount the Maneuver the way it discounts any
  // other - a hand-rolled sum is what makes a (bT) discount silently do nothing.
  const discounted = someone(3);
  discounted.system.effects.slots["movement.kiCost"] =
    { add: -4, multiply: 1, set: null, min: null, max: null, clamp: null };
  check("a discount reaches it", movementKiCost(discounted, { speed: "boosted" }), 5);
  check("and cannot make it pay you",
    movementKiCost(discounted, { speed: "normal" }), 0);

  // Which Speed bounds the movement, in Squares - the half the system actually knows.
  check("Normal Speed is the Normal Speed", movementSquares(someone(3, 6, 12), "normal"), 6);
  check("and Boosted the Boosted", movementSquares(someone(3, 6, 12), "boosted"), 12);
}

// --- What the dialog shows -------------------------------------------------------------------
{
  // askMovement is private, so it is cut out and run: what is checked is the markup a
  // player would be looking at.
  // Both are exported now - the out-of-sequence path reaches them - so the slice has to
  // start after the keyword and stop before the next one's, or it carries a stray
  // `export` into a Function body that cannot have one.
  const from = USE.indexOf("async function askMovement(");
  const to = USE.indexOf("export async function takeRapidMovement(");
  check("the dialog is where it is expected", from > 0 && to > from, true);

  const askMovement = new Function(
    "MOVEMENT_SPEEDS", "RAPID_MOVEMENT_PER_TIER", "movementKiCost", "movementSquares",
    `${USE.slice(from, to)}\nreturn askMovement;`
  )(MOVEMENT_SPEEDS, RAPID_MOVEMENT_PER_TIER, movementKiCost, movementSquares);

  shown = null;
  answer = { speed: "boosted", rapid: true };
  const chosen = await askMovement(someone(3, 6, 12));
  const html = shown?.content ?? "";

  check("both Speeds are offered",
    [html.includes('value="normal"'), html.includes('value="boosted"')], [true, true]);
  check("each with what it costs",
    [html.includes("0 KP"), html.includes("9 KP")], [true, true]);
  // "Up to your Boosted Speed" is not a number, and this is the number.
  check("and how far it actually is",
    [html.includes("up to 6 Squares"), html.includes("up to 12 Squares")], [true, true]);
  check("the cheaper one starts selected",
    /value="normal" checked/.test(html), true);

  check("Rapid Movement is an extra rather than a third choice",
    html.includes('type="checkbox" name="rapid"'), true);
  check("priced at 2(T)", html.includes("+6 KP"), true);
  check("and saying what it buys",
    html.includes("increase your Strike Rolls by") && html.includes("1(T)"), true);

  // The movement itself is the table's, and the card says the one thing that is not.
  check("the dialog hands the map back to the table",
    html.includes("Move on the map yourself"), true);
  check("and warns what leaving a Melee Range does",
    html.includes("hands them the Exploit Maneuver"), true);

  check("what it answers is the choice", chosen, { speed: "boosted", rapid: true });

  // Backing out is a real answer: nothing is paid and the Maneuver is not used.
  answer = null;
  check("and backing out answers nothing", await askMovement(someone()), null);
}

// --- Asked before anything is paid, and the price follows it -------------------------------------
{
  check("the choice is made before the Ki is spent",
    USE.indexOf("crossing = await askMovement(actor);")
      < USE.indexOf("await spendManeuverCost(actor, maneuver, moving.fromSelf)"), true);
  // Asked as "is the Actions call after this one" rather than as "is it after the first
  // call of that name in the file": branches that pay for themselves sit above this path
  // and use the same call, and the first of them is not the one this is about.
  check("and before the Actions are taken",
    USE.indexOf("await payActions(actor, maneuver, actionsSpent);",
      USE.indexOf("crossing = await askMovement(actor);")) > 0, true);
  check("backing out drops the Maneuver",
    USE.includes("if (!crossing) return false;"), true);

  // The first Maneuver whose price is not a number on its file.
  check("the price is what was chosen",
    USE.includes("let price = crossing\n    ? movementKiCost(actor, crossing)"), true);
  check("and everything else still pays what its Profile says",
    USE.includes(": maneuverKiCost(maneuver, declared, actor) + (Number(sustaining?.extraKi) || 0)"), true);
}

// --- Rapid Movement's Strike bonus --------------------------------------------------------------
{
  // Held as a Resource so the clock can take it away - the shape Combat Recovery uses for
  // the Defense Value it costs.
  check("the Resource is declared with a ceiling of one", resourceLimits().rapid, 1);

  check("it is granted when Rapid Movement was taken",
    USE.includes("if (crossing?.rapid) await takeRapidMovement(actor);"), true);
  // "Until the end of your turn", which this system calls "turn".
  check("and put on a clock that runs out with the turn",
    USE.includes('await expiresAt(actor, "rapid", "turn");'), true);
  check("written whole, since a removal on an ObjectField needs it",
    USE.includes('await actor.update({ "system.resources": replaceObject(held) });'), true);

  // The rule itself is in the file, as a passive reading the Resource.
  const script = TRAIT.slice(TRAIT.indexOf("\n---") + 4);
  const { program, errors } = compile(script, null);
  check("the Maneuver's script compiles", errors.map(e => e.message), []);

  const entry = { program, priority: 6, sourceId: "movement", sourceName: "Rapid Movement",
                  level: 0, stacks: 1, armed: true, available: true };

  // In the phase the Slot lives in: `strike` is LATE, and a passive only lands in its
  // own phase. Applied as "core" the bonus reads as doing nothing, which is the ordering
  // working rather than the rule failing.
  const without = { resources: {}, tierOfPower: 3 };
  check("with no Rapid Movement it does nothing",
    applyPassives([entry], "late", { data: without, errors: [], context: {}, queue: [] })
      .slots.strike, undefined);

  const with_ = { resources: { rapid: { stacks: 1, max: 1 } }, tierOfPower: 3 };
  const slots = applyPassives([entry], "late",
    { data: with_, errors: [], context: {}, queue: [] }).slots;
  check("and with it, the Strike Roll gains 1(T)", applySlot(slots, "strike", 10), 13);
}

// --- What is not built, and why ------------------------------------------------------------------
{
  check("the file says stopping the movement is not built",
    TRAIT.includes("This system moves nobody"), true);

  // And Combat Recovery's own note follows: the carrier it was waiting on exists, so the
  // reason it gives is no longer the reason.
  const RECOVERY = fs.readFileSync(
    path.join(TRAITS, "maneuvers", "combat-recovery.dbu"), "utf8");
  check("Combat Recovery no longer blames the carrier",
    RECOVERY.includes("does not carry it yet"), false);
  check("and says what is actually left of it",
    RECOVERY.includes("What\n#     is left is this end of it"), true);

  // The offer itself does go out: `exploitable` is what draws it, in the rulebook's words.
  check("the opening is offered in the rulebook's own words",
    getManeuver("movement").exploitable, "If you leave the Melee Range of an Opponent.");
}

// --- Rapid Movement's Dodge bonus, against the Exploit that Movement provoked -------------------
// "Increase your Dodge Roll against an Exploit Maneuver provoked by this instance of
// Movement by 1(T)."
//
// This instance: the card. A character may move twice a round and pay for Rapid Movement
// on one of them, so "a Movement of mine" is not the question - "that one" is.
{
  const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");

  // --- The links between the two ends -------------------------------------------------
  // The offer says which card opened the door.
  check("an Exploit offer carries what provoked it",
    CHAT.includes("provokedBy: {\n          maneuverId: maneuver.id,"), true);
  check("including which card, not only which Maneuver",
    CHAT.includes("messageId: card.id"), true);

  // The Exploit's own recursion spreads the offer, so it arrives with nothing added.
  check("the Exploit hands it on untouched",
    CHAT.includes("return takeOutOfSequence(message, actor, {\n      ...offer,"), true);
  // The options object grew a third entry when the Reflect Maneuver arrived, so this asks
  // for the part it is about rather than for the line as it was written that day.
  // The options object has grown twice now - the Reflect Maneuver, and then the grants a
  // Feint attaches - so this asks for the part it is about rather than for the line.
  check("and the attack it becomes keeps it",
    CHAT.includes("        provokedBy: offer.provokedBy ?? null,"), true);
  check("stored on the attack itself", CHAT.includes("          provokedBy,"), true);

  // The Movement card says what was paid for, set before the offers are written.
  check("a Movement card says whether Rapid Movement was paid for",
    USE.includes("rapidMovement: Boolean(crossing?.rapid)"), true);
  check("marked before the offers are written",
    CHAT.indexOf("[RAPID_FLAG]: { actorUuid: actor.uuid }")
      < CHAT.indexOf("offerExploits(card, actor, maneuver);"), true);

  // --- And the Dodge that reads it ------------------------------------------------------
  const from = CHAT.indexOf("function dodgeBonus(");
  const to = CHAT.indexOf("/**\n * What failed Steadfast Checks cost");
  check("the Dodge parts are where they are expected", from > 0 && to > from, true);

  // RAPID_FLAG is a module constant, so the cut-out code needs it handed in - and it is
  // handed in by its real value, read off the source, rather than by one written here
  // that could quietly stop matching.
  const flagName = /const RAPID_FLAG = "(\w+)";/.exec(CHAT)?.[1] ?? "";
  check("the flag has a name", Boolean(flagName), true);

  const dodgeBonus = new Function("musclePenalty", "thresholdPenalty", "openedAgainst", "rideExploitBonus",
    "flyinDodge", "game", "SCOPE", "RAPID_FLAG",
    // Mind Reading's bonus - nobody here has been read.
    `${CHAT.slice(from, to)}\nfunction mindReadBonus() { return []; }\nfunction telepathyBonus() { return []; }\nfunction lockOnDodge() { return []; }\nfunction studiedDodge() { return []; }
function draconicParts() { return []; }\nfunction telepathicDodge() { return []; }\nfunction guidanceDodgeParts() { return []; }\nfunction partyParts() { return []; }\nfunction bioBondParts() { return []; }\nfunction fleetDodge() { return []; }
function weakParts() { return []; }
function balancedParts() { return []; }
function mysticCover() { return false; }
function speedsterDodge() { return []; }
function tacticianParts() { return []; }\nfunction inferiorDodge() { return []; }\nfunction zenCounterParts() { return []; }\nfunction analyticParts() { return []; }\nfunction markedParts() { return []; }\nfunction supportParts() { return []; }\nfunction hiddenRollParts() { return []; }
function respondingParts() { return []; }\nfunction vehicleDodgeOf() { return null; }\nreturn dodgeBonus;`
  )(() => [], () => [], () => [], () => [], () => [], {
    messages: {
      get: id => (id === "rapid-card")
        ? { getFlag: (scope, key) => (key === flagName) ? { actorUuid: "Actor.mover" } : null }
        : (id === "plain-card")
        ? { getFlag: () => null }
        : null
    }
  }, "dbu-ttrpg", flagName);

  const mover = {
    uuid: "Actor.mover",
    system: { defenseValue: 10, tierOfPower: 3, rollModifiers: { dodge: 0 },
              diminishing: { defense: { penalty: 0 } } }
  };
  const labels = attack => dodgeBonus(mover, { attack }).map(part => part.label);
  const total = attack =>
    dodgeBonus(mover, { attack }).reduce((sum, part) => sum + part.value, 0);

  // An attack nobody provoked is an attack like any other.
  check("an ordinary attack gets nothing", labels(null), ["Defense Value", "Dim. Defense"]);
  check("and so does one provoked by somebody else's Movement",
    labels({ provokedBy: { messageId: "plain-card" } }),
    ["Defense Value", "Dim. Defense"]);
  check("or by a card that is no longer there",
    labels({ provokedBy: { messageId: "gone" } }), ["Defense Value", "Dim. Defense"]);

  // The one it was paid for.
  const provoked = { provokedBy: { messageId: "rapid-card", maneuverId: "movement" } };
  check("the Exploit that Movement provoked gets the bonus",
    labels(provoked), ["Defense Value", "Dim. Defense", "Rapid Movement"]);
  check("worth 1(T)", total(provoked) - total(null), 3);
  check("written as the rule writes it",
    dodgeBonus(mover, { attack: provoked }).at(-1).written, "+1(T)");

  // Somebody else dodging that same attack is not the one who paid for it.
  const other = { ...mover, uuid: "Actor.other" };
  check("and nobody else's Dodge takes it",
    dodgeBonus(other, { attack: provoked }).map(part => part.label),
    ["Defense Value", "Dim. Defense"]);

  // Cross Counter is a Dodge Roll with the Defense Value inside it halved, so the rule
  // reaches it: "increase your Dodge Roll".
  const crossed = dodgeBonus(mover, { attack: provoked, halved: true });
  check("Cross Counter's Dodge takes it too",
    crossed.map(part => part.label), ["Defense Value (halved)", "Dim. Defense", "Rapid Movement"]);
  check("with the halving where it belongs", crossed[0].value, 5);

  // The file says it is built, since it used to say it could not be.
  check("and the file no longer says it is impossible",
    TRAIT.includes("Rapid Movement is built, both halves."), true);
  check("nor that the attack cannot carry it",
    TRAIT.includes("carries nothing about what provoked it"), false);
}

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
