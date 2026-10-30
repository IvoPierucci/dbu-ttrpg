/**
 * Whether an effect applies right now.
 *
 * The one behaviour worth naming: this **fails closed**. The old `conditionHolds` ended
 * its switch with a warning and `return true`, so a condition the system did not
 * understand was treated as met - a typo made a gated effect apply unconditionally,
 * which is the worst way for it to be wrong. Anything unrecognised here is false, and
 * it is reported.
 */

import { areAllies } from "../allies.mjs";
import { resolveAmount, useConditionEvaluator } from "./amounts.mjs";
import { lightLevelOf } from "../light.mjs";
import { traitAside } from "../aside.mjs";

/** Whether a key is a published Combat Condition - set by traits.mjs at load, to keep the import one way. */
let isCombatCondition = () => false;
export function useCombatConditionCheck(fn) {
  isCombatCondition = fn;
}

/** The Trait files by id - set by traits.mjs at load, the same way: what the Light Level reads (lightNormalOrHigher). */
let traitLookup = null;
export function useTraitLookup(fn) {
  traitLookup = fn;
}

/** Every Battle Weather's Connected Profile - set by traits.mjs at load, the same way (weatherConnected). */
let weatherProfiles = () => [];
export function useWeatherProfiles(fn) {
  weatherProfiles = fn;
}

/** The most of a Resource a character may hold, nothing for no ceiling - set by traits.mjs at load, the same way. */
let resourceCeilingOf = () => 0;
export function useResourceCeiling(fn) {
  resourceCeilingOf = fn;
}

/**
 * Questions an effect can ask that are not arithmetic.
 *
 * Each takes the scope and whatever arguments the condition carried. Adding one is a
 * row here; nothing else changes.
 */
/**
 * Whether another is an Opponent of theirs - of another token disposition - and not at Long Range: fewer than 9 Squares,
 * measured on the map; unmeasurable, near.
 */
function opponentNear(self, other) {
  if (!self || !other || (self.uuid === other.uuid)) return false;
  if (!self.getActiveTokens?.(false, true)?.[0] || areAllies(self, other)) return false;
  const mine = self.getActiveTokens?.(false, true)?.[0];
  const theirs = other.getActiveTokens?.(false, true)?.[0];
  const grid = globalThis.canvas?.grid;
  if (!mine || !theirs || !grid?.measurePath) return true;
  return Math.round(grid.measurePath([mine.center, theirs.center]).distance / (grid.distance || 1)) < 9;
}

/**
 * Initiative Advantage - Improved Initiative's: "If your Initiative Value is higher than that of all Opponents". Read off the
 * Combat's Combatants; every Opponent's rolled and lower, and at least one of them.
 */
export function initiativeAdvantageOf(actor) {
  return initiativeAgainstAll(actor, (theirs, own) => theirs < own);
}

/** Patient Fighter (2)'s: "If your Initiative Value is lower than all of your Opponents". */
export function initiativeBehindOf(actor) {
  return initiativeAgainstAll(actor, (theirs, own) => theirs > own);
}

/** Every Opponent in the Combat rolled, and each of their Initiative Values as `holds` says against yours - at least one. */
function initiativeAgainstAll(actor, holds) {
  const combat = globalThis.game?.combat;
  const own = combat?.combatants?.find(entry => entry.actor?.uuid === actor?.uuid);
  if (!own || !Number.isFinite(own.initiative)) return false;
  // A Defeated one's "turn in the Initiative Order is skipped and ultimately ignored for calculating Initiative Advantage".
  if (actor?.system?.defeated) return false;
  const opponents = Array.from(combat.combatants ?? []).filter(entry => (entry.id !== own.id) && !areAllies(entry.actor, actor)
    && !entry.actor?.system?.defeated);
  return (opponents.length > 0) && opponents.every(entry => Number.isFinite(entry.initiative) && holds(entry.initiative, own.initiative));
}

