/**
 * The Signature Technique Maneuver: a door rather than an attack.
 *
 * "Make an Attacking Maneuver using a Signature Technique you have access to." Which
 * half of the merge wins is the whole rule, so that is what is checked by running it:
 * the door keeps what it charges and what it limits, the Technique keeps the attack.
 *
 * And the two things that had to exist first, both checked here because both were
 * silently broken rather than missing: a one-word `tags:` header parsing as a word, and
 * `maneuver.signature` - which `profileKiCost` has always read and nothing has ever
 * written, so Blitz's Signature discount had never once applied.
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
const { loadManeuvers, getManeuver, PROFILES, profileKiCost, maneuverUsesLeft,
        maneuverKiCost } = await import(modUrl("maneuvers.mjs"));
await loadTraits();
await loadManeuvers();

const { definitionOf, maneuverItemFrom, signatureTechniquesOf } =
  await import(modUrl("use-maneuver.mjs"));

const TRAIT = fs.readFileSync(path.join(TRAITS, "maneuvers", "signature-technique.dbu"), "utf8");
const USE = fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8");
const SHEET = fs.readFileSync(
  path.join(ROOT, "module", "sheets", "actor-character-sheet.mjs"), "utf8");
const RULES = fs.readFileSync(
  path.join(ROOT, "templates", "parts", "maneuver-rules.hbs"), "utf8");
const ITEM_SHEET = fs.readFileSync(
  path.join(ROOT, "module", "sheets", "item-maneuver-sheet.mjs"), "utf8");
const INDEX = JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));

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
    id,
    name,
    type: "maneuver",
    system: {
      maneuverId: "", type: "standard", actionCost: 1, actionCostMax: 0,
      actionCostOpen: false, kiCost: 0, kiCostPerBaseTier: 0, attacking: false,
      absolute: false, requiresTarget: false, defend: false, intervene: false,
      exploit: false, empower: false, grapple: false, launch: false, movement: false,
      pin: false, powerUp: false, signatureTechnique: false, exploitable: "",
      surge: false, charge: false, cancelCharge: false, profile: "", clashSkill: "",
      tags: [], advantages: [], description: "", source: "", text: "",
      ...system,
      get limit() {
        const match = String(this.usageLimit ?? "").match(/^(\d+)\s*\/\s*(round|encounter)$/i);
        return match ? { amount: Number(match[1]), per: match[2].toLowerCase() } : null;
      }
    }
  };
}

// --- The Maneuver as the rulebook lists it ------------------------------------------------
{
  check("listed", INDEX.traits.includes("maneuvers/signature-technique.dbu"), true);

  const door = getManeuver("signature-technique");
  check("loaded as a Standard Maneuver", door?.type, "standard");
  check("costing 1 Action", door.actionCost, 1);
  check("once a Combat Round", door.usageLimit, { amount: 1, per: "round" });
  check("making an Attacking Maneuver", [door.attacking, door.requiresTarget], [true, true]);
  check("and giving no opening of its own", door.exploitable, "");

  // Read through the parser, not off the file: the KP Cost line wraps in the middle and
  // the whole sentence is what the row shows.
  check("the entry is there whole", [
    door.text.includes("Signature Technique Maneuver [1/Round]: Blast an Opponent away"),
    door.text.includes("their own KP Cost – that is the KP Cost you pay for this Maneuver"),
    door.text.includes("Make an Attacking Maneuver using a Signature Technique you have access to.")
  ], [true, true, true]);

  // A rule that forbids Signature Techniques has to stop the only door to one.
  check("tagged as a Signature Technique itself", door.tags, ["signature"]);
  check("which the forbid gate reads",
    USE.includes('[(maneuver.tags ?? []).includes("signature") || Boolean(maneuver.godFinisher), "signatureTechniques"'), true);
}

// --- A one-word tag header is a list ---------------------------------------------------------
{
  // `coerce` splits on commas and leaves a lone value a string, so `tags: signature`
  // arrived as the seven letters and `tags.includes("signature")` was asking whether the
  // word contains itself - true by accident here, and false for any other single tag.
  const door = getManeuver("signature-technique");
  check("a lone tag is a list of one", Array.isArray(door.tags), true);
  check("and reaches the Item as one", maneuverItemFrom(door).system.tags, ["signature"]);

  // The accident, so it is on the record: a one-tag header that happened to be a
  // substring of the word being looked for passed the test while being a string.
  check("the accident that hid it", "signature".includes("signature"), true);
  check("and what it would have done to any other tag",
    "uniqueAbility".includes("signature"), false);
}

// --- Which half of the merge wins --------------------------------------------------------------
{
  const from = USE.indexOf("function throughSignatureTechnique(");
  const to = USE.indexOf("\n/**", from);
  const through = new Function(`${USE.slice(from, to)}\nreturn throughSignatureTechnique;`)();

  const door = { ...getManeuver("signature-technique"), itemId: "door-item" };
  const technique = definitionOf(makeItem({
    id: "kame", name: "Kamehameha",
    system: { attacking: true, kiCost: 7, profile: "beam", tags: ["signature"],
              advantages: ["knockback"], usageLimit: "2/encounter", actionCost: 3,
              requiresTarget: false, text: "A wave of my own." }
  }));

  const used = through(door, technique);

  // The door's: what it charges, what it limits, and the id the use is counted against.
  check("the Action Cost is the door's, not the Technique's", used.actionCost, 1);
  check("and no range of Actions comes with it",
    [used.actionCostMax, used.actionCostOpen], [0, false]);
  check("the limit is the door's", used.usageLimit, { amount: 1, per: "round" });
  check("counted against the door, which is what makes it one across all of them",
    used.id, "signature-technique");
  check("and an Opponent is needed however the Technique was left set",
    used.requiresTarget, true);

  // The Technique's: everything about the attack.
  check("the name on the card is the Technique's", used.name, "Kamehameha");
  check("so is the price", used.kiCost, 7);
  check("so is the Profile", used.profile, "beam");
  check("so are the features it was built with", used.advantages, ["knockback"]);
  check("and its own Item id, so its script fires and its charges are collected",
    used.itemId, technique.itemId);
  check("the published wording is the Technique's", used.text, "A wave of my own.");

  // Both tags, and not a door itself - or using it would ask which Technique again.
  check("the tags are the union", used.tags.sort(), ["signature"]);
  check("it is a Signature Technique", used.signature, true);
  check("and it is not another door", used.signatureTechnique, false);

  // The Technique's own limit is a different statement from the door's, so it is kept
  // to be counted separately rather than swallowed.
  check("the Technique's own limit is remembered",
    used.through, { id: "kame", name: "Kamehameha", usageLimit: { amount: 2, per: "encounter" } });

  const plain = through(door, definitionOf(makeItem({
    id: "ki-blast", name: "Ki Blast", system: { attacking: true, tags: ["signature"] }
  })));
  check("and a Technique with no limit of its own remembers nothing", plain.through, null);

  check("both uses are recorded", USE.includes(
    "if (maneuver.through) await recordManeuverUse(actor, maneuver.through);"), true);
}

// --- Which Techniques a character has access to ---------------------------------------------------
{
  const items = [
    makeItem({ id: "kame", name: "Kamehameha", system: { tags: ["signature"] } }),
    makeItem({ id: "disc", name: "Destructo Disc", system: { tags: ["signature"] } }),
    makeItem({ id: "basic", name: "Basic Attack", system: { maneuverId: "basic-attack" } }),
    // The door carries the tag too, and must not be an option inside its own dialog.
    makeItem({ id: "door", name: "Signature Technique",
      system: { maneuverId: "signature-technique", tags: ["signature"],
                signatureTechnique: true } })
  ];
  const actor = { items };

  check("every Technique the character owns, in name order",
    signatureTechniquesOf(actor).map(t => t.name), ["Destructo Disc", "Kamehameha"]);
  check("and nothing that is not one",
    signatureTechniquesOf(actor).some(t => t.name === "Basic Attack"), false);
  check("the door is not an option inside its own dialog",
    signatureTechniquesOf(actor).some(t => t.signatureTechnique), false);
  check("a character with none has none", signatureTechniquesOf({ items: [] }), []);
}

// --- Blitz's discount, which had never once applied -------------------------------------------------
{
  // "If this Attacking Maneuver is a Signature Technique, reduce the KP Cost by 2(T)."
  const blitz = Object.entries(PROFILES).find(([, p]) => p.signatureDiscountPerTier);
  check("a Profile discounts Signature Techniques", Boolean(blitz), true);

  const [id, profile] = blitz;
  const actor = { system: { tierOfPower: 3 } };
  const listed = (profile.kiCost ?? 0) + ((profile.kiCostPerTier ?? 0) * 3);

  check("a Maneuver that is not one pays the listed cost",
    profileKiCost(id, { signature: false }, actor), listed);
  check("and one that is pays 2(T) less",
    profileKiCost(id, { signature: true }, actor),
    Math.max(0, listed - (profile.signatureDiscountPerTier * 3)));

  // The property it reads, which no definition carried until now: a Technique came
  // through here as `undefined` and paid full price every time.
  const technique = definitionOf(makeItem({
    id: "kame", name: "Kamehameha", system: { attacking: true, tags: ["signature"] } }));
  check("a Technique's definition says it is one", technique.signature, true);
  check("and an ordinary Maneuver's says it is not",
    definitionOf(makeItem({ id: "b", name: "Basic Attack" })).signature, false);
  check("so the discount now reaches it",
    profileKiCost(id, technique, actor) < listed, true);
}

// --- The Technique is played through the door, not from its own row ------------------------------------
{
  check("the sheet knows why a row is not played from",
    SHEET.includes('return technique ? "Played through the Signature Technique Maneuver." : "";'),
    true);
  check("which takes the button off that row",
    /playable: \(group\.playable \|\| this\.#playableAlone\(maneuver\)\)\s*\n\s*&& !this\.#playedThrough\(maneuver\)/
      .test(SHEET), true);
  check("and says so where the row's other refusals are said",
    SHEET.includes("              this.#playedThrough(maneuver),"), true);

  // The door itself is not caught by its own rule, or the only way in would be shut.
  const from = SHEET.indexOf("  #playedThrough(maneuver) {");
  const to = SHEET.indexOf("\n  }", from);
  const playedThrough = new Function("maneuver",
    `${SHEET.slice(from, to).replace("#playedThrough(maneuver) {", "return (function (maneuver) {")}
    })(maneuver);`);

  check("a Technique is played through the door",
    playedThrough({ tags: ["signature"] }),
    "Played through the Signature Technique Maneuver.");
  check("the door is not played through itself",
    playedThrough({ tags: ["signature"], signatureTechnique: true }), "");
  check("and an ordinary Maneuver is untouched", playedThrough({ tags: [] }), "");
}

// --- A Maneuver is not turned into a Technique, or back: Techniques are made as Techniques ---------------
{
  // Every template, not only the Rules tab: the Sig Creation tab had a copy of its own.
  const TEMPLATES = fs.readdirSync(path.join(ROOT, "templates", "parts"))
    .filter(name => name.endsWith(".hbs"))
    .filter(name => fs.readFileSync(path.join(ROOT, "templates", "parts", name), "utf8").includes("toggleSignature"));
  check("the Item sheet offers no such switch, on any tab",
    [TEMPLATES, ITEM_SHEET.includes("toggleSignature"), ITEM_SHEET.includes("isSignature")],
    [[], false, false]);

  // The field the features land in, read since Charging Assault was built and written by
  // nothing until now.
  check("a Maneuver carries the features it was built with",
    definitionOf(makeItem({ id: "k", name: "K", system: { advantages: ["full-wager"] } })).advantages,
    ["full-wager"]);
  check("and declareAttack is what reads them",
    fs.readFileSync(path.join(ROOT, "module", "maneuvers.mjs"), "utf8")
      .includes("withGranted(maneuver.advantages, PROFILES[profile]?.grantsAdvantage)"), true);
}

// --- What is not built, and why --------------------------------------------------------------------------
{
  check("the file says what is missing",
    TRAIT.includes("Buying a Signature Technique with Technique Points"), true);
  check("and what is half there",
    TRAIT.includes("what is missing is the part that prices them"), true);
}

// --- The dialog itself, run -------------------------------------------------------------------
{
  // Cut out and run against a stubbed DialogV2, so what is checked is the markup a player
  // is actually shown: the price beside each name, and the row that cannot be picked
  // because that Technique is out of its own uses.
  const from = USE.indexOf("async function pickSignatureTechnique(");
  const to = USE.indexOf("\n/**", from);
  const build = new Function("signatureTechniquesOf", "maneuverKiCost", "maneuverUsesLeft",
    "PROFILES", "ui", "foundry", "Handlebars", "whyNotTechnique",
    `${USE.slice(from, to)}\nreturn pickSignatureTechnique;`);

  let shown = "";
  let warned = "";

  /** DialogV2, answering the way the real one would. */
  const stub = answer => ({
    applications: {
      api: {
        DialogV2: {
          wait: async ({ content }) => {
            shown = content;
            if (answer === "cancel") return null;
            // Confirm reads the checked radio, so with no answer given the stub returns
            // whichever option the picker itself started on.
            return answer ?? (content.match(/value="([^"]+)"[^>]*checked/) ?? [])[1] ?? null;
          }
        }
      }
    }
  });

  const ask = (who, answer) => build(
    signatureTechniquesOf, maneuverKiCost, maneuverUsesLeft, PROFILES,
    { notifications: { warn: message => { warned = message; } } },
    stub(answer), globalThis.Handlebars, () => ""
  )(who, door);

  const door = { ...getManeuver("signature-technique"), itemId: "door-item" };
  const actor = {
    system: { tierOfPower: 2, usedManeuvers: [] },
    items: [
      makeItem({ id: "kame", name: "Kamehameha",
        system: { attacking: true, kiCost: 7, profile: "beam", tags: ["signature"] } }),
      makeItem({ id: "disc", name: "Destructo Disc",
        system: { attacking: true, kiCost: 4, tags: ["signature"], usageLimit: "1/encounter" } })
    ]
  };

  const first = await ask(actor);
  check("the first Technique is the one already selected", first?.name, "Destructo Disc");
  check("both are offered",
    [shown.includes("Kamehameha"), shown.includes("Destructo Disc")], [true, true]);
  check("with what throwing each one costs",
    [shown.includes("7 KP"), shown.includes("4 KP")], [true, true]);
  check("and the Profile a Technique names", shown.includes(PROFILES.beam.label), true);
  check("the question says what the door itself costs",
    shown.includes("1 Action and may be used once a Combat Round"), true);

  check("picking one by name gives that one back",
    (await ask(actor, "kame"))?.name, "Kamehameha");

  // Its own limit, spent. Greyed rather than left off the list, and not the one the
  // picker starts on.
  actor.system.usedManeuvers = ["encounter:disc"];
  const other = await ask(actor);
  check("a Technique out of its own uses cannot be picked",
    shown.includes("dbu-technique-spent"), true);
  check("and says why", shown.includes("no uses left this encounter"), true);
  check("so the selection falls to one that can be", other?.name, "Kamehameha");

  check("nothing chosen is nothing thrown", await ask(actor, "cancel"), null);

  warned = "";
  check("a character with no Techniques is told, not shown an empty box",
    await ask({ system: { usedManeuvers: [] }, items: [] }), null);
  check("by name", warned.includes("has no Signature Techniques"), true);
  check("and told where to make one",
    warned.includes("Build one on the Signature Techniques tab"), true);
}

console.log(failed ? `\n${failed} failing` : "\nall good");
process.exit(failed ? 1 : 0);
