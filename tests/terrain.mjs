/**
 * Battle Terrain: Cover, and throwing an Attacking Maneuver at a Feature.
 *
 * Three things worth running.
 *
 * Cover's two halves land in two different places and for a reason. The Dodge bonus is a
 * passive, because it stands while the toggle is on; the Damage reduction is an automatic
 * block on `before-wound`, because that is the moment the Damage it reduces exists - and
 * because it must not be Damage Reduction, which a Profile can pierce or halve. A wall is
 * not your toughness.
 *
 * The toggle gathers the Trait rather than being read inside it, which is how a Combat
 * Condition works: being gathered is what "you have this" means here.
 *
 * And a Feature attack, whose whole card is one number - the Strike and the Wound are both
 * settled by the entry before either would be rolled.
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

const { loadTraits, getTrait } = await import(modUrl("effects/traits.mjs"));
const { reactiveFor } = await import(modUrl("effects/registry.mjs"));
const { collectReactive, applySlot } = await import(modUrl("effects/interpreter.mjs"));
const { default: DBUCharacterData } = await import(modUrl("data/actor-character.mjs"));
await loadTraits();

const COVER = fs.readFileSync(path.join(TRAITS, "battlefields", "cover.dbu"), "utf8");
const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
const USE = fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8");
const SHEET = fs.readFileSync(
  path.join(ROOT, "module", "sheets", "actor-character-sheet.mjs"), "utf8");
const TAB = fs.readFileSync(
  path.join(ROOT, "templates", "parts", "actor-battlefields.hbs"), "utf8");

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

class ActorStub extends DataModel { static defineSchema() { return {}; } }

function progressionTo(powerLevel) {
  const rows = [{ lvl: 1, choice: "Skill Improvement", locked: true, attributes: {},
                  skillRanks: ["perception", "perception"] }];
  for (let lvl = 2; lvl <= powerLevel; lvl++) {
    rows.push({ lvl, choice: "Attribute Addition", locked: false,
      attributes: { insight: 1, agility: 1 }, skillRanks: [] });
  }
  return rows;
}

/**
 * A character, with Cover set however the caller wants it.
 *
 * Their Tier of Power is pushed above their Base Tier on purpose. With the two equal,
 * `2(T)` and `2(bT)` are the same number and a check on either passes whichever the file
 * says - which is exactly how a sabotage swapping one for the other went unnoticed.
 */
function behind({ active = false, rank = 0, powerLevel = 10 } = {}) {
  const parent = new ActorStub({}, { strict: false });
  parent.items = [];
  const model = new DBUCharacterData(
    { powerLevel, progression: progressionTo(powerLevel),
      // Debug's ToP Mod is gone (the user's): a Custom Buff's ToP (Breakthrough) pushes it instead.
      customBuffs: [{ id: "top", name: "ToP", group: "", active: true, effect: "tierOfPower", flat: 2, perBase: 0, perTier: 0 }],
      battlefield: { lightLevel: 0, cover: { active, rank } } },
    { parent, strict: false });
  parent.system = model;
  model.prepareBaseData?.();
  model.prepareDerivedData();
  return model;
}

// --- The file, and what gathers it ----------------------------------------------------------
{
  const cover = getTrait("cover");
  check("Cover is a Battlefield Trait", cover?.kind, "battlefields");
  check("with no Light Level, being no Light Level",
    cover.lightLevel === undefined, true);

  // The toggle is the gate, and it is the only gate: the script has no test of its own.
  check("nothing in the script asks whether it applies",
    /battlefield\.cover\.active/.test(cover.script), false);
  check("and the registry asks instead",
    fs.readFileSync(path.join(ROOT, "module", "effects", "registry.mjs"), "utf8")
      .includes("  if (!actor.system?.battlefield?.cover?.active) return [];"), true);
  check("which the file says is on purpose",
    COVER.includes("The toggle is what decides whether this file runs at all."), true);

  // Two blocks, and they are two for a reason.
  check("a passive for the Dodge", cover.script.includes("[passive]\ndodge += 2(T);"), true);
  check("and an automatic one for the Damage",
    cover.script.includes("[automatic/before-wound]\nincoming.damage -= 2 * battlefield.cover.hardness;"),
    true);
  check("which is the moment Broken answers too",
    fs.readFileSync(path.join(TRAITS, "conditions", "broken.dbu"), "utf8")
      .includes("[automatic/before-wound]"), true);

  // Not Damage Reduction, which is the distinction that matters.
  check("it never touches Damage Reduction",
    /damageReduction/.test(cover.script), false);
  check("and the file says why",
    COVER.includes("a wall taking the hit instead of you"), true);
}

