/**
 * Combat Conditions, as the character carries them.
 *
 * A Condition is not an Item and is not owned - you have it or you do not - so it lives
 * on the character as a name and a number of stacks, and everything it *does* comes from
 * the file of the same name under traits/conditions. That split is what lets the GM hand
 * one out with a checkbox while its rules stay in one editable place.
 *
 * `[on applied]` and `[on removed]` are fired from here rather than from whoever changed
 * the Condition, because there are three ways to change one - the sheet, an effect, and
 * a GM editing the Actor directly - and a Condition that only fires from one of them is
 * worse than one that never fires at all.
 */

import { traitsOfKind } from "./effects/traits.mjs";
import { fireMoment } from "./effects/moments-runtime.mjs";

/**
 * Write a whole ObjectField, removals included.
 *
 * Handing `actor.update` a plain object does *not* remove what is missing from it.
 * ObjectField#_updateDiff diffs the new value against the old and merges the
 * difference, and a key that is simply absent produces no difference at all - so the
 * update comes back empty, nothing changes, and no re-render is even triggered. The
 * checkbox unticks itself in the browser while the character keeps the Condition.
 *
 * ForcedReplacement says "this object, exactly" and skips the diff entirely.
 */
export function replaceObject(value) {
  return foundry.data.operators.ForcedReplacement.create(value);
}

/** Every Combat Condition the system knows, in the order the sheet lists them. */
export function allConditions() {
  return traitsOfKind("conditions").map(trait => ({
    key: trait.id,
    name: trait.name,
    description: trait.description ?? "",
    text: trait.text ?? "",
    // A Condition with a maximum above one stacks; the rest are simply on or off.
    maxStacks: Number(trait.maxStacks) || 1
  }));
}

/** What a character has, as the sheet wants to render it. */
export function conditionsFor(actor) {
  const held = actor.system?.conditions ?? {};

  return allConditions().map(condition => ({
    ...condition,
    stacks: Number(held[condition.key]) || 0,
    active: (Number(held[condition.key]) || 0) > 0,
    stacking: condition.maxStacks > 1
  }));
}

/**
 * Every State the system knows, and where the character stands in each.
 *
 * A State is the same shape as a Condition but its number is a level rather than a
 * count of stacks, and most of its effects scale with it. Kept in this file because
 * they are the same machinery pointed at a different folder.
 */
export function statesFor(actor) {
  const held = actor.system?.states ?? {};

  return traitsOfKind("states").map(trait => {
    const level = Number(held[trait.id]) || 0;
    return {
      key: trait.id,
      name: trait.name,
      description: trait.description ?? "",
      text: trait.text ?? "",
      levels: Number(trait.levels) || 1,
      level,
      active: level > 0,
      levelled: (Number(trait.levels) || 1) > 1
    };
  });
}

/** Enter a State at a level, or leave it. */
export async function setState(actor, key, level) {
  const definition = statesFor(actor).find(s => s.key === key);
  if (!definition) {
    ui.notifications?.warn(`"${key}" is not a State this system knows.`);
    return false;
  }

  const wanted = Math.min(definition.levels, Math.max(0, Math.round(Number(level) || 0)));
  const states = { ...actor.system.states };

  if (wanted <= 0) delete states[key];
  else states[key] = wanted;

  await actor.update({ "system.states": replaceObject(states) });
  return true;
}

/** Leave every State at once, which is what returning to your Normal State means. */
export async function clearStates(actor) {
  if (foundry.utils.isEmpty(actor.system.states ?? {})) return true;
  await actor.update({ "system.states": replaceObject({}) });
  return true;
}

/** In or out, at level one. */
export async function toggleState(actor, key) {
  const current = Number(actor.system.states?.[key]) || 0;
  return setState(actor, key, current > 0 ? 0 : 1);
}

/**
 * Put a Condition on a character, take it off, or change how many stacks it has.
 *
 * Zero or less means removing it outright rather than storing a zero, so that
 * `system.conditions` only ever holds what the character actually has.
 */
