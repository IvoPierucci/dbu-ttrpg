/**
 * Each Profile once a Combat Round through a Basic Attack, bar the Simple one.
 *
 * "You can only use each Profile once per Combat Round when using a Basic Attack
 * Maneuver, except for the Simple Profile."
 *
 * The picker is driven for real here rather than read as source: DialogV2.wait is
 * stubbed to hand back the content it was about to show, so what is checked is the
 * markup the player would actually be looking at.
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
// combat.mjs reaches the character data model, and a data model needs the field classes
// and a base to extend at import time.
globalThis.foundry.data = await import(appUrl("common/data/_module.mjs"));
const { default: DataModel } = await import(appUrl("common/abstract/data.mjs"));
globalThis.foundry.abstract = { DataModel, TypeDataModel: DataModel };
globalThis.Handlebars = {
  escapeExpression: s => String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#x27;")
};

// What the picker is about to show, captured instead of shown.
let shown = null;
globalThis.foundry.applications = {
  api: { DialogV2: { wait: async options => { shown = options; return null; } } }
};

const { PROFILES, PROFILE_SPENT_LABEL, pickProfileOnly, recordProfileUse, whyNotThisProfile } =
  await import(modUrl("maneuvers.mjs"));
const { newRoundFor } = await import(modUrl("combat.mjs"));

const MODEL = fs.readFileSync(path.join(ROOT, "module", "data", "actor-character.mjs"), "utf8");
const USE = fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8");
const CSS = fs.readFileSync(path.join(ROOT, "styles", "dbu-ttrpg.css"), "utf8");

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

/** A character, as far as any of this reads one. */
function makeActor(spent = []) {
  return {
    name: "Tizi",
    system: {
      basicAttackProfiles: [...spent],
      // High enough that no Foundation is shut, which is a different rule being tested
      // elsewhere.
      attributes: { force: { score: 5 }, magic: { score: 5 } },
      tierOfPower: 1,
      baseTierOfPower: 1,
      capacity: { max: 40, remaining: 40, spent: 0 },
      ki: { value: 40 },
      effects: { slots: {} }
    },
    async update(changes) {
      for (const [key, value] of Object.entries(changes)) {
        if (key === "system.basicAttackProfiles") this.system.basicAttackProfiles = value;
      }
    }
  };
}

const BASIC = { id: "basic-attack", name: "Basic Attack", profile: "any", attacking: true };
const SIGNATURE = { id: "wolf-fang-fist", name: "Wolf Fang Fist", profile: "any", attacking: true };
const FOUNDATIONS = {
  physical: { label: "Physical" },
  energy: { label: "Energy" },
  magic: { label: "Magic" }
};

// A Profile that is not Simple, taken from the list rather than named, so this does not
// quietly stop testing anything if the Profiles are renamed.
const LIMITED = Object.keys(PROFILES).find(id => id !== "simple");

// --- The rule ------------------------------------------------------------------------
{
  check("a Profile not yet used is allowed",
    whyNotThisProfile(makeActor(), BASIC, LIMITED), "");

  const spent = whyNotThisProfile(makeActor([LIMITED]), BASIC, LIMITED);
  check("one already used through a Basic Attack is refused", Boolean(spent), true);
  check("and the refusal names the Profile and the character", [
    spent.includes(PROFILES[LIMITED].label), spent.includes("Tizi"),
    spent.includes("Combat Round")
  ], [true, true, true]);

  // "...except for the Simple Profile."
  check("the Simple Profile is never refused",
    whyNotThisProfile(makeActor(["simple"]), BASIC, "simple"), "");

  // "when using a Basic Attack Maneuver". A Signature Technique with the same Profile is
  // a different Maneuver and is not limited by this - nor does using one spend it.
  check("another Maneuver is not limited by it",
    whyNotThisProfile(makeActor([LIMITED]), SIGNATURE, LIMITED), "");

  // Asked with nothing to ask about.
  check("no Profile, nothing to refuse", whyNotThisProfile(makeActor(), BASIC, ""), "");
  check("no character, nothing to refuse", whyNotThisProfile(null, BASIC, LIMITED), "");
}

// --- Recording it --------------------------------------------------------------------
{
  const actor = makeActor();
  await recordProfileUse(actor, BASIC, LIMITED);
  check("a Basic Attack's Profile is recorded", actor.system.basicAttackProfiles, [LIMITED]);

  // Twice is once: the tally is what has been used, not how often.
  await recordProfileUse(actor, BASIC, LIMITED);
  check("and recorded once", actor.system.basicAttackProfiles, [LIMITED]);

  await recordProfileUse(actor, BASIC, "simple");
  check("the Simple Profile is not recorded at all",
    actor.system.basicAttackProfiles, [LIMITED]);

  const other = makeActor();
  await recordProfileUse(other, SIGNATURE, LIMITED);
  check("nor is a Profile used through another Maneuver",
    other.system.basicAttackProfiles, []);

  // Only inside a Combat Round, and the caller is what knows: there are no rounds
  // outside an Encounter, so nothing would clear the tally and a Profile used once out
  // of combat would be spent for ever.
  check("the caller records only inside a Combat Round",
    USE.includes("if (game.combat?.started) await recordProfileUse(actor, maneuver, declared?.profile);"),
    true);
}

