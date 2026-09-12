/**
 * The stimuli a Triggered or Automatic effect can answer.
 *
 * Unlike the Slots, this list is deliberately open: the rulebook has triggers that are
 * specific to one Trait, and we do not know them all. Adding one has to cost a row here
 * and a line where it fires - never a change to the parser, the interpreter, or any of
 * the places effects are consumed.
 *
 * Each Moment declares what it puts within reach. Reading something a Moment does not
 * provide is a compile error, so an effect that asks for incoming damage where there is
 * none is caught when it is written rather than in the middle of a fight.
 *
 * A few carry a limit of their own, which belongs to the trigger and not to any one
 * effect: Threshold fires once per Threshold per Encounter no matter how many effects
 * are waiting on it. That is independent of an effect's own x/Round or x/Encounter, and
 * both are enforced.
 */

/** Context an effect may read, by Moment. */
const CTX = {
  ATTACK: "attack",
  ATTACKER: "attacker",
  TARGET: "target",
  MANEUVER: "maneuver",
  TARGETS: "targets",
  ROLL: "roll",
  CLASH: "clash",
  DAMAGE: "damage",
  CATEGORY: "damageCategory",
  RESULT: "result",
  AMOUNT: "amount",
  THRESHOLD: "threshold",
  STATE: "state"
};

