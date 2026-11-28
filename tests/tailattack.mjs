/**
 * The Tail Attack Maneuver: the first Special Maneuver that is itself an attack, and the
 * first Maneuver of any kind that prices its own Profiles.
 *
 * Three things worth running.
 *
 * The price, because it is the one reading in this entry worth arguing about: what the
 * Maneuver states and what the Profile states are added, which is what this system has
 * always done, and the entry's own numbers point hard at a different answer. Both are
 * worked out here so the argument is numbers rather than prose.
 *
 * The Profile list, because "two of them, and which two depends on a choice made once" is
 * a shape nothing here had - `profile` named one and "any" meant all.
 *
 * And Diminishing Offense, in both directions. "Do not suffer from, or count towards" is
 * one sentence over two pieces of machinery, and the half that would go unnoticed is the
 * count: it is easy to read and easy to forget not to write.
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
const {
  loadManeuvers, getManeuver, allManeuvers, whyNotSpecial, maneuverKiCost,
  minimumAttackKiCost, profileKiCost, PROFILES, MANEUVER_TYPES,
  TAIL_VARIANTS, TAIL_BASE_PROFILE, tailProfiles
} = await import(modUrl("maneuvers.mjs"));
const { maneuverItemFrom, definitionOf } = await import(modUrl("use-maneuver.mjs"));
const { default: DBUCharacterData } = await import(modUrl("data/actor-character.mjs"));
await loadTraits();
await loadManeuvers();

const TRAIT = fs.readFileSync(path.join(TRAITS, "maneuvers", "tail-attack.dbu"), "utf8");
const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
const MAN = fs.readFileSync(path.join(ROOT, "module", "maneuvers.mjs"), "utf8");
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

/** A character, as little of one as a price needs. */
const who = (tier) => ({
  name: "Tizi",
  system: { tierOfPower: tier, baseTierOfPower: tier, effects: { slots: {} } }
});

