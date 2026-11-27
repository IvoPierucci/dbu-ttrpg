/**
 * That every module in the system actually loads, and every template survives Handlebars.
 *
 * Both of these were blind spots, and one of them cost a broken sheet.
 *
 * Every harness here imports the modules it is about - chat.mjs, maneuvers.mjs,
 * use-maneuver.mjs - so an import-time throw in any of those would be caught by whichever
 * ran first. The sheets were the exception: three harnesses read `actor-character-sheet.mjs`
 * as text and not one of them ever imported it, so a missing export or a cycle there would
 * have reached the table untouched.
 *
 * The templates were checked by counting braces, which says nothing about whether
 * Handlebars can compile the thing or render it without throwing.
 *
 * Neither pass proves a sheet opens - `_prepareContext` reads private fields, so it cannot
 * be called without the whole ApplicationV2 machinery behind it. What they prove is that
 * loading the system does not throw, which is the half that can be proved cheaply.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const ROOT = process.argv[2];
const APP = (process.env.FOUNDRY_APP || String.raw`C:\Program Files\Foundry Virtual Tabletop\resources\app`);
const appUrl = p => pathToFileURL(path.join(APP, p)).href;

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

// --- Enough of Foundry for a module to load ---------------------------------------------------
globalThis.CONST = {};
globalThis.foundry = {};
await import(appUrl("common/primitives/_module.mjs"));
globalThis.foundry.utils = { ...await import(appUrl("common/utils/_module.mjs")) };
globalThis.foundry.data = { ...await import(appUrl("common/data/_module.mjs")) };
globalThis.foundry.data.operators = { ForcedReplacement: { create: value => value } };
const { default: DataModel } = await import(appUrl("common/abstract/data.mjs"));
globalThis.foundry.abstract = { DataModel, TypeDataModel: DataModel };

// The application classes the sheets extend. Stubbed rather than reproduced: what is being
// looked for is a module that throws on the way in, not a sheet that renders.
class Stub { static DEFAULT_OPTIONS = {}; static PARTS = {}; }
globalThis.foundry.applications = {
  api: { HandlebarsApplicationMixin: (Base) => class extends Base {}, DialogV2: {} },
  sheets: { ActorSheetV2: Stub, ItemSheetV2: Stub },
  ux: { TextEditor: { implementation: {} } }
};
globalThis.ui = { notifications: { warn: () => {}, error: () => {}, info: () => {} } };
globalThis.Handlebars = { escapeExpression: String, registerHelper: () => {} };
globalThis.game = { combat: null, users: { activeGM: null }, settings: { get: () => null } };
globalThis.Hooks = { on: () => {}, once: () => {} };

// --- Every module the system ships ---------------------------------------------------------
{
  const modules = [];
  const walk = (at) => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".mjs")) modules.push(full);
    }
  };
  walk(path.join(ROOT, "module"));

  check("there are modules to load", modules.length > 10, true);

  // The sheets in particular, named. They are the ones nothing else imports, and the ones
  // whose failure is a sheet that will not open.
  const sheets = modules
    .map(file => path.relative(ROOT, file).replace(/\\/g, "/"))
    .filter(name => name.startsWith("module/sheets/"));
  check("and the sheets are among them", sheets, [
    "module/sheets/actor-character-sheet.mjs",
    "module/sheets/actor-vehicle-sheet.mjs",
    "module/sheets/item-gear-sheet.mjs",
    "module/sheets/item-maneuver-sheet.mjs",
    "module/sheets/item-talent-sheet.mjs"
  ]);

  const threw = [];
  for (const file of modules) {
    try {
      await import(pathToFileURL(file).href);
    }
    catch (error) {
      threw.push(`${path.relative(ROOT, file).replace(/\\/g, "/")}: ${error.message.split("\n")[0]}`);
    }
  }
  check("every module loads without throwing", threw, []);
}

// --- Every template, compiled and rendered for real -------------------------------------------
{
  const require = createRequire(path.join(APP, "package.json"));
  const RealHandlebars = require("handlebars");

  // The helpers Foundry registers for its own templates. Stubbed, because what is being
  // looked for is a template that throws rather than one that renders wrongly.
  for (const name of ["eq", "ne", "lt", "gt", "lte", "gte", "and", "or", "not", "concat",
                      "localize", "numberFormat", "numberInput", "radioBoxes", "rangePicker",
                      "selectOptions", "formInput", "formGroup", "filePicker", "editor",
                      "colorPicker", "checked", "disabled", "ifThen", "object", "log"]) {
    RealHandlebars.registerHelper(name, () => "");
  }

  const templates = [];
  const walk = (at) => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".hbs")) templates.push(full);
    }
  };
  walk(path.join(ROOT, "templates"));

  check("there are templates to compile", templates.length > 5, true);

  const broken = [];
  for (const file of templates) {
    const name = path.relative(ROOT, file).replace(/\\/g, "/");
    const text = fs.readFileSync(file, "utf8");
    try {
      const compiled = RealHandlebars.compile(text);
      // An empty context on purpose: a template that needs a key to exist before it can
      // be drawn is a template that throws on a character who has not got it.
      compiled({});
    }
    catch (error) {
      broken.push(`${name}: ${error.message.split("\n")[0]}`);
    }
  }
  check("every template compiles and renders on an empty context", broken, []);

  // Every tab page in particular, since those are the ones a sheet cannot open without.
  const pages = templates
    .map(file => path.basename(file))
    .filter(name => name.startsWith("actor-"))
    .sort();
  check("and the character sheet's pages are among them", pages, [
    "actor-adventure.hbs", "actor-adversary.hbs", "actor-battlefields.hbs", "actor-biography.hbs", "actor-combat.hbs", "actor-custom-buffs.hbs", "actor-fusion.hbs", "actor-gear.hbs",
    "actor-header.hbs", "actor-main.hbs", "actor-maneuvers.hbs",
    "actor-progression.hbs", "actor-settings.hbs", "actor-techniques.hbs", "actor-traits.hbs", "actor-transformations.hbs", "actor-unique-abilities.hbs"
  ]);

  // --- Helpers that do not exist ----------------------------------------------------------
  //
  // Rendering catches a missing inline helper, because Handlebars throws on one. It does
  // not catch a missing BLOCK helper: `{{#whenBattlefield}}...{{/whenBattlefield}}` is read
  // as a path that resolves to nothing, the inverse branch is drawn, and the whole section
  // silently disappears. A panel that vanishes is worse than one that errors, so the names
  // are read off the parsed template instead.
  const BLOCK_HELPERS = new Set(["if", "unless", "each", "with"]);
  const INLINE_HELPERS = new Set([
    "eq", "ne", "lt", "gt", "lte", "gte", "and", "or", "not", "concat",
    "localize", "numberFormat", "numberInput", "radioBoxes", "rangePicker",
    "selectOptions", "formInput", "formGroup", "filePicker", "editor",
    "colorPicker", "checked", "disabled", "ifThen", "object", "log",
    "lookup", "this"
  ]);

  const unknown = [];
  for (const file of templates) {
    const name = path.relative(ROOT, file).replace(/\\/g, "/");
    const seen = new Set();

    const walk = (node) => {
      if (!node || (typeof node !== "object")) return;

      if (node.type === "BlockStatement") {
        const called = node.path?.parts?.join(".") ?? "";
        // One part and no dots: anything deeper is a path, and a path in block position
        // is `{{#if}}`'s job rather than a helper.
        if (called && !called.includes(".") && !BLOCK_HELPERS.has(called)
          && !INLINE_HELPERS.has(called) && !seen.has(called)) {
          seen.add(called);
          unknown.push(`${name}: {{#${called}}} is no helper this system has`);
        }
      }

      // A mustache with parameters is a helper call and nothing else - `{{foo bar}}` has
      // no reading as a path.
      if (((node.type === "MustacheStatement") || (node.type === "SubExpression"))
        && (node.params?.length > 0)) {
        const called = node.path?.parts?.join(".") ?? "";
        if (called && !called.includes(".") && !INLINE_HELPERS.has(called)
          && !BLOCK_HELPERS.has(called) && !seen.has(called)) {
          seen.add(called);
          unknown.push(`${name}: {{${called} ...}} is no helper this system has`);
        }
      }

      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(walk);
        else walk(value);
      }
    };

    walk(RealHandlebars.parse(fs.readFileSync(file, "utf8")));
  }

  check("every helper a template calls is one that exists", unknown, []);
}

console.log(`${failed} failing`);
process.exit(failed ? 1 : 0);
