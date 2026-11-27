/**
 * Modifier Maneuvers: a fifth kind, applied onto the Maneuver you are doing.
 *
 * "Each Modifier Maneuver has a Maneuver (or type of Maneuver) that it can be applied to
 * - this is known as the Base Maneuver." Both shapes, so `whyNotModify` is what most of
 * this runs: one Maneuver by its id, one of the four kinds, `attacking` for every
 * Attacking Maneuver, and several of those at once.
 *
 * No Modifier Maneuver exists in the library yet - the type was given before any of them
 * were - so what is checked is the machinery and the shape a file will be written in.
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
// use-maneuver reaches the character data model, which is built out of DataFields.
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
const { loadManeuvers, getManeuver, MANEUVER_TYPES, whyNotModify, PROFILES } =
  await import(modUrl("maneuvers.mjs"));
await loadTraits();
await loadManeuvers();

const { definitionOf, modifiersFor } = await import(modUrl("use-maneuver.mjs"));

const USE = fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8");
const SHEET = fs.readFileSync(
  path.join(ROOT, "module", "sheets", "actor-character-sheet.mjs"), "utf8");
const SCHEMA = fs.readFileSync(
  path.join(ROOT, "module", "data", "item-maneuver.mjs"), "utf8");
const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
const COMBAT = fs.readFileSync(path.join(ROOT, "module", "combat.mjs"), "utf8");

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

/** A Maneuver Item as `definitionOf` reads one. */
function makeItem({ id, name, system = {} }) {
  return {
    id, name, type: "maneuver",
    system: {
      maneuverId: "", type: "standard", actionCost: 1, actionCostMax: 0,
      actionCostOpen: false, kiCost: 0, kiCostPerBaseTier: 0, kiCostPerTier: 0,
      attacking: false, absolute: false, requiresTarget: false, defend: false,
      intervene: false, exploit: false, empower: false, grapple: false, launch: false,
      movement: false, pin: false, powerUp: false, signatureTechnique: false,
      thrust: false, blockade: false, suddenStop: false, reflect: false,
      exploitable: "", surge: false, charge: false, cancelCharge: false, profile: "",
      clashSkill: "", tags: [], advantages: [], baseManeuver: [], description: "",
      source: "", text: "",
      ...system,
      get limit() {
        const match = String(this.usageLimit ?? "").match(/^(\d+)\s*\/\s*(round|encounter)$/i);
        return match ? { amount: Number(match[1]), per: match[2].toLowerCase() } : null;
      }
    }
  };
}

// --- The kind ---------------------------------------------------------------------------------
{
  check("Modifier is one of the kinds a Maneuver can be",
    MANEUVER_TYPES.modifier?.label, "Modifier");

  // Not a currency of its own: which Actions it spends is the Base Maneuver's business,
  // because a Modifier is part of doing that Maneuver rather than a second thing beside it.
  check("it spends no Actions of a kind of its own", MANEUVER_TYPES.modifier?.action, null);
  check("and it is marked as applied to another",
    MANEUVER_TYPES.modifier?.appliedToAnother, true);

  // The five. Special is not among them: the Analysis Maneuver s entry reads "Maneuver
  // Type: Standard Maneuver", so Special is something a Maneuver of any kind can be
  // rather than a kind of its own.
  check("there are five kinds",
    Object.keys(MANEUVER_TYPES),
    ["standard", "counter", "instant", "modifier", "outOfSequence"]);
}

