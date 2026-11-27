/**
 * A character's Racial Traits by its race (the user's, 2026-11-27 - in place of the 2026-10 ruling that they were added by hand).
 *
 * "You gain access to all Primary & Secondary Racial Traits listed on your race, unless otherwise stated": choosing a race (and a
 * Subrace) puts its Primary, Secondary and Subrace Traits on the character. A race that says how many Secondary Traits are chosen
 * (`secondaryChoices` in races/<race>.json - the Majins' 4) has them picked on the Progression tab instead (`system.racialPicks`). A
 * Minion that is not a Duplicate nor of a Minion Race (Minion Creation, Step 2) has its Primary Traits and picks two of its Secondary and
 * Subrace Traits - one Subrace Trait at most - the same way; a Minion Race's keeps them all.
 *
 * A Racial Trait is exchanged for a Factor Trait from its row (its exchange button): a Secondary for a Factor Trait that takes a Secondary's
 * place, a Primary only for one that names it ("From Goop (Body) [Majin Regeneration]"). The Factor Trait remembers what it stands for
 * (`flags.dbu-ttrpg.exchangedFor`), and gives it back as it is restored. Changing the race puts every one of the old race's and its Factor
 * Traits by for the new race's.
 *
 * Not a Fusion's (its own window), nor a Duplicate's (its Master's copied) - nor an Other, a Villainous or a Transformation Trait, nor one
 * another Trait gave.
 */

import { getTrait } from "./effects/traits.mjs";
import { getRace, isMinionRace } from "./races.mjs";
import { addRacialTrait, factorOf, minionRacialUnfit, racialFactor, racialTraitFiles, racialTraitUnfit, removeRacialTrait,
  replacedTraitOf } from "./racial.mjs";

const SCOPE = "dbu-ttrpg";

/** Whether this character's Racial Traits come from its race: a Character, an Adversary, a Minion not a Duplicate - with a race. */
export function managesRaceTraits(actor) {
  if (!actor?.system?.race) return false;
  if (!["character", "adversary", "minion"].includes(actor.type)) return false;
  return !((actor.type === "minion") && actor.system?.duplicate);
}

/** A race's own Racial Trait files (no Factor's). */
function raceFiles(race) {
  return racialTraitFiles().filter(file => !factorOf(file) && (file.owner === race));
}

/**
 * What its race gives: `auto` the Traits it has by itself, `pool` those picked on the Progression tab, `choose` how many, `picked` the
 * ids picked, `wanted` all it should have; `minion` whether picked by Minion Creation's rule. Null where its race does not say.
 */
export function raceTraitPlan(actor) {
  if (!managesRaceTraits(actor)) return null;
  const race = actor.system.race;
  const subrace = String(actor.system.subrace ?? "");
  const files = raceFiles(race);
  const primary = files.filter(file => !file.subrace && (file.importance !== "secondary"));
  const secondary = files.filter(file => !file.subrace && (file.importance === "secondary"));
  const ownSubrace = files.filter(file => file.subrace && subrace && (file.subrace === subrace));
  const minion = (actor.type === "minion") && !isMinionRace(race);
  const choose = minion ? 2 : Math.max(0, Number(getRace(race)?.secondaryChoices) || 0);
  const auto = minion ? primary : (choose ? [...primary, ...ownSubrace] : [...primary, ...secondary, ...ownSubrace]);
  const pool = minion ? [...secondary, ...ownSubrace] : (choose ? secondary : []);
  const picked = Array.from(actor.system.racialPicks ?? []).filter(id => pool.some(file => file.id === id));
  return { race, auto, pool, choose, minion, picked, wanted: [...auto.map(file => file.id), ...picked] };
}

/** A race's own Racial Trait Item - not a Factor's, an Other's, a Transformation's, nor one another Trait gave. */
export function isRaceTraitItem(item) {
  if ((item?.type !== "racial") || item.system?.other || item.system?.transformation || item.system?.factor) return false;
  if (item.flags?.[SCOPE]?.grantedBy) return false;
  return getTrait(item.flags?.[SCOPE]?.sourceId ?? "")?.kind === "races";
}

/** A Factor Trait Item of theirs - by an exchange or not. */
function isFactorTraitItem(item) {
  return (item?.type === "racial") && Boolean(item.system?.factor) && !item.system?.other && !item.system?.transformation
    && !item.flags?.[SCOPE]?.grantedBy;
}

/**
 * The character's Racial Traits as its race says: those it should not have put by, those it is missing given (asked their Options as any
 * added one is). An exchanged Factor Trait stands for the one it replaced. `raceChanged`: every Factor Trait put by too.
 */
export async function syncRaceTraits(actor, { raceChanged = false } = {}) {
  const plan = raceTraitPlan(actor);
  if (!plan) return false;
  const wanted = new Set(plan.wanted);
  const held = new Set();
  for (const item of Array.from(actor.items)) {
    const source = String(item.flags?.[SCOPE]?.sourceId ?? "");
    if (isRaceTraitItem(item)) {
      if (wanted.has(source) && !held.has(source)) held.add(source);
      else await removeRacialTrait(actor, item.id);
      continue;
    }
    if (!isFactorTraitItem(item)) continue;
    const slot = String(item.flags?.[SCOPE]?.exchangedFor ?? "");
    if (slot && wanted.has(slot) && !held.has(slot)) {
      held.add(slot);
      continue;
    }
    if (slot || raceChanged) await removeRacialTrait(actor, item.id);
  }
  for (const id of plan.wanted) {
    if (held.has(id)) continue;
    const file = getTrait(id);
    if (file) await addRacialTrait(actor, file);
  }
  await actor.setFlag(SCOPE, "raceTraitsSet", actor.system.race);
  return true;
}

