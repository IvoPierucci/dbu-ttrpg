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
  rulerAllies: {
    args: [0, 0],
    names: [],
    doc: "Ruler's: 2 stacks of Overwhelm spent, and the Allies ticked as within a Large Sphere around you Ruled - Soak "
       + "Value and Combat Rolls 1(T) higher - until the start of your next turn (chat.mjs rulerAllies)."
  },
  shardCarriers: {
    args: [0, 0],
    names: [],
    doc: "Glass Shards (1)'s: each the attack hit a Shard Carrier till the start of your next turn (chat.mjs shardCarriers)."
  },
  shardStrike: {
    args: [0, 0],
    names: [],
    doc: "Glass Shards (5)'s: a Shard Carrier picked, a Basic Attack of the Glass Profile at them offered (chat.mjs shardStrike)."
  },
  shardBurst: {
    args: [0, 0],
    names: [],
    doc: "Glass Shards (6)'s: a Shard Carrier picked, a Clash, and Glass around them (chat.mjs shardBurst)."
  },
  debuff: {
    args: [0, 0],
    doc: "Spirit of Namek's Debuffer: a Studied Opponent picked, a Clash (Cognitive) - won, Impediment till the end of this "
       + "turn (chat.mjs debuff)."
  },
  lifeBurn: {
    args: [0, 0],
    doc: "Spirit of Namek's Life Burn: a quarter of the Maximum Life Points off it and the Life Points, Combat Rolls 2(T) "
       + "till a Steadfast Check is failed (chat.mjs lifeBurn)."
  },
  namekianTechnique: {
    args: [0, 0],
    doc: "Namekian Techniques (4): an Opponent picked - Studied, the Basic Attack or a Signature Technique out of sequence at "
       + "them; not, Studied for the Round (chat.mjs namekianTechnique)."
  },
  studyCharacter: {
    args: [0, 0],
    doc: "Intelligent Fighter (2): a Character who attacked this Round picked - Studied till the end of the next (chat.mjs "
       + "studyCharacter)."
  },
  spectatorCheer: {
    args: [0, 0],
    doc: "Spectator (1): an Ally picked, their Combat Rolls 1(bT) till the start of your next turn (chat.mjs spectatorCheer)."
  },
  spectatorLeft: {
    args: [0, 0],
    doc: "Spectator left: its Ally's bonus off (chat.mjs spectatorLeft)."
  },
  motivatingPerformance: {
    args: [0, 0],
    doc: "Motivating Performance: the Allies within a Sphere ticked - Motivated, a quarter of your Personality Modifier, while "
       + "you are Hyped (chat.mjs motivatingPerformance)."
  },
  analyticFighter: {
    args: [1, 1],
    names: [0],
    doc: "Analytic Fighter: the named Option's (damageAnalysis, weak, offensive, defensive, critical, teamwork) - its mark on the one "
       + "Analyzed, and its Clash where it has one (chat.mjs analyticFighter)."
  },
  silentFootsteps: {
    args: [0, 0],
    doc: "Silent Footsteps (1): a Skill Clash (Stealth vs Perception) at each Opponent - won, Hidden from them till the end of "
       + "your next turn or your attack at them (chat.mjs silentFootsteps)."
  },
  yoinkGrenade: {
    args: [0, 0],
    doc: "Yoink (2): a Grenade of yours given to the one Snatched from - the Throw at them with it as their next turn begins "
       + "(chat.mjs yoinkGrenade)."
  },
  yoinkGuard: {
    args: [0, 0],
    doc: "Yoink (3): Guard Down on the one Snatched from, against your next Attacking Maneuver at them this turn (chat.mjs "
       + "yoinkGuard)."
  },
  juryRig: {
    args: [0, 0],
    doc: "Counter Jury-rigging (2): a Weapon and a 1-Slot Quality it takes, asked - on it till the Round turns over (chat.mjs "
       + "juryRig)."
  },
  dynamicHypeEnds: {
    args: [0, 0],
    doc: "Hyped gone: the Option asked at that Hype and Dynamic Hype (2)'s second no longer in use (chat.mjs dynamicHypeEnds)."
  },
  motivatedLeft: {
    args: [0, 0],
    doc: "Hyped gone: Motivating Performance's Motivated off whoever it was given to (chat.mjs motivatedLeft)."
  },
  explosivePerformance: {
    args: [0, 0],
    doc: "Explosive Performance: the Opponents your last Maneuver hit - Life Points less your Personality Modifier and half "
       + "your Might (chat.mjs explosivePerformance)."
  },
  undyingFall: {
    args: [0, 0],
    doc: "Undying (1): leaving it below nothing - Defeated at once, nothing answering it (chat.mjs undyingFall)."
  },
  multiTypeStart: {
    args: [0, 0],
    doc: "Multi-Type Specialist (2): Multi-Type Attacker's stack, any Foundation, outside its limit (chat.mjs multiTypeStart)."
  },
  speedblitz: {
    args: [0, 0],
    doc: "Speedblitz (3): the Movement or the Basic Attack out of sequence, which asked (chat.mjs speedblitz)."
  },
  personalEscape: {
    args: [0, 0],
    doc: "Personal Space (2): a Grapple Check to escape, counted as an Action spent (use-maneuver.mjs escapeGrapple)."
  },
  judoStrike: {
    args: [0, 0],
    doc: "Judo Training (2): the Basic Attack or the Launch out of sequence, which asked (chat.mjs judoStrike)."
  },
  rageStrike: {
    args: [0, 0],
    doc: "Raging, Apoplectic (1): the Basic Attack out of sequence, once a Round (chat.mjs rageStrike)."
  },
  surgingFocus: {
    args: [0, 0],
    doc: "Surging (1): the Focus, an Opponent picked as the State is entered (chat.mjs surgingFocus)."
  },
  surgingSpare: {
    args: [0, 0],
    doc: "No Fatigued on leaving Surging this time - its second effect ignored (chat.mjs surgingSpare)."
  },
  goof: {
    args: [0, 0],
    doc: "The Goof Special Maneuver (Gadabout): an Opponent out of Long Range picked, a Clash (Morale) - won, a 1d4 Combat "
       + "Condition till the start of your next turn (chat.mjs goof)."
  },
  hocusPocus: {
    args: [0, 0],
    doc: "The Hocus Pocus Special Maneuver (Gadabout): a 1d10 and its effect (chat.mjs hocusPocus)."
  },
  gadaboutPower: {
    args: [0, 0],
    doc: "Gadabout (2): a 1d10 at the Power Up - 3 or less, its stack taken back; 4+, another (chat.mjs gadaboutPower)."
  },
  gadaboutTurn: {
    args: [0, 0],
    doc: "Gadabout (3): a 1d10 as the turn begins - a 1, 3 Tension or the turn skipped; 8+, a Standard Maneuver out of "
       + "sequence (chat.mjs gadaboutTurn)."
  },
  dancerHype: {
    args: [0, 0],
    doc: "Dancer (4): the Hype Maneuver out of sequence, a stack of Tension spent once it is (chat.mjs dancerHype)."
  },
  rangerMove: {
    args: [0, 0],
    doc: "Ranger (4): 4(bT) Ki paid, then the Movement Maneuver out of sequence (chat.mjs rangerMove)."
  },
  whack: {
    args: [0, 0],
    doc: "The Whack Special Maneuver (Priest): a stack of Tension, an Opponent below Injured and out of Long Range picked - "
       + "once each an Encounter - and a Clash (Strike vs Strike/Dodge); won, a 1d10 - a 10, Defeated (chat.mjs whack)."
  },
  boom: {
    args: [0, 0],
    doc: "The Boom Special Maneuver (Mage): up to 2 stacks of Tension asked, then the Basic Attack offered out of sequence - "
       + "the Simple Profile of the Magic Foundation, a Standard Sphere on a Square (chat.mjs boom)."
  },
  shedCondition: {
    args: [0, 9],
    names: [0, 1, 2, 3, 4, 5, 6, 7, 8],
    doc: "A stack of one Combat Condition you suffer from taken off - which, asked where there are several - but the ones "
       + "named (Battle Tension's: not Pinned, Suffocating, Stress Exhaustion or Transfigured). None, its use unspent."
  },
  integrateMajinDama: {
    args: [0, 0],
    doc: "Neko Majin-Dama (3): a Majin-Dama you possess and not Integrated - which, where several - Integrated, Active where it "
       + "fits (majin-dama.mjs). None chosen, its use unspent."
  },
  expelMajinDama: {
    args: [0, 0],
    doc: "Neko Majin-Dama (4): an Integrated Majin-Dama - which, where several - expelled for 1 Action, dropped or Equipped "
       + "(majin-dama.mjs). None chosen, its use unspent."
  },
  cutthroatShove: {
    args: [0, 0],
    doc: "Cutthroat Teamwork (2): an Ally on an adjacent Square picked, a Might Clash against them - won, they may be moved "
       + "within a Large Sphere centred on you (chat.mjs cutthroatShove). None beside you, its use unspent."
  },
  glassSoldiers: {
    args: [0, 0],
    names: [],
    doc: "Warriors of Glass (1)'s: how many Glass Soldiers asked, 2(bT) Ki each, paid and said (chat.mjs glassSoldiers)."
  },
  glassSoldiersMove: {
    args: [0, 0],
    names: [],
    doc: "Warriors of Glass (3)'s: how far the Glass Soldiers may move, said (chat.mjs glassSoldiersMove)."
  },
  glassification: {
    args: [0, 0],
    names: [],
    doc: "Glassification's: each Action's target asked - a Square or a Character - and each settled (chat.mjs glassification)."
  },
  experiencedFighter: {
    args: [0, 0],
    names: [],
    doc: "Experienced Fighter (2)'s: at the Maneuver's target, one of its three asked and held (chat.mjs experiencedFighter)."
  },
  clearConditions: {
    args: [0, 9],
    names: [0, 1, 2, 3, 4, 5, 6, 7, 8],
    doc: "Every Combat Condition on you taken off - a published one, not a mark - but the ones named (Earthling Resolve's)."
  },
  rescueByPressure: {
    args: [0, 0],
    names: [],
    doc: "Demonic Resilience's: a Pressure Check - a success passes the Steadfast Check that failed (chat.mjs rescueSteadfast)."
  },
  pressureCheck: {
    args: [0, 0],
    names: [],
    doc: "Demonic Pressure's Pressure Check: 1d10 rolled in chat, 4+ a success - a stack of Demonic Power; 3 or less a "
       + "stack of Demonic Fatigue (chat.mjs pressureCheck)."
  },
  knockedProneClash: {
    args: [0, 0],
    names: [],
    doc: "Demonic Combat's: a Might Clash at whoever this Moment says was knocked through - won, they are knocked Prone "
       + "(chat.mjs knockedProneClash)."
  },
  demonicImpediment: {
    args: [0, 0],
    names: [],
    doc: "Demonic Combat's: an Opponent not at Long Range picked, 4(bT) Ki paid, and a Clash (Cognitive) at them - won, "
       + "Impediment till the end of your turn (chat.mjs demonicImpediment)."
  },
  wrathSteadfast: {
    args: [0, 0],
    names: [],
    doc: "Wrath of the Dragon (4): 2 off the Steadfast Check of whoever this Moment says was knocked through - kept on them "
       + "till it is rolled (chat.mjs wrathSteadfast)."
  },
  impairFailed: {
    args: [0, 0],
    names: [],
    doc: "Wrath of the Dragon (5): a stack of Impaired on whoever this Moment says failed, till the start of your next turn "
       + "(chat.mjs impairFailed)."
  },
  mastersPlace: {
    args: [0, 0],
    names: [],
    doc: "Masters of Movement (3): placed on any Square - the map's; the Grappled, a Clash (Cognitive) at the Grappler first "
       + "(chat.mjs mastersPlace)."
  },
  mastersPlaceAny: {
    args: [0, 0],
    names: [],
    doc: "Masters of Movement (4): you or an Ally, or nobody, asked - placed the same way (chat.mjs mastersPlace)."
  },
  freeFlowingStance: {
    args: [0, 0],
    names: [],
    doc: "Free Flowing Stance (1): in the Stance till the start of your next turn, a stack for each Action spent (chat.mjs "
       + "freeFlowingStance)."
  },
  failSteadfastKnocked: {
    args: [0, 0],
    names: [],
    doc: "Critical Wound (2): whoever this Moment says was knocked through fails their Steadfast Check for that Health "
       + "Threshold without rolling (chat.mjs steadfastFailedBy)."
  },
  buddySystem: {
    args: [0, 0],
    names: [],
    doc: "Buddy System (2): a Buddy of your choice - not a Special one - gained as from the Gear tab, and a Karma Point paid "
       + "once it is (chat.mjs buddySystem)."
  },
  pacifistMend: {
    args: [0, 0],
    names: [],
    doc: "Spiritual Pacifist (5): the Ally this Moment says was Empowered regains a quarter of the Ki they gained, rounded up, "
       + "in Life Points (chat.mjs pacifistMend)."
  },
  pacifistEmpower: {
    args: [0, 0],
    names: [],
    doc: "Spiritual Pacifist (6): which Ally asked, and the Empower at them as if 9,001 Actions were spent (chat.mjs "
       + "pacifistEmpower)."
  },
  warriorEmpower: {
    args: [0, 0],
    names: [],
    doc: "Spiritual Warrior (6): your Bonded Ally's player asked how much Ki, as if 2 Actions were spent - as many Life Points "
       + "yours (chat.mjs warriorEmpower)."
  },
  conduitPower: {
    args: [0, 0],
    names: [],
    doc: "Conduit of Spirit (3): Impaired till the start of your next turn; a willing Ally asked - Superior till the end of "
       + "their next turn (chat.mjs conduitPower)."
  },
  bondTo: {
    args: [0, 0],
    names: [],
    doc: "Power of the Weak (4): Bonded to the Ally this Moment says was Empowered, till Bonded to another (chat.mjs bondTo)."
  },
  impairKnocked: {
    args: [0, 0],
    names: [],
    doc: "A stack of Impaired on whoever this Moment says was knocked through, till the start of your next turn, on your clock "
       + "(chat.mjs impairKnocked) - Draconic Physique's Elemental Dragon."
  },
  markKnocked: {
    args: [2, 2],
    names: [0],
    doc: "A Combat Condition's stacks on whoever this Moment says was knocked through - till the end of your next turn, "
       + "on your clock (chat.mjs markKnocked) - Scarlet Spotter's 2 Broken."
  },
  followAlly: {
    args: [0, 0],
    names: [],
    doc: "Patient Sniper's: an Ally with a lower Initiative picked, and your Initiative set just after theirs for this "
       + "Combat Round - put back as the next begins (chat.mjs followAlly)."
  },
  hazyDragon: {
    args: [0, 0],
    names: [],
    doc: "Hazy Dragon: up to 4 Negative Energy, how many asked, spent - a Sphere around you the Bog Environment, Magnitude 1 more "
       + "for each after the first, said for the map (chat.mjs hazyDragon). None, its use unspent."
  },
  nobleDragon: {
    args: [0, 0],
    names: [],
    doc: "Noble Dragon: a Morale Clash at the one targeted - won, both Compelled till the start of your next turn, and Noble "
       + "Compelled on you (chat.mjs nobleDragon)."
  },
  negativeEnergy: {
    args: [0, 0],
    names: [],
    doc: "Negative Ki (1): how many 2(bT) of Life Points to lose, up to 8(bT), asked - a Negative Energy for each (chat.mjs "
       + "negativeEnergy)."
  },
  negativeClash: {
    args: [0, 0],
    names: [],
    doc: "Negative Ki (2): Opponents not at Long Range picked, a Negative Energy spent for each - a Morale Clash at each, won, "
       + "Impaired till the start of your next turn (chat.mjs negativeClash)."
  },
  parasiteDrain: {
    args: [0, 0],
    names: [],
    doc: "Parasitic Biology (3): this Round's Inferior, hit - 2(bT) off their Ki Points, 1(bT) more for each Revenge Point spent on "
       + "the attack (chat.mjs parasiteDrain)."
  },
  chooseInferior: {
    args: [0, 0],
    names: [],
    doc: "Tuffle Superiority (1): an Opponent on the scene, asked of whoever plays them, their Inferior till the Combat Round "
       + "ends - and (4)'s Surging offered (chat.mjs askInferior)."
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