// --- What a Modifier attaches to, run ------------------------------------------------------------
{
  const basicAttack = getManeuver("basic-attack");
  const defend = getManeuver("defend");
  const surge = getManeuver("surge");

  const named = { name: "Sharpened", baseManeuver: ["basic-attack"] };
  check("one Maneuver by its id", whyNotModify(named, basicAttack), null);
  check("and not another Maneuver",
    whyNotModify(named, surge), "Sharpened applies to basic-attack, not to Surge.");

  // "Or type of Maneuver" - the four kinds name themselves.
  const anyCounter = { name: "Braced", baseManeuver: ["counter"] };
  check("a kind of Maneuver", whyNotModify(anyCounter, defend), null);
  check("and not a Maneuver of another kind",
    Boolean(whyNotModify(anyCounter, surge)), true);

  // And the one category this system already models as a flag.
  const anyAttack = { name: "Heavy", baseManeuver: ["attacking"] };
  check("every Attacking Maneuver", whyNotModify(anyAttack, basicAttack), null);
  check("and nothing that is not one", Boolean(whyNotModify(anyAttack, surge)), true);

  // Several at once, because a header splits on commas and the rule does not say one.
  const either = { name: "Wide", baseManeuver: ["surge", "attacking"] };
  check("several, and any of them will do",
    [whyNotModify(either, surge), whyNotModify(either, basicAttack)], [null, null]);
  check("but still not something outside the list",
    Boolean(whyNotModify(either, defend)), true);

  // A Base Maneuver is part of what a Modifier is. One written without it is unfinished
  // rather than universal, and says so.
  check("naming nothing attaches to nothing",
    whyNotModify({ name: "Nameless", baseManeuver: [] }, basicAttack),
    "Nameless does not say which Maneuver it applies to.");
  check("and a missing list is the same thing",
    Boolean(whyNotModify({ name: "Nameless" }, basicAttack)), true);

  // Not onto another Modifier: what it attaches to is a Maneuver you are doing.
  check("not onto another Modifier",
    whyNotModify({ name: "Wide", baseManeuver: ["standard"] },
      { id: "other", name: "Other", type: "modifier" }),
    "A Modifier Maneuver cannot be applied to another Modifier Maneuver.");

  check("and nothing at all is nothing to apply it to",
    whyNotModify(named, null), "There is no Maneuver here to apply it to.");
}

// --- Called Shot, the first one of them --------------------------------------------------------
{
  const shot = getManeuver("called-shot");

  check("loaded as a Modifier Maneuver", shot?.type, "modifier");
  check("once a Combat Round", shot.usageLimit, { amount: 1, per: "round" });
  check("costing 1 Action and 2(T)", [shot.actionCost, shot.kiCostPerTier], [1, 2]);

  // "Base Maneuver: Any Attacking Maneuver", narrowed by the Effect to one without an
  // Area of Effect. Two sentences, so two fields.
  check("applied to any Attacking Maneuver", shot.baseManeuver, ["attacking"]);
  check("but not one with an Area of Effect", shot.baseForbids, ["area"]);

  // "Increase the Damage Category of that Attacking Maneuver by 1 but decrease the
  // Strike Roll for that Attacking Maneuver by 2(T)."
  check("one Damage Category harder", shot.damageCategoryShift, 1);
  check("and 2(T) off the Strike Roll", shot.strikePerTier, -2);
  check("and it asks where you aimed", shot.asks, "State the area you targeted");

  check("the entry is there whole", [
    shot.text.includes("Called Shot [1/Round]: A unique type of Maneuver"),
    shot.text.includes("Base Maneuver: Any Attacking Maneuver."),
    shot.text.includes("that does not have an Area of Effect"),
    shot.text.includes("decrease the Strike Roll for that Attacking Maneuver by 2(T)"),
    shot.text.includes("State the area you targeted with this Attacking Maneuver."),
    shot.text.includes("Your ARC may allow for special effects to occur")
  ], [true, true, true, true, true, true]);

  // The five are examples the entry offers, and they are all in it.
  for (const part of ["Head:", "Eyes:", "Arm:", "Leg:", "Gut:"]) {
    check(`the ${part.replace(":", "")} example is carried`,
      shot.text.includes(part), true);
  }

  // And an Area of Effect really is refused, against a real Profile that has one.
  const areaProfile = Object.entries(PROFILES).find(([, p]) => p.area)?.[0];
  const plainProfile = Object.entries(PROFILES).find(([, p]) => !p.area)[0];

  check("it applies to a Basic Attack with an ordinary Profile",
    whyNotModify(shot, { ...getManeuver("basic-attack"), profile: plainProfile }), null);
  check("and is refused on one with an Area of Effect",
    whyNotModify(shot, { ...getManeuver("basic-attack"), profile: areaProfile }),
    "Called Shot cannot be applied to an Attacking Maneuver with an Area of Effect.");
  check("and on a Maneuver that is not an attack at all",
    Boolean(whyNotModify(shot, getManeuver("surge"))), true);
}