// --- The Dodge bonus, run -------------------------------------------------------------------
{
  const open = behind({ active: false });
  const covered = behind({ active: true });

  check("standing in the open changes nothing",
    open.combat.dodge, behind({ active: false, hardness: 9 }).combat.dodge);
  check("and behind something is 2(T) better",
    covered.combat.dodge - open.combat.dodge, 2 * open.tierOfPower);
  // Which needs the two to differ, or the check cannot tell them apart. Asserted rather
  // than assumed: a character whose Tier of Power happens to equal their Base Tier makes
  // the line below true whatever the file says.
  check("this character's two Tiers differ",
    open.tierOfPower !== open.baseTierOfPower, true);
  check("so it is the Tier of Power and not the Base Tier",
    covered.combat.dodge - open.combat.dodge !== 2 * open.baseTierOfPower, true);

  // It is the Dodge Roll, not the Defense Value - the two are different numbers and only
  // one of them is what the entry names.
  check("the Defense Value is untouched", covered.defenseValue, open.defenseValue);
  check("and nothing else moved",
    [covered.combat.strike, covered.awareness, covered.soakValue],
    [open.combat.strike, open.awareness, open.soakValue]);

  // The hardness has nothing to do with the Dodge.
  check("a harder Feature dodges no better",
    behind({ active: true, rank: 5 }).combat.dodge, covered.combat.dodge);
}

// --- The Value is worked out, not stored ---------------------------------------------------------
{
  // "The Hardness Value is twice the Hardness Rank multiplied by the base Tier of Power."
  // Which is why the Rank is what is kept: the Value is not a property of the Feature, and
  // a stored one would stop matching the wall the moment the character's base Tier moved.
  const at = (rank, powerLevel) => {
    const model = behind({ active: true, rank, powerLevel });
    return [model.baseTierOfPower, model.battlefield.cover.hardness];
  };

  // Two characters, the same wall, two Values.
  const [lowTier, lowValue] = at(3, 1);
  const [highTier, highValue] = at(3, 30);
  check("a Rank 3 wall against the lowest base Tier", [lowTier, lowValue], [1, 6]);
  check("and against the highest", [highTier, highValue], [7, 42]);
  check("which are not the same number", lowValue === highValue, false);

  // Rank 0 is 1(bT) rather than nothing, here as in the collision window.
  check("Rank 0 is worth something", at(0, 10)[1] > 0, true);
  check("and it is one a base Tier", at(0, 10)[1], at(0, 10)[0]);

  // Nothing is stored for it. A `hardness` in the schema would be a second answer to a
  // question that already has one, and the two would drift.
  check("only the Rank is a field",
    Object.keys(DBUCharacterData.defineSchema().battlefield.fields.cover.fields).sort(),
    ["active", "rank"]);
  check("and the Rank cannot be one that does not exist",
    [behind({ active: true, rank: 9 }).battlefield.cover.rank,
     behind({ active: true, rank: -2 }).battlefield.cover.rank], [5, 0]);
}

// --- The Damage reduction, run ----------------------------------------------------------------
{
  // `before-wound` is a Moment, so what Cover brings is collected rather than derived.
  // Gathered the way the attack gathers it, and applied the way `damageTaken` applies it.
  const damageTaken = new Function("applySlot",
    `${source(CHAT, "damageTaken")}\nreturn damageTaken;`)(applySlot);

  // Through `reactiveFor`, which is what the attack itself calls - it marks each block up
  // with whether it is armed and whether it has uses left, and `collectReactive` skips
  // anything that is not available. Asking `programsFor` directly gathered entries with
  // neither, so nothing was collected and the first version of this passed by measuring
  // an empty bag.
  const bagFor = (model) =>
    collectReactive(reactiveFor(model.parent), "before-wound", { data: model, errors: [] })
      .slots;

  // Rank 2 at this character's base Tier of Power, whatever that comes to - read off the
  // model rather than written here, so this is the rule and not a copy of the sum.
  const open = behind({ active: false, rank: 2 });
  const covered = behind({ active: true, rank: 2 });
  const value = covered.battlefield.cover.hardness;
  check("the wall they are behind has a Value at all", value > 0, true);

  check("in the open nothing answers before the Wound",
    bagFor(open)["incoming.damage"] ?? null, null);
  check("and behind a Feature something does",
    Boolean(bagFor(covered)["incoming.damage"]), true);

  // "Twice the Hardness Value."
  check("twice the Hardness Value comes off",
    damageTaken(100, bagFor(covered)), 100 - (2 * value));

  const katchin = behind({ active: true, rank: 5 });
  check("a harder Feature takes more off",
    damageTaken(100, bagFor(katchin)),
    100 - (2 * katchin.battlefield.cover.hardness));
  check("which is more than the softer one took",
    katchin.battlefield.cover.hardness > value, true);

  // Rank 0 is the lowest there is and is still worth something - so the only way Cover
  // takes nothing off is Cover being off.
  check("and no Cover takes nothing off",
    damageTaken(100, bagFor(behind({ active: false, rank: 5 }))), 100);

  // Damage never goes below nothing, and no Damage is still no Damage.
  check("it cannot take Damage below nothing",
    damageTaken(5, bagFor(katchin)), 0);
  check("and an attack that did nothing still does nothing",
    damageTaken(0, bagFor(covered)), 0);
}

