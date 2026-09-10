/**
 * The only part of the engine that knows Foundry exists.
 *
 * Everything else takes plain data and hands plain data back. This is where a character
 * turns into a list of compiled programs, which is the seam that makes the engine
 * agnostic to where an effect came from: today it walks Talent Items, and when Races,
 * Forms and Conditions arrive it walks those too - without a single consuming call site
 * changing.
 */

import { legacyToProgram } from "./migrate.mjs";
import { compile as compileScript } from "./parser.mjs";
import { PRIORITY } from "./interpreter.mjs";
import { getTrait, traitsOfKind } from "./traits.mjs";

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
export function programsFor(actor, { report = () => {} } = {}) {
  const entries = [];

  for (const item of actor.items ?? []) {
    if (item.type !== "talent") continue;

    const { program, errors } = compile(
      item.uuid,
      { script: item.system?.script, rows: item.system?.effects },
      message => report(`${item.name}: ${message}`)
    );
    // A Trait that does not compile is skipped and named, never applied half-way.
    if (errors.length) continue;

    entries.push({
      program,
      priority: PRIORITY.talent,
      sourceId: item.id,
      sourceUuid: item.uuid,
      sourceName: item.name,
      // A Talent has no level and no stacks; States and Conditions will fill these in.
      level: 0,
      stacks: 1
    });
  }

  entries.push(...racialPrograms(actor, report));
  entries.push(...karmaPrograms(report));
  entries.push(...statePrograms(actor, report));
  entries.push(...conditionPrograms(actor, report));

  return entries;
}

/**
 * The Racial Traits this character has taken.
 *
 * Checked against the race as well as against the list, so a character whose race is
 * changed stops benefiting from the one they left behind - the id would still be sitting
 * in the array, and without this it would go on applying.
 */
function racialPrograms(actor, report) {
  const entries = [];
  const race = actor.system?.race;

  for (const id of actor.system?.racialTraits ?? []) {
    const trait = getTrait(id);
    if (!trait || (trait.kind !== "races")) {
      report(`"${id}" is not a Racial Trait this system knows.`);
      continue;
    }
    if (race && trait.owner && (trait.owner !== race)) continue;

    const { program, errors } = compile(
      `racial:${id}`,
      { script: trait.script },
      message => report(`${trait.name}: ${message}`)
    );
    if (errors.length) continue;

    entries.push({
      program,
      priority: PRIORITY.racial,
      sourceId: `racial:${id}`,
      sourceUuid: null,
      sourceName: trait.name,
      level: 0,
      stacks: 1
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
function conditionPrograms(actor, report) {
  const entries = [];

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
export function reactiveFor(actor, options = {}) {
  const armed = new Set(actor.system?.armedEffects ?? actor.system?.armedTalents ?? []);

  return programsFor(actor, options).flatMap(entry =>
    (entry.program.blocks ?? [])
      .filter(b => (b.mode === "triggered") || (b.mode === "automatic"))
      .map(b => ({
        ...entry,
        program: { ...entry.program, blocks: [b] },
        blockId: `${entry.sourceId}#${b.index}`,
        armed: (b.mode === "automatic") || armed.has(`${entry.sourceId}#${b.index}`)
          // A Talent armed under the old per-Talent key still counts, so nothing a
          // player armed before this change quietly stops working.
          || armed.has(entry.sourceId),
        uses: usesLeft(actor, entry.sourceId, b),
        available: usesLeft(actor, entry.sourceId, b).available,
        budget: b.budget
      }))
  );
}

/** What is left of one block's own limits. */
export function usesLeft(actor, sourceId, b) {
  const uses = actor.system?.effectUses ?? actor.system?.talentUses ?? { round: [], encounter: [] };
  const id = `${sourceId}#${b.index}`;

  // Counts recorded under the old per-Talent key still count against the block, so a
  // use spent before this change is not handed back.
  const counts = list => (list ?? []).filter(x => (x === id) || (x === sourceId)).length;

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
