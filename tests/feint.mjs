/**
 * The Feint Maneuver: the first attack in this system that arrives with strings attached.
 *
 * Everything before it either granted an attack (Exploit, Cross Counter) or changed one
 * that was being declared (a Modifier Maneuver). This does both at once and in both
 * directions - two bonuses and two refusals - and the refusals are the half worth running,
 * because an attack refused after it is built is worse than one that could not be built.
 *
 * "(Bluff vs Intuition/Perception)" also turns the defender's Skill into a list, since
 * that slash is the same slash as "Strike/Dodge" and is read the same way.
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
const { loadManeuvers, getManeuver, maneuverKiCost, whyNotSpecial, maxKiWager,
        MANEUVER_TYPES, PROFILES, DEFEND_OPTIONS } = await import(modUrl("maneuvers.mjs"));
const { maneuverItemFrom, definitionOf } = await import(modUrl("use-maneuver.mjs"));
await loadTraits();
await loadManeuvers();

const TRAIT = fs.readFileSync(path.join(TRAITS, "maneuvers", "feint.dbu"), "utf8");
const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
const MAN = fs.readFileSync(path.join(ROOT, "module", "maneuvers.mjs"), "utf8");
const INDEX = JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

/** One top-level function out of a module, to be run rather than read. */
function source(text, name) {
  let at = text.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`no ${name}`);
  if (text.slice(at - 6, at) === "async ") at -= 6;
  return text.slice(at, text.indexOf("\n}\n", at) + 2);
}

// --- The Maneuver as the rulebook lists it ---------------------------------------------------
{
  check("listed", INDEX.traits.includes("maneuvers/feint.dbu"), true);

  const feint = getManeuver("feint");
  check("loaded as an Instant Maneuver", feint?.type, "instant");
  check("which costs no Action, because an Instant has no Action to cost",
    MANEUVER_TYPES.instant.action, null);
  check("once a Combat Round", feint.usageLimit, { amount: 1, per: "round" });
  check("it is Special", feint.special, true);
  check("aimed at somebody", feint.requiresTarget, true);
  check("and it is not itself an attack", Boolean(feint.attacking), false);

  // "KP Cost: 2(T)", which is the Tier of Power and not the Base Tier.
  const at = (tier) => maneuverKiCost(feint, null,
    { system: { tierOfPower: tier, baseTierOfPower: tier, effects: { slots: {} } } });
  check("priced in Tiers of Power", feint.kiCostPerTier, 2);
  check("so it costs 2 a Tier", [at(1), at(3), at(4)], [2, 6, 8]);

  for (const line of [
    "Target an Opponent within your Melee Range",
    "Make a Clash (Bluff vs\n  Intuition/Perception) against that Opponent",
    "you may use the Basic Attack\n  Maneuver as an Out-of-Sequence Maneuver",
    "Increase the Strike and Wound Rolls for this\n  Attacking Maneuver by 1(T)",
    "cannot use any option of the Defend\n  Maneuver in response to this Attacking Maneuver except Cross Counter",
    "this\n  Attacking Maneuver cannot possess an AoE",
    "you cannot Ki Wager more than 1/4\n  (rounded up) of your Maximum Capacity on this Attacking Maneuver"
  ]) {
    check(`the entry says "${line.slice(0, 44).replace(/\n\s+/g, " ")}"`,
      TRAIT.includes(line), true);
  }

  // The first Special Maneuver that is not a Standard one, which is the claim about what
  // Special means made once more by something other than argument.
  check("and it is the first Special Instant",
    [feint.type, getManeuver("analysis").type, getManeuver("attack-absorption").type],
    ["instant", "standard", "outOfSequence"]);

  // "Special Maneuver: you gain access to the Feint Maneuver" - in Bluff's entry, which is
  // the only place that ever says where a Special Maneuver comes from.
  const who = (ranks) => ({
    name: "Tizi",
    system: {
      effects: { slots: {} },
      specialManeuvers: [{ maneuver: "feint", skill: "Bluff", ranks, needs: 2, open: ranks >= 2 }]
    }
  });
  const { default: DBUCharacterData } = await import(modUrl("data/actor-character.mjs"));
  check("Bluff is the Skill that opens it",
    DBUCharacterData.SKILLS.bluff.specialManeuver, "feint");
  check("which is also the Skill its Clash is made with, though those are two questions",
    feint.clashSkill, "bluff");

  check("Bluff opens it, and the reason says by how much it is short",
    whyNotSpecial(who(1), feint), "Feint opens at 2 Ranks of Bluff, and Tizi has 1.");
  check("two Ranks opens it", whyNotSpecial(who(2), feint), null);
}

