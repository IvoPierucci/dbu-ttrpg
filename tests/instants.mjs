/**
 * An Instant Maneuver cannot follow another Instant.
 *
 * What frees you is using a Maneuver of some other kind *yourself*. It used to be read
 * off the message log instead - "did you answer the most recent Standard Maneuver" -
 * and the most recent one belongs to whoever played it, so somebody else taking their
 * turn handed you a second Instant.
 *
 * The exception is the interesting part: an Out-of-Sequence Maneuver counts as that
 * other Maneuver, unless the thing that offered it was the Instant still holding you.
 * Without that, an Instant granting an Out-of-Sequence Maneuver would launder itself
 * into permission for the next Instant, for ever.
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
// The warning an unrecognised kind prints is the point of that case, not noise to read.
console.warn = () => {};

const { recordManeuverType, whyNotAnotherInstant } = await import(modUrl("maneuvers.mjs"));

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

/** An Actor as far as these two functions read one. */
function fighter(name = "Goku") {
  return {
    name,
    system: { instantPlayed: { held: false, messageId: "" } },
    async update(changes) {
      if ("system.instantPlayed" in changes) {
        this.system.instantPlayed = changes["system.instantPlayed"];
      }
    }
  };
}

const blocked = actor => Boolean(whyNotAnotherInstant(actor));

// --- The rule ----------------------------------------------------------------
{
  const goku = fighter();
  check("nothing is in the way to begin with", blocked(goku), false);

  await recordManeuverType(goku, "instant", { messageId: "m1" });
  check("having played one, you may not play another", blocked(goku), true);
  check("and it says why",
    whyNotAnotherInstant(goku), "Your last Maneuver this Turn was an Instant. Use another kind first.");

  await recordManeuverType(goku, "standard", { messageId: "m2" });
  check("using a Standard Maneuver frees you", blocked(goku), false);
}

// A Counter is another kind too.
{
  const goku = fighter();
  await recordManeuverType(goku, "instant", { messageId: "m1" });
  await recordManeuverType(goku, "counter");
  check("so does a Counter Maneuver", blocked(goku), false);
}

// --- The bug that started this -----------------------------------------------
// Somebody else playing a Standard Maneuver is not you using one. The old reading -
// "did you answer the most recent Standard Maneuver" - said otherwise, because the
// most recent one stopped being the one you had answered.
{
  const goku = fighter("Goku");
  const vegeta = fighter("Vegeta");

  await recordManeuverType(goku, "instant", { messageId: "m1" });
  await recordManeuverType(vegeta, "standard", { messageId: "m2" });

  check("another character's Standard Maneuver frees nobody but them",
    [blocked(goku), blocked(vegeta)], [true, false]);
}

// Nor does a whole round of other people acting.
{
  const goku = fighter();
  await recordManeuverType(goku, "instant", { messageId: "m1" });
  for (const other of ["Vegeta", "Piccolo", "Krillin"]) {
    await recordManeuverType(fighter(other), "standard", { messageId: `m-${other}` });
  }
  check("nor does a whole round of them", blocked(goku), true);
}

// --- Out of Sequence ----------------------------------------------------------
// It counts as another Maneuver, which is what the rule says - with one exception.
{
  const goku = fighter();
  await recordManeuverType(goku, "instant", { messageId: "m1" });
  await recordManeuverType(goku, "outOfSequence", { messageId: "m9" });
  check("one triggered by something else frees you", blocked(goku), false);
}

{
  const goku = fighter();
  await recordManeuverType(goku, "instant", { messageId: "m1" });
  await recordManeuverType(goku, "outOfSequence", { messageId: "m1" });
  check("but one the same Instant offered does not", blocked(goku), true);
}

// And it cannot be laundered twice: the second attempt is still the same card.
{
  const goku = fighter();
  await recordManeuverType(goku, "instant", { messageId: "m1" });
  await recordManeuverType(goku, "outOfSequence", { messageId: "m1" });
  await recordManeuverType(goku, "outOfSequence", { messageId: "m1" });
  check("however many times it is tried", blocked(goku), true);
}

// An Out-of-Sequence Maneuver played while nothing is holding you leaves you free.
{
  const goku = fighter();
  await recordManeuverType(goku, "outOfSequence", { messageId: "m1" });
  check("and one played while free changes nothing", blocked(goku), false);
}

// --- Dodging is not a Maneuver ------------------------------------------------
// It costs no Counter Action and it is not one of the four kinds, so it cannot be the
// other Maneuver that frees you.
{
  const goku = fighter();
  await recordManeuverType(goku, "instant", { messageId: "m1" });
  await recordManeuverType(goku, "dodge");
  check("dodging does not free you", blocked(goku), true);
}

// --- One rule, in one place ---------------------------------------------------
{
  const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
  const USE = fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8");
  const SHEET = fs.readFileSync(
    path.join(ROOT, "module", "sheets", "actor-character-sheet.mjs"), "utf8");

  // The inference this replaced read the message log, and is gone from all three.
  check("nothing reads the rule off the message log any more",
    [CHAT, USE, SHEET].map(file => /answeredLatestManeuver/.test(file)),
    [false, false, false]);

  // An Instant played into a card is an Instant played. That path recorded nothing,
  // which is why the log had to be read in the first place.
  check("an Instant played in chat is recorded",
    /recordManeuverType\(actor, "instant", \{ messageId: message\.id \}\)/.test(CHAT), true);
  check("and a Counter played in chat too",
    /recordManeuverType\(actor, "counter"\)/.test(CHAT), true);
  check("and an Out-of-Sequence one, with the card that offered it",
    /recordManeuverType\(actor, "outOfSequence", \{ messageId: message\.id \}\)/.test(CHAT), true);

  // The sheet asks the rule rather than working it out a second way.
  check("the sheet asks the same question", /whyNotAnotherInstant\(this\.actor\)/.test(SHEET), true);

  // Recorded after the card exists, or a sheet-played Instant would hold no card id
  // and the Out-of-Sequence exception could never match.
  check("a Maneuver played from the sheet records the card it made",
    /recordManeuverType\(actor, (outOfSequence \? "outOfSequence" : )?maneuver\.type,\s*\{ messageId: card\?\.id,/.test(USE), true);
}

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
