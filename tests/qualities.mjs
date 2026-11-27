/**
 * Feature Qualities.
 *
 * Two halves, and they have to be one list or the thing is useless: the tab lists all ten
 * for reading, and the Collision Damage dialog asks about the six that do something at
 * the moment the damage lands. A list built twice is a list that drifts.
 *
 * So what is checked here is that the text is the rulebook's, that exactly the right six
 * are offered, that both readers read the same array - and then the applier is cut out and
 * run, because "Burning gives them Broken" is not a thing a source-text check can see.
 *
 * The arithmetic matters twice over. Rubbery and Fragile both halve, Sudden Stop halves,
 * Launching doubles, and any two of those settled one after the other take a point off a
 * number the rules leave where it started.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
const modUrl = p => pathToFileURL(path.join(ROOT, "module", p)).href;

const CHAT = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8");
const SHEET = fs.readFileSync(
  path.join(ROOT, "module", "sheets", "actor-character-sheet.mjs"), "utf8");
const TAB = fs.readFileSync(
  path.join(ROOT, "templates", "parts", "actor-battlefields.hbs"), "utf8");
const DURATIONS = fs.readFileSync(path.join(ROOT, "module", "durations.mjs"), "utf8");

const { FEATURE_QUALITIES, COLLISION_QUALITIES, featureQuality,
        HARDNESS_RANKS, hardnessValue, COLLISION_DAMAGE } =
  await import(modUrl("features.mjs"));

/** One Hardness Rank by its number. */
const featureQualityRank = rank =>
  HARDNESS_RANKS.find(hardness => hardness.rank === rank);

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

// --- The ten, as the rulebook lists them ---------------------------------------------------
{
  check("all ten Qualities, in the order they are written",
    FEATURE_QUALITIES.map(quality => quality.key),
    ["rubbery", "fragile", "splintering", "burning", "shocking", "sharp",
     "resilient", "metallic", "reflective", "glass"]);

  check("each one named", FEATURE_QUALITIES.map(quality => quality.name),
    ["Rubbery", "Fragile", "Splintering", "Burning", "Shocking", "Sharp",
     "Resilient", "Metallic", "Reflective", "Glass"]);

  // The text, phrase by phrase. A Quality is only ever read - nothing here sets one - so
  // the words are the whole of what it is, and a clause lost in the wrapping is the whole
  // rule lost.
  const says = (key, phrase) => featureQuality(key).text.includes(phrase);

  check("Rubbery, whole", [
    says("rubbery", "halve the amount of Collision Damage you would receive"),
    says("rubbery", "move a number of Squares equal to the Hardness Value directly away"),
    says("rubbery", "only apply this effect once per Combat Round on each individual Feature")
  ], [true, true, true]);

  check("Fragile, whole", [
    says("fragile", "it is destroyed regardless of its Hardness Rank"),
    says("fragile", "halve the Collision Damage you take and you continue your movement"),
    says("fragile", "cease your movement as usual upon colliding with the second Fragile Feature")
  ], [true, true, true]);

  check("Splintering, whole", [
    says("splintering", "If this Feature is destroyed"),
    says("splintering", "all Characters within a Minor Sphere AoE (centered on this Feature)"),
    says("splintering", "receive Collision Damage equal to its Hardness Value")
  ], [true, true, true]);

  check("Burning, whole", [
    says("burning", "If you receive Collision Damage from this Feature"),
    says("burning", "gain a stack of the Broken Combat Condition for 1 Combat Round"),
    says("burning", "(ending on the end of this turn, next Combat Round)")
  ], [true, true, true]);

  check("Shocking, whole", [
    says("shocking", "suffer from the Impediment Combat Condition for 1 Combat Round"),
    says("shocking", "(ending on the end of this turn, next Combat Round)")
  ], [true, true]);

  check("Sharp, whole", [
    says("sharp", "gain 2 stacks of Damage Over Time for 1 Combat Round"),
    says("sharp", "(ending on the end of this turn, next Combat Round)")
  ], [true, true]);

  check("Resilient, whole", [
    says("resilient", "Double the Life Points of this Feature"),
    says("resilient", "anyone benefiting from Cover due to this Feature may reduce the Damage"),
    says("resilient", "even if hit by an Attacking Maneuver that possesses an AoE")
  ], [true, true, true]);

  check("Metallic, whole", [
    says("metallic", "It must have a Hardness Rank of 3+"),
    says("metallic", "remove all other Feature Qualities on this Feature")
  ], [true, true]);

  check("Reflective, whole", [
    says("reflective", "of the Energy Foundation or the Elemental (Light) Profile"),
    says("reflective", "fails to hit you while you are in Cover behind this Feature"),
    says("reflective", "you may roll Strike against an Opponent of your choice"),
    says("reflective", "rolls the Wound Roll for their initial Attacking Maneuver instead as an Urgent Roll"),
    says("reflective", "including any Ki Wagers and Energy Charges included on that Attacking Maneuver")
  ], [true, true, true, true, true]);

  check("Glass, whole", [
    says("glass", "increasing its Hardness Rank by 1"),
    says("glass", "remove all other Feature Qualities on this Feature")
  ], [true, true]);

  check("and nothing is looked up that is not there", featureQuality("granite"), null);
}