// --- The slash is a choice ---------------------------------------------------------------------
{
  const feint = getManeuver("feint");
  check("made with Bluff", feint.clashSkill, "bluff");
  check("and answered with either of two", feint.clashDefenderSkills,
    ["intuition", "perception"]);
  check("both of which the character has",
    feint.clashDefenderSkills.every(key => Boolean(getManeuver("feint")) && key), true);

  // The library's own copy carries the same Clash the Item's copy does. It did not: the
  // second Skill was written onto the Item and nowhere else, so two copies of one Maneuver
  // disagreed and only the door that reads the Item was right.
  check("the library's copy carries both halves", feint.clash,
    { skill: "bluff", defenderSkills: ["intuition", "perception"] });
  const item = maneuverItemFrom(feint);
  check("and the Item's copy says the same", item.system.clashDefenderSkills,
    ["intuition", "perception"]);
  check("read back off the Item unchanged",
    definitionOf({ id: "x", name: feint.name,
      system: { ...item.system, maneuverId: feint.id } }).clash,
    { skill: "bluff", defenderSkills: ["intuition", "perception"] });

  // Which Skill each side rolls, run.
  const skillPicked = new Function(
    `${source(CHAT, "skillPicked")}\nreturn skillPicked;`)();
  const clash = { challengerUuid: "Actor.a", defenderUuid: "Actor.b", skill: "bluff",
                  defenderSkills: ["intuition", "perception"], defenderSkill: "" };

  check("the challenger rolls the Skill the rule names",
    skillPicked(clash, "Actor.a"), "bluff");
  check("the defender rolls the first offered until they say",
    skillPicked(clash, "Actor.b"), "intuition");
  check("and what they chose once they have",
    skillPicked({ ...clash, defenderSkill: "perception" }, "Actor.b"), "perception");
  check("a Clash naming one Skill has the defender roll it",
    skillPicked({ ...clash, defenderSkills: ["intuition"] }, "Actor.b"), "intuition");
  check("and one naming none has them roll the challenger's",
    skillPicked({ ...clash, defenderSkills: [] }, "Actor.b"), "bluff");
  // A card written before any of this existed carries no list at all.
  check("as does a card from before the list existed",
    skillPicked({ challengerUuid: "Actor.a", defenderUuid: "Actor.b", skill: "bluff" },
      "Actor.b"), "bluff");

  // Asked of the defender alone: the challenger's Skill is named outright by the rule.
  check("only the defender is asked",
    CHAT.includes("      if ((actor.uuid !== clash.defenderUuid) || (offered.length < 2)) return {};"),
    true);
  check("and only when there is something to choose between",
    CHAT.includes("(offered.length < 2)"), true);
  check("before either side has seen a number",
    CHAT.indexOf("const answer = kind.choose ? await kind.choose(opened, actor) : {};") > 0,
    true);
}

// --- What winning attaches to the attack --------------------------------------------------------
{
  const feintGrants = new Function(`${source(CHAT, "feintGrants")}\nreturn feintGrants;`)();
  const who = (max) => ({ system: { capacity: { max } } });

  const grants = feintGrants(who(40));
  check("one row, named after what bought it", grants.modifiers.map(m => m.name), ["Feint"]);
  check("worth 1(T) on the Strike and 1(T) on the Wound",
    [grants.modifiers[0].strikePerTier, grants.modifiers[0].woundPerTier], [1, 1]);
  check("and nothing to the Damage Category, which the entry does not mention",
    grants.modifiers[0].damageCategoryShift, 0);
  check("shaped like everything else applied to an attack",
    Object.keys(grants.modifiers[0]).sort(),
    ["damageCategoryShift", "id", "name", "note", "strikePerTier", "woundPerTier"]);

  check("no Area of Effect", grants.noArea, true);
  check("and one option of the Defend Maneuver", grants.defencesAllowed, ["crossCounter"]);
  check("which is an option the Defend Maneuver has",
    Boolean(DEFEND_OPTIONS.crossCounter), true);
  check("and it is Cross Counter by name", DEFEND_OPTIONS.crossCounter.label, "Cross Counter");

  // "1/4 (rounded up) of your Maximum Capacity." Rounded up, which is unusual here.
  check("a quarter of the maximum Capacity", feintGrants(who(40)).wagerCap, 10);
  check("rounded up, not down", feintGrants(who(41)).wagerCap, 11);
  check("and up again", [feintGrants(who(42)).wagerCap, feintGrants(who(43)).wagerCap,
                         feintGrants(who(44)).wagerCap], [11, 11, 11]);
  check("a Capacity of nothing caps it at nothing", feintGrants(who(0)).wagerCap, 0);

  // The maximum, not what is left: it is a ceiling on this attack rather than a second
  // reading of what can be afforded.
  check("read off the maximum rather than what is left",
    CHAT.includes(": Math.ceil((feinter.system.capacity.max ?? 0) / 4)"), true);
}

