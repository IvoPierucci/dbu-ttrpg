/**
 * What a Maneuver costs, and how often it can be used.
 *
 * A use is recorded against the period it is counted in, and a new Round hands back
 * only the ones it owns. That had been wrong: every use was written the same way, the
 * Round could not tell them apart, and a Maneuver limited to once per Round was in
 * practice once per Encounter.
 */

import path from "node:path";
import { pathToFileURL } from "node:url";

const APP = (process.env.FOUNDRY_APP || String.raw`C:\Program Files\Foundry Virtual Tabletop\resources\app`);
const appUrl = p => pathToFileURL(path.join(APP, p)).href;

globalThis.CONST = {};
globalThis.foundry = {};
await import(appUrl("common/primitives/_module.mjs"));
globalThis.foundry.utils = { ...await import(appUrl("common/utils/_module.mjs")) };
// combat.mjs reaches the character data model, and a data model needs the field
// classes and a base to extend at import time. Without these the harness never got
// as far as its first assertion.
globalThis.foundry.data = await import(appUrl("common/data/_module.mjs"));
const { default: DataModel } = await import(appUrl("common/abstract/data.mjs"));
globalThis.foundry.abstract = { DataModel, TypeDataModel: DataModel };

const ROOT = process.argv[2];
const modUrl = p => pathToFileURL(path.join(ROOT, "module", p)).href;

const { maneuverKiCost, maneuverUsesLeft, recordManeuverUse } =
  await import(modUrl("maneuvers.mjs"));
const { newRoundFor } = await import(modUrl("combat.mjs"));

/** An Actor as far as these two functions read one. */
function makeActor() {
  return {
    system: { usedManeuvers: [], attacksThisRound: 0, diminishingDefense: 0 },
    async update(changes) {
      for (const [key, value] of Object.entries(changes)) {
        if (key === "system.usedManeuvers") this.system.usedManeuvers = value;
      }
    }
  };
}

const perRound = { id: "energy-cancel", usageLimit: { amount: 1, per: "round" } };
const perEncounter = { id: "surge", usageLimit: { amount: 1, per: "encounter" } };
const unlimited = { id: "basic-attack", usageLimit: null };

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

const actor = makeActor();

check("a limited Maneuver starts with its uses", maneuverUsesLeft(actor, perRound), 1);
check("an unlimited one is never spent", maneuverUsesLeft(actor, unlimited), Infinity);

await recordManeuverUse(actor, perRound);
await recordManeuverUse(actor, perEncounter);
check("using one spends it", maneuverUsesLeft(actor, perRound), 0);
check("and the other", maneuverUsesLeft(actor, perEncounter), 0);

// The round turns over.
const cleared = newRoundFor(actor);
actor.system.usedManeuvers = cleared["system.usedManeuvers"];

check("a new Round hands back the per-Round use", maneuverUsesLeft(actor, perRound), 1);
check("and keeps the per-Encounter one spent", maneuverUsesLeft(actor, perEncounter), 0);

// A use written before uses carried their period still counts against the Maneuver.
const legacy = makeActor();
legacy.system.usedManeuvers = ["energy-cancel"];
check("a use recorded the old way still counts", maneuverUsesLeft(legacy, perRound), 0);

// --- What it costs ----------------------------------------------------------
// A cost is asked for twice: once by the sheet with no Profile declared, and once
// when it is actually paid. Both have to answer the same way about everything that
// is not the Profile, or the list shows a price nobody is charged.

/** A character with the given effect slots, as maneuverKiCost reads one. */
const priced = slots => ({ system: { baseTierOfPower: 3, effects: { slots } } });

const attack = { id: "basic-attack", kiCost: 0, attacking: true };
const charge = { id: "energy-charge", kiCostPerBaseTier: 2, attacking: false };

// Drained: attack.kiCost += 2(T). At Tier 3 that is 6 on every Attacking Maneuver.
const drained = { add: 6, multiply: 1, set: null, min: null, max: null, clamp: null };

check("an attack shows what an effect adds to every attack",
  maneuverKiCost(attack, null, priced({ "attack.kiCost": drained })), 6);
check("and charges the same once the Profile is declared",
  maneuverKiCost(attack, { profile: "simple", kiWager: 0 },
    priced({ "attack.kiCost": drained })), 6);
check("a Maneuver that is not an attack is untouched by it",
  maneuverKiCost(charge, null, priced({ "attack.kiCost": drained })), 6);

check("the (bT) notation is read", maneuverKiCost(charge, null, priced({})), 6);
check("a wager is added on top",
  maneuverKiCost(attack, { profile: "simple", kiWager: 4 }, priced({})), 4);
check("and a cost never goes below nothing",
  maneuverKiCost(attack, null,
    priced({ "attack.kiCost": { ...drained, add: -99 } })), 0);

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