// --- Which six the dialog asks about, and why -----------------------------------------------
{
  // Offered exactly when the Quality does something to a Character taking Collision
  // Damage. The other four are about the Feature - its Life Points, what it does when
  // destroyed, what bounces off it - and there is nothing here for them to act on.
  check("the six the collision dialog offers",
    COLLISION_QUALITIES.map(quality => quality.key),
    ["rubbery", "fragile", "burning", "shocking", "sharp"]);

  check("and it is the same array the tab reads from, filtered",
    COLLISION_QUALITIES.every(quality => FEATURE_QUALITIES.includes(quality)), true);

  check("what each of them does",
    COLLISION_QUALITIES.map(quality => quality.collision), [
      { halves: true, manual: featureQuality("rubbery").collision.manual },
      { halves: true, manual: featureQuality("fragile").collision.manual },
      { condition: "broken", stacks: 1 },
      { condition: "impediment", stacks: 1 },
      { dot: 2 }
    ]);

  // Splintering is Collision Damage and is deliberately not on that list: it is dealt to
  // an area rather than to whoever collided, and areas are the table's. Left out with a
  // reason written down, so this is a decision rather than an omission.
  check("Splintering is left out on purpose, and says why",
    Boolean(featureQuality("splintering").note) && !featureQuality("splintering").collision,
    true);
  check("and so is Resilient, whose half is the Cover toggle",
    Boolean(featureQuality("resilient").note) && !featureQuality("resilient").collision,
    true);
}

