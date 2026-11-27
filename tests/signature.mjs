/**
 * The Advantages a Signature Technique is built out of, starting with Charging Assault.
 *
 * The point of the arrangement is that a feature is the same feature however it was
 * reached: the Blitz Profile grants Charging Assault for free, a Technique can buy it
 * for 10 TP, and neither route knows about the other. What they share is the number the
 * charge covered. So what is checked here is the arithmetic on that number, and that
 * the two bonuses it feeds stay apart.
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

const TRAITS = path.join(ROOT, "traits");
globalThis.foundry.utils.fetchJsonWithTimeout = async () =>
  JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));
globalThis.fetch = async url => {
  const file = path.join(TRAITS, String(url).replace("systems/dbu-ttrpg/traits/", ""));
  if (!fs.existsSync(file)) return { ok: false, status: 404, statusText: "missing" };
  return { ok: true, text: async () => fs.readFileSync(file, "utf8") };
};

const { loadTraits } = await import(modUrl("effects/traits.mjs"));
await loadTraits();
const { programsFor } = await import(modUrl("effects/registry.mjs"));
const { applyPassives, collectReactive, applySlot } = await import(modUrl("effects/interpreter.mjs"));
const { reactiveFor } = await import(modUrl("effects/registry.mjs"));

const { getSignatureFeature, traitsOfKind, SIGNATURE_SIDES } =
  await import(modUrl("effects/traits.mjs"));
const { featureAsks, featureSummary, advantageWoundParts, CHARGING_FREE_SQUARES, pushes,
        featureRanks } = await import(modUrl("signature.mjs"));

const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
const TRAIT_FILE = fs.readFileSync(
  path.join(ROOT, "traits", "signature", "advantages", "power-shot.dbu"), "utf8");
const { PROFILES } = await import(modUrl("maneuvers.mjs"));

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

// --- The file is found, and found as what it is -----------------------------
check("Charging Assault loads as a Signature Technique feature",
  Boolean(getSignatureFeature("charging-assault")), true);
check("on the Advantages side", getSignatureFeature("charging-assault").owner, "advantages");
check("and not on the other", getSignatureFeature("charging-assault", "disadvantages"), undefined);

check("the two sides are the two folders", SIGNATURE_SIDES, ["advantages", "disadvantages"]);

// A feature is not a Trait a character holds, and asking for one by the wrong door
// must not hand back something that happens to share a name.
check("a Combat Condition is not a Signature feature",
  getSignatureFeature("blinded"), undefined);

const summary = featureSummary("charging-assault");
check("it costs what the rulebook says", summary.tpCost, 10);
check("and states its requirement", summary.requirement, "N/A");
check("and carries its rules text", summary.text.includes("Boosted Speed"), true);
check("a feature nobody has written is nothing", featureSummary("nonesuch"), null);

// --- What it asks for -------------------------------------------------------
// One number, at Attack Declaration. Everything else the rule says - the straight
// line, the Melee Range it ends in, the Boosted Speed ceiling, the High Environment
// ranks - is the map's business and is not asked about at all.
check("it asks for the Squares charged",
  featureAsks(["charging-assault"]).map(a => a.field), ["squaresCharged"]);
check("and an attack carrying nothing is asked nothing", featureAsks([]), []);
check("as is one carrying a feature that wants no number",
  featureAsks(["some-other-advantage"]), []);

// --- The Wound bonus --------------------------------------------------------
// "+1 for each Square you moved after the third. This bonus cannot exceed 2(T)."
const charged = (squares, tier = 1) => advantageWoundParts(
  { system: { tierOfPower: tier } },
  { advantages: ["charging-assault"], squaresCharged: squares }
).reduce((sum, part) => sum + part.value, 0);

check("the first three Squares are worth nothing", [charged(1), charged(2), charged(3)], [0, 0, 0]);
check("the fourth is worth one", charged(4), 1);
check("and the fifth two", charged(5), 2);
check("but the cap is 2(T), so at Tier 1 it stops there", charged(9), 2);
check("and at Tier 3 it stops at six", charged(20, 3), 6);
check("standing still is worth nothing", charged(0), 0);

check("the free Squares are the three the rule names", CHARGING_FREE_SQUARES, 3);

// An attack that never had the Advantage gets nothing however far it moved.
check("no Advantage, no bonus",
  advantageWoundParts({ system: { tierOfPower: 3 } },
    { advantages: [], squaresCharged: 10 }), []);

// --- Blitz names it rather than restating it --------------------------------
check("Blitz grants the Advantage by id", PROFILES.blitz.grantsAdvantage, "charging-assault");
check("and that id is a feature that exists",
  Boolean(getSignatureFeature(PROFILES.blitz.grantsAdvantage, "advantages")), true);

// Blitz's own bonus is Blitz's, and is not in the Advantage's arithmetic - a Technique
// that bought Charging Assault for 10 TP gets the Squares bonus and nothing else.
check("the Advantage does not carry Blitz's half-Agility bonus",
  advantageWoundParts(
    { system: { tierOfPower: 3, attributes: { agility: { mod: 8 } }, speed: { normal: 4 } } },
    { advantages: ["charging-assault"], squaresCharged: 10, profile: "simple" }
  ).map(p => p.label),
  ["Charging Assault"]);

// --- Power Shot, the first feature that is had more than once ---------------------
{
  // "Increase your Wound Rolls for this Signature Technique by 2(T) for each rank of
  // this Advantage." A ranked feature is in the list once per rank, so the rank is the
  // count - which leaves `includes` answering "does it have it" for everything that
  // only wants that, and adds nothing to a feature with no ranks.
  check("no ranks is no count", featureRanks([], "power-shot"), 0);
  check("one entry is one rank", featureRanks(["power-shot"], "power-shot"), 1);
  check("and three entries are three",
    featureRanks(["power-shot", "knockback", "power-shot", "power-shot"], "power-shot"), 3);
  check("somebody else's entries are not counted",
    featureRanks(["knockback", "full-wager"], "power-shot"), 0);
  check("and a missing list is nothing rather than a throw",
    featureRanks(undefined, "power-shot"), 0);

  // Anything that only asks whether the attack has it goes on working.
  check("having it once is still having it",
    ["power-shot"].includes("power-shot"), true);

  const attacker = { system: { tierOfPower: 3, attributes: { agility: { mod: 8 } },
                               speed: { normal: 4 } } };
  const worth = ranks => advantageWoundParts(attacker,
    { advantages: Array(ranks).fill("power-shot"), profile: "simple" });

  check("one rank is 2(T) on the Wound Roll",
    worth(1).map(p => [p.label, p.written, p.value]), [["Power Shot 1", "+2(T)", 6]]);
  check("two are 4(T)",
    worth(2).map(p => [p.label, p.written, p.value]), [["Power Shot 2", "+4(T)", 12]]);
  check("three are 6(T)",
    worth(3).map(p => [p.label, p.written, p.value]), [["Power Shot 3", "+6(T)", 18]]);

  // Three prices are listed and no fourth, so three is where the ranks stop.
  check("the entry prices three ranks", getSignatureFeature("power-shot").ranks, 3);
  check("and a fourth is worth nothing more",
    worth(4).map(p => p.value), worth(3).map(p => p.value));

  check("with none of it on an attack that has none", worth(0), []);

  // It sits beside the other features rather than instead of them.
  check("and it adds to what the others add",
    advantageWoundParts(attacker, {
      advantages: ["charging-assault", "power-shot", "power-shot"],
      squaresCharged: 5, profile: "simple"
    }).map(p => p.label),
    ["Charging Assault", "Power Shot 2"]);

  // The entry as printed, and the two things in it this system cannot check.
  const entry = getSignatureFeature("power-shot");
  check("the entry is there whole", [
    entry.text.includes("Power Shot: Your signature technique has more power."),
    entry.text.includes("4 (First Rank), 6 (Second Rank), 8 (Third Rank)"),
    entry.text.includes("by 2(T) for each rank of this Advantage.")
  ], [true, true, true]);
  check("the Requirement is carried as written",
    entry.requirement.includes("does not have the Low Penetration Disadvantage"), true);
  check("and the file says there is no such Disadvantage to check it against",
    TRAIT_FILE.includes("no Low Penetration Disadvantage in this system"), true);
}

// --- The two rolls that have been waiting for a rank count ------------------------
{
  // Both are the same sentence in different Tiers. The Parry option of the Defend
  // Maneuver: "reduce your Dice Score by 1(bT) for each Energy Charge or rank of Power
  // Shot on the Attacking Maneuver". The Intervene Maneuver's Deflects say the same in
  // (T). Until Power Shot existed the Parry counted only the Charges and the Deflect
  // read a field nothing had ever written.
  // To the closing brace at column nought, not to the first blank line: both of these
  // have a blank line inside them, and slicing at one cuts the function in half.
  const run = (name, actor, attack) => {
    const from = CHAT.indexOf(`function ${name}(`);
    const to = CHAT.indexOf("\n}", from) + 2;
    return new Function("actor", "attack",
      `${CHAT.slice(from, to)}\nreturn ${name}(actor, attack);`)(actor, attack);
  };

  const parrier = { system: { baseTierOfPower: 2, tierOfPower: 5 } };

  check("a Parry against a plain attack loses nothing",
    run("chargePenalty", parrier, { energyCharges: 0, powerShotRanks: 0 }), []);
  check("three Energy Charges cost a Parry 3(bT)",
    run("chargePenalty", parrier, { energyCharges: 3, powerShotRanks: 0 })
      .map(p => [p.label, p.written, p.value]),
    [["Energy Charges", "-3(bT)", -6]]);
  check("two ranks of Power Shot cost it 2(bT) on their own",
    run("chargePenalty", parrier, { energyCharges: 0, powerShotRanks: 2 })
      .map(p => [p.label, p.written, p.value]),
    [["Charges and Power Shot", "-2(bT)", -4]]);
  check("and both are one count, as the sentence reads",
    run("chargePenalty", parrier, { energyCharges: 3, powerShotRanks: 2 })
      .map(p => [p.label, p.written, p.value]),
    [["Charges and Power Shot", "-5(bT)", -10]]);

  // The same sentence, in (T) rather than (bT) - which is what the Intervene entry says.
  check("a Deflect counts the same things in Tiers of Power",
    run("deflectPenalty", parrier, { energyCharges: 3, powerShotRanks: 2 })
      .map(p => [p.label, p.written, p.value]),
    [["Charges and Power Shot", "-5(T)", -25]]);

  // And the attack carries the count for them to read.
  check("the attack carries the rank count",
    CHAT.includes('Math.min(featureRanks(advantages, "power-shot"), POWER_SHOT_MAX_RANKS)'),
    true);
  check("and a reflected attack hands it across",
    CHAT.includes("powerShotRanks: attack.powerShotRanks ?? 0,"), true);
}

// --- Both lists load --------------------------------------------------------
check("the Advantages are in the list",
  ["charging-assault", "full-wager", "knockback", "power-shot", "staggering-attack"]
    .every(id => traitsOfKind("signature", "advantages").some(t => t.id === id)), true);
// A Disadvantage is worth negative TP, which is what makes it one: you take it to pay
// for something else.
check("and the Disadvantages are too",
  traitsOfKind("signature", "disadvantages").some(t => t.id === "all-or-nothing"), true);
check("with a negative cost, which is what makes it a Disadvantage",
  traitsOfKind("signature", "disadvantages").every(t => t.tpCost < 0), true);

// --- Knockback ---------------------------------------------------------------
// "If you successfully Damage an Opponent with this Signature Technique, after the
// Wound Roll, you may make a Might Clash. If you win, move the target a number of
// Squares in a straight line away from you in any direction up to your Might."
{
  const knockback = featureSummary("knockback");
  check("Knockback loads as an Advantage", knockback.side, "advantages");
  check("at its 4 TP", knockback.tpCost, 4);
  check("and says it is a Might Clash", knockback.text.includes("Might Clash"), true);
}

// It asks for no number at declaration: what it needs is a Clash, opened afterwards,
// and then a movement made on the map.
check("Knockback asks nothing up front", featureAsks(["knockback"]), []);

// An attack carrying it earns the buttons that follow the Wound Roll; one that does
// not, does not.
check("Knockback is what pushes", pushes({ advantages: ["knockback"] }), true);
check("Charging Assault moves you, not them",
  pushes({ advantages: ["charging-assault"] }), false);
check("and an attack carrying nothing pushes nobody", pushes({}), false);

// --- Launching meets it ------------------------------------------------------
// The Profile grants the Advantage and doubles what the movement costs. The Advantage
// does not know Launching exists, which is the point of the arrangement.
check("Launching grants Knockback by id", PROFILES.launching.grantsAdvantage, "knockback");
check("and that id is a feature that exists",
  Boolean(getSignatureFeature(PROFILES.launching.grantsAdvantage, "advantages")), true);
check("Launching is what doubles the Collision Damage, not Knockback",
  [PROFILES.launching.doublesCollisionDamage,
   featureSummary("knockback").text.includes("Launching")],
  [true, false]);

// --- What the buttons and the reduction do -----------------------------------
{
  const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");

  // Knockback is not a button at all any more. "If you successfully Damage an
  // Opponent" is answered when the Damage is actually taken off, so the card is
  // posted there - it is a Clash between two characters, with two sides to roll
  // and a consequence of its own, and it belongs on a card of its own.
  check("the Clash is opened after the Damage is taken off",
    CHAT.indexOf(`"system.life.value": floor`) < CHAT.indexOf("openKnockback(attack"), true);
  check("and only when Damage was actually dealt",
    CHAT.includes("(damage > 0)") && CHAT.includes("pushes(attack)"), true);
  // An Environment can hand the Advantage out too now - Local Space and Deep Space give it
  // to every Attacking Maneuver - so the Clash opens for either reason and for no other.
  check("and for an attack that brought its own or an Environment that hands it out",
    CHAT.includes("if (foe && (broughtItsOwn || here)) {"), true);
  // Not for an Absolute Attack, whose Damage "does not count as dealing damage to that
  // Character with an Attacking Maneuver for any effects that would trigger as a result"
  // - and Knockback is one of them.
  check("and not for Damage an Absolute Attack dealt without hitting",
    CHAT.includes("if ((damage > 0) && !isAbsoluteMiss(own)) {"), true);
  check("the attack card offers no Knockback button",
    /textContent = "Knockback"/.test(CHAT), false);
  check("nor a collision one",
    (CHAT.match(/textContent = "Apply collision damage"/g) ?? []).length, 1);

  // A Life Point reduction is not Damage: it consults neither Soak nor Damage
  // Reduction, which is the whole distinction and the reason it is its own function.
  check("the reduction goes straight to Life",
    /export async function reduceLifePoints/.test(CHAT), true);
  check("and consults no Soak Value on the way",
    /reduceLifePoints[\s\S]{0,700}soakValue/.test(CHAT), false);
  check("nor Damage Reduction",
    /reduceLifePoints[\s\S]{0,700}damageReduction/.test(CHAT), false);
  check("but still honours the one exception to the floor",
    /reduceLifePoints[\s\S]{0,700}life\.allowNegative/.test(CHAT), true);

  // A Clash is one category on both sides. Might is now one of them, and it does not
  // borrow the Skill's flat critical die.
  const MIGHT = CHAT.slice(CHAT.indexOf("  might: {\n    label: \"Might Clash\","),
    CHAT.indexOf("\n  },", CHAT.indexOf("  might: {\n    label: \"Might Clash\",")));
  check("a Might Clash rolls Might on both sides",
    MIGHT.includes('{ label: "Might", value: actor.system.might }'), true);
  check("unless the card names what stands in for it",
    MIGHT.includes("const own = clash?.mightFor?.[uuid];"), true);
  check("and takes its own critical die, not a Skill's",
    MIGHT.includes("criticalDice: (actor) => actor.system.dice.critical.formula"), true);
}

// --- The Collision Damage doubling is arithmetic -----------------------------
const collision = (typed, doubled) => doubled ? typed * 2 : typed;
check("an ordinary collision is taken as given", collision(7, false), 7);
check("Launching doubles it", collision(7, true), 14);
check("and nothing doubles to nothing", collision(0, true), 0);

// --- Winning the Clash is what buys the collision -------------------------------
// "If you win, move the target." The movement is what causes the collision, so there
// is no collision without the win - and the button that asks for it lives on the Clash
// that decided it, not on the attack that opened the Clash.
{
  const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");

  // The same test the card runs. A tie goes to the defender, as everywhere else: the
  // challenger has to beat them.
  const won = result => result.challenger.succeeded
    || (!result.defender.succeeded && (result.challenger.total > result.defender.total));

  const side = (total, succeeded = false) => ({ total, succeeded });

  check("beating them wins it", won({ challenger: side(14), defender: side(9) }), true);
  check("a tie does not", won({ challenger: side(9), defender: side(9) }), false);
  check("and losing does not", won({ challenger: side(4), defender: side(9) }), false);
  check("a Karmic Save wins it whatever the numbers said",
    won({ challenger: side(2, true), defender: side(20) }), true);
  check("and the defender's Karmic Save takes it away",
    won({ challenger: side(20), defender: side(2, true) }), false);

  // Asked in one place rather than written out wherever it matters: saying who won,
  // offering the collision to them, and settling a Grapple were three copies of it.
  check("the card decides it the same way",
    CHAT.includes('const wonIt = whoWonClash(result) === "challenger";'), true);
  check("and that is the one answer to the question",
    CHAT.includes("function whoWonClash({ challenger, defender })"), true);

  // Offered on the Clash, to its winner, once.
  check("the collision is offered on the Clash and not the attack",
    /clash\.collision && wonIt && !clash\.collisionApplied && challenger\?\.isOwner/.test(CHAT), true);
  check("and taking it closes the offer",
    /collisionApplied: true/.test(CHAT), true);

  // Asked of the loser of that Clash, which is who was thrown.
  check("it is taken off whoever lost the Clash",
    /applyCollisionDamage\(message, clash\)[^]{0,400}fromUuidSync\(clash\.defenderUuid\)/
      .test(CHAT.slice(CHAT.indexOf("async function applyCollisionDamage")) + CHAT), true);
}

// --- One number per character, not one per Maneuver ----------------------------
// "Collision damage varies between characters, so do not assume every target that lost
// its Might Clash takes the same." Each Clash is asked its own number and marks itself
// paid, so two characters thrown by one Maneuver are two questions.
{
  const clashes = [
    { defenderUuid: "a", collision: { doubles: false }, collisionApplied: false },
    { defenderUuid: "b", collision: { doubles: false }, collisionApplied: false }
  ];

  // Paying one leaves the other still to ask.
  const paid = { ...clashes[0], collisionApplied: true };
  check("paying one character's collision does not pay the other's",
    [paid.collisionApplied, clashes[1].collisionApplied], [true, false]);
  check("and they are different characters",
    paid.defenderUuid === clashes[1].defenderUuid, false);
}

// Launching's doubling travels on the Clash, so the Advantage still does not know
// which Profile threw them.
{
  const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
  check("the doubling is settled when the Clash is opened",
    /doubles: Boolean\(profileFor\(attack\)\?\.doublesCollisionDamage\)/.test(CHAT), true);
  // Read off the Clash and handed to the window that asks what they hit - which is the
  // one place the doubling is applied, and is shared with the Battlefields button that
  // has no Clash behind it at all.
  check("and read off the Clash when the window is opened",
    /doubled: Boolean\(clash\.collision\?\.doubles\),/.test(CHAT), true);
}

// --- A granted feature, and the ranks already bought -------------------------
{
  const { withGranted, emptiesCapacity } = await import(modUrl("signature.mjs"));
  const three = ["power-shot", "power-shot", "power-shot"];
  check("three ranks of Power Shot stay three when a Profile grants something else",
    featureRanks(withGranted(three, "knockback"), "power-shot"), 3);
  check("and the grant is added", withGranted(three, "knockback").includes("knockback"), true);
  check("a grant the Technique already bought is not a second copy",
    withGranted(["charging-assault"], "charging-assault"), ["charging-assault"]);
  check("no grant leaves the list as it was", withGranted(three, undefined), three);
  const MANEUVERS = fs.readFileSync(path.join(ROOT, "module", "maneuvers.mjs"), "utf8");
  check("declareAttack merges through withGranted, not a Set",
    MANEUVERS.includes("    withGranted(withGranted(maneuver.advantages, PROFILES[profile]?.grantsAdvantage),")
      && !MANEUVERS.includes("const advantages = [...new Set(["), true);

  check("All or Nothing empties Capacity", emptiesCapacity(["all-or-nothing"]), true);
  check("and nothing else does", emptiesCapacity(["full-wager", "power-shot"]), false);
  const USE = fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8");
  const at = USE.indexOf("emptiesCapacity(declared.advantages)");
  check("the use flow spends the rest of the Capacity after the card",
    at > USE.indexOf("await recordManeuverType(actor, maneuver.type, { messageId: card?.id });")
      && USE.indexOf('"system.capacity.spent": actor.system.capacity.max', at) > at, true);
}

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
