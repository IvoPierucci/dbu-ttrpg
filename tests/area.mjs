/**
 * One attack, several people, one Strike Roll.
 *
 * An Area of Effect used to post a card each, which made it several attacks wearing one
 * name: several Strike Rolls, several Wound Rolls, and a Maneuver counted once per
 * person it caught. Everyone it reaches answers the same Strike and the same Wound Roll
 * now, and what differs is what each of them did about it.
 *
 * So what is checked here is the branching: that one person's defence settles their own
 * line and nobody else's, and that the shared rolls stay shared. A Power Flare that
 * beats the Wound Roll takes the Damage off whoever flared, and the rest still take
 * theirs - which is the case the old shape could not express at all.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");

const APP = (process.env.FOUNDRY_APP || String.raw`C:\Program Files\Foundry Virtual Tabletop\resources\app`);
globalThis.foundry = {};
await import(pathToFileURL(path.join(APP, "common/primitives/_module.mjs")).href);
globalThis.foundry.utils =
  { ...await import(pathToFileURL(path.join(APP, "common/utils/_module.mjs")).href) };

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

/** The two accessors the card and the resolution share. */
const targetResult = (attack, uuid) =>
  (attack.result?.targets ?? []).find(entry => entry.uuid === uuid) ?? null;
const attackTargets = attack =>
  attack.targets ?? [{ uuid: attack.targetUuid, name: attack.targetName }];
const targetResults = attack =>
  attackTargets(attack).map(t => ({ ...t, own: targetResult(attack, t.uuid) }));

/** An attack after the Strike has been rolled and each of them has answered it. */
const exchange = (strikeTotal, answers) => ({
  targetUuid: "a",
  targets: Object.keys(answers).map(uuid => ({ uuid, name: uuid.toUpperCase() })),
  damageCategory: "standard",
  result: {
    strike: { total: strikeTotal },
    targets: Object.entries(answers).map(([uuid, own]) => ({ uuid, ...own }))
  }
});

// --- The Strike is one roll ---------------------------------------------------
// Three people, one number to beat. Two of them beat it and one did not, and that is
// three different answers to one Strike rather than three Strikes.
{
  const attack = exchange(14, {
    a: { answer: { total: 16 }, hit: false },
    b: { answer: { total: 11 }, hit: true },
    c: { answer: null, hit: true, forced: "B is hit automatically" }
  });

  check("one Strike Roll, however many it reached",
    Object.keys(attack.result).includes("strike")
      && !attack.result.targets.some(own => own.strike),
    true);

  check("and each of them lands or misses on their own",
    targetResults(attack).map(entry => entry.own.hit), [false, true, true]);
}

// --- The Wound Roll is one roll, and Power Flare answers it for one person ------
// "Power Flare defends only the defender: if the one defending with Power Flare wins,
// only they take no damage, the rest still take it."
{
  const wound = { total: 30 };
  const attack = {
    ...exchange(14, {
      a: { hit: true, defense: "powerFlare", counterWound: { total: 33 },
           effectiveWound: 30, soak: 4, reduction: 0 },
      b: { hit: true, defense: "dodge", counterWound: null,
           effectiveWound: 30, soak: 4, reduction: 0 }
    })
  };
  attack.result.wound = wound;

  // The same arithmetic the Wound step does, per person.
  const damageFor = own => {
    const negated = own.counterWound && (own.counterWound.total > wound.total);
    return negated ? 0 : Math.max(0, own.effectiveWound - own.soak - own.reduction);
  };

  check("a Power Flare that beats the Wound Roll saves the one who flared",
    damageFor(targetResult(attack, "a")), 0);
  check("and leaves everybody else taking theirs",
    damageFor(targetResult(attack, "b")), 26);
}

// A flare that loses saves nobody, including the one who threw it.
{
  const wound = { total: 30 };
  const own = { hit: true, counterWound: { total: 21 }, effectiveWound: 30, soak: 4, reduction: 0 };
  const negated = own.counterWound.total > wound.total;
  check("a flare that loses changes nothing",
    negated ? 0 : own.effectiveWound - own.soak - own.reduction, 26);
}

// --- Applying Damage is per person ---------------------------------------------
// Four people caught by one Maneuver are four amounts, taken by four characters, and
// one of them having been dealt says nothing about the rest.
{
  const attack = exchange(14, {
    a: { hit: true, damage: 12, applied: true },
    b: { hit: true, damage: 7, applied: false },
    c: { hit: false, damage: 0, applied: false }
  });

  check("one of them taking their Damage does not settle the others",
    targetResults(attack).map(entry => entry.own.applied), [true, false, false]);

  // Only those who were hit and have Damage left to take are offered a button.
  const offered = targetResults(attack)
    .filter(entry => entry.own.hit && !entry.own.applied && (entry.own.damage > 0))
    .map(entry => entry.uuid);
  check("and only the ones still owed anything are asked", offered, ["b"]);
}