// --- Both readers read this file ------------------------------------------------------------
{
  // The bug this exists to stop: a second copy of the list. Two lists is one of them going
  // stale, and neither saying so.
  check("the sheet reads the list from features.mjs",
    SHEET.includes('import { COLLISION_DAMAGE, FEATURE_QUALITIES, HARDNESS_RANKS, '
      + 'hardnessValue } from "../features.mjs";'), true);
  check("and hands the page a row for every one of them",
    SHEET.includes("context.featureQualities = FEATURE_QUALITIES.map("), true);
  // The chat reads the whole list too now - Elemental (Plantlife) names the Feature it
  // builds on the card - so what is pinned is the dialog itself: the collision window
  // offers the filtered five and never the whole ten.
  check("the chat reads both from features.mjs",
    CHAT.includes('import { COLLISION_DAMAGE, COLLISION_QUALITIES, FEATURE_QUALITIES, '
      + 'HARDNESS_RANKS, hardnessValue }'), true);
  {
    const at = CHAT.search(/async function askCollisionDamage\(/);
    const next = CHAT.slice(at + 1).search(/\n(export )?(async )?function /);
    const dialog = CHAT.slice(at, at + 1 + next);
    check("the dialog reads the filtered one",
      [at > 0, dialog.includes("COLLISION_QUALITIES"), dialog.includes("FEATURE_QUALITIES")],
      [true, true, false]);
  }
  // A rule's words appear in exactly one file. Its name may be said in a comment - it is
  // what the comment is about - so what is looked for is the text, which is the thing that
  // goes stale when it is written twice.
  const phrase = "halve the amount of Collision Damage you would receive";
  check("and none of them copies a rule out by hand",
    [SHEET.includes(phrase), CHAT.includes(phrase), TAB.includes(phrase)],
    [false, false, false]);
  check("while features.mjs has it",
    featureQuality("rubbery").text.includes(phrase), true);
}

// --- The tab lists them, collapsed -----------------------------------------------------------
{
  check("the tab has a Feature Qualities section",
    TAB.includes("Feature Qualities"), true);
  check("as a <details>, so ten paragraphs are not what the tab opens on",
    TAB.includes('<details class="condition-group" data-section="featureQualities"'), true);
  check("remembering whether it was left open",
    TAB.includes("{{#if openSections.featureQualities}}open{{/if}}"), true);
  check("and it walks the list rather than naming any of them",
    TAB.includes("{{#each featureQualities as |quality|}}"), true);
  check("drawing the name and the rule's own words",
    [TAB.includes("{{quality.name}}"), TAB.includes("{{quality.text}}")], [true, true]);
  check("and marking the ones the collision dialog will ask about",
    TAB.includes("{{#if quality.onCollision}}"), true);

  // Nothing on this tab sets a Quality, because a Quality is a Feature's and a Feature is
  // the ARC's. A name= in that section would be a field writing to a schema that has no
  // room for it.
  const from = TAB.indexOf("Feature Qualities");
  check("nothing in the section writes to the character",
    TAB.slice(from).includes("name=\"system."), false);
}

// --- The arithmetic ---------------------------------------------------------------------------
{
  // Every halving at once. Rubbery and Fragile can both be true of one Feature, and
  // between them and a Sudden Stop there are three ways to halve one number.
  const settle = (value, doubled, halvings) =>
    Math.floor(value * (doubled ? 2 : 1) * (0.5 ** halvings));

  check("the source counts the halvings rather than asking about one",
    CHAT.includes("const halvings = (halved ? 1 : 0)\n"
      + "    + applied.filter(quality => quality.collision.halves).length"), true);
  // And the doublings, since a Dangerous Square doubles a Ground Collision the way a
  // Launching Profile doubles a Knockback's.
  check("and the doublings the same way",
    CHAT.includes("const doublings = (doubled ? 1 : 0)"), true);
  check("and settles them in one multiply, rounded once",
    CHAT.includes("const amount = Math.floor(value * (2 ** doublings) * (0.5 ** halvings));"),
    true);

  check("nothing applied is the Hardness Value whole", settle(7, false, 0), 7);
  check("a Rubbery wall halves it, rounded down", settle(7, false, 1), 3);
  check("Launching doubles and Rubbery halves, leaving it where it started",
    settle(7, true, 1), 7);
  check("Rubbery and Fragile both, which one Feature may be", settle(9, false, 2), 2);
  check("and a Sudden Stop on top of the two of them", settle(9, false, 3), 1);

  // Why it is one multiply. Halving 9 three times one after the other floors three times.
  check("which taking them one at a time would not have given",
    [Math.floor(Math.floor(Math.floor(9 * 0.5) * 0.5) * 0.5), settle(9, false, 3)], [1, 1]);
  check("nor on an odd number that survives the round trip",
    [Math.floor(Math.floor(7 * 0.5) * 2), settle(7, true, 1)], [6, 7]);

  check("and the reason on the Life Point card names each one that halved it",
    CHAT.includes("map(quality => `halved by ${quality.name}`)"), true);
}

// --- What a Quality leaves behind, run ----------------------------------------------------------
{
  // Cut out and run. "Burning gives them a stack of Broken, on a clock kept by whoever is
  // taking the turn" has four moving parts and no source-text check can see any of them.
  const from = CHAT.indexOf("async function applyFeatureQualities(");
  const to = CHAT.indexOf("/**\n * The Collision Damage window", from);
  check("the applier was found to cut out", (from > 0) && (to > from), true);

  // The dynamic import is the one thing that cannot survive being cut out of its file, so
  // it is handed in instead. Everything else in the slice is left exactly as written.
  const body = CHAT.slice(from, to)
    .replace('const { setCondition } = await import("./conditions.mjs");', "");

  const calls = [];
  const setCondition = async (actor, key, stacks) => {
    calls.push(["setCondition", actor.name, key, stacks]);
    actor.system.conditions = { ...actor.system.conditions, [key]: stacks };
    return true;
  };
  const clocks = [];
  const lasting = async (keeper, entry) => { clocks.push({ keeper: keeper.name, ...entry }); };

  const { KINDS, EDGES } = await import(modUrl("durations.mjs"));

  const make = (name, uuid) => ({
    name, uuid,
    system: { conditions: {}, dotStacks: 0 },
    async update(changes) { Object.assign(this.system, {
      dotStacks: changes["system.dotStacks"] ?? this.system.dotStacks }); }
  });

  const run = (qualities, { turnOf = null } = {}) => {
    const target = make("Krillin", "Actor.krillin");
    globalThis.game = turnOf
      ? { combat: { started: true, combatant: { actor: turnOf } } }
      : { combat: null };
    const apply = new Function("setCondition", "lasting", "KINDS", "EDGES", "game",
      `${body}\nreturn applyFeatureQualities;`)(
        setCondition, lasting, KINDS, EDGES, globalThis.game);
    return apply(target, qualities, "Knockback").then(said => ({ target, said }));
  };

  const vegeta = make("Vegeta", "Actor.vegeta");

  // Nothing ticked, which is the ordinary answer.
  {
    calls.length = 0; clocks.length = 0;
    const { said } = await run([]);
    check("no Quality leaves nothing to say", said, []);
    check("and sets nothing", [calls.length, clocks.length], [0, 0]);
  }

  // Burning: a stack of Broken, on top of what they were already carrying.
  {
    calls.length = 0; clocks.length = 0;
    const { target, said } = await run([featureQuality("burning")], { turnOf: vegeta });
    check("Burning gives them a stack of Broken", target.system.conditions.broken, 1);
    check("one clock for it", clocks.length, 1);
    check("counted by whoever is taking the turn, not by whoever was thrown",
      [clocks[0].keeper, clocks[0].on], ["Vegeta", "Actor.krillin"]);
    check("ending on an end edge, one Combat Round out",
      [clocks[0].edge, clocks[0].next], [EDGES.END, true]);
    check("as a Condition", clocks[0].kind, KINDS.CONDITION);
    check("named for what did it", clocks[0].source, "Knockback - Burning");
    check("and the card says so",
      said[0].includes("Broken") || said[0].includes("Burning leaves them"), true);
  }

  // "Gain a stack" is on top of, not set to. A character already Broken twice comes out of
  // this Broken three times.
  {
    calls.length = 0; clocks.length = 0;
    const target = make("Krillin", "Actor.krillin");
    target.system.conditions = { broken: 2 };
    globalThis.game = { combat: { started: true, combatant: { actor: vegeta } } };
    const apply = new Function("setCondition", "lasting", "KINDS", "EDGES", "game",
      `${body}\nreturn applyFeatureQualities;`)(
        setCondition, lasting, KINDS, EDGES, globalThis.game);
    await apply(target, [featureQuality("burning")], "Knockback");
    check("a stack gained is a stack on top of the ones they had",
      target.system.conditions.broken, 3);
  }

  // Shocking: Impediment, the same way.
  {
    calls.length = 0; clocks.length = 0;
    const { target } = await run([featureQuality("shocking")], { turnOf: vegeta });
    check("Shocking gives them Impediment", target.system.conditions.impediment, 1);
    check("on one clock", [clocks.length, clocks[0].key], [1, "impediment"]);
  }

  // Sharp: two stacks of Damage Over Time, which is neither a Condition nor a Resource.
  {
    calls.length = 0; clocks.length = 0;
    const { target, said } = await run([featureQuality("sharp")], { turnOf: vegeta });
    check("Sharp leaves two stacks of Damage Over Time", target.system.dotStacks, 2);
    check("no Condition is set, because DOT is not one", calls.length, 0);
    // Two clocks, not one. A stack gained later must not be taken off by a clock that
    // started sooner - which is the rule the Resource kind already follows.
    check("on a clock each", clocks.length, 2);
    check("of their own kind", [...new Set(clocks.map(c => c.kind))], [KINDS.DOT]);
    check("and the card says both stacks", said[0].includes("2 stacks"), true);
  }

  // Rubbery and Fragile do their halving in the number, not here. What they leave is the
  // half this system does not do - and it is said rather than dropped.
  {
    calls.length = 0; clocks.length = 0;
    const { said } = await run([featureQuality("rubbery")], { turnOf: vegeta });
    check("Rubbery sets nothing", [calls.length, clocks.length], [0, 0]);
    check("and says what the table still has to do", [
      said.length,
      said[0].includes("Hardness Value Squares"),
      said[0].includes("per Combat Round on each individual Feature")
    ], [1, true, true]);
  }
  {
    calls.length = 0; clocks.length = 0;
    const { said } = await run([featureQuality("fragile")], { turnOf: vegeta });
    check("Fragile the same, and says the Feature is gone",
      [clocks.length, said[0].includes("destroyed")], [0, true]);
  }

  // Several at once. One Feature can be Burning and Sharp both.
  {
    calls.length = 0; clocks.length = 0;
    const { target, said } = await run(
      [featureQuality("burning"), featureQuality("sharp")], { turnOf: vegeta });
    check("a Burning, Sharp Feature does both",
      [target.system.conditions.broken, target.system.dotStacks], [1, 2]);
    check("with a clock for each stack of each", clocks.length, 3);
    check("and a sentence for each Quality", said.length, 2);
  }

  // Outside a Combat there is no turn being taken, so the character keeps their own.
  {
    calls.length = 0; clocks.length = 0;
    const { said } = await run([featureQuality("burning")]);
    // `on` is always passed: `lasting` itself drops it when it names the character keeping
    // the clock, and the stub here does not, so what this checks is that the keeper is the
    // character rather than somebody else.
    check("outside a Combat the clock is their own",
      [clocks[0].keeper, clocks[0].on], ["Krillin", "Actor.krillin"]);
    check("and the card says so", said[0].includes("their own"), true);
  }
}

// --- The clock the DOT stacks run on ------------------------------------------------------------
{
  // A kind of its own, because DOT is a count on the character and is neither a Combat
  // Condition nor a Resource - and nothing in the rules said how long a stack lasts until
  // Sharp did.
  check("durations knows a DOT kind", DURATIONS.includes('DOT: "dot"'), true);
  check("and knows how to take one off",
    DURATIONS.includes("if (entry.kind === KINDS.DOT) {"), true);
  check("one stack an entry, like a Resource",
    DURATIONS.includes('const left = Math.max(0, (actor.system.dotStacks ?? 0) - 1);'), true);

  // Run, rather than read. `takeOff` is where a clock running out actually does something.
  const from = DURATIONS.indexOf("async function takeOff(owner, entry) {");
  const to = DURATIONS.indexOf("/** Whether this character is holding this thing", from);
  check("takeOff was found to cut out", (from > 0) && (to > from), true);

  const { KINDS } = await import(modUrl("durations.mjs"));
  const takeOff = new Function("KINDS", "setState", "setCondition", "replaceObject",
    "fromUuidSync", "console",
    `${DURATIONS.slice(from, to)}\nreturn takeOff;`)(
      KINDS, async () => true, async () => true, v => v, () => null,
      { warn: () => {} });

  const burning = {
    system: { dotStacks: 2 },
    async update(changes) { this.system.dotStacks = changes["system.dotStacks"]; }
  };

  await takeOff(burning, { kind: KINDS.DOT, key: "dot" });
  check("one clock running out takes one stack", burning.system.dotStacks, 1);
  await takeOff(burning, { kind: KINDS.DOT, key: "dot" });
  check("the second takes the other", burning.system.dotStacks, 0);
  await takeOff(burning, { kind: KINDS.DOT, key: "dot" });
  check("and a third takes it no lower", burning.system.dotStacks, 0);
}

// --- The dialog offers them, and a cancel is a cancel -------------------------------------------
{
  check("the window asks which Hardness Rank they hit rather than for a number",
    CHAT.includes('<select name="hardness">${ranks}</select>')
      && !CHAT.includes('<input type="number" name="collision"'), true);
  check("with every Rank in it, its Damage worked out, and what it is made of",
    CHAT.includes("const ranks = HARDNESS_RANKS.map(hardness =>")
      && CHAT.includes("hardnessValue(hardness.rank, baseTier)} Damage")
      && CHAT.includes("Handlebars.escapeExpression(hardness.material)"), true);

  // Short enough to read in a dropdown, which is the whole reason it is a field of its
  // own rather than the rule with its first clause chopped off.
  check("each Rank has a short name for the picker",
    HARDNESS_RANKS.map(hardness => hardness.material),
    ["sand, the surface of water", "wood, gravel", "stone, bone, cement",
     "metal, resilient stone", "reinforced metals", "Katchin, or its equal"]);
  check("and none of them is long enough to be cut off",
    HARDNESS_RANKS.every(hardness => hardness.material.length <= 28), true);

  // The half a markup check cannot see: what comes back has to be what was picked. A
  // dropdown drawn correctly and read as a constant looks right and is not.
  //
  // Not a number any more: "the ground" is an answer of its own beside the six Ranks, so
  // the value is kept as it came back and resolved afterwards. Which one it was is
  // `environments.mjs`'s to check.
  check("and what comes back is what was picked",
    CHAT.includes(
      `picked: dialog.element.querySelector('select[name="hardness"]').value,`),
    true);

  // "the base Tier of Power of the Character who is suffering the Collision Damage" -
  // their base one, so a Transformation does not make a wall hit harder.
  check("worked out against their base Tier of Power, not their current one",
    CHAT.includes("const baseTier = Math.max(1, target.system.baseTierOfPower ?? 1);"),
    true);

  check("the dialog draws a row per Quality",
    CHAT.includes("const qualities = COLLISION_QUALITIES.map(quality => `"), true);
  check("each a checkbox carrying its key",
    CHAT.includes('<input type="checkbox" name="quality" value="${quality.key}"/>'), true);
  // Five rules printed under five names turned a window somebody passes through in two
  // seconds into a page of small print. The words are still there, on hover.
  check("with the rule's own words on hover rather than under the name",
    CHAT.includes('data-tooltip="${Handlebars.escapeExpression(quality.text)}"'), true);
  check("and not printed into the row",
    CHAT.includes("<em>${Handlebars.escapeExpression(quality.text)}</em>"), false);
  check("the list is headed rather than explained",
    CHAT.includes('<p class="dbu-respond-hint dbu-list-label">Feature Qualities</p>'),
    true);
  check("with nothing asking them a question about it",
    CHAT.includes("Did the Feature they hit have any of these Qualities?"), false);
  check("and what they hit is asked for in the same window",
    CHAT.includes('<select name="hardness">') && CHAT.includes("${qualities}"), true);

  // The one that used to be a bug waiting: `if (!typed) return` was right when the answer
  // was a number and is wrong now that it is an object. Zero Collision Damage off a
  // Burning wall is still a stack of Broken.
  check("only a closed window stops there",
    CHAT.includes("if (!chosen) return null;"), true);
  check("rather than a typed nothing",
    CHAT.includes("if (!typed) return;"), false);
  // Rank 0 is a real answer and is the one the dropdown opens on, so a falsy rank must not
  // read as "they answered nothing" - which is the shape the old `if (!typed)` had.
  check("and Rank 0 is not mistaken for no answer",
    CHAT.includes("if (!chosen.rank") || CHAT.includes("if (!rank"), false);
  check("and what came back carries both halves",
    CHAT.includes("const value = hardnessValue(rank, baseTier);")
    && CHAT.includes("chosen.keys.includes(quality.key)"), true);
}


// --- Hardness: the Rank is the Feature's, the Value is yours ------------------------------------
{
  // "There are 6 Hardness Ranks", and the bracketed number beside each is not a property
  // of the Feature at all - it scales with the base Tier of Power of whoever hit it. The
  // same wall costs two characters two different numbers, which is the whole reason the
  // window works it out instead of asking.
  // "Collision Damage: reduce your Life Points by the Hardness Value of the Feature you
  // Collided with." Which is the sentence the whole window rests on: the Value is not
  // something the damage is worked out from, it is the damage. Picking the Rank is picking
  // the number, and the only things between the two are the doublings and halvings that
  // other rules hand it.
  check("what Collision Damage is, whole", [
    COLLISION_DAMAGE.includes("reduce your Life Points by the Hardness Value"),
    COLLISION_DAMAGE.includes("of the Feature you Collided with")
  ], [true, true]);
  check("said in the window that applies it, on the picker it is about",
    CHAT.includes("const howItWorks = `${COLLISION_DAMAGE} The Value is twice the Rank")
      && CHAT.includes('data-tooltip="${Handlebars.escapeExpression(howItWorks)}"'), true);
  // Through the escape, like everything else. A character named with an apostrophe or a
  // quote would otherwise end the attribute early and take the window with it.
  check("with the character's name escaped like the rest of it",
    CHAT.includes("${target.name}'s base Tier of ")
      && CHAT.includes("Handlebars.escapeExpression(howItWorks)"), true);
  const SECTION = TAB.slice(TAB.indexOf('data-section="hardness"'));
  check("and on the tab, above the Ranks",
    SECTION.includes("{{collisionDamage}}")
      && (SECTION.indexOf("{{collisionDamage}}")
          < SECTION.indexOf("{{#each hardnessRanks")), true);
  check("from the one file that has it", [
    CHAT.includes("reduce your Life Points by the Hardness Value"),
    TAB.includes("reduce your Life Points by the Hardness Value"),
    SHEET.includes("reduce your Life Points by the Hardness Value")
  ], [false, false, false]);

  // The sentence and the sum have to agree, which is the thing worth pinning: nothing is
  // added to the Value on the way to becoming the damage.
  check("nothing sits between the Value and the damage",
    CHAT.includes("const amount = Math.floor(value * (2 ** doublings) * (0.5 ** halvings));"),
    true);

  check("six Ranks, 0 to 5", HARDNESS_RANKS.map(hardness => hardness.rank),
    [0, 1, 2, 3, 4, 5]);

  // "The easiest way to remember it is that (aside from Hardness Rank 0), the Hardness
  // Value is twice the Hardness Rank multiplied by the base Tier of Power." Rank 0 is the
  // exception and is 1(bT) - sand and the surface of water still cost something.
  check("the multiplier is twice the Rank, except at Rank 0",
    HARDNESS_RANKS.map(hardness => hardness.perBaseTier), [1, 2, 4, 6, 8, 10]);
  check("and every one of them except Rank 0 is twice its Rank",
    HARDNESS_RANKS.filter(hardness => hardness.rank > 0)
      .every(hardness => hardness.perBaseTier === (2 * hardness.rank)), true);
  check("while Rank 0 is 1(bT), not nothing",
    featureQualityRank(0).perBaseTier, 1);

  // The sum itself, against a real base Tier of Power.
  check("a base Tier of 1 is the bracketed number",
    HARDNESS_RANKS.map(hardness => hardnessValue(hardness.rank, 1)), [1, 2, 4, 6, 8, 10]);
  check("a base Tier of 3 is three times it",
    HARDNESS_RANKS.map(hardness => hardnessValue(hardness.rank, 3)), [3, 6, 12, 18, 24, 30]);
  check("and Rank 0 scales with the rest of them", hardnessValue(0, 4), 4);

  // A base Tier of Power below 1 is not a character the rules describe, and a Value of 0
  // would be a collision that cost nothing - so it floors at one rather than multiplying
  // by whatever turned up.
  check("nothing below a base Tier of 1", [hardnessValue(2, 0), hardnessValue(2, -3)],
    [4, 4]);
  check("and a Rank nobody has is worth nothing", hardnessValue(9, 3), 0);

  // The text, which is what somebody picking from the dropdown is actually reading.
  const material = rank => featureQualityRank(rank).text;
  check("what each Rank is made of", [
    material(0).includes("not structurally sound, such as sand or the surface of water"),
    material(0).includes("Features cannot have a Hardness value of 0, but the Squares themselves can"),
    material(1).includes("made of wood or a collection of harder substances, like gravel"),
    material(2).includes("made of stone, bone or cement"),
    material(3).includes("made of metal or more resilient stone"),
    material(4).includes("made from reinforced metals"),
    material(5).includes("forged of Katchin, the strongest metal in the universe")
  ], [true, true, true, true, true, true, true]);
}

// --- The tab lists Hardness, and the button that opens the window -------------------------------
{
  check("the tab has a Hardness section", TAB.includes("Hardness"), true);
  check("collapsed, like the Qualities beside it",
    TAB.includes('<details class="condition-group" data-section="hardness"'), true);
  check("walking the same list rather than printing a second one",
    TAB.includes("{{#each hardnessRanks as |hardness|}}"), true);
  check("with the Value worked out rather than written as notation",
    TAB.includes("{{hardness.value}} Damage to you"), true);
  check("and the page is told whose base Tier of Power that is",
    TAB.includes("{{baseTierOfPower}}"), true);

  check("the sheet works each Value out for this character",
    SHEET.includes("value: hardnessValue(hardness.rank, context.baseTierOfPower)"), true);
  check("off their base Tier of Power, not their current one",
    SHEET.includes("context.baseTierOfPower = system.baseTierOfPower ?? 1;"), true);

  // The other way into the window. Most collisions in these rules are not a card this
  // system opened, and before this there was no way to take one that was not.
  check("the tab has a button to take a collision",
    TAB.includes('data-action="takeCollision"'), true);
  check("named for what it does",
    TAB.includes("Receive Collision Damage"), true);
  check("wired to an action",
    SHEET.includes("takeCollision: DBUCharacterSheet._onTakeCollision,"), true);
  check("that opens the same window the card opens",
    SHEET.includes("return takeCollisionDamage(this.actor);"), true);
  check("which chat.mjs exports for it",
    CHAT.includes("export async function takeCollisionDamage(actor) {"), true);
  // Nothing doubles or halves it on that door: both are things a Clash knows about.
  check("and opens it with nothing doubling or halving",
    CHAT.includes("return askCollisionDamage(actor, { title: `${actor.name} - Collision Damage` });"),
    true);
}

console.log(`${failed} failing`);
process.exit(failed ? 1 : 0);