// --- What it does to the attack, run ------------------------------------------------------------
{
  // A Modifier that changes the character can write a Slot and be done. This one changes
  // that attack, and an attack is settled minutes later and often on another client - so
  // what was applied has to be on the card rather than on whoever applied it.
  const { appliedModifiers } = await import(modUrl("use-maneuver.mjs"));

  const shot = getManeuver("called-shot");
  const kept = appliedModifiers([{ modifier: { ...shot, itemId: "cs" }, note: "the Gut" }]);

  // `woundPerTier` arrived with the Feint Maneuver, which is the first thing applied to an
  // attack that touches the Wound Roll as well as the Strike. Zero on every Modifier
  // Maneuver so far, and carried anyway: the list holds one shape.
  check("the card keeps the numbers and the words",
    kept, [{ id: "called-shot", name: "Called Shot", damageCategoryShift: 1,
             strikePerTier: -2, woundPerTier: 0, note: "the Gut", atApparel: false, atWeapon: null,
             atBuddy: null }]);
  check("and nothing else, since the Item may be edited in between",
    Object.keys(kept[0]).sort(),
    ["atApparel", "atBuddy", "atWeapon", "damageCategoryShift", "id", "name", "note", "strikePerTier", "woundPerTier"]);

  // The two readers on the attack's side, cut out and run.
  const shiftFrom = CHAT.indexOf("function modifierCategoryShift(");
  const shiftTo = CHAT.indexOf("\n}", shiftFrom) + 2;
  const modifierCategoryShift = new Function(
    `${CHAT.slice(shiftFrom, shiftTo)}\nreturn modifierCategoryShift;`)();

  check("no Modifiers is no step", modifierCategoryShift([]), 0);
  check("Called Shot is one step", modifierCategoryShift(kept), 1);
  check("and two of them are two",
    modifierCategoryShift([...kept, ...kept]), 2);

  const partsFrom = CHAT.indexOf("function modifierStrikeParts(");
  const partsTo = CHAT.indexOf("\n}", partsFrom) + 2;
  const modifierStrikeParts = new Function(
    `${CHAT.slice(partsFrom, partsTo)}\nreturn modifierStrikeParts;`)();

  const attacker = { system: { tierOfPower: 4 } };
  check("Called Shot takes 2(T) off the Strike Roll",
    modifierStrikeParts(attacker, { modifiers: kept })
      .map(p => [p.label, p.written, p.value]),
    [["Called Shot", "-2(T)", -8]]);
  check("a row each, since each is a Maneuver you chose and paid for",
    modifierStrikeParts(attacker, { modifiers: [...kept, ...kept] }).length, 2);
  check("and nothing at all from one that touches no Strike",
    modifierStrikeParts(attacker, { modifiers: [{ name: "Quiet", strikePerTier: 0 }] }), []);
  check("nor from an attack with none", modifierStrikeParts(attacker, {}), []);

  // Where the two are read from, which is the attack rather than the character.
  check("the Strike Roll reads them",
    CHAT.includes("...modifierStrikeParts(attacker, attack),"), true);
  check("and the Damage Category step is added on top of the Profile's",
    /\+ modifierCategoryShift\(modifiers\)\r?\n\s*\+ \(Number\(weapon\?\.damageCategory\) \|\| 0\)\r?\n/.test(CHAT),
    true);
  check("the attack carries what was applied",
    CHAT.includes("          modifiers,\n"), true);
}

