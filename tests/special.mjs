/**
 * Special Maneuvers: the kind nobody has until an effect gives it to them.
 *
 * "While you can use all forms of Maneuver naturally, you cannot use any Special
 * Maneuvers until you have gained access to them through an effect." That sentence is the
 * whole of the rule, so it is the whole of what is checked - and the half of it worth
 * running is the question asked the other way round, because everything else in this
 * system is yours until something takes it away.
 *
 * `allow` is what grants access, and `allow` forbade: the parser has made the node since
 * the language was written and the interpreter read the node and not the flag. Nothing
 * had ever written one, because nothing needed granting until this.
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
// setCondition writes through the character data model, which is built of DataFields.
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

const { loadTraits } = await import(modUrl("effects/traits.mjs"));
const { loadManeuvers, MANEUVER_TYPES, getManeuver, allManeuvers } =
  await import(modUrl("maneuvers.mjs"));
const { compile } = await import(modUrl("effects/parser.mjs"));
const { applyPassives, applySlot, collectReactive, permits, granted } =
  await import(modUrl("effects/interpreter.mjs"));

/** A trait file's script is everything past the "---". */
const script = text => String(text ?? "");
const { getSlot } = await import(modUrl("effects/slots.mjs"));
await loadTraits();
await loadManeuvers();

const { whyNotSpecial } = await import(modUrl("maneuvers.mjs"));
const { default: DBUCharacterData } = await import(modUrl("data/actor-character.mjs"));
const { allConditions, conditionsFor, combatConditionsFor, marksFor } =
  await import(modUrl("conditions.mjs"));
const { getTrait } = await import(modUrl("effects/traits.mjs"));

const USE = fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8");
const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
const INDEX = JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));
const SHEET = fs.readFileSync(
  path.join(ROOT, "module", "sheets", "actor-character-sheet.mjs"), "utf8");
const COMBAT = fs.readFileSync(
  path.join(ROOT, "templates", "parts", "actor-combat.hbs"), "utf8");

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

/** The Slots one passive settles, run for real. */
function slotsFrom(script) {
  const { program, errors } = compile(script, null);
  if (errors.length) throw new Error(errors.map(e => e.message).join("; "));
  const entry = { program, priority: 6, sourceId: "t", sourceName: "Test",
                  level: 0, stacks: 1, armed: true, available: true };
  return applyPassives([entry], "core",
    { data: {}, errors: [], context: {}, queue: [] }).slots;
}

// --- Not a kind of Maneuver, but something one can be -----------------------------------------
{
  // This was built as a sixth kind from "while you can use all forms of Maneuver
  // naturally, you cannot use any Special Maneuvers", which reads as a sixth form. The
  // first Special Maneuver settles it: the Analysis Maneuver's entry says "Maneuver Type:
  // Standard Maneuver". So Special is a property, and a Special Maneuver is a Standard,
  // Counter, Instant, Modifier or Out-of-Sequence one you have not got yet.
  check("Special is not a kind", MANEUVER_TYPES.special, undefined);
  check("and no kind is the one that has to be granted",
    Object.values(MANEUVER_TYPES).some(type => type.requiresAccess), false);

  const analysis = getManeuver("analysis");
  check("the first one of them is a Standard Maneuver", analysis?.type, "standard");
  check("and is Special", analysis.special, true);
  check("its entry says both",
    analysis.text.includes("–Maneuver Type: Standard Maneuver"), true);

  // Every other Maneuver is yours naturally, which is the other half of the sentence.
  // Named rather than counted: one falling out of the library should be noticed, and a
  // count would only say the number had changed.
  check("and these are the Special ones",
    allManeuvers().filter(m => m.special).map(m => m.id).sort(),
    ["absorb", "act-again", "amplified-power-up", "analysis", "area-wipe", "attack-absorption", "aura-tail", "back-to-basics-power-up", "bite-attack", "boom", "brace", "class-up-berserker-choice", "class-up-elite-choice", "class-up-hero-choice", "coup-de-grace-strike", "dance", "dark-saiya-evil-points", "darkness-mixer", "demonic-battle-strike", "dirty-trick", "draining-attack", "eject", "energy-synchronize", "erratic-basic-attack", "face-me-at-full-power", "feint", "flip", "float-mirror", "full-awakening", "get-up", "glassification", "goof", "greater-super-class-choice", "healing-surge-instant", "hide", "hocus-pocus", "holding-back", "hype", "insta-kill", "insult", "internal-attack", "intuit", "junior-creation", "legendary-chaos-surge", "limit-of-the-super-saiyan-recovery", "limit-of-the-super-saiyan-surge", "liquid-form", "magic-trick", "movement-instant", "movement-or-basic-instant", "mutants-resilience-counter", "one-man-army", "one-on-one-duel", "overflowing-surge", "pinnacle-of-legacy-power-up", "planet-burst", "possess", "power-drain", "rampaging-tail", "repair", "s-cells-power-up", "search", "sense", "snatch", "soar", "spiritual-master-surge", "stance", "stop-wasting-my-time", "tail-attack", "talk", "terrify", "tides-of-time", "time-lag", "time-prison", "time-to-get-serious", "transfiguration", "treatment", "unify", "unkillable-majin-from-goop", "unkillable-majin-regeneration", "whack", "zoom"]);
  check("which is a few of them and not most",
    allManeuvers().filter(m => m.special).length < allManeuvers().length / 2, true);

  // And they are not all of one kind, which is the claim above proved rather than argued:
  // four are Standard Maneuvers, Attack Absorption is Out-of-Sequence and Feint is an
  // Instant - so Special cannot be the sixth kind it was first built as.
  check("Special crosses the kinds",
    [...new Set(allManeuvers().filter(m => m.special).map(m => m.type))].sort(),
    ["counter", "instant", "modifier", "outOfSequence", "standard"]);
}

