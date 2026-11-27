/**
 * A Maneuver's published entry, from the file to the row that opens under it.
 *
 * Two bugs met here. The first: a folded block in a trait file ended at its first blank
 * line, so every multi-paragraph entry in the library was silently truncated - six of
 * them, 47 lines of rulebook text, including the whole of Condition Recovery and
 * Spectate. Both of those had been checked by a harness that read the file rather than
 * the parsed value, which is why nothing noticed.
 *
 * The second is the one this system keeps having: `text` was written in six Maneuver
 * files, carried through the loader, stored on the Item, and read by nothing a player
 * ever looked at. The sheet showed a short summary written beside it instead.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
const APP = (process.env.FOUNDRY_APP || String.raw`C:\Program Files\Foundry Virtual Tabletop\resources\app`);
const appUrl = p => pathToFileURL(path.join(APP, p)).href;
const modUrl = p => pathToFileURL(path.join(ROOT, "module", p)).href;

// --- Enough of Foundry to load the registry ------------------------------------------
globalThis.CONST = {};
globalThis.foundry = {};
await import(appUrl("common/primitives/_module.mjs"));
globalThis.foundry.utils = { ...await import(appUrl("common/utils/_module.mjs")) };
globalThis.ui = { notifications: { warn: () => {}, error: () => {}, info: () => {} } };

// Only escapeExpression is asked for, and only by the Profile picker's tooltip.
globalThis.Handlebars = {
  escapeExpression: s => String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#x27;")
};

const TRAITS = path.join(ROOT, "traits");
globalThis.foundry.utils.fetchJsonWithTimeout = async () =>
  JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));
globalThis.fetch = async url => {
  const relative = String(url).replace("systems/dbu-ttrpg/traits/", "");
  const file = path.join(TRAITS, relative);
  if (!fs.existsSync(file)) return { ok: false, status: 404, statusText: "missing" };
  return { ok: true, status: 200, text: async () => fs.readFileSync(file, "utf8") };
};

const { loadTraits, parseTraitFile, printedLines } = await import(modUrl("effects/traits.mjs"));
const { loadManeuvers, getManeuver, allManeuvers, entryTip, maneuverEntry } =
  await import(modUrl("maneuvers.mjs"));

await loadTraits();
await loadManeuvers();

const SHEET = fs.readFileSync(
  path.join(ROOT, "module", "sheets", "actor-character-sheet.mjs"), "utf8");
const USE = fs.readFileSync(path.join(ROOT, "module", "use-maneuver.mjs"), "utf8");
// The Maneuver rows, which moved out of the Combat tab into one of their own. Named for
// what it holds rather than for where it used to live.
const MANEUVER_TAB = fs.readFileSync(
  path.join(ROOT, "templates", "parts", "actor-maneuvers.hbs"), "utf8");
const ITEM_SHEET = fs.readFileSync(
  path.join(ROOT, "module", "sheets", "item-maneuver-sheet.mjs"), "utf8");
const DESCRIPTION_TAB = fs.readFileSync(
  path.join(ROOT, "templates", "parts", "maneuver-description.hbs"), "utf8");
const CSS = fs.readFileSync(path.join(ROOT, "styles", "dbu-ttrpg.css"), "utf8");

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

const EN_DASH = "\u2013";

// --- A folded block keeps its shape ----------------------------------------------------
{
  const parse = body => parseTraitFile(`x: >\n${body}\n---\n`).x;

  check("one wrapped line comes back as one",
    parse("  A sentence that was\n  wrapped to stay readable."),
    "A sentence that was wrapped to stay readable.");

  check("a stat line opens a line of its own",
    parse(`  Name: a tagline.\n  ${EN_DASH}Action Cost: 1 Action`),
    `Name: a tagline.\n${EN_DASH}Action Cost: 1 Action`);

  check("and so does a bullet",
    parse("  First.\n  * Second.\n  * Third."),
    "First.\n* Second.\n* Third.");

  check("a bullet's own wrapping is joined back onto it",
    parse("  * A bullet that runs\n    onto a second line."),
    "* A bullet that runs onto a second line.");

  // The bug. A blank line ended the block, so everything past it was dropped without a
  // word - and a paragraph break is part of the text, not the end of it.
  check("a blank line is a paragraph break, not the end of the block",
    parse("  One.\n\n  Two."), "One.\n\nTwo.");

  check("and the paragraph after it opens a line even with no marker",
    parse("  One.\n\n  Two.\n  Still two."), "One.\n\nTwo. Still two.");

  // But a blank line with nothing indented after it really is the end: that is the gap
  // between the last header key and the "---".
  check("a trailing blank line ends it",
    parseTraitFile(`x: >\n  One.\n\nkey: value\n---\n`),
    { x: "One.", key: "value", id: "", script: "" });

  check("a numbered effect opens a line too, for a Special State's list",
    parse("  (1)-[Passive]: One.\n  (2)-[Passive]: Two."),
    "(1)-[Passive]: One.\n(2)-[Passive]: Two.");

  // A file with Windows line endings parses, which it did not. Every key was matched
  // against a pattern ending in `$` with no multiline flag, so a trailing carriage
  // return meant no key matched at all: the whole header came out empty and the only
  // thing left was the id taken from the filename. Silently - the loader reports a file
  // it cannot read, not one it read as nothing.
  //
  // And it is one `git checkout` away on any machine with core.autocrlf set, which this
  // one has: a stash and a pop converted fifteen trait files and broke every one.
  {
    const windows = parseTraitFile(
      "id: x\r\nname: X\r\ntype: standard\r\ndescription: >\r\n  One.\r\n\r\n  Two.\r\n---\r\nki.value += 1;\r\n",
      "x.dbu");
    check("a file with CRLF line endings parses",
      [windows.id, windows.name, windows.type], ["x", "X", "standard"]);
    check("its folded block too", windows.description, "One.\n\nTwo.");
    check("and its script", windows.script, "ki.value += 1;\n");
  }

  // Both callers hand their text to the same rule, and one of them hands it text this
  // rule has already folded. Folding it twice has to change nothing.
  const once = printedLines(`A.\n${EN_DASH}B: c.\n\n* D.\n  more d.`);
  check("folding is idempotent", printedLines(once.join("\n")), once);
}

// --- Every entry in the library survives the loader ---------------------------------------
{
  // The six blocks that were being truncated, by the phrase each lost. Checked through
  // the loader rather than by reading the file, which is the mistake that hid this: the
  // file was right all along.
  for (const [kind, id, phrase] of [
    ["maneuvers", "arrogant-declaration", "Only 1 of your Minions"],
    ["maneuvers", "combat-recovery", "Spectate: After using Combat Recovery"],
    ["maneuvers", "empower", "You can only enter the Entrusted Special State"]
  ]) {
    const definition = getManeuver(id);
    check(`${id} keeps "${phrase.slice(0, 28)}..."`,
      String(definition?.text ?? "").includes(phrase), true);
  }

  // The other three are not Maneuvers, and they were truncated the same way.
  for (const [file, phrase] of [
    ["signature/advantages/charging-assault.dbu", "If you are in a High Environment"],
    ["states/entrusted.dbu", "(4)-[Triggered, 1/Encounter]"],
    ["states/spectator.dbu", "(5)-[Passive]"]
  ]) {
    const parsed = parseTraitFile(fs.readFileSync(path.join(TRAITS, file), "utf8"), file);
    check(`${file.split("/").pop()} keeps its last effect`,
      String(parsed.text ?? "").includes(phrase), true);
  }
}

// --- Every Maneuver either carries its entry or says why it does not ------------------------------
{
  // A Maneuver that is one of a Trait's numbered effects is a third camp: the rulebook
  // prints it as a line inside that Trait, not as a Maneuver entry, so there is no stat
  // block for it to carry and demanding one would be demanding something that does not
  // exist. What it carries is the line.
  const ownEffect = allManeuvers().filter(m => m.fromTrait).map(m => m.id).sort();
  check("and these are a Trait's own effects rather than Maneuvers of their own",
    ownEffect, ["alternate-sight-fourth-effect", "arboreal-fourth-effect", "arboreal-second-effect", "arboreal-third-effect", "attendants-focus-fourth-effect", "autonomous-glass-soldiers-first-effect", "brood-parent-first-effect", "camouflage-exit", "camouflage-first-effect", "cloaking-system-fourth-effect", "cloaking-system-third-effect", "combat-blueprint-first-effect", "consumable-minions-maneuver", "cutthroat-teamwork-second-effect", "debuffer-maneuver", "demonic-god-option", "dissipating-dodge-first-effect", "energy-core-fifth-effect", "experienced-fighter-second-effect", "footwork-first-effect", "free-flowing-stance-first-effect", "frequent-flyer-third-effect", "from-goop-sixth-effect", "from-goop-third-effect", "genetic-focus-neko-majins-fifth-effect", "genetic-focus-neko-majins-fourth-effect", "glass-decorations-second-effect", "glass-shards-fifth-effect", "glass-shards-sixth-effect", "golden-fruit-first-effect", "greedy-rabbit-sixth-effect", "grippy-grabbers-third-effect", "heel-second-effect", "innate-weaponry-first-effect", "instant-craft-second-effect", "kindhearted-saiyan-second-effect", "light-consumption-first-effect", "liquid-sixth-effect", "majin-regeneration-third-effect", "merged-tuffle-second-effect", "metallic-movement-third-effect", "mimicry-of-the-whipping-tail-second-effect", "mini-majin-first-effect", "minion-coordinator-second-effect", "minion-mark-first-effect", "minion-supporter-second-effect", "mutant-core-fourth-effect", "mutant-core-third-effect", "namekian-biology-third-effect", "namekian-genes-second-effect", "neko-majin-dama-fourth-effect", "neko-majin-dama-third-effect", "noble-dragon-maneuver", "personified-dragon-ball-fourth-effect", "petrification-plating-fourth-effect", "poko-priest-maneuver", "protector-first-effect", "protector-second-effect", "regenerating-beast-second-effect", "sacrificial-minion-second-effect", "saiyan-soul-third-effect", "silk-production-third-effect", "spectral-monster-first-effect", "spectral-monster-second-effect", "suplex-first-effect", "swaggering-wager-third-effect", "switch-to-a-hero-second-effect", "treacherous-spikes-fourth-effect", "tuffle-fusion-second-effect", "warm-up-first-effect", "warriors-of-glass-first-effect", "warriors-of-glass-third-effect", "watchful-gaze-third-effect", "weather-resilient-third-effect", "yaki-swarm-first-effect"]);
  for (const id of ownEffect) {
    const maneuver = getManeuver(id);
    check(`${id} carries the effect's own line`,
      /^\(\d+\)-\[/.test(maneuver.text.trim()), true);
    check(`${id} names the Trait it came out of`,
      Boolean(maneuver.fromTrait) && (maneuver.fromEffect > 0), true);
  }

  const carried = allManeuvers()
    .filter(m => m.text && !m.fromTrait).map(m => m.id).sort();
  const bare = allManeuvers().filter(m => !m.text).map(m => m.id).sort();

  // The relationship rather than the list. A count re-anchored on every new Maneuver is
  // a check that fails for being right, and the claim worth keeping is this one: nothing
  // in the library is missing its published wording by accident.
  check("every Maneuver is in one camp or another",
    carried.length + bare.length + ownEffect.length, allManeuvers().length);
  check("and most of them carry it", carried.length > bare.length, true);

  // The ones without say so in the file, where the next person looks. Nothing was
  // invented to fill them: they were built from the rules as given, not from an entry.
  for (const id of bare) {
    const file = fs.readFileSync(path.join(TRAITS, "maneuvers", `${id}.dbu`), "utf8");
    check(`${id} says it has no printed entry`,
      file.includes("# No printed entry here."), true);
  }

  // Each of those is the whole entry rather than the Effect on its own: the same
  // convention a Profile follows, since it is the entry being quoted.
  for (const id of carried) {
    const lines = printedLines(getManeuver(id).text);
    check(`${id} opens with its name and tagline`,
      lines[0]?.startsWith(EN_DASH), false);
    // A Modifier Maneuver's stat block is a different set: it has no Maneuver Type line
    // and carries a Base Maneuver one instead, which is what says which kind it is.
    // The Effect line is written both ways: "Effect:" nearly everywhere and "Effects:"
    // where an entry has several - the Tail Attack is the first. Both are accepted because
    // both are the rulebook's, and each entry carries whichever wording it was printed
    // with rather than one tidied to match the others.
    const wanted = (getManeuver(id).type === "modifier")
      ? ["Action Cost:", "Base Maneuver:", "KP Cost:", ["Effect:", "Effects:"]]
      : ["Maneuver Type:", "Action Cost:", ["KP Cost:", "DKP Cost:"], ["Effect:", "Effects:"]];

    check(`${id} carries its stat lines`,
      wanted.every(head => [].concat(head).some(
        wording => lines.some(line => line.startsWith(`${EN_DASH}${wording}`)))), true);
  }

  // Named, so that one falling out of the library is noticed rather than quietly
  // reducing the set this is checked against.
  // The three placeholders (Jump, Thumb War, Crouch) taken out (the user's): none left.
  check("which those are", bare, []);
}

// --- What the entries say, where it has been corrected ---------------------------------------
{
  // Defend's entry has been given three times. The first carried a line the other two
  // did not - "If you use the Parry option ... you may use the Reflect Maneuver" - and I
  // had written it in from that one. It is out: two of the three, the latest included,
  // do not have it, and there is no Reflect Maneuver here to point at either way.
  check("Defend's entry ends at Diminishing Defense",
    getManeuver("defend").text.trim().endsWith(
      "you do not gain any stacks of Diminishing Defense from that Attacking Maneuver."),
    true);
  check("and says nothing about a Reflect Maneuver",
    getManeuver("defend").text.includes("Reflect"), false);

  // Basic Attack's entry carries a rule of its own, and the whole sentence survives the
  // file's wrapping - which is the thing this harness is about. Whether anything enforces
  // it is profileround.mjs's business, and something does.
  check("Basic Attack's once-a-Profile rule is quoted whole",
    getManeuver("basic-attack").text.includes(
      "You can only use each Profile once per Combat Round when using a Basic Attack "
      + "Maneuver, except for the Simple Profile."), true);
}

// --- The entry reaches the row --------------------------------------------------------------
{
  // It never did: a definition read off an Item carried the description and not the
  // wording, so the field was written, stored, and read by nothing.
  check("a definition carries the wording", USE.includes("text: item.system.text,"), true);

  const recovery = getManeuver("combat-recovery");
  const shown = maneuverEntry({ ...recovery, itemId: "x" });
  const said = shown.lines.map(line => line.text).join("\n");

  check("the row carries the entry",
    said.includes("Combat Recovery [1/Round]: Talk or rest"), true);
  check("its stat lines and all", said.includes(`${EN_DASH}Action Cost: Variable (2~3 Actions)`), true);
  check("down to the options underneath",
    said.includes("Spectate: After using Combat Recovery"), true);
  check("a bullet is marked as one",
    shown.lines.filter(line => line.bullet).length, 2);
  check("and a paragraph break as one",
    shown.lines.some(line => line.gap), true);

  // Not the summary written beside it, which is the whole complaint.
  check("and not the summary beside it", shown.description, "");

  // A character's copy carries the wording the file had when it was granted, and six of
  // these were granted with an entry truncated at its first blank line. So the file wins
  // wherever the file has one: the rules live in traits/, and this is one of them.
  const stale = maneuverEntry({
    id: "combat-recovery", text: "", description: recovery.description
  });
  check("an Item with no wording of its own shows the file's entry",
    stale.lines[0]?.text.startsWith("Combat Recovery [1/Round]"), true);

  const granted = maneuverEntry({
    id: "combat-recovery",
    text: "You can spend between 2 and 3 Actions on Combat Recovery.",
    description: recovery.description
  });
  check("and a copy carrying a stale one shows the file's too",
    granted.lines.some(line => line.text === `${EN_DASH}Action Cost: Variable (2~3 Actions)`), true);

  // A Maneuver with no file at all falls back to its own: a Signature Technique and a
  // Unique Ability are bought per character and exist only as Items, so the Item is the
  // only place their wording could live.
  const bought = maneuverEntry({
    id: "wolf-fang-fist", text: `Wolf Fang Fist: a flurry.\n${EN_DASH}TP Cost: 12`, description: ""
  });
  check("a Maneuver that exists only as an Item shows its own wording",
    bought.lines.map(line => line.text),
    ["Wolf Fang Fist: a flurry.", `${EN_DASH}TP Cost: 12`]);

  // And the window says whose wording is being shown, rather than leaving somebody to
  // type into a field and watch nothing change.
  check("the sheet works out whether the entry is published",
    ITEM_SHEET.includes("context.publishedEntry = definition?.text"), true);
  check("and the tab says which", DESCRIPTION_TAB.includes("{{#if publishedEntry}}"), true);

  // What somebody writes on their own copy reads, exactly as they wrote it: that is much
  // of the point of a Maneuver being an Item.
  const theirs = maneuverEntry({
    id: "combat-recovery",
    text: recovery.text,
    description: "<p>Tizi sits down and eats a senzu.</p>"
  });
  check("a description of their own is carried",
    theirs.description, "<p>Tizi sits down and eats a senzu.</p>");
  check("and the entry with it", theirs.lines.length > 0, true);

  // Kept as they wrote it rather than flattened: the pencil edits it through Foundry's
  // own editor, so it is HTML, and the row renders it instead of escaping it.
  check("the row renders it as written",
    MANEUVER_TAB.includes("{{{maneuver.description}}}"), true);

  // And the one the definition ships with is not shown, since the entry says it better -
  // which is why the entries were written out at all.
  check("the shipped summary is not",
    maneuverEntry({
      id: "combat-recovery", text: recovery.text, description: recovery.description
    }).description, "");

  // With no entry to quote, the description is the body rather than an extra - a
  // homebrew Maneuver, and the five Core ones whose entry was never printed here.
  const placeholder = maneuverEntry({ id: "homebrew", text: "", description: "A Skill Clash of Bluff against one target." });
  check("with no entry, the description is the body",
    placeholder.description.includes("Skill Clash of Bluff"), true);
  check("and there are no entry lines to show", placeholder.lines, []);

  // Nothing either way says so, rather than opening an empty box.
  const nothing = maneuverEntry({ id: "nothing-like-this", text: "", description: "" });
  check("a Maneuver with neither says so",
    [nothing.empty, nothing.lines, nothing.description], [true, [], ""]);
  check("and the row has something to say when it does",
    MANEUVER_TAB.includes("Nothing written for this one yet."), true);
}

// --- The row opens downwards ----------------------------------------------------------------
{
  check("the row asks for what it has to say",
    SHEET.includes("...maneuverEntry(maneuver),"), true);

  // Not a hover any more. A tooltip cannot be read at leisure, cannot be scrolled, and
  // had to escape a description that is HTML.
  // Scoped to the Maneuver list. The Combat Rolls above it show their workings on
  // hover, which is a different question about a different panel - checked across the
  // whole tab, this said the Maneuver rows had regressed because a Strike Roll had
  // gained a tooltip.
  const rows = MANEUVER_TAB.slice(MANEUVER_TAB.indexOf('<ul class="maneuver-list">'),
    MANEUVER_TAB.indexOf("</ul>", MANEUVER_TAB.indexOf('<ul class="maneuver-list">')));
  check("nothing on the row is a tooltip of the text",
    rows.includes("data-tooltip-html"), false);
  check("and the description is not squeezed into an attribute",
    /data-tooltip="\{\{maneuver\.description\}\}"/.test(MANEUVER_TAB), false);

  // Anywhere on the row opens it. Nothing looks at what was clicked to tell the three
  // apart: ApplicationV2 dispatches to closest("[data-action]"), so the name resolves to
  // the name, the pencil to the pencil, and the rest of the row to the row.
  check("the strip you click is the whole row",
    /<div class="maneuver-head" data-action="toggleManeuver"[ >]/.test(MANEUVER_TAB), true);
  check("the name keeps its own click",
    /class="maneuver-name rollable" data-action="useManeuver"/.test(MANEUVER_TAB), true);
  check("and the pencil keeps its own",
    /class="maneuver-control" data-action="editItem"/.test(MANEUVER_TAB), true);
  check("both sit inside the strip",
    MANEUVER_TAB.indexOf('data-action="toggleManeuver"') < MANEUVER_TAB.indexOf('data-action="useManeuver"'),
    true);
  check("the row is registered as an action",
    SHEET.includes("toggleManeuver: DBUCharacterSheet._onToggleManeuver,"), true);

  // Toggled in place and remembered, not re-rendered: the list would jump, and
  // re-rendering a whole sheet to record that somebody opened a row is the mistake the
  // collapsible sections already avoid.
  check("opening it is recorded rather than re-rendered", [
    SHEET.includes('row.classList.toggle("maneuver-open", open);'),
    SHEET.includes('this.#openSections[`maneuver-${row.dataset.itemId}`] = open;')
  ], [true, true]);
  check("and a row left open is drawn open",
    SHEET.includes("open: Boolean(this.#openSections[`maneuver-${maneuver.itemId}`]),"), true);
  check("which the markup honours",
    MANEUVER_TAB.includes("{{#if maneuver.open}} maneuver-open{{/if}}"), true);

  // Closed by a class rather than by the `hidden` attribute, since the body has a
  // display of its own and would have won the argument.
  check("what is closed is closed by class", [
    CSS.includes(".dbu-ttrpg .maneuver-body {\n  display: none;\n}"),
    CSS.includes(".dbu-ttrpg .maneuver-open > .maneuver-body {")
  ], [true, true]);
  check("and the row is no longer the flex strip itself",
    CSS.includes(".dbu-ttrpg .maneuver-head {\n  display: flex;"), true);

  // Why it cannot be played is said as well as the entry rather than instead of it.
  check("out of Actions is said", SHEET.includes('"No Actions left this round for this."'), true);
  check("out of uses too",
    SHEET.includes("No uses of this left this ${maneuver.usageLimit?.per"), true);
  check("and the row draws them", MANEUVER_TAB.includes("{{#each maneuver.notes as |note|}}"), true);

  // The row is not disabled and nothing takes its pointer events away: it has to stay
  // clickable to be opened at all, and the click that plays it is refused by name where
  // the rule lives.
  check("the row is not disabled", /\{\{#if maneuver\.unaffordable\}\}disabled/.test(MANEUVER_TAB), false);
  check("nor does anything take its pointer events away",
    CSS.includes("maneuver-exhausted button.maneuver-name"), false);
  check("the click is refused where the rule lives", [
    USE.includes("has no ${kind} Actions left this round for ${maneuver.name}."),
    USE.includes("has no uses of ${maneuver.name} left.")
  ], [true, true]);

  // A Maneuver is an Item, and until now the only Item this sheet could open was a
  // Talent.
  check("the pencil opens the Item's own sheet",
    SHEET.includes("this.actor.items.get(target.dataset.itemId)?.sheet.render(true);"), true);
}

// --- The names line up on the left -----------------------------------------------------------
// Measured in a browser with Foundry's own button rule in effect - which took proving,
// since the whole of foundry2.css serves fine and parses to nothing in that engine, so
// the first measurement was taken against a page that never had it. With the rule loaded
// on its own: every name starts at the same x, every row is 30px, and the source and cost
// columns start at the same x on every row. What is checked here is the rules that make
// that true, each of which is easy to undo by accident.
{
  const nameRule = CSS.slice(CSS.indexOf(".dbu-ttrpg button.maneuver-name {"));
  const nameBody = nameRule.slice(0, nameRule.indexOf("}"));

  // Both properties, because which one places the label is not ours to decide. Foundry
  // makes every button a flex container, and in one of those the label is a flex item
  // that justify-content places and text-align never reaches - which is why this button
  // read `text-align: left` from the day it was written and drew centred anyway. Without
  // that rule the button is an ordinary block and the browser's own
  // `button { text-align: center }` places it. Declaring one and not the other leaves the
  // alignment resting on somebody else's stylesheet.
  check("the name is placed by justify-content",
    /justify-content: flex-start;/.test(nameBody), true);
  check("and by text-align as well",
    /text-align: left;/.test(nameBody), true);

  // The span is not a button and has no flex of its own, so text-align is the only one
  // that reaches it. Both were in the same list, one centred and one left.
  check("a Counter Maneuver's name is aligned the same way",
    /span\.maneuver-name \{[^}]*text-align: left;/.test(CSS), true);

  // The columns after the name are sized rather than left to their text, so that where a
  // Maneuver is from and what it costs sit in the same place whether or not it has a
  // usage limit.
  check("the usage column has a width of its own",
    /\.maneuver-uses \{[^}]*flex: 0 0 \d+px;/.test(CSS), true);
  check("and is drawn on every row",
    /<span class="maneuver-uses">\{\{#if maneuver\.usageLabel\}\}/.test(MANEUVER_TAB), true);
  check("the source column has a floor",
    /\.maneuver-source \{[^}]*min-width: \d+px;/.test(CSS), true);

  // One row height: Foundry's button min-height made a playable Maneuver's row four
  // pixels taller than a Counter Maneuver's, whose name is a span.
  check("the name does not take a button's height", /min-height: 0;/.test(nameBody), true);
}

// --- One rule for the lines, wherever they are drawn -----------------------------------------
{
  // The Profile picker is still a hover - it is a dialog you are choosing from, not a
  // list you are reading - so entryTip is still what builds that. What the two share is
  // the rule for what a printed line is: the picker hands its lines to entryTip, the row
  // hands the same lines to Handlebars, and both get them from printedLines.
  check("entryTip is what the picker asks", typeof entryTip, "function");
  check("it draws nothing from nothing", entryTip([], []), "");
  check("an aside alone is still worth drawing",
    entryTip([], ["Not automated: something."]).includes("dbu-profile-note"), true);

  const MANEUVERS = fs.readFileSync(path.join(ROOT, "module", "maneuvers.mjs"), "utf8");
  check("and the Profile hover is built from it",
    /function profileTip\(profile\) \{[\s\S]{0,1200}?entryTip\(printed, notes\)/.test(MANEUVERS),
    true);
  check("with no second copy of the markup left",
    (MANEUVERS.match(/dbu-profile-tip/g) ?? []).length, 1);
}

// --- The Maneuver rows live in one place ----------------------------------------------------
{
  // Whether every tab has a page, and every page knows which tab it is, used to be here.
  // It is in `tabs.mjs` now, and for the reason the check itself exists: it held a list of
  // the sheet's tab names, a second harness grew a second list of them, and two lists that
  // have to be updated together are two lists that drift. One of them owns it.
  //
  // What stays here is about this tab's contents rather than its wiring: the Maneuver rows
  // moved out of the Combat tab, and two copies of a row is two that drift as well.
  const COMBAT_TAB = fs.readFileSync(
    path.join(ROOT, "templates", "parts", "actor-combat.hbs"), "utf8");
  check("the Maneuver lists left the Combat tab",
    COMBAT_TAB.includes('class="maneuver-list"'), false);
  check("and are in the one they moved to",
    MANEUVER_TAB.includes('class="maneuver-list dbu-clist"'), true);
}

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