// --- What the ARC decides, and is not decided here -----------------------------------------------
{
  const FILE = fs.readFileSync(path.join(TRAITS, "maneuvers", "called-shot.dbu"), "utf8");

  // "Your ARC may allow for special effects to occur" - a ruling rather than a rule, and
  // the five below it are "a few potential example targets". So nothing here reaches for
  // a Condition off that list.
  check("the file says the effects are the ARC's",
    FILE.includes("That is a ruling, not a rule"), true);
  check("and nothing applies a Condition from the examples",
    ["impediment", "blinded"].some(key => USE.includes(`"${key}"`)), false);

  // The area is written in the player's own words rather than picked off a list.
  check("the question is asked in the entry's own words",
    USE.includes("<span>${escape(modifier.asks)}</span>"), true);
  check("and answered as free text",
    USE.includes('<input type="text" name="note" value=""/>'), true);
}

// --- Triggered, the second one, and the first that holds a Maneuver back ------------------------
{
  const held = getManeuver("triggered");

  check("loaded as a Modifier Maneuver", held?.type, "modifier");
  check("once a Combat Round", held.usageLimit, { amount: 1, per: "round" });
  check("costing nothing of its own, which is what N/A means",
    [held.actionCost, held.kiCost], [0, 0]);

  // "Base Maneuver: Any Maneuver", written as the four kinds - a Modifier with no Base
  // Maneuver attaches to nothing here, so naming all four is how "any" is said.
  check("applied to any kind of Maneuver",
    held.baseManeuver, ["standard", "counter", "instant", "outOfSequence"]);
  for (const id of ["basic-attack", "defend", "surge", "reflect"]) {
    check(`and to the ${id} Maneuver`, whyNotModify(held, getManeuver(id)), null);
  }
  // Still not onto another Modifier, which is the one thing "any Maneuver" does not mean.
  check("but not onto another Modifier",
    Boolean(whyNotModify(held, getManeuver("called-shot"))), true);

  check("it holds the Base Maneuver back", held.delays, true);
  check("and asks what the trigger is", held.asks, "Select a trigger");

  // The Exploitable line is inside the Effect rather than above it, which is why the file
  // carries it as the field and the entry does not print a line for it.
  check("it provokes the Exploit from a Sphere around you",
    held.exploitable, "Any Opponent within a Sphere AoE centered on you");

  check("the entry is there whole", [
    held.text.includes("Triggered Maneuver [1/Round]: A unique type of Maneuver"),
    held.text.includes("delay its use but pay the Action Cost and KP Cost immediately"),
    held.text.includes("without paying the Action Cost or KP Cost as an Out-of-Sequence Maneuver"),
    held.text.includes("a trigger should at least be as specific as those below"),
    held.text.includes("you provoke the Exploit Maneuver for any Opponent within a Sphere AoE"),
    held.text.includes("you gain a number of Counter Actions equal to the Action\nCost spent.")
      || held.text.includes("Counter Actions equal to the Action")
  ], [true, true, true, true, true, true]);

  for (const example of ["Damage:", "Movement:", "Attack:", "Turn End:", "Combat Condition:"]) {
    check(`the ${example.replace(":", "")} trigger is carried`, held.text.includes(example), true);
  }
}