// --- Neither of them is a Combat Condition ------------------------------------------------------
{
  // "You become Hyped!" and "they become Analyzed" - where the entries that mean it say
  // "gains the Impediment Combat Condition". They live in that folder because that is
  // where a mark with a clock on it lives, and the machinery is all keyed there.
  const all = allConditions();
  const marks = all.filter(c => !c.combatCondition).map(c => c.key).sort();
  check("the marks say they are not", marks,
    ["absorption-awakening", "all-out-mark", "analyzed", "arcosian-raised-mark", "arrogance-mark", "arrogant-unstoppable-mark", "ball-form", "battle-creation-mark", "battle-focused-training", "beautified", "being-a-copy", "braced", "brightened", "camouflaged", "chaos-die", "chaos-free-mark", "chaos-twice-mark", "cheered", "cloaked", "combat-wisdom-mark", "courage-mark", "crackling", "critical-tactics-mark", "damage-analysis-mark", "dance-for-us-mark", "darkened", "debilitated", "deeper-enhanced", "defensive-analysis-mark", "desperate-rally-mark", "doff-bonus", "energizing-training", "entangled", "entertained", "false-courage-mark", "ferocious-mark", "flame-stance", "flooded", "footwork-mark", "free-flowing-stance-mark", "from-the-stars-mark", "frosted", "frozen-in-time", "fury-mark", "hang-in-there-mark", "hated", "high-speed-mark", "hunger", "hyped", "ignited", "incorporeal-lock", "insect-shell-doubled", "internalized", "jack-of-all-styles-mark", "ki-control-training", "ki-sealed", "konatsian-superior-mark", "lagged", "last-resort-mark", "life-burn-mark", "life-burned", "lightning-soak-mark", "lightning-wound-mark", "limb-restriction-mark", "lingering-power-mark", "magically-enhanced", "marked-mark", "marked-minion", "massive-spin", "masterful-dodge-mark", "masterful-strike-mark", "merged-tuffle-mark", "mind-read", "motivated-mark", "mystic-power-mark", "need-for-revenge-mark", "noble-compelled", "offensive-analysis-mark", "pacifist-bonded", "pain-resistant-mark", "para-para", "parasite-drained-bruised", "parasite-drained-critical", "parasite-drained-injured", "plates-shed", "post-training-confidence", "rally-mark", "recovery-doubled", "reserved-mark", "resilient", "risky-bet-mark", "rocket-dodge-mark", "rocket-wound-mark", "rooted", "ruled", "sacrificial-mark", "scam-riches", "sealed", "second-sight-mark", "seen", "serene-mark", "shard-carrier", "shell-burst", "shifted-aflame", "shifted-bouncy", "shifted-dangerous", "shifted-electrified", "shifted-frozen", "shifted-poisonous", "shinjin-counter-mark", "smoked", "soaring", "solar-flared", "spectral-mark", "speed-training", "spinning", "spirit-studied", "stand-strong-mark", "stone-stance", "stretched", "studied", "supercomputer-command-mark", "supercomputer-mark", "supporter-mark", "survival-training", "swagger-dodge-mark", "swagger-strike-mark", "swagger-wound-mark", "tail-held", "tainted", "tased", "teamwork-tactics-mark", "telepathic-read", "torchlit", "tranquil-mark", "transformation-training", "tuffle-raised-mark", "undying-determination-mark", "unified-awakening", "variable-armed-mark", "variable-unarmed-mark", "warm-up-mark", "wave-stance", "wind-stance", "you-can-do-it-mark", "zero-effort-mark", "zooner-raised-mark"]);

  // And everything else in the folder is one, without having to say so.
  check("every other file in the folder is a Combat Condition",
    all.filter(c => c.combatCondition).length, all.length - marks.length);
  check("which is the published eighteen",
    all.filter(c => c.combatCondition).length, 18);

  // The checklist the sheet draws is the published ones.
  const who = (conditions) => ({ system: { conditions, timed: [] } });
  const carrying = who({ hyped: 1, prone: 1 });

  check("the checklist leaves the marks out",
    combatConditionsFor(carrying).some(c => c.key === "hyped"), false);
  check("and keeps the Combat Conditions",
    combatConditionsFor(carrying).some(c => c.key === "prone"), true);
  check("still as a checklist of everything that exists",
    combatConditionsFor(carrying).length, 18);

  // The marks are listed separately, and only the ones actually held.
  check("a mark being carried is listed",
    marksFor(carrying).map(m => m.key), ["hyped"]);
  check("and one that is not is not",
    marksFor(who({ prone: 1 })), []);
  check("nor is a Combat Condition, however many they have",
    marksFor(who({ prone: 3, shaken: 1 })), []);

  // The machinery goes on working: `conditionsFor` is what setCondition looks in, and it
  // still knows about both.
  check("both are still things the system can put on somebody",
    conditionsFor(carrying).filter(c => ["hyped", "analyzed"].includes(c.key)).length, 2);

  // And the sheet asks for the narrowed list rather than filtering a copy of its own.
  check("the sheet asks for the published ones",
    SHEET.includes("context.conditions = combatConditionsFor(this.actor);"), true);
  check("and for the marks beside them",
    SHEET.includes("context.marks = marksFor(this.actor).map(mark => ({"), true);
}