// --- Throwing one at a Feature ------------------------------------------------------------------
{
  // "You always automatically hit a Feature and only inflict Damage equal to your Tier of
  // Power." So the card is one number and neither roll is made.
  const postFeatureAttack = new Function(
    "ChatMessage", "Handlebars", "PROFILES", "SCOPE", "RESPONDABLE_FLAG", "isRespondable",
    `${source(CHAT, "postFeatureAttack")}\nreturn postFeatureAttack;`);

  let card = null;
  const post = (tier, charges, profile = "simple") => postFeatureAttack(
    { create: async (data) => { card = data; return { id: "c1" }; },
      getSpeaker: () => ({}) },
    { escapeExpression: String },
    { simple: { label: "Simple" } },
    "dbu-ttrpg", "respondable", () => true)(
      { name: "Tizi", system: { tierOfPower: tier } },
      { name: "Basic Attack", kiCost: 0, type: "standard" },
      { profile }, charges);

  const totalOf = () => Number(card.content.match(/dbu-check-total">(\d+)</)[1]);

  await post(4, 0);
  check("the Damage is the Tier of Power", totalOf(), 4);
  check("and the card says the hit was automatic",
    card.content.includes("Automatic hit"), true);

  // "For every 2 Energy Charges, treat your Tier of Power as if it was 1 higher."
  await post(4, 2);
  check("two Energy Charges are worth one Tier", totalOf(), 5);
  await post(4, 1);
  check("one on its own is worth nothing", totalOf(), 4);
  await post(4, 7);
  check("and seven are worth three", totalOf(), 7);
  await post(4, 0);
  check("with no charges the card says nothing about them",
    card.content.includes("Energy Charges"), false);
  await post(4, 2);
  check("and with some it says how many",
    card.content.includes("+1 from 2 Energy Charges"), true);

  // A Tier of Power of nothing is still a Tier of one.
  await post(0, 0);
  check("the Tier is never less than one", totalOf(), 1);

  // Nothing is written to anybody: a Feature's Life Points are the table's.
  check("no Damage is applied to a character",
    source(CHAT, "postFeatureAttack").includes("requestActorUpdate"), false);
  check("which the card says outright",
    card.content.includes("nothing here holds a Feature"), true);
}

// --- The door it goes through ---------------------------------------------------------------------
{
  // One door, so a Maneuver thrown at a wall is bound by everything one thrown at somebody
  // is bound by - the Actions, the Ki, the limit, the Instant rule.
  check("the same door takes both",
    USE.includes("async function useManeuverOnce(actor, maneuver, { atFeature = false, techniqueId = \"\", via = \"\","),
    true);
  check("with the target refusal stepped aside",
    USE.includes("  if (maneuver.requiresTarget && !atFeature) {"), true);
  check("and the card swapped at the end",
    USE.includes("    : (atFeature && declared)\n    ? await postFeatureAttack("), true);
  check("after everything has been paid for",
    USE.indexOf("await payActions(actor, maneuver, actionsSpent);")
      < USE.indexOf("(atFeature && declared)"), true);

  // Offered for every Attacking Maneuver the character owns, which is what the entry says.
  check("the sheet offers the Attacking ones",
    SHEET.includes("      .filter(maneuver => maneuver.attacking)"), true);
  check("through the door the sheet already uses",
    SHEET.includes("useOwnedManeuver(this.actor, target.dataset.itemId, { atFeature: true })"),
    true);
  check("and the button is on the tab",
    TAB.includes('data-action="attackFeature"'), true);
}

// --- Collisions with a Feature, which are the Feature's --------------------------------------------
{
  // "When anything collides with a Feature, it takes Collision Damage. However, the Damage
  // inflicted is equal to 1/2 (rounded up) of the Tier of Power of the Character whose
  // Maneuver or Effect caused the Collision."
  //
  // The Feature takes it, not whoever was thrown into it. I read that backwards first and
  // offered the number as the starting value of the Collision Damage dialog - which is the
  // Damage a Character takes, a different thing entirely. Taken back out.
  //
  // So nothing is built for the number itself: a Feature is not a thing this system holds,
  // and there is nowhere for that Damage to land. It is stated where the table reads it.
  //
  // What the dialog did later gain is the other direction - the Qualities of the Feature
  // that was hit, which act on the Character - and that is `qualities.mjs`. The two are
  // easy to confuse, so what is pinned here is that this dialog still works out no Feature
  // Damage: no Tier of Power in it, and nothing halving or filling in the number it asks
  // for on the Feature's behalf.
  // The window works out one number and it is the Character's: the Hardness Value of what
  // they hit, off their own base Tier of Power. Nothing in it computes a Tier of Power for
  // the thrower, and nothing takes anything off a Feature, because there is no Feature here
  // to take it off.
  const WINDOW = source(CHAT, "askCollisionDamage");
  check("the collision window works the damage out from the Character's own base Tier",
    WINDOW.includes("const baseTier = Math.max(1, target.system.baseTierOfPower ?? 1);"),
    true);
  check("with no Tier of Power of anybody else's in it",
    /[^e]tierOfPower/.test(WINDOW), false);
  check("and nothing it writes goes anywhere but the Character",
    WINDOW.includes("await reduceLifePoints(target, ignored ? 0 : received,")
      && !WINDOW.includes("feature.update"), true);
  check("the Features it names are the one they hit, asked about and not held",
    WINDOW.includes('<p class="dbu-respond-hint dbu-list-label">Feature Qualities</p>'),
    true);

  // It was written out on the tab for a while, the right way round and twice over. That
  // paragraph is gone with the rest of the tab's prose, so the rule is the rulebook's to
  // state and this is the record of the reading: the FEATURE takes Collision Damage equal
  // to half the Tier of Power - rounded up - of whoever caused the collision. Not whoever
  // was thrown into it. I had it backwards once.
  //
  // Nothing is built for it either way, which is what is pinned here: a Feature is not a
  // thing this system holds, so there is nowhere for that Damage to land and nothing that
  // works it out.
  check("nothing anywhere works out what a Feature takes",
    /half the Tier of Power/.test(CHAT) || /collisionToFeature/.test(CHAT), false);
  check("and the tab asks nothing about it either",
    /Collision Damage equal to half/.test(TAB), false);
}

// --- What the tab says, which is as little as it can ------------------------------------------------
{
  // Four paragraphs headed "What is the table's" - Scale, Light Sources, Features,
  // Collisions - used to sit under the buttons, saying which rules this system leaves
  // alone. Printed where somebody is looking for a control, they read as work to do.
  //
  // So the tab carries controls and the rules stay in the rulebook. What is checked now is
  // that it stayed that way: the prose is gone and the controls are all still there.
  for (const gone of ["<strong>Features.</strong>", "<strong>Collisions.</strong>",
                      "<strong>Scale.</strong>", "<strong>Light Sources.</strong>",
                      "You always hit a Feature, and the Damage is your Tier of Power"]) {
    check(`the tab no longer explains ${gone.slice(0, 28)}`, TAB.includes(gone), false);
  }

  // Every control the tab is for, named. Without this, a tab trimmed too far looks exactly
  // like a tab trimmed correctly.
  check("and every control is still on it", [
    TAB.includes('name="system.battlefield.lightLevel"'),
    TAB.includes('name="system.battlefield.cover.active"'),
    TAB.includes('name="system.battlefield.cover.rank"'),
    TAB.includes('data-action="attackFeature"'),
    TAB.includes('data-action="takeCollision"'),
    TAB.includes('data-section="hardness"'),
    TAB.includes('data-section="featureQualities"')
  ], [true, true, true, true, true, true, true]);

  check("and names the one case Cover takes itself back in",
    TAB.includes("Cover does not apply if the Attacking Maneuver has an Area of Effect"),
    true);
  check("which the file records as well",
    COVER.includes("So the exception is the table's to spot"), true);

  // The two Hardnesses were a trap while the field was a number to type: the Value is what
  // Cover uses, and the Rank is a Feature's Life Points. The picker closed it - what you
  // choose is a Rank by name, and the Value is worked out and never asked for.
  check("the tab asks for the Rank", TAB.includes("system.battlefield.cover.rank"), true);
  check("by name rather than by number",
    TAB.includes("Rank {{hardness.rank}} &middot; {{hardness.material}}"), true);
  check("and asks for no Value at all",
    TAB.includes("system.battlefield.cover.hardness"), false);

  // A picker that never shows what is stored looks right and answers nothing: it opens on
  // Rank 0 every time the sheet is drawn, whatever the character is actually behind. Both
  // halves, because either one alone is a dropdown with no memory.
  check("the picker opens on the Rank that is stored",
    SHEET.includes("behind: hardness.rank === (system.battlefield?.cover?.rank ?? 0)"),
    true);
  check("and the page marks that one selected",
    TAB.includes("{{#if hardness.behind}}selected{{/if}}"), true);
  check("while the trait still reduces Damage by twice the Value",
    COVER.includes("incoming.damage -= 2 * battlefield.cover.hardness;"), true);
}

console.log(`${failed} failing`);
process.exit(failed ? 1 : 0);