const TABLE = [
  // --- Named by the rulebook, using its own words ------------------------------
  {
    key: "threshold",
    label: "Knocked through a Health Threshold",
    provides: [CTX.THRESHOLD],
    // "This effect only occurs once for each Health Threshold during a single Combat
    // Encounter" - the limit belongs to the trigger, not to the effect using it.
    limit: { per: "encounter", each: "threshold", amount: 1 },
    // It waits for the Maneuver that caused it to finish.
    after: "maneuver",
    parameterised: true,
    doc: "Fires after the Maneuver that pushed you through finishes. Name a Threshold "
       + "to answer only that one."
  },
  {
    key: "defeated",
    label: "Reduced to your minimum Life Points",
    provides: [CTX.DAMAGE],
    limit: { per: "encounter", amount: 1 },
    parameterised: true,
    doc: "Fires before you are registered as Defeated, so something can still save you. "
       + "Only one effect of this kind per Encounter. Name a character to answer their "
       + "defeat instead of your own."
  },
  {
    key: "defeat-resolved",
    label: "Defeated, once it is settled",
    provides: [],
    doc: "After the defeat stands. This is when you leave any Transformation or State - "
       + "deliberately separate from `defeated`, which fires before it is settled."
  },
  { key: "start-of-encounter", label: "The Combat Encounter begins", provides: [],
    doc: "Fires when you enter the Encounter, so joining late still earns it." },
  { key: "start-of-round", label: "The Combat Round begins", provides: [] },
  { key: "start-of-turn", label: "Your turn begins", provides: [],
    doc: "Fires even when the turn is then skipped - for being Defeated, for Slowed at "
       + "three stacks, for anything answering this that takes the turn away. A skipped "
       + "turn is still your turn: you lost it, it did not stop existing. Durations "
       + "measured from this edge end on it either way." },
  { key: "power", label: "You use the Power Up Maneuver", provides: [] },
  { key: "transform", label: "You enter this Transformation", provides: [] },
  {
    key: "state",
    label: "You enter a State",
    provides: [CTX.STATE],
    parameterised: true,
    doc: "Written as the State's own name, e.g. triggered/raging."
  },
  {
    key: "left-state",
    label: "You leave a State",
    provides: [CTX.STATE],
    parameterised: true,
    doc: "Written as the State's own name, e.g. automatic/left-state/superior. The "
       + "other end of entering one, and answerable by anything - `on-removed` is the "
       + "State's own Moment about itself and only its own effects hear it."
  },

  // --- From the flow of combat this system already implements ------------------
  { key: "declare-maneuver", label: "A Maneuver is declared", provides: [CTX.MANEUVER, CTX.TARGETS] },
  { key: "on-used", label: "This Maneuver is used", provides: [CTX.MANEUVER, CTX.TARGETS],
    doc: "What a Maneuver does when it is used, written in its own file as `[on used]`. "
       + "Only that Maneuver's own script hears it - it is about this Maneuver, not "
       + "about every Maneuver you play, which is what `declare-maneuver` is for." },
  { key: "combat-roll", label: "A Combat Roll is about to be made", provides: [CTX.ROLL] },
  {
    key: "clash-resolved",
    label: "A roll is read, and you know what it came to",
    provides: [CTX.CLASH, CTX.ROLL],
    doc: "After the dice are read - which is the point of it. It fires for a lone "
       + "Skill roll or Steadfast Check as well as for a Clash; the clash context is "
       + "there only when there was one, so an effect that needs it says so and rules "
       + "itself out of the rest. Karmic Boost and "
       + "Karmic Chance are chosen once the result is in, so they need a moment that "
       + "comes after the dice rather than before them. Reads clash.lost (you are the "
       + "side that lost), clash.answering (you did not start it), clash.margin (how "
       + "far behind), and one of clash.combatRoll / clash.skill / clash.save / "
       + "clash.might for the kind of roll it was settled on. A Clash is always the "
       + "same kind on both sides."
  },
  { key: "clash-win", label: "You win a Clash", provides: [CTX.CLASH] },
  { key: "clash-lose", label: "You lose a Clash", provides: [CTX.CLASH] },
  { key: "defending", label: "You Defend against an attack", provides: [CTX.ATTACK, CTX.ATTACKER] },
  { key: "hit", label: "Your attack connects", provides: [CTX.ATTACK, CTX.TARGET],
    doc: "Hitting for no damage is still a hit: Soak and Damage Reduction taking the "
       + "Wound Roll down to nothing is not a miss. An Absolute Attack deals Damage "
       + "without hitting and does not fire this - \"it does not count as hitting a "
       + "Character with an Attacking Maneuver for any effects that would trigger as a "
       + "result\", and the Damage it deals does not count either." },
  { key: "miss", label: "Your attack fails", provides: [CTX.ATTACK, CTX.TARGET],
    doc: "Failing to hit at all: the Strike lost, the target dodged, an Intervene "
       + "deflected it, or a Defend Maneuver avoided it completely. An Absolute Attack "
       + "that deals Damage anyway has still missed. An Ally taking the hit through "
       + "Intervene is not a miss on the first target - the target changed." },
  { key: "being-hit", label: "An attack connects on you", provides: [CTX.ATTACK, CTX.ATTACKER] },
  { key: "before-wound", label: "Before the Wound Roll", provides: [CTX.ATTACK, CTX.CATEGORY] },
  { key: "damage-applied", label: "Damage is dealt", provides: [CTX.DAMAGE, CTX.ATTACKER] },
  { key: "end-of-turn", label: "Your turn ends", provides: [],
    doc: "The other edge of the same turn, and it fires on a skipped turn too." },
  { key: "steadfast-check", label: "You make a Steadfast Check", provides: [CTX.RESULT] },
  { key: "healing-surge", label: "You take a Healing Surge", provides: [CTX.AMOUNT] },
  { key: "ki-surge", label: "You take a Ki Surge", provides: [CTX.AMOUNT] },
  { key: "counter-maneuver", label: "You use a Counter Maneuver", provides: [CTX.ATTACK] },
  { key: "counter-window", label: "You could act out of sequence", provides: [CTX.ATTACK] },

  // --- Gaining and losing something --------------------------------------------
  // Written `[on applied]` and `[on removed]` rather than with a slash, because that is
  // how they read on a Condition: the thing they answer is the Condition itself.
  { key: "on-applied", label: "This is applied to you", provides: [],
    doc: "Fires once when the Condition, State or Transformation carrying it is gained. "
       + "Not per stack - gaining a second stack does not fire it again." },
  { key: "on-removed", label: "This is taken off you", provides: [],
    doc: "Fires once when it is lost, whether that was waited out, cured or cancelled." }
];

const MOMENTS = new Map(TABLE.map(moment => [moment.key, Object.freeze(moment)]));

/**
 * Look a Moment up.
 *
 * A parameterised Moment is written `defeated(Focus)` or `threshold/bruised`; the name
 * before the parameter is what is looked up, and the parameter says who or what it is
 * about rather than naming a different Moment.
 */
export function getMoment(key) {
  const bare = String(key).split(/[(/]/)[0];
  const moment = MOMENTS.get(bare);
  if (!moment) return undefined;

  const parameter = String(key).match(/[(/]([^)]+)\)?$/)?.[1] ?? null;
  if (parameter && !moment.parameterised) return undefined;

  return parameter ? Object.freeze({ ...moment, parameter }) : moment;
}

/** Whether a Moment puts a piece of context within reach. */
export function provides(moment, what) {
  return (moment.provides ?? []).includes(what);
}

/** Every Moment, for the reference list and the tests. */
export function allMoments() {
  return [...MOMENTS.values()];
}

export { CTX };