// --- And the row says when it lifts, which it did not -------------------------------------------
{
  // Read rather than asserted, because the row was added and described and never said
  // anything: `markClock` narrows the character's clocks down to the Condition entries and
  // handed them to a function that drops everything which is not a Resource. The rows
  // appeared, empty, and looked exactly like marks nobody had put a clock on.
  const { KINDS, EDGES } = await import(modUrl("durations.mjs"));
  const slice = (name) => {
    const at = SHEET.indexOf(`function ${name}(`);
    const end = SHEET.indexOf("\n}\n", at);
    return SHEET.slice(at, end + 2);
  };
  // `canvas?.` still throws on a name that was never declared, and Foundry declares this
  // one. The other half of markClock walks the scene looking for somebody else's clock.
  globalThis.canvas = null;
  const run = new Function("KINDS", "EDGES",
    `${slice("clockNotes")}\n${slice("markClock")}\nreturn { clockNotes, markClock };`)(KINDS, EDGES);

  const carrying = (timed) => ({ uuid: "Actor.tizi", system: { timed } });

  check("a mark with a clock says when it lifts",
    run.markClock(carrying([
      { kind: KINDS.CONDITION, key: "hyped", edge: EDGES.END, edges: 2 }
    ]), "hyped"),
    "1 at the end of your next turn");
  check("and one lifting this turn says that",
    run.markClock(carrying([
      { kind: KINDS.CONDITION, key: "hyped", edge: EDGES.END, edges: 1 }
    ]), "hyped"),
    "1 at the end of your turn");
  check("a start edge reads as a start",
    run.markClock(carrying([
      { kind: KINDS.CONDITION, key: "braced", edge: EDGES.START, edges: 1 }
    ]), "braced"),
    "1 at the start of your turn");

  // A mark nobody put a clock on says nothing, rather than claiming a turn it has not got.
  check("a mark with no clock claims no turn", run.markClock(carrying([]), "hyped"), "");
  check("and another mark's clock is not read as this one's",
    run.markClock(carrying([
      { kind: KINDS.CONDITION, key: "analyzed", edge: EDGES.END, edges: 1 }
    ]), "hyped"), "");

  // The Resource rows go on reading their own clocks, which is what the default is for.
  check("a Resource clock still reads as one",
    run.clockNotes([{ kind: KINDS.RESOURCE, key: "power", edge: EDGES.END, edges: 2 }], "power"),
    ["1 at the end of your next turn"]);
  check("and a Condition entry is not counted as a Resource",
    run.clockNotes([{ kind: KINDS.CONDITION, key: "power", edge: EDGES.END, edges: 2 }], "power"),
    []);
}

// --- The Analysis Maneuver as the rulebook lists it ------------------------------------------
{
  const analysis = getManeuver("analysis");

  check("listed", INDEX.traits.includes("maneuvers/analysis.dbu"), true);
  check("a Standard Maneuver, once a Combat Round",
    [analysis.type, analysis.usageLimit], ["standard", { amount: 1, per: "round" }]);
  check("costing 1 Action and no Ki", [analysis.actionCost, analysis.kiCost], [1, 0]);
  check("aimed at an Opponent", analysis.requiresTarget, true);
  check("and giving no opening", analysis.exploitable, "");

  check("the entry is there whole", [
    analysis.text.includes("Analysis Maneuver [1/Round]: Study your opponents"),
    analysis.text.includes("–Minions: Free"),
    analysis.text.includes("They become Analyzed until the end of your next turn."),
    analysis.text.includes("by 1(T)+1/4 (rounded up) of\nyour Scholarship Modifier.")
      || analysis.text.includes("1/4 (rounded up) of")
  ], [true, true, true, true]);

  // The mark it leaves is a thing the library knows, so it can be put on somebody and
  // taken off again.
  const analyzed = allConditions().find(c => c.key === "analyzed");
  check("Analyzed is a mark the library knows", Boolean(analyzed), true);
  check("held once rather than stacked", analyzed.maxStacks, 1);
  // Its file is all comment and no rule: what being Analyzed costs you is written in the
  // Maneuver, because the bonus belongs to whoever Analyzed you rather than to the table.
  check("and with no effects of its own, since the bonus is the analyser's",
    compile(getTrait("analyzed")?.script ?? "", null).program.blocks.length, 0);
}

// --- The Hype Maneuver, which needed no code at all --------------------------------------------
{
  const hype = getManeuver("hype");

  check("listed", INDEX.traits.includes("maneuvers/hype.dbu"), true);
  check("a Standard Maneuver, once a Combat Round",
    [hype.type, hype.usageLimit], ["standard", { amount: 1, per: "round" }]);
  check("Special, like the other one", hype.special, true);
  check("costing 1 Action and no Ki", [hype.actionCost, hype.kiCost], [1, 0]);
  check("and aimed at nobody, since it is about you", hype.requiresTarget, false);

  check("the entry is there whole", [
    hype.text.includes("Hype Maneuver [1/Round]: Hype the crowds"),
    hype.text.includes("–Minions: Free"),
    hype.text.includes("You become Hyped!"),
    hype.text.includes("of your Personality Modifier until the end of your next turn.")
  ], [true, true, true, true]);

  // Two lines, and both of them are verbs the language already had.
  const { program, errors } = compile(script(getTrait("hype").script), null);
  check("its script compiles", errors.map(e => e.message), []);

  const entry = { program, priority: 6, sourceId: "hype", sourceName: "Hype",
                  level: 0, stacks: 1, armed: true, available: true };
  const scope = { data: {}, errors: [], context: {}, queue: [] };
  collectReactive([entry], "on-used", scope);

  check("using it marks you and starts the clock",
    scope.queue.map(call => [call.verb, ...(call.args ?? [])]),
    [["gain", "hyped"], ["expires", "hyped", "next-turn"]]);
}