// --- Nobody is hit twice by one Maneuver ----------------------------------------
// The dialog offers only characters not already in the exchange, and the attacker is
// not among them either.
{
  const attack = exchange(14, { a: {}, b: {} });
  const already = new Set(["attacker", ...attackTargets(attack).map(t => t.uuid)]);
  const scene = ["attacker", "a", "b", "c", "d"];

  check("only characters not already in it can be added",
    scene.filter(uuid => !already.has(uuid)), ["c", "d"]);
}

// --- What the code has to say for itself -----------------------------------------
{
  // One Strike Roll and one Wound Roll, outside the per-target loop.
  // Asked as an order rather than a distance: the Strike's own options have grown twice
  // since this was written, and a pattern counting characters between the two lines
  // fails on the next thing that goes in between them.
  check("the Strike is rolled once, before the branch",
    (CHAT.indexOf("const strike = await rollSide") > 0)
      && (CHAT.indexOf("const strike = await rollSide")
          < CHAT.indexOf("for (const { uuid, actor: target } of targets)")), true);
  check("and the Wound Roll likewise",
    CHAT.indexOf("const wound = await rollSide")
      < CHAT.indexOf("for (const { uuid, actor: target, own } of reached)"), true);

  // The Power Flare is inside the loop, because it answers for one person.
  // Inside the per-target loop, because a Power Flare answers for one person. Asked as
  // "does it come after the loop opens and before the loop's own writes end" rather than
  // "is it within N characters of it" - the loop has grown twice since this was written.
  const loopStart = CHAT.indexOf("for (const { uuid, actor: target, own } of reached)");
  const loopEnd = CHAT.indexOf("settledTargets.push({ ...own, ...woundAgainst, counterWound, effectiveWound", loopStart);
  check("the Power Flare is rolled per defender",
    (loopStart >= 0) && (CHAT.indexOf("defence.answersWound", loopStart) < loopEnd), true);

  // Targets can only join while the exchange genuinely cannot resolve - which is until
  // the attacker confirms, not until the Strike is rolled. Waiting for the roll let the
  // first target to answer settle the whole thing mid-decision.
  check("targets may only be added until the attacker confirms",
    /attackArea\(attack\) && thrower\?\.isOwner && !result && !committed/.test(CHAT), true);

  // Everyone the attack reaches may answer it, not the one it was first aimed at.
  check("every target of the attack may defend against it",
    /attackTargets\(attack\)\.some\(target => target\.uuid === actor\.uuid\)/.test(CHAT), true);
  check("and the Respond button is offered to all of them",
    /attackTargets\(attack\)\.some\(target => fromUuidSync\(target\.uuid\)\?\.isOwner\)/
      .test(CHAT), true);

  // Nothing reads a single flat result any more.
  //
  // `result?.hit` and `result.hit` are the same mistake, and the first spelling slipped
  // past a pattern that only knew the second - which left the Wound button testing a
  // field that no longer exists, so it never appeared. The optional dot is part of the
  // pattern now, and so is every field that moved.
  check("no flat per-target field is left on the result",
    /result\??\.(hit|answer|forced|soak|reduction|applied|damage|counterWound|incomingDamage|effectiveWound|damageCategory)\b/.test(CHAT), false);

  // The two places that used to ask "did it hit" of the attack as a whole ask whether
  // it landed on anybody, which is the question with several people on the card.
  // Landing on anybody is the usual reason a Wound Roll is owed. An Absolute Attack owes
  // one whatever happened, so the button asks `owesWound`, which is the two together.
  const owes = /function owesWound\([\s\S]*?\n\}/.exec(CHAT)?.[0] ?? "";
  check("the Wound Roll is offered when it landed on anyone",
    owes.includes("anyoneHit(attack)"), true);
  check("and the button asks that question",
    /!result\.wound && owesWound\(attack\)/.test(CHAT), true);
  check("and Combination's extra Strikes wait on the same question",
    /followUps\)[\s\S]{0,80}anyoneHit\(attack\)/.test(CHAT), true);
}

// --- A uuid cannot be an object key ---------------------------------------------
// This is what the harness missed, because it built its own shape rather than writing
// one the way the game does. A uuid is "Actor.4Nx8qLmP2Zk" - dots and all - and Foundry
// expands dotted keys when a document is written. So an object keyed by uuid comes back
// nested and every lookup finds nothing: the Strike was rolled, the defenders had no
// line on it, and the card sat there saying "waiting" for ever.
{
  const uuid = "Actor.4Nx8qLmP2Zk";
  const { expandObject } = globalThis.foundry.utils;

  check("an object keyed by uuid does not survive being written",
    Object.keys(expandObject({ byTarget: { [uuid]: { hit: true } } }).byTarget), ["Actor"]);

  // A list of entries carrying their own uuid survives whatever the write does.
  const asList = expandObject({ targets: [{ uuid, hit: true }] });
  check("a list of entries does", asList.targets[0].uuid, uuid);

  // So neither of the two survives as a keyed object in the product.
  check("the per-target results are a list", /result\?\.targets \?\? \[\]/.test(CHAT), true);
  check("and the defences are too", /attack\.defences \?\? \[\]/.test(CHAT), true);
  check("nothing is keyed by a uuid any more",
    /\[(target|actor|who|entry)\.uuid\]:/.test(CHAT), false);
}

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
