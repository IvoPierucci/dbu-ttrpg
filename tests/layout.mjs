/**
 * The Battlefields tab's layout: the order the panels come in, two rows of three pickers,
 * the buttons two to a row, and every reading list folded under Information.
 *
 * All of it is the template and the stylesheet, so this reads both as text. What it pins
 * is the order the player asked for, so a later edit that puts a panel back where it was
 * fails here rather than at the table.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.argv[2];
const TAB = fs.readFileSync(path.join(ROOT, "templates", "parts", "actor-battlefields.hbs"), "utf8");
const CSS = fs.readFileSync(path.join(ROOT, "styles", "dbu-ttrpg.css"), "utf8");

let failing = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failing++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${ok ? "" : `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
}

// Comments say things in prose that a marker would match, so they are taken out first.
const BODY = TAB.replace(/\{\{!(--)?[\s\S]*?(--)?\}\}/g, "");
const at = marker => BODY.indexOf(marker);

// --- The order ---------------------------------------------------------------------------------
{
  const order = [
    'name="system.battlefield.environment"',
    'name="system.battlefield.weather.id"',
    'data-section="qualities"',
    'name="system.battlefield.cover.active"',
    'class="battlefield-buttons"',
    'data-section="information"'
  ];
  const places = order.map(at);
  check("every panel was found", places.every(place => place >= 0), true);
  check("Environment, Weather, Environmental Qualities, Cover, buttons, Information",
    places.every((place, i) => (i === 0) || (place > places[i - 1])), true);
}

// --- Two rows of three -------------------------------------------------------------------------
{
  const rows = [...BODY.matchAll(/<div class="stat-grid battlefield-row">/g)].map(m => m.index);
  check("two rows of pickers", rows.length, 2);

  // Each row runs to the next panel's end. A row is three tiles, each holding one picker -
  // Ground Hardness is drawn only on the ground, so the count is of what the template has.
  const selectsIn = start => {
    const end = BODY.indexOf("</section>", start);
    return [...BODY.slice(start, end).matchAll(/<select /g)].length;
  };
  check("the Environment row has three", selectsIn(rows[0]), 3);
  check("and the Weather row has three", selectsIn(rows[1]), 3);

  const weatherRow = BODY.slice(rows[1], BODY.indexOf("</section>", rows[1]));
  check("the Light Level is in the Weather row",
    weatherRow.includes('name="system.battlefield.lightLevel"'), true);
  check("and has no panel of its own",
    [...BODY.matchAll(/name="system\.battlefield\.lightLevel"/g)].length, 1);

  // What the Qualities leave the ground at is said inside the Ground Hardness tile, so the
  // row keeps three tiles when it shows.
  const ground = BODY.slice(at('name="system.battlefield.groundHardness"'),
    BODY.indexOf("</div>", at('name="system.battlefield.groundHardness"')));
  check("After Qualities sits inside the Ground Hardness tile",
    ground.includes("{{ground.shifted.rank}}"), true);

  check("the stylesheet holds a row at three",
    /\.stat-grid\.battlefield-row \{\s*grid-template-columns: repeat\(3, 1fr\);/.test(CSS), true);
}

// --- The buttons, two to a row -----------------------------------------------------------------
{
  const start = at('class="battlefield-buttons"');
  const block = BODY.slice(start, BODY.indexOf("</section>", start));
  check("the Feature attacks are in the square",
    block.includes('data-action="attackFeature"'), true);
  check("and so is Receive Collision Damage",
    block.includes('data-action="takeCollision"'), true);
  check("the stylesheet puts two to a row",
    /\.battlefield-buttons \{\s*display: grid;\s*grid-template-columns: repeat\(2, 1fr\);/.test(CSS),
    true);
}

// --- Information -------------------------------------------------------------------------------
{
  const info = at('data-section="information"');
  check("remembering whether it was left open",
    BODY.includes("{{#if openSections.information}}open{{/if}}"), true);

  // Every reading list sits inside it, and nothing that sets a value does.
  for (const section of ["featureQualities", "hardness"]) {
    check(`the ${section} list is inside Information`,
      at(`data-section="${section}"`) > info, true);
  }
  check("and nothing inside it writes to the character",
    BODY.slice(info).includes('name="system.'), false);

  // The ticked list is a control, not a reading list, and stays out.
  check("the Environmental Qualities stay outside it",
    at('data-section="qualities"') < info, true);

  // Information is one <details> holding two; the last close in the tab is its own.
  const from = BODY.lastIndexOf("<details ", info);
  const opens = [...BODY.slice(from).matchAll(/<details /g)].length;
  const closes = [...BODY.slice(from).matchAll(/<\/details>/g)].length;
  check("two lists inside one", [opens, closes], [3, 3]);
  check("and the Weather and Environments reading lists are gone",
    [BODY.includes('data-section="weather"'), BODY.includes('data-section="environments"')],
    [false, false]);
}

// --- Headings ------------------------------------------------------------------------------------
{
  check("the second row is named for both of its halves",
    BODY.includes("Battle Weather and Light Level"), true);
  // A note beside a summary pulls the title to the middle; the Hardness one is a tooltip.
  const hardness = BODY.slice(at('data-section="hardness"'),
    BODY.indexOf("</summary>", at('data-section="hardness"')));
  check("the Hardness title carries no note beside it",
    hardness.includes("panel-note"), false);
  check("its base Tier is on hover instead",
    hardness.includes('data-tooltip="Your Values, at base Tier {{baseTierOfPower}}"'), true);
}

// --- Dialogs that fit the screen ---------------------------------------------------------------
{
  // The Profile picker ran past the bottom of the screen once the Magic Profiles arrived,
  // and the ones below the edge could not be picked without folding the others away.
  check("the Profile list scrolls inside itself",
    /\.dbu-profile-picker \{\s*max-height: [^;]+;\s*overflow-y: auto;/.test(CSS), true);
  check("and no dialog of ours is taller than the screen",
    /\.application\.dbu-dialog \{\s*(\/\*[\s\S]*?\*\/\s*)?max-height: 90vh;/.test(CSS), true);
  check("scrolling rather than cutting off",
    /\.application\.dbu-dialog \.window-content \{[^}]*overflow-y: auto;/.test(CSS), true);
}

// --- The tab strip: each tab as wide as its name, six over five --------------------------------
{
  // Columns of equal width had the long names running into each other (the user's): each tab takes
  // what its name takes, never wrapped, and each row is centred.
  check("a wrapping row of tabs, each as wide as its name, centred",
    [/\.dbu-ttrpg \.sheet-tabs \{\s*display: flex;\s*flex-wrap: wrap;\s*justify-content: center;/.test(CSS),
     /\.dbu-ttrpg \.sheet-tabs > \.item \{\s*flex: 0 0 auto;[^}]*white-space: nowrap;/.test(CSS),
     /grid-area: \d+ \/ \d+/.test(CSS.slice(CSS.indexOf(".dbu-ttrpg .sheet-tabs {")))], [true, true, false]);
  check("seven and seven since the Transformations: a break after the seventh, the eighth on in the second row",
    [/\.dbu-ttrpg \.sheet-tabs::after \{\s*content: "";\s*flex-basis: 100%;\s*height: 0;\s*order: 1;/.test(CSS),
     CSS.includes(".dbu-ttrpg .sheet-tabs > .item:nth-child(n+8) { order: 2; }")], [true, true]);
}

// --- The Gear tab: three folded lists ----------------------------------------------------------
{
  const GEAR = fs.readFileSync(path.join(ROOT, "templates", "parts", "actor-gear.hbs"), "utf8")
    .replace(/\{\{!(--)?[\s\S]*?(--)?\}\}/g, "");
  const lists = [...GEAR.matchAll(/<details class="condition-group" data-section="(\w+)"[\s\S]*?<summary class="panel-title">([^<]+)<\/summary>/g)]
    .map(m => [m[1], m[2]]);
  // Accessories share the first list: "Accessories are also counted as Basic Items for
  // rules and effects".
  check("Basic Items & Accessories, Apparel, Weapons and Buddies, in that order", lists, [
    ["gearBasic", "Basic Items &amp; Accessories"],
    ["gearApparel", "Apparel"],
    ["gearWeapons", "Weapons"],
    ["gearBuddies", "Buddies"]
  ]);
  check("each remembering whether it was left open",
    lists.every(([key]) => GEAR.includes(`{{#if openSections.${key}}}open{{/if}}`)), true);
}

// --- One arrow for everything that opens (the user's) ----------------------------------------------
{
  check("the rows' arrow: 12px, in the accent",
    /\.dbu-ttrpg \.maneuver-mark \{\s*flex: 0 0 auto;\s*width: 12px;\s*font-size: 12px;\s*line-height: 1;\s*color: var\(--dbu-accent\);/.test(CSS),
    true);
  check("and the same on every fold: Conditions and States, Maneuver groups, Talents, a Talent's own",
    ["condition-group", "maneuver-group", "trait-group", "effect-resolved"].map(fold =>
      CSS.includes(`.dbu-ttrpg .${fold} > summary::before`) && CSS.includes(`.dbu-ttrpg .${fold}[open] > summary::before`)
        && CSS.includes(`.dbu-ttrpg .${fold} > summary::-webkit-details-marker`)), [true, true, true, true]);
  check("no fold keeps an arrow of its own",
    CSS.includes(".adventuring-list .maneuver-mark"), false);
}

console.log(`${failing} failing`);
process.exit(failing ? 1 : 0);