// --- What being Hyped is worth, run --------------------------------------------------------------
{
  // The rule lives on the mark rather than in the Maneuver, because it is a rule about
  // whoever is Hyped - so anything else that ever makes somebody Hyped gets it too.
  const { program, errors } = compile(script(getTrait("hyped").script), null);
  check("the mark's own script compiles", errors.map(e => e.message), []);

  const entry = { program, priority: 6, sourceId: "hyped", sourceName: "Hyped",
                  level: 0, stacks: 1, armed: true, available: true };

  const worth = (tier, personality) => {
    const data = { tierOfPower: tier, attributes: { personality: { mod: personality } },
                   personality: { mod: personality } };
    const slots = applyPassives([entry], "late",
      { data, errors: [], context: {}, queue: [] }).slots;
    return ["strike", "dodge", "wound"].map(key => applySlot(slots, key, 0));
  };

  // "Increase your Combat Rolls by 1(T)+1/4 (rounded up) of your Personality Modifier."
  // combatRolls is the rulebook's term for the three, and the Slot fans out to all of
  // them - which is why one line here is three rolls.
  check("it reaches the Strike, the Dodge and the Wound Roll",
    worth(3, 0), [3, 3, 3]);

  // Rounded up, which this entry says outright.
  for (const [personality, quarter] of [[0, 0], [1, 1], [4, 1], [5, 2], [8, 2], [9, 3]]) {
    check(`a Personality Modifier of ${personality} adds ${quarter}`,
      worth(3, personality)[0], 3 + quarter);
  }

  // And the Tier half is a Tier: a Transformation makes the performance worth more.
  check("the 1(T) grows with the Tier of Power",
    [worth(1, 0)[0], worth(5, 0)[0]], [1, 5]);
}

// --- Whose clock it is, run ---------------------------------------------------------------------
{
  // "They become Analyzed until the end of your next turn." Two characters and one rule:
  // the Condition is theirs and the turn is yours.
  const { EDGES, KINDS, lasting, edgeReached } = await import(modUrl("durations.mjs"));

  const store = (system) => ({
    name: system.name, uuid: system.uuid, isOwner: true,
    system: { timed: [], states: {}, conditions: {}, resources: {}, ...system },
    async update(changes) {
      for (const [key, value] of Object.entries(changes)) {
        if (key === "system.timed") this.system.timed = [...value];
        if (key === "system.conditions") this.system.conditions = { ...value };
      }
    }
  });

  const analyser = store({ name: "Tizi", uuid: "Actor.tizi" });
  const target = store({ name: "Krillin", uuid: "Actor.krillin",
                         conditions: { analyzed: 1 } });
  globalThis.fromUuidSync = uuid => (uuid === target.uuid) ? target : analyser;

  // Their own turn, so "the end of your next turn" is two edges away.
  globalThis.game = { combat: { started: true, combatant: { actor: { uuid: "Actor.tizi" } } } };

  await lasting(analyser, { kind: KINDS.CONDITION, key: "analyzed", edge: EDGES.END,
    next: true, on: target.uuid, source: "Analysis" });

  check("the clock is the analyser's", analyser.system.timed.length, 1);
  check("and nothing is put on the one who was Analyzed", target.system.timed.length, 0);
  check("the entry names them", analyser.system.timed[0].on, target.uuid);
  check("two edges away, which is the end of their next turn",
    analyser.system.timed[0].edges, 2);

  await edgeReached(analyser, EDGES.END);
  check("the end of this turn does not lift it", target.system.conditions.analyzed, 1);
  await edgeReached(analyser, EDGES.END);
  check("the end of their next turn does",
    Number(target.system.conditions.analyzed) || 0, 0);
}

