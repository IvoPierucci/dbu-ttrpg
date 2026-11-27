/**
 * What an effect can forbid, and whether anything is listening.
 *
 * Nine things could be forbidden and six of them were read by nobody. Transfigured
 * forbade Signature Techniques and Unique Abilities and neither noticed; Stress
 * Exhaustion forbade Transformations and none were stopped; Pinned and Staggered forbade
 * movement. Every one of those looked right in its file, compiled, and did nothing -
 * which is the bug this whole language exists to prevent and the one it kept having.
 *
 * The Spectator State is what found it: four of its five effects are forbids, and
 * writing them would have produced a State that read perfectly and stopped nothing.
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

const { getSlot } = await import(modUrl("effects/slots.mjs"));
const { permits } = await import(modUrl("effects/interpreter.mjs"));

const SLOTS = fs.readFileSync(path.join(ROOT, "module", "effects", "slots.mjs"), "utf8");
const USE = fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8");
const STATE = fs.readFileSync(path.join(ROOT, "traits", "states", "spectator.dbu"), "utf8");
const INDEX = JSON.parse(fs.readFileSync(path.join(ROOT, "traits", "index.json"), "utf8"));

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

// --- Every flag that can be forbidden is read by something ---------------------------
// The whole point. A name nobody reads is an effect that does nothing, and it has to be
// caught here rather than discovered at the table.
{
  const forbiddable = [...SLOTS.matchAll(/\{ key: "([\w.]+)", phase: PHASES\.\w+, kind: F,\s*\n?\s*ops: \["allow", "forbid", "set"\]/g)]
    .map(m => m[1]);
  const alsoOneLine = [...SLOTS.matchAll(/\{ key: "([\w.]+)", phase: PHASES\.\w+, kind: F, ops: \["allow", "forbid", "set"\] \}/g)]
    .map(m => m[1]);
  const named = [...new Set([...forbiddable, ...alsoOneLine])];

  // A flag that fans out is read through what it fans out to. `unnatural` is the first:
  // forbidding it forbids Suffocating and Poisoned, and those two are what everything
  // asks about - so looking for a reader of `unnatural` itself would be looking for the
  // thing this deliberately does not have.
  //
  // Named rather than skipped silently, and its targets are checked instead, so this is
  // an exception with a shape rather than a hole.
  // One entry at a time, from its own key to the start of the next. A single pattern
  // spanning both was worse than useless: the lazy middle let an earlier key bind to a
  // later entry's `fanOut`, so it reported two keys that have none and missed the one
  // that does.
  const entryOf = key => {
    const at = SLOTS.indexOf(`{ key: "${key}"`);
    if (at < 0) return "";
    const next = SLOTS.slice(at + 1).search(/\n  \{ (key|match): /);
    return (next < 0) ? SLOTS.slice(at) : SLOTS.slice(at, at + 1 + next);
  };

  const fansOut = new Map(named
    .map(key => [key, [...entryOf(key).matchAll(/fanOut: \[([^\]]+)\]/g)]])
    .filter(([, found]) => found.length)
    .map(([key, found]) => [key,
      [...found[0][1].matchAll(/"([\w.]+)"/g)].map(t => t[1])]));

  check("the flags that fan out instead of being read",
    named.filter(key => fansOut.has(key)), ["unnatural"]);
  check("and what unnatural fans out to",
    fansOut.get("unnatural"), ["condition.suffocating", "condition.poisoned"]);

  // A piece's own flags are not the character's to be forbidden: they say what a built Item is,
  // and are read off the piece in gear.mjs - each one there, by its key. A Weapon's likewise,
  // read off it for the attack made with it.
  const ownFlag = key => key.startsWith("piece.") || key.startsWith("weapon.");
  const pieceFlags = named.filter(ownFlag);
  const GEAR = fs.readFileSync(path.join(ROOT, "module", "gear.mjs"), "utf8");
  check("a piece's flags are there, and each is read off the piece",
    [pieceFlags.length > 0, pieceFlags.filter(key => !GEAR.includes(`["${key}"]`)
      && !GEAR.includes(`flag("${key}")`))], [true, []]);

  const all = named.filter(key => !fansOut.has(key) && !ownFlag(key));

  check("there are flags to forbid at all", all.length > 0, true);

  // Read somewhere in the system. Two are exceptions and both say so in their own docs:
  // this system does not move anybody, and it does not track who you were told to
  // attack - the table chose to keep that one. Said rather than enforced is a fine
  // answer; said and silently dropped is not, which is what the other six were.
  const CODE = ["chat.mjs", "use-maneuver.mjs", "combat.mjs", "conditions.mjs",
                "maneuvers.mjs", "breath.mjs"]
    .map(f => fs.readFileSync(path.join(ROOT, "module", f), "utf8")).join("\n")
    + fs.readFileSync(path.join(ROOT, "module", "data", "actor-character.mjs"), "utf8");

  // Read means consumed, not "these letters appear somewhere in the file". The plain
  // substring test started passing for `movement` the day a chat flag was named
  // `"movement"` - which reads nothing and forbids nothing, and would have quietly
  // retired this check for that key.
  //
  // Two shapes consume one: an argument to `permits`, and a row of the `refused` table,
  // which is four of them asked in one loop rather than four calls.
  const asked = new Set([...CODE.matchAll(/permits\([^,)]+,\s*`?"?([\w.$]+)/g)].map(m => m[1]));

  const USE = fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8");
  const tableAt = USE.indexOf("const refused = [");
  const table = (tableAt < 0) ? "" : USE.slice(tableAt, USE.indexOf("];", tableAt));
  for (const [, key] of table.matchAll(/"([\w.]+)"/g)) asked.add(key);

  check("the refused table is where it is expected", table.length > 0, true);

  const unread = all.filter(key => !asked.has(key));
  check("and nothing is forbidden into thin air, bar the two that say why",
    unread, ["movement", "attacksOnOthers"]);

  // And those two say it where an author would look, rather than only here. Read as a
  // slice of the file from the key onwards: a pattern built out of the key's own name
  // has to be escaped twice over and is not worth the trouble.
  for (const key of unread) {
    const at = SLOTS.indexOf(`key: "${key}"`);
    const doc = (at < 0) ? "" : SLOTS.slice(at, at + 400);
    check(`${key} says it is the table's to enforce`,
      doc.includes("to the table, not enforced"), true);
  }
}

// --- The ones the Spectator State needed ---------------------------------------------
{
  // A forbidden flag is stored as the literal false, which is what permits() reads:
  // "not mentioned" and "allowed" are the same answer, and only an explicit forbid says
  // no.
  check("nothing forbidden is allowed", permits({}, "uniqueAbilities"), true);
  check("and forbidding it refuses",
    permits({ uniqueAbilities: false }, "uniqueAbilities"), false);
  check("while allowing it says so too",
    permits({ uniqueAbilities: true }, "uniqueAbilities"), true);

  for (const [what, flag, tag] of [
    ["Signature Techniques", "signatureTechniques", "signature"],
    ["Unique Abilities", "uniqueAbilities", "uniqueAbility"],
    ["Transformations", "transformations", "transformation"]
  ]) {
    check(`${what} are recognised by their tag`,
      USE.includes(`(maneuver.tags ?? []).includes("${tag}"), "${flag}"`)
        || USE.includes(`(maneuver.tags ?? []).includes("${tag}") || Boolean(maneuver.godFinisher), "${flag}"`)
        // A Bestial Trait's Unique Ability, used even in the Feral State.
        || USE.includes(`(maneuver.tags ?? []).includes("${tag}") && !feralBestial, "${flag}"`), true);
  }

  check("and Attacking Maneuvers by what they are",
    USE.includes('[maneuver.attacking, "attackingManeuvers"'), true);

  // Named outright, for a rule that lists Maneuvers rather than describing them.
  check("a Maneuver can be forbidden by name",
    Boolean(getSlot("maneuver.energy-charge")), true);
  check("and the gate asks for it",
    USE.includes("!permits(slots, `maneuver.${maneuver.id}`)"), true);

  // The one that cannot be judged at the gate: nothing knows the Foundation until it has
  // been declared, which is why it was the only one left over.
  check("a non-Physical attack is judged once the Foundation is declared",
    /declared && \(declared\.foundation !== "physical"\)\s*\n\s*&& !permits\([^)]*"nonPhysicalAttacks"\)/
      .test(USE), true);
  check("after the Foundation's own demand, not before",
    USE.indexOf("whyNotThisFoundation(actor, declared.foundation")
      < USE.indexOf('"nonPhysicalAttacks"'), true);
}

// --- The Spectator State -----------------------------------------------------------------
{
  check("it is a State", /^kind: state$/m.test(STATE), true);
  check("and listed", INDEX.traits.includes("states/spectator.dbu"), true);

  // (2): asked as the turn begins, before its Moment - so (3) reads whether it was taken.
  const COMBAT = fs.readFileSync(path.join(ROOT, "module", "combat.mjs"), "utf8");
  const CHAT_S = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
  check("its second effect is asked before the turn's Moment",
    COMBAT.indexOf("spectatorTurnStart(actor)") < COMBAT.indexOf('fireMoment(actor, "start-of-turn")'), true);
  check("and leaving is what it does", CHAT_S.includes('return leaveState(actor, "spectator");'), true);

  // (4): the forbids, the three Maneuvers named by name and the classes.
  for (const line of [
    "forbid maneuver.power-up;",
    "forbid maneuver.transformation;",
    "forbid maneuver.energy-charge;",
    "forbid attackingManeuvers;",
    "forbid specialManeuvers;",
    "forbid uniqueAbilities;"
  ]) {
    check(`it forbids: ${line}`, STATE.includes(line), true);
  }
  check("closing the class, not one Maneuver by name",
    /forbid maneuver.special/.test(STATE), false);

  // (3) fires by itself, once (2) has been asked.
  check("its third effect fires by itself",
    /\[automatic\/start-of-turn\]/.test(STATE), true);
  for (const line of ["actions.remaining = 0;", "turn.skip = true;",
                      "life.value += 2d10(bT);", "ki.value += 2d10(bT);"]) {
    check(`and does: ${line}`, STATE.includes(line), true);
  }

  // (1) the Ally's Cheered, (5) no other Triggered effect at a turn's or a Round's start.
  check("(1) an Ally Cheered, off as it is left",
    ["spectatorCheer();", "spectatorLeft();"].every(line => STATE.includes(line)), true);
  const RUNTIME = fs.readFileSync(path.join(ROOT, "module", "effects", "moments-runtime.mjs"), "utf8");
  check("(5) held at the Moment and on its card",
    [RUNTIME.includes("let entries = spectatorHeld(actor, moment,"), CHAT_S.includes('|| !["start-of-turn", "start-of-round"].includes(card.moment) || (entry.sourceId === "state:spectator"));')],
    [true, true]);

  // The published text of all five is in the file, so nothing is lost while they wait.
  check("and the published text carries all five",
    ["(1)-[Triggered/Spectator", "(2)-[Triggered/Start of Turn", "(3)-[Automatic/Start of Turn",
     "(4)-[Passive]", "(5)-[Passive]"].filter(part => !STATE.includes(part)), []);
}

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