export async function setCondition(actor, key, stacks) {
  const definition = allConditions().find(c => c.key === key);
  if (!definition) {
    ui.notifications?.warn(`"${key}" is not a Combat Condition this system knows.`);
    return false;
  }

  // Immunity, written by a State as `forbid condition.<name>`. Refused out loud: a
  // Condition that silently fails to land looks exactly like a bug.
  const current = Number(actor.system.conditions?.[key]) || 0;
  const wanted = Math.min(definition.maxStacks, Math.max(0, Math.round(Number(stacks) || 0)));

  if ((wanted > current) && (actor.system.effects?.slots?.[`condition.${key}`] === false)) {
    ui.notifications?.info(`${actor.name} cannot gain ${definition.name} right now.`);
    return false;
  }
  const conditions = { ...actor.system.conditions };

  if (wanted <= 0) delete conditions[key];
  else conditions[key] = wanted;

  // Relayed when the character is not yours. A Condition is often put on somebody by
  // somebody else - Direct Hit rattles the attacker, and it is the attacker's own
  // client that works out there was no Damage - and writing to an Actor you do not own
  // throws, taking whatever was mid-resolution down with it.
  const { requestActorUpdate } = await import("./chat.mjs");
  await requestActorUpdate(actor, { "system.conditions": replaceObject(conditions) });
  return true;
}

/** On or off, keeping whatever stack count it had. */
export async function toggleCondition(actor, key) {
  const current = Number(actor.system.conditions?.[key]) || 0;
  return setCondition(actor, key, current > 0 ? 0 : 1);
}

/**
 * Fire `[on applied]` and `[on removed]` when what a character has changes.
 *
 * Only on gaining and losing, not on every stack: the rulebook says Slowed applies its
 * lost Actions "immediately (meaning you lose a number of Actions equal to the number of
 * Slowed stacks you gained)", so a stack change fires it for the difference and a
 * Condition already held does not fire it again from nothing.
 */
export function registerConditionHooks() {
  Hooks.on("preUpdateActor", (actor, changes, options) => {
    if (actor.type !== "character") return;
    // Stashed before the write, since afterwards there is nothing left to compare with.
    if (foundry.utils.hasProperty(changes, "system.conditions")) {
      options.dbuConditionsBefore = foundry.utils.deepClone(actor.system.conditions ?? {});
    }
    if (foundry.utils.hasProperty(changes, "system.states")) {
      options.dbuStatesBefore = foundry.utils.deepClone(actor.system.states ?? {});
    }
  });

  Hooks.on("updateActor", async (actor, changes, options) => {
    if (actor.type !== "character") return;

    // One client, or every connected player fires the same Moment. The GM is that one,
    // the same way the combat hooks and the relayed chat edits work.
    if (!game.users.activeGM || (game.users.activeGM !== game.user)) return;

    if (options.dbuConditionsBefore) {
      await announceChanges(actor, options.dbuConditionsBefore,
        actor.system.conditions ?? {}, "condition");
    }
    if (options.dbuStatesBefore) {
      await announceChanges(actor, options.dbuStatesBefore,
        actor.system.states ?? {}, "state");
    }
  });
}

/**
 * Fire what a gain or a loss calls for, one key at a time.
 *
 * `stacks` in an `[on applied]` block is what was *gained*, not the total held, so that
 * "you lose Actions equal to the number of Slowed stacks you gained" comes out right.
 * Entering a State also fires the State's own Moment, which is how an effect answers
 * `triggered/raging` by name.
 */
async function announceChanges(actor, before, after, kind) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of keys) {
    const was = Number(before[key]) || 0;
    const now = Number(after[key]) || 0;
    if (was === now) continue;

    const source = `${kind}:${key}`;
    const context = (kind === "state") ? { state: key } : { condition: key };

    if (now > was) {
      await fireMoment(actor, "on-applied", context, { only: source, stacks: now - was });
      // Entering a State is a Moment other effects can answer, unlike gaining a
      // Condition - the rulebook writes triggers as `triggered/raging`.
      if ((kind === "state") && (was === 0)) await fireMoment(actor, `state/${key}`, context);
    }
    else if (now === 0) {
      await fireMoment(actor, "on-removed", context, { only: source, stacks: was });
    }
  }
}