// --- What Analysis is worth, run -----------------------------------------------------------------
{
  // "Increase your Combat Rolls against Analyzed Opponents by 1(T)+1/4 (rounded up) of
  // your Scholarship Modifier."
  const from = CHAT.indexOf("function analysisBonus(");
  const to = CHAT.indexOf("\n}", from) + 2;
  const analysisBonus = new Function("activeBuddy", "activeBuddies", "buddyHeader", "buddyAttribute", "getTrait", "customBuffOn",
    `${CHAT.slice(from, to)}\nreturn analysisBonus;`)(() => null, () => [], () => undefined, () => 0, () => null, () => false);

  const marker = (uuid, { tier = 3, scholarship = 0, on = null } = {}) => ({
    uuid,
    system: {
      tierOfPower: tier,
      attributes: { scholarship: { mod: scholarship } },
      timed: on ? [{ kind: "condition", key: "analyzed", edge: "end", edges: 2, on }] : []
    }
  });
  const them = { uuid: "Actor.krillin" };
  const other = { uuid: "Actor.someone" };

  check("nobody Analyzed is no bonus",
    analysisBonus(marker("Actor.tizi"), them), []);

  check("one you Analyzed is 1(T) with no Scholarship to add",
    analysisBonus(marker("Actor.tizi", { on: them.uuid }), them)
      .map(p => [p.label, p.value]),
    [["Analysis", 3]]);

  // Rounded up, which this entry says outright.
  for (const [scholarship, quarter] of [[0, 0], [1, 1], [4, 1], [5, 2], [8, 2], [9, 3]]) {
    check(`a Scholarship Modifier of ${scholarship} adds ${quarter}`,
      analysisBonus(marker("Actor.tizi", { scholarship, on: them.uuid }), them)[0].value,
      3 + quarter);
  }

  check("and it is written as the entry writes it",
    analysisBonus(marker("Actor.tizi", { scholarship: 6, on: them.uuid }), them)[0].written,
    "+1(T)+2");

  // Yours against the one you Analyzed, which is the narrower reading and the built one.
  check("somebody else's mark is not your bonus",
    analysisBonus(marker("Actor.tizi", { on: other.uuid }), them), []);
  check("and neither is nobody at all",
    analysisBonus(marker("Actor.tizi", { on: them.uuid }), null), []);
}

// --- Where it reaches the three Combat Rolls --------------------------------------------------------
{
  // "Combat Rolls" is the Strike, the Dodge and the Wound Roll, and this bonus is against
  // one Opponent - so each takes it where that Opponent is known.
  check("the Strike takes it per person it reaches",
    CHAT.includes("const analysisParts = [...analysisBonus(attacker, target), ...foresightBonus(attacker, target),"),
    true);
  check("and it is said on the card beside the distance",
    /longRange,\s*\n[\s\S]{0,300}?analysis,/.test(CHAT), true);

  check("the Dodge takes it against whoever is attacking",
    CHAT.includes("parts.push(...analysisBonus(actor, fromUuidSync(attack?.attackerUuid ?? \"\")));"),
    true);

  check("and the Wound Roll where it is worked out per person",
    CHAT.includes("const effectiveWound = defence.wound(wound.total + analysis);"), true);
}

// --- What is not built, and why ----------------------------------------------------------------------
{
  const FILE = fs.readFileSync(path.join(TRAITS, "maneuvers", "analysis.dbu"), "utf8");

  check("the Minions line is carried and named as unbuilt",
    FILE.includes("There are no Minions in this system"), true);
  check("and the reading of \"your Combat Rolls\" is written down",
    FILE.includes("The other reading is that any"), true);
}

// --- `allow` allows, which it did not ------------------------------------------------------------
{
  // The parser has known the word since the language was written; the interpreter read
  // the node and not the flag on it, so every `allow` in a file collected a forbid.
  check("the Slot takes both",
    getSlot("maneuver.dragon-fist")?.ops, ["allow", "forbid", "set"]);

  const allowed = slotsFrom("[passive]\nallow maneuver.dragon-fist;\n");
  check("allowing writes true", allowed["maneuver.dragon-fist"], true);

  const forbidden = slotsFrom("[passive]\nforbid maneuver.dragon-fist;\n");
  check("and forbidding writes false", forbidden["maneuver.dragon-fist"], false);

  // The two questions, which are not the same question.
  check("granted says yes only to what was allowed",
    [granted(allowed, "maneuver.dragon-fist"),
     granted(forbidden, "maneuver.dragon-fist"),
     granted({}, "maneuver.dragon-fist")],
    [true, false, false]);

  check("and permits says no only to what was forbidden",
    [permits(allowed, "maneuver.dragon-fist"),
     permits(forbidden, "maneuver.dragon-fist"),
     permits({}, "maneuver.dragon-fist")],
    [true, false, true]);

  // Which is the whole difference between a Special Maneuver and every other one: not
  // mentioned is yes for the five and no for this one.
  check("not mentioned is the opposite answer for the two",
    [permits({}, "maneuver.x"), granted({}, "maneuver.x")], [true, false]);
}

// --- A grant and a forbid on the same Maneuver ----------------------------------------------------
{
  // One key, said both ways. A Special Maneuver has to pass both questions, so something
  // that grants access and something else that takes it away leaves it unusable.
  const both = slotsFrom(
    "[passive]\nallow maneuver.dragon-fist;\nforbid maneuver.dragon-fist;\n");

  check("the two do not both survive",
    typeof both["maneuver.dragon-fist"], "boolean");
  check("and whichever won, it is asked both ways",
    granted(both, "maneuver.dragon-fist") && permits(both, "maneuver.dragon-fist"),
    granted(both, "maneuver.dragon-fist") === true
      && permits(both, "maneuver.dragon-fist") === true);
}

