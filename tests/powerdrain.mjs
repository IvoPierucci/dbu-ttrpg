/**
 * The Power Drain Maneuver: the first that takes Ki off somebody and hands it to somebody
 * else.
 *
 * Two halves worth running. The rounding - "1/2 (rounded up) of your Might", for each
 * Action - is per Action rather than once at the end, and on an odd Might the two differ.
 * And "regain Ki Points equal to the total amount of Ki Points lost by the target" is about
 * what they actually lost, which is not always what was aimed at them.
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

const { loadTraits } = await import(modUrl("effects/traits.mjs"));
const { loadManeuvers, getManeuver, whyNotDrain, whyNotPin, whyNotSpecial } =
  await import(modUrl("maneuvers.mjs"));
const { maneuverItemFrom, definitionOf } = await import(modUrl("use-maneuver.mjs"));
const { default: DBUCharacterData } = await import(modUrl("data/actor-character.mjs"));
await loadTraits();
await loadManeuvers();

const TRAIT = fs.readFileSync(path.join(TRAITS, "maneuvers", "power-drain.dbu"), "utf8");
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

/** One top-level function out of a module, sliced so it can be run. */
function source(text, name) {
  let at = text.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`no ${name}`);
  if (text.slice(at - 6, at) === "async ") at -= 6;
  return text.slice(at, text.indexOf("\n}\n", at) + 2);
}

// --- The Maneuver as the rulebook lists it -----------------------------------------------
{
  check("listed", INDEX.traits.includes("maneuvers/power-drain.dbu"), true);

  const drain = getManeuver("power-drain");
  check("loaded as a Standard Maneuver", drain?.type, "standard");
  check("once a Combat Round", drain.usageLimit, { amount: 1, per: "round" });
  check("it is Special", drain.special, true);
  check("and it is not an attack", Boolean(drain.attacking), false);
  check("and no Ki", drain.kiCost, 0);

  // "Action Cost: Variable", with the ceiling in the Effect rather than in the cost line.
  check("it costs between one Action and three",
    [drain.actionCost, drain.actionCostMax], [1, 3]);
  check("and is not open-ended, which is a different thing",
    Boolean(drain.actionCostOpen), false);
  check("where Combat Recovery is the other Maneuver priced in a range",
    [getManeuver("combat-recovery").actionCost, getManeuver("combat-recovery").actionCostMax],
    [2, 3]);

  // It aims itself: the one being held is the only answer.
  check("it asks for no target", Boolean(drain.requiresTarget), false);
  check("as the Launch does, for the same reason",
    Boolean(getManeuver("launch").requiresTarget), false);

  for (const line of [
    "You can only use this Maneuver if you are in a Grapple Maneuver as the",
    "Target the Grappled and spend up to 3 Actions",
    "reduce their Life and Ki Points by 1/2 (rounded up) of your Might",
    "regain Ki Points\n  equal to the total amount of Ki Points lost by the target"
  ]) {
    check(`the entry says "${line.slice(0, 44).replace(/\n\s+/g, " ")}"`,
      TRAIT.includes(line), true);
  }

  check("no Skill opens it",
    Object.values(DBUCharacterData.SKILLS).some(s => s.specialManeuver === "power-drain"),
    false);

  const item = maneuverItemFrom(drain);
  check("the Item carries the flag and the range",
    [item.system.powerDrain, item.system.actionCost, item.system.actionCostMax],
    [true, 1, 3]);
  check("and reading it back gives them up",
    definitionOf({ id: "x", name: drain.name,
      system: { ...item.system, maneuverId: drain.id } }).powerDrain, true);
}

// --- Only as the Grappler ---------------------------------------------------------------------
{
  const drain = getManeuver("power-drain");
  const who = (grapple) => ({ name: "Tizi", system: { grapple } });

  check("a Grappler may",
    whyNotDrain(who({ partner: "Actor.kuro", role: "grappler" }), drain), null);
  check("the Grappled may not",
    whyNotDrain(who({ partner: "Actor.kuro", role: "grappled" }), drain),
    "Tizi is the Grappled, not the Grappler, and can only drain somebody they are holding.");
  check("and somebody in no Grapple at all may not",
    whyNotDrain(who({}), drain),
    "Tizi is not in a Grapple, and Power Drain drains somebody you are Grappling.");
  check("a Maneuver that is not this one is never refused by it",
    whyNotDrain(who({}), getManeuver("basic-attack")), null);

  // The same pair of rules the Pin asks, asked the same way rather than a second way that
  // could disagree with it.
  check("which is the Pin's pair of rules",
    [whyNotPin(who({ partner: "Actor.kuro", role: "grappler" }), getManeuver("pin")),
     Boolean(whyNotPin(who({ partner: "Actor.kuro", role: "grappled" }), getManeuver("pin"))),
     Boolean(whyNotPin(who({}), getManeuver("pin")))],
    [null, true, true]);

  // Refused before anything is paid for.
  check("refused at the door",
    USE.includes("    const nobodyToDrain = whyNotDrain(actor, maneuver);"), true);
  check("before the Actions are taken",
    USE.indexOf("await payActions(actor, maneuver, actionsSpent);",
      USE.indexOf("const nobodyToDrain")) > 0, true);
  check("and beside the Pin's own refusal",
    USE.indexOf("const nobodyToDrain") < USE.indexOf("const nobodyToPin"), true);
}

