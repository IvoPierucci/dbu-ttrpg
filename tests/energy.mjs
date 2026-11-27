/**
 * The Energy Profiles.
 *
 * Four of the six ask for machinery nothing had needed before: a floor under the Natural
 * Result, a roll where anything short of a Critical is a Botch, a Critical Target stated
 * by the attack rather than held to the character's own limits, and an Energy Charge that
 * sits outside the maximum. Each of those touches the roll pipeline every other attack in
 * the system goes through, which is why they are checked apart from the Profiles.
 *
 * The published text of all six is checked word for word by the profiletext harness. This
 * is about what the numbers do.
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

const { PROFILES, FOUNDATION_RULES, whyNotThisFoundation, profileListedKiCost,
        areaLabel, areaMagnitude, DEFAULT_AREA_MAGNITUDE } =
  await import(modUrl("maneuvers.mjs"));

const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
const MANEUVERS = fs.readFileSync(path.join(ROOT, "module", "maneuvers.mjs"), "utf8");
const USE = fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8");

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

const SIX = ["beam", "blast", "clearing", "concentrated", "cutting", "wave"];
const fighter = (force = 10) => ({
  name: "Goku",
  system: { attributes: { force: { score: force, mod: 4 } }, tierOfPower: 3 }
});

// --- All six are there, and they are Energy ---------------------------------------
check("six Energy Profiles", SIX.filter(id => !PROFILES[id]), []);
check("and each belongs to Energy alone",
  SIX.filter(id => JSON.stringify(PROFILES[id].foundations) !== JSON.stringify(["energy"])), []);

// The listed costs, which the Minimum Ki Point Cost is read from.
check("the listed costs, at Tier 3",
  SIX.map(id => profileListedKiCost(id, fighter())), [24, 15, 18, 30, 18, 18]);

check("and the Damage Categories",
  SIX.map(id => PROFILES[id].damageCategory),
  ["direct", "direct", "standard", "lethal", "direct", "direct"]);

// --- The Foundation's own demand ----------------------------------------------------
// "You cannot use an Energy Attack if your Force Score is below 3." The Score, not the
// Modifier - the two part company early and this one names the Score.
{
  check("Energy asks for a Force Score of 3",
    FOUNDATION_RULES.energy.minimum, { attribute: "force", score: 3 });

  check("a Force Score of 2 cannot make one",
    Boolean(whyNotThisFoundation(fighter(2), "energy", "Energy")), true);
  check("3 can", whyNotThisFoundation(fighter(3), "energy", "Energy"), null);
  check("and the refusal says what is short",
    whyNotThisFoundation(fighter(1), "energy", "Energy"),
    "An Energy Attack needs a Force Score of 3. Goku has 1.");

  // It is the Score that is read. A character can have a high Modifier from a low Score,
  // and this rule does not care about the Modifier at all.
  check("the Modifier is not what is read",
    whyNotThisFoundation(
      { name: "Goku", system: { attributes: { force: { score: 2, mod: 9 } } } },
      "energy", "Energy") !== null,
    true);

  // Physical demands nothing of the attacker - the question it asks is about where the
  // target is standing, and that one has its own answer.
  check("Physical asks nothing of the attacker",
    whyNotThisFoundation(fighter(1), "physical", "Physical"), null);

  // Magic asks the same thing of its own Attribute, and each Foundation reads its own:
  // a Force Score of 10 does nothing for a Magic Attack, and the reverse.
  const mage = (magic, force) => ({
    name: "Bulma",
    system: { attributes: { force: { score: force }, magic: { score: magic } } }
  });

  check("Magic asks for a Magic Score of 3",
    FOUNDATION_RULES.magic.minimum, { attribute: "magic", score: 3 });
  check("a Magic Score of 2 cannot make one",
    Boolean(whyNotThisFoundation(mage(2, 20), "magic", "Magic")), true);
  check("however high the Force Score is",
    whyNotThisFoundation(mage(2, 20), "magic", "Magic"),
    "A Magic Attack needs a Magic Score of 3. Bulma has 2.");
  check("and 3 can", whyNotThisFoundation(mage(3, 0), "magic", "Magic"), null);

  // The reverse: a mage with no Force cannot throw an Energy Attack.
  check("each Foundation reads its own Attribute",
    Boolean(whyNotThisFoundation(mage(20, 1), "energy", "Energy")), true);

  // "An Energy Attack" but "A Magic Attack". One Foundation hid this and the second one
  // found it - the article is the only word in the sentence that depends on the name.
  check("the article follows the name",
    [whyNotThisFoundation(mage(1, 1), "energy", "Energy").slice(0, 2),
     whyNotThisFoundation(mage(1, 1), "magic", "Magic").slice(0, 1)],
    ["An", "A"]);

  // Asked on both ways of throwing an attack, and before anything is paid.
  check("the ordinary path asks it", USE.includes("whyNotThisFoundation(actor, declared.foundation"), true);
  check("and the out-of-sequence path too",
    CHAT.includes("whyNotThisFoundation(actor, declared.foundation"), true);
  check("before the Ki is spent",
    USE.indexOf("whyNotThisFoundation") < USE.indexOf("spendManeuverCost(actor, maneuver"), true);

  // It is about the attacker, so it is asked even with nobody to aim at - unlike the
  // Melee Range, which has nothing to measure without a target.
  check("and it does not wait for a target",
    /const wrongFoundation = declared && !copiedEnergy && !favoredElement\(actor, declared\.profile\) && whyNotThisFoundation/.test(USE), true);
}

// --- A Foundation you cannot use is shut, not merely refused ------------------------------
// Refusing the attack after it is declared is correct and useless: the player has already
// picked. So a Foundation the character cannot use is shut where it is chosen.
{
  const CSS = fs.readFileSync(path.join(ROOT, "styles", "dbu-ttrpg.css"), "utf8");

  // Worked out once per dialog rather than per row - the answer is the same for every
  // Profile under a Foundation, that being what a Foundation rule is.
  check("the reasons are gathered in one place",
    (MANEUVERS.match(/function shutFoundations\(actor, foundations\)/g) ?? []).length, 1);
  check("and both Profile pickers ask for them",
    (MANEUVERS.match(/const shut = shutFoundations\(actor, foundations\);/g) ?? []).length, 3);

  // The group is drawn as a plain block, not a <details>: one that is merely closed is a
  // single click from being open, and the point is that it does not open.
  const section = /function profileSection[\s\S]*?\n\}/.exec(MANEUVERS)?.[0] ?? "";
  check("a shut Foundation is not a disclosure widget at all",
    /if \(reason\) \{[\s\S]{0,400}?<div class="dbu-profile-group dbu-profile-shut"/.test(section),
    true);
  check("and nothing under it is drawn, so nothing under it can be picked",
    /if \(!open\.length\) return profileSection\(group, "", shut\);/.test(MANEUVERS), true);
  // Which also keeps anything under it from being the row that starts selected: the
  // group returns before a single row is built. Checked inside each picker's own body
  // rather than by the first match in the file, since there are two of them.
  // The attack's picker draws a tab per Foundation now (the user's, 2026-11-15): a shut one's tab offers its Favored Elements only,
  // decided before a row is built.
  {
    const tabs = /function profileTabs\([^)]*\) \{[\s\S]*?\n\}/.exec(MANEUVERS)?.[0] ?? "";
    const pick = /async function pickProfile\([^)]*\) \{[\s\S]*?\n\}/.exec(MANEUVERS)?.[0] ?? "";
    check("pickProfile's tabs: a shut Foundation's offers its Favored Elements alone, before any row is built",
      [tabs.includes("&& (!shut[key] || favoredElement(actor, profile.id));"), pick.indexOf("const shut = shutFoundations(actor, foundations);") < pick.indexOf("profileTabsHtml(")],
      [true, true]);
  }
  for (const name of ["pickProfileOnly"]) {
    const body = new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`).exec(MANEUVERS)?.[0] ?? "";
    check(`${name} decides a group is shut before it builds a row`,
      body.indexOf("shut[group.key]") < body.indexOf("profileOption(profile"), true);
    check(`${name} builds no rows for a shut group`,
      /const open = shut\[group\.key\] \? group\.profiles\.filter\(profile => favoredElement\(actor, profile\.id\)\) : group\.profiles;\s*\n\s*if \(!open\.length\) return profileSection\(group, "", shut\)/.test(body), true);
  }

  // The reason is on the face of it. A control greyed out and saying nothing looks broken.
  check("the reason is shown, not just implied",
    section.includes("Handlebars.escapeExpression(reason)"), true);
  check("and it is styled as shut", CSS.includes(".dbu-profile-shut"), true);

  // The Foundation button on a Multi-Foundation Profile: disabled rather than missing.
  // A disabled button cannot submit, so clicking it does nothing and the dialog stays.
  check("a shut Foundation is offered greyed out rather than left off",
    /disabled: Boolean\(shut\[key\]\)/.test(MANEUVERS), true);
  // And the name and nothing else on it. A button is not a place for a sentence: with
  // the reason written into the label, two of them side by side came out as blocks of
  // wrapped text and the Foundation's name was lost in the middle. It is said one step
  // back instead, on the group these Profiles were chosen from - checked just above.
  check("saying only which Foundation it is",
    /label: foundations\[key\]\.label,/.test(MANEUVERS), true);
  check("with no sentence crammed into the button",
    MANEUVERS.includes("${foundations[key].label} - ${shut[key]}"), false);

  // Which is the same question the declaration asks later, so the two cannot disagree.
  check("it is the same rule the declaration asks",
    /const refused = whyNotThisFoundation\(actor, key, foundations\[key\]\?\.label \?\? key\);/
      .test(MANEUVERS), true);

  // With no actor there is nothing to ask, and nothing is shut - the Energy Charge
  // Maneuver's own picker can be opened without one.
  check("nothing is shut when there is nobody to ask about",
    /if \(!actor\) return shut;/.test(MANEUVERS), true);
}

// --- Beam's Charge sits outside the maximum -------------------------------------------
{
  const MAX = 7;
  // Mirrors the line in postAttack: the ordinary grant is held to the ceiling, and the
  // uncapped one is added after it.
  const charges = (profile, declared) => Math.min(
    declared + (PROFILES[profile].grantsEnergyCharge ?? 0),
    PROFILES[profile].maxEnergyCharges ?? MAX
  ) + (PROFILES[profile].grantsUncappedEnergyCharge ?? 0);

  check("Beam grants one that does not count towards the maximum",
    PROFILES.beam.grantsUncappedEnergyCharge, 1);
  check("so a full Beam holds eight", charges("beam", 7), 8);
  check("and an empty one holds one", charges("beam", 0), 1);

  // Powered's is an ordinary Charge and is held to the maximum with the rest, which is
  // the distinction this exists to keep.
  check("Powered's is an ordinary one", PROFILES.powered.grantsUncappedEnergyCharge ?? 0, 0);
  check("so a full Powered still holds seven", charges("powered", 7), 7);

  check("the uncapped one is added after the ceiling",
    /\)\s*\+ \(PROFILES\[profile\]\.grantsUncappedEnergyCharge \?\? 0\)/.test(CHAT), true);
}

// --- Clearing's floor under the Natural Result -----------------------------------------
// "The minimum Natural Result for the Strike Roll is 5 (if your Natural Result is less
// than 5, it becomes 5). This is applied after rolling and applying any increases."
{
  const natural = (rolled, adjustment, floor) => Math.max(Math.max(0, rolled + adjustment), floor);

  check("Clearing's floor is 5", PROFILES.clearing.minimumNatural, 5);
  check("a 2 becomes a 5", natural(2, 0, 5), 5);
  check("a 7 is left alone", natural(7, 0, 5), 7);

  // Last, as the rule says: after the die and after anything that moved it. An increase
  // that lands first cannot be pushed back under the floor, and a penalty that lands
  // first cannot dodge it.
  check("an increase is applied before the floor, and kept", natural(2, 4, 5), 6);
  check("and a penalty cannot take it under", natural(7, -6, 5), 5);

  check("the floor is taken last",
    /const natural = Math\.max\(adjusted, minimumNatural\);/.test(CHAT), true);
  check("and the Strike Roll is told about it",
    /minimumNatural: profileFor\(attack\)\?\.minimumNatural \?\? 0/.test(CHAT), true);

  // The Natural Result is part of the Dice Score, so raising it raises the total - the
  // same way an effect that raises the Base Die does.
  check("raising it raises the roll", /naturalShift: natural - rolled/.test(CHAT), true);

  // No other Profile has one, so nothing else is quietly floored.
  check("only Clearing has a floor",
    Object.keys(PROFILES).filter(id => PROFILES[id].minimumNatural), ["clearing"]);
}

// --- Cutting: all or nothing ---------------------------------------------------------
{
  // "If you do not score a Critical Result, then you score a Botch Result regardless of
  // the Natural Result."
  const outcome = (critical, rule) => {
    const botch = rule ? !critical : false;
    return critical ? "critical" : (botch ? "botch" : "plain");
  };

  check("a Critical is a Critical", outcome(true, true), "critical");
  check("and anything else is a Botch", outcome(false, true), "botch");
  check("which is not true of any other Profile", outcome(false, false), "plain");

  check("Cutting says so", PROFILES.cutting.botchUnlessCritical, true);
  check("only Cutting",
    Object.keys(PROFILES).filter(id => PROFILES[id].botchUnlessCritical), ["cutting"]);
  check("the roll is told",
    /botchUnlessCritical: Boolean\(profileFor\(attack\)\?\.botchUnlessCritical\)/.test(CHAT),
    true);
  check("and the card says why a good-looking roll botched",
    /noteLine\("Anything short of a Critical Result is a Botch"\)/.test(CHAT), true);

  // "On a Critical Result for the Strike Roll, increase the Damage Category by 1."
  check("a Critical Strike is worth a Damage Category",
    PROFILES.cutting.categoryUpOnCriticalStrike, 1);
  check("read off the Strike that was rolled",
    /const criticalStep = \(strike\.outcome === "critical"\)/.test(CHAT), true);
  // Summed with the rest before anything is clamped, so a Guard pulling the Category
  // down still meets it in the middle rather than being overridden.
  check("and summed with every other step",
    /\+ criticalStep\s*\n\s*\+ \(defence\.damageCategoryShift \?\? 0\)/.test(CHAT), true);

  // "On the Wound Roll, the Critical Target is 5 (ignoring the usual limit)."
  check("Cutting's Wound Critical Target is 5", PROFILES.cutting.woundCriticalTarget, 5);
  check("it reaches the Wound Roll and not the Strike",
    /criticalTarget: profileFor\(attack\)\?\.woundCriticalTarget \?\? null/.test(CHAT), true);
  // Stated rather than derived, so the floor a character's own target is held to does
  // not apply - which is what "ignoring the usual limit" means.
  check("a stated target goes in as written",
    /critical: natural >= \(criticalTarget \?\? actor\.system\.criticalTarget\)/.test(CHAT), true);
}

// --- A rerolled Base Die is still the same roll -------------------------------------------
// Karmic Chance replaces the Base Die and settles the outcome again from scratch. Read
// off the character's sheet alone, that second reading loses whatever the Profile
// brought: a Cutting Strike rerolled from 3 to 9 stopped being a Botch, which is the one
// thing Cutting says it always is short of a Critical.
{
  // What the reroll works out, mirrored from rerollBaseDie.
  const settle = (rolled, rules, sheet) => {
    const natural = Math.max(rolled, rules.minimumNatural ?? 0);
    const critical = natural >= (rules.criticalTarget ?? sheet.criticalTarget);
    const botch = rules.botchUnlessCritical
      ? !critical
      : (natural <= sheet.botchRange);
    return { natural, critical, botch };
  };

  const sheet = { criticalTarget: 10, botchRange: 1 };
  const cutting = { botchUnlessCritical: true };

  // The reported case: a 3 rerolled into a 9, which is not a Critical for this character.
  check("a Cutting Strike rerolled short of a Critical is still a Botch",
    settle(9, cutting, sheet), { natural: 9, critical: false, botch: true });
  check("and one rerolled into a Critical is a Critical",
    settle(10, cutting, sheet), { natural: 10, critical: true, botch: false });

  // Without the rule, a 9 is neither - which is what the reroll was doing to Cutting.
  check("an ordinary roll rerolled into a 9 is neither",
    settle(9, {}, sheet), { natural: 9, critical: false, botch: false });

  // Clearing's floor applies to the new die as it did to the old.
  check("a floor under the Natural Result survives the reroll",
    settle(2, { minimumNatural: 5 }, sheet).natural, 5);

  // And a Critical Target the attack states is the one the reroll measures against.
  check("a stated Critical Target survives it too",
    settle(6, { criticalTarget: 5 }, sheet).critical, true);
  check("where the character's own would have said otherwise",
    settle(6, {}, sheet).critical, false);

  // Which works because the rules travel with the roll rather than being read off the
  // sheet a second time.
  // The Botch Range travels with them now: Vile Weather gives a Combat Roll a wider one
  // than a Skill Check has, and a reroll that worked it out again would have used the
  // combat range for whatever it was rerolling.
  check("the roll carries its own rules",
    /rules: \{ minimumNatural, criticalTarget: aimed, botchUnlessCritical,/.test(CHAT), true);
  check("the Botch Range among them",
    /botchRange: botchRangeFor\(actor, true\) \}/.test(CHAT), true);
  check("and the reroll reads them",
    /const rules = side\.rules \?\? \{\};/.test(CHAT), true);
  check("the floor among them",
    /const natural = Math\.max\(fresh, rules\.minimumNatural \?\? 0\);/.test(CHAT), true);
  check("the stated Critical Target among them",
    /natural >= \(rules\.criticalTarget \?\? actor\.system\.criticalTarget \?\? 10\)/.test(CHAT),
    true);
  check("and the all-or-nothing rule among them",
    /rules\.botchUnlessCritical \? !critical/.test(CHAT), true);

  // The swap row shows what the die became, floor included - not the raw die, which is
  // not what the roll is using.
  check("the swap row shows what the die became",
    /written: `\$\{before\} \u2192 \$\{natural\}`/.test(CHAT), true);

  // The note explaining the Botch is the Base Die's doing, so it goes with the die.
  // Left standing, a roll rerolled into a Critical kept a line saying it was not one.
  check("the note goes with the die it explains",
    /fromOutcome\(noteLine\("Anything short of a Critical Result is a Botch"\)\)/.test(CHAT),
    true);
  check("and the reroll says it again when it still applies",
    /if \(rules\.botchUnlessCritical && botch\) \{[\s\S]{0,140}?noteLine\("Anything short/
      .test(CHAT), true);

  // Keeping the first roll changes nothing, so nothing the first die decided comes off.
  // Stripped anyway, the total still carried a Botch the column no longer showed.
  check("a kept die keeps its consequences", /kept: true,/.test(CHAT), true);
  check("and the caller honours that",
    /const before = again\.kept \? lines : withoutOutcome\(lines\);/.test(CHAT), true);
}

// --- Concentrated halves what is left of the Damage Reduction ---------------------------
{
  const reduction = (dr, pierced, halves) => {
    const afterPierce = Math.max(0, dr - pierced);
    return Math.max(0, afterPierce - (halves ? Math.floor(afterPierce / 2) : 0));
  };

  check("half of it is ignored", reduction(10, 0, true), 5);
  check("rounded down", reduction(9, 0, true), 5);
  check("and nothing is ignored without it", reduction(10, 0, false), 10);

  // Taken off what the piercing left, not off the whole: ignoring half of what is
  // already gone would be worth more than ignoring half of what is there.
  check("it halves what the piercing left", reduction(10, 4, true), 3);
  check("and nothing is left to halve once pierced through", reduction(10, 10, true), 0);

  check("Concentrated says so", PROFILES.concentrated.ignoresHalfDamageReduction, true);
  check("only Concentrated",
    Object.keys(PROFILES).filter(id => PROFILES[id].ignoresHalfDamageReduction),
    ["concentrated"]);
  check("the Wound step halves it",
    /const halved = \(profileFor\(attack\)\?\.ignoresHalfDamageReduction/.test(CHAT), true);
  check("after the piercing", CHAT.indexOf("const afterPierce") < CHAT.indexOf("const halved"), true);
}

// --- The Areas ----------------------------------------------------------------------------
{
  check("Blast is a Cone", PROFILES.blast.area, { shape: "cone" });
  check("Concentrated is a Line", PROFILES.concentrated.area, { shape: "line" });
  check("Clearing is a Sphere on a Square",
    PROFILES.clearing.area, { shape: "sphere", centredOnSquare: true });
  check("and Wave a Line on one",
    PROFILES.wave.area, { shape: "line", centredOnSquare: true });

  // Four of them name no Magnitude in the published text, and none is written into the
  // data either - the rule supplies it instead: "if an AoE does not have its Magnitude
  // declared, it is Standard by default."
  const unnamed = ["blast", "clearing", "concentrated", "wave"];
  check("no Magnitude is guessed at", unnamed.filter(id => PROFILES[id].area.magnitude), []);
  check("and each reads as Standard",
    unnamed.map(id => areaMagnitude(PROFILES[id].area)),
    unnamed.map(() => DEFAULT_AREA_MAGNITUDE));

  // Which is what a reader actually sees. It used to come out as "Undefined Cone".
  check("so the names read properly",
    unnamed.map(id => areaLabel(PROFILES[id].area)),
    ["Standard Cone", "Standard Sphere", "Standard Line", "Standard Line"]);

  // A stated Magnitude is still its own: the default fills a gap, it does not override.
  check("a stated Magnitude is left alone",
    [areaLabel(PROFILES.sweeping.area), areaLabel(PROFILES.soaring.area)],
    ["Minor Sphere (centred on you)", "Standard Line"]);

  // And Concentrated's cap sits exactly where the default puts it, which is the point of
  // the cap: it is there to stop something else raising it, not to lower anything.
  check("Concentrated's cap is where its Area already is",
    PROFILES.concentrated.areaLocked.magnitude, DEFAULT_AREA_MAGNITUDE);

  // Concentrated's cap is carried rather than enforced: nothing in the system changes an
  // attack's Area yet, so there is nothing here to refuse.
  check("Concentrated's cap on its own Area is written down",
    PROFILES.concentrated.areaLocked, { magnitude: "standard" });

  // Beam and Cutting have none at all.
  check("Beam and Cutting have no Area",
    ["beam", "cutting"].filter(id => PROFILES[id].area), []);
}

// --- What is left to the table --------------------------------------------------------------
// Which cardinal direction a Wave points, and who any Area covers, are the table's - but
// that is true of every Area here and the tip already says it for all of them through the
// Area itself. `needs` is for machinery the system lacks, and none of these lack any.
check("no Energy Profile is waiting on machinery",
  SIX.filter(id => PROFILES[id].needs), []);
check("and the ones with an Area get the table's note through it",
  ["blast", "clearing", "concentrated", "wave"].filter(id => !PROFILES[id].area), []);

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