// --- The gate, run ------------------------------------------------------------------------------------
{
  // Two ways in and one way out: an effect that wrote `allow`, a Skill with the Ranks for
  // it, and a `forbid` that closes it whichever way it was opened. Asked in one place, and
  // answered with what would open it rather than with a no.
  const special = { id: "analysis", name: "Analysis", special: true };
  const plain = { id: "basic-attack", name: "Basic Attack", special: false };

  const who = (slots = {}, skills = []) => ({
    name: "Tizi",
    system: { effects: { slots }, specialManeuvers: skills }
  });

  check("a Maneuver that is not Special is never closed",
    whyNotSpecial(who(), plain), null);

  check("a Special one with nothing at all says what would open it",
    whyNotSpecial(who({}, [{ maneuver: "analysis", skill: "Investigation", ranks: 0,
                             needs: 2, open: false }])),
    null);

  check("and names both numbers",
    whyNotSpecial(who({}, [{ maneuver: "analysis", skill: "Investigation", ranks: 1,
                             needs: 2, open: false }]), special),
    "Analysis opens at 2 Ranks of Investigation, and Tizi has 1.");

  check("the Ranks open it",
    whyNotSpecial(who({}, [{ maneuver: "analysis", skill: "Investigation", ranks: 2,
                             needs: 2, open: true }]), special),
    null);

  check("and so does an effect, with no Ranks at all",
    whyNotSpecial(who({ "maneuver.analysis": true }), special), null);

  // A Special Maneuver no Skill opens is one some effect has to hand over, and the reason
  // says that rather than naming a Skill that does not exist.
  check("one no Skill opens says it is an effect's to give",
    whyNotSpecial(who(), special),
    "Tizi has not been granted access to Analysis. A Special Maneuver is gained through "
    + "an effect.");

  // And a forbid closes it whichever way it was opened.
  check("a forbid closes one the Ranks opened",
    whyNotSpecial(who({ "maneuver.analysis": false },
      [{ maneuver: "analysis", skill: "Investigation", ranks: 4, needs: 2, open: true }]),
      special),
    "Something is keeping Tizi from using Analysis.");
  check("and one an effect opened",
    Boolean(whyNotSpecial(who({ "maneuver.analysis": false }), special)), true);

  // One question, asked by the Maneuver and by the sheet.
  check("the Maneuver asks it", USE.includes("const closed = whyNotSpecial(actor, maneuver);"),
    true);
  check("and the sheet asks the same one",
    SHEET.includes('return whyNotSpecial(this.actor, maneuver) ?? "";'), true);
}

// --- Which Skill opens which, and at what -------------------------------------------------------------
{
  // "Each Skill either provides an Adventuring Maneuver and/or a Special Maneuver for
  // gaining 2+ Skill Ranks in that Skill."
  check("two Ranks is the price", DBUCharacterData.SKILL_MANEUVER_RANKS, 2);

  check("Investigation opens Analysis",
    DBUCharacterData.SKILLS.investigation.specialManeuver, "analysis");
  check("Performance opens Hype",
    DBUCharacterData.SKILLS.performance.specialManeuver, "hype");
  check("Survival opens Brace",
    DBUCharacterData.SKILLS.survival.specialManeuver, "brace");
  check("Bluff opens Feint",
    DBUCharacterData.SKILLS.bluff.specialManeuver, "feint");
  check("Acrobatics opens Flip",
    DBUCharacterData.SKILLS.acrobatics.specialManeuver, "flip");
  check("Concealment opens Holding Back",
    DBUCharacterData.SKILLS.concealment.specialManeuver, "holding-back");
  check("Intuition opens Intuit",
    DBUCharacterData.SKILLS.intuition.specialManeuver, "intuit");
  check("Use Magic opens Magic Trick",
    DBUCharacterData.SKILLS.useMagic.specialManeuver, "magic-trick");
  check("Clairvoyance opens Sense",
    DBUCharacterData.SKILLS.clairvoyance.specialManeuver, "sense");
  check("Intimidation opens Terrify",
    DBUCharacterData.SKILLS.intimidation.specialManeuver, "terrify");
  check("Medicine opens Treatment",
    DBUCharacterData.SKILLS.medicine.specialManeuver, "treatment");

  // Required Skills: no Rank, no roll at all, so the Maneuver arrives one Rank after the
  // Skill becomes usable rather than one Rank after nothing.
  check("and the Required Skills among them are these - the four Crafts each one",
    Object.entries(DBUCharacterData.SKILLS)
      .filter(([, skill]) => skill.specialManeuver && skill.required)
      .map(([key]) => key).sort(),
    ["clairvoyance", "concealment", "craft", "craftApparel", "craftVehicles", "craftWeapons", "flight", "medicine", "pilot", "useMagic"]);

  // And not the Dirty Trick, which is also a Clash made with Bluff. Being the Skill a
  // Maneuver rolls is not the same question as being the Skill that hands it over, and
  // only the Skill's own entry answers the second.
  check("and Bluff opens only the one of its two Clashes that it says it does",
    Object.values(DBUCharacterData.SKILLS)
      .filter(skill => skill.specialManeuver === "dirty-trick").length, 0);
  check("though both Clashes are made with it",
    [getManeuver("feint").clashSkill, getManeuver("dirty-trick").clashSkill],
    ["bluff", "bluff"]);

  // Every Special Maneuver in the library is opened by something, and every Skill that
  // opens one names a Maneuver that exists.
  const opened = [...new Set(Object.values(DBUCharacterData.SKILLS)
    .map(skill => skill.specialManeuver).filter(Boolean))];
  check("and those are the eighteen so far - the Repair once, whichever Craft opens it", opened.sort(),
    ["analysis", "brace", "eject", "feint", "flip", "hide", "holding-back", "hype", "intuit",
     "magic-trick", "repair", "search", "sense", "snatch", "soar", "talk", "terrify", "treatment"]);
  check("each naming a Maneuver the library has",
    opened.every(id => Boolean(getManeuver(id))), true);
  check("and each of those being Special",
    opened.every(id => getManeuver(id).special), true);

  // One Special Maneuver is still an effect's to give, so the other half of the gate is
  // not dead code sitting behind a Skill that happens to cover everything.
  const unopened = allManeuvers()
    .filter(m => m.special && !opened.includes(m.id)).map(m => m.id);
  check("and these are opened by no Skill at all", unopened.sort(),
    ["absorb", "act-again", "amplified-power-up", "area-wipe", "attack-absorption", "aura-tail", "back-to-basics-power-up", "bite-attack", "boom", "class-up-berserker-choice", "class-up-elite-choice", "class-up-hero-choice", "coup-de-grace-strike", "dance", "dark-saiya-evil-points", "darkness-mixer", "demonic-battle-strike", "dirty-trick", "draining-attack", "energy-synchronize", "erratic-basic-attack", "face-me-at-full-power", "float-mirror", "full-awakening", "get-up", "glassification", "goof", "greater-super-class-choice", "healing-surge-instant", "hocus-pocus", "insta-kill", "insult", "internal-attack", "junior-creation", "legendary-chaos-surge", "limit-of-the-super-saiyan-recovery", "limit-of-the-super-saiyan-surge", "liquid-form", "movement-instant", "movement-or-basic-instant", "mutants-resilience-counter", "one-man-army", "one-on-one-duel", "overflowing-surge", "pinnacle-of-legacy-power-up", "planet-burst", "possess", "power-drain", "rampaging-tail", "s-cells-power-up", "spiritual-master-surge", "stance", "stop-wasting-my-time", "tail-attack", "tides-of-time", "time-lag", "time-prison", "time-to-get-serious", "transfiguration", "unify", "unkillable-majin-from-goop", "unkillable-majin-regeneration", "whack", "zoom"]);
}

