// What a Technique's features do on the cards: the Knockback family, the lingering effects, Delayed,
// the Defend dialog's limits, Final Chance's held Defeat. Sliced out of the modules, as the other
// harnesses do, so these are the modules' own lines being run.
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
globalThis.ui = { notifications: { warn: () => {}, error: () => {}, info: () => {} } };
globalThis.Handlebars = { escapeExpression: text => String(text) };
const TRAITS = path.join(ROOT, "traits");
globalThis.foundry.utils.fetchJsonWithTimeout = async () => JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));
globalThis.fetch = async url => {
  const file = path.join(TRAITS, String(url).replace("systems/dbu-ttrpg/traits/", ""));
  return fs.existsSync(file) ? { ok: true, text: async () => fs.readFileSync(file, "utf8") } : { ok: false };
};
await (await import(modUrl("effects/traits.mjs"))).loadTraits();
const M = await import(modUrl("maneuvers.mjs"));
const { featureRanks } = await import(modUrl("signature.mjs"));
const { FEATURE_QUALITIES } = await import(modUrl("features.mjs"));

const CHAT = read("module", "chat.mjs");
const COMBAT = read("module", "combat.mjs");
const USE = read("module", "use-maneuver.mjs");
const REGISTRY = read("module", "effects", "registry.mjs");
const DURATIONS = read("module", "durations.mjs");

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};
function source(text, name) {
  const at = text.search(new RegExp(`(export )?(async )?function ${name}\\(`));
  if (at < 0) return "";
  const next = text.slice(at + 1).search(/\n(export )?(async )?function |\n\/\*\*/);
  return (next < 0 ? text.slice(at) : text.slice(at, at + 1 + next)).replace(/^export /, "");
}

// --- The Feature note: Reinforced Plantlife and Compressed Element -----------------------------------
{
  const featureNote = new Function("FEATURE_QUALITIES", "Handlebars",
    `${source(CHAT, "compressedOn")}; ${source(CHAT, "featureNote")}; return featureNote;`)(FEATURE_QUALITIES, globalThis.Handlebars);
  const plant = M.PROFILES.elementalPlantlife;
  check("the Profile's own Feature", featureNote(plant, null), " &middot; Feature: Hardness Rank 1, Splintering");
  check("Reinforced Plantlife adds its ranks to the Hardness Rank",
    featureNote(plant, { technique: { features: ["reinforced-plantlife", "reinforced-plantlife"] } }),
    " &middot; Feature: Hardness Rank 3, Splintering");
  check("Compressed Element takes the Feature away",
    featureNote(plant, { technique: { features: ["compressed-element"] } }), " &middot; Compressed Element: no Feature");
  check("a Profile that makes none says nothing", featureNote(M.PROFILES.beam, { technique: { features: [] } }), "");
}

// --- Collision Damage with something added on top ---------------------------------------------------
{
  const lines = ["const amount = Math.floor(value * (2 ** doublings) * (0.5 ** halvings));",
    "const total = amount + Math.max(0, Number(extra) || 0);"];
  check("both lines are there, the addition after the multiply",
    lines.every(line => CHAT.includes(line)) && (CHAT.indexOf(lines[0]) < CHAT.indexOf(lines[1])), true);
  const settle = new Function("value", "doublings", "halvings", "extra", `${lines.join("\n")} return total;`);
  check("Deadly Drop's is added after the halving, not halved with it", settle(7, 0, 1, 10), 13);
  check("and nothing added is the Feature's worth alone", settle(7, 1, 0, 0), 14);
  check("what comes off is the total", CHAT.includes("await reduceLifePoints(target, ignored ? 0 : received,"), true);
  check("Deadly Drop: half the Might times the rank, rounded down",
    CHAT.includes("const extra = Math.floor((Number(attacker.system.might) || 0) / 2) * rank;"), true);
  check("both brought to the ground first",
    source(CHAT, "postDeadlyDrop").match(/"system\.battlefield\.highEnvironment": 0/g)?.length, 2);
}