// --- The hold, run ---------------------------------------------------------------------------------
{
  const { delayedManeuver, dropDelayed } = await import(modUrl("use-maneuver.mjs"));

  const empty = { itemId: "", maneuverId: "", name: "", trigger: "", actions: 0,
                  actionKind: "standard", messageId: "" };
  const actor = {
    name: "Tizi",
    system: { delayed: { ...empty } },
    async update(changes) {
      for (const [key, value] of Object.entries(changes)) {
        if (key === "system.delayed") this.system.delayed = { ...value };
        if (key === "system.actionsSpent.counter") {
          this.system.actionsSpent = { ...this.system.actionsSpent, counter: value };
        }
      }
    }
  };

  check("holding nothing is nothing to say", delayedManeuver(actor), null);

  actor.system.delayed = { itemId: "i", maneuverId: "basic-attack", name: "Basic Attack",
                           trigger: "if Krillin is hit", actions: 1,
                           actionKind: "standard", messageId: "m1" };
  check("holding something says what and on what",
    [delayedManeuver(actor).name, delayedManeuver(actor).trigger],
    ["Basic Attack", "if Krillin is hit"]);

  // A holding with no trigger written on it is one nobody can rule on, so it says so
  // rather than showing a blank.
  actor.system.delayed = { ...actor.system.delayed, trigger: "" };
  check("and a holding with no trigger says that too",
    delayedManeuver(actor).trigger, "no trigger stated");

  await dropDelayed(actor);
  check("letting go leaves nothing behind", delayedManeuver(actor), null);
  check("and dropping nothing is nothing to drop", await dropDelayed(actor), false);
}

// --- The reprisal, run -------------------------------------------------------------------------------
{
  // "If you take Damage from an Attacking Maneuver used through the Exploit Maneuver in
  // response to this Maneuver, you do not gain the effects ... but you gain a number of
  // Counter Actions equal to the Action Cost spent."
  const from = CHAT.indexOf("async function interruptDelayed(");
  const to = CHAT.indexOf("\n}", from) + 2;

  let said = "";
  let dropped = false;
  const interruptDelayed = new Function("requestActorUpdate", "ChatMessage", "dropDelayed",
    `${CHAT.slice(from, to).replace(/const \{ dropDelayed \} = await import\([^)]*\);/, "")}
     return interruptDelayed;`)(
      (target, changes) => target.update(changes),
      { getSpeaker: () => ({}), create: async ({ content }) => { said = content; } },
      async () => { dropped = true; });

  const holder = () => ({
    name: "Tizi",
    system: {
      delayed: { itemId: "i", maneuverId: "surge", name: "Surge", trigger: "x",
                 actions: 2, actionKind: "standard", messageId: "m1" },
      actionsSpent: { standard: 2, counter: 2 }
    },
    async update(changes) {
      for (const [key, value] of Object.entries(changes)) {
        if (key === "system.actionsSpent.counter") this.system.actionsSpent.counter = value;
      }
    }
  });

  // The Exploit that came through this holding's own card.
  dropped = false;
  const hit = holder();
  await interruptDelayed(hit, { provokedBy: { messageId: "m1" } });
  check("the hold is let go of", dropped, true);
  check("and the Actions come back as Counter Actions",
    hit.system.actionsSpent.counter, 0);
  check("said out loud, naming what was not used", said.includes("Surge is not used"), true);
  check("and how many came back", said.includes("2 Counter Actions"), true);

  // An unrelated Exploit, and an unrelated attack. A character who held something and is
  // hit by something else keeps their holding.
  dropped = false;
  await interruptDelayed(holder(), { provokedBy: { messageId: "m2" } });
  check("an Exploit from another card leaves the hold alone", dropped, false);

  dropped = false;
  await interruptDelayed(holder(), {});
  check("and so does an attack that came through no Exploit at all", dropped, false);

  dropped = false;
  const nothing = holder();
  nothing.system.delayed = { itemId: "", maneuverId: "", name: "", trigger: "", actions: 0,
                             actionKind: "standard", messageId: "" };
  await interruptDelayed(nothing, { provokedBy: { messageId: "m1" } });
  check("somebody holding nothing has nothing interrupted", dropped, false);

  // Only when Damage actually landed - an attack that hits for nothing is not Damage
  // taken, and the entry says "if you take Damage".
  check("and it is only asked once the Damage is known",
    CHAT.includes("if (damage > 0) await interruptDelayed(target, attack);"), true);
}

