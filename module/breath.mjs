/**
 * Held Breath, and the Unbreathable Environment that asks for it.
 *
 * "Upon entering an Unbreathable Environment, make a Survival Skill Check (unless you are
 * Unnatural or otherwise unable to gain the Suffocating Combat Condition). For every
 * Difficulty you exceed with this Dice Score, gain a stack of Held Breath."
 *
 * Four things happen to a stack and they happen in four different places, which is why
 * this is a module rather than a block in a trait file: the Check that hands them out, the
 * Combat Round that takes one, the Health Threshold that takes one, and leaving, which
 * takes them all. What a script in the effects language can say is "while X, Y" - and
 * every one of these is an event.
 *
 * The Suffocating itself is never set by hand anywhere. It follows from the two facts:
 * in an Unbreathable Environment, with no stacks left. `settleBreath` is the one place
 * that reads those two and writes the Condition, so the rule cannot be half-applied by
 * one caller and not another.
 */

import { getTrait, traitsOfKind } from "./effects/traits.mjs";
import { environmentIdOf, highTraitOf } from "./environments.mjs";
import { setCondition } from "./conditions.mjs";
import DBUCharacterData from "./data/actor-character.mjs";

/** The Battle Environment this character is standing in, as a Trait. */
export function environmentOf(actor) {
  if (!actor?.system) return null;
  return getTrait(environmentIdOf(actor.system, getTrait)) ?? null;
}

/**
 * Whether there is nothing to breathe where they are.
 *
 * Two files can say so and only one of them is underfoot: Local Space and Deep Space are
 * Unbreathable, and a character in either is not in the Battle Environment below at all.
 * So the High Environment is asked first, and the ground only when they are on it.
 */
export function isUnbreathable(actor) {
  const rank = Number(actor?.system?.battlefield?.highEnvironment) || 0;
  if (rank) {
    const sky = highTraitOf(actor.system, { all: () => traitsOfKind("high") });
    return sky?.unbreathable === true;
  }
  return environmentOf(actor)?.unbreathable === true;
}

/**
 * Whether the Environment can reach them at all.
 *
 * "Unless you are Unnatural or otherwise unable to gain the Suffocating Combat Condition."
 * Both halves of that are one question here: Unnatural forbids the Condition, so anything
 * that forbids it answers the same way. Which is why there is no separate test for being
 * Unnatural - it would be a second answer to a question that already has one.
 */
export function canSuffocate(actor) {
  return actor?.system?.effects?.slots?.["condition.suffocating"] !== false;
}

/** Stacks of Held Breath. */
export function heldBreath(actor) {
  return Math.max(0, Number(actor?.system?.battlefield?.heldBreath) || 0);
}

/**
 * How many Difficulties a Dice Score reaches.
 *
 * "For every Difficulty you exceed with this Dice Score, gain a stack of Held Breath."
 *
 * Read as meeting rather than beating: a Skill Check meets or exceeds a Difficulty's
 * Target Number to succeed at it, so "every Difficulty you exceed" is every one you would
 * have passed. A 14 is a Qualified Check passed, and three Difficulties reached.
 */
export function difficultiesMet(score) {
  return Object.values(DBUCharacterData.DIFFICULTIES)
    .filter(difficulty => score >= difficulty.tn).length;
}

/**
 * Put the Suffocating where the two facts say it belongs.
 *
 * "While you are in an Unbreathable Environment and have no stacks of Held Breath, you
 * suffer from the Suffocating Combat Condition."
 *
 * While, so it is not gained once and remembered - it is true or it is not, and this is
 * the only place that decides. `drowning` records that the Condition on them is this
 * rule's, so that leaving takes off the one this put on and not one they brought with
 * them from somewhere else.
 */
export async function settleBreath(actor) {
  if (!actor) return;

  const drowning = isUnbreathable(actor) && canSuffocate(actor) && (heldBreath(actor) === 0);
  const was = Boolean(actor.system.battlefield?.drowning);
  if (drowning === was) return;

  // The flag first. `setCondition` refuses to take off a Condition that is held in place,
  // and this is what holds it - so it has to stop being true before the Condition can go.
  await actor.update({ "system.battlefield.drowning": drowning });
  await setCondition(actor, "suffocating", drowning ? 1 : 0);
}

/**
 * One stack off, and then whatever that means.
 *
 * "At the end of each Combat Round and each time you are knocked through a Health
 * Threshold, you lose a stack of Held Breath."
 *
 * Both callers come through here, so the two rules cannot disagree about what losing a
 * stack does - and neither has to know that running out is what starts the drowning.
 */
export async function loseBreath(actor, reason = "") {
  if (!actor || !isUnbreathable(actor)) return false;

  const held = heldBreath(actor);
  if (held > 0) await actor.update({ "system.battlefield.heldBreath": held - 1 });

  await settleBreath(actor);
  return held > 0;
}

/**
 * They have entered an Unbreathable Environment.
 *
 * The Check is not made here. It is offered on the Battlefields tab, because a Skill Check
 * is the sheet's to roll and the card it leaves is the sheet's card - and because a roll
 * that happens to you is one nobody feels they had any part in, which is the same reason
 * the storm asks first.
 *
 * What this does is arm it: nothing held, nothing rolled yet, and the Suffocating settled
 * from those two facts - so a character who walks into the vacuum and does nothing is
 * already suffocating, which is what the rule says.
 */
export async function enteredUnbreathable(actor) {
  await actor.update({
    "system.battlefield.heldBreath": 0,
    "system.battlefield.breathRolled": false
  });
  await settleBreath(actor);
}

/**
 * They have left it.
 *
 * "Lose all stacks of Held Breath and the Suffocating Combat Condition (if it was gained
 * through the rules on Unbreathable Environments) upon leaving an Unbreathable Environment
 * for a Battle Environment that is not Unbreathable."
 *
 * The parenthesis is what `drowning` is for. Suffocating gained some other way is not this
 * rule's to take off, and stepping out of the water would otherwise cure it.
 */
export async function leftUnbreathable(actor) {
  await actor.update({
    "system.battlefield.heldBreath": 0,
    "system.battlefield.breathRolled": false
  });
  // `settleBreath` reads the Environment they are in now, which is a breathable one - so
  // it takes the Condition off exactly when `drowning` says this rule put it there.
  await settleBreath(actor);
}
