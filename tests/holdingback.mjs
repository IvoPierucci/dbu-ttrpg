/**
 * The Holding Back Maneuver: the first Resource in this system with a moving ceiling.
 *
 * "The maximum you can possess is equal to your base Tier of Power." Every other Resource
 * states a number in its file; this one states a value about the character, and it changes
 * as they grow.
 *
 * The passive is the half worth running, because it has a cliff in it: each stack takes a
 * Tier of Power off, and at the ceiling the entry stops subtracting and states the answer
 * instead - "set your Tier of Power to 1" - because subtracting your whole base Tier would
 * leave you at nothing.
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

const { loadTraits, resourceDefinitions, resourceCeiling, resourceLimits } =
  await import(modUrl("effects/traits.mjs"));
const { loadManeuvers, getManeuver, whyNotSpecial, MANEUVER_TYPES } =
  await import(modUrl("maneuvers.mjs"));
const { compile } = await import(modUrl("effects/parser.mjs"));
const { applyPassives, applySlot } = await import(modUrl("effects/interpreter.mjs"));
const { getSlot } = await import(modUrl("effects/slots.mjs"));
const { maneuverItemFrom, definitionOf } = await import(modUrl("use-maneuver.mjs"));
const { default: DBUCharacterData } = await import(modUrl("data/actor-character.mjs"));
await loadTraits();
await loadManeuvers();

const TRAIT = fs.readFileSync(path.join(TRAITS, "maneuvers", "holding-back.dbu"), "utf8");
const USE = fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8");
const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
const INDEX = JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

// --- The Maneuver as the rulebook lists it -------------------------------------------------
{
  check("listed", INDEX.traits.includes("maneuvers/holding-back.dbu"), true);

  const held = getManeuver("holding-back");
  check("loaded as an Instant Maneuver", held?.type, "instant");
  check("which costs no Action", MANEUVER_TYPES.instant.action, null);
  check("and no Ki", held.kiCost, 0);
  check("once a Combat Round", held.usageLimit, { amount: 1, per: "round" });
  check("it is Special", held.special, true);
  check("aimed at nobody", Boolean(held.requiresTarget), false);

  for (const line of [
    "Gain any number of Holding Back Stacks (the maximum you can possess is equal\n  to your base Tier of Power)",
    "For each stack of Holding Back, reduce your Tier of Power\n  by 1",
    "If your number of Holding Back Stacks is equal to your base Tier of Power, reduce\n  your Combat Rolls by 1(bT) and set your Tier of Power to 1",
    "increase the Skill Bonus for your\n  Concealment Skill Checks by 1 (max. 3)",
    "you can instead choose to remove any\n  number of them or gain more up to your maximum"
  ]) {
    check(`the entry says "${line.slice(0, 44).replace(/\n\s+/g, " ")}"`,
      TRAIT.includes(line), true);
  }

  // "Special Maneuver: you gain access to the Holding Back Maneuver", in Concealment's
  // own entry - which is also the Skill this Maneuver's stacks improve, and that is a
  // coincidence of this entry rather than a rule.
  check("Concealment opens it",
    DBUCharacterData.SKILLS.concealment.specialManeuver, "holding-back");

  const who = (ranks) => ({
    name: "Tizi",
    system: {
      effects: { slots: {} },
      specialManeuvers: [{ maneuver: "holding-back", skill: "Concealment", ranks, needs: 2,
                           open: ranks >= 2 }]
    }
  });
  check("one Rank is short, and says by how much", whyNotSpecial(who(1), held),
    "Holding Back opens at 2 Ranks of Concealment, and Tizi has 1.");
  check("two Ranks opens it", whyNotSpecial(who(2), held), null);

  // A Required Skill cannot be rolled at all without a Rank, so the Maneuver arrives one
  // Rank after the Skill becomes usable - and the Concealment bonus its stacks give is a
  // bonus to something the character can already do.
  check("and Concealment is a Required Skill",
    DBUCharacterData.SKILLS.concealment.required, true);
}

// --- A ceiling that moves --------------------------------------------------------------------
{
  const held = getManeuver("holding-back");
  const declared = resourceDefinitions().holdingback;

  check("the Maneuver declares a Resource", Boolean(declared), true);
  check("named as the entry names it", declared.label, "Holding Back");
  check("and it is a Resource the rules name, not bookkeeping", declared.internal, false);
  check("declared by this Maneuver", declared.id, "holding-back");

  // The first with a ceiling that is not a number in the file.
  check("bounded by the character rather than by a number", declared.maxFrom,
    "baseTierOfPower");
  check("and stating no number of its own", declared.max, 0);
  check("which every other Resource does state",
    Object.entries(resourceDefinitions())
      .filter(([name]) => !["holdingback", "lifeforce", "comfort", "demonicpower", "demonicfatigue", "greed", "armory", "swagger", "lightstacks", "grudge", "evilpoints"].includes(name))
      .every(([, d]) => (d.max > 0) && !d.maxFrom), true);

  const who = (tier) => ({ system: { baseTierOfPower: tier } });
  check("a base Tier of 1 allows one stack", resourceCeiling(declared, who(1)), 1);
  check("a base Tier of 4 allows four", resourceCeiling(declared, who(4)), 4);
  check("and it moves with them", [resourceCeiling(declared, who(2)),
                                   resourceCeiling(declared, who(7))], [2, 7]);
  check("a base Tier of nothing allows none", resourceCeiling(declared, who(0)), 0);
  check("and a fraction is floored, since a ceiling counts stacks",
    resourceCeiling(declared, { system: { baseTierOfPower: 3.9 } }), 3);

  // Both places that clamp a Resource ask the character now.
  check("the runtime clamp asks", CHAT.includes("resourceLimits(actor)[name] ?? 0;"), true);
  const RUNTIME = fs.readFileSync(
    path.join(ROOT, "module", "effects", "moments-runtime.mjs"), "utf8");
  check("and so does the one a script's write goes through",
    RUNTIME.includes("const limits = resourceLimits(actor);"), true);
  check("and the sheet's row asks the same function",
    fs.readFileSync(path.join(ROOT, "module", "sheets", "actor-character-sheet.mjs"), "utf8")
      .includes("max: resourceCeiling(definition, { system })"), true);
}

// --- What a stack costs you, run ----------------------------------------------------------------
{
  const { program, errors } = compile(String(getManeuver("holding-back").script ?? ""), null);
  check("the passive compiles", errors.map(e => e.message), []);

  /** The Slots this passive settles for a character holding that many stacks. */
  const at = (stacks, baseTier, phase) => {
    const entry = { program, priority: 6, sourceId: "holding-back", sourceName: "Holding Back",
                    level: 0, stacks: 1, armed: true, available: true };
    return applyPassives([entry], phase, {
      data: {
        baseTierOfPower: baseTier,
        skills: { concealment: { ranks: 0, label: "Concealment" } },
        resources: stacks ? { holdingback: { stacks, max: baseTier } } : {}
      },
      errors: [], context: {}, queue: []
    }).slots;
  };

  const tier = (stacks, baseTier) =>
    applySlot(at(stacks, baseTier, "tier"), "tierOfPower", baseTier);
  // `combatRolls` is settled after Might and the Thresholds are, and it fans out: what is
  // written lands on the Strike, the Dodge and the Wound Roll together, which is what the
  // rulebook means by the term. So it is read off one of the three rather than off the name.
  const rolls = (stacks, baseTier) =>
    applySlot(at(stacks, baseTier, "late"), "strike", 0);
  const everyRoll = (stacks, baseTier) => {
    const slots = at(stacks, baseTier, "late");
    return ["strike", "dodge", "wound"].map(key => applySlot(slots, key, 0));
  };
  const hidden = (stacks, baseTier) =>
    applySlot(at(stacks, baseTier, "core"), "skill.concealment.bonus", 0);

  // "For each stack of Holding Back, reduce your Tier of Power by 1."
  check("no stacks is no change", tier(0, 5), 5);
  check("one stack is a Tier off", tier(1, 5), 4);
  check("three stacks is three off", tier(3, 5), 2);
  check("and four leaves one, the hard way", tier(4, 5), 1);

  // "If your number of Holding Back Stacks is equal to your base Tier of Power... set your
  // Tier of Power to 1." Which is where subtracting would have left you at nothing.
  check("filling up sets it to 1 rather than to nothing", tier(5, 5), 1);
  check("at a base Tier of 1, one stack is already full", tier(1, 1), 1);
  check("and at 2, two stacks is", tier(2, 2), 1);
  // A hand-set overflow gets the floor rather than a Tier below one.
  check("more than full is still 1, not less", tier(9, 3), 1);

  // "Reduce your Combat Rolls by 1(bT)", and only then.
  check("a partial holding costs no Combat Rolls", rolls(3, 5), 0);
  check("a full one costs 1(bT)", rolls(5, 5), -5);
  check("which is the base Tier, not the current one", rolls(2, 2), -2);
  check("and none at all with no stacks", rolls(0, 5), 0);
  check("and it is every Combat Roll, not only the Strike", everyRoll(5, 5), [-5, -5, -5]);
  check("which is what the Slot fans out to",
    getSlot("combatRolls", {}).fanOut, ["strike", "dodge", "wound"]);
  check("settled after Might and the Thresholds are",
    getSlot("combatRolls", {}).phase, "late");

  // "Increase the Skill Bonus for your Concealment Skill Checks by 1 (max. 3)."
  check("one stack is one point of Concealment", hidden(1, 5), 1);
  check("three is three", hidden(3, 5), 3);
  check("and four is still three: the cap is on what they are worth",
    hidden(4, 5), 3);
  check("as is five", hidden(5, 5), 3);
  check("no stacks is nothing", hidden(0, 5), 0);

  // The Slots it writes, and the phase each is settled in - which is why the amounts are
  // in (bT): the Tier of Power is what (T) means and it is not known yet.
  check("the Tier of Power is settled before the Tiers are known",
    getSlot("tierOfPower", {}).phase, "tier");
  check("and the script says so in (bT)", TRAIT.includes("combatRolls -= 1(bT);"), true);
  check("a Concealment bonus is a Slot the system has",
    Boolean(getSlot("skill.concealment.bonus", { skills: { concealment: {} } })), true);
}