// --- Knockback: Forceful Launch, Precise Strike, Super Launch ----------------------------------------
{
  const knock = source(CHAT, "openKnockback");
  check("Forceful Launch adds 1(T) a rank to the distance", knock.includes("let squares = might + forceful;"), true);
  check("and to the Might Clash, as a row of its own",
    knock.includes('challengerRows: forceful ? [{ label: "Forceful Launch", value: forceful }] : []'), true);
  check("Precise Strike: half again on a Critical, rounded down",
    knock.includes('squares = Math.floor(squares * 1.5);')
    && knock.includes('attack.result?.strike?.outcome === "critical"'), true);
  check("Super Launch: the distance straight off their Life, before the card",
    knock.indexOf("await reduceLifePoints(target, squares,") < knock.indexOf("return postMightClash(attacker, target, {"),
    true);
  check("and the Clash already won", knock.includes('succeeded: true,\n          automatic: "Super Launch"'), true);
  check("one collision object for both cards", (knock.match(/doubles: Boolean\(/g) ?? []).length, 1);
}

// --- What a Technique leaves on its user -------------------------------------------------------------
{
  const body = source(CHAT, "techniqueAfterCard");
  const run = async (features, system = {}, extra = {}) => {
    const log = { reduced: [], updates: [], lasting: [], posted: [] };
    const actor = { name: "Goku", uuid: "A", system: { baseTierOfPower: 2, timed: [], statDrain: 0, usedManeuvers: [],
      threshold: { key: "injured" }, thresholdChecks: {}, capacity: { max: 30, spent: 4 }, grapple: {}, ...system },
      update: async data => { log.updates.push(data); } };
    const fn = new Function("featureRanks", "reduceLifePoints", "KINDS", "EDGES", "lasting", "postManeuver",
      "fromUuidSync", "endGrapple", "DBUCharacterData", "ChatMessage", "Handlebars",
      `${body}; return techniqueAfterCard;`)(featureRanks,
      async (who, amount, options) => log.reduced.push([amount, options.reason]),
      { CONDITION: "condition", DRAIN: "drain" }, { END: "end" },
      async (who, entry) => log.lasting.push(entry),
      async (who, maneuver, options) => log.posted.push([maneuver, options]),
      () => null, async () => {}, { THRESHOLDS: { healthy: {}, bruised: {}, injured: {}, critical: {} } },
      { create: async data => log.posted.push(data.content), getSpeaker: () => ({}) }, globalThis.Handlebars);
    await fn(actor, { maneuverName: "Kamehameha", targetName: "Vegeta",
      technique: { features, superProfile: "", ...extra } });
    return log;
  };

  const backlash = await run(["backlash", "backlash", "backlash"]);
  check("Backlash: 2(bT) a rank, as a Life Point reduction", backlash.reduced, [[12, "Kamehameha, Backlash"]]);

  const drain = await run(["stat-drain", "stat-drain"], { statDrain: 3 });
  check("Stat Drain: the most ranks kept, not added (Double Dip)", drain.updates[0]["system.statDrain"], 3);
  check("with its clock as a drain, until the end of the next turn",
    [drain.lasting[0].kind, drain.lasting[0].edge, drain.lasting[0].next], ["drain", "end", true]);
  const fresh = await run(["stat-drain"]);
  check("and a first one is its ranks", fresh.updates[0]["system.statDrain"], 1);

  const allOut = await run([], {}, { superProfile: "all-out" });
  check("All Out: Capacity to 0 and the Thresholds reached failed",
    [allOut.updates[0]["system.capacity.spent"], allOut.updates[0]["system.thresholdChecks"]],
    [30, { bruised: "fail", injured: "fail" }]);

  const bomb = await run([], {}, { powerbomb: true });
  check("Powerbomb: no Grapple until the start of the next turn",
    bomb.updates[0]["system.usedManeuvers"], ["turn:powerbomb"]);
  check("which the Grapple Maneuver reads",
    Boolean(M.whyNotAnotherGrapple({ name: "Goku", system: { usedManeuvers: ["turn:powerbomb"], grapple: {} } },
      { grapple: true })), true);
  check("and the turn's start takes away", COMBAT.includes('startsWith("turn:")'), true);

  const hit = await run(["hit-and-run", "high-speed-dash"]);
  check("Hit and Run is its own Out-of-Sequence card; High-Speed Dash triggers no Exploit",
    [hit.posted[0][0].exploitable, hit.posted[0][1].asOutOfSequence], ["", true]);
  const run2 = await run(["hit-and-run"]);
  check("without it, leaving a Melee Range is exploitable", Boolean(run2.posted[0][0].exploitable), true);

  check("Stat Drain is a program on the character",
    REGISTRY.includes("combatRolls -= ${ranks}(bT);\\nsoakValue.external -= ${ranks}(bT);"), true);
  check("and a kind of clock of its own, cleared by taking it off",
    [/DRAIN: "drain"/.test(DURATIONS), /statDrain/.test(DURATIONS)], [true, true]);
}

// --- Delayed and Short Delay -------------------------------------------------------------------------
{
  const fn = new Function("detonateTechnique", `${source(CHAT, "shortDelays")}; return shortDelays;`);
  const fired = [];
  const shortDelays = fn(async (actor, id, options) => fired.push([id, options.auto]));
  const item = (advantages, round) => ({ id: `i${round}`, type: "maneuver",
    system: { advantages, signature: { delayed: { messageId: "m", round } } } });
  const actor = { items: [item(["delayed", "short-delay"], 1), item(["delayed"], 1)] };
  await shortDelays(actor, 3);
  check("applied in Round 1, not yet as Round 3 begins", fired, []);
  await shortDelays(actor, 4);
  check("gone off by the start of Round 4 - the end of Round 3 - and only with Short Delay", fired, [["i1", true]]);
  check("the round's start asks", COMBAT.includes("shortDelays"), true);
  check("and an Encounter's end clears every record", COMBAT.includes("clearDelayed"), true);
  check("the Damage is held instead of applied while Delayed", CHAT.includes("holdDelayed"), true);
}

// --- The Defend dialog -------------------------------------------------------------------------------
{
  const actor = { system: { baseTierOfPower: 2, effects: { slots: {} } } };
  const attack = features => ({ technique: { features } });
  check("Encompassing Attack: Defend +2(bT) a rank",
    [M.defendOptionCost("guard", actor, attack([])), M.defendOptionCost("guard", actor,
      attack(["encompassing-attack", "encompassing-attack"]))].map((cost, i, all) => cost - all[0]), [0, 8]);
  const dialog = source(CHAT, "defendAgainst");
  check("rank 2 leaves no Parry", dialog.includes('.filter(([key]) => !(encompassed && (key === "parry")))'), true);
  check("a Fake Out loser may only Guard (or Dodge)", dialog.includes('.filter(([key]) => !fakedOut || (key === "guard"))'),
    true);
  check("Counter's option only for one who has such a Technique",
    [Boolean(M.DEFEND_OPTIONS.crossCounterSignature?.needsCounterTechnique),
     dialog.includes("!option.needsCounterTechnique || hasCounterTechnique")], [true, true]);
  check("Sudden Blast: nothing to Reflect", /sudden-blast/.test(source(CHAT, "offerReflect")), true);
}

// --- Final Chance: the Defeat held -------------------------------------------------------------------
{
  check("the Life update says to hold it", USE.includes("dbuDefeatHeld: true"), true);
  check("and the hook does", COMBAT.includes("if (options.dbuDefeatHeld) return;"), true);
  check("let go at the end of their turn at the latest", COMBAT.includes("releaseFinalChance("), true);
  check("Complete Annihilation silences the Defeated Moment",
    COMBAT.includes('if (!silenced) await fireMoment(actor, "defeated", { damage: 0 });'), true);
}

// --- Genki: Empower turned into a wager --------------------------------------------------------------
{
  check("half of what was given, rounded down", USE.includes("const bonus = Math.floor(sent / 2);"), true);
  check("gathered while charging, and not gained as Ki",
    USE.indexOf('"system.charging.bonusWager"') < USE.indexOf('"system.ki.value": Math.min(ally.system.ki.max'), true);
  check("added to the wager without being paid again", CHAT.includes("kiWager: kiWager + (Number(freeWager) || 0),"), true);
}

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