// --- Where it is held, offered, and let go of --------------------------------------------------------
{
  const using = USE.slice(USE.indexOf("export async function useManeuver("));

  // Paid for first - "pay the Action Cost and KP Cost immediately" - and stopped before
  // anything else happens to it.
  check("the hold comes after the Actions are paid",
    using.indexOf("await payActions(actor, maneuver, actionsSpent);")
      < using.indexOf("if (held) return holdManeuver(actor, maneuver, held, actionsSpent);"),
    true);
  check("and before the Maneuver is declared",
    using.indexOf("if (held) return holdManeuver(actor, maneuver, held, actionsSpent);")
      < using.indexOf('await fireMoment(actor, "declare-maneuver"'), true);

  // One at a time: the character has one place to keep it.
  check("a second holding is refused",
    using.includes("if (held && delayedManeuver(actor)) {"), true);

  // Offered back free, which is the only thing that sets `free` on an offer.
  check("offered back on the card that announced it",
    USE.includes("offerDelayed(card, actor, maneuver, held.note ?? \"\");"), true);
  check("free, which waives the Ki that out-of-sequence does not",
    CHAT.includes("  let price = offer.free\n    // What was bought on top of it all the same - Greed of the Hera's AoE and Magnitude.\n    ? (Number(declared?.kiSurcharge) || 0)"), true);
  check("and taking it stops the holding",
    CHAT.includes("if (offer.free && actor.system.delayed?.itemId) {"), true);

  // "Before the start of your next turn" is where the window shuts.
  check("it lapses at the start of your next turn",
    COMBAT.includes("  await lapseDelayed(actor);"), true);
  check("after the Moment and the DOT, both of which are still arriving at the turn",
    COMBAT.indexOf("await burnDot(actor);") < COMBAT.indexOf("await lapseDelayed(actor);"),
    true);

  // And the sheet says what is being held, since nothing watches for the trigger.
  check("the sheet is told what is held",
    SHEET.includes("context.delayed = delayedManeuver(this.actor);"), true);
}

// --- What the table decides, and is not decided here --------------------------------------------------
{
  const FILE = fs.readFileSync(path.join(TRAITS, "maneuvers", "triggered.dbu"), "utf8");

  check("the file says nothing watches for the trigger",
    FILE.includes("nothing here watches for one"), true);
  check("and that the five are examples of how specific to be",
    FILE.includes("examples of how specific to\n# be, not a list to choose from")
      || FILE.includes("not a list to choose from"), true);
  check("the Ki is not handed back, and the file says why",
    FILE.includes("The Ki is not"), true);
}

// --- Which ones a character could apply ------------------------------------------------------------
{
  const basicAttack = { ...getManeuver("basic-attack"), itemId: "base" };

  const actor = {
    name: "Tizi",
    // A Tier of Power the Base Tier's: a Breakthrough above it would price nothing higher (Breakthrough).
    system: { tierOfPower: 3, baseTierOfPower: 3, usedManeuvers: [], effects: { slots: {} } },
    items: [
      makeItem({ id: "heavy", name: "Heavy Swing",
        system: { type: "modifier", baseManeuver: ["attacking"], actionCost: 1,
                  kiCostPerTier: 2 } }),
      makeItem({ id: "braced", name: "Braced",
        system: { type: "modifier", baseManeuver: ["counter"] } }),
      makeItem({ id: "spent", name: "Once Only",
        system: { type: "modifier", baseManeuver: ["attacking"], usageLimit: "1/round" } }),
      makeItem({ id: "plain", name: "Basic Attack", system: { maneuverId: "basic-attack" } })
    ]
  };

  const offered = modifiersFor(actor, basicAttack);
  check("only the ones that apply, in name order",
    offered.map(entry => entry.modifier.name), ["Heavy Swing", "Once Only"]);

  const heavy = offered.find(entry => entry.modifier.name === "Heavy Swing");
  check("with what it costs worked out",
    [heavy.actions, heavy.kind, heavy.ki], [1, "standard", 6]);

  // The Base Maneuver's currency: a Modifier on a Counter costs Counter Actions.
  const onCounter = modifiersFor(actor, { ...getManeuver("defend"), itemId: "d" });
  check("a Modifier on a Counter spends Counter Actions",
    onCounter.map(entry => [entry.modifier.name, entry.kind]), [["Braced", "counter"]]);

  // Out of uses is offered and refused rather than hidden, so the reason is visible.
  actor.system.usedManeuvers = ["round:spent"];
  const after = modifiersFor(actor, basicAttack);
  check("one out of uses is still listed",
    after.map(entry => entry.modifier.name), ["Heavy Swing", "Once Only"]);
  check("and says it has none left",
    after.map(entry => entry.left > 0), [true, false]);
  check("the dialog greys that one out",
    USE.includes('${spent ? "disabled" : ""}'), true);
}

