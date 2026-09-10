/**
 * Things an effect can do, as opposed to values it can change.
 *
 * A Slot is a number or a flag that some line of the pipeline reads. A verb is an act:
 * losing a Condition, taking a Surge, leaving a State. They are declared here rather
 * than only existing as cases in a switch, for the same reason the Slots are a closed
 * list - a name nobody implements has to be an authoring error caught when it is
 * written, not a warning in the console during a fight.
 *
 * The list is kept free of Foundry so that both the compiler and the runtime can read
 * it: the compiler checks names against it, and the runtime dispatches on them.
 */

export const VERBS = Object.freeze({
  remove: {
    args: [0, 1],
    doc: "Take a Combat Condition off. With no name, the one carrying this effect."
  },
  gain: {
    args: [1, 2],
    doc: "Put a Combat Condition on, optionally at a number of stacks."
  },
  surge: {
    args: [0, 1],
    doc: "Take a Surge. Name \"healing\" or \"ki\" to force which, or neither to be asked."
  },
  leaveState: {
    args: [0, 1],
    doc: "Leave a State. With no name, every State - which is what returning to your "
       + "Normal State means."
  },
  grantOutOfSequence: {
    args: [0, 1],
    doc: "Offer an Out-of-Sequence Maneuver. Offered rather than played: it is still "
       + "the player's to take."
  },
  reroll: {
    args: [0, 0],
    doc: "Roll the Base Die again and keep the better of the two. Karmic Chance, "
       + "which is taken after the first result is seen."
  },
  mightClash: {
    args: [0, 1],
    doc: "Make a Might Clash against whoever is named, or against whoever inflicted "
       + "the Condition carrying this effect."
  }
});

/** Whether a verb exists, and whether it was given a workable number of arguments. */
export function checkVerb(name, count) {
  const verb = VERBS[name];
  if (!verb) return `"${name}" is not something an effect can do.`;

  const [least, most] = verb.args;
  if (count < least) return `"${name}" needs at least ${least} argument(s).`;
  if (count > most) return `"${name}" takes at most ${most} argument(s).`;
  return null;
}
