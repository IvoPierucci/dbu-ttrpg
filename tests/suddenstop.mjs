/**
 * The Sudden Stop Maneuver.
 *
 * "If you are moved by the effect of another Character." The interesting part is that
 * this is one question rather than a list: every effect in these rules that moves
 * somebody opens a Clash carrying a collision, and the Character moved is its Defender.
 * So `beingMovedOn` is cut out and run against every shape of card there is - the Launch,
 * the Thrust's Push Back, the Knockback - and against the ones it must say no to.
 *
 * And the arithmetic, which is where a rule like this goes wrong quietly: Launching
 * doubles the Collision Damage and this halves it, and settling them one after the other
 * would take a point off an odd number that the rules leave exactly where it started.
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

const { loadTraits } = await import(modUrl("effects/traits.mjs"));
const { loadManeuvers, getManeuver } = await import(modUrl("maneuvers.mjs"));
await loadTraits();
await loadManeuvers();

const TRAIT = fs.readFileSync(path.join(TRAITS, "maneuvers", "sudden-stop.dbu"), "utf8");
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

// --- The Maneuver as the rulebook lists it ------------------------------------------------
{
  check("listed", INDEX.traits.includes("maneuvers/sudden-stop.dbu"), true);

  const stop = getManeuver("sudden-stop");
  check("loaded as a Counter Maneuver", stop?.type, "counter");
  check("costing 1 Counter Action and no Ki", [stop.actionCost, stop.kiCost], [1, 0]);
  check("aimed at nobody, because it answers a card", stop.requiresTarget, false);
  check("and freely, with no limit of its own", stop.usageLimit, null);

  check("the entry is there whole", [
    stop.text.includes("Sudden Stop Maneuver: By hitting the ground, stabbing your Ki"),
    stop.text.includes("reduce the number of Squares you move by a number of Squares up to"),
    stop.text.includes("halve any Collision damage you take as a result of this movement"),
    stop.text.includes("Feature Collision or Ground Collision respectively"),
    stop.text.includes("you may use the Movement Maneuver as an Out-of-Sequence Maneuver.")
  ], [true, true, true, true, true]);

  // Its second paragraph survives the fold, which is the thing that used to truncate
  // every multi-paragraph entry in the library.
  check("and the second paragraph with it",
    stop.text.includes("\nIf you end this movement without Collision"), true);
}

// --- Being moved, which is one question here ---------------------------------------------------
{
  // Cut out and run, because "are you being moved right now" is the whole of what decides
  // when this Maneuver may be played and it has four ways to say no.
  const from = CHAT.indexOf("function beingMovedOn(");
  // Nothing documented follows it, so the next export is the end of the slice.
  const to = CHAT.indexOf("export function gainsHtml", from);
  const beingMovedOn = new Function("SCOPE", "CLASH_FLAG", "whoWonClash",
    `${CHAT.slice(from, to)}\nreturn beingMovedOn;`)(
      "dbu", "clash",
      ({ challenger, defender }) => (challenger.total > defender.total) ? "challenger" : "defender");

  const card = clash => ({ getFlag: (scope, key) => (key === "clash") ? clash : null });
  const me = { uuid: "Actor.me" };

  const won = { challenger: { total: 20 }, defender: { total: 10 } };
  const lost = { challenger: { total: 10 }, defender: { total: 20 } };

  const thrown = {
    collision: { doubles: false, doubledBy: "" },
    collisionApplied: false,
    defenderUuid: me.uuid,
    result: won
  };

  check("being thrown is a card you can dig in against",
    Boolean(beingMovedOn(card(thrown), me)), true);

  check("the one doing the throwing cannot",
    beingMovedOn(card(thrown), { uuid: "Actor.them" }), null);

  // A tie goes to the Defender, so nobody is moved and there is nothing to stop - the
  // same rule that decides whether the collision button is drawn at all.
  check("a Clash they won moves nobody",
    beingMovedOn(card({ ...thrown, result: lost }), me), null);

  check("a Clash still being rolled is not yet a movement",
    beingMovedOn(card({ ...thrown, result: null }), me), null);

  // Once the collision is settled they have hit whatever they hit; stopping then would be
  // stopping something that has finished happening.
  check("and one whose collision has been settled is past stopping",
    beingMovedOn(card({ ...thrown, collisionApplied: true }), me), null);

  // A Clash with no movement behind it - a Grapple Check, a Skill Clash, the Pin.
  check("a Clash that moves nobody is not one to stop",
    beingMovedOn(card({ ...thrown, collision: null }), me), null);

  check("and a card with no Clash on it at all", beingMovedOn(card(null), me), null);
}

// --- The Collision Damage, doubled and halved as one ---------------------------------------------
{
  // The arithmetic on its own, which is the half of this rule that goes wrong quietly.
  // A Feature's Qualities can halve it as well now, so the halvings are counted rather
  // than asked about - and they are still one multiply and one rounding.
  // The number being halved is the Hardness Value of what they hit now, worked out from
  // the Rank picked in the window and the base Tier of Power of whoever is taking it.
  // Doublings are counted as well now - a Dangerous Square doubles a Ground Collision -
  // so the two are powers rather than a ternary, and they multiply.
  const settle = (value, doubled, halved) =>
    Math.floor(value * (2 ** (doubled ? 1 : 0)) * (0.5 ** (halved ? 1 : 0)));

  check("the source settles them together",
    CHAT.includes("const amount = Math.floor(value * (2 ** doublings) * (0.5 ** halvings));"),
    true);
  check("counting every halving there is, rather than only this one",
    CHAT.includes("const halvings = (halved ? 1 : 0)"), true);

  check("plain damage is what was typed", settle(7, false, false), 7);
  check("Launching doubles it", settle(7, true, false), 14);
  check("a Sudden Stop halves it, rounded down", settle(7, false, true), 3);

  // The case the order matters for. Halving 7 to 3 and then doubling is 6; doubling 7 to
  // 14 and then halving is 7. One multiplier is neither, and leaves the number where the
  // two rules between them leave it.
  check("and the two together leave it exactly where it was", settle(7, true, true), 7);
  check("which neither order of the two would have",
    [Math.floor(Math.floor(7 * 0.5) * 2), Math.floor(Math.floor(7 * 2) * 0.5)], [6, 7]);

  // Said by the window, which is handed the two by whatever opened it - the card reads
  // them off the Clash, and the Battlefields button has neither.
  check("and the card says both", [
    CHAT.includes("doubled ? `doubled by ${doubledBy}` : \"\","),
    CHAT.includes("halved ? `halved by ${halvedBy}` : \"\",")
  ], [true, true]);
  check("off the Clash's own flags",
    CHAT.includes("halved: Boolean(clash.collision?.halves),")
    && CHAT.includes('halvedBy: clash.collision?.halvedBy ?? ""'), true);
}

// --- Played --------------------------------------------------------------------------------------
{
  check("the Sudden Stop is reached before the attack guard",
    CHAT.indexOf("if (blockade?.suddenStop) return playSuddenStop(message, actor, blockade);")
      < CHAT.indexOf("  if (!attack || attack.result) return;"), true);

  // "Up to 1/2 of your Might" - theirs to say, because "up to" is a choice.
  check("the ceiling is half their Might, rounded down",
    CHAT.includes("const most = Math.floor(Math.max(0, actor.system.might ?? 0) / 2);"), true);
  check("asked before the Counter Action is spent",
    CHAT.indexOf("if (typeof typed !== \"number\") return;")
      < CHAT.indexOf("if (!await payCounter(actor, maneuver, maneuver.actionCost ?? 1)) return;"),
    true);
  check("and no Ki, because the entry says N/A", getManeuver("sudden-stop").kiCost, 0);

  // Once. However hard you dig in, a movement is stopped suddenly once.
  check("a movement is dug in against once",
    CHAT.includes("if (!clash || clash.suddenStop) return;"), true);
  check("and the dialog says so on the second look",
    CHAT.includes('? "you have already dug in against this one"'), true);

  check("the halving is left on the card for whoever enters the number",
    CHAT.includes("collision: { ...clash.collision, halves: true, halvedBy: maneuver.name }"),
    true);

  // The way in has to exist on a card that has no other reason to offer one: a Knockback's
  // Might Clash is not a Maneuver an Instant can answer and is not an attack.
  check("the Respond dialog opens on a card that is only throwing somebody",
    CHAT.includes("if (!respondable && !awaiting && !thrown) return;"), true);
  check("and the Counter group opens with it",
    CHAT.includes("const counterGroup = (attack || canBlock || canStop)"), true);
}

// --- The Movement it hands out, out of sequence ------------------------------------------------------
{
  check("the Movement Maneuver is offered",
    CHAT.includes('maneuverId: "movement",'), true);
  check("with its condition written on it",
    CHAT.includes('reason: "Sudden Stop - only if that movement ended without a Collision"'),
    true);
  check("and only to somebody who has the Maneuver",
    CHAT.includes("if (actor.items.some(item => (item.type === \"maneuver\") && item.system.movement)) {"),
    true);

  // An Out-of-Sequence Movement could not be paid for: a Movement's price is a choice and
  // nobody was asking out of sequence, so it was Normal Speed and free whatever the player
  // would have paid for.
  check("an Out-of-Sequence Movement is asked which Speed",
    CHAT.includes("    crossing = await askMovement(actor);"), true);
  // The price grew a branch above it - a held Maneuver was paid for when it was held, so
  // an offer marked free pays nothing - and this asks for the part it is about.
  check("and priced by the answer",
    CHAT.includes("    ? movementKiCost(actor, crossing)"), true);
  check("with Rapid Movement's Strike bonus granted the same way",
    CHAT.includes("    await takeRapidMovement(actor);"), true);
  check("both of which the Maneuver module now lets out", [
    USE.includes("export async function askMovement(actor, { rapid: rapidAllowed = true, pilot = null } = {}) {"),
    USE.includes("export async function takeRapidMovement(actor) {")
  ], [true, true]);
}

// --- What is not built, and why ------------------------------------------------------------------------
{
  check("the Qualities are named as missing",
    TRAIT.includes("There are no Feature Qualities or Environment Qualities in this system"),
    true);
  check("and the card still says they are ignored",
    CHAT.includes("any Feature or Environment Qualities that would have applied to it."), true);
  // The sentence wraps in the file, so the half carrying the claim is what is looked for.
  check("\"without Collision\" is said to be the table's",
    TRAIT.includes("Whether anything was hit is the"), true);
}

console.log(failed ? `\n${failed} failing` : "\nall good");
process.exit(failed ? 1 : 0);
