/**
 * The Racial Trait path, end to end.
 *
 * Every Trait shipped today sits one folder deep, so nothing has ever exercised the
 * nested form - `races/<race>/<trait>.dbu`, where the second folder says which race
 * the Trait belongs to. This writes one, loads it through the real loader, and takes
 * it away again.
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

const TRAITS = path.join(ROOT, "traits");
const RACE_DIR = path.join(TRAITS, "races", "android");
const FILE = path.join(RACE_DIR, "__harness-probe.dbu");

const PROBE = `id: harness-probe
name: Harness Probe
description: >
  A Trait that exists only while this check runs.
text: >
  Increase your Soak Value by 2(bT).

---

[passive]
soakValue += 2(bT);
`;

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

fs.mkdirSync(RACE_DIR, { recursive: true });
fs.writeFileSync(FILE, PROBE, "utf8");

try {
  const index = JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));
  const listed = [...index.traits, "races/android/__harness-probe.dbu"];

  globalThis.foundry.utils.fetchJsonWithTimeout = async () => ({ traits: listed });
  globalThis.fetch = async url => {
    const relative = String(url).replace("systems/dbu-ttrpg/traits/", "");
    const file = path.join(TRAITS, relative);
    if (!fs.existsSync(file)) return { ok: false, status: 404, statusText: "missing" };
    return { ok: true, text: async () => fs.readFileSync(file, "utf8") };
  };

  const { loadTraits, traitsOfKind, getTrait } = await import(modUrl("effects/traits.mjs"));
  await loadTraits();

  const trait = getTrait("harness-probe");
  check("a nested file loads", Boolean(trait), true);
  check("the first folder is the kind", trait?.kind, "races");
  check("the second folder is the owner", trait?.owner, "android");

  check("it is offered to its own race",
    traitsOfKind("races", "android").map(t => t.id).includes("harness-probe"), true);
  check("and not to another", traitsOfKind("races", "saiyan").map(t => t.id).includes("harness-probe"), false);

  // The one-folder-deep Traits must keep working, with no owner of their own.
  check("a flat Trait has no owner", getTrait("resilience")?.owner, null);
}
finally {
  fs.rmSync(FILE, { force: true });
  // Only if we made it and nothing else is in it.
  try { fs.rmdirSync(RACE_DIR); } catch {}
}

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