// --- No clock ---------------------------------------------------------------------------------
{
  // Every other Resource here runs out on a turn edge. These come off when you take them
  // off, which is what the entry's last paragraph is for - so the file sets no duration.
  check("nothing puts it on a clock",
    String(getManeuver("holding-back").script ?? "").includes("expires("), false);
  check("where the Power Up Maneuver does",
    getManeuver("power-up").script.includes("expires(power, next-turn);"), true);
}

// --- The question it asks ------------------------------------------------------------------------
{
  const held = getManeuver("holding-back");
  check("the Maneuver asks one", held.holdingBack, true);

  const item = maneuverItemFrom(held);
  check("the Item carries the flag", item.system.holdingBack, true);
  check("and reading it back gives it up",
    definitionOf({ id: "x", name: held.name,
      system: { ...item.system, maneuverId: held.id } }).holdingBack, true);

  // Asked as a total rather than as a change, because "gain any number" and "remove any
  // number of them" are the same question answered higher or lower.
  check("asked at the door", USE.includes("    if (maneuver.holdingBack) {"), true);
  check("and dropping the question changes nothing",
    USE.includes("      if (!chosen) return false;"), true);
  check("the field starts where the character already is",
    USE.includes('<input type="number" name="stacks" value="${now}" min="0" max="${most}"/>'),
    true);
  check("clamped again on the way out, since max is only advice to the browser",
    USE.includes("return Number.isFinite(value) ? Math.min(Math.max(0, value), most) : now;"),
    true);

  // Which Resource it is about is asked of the library rather than carried on the
  // Maneuver: two copies of that had just been a bug elsewhere.
  check("the Resource is found by which Trait declares it",
    USE.includes("    .find(([, definition]) => definition.id === maneuver.id);"), true);
  check("and written through the one place that clamps a Resource",
    USE.includes("await setResource(actor, chosen.name, chosen.stacks);"), true);
  check("which is shared rather than copied",
    CHAT.includes("export async function setResource(actor, name, stacks, { lost = false } = {}) {"), true);
}

console.log(`${failed} failing`);
process.exit(failed ? 1 : 0);
