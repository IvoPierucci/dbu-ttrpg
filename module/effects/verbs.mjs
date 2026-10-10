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

/**
 * Which of a verb's arguments are names rather than amounts.
 *
 * A bare word in an argument list is a word - the name of a Condition, a State, a
 * Resource, a duration - and it used to be read as a path off the character, find
 * nothing, and resolve to 0. `expires(recovery, start-of-next-turn)` reached the runtime
 * as `expires(0, 0)`, which refuses on its first line and says nothing, so no duration
 * written in a file had ever been set.
 *
 * Declared per verb rather than guessed from the shape of the argument, because the shape
 * does not say: `enterState(superior, tierOfPower)` wants a word and then a number, and
 * both are bare words on the page.
 */
export const VERBS = Object.freeze({
  remove: {
    args: [0, 1],
    names: [0],
    doc: "Take a Combat Condition off. With no name, the one carrying this effect."
  },
  gain: {
    args: [1, 2],
    names: [0],
    doc: "Gain a Combat Condition, optionally several stacks of it. On top of what is "
       + "already held, which is what gaining one means - the Condition's own maximum "
       + "still caps it."
  },
  steadfastEnter: {
    args: [2, 3],
    names: [1, 2],
    doc: "Make a Steadfast Check, the amount added to its Dice Score (-2 takes 2 off); passed, enter the named State, for "
       + "the duration named after it - Saiyan Heritage's Undying \"until the end of your next turn\" (next-turn)."
  },
  trigger: {
    args: [1, 1],
    names: [0],
    doc: "Fire a Moment: what answers the named one answers it now - Saiyan Heritage's 2nd effect firing heritage, which "
       + "Born for Battle's 3rd answers."
  },
  raiseTo: {
    args: [2, 6],
    names: [1, 2, 3, 4, 5],
    doc: "Set each named Resource to at least this many stacks, past its ceiling, never lowering one - Born for Battle's "
       + "\"set the number of Battle Born stacks on each Combat Roll to 3, regardless of the limit\"."
  },
  gainOneOf: {
    args: [2, 6],
    names: [0, 1, 2, 3, 4, 5],
    doc: "Gain a stack of one of these Resources, the character's player choosing which - Born for Battle's \"apply it "
       + "to either Strike, Dodge, or Wound (you decide)\". One already at its ceiling is not offered."
  },
  gainGear: {
    args: [1, 1],
    names: [0],
    doc: "Gain a Basic Item, by its file's id - Snack Fiend's Snack, on the Gear tab."
  },
  reduceOpponentLife: {
    args: [1, 1],
    names: [0],
    doc: "The Opponent the Moment names - who lost the Clash - loses Life Points equal to the named Attribute's Modifier: "
       + "Psychic's \"reduce that Opponent's Life Points by your Insight Modifier\"."
  },
  legendRealized: {
    args: [0, 0],
    names: [],
    doc: "Legend Realized, granted by an effect - a Talent's - under none of the Transformation Maneuver's limits "
       + "(chat.mjs legendRealized): 2d10(T) + the Power Level, restored as Life and Ki Points."
  },
  kiForLife: {
    args: [0, 0],
    names: [],
    doc: "Discarded Divinity's: \"spend Ki Points up to an amount equal to 1/2 of your Max Capacity to regain an equal "
       + "number of Life Points\" - how much asked of whoever plays them (chat.mjs kiForLife)."
  },
  comfortForOverwhelm: {
    args: [0, 0],
    names: [],
    doc: "Comfortable Count's: every stack of Comfort for as many of Overwhelm (to its most) - and with more Comfort than "
       + "Overwhelm's most, the Power Up or the Transformation Maneuver offered out of sequence (chat.mjs)."
  },
  chooseEnemy: {
    args: [0, 0],
    names: [],
    doc: "Burning Hatred's: an Opponent on the scene, asked of whoever plays them, their Enemy until another is chosen - "
       + "and Compelled till the end of the Combat Round (chat.mjs askEnemy)."
  },
  lockOn: {
    args: [0, 0],
    names: [],
    doc: "Lock On's: an Opponent on the scene, asked of whoever plays them, their Target till the start of their next turn."
  },
  encounterTechnique: {
    args: [0, 0],
    names: [],
    doc: "Inherited Creativity's: a Signature Technique made now - no Technique Points spent, up to the base Tier's TP cap, "
       + "no Disadvantages - its builder opened for whoever plays them, gone at the end of the Combat Encounter."
  },
  steadfastPass: {
    args: [0, 0],
    names: [],
    doc: "The failed Steadfast Check this answers, passed instead - Primitive Durability's \"you can instead choose to pass "
       + "it automatically\" - asked as it fails (steadfast-failed)."
  },
  steamCloud: {
    args: [0, 0],
    names: [],
    doc: "Steaming Fury's: the Smoked mark - their Square Obscured - on you and whoever your player targets, till the end "
       + "of your next turn."
  },
  surge: {
    args: [0, 3],
    names: [0],
    doc: "Take a Surge. Name \"healing\" or \"ki\" to force which, or neither to be asked. A number after it multiplies "
       + "the Life Points a Healing Surge gives back - Majin Regeneration's \"double the amount\" - and a third, a die rolled "
       + "once per Tier of Power on top - Revenge Bomber's 1d6(T) (6)."
  },
  leaveState: {
    args: [0, 1],
    names: [0],
    doc: "Leave a State. With no name, every State - which is what returning to your "
       + "Normal State means."
  },
  expires: {
    args: [2, 3],
    names: [0, 1],
    doc: "Put something you hold on a clock: a Resource, a Combat Condition or a State, "
       + "and then \"turn\", \"next-turn\", \"start-of-turn\", \"start-of-next-turn\" "
       + "or \"encounter\". It is taken off when that moment arrives. A number after "
       + "the duration puts that many stacks on clocks of their own, which is what a rule "
       + "handing out several at once needs."
  },
  enterState: {
    args: [1, 3],
    // The name and the duration. The level between them is a number.
    names: [0, 2],
    doc: "Enter a State. A level after the name, and a duration after that - \"turn\", "
       + "\"next-turn\", \"start-of-turn\", \"start-of-next-turn\" or \"encounter\". "
       + "With no duration it stays until something takes it off."
  },
  grantOutOfSequence: {
    args: [0, 1],
    names: [0],
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
    names: [0],
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
