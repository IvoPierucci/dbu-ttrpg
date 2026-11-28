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
 * Traits by for the new race's. While something sets `restoreReplaced.<factor>` ("regain access to the Racial Trait that you replaced with
 * the Factor Trait from the Mutation Factor" - Greater Mutation (3), Mastered Reincarnated (1)), that Factor's exchanged Traits are kept
 * and the race Traits they replaced are had again beside them; once it is no longer set, put by again.
 *
 * Not a Fusion's (its own window), nor a Duplicate's (its Master's copied) - nor an Other, a Villainous or a Transformation Trait, nor one
 * another Trait gave.
 */

import { getTrait, traitsOfKind } from "./effects/traits.mjs";
import { getRace, isMinionRace } from "./races.mjs";
import { addRacialTrait, answered, askChoice, askOptions, changeChoice, changeRacialOption, factorOf, minionRacialUnfit,
  ownedRacialTraits, racialFactor, racialItemFrom, racialTraitFiles, racialTraitUnfit, removeRacialTrait, replacedTraitOf,
  unansweredOf } from "./racial.mjs";
import { withChoiceWizard } from "./choice-wizard.mjs";

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
  const changes = raceTraitChanges(actor, { raceChanged });
  if (!changes) return false;
  for (const id of changes.remove) if (actor.items.get(id)) await removeRacialTrait(actor, id);
  const files = changes.add.map(id => getTrait(id)).filter(Boolean);
  if (files.length) await addRaceTraitFiles(actor, files);
  await actor.setFlag(SCOPE, "raceTraitsSet", actor.system.race);
  return true;
}

/**
 * The Factor a race Trait must be exchanged for, by an Option already chosen - in `chosen` lists (Items' `system.chosen`): Enhanced
 * Organism's "You must exchange the Functional Purpose Racial Trait for the Factor Trait" (`exchangesRaceTrait: functional-purpose`,
 * `exchangeFactor: alternate-upbringing` in the Option's header). "" where none.
 */
export function forcedExchange(traitId, chosen) {
  for (const entry of chosen.flat()) {
    if (entry?.key !== "option") continue;
    const option = getTrait(entry.value);
    if (option && (String(option.exchangesRaceTrait ?? "") === traitId) && option.exchangeFactor) return String(option.exchangeFactor);
  }
  return "";
}

/** Which of a Factor's Traits takes a race Trait's place - asked; its id, or "" (closed). */
async function askExchangeFactor(file, factor) {
  const escape = Handlebars.escapeExpression;
  const offered = racialTraitFiles().filter(each => factorOf(each) === factor).sort((a, b) => a.name.localeCompare(b.name));
  if (!offered.length) return "";
  const name = racialFactor(factor)?.name ?? factor;
  const picked = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: `${file.name} - exchanged for a ${name} Factor Trait` },
    content: `<p class="dbu-respond-hint">${escape(file.name)} is exchanged for a Factor Trait of ${escape(name)}: which?</p>
      <select name="factor">${offered.map(each => `<option value="${escape(each.id)}">${escape(each.name)}</option>`).join("")}</select>`,
    buttons: [{ action: "take", label: "Choose", default: true,
      callback: (event, button, dialog) => dialog.element.querySelector('[name="factor"]')?.value ?? "" },
      { action: "cancel", label: "Cancel" }],
    rejectClose: false
  });
  return offered.some(each => each.id === picked) ? picked : "";
}

/**
 * A race's Traits given together (the user's, 2026-11-27): every Option and choice of them asked in one window, Last and Next between
 * them (choice-wizard.mjs) - and only then are they made, what they ask as they are made (a Weapon's, a Unique Ability's) in the same
 * window. One an Option already chosen exchanges for a Factor's (forcedExchange) is not given: which of that Factor's Traits takes its
 * place is asked instead, and given remembering it (`exchangedFor`). Closed before all is answered, every Trait is given all the same,
 * what was not answered left empty (the user's): Set Racial Options asks it later (answerRaceTraitQuestions).
 */
