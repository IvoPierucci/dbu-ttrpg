/**
 * The only part of the engine that knows Foundry exists.
 *
 * Everything else takes plain data and hands plain data back. This is where a character
 * turns into a list of compiled programs, which is the seam that makes the engine
 * agnostic to where an effect came from: today it walks Talent Items, and when Races,
 * Forms and Conditions arrive it walks those too - without a single consuming call site
 * changing.
 */

import { grantedUniques, uniqueScriptOf } from "../unique.mjs";
import { legacyToProgram } from "./migrate.mjs";
import { compile as compileScript } from "./parser.mjs";
import { PRIORITY } from "./interpreter.mjs";
import { getTrait, traitsOfKind } from "./traits.mjs";
import { environmentIdOf, isAirborne, qualitiesOf } from "../environments.mjs";
import { lightLevelOf } from "../light.mjs";
import { accessoriesInEffect, apparelPenaltyPieces, apparelQualitiesInEffect, craftedReading,
  effectParts, effectsOf, groundIgnored, pieceTokens, scriptWithPiece,
  topLayerPiece, wieldedWeapons, formScript, activeForm, buddiesOf, buddyScript,
  buddyHeader } from "../gear.mjs";

/**
 * Compiled programs, keyed by the source and a hash of what it contained.
 *
 * Keying on the content rather than the id alone makes a stale entry impossible by
 * construction: an edit produces a different key, so nothing has to remember to clear
 * anything. The hooks below only bound how much is kept, they do not fix correctness.
 */
const cache = new Map();