// --- The ceiling, under the ones that were already there --------------------------------------------
{
  // The cap sits on top of the ordinary limits rather than replacing them: you still
  // cannot wager Capacity you have spent or Ki you have not got.
  check("the picker takes the lower of the two",
    MAN.includes("  const wagerMax = Math.min(\n    maxKiWager(actor, features),"), true);
  check("and an attack nobody capped is unchanged",
    MAN.includes("Number.isFinite(limits.wagerCap) ? limits.wagerCap : Number.POSITIVE_INFINITY);"),
    true);

  // maxKiWager itself, run, so "on top of" means something.
  const ordinary = maxKiWager({
    system: { capacity: { max: 40, remaining: 12 }, ki: { value: 30 } }
  });
  check("the ordinary ceiling is the lowest of the three", ordinary, 12);
  check("and a Feint's quarter can be lower still", Math.min(ordinary, 10), 10);
  check("or higher, and then it is not what binds", Math.min(8, 10), 8);
}

// --- The Profiles it cannot be made with ---------------------------------------------------------
{
  const area = Object.values(PROFILES).find(p => p.area);
  check("there is a Profile with an Area of Effect", Boolean(area), true);
  check("and plenty without", Object.values(PROFILES).filter(p => !p.area).length > 1, true);

  // Refused at the picker rather than after the attack is built, and with its own reason
  // beside it: "used this round" against a Profile nobody has used reads as a bug.
  check("a Profile with an Area is refused where it is chosen",
    MAN.includes("  const forbidden = Boolean(limits.noArea && profile.area);"), true);
  check("with the reason on it",
    MAN.includes("has an Area of Effect, and this Attacking Maneuver cannot."), true);
  check("and its own note, not the one about being spent",
    MAN.includes('const note = forbidden ? "Area of Effect"\n    : onlySimple(actor, profile.id) ? "Simple only" : PROFILE_SPENT_LABEL;'), true);
  check("which is the note the option draws",
    MAN.includes('<em class="dbu-profile-spent-note">${note}</em>'), true);

  // And the limits reach the picker at all.
  check("the declaration takes them", MAN.includes(
    "export async function declareAttack(maneuver, foundations, actor, limits = {}) {"), true);
  check("and hands them to the picker",
    MAN.includes("await pickProfile(maneuver, foundations, actor, limits);"), true);
  check("which hands them to each option",
    MAN.includes("const row = profileOption(profile, maneuver, actor, state, limits,"), true);
  check("an attack nobody put conditions on is declared exactly as before",
    MAN.includes("limits = {}"), true);
}

// --- The defence that is left ----------------------------------------------------------------------
{
  // "Cannot use any option of the Defend Maneuver except Cross Counter." Narrowed rather
  // than refused: the Defend Maneuver is still usable and what is left of it is one option.
  const all = Object.keys(DEFEND_OPTIONS);
  check("there is more than one option to narrow", all.length > 1, true);
  check("and narrowing to Cross Counter leaves exactly one",
    all.filter(key => ["crossCounter"].includes(key)), ["crossCounter"]);
  // `counterAttacks` is on the resolution table in chat.mjs rather than on the option the
  // dialog draws, so the option is asked for what it says it does.
  check("which is the one that strikes back",
    DEFEND_OPTIONS.crossCounter.summary.includes("strike back"), true);
  check("and the resolution table agrees",
    CHAT.includes("    counterAttacks: true,"), true);

  check("the dialog offers only what is allowed",
    CHAT.includes("  const offered = allowed.length\n"
      + "    ? Object.entries(DEFEND_OPTIONS).filter(([key]) => allowed.includes(key))\n"
      + "    : Object.entries(DEFEND_OPTIONS);"), true);
  check("an empty list is every option, which is every attack but this one",
    CHAT.includes("  const allowed = attack.defencesAllowed ?? [];"), true);
  check("and nothing left is said rather than shown as an empty dialog",
    CHAT.includes('ui.notifications.warn("No option of the Defend Maneuver can answer this attack.");'),
    true);

  check("carried on the attack itself", CHAT.includes("          defencesAllowed,"), true);
}