/** The race Trait a row stands for: its own, or the one an exchanged Factor Trait replaced. "" for any other. */
export function slotOf(item) {
  if (isRaceTraitItem(item)) return String(item.flags?.[SCOPE]?.sourceId ?? "");
  return isFactorTraitItem(item) ? String(item.flags?.[SCOPE]?.exchangedFor ?? "") : "";
}

/** Whether a race Trait may be exchanged: a Secondary always; a Primary only where some Factor Trait names it. */
export function exchangeable(actor, item) {
  if (!managesRaceTraits(actor)) return false;
  const slot = slotOf(item);
  const file = getTrait(slot);
  if (!file) return false;
  if (!isRaceTraitItem(item)) return true;
  if (file.importance === "secondary") return true;
  return racialTraitFiles().some(each => factorOf(each) && (replacedTraitOf(each, actor.system.race)?.id === slot));
}

/**
 * What a race Trait's row may be exchanged for: every Factor Trait that takes its place - a Secondary's, any Secondary Factor Trait that
 * names none, or one that names it; a Primary's, one that names it - each with why it is not this character's, dimmed and taken all the
 * same ("" where it is). Those fitting first, by Factor. `original` the race Trait, to restore.
 */
export function exchangeChoices(actor, item) {
  const slot = slotOf(item);
  const original = getTrait(slot);
  if (!original) return { original: null, current: null, choices: [] };
  const race = actor.system.race;
  const subrace = String(actor.system.subrace ?? "");
  const slots = actor.system.effects?.slots ?? null;
  const current = isFactorTraitItem(item) ? String(item.flags?.[SCOPE]?.sourceId ?? "") : "";
  const heldIds = new Set(Array.from(actor.items).map(each => String(each.flags?.[SCOPE]?.sourceId ?? "")));
  const heldFiles = Array.from(actor.items).map(each => getTrait(each.flags?.[SCOPE]?.sourceId ?? "")).filter(Boolean);
  const choices = racialTraitFiles().filter(file => factorOf(file) && (file.id !== current)).filter(file => {
    const named = replacedTraitOf(file, race);
    if (named) return named.id === slot;
    return (original.importance === "secondary") && !original.subrace && (file.importance === "secondary");
  }).map(file => {
    const factor = racialFactor(factorOf(file));
    const most = Number([].concat(factor?.maximumFactor ?? [])[0]);
    const fromFactor = heldFiles.filter(each => factorOf(each) === factorOf(file)).length;
    const why = heldIds.has(file.id) ? "Already had"
      : (racialTraitUnfit(file, race, subrace, slots) || minionRacialUnfit(file, actor, heldFiles)
        || ((Number.isFinite(most) && (most > 0) && (fromFactor >= most)) ? `Its Racial Factor's Maximum Factor is ${most}` : ""));
    return { id: file.id, name: file.name, factor: factor?.name ?? factorOf(file), why };
  }).sort((a, b) => (Boolean(a.why) - Boolean(b.why)) || a.factor.localeCompare(b.factor) || a.name.localeCompare(b.name));
  return { original, current, choices };
}

/**
 * Exchanged: the row's Trait put by and the chosen Factor Trait given in its place, remembering what it stands for - or, `choice` "",
 * the race Trait given back.
 */
export async function exchangeRaceTrait(actor, itemId, choice) {
  const item = actor?.items?.get(itemId);
  const slot = item ? slotOf(item) : "";
  const original = getTrait(slot);
  if (!original) return null;
  const file = choice ? getTrait(choice) : original;
  if (!file) return null;
  await removeRacialTrait(actor, item.id);
  const made = await addRacialTrait(actor, file);
  if (made && choice) await made.setFlag(SCOPE, "exchangedFor", slot);
  return made;
}

/**
 * Hooks: the race or Subrace changed - by this client - its Traits put right (a race changed puts every Factor Trait by too); the picks
 * changed, the same.
 */
export function registerRaceTraitHooks() {
  Hooks.on("updateActor", (actor, changes, options, userId) => {
    if ((userId !== game.user.id) || options?.dbuRaceReset || !managesRaceTraits(actor)) return;
    const system = changes.system ?? {};
    if (("race" in system) || ("subrace" in system)) syncRaceTraits(actor, { raceChanged: "race" in system });
    else if ("racialPicks" in system) syncRaceTraits(actor);
  });
}

/**
 * The world's characters made before (the user's, 2026-11-27: "quitáselos, lo re colocan a mano"): their race and Factor Traits taken
 * off once, by the active GM, and marked to be given their race's again as their sheet is next opened by whoever plays them - who answers
 * any Option asked. What a Trait of theirs gave goes with it; Other, Villainous and Transformation Traits are kept. How many.
 */
export async function resetRaceTraits(actors) {
  let reset = 0;
  for (const actor of actors) {
    if (!managesRaceTraits(actor)) continue;
    const ids = Array.from(actor.items).filter(item => isRaceTraitItem(item) || isFactorTraitItem(item)).map(item => item.id);
    for (const id of ids) if (actor.items.get(id)) await removeRacialTrait(actor, id);
    await actor.update({ "system.racialPicks": [], [`flags.${SCOPE}.-=raceTraitsSet`]: null }, { dbuRaceReset: true });
    reset++;
  }
  return reset;
}

/** Whether its sheet, opened by whoever plays it, should give it its race's Traits: none given for its race yet. */
export function raceTraitsOwed(actor) {
  return managesRaceTraits(actor) && (actor.getFlag?.(SCOPE, "raceTraitsSet") !== actor.system.race);
}