// --- Two numbers in one Skill --------------------------------------------------------------------
{
  // Brace reads Survival Ranks twice, at two thresholds that are not the same rule: 2+
  // opens the Maneuver, like every Skill's, and 4+ is what the entry itself asks for to
  // double what it is worth. Easy to collapse into one number, so both are pinned.
  check("two Ranks opens it", DBUCharacterData.SKILL_MANEUVER_RANKS, 2);
  check("and four is what doubles it",
    getTrait("braced").script.includes("if (survival.ranks >= 4) {"), true);
  check("which is not the same number",
    DBUCharacterData.SKILL_MANEUVER_RANKS === 4, false);

  // So the gate and the reason both name the Skill now, where they named an effect.
  const who = (ranks) => ({
    name: "Tizi",
    system: {
      effects: { slots: {} },
      specialManeuvers: [{ maneuver: "brace", skill: "Survival", ranks,
                           needs: DBUCharacterData.SKILL_MANEUVER_RANKS,
                           open: ranks >= DBUCharacterData.SKILL_MANEUVER_RANKS }]
    }
  });
  check("one Rank is short, and the reason says by how much",
    whyNotSpecial(who(1), getManeuver("brace")),
    "Brace opens at 2 Ranks of Survival, and Tizi has 1.");
  check("two Ranks opens it for real", whyNotSpecial(who(2), getManeuver("brace")), null);
  check("and four still opens it, at twice the Tiers",
    whyNotSpecial(who(4), getManeuver("brace")), null);
}