// --- The Maneuver as the rulebook lists it -------------------------------------------------
{
  check("listed", INDEX.traits.includes("maneuvers/tail-attack.dbu"), true);

  const tail = getManeuver("tail-attack");
  check("loaded as an Instant Maneuver", tail?.type, "instant");
  check("which costs no Action, because an Instant has none to cost",
    MANEUVER_TYPES.instant.action, null);
  check("once a Combat Round", tail.usageLimit, { amount: 1, per: "round" });
  check("it is Special", tail.special, true);
  check("aimed at somebody", tail.requiresTarget, true);
  check("and it is itself the attack", tail.attacking, true);
  check("which is what makes it the first of those",
    allManeuvers().filter(m => m.special && m.attacking).map(m => m.id), ["area-wipe", "bite-attack", "massive-blow", "planet-burst", "tail-attack"]);
  check("priced at 2(T) of its own", tail.kiCostPerTier, 2);
  check("it is the flag it is", tail.tailAttack, true);
  check("and it is outside Diminishing Offense", tail.outsideDiminishing, true);

  // "An Unarmed Attacking Maneuver", carried as a tag because a tag is what these rules
  // match on - and read at declaration: no Weapon is asked for.
  check("tagged unarmed", tail.tags, ["unarmed"]);
  check("which the declaration reads: no Weapon asked for",
    USE.includes('if (!thrown && !(maneuver.tags ?? []).includes("unarmed") && !unassisted && !maneuver.buddyAttack && (armedAs !== "unarmed")) {'), true);
  check("as the file says", /a Maneuver\r?\n# tagged `unarmed` is not asked which Weapon/.test(TRAIT), true);

  for (const line of [
    "Target an Opponent with an Unarmed Attacking Maneuver using the Simple",
    "When you first gain access to this Special Maneuver, you may select one of",
    "* Elongated. You may increase the KP Cost of this Maneuver by 2(T) to instead use the",
    "* Multiple. You may increase the KP Cost of this Maneuver by 2(T) to instead use the",
    "Combination Profile of the Physical Foundation",
    "* Spiked. You may increase the KP Cost of this Maneuver by 4(T) to instead use the",
    "* Heavy. You may increase the KP Cost of this Maneuver by 6(T) to instead use the",
    "do not suffer from, or count\n  towards, the penalty from Diminishing Offense"
  ]) {
    check(`the entry says "${line.slice(0, 44).replace(/\n\s+/g, " ")}"`,
      TRAIT.includes(line), true);
  }

  check("no Skill opens it",
    Object.values(DBUCharacterData.SKILLS).some(s => s.specialManeuver === "tail-attack"),
    false);
  check("so an effect has to grant it",
    whyNotSpecial({ name: "Tizi", system: { effects: { slots: {} }, specialManeuvers: [] } },
      tail),
    "Tizi has not been granted access to Tail Attack. A Special Maneuver is gained through "
    + "an effect.");
}

// --- The four things a tail can be ----------------------------------------------------------
{
  check("four of them", Object.keys(TAIL_VARIANTS).sort(),
    ["elongated", "heavy", "multiple", "spiked"]);
  check("each naming a Profile the library has",
    Object.values(TAIL_VARIANTS).every(v => Boolean(PROFILES[v.profile])), true);
  check("and those are the four the entry names",
    Object.values(TAIL_VARIANTS).map(v => v.profile),
    ["sweeping", "combination", "crushing", "powered"]);
  check("with the entry's own surcharges",
    Object.values(TAIL_VARIANTS).map(v => v.kiCostPerTier), [2, 2, 4, 6]);

  // "The Combination Profile of the Physical Foundation." The entry pins a Foundation
  // exactly once, and this is the one Profile of the four that needed it said.
  check("only one of them pins a Foundation",
    Object.entries(TAIL_VARIANTS).filter(([, v]) => v.foundation).map(([key]) => key),
    ["multiple"]);
  check("and it pins Physical", TAIL_VARIANTS.multiple.foundation, "physical");
  check("to the only one of the four that belongs to more than one Foundation",
    Object.values(TAIL_VARIANTS)
      .filter(v => PROFILES[v.profile].foundations.length > 1).map(v => v.profile),
    ["combination"]);
  check("where the other three are Physical already",
    ["sweeping", "crushing", "powered"].map(id => PROFILES[id].foundations),
    [["physical"], ["physical"], ["physical"]]);

  // The base Profile is Simple, and Simple is pinned to nothing: the entry says nothing
  // about its Foundation, and the table settled that it may be any of the three. So a Tail
  // Attack is Physical in exactly the one place the entry pins it and nowhere else.
  check("the Profile it always has is Simple", TAIL_BASE_PROFILE, "simple");
  check("which belongs to all three Foundations", PROFILES.simple.foundations.length, 3);
  check("and is pinned to none of them",
    tailProfiles("elongated").profileFoundation.simple ?? null, null);
  check("not by any variant, whichever was taken",
    Object.keys(TAIL_VARIANTS).map(key => tailProfiles(key).profileFoundation.simple ?? null),
    [null, null, null, null]);
  check("so the Foundation is asked, as it is for every other Simple attack",
    MAN.includes("  const available = pinned ? [pinned] : PROFILES[profile].foundations;"), true);
  check("which the file records as settled rather than guessed",
    TRAIT.includes("Settled by the table: the Simple Profile may be made with any Foundation"),
    true);
}

// --- Which Profiles, and what the second one adds --------------------------------------------
{
  check("unchosen offers the Simple Profile alone",
    tailProfiles("").profileChoices, ["simple"]);
  check("and charges nothing extra for it", tailProfiles("").profileSurcharge, {});

  check("declining is the same list",
    tailProfiles("none").profileChoices, ["simple"]);
  check("and a variant nothing knows about is too, rather than a crash",
    tailProfiles("nonsense").profileChoices, ["simple"]);

  for (const [key, variant] of Object.entries(TAIL_VARIANTS)) {
    check(`${key} offers Simple and ${variant.profile}`,
      tailProfiles(key).profileChoices, ["simple", variant.profile]);
    check(`and charges ${variant.kiCostPerTier}(T) for the second of them`,
      tailProfiles(key).profileSurcharge, { [variant.profile]: variant.kiCostPerTier });
  }

  // Derived rather than stored, so the list and the surcharge cannot disagree.
  check("derived from the one field, not kept beside it",
    USE.includes("...(item.system.tailAttack ? tailProfiles(item.system.tailVariant ?? \"\") : {}),"),
    true);
}

// --- The picker is narrowed to them, run -----------------------------------------------------
{
  const profileGroups = new Function("PROFILES", "profileOpen",
    `${source(MAN, "profileGroups")}\nreturn profileGroups;`)(PROFILES, () => true);
  const listed = (allowed) => profileGroups(DBUCharacterData.FOUNDATIONS, allowed)
    .flatMap(group => group.profiles.map(p => `${group.key}:${p.id}`));

  check("a Maneuver that allows two gets two",
    listed(["simple", "sweeping"]), ["multi:simple", "physical:sweeping"]);
  check("each still under the group it belongs to",
    listed(["combination"]), ["multi:combination"]);
  check("allowing nothing is allowing everything, which is what every other Maneuver does",
    listed([]).length, Object.keys(PROFILES).length);
  check("and a Tail Attack with no variant sees one Profile",
    listed(tailProfiles("").profileChoices), ["multi:simple"]);
  check("with Heavy, two", listed(tailProfiles("heavy").profileChoices),
    ["multi:simple", "physical:powered"]);

  check("both pickers are narrowed the same way",
    (MAN.match(/profileGroups\(foundations, maneuver\.profileChoices \?\? \[\], actor\)/g) ?? []).length,
    2);
}

// --- What it costs: what is written, and nothing on top of it -------------------------------
{
  const tail = (variant) => ({ ...getManeuver("tail-attack"), ...tailProfiles(variant) });
  const price = (variant, profile, tier = 1) =>
    maneuverKiCost(tail(variant), { profile }, who(tier));

  // The written price is the whole price: the Maneuver's stated cost plus the variant, and
  // the Profile's own cost is not added because this Maneuver's price is what buys it.
  check("Simple with no variant is the stated 2(T)", price("", "simple"), 2);
  check("which is 2 a Tier", [price("", "simple", 3), price("", "simple", 5)], [6, 10]);

  check("Elongated is 2 + 2 as written", price("elongated", "sweeping"), 4);
  check("Multiple is 2 + 2 as written", price("multiple", "combination"), 4);
  check("Spiked is 2 + 4 as written", price("spiked", "crushing"), 6);
  check("Heavy is 2 + 6 as written", price("heavy", "powered"), 8);
  check("and all of it scales with the Tier of Power",
    price("heavy", "powered", 4), 32);

  // Which is the entry's four bullets read straight off, per Tier.
  check("every variant costs its bullet",
    Object.entries(TAIL_VARIANTS).map(([key, v]) => price(key, v.profile)),
    Object.values(TAIL_VARIANTS).map(v => 2 + v.kiCostPerTier));

  // The Profile's own cost is charged to every other Attacking Maneuver and not to this
  // one, which is the whole of the change.
  check("this is the only Maneuver whose price covers its Profile",
    allManeuvers().filter(m => m.kiCostCoversProfile).map(m => m.id), ["planet-burst", "tail-attack"]);
  check("so a Basic Attack still pays what the Profile lists",
    maneuverKiCost(getManeuver("basic-attack"), { profile: "powered" }, who(1)),
    profileKiCost("powered", null, who(1)));
  check("where a Tail Attack on the same Profile pays what is written instead",
    [price("heavy", "powered"), profileKiCost("powered", null, who(1))], [8, 8]);

  // The surcharge is bought with the Profile, not with the variant: taking Elongated and
  // then throwing a Simple one costs what a Simple one costs.
  check("a variant you do not use costs nothing",
    price("elongated", "simple"), 2);
  check("nor does one you have not taken",
    [price("", "simple"), price("none", "simple")], [2, 2]);

  // Three of the four written totals land exactly on what the Profile costs anywhere else.
  // Combination is the odd one: through a Tail Attack it is 1(T) more than Combination's
  // own listed cost. Written wins, so that stands as written rather than being bent to
  // match - and there is no special case for it, which is the point of checking it.
  check("three of the four come to the Profile's own cost",
    Object.entries(TAIL_VARIANTS).map(([key, v]) =>
      price(key, v.profile) === profileKiCost(v.profile, null, who(1))),
    [true, false, true, true]);
  check("and Combination is the one that does not, by one",
    price("multiple", "combination") - profileKiCost("combination", null, who(1)), 1);
  check("which is the same rule applied rather than an exception to it",
    source(MAN, "surchargeKiCost")
      .includes("  const perTier = maneuver.profileSurcharge?.[profileId] ?? 0;"), true);
  check("and no variant carries an adjustment of its own",
    [...new Set(Object.values(TAIL_VARIANTS).flatMap(v => Object.keys(v)))].sort(),
    ["foundation", "kiCostPerTier", "label", "profile", "tip"]);
  check("said in the file, because it looks like a bug and is not one",
    TRAIT.includes("through a Tail Attack it costs 1(T) more than Combination costs "
      + "anywhere\n# else."), true);

  // The Minimum Ki Point Cost still sits underneath, unchanged: it is half the Profile's
  // listed cost, and a rule about attacks rather than about this Maneuver.
  check("the floor is the Profile's alone",
    [minimumAttackKiCost("sweeping", who(1)), minimumAttackKiCost("powered", who(1))],
    [2, 4]);
  check("and a written price that buys a Profile always clears it",
    Object.entries(TAIL_VARIANTS).every(([key, v]) =>
      [1, 3, 7].every(tier =>
        price(key, v.profile, tier) >= minimumAttackKiCost(v.profile, who(tier)))),
    true);
  check("so nothing raises a Tail Attack above what is written",
    [1, 3, 7].map(tier => price("multiple", "combination", tier)), [4, 12, 28]);

  // The picker shows the whole price, so what a variant costs is visible before it is paid.
  check("the picker prices what it will actually charge",
    MAN.includes("  return maneuverKiCost(maneuver, { profile: profileId }, actor);"), true);

  // The surcharge is part of the base, where the discounts that apply to this Maneuver can
  // reach it; the Profile's own cost is the term that is now conditional.
  check("the surcharge is part of the base rather than added after it",
    MAN.includes("    + surchargeKiCost(maneuver, declared?.profile, actor)"),
    true);
  check("and the Profile's own cost is the term this Maneuver skips",
    MAN.includes("  const forProfile = (declared && !maneuver.kiCostCoversProfile)"), true);
}

// --- Outside Diminishing Offense, both ways -------------------------------------------------
{
  // "Do not suffer from": the row is left off the Strike Roll. Run, out of the roll's own
  // source, so an edit to it is an edit to what is checked.
  // strikeParts - the one list the roll and its window share.
  const from = CHAT.indexOf("function strikeParts(attacker, attack) {");
  const listText = CHAT.slice(CHAT.indexOf("[", from), CHAT.indexOf("\n  ];", from) + 4);
  const strikeParts = new Function(
    "attacker", "attack", "profileStrikeParts", "modifierStrikeParts", "musclePenalty",
    "thresholdPenalty", "techniqueStrikeParts", "strikeOf", "favoredParts", "maneuverStrikeParts", "profileSlotStrike", "unitedStrikeParts", "variableParts", "spotterParts", "partyParts", "bioBondParts", "customBuffBasicIsSignature", "slotPart", "heavyWager", `return ${listText};`);
  const rows = (outsideDiminishing) => strikeParts(
    { system: { combat: { strike: 7 }, diminishing: { offense: { penalty: 4 } } } },
    { outsideDiminishing },
    () => [], () => [], () => [], () => [], () => [],
    (actor) => ({ label: "Strike", value: actor.system.combat.strike }), () => [], () => [], () => [], () => [], () => [], () => [], () => [], () => [], () => false, () => [], () => false).map(part => part.label);

  check("an ordinary attack carries the Diminishing Offense row",
    rows(false), ["Strike", "Dim. Offense"]);
  check("and a Tail Attack does not carry it at all",
    rows(true), ["Strike"]);
  check("left off rather than shown at nothing",
    rows(true).some(label => label === "Dim. Offense"), false);

  // "Do not count towards": the round's attack count is not raised.
  check("the count is raised by a number rather than by one",
    CHAT.includes('    "system.attacksThisRound": actor.system.attacksThisRound + counts,'),
    true);
  check("and the number is nothing for a Maneuver outside it",
    CHAT.includes("  const counts = maneuver.outsideDiminishing ? 0 : (technique?.attacksCounted ?? 1);"), true);
  check("which is what the penalty is worked out from",
    fs.readFileSync(path.join(ROOT, "module", "data", "actor-character.mjs"), "utf8")
      .includes("    const offenseStacks = Math.max(0, this.attacksThisRound - freeAttacks);"),
    true);

  // Carried on the attack, since the Strike Roll happens later and often elsewhere.
  check("the attack carries it",
    CHAT.includes("          outsideDiminishing: Boolean(maneuver.outsideDiminishing),"), true);
  check("and it is the only Maneuver in the library outside it",
    allManeuvers().filter(m => m.outsideDiminishing).map(m => m.id), ["tail-attack"]);
}

// --- The choice made once, and kept ----------------------------------------------------------
{
  const tail = getManeuver("tail-attack");

  // The library's copy belongs to nobody, so it holds no variant - and still prices and
  // offers the Simple Profile, which is what a sheet showing the library's copy needs.
  check("the library's copy has taken nothing", tail.tailVariant, "");
  check("and offers the Simple Profile regardless", tail.profileChoices, ["simple"]);

  const item = maneuverItemFrom(tail);
  check("the Item carries both halves",
    [item.system.tailAttack, item.system.tailVariant], [true, ""]);

  const read = (variant) => definitionOf({
    id: "x", name: "Whatever they called it",
    system: { ...item.system, maneuverId: tail.id, tailVariant: variant }
  });
  check("reading an unchosen Item back gives the Simple Profile",
    read("").profileChoices, ["simple"]);
  check("and a chosen one gives both",
    read("spiked").profileChoices, ["simple", "crushing"]);
  check("with the surcharge that goes with it",
    read("spiked").profileSurcharge, { crushing: 4 });
  check("and a declined one is not an unchosen one",
    [read("none").tailVariant, read("").tailVariant], ["none", ""]);

  // Written to the Item rather than the character: a second Tail Attack kept beside the
  // first is a different tail, and the Item is where a player's changes already live.
  check("recorded on the Item",
    USE.includes('  await item.update({ "system.tailVariant": variant });'), true);
  check("looked up by the Item's own id",
    USE.includes("  const item = actor.items.get(maneuver.itemId);"), true);

  // Asked only while it is unanswered, and before the Profile is declared - the answer
  // decides what the picker offers.
  check("asked once", USE.includes("  if (maneuver.tailAttack && !maneuver.tailVariant) {"),
    true);
  check("before the Profile is declared",
    USE.indexOf("if (maneuver.tailAttack && !maneuver.tailVariant)")
      < USE.indexOf("    declared = await declareAttack(locked,"), true);
  check("and backing out spends nothing",
    USE.includes("    const variant = await askTailVariant(actor, maneuver);\n"
      + "    if (!variant) return false;"), true);
  check("the Maneuver used from there is the one with the variant on it",
    USE.includes("    maneuver = { ...maneuver, tailVariant: variant, ...tailProfiles(variant) };"),
    true);

  // And it stays the player's afterwards, on the Item's own sheet.
  check("the sheet offers it",
    fs.readFileSync(path.join(ROOT, "templates", "parts", "maneuver-rules.hbs"), "utf8")
      .includes('<select name="system.tailVariant">'), true);
  check("only on the Maneuver it is about",
    fs.readFileSync(path.join(ROOT, "module", "sheets", "item-maneuver-sheet.mjs"), "utf8")
      .includes("    context.tailVariants = this.item.system.tailAttack"), true);
  check("with both states on the list, so declining can be taken back",
    ["", "none"].every(value =>
      fs.readFileSync(path.join(ROOT, "module", "sheets", "item-maneuver-sheet.mjs"), "utf8")
        .includes(`{ value: "${value}", label:`)), true);
}

console.log(`${failed} failing`);
process.exit(failed ? 1 : 0);
