/**
 * The Reflect Maneuver, and the first attack in this system that belongs to two people.
 *
 * "The original attacking Opponent rolls the Wound Roll for their initial Attacking
 * Maneuver instead." Every attack here has been one character's from the declaration
 * through to the Damage, so the half worth running is the split: who owes the Wound Roll,
 * and what the reflected attack carries across rather than working out again.
 *
 * And the condition, which has three parts in two places - the Foundation and the Area
 * are asked once, and how it was avoided is asked where each of those is settled.
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
const { loadManeuvers, getManeuver, maneuverKiCost, PROFILES, INTERVENE_OPTIONS,
        MANEUVER_TYPES } = await import(modUrl("maneuvers.mjs"));
await loadTraits();
await loadManeuvers();

const TRAIT = fs.readFileSync(path.join(TRAITS, "maneuvers", "reflect.dbu"), "utf8");
const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
const SHEET = fs.readFileSync(
  path.join(ROOT, "module", "sheets", "actor-character-sheet.mjs"), "utf8");
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
  check("listed", INDEX.traits.includes("maneuvers/reflect.dbu"), true);

  const reflect = getManeuver("reflect");
  check("loaded as an Out-of-Sequence Maneuver", reflect?.type, "outOfSequence");
  check("with no Action Cost, which is what N/A means here", reflect.actionCost, 0);
  check("it is an Attacking Maneuver", reflect.attacking, true);
  check("and aimed at somebody of your choosing", reflect.requiresTarget, true);
  check("naming no Profile of its own, since it borrows one", reflect.profile, undefined);

  check("the entry is there whole", [
    reflect.text.includes("Reflect Maneuver: Throw back an attack against an opponent!"),
    reflect.text.includes("(that did not possess an AoE)"),
    reflect.text.includes("the Parry option of the Defend Maneuver"),
    reflect.text.includes("Deflect or Distant Deflect options of the Intervene Maneuver"),
    reflect.text.includes("rolls the Wound Roll for their initial Attacking Maneuver instead as an Urgent Roll"),
    reflect.text.includes("including any Ki Wagers and Energy Charges included on that Attacking Maneuver")
  ], [true, true, true, true, true, true]);
}

// --- "KP Cost: 5(T)", and nothing else ------------------------------------------------------------
{
  const reflect = getManeuver("reflect");
  check("priced in Tiers of Power", reflect.kiCostPerTier, 5);

  const at = tier => maneuverKiCost(reflect, null, { system: { tierOfPower: tier } });
  check("so it costs 5 a Tier", [at(1), at(3)], [5, 15]);

  // An attack ordinarily pays its Profile's cost on top. This one does not - the entry
  // prices the Maneuver outright, and the Profile was paid for by whoever threw it first.
  check("the Profile is not charged for a second time",
    CHAT.includes("maneuverKiCost(maneuver, reflecting ? null : declared, actor)"), true);
}

// --- The condition, run ------------------------------------------------------------------------------
{
  // With the one it asks about an attack's Area, which knows the Area an attack brings for
  // itself as well as its Profile's.
  const areaAt = CHAT.indexOf("function attackArea(");
  const attackArea = new Function("PROFILES",
    `${CHAT.slice(areaAt, CHAT.indexOf("\n}\n", areaAt) + 2)}\nreturn attackArea;`)(PROFILES);
  const from = CHAT.indexOf("function whyNotReflect(");
  const to = CHAT.indexOf("\n/**", from);
  const whyNotReflect = new Function("PROFILES", "attackArea",
    `${CHAT.slice(from, to)}\nreturn whyNotReflect;`)(PROFILES, attackArea);

  // A Profile with no Area, and one with. Read off the table rather than named, so this
  // says what it means whichever Profiles the library happens to hold.
  const plain = Object.entries(PROFILES).find(([, p]) => !p.area)[0];
  const area = Object.entries(PROFILES).find(([, p]) => p.area)?.[0];

  check("an Energy attack with no Area can be thrown back",
    whyNotReflect({ foundation: "energy", profile: plain }), null);
  check("and a Magic one",
    whyNotReflect({ foundation: "magic", profile: plain }), null);

  check("a Physical attack cannot",
    whyNotReflect({ foundation: "physical", profile: plain }),
    "only an Energy or Magic Attack can be thrown back");

  check("there is a Profile with an Area to test against", Boolean(area), true);
  check("and one with an Area of Effect cannot",
    whyNotReflect({ foundation: "energy", profile: area }),
    "an Attacking Maneuver with an Area of Effect cannot be thrown back");
  check("nor one whose Area is its own, not its Profile's - a Grenade's",
    whyNotReflect({ foundation: "energy", profile: plain,
      area: { shape: "sphere", magnitude: "minor", centredOnTarget: true } }),
    "an Attacking Maneuver with an Area of Effect cannot be thrown back");
}

// --- Where it is offered -------------------------------------------------------------------------------
{
  // "If you avoid an Attacking Maneuver due to using the Parry option." Avoided, not
  // merely answered: a Parry that lost is a Parry that was hit.
  check("a Parry that turned it aside is offered it",
    CHAT.includes('if (!["parry", "stardust"].includes(own?.defense) || own.hit) continue;'), true);
  check("and said as that", CHAT.includes('"Reflect - your Parry turned it aside"'), true);

  // "Or succeed at the Might Clash for the Deflect or Distant Deflect options." Asked as
  // "the Clash was won", which is what those two options are marked with.
  check("a won Deflect is offered it", CHAT.includes("  if (entry.deflected) {\n    offerReflect("), true);
  check("which is the mark the Intervene table already carries",
    [INTERVENE_OPTIONS.deflect.clashes, INTERVENE_OPTIONS.distantDeflect.clashes,
     Boolean(INTERVENE_OPTIONS.defenseWall.clashes)],
    [true, true, false]);

  // Only to somebody who has the Maneuver, like every other offer here.
  check("and only to somebody who has it",
    CHAT.includes('if (!actor.items?.some(item => (item.type === "maneuver") && item.system.reflect)) return;'),
    true);

  // The attack travels with the offer: the card it came from goes on being edited after
  // this, and what is thrown back is that attack as it stood.
  for (const field of ["profile", "foundation", "kiWager", "energyCharges", "signature",
                       "damageCategoryShift", "attackerUuid"]) {
    // Either straight across or wrapped in a coercion - `signature` goes through Boolean,
    // since an older card may carry it as undefined.
    check(`the offer carries the attack's ${field}`,
      new RegExp(`\\n\\s+${field}: (?:Boolean\\()?attack\\.`).test(CHAT), true);
  }
}

// --- One attack, two characters -------------------------------------------------------------------------
{
  const from = CHAT.indexOf("function woundRoller(");
  const to = CHAT.indexOf("\n\n", from);
  const woundRoller = new Function("fromUuidSync",
    `${CHAT.slice(from, to)}\nreturn woundRoller;`)(uuid => uuid);

  check("an ordinary attack's Wound Roll is the attacker's",
    woundRoller({ attackerUuid: "Actor.striker" }), "Actor.striker");
  check("and a blank woundBy changes nothing",
    woundRoller({ attackerUuid: "Actor.striker", woundBy: "" }), "Actor.striker");
  check("a reflected one belongs to whoever threw it first",
    woundRoller({ attackerUuid: "Actor.reflector", woundBy: "Actor.thrower" }),
    "Actor.thrower");

  check("the roll is made by them", CHAT.includes("  const attacker = woundRoller(attack);"), true);

  // And the card says so. The roll was already the right person's and the row was
  // labelled with the one who threw it back, which is the right numbers under the wrong
  // name - worse than either on its own.
  check("the Wound row is labelled with whoever owes the roll",
    CHAT.includes('attackSide("Wound", attack.woundByName || attack.attackerName, result.wound)'),
    true);
  check("and the Strike row stays with whoever struck",
    CHAT.includes('attackSide("Strike", attack.attackerName, strikeShown(attack))'), true);

  // Which attack was thrown back, said on the card beside the rest of what it is made
  // of. It was written when the attack was posted and read by nothing at all.
  check("the card says the attack was thrown back",
    CHAT.includes("attack.reflectedFrom)} thrown back at "), true);
  check("and names whose it was", CHAT.includes("${Handlebars.escapeExpression(attack.woundByName ?? \"\")}"), true);
  check("and the button is on their client",
    CHAT.includes("    const roller = woundRoller(attack);\n    if (!roller?.isOwner) return;"), true);

  // The extra Strikes a Combination rolls stay with the one who made the Strike, which is
  // the reflector: those are the Strike's, not the Wound's.
  check("the follow-up Strikes stay with whoever struck",
    CHAT.includes("    const attacker = fromUuidSync(attack.attackerUuid);\n    if (!attacker?.isOwner) return;"),
    true);
}

// --- What comes across, and what is not worked out twice ---------------------------------------------------
{
  // A Beam's free Energy Charge is on that attack once already. Deriving it again from the
  // Profile would hand it to them a second time.
  check("the Energy Charges are taken whole",
    CHAT.includes("          energyCharges: reflecting\n            ? (reflecting.energyCharges ?? 0)"),
    true);
  // Wrapped now, since a Modifier Maneuver adds a step of its own on top - so this asks
  // for the part it is about rather than for the line as it was written that day.
  check("so is the Damage Category step",
    CHAT.includes("? (reflecting.damageCategoryShift ?? 0)"), true);
  check("and whose Technique it was, which sizes an Energy Charge's die",
    CHAT.includes("          signature: reflecting\n            ? Boolean(reflecting.signature)"), true);

  // There is a Profile that grants a free Charge, which is what makes that worth saying.
  check("a Profile that grants a free Energy Charge exists to get this wrong with",
    Object.values(PROFILES).some(p => p.grantsEnergyCharge || p.grantsUncappedEnergyCharge),
    true);

  // "As an Urgent Roll."
  check("the Wound Roll is Urgent", CHAT.includes("      urgent: Boolean(attack.urgentWound || attack.urgentRolls),"), true);
  check("marked when the attack is posted", CHAT.includes("          urgentWound: Boolean(reflecting),"), true);
  // Which is the same word the system already uses for a roll that cannot be failed on
  // purpose, so nothing new had to be invented for it.
  check("and Urgent already meant that here",
    CHAT.includes("  if (urgent) return URGENT;"), true);
}

// --- Taken as declared, with nothing asked -----------------------------------------------------------------
{
  // "Using the Profile of the initial Attacking Maneuver" - so there is no Profile to
  // pick, and the wager is theirs rather than a new one of yours.
  check("a Reflect is declared from the offer",
    CHAT.includes("  const reflecting = (maneuver.reflect && offer.reflect) ? offer.reflect : null;"),
    true);
  check("and the Profile picker is not opened over it",
    CHAT.includes("  if (!declared && (maneuver.profile || maneuver.attacking)) {"), true);
  check("the wager is the one that was on the attack",
    CHAT.includes("      kiWager: reflecting.kiWager ?? 0,"), true);
}

// --- The fourth list on the sheet ---------------------------------------------------------------------------
{
  check("Out-of-Sequence is a kind the system names",
    MANEUVER_TYPES.outOfSequence?.label, "Out-of-Sequence");
  check("and spends no Action of its own", MANEUVER_TYPES.outOfSequence?.action, null);

  check("the sheet lists them as a group of their own",
    SHEET.includes('{ key: "outOfSequence", playable: false,'), true);
  check("not played from there, and the row says where it is played from",
    SHEET.includes('"Played from the card of whatever offers it - nothing takes one from here."'),
    true);

  // The section opens and closes like the other three, keyed the same way.
  check("and it is one of the collapsible sections",
    SHEET.includes("maneuvers-${group.key}") || SHEET.includes("`maneuvers-${group.key}`"), true);
}

// --- What the entry leaves, and what the file says about it ---------------------------------------------------
{
  check("the file says which half was new",
    TRAIT.includes("Nothing here had ever split those"), true);
  // The sentence wraps in the file, so the half carrying the claim is what is looked for.
  check("and why the Profile is not charged twice",
    TRAIT.includes("paid for by whoever threw it the first time"), true);
}

console.log(failed ? `\n${failed} failing` : "\nall good");
process.exit(failed ? 1 : 0);
