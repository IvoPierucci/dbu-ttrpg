/**
 * The Moments that belong to nobody's exchange.
 *
 * The Encounter beginning, a round turning over, somebody's turn starting, somebody
 * knocked through a Health Threshold, somebody falling. Automatic effects answered these
 * already and nobody saw it happen. Triggered ones had nowhere at all to be offered -
 * every place this system offers an effect hangs off a card, and these had no card, so a
 * Talent written "when the Combat Round begins, you may..." was waiting on a button that
 * existed nowhere.
 *
 * Two of the five were worse than invisible: `threshold` was never fired at all, and the
 * Steadfast Check it calls for was something a player had to notice on their own sheet.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.argv[2];
const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
const COMBAT = fs.readFileSync(path.join(ROOT, "module", "combat.mjs"), "utf8");
const SHEET = fs.readFileSync(
  path.join(ROOT, "module", "sheets", "actor-character-sheet.mjs"), "utf8");
const MOMENTS = fs.readFileSync(path.join(ROOT, "module", "effects", "moments.mjs"), "utf8");
const CSS = fs.readFileSync(path.join(ROOT, "styles", "dbu-ttrpg.css"), "utf8");

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

const FIVE = ["start-of-encounter", "start-of-round", "start-of-turn", "threshold", "defeated"];

// --- Each of the five is announced ------------------------------------------------
for (const moment of FIVE) {
  check(`${moment} posts a card`, new RegExp(`announce\\("${moment}"`).test(COMBAT), true);
}
check("and each is a Moment the system knows",
  FIVE.filter(moment => !MOMENTS.includes(`key: "${moment}"`)), []);

// One function posts all of them, so they cannot drift into five shapes.
check("through one function",
  (CHAT.match(/export async function postMoment/g) ?? []).length, 1);
check("which is reached without importing chat.mjs as this module loads",
  /const \{ postMoment \} = await import\("\.\/chat\.mjs"\);/.test(COMBAT), true);

// --- What each card says ------------------------------------------------------------
check("the Encounter card says so",
  /title: "Start of the Combat Encounter"/.test(COMBAT), true);
check("the round card counts the round",
  /title: `Start of Combat Round \$\{combat\.round\}`/.test(COMBAT), true);
check("the turn card names whose it is",
  COMBAT.includes("`Start of ${actor.name}'s turn`"), true);
check("the Threshold card says what happened",
  /title: `\$\{actor\.name\} is knocked through a Health Threshold`/.test(COMBAT), true);
check("and which Threshold it was",
  /detail: `\$\{THRESHOLDS\[before\]\.label\} to \$\{THRESHOLDS\[now\]\.label\}`/.test(COMBAT), true);

// --- The Encounter's first round is two cards, not one --------------------------------
// "Al inicio de un combate, el start of encounter y el start of combat round de la
// primera round suceden uno despues del otro."
{
  const start = COMBAT.indexOf('Hooks.on("combatStart"');
  const body = COMBAT.slice(start, COMBAT.indexOf('Hooks.on("combatTurnChange"', start));
  check("starting an Encounter runs both, in that order",
    body.indexOf("startEncounter(combat)") < body.indexOf("startRound(combat)"), true);
  check("and the first turn is begun after both",
    body.indexOf("startRound(combat)") < body.indexOf("beginTurn(first)"), true);
}

// --- Who is offered a button ------------------------------------------------------------
{
  // Recorded when the card is made rather than worked out when it is read: who was in
  // the Encounter when the round turned over is a fact about that moment.
  check("who may answer is recorded on the card",
    /subjects: combatants\(combat\)\.map\(actor => actor\.uuid\)/.test(COMBAT), true);
  check("a turn is its own character's",
    /subjects: \[actor\.uuid\]/.test(COMBAT), true);

  // A Threshold and a defeat are both written so somebody else can answer them, so the
  // whole Encounter is offered the card.
  // The defeat card names the list first, because it also asks it a question - so the
  // two spellings are one fact, and counting one of them was counting half.
  check("a Threshold and a defeat are offered to everyone in the Encounter",
    [/subjects: witnesses\(actor\)/.test(COMBAT),
     /const who = witnesses\(actor\);[\s\S]*?subjects: who,/.test(COMBAT)],
    [true, true]);
  check("which outside an Encounter is just the one character",
    /const others = game\.combat\?\.started \? combatants\(game\.combat\) : \[\];/.test(COMBAT), true);

  // Only characters the reader owns, who still hold something, and who have not answered.
  check("the button is drawn for whoever still holds something",
    /function momentAnswerers\(card\)[\s\S]{0,400}?momentTriggers\(actor, card\)\.length/
      .test(CHAT), true);
  check("and not for somebody who already answered",
    /!\(card\.applied \?\? \[\]\)\.includes\(actor\.uuid\)/.test(CHAT), true);
  check("nor for a character the reader does not own",
    /actor\?\.isOwner\s*\n\s*&& !\(card\.applied/.test(CHAT), true);
}

// --- Only triggered effects are offered ---------------------------------------------------
// An Automatic effect fires by itself; offering it would ask the player to choose
// something that was never theirs to choose. A Karmic Effect is bought, not armed.
check("only triggered effects are offered",
  /function triggersFor[\s\S]{0,700}?\(b\.mode === "triggered"\)/.test(CHAT), true);
check("and never a Karmic Effect, which is bought rather than armed",
  /function triggersFor[\s\S]{0,700}?!entry\.sourceId\.startsWith\("karma:"\)/.test(CHAT), true);

// One definition of "what answers this Moment", shared with the attack card's version.
check("the attack card asks the same question",
  /return triggersFor\(actor, TRIGGER_STAGES\[stage\]\?\.\[side\] \?\? \[\]\);/.test(CHAT), true);

// A Moment written `threshold(bruised)` still answers the Moment of crossing one.
check("a parameterised Moment still matches its Moment",
  CHAT.includes('String(b.moment ?? "").split(/[(/]/)[0]'), true);

// --- The Threshold --------------------------------------------------------------------------
{
  // Nothing fired this before. The Threshold is derived from Life, so crossing one left
  // no trace at all - which is why the card needs a before-and-after.
  check("the Moment is fired where the card is posted",
    /await fireMoment\(actor, "threshold", \{ threshold: now, from: before, knockerUuid: knockedBy \}\);/.test(COMBAT), true);
  check("and where they stood before is captured before the write",
    /options\.dbuThreshold = actor\.system\.threshold\.key;/.test(COMBAT), true);

  // Downward only: healing back up through one is not being knocked through it.
  check("only a crossing downward counts",
    /if \(keys\.indexOf\(now\) <= keys\.indexOf\(before\)\) return;/.test(COMBAT), true);

  // The Check belongs to whoever was knocked through, and is on the card.
  check("the card offers the Steadfast Check",
    /roll\.textContent = "Steadfast Check";/.test(CHAT), true);
  check("to the character it happened to",
    /\(card\.moment === "threshold"\) && subject\?\.isOwner && subject\.system\.threshold\.pending\.length/
      .test(CHAT), true);

  // One definition of the Check, since two places ask for it now.
  check("the Check has one home",
    (CHAT.match(/export async function rollSteadfastCheck/g) ?? []).length, 1);
  check("and the sheet asks for that one",
    /return rollSteadfastCheck\(this\.actor\);/.test(SHEET), true);
  check("rather than rolling its own",
    /new Roll\(STEADFAST_DIE\)/.test(SHEET), false);
}

// --- The defeat -------------------------------------------------------------------------------
{
  // "Si no tenes ninguno, en vez de decir incoming defeat, que diga [character]
  // defeated." So what the card says follows from whether anything can still answer it.
  check("the title says whether anything is still coming",
    /title: pending \? `\$\{actor\.name\} - incoming defeat` : `\$\{actor\.name\} is Defeated`/
      .test(COMBAT), true);
  check("and that is asked of everyone who could answer",
    /: await anybodyAnswers\("defeated", who, actor\.uuid\);/.test(COMBAT), true);

  // A defeat nobody can answer is settled at once: a card saying "incoming" that nobody
  // can act on is a step the table clicks past for nothing.
  check("nothing to wait for means it is settled there and then",
    /if \(!pending\) \{[\s\S]*?await fireMoment\(actor, "defeat-resolved"\);\s*\n[\s\S]*?await petrifierDefeated\(actor\);[\s\S]*?await endShapeshift\(actor, "Defeated"\);\s*\n\s*\}/.test(COMBAT),
    true);
  // And one that can be answered waits, with somebody able to say when it stands.
  check("one that can be answered waits for a button",
    /settle\.textContent = "Settle the defeat";/.test(CHAT), true);
  check("which fires the Moment that was held back",
    /await fireMoment\(actor, "defeat-resolved"\);/.test(CHAT), true);
  check("and only the character's own side or the GM may press it",
    /card\.pending && \(subject\?\.isOwner \|\| game\.user\.isGM\)/.test(CHAT), true);

  // Picked back up in the meantime by the very effects the card was posted to offer.
  check("a character back on their feet settles as that instead",
    /if \(!actor\.system\.defeated\) \{[\s\S]{0,300}?back on their feet/.test(CHAT), true);

  // The two Moments stay apart, which is the whole reason for the wait.
  check("defeated and defeat-resolved are still two Moments",
    /key: "defeat-resolved"/.test(MOMENTS) && /key: "defeated"/.test(MOMENTS), true);
  check("and the bare Defeated line is gone",
    /dbu-check-parts">Defeated</.test(COMBAT), false);
}

// --- The card is written once and read by everyone ---------------------------------------------
{
  // Posted by one client - the GM's, the one that fires the Moments - or it appears once
  // per connected player.
  const guard = /if \(!game\.users\.activeGM \|\| \(game\.users\.activeGM !== game\.user\)\) return;/g;
  check("every hook that posts one is held to a single client",
    (COMBAT.match(guard) ?? []).length >= 5, true);

  // Answering it is recorded through the relay: the card belongs to whoever posted it.
  check("answering goes through the relay",
    /requestEdit\(message, \{\s*\n\s*type: "moment",/.test(CHAT), true);
  check("and the relay knows the edit",
    /case "moment": return applyMoment\(request\.messageId, request\.moment\);/.test(CHAT), true);

  // Nothing here is a Maneuver, so no Instant may answer it.
  check("no Instant may answer a Moment card",
    /\[RESPONDABLE_FLAG\]: false,\s*\n\s*\[MOMENT_FLAG\]/.test(CHAT), true);
}

// --- Where an Encounter starts and stops ------------------------------------------------------------
// The log had somebody's turn starting above the Encounter that had not started yet.
// Pressing Begin Combat moves the turn from nowhere to the first combatant, and Foundry
// reports that as a turn change - which arrives before `combatStart` does. There are no
// turns before an Encounter, because there is no Encounter for them to be turns of.
{
  const body = /Hooks\.on\("combatTurnChange"[\s\S]*?\n  \}\);/.exec(COMBAT)?.[0] ?? "";

  check("a turn change before the Encounter has begun is ignored",
    body.includes("if (!combat.started) return;"), true);
  check("and it is refused before anything is fired",
    body.indexOf("if (!combat.started) return;") < body.indexOf("fireMoment"), true);
  // By the time Foundry reports the first turn the Round is already 1, so `started` does not catch it: the turn
  // coming out of Round 0 is left to the combatStart handler, which begins it after the Encounter and the Round.
  check("nor the first turn, which the combatStart handler begins itself",
    body.includes("if (!(Number(previous?.round) > 0)) return;")
      && (body.indexOf("if (!(Number(previous?.round) > 0)) return;") < body.indexOf("fireMoment")), true);

  // So the first three lines of an Encounter are the Encounter, its first round, and the
  // first turn - in that order and once each.
  const startBody = COMBAT.slice(COMBAT.indexOf('Hooks.on("combatStart"'),
    COMBAT.indexOf('Hooks.on("combatTurnChange"'));
  check("the Encounter announces itself before its first round",
    startBody.indexOf("startEncounter(combat)") < startBody.indexOf("startRound(combat)"), true);
  check("and its first turn after both",
    startBody.indexOf("startRound(combat)") < startBody.indexOf("beginTurn(first)"), true);

  // And it is closed, so a log scrolled back through has an end to each Encounter as
  // well as a beginning.
  check("the Encounter is closed in chat",
    /title: "End of the Combat Encounter"/.test(COMBAT), true);
  check("with how long it ran",
    /detail: rounds \? `\$\{rounds\} round\$\{\(rounds === 1\) \? "" : "s"\}` : ""/.test(COMBAT),
    true);

  // Read before the Combat is gone, said after the clearing: what is announced is that
  // it is over, and it is not over until that has happened.
  const deleteBody = /Hooks\.on\("deleteCombat"[\s\S]*?\n  \}\);/.exec(COMBAT)?.[0] ?? "";
  // The clearing is each character's Encounter ended (endEncounterFor), the sheet's New encounter's too.
  check("the round count is read before the clearing",
    deleteBody.indexOf("const rounds = combat.round") < deleteBody.indexOf("await endEncounterFor(actor)"), true);
  check("and the line comes after it",
    deleteBody.indexOf("await endEncounterFor(actor)") < deleteBody.indexOf("announceEncounterEnd"), true);

  // Nothing in the rules happens at the end of an Encounter, so it is a marker rather
  // than a Moment - and carries nobody to answer it.
  check("nothing is offered on it", /subjects: \[\]/.test(COMBAT), true);
  check("and it is deliberately not a Moment the effects system knows",
    MOMENTS.includes('key: "end-of-encounter"'), false);
}

// --- A skipped turn is still a turn ---------------------------------------------------------------
// Both of its edges arrive, because a duration measured from either one has to end
// somewhere. A Defeated character lying in the Initiative Order would otherwise keep
// every buff on them for the rest of the Encounter.
//
// This function used to hold the question three ways at once: a turn skipped for being
// Defeated fired no `start-of-turn` but fired `end-of-turn` anyway, a turn skipped by the
// Determined State fired both, and the first turn of an Encounter checked nothing at all -
// so a Defeated character standing first in the Order was handed a turn.
{
  const GUIDE = fs.readFileSync(path.join(ROOT, "WRITING-EFFECTS.txt"), "utf8");

  check("a turn begins in one place",
    (COMBAT.match(/async function beginTurn\(actor\)/g) ?? []).length, 1);

  // Both callers go through it, so the first turn of an Encounter cannot behave
  // differently from every turn after it.
  check("the first turn of the Encounter goes through it",
    /\(isCharacter\(first\)\) && !await beginTurn\(first\)/.test(COMBAT), true);
  check("and so does every turn after it",
    /\(isCharacter\(arriving\)\) && !await beginTurn\(arriving\)/.test(COMBAT), true);
  check("with nothing left deciding a skip on its own",
    /if \(arriving\.system\.defeated \|\| arriving\.system\.effects/.test(COMBAT), false);

  // The Moment fires before anything is decided: something may take the turn away as it
  // begins rather than for as long as it lasts, so its answer is read after.
  const body = /async function beginTurn[\s\S]*?\n\}/.exec(COMBAT)?.[0] ?? "";
  check("the edge arrives before the skip is decided",
    body.indexOf('fireMoment(actor, "start-of-turn")') < body.indexOf("const skipped"), true);

  // All three reasons a turn can be lost, answered the same way.
  check("being Defeated skips the turn", body.includes("Boolean(actor.system.defeated)"), true);
  check("so does a standing skipTurn",
    body.includes('actor.system.effects?.slots?.skipTurn === true'), true);
  check("and so does one taken away as the turn begins",
    body.includes('slots["turn.skip"] === true'), true);

  // The edge arrives whether or not the turn is taken.
  check("the edge arrives either way",
    body.indexOf("const skipped") < body.indexOf("announceTurn(actor, { skipped"), true);
  check("and the card says which it was",
    /title: skipped\s*\n\s*\? `\$\{actor\.name\}'s turn is skipped`/.test(COMBAT), true);

  // The rule an author reads.
  check("the guide settles what \"your next turn\" means",
    GUIDE.includes("still has that edge ahead of it"), true);
  check("and says the two start-of durations are one",
    GUIDE.includes("the same duration written"), true);
  check("and that a skipped turn still counts",
    GUIDE.includes("A skipped turn is still your turn"), true);
  check("the Moment says so where it is declared",
    /key: "start-of-turn"[\s\S]{0,300}?Fires even when the turn is then skipped/.test(MOMENTS),
    true);
}

// --- Walking into an Encounter already under way -------------------------------------------------
// "Fires when you enter the Encounter, so joining late still earns it." The card is
// posted to the people who were standing there when it began, and somebody who walks in
// afterwards is not one of them - for them it begins when they arrive, which is a moment
// Foundry has no hook for and only they can say.
{
  const MODEL = fs.readFileSync(path.join(ROOT, "module", "data", "actor-character.mjs"), "utf8");
  const TEMPLATE = fs.readFileSync(
    path.join(ROOT, "templates", "parts", "actor-combat.hbs"), "utf8");

  check("whether they have taken it is recorded",
    /schema\.enteredEncounter = new fields\.BooleanField\(\{ required: true, initial: false \}\)/
      .test(MODEL), true);

  // Standing in it when it begins is one way of entering it, so those characters have
  // already had theirs and the button has nothing to offer them.
  check("being there when it begins counts as entering",
    /"system\.enteredEncounter": true,/.test(COMBAT), true);
  check("and leaving the Encounter gives it back",
    /"system\.enteredEncounter": false,/.test(COMBAT), true);
  // The sheet's New encounter ends the one before as the tracker's end does (the user's: an Encounter-long penalty stayed).
  check("as does the sheet's own new-encounter button",
    /const \{ endEncounterFor \} = await import\("\.\.\/combat\.mjs"\);\s*return endEncounterFor\(this\.actor\);/.test(SHEET), true);

  // One door. The sheet asks chat.mjs rather than firing the Moment itself - two ways in
  // would mean two answers to "what does the start of an Encounter do to you".
  check("the rule has one home",
    (CHAT.match(/export async function enterEncounter/g) ?? []).length, 1);
  check("and the sheet asks for it",
    /return enterEncounter\(this\.actor\);/.test(SHEET), true);
  check("rather than firing the Moment on its own",
    /fireMoment\([^)]*"start-of-encounter"/.test(SHEET), false);

  // Both halves, the same two the card offers: what fires by itself, and what the player
  // chooses. Offering only the second would quietly drop every automatic effect.
  const body = /export async function enterEncounter[\s\S]*?\n\}/.exec(CHAT)?.[0] ?? "";
  check("it fires the automatic half",
    body.includes('fireMoment(actor, "start-of-encounter")'), true);
  check("and offers the chosen half",
    body.includes('triggersFor(actor, ["start-of-encounter"])'), true);
  check("through the same dialog the card uses", body.includes("prepareRoll(actor, triggers"), true);

  // Once. Taken is taken, whether or not anything answered it - what the flag means is
  // that this character has had their start of the Encounter, not that it was worth
  // something.
  check("a second attempt does nothing",
    body.includes("if (!actor || actor.system.enteredEncounter) return false;"), true);
  check("and it is recorded even when nothing answered",
    body.indexOf('"system.enteredEncounter": true') > body.indexOf("prepareRoll"), true);

  // The button is on the sheet until it is taken, and not gated on the tracker: a table
  // running an Encounter without a Combat in it still has an Encounter.
  check("the button waits on the flag alone",
    /context\.canEnterEncounter = !this\.actor\.system\.enteredEncounter;/.test(SHEET), true);
  // On the Settings tab since the Combat tab's new layout (the user's).
  const SETTINGS = fs.readFileSync(path.join(ROOT, "templates", "parts", "actor-settings.hbs"), "utf8");
  check("and the sheet draws it",
    /\{\{#if canEnterEncounter\}\}/.test(SETTINGS)
      && /data-action="enterEncounter"/.test(SETTINGS), true);
}

// --- It is drawn ---------------------------------------------------------------------------------
check("the card is rendered", /renderMoment\(message, html\);/.test(CHAT), true);
check("and styled",
  [".dbu-moment", ".dbu-moment-title", ".dbu-moment-detail"].every(rule => CSS.includes(rule)),
  true);

// --- Every chat button has a palette to read ---------------------------------------------------
// A button in the shared rule but not in the palette above it is worse off than one in
// neither: rgba(var(--dbu-action), 0.24) with nothing to resolve is invalid at
// computed-value time, so the background and the border are dropped and what is left is a
// transparent rectangle on a dark card. It happened to both buttons that are drawn
// straight into .message-content rather than inside a card to inherit from.
{
  const ruleFor = marker => {
    const at = CSS.indexOf(marker);
    if (at < 0) return { selectors: [], body: "" };
    // Backwards: the declaration is inside its rule, so the brace that opens it is
    // behind the marker. Looking forward finds the next rule's, and reports that rule's
    // selectors as the ones missing a palette.
    const open = CSS.lastIndexOf("{", at);
    const start = CSS.lastIndexOf("}", open) + 1;
    return {
      selectors: CSS.slice(start, open).split(",")
        .map(part => part.trim()).filter(part => part.startsWith(".")),
      body: CSS.slice(open, CSS.indexOf("}", open))
    };
  };

  const palette = ruleFor("--dbu-action: 74, 118, 176;");
  const buttons = ruleFor("border: 1px solid rgba(var(--dbu-action), 0.7);");

  check("the palette rule was found", palette.selectors.length > 0, true);
  check("and the rule that reads it", buttons.selectors.length > 0, true);

  const unpainted = buttons.selectors.filter(sel => !palette.selectors.includes(sel));
  check("every button that reads --dbu-action is given one", unpainted, []);

  // The Out-of-Sequence button then overrides it: the accent yellow rather than the blue
  // the rest share, because it is a chance handed to somebody who is not acting.
  check("and the Out-of-Sequence button is the accent yellow",
    /\.dbu-oos-button \{\s*--dbu-action: 245, 166, 35;\s*\}/.test(CSS), true);
  check("which is the accent this system uses everywhere else",
    CSS.includes("--dbu-accent: #f5a623;"), true);
}

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