/** Two Weapons wielded or more of one Weapon Category - its Category as it stands (gear.mjs activeForm). */
export function twinWielded(items) {
  const counts = new Map();
  for (const item of items ?? []) {
    const crafted = item?.system?.crafted;
    if ((item?.type !== "gear") || (crafted?.kind !== "weapon") || !item.system?.equipped || crafted.destroyed) continue;
    const category = crafted.activeCategory || crafted.category || "";
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return [...counts.values()].some(count => count >= 2);
}

/**
 * Synchronized Combatants (1): "Choose a Character. If that Character has also chosen you through this effect, that Character
 * is your Partner." The world's Actor, or null.
 */
export function partnerOf(actor) {
  return mutualChoice(actor, "synchronized-combatants");
}

/**
 * Power of the Weak (4)'s Bonded Ally, as { uuid, name } - or, with Twinned Spirits (1), "You are always Bonded to your Partner, but
 * you cannot become Bonded with any other Character": the Partner, or none.
 */
export function bondOf(actor) {
  if (actor?.system?.effects?.slots?.["twinned.partner"] === true) {
    const partner = partnerOf(actor);
    return partner ? { uuid: partner.uuid, name: partner.name } : null;
  }
  return actor?.getFlag?.("dbu-ttrpg", "bonded") ?? null;
}

/** Chosen Rival (1): "If that Character has also chosen you through this effect, that Character is your Rival." */
export function rivalOf(actor) {
  return mutualChoice(actor, "chosen-rival");
}

/** The Character this one chose through a Talent's `choose: character`, where they chose this one through it too. */
function mutualChoice(actor, sourceId) {
  const chosenBy = who => (Array.from(who?.items ?? []).find(item => item.flags?.["dbu-ttrpg"]?.sourceId === sourceId)
    ?.system?.chosen ?? []).find(entry => entry.key === sourceId)?.value ?? "";
  const id = chosenBy(actor);
  if (!actor || !id || (id === actor.id)) return null;
  const other = globalThis.game?.actors?.get?.(id) ?? null;
  return (other && (chosenBy(other) === actor.id)) ? other : null;
}

/** Chosen Rival: your Rival's side against yours, by their tokens on the scene - "opponent", "ally", or "" where not there. */
function rivalSide(self) {
  const rival = rivalOf(self);
  const mine = self?.getActiveTokens?.(false, true)?.[0];
  const theirs = rival ? (globalThis.canvas?.tokens?.placeables ?? []).find(token => token.actor?.id === rival.id)?.document : null;
  if (!mine || !theirs) return "";
  return areAllies(self, rival) ? "ally" : "opponent";
}

/** Chosen Rival (4): "your Rival is your only non-Defeated Ally" - the one Ally on the scene still standing. */
function rivalOnlyAlly(self) {
  const rival = rivalOf(self);
  if (!rival || !self) return false;
  const standing = [...new Map((globalThis.canvas?.tokens?.placeables ?? [])
    .filter(token => token.actor && areAllies(token.actor, self) && (token.actor.uuid !== self.uuid) && !token.actor.system?.defeated)
    .map(token => [token.actor.uuid, token.actor])).values()];
  return (standing.length === 1) && (standing[0].id === rival.id);
}

/** Synchronized Combatants (2): on a Square adjacent to your Partner, and your Partner your Ally - their tokens, side by side. */
function besidePartner(self) {
  return besideChosen(self, partnerOf(self), { ally: true });
}

/** Two tokens on Squares adjacent - one an Ally of the other, where asked. */
function besideChosen(self, other, { ally = false } = {}) {
  const mine = self?.getActiveTokens?.(false, true)?.[0];
  const theirs = other ? (globalThis.canvas?.tokens?.placeables ?? []).find(token => token.actor?.id === other.id)?.document : null;
  const grid = globalThis.canvas?.grid?.size;
  if (!mine || !theirs || !grid || (mine.parent?.id !== theirs.parent?.id) || (ally && !areAllies(self, other))) return false;
  const gap = (p, q, pSize, qSize) => Math.max(0, Math.max(p - (q + qSize), q - (p + pSize)));
  const apart = Math.max(Math.ceil(gap(mine.x / grid, theirs.x / grid, mine.width ?? 1, theirs.width ?? 1)),
    Math.ceil(gap(mine.y / grid, theirs.y / grid, mine.height ?? 1, theirs.height ?? 1)));
  return apart === 0;
}

const PREDICATES = {
  /** Are you Defending against the attack currently being resolved. */
  defending: scope => Boolean(scope.context?.defending),

  /**
   * Is this roll part of an Attacking Maneuver *you* are making.
   *
   * Not the same question as "is an attack happening": a Dodge and a Parry are Combat
   * Rolls made during somebody else's Attacking Maneuver, and a rule about the rolls
   * "for Attacking Maneuvers" does not reach them. Compelled is the rule that cares -
   * it makes your own attacks Urgent, not your defence against one.
   */
  attackingManeuver: scope => Boolean(scope.context?.attackingManeuver),

  /**
   * Is a named Trait doing anything for this character at the moment.
   *
   * Written as a Trait's name because that is how the rulebook writes it ("while you
   * are not benefiting from Balanced Warrior"). The visited set matters: two Traits can
   * name each other, and without it that recurses forever.
   */
  benefiting: (scope, name) => {
    const key = String(name).toLowerCase();
    if (scope.visiting?.has(key)) {
      scope.errors?.push(`"${name}" refers back to an effect that refers to it; treating it as not benefiting.`);
      return false;
    }
    const visiting = new Set(scope.visiting ?? []);
    visiting.add(key);
    return Boolean(scope.benefitsFrom?.(name, { ...scope, visiting }));
  },

  /** Do you hold any of a Resource. */
  hasResource: (scope, name) => (scope.data?.resources?.[name]?.stacks ?? 0) > 0,

  /**
   * "If you already had access to the <X> Maneuver" (Majestic Grace's): a Special Maneuver opened by anything but the
   * effect asking - a Skill's Ranks.
   */
  accessElsewhere: (scope, id) => {
    const table = scope.data?.constructor?.SKILLS ?? {};
    const needs = Number(scope.data?.constructor?.SKILL_MANEUVER_RANKS) || 2;
    return Object.entries(table).some(([key, skill]) => (skill.specialManeuver === String(id))
      && ((Number(scope.data?.skills?.[key]?.ranks) || 0) >= needs));
  },

  /** The Clash won was won with this Skill (Stealthy Trick's) - clash-win's context. */
  wonWithSkill: (scope, id) => (scope.context?.skill ?? "") === String(id),

  /** The Maneuver being declared is an Attacking Maneuver - Demonic Pressure's. */
  declaringAttack: scope => Boolean(scope.context?.maneuver?.attacking),

  /** Suffering from a Combat Condition - a published one, not a mark - besides the ones named (Earthling Resolve's). */
  conditionedBesides: (scope, ...names) => {
    const besides = names.map(name => String(name).toLowerCase());
    return Object.entries(scope.data?.conditions ?? {}).some(([key, stacks]) => ((Number(stacks) || 0) > 0)
      && !besides.includes(key) && isCombatCondition(key));
  },

  /** The Attacking Maneuver that hit was of the Glass Profile - its own or applied (Glass Shards') - hit-opponent's context. */
  glassAttack: scope => Boolean(scope.context?.glass),

  /** Their Square has that Environmental Quality - its Environment's, ticked, or an effect's (Body of Glass's Glass). */
  onSquare: (scope, name) => (scope.data?.battlefield?.squareQualities ?? []).includes(String(name).toLowerCase()),

  /** That Option chosen on one of their Racial Traits - Quick to Master's Way, for Eye of the Dragon (3). */
  optionChosen: (scope, id) => Array.from(scope.data?.parent?.items ?? []).some(item => (item.type === "racial")
    && (item.system?.chosen ?? []).some(entry => (entry.key === "option") && (entry.value === String(id)))),

  /** That Talent held, by its file's id - Tai Chi Expert's (1), read on Tai Chi Practitioner's (2). */
  hasTalent: (scope, id) => Array.from(scope.data?.parent?.items ?? []).some(item => (item.type === "talent")
    && (item.flags?.["dbu-ttrpg"]?.sourceId === String(id))),

  /** It is this character's own turn - or there are no turns, out of a Combat Encounter (Demonic Pressure's). */
  ownTurn: scope => !game.combat?.started || (game.combat?.combatant?.actor?.uuid === scope.data?.parent?.uuid),

  /** Knocked through or Defeated by an attack whose Strike was a Critical Result - Critical Point's. */
  byCriticalStrike: scope => Boolean(scope.context?.critical),

  /** The one knocked through was knocked by a Called Shot or an attack through the Exploit - Scarlet Spotter's. */
  knockedPinpoint: scope => Boolean(scope.context?.pinpoint),

  /** The Clash won was the one your Terrify Maneuver opened (Terrifying Pressure's) - clash-win's context. */
  wonTerrify: scope => Boolean(scope.context?.terrify),

  /** The Attacking Maneuver hit someone Oblivious of you, as it hit (Stealthy Trick's) - hit-opponent's context. */
  hitOblivious: scope => Boolean(scope.context?.oblivious),

  /** Are you in a named State. */
  inState: (scope, name) => Boolean(scope.data?.states?.[String(name).toLowerCase()]),

  /**
   * Are you in a named Battle Environment - "While in the Underwater Battle Environment" - by its file, with or without
   * "-environment" on the end. Not while you are above it in a High Environment: there it does not reach you.
   */
  inEnvironment: (scope, name) => {
    const battlefield = scope.data?.battlefield ?? {};
    if ((Number(battlefield.highEnvironment) || 0) > 0) return false;
    const here = String(battlefield.environment ?? "").toLowerCase();
    const wanted = String(name).trim().toLowerCase();
    return (here === wanted) || (here === `${wanted}-environment`);
  },

  /** Do you have a named Combat Condition. */
  hasCondition: (scope, name) => Boolean(scope.data?.conditions?.[String(name).toLowerCase()]),

  /**
   * Is the Item carrying this effect meant for whoever is wearing it - the Eyeglasses'
   * "If you're the Intended Character". Declared on the Item; false for anything that
   * declares nobody.
   */
  intendedForYou: scope => Boolean(scope.intended),

  /**
   * Is this character wielding a Weapon - Parrying Armor's "While you do not have a Weapon
   * equipped". Wielded is `equipped`; a broken one is as if it were not there.
   */
  adventuring: scope => Boolean(scope.data?.adventuring),

  wieldingWeapon: scope => Array.from(scope.data?.parent?.items ?? []).some(item =>
    (item.type === "gear") && (item.system?.crafted?.kind === "weapon") && item.system?.equipped
    && !item.system?.crafted?.destroyed),

  /**
   * Is this character wearing an Item made from a named file - "while wearing Standard
   * Clothing". By the file's id, so a renamed one still counts; worn being the same
   * `equipped` an Accessory is put on with, and one in a Capsule never being worn.
   */
  wearing: (scope, id) => {
    const wanted = String(id).trim().toLowerCase();
    // An Item made from that file, or one built as that Category - "Standard Clothing" is an
    // Apparel Category, and any Apparel of it counts.
    // "Natural Armor does not count as equipped Apparel for any of your effects."
    return Array.from(scope.data?.parent?.items ?? []).some(item => (item.type === "gear")
      && ((item.system?.gearId === wanted) || (item.system?.crafted?.category === wanted))
      && Boolean(item.system?.equipped) && (item.flags?.["dbu-ttrpg"]?.naturalArmor !== true));
  },

  /** Is the Maneuver being declared one made through the Signature Technique Maneuver - God of Judgment's. */
  signatureTechnique: scope => Boolean(scope.context?.maneuver?.signature && !scope.context?.maneuver?.signatureTechnique),

  /** An Ultimate Signature Technique being declared - Questing Wisdom's. */
  usingUltimate: scope => Boolean(scope.context?.maneuver?.signature && !scope.context?.maneuver?.signatureTechnique
    && scope.context?.maneuver?.ultimate),

  /** No Counter Action left - Lingering Instincts' "while you possess no Counter Actions". */
  noCounterActions: scope => (Number(scope.data?.actions?.counterLeft) || 0) <= 0,

  /** Is this character in their own Frozen Turn - Time Freeze's (God of Time's "during Frozen Turns"). */
  frozenTurn: scope => Boolean(scope.data?.parent?.getFlag?.("dbu-ttrpg", "frozenTurn")),

  /** Is the Maneuver being declared that one, by its id - Cosmic Efficiency's Combat Recovery. */
  using: (scope, id) => (scope.context?.maneuver?.id ?? "") === String(id).trim(),

  /** The one this Moment says was Defeated, your Lock On Target (Lock On's 2nd). */
  defeatedLockOn: scope => Boolean(scope.context?.defeatedUuid)
    && (scope.data?.parent?.getFlag?.("dbu-ttrpg", "lockOn")?.uuid === scope.context.defeatedUuid),

  /** Ki Multiplier from somewhere else than an effect that always gives it - the sheet's box, until Forms (Power Battery). */
  kiMultiplied: scope => scope.data?.debug?.kiMultiplier === true,

  /** No Ki Points regained through a Ki Surge or Combat Recovery (Power Battery's). */
  kiLocked: scope => scope.data?.effects?.slots?.["ki.noRegain"] === true,

  /** Does this character still have their tail - Saiyan Heritage's Tailed, not lost (the Options tab's Tail lost box). */
  tailed: scope => !scope.data?.parent?.getFlag?.("dbu-ttrpg", "tailLost"),

  /** Do these Resources come to at least this many stacks between them - Blood of the Warrior's "6+ stacks of Battle Born". */
  stacksAtLeast: (scope, amount, ...names) => names
    .reduce((sum, name) => sum + (Number(scope.data?.resources?.[String(name).toLowerCase()]?.stacks) || 0), 0)
    >= (Number(amount) || 0),

  /**
   * Is this character below that Health Threshold - in it or a lower one, as Final Chance and All Out read "below the
   * Injured Health Threshold" (Blood of the Warrior's).
   */
  belowThreshold: (scope, name) => {
    const keys = ["healthy", "bruised", "injured", "critical"];
    const wanted = keys.indexOf(String(name).toLowerCase());
    // Divine Physique (3): Superior, and Healthy as well for every effect of theirs - so below nothing.
    if ((scope.data?.effects?.slots?.["threshold.healthyInSuperior"] === true)
      && ((Number(scope.data?.states?.superior) || 0) > 0)) return false;
    return (wanted > 0) && (keys.indexOf(scope.data?.threshold?.key ?? "healthy") >= wanted);
  },

  /** In the Healthy Health Threshold, whatever counts them as Healthy besides - Divine Physique (2)'s. */
  trulyHealthy: scope => (scope.data?.threshold?.key ?? "healthy") === "healthy",

  /** No Character in the Combat Encounter larger than you - King's Stature's "the highest Size Category". */
  largestInEncounter: scope => {
    const own = Number(scope.data?.size?.steps) || 0;
    return Array.from(game.combat?.combatants ?? []).map(entry => entry.actor).filter(Boolean)
      .every(other => (Number(other.system?.size?.steps) || 0) <= own);
  },

  /** Is the Maneuver being declared a Unique Ability - Frigid Tricks'. */
  usingUnique: scope => (scope.context?.maneuver?.tags ?? []).includes("uniqueAbility"),

  /** Whoever was Defeated or knocked through a Threshold is your Enemy - Burning Hatred's (chat.mjs askEnemy). */
  /** Tuffle Superiority (3): the attack that dealt the Damage your Inferior's, this Round (Energy of Revenge's doubled). */
  byInferior: scope => {
    const inferior = scope.data?.parent?.getFlag?.("dbu-ttrpg", "inferior");
    const round = `${globalThis.game?.combat?.id ?? "none"}:${globalThis.game?.combat?.round ?? 0}`;
    return (scope.data?.effects?.slots?.["superiority.inferior"] === true) && Boolean(inferior?.uuid)
      && (inferior.round === round) && (inferior.uuid === (scope.context?.attackerUuid ?? ""));
  },

  /** The attack defended against carries that many Energy Charges or more (Legacy of the Scholars' 3+). */
  chargesAtLeast: (scope, amount) => (Number(scope.context?.charges) || 0) >= (Number(amount) || 0),

  /** Parasitic Biology (3): this Round's Inferior among those the attack hit (moment hit-opponent's `struck`). */
  struckInferior: scope => {
    const inferior = scope.data?.parent?.getFlag?.("dbu-ttrpg", "inferior");
    const round = `${globalThis.game?.combat?.id ?? "none"}:${globalThis.game?.combat?.round ?? 0}`;
    return Boolean(inferior?.uuid) && (inferior.round === round) && (scope.context?.struck ?? []).includes(inferior.uuid);
  },

  /** A Health Threshold whose penalties are suffered: reached, its Steadfast Check failed (Parasite-Drained's). */
  penalizedBy: (scope, key) => (scope.data?.threshold?.failedKeys ?? []).includes(String(key).toLowerCase()),

  /** Personified Dragon Ball: in your Ball Form - taken by its (4), or Defeated. */
  inBallForm: scope => ((Number(scope.data?.conditions?.["ball-form"]) || 0) > 0)
    || ((Number(scope.data?.life?.value) || 0) <= (Number(scope.data?.life?.min) || 0)),

  /** The attack that knocked them through of a Favored Element's Profile of yours (Draconic Physique's Elemental Dragon). */
  knockedFavored: scope => (scope.context?.profiles ?? [])
    .some(profile => scope.data?.effects?.slots?.[`favored.${profile}`] === true),

  /** Wrath of the Dragon (4): knocked through by you or an Ally - an Opponent, not at Long Range (moment opponent-knocked). */
  knockedNear: scope => {
    const self = scope.data?.parent;
    const knocker = globalThis.fromUuidSync?.(scope.context?.knockerUuid ?? "");
    const knocked = globalThis.fromUuidSync?.(scope.context?.knockedUuid ?? "");
    if (!self || !knocker || !knocked) return false;
    if ((knocker.uuid !== self.uuid) && !areAllies(knocker, self)) return false;
    return opponentNear(self, knocked);
  },

  /** Opportunist (1): knocked through by an Ally of yours - not you (moment opponent-knocked). */
  knockedByAlly: scope => {
    const self = scope.data?.parent;
    const knocker = globalThis.fromUuidSync?.(scope.context?.knockerUuid ?? "");
    if (!self || !knocker || (knocker.uuid === self.uuid)) return false;
    return areAllies(knocker, self);
  },

  /** Critical Wound (2): the attack that knocked them through a Critical Result on its Wound Roll (moment knock-through). */
  woundCriticalKnock: scope => Boolean(scope.context?.woundCritical),

  /** Beat-down Tactics (2): the one knocked through (moment knock-through) an Opponent - of another side than yours. */
  knockedOpponent: scope => {
    const self = scope.data?.parent;
    const knocked = globalThis.fromUuidSync?.(scope.context?.knockedUuid ?? "");
    if (!self || !knocked || (knocked.uuid === self.uuid)) return false;
    return !areAllies(knocked, self);
  },

  /** Buddy to Buddies (1): a Buddy of yours Active - not destroyed, not locked. */
  buddyActive: scope => Array.from(scope.data?.parent?.items ?? []).some(item => (item.type === "gear")
    && (item.system?.itemType === "buddy") && item.system.buddy?.active && !item.system.buddy?.destroyed && !item.system.buddy?.locked),

  /** Spiritual Pacifist (5): Ki Points the Ally Empowered gained (moment empowered-ally). */
  kiGained: scope => (Number(scope.context?.gained) || 0) > 0,

  /** Spiritual Warrior (6): a Bonded Ally (Power of the Weak's), not Defeated. */
  bondedAlly: scope => {
    const bond = bondOf(scope.data?.parent);
    const ally = bond?.uuid ? globalThis.fromUuidSync?.(bond.uuid) : null;
    return Boolean(ally) && !ally.system?.defeated;
  },

  /**
   * Conduit of Spirit (1): "while you have at least 1 Ally and none of your Allies are Defeated" - the tokens of your token's
   * disposition on the scene.
   */
  besidePartner: scope => besidePartner(scope.data?.parent),
  rivalOpponent: scope => rivalSide(scope.data?.parent) === "opponent",
  rivalAlly: scope => rivalSide(scope.data?.parent) === "ally",
  rivalOnlyAlly: scope => rivalOnlyAlly(scope.data?.parent),
  // "If you are not wearing any pieces of Apparel" - Furious Flex's, Naturist's: none worn, Natural Armor being none ("Natural
  // Armor does not count as equipped Apparel for any of your effects").
  wearingNoApparel: scope => !Array.from(scope.data?.parent?.items ?? []).some(item => (item.type === "gear")
    && (item.system?.crafted?.kind === "apparel") && item.system?.equipped && (item.flags?.["dbu-ttrpg"]?.naturalArmor !== true)),
  // A Combat Encounter running.
  inCombat: () => Boolean(globalThis.game?.combat?.started),
  /** Arboreal (1): "if the Light Level ... is Normal or higher" - the Level this character is in, as they treat it. */
  lightNormalOrHigher: scope => lightLevelOf(scope.data, traitLookup) >= 0,

  /** A Racial or Other Trait held by its id - and applied: one the Bestial Limit set aside, not (Underwater Beast's). */
  holdsTrait: (scope, id) => {
    const items = Array.from(scope.data?.parent?.items ?? []);
    return items.some(item => (item.type === "racial") && (item.flags?.["dbu-ttrpg"]?.sourceId === String(id))
      && !traitAside(item, items, scope.data?.parent));
  },

  /** In that Battle Weather - Weather Resilient's "within your selected Battle Weather". */
  inWeather: (scope, id) => Boolean(id) && (String(scope.data?.battlefield?.weather?.id ?? "") === String(id)),

  /** The one Defeated by your attack (moment defeat-opponent) is a Minion - its Minion box (Bloodlust's). */
  defeatedMinion: scope => Boolean(globalThis.fromUuidSync?.(scope.context?.defeatedUuid ?? "")?.system?.minion),

  /** In the Low Sky or High Sky Environment - Winged Beast's. */
  inSky: scope => [1, 2].includes(Number(scope.data?.battlefield?.highEnvironment) || 0),

  /** Elemental Adaptation (3), (4): is this Profile the Connected Profile of a Battle Weather. */
  // A Profile's id is camelCase (elementalFire), a Weather file's `profile:` kebab-case (elemental-fire).
  weatherConnected: (scope, profile) => weatherProfiles()
    .includes(String(profile ?? "").trim().replace(/([A-Z])/g, "-$1").toLowerCase()),

  /** Weather Environment's Light (2): "While the Light Level is not Normal" - as it is, not as they treat it. */
  lightNotNormal: scope => lightLevelOf(scope.data, traitLookup, { treated: false }) !== 0,

  /** In Cover - the Battlefields tab's, or set by an effect (Burrowing Beast's Underground, a Feature carried). */
  inCover: scope => Boolean(scope.data?.battlefield?.cover?.active),

  // "While you have an Integrated Majin-Dama".
  hasIntegratedDama: scope => Array.from(scope.data?.parent?.items ?? []).some(item => (item.type === "gear")
    && (item.system?.gearId === "majin-dama") && (item.system?.integrated === true)),
  // Protector of the Dragon Ball (5): a Dragon Ball Integrated.
  hasIntegratedDragonBall: scope => Array.from(scope.data?.parent?.items ?? []).some(item => (item.type === "gear")
    && (item.system?.gearId === "dragon-ball") && (item.system?.integrated === true)),
  // A Combat Condition put on an Opponent this Combat Encounter - kept on whoever put it as it is (chat.mjs conditionGained).
  inflictedThisEncounter: scope => Boolean(globalThis.game?.combat?.started)
    && (scope.data?.parent?.getFlag?.("dbu-ttrpg", "inflictedEncounter") === globalThis.game.combat.id),
  // The Tail Attack used in the Round that ended - the end of a Round answered as the next begins, so read as the one before it.
  tailAttackLastRound: scope => (scope.data?.parent?.getFlag?.("dbu-ttrpg", "tailAttackRound") ?? "")
    === `${globalThis.game?.combat?.id ?? "none"}:${(Number(globalThis.game?.combat?.round) || 0) - 1}`,
  // The inflict-shaken Moment's Shaken, put on through the Direct Hit option of the Defend Maneuver.
  shakenByDirectHit: scope => Boolean(scope.context?.directHit),
  // "at least 1 of your pieces of Apparel have been destroyed this Combat Encounter" - kept on the character as one breaks.
  apparelDestroyedThisEncounter: scope => Boolean(globalThis.game?.combat?.started)
    && (scope.data?.parent?.flags?.["dbu-ttrpg"]?.apparelBrokenEncounter === globalThis.game.combat.id),
  // Twin Weapon Specialist (1): "While you are wielding 2+ Weapons of the same Weapon Category" - each as it stands.
  twinWeapons: scope => twinWielded(Array.from(scope.data?.parent?.items ?? [])),
  // Dragon-like (1): "For each Bestial Trait gained" - the Other Traits this Trait gave, still held.
  grantedOthersAtLeast: (scope, count, id) => {
    const items = Array.from(scope.data?.parent?.items ?? []);
    const own = items.find(item => (item.type === "racial") && (item.flags?.["dbu-ttrpg"]?.sourceId === String(id ?? "")));
    return Boolean(own) && (items.filter(item => (item.type === "racial") && (item.flags?.["dbu-ttrpg"]?.grantedBy === own.id)).length
      >= (Number(count) || 0));
  },
  // Dual Wielding Specialist: "While you are wielding 2+ Weapons".
  weaponsWieldedAtLeast: (scope, count) => Array.from(scope.data?.parent?.items ?? []).filter(item => (item.type === "gear")
    && (item.system?.crafted?.kind === "weapon") && item.system?.equipped && !item.system?.crafted?.destroyed).length
    >= (Number(count) || 0),
  // Light Weapons Specialist (1): "While you are only wielding a single Weapon of the Small Size" - one Weapon wielded, of that
  // Size (its Form's).
  singleWeaponOf: (scope, size) => {
    const items = Array.from(scope.data?.parent?.items ?? []);
    const held = items.filter(item => (item.type === "gear") && (item.system?.crafted?.kind === "weapon") && item.system?.equipped
      && !item.system?.crafted?.destroyed);
    if (held.length !== 1) return false;
    // Its Size as it stands - a Transforming Weapon's in use (gear.mjs activeForm).
    const crafted = held[0].system.crafted;
    return String(crafted.activeSize || crafted.weaponSize || "") === String(size ?? "").toLowerCase();
  },
  // Bag of Tricks (3): the Clash won one your own Unique Ability opened, against an Opponent (moment unique-clash-won).
  ownUniqueWon: scope => {
    const self = scope.data?.parent;
    const loser = globalThis.fromUuidSync?.(scope.context?.opponentUuid ?? "");
    if (!self || !loser || !scope.context?.ownUnique) return false;
    return !areAllies(loser, self);
  },
  // Desperate Support (3): "forgo regaining Life and Ki Points" - this Round's, chosen as the turn began.
  desperateForgone: scope => scope.data?.parent?.getFlag?.("dbu-ttrpg", "desperateForgone")
    === `${globalThis.game?.combat?.id ?? "none"}:${globalThis.game?.combat?.round ?? 0}`,
  // Eternal Rival (1): "While your Rival is in a Combat Encounter" - a Combatant of the one under way.
  rivalInEncounter: scope => {
    const rival = rivalOf(scope.data?.parent);
    const combat = globalThis.game?.combat;
    return Boolean(rival && combat?.started && (combat.combatants ?? []).some(combatant => combatant.actor?.id === rival.id));
  },
  // Eternal Rival (3): "If you are adjacent to your Rival" - whichever side they are on.
  besideRival: scope => besideChosen(scope.data?.parent, rivalOf(scope.data?.parent)),

  alliesStanding: scope => {
    const self = scope.data?.parent;
    if (!self) return false;
    const allies = [...new Map((globalThis.canvas?.tokens?.placeables ?? [])
      .filter(token => token.actor && (token.actor.uuid !== self.uuid) && areAllies(token.actor, self))
      .map(token => [token.actor.uuid, token.actor])).values()];
    return (allies.length > 0) && allies.every(other => !other.system?.defeated);
  },

  /**
   * Power of the Weak (4): the Ally Empowered (moment empowered-ally) not Bonded to you already, nor to another - "You cannot
   * be Bonded with a Character that another Yardrat is already Bonded to." Nor "(except a Minion)" one marked a Minion - unless
   * Spiritual Leadership (1); and never with Twinned Spirits (1), Bonded to the Partner alone.
   */
  bondOpen: scope => {
    const self = scope.data?.parent;
    const ally = scope.context?.allyUuid;
    if (!self || !ally || (bondOf(self)?.uuid === ally) || (self.system?.effects?.slots?.["twinned.partner"] === true)) return false;
    const empowered = globalThis.fromUuidSync?.(ally);
    if (empowered?.system?.minion && (self.system?.effects?.slots?.["leadership.bondMinion"] !== true)) return false;
    const others = [...(globalThis.game?.actors ?? []), ...(globalThis.canvas?.tokens?.placeables ?? []).map(token => token.actor)];
    return !others.some(other => other && (other.uuid !== self.uuid) && (bondOf(other)?.uuid === ally));
  },

  /** Wrath of the Dragon (5): the one failing an Opponent not at Long Range (moment opponent-steadfast-failed). */
  failedNear: scope => {
    const self = scope.data?.parent;
    const failed = globalThis.fromUuidSync?.(scope.context?.failedUuid ?? "");
    return Boolean(self && failed) && opponentNear(self, failed);
  },

  /** Karmic Reflection (2): the Botch yours, or an Opponent's not at Long Range from you (moment botch-seen). */
  botchNear: scope => {
    const self = scope.data?.parent;
    const uuid = scope.context?.botcherUuid ?? "";
    if (!self || !uuid) return false;
    if (uuid === self.uuid) return true;
    const other = globalThis.fromUuidSync?.(uuid);
    if (!other || !self.getActiveTokens?.(false, true)?.[0] || areAllies(self, other)) return false;
    const mine = self.getActiveTokens?.(false, true)?.[0];
    const theirs = other.getActiveTokens?.(false, true)?.[0];
    const grid = globalThis.canvas?.grid;
    if (!mine || !theirs || !grid?.measurePath) return true;
    const squares = Math.round(grid.measurePath([mine.center, theirs.center]).distance / (grid.distance || 1));
    return squares < 9;
  },

  fallenEnemy: scope => {
    const fallen = scope.context?.defeatedUuid || scope.context?.knockedUuid || "";
    return Boolean(fallen) && (scope.data?.parent?.getFlag?.("dbu-ttrpg", "enemy")?.uuid === fallen);
  },

  /** The attack an AoE, and more than one hit by it - Overwhelming Pressure's (2) (moment hit-opponent's context). */
  aoeHitMany: scope => Boolean(scope.context?.area) && ((Number(scope.context?.hits) || 0) > 1),

  /** Natural Armor with Break Value to get back, or broken - Survivor's Plating (3). */
  platingMendable: scope => Array.from(scope.data?.parent?.items ?? []).some(item => (item.flags?.["dbu-ttrpg"]?.naturalArmor === true)
    && (((Number(item.system?.crafted?.breakLost) || 0) > 0) || Boolean(item.system?.crafted?.destroyed))),

  /** The Superior State's extra Damage not taken - Divine Physique (2). */
  superiorUnhurt: scope => scope.data?.effects?.slots?.["superior.noExtraDamage"] === true,

  /**
   * Majin Style's Default Costume, worn or broken, with Break Value to get back - "while wearing your Default Costume ...
   * If the piece of Apparel was broken, it stops being broken".
   */
  costumeMendable: scope => Boolean(scope.data?.defaultCostume?.mendable),

  /** Brought to 0 by their own effect - Revenge Bomber's. */
  ownDefeat: scope => Boolean(scope.data?.parent?.getFlag?.("dbu-ttrpg", "ownDefeat")),

  /** The Movement Maneuver used this Combat Round - Terrifying Speed (1)'s. In a Combat alone: no Round, none. */
  movedThisRound: scope => Boolean(globalThis.game?.combat?.started)
    && ((scope.data?.parent?.getFlag?.("dbu-ttrpg", "movedRound") ?? "")
      === `${globalThis.game?.combat?.id ?? "none"}:${globalThis.game?.combat?.round ?? 0}`),

  /**
   * Survivalist (2): "While you are in a Battle Weather that you are not suffering the effects of" - one set on you, felt at
   * Tier 0 (Weather Resistant's, Brace's: "completely ignore the effects").
   */
  weatherUnfelt: scope => Boolean(scope.data?.battlefield?.weather?.id)
    && (Number(scope.data?.battlefield?.weather?.felt ?? NaN) === 0),

  /** The attack whose roll answers this Moment is of that Foundation - `critical-scored`'s `foundation` (Archetype Focus's). */
  ofFoundation: (scope, name) => Boolean(scope.context?.foundation)
    && (String(scope.context.foundation).toLowerCase() === String(name?.value ?? name ?? "").toLowerCase()),

  /** The Focused Foundation is that one - Archetype Focus's, said as `focused.<foundation>` (Archetype Defense's). */
  focusedOn: (scope, name) => scope.data?.effects?.slots?.[`focused.${String(name?.value ?? name ?? "").toLowerCase()}`] === true,

  /** The Maneuver this Moment names is an Attacking Maneuver or a Unique Ability - Reserved Combatant (3)'s. */
  attackOrUnique: scope => Boolean(scope.context?.maneuver?.attacking)
    || (scope.context?.maneuver?.tags ?? []).includes("uniqueAbility") || Boolean(scope.context?.maneuver?.uniqueType),

  /** The Surge this Moment is for was taken through the Surge Maneuver itself - Never Surrender (2)'s. */
  bySurgeManeuver: scope => scope.context?.surgeManeuver === true,

  /** A Snack eaten this Combat Round - Snack Motivated's. */
  snackThisRound: scope => (scope.data?.parent?.getFlag?.("dbu-ttrpg", "snackRound") ?? "")
    === `${globalThis.game?.combat?.id ?? "none"}:${globalThis.game?.combat?.round ?? 0}`,

  /** Room for another stack of that Resource, whatever raises its ceiling - Power of the Hera's Power. */
  roomFor: (scope, name) => {
    const key = String(name ?? "").toLowerCase();
    const most = Number(resourceCeilingOf(key, scope.data?.parent ?? null)) || 0;
    return !most || ((Number(scope.data?.resources?.[key]?.stacks) || 0) < most);
  },

  /**
   * The attack that hit came from an Opponent - one not on their side of the scene (`attackerUuid`, being-hit's context).
   * Where it is not said whose, an Opponent's: Superior's 2(T) is what it was written for.
   */
  byOpponent: scope => {
    const uuid = scope.context?.attackerUuid ?? "";
    const self = scope.data?.parent;
    if (!uuid || !self) return true;
    if (uuid === self.uuid) return false;
    return !areAllies(self, globalThis.fromUuidSync?.(uuid));
  },

  /**
   * Tuffle-Raised (1), (2): knocked through a Health Threshold - or an Ally Defeated - by an Opponent's Attacking Maneuver: its maker
   * (`knockerUuid`, the threshold and ally-defeated Moments') not on your side of the scene.
   */
  knockedByOpponent: scope => {
    const uuid = scope.context?.knockerUuid ?? "";
    const self = scope.data?.parent;
    if (!uuid || !self || (uuid === self.uuid)) return false;
    return !areAllies(self, globalThis.fromUuidSync?.(uuid));
  },

  /** At the Life Points they would be Defeated at, or below - Undying (2)'s "when you would have been Defeated". */
  atDefeat: scope => (Number(scope.data?.life?.value) || 0) <= (Number(scope.data?.life?.min) || 0),

  /** Intelligent Fighter (3): the one Defeated was the one you Studied, while it lasts. */
  defeatedStudied: scope => {
    const held = scope.data?.parent?.getFlag?.("dbu-ttrpg", "studied");
    const combat = globalThis.game?.combat;
    return Boolean(scope.context?.defeatedUuid) && (Array.isArray(held) ? held : [held]).some(studied =>
      (studied?.uuid === scope.context.defeatedUuid) && (studied.combatId === (combat?.id ?? "none"))
      && ((combat?.round ?? 0) <= (Number(studied.through) || 0)));
  },

  /** Demonic Skills: the one you knocked through was one you Studied, while it lasts - defeatedStudied's, for `knockedUuid`. */
  knockedStudied: scope => {
    const held = scope.data?.parent?.getFlag?.("dbu-ttrpg", "studied");
    const combat = globalThis.game?.combat;
    return Boolean(scope.context?.knockedUuid) && (Array.isArray(held) ? held : [held]).some(studied =>
      (studied?.uuid === scope.context.knockedUuid) && (studied.combatId === (combat?.id ?? "none"))
      && ((combat?.round ?? 0) <= (Number(studied.through) || 0)));
  },

  /** Surging (5): the one Defeated was your Focus. */
  defeatedFocus: scope => Boolean(scope.context?.defeatedUuid)
    && (scope.context.defeatedUuid === (scope.data?.parent?.getFlag?.("dbu-ttrpg", "surgingFocus") ?? "")),

  /** Surging's second effect ignored this time - its (5)'s, Hocus Pocus (9)'s. */
  surgingSpared: scope => scope.data?.parent?.getFlag?.("dbu-ttrpg", "surgingSpared") === true,

  /** Galaxy at the Brink (3): Greed of the Hera's 7th ignored at the start of this turn. */
  powerHeld: scope => (scope.data?.parent?.getFlag?.("dbu-ttrpg", "galaxyHold") ?? "")
    === `${globalThis.game?.combat?.id ?? "none"}:${globalThis.game?.combat?.round ?? 0}`,

  /** An Ally (not a Minion) dealt Damage by one of your Attacking Maneuvers this Combat Round - Cutthroat Teamwork's. */
  allyHitThisRound: scope => (scope.data?.parent?.getFlag?.("dbu-ttrpg", "cutthroatAllyHit") ?? "")
    === `${globalThis.game?.combat?.id ?? "none"}:${globalThis.game?.combat?.round ?? 0}`,

  /**
   * Initiative Advantage - Improved Initiative's: "If your Initiative Value is higher than that of all Opponents". Read off the
   * Combat's Combatants; every Opponent's rolled and lower, and at least one of them.
   */
  initiativeAdvantage: scope => initiativeAdvantageOf(scope.data?.parent),
  initiativeBehind: scope => initiativeBehindOf(scope.data?.parent),

  /** In a Grapple as the Grappled - Personal Space's. */
  grappledInGrapple: scope => Boolean(scope.data?.grapple?.partner) && (scope.data?.grapple?.role === "grappled"),

  /** In a Grapple, either side - Human Shield's. */
  inGrapple: scope => Boolean(scope.data?.grapple?.partner),

  /** In a Grapple as the Grappler - Judo Training's. */
  grappler: scope => Boolean(scope.data?.grapple?.partner) && (scope.data?.grapple?.role === "grappler"),

  /** Is this an even-numbered Combat Round - Born for Battle's. */
  // "While in your Normal State" - no Form, no Enhancement: always, while Transformations are not in this system (Disguised Shadow's).
  normalState: () => true,
  // Natural Dragon: "you may increase your Size Category to Gigantic while you possess that stack of Absorption" - chosen as it was
  // gained (chat.mjs absorbCharacter), a stack still held.
  absorbedGigantic: scope => (scope.data?.parent?.flags?.["dbu-ttrpg"]?.absorbedGigantic === true)
    && ((Number(scope.data?.conditions?.["absorption-awakening"]) || 0) > 0),
  evenRound: () => {
    const round = Number(globalThis.game?.combat?.started ? globalThis.game.combat.round : 0) || 0;
    return (round > 0) && ((round % 2) === 0);
  },

  /** Is this character a Minion. */
  isMinion: scope => Boolean(scope.data?.minion),

  /** Does the Maneuver being resolved include this character as a target. */
  targets: (scope, who) =>
    (scope.context?.targets ?? []).some(t => matches(t, who, scope)),

  /** Does this attack's area cover them. */
  aoeHits: (scope, who) =>
    (scope.context?.area?.covered ?? []).some(t => matches(t, who, scope)),

  /** Is this Maneuver an attack aimed at them. */
  attacking: (scope, who) =>
    Boolean(scope.context?.attack) && matches(scope.context?.target, who, scope)
};

/** A character reference can be a uuid, a name, or a Ruling's stored value. */
function matches(candidate, who, scope) {
  if (!candidate) return false;
  const wanted = scope.rulings?.[who] ?? who;
  const uuid = candidate.uuid ?? candidate;
  return (uuid === wanted) || (candidate.name === wanted);
}

/**
 * Evaluate a condition.
 *
 * @returns {boolean} False for anything it does not understand, having said so.
 */
export function evaluate(condition, scope) {
  if (!condition) return true;

  switch (condition.type) {
    case "compare": {
      const left = resolveAmount(condition.left, scope);
      const right = resolveAmount(condition.right, scope);
      switch (condition.op) {
        case "==": return left === right;
        case "!=": return left !== right;
        case "<": return left < right;
        case "<=": return left <= right;
        case ">": return left > right;
        case ">=": return left >= right;
        default:
          scope.errors?.push(`Unknown comparison "${condition.op}".`);
          return false;
      }
    }

    case "logical": {
      // Short-circuiting matters: the right side of an && may only be safe to read
      // because the left one held.
      if (condition.op === "&&") {
        return evaluate(condition.left, scope) && evaluate(condition.right, scope);
      }
      if (condition.op === "||") {
        return evaluate(condition.left, scope) || evaluate(condition.right, scope);
      }
      scope.errors?.push(`Unknown operator "${condition.op}".`);
      return false;
    }

    case "not":
      return !evaluate(condition.operand, scope);

    case "predicate": {
      const fn = PREDICATES[condition.name];
      if (!fn) {
        scope.errors?.push(`Unknown condition "${condition.name}".`);
        return false;
      }
      return Boolean(fn(scope, ...(condition.args ?? []).map(a => literal(a, scope))));
    }

    default:
      scope.errors?.push(`Unknown condition "${condition.type}".`);
      return false;
  }
}

/** A predicate's argument is usually a name rather than a number. */
function literal(arg, scope) {
  if (typeof arg === "string") return arg;
  if (arg?.type === "name") return arg.value;
  return resolveAmount(arg, scope);
}

// Amounts need to evaluate a condition for the ternary, and conditions need to resolve
// an amount to compare. Registering the evaluator breaks the cycle without either file
// importing the other twice.
useConditionEvaluator(evaluate);

export { PREDICATES };