function hash(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

/**
 * Compile one source, reusing the last result when nothing changed.
 *
 * A script is what a Trait carries now. The old typed rows are still understood, so a
 * Talent written before the language existed keeps working - but nothing produces them
 * any more, and `migrateData` gives most of them a script before this is ever reached.
 */
function compile(uuid, { script, rows }, report) {
  const key = `${uuid}#${hash(script || JSON.stringify(rows ?? []))}`;
  const cached = cache.get(key);
  if (cached) return cached;

  let built;
  if (script) {
    const { program, errors } = compileScript(script);
    built = { program, errors };
  }
  else {
    const problems = [];
    const program = legacyToProgram(rows, message => problems.push({ message }));
    built = { program, errors: problems };
  }

  cache.set(key, built);
  // Reported by line where the parser knew one, so an author is pointed at the mistake
  // rather than told the Trait is broken.
  built.errors.forEach(e => report(e.line ? `line ${e.line}: ${e.message}` : e.message));
  return built;
}

/**
 * Every program that applies to a character, with the Priority of what granted it.
 *
 * The Priority comes from the kind of source, exactly as the rulebook's ladder orders
 * them - which is also what the folder a Trait lives in will say once Traits are files.
 */
export function programsFor(actor, { report = () => {}, baseTier = 1, skills = {} } = {}) {
  const entries = [];

  for (const item of actor.items ?? []) {
    // Talents and Maneuvers both. A Maneuver's `script` field has existed since the Item
    // was written and nothing ever compiled it - so a Maneuver whose rules needed an
    // effect had to be given a header flag and a branch in the code instead, which is
    // why there are five of those.
    if ((item.type !== "talent") && (item.type !== "maneuver") && (item.type !== "racial")) continue;

    // A Unique Ability's script is its own and each Advancement bought and Restriction applied.
    const script = (item.type === "maneuver") && (item.system?.tags ?? []).includes("uniqueAbility")
      ? uniqueScriptOf(item.system) : item.system?.script;
    const { program, errors } = compile(
      item.uuid,
      { script, rows: item.system?.effects },
      message => report(`${item.name}: ${message}`)
    );
    // A Trait that does not compile is skipped and named, never applied half-way.
    if (errors.length) continue;

    // What was ticked as a Counter Maneuver was used holds as a passive for its duration - Skill of the Watcher's
    // (chat.mjs answerCounter).
    const boosted = new Set(actor.getFlag?.("dbu-ttrpg", "counterBoost")?.blocks ?? []);
    const held = boosted.size && program.blocks.some(b => boosted.has(`${item.id}#${b.index}`))
      ? { ...program, blocks: program.blocks.map(b => boosted.has(`${item.id}#${b.index}`)
        ? { ...b, mode: "passive", moment: null } : b) }
      : program;

    entries.push({
      program: held,
      // A Racial Trait - the character's own Item, edited as a Talent is - on its own rung, above a Talent.
      priority: (item.type === "racial") ? PRIORITY.racial : PRIORITY.talent,
      sourceId: item.id,
      sourceUuid: item.uuid,
      sourceName: item.name,
      // A Talent has no level and no stacks; States and Conditions will fill these in.
      level: 0,
      stacks: 1
    });
  }

  entries.push(...accessoryPrograms(actor, report));
  entries.push(...apparelPrograms(actor, report));
  entries.push(...weaponPrograms(actor, report));
  entries.push(...buddyPrograms(actor, report, { baseTier, skills }));
  entries.push(...drainPrograms(actor, report));
  entries.push(...karmaPrograms(report));
  entries.push(...statePrograms(actor, report));
  entries.push(...conditionPrograms(actor, report));
  entries.push(...battlefieldPrograms(actor, report));
  entries.push(...coverPrograms(actor, report));
  entries.push(...weatherPrograms(actor, report));
  entries.push(...environmentPrograms(actor, report));
  entries.push(...qualityPrograms(actor, report));
  entries.push(...highPrograms(actor, report));

  return entries;
}

/**
 * The Accessories this character is wearing, one of each.
 *
 * "Accessories are Basic Items that can be equipped and apply benefits while equipped."
 * The effect is the file's script, read through the Item's `gearId` - so a renamed pair of
 * gloves is still the gloves, and one taken off or put in a Capsule applies nothing.
 *
 * At a Talent's Priority: the Priority ladder names no Items, and an Item is held the way a
 * Talent is. Every Accessory so far only adds, where Priority changes nothing.
 */
/**
 * The Qualities of the Apparel this character is wearing.
 *
 * Each Quality's script, with what was chosen for it written in, from every piece worn - a
 * Quality its Category does not take is left out. What the wearer must meet is the script's
 * to ask: "If the wearer of a piece of Apparel does not meet a Apparel Quality's Prerequisite,
 * the Apparel Quality's effects remain inactive while they are wearing it."
 *
 * At a Talent's Priority, as the Accessories are.
 */
function apparelPrograms(actor, report) {
  const entries = [];
  // Its Category only from the Top Layer - or whichever Layer worn is highest.
  const top = topLayerPiece(Array.from(actor.items ?? []));
  const worn = apparelQualitiesInEffect(Array.from(actor.items ?? [])).map(({ item }) => {
    // The piece's own Effects, and nothing else: what its Category and Qualities wrote there,
    // and whatever has been written since. A part at a time, so each keeps its own name in the
    // workings.
    const reading = craftedReading(item.system.crafted, { getTrait, difficulties: {},
      category: item === top });
    // What its Effects may name about it: the Armor's multiplier, the Rolls its Weights
    // reach, and whether they are waived right now.
    const tokens = pieceTokens(item, actor, reading, getTrait);
    const parts = effectParts(effectsOf(item.system.crafted, getTrait))
      // "Benefits that you gain while wearing that piece of Apparel as the Top Layer."
      .filter(part => (part.type !== "category") || (item === top));
    return { item, reading, tokens, parts };
  });
  const kept = doubleDipped(worn);
  for (const { item, reading, tokens, parts } of worn) {
    for (const part of parts) {
      if ((part.type === "quality") && (kept.get(dipKey(part)) !== part)) continue;
      const script = scriptWithPiece(part.key ? part.body : part.text, reading, tokens);
      if (!script.trim()) continue;

      const name = part.name || item.name;
      const { program, errors } = compile(
        `apparel:${item.id}:${part.key ?? "own"}`,
        { script },
        message => report(`${item.name}${part.name ? `, ${part.name}` : ""}: ${message}`)
      );
      if (errors.length) continue;

      entries.push({
        program,
        priority: PRIORITY.talent,
        sourceId: `${item.id}:${part.key ?? "own"}`,
        sourceUuid: item.uuid ?? null,
        sourceName: part.name ? `${name} (${item.name})` : item.name,
        level: 0,
        stacks: 1
      });
    }
  }

  // The Apparel Penalty, one entry for all of it, so the workings name it.
  const penalized = apparelPenaltyPieces(Array.from(actor.items ?? []), getTrait);
  if (penalized > 0) {
    const { program, errors } = compile("apparel-penalty",
      { script: `[passive]\ncombatRolls -= ${penalized} * ceil(1(bT) / 2);` }, report);
    if (!errors.length) {
      entries.push({ program, priority: PRIORITY.base, sourceId: "apparel-penalty",
        sourceUuid: null, sourceName: "Apparel Penalty", level: 0, stacks: 1 });
    }
  }
  return entries;
}

/**
 * What the Weapons this character is wielding do while they are: each one's own Effects, a part
 * at a time - the Magic Staff's "While wielding this Weapon", Warding's Damage Reduction. What
 * they do to an attack made with them is written against `weapon.*` Slots, which nothing here
 * reaches: that is read off the Weapon when the attack is declared.
 *
 * One Quality on both Weapons in hand is gained once, as one on two pieces of Apparel is.
 */
function weaponPrograms(actor, report) {
  const entries = [];
  const held = wieldedWeapons(Array.from(actor.items ?? [])).map(item => ({
    item,
    reading: craftedReading(item.system.crafted, { getTrait, difficulties: {} }),
    // As it is being used: the Category in use and no other - Flexible's.
    parts: effectParts(formScript(effectsOf(item.system.crafted, getTrait),
      activeForm(item.system.crafted), getTrait))
  }));
  const kept = doubleDipped(held);
  for (const { item, reading, parts } of held) {
    for (const part of parts) {
      if ((part.type === "quality") && (kept.get(dipKey(part)) !== part)) continue;
      const script = scriptWithPiece(part.key ? part.body : part.text, reading);
      if (!script.trim()) continue;
      const { program, errors } = compile(`weapon:${item.id}:${part.key ?? "own"}`, { script },
        message => report(`${item.name}${part.name ? `, ${part.name}` : ""}: ${message}`));
      if (errors.length) continue;
      entries.push({
        program,
        priority: PRIORITY.talent,
        sourceId: `${item.id}:${part.key ?? "own"}`,
        sourceUuid: item.uuid ?? null,
        sourceName: part.name ? `${part.name} (${item.name})` : item.name,
        level: 0,
        stacks: 1
      });
    }
  }
  return entries;
}

/**
 * What a character's Buddies do: each one's scripts - its Original Buddy's and its own - with what
 * they name written in. Its Buddy Effect's lines run while it is Active, its Adventure Effect's
 * while its owner is Adventuring; a destroyed one runs nothing. See buddyScript() in gear.mjs.
 */
/**
 * Stat Drain, while it runs: "reduce your Combat Rolls and Soak Value by 1(bT) until the end of
 * your next turn" for each rank. A Disadvantage's lingering effect, not a Combat Condition - held
 * as a number on the character (`statDrain`) with a clock of its own.
 */
function drainPrograms(actor, report) {
  const ranks = Math.max(0, Number(actor.system?.statDrain) || 0);
  if (!ranks) return [];
  const script = `[passive]\ncombatRolls -= ${ranks}(bT);\nsoakValue.external -= ${ranks}(bT);`;
  const { program, errors } = compile("signature:stat-drain", { script },
    message => report(`Stat Drain: ${message}`));
  if (errors.length) return [];
  return [{ program, priority: PRIORITY.talent, sourceId: "stat-drain", sourceUuid: null,
    sourceName: "Stat Drain", level: 0, stacks: 1 }];
}

function buddyPrograms(actor, report, { baseTier = 1, skills = {} } = {}) {
  const entries = [];
  const round = globalThis.game?.combat?.started ? (globalThis.game.combat.round ?? 0) : 0;
  for (const item of buddiesOf(Array.from(actor.items ?? []))) {
    const spiritUuid = item.system?.buddy?.spiritUuid;
    const spirit = (spiritUuid && (buddyHeader(item, getTrait, "spirit") === true))
      ? (globalThis.fromUuidSync?.(spiritUuid) ?? null) : null;
    const script = buddyScript(item, getTrait, { baseTier, round, skills, spirit });
    if (!/^\s*\[/m.test(script)) continue;
    const { program, errors } = compile(`buddy:${item.id}`, { script },
      message => report(`${item.name}: ${message}`));
    if (errors.length) continue;
    entries.push({
      program,
      priority: PRIORITY.talent,
      sourceId: item.id,
      sourceUuid: item.uuid ?? null,
      sourceName: item.name,
      level: 0,
      stacks: 1
    });
  }
  // The Unique Ability an Active Buddy gives access to - the Oracle Fish's Precognition - and so its Passive.
  const active = buddiesOf(Array.from(actor.items ?? [])).find(item => item.system?.buddy?.active) ?? null;
  for (const id of grantedUniques(active, actor.items, (item, key) => buddyHeader(item, getTrait, key))) {
    const trait = getTrait(id);
    if (!trait?.script) continue;
    const { program, errors } = compile(`buddy:${active.id}:${id}`, { script: trait.script },
      message => report(`${trait.name}: ${message}`));
    if (errors.length) continue;
    entries.push({ program, priority: PRIORITY.talent, sourceId: `${active.id}:${id}`, sourceUuid: active.uuid ?? null,
      sourceName: `${trait.name} (${active.name})`, level: 0, stacks: 1 });
  }
  return entries;
}

/**
 * Double Dip: "You cannot gain any specific instance of a Trait, Talent, Quality, Advantage or
 * Disadvantage more than once, unless specifically specified otherwise." One Quality worn on
 * several pieces is gained once - from the piece that gives it the most Quality Slots, and the
 * first of those worn where they tie. What was chosen for it does not make another instance: a
 * Talent with a choice is "a single Talent" all the same.
 *
 * Only what the wearer gains: what a Quality makes of its piece - its Break Value, its Hardness,
 * its Size - is read off that piece alone, by pieceSlots(), and is never counted here.
 *
 * A Dynamic Quality is a Quality made at the table, each one its own: one per name.
 *
 * @returns {Map<string, object>}  the one part kept for each Quality, by dipKey()
 */
export function doubleDipped(worn) {
  const best = new Map();
  for (const { item, parts } of worn) {
    for (const part of parts) {
      if (part.type !== "quality") continue;
      const slots = partSlots(item, part);
      const key = dipKey(part);
      if (!best.has(key) || (slots > best.get(key).slots)) best.set(key, { part, slots });
    }
  }
  return new Map(Array.from(best, ([key, { part }]) => [key, part]));
}

/** What makes two Quality parts the same Quality. */
export function dipKey(part) {
  return (part.id === "dynamic-quality") ? `${part.id}|${part.name}` : part.id;
}

/** The Quality Slots the entry behind a part takes: the nth part of an id is its nth entry. */
function partSlots(item, part) {
  const nth = Number(String(part.key).split(":")[2] ?? 1);
  const entry = (item.system?.crafted?.qualities ?? []).filter(q => q.id === part.id)[nth - 1];
  return Number(entry?.slots ?? 1) || 1;
}

function accessoryPrograms(actor, report) {
  const entries = [];
  for (const item of accessoriesInEffect(Array.from(actor.items ?? []))) {
    const trait = getTrait(item.system.gearId);
    if (!trait || (trait.kind !== "gear")) continue;

    const { program, errors } = compile(
      `gear:${trait.id}`,
      { script: trait.script },
      message => report(`${item.name}: ${message}`)
    );
    if (errors.length) continue;

    entries.push({
      program,
      priority: PRIORITY.talent,
      sourceId: item.id,
      sourceUuid: item.uuid ?? null,
      sourceName: item.name,
      level: 0,
      stacks: 1,
      // Whether the wearer is the Character it was declared for.
      intended: Boolean(item.system.intended?.uuid)
        && (item.system.intended.uuid === actor.uuid)
    });
  }
  return entries;
}

/**
 * The Karmic Effects, which everyone has and nobody holds.
 *
 * Unlike a Talent or a Condition these are not on the character at all - anyone with a
 * Karma Point can take one - so they are always present as programs and do nothing until
 * armed, which is what paying for one does.
 */
function karmaPrograms(report) {
  const entries = [];

  for (const trait of traitsOfKind("karma")) {
    // Only files that actually carry an effect; a placeholder holding comments alone
    // would compile to an empty program and sit in every list for no reason.
    if (!/^\s*\[/m.test(trait.script ?? "")) continue;

    const { program, errors } = compile(
      `karma:${trait.id}`,
      { script: trait.script },
      message => report(`${trait.name}: ${message}`)
    );
    if (errors.length) continue;

    entries.push({
      program,
      priority: PRIORITY.base,
      sourceId: `karma:${trait.id}`,
      sourceUuid: null,
      sourceName: trait.name,
      level: 0,
      stacks: 1
    });
  }

  return entries;
}

/**
 * The States a character is in, as programs.
 *
 * Like a Condition, a State is not owned - but unlike one it has a level, and the level
 * is what most of its effects are written against. Raging at level 2 gives Wound +2(T)
 * rather than unlocking a second effect worth +1(T), which is why the level travels with
 * the entry instead of being folded into the amounts.
 */
function statePrograms(actor, report) {
  const entries = [];

  for (const [key, level] of Object.entries(actor.system?.states ?? {})) {
    const count = Number(level) || 0;
    if (count <= 0) continue;

    const trait = getTrait(key);
    if (!trait) {
      report(`"${key}" is not a State this system knows.`);
      continue;
    }

    const { program, errors } = compile(
      `state:${key}`,
      { script: trait.script },
      message => report(`${trait.name}: ${message}`)
    );
    if (errors.length) continue;

    entries.push({
      program,
      priority: PRIORITY.state,
      sourceId: `state:${key}`,
      sourceUuid: null,
      sourceName: trait.name,
      level: count,
      stacks: 1
    });
  }

  return entries;
}

/**
 * The Combat Conditions a character has, as programs.
 *
 * A Condition is not an Item and is not owned - you have it or you do not - so it lives
 * as a name and a number of stacks on the character, and its behaviour comes from the
 * file of the same name. That is what lets the GM hand one out with a checkbox without
 * creating a document for it.
 */
/**
 * What the ground this character is standing on does to them.
 *
 * One Light Level at a time, read off the character rather than off a Square: every
 * Battlefield rule here is about one character, and what the rest of the map is doing is
 * the table's. The player sets it, or another effect does.
 *
 * Which Trait is which Level is in the Trait files - `lightLevel: -1` - rather than in a
 * table here, so the number sits beside the rule it carries. Normal is a file with no
 * script, so it contributes nothing and is skipped before it can be reported as active.
 *
 * Not built, and not guessed at: Scale and Light Sources. "Each Square has its Light Level
 * calculated individually" and "each Light Source will present an AoE" are both about
 * Squares, and this system has none - it measures no distances and draws no areas. What a
 * Square is lit like is settled at the table and typed in here.
 */
function battlefieldPrograms(actor, report) {
  // The Level set, less whatever Darkened has taken off it.
  const level = lightLevelOf(actor.system, getTrait);

  // Only the files that declare one. Cover is a Battlefield Trait too and has no Light
  // Level at all - leaving it in the search made the answer depend on how a missing header
  // coerces, which is not a thing to leave to chance.
  const trait = traitsOfKind("battlefields")
    .filter(candidate => (candidate.lightLevel !== undefined)
      && (candidate.weather !== true) && (candidate.environment !== true))
    .find(candidate => Number(candidate.lightLevel) === level);

  if (!trait) {
    // Named rather than ignored, as an unknown Condition is: a Light Level with no file
    // is a file that failed to load, and doing nothing quietly sends you looking in the
    // wrong place.
    report(`Light Level ${level} is not one this system has a Battlefield file for.`);
    return [];
  }

  const { program, errors } = compile(
    `battlefield:${trait.id}`,
    { script: trait.script },
    message => report(`${trait.name}: ${message}`)
  );
  if (errors.length) return [];

  // Normal's file is all commentary and no statements - "no effect" is the rule. A
  // program with no blocks in it would contribute nothing anyway; it is dropped here so
  // it cannot be counted among the entries either.
  //
  // Asked of the compiled program rather than of the file's text: everything after the
  // `---` is the script, comments included, so a file with nothing but comments has a
  // `script` that is not empty and a program that is.
  if (!program?.blocks?.length) return [];

  return [{
    program,
    priority: PRIORITY.base,
    sourceId: `battlefield:${trait.id}`,
    sourceUuid: null,
    // The Level's own name, so the workings say "Dark" rather than a number.
    sourceName: trait.name,
    level: 0,
    stacks: 1
  }];
}

/** The High Environment file for the rank this character is at, or nothing. */
function highTrait(actor) {
  const rank = Number(actor?.system?.battlefield?.highEnvironment) || 0;
  if (!rank) return null;
  return traitsOfKind("high").find(trait => Number(trait.highRank) === rank) ?? null;
}

/**
 * The High Environment this character is in.
 *
 * By rank rather than by id, because a rank is what the rules compare - "for every
 * difference in rank of High Environment" - and the id is only how the file is found.
 *
 * Three of the four have no statements at all: what they do is refuse things, and
 * refusing is done by the headers those files carry rather than by a script. So this
 * gathers next to nothing today and is the door for the day one of them adds a value.
 */
function highPrograms(actor, report) {
  const trait = highTrait(actor);
  if (!trait) return [];

  const { program, errors } = compile(
    `high:${trait.id}`,
    { script: trait.script },
    message => report(`${trait.name}: ${message}`)
  );
  if (errors.length) return [];
  if (!program?.blocks?.length) return [];

  return [{
    program,
    priority: PRIORITY.base,
    sourceId: `high:${trait.id}`,
    sourceUuid: null,
    sourceName: trait.name,
    level: 0,
    stacks: 1
  }];
}

/**
 * The Environmental Qualities of the Square this character is standing in.
 *
 * Several at once, unlike everything else on the Battlefield: a Square can be Aflame and
 * Obscured, and the rules list no exclusions between them that are not the ARC's to
 * enforce. So this gathers a program per Quality rather than choosing one.
 *
 * Both sources at once - what the Environment's own file declares and what the player has
 * ticked - because `qualitiesOf` is the one place that answers "which Qualities does this
 * Square have" and two answers to it would be two lists to keep in step.
 */
function qualityPrograms(actor, report) {
  // Ignored altogether by what they are wearing - Environmental Protection.
  if (groundIgnored(Array.from(actor.items ?? []), getTrait).qualities) return [];

  // Gathered whether they are on the ground or above it. A Quality belongs to a Square and
  // a High Environment has Squares of its own - Obscured says so outright: "this
  // Environmental Quality can be applied to Squares within High Environments".
  //
  // What is not gathered while airborne is the Environment's own Qualities, since the
  // Environment is not reaching them either: `qualitiesOf` is asked with no Environment.
  const standing = isAirborne(actor.system)
    ? null
    : getTrait(environmentIdOf(actor.system, getTrait));
  const ids = qualitiesOf(actor.system, standing, getTrait);
  if (!ids.length) return [];

  const entries = [];
  for (const id of ids) {
    const trait = getTrait(id);
    if (!trait) {
      report(`"${id}" is not an Environmental Quality this system has a file for.`);
      continue;
    }
    if (trait.envQuality !== true) {
      report(`"${id}" is a Trait, but it is not an Environmental Quality.`);
      continue;
    }

    const { program, errors } = compile(
      `quality:${trait.id}`,
      { script: trait.script },
      message => report(`${trait.name}: ${message}`)
    );
    if (errors.length) continue;
    // Bouncy and Dangerous are collisions and nothing else, so their files have no
    // statements. Dropped here rather than gathered as an entry that contributes nothing.
    if (!program?.blocks?.length) continue;

    entries.push({
      program,
      priority: PRIORITY.base,
      sourceId: `quality:${trait.id}`,
      sourceUuid: null,
      sourceName: trait.name,
      level: 0,
      stacks: 1
    });
  }
  return entries;
}

/**
 * The Battle Environment this character is standing in.
 *
 * Always one, unlike a Weather: a character is standing on something whatever nobody has
 * said, and the Standard Environment is the file that says it does nothing. So there is no
 * early return for an empty id - an empty one is a character whose data predates this, and
 * the Standard Environment is what they are in.
 */
function environmentPrograms(actor, report) {
  // Not while they are above it. "Layered above the usual Battle Environments" is what a
  // High Environment is, and the Soar Maneuver says the same thing from the other side:
  // coming down is "to leave the High Environment and enter the Battle Environment of the
  // Square they would be occupying", which is not something you enter if you were in it.
  //
  // The Environment itself is left alone on the character: what is under somebody in the
  // Low Sky is still a Lava Environment, and it is what they land in.
  if (isAirborne(actor.system)) return [];
  // Ignored altogether by what they are wearing - Environmental Protection.
  if (groundIgnored(Array.from(actor.items ?? []), getTrait).environments) return [];

  const id = environmentIdOf(actor.system, getTrait);

  const trait = traitsOfKind("battlefields").find(candidate => candidate.id === id);
  if (!trait) {
    report(`"${id}" is not a Battle Environment this system has a file for.`);
    return [];
  }
  if (trait.environment !== true) {
    report(`"${id}" is a Battlefield file, but it is not a Battle Environment.`);
    return [];
  }

  const { program, errors } = compile(
    `battlefield:${trait.id}`,
    { script: trait.script },
    message => report(`${trait.name}: ${message}`)
  );
  if (errors.length) return [];
  // The Standard Environment is all commentary and no statements, the way the Normal Light
  // Level is. Dropped here so it is not counted among the entries either.
  if (!program?.blocks?.length) return [];

  return [{
    program,
    priority: PRIORITY.base,
    sourceId: `battlefield:${trait.id}`,
    sourceUuid: null,
    sourceName: trait.name,
    level: 0,
    stacks: 1
  }];
}

/**
 * The Battle Weather this character is standing in.
 *
 * Gathered by id rather than by a number, unlike the Light Level: there is one Light Level
 * scale and every point on it has a file, and Weathers are a list that grows. An id that
 * names nothing is reported rather than ignored, the same way an unknown Condition is.
 *
 * The Tier is not a gate here. "Each Tier gains the effects of the earlier Tiers", so a
 * Weather at Cataclysmic is doing all three sets at once - which the file says for itself
 * with `battlefield.weather.tier >= 2`, one block per Tier. Gating out here would mean
 * choosing which of the three to gather, and the answer is all of them up to the Tier.
 *
 * Kept apart from Cover and the Light Level because none of the three is an alternative to
 * the others: you can be behind a rock, in the dark, in a storm.
 */
function weatherPrograms(actor, report) {
  // "Battle Weather cannot exist in this Battle Environment." Cannot exist, so it is not
  // gathered rather than reduced to nothing - a Weather Tier of zero would still be a
  // Weather with a name, and that is Brace's rule and a different one.
  //
  // Left on the character rather than cleared: the storm is still there when they come
  // down, and clearing it would be this system deciding something about the ground.
  if (highTrait(actor)?.noWeather === true) return [];

  const id = String(actor.system?.battlefield?.weather?.id ?? "");
  if (!id) return [];
  // "If this would treat the Weather Tier as if it was 0 or less, completely ignore the effects
  // of that Battle Weather" - Weather Resistant.
  if (Number(actor.system?.battlefield?.weather?.felt) === 0) return [];

  const trait = traitsOfKind("battlefields").find(candidate => candidate.id === id);
  if (!trait) {
    report(`"${id}" is not a Battle Weather this system has a file for.`);
    return [];
  }
  if (trait.weather !== true) {
    report(`"${id}" is a Battlefield file, but it is not a Battle Weather.`);
    return [];
  }

  const { program, errors } = compile(
    `battlefield:${trait.id}`,
    { script: trait.script },
    message => report(`${trait.name}: ${message}`)
  );
  if (errors.length) return [];
  if (!program?.blocks?.length) return [];

  return [{
    program,
    priority: PRIORITY.base,
    sourceId: `battlefield:${trait.id}`,
    sourceUuid: null,
    sourceName: trait.name,
    level: 0,
    stacks: 1
  }];
}

/**
 * Cover, when the player says they are behind something.
 *
 * The toggle is the whole gate. There is nothing in the Trait's own script that asks
 * whether it applies, the same way a Combat Condition's script does not ask whether the
 * character has it - being gathered is what "you have this" means here, and a rule written
 * in both places is a rule that can disagree with itself.
 *
 * Kept apart from the Light Level above because they are not alternatives: you can be
 * behind a rock in the dark.
 */
function coverPrograms(actor, report) {
  if (!actor.system?.battlefield?.cover?.active) return [];

  const trait = getTrait("cover");
  if (!trait) {
    report("Cover is not a Battlefield file this system has.");
    return [];
  }

  const { program, errors } = compile(
    "battlefield:cover",
    { script: trait.script },
    message => report(`${trait.name}: ${message}`)
  );
  if (errors.length) return [];

  return [{
    program,
    priority: PRIORITY.base,
    sourceId: "battlefield:cover",
    sourceUuid: null,
    sourceName: trait.name,
    level: 0,
    stacks: 1
  }];
}

/** The Combat Conditions Plastered still feels. */
const PLASTERED_SPARES = Object.freeze(["pinned", "suffocating", "stress-exhaustion", "transfigured"]);

/**
 * The Combat Conditions a Trait or Talent the character has lets them ignore - its file's `ignoresConditions`, while in
 * the State its `ignoresConditionsWhile` names, if it names one: Warrior's Pride's Impaired and Fatigued in Superior.
 */
function conditionsIgnored(actor) {
  const ignored = new Set();
  const list = value => (Array.isArray(value) ? value : String(value ?? "").split(",")).map(each => String(each).trim())
    .filter(Boolean);
  for (const item of Array.from(actor.items ?? [])) {
    if (!["racial", "talent"].includes(item.type)) continue;
    const trait = getTrait(item.flags?.["dbu-ttrpg"]?.sourceId ?? "");
    if (!trait?.ignoresConditions) continue;
    const state = String(trait.ignoresConditionsWhile ?? "").toLowerCase();
    if (state && !((Number(actor.system?.states?.[state]) || 0) > 0)) continue;
    for (const key of list(trait.ignoresConditions)) ignored.add(key.toLowerCase());
  }
  return ignored;
}

function conditionPrograms(actor, report) {
  const entries = [];
  const ignored = conditionsIgnored(actor);

  for (const [key, stacks] of Object.entries(actor.system?.conditions ?? {})) {
    const count = Number(stacks) || 0;
    if (count <= 0) continue;

    const trait = getTrait(key);
    if (!trait) {
      // Named rather than ignored: a Condition nothing defines is a file that failed to
      // load, and silently doing nothing sends you looking at the wrong thing.
      report(`"${key}" is not a Combat Condition this system knows.`);
      continue;
    }
    // Drunk at Plastered: "Ignore the effects of all Combat Conditions (except Pinned, Suffocating, Stress Exhaustion, and
    // Transfigured)" - a Combat Condition's, not a mark's (`combatCondition: no`).
    if (((Number(actor.system?.states?.drunk) || 0) >= 2) && (trait.combatCondition !== false)
      && !PLASTERED_SPARES.includes(key)) continue;
    if (ignored.has(key)) continue;

    const { program, errors } = compile(
      `condition:${key}`,
      { script: trait.script },
      message => report(`${trait.name}: ${message}`)
    );
    if (errors.length) continue;

    entries.push({
      program,
      priority: PRIORITY.condition,
      sourceId: `condition:${key}`,
      sourceUuid: null,
      sourceName: trait.name,
      level: 0,
      stacks: count
    });
  }

  return entries;
}

/**
 * The same list, marked up with what a reactive effect needs: whether the character has
 * armed it and whether it has uses left.
 *
 * Arming is per **block**, not per source. A Talent with two triggered effects used to
 * be impossible to arm separately, because both the armed list and the use counters
 * were keyed on the Talent's id.
 */
/**
 * The moments whose Triggered effects are offered in a window as they happen - the Power Up's, a Maneuver declared, a
 * Botch or a Critical on a Combat Roll - and so never Armed or set Automatic beforehand (the user's). A Counter Maneuver's
 * may be: Automatic, it holds without asking; Triggered, its window asks (chat.mjs answerCounter).
 */
export const WINDOW_MOMENTS = Object.freeze(["power", "declare-maneuver", "botch", "critical",
  // And what Respond and a roll's own window already offer - Flow of Combat's (3) in Respond.
  "defending", "combat-roll", "hit", "being-hit", "before-wound", "clash-resolved"]);

/** A block's moment, without its parameter. */
export function momentOf(block) {
  return String(block?.moment ?? "").split(/[(/]/)[0];
}

export function reactiveFor(actor, options = {}) {
  const armed = new Set(actor.system?.armedEffects ?? actor.system?.armedTalents ?? []);
  // What the player set to Automatic on a Racial Trait (the user's): answers its moment each time, never spent off.
  const automatic = new Set(actor.getFlag?.("dbu-ttrpg", "automatic") ?? []);

  return programsFor(actor, options).flatMap(entry =>
    (entry.program.blocks ?? [])
      .filter(b => (b.mode === "triggered") || (b.mode === "automatic"))
      .map(b => ({
        ...entry,
        program: { ...entry.program, blocks: [b] },
        blockId: `${entry.sourceId}#${b.index}`,
        armed: (b.mode === "automatic") || armed.has(`${entry.sourceId}#${b.index}`)
          || (automatic.has(`${entry.sourceId}#${b.index}`) && !WINDOW_MOMENTS.includes(momentOf(b)))
          // A Talent armed under the old per-Talent key still counts, so nothing a
          // player armed before this change quietly stops working.
          || armed.has(entry.sourceId),
        uses: usesLeft(actor, entry.sourceId, b, siblings(entry.program, b)),
        available: usesLeft(actor, entry.sourceId, b, siblings(entry.program, b)).available,
        budget: b.budget
      }))
  );
}

/**
 * The other blocks of the same printed effect - `effect 3` on two of them - which share its limit: Warrior's Pride's
 * "[Triggered/Raging, Triggered/Power, 1/Encounter]" is once between the two.
 */
function siblings(program, b) {
  const number = b.modifiers?.effect;
  if (!number) return [];
  return (program.blocks ?? []).filter(other => (other.index !== b.index) && (other.modifiers?.effect === number))
    .map(other => other.index);
}

/** What is left of one block's own limits - and of its printed effect's other blocks', `also`. */
export function usesLeft(actor, sourceId, b, also = []) {
  const uses = actor.system?.effectUses ?? actor.system?.talentUses ?? { round: [], encounter: [] };
  const ids = [`${sourceId}#${b.index}`, ...also.map(index => `${sourceId}#${index}`)];

  // Counts recorded under the old per-Talent key still count against the block, so a
  // use spent before this change is not handed back.
  const counts = list => (list ?? []).filter(x => ids.includes(x) || (x === sourceId)).length;

  const perRound = b.budget?.round ?? Infinity;
  const perEncounter = b.budget?.encounter ?? Infinity;
  const spentRound = counts(uses.round);
  const spentEncounter = counts(uses.encounter);

  return {
    round: perRound - spentRound,
    encounter: perEncounter - spentEncounter,
    available: (spentRound < perRound) && (spentEncounter < perEncounter)
  };
}

/**
 * Whether a named Trait is doing anything for this character right now.
 *
 * Written for the `benefiting` condition, which the rulebook phrases as a Trait's name.
 * The visited set comes in through the scope so two Traits naming each other terminate
 * rather than recursing until the stack gives out.
 */
export function benefitsFrom(actor, name, scope, evaluateBlock) {
  const item = (actor.items ?? []).find(i =>
    (i.type === "talent") && (i.name?.toLowerCase() === String(name).toLowerCase()));
  if (!item) return false;

  const { program } = compile(
    item.uuid, { script: item.system?.script, rows: item.system?.effects }, () => {});
  return (program.blocks ?? []).some(b => evaluateBlock(b, scope));
}

/** Drop cached programs for a source that changed, to bound how much is kept. */
export function forget(uuid) {
  for (const key of cache.keys()) {
    if (key.startsWith(`${uuid}#`)) cache.delete(key);
  }
}

/** Clear everything. Used when the world reloads its content. */
export function forgetAll() {
  cache.clear();
}