// --- Given back with the round -------------------------------------------------------
{
  const actor = makeActor([LIMITED, "crushing"]);
  const changes = newRoundFor(actor);
  check("a new Combat Round hands every Profile back",
    changes["system.basicAttackProfiles"], []);

  // Stored, since it has to survive a reload mid-Encounter.
  check("and it is a field on the character",
    /schema\.basicAttackProfiles = new fields\.ArrayField\(/.test(MODEL), true);
  check("holding Profile ids",
    /schema\.basicAttackProfiles[\s\S]{0,200}?new fields\.StringField\(\{ required: true, blank: false \}\)/
      .test(MODEL), true);
}

// --- What the picker actually shows --------------------------------------------------
{
  const actor = makeActor([LIMITED]);
  shown = null;
  await pickProfileOnly(BASIC, FOUNDATIONS, "", actor);
  const html = shown?.content ?? "";

  check("the picker was opened", Boolean(html), true);

  // The spent one is drawn rather than left off: a missing row reads as a bug.
  check("the spent Profile is still listed",
    html.includes(`value="${LIMITED}"`), true);

  // One row per Profile, and exactly one of them is the spent one.
  const rows = html.split('class="dbu-profile-option');
  const spentRows = rows.filter(row => row.startsWith(" dbu-profile-spent"));
  check("exactly one row is marked spent", spentRows.length, 1);
  check("it is that Profile's row", spentRows[0].includes(`value="${LIMITED}"`), true);
  check("its radio cannot be chosen", /disabled/.test(spentRows[0]), true);
  check("it says why on the row", spentRows[0].includes(PROFILE_SPENT_LABEL), true);
  check("and carries the whole reason as well",
    spentRows[0].includes("already used the"), true);

  // And it is never the one that starts selected, or confirming straight away would
  // confirm something the rules refuse.
  check("nothing spent starts selected", /checked/.test(spentRows[0]), false);
  const checkedRows = rows.filter(row => /<input[^>]*checked/.test(row));
  check("exactly one row starts selected", checkedRows.length, 1);
  check("and it is one that can be used", /disabled/.test(checkedRows[0]), false);

  // The other Profiles are untouched.
  check("nothing else is marked spent",
    rows.filter(row => row.includes("dbu-profile-spent-note")).length, 1);

  // The Simple Profile stays available even after it has been used, so there is always
  // something to choose.
  shown = null;
  await pickProfileOnly(BASIC, FOUNDATIONS, "", makeActor(["simple"]));
  check("a used Simple Profile is still offered",
    (shown?.content ?? "").includes("dbu-profile-spent"), false);

  // And another Maneuver's picker is not limited at all.
  shown = null;
  await pickProfileOnly(SIGNATURE, FOUNDATIONS, "", makeActor([LIMITED]));
  check("another Maneuver's picker offers everything",
    (shown?.content ?? "").includes("dbu-profile-spent"), false);

  check("and a spent row looks spent", [
    CSS.includes(".dbu-profile-option.dbu-profile-spent"),
    CSS.includes(".dbu-profile-spent-note")
  ], [true, true]);
}

// --- The route that does not go through the picker -----------------------------------
{
  // The Energy Charge Maneuver declares the Profile in advance, and what it declared can
  // be spent in between by a Cross Counter's Out-of-Sequence Basic Attack. So the
  // refusal is checked again once the Profile is settled.
  check("the declaration is checked against the rule",
    USE.includes("const profileSpent = declared && whyNotThisProfile(actor, maneuver, declared.profile);"),
    true);
  check("and refused by name", USE.includes("ui.notifications.warn(profileSpent);"), true);

  // Before anything is paid, so a refused declaration costs nothing - the same place the
  // reach, the Foundation and the Absolute Attack limit are checked.
  // Anchored on the calls this path actually makes, not the first of their name in the
  // file: the Surge and Energy Charge branches above pay for themselves too, and it was
  // those that the first version of these two assertions was measuring against.
  const declaredPath = "maneuverKiCost(maneuver, declared, actor)";
  const takesActions = "await payActions(actor, maneuver, actionsSpent);";
  check("before anything is paid",
    USE.indexOf("const profileSpent") < USE.indexOf(declaredPath), true);
  check("and before the Actions are taken",
    USE.indexOf(takesActions, USE.indexOf("const profileSpent")) > 0, true);

  // Recorded after, once the Maneuver is certain to happen.
  const records = "await recordProfileUse(actor, maneuver, declared?.profile);";
  check("recorded once it is certain to happen",
    USE.indexOf(records) > USE.indexOf(takesActions), true);
}

// --- Said in the file, where an author looks -----------------------------------------
{
  const trait = fs.readFileSync(
    path.join(ROOT, "traits", "maneuvers", "basic-attack.dbu"), "utf8");
  // Half the sentence, because the file wraps in the middle of it - the whole of it is
  // checked through the parser in entries.mjs, which is where the wrapping is undone.
  check("Basic Attack's entry still quotes the rule",
    trait.includes("You can only use each Profile once per Combat"), true);
  // The note saying nothing enforced it is gone, because something does now.
  check("and the file no longer says nothing enforces it",
    trait.includes("not enforced"), false);
}

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