// --- What each Action takes, run ---------------------------------------------------------------
{
  // `drainFrom` is where the arithmetic lives. Run with the two writes stubbed, so what is
  // checked is the numbers rather than the plumbing.
  let took = null;
  const drainFrom = new Function(
    "actionCostOf", "ui", "postManeuver", "stub",
    `${source(USE, "drainFrom").replace(
      'const { reduceKiPoints, reduceLifePoints } = await import("./chat.mjs");',
      "const { reduceKiPoints, reduceLifePoints } = stub;").replace(
      'const { requestActorUpdate } = await import("./chat.mjs");',
      "const { requestActorUpdate } = stub;")}
     return drainFrom;`)(
      () => ({ amount: 1, kind: "standard" }),
      { notifications: { warn: () => {} } },
      async (actor, maneuver, options) => { took.note = options.note; },
      {
        reduceLifePoints: async (target, amount) => { took.life = amount; },
        // What they actually lose is capped by what they have, which is the whole point.
        reduceKiPoints: async (target, amount) => {
          took.ki = Math.min(amount, target.system.ki.value);
          return took.ki;
        },
        requestActorUpdate: (actor, changes) => { took.gained = changes; }
      });

  const drain = getManeuver("power-drain");
  const run = async (might, actions, theirKi, mine = { value: 0, max: 100 }) => {
    took = { life: 0, ki: 0, gained: null, note: "" };
    const actor = { name: "Tizi", system: { might, ki: { ...mine } } };
    const grappled = { name: "Kuro", system: { ki: { value: theirKi, max: 50 } } };
    const ok = await drainFrom(actor, grappled, drain, actions);
    return { ok, ...took };
  };

  // "1/2 (rounded up) of your Might", for each Action.
  check("half an even Might, once", (await run(8, 1, 99)).life, 4);
  check("and an odd one rounds up", (await run(5, 1, 99)).life, 3);

  // Rounded per Action rather than once at the end: three Actions at half of 5 is nine,
  // where half of fifteen is eight.
  check("three Actions at an odd Might is three roundings", (await run(5, 3, 99)).life, 9);
  check("which is not the same as rounding once at the end",
    Math.ceil((5 * 3) / 2), 8);
  check("two Actions at an even Might", (await run(8, 2, 99)).life, 8);

  // The Life and the Ki are the same number.
  const both = await run(6, 2, 99);
  check("Life and Ki are taken alike", [both.life, both.ki], [6, 6]);

  // What comes back is what they lost, not what was aimed at them.
  check("a target with less Ki than that loses what they have",
    (await run(10, 3, 4)).ki, 4);
  check("and that is what is handed over",
    (await run(10, 3, 4)).gained, { "system.ki.value": 4 });
  check("where a target with plenty hands over the whole drain",
    (await run(10, 2, 99)).gained, { "system.ki.value": 10 });

  // And it is capped again on the way in, like every other regain here.
  check("a drainer near their own maximum takes only what fits",
    (await run(10, 2, 99, { value: 96, max: 100 })).gained, { "system.ki.value": 100 });
  check("and one already full takes nothing",
    (await run(10, 2, 99, { value: 100, max: 100 })).gained, null);
  check("which the card says rather than leaving blank",
    (await run(10, 2, 99, { value: 100, max: 100 })).note.includes("had no room for any of it"),
    true);

  // Nothing to drain with is a refusal rather than a Maneuver spent on nothing.
  check("no Might is no drain", (await run(0, 3, 99)).ok, false);
  check("and nothing is taken", (await run(0, 3, 99)).life, 0);

  // The card says what happened, once.
  check("the card says both numbers",
    (await run(6, 2, 99)).note,
    "Kuro loses 6 Life and 6 Ki. Tizi takes 6 of it back.");
}

// --- Taking Ki off somebody, which nothing could do before -------------------------------------------
{
  check("there is a way to take Ki off somebody now",
    CHAT.includes("export async function reduceKiPoints(target, amount,"), true);
  check("and it says how much actually came off",
    CHAT.includes("  return taken;"), true);
  check("capped by what they have",
    CHAT.includes("  const taken = Math.min(wanted, Math.max(0, value));"), true);
  check("floored at nothing, since no rule takes Ki below zero",
    CHAT.includes("Math.max(0, value)"), true);
  check("where Life has an Undying to opt out of its floor",
    CHAT.includes('const floor = target.system.effects?.slots?.["life.allowNegative"]'), true);
  check("and it is relayed, since the drainer may not own them",
    CHAT.includes('await requestActorUpdate(target, { "system.ki.value": value - taken });'),
    true);
}

console.log(`${failed} failing`);
process.exit(failed ? 1 : 0);