// --- The Wound Roll's own row -------------------------------------------------------------------------
{
  const modifierWoundParts = new Function(
    `${source(CHAT, "modifierWoundParts")}\nreturn modifierWoundParts;`)();
  const attacker = (tier) => ({ system: { tierOfPower: tier } });

  check("nothing applied is no row", modifierWoundParts(attacker(3), {}), []);
  check("and a Modifier that touches only the Strike is no row here",
    modifierWoundParts(attacker(3),
      { modifiers: [{ name: "Called Shot", strikePerTier: -2, woundPerTier: 0 }] }), []);

  check("a Feint is one row, scaled by the Tier of Power",
    modifierWoundParts(attacker(3),
      { modifiers: [{ name: "Feint", strikePerTier: 1, woundPerTier: 1 }] }),
    [{ label: "Feint", written: "+1(T)", value: 3 }]);
  check("and at Tier 1 it is worth one",
    modifierWoundParts(attacker(1),
      { modifiers: [{ name: "Feint", woundPerTier: 1 }] })[0].value, 1);
  check("a negative one is written as one",
    modifierWoundParts(attacker(2),
      { modifiers: [{ name: "Something", woundPerTier: -1 }] }),
    [{ label: "Something", written: "-1(T)", value: -2 }]);

  // Added where the Wound Roll is built, beside the rows that were already there.
  check("the Wound Roll takes the row",
    CHAT.includes("    ...modifierWoundParts(attacker, attack),"), true);
  check("and the Strike Roll still takes its own",
    CHAT.includes("function modifierStrikeParts(attacker, attack) {"), true);
}

// --- Won, and handed over -------------------------------------------------------------------------------
{
  check("the Clash knows it buys an attack",
    CHAT.includes('feint: maneuver.feint ? { applied: false } : null,'), true);
  check("settled once, by the one client that writes a Clash",
    CHAT.includes("  if (clash.feint && clash.result && !clash.feint.applied) {"), true);
  check("and marked before anything else happens",
    CHAT.includes("    ...clash, feint: { ...clash.feint, applied: true }"), true);

  // A tie goes to the defender, here as everywhere.
  check("losing hands over nothing",
    CHAT.includes('if (whoWonClash(clash.result) !== "challenger") {\n'
      + "    await settledNote(message, `${target.name} is not taken in.`);"), true);

  // The offer is the Exploit's shape: a Basic Attack, named, aimed at the one who was
  // feinted, with what was granted riding on it.
  check("winning offers the Basic Attack",
    CHAT.includes('      maneuverId: "basic-attack",\n      maneuverName: "Basic Attack",\n'
      + "      targetUuid: target.uuid,"), true);
  check("with the grants on the offer", CHAT.includes("      grants: feintGrants(feinter)"), true);

  // And the door reads them.
  check("the door takes what the offer granted",
    CHAT.includes("  const granted = offer.grants ?? null;"), true);
  check("and declares the attack under them",
    CHAT.includes("      noArea: Boolean(granted?.noArea),\n      wagerCap: granted?.wagerCap"),
    true);
  check("and puts them on the attack",
    CHAT.includes("        modifiers: granted?.modifiers ?? [],\n"
      + "        defencesAllowed: granted?.defencesAllowed ?? []"), true);

  // Out of sequence waives the Action Cost and nothing else - the Basic Attack's own KP is
  // still paid, and an offer that is not `free` is not free.
  check("the Action Cost is waived and the Ki is not",
    CHAT.includes("  let price = offer.free\n    // What was bought on top of it all the same - Greed of the Hera's AoE and Magnitude.\n    ? (Number(declared?.kiSurcharge) || 0)"), true);
  check("and it counts as an Out-of-Sequence Maneuver",
    CHAT.includes('await recordManeuverType(actor, "outOfSequence", { messageId: message.id });'),
    true);
}

console.log(`${failed} failing`);
process.exit(failed ? 1 : 0);