export async function addRaceTraitFiles(actor, files) {
  const title = `${actor.name} - Racial Traits`;
  return withChoiceWizard(title, async wizard => {
    const held = Array.from(actor.items ?? []).map(item => item.system?.chosen ?? []);
    const entries = await wizard.rewindable(async () => {
      const out = [];
      // One an Option may exchange away asked last, once the Options that might are chosen.
      const exchangeable = new Set([...traitsOfKind("races"), ...traitsOfKind("factors")].map(each => String(each.exchangesRaceTrait ?? "")).filter(Boolean));
      const ordered = [...files.filter(file => !exchangeable.has(file.id)), ...files.filter(file => exchangeable.has(file.id))];
      for (const file of ordered) {
        const factor = forcedExchange(file.id, [...held, ...out.map(entry => entry.made?.data?.system?.chosen ?? [])]);
        if (factor) {
          const replacing = getTrait(await askExchangeFactor(file, factor));
          const made = replacing ? await racialItemFrom(replacing, actor, { partial: true }) : null;
          if (made) made.data.flags[SCOPE].exchangedFor = file.id;
          out.push({ file: replacing, made });
          continue;
        }
        out.push({ file, made: await racialItemFrom(file, actor, { partial: true }) });
      }
      return out;
    });
    const made = [];
    for (const entry of entries) {
      if (!entry.made || !entry.file) continue;
      const item = await addRacialTrait(actor, entry.file, { made: entry.made });
      if (item) made.push(item);
    }
    return made;
  });
}

/**
 * The Factors whose replaced race Traits are had again (`restoreReplaced.<factor>` set by an effect of theirs - Greater Mutation (3)'s
 * `restoreReplaced.mutation`).
 */
export function restoredFactors(actor) {
  const slots = actor?.system?.effects?.slots ?? {};
  return new Set(Object.keys(slots).filter(key => key.startsWith("restoreReplaced.") && (slots[key] === true))
    .map(key => key.slice("restoreReplaced.".length)));
}

/**
 * What syncRaceTraits does, worked out: the Item ids to `remove` and the Trait ids to `add`. An exchanged Factor Trait first stands for the
 * race Trait it replaced - unless its Factor is restored (restoredFactors), when it is kept and that race Trait is had too. Then each race
 * Trait wanted is kept once, any other put by; what is missing given. `raceChanged`: every Factor Trait put by too. Null where its race
 * does not say.
 */