// --- And the sheet says which it is, and why it is closed ---------------------------------------------
{
  // No list of their own: a Special Maneuver sits in its own kind's list, which for
  // Analysis is the Standard one.
  check("there is no Special group",
    SHEET.includes('{ key: "special"'), false);
  check("and the five groups are the five kinds",
    [...SHEET.matchAll(/\{ key: "(\w+)", playable/g)].map(m => m[1]),
    ["standard", "counter", "outOfSequence", "modifier"]);

  // Judged row by row, because the rule is about this Maneuver rather than about Special
  // Maneuvers in general.
  check("each row is judged on its own",
    SHEET.includes("&& !this.#withoutAccess(maneuver),"), true);

  // The row's own reason is the gate's, asked the same way and run against a real
  // character above. What is left to check here is that the sheet asks it at all rather
  // than keeping a second copy of the rule - which is what this used to be.
  const from = SHEET.indexOf("  #withoutAccess(maneuver) {");
  const body = SHEET.slice(from, SHEET.indexOf("\n  }", from));
  check("and asks the one question rather than keeping a copy of the rule",
    body.includes("whyNotSpecial(this.actor, maneuver)"), true);
  check("with nothing else left in it",
    body.split("\n").filter(line => line.trim()).length, 2);
}

// --- The Brace Maneuver as the rulebook lists it ------------------------------------------------
{
  check("listed", INDEX.traits.includes("maneuvers/brace.dbu"), true);

  const brace = getManeuver("brace");
  check("loaded as a Standard Maneuver", brace?.type, "standard");
  check("costing an Action", brace.actionCost, 1);
  check("and no Ki, which is what N/A means", brace.kiCost, 0);
  check("once a Combat Round", brace.usageLimit, { amount: 1, per: "round" });
  check("it is Special", brace.special, true);
  check("aimed at nobody", Boolean(brace.requiresTarget), false);
  check("and it is not an attack", Boolean(brace.attacking), false);
  check("its Exploitable line is carried as printed",
    brace.exploitable, "All adjacent Opponents.");
  // Carried as printed, full stop and all - which is what every other entry does too, some
  // of them with the stop and some without, because that is how each one is written.
  check("which six other Maneuvers open their own line with",
    // And Insta-Kill and Area Wipe, Villainous Maneuvers (the Adversaries page), since.
    allManeuvers().filter(m => m.exploitable.startsWith("All adjacent Opponents")).length, 14);
  // The Transfiguration's carries a rider after that line, and it is the one with a comma
  // in it - which is the case a folded header block exists for. `coerce` splits a header
  // value on commas, so the first Exploitable line with one became two strings and threw.
  // Checked as one string with the comma still in it.
  const rider = getManeuver("transfiguration").exploitable;
  check("the Transfiguration's line survives its own comma", typeof rider, "string");
  check("carrying the rider whole",
    rider.includes("in response to this Maneuver, you automatically fail the Strike Roll"),
    true);
  check("after the line five other Maneuvers share",
    rider.startsWith("All adjacent Opponents. If you are knocked through a Health Threshold"),
    true);

  for (const line of [
    "Until the start of your next turn, treat all Battle Weathers as if they were",
    "1 Weather Tier lower",
    "If this would reduce the Weather Tier to 0, ignore the effects of that Battle Weather",
    "If you have 4+ Skill Ranks in Survival, you may treat it as 2 Weather Tiers lower "
    + "instead"
  ]) {
    check(`the entry says "${line.slice(0, 40)}"`, brace.text.includes(line), true);
  }

  // "Special Maneuver: you gain access to the Brace Maneuver." The Skill's own entry is
  // what says so - Brace's says only that 4+ Ranks in Survival doubles it, which is a
  // different threshold in the same Skill.
  check("Survival opens it",
    DBUCharacterData.SKILLS.survival.specialManeuver, "brace");

  // Survival grants an Adventuring Maneuver too, and that is not recorded: there are no
  // Adventuring Maneuvers in this system and no Forage entry to build one from, and a
  // Skill naming a Maneuver the library has not got is the one thing this table refuses.
  check("and nothing claims a Maneuver that does not exist",
    Object.values(DBUCharacterData.SKILLS)
      .flatMap(skill => [skill.specialManeuver, skill.adventuringManeuver].filter(Boolean))
      .every(id => Boolean(getManeuver(id))), true);
  check("Forage is not in the library, so nothing points at it",
    Boolean(getManeuver("forage")), false);
}

// --- What it does, which is put a mark on a clock -------------------------------------------------
{
  const brace = getManeuver("brace");
  const { program, errors } = compile(script(brace.script), null);
  check("the script compiles", errors.map(e => e.message), []);

  const body = JSON.stringify(program);
  check("it puts the mark on", body.includes('"gain"') && body.includes("braced"), true);
  // "Until the START of your next turn", which is a different edge from the one most of
  // these use, and the system already knows the difference.
  check("and sets its clock to the start of your next turn",
    body.includes("start-of-next-turn"), true);
  check("fired when the Maneuver is used", brace.script.includes("[on used]"), true);
}

// --- How many Weather Tiers, run --------------------------------------------------------------------
{
  // "1 Weather Tier lower... if you have 4+ Skill Ranks in Survival, you may treat it as 2
  // Weather Tiers lower instead." Run against a character rather than read, because the
  // threshold is the whole of the rule.
  const { program, errors } = compile(script(getTrait("braced").script), null);
  check("the mark's passive compiles", errors.map(e => e.message), []);

  const tiers = (ranks) => {
    const entry = { program, priority: 6, sourceId: "braced", sourceName: "Braced",
                    level: 0, stacks: 1, armed: true, available: true };
    const slots = applyPassives([entry], "weather", {
      data: { skills: { survival: { ranks } } }, errors: [], context: {}, queue: []
    }).slots;
    return applySlot(slots, "weather.tiers", 0);
  };

  check("no Ranks in Survival is one Tier", tiers(0), 1);
  check("three Ranks is still one", tiers(3), 1);
  check("four is two", tiers(4), 2);
  check("and more than four is still two, not more", tiers(9), 2);

  // The Slot is declared, which is what stops a name nobody reads from compiling.
  const slot = getSlot("weather.tiers", {});
  check("the Slot exists", Boolean(slot), true);
  check("as a number settled before anything else - the Weather felt waits on it",
    [slot.kind, slot.phase], ["number", "weather"]);
  check("and says it is taken off the Weather felt, at 0 ignored",
    [slot.doc.includes("Said to the table"), slot.doc.includes("A Tier reduced to 0 is a Weather whose effects you ignore.")],
    [false, true]);
}

// --- And the sheet says what it comes to -------------------------------------------------------------
{
  // Off the Slot rather than off the Maneuver, so anything else that lowers a Weather Tier
  // lands in the same row without the sheet hearing about it.
  check("the sheet reads the Slot",
    SHEET.includes('const weatherTiers = this.actor.system.effects?.slots?.["weather.tiers"] ?? 0;'),
    true);
  check("and says nothing when there is nothing to say",
    SHEET.includes("context.weather = weatherTiers\n      ? {"), true);
  check("the row is drawn", COMBAT.includes("{{#if weather}}"), true);
  check("saying how many Tiers", COMBAT.includes("{{weather.tiers}} Tier"), true);
  check("beside the marks rather than inside one",
    COMBAT.indexOf("{{#each marks as |mark|}}") < COMBAT.indexOf("{{#if weather}}"), true);
}

console.log(failed ? `\n${failed} failing` : "\nall good");
process.exit(failed ? 1 : 0);