// --- Where it is applied, and where it is not ----------------------------------------------------
{
  // Asked last of the questions that can still be walked away from, and paid first of the
  // things that are paid - so whatever a Modifier does is in place before the Maneuver it
  // was applied to is declared.
  const using = USE.slice(USE.indexOf("export async function useManeuver("));
  check("the question comes before anything is paid",
    using.indexOf("const modifiers = await askModifiers(actor, maneuver);")
      < using.indexOf("if (!await applyModifiers(actor, modifiers, { maneuver, declared })) return false;"), true);
  check("and the Modifiers are paid before the Maneuver is",
    using.indexOf("if (!await applyModifiers(actor, modifiers, { maneuver, declared })) return false;")
      < using.indexOf("if (!fromStore && !await spendManeuverCost(actor, maneuver, moving.fromSelf)) return false;"),
    true);
  check("backing out of the question drops the Maneuver",
    using.includes("  if (!modifiers) return false;"), true);

  // Everything is checked before anything is spent: a character who can afford the first
  // of two and not the second must not be left having paid for the first.
  check("the Actions are checked before any are spent",
    USE.indexOf("if (amount && (actionsLeft(actor, kind) < amount)) {")
      < USE.indexOf("if (amount) await spendActions(actor, amount, kind);"), true);
  check("and refused by name when they are short",
    USE.includes("Action(s) for those Modifier Maneuvers."), true);
  check("and the Ki is one price for all of them",
    USE.includes('if (ki && !await spendManeuverCost(actor, { name: "those Modifier Maneuvers" }, ki))'),
    true);

  // Each does its own thing, scoped to its own Item.
  check("each Modifier's own effects are fired for it alone",
    USE.includes("{ only: entry.modifier.itemId });"), true);

  // "Applied onto other Maneuvers you are doing", so there is no using one on its own -
  // said where the rule is and not only where the button is.
  check("using one on its own is refused",
    using.includes('if (maneuver.type === "modifier") {'), true);
}

// --- And the sheet lists them --------------------------------------------------------------------
{
  check("the sheet gives them a list of their own",
    SHEET.includes('{ key: "modifier", playable: false,'), true);
  check("not played from it, and the row says what it applies to",
    SHEET.includes('(maneuver.baseManeuver ?? []).join(" or ") || "nothing yet"'), true);

  check("a Maneuver carries what it applies to",
    SCHEMA.includes("baseManeuver: new fields.ArrayField("), true);
  check("and a definition carries it as a list",
    definitionOf(makeItem({ id: "m", name: "M",
      system: { type: "modifier", baseManeuver: ["attacking"] } })).baseManeuver,
    ["attacking"]);
  check("blank on everything that is not one",
    definitionOf(makeItem({ id: "b", name: "B" })).baseManeuver, []);
}

console.log(failed ? `\n${failed} failing` : "\nall good");
process.exit(failed ? 1 : 0);