export function raceTraitChanges(actor, { raceChanged = false } = {}) {
  const plan = raceTraitPlan(actor);
  if (!plan) return null;
  const wanted = new Set(plan.wanted);
  const restored = restoredFactors(actor);
  const items = Array.from(actor.items ?? []);
  const held = new Set();
  const taken = new Set();
  const remove = [];
  for (const item of items) {
    if (!isFactorTraitItem(item)) continue;
    const slot = String(item.flags?.[SCOPE]?.exchangedFor ?? "");
    if (slot && wanted.has(slot) && !taken.has(slot)) {
      taken.add(slot);
      if (!restored.has(factorOf(item))) held.add(slot);
      continue;
    }
    if (slot || raceChanged) remove.push(item.id);
  }
  for (const item of items) {
    if (!isRaceTraitItem(item)) continue;
    const source = String(item.flags?.[SCOPE]?.sourceId ?? "");
    if (wanted.has(source) && !held.has(source)) held.add(source);
    else remove.push(item.id);
  }
  return { remove, add: plan.wanted.filter(id => !held.has(id)) };
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
  // The race Trait had again beside the Factor Trait that replaced it (restoredFactors): that one's row exchanges, not this.
  if (Array.from(actor.items ?? []).some(each => isFactorTraitItem(each) && (String(each.flags?.[SCOPE]?.exchangedFor ?? "") === slot)))
    return false;
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
  // Restored with the race Trait already had again beside it (restoredFactors): only the Factor Trait goes.
  if (!choice && Array.from(actor.items).some(each => isRaceTraitItem(each) && (String(each.flags?.[SCOPE]?.sourceId ?? "") === slot))) return null;
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
  // A Transformation had or put by: what gives a replaced race Trait back (restoredFactors) may have come or gone.
  const transformationChanged = (item, options, userId) => {
    const actor = item?.parent;
    if ((userId !== game.user.id) || (item?.type !== "transformation") || !managesRaceTraits(actor) || raceTraitsOwed(actor)) return;
    const changes = raceTraitChanges(actor);
    if (changes && (changes.remove.length || changes.add.length)) syncRaceTraits(actor);
  };
  Hooks.on("createItem", transformationChanged);
  Hooks.on("deleteItem", transformationChanged);
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

/** Its Racial and Factor Traits with something left unanswered (unansweredOf), in the Traits tab's order. */
export function unansweredRaceTraits(actor) {
  return ownedRacialTraits(actor).filter(item => !item.system?.other && !item.system?.transformation && unansweredOf(item).length);
}

/**
 * The Progression tab's Set Racial Options (the user's, 2026-11-27): only what was left unanswered, Trait by Trait, in the same window
 * (Last, Next, Done) - an Option effect's missing Options with their own choices, then each choice not made - and written as the pencil
 * writes them (changeRacialOption, changeChoice) once all is asked. Closed midway, what was answered is written.
 */
export async function answerRaceTraitQuestions(actor) {
  const items = unansweredRaceTraits(actor);
  if (!items.length) return 0;
  return withChoiceWizard(`${actor.name} - Racial Options`, async wizard => {
    const steps = await wizard.rewindable(async () => {
      const out = [];
      for (const item of items) {
        const file = getTrait(item.flags?.[SCOPE]?.sourceId ?? "");
        if (!file) continue;
        const chosen = item.system?.chosen ?? [];
        const value = key => chosen.find(entry => entry.key === key)?.value ?? "";
        const given = [];
        for (const gap of unansweredOf(item)) {
          if (gap.kind === "option") {
            const open = gap.group.options.filter(option => !chosen.some(entry => (entry.key === "option") && (entry.value === option.id)));
            const picked = await askOptions(file, open, gap.missing, gap.group.effect);
            if (!picked) continue;
            for (const id of picked) {
              const option = open.find(each => each.id === id);
              const extra = [];
              const script = await answered(option, extra, actor);
              if (script !== null) out.push({ item, option: id, prepared: { script, extra } });
            }
            continue;
          }
          const kind = (gap.which === 3) ? file.choose3 : (gap.which === 2) ? file.choose2 : file.choose;
          const earlier = [value(file.id), value(`${file.id}#2`), value(`${file.id}#3`), ...given].filter(Boolean);
          const picked = await askChoice(file, kind, { actor, earlier });
          if (!picked) continue;
          given.push(picked.value);
          out.push({ item, which: gap.which, value: picked.value });
        }
      }
      return out;
    });
    let written = 0;
    for (const step of steps) {
      const item = actor.items.get(step.item.id);
      if (!item) continue;
      const done = step.option ? await changeRacialOption(item, step.option, "", step.prepared) : await changeChoice(item, step.which, step.value);
      if (done) written++;
    }
    return written;
  });
}

/** Whether its sheet, opened by whoever plays it, should give it its race's Traits: none given for its race yet. */
export function raceTraitsOwed(actor) {
  return managesRaceTraits(actor) && (actor.getFlag?.(SCOPE, "raceTraitsSet") !== actor.system.race);
}

/**
 * Settings' Refresh Racial Traits (the user's, 2026-11-27): a Racial or Factor Trait held twice - the same file - taken off but the first,
 * and the race's put right (syncRaceTraits). How many were taken off.
 */
export async function refreshRaceTraits(actor) {
  const seen = new Set();
  let removed = 0;
  for (const item of Array.from(actor?.items ?? [])) {
    if ((item.type !== "racial") || item.system?.transformation || item.flags?.[SCOPE]?.grantedBy) continue;
    const source = String(item.flags?.[SCOPE]?.sourceId ?? "");
    if (!source) continue;
    if (!seen.has(source)) {
      seen.add(source);
      continue;
    }
    await removeRacialTrait(actor, item.id);
    removed++;
  }
  await syncRaceTraits(actor);
  return removed;
}
