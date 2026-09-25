import DBUCharacterData from "./data/actor-character.mjs";
import { reactiveFor, usesLeft } from "./effects/registry.mjs";
import { permits } from "./effects/interpreter.mjs";
import { refundActions, spendActions, strikeLightning, weatherToRoll }
  from "./combat.mjs";
import { EDGES, KINDS, endedBy, lasting } from "./durations.mjs";
import { COLLISION_DAMAGE, COLLISION_QUALITIES, FEATURE_QUALITIES, HARDNESS_RANKS, hardnessValue }
  from "./features.mjs";
// `environmentOf` lives beside the breath: "what are they standing in" had to be
// answered there first, and two answers to one question is how they come to disagree.
import { environmentOf } from "./breath.mjs";
import { highTraitOf, isAirborne, qualitiesOf } from "./environments.mjs";
import { getTrait, traitsOfKind } from "./effects/traits.mjs";
import { allKarmicEffects, karmicOptionsFor, spendKarma } from "./karma.mjs";
import { advantageWoundParts, featureRanks, pushes, staggers, POWER_SHOT_MAX_RANKS }
  from "./signature.mjs";
import { baseDieLine, extraDiceLine, diceLine, partLine, noteLine, floorLine,
         fromOutcome, withoutOutcome, breakdownTable, breakdownText } from "./breakdown.mjs";
import { collectReactive, applySlot } from "./effects/interpreter.mjs";
import {
  DAMAGE_CATEGORIES,
  DEFEND_OPTIONS,
  INTERVENE_OPTIONS,
  MANEUVER_TYPES,
  PROFILES,
  areaLabel,
  maxEnergyCharges,
  resolveDamageCategory,
  allManeuvers,
  declareAttack,
  whyNotInReach,
  defendOptionCost,
  getManeuver,
  interveneOptionCost,
  longRangePenalty,
  maneuverKiCost,
  lifeWagerProblem,
  spendLifeWager,
  movementKiCost,
  movementSquares,
  effectUsesLeft,
  recordEffectUse,
  recordManeuverType,
  recordManeuverUse,
  whyNotAnotherAbsolute,
  whyNotThisFoundation,
  whyNotAnotherInstant,
  whyNotIntervene,
  whyNotSpecial,
  maxKiWager,
  refundManeuverCost,
  spendManeuverCost
} from "./maneuvers.mjs";

/** Flag scope for everything this system stores on a ChatMessage. */
const SCOPE = "dbu-ttrpg";

/** Present while a critical's extra die is still unclaimed. */
const PENDING_FLAG = "criticalPending";

/** Which die that critical adds: a flat 1d4 for Skills, Critical Extra Dice elsewhere. */
const CRITICAL_DICE_FLAG = "criticalDice";

/** Present on a Standard Maneuver, which an Instant Maneuver may respond to. */
const RESPONDABLE_FLAG = "respondable";

/** The Instant Maneuvers played in response, one entry per responding Actor. */
const RESPONSES_FLAG = "responses";

/**
 * Out-of-Sequence opportunities granted by this message: one entry per Maneuver a
 * character has been allowed to play in response to it.
 */
const OOS_OFFERS_FLAG = "oosOffers";

/**
 * Set once one of those opportunities has been taken. Only one Out-of-Sequence
 * Maneuver may come out of a single trigger, so taking one closes the rest.
 */
const OOS_TAKEN_FLAG = "oosTaken";

/**
 * Which Karmic Effect each character has spent on this exchange, keyed by Actor id.
 *
 * Only one Karmic Effect may be applied at a time, and this is what makes the rest
 * come up greyed out with the reason rather than simply working twice.
 */
const KARMIC_FLAG = "karmicApplied";

/**
 * What a lone check off the sheet needs to be rolled again.
 *
 * A Clash keeps its two sides on the message already; a Skill roll, an Attribute Check
 * or a Steadfast Check had nowhere to keep theirs, so Karmic Chance - which is about
 * "any die" and not only a Clash - had nothing to work from.
 */
const CHECK_FLAG = "check";

/**
 * The four kinds of roll a Clash can be settled on.
 *
 * A Clash is always the same kind against itself. A Strike is answered by a Dodge or a
 * Parry, never by a Skill; a Skill Clash is a Skill on both sides; a Might Clash is
 * Might on both. They are kept apart because they scale differently - a Combat Roll and
 * a Saving Throw at the same Tier of Power are not comparable numbers - so pitting one
 * against another would not be a close contest, it would be a category error.
 *
 * Written down here because effects ask about it, and because the next person to add a
 * Clash needs to know which of the four they are building.
 */
const CLASH_CATEGORIES = Object.freeze({
  /** Strike, Dodge and Wound - including a Parry, which rolls Strike. */
  combat: "combatRoll",
  /** Any Skill. */
  skill: "skill",
  /** Impulsive, Corporeal, Cognitive, Morale. */
  save: "save",
  /** Might, and only Might. */
  might: "might"
});

/** The four as context, with the one this Clash was settled on set. */
function categoryContext(category) {
  return Object.fromEntries(
    Object.entries(CLASH_CATEGORIES).map(([key, name]) => [name, key === category ? 1 : 0]));
}

/** Socket channel used to ask the GM to edit a message the responder cannot. */
const CHANNEL = `system.${SCOPE}`;

/**
 * Responses are recorded on the Standard Maneuver's own message, but a player does
 * not own another player's message and so cannot edit it. Those edits are relayed to
 * the GM's client, which applies them for everyone.
 */
/** Registering twice would apply every relayed edit twice. */
let socketRegistered = false;

export function registerManeuverSocket() {
  if (socketRegistered) return;
  if (!game.socket) {
    console.error("DBU TTRPG | No socket to listen on yet");
    return;
  }
  socketRegistered = true;
  console.log(`DBU TTRPG | Listening on ${CHANNEL}`);

  game.socket.on(CHANNEL, async request => {
    // Exactly one client must act, or the same edit is applied several times - but a
    // lone GM must always be that client. Deferring to activeGM alone would drop the
    // edit entirely on the one setup where it matters most.
    if (!game.user.isGM) return;
    const activeGM = game.users.activeGM;
    if (activeGM && (activeGM !== game.user)) return;

    try {
      await applyRequest(request);
    }
    catch (error) {
      // A refused edit here leaves the player who asked for it staring at a card that
      // never changed, so it must not fail quietly on this end.
      console.error("DBU TTRPG | Could not apply a relayed edit", request, error);
      ui.notifications.error("DBU TTRPG | A relayed edit failed. See the console.");
    }
  });
}

/** Carry out one relayed edit. Shared with the direct path, which needs the same map. */
function applyRequest(request) {
  switch (request?.type) {
    case "respond": return applyResponse(request.messageId, request.response);
    case "cancel": return applyCancel(request.messageId, request.actorUuid);
    case "clash": return applyClash(request.messageId, request.clash);
    case "attack": return applyAttack(request.messageId, request.attack);
    case "moment": return applyMoment(request.messageId, request.moment);
    case "cure": return applyCure(request.messageId, request.cure);
    case "scan": return applyScan(request.messageId, request.scan);
    case "actor": return applyActorUpdate(request.actorUuid, request.changes);
    case "offer": return applyOffer(request.messageId, request.offer);
    case "offerTaken": return applyOfferTaken(request.messageId, request.actorUuid);
    case "karmic": return applyKarmicRecord(request.messageId, request.actorId, request.key);
    default:
      console.warn("DBU TTRPG | Unknown relayed edit", request);
      return undefined;
  }
}

/**
 * Note that this character has spent their Karmic Effect on this exchange.
 *
 * Relayed like every other edit, because the person spending the Karma is usually not
 * the author of the message they are spending it on - the defender answering an attack,
 * most often - and writing the flag directly would simply be refused.
 */
async function applyKarmicRecord(messageId, actorId, key) {
  const message = game.messages.get(messageId);
  if (!message) return;
  const applied = { ...(message.getFlag(SCOPE, KARMIC_FLAG) ?? {}) };
  applied[actorId] = key;
  await message.setFlag(SCOPE, KARMIC_FLAG, applied);
}

/** Record a response, replacing whatever that Actor had played before. */
async function applyResponse(messageId, response) {
  const message = game.messages.get(messageId);
  if (!message) return;
  const responses = (message.getFlag(SCOPE, RESPONSES_FLAG) ?? [])
    .filter(entry => entry.actorUuid !== response.actorUuid);
  await message.setFlag(SCOPE, RESPONSES_FLAG, [...responses, response]);
}

/** Take an Actor's response back off the message. */
async function applyCancel(messageId, actorUuid) {
  const message = game.messages.get(messageId);
  if (!message) return;
  const responses = (message.getFlag(SCOPE, RESPONSES_FLAG) ?? [])
    .filter(entry => entry.actorUuid !== actorUuid);
  await message.setFlag(SCOPE, RESPONSES_FLAG, responses);
}

/** Grant a character the chance to play a Maneuver out of sequence. */
async function applyOffer(messageId, offer) {
  const message = game.messages.get(messageId);
  if (!message) return;
  const offers = message.getFlag(SCOPE, OOS_OFFERS_FLAG) ?? [];
  await message.setFlag(SCOPE, OOS_OFFERS_FLAG, [...offers, offer]);
}

/** Record that this trigger's one Out-of-Sequence Maneuver has been used. */
async function applyOfferTaken(messageId, actorUuid) {
  const message = game.messages.get(messageId);
  if (!message) return;
  // A list, because each person's opening is their own trigger. Held as a single uuid,
  // one Cross Counter settled the card and the other three defenders who had chosen it
  // and paid for it lost their strike back - and an Exploit provoked for "all adjacent
  // Opponents" would have been one opening shared between them.
  //
  // An older card holds a bare uuid, which reads as a list of one.
  const taken = takenOffers(message);
  await message.setFlag(SCOPE, OOS_TAKEN_FLAG, [...new Set([...taken, actorUuid])]);
}

async function applyActorUpdate(actorUuid, changes) {
  const actor = fromUuidSync(actorUuid);
  return actor?.update(changes);
}

/**
 * Change an Actor we may not own.
 *
 * A Combat Roll is resolved by whichever client is settling the exchange, which is
 * often not the one that owns the character rolling - so spending a triggered effect
 * has to be relayed the same way a message edit is.
 */
export function requestActorUpdate(actor, changes) {
  if (actor.isOwner) return actor.update(changes);
  if (!game.users.activeGM) return;
  game.socket.emit(CHANNEL, { type: "actor", actorUuid: actor.uuid, changes });
}

/**
 * Record one use of a triggered effect, and disarm it.
 *
 * Counted against the **block**, not the Trait. A Talent with two triggered effects
 * used to be impossible to arm or spend separately, because both lists were keyed on
 * the Talent's own id.
 */
function spendTriggeredEffect(actor, blockId) {
  return requestActorUpdate(actor, {
    "system.talentUses.round": [...actor.system.talentUses.round, blockId],
    "system.talentUses.encounter": [...actor.system.talentUses.encounter, blockId],
    "system.armedTalents": actor.system.armedTalents.filter(id => id !== blockId)
  });
}

/** Write a cured poison back onto its message, so the button goes. */
/** Write a settled scan back onto its message, so its buttons go. */
async function applyScan(messageId, scan) {
  const message = game.messages.get(messageId);
  if (!message) return;
  await message.setFlag(SCOPE, SCAN_FLAG, scan);
}

async function applyCure(messageId, cure) {
  const message = game.messages.get(messageId);
  if (!message) return;
  await message.setFlag(SCOPE, CURE_FLAG, cure);
}

/** Write a resolved attack back onto its message. */
async function applyAttack(messageId, attack) {
  const message = game.messages.get(messageId);
  if (!message) return;
  await message.setFlag(SCOPE, ATTACK_FLAG, attack);
}

/** Write a Moment card's state back onto its message. */
async function applyMoment(messageId, moment) {
  const message = game.messages.get(messageId);
  if (!message) return;
  await message.setFlag(SCOPE, MOMENT_FLAG, moment);
}

/** Write a settled Skill Clash back onto its message. */
async function applyClash(messageId, clash) {
  const message = game.messages.get(messageId);
  if (!message) return;
  await message.setFlag(SCOPE, CLASH_FLAG, clash);

  // A Grapple Check does something when it lands, and this is the one place a Clash is
  // written: exactly one client gets here - the message's author, or the GM acting for
  // them - so the Grapple is applied once rather than once per person watching.
  if (clash.grapple && clash.result && !clash.grapple.applied) {
    await settleGrapple(message, clash);
  }

  // The same arrangement for the Thrust, and for the same reason: exactly one client
  // reaches here, so what a settled Clash leaves behind is left once.
  if (clash.thrust && clash.result && !clash.thrust.applied) {
    await settleThrust(message, clash);
  }

  if (clash.blockade && clash.result && !clash.blockade.applied) {
    await settleBlockade(message, clash);
  }

  if (clash.dirtyTrick && clash.result && !clash.dirtyTrick.applied) {
    await settleDirtyTrick(message, clash);
  }

  if (clash.feint && clash.result && !clash.feint.applied) {
    await settleFeint(message, clash);
  }

  if (clash.insult && clash.result && !clash.insult.applied) {
    await settleInsult(message, clash);
  }

  if (clash.internalAttack && clash.result && !clash.internalAttack.applied) {
    await settleInternalAttack(message, clash);
  }

  if (clash.magicTrick && clash.result && !clash.magicTrick.applied) {
    await settleMagicTrick(message, clash);
  }

  if (clash.sense && clash.result && !clash.sense.applied) {
    await settleSense(message, clash);
  }

  if (clash.terrify && clash.result && !clash.terrify.applied) {
    await settleTerrify(message, clash);
  }

  if (clash.transfiguration && clash.result && !clash.transfiguration.applied) {
    await settleTransfiguration(message, clash);
  }

  if (clash.treatment && clash.result && !clash.treatment.applied) {
    await settleTreatment(message, clash);
  }

  if (clash.stagger && clash.result && !clash.stagger.applied) {
    await settleStagger(message, clash);
  }

  if (clash.gearClash && clash.result && !clash.gearClash.applied) {
    await settleGearClash(message, clash);
  }

  if (clash.snare && clash.result && !clash.snare.applied) {
    await settleSnare(message, clash);
  }

  if (clash.drain && clash.result && !clash.drain.applied) {
    await settleDrain(message, clash);
  }
}

/**
 * The Clash before a Power Drain made without a Grapple, through the Energy-Suction Device.
 *
 * "You must win a Clash (Physical Strike vs Strike/Dodge) against your target before using
 * the effects of the Power Drain Special Maneuver." The Strike Clash, the target choosing.
 */
export async function postDrainClash(actor, target, maneuver, actions, store) {
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: "",
    flags: {
      [SCOPE]: {
        [RESPONDABLE_FLAG]: false,
        [CLASH_FLAG]: {
          category: "strike",
          clashLabel: "Clash (Physical Strike vs Strike/Dodge)",
          maneuverName: maneuver.name,
          reason: `Win and ${maneuver.name} takes from ${target.name}.`,
          challengerUuid: actor.uuid,
          challengerName: actor.name,
          defenderUuid: target.uuid,
          defenderName: target.name,
          defenderRoll: "",
          drain: {
            applied: false, maneuverId: maneuver.id, actions: actions || 1,
            storeId: store?.id ?? ""
          },
          ready: [],
          result: null
        }
      }
    }
  });
}

/** A won drain Clash drains, into the Device; a lost one takes nothing. */
async function settleDrain(message, clash) {
  const actor = fromUuidSync(clash.challengerUuid);
  const target = fromUuidSync(clash.defenderUuid);
  if (!actor || !target) return;

  await message.setFlag(SCOPE, CLASH_FLAG, { ...clash, drain: { ...clash.drain, applied: true } });

  if (whoWonClash(clash.result) !== "challenger") {
    await settledNote(message, `${target.name} pulls free before anything is taken.`);
    return;
  }

  const maneuver = getManeuver(clash.drain.maneuverId);
  const store = actor.items.get(clash.drain.storeId) ?? null;
  if (!maneuver) return;
  const { drainFrom } = await import("./use-maneuver.mjs");
  return drainFrom(actor, target, maneuver, clash.drain.actions, store);
}

/**
 * Open the Net's first Clash: the thrower's Strike against the target's Dodge.
 *
 * "Make a Clash (Energy Strike/Magic Strike vs Dodge)." The Strike category, with the
 * Defender held to Dodge. What winning each step leaves is carried whole, with the recorded
 * Modifier and the thrower's Tier taken now - the Tier is the thrower's, by the table's
 * ruling, and what it was when they threw is what the entry means.
 */
export async function postSnare(thrower, target, item) {
  const snare = item.system.snare;
  const tier = Math.max(1, thrower.system.tierOfPower ?? 1);
  const might = Number.isFinite(item.system.recorded) ? item.system.recorded : 0;
  const foundations = (snare.foundations ?? [])
    .map(key => key.charAt(0).toUpperCase() + key.slice(1)).join(" Strike/");

  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: thrower }),
    content: "",
    flags: {
      [SCOPE]: {
        [RESPONDABLE_FLAG]: false,
        [CLASH_FLAG]: {
          category: "strike",
          clashLabel: `Clash (${foundations} Strike vs Dodge)`,
          maneuverName: item.name,
          reason: `Win and ${target.name}'s Defense Value drops by ${tier}, and a Might Clash `
            + "follows.",
          challengerUuid: thrower.uuid,
          challengerName: thrower.name,
          defenderUuid: target.uuid,
          defenderName: target.name,
          defenderRoll: "dodge",
          dodgeOnly: true,
          snare: {
            stage: "strike", applied: false, itemName: item.name,
            mark: snare.mark, condition: snare.condition, tier, might
          },
          ready: [],
          result: null
        }
      }
    }
  });
}

/**
 * What a settled Net Clash leaves.
 *
 * The Strike: "If you win, reduce their Defense Value by 1(T) until the end of your next
 * turn and make a Might Clash against that same Character." The Might Clash: "If you win,
 * that target is Pinned." A tie goes to the Defender, here as everywhere.
 */
async function settleSnare(message, clash) {
  const thrower = fromUuidSync(clash.challengerUuid);
  const target = fromUuidSync(clash.defenderUuid);
  if (!thrower || !target) return;

  // Marked first, whatever happens below: a failure halfway through must not leave a card
  // that settles itself again on the next render.
  await message.setFlag(SCOPE, CLASH_FLAG, { ...clash, snare: { ...clash.snare, applied: true } });

  const snare = clash.snare;
  if (whoWonClash(clash.result) !== "challenger") {
    await settledNote(message, `${target.name} slips the ${snare.itemName}.`);
    return;
  }

  if (snare.stage === "strike") {
    // The thrower's Tier in stacks, each a point off their Defense Value, on the thrower's
    // clock to the end of their next turn.
    await markUntilNextTurn(thrower, target, snare.mark, snare.tier, "end", snare.itemName);
    await settledNote(message, `${target.name}'s Defense Value is ${snare.tier} lower until the `
      + `end of ${thrower.name}'s next turn.`);

    // The recorded Modifier is the thrower's Might in this one.
    return postMightClash(thrower, target, {
      maneuverName: snare.itemName,
      reason: `Win and ${target.name} is ${getTrait(snare.condition)?.name ?? snare.condition}.`,
      mightFor: { [thrower.uuid]: snare.might },
      mightLabel: `${snare.itemName} (Scholarship)`,
      snare: { ...snare, stage: "might", applied: false }
    });
  }

  // The Might Clash. Won, the Condition - and a note on them of who threw it and what it
  // recorded, since "the Pinned Combat Condition inflicted through it" is Clashed against
  // with the recorded Modifier too, every time they try to get free.
  const { setCondition } = await import("./conditions.mjs");
  if (await setCondition(target, snare.condition, 1) === false) return;
  await requestActorUpdate(target, {
    [`flags.${SCOPE}.snaredBy`]: {
      by: thrower.uuid, might: snare.might, condition: snare.condition, itemName: snare.itemName
    }
  });
  await settledNote(message, `${target.name} is ${getTrait(snare.condition)?.name
    ?? snare.condition}.`);
}

/**
 * Open the Clash an Item makes against one character it caught.
 *
 * The Flash Bang's Clash (Impulsive): the Saving Throw named on both sides, the way the
 * Blockade's is.
 */
export async function postGearClash(thrower, target, item) {
  const clash = item.system.clash;
  const condition = getTrait(clash.condition)?.name ?? clash.condition;
  const until = (clash.until === "end") ? "the end" : "the start";
  const leaves = {
    applied: false,
    itemName: item.name,
    condition: clash.condition,
    until: clash.until,
    hold: clash.hold ?? ""
  };

  // The Taser's "Clash (Strike vs Strike/Dodge)": the Strike Clash the Grapple Check and the
  // Thrust are made with, the Defender choosing which of the two to answer with.
  if (clash.roll === "strike") {
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: thrower }),
      content: "",
      flags: {
        [SCOPE]: {
          [RESPONDABLE_FLAG]: false,
          [CLASH_FLAG]: {
            category: "strike",
            clashLabel: "Clash (Strike vs Strike/Dodge)",
            maneuverName: item.name,
            reason: `Win and ${target.name} is ${condition} until ${until} of ${thrower.name}'s `
              + "next turn.",
            challengerUuid: thrower.uuid,
            challengerName: thrower.name,
            defenderUuid: target.uuid,
            defenderName: target.name,
            defenderRoll: "",
            gearClash: leaves,
            ready: [],
            result: null
          }
        }
      }
    });
  }

  return postSaveClash(thrower, target, {
    maneuverName: item.name,
    clashLabel: `Clash (${clash.save.charAt(0).toUpperCase()}${clash.save.slice(1)})`,
    reason: `Win and ${target.name} is ${condition} until ${until} of ${thrower.name}'s `
      + "next turn.",
    saves: [clash.save],
    gearClash: leaves
  });
}

/**
 * What a settled Item Clash leaves: the Condition, on the thrower's clock, or nothing.
 *
 * "If you win, they gain the Blinded Combat Condition until the start of your next turn."
 * Your turn, so the clock is the thrower's. A tie goes to the Defender, here as everywhere.
 */
async function settleGearClash(message, clash) {
  const thrower = fromUuidSync(clash.challengerUuid);
  const target = fromUuidSync(clash.defenderUuid);
  if (!thrower || !target) return;

  // Marked first, whatever happens below: a failure halfway through must not leave a card
  // that settles itself again on the next render.
  await message.setFlag(SCOPE, CLASH_FLAG, {
    ...clash, gearClash: { ...clash.gearClash, applied: true }
  });

  const { condition, until, itemName } = clash.gearClash;
  if (whoWonClash(clash.result) !== "challenger") {
    await settledNote(message, `${target.name} shrugs off the ${itemName}.`);
    return;
  }

  // The mark that holds it first, on the same clock, so it runs out first: the Condition's
  // own clock then finds nothing holding it. "They cannot remove the Prone Combat Condition
  // inflicted by a Taser until then."
  const edge = (until === "end") ? "end" : "start";
  if (clash.gearClash.hold) {
    await markUntilNextTurn(thrower, target, clash.gearClash.hold, 1, edge, itemName);
  }
  await markUntilNextTurn(thrower, target, condition, 1, edge, itemName);
  const name = getTrait(condition)?.name ?? condition;
  await settledNote(message, `${target.name} is ${name} until the `
    + `${(until === "end") ? "end" : "start"} of ${thrower.name}'s next turn.`);
}

/**
 * What a settled Staggering Attack Clash leaves: Staggered, or nothing.
 *
 * "If you win, they gain the Staggered Combat Condition until the end of their turn."
 * Their turn, so the clock is theirs. A tie goes to the Defender, here as everywhere.
 */
async function settleStagger(message, clash) {
  const attacker = fromUuidSync(clash.challengerUuid);
  const target = fromUuidSync(clash.defenderUuid);
  if (!attacker || !target) return;

  // Marked first, whatever happens below: a failure halfway through must not leave a card
  // that settles itself again on the next render.
  await message.setFlag(SCOPE, CLASH_FLAG, {
    ...clash, stagger: { ...clash.stagger, applied: true }
  });

  if (whoWonClash(clash.result) !== "challenger") {
    await settledNote(message, `${target.name} keeps their footing.`);
    return;
  }

  const { setCondition } = await import("./conditions.mjs");
  if (await setCondition(target, "staggered", 1) === false) return;
  await lasting(target, {
    kind: KINDS.CONDITION,
    key: "staggered",
    edge: EDGES.END,
    source: "Staggering Attack"
  });

  await settledNote(message, `${target.name} is Staggered until the end of their turn.`);
}

/**
 * What a settled Treatment Clash leaves: the poison out, or still in.
 *
 * "If you win, remove the Combat Condition." Off the Ally, who is neither side of this
 * Clash - it is rolled against whoever gave them the poison, and the card is what knows
 * who it was for. A tie goes to the Defender, here as everywhere: the poison was theirs
 * and holding on to it needs no effort.
 *
 * The halved Life Points are not handed back on a loss. The entry spends them on the
 * attempt rather than on the result, and says nothing about getting them back.
 */
async function settleTreatment(message, clash) {
  const treater = fromUuidSync(clash.challengerUuid);
  const culprit = fromUuidSync(clash.defenderUuid);
  const ally = fromUuidSync(clash.treatment.allyUuid);
  if (!treater || !culprit) return;

  // Marked first, whatever happens below: a failure halfway through must not leave a card
  // that settles itself again on the next render.
  await message.setFlag(SCOPE, CLASH_FLAG, {
    ...clash, treatment: { ...clash.treatment, applied: true }
  });

  const name = ally?.name ?? clash.treatment.allyName ?? "their patient";

  if (whoWonClash(clash.result) !== "challenger") {
    await settledNote(message,
      `The poison holds. ${name} is still Poisoned, and the Life Points that bought the `
      + "attempt are spent.");
    return;
  }

  if (!ally) {
    await settledNote(message,
      `${treater.name} wins, but ${name} is no longer here to treat.`);
    return;
  }

  const { setCondition } = await import("./conditions.mjs");
  await setCondition(ally, "poisoned", 0);

  await settledNote(message, `${treater.name} draws it out: ${name} is no longer Poisoned.`);
}

/**
 * What an Attacking Maneuver thrown at a Feature comes to.
 *
 * "Features can be targets for any Attacking Maneuver, just like Characters can. However,
 * you always automatically hit a Feature and only inflict Damage equal to your Tier of
 * Power."
 *
 * So there is no Strike Roll and no Wound Roll: both are settled before the dice would
 * have been picked up, and the whole card is one number. The attack still cost what it
 * costs - the Actions, the Ki, the Profile, the Ki Wager - because it is an Attacking
 * Maneuver and those are paid for making one, not for hitting with it.
 *
 * "For every 2 Energy Charges applied to an Attacking Maneuver, treat your Tier of Power
 * as if it was 1 higher when calculating Damage to a Feature." Two, so an odd charge is
 * worth nothing on its own - rounded down, which is what this system does everywhere it
 * does not say otherwise.
 *
 * Nothing is written to anybody. A Feature has Life Points equal to its Hardness Rank and
 * this system has no Features to keep them on, so the number is said and the table takes
 * it off whatever they are holding.
 */
export async function postFeatureAttack(actor, maneuver, declared, charges = 0) {
  const tier = Math.max(1, actor.system.tierOfPower ?? 1);
  const fromCharges = Math.floor(Math.max(0, charges) / 2);
  const damage = tier + fromCharges;

  const profile = PROFILES[declared?.profile];

  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="dbu-maneuver">
        <div class="dbu-maneuver-name">${Handlebars.escapeExpression(maneuver.name)} - at a Feature</div>
        <div class="dbu-maneuver-meta">Automatic hit &middot; ${
          profile ? `${Handlebars.escapeExpression(profile.label)} Profile &middot; ` : ""
        }${maneuver.kiCost} KP</div>
        <div class="dbu-check">
          <div class="dbu-check-parts">Tier of Power ${tier}${
            fromCharges ? ` &middot; +${fromCharges} from ${charges} Energy Charges` : ""
          }</div>
          <div class="dbu-check-total">${damage}</div>
        </div>
        <div class="dbu-maneuver-note">Damage to the Feature. Its Life Points are its
          Hardness Rank, which is the table's to keep - nothing here holds a Feature.</div>
      </div>`,
    flags: {
      [SCOPE]: {
        // An Attacking Maneuver at a Feature is still a Maneuver being used, so an Instant
        // can answer it - the rule is about what kind of Maneuver it is, not about what it
        // was aimed at.
        [RESPONDABLE_FLAG]: isRespondable(maneuver)
      }
    }
  });
}

/**
 * Open the Transfiguration's first Clash: "(Physical Strike vs Strike/Dodge)".
 *
 * The Grapple Check's pair of rolls, which is the only Strike-against-Strike-or-Dodge
 * there is here - there is one Strike Roll in this system, and a Foundation decides what
 * the Wound reads rather than what Strike is.
 *
 * `urgent` is the Counter Action's doing. "Make the rolls as if you were targeted by
 * another Character (all rolls involved become Urgent)" - so a re-aimed Transfiguration
 * opens with one character on both sides and neither of their rolls can be failed on
 * purpose.
 */
export async function postTransfiguration(actor, target, maneuver, { urgent = false } = {}) {
  const aimedAtSelf = actor.uuid === target.uuid;

  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: "",
    flags: {
      [SCOPE]: {
        // A Standard Maneuver, so an Instant can answer it - except when it is the
        // re-aimed one, which is not a Maneuver being used but the same use turned round.
        [RESPONDABLE_FLAG]: !urgent && isRespondable(maneuver),
        [CLASH_FLAG]: {
          category: "strike",
          clashLabel: "Transfiguration",
          maneuverName: maneuver.name,
          reason: aimedAtSelf
            ? `${actor.name} has their own Transfiguration turned back on them. Both rolls `
              + "are theirs, and both are Urgent."
            : `${actor.name} tries to turn ${target.name} into an object. Win and they are `
              + "Transfigured, and a Might Clash follows.",
          challengerUuid: actor.uuid,
          challengerName: actor.name,
          defenderUuid: target.uuid,
          defenderName: target.name,
          defenderRoll: "",
          // Neither side may fail on purpose once the Counter Action has turned this round.
          urgent,
          transfiguration: {
            stage: "strike",
            applied: false,
            // What the winner named it, filled in on the card once there is a winner.
            item: "",
            // Whether the target has paid a Counter Action to turn this back on its user.
            // Spent while the Clash is still open, because it is what decides what beating
            // them does - and it cannot be offered on a Clash that is already aimed at
            // its own user.
            counter: false,
            counterOffered: !aimedAtSelf
          },
          ready: [],
          result: null
        }
      }
    }
  });
}

/**
 * What a settled Transfiguration Clash leaves, at whichever of its two stages this is.
 *
 * The first is "(Physical Strike vs Strike/Dodge)". Winning it buys the Item and the
 * Transfigured Combat Condition; losing it does nothing, unless the target paid a Counter
 * Action and beat it - in which case the whole use turns round onto whoever threw it.
 *
 * The second is the Might Clash that follows. Winning that makes them the Item outright.
 *
 * A tie goes to the Defender in both, here as everywhere.
 */
async function settleTransfiguration(message, clash) {
  const caster = fromUuidSync(clash.challengerUuid);
  const target = fromUuidSync(clash.defenderUuid);
  if (!caster || !target) return;

  // Marked first, whatever happens below: a failure halfway through must not leave a card
  // that settles itself again on the next render.
  await message.setFlag(SCOPE, CLASH_FLAG, {
    ...clash, transfiguration: { ...clash.transfiguration, applied: true }
  });

  const winner = whoWonClash(clash.result);

  if (clash.transfiguration.stage === "might") {
    return settleTransfigurationMight(message, clash, caster, target, winner);
  }

  if (winner === "challenger") {
    await settledNote(message,
      `${caster.name} has ${target.name}. They choose what ${target.name} has become.`);
    return;
  }

  // "If they do, and they beat the initial Clash." Beating, not tying: a tie is already
  // the Defender's and the Maneuver already fails, so what the Counter Action buys is the
  // part beyond that - and the entry asks for a beat by name.
  const beatIt = !clash.result.challenger.succeeded
    && (clash.result.defender.succeeded
      || (clash.result.defender.total > clash.result.challenger.total));

  if (clash.transfiguration.counter && beatIt) {
    await settledNote(message,
      `${target.name} spent a Counter Action and beat it, so the Transfiguration turns `
      + `back on ${caster.name} - who now rolls both sides of it, Urgently.`);

    // "You must change the target of this use of the Transfiguration Maneuver to
    // yourself." The Maneuver stays the caster's and the caster is its target, so both
    // sides of the new Clash are them.
    await postTransfiguration(caster, caster,
      { name: clash.maneuverName, type: "standard" }, { urgent: true });
    return;
  }

  await settledNote(message, clash.transfiguration.counter
    ? `${target.name} holds their shape, but did not beat it outright - the Counter Action `
      + "is spent and nothing turns back."
    : `${target.name} holds their shape.`);
}

/**
 * The Might Clash that follows becoming an Item, settled.
 *
 * Winning it is the whole of the Maneuver: "the Transfigured Opponent, for all intents and
 * purposes, becomes that Item and cannot make any type of Maneuver until the end of the
 * Combat Encounter". Held as a Resource with an Encounter clock, read by a passive in the
 * Maneuver's own file - which is the only passive that runs on the character it binds.
 *
 * Losing it leaves them Transfigured and able to act, which is what Transfigured's own
 * entry is about: -2(bT) on Combat Rolls, Physical attacks only, and no Signature
 * Techniques. A rule about somebody who is still in the fight.
 */
async function settleTransfigurationMight(message, clash, caster, target, winner) {
  const item = clash.transfiguration.item || "an object";

  if (winner !== "challenger") {
    await settledNote(message,
      `${target.name} is still ${item} and still Transfigured, but not only ${item}: they `
      + "can act.");
    return;
  }

  await setResource(target, "anitem", 1);
  await lasting(caster, {
    kind: KINDS.RESOURCE,
    key: "anitem",
    edge: EDGES.ENCOUNTER,
    on: target.uuid,
    source: "Transfiguration"
  });

  await settledNote(message,
    `${target.name} is ${item}, for all intents and purposes, and can make no Maneuver of `
    + "any kind until the Encounter ends - after which, if they are alive, they return to "
    + `normal. If ${item} is destroyed or used up, ${target.name} dies.`);
}

/**
 * "Choose an Item." Named by whoever won the first Clash, on the card, after they won it.
 *
 * There are no objects in this system, so what is chosen is a name. It is written onto the
 * character as well as the card: "for all intents and purposes, becomes that Item" lasts
 * the Encounter and the card scrolls away inside a round.
 *
 * Naming it is also what applies the Condition and opens the Might Clash, because the
 * entry puts them in that order - "your Opponent becomes that Item... after your Opponent
 * becomes an Item, make a Might Clash".
 */
async function chooseTransfiguredItem(message, clash) {
  if (clash.transfiguration?.item) return;

  const caster = fromUuidSync(clash.challengerUuid);
  const target = fromUuidSync(clash.defenderUuid);
  if (!caster || !target) return;

  const named = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: `${clash.maneuverName} - what have they become?` },
    content: `
      <p>${Handlebars.escapeExpression(target.name)} becomes this until the end of the
        Combat Encounter.</p>
      <label class="dbu-wager">
        <span>Item</span>
        <input type="text" name="item" value="" placeholder="a teacup" autofocus/>
        <em>Their Size Category changes to suit it - your ARC decides, and the Slot for it
          is <code>size.steps</code>.</em>
      </label>`,
    buttons: [
      {
        action: "confirm",
        label: "Confirm",
        callback: (event, button, dialog) =>
          dialog.element.querySelector('input[name="item"]').value.trim() || "an object"
      },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });

  if ((typeof named !== "string") || !named || (named === "cancel")) return;

  const { setCondition } = await import("./conditions.mjs");
  await setCondition(target, "transfigured", 1);
  await requestActorUpdate(target, {
    "system.transfigured.item": named,
    "system.transfigured.byName": caster.name
  });

  await lasting(caster, {
    kind: KINDS.CONDITION,
    key: "transfigured",
    edge: EDGES.ENCOUNTER,
    on: target.uuid,
    source: "Transfiguration"
  });

  await requestEdit(message, {
    type: "clash",
    clash: { ...clash, transfiguration: { ...clash.transfiguration, item: named } }
  });

  await settledNote(message,
    `${target.name} is ${named}, and Transfigured until the Encounter ends. Their Size `
    + "Category changes to suit it, which is the ARC's to say.");

  // "After your Opponent becomes an Item, make a Might Clash against that Opponent."
  await postMightClash(caster, target, {
    maneuverName: clash.maneuverName,
    clashLabel: "Transfiguration",
    reason: `${caster.name} presses it home. Win and ${target.name} is ${named} outright, `
      + "unable to act for the rest of the Encounter.",
    transfiguration: { stage: "might", applied: false, item: named, counter: false,
                       counterOffered: false }
  });
}

/**
 * A Counter Action spent to turn the Maneuver back on whoever threw it.
 *
 * Spent while the Clash is still open: it is what decides what beating the Clash does, so
 * it cannot be declared after the dice. Refused if the Clash has already been rolled, and
 * refused by `spendActions` if there is no Counter Action to spend - which also refuses it
 * outside a Combat Encounter, where nothing would hand it back.
 */
async function counterTransfiguration(message, clash) {
  if (clash.result || clash.transfiguration?.counter) return;

  const target = fromUuidSync(clash.defenderUuid);
  if (!target) return;

  const { spendActions } = await import("./combat.mjs");
  if (!await spendActions(target, 1, "counter")) return;

  await requestEdit(message, {
    type: "clash",
    clash: { ...clash, transfiguration: { ...clash.transfiguration, counter: true } }
  });

  await settledNote(message,
    `${target.name} spends a Counter Action. Beat the Clash and the Transfiguration turns `
    + `back on ${clash.challengerName}.`);
}

/**
 * "If that Item would be destroyed or used up (such as a Snack), that Character dies."
 *
 * Nothing here can know that a teacup was broken, so this is a button pressed by whoever
 * is running the fight rather than something watched for.
 *
 * "They must spend a Karma Point to avoid dying." Offered rather than spent for them: it
 * is a choice with a price, and a system that spends somebody's last Karma Point without
 * asking has made the choice for them.
 *
 * "They are still Defeated." Either way - the Karma Point buys you out of dying and not
 * out of being Defeated. This system has no separate record of being dead, so what it
 * writes is the defeat, and the card says which of the two happened.
 */
async function transfigurationDestroyed(message, clash) {
  const target = fromUuidSync(clash.defenderUuid);
  if (!target) return;

  const item = clash.transfiguration?.item || "the object";

  const answer = await pick(
    `${item} is destroyed`,
    `${target.name} dies. They may spend a Karma Point to avoid dying - they are Defeated `
    + "either way.",
    [
      { action: "karma", label: `Spend a Karma Point (${target.system.karma ?? 0} left)` },
      { action: "die", label: "Let them die" }
    ]);
  if (!answer) return;

  if (answer === "karma") {
    const { spendKarma } = await import("./karma.mjs");
    // A Karmic Effect's own shape, since that is what the spender takes: a name for the
    // dialog it may open and a price. This one's price is stated, so nothing is asked and
    // the refusal for not having it is the one every Karmic Effect gets.
    if (!await spendKarma(target, { name: "Transfiguration", cost: 1 })) return;
  }

  // "They are still Defeated" - either way, so this is written in both branches. Being
  // Defeated is not a field: it is derived from Life Points at nothing, and writing it
  // directly wrote nothing at all. So what is written is the Life, which is also what
  // makes the existing defeat machinery notice - the Moments, the card, Undying's chance
  // to reach through.
  //
  // Which leaves dying and being Defeated recorded the same way, because this system has
  // no separate record of being dead. The card says which of the two it was.
  await reduceLifePoints(target, target.system.life.value,
    { reason: `${item} destroyed - Transfiguration` });

  await settledNote(message, (answer === "karma")
    ? `${item} is destroyed. ${target.name} spends a Karma Point and lives - their body `
      + "appears in the closest unoccupied Square. They are still Defeated."
    : `${item} is destroyed, and ${target.name} dies with it. Defeated.`);
}

/**
 * The Transfiguration's Might Clash penalty for punching up.
 *
 * "If that Opponent's Tier of Power is higher than yours, reduce your Dice Score for this
 * Clash by 1(T)." The challenger's row alone, and scaled where the Terrify's -2 is flat -
 * 1(T) of the challenger's own Tier, which is what (T) means on a number belonging to
 * whoever is rolling it.
 *
 * Strictly higher: equal Tiers are not higher.
 */
function transfigurationPenalty(actor, clash, uuid) {
  if (!clash.transfiguration) return [];
  if (uuid !== clash.challengerUuid) return [];

  const target = fromUuidSync(clash.defenderUuid);
  if (!target) return [];

  const theirs = Math.max(1, target.system.tierOfPower ?? 1);
  const mine = Math.max(1, actor.system.tierOfPower ?? 1);
  if (theirs <= mine) return [];

  return [{ label: "Transfiguration - higher Tier", written: "-1(T)", value: -mine }];
}

/**
 * What a settled Terrify leaves: a Condition, and sometimes a second one.
 *
 * "If you win, your target gains the Shaken Combat Condition until the end of your next
 * turn." Your turn, so the clock is kept by the one who frightened them and the Condition
 * sits on the target - the split Analysis and Intuit both use.
 *
 * "If they already possessed the Shaken Combat Condition, they are additionally knocked
 * Prone." Already, so it is read before this use writes it. Get that ordering backwards and
 * every Terrify knocks its target Prone, because every Terrify has just made them Shaken.
 */
async function settleTerrify(message, clash) {
  const terrifier = fromUuidSync(clash.challengerUuid);
  const target = fromUuidSync(clash.defenderUuid);
  if (!terrifier || !target) return;

  // Marked first, whatever happens below: a failure halfway through must not leave a card
  // that settles itself again on the next render.
  await message.setFlag(SCOPE, CLASH_FLAG, {
    ...clash, terrify: { ...clash.terrify, applied: true }
  });

  // A tie goes to the Defender, here as everywhere else.
  if (whoWonClash(clash.result) !== "challenger") {
    await settledNote(message, `${target.name} does not flinch.`);
    return;
  }

  const { setCondition } = await import("./conditions.mjs");

  // Read before it is written. This is the whole of the second sentence.
  const already = (Number(target.system.conditions?.shaken) || 0) > 0;

  await setCondition(target, "shaken", 1);

  await lasting(terrifier, {
    kind: KINDS.CONDITION,
    key: "shaken",
    edge: EDGES.END,
    next: true,
    on: target.uuid,
    source: "Terrify"
  });

  // No clock of its own: the entry gives Prone none, so it comes off the way Prone always
  // comes off.
  if (already) await setCondition(target, "prone", 1);

  await settledNote(message, already
    ? `${target.name} was Shaken already, so they are knocked Prone - and Shaken until the `
      + `end of ${terrifier.name}'s next turn.`
    : `${target.name} is Shaken until the end of ${terrifier.name}'s next turn.`);
}

/**
 * What a settled Sense leaves: a sentence, and only for one side.
 *
 * "If you win, you can tell how many stacks of Holding Back they possess and if they are
 * currently in their Transformation with the highest Tier of Power Requirement." Half of
 * that is a Resource this system keeps and half of it is about Transformations, which this
 * system has none of - so the first is read and the second is asked.
 *
 * The reading is whispered, where every other settled Clash's note is read out. What the
 * others leave is a thing that happened and belongs to the table; this one buys knowing,
 * and reading it out gives the answer to the people the entry keeps it from. That it
 * landed is said publicly, since the card already shows who won.
 */
async function settleSense(message, clash) {
  const sensor = fromUuidSync(clash.challengerUuid);
  const target = fromUuidSync(clash.defenderUuid);
  if (!sensor || !target) return;

  // Marked first, whatever happens below: a failure halfway through must not leave a card
  // that settles itself again on the next render.
  await message.setFlag(SCOPE, CLASH_FLAG, {
    ...clash, sense: { ...clash.sense, applied: true }
  });

  // A tie goes to the Defender, here as everywhere else.
  if (whoWonClash(clash.result) !== "challenger") {
    await settledNote(message, `${sensor.name} cannot get a fix on ${target.name}.`);
    return;
  }

  await settledNote(message,
    `${sensor.name} gets a read on ${target.name} - what they sense is theirs.`);
  await settledNote(message, senseReading(target), { to: sensor });
}

/**
 * The two things a won Sense tells you, in the order the entry names them.
 *
 * The Stacks are read off the target's own Resource, which is what "how many stacks of
 * Holding Back they possess" means - and none is an answer worth having, since the whole
 * point of the Maneuver is telling the difference.
 *
 * The Transformation is asked rather than answered. There are no Transformations in this
 * system: nothing records which one a character is in and no entry gives one a Tier of
 * Power Requirement to be the highest of. Guessing from the Tier of Power would be
 * guessing - that is the number a Transformation raises, not a record of being in one.
 */
function senseReading(target) {
  const stacks = Number(target.system.resources?.holdingback?.stacks) || 0;
  const held = stacks
    ? `${target.name} is holding back ${stacks} Stack${stacks === 1 ? "" : "s"}`
    : `${target.name} is holding nothing back`;

  return `${held}. Whether they are in their Transformation with the highest Tier of `
    + "Power Requirement is the table's to answer - this system has no Transformations "
    + "in it yet.";
}

/**
 * What a settled Magic Trick leaves, which depends on which trick was chosen and on
 * whether it landed.
 *
 * Winning: the first effect leaves the target Impaired "until the start of your next turn"
 * - your turn, so that clock is kept by you and the Condition sits on them. The second
 * moves them a number of Squares, which is said and not done like every Square here.
 *
 * Losing: "if you fail the initial Clash, this triggers the Exploit Maneuver from the
 * target." One person and only on a loss, which is why it is handed out here rather than
 * by the door that offers every other Exploitable line when a card is posted.
 */
async function settleMagicTrick(message, clash) {
  const caster = fromUuidSync(clash.challengerUuid);
  const target = fromUuidSync(clash.defenderUuid);
  if (!caster || !target) return;

  // Marked first, whatever happens below: a failure halfway through must not leave a card
  // that settles itself again on the next render.
  await message.setFlag(SCOPE, CLASH_FLAG, {
    ...clash, magicTrick: { ...clash.magicTrick, applied: true }
  });

  // A tie goes to the Defender, here as everywhere - and a tie is a failure, which is what
  // hands them the opening.
  if (whoWonClash(clash.result) !== "challenger") {
    await settledNote(message, `${target.name} shrugs it off.`);
    offerExploitTo(message, target, caster, `${clash.maneuverName} - the Clash was lost`);
    return;
  }

  if (clash.magicTrick.option === "impair") {
    const { setCondition } = await import("./conditions.mjs");
    await setCondition(target, "impaired", 1);
    await lasting(caster, {
      kind: KINDS.CONDITION,
      key: "impaired",
      edge: EDGES.START,
      next: true,
      on: target.uuid,
      source: clash.maneuverName
    });

    await settledNote(message,
      `${target.name} is Impaired until the start of ${caster.name}'s next turn.`);
    return;
  }

  // "Move that target by a number of Squares equal to your number of Skill Ranks in the Use
  // Magic Skill." Read now rather than when the card was opened, so it is the Ranks they
  // have when it lands.
  const squares = casterSquares(caster, clash);
  await settledNote(message,
    `${caster.name} moves ${target.name} ${squares} Square${squares === 1 ? "" : "s"} - `
    + `${caster.name}'s Use Magic Ranks. Where to is ${caster.name}'s to say.`);
}

/** How far a Magic Trick moves somebody: the caster's Ranks in the Skill it is made with. */
function casterSquares(caster, clash) {
  const ranks = caster.system.skills?.[clash.skill]?.ranks ?? 0;
  return Math.max(0, ranks);
}

/**
 * Hand one character the Exploit Maneuver, where a rule names who gets it.
 *
 * `offerExploits` sweeps everybody in reach, which is what "all adjacent Opponents" wants.
 * A line that names one person - "this triggers the Exploit Maneuver from the target" -
 * wants this instead.
 */
function offerExploitTo(message, who, against, reason) {
  if (!who || !against) return;
  if (!who.items?.some(item => (item.type === "maneuver") && item.system.exploit)) return;

  requestEdit(message, {
    type: "offer",
    offer: {
      actorUuid: who.uuid,
      actorName: who.name,
      maneuverId: "exploit",
      maneuverName: "Exploit",
      targetUuid: against.uuid,
      reason,
      provokedBy: {
        maneuverId: "magic-trick",
        maneuverName: message.getFlag(SCOPE, CLASH_FLAG)?.maneuverName ?? "",
        messageId: message.id
      }
    }
  });
}

/**
 * What a won Internal Attack leaves: two marks, and an Initiative written down.
 *
 * "Remove yourself from the Combat Encounter (record your Initiative)." The Initiative
 * Order is the ARC's to change and this system does not add or remove combatants, so what
 * happens here is the record and the state - the card says what the Order said, and
 * whoever runs the tracker does the rest.
 *
 * The state is the pair: the attacker is inside somebody, and the target is Internalized.
 * That pair is what "while you are not a member of the Combat Encounter" comes to, and it
 * is what carries the penalty - which lives in the mark's own file.
 */
async function settleInternalAttack(message, clash) {
  const attacker = fromUuidSync(clash.challengerUuid);
  const target = fromUuidSync(clash.defenderUuid);
  if (!attacker || !target) return;

  // Marked first, whatever happens below: a failure halfway through must not leave a card
  // that settles itself again on the next render.
  await message.setFlag(SCOPE, CLASH_FLAG, {
    ...clash, internalAttack: { ...clash.internalAttack, applied: true }
  });

  // A tie goes to the Defender, here as everywhere.
  if (whoWonClash(clash.result) !== "challenger") {
    await settledNote(message, `${target.name} keeps ${attacker.name} out.`);
    return;
  }

  // What the Order said, read now because it is about to stop being true. Blank outside an
  // Encounter, where there is no Order to record and nothing to re-enter.
  const initiative = String(
    game.combat?.combatants?.find(entry => entry.actor?.uuid === attacker.uuid)?.initiative ?? "");

  const { setCondition } = await import("./conditions.mjs");
  await setCondition(target, "internalized", 1);

  await requestActorUpdate(attacker, {
    "system.inside": {
      targetUuid: target.uuid,
      targetName: target.name,
      initiative,
      messageId: message.id
    }
  });

  await requestEdit(message, {
    type: "clash",
    clash: {
      ...clash,
      internalAttack: { ...clash.internalAttack, applied: true, inside: true }
    }
  });

  await settledNote(message,
    `${attacker.name} is inside ${target.name}${initiative ? ` at Initiative ${initiative}` : ""}. `
    + `Take ${attacker.name} out of the Initiative Order; ${target.name} loses 2(T) of Soak `
    + "Value and Defense Value until they come back out.");
}

/**
 * Coming back out, which is an Instant Maneuver of its own.
 *
 * "As an Instant Maneuver... you can appear on a Square adjacent to the target, re-enter
 * the Combat Encounter (using your recorded Initiative), and reduce their Life Points by
 * 2x your Might."
 *
 * The Might is read now rather than when they went in: "your Might" is present tense, and
 * a Power Up while they were in there is theirs.
 *
 * A Life Point reduction, which in these rules is straight off the Life Points past the
 * Soak Value and the Damage Reduction - the same thing a collision is, through the same
 * function. Which is also why the Soak penalty being gone by then does not matter: nothing
 * about this goes through Soak.
 */
async function burstOut(message, clash) {
  const attacker = fromUuidSync(clash.challengerUuid);
  const target = fromUuidSync(clash.defenderUuid);
  if (!attacker || !target || !clash.internalAttack?.inside) return;

  // An Instant, so the Instant rule applies to it like any other.
  const held = whyNotAnotherInstant(attacker);
  if (held) {
    ui.notifications.warn(held);
    return;
  }

  const initiative = attacker.system.inside?.initiative ?? "";

  await requestEdit(message, {
    type: "clash",
    clash: { ...clash, internalAttack: { ...clash.internalAttack, inside: false } }
  });

  const { setCondition } = await import("./conditions.mjs");
  await setCondition(target, "internalized", 0);
  await requestActorUpdate(attacker, {
    "system.inside": { targetUuid: "", targetName: "", initiative: "", messageId: "" }
  });

  // Played as an Instant, so it releases whoever was held by one and holds them in turn.
  await recordManeuverType(attacker, "instant", { messageId: message.id });

  await reduceLifePoints(target, 2 * (attacker.system.might ?? 0),
    { reason: `Internal Attack - twice ${attacker.name}'s Might` });

  await settledNote(message,
    `${attacker.name} bursts out beside ${target.name}`
    + `${initiative ? `, back in the Order at Initiative ${initiative}` : ""}. `
    + `Put them on a Square adjacent to ${target.name}.`);
}

/**
 * What a won Insult leaves on the Opponent it was aimed at.
 *
 * "The target suffers from the Impaired Combat Condition and gains the Compelled Combat
 * Condition against you until the end of your next turn." Two Conditions, and only one of
 * them is timed: the clause at the end belongs to the Compelled, which is the half it also
 * gives a subject to. Impaired is stated flat, and a Combat Condition with no duration on
 * it stays until something takes it off.
 *
 * "Until the end of YOUR next turn" is the insulter's turn, so that clock is kept by them
 * and the Condition sits on the target - the split Analysis and Dirty Trick already use.
 *
 * "Against you" is said and not tracked: Compelled's own Slot has said since it was
 * written that who you were told to attack is the table's to keep, so what this can give
 * them is the sentence with the name in it.
 */
async function settleInsult(message, clash) {
  const insulter = fromUuidSync(clash.challengerUuid);
  const target = fromUuidSync(clash.defenderUuid);
  if (!insulter || !target) return;

  // Marked first, whatever happens below: a failure halfway through must not leave a card
  // that settles itself again on the next render.
  await message.setFlag(SCOPE, CLASH_FLAG, {
    ...clash, insult: { ...clash.insult, applied: true }
  });

  // A tie goes to the Defender, here as everywhere else.
  if (whoWonClash(clash.result) !== "challenger") {
    await settledNote(message, `${target.name} does not rise to it.`);
    return;
  }

  const { setCondition } = await import("./conditions.mjs");
  await setCondition(target, "impaired", 1);
  await setCondition(target, "compelled", 1);

  await lasting(insulter, {
    kind: KINDS.CONDITION,
    key: "compelled",
    edge: EDGES.END,
    next: true,
    on: target.uuid,
    source: "Insult"
  });

  await settledNote(message,
    `${target.name} is Impaired, and Compelled against ${insulter.name} until the end of `
    + `${insulter.name}'s next turn. The Impaired stays until something takes it off.`);
}

/**
 * What a won Feint hands over: a Basic Attack, out of sequence, with strings attached.
 *
 * "If you win, you may use the Basic Attack Maneuver as an Out-of-Sequence Maneuver" is
 * the Exploit Maneuver's sentence, so it reaches the same door - an offer on the card,
 * taken by the player, waiving the Action Cost and nothing else.
 *
 * The four conditions travel on the offer. They have to: the attack is declared on the
 * player's own client minutes later, and by then the Clash card is the only thing that
 * still knows a Feint bought it.
 */
async function settleFeint(message, clash) {
  const feinter = fromUuidSync(clash.challengerUuid);
  const target = fromUuidSync(clash.defenderUuid);
  if (!feinter || !target) return;

  // Marked first, whatever happens below: a failure halfway through must not leave a card
  // that settles itself again on the next render.
  await message.setFlag(SCOPE, CLASH_FLAG, {
    ...clash, feint: { ...clash.feint, applied: true }
  });

  // A tie goes to the Defender, here as everywhere: a feint has to be sold outright.
  if (whoWonClash(clash.result) !== "challenger") {
    await settledNote(message, `${target.name} is not taken in.`);
    return;
  }

  requestEdit(message, {
    type: "offer",
    offer: {
      actorUuid: feinter.uuid,
      actorName: feinter.name,
      // Named rather than swept for, as Cross Counter names the Basic Attack it gives away.
      maneuverId: "basic-attack",
      maneuverName: "Basic Attack",
      targetUuid: target.uuid,
      reason: "Feint - they bought it",
      grants: feintGrants(feinter)
    }
  });
}

/**
 * The conditions a Feint attaches to the attack it bought.
 *
 * Two for and two against, and the two against are worked out here rather than at the
 * picker: "1/4 of your MAXIMUM Capacity" is a number about the character who feinted, and
 * the client declaring the attack is theirs but the moment is not - the cap belongs to the
 * Feint, so it is settled when the Feint is won.
 *
 * Rounded up, which is unusual in these rules and is what the entry says.
 */
function feintGrants(feinter) {
  return {
    // Shaped like a Modifier Maneuver, because that is what the list on an attack holds:
    // a named thing that changed it, with a row of its own on the breakdown.
    modifiers: [{
      id: "feint",
      name: "Feint",
      damageCategoryShift: 0,
      strikePerTier: 1,
      woundPerTier: 1,
      note: ""
    }],
    // "Cannot use any option of the Defend Maneuver in response to this Attacking Maneuver
    // except Cross Counter."
    defencesAllowed: ["crossCounter"],
    noArea: true,
    wagerCap: Math.ceil((feinter.system.capacity.max ?? 0) / 4)
  };
}

/**
 * The three things a Dirty Trick can turn out to have been.
 *
 * A table rather than three branches, because what differs between them is small and
 * particular: which Condition, whose turn counts it, whether being hit ends it early, and
 * whether it has a limit of its own.
 */
const TRICKS = Object.freeze({
  sand: {
    label: "Pocket Sand",
    condition: "blinded",
    tip: "They are Blinded until the end of your turn."
  },
  look: {
    label: "Made ya look!",
    condition: "guard-down",
    // "Or until they are hit by an Attacking Maneuver (whichever comes first)."
    until: "being-hit",
    tip: "They are Guard Down until the end of your turn, or until they are hit by an "
       + "Attacking Maneuver - whichever comes first."
  },
  tragedy: {
    label: "It's Such a Tragedy!",
    condition: "compelled",
    // "Until the end of THEIR turn", where the other two are yours. So this clock is the
    // target's own and the other two are kept by whoever played the trick.
    theirClock: true,
    once: "encounter",
    tip: "They are Compelled against a target of your choice until the end of their turn. "
       + "On your Critical or their Botch they must also Transform or Power Up next turn. "
       + "Once a Combat Encounter."
  }
});

/**
 * What a settled Dirty Trick leaves behind: a choice, or nothing at all.
 *
 * A tie goes to the Defender here as everywhere else - cheating has to be done outright.
 */
async function settleDirtyTrick(message, clash) {
  const tricker = fromUuidSync(clash.challengerUuid);
  const target = fromUuidSync(clash.defenderUuid);
  if (!tricker || !target) return;

  // Marked first, whatever happens below: a failure halfway through must not leave a card
  // that settles itself again on the next render.
  await message.setFlag(SCOPE, CLASH_FLAG, {
    ...clash, dirtyTrick: { ...clash.dirtyTrick, applied: true }
  });

  if (whoWonClash(clash.result) !== "challenger") {
    await settledNote(message, `${target.name} sees through it.`);
    return;
  }

  await settledNote(message, `${tricker.name} wins, and chooses what the trick was.`);
}

/**
 * Whether the Clash went the way the third effect's rider asks for.
 *
 * "If you scored a Critical Result or your target scored a Botch Result in your Clash."
 * Either one, and read off the Clash that was actually rolled rather than worked out
 * again - a Karmic Effect that changed the outcome changed this with it.
 */
function forcedToPower(clash) {
  return (clash.result?.challenger?.outcome === "critical")
    || (clash.result?.defender?.outcome === "botch");
}

/**
 * "Apply one of the following effects." Taken on the card, by whoever won it.
 *
 * The Condition goes on the target and the clock goes wherever the entry says: two of
 * these are counted by the trickster's turn and one by the target's.
 */
async function chooseDirtyTrick(message, clash, choice) {
  if (clash.dirtyTrick?.chosen) return;

  const trick = TRICKS[choice];
  const tricker = fromUuidSync(clash.challengerUuid);
  const target = fromUuidSync(clash.defenderUuid);
  if (!trick || !tricker || !target) return;

  const maneuver = getManeuver("dirty-trick");
  if (trick.once && maneuver
    && !effectUsesLeft(tricker, maneuver, choice, { per: trick.once })) {
    ui.notifications.warn(
      `${tricker.name} has already used ${trick.label} this Combat Encounter.`);
    return;
  }

  // "Against a target of your choice", read on the client that is choosing and said on the
  // card. Not tracked: Compelled's own Slot has said since it was written that who you
  // were told to attack is the table's to keep, and this is what gives them the sentence.
  const against = trick.theirClock ? (game.user.targets.first()?.actor ?? null) : null;

  const { setCondition } = await import("./conditions.mjs");
  await setCondition(target, trick.condition, 1);

  await lasting(trick.theirClock ? target : tricker, {
    kind: KINDS.CONDITION,
    key: trick.condition,
    edge: EDGES.END,
    // Whose turn the entry named. A clock the trickster keeps is about somebody else, and
    // says so; the target's own clock is about the target and needs no `on`.
    ...(trick.theirClock ? {} : { on: target.uuid }),
    ...(trick.until ? { until: trick.until } : {}),
    source: "Dirty Trick"
  });

  if (trick.once && maneuver) {
    await recordEffectUse(tricker, maneuver, choice, { per: trick.once });
  }

  await requestEdit(message, {
    type: "clash",
    clash: { ...clash, dirtyTrick: { ...clash.dirtyTrick, chosen: choice } }
  });

  await settledNote(message, trickNote(trick, tricker, target, against, clash));
}

/**
 * What the trick came to, said at the table.
 *
 * The rider is said rather than enforced, and could not be enforced anyway: there is no
 * Transformation Maneuver in this system, so half of the choice it demands does not exist
 * to be offered.
 */
function trickNote(trick, tricker, target, against, clash) {
  if (trick.condition === "blinded") {
    return `${target.name} is Blinded until the end of ${tricker.name}'s turn.`;
  }

  if (trick.condition === "guard-down") {
    return `${target.name} is Guard Down until the end of ${tricker.name}'s turn, or until `
      + "they are hit by an Attacking Maneuver - whichever comes first.";
  }

  const whom = against ? against.name : `a target of ${tricker.name}'s choice`;
  const note = `${target.name} is Compelled against ${whom} until the end of `
    + `${target.name}'s turn.`;

  return forcedToPower(clash)
    ? `${note} ${target.name} must also use the Transformation Maneuver or the Power Up `
      + "Maneuver during their next turn."
    : note;
}

/**
 * What a settled Blockade leaves behind.
 *
 * Winning stops the Movement where it is: the Squares already crossed stand, the Actions
 * and the Ki come back, and the Character cannot use the Movement Maneuver again this
 * turn. Losing hands them an opening - "you trigger their Exploit Maneuver" - and their
 * Movement goes on.
 *
 * A tie goes to the Defender here as everywhere, and the Defender is the one who moved:
 * standing in somebody's way has to be done outright.
 */
async function settleBlockade(message, clash) {
  const blocker = fromUuidSync(clash.challengerUuid);
  const mover = fromUuidSync(clash.defenderUuid);
  if (!blocker || !mover) return;

  // Marked first, whatever happens below: a failure halfway through must not leave a
  // card that settles itself again on the next render.
  await message.setFlag(SCOPE, CLASH_FLAG, {
    ...clash, blockade: { ...clash.blockade, applied: true }
  });

  const moved = game.messages.get(clash.blockade.messageId);
  const movement = movementOnCard(moved);

  if (whoWonClash(clash.result) !== "challenger") {
    // "That Character may continue to use their Movement Maneuver and you trigger their
    // Exploit Maneuver." Theirs alone, and aimed at whoever stepped in the way.
    await settledNote(message,
      `${mover.name} goes through, and ${blocker.name} has given them an opening.`);

    if (mover.items.some(item => (item.type === "maneuver") && item.system.exploit)) {
      requestEdit(message, {
        type: "offer",
        offer: {
          actorUuid: mover.uuid,
          actorName: mover.name,
          maneuverId: "exploit",
          maneuverName: "Exploit",
          targetUuid: blocker.uuid,
          reason: "Blockade - they stepped into your path and lost the Clash"
        }
      });
    }
    return;
  }

  // "You may immediately move to any Square within your Normal Speed that is adjacent to
  // that Character." How far is a rule and the card says it; where is the table's.
  const speed = movementSquares(blocker, "normal");

  // One Movement is stopped once, however many people were standing in the way.
  if (moved && movement) {
    await moved.setFlag(SCOPE, MOVEMENT_FLAG, { ...movement, stopped: true });
  }

  // "They regain any Actions or Ki Points spent." What this Movement cost them, which
  // the card kept because by now there is nothing on the character that says.
  const spent = movement?.spent ?? { actions: 0, kind: "standard", ki: 0 };
  if (spent.actions > 0) await refundActions(mover, spent.actions, spent.kind || "standard");
  if (spent.ki > 0) {
    await refundManeuverCost(mover, { name: "Movement", kiCost: spent.ki });
  }

  // "Cannot use the Movement Maneuver for the remainder of their Turn." Held as a
  // Resource with a clock of their own turn's end, and read by a passive in the Movement
  // Maneuver's file - which is the only one that runs on the character it binds.
  await setResource(mover, "blockaded", 1);
  await lasting(mover, {
    kind: KINDS.RESOURCE, key: "blockaded", edge: EDGES.END, source: "Blockade"
  });

  const givenBack = [
    spent.actions > 0 ? `${spent.actions} Action${spent.actions === 1 ? "" : "s"}` : "",
    spent.ki > 0 ? `${spent.ki} Ki Points` : ""
  ].filter(Boolean).join(" and ");

  await settledNote(message,
    `${mover.name} is stopped${givenBack ? `, and gets back ${givenBack}` : ""}. They `
    + "cannot use the Movement Maneuver again this turn. "
    + `${blocker.name} may step to any Square within ${speed} - their Normal Speed - that `
    + `is adjacent to ${mover.name}.`);
}

/**
 * Put a Resource on a character from outside the effects engine.
 *
 * Everything else that writes one is a Slot settled in a Moment, and this is not: the
 * Blockade's Resource is handed out by a Clash landing, which no Moment describes. Capped
 * at what the library declares, like every other write to the bag.
 */
export async function setResource(actor, name, stacks) {
  const { replaceObject } = await import("./conditions.mjs");
  const { resourceLimits } = await import("./effects/traits.mjs");

  const held = { ...(actor.system.resources ?? {}) };
  const max = resourceLimits(actor)[name] ?? 0;
  const capped = Math.max(0, max ? Math.min(stacks, max) : stacks);

  if (capped > 0) held[name] = { stacks: capped, max };
  else delete held[name];

  return actor.update({ "system.resources": replaceObject(held) });
}

/**
 * What a settled Thrust Clash leaves behind.
 *
 * Two stages, and which it is was decided when the card was opened. The first is the
 * Maneuver's own Clash: winning it buys the choice between the two effects, and the
 * entry says nothing whatever about losing it - so losing does nothing, which is said
 * plainly rather than left as a card with no answer on it.
 *
 * The second is Knock Prone's: "if you win, they are knocked Prone. If you lose, they
 * suffer from the Guard Down Combat Condition until the end of your turn." Both halves
 * land on the target - you have already won the first Clash, and this one decides only
 * how much good it did.
 */
async function settleThrust(message, clash) {
  const thruster = fromUuidSync(clash.challengerUuid);
  const target = fromUuidSync(clash.defenderUuid);
  if (!thruster || !target) return;

  // Marked first, whatever happens below: a failure halfway through must not leave a
  // card that settles itself again on the next render.
  await message.setFlag(SCOPE, CLASH_FLAG, {
    ...clash, thrust: { ...clash.thrust, applied: true }
  });

  const winner = whoWonClash(clash.result);

  if (clash.thrust.stage === "prone") {
    const { setCondition } = await import("./conditions.mjs");

    if (winner === "challenger") {
      await setCondition(target, "prone", 1);
      await settledNote(message, `${target.name} is knocked Prone.`);
      return;
    }

    // "Until the end of your turn" - the Thruster's turn, not the target's. So the clock
    // is kept by the Thruster and the Condition sits on the target, which is what a
    // duration `on` somebody else is for.
    await setCondition(target, "guard-down", 1);
    await lasting(thruster, {
      kind: KINDS.CONDITION,
      key: "guard-down",
      edge: EDGES.END,
      on: target.uuid,
      source: "Thrust"
    });
    await settledNote(message,
      `${thruster.name} does not put ${target.name} down, but leaves them Guard Down `
      + `until the end of ${thruster.name}'s turn.`);
    return;
  }

  // The Maneuver's own Clash. A tie goes to the Defender, here as everywhere.
  if (winner !== "challenger") {
    await settledNote(message, `${target.name} holds their ground.`);
    return;
  }

  await settledNote(message,
    `${thruster.name} wins, and chooses what it buys.`);
}

/**
 * "Choose one of the effects below to apply." Taken on the card, by whoever won it.
 *
 * Push Back is the whole effect: how far and which way is said, the moving is the
 * player's, and what they hit is the collision - which this arms at double, since
 * "double any Collision Damage they suffer due to this movement".
 *
 * Knock Prone is a second Clash, and lands either way.
 */
async function chooseThrust(message, clash, choice) {
  if (clash.thrust?.chosen) return;

  const thruster = fromUuidSync(clash.challengerUuid);
  const target = fromUuidSync(clash.defenderUuid);
  if (!thruster || !target) return;

  if (choice === "push") {
    // "A number of Squares equal to 1/2 of your Might", read now rather than when the
    // card was opened, so it is the Might they had when they shoved.
    const squares = Math.floor(Math.max(0, thruster.system.might ?? 0) / 2);

    await requestEdit(message, {
      type: "clash",
      clash: {
        ...clash,
        thrust: { ...clash.thrust, chosen: "push" },
        collision: { doubles: true, doubledBy: "Push Back" }
      }
    });

    await settledNote(message,
      `${target.name} is pushed back ${squares} Square${squares === 1 ? "" : "s"}, in a `
      + `straight line away from ${thruster.name}. Any Collision Damage is doubled.`);
    return;
  }

  await requestEdit(message, {
    type: "clash",
    clash: { ...clash, thrust: { ...clash.thrust, chosen: "prone" } }
  });

  // "Make a second Clash (Impulsive/Corporeal)." Both Saving Throws are offered to both
  // sides - see the Maneuver's file for why that reading, and for the other one.
  await postSaveClash(thruster, target, {
    maneuverName: "Thrust",
    clashLabel: "Knock Prone",
    reason: `${thruster.name} tries to put ${target.name} on the ground. Win and they `
      + `are Prone; lose and they are Guard Down until the end of ${thruster.name}'s turn.`,
    saves: ["impulsive", "corporeal"],
    thrust: { stage: "prone", applied: false, chosen: "" }
  });
}

/**
 * Open a Clash of Saving Throws.
 *
 * `saves` is which ones the rule named. More than one means each side picks from that
 * list, which is how "(Impulsive/Corporeal)" is read - the slash is the same slash as in
 * "Strike/Dodge", which is a choice.
 */
export async function postSaveClash(actor, target, {
  maneuverName, clashLabel = "", reason = "", saves = ["impulsive"], defenderSaves = [],
  ...leaves
} = {}) {
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: "",
    flags: {
      [SCOPE]: {
        // Not a Maneuver of its own: it arrives out of one that has already been used,
        // so there is nothing here for an Instant to answer.
        [RESPONDABLE_FLAG]: false,
        [CLASH_FLAG]: {
          category: "save",
          clashLabel: clashLabel || "Saving Throw Clash",
          maneuverName,
          reason,
          saves,
          // What the other side may answer with, where the rule named something different
          // for them. Empty is every Clash that named one list for both.
          defenderSaves,
          // Which each side answered with. Unset until they say, and they are asked
          // before either has seen a number.
          challengerSave: "",
          defenderSave: "",
          // What settling this Clash leaves behind, whatever it is called - `thrust`,
          // `blockade`, `insult`. Carried whole rather than named one at a time, because
          // naming them one at a time is how the Blockade's went missing: it was passed by
          // the Maneuver, taken by nobody here, and `applyClash` waited for a key that
          // never arrived. Winning a Blockade stopped no Movement for as long as that
          // lasted.
          ...leaves,
          challengerUuid: actor.uuid,
          challengerName: actor.name,
          defenderUuid: target.uuid,
          defenderName: target.name,
          ready: [],
          result: null
        }
      }
    }
  });
}

/**
 * What a settled Grapple Check leaves behind.
 *
 * Two shapes, and which it is was decided when the card was opened. Starting one: the
 * Initiator has to win, and losing "provokes the Exploit Maneuver from your target" -
 * which is why the Exploitable line is not on the Maneuver itself, since that would hand
 * an Exploit to every adjacent Opponent every time anybody grabbed anybody.
 *
 * Escaping one: the Grappled has to win, and they are the Defender of it however it was
 * opened - "the Grappler is still considered the Initiator and the Grappled is still
 * considered the Defender for any further Grapple Checks made within the Grapple". So a
 * tie frees them, a tie going to the Defender here as everywhere else.
 */
async function settleGrapple(message, clash) {
  const grappler = fromUuidSync(clash.challengerUuid);
  const grappled = fromUuidSync(clash.defenderUuid);
  if (!grappler || !grappled) return;

  // Marked first. Whatever happens below, this Check has been settled, and a failure
  // halfway through must not leave a card that settles itself again on the next render.
  await message.setFlag(SCOPE, CLASH_FLAG, {
    ...clash, grapple: { ...clash.grapple, applied: true }
  });

  const winner = whoWonClash(clash.result);

  // The first of the Pin's two Clashes. "If you win, make a Might Clash against the
  // Grappled. If you lose either of these Clashes, they escape the Grapple."
  if (clash.grapple.kind === "pin") {
    if (winner !== "challenger") {
      await endGrapple(grappler, grappled);
      await settledNote(message,
        `${grappler.name} loses the Grapple Check, and ${grappled.name} escapes.`);
      return;
    }

    await settledNote(message,
      `${grappler.name} wins, and closes for the hold.`);

    // The second Clash, carrying the Grapple so that it settles here too.
    await postMightClash(grappler, grappled, {
      maneuverName: "Pin",
      reason: `${grappler.name} holds ${grappled.name} down. Win and they are Pinned; `
        + "lose and they escape the Grapple.",
      grapple: { kind: "pin-hold", applied: false }
    });
    return;
  }

  // The second. "If you win, they gain the Pinned Combat Condition while in this
  // Grapple" - and losing this one frees them exactly as losing the first would.
  if (clash.grapple.kind === "pin-hold") {
    if (winner !== "challenger") {
      await endGrapple(grappler, grappled);
      await settledNote(message,
        `${grappler.name} loses the Might Clash, and ${grappled.name} escapes.`);
      return;
    }

    const { setCondition } = await import("./conditions.mjs");
    await setCondition(grappled, "pinned", 1);
    await settledNote(message,
      `${grappled.name} is Pinned, for as long as this Grapple lasts.`);
    return;
  }

  if (clash.grapple.kind === "launch") {
    // "If you lose, the Grappled Opponent escapes the Grapple." A tie is a loss here, as
    // it is in every Grapple Check: the Defender takes one, and the Defender is the
    // Grappled however the Check was opened.
    if (winner !== "challenger") {
      await endGrapple(grappler, grappled);
      await settledNote(message,
        `${grappler.name} loses the Grapple Check, and ${grappled.name} escapes.`);
      return;
    }

    // "You may end the Grapple to move that Character." Taken as done rather than
    // offered: using a Maneuver and then being asked whether you meant it is a strange
    // thing to hand somebody, and the throw is what the Maneuver is for.
    //
    // The distance is read now rather than when the Check was opened, so it is the
    // Grappler's Might as it stands when they let go. Where they land is the table's, as
    // every movement here is - and what they land against is the collision the card goes
    // on to offer.
    const squares = Math.max(0, grappler.system.might ?? 0);
    await endGrapple(grappler, grappled);
    await settledNote(message,
      `${grappler.name} throws ${grappled.name} - the Grapple ends, and they move up to `
      + `${squares} Squares in any direction.`);
    return;
  }

  if (clash.grapple.kind === "escape") {
    if (winner !== "defender") {
      await settledNote(message, `${grappled.name} does not break free.`);
      return;
    }
    await endGrapple(grappler, grappled);
    await settledNote(message, `${grappled.name} escapes the Grapple.`);
    return;
  }

  if (winner !== "challenger") {
    // "If you lose, you provoke the Exploit Maneuver from your target." From the target
    // and from nobody else, so this is offered by name rather than swept for.
    await settledNote(message,
      `${grappler.name} loses the Grapple Check and gives ${grappled.name} an opening.`);
    if (grappled.items.some(item => (item.type === "maneuver") && item.system.exploit)) {
      requestEdit(message, {
        type: "offer",
        offer: {
          actorUuid: grappled.uuid,
          actorName: grappled.name,
          maneuverId: "exploit",
          maneuverName: "Exploit",
          targetUuid: grappler.uuid,
          reason: "Grapple - lost the initial Grapple Check"
        }
      });
    }
    return;
  }

  await beginGrapple(grappler, grappled);
  await settledNote(message,
    `${grappler.name} has ${grappled.name} in a Grapple.`);
}

/**
 * A line under the card saying what the Clash came to.
 *
 * `to` keeps it to one character's side - whoever owns them, and every GM. Left off
 * everywhere else on purpose: what a Clash came to is a thing that happened, and somebody
 * knocked Prone is knocked Prone in front of the room.
 *
 * Which is not the reading `hidePrivateBreakdowns` declined. There a roll's workings are
 * held back as a courtesy and the total still reaches the table, because the total is what
 * the table is waiting for. A note kept to one side is for a Maneuver where the sentence
 * itself is what was bought.
 */
async function settledNote(message, text, { to = null } = {}) {
  await ChatMessage.create({
    speaker: message.speaker,
    content: `<div class="dbu-settled-note">${Handlebars.escapeExpression(text)}</div>`,
    ...(to ? { whisper: whisperTo(to) } : {})
  });
}

/**
 * Everybody who may be told something about one character: whoever owns them, and every
 * GM.
 *
 * The GMs unconditionally. A secret the GM cannot see is a secret from the person running
 * the fight, and every other relay in this file goes through them.
 */
function whisperTo(actor) {
  return [...new Set(game.users
    .filter(user => user.isGM || actor.testUserPermission(user, "OWNER"))
    .map(user => user.id))];
}

/**
 * Put two characters in a Grapple, with the roles that do not swap afterwards.
 *
 * "While in a Grapple, all Characters suffer from the Guard Down Combat Condition and
 * cannot remove it while in the Grapple." Applied here; what stops it coming off is in
 * conditions.mjs, where every other refusal to change a Condition lives.
 */
async function beginGrapple(grappler, grappled) {
  const { setCondition } = await import("./conditions.mjs");

  await requestActorUpdate(grappler, {
    "system.grapple.partner": grappled.uuid,
    "system.grapple.role": "grappler"
  });
  await requestActorUpdate(grappled, {
    "system.grapple.partner": grappler.uuid,
    "system.grapple.role": "grappled"
  });

  for (const actor of [grappler, grappled]) await setCondition(actor, "guard-down", 1);
}

/**
 * Let go. Both sides, because a Grapple is a pair and half of one is nothing.
 *
 * The Guard Down comes off with it. It was the Grapple that put it there and the Grapple
 * that held it, so ending the Grapple ends both - a character who was already Guard Down
 * for a reason of their own is the case this gets wrong, and the sheet is one click away.
 */
export async function endGrapple(grappler, grappled) {
  const { setCondition } = await import("./conditions.mjs");
  const { NOT_GRAPPLING } = await import("./combat.mjs");

  for (const actor of [grappler, grappled]) {
    if (!actor) continue;
    await requestActorUpdate(actor, { ...NOT_GRAPPLING });
  }
  // After they are out of it, or the refusal that holds it in place refuses this too.
  for (const actor of [grappler, grappled]) {
    if (actor) await setCondition(actor, "guard-down", 0);
  }

  // "They gain the Pinned Combat Condition while in this Grapple." Tied to the hold
  // rather than to a clock, so it goes wherever a Grapple ends - escaped, let go, thrown,
  // or the Encounter over. Taken off both, since only one of them can have it and asking
  // which is a question with no better answer than doing it twice.
  for (const actor of [grappler, grappled]) {
    if (actor) await setCondition(actor, "pinned", 0);
  }
}

/**
 * Apply an edit directly when we may, and ask the GM to when we may not.
 *
 * A ChatMessage can only be edited by whoever posted it - unlike an Actor, it carries
 * no ownership that could be handed to anyone else. So a defender recording their own
 * roll on the attacker's message has to go through the GM's client, which applies it
 * for them. This asks the question that decides that, rather than canUserModify, which
 * answers it too generously and leaves the update to be refused by the server.
 */
function requestEdit(message, request) {
  const payload = { ...request, messageId: message.id };

  // Surfaced rather than left to an unhandled rejection: a failure here stops the
  // exchange dead, and the card simply never changes.
  if (message.isAuthor || game.user.isGM) {
    return Promise.resolve(applyRequest(payload)).catch(error => {
      console.error("DBU TTRPG | Could not apply an edit", payload, error);
      ui.notifications.error("DBU TTRPG | An edit failed. See the console.");
    });
  }

  if (!game.users.activeGM) {
    ui.notifications.warn("A GM must be connected for this to be recorded on the maneuver.");
    return;
  }

  game.socket.emit(CHANNEL, payload);
}

export function registerChatHooks() {
  Hooks.on("renderChatMessageHTML", onRenderChatMessage);
}

/**
 * The highest Natural Result that is a Botch on this kind of roll.
 *
 * Two ranges, because Vile Weather widens one and not the other: "you score a Botch
 * Result for a Combat Roll on a Natural Result of 2(WT) or lower" says Combat Roll, and a
 * Skill Check made in the poison is no likelier to go wrong than one made in clean air.
 */
function botchRangeFor(actor, combatRoll) {
  return combatRoll
    ? (actor.system.botchRangeCombat ?? actor.system.botchRange ?? 1)
    : (actor.system.botchRange ?? 1);
}

/**
 * Roll the Base Die plus a bonus and classify the result, without deciding what to
 * do about it. Callers apply their own policy: a lone check offers the critical die
 * as a button, while a Skill Clash has to settle both sides at once.
 */
/**
 * What a Skill's Checks do to their Natural Result: its own move, and the one that only
 * applies relying on sight where the Check does.
 */
export function skillNatural(actor, key, bySight = false) {
  const skill = actor?.system?.skills?.[key];
  if (!skill) return 0;
  return (skill.natural ?? 0) + (bySight ? (skill.naturalSight ?? 0) : 0);
}

export async function evaluateCheck(actor, bonus, extraDice = "", baseDie = null,
                                    { minimumNatural = 0, criticalTarget = null,
                                      combatRoll = false, naturalAdd = 0 } = {}) {
  // The whole `baseDie` Slot, not only its `set`. Only `set` was ever read, so an
  // effect *adjusting* the Natural Result - which is what Impaired does, and the only
  // way anything reaches the Botch Range that a penalty to the roll cannot - was
  // collected, carried here, and dropped.
  const forcedNatural = (typeof baseDie === "number") ? baseDie : (baseDie?.set ?? null);

  // With the Base Die set by an effect it is not rolled at all: it is stated. Rolling
  // one and discarding it left a die on the card that meant nothing. Every other die
  // still rolls - the Tier of Power Extra Dice and the critical die among them.
  const base = (forcedNatural === null) ? DBUCharacterData.BASE_DIE : String(forcedNatural);

  // The Base Die stays first, since the critical and botch rules read its natural
  // result - Extra Dice never decide either.
  const formula = [base, extraDice, "@bonus"].filter(Boolean).join(" + ");
  const roll = new Roll(formula, { bonus });
  await roll.evaluate();

  const rolled = (forcedNatural === null) ? roll.dice[0]?.total : forcedNatural;

  // Adjusted the way every other value is, which settles what a `set` and an adjustment
  // do together without a rule of its own: adds land, then a `set` overrides them. An
  // effect that states the Natural Result outright states it.
  //
  // `naturalAdd` is the same thing arriving from the sheet rather than from a Moment - a
  // Skill's own Natural Result, which the Eyeglasses move. Added to the die before a
  // `set` is read, so a stated Natural Result still states it.
  const adjusted = (typeof baseDie === "object" && baseDie)
    ? Math.max(0, applySlot({ baseDie }, "baseDie", rolled + naturalAdd))
    : Math.max(0, rolled + naturalAdd);

  // A floor under the Natural Result, which the Clearing Profile puts at 5: "if your
  // Natural Result is less than 5, it becomes 5. This is applied after rolling and
  // applying any increases to your Natural Result." Last, as it says - after the die and
  // after anything that moved it, so an effect cannot be pushed under the floor by
  // arriving later.
  const natural = Math.max(adjusted, minimumNatural);

  return {
    roll,
    natural,
    // How far the adjustment moved it, so the caller can take the same amount off the
    // total. The Natural Result is part of the total - reducing the die reduces the
    // sum it sits in - and what makes it the *Natural* Result is that Botch and
    // Critical read it too.
    naturalShift: natural - rolled,
    // Two ends of the same line, both read off the Base Die: a Botch is any Natural
    // Result at or below the Botch Range, a Critical any at or above the Critical
    // Target. The Botch Range is held below the Critical Target when it is derived, so
    // the two can never both be true - which used to rest on the Botch always being 1.
    // Which Botch Range this roll is measured against. A Combat Roll may have a wider
    // one than a Skill Check does - Vile Weather gives it one - so the caller says which
    // kind of roll this is rather than being assumed into the harsher of the two.
    botch: natural <= botchRangeFor(actor, combatRoll),
    // The character's own Critical Target unless the roll states one. Cutting states one
    // for its Wound Roll - "the Critical Target is 5 (ignoring the usual limit)" - and
    // that limit is the floor the character's own target is held to, so a stated target
    // goes in as it is written rather than through it.
    critical: natural >= (criticalTarget ?? actor.system.criticalTarget)
  };
}

/**
 * Card for a check whose result needs to stand out. The parts line keeps the working
 * visible; the total is what the player actually reads, so it carries the emphasis.
 */
/**
 * The row that says whether a Check met the Target Number it was rolled against.
 *
 * "You must match or exceed the listed value of the TN" - so this is `>=`, where a Clash
 * is settled by beating the other side outright. The difference is that a Clash has
 * somebody on the other side for a tie to go to and a Target Number is nobody.
 *
 * Both the name and the number, because the table talks in names and the roll is measured
 * against the number - a card saying only "Apprentice" makes the reader look it up, and
 * one saying only "10" makes them work out which Category that was.
 *
 * Returns nothing when there was no Target Number, since almost no Check has one.
 *
 * @param {number} total  what the Check came to
 * @param {?{label: string, tn: number}} against  the Difficulty, or null
 */
export function difficultyLine(total, against) {
  if (!against) return null;
  const met = total >= against.tn;
  return noteLine(`${against.label} ${against.tn} - ${met ? "met" : "not met"}`);
}

export function checkCard({ parts, total, outcome, owner = null, lines = null }) {
  // `owner` marks the line as a breakdown of somebody's roll rather than a statement of
  // what happened. A Karma spend or a Ki Surge names itself and stays public; the dice
  // and bonuses behind a roll belong to whoever made it.
  const attribution = owner ? ` data-owner="${owner}"` : "";

  // The same rows a Clash hover shows, on the same cards the sheet posts. A check is
  // read at a glance and inspected on hover, which is how every other roll works -
  // there is no reason a Perception Check should be the one that reads differently.
  const tip = lines
    ? ` data-tooltip-html="${Handlebars.escapeExpression(breakdownTable(lines, total))}"`
    : "";

  return `
    <div class="dbu-check">
      <div class="dbu-check-parts"${attribution}${tip}>${parts ?? breakdownText(lines ?? [], total)}</div>
      <div class="dbu-check-total dbu-${outcome}">${total}</div>
    </div>`;
}

/**
 * Offer the critical die on any check whose Base Die met the Critical Target. The
 * button is added at render time from a flag rather than baked into the message
 * content, so it disappears everywhere once the die has been rolled.
 */
function onRenderChatMessage(message, html) {
  renderCriticalButton(message, html);
  renderSkillClash(message, html);
  renderAttack(message, html);
  renderMoment(message, html);
  renderInstantResponses(message, html);
  renderOutOfSequence(message, html);
  renderAfterTheFact(message, html);
  renderCurePoison(message, html);
  renderGearHazard(message, html);
  renderGearScan(message, html);
  renderCheckKarma(message, html);
  hidePrivateBreakdowns(message, html);
}

/**
 * Post a scan's card. Settled at once where the one scanned is still hidden from this kind of
 * Item this Encounter: "they automatically succeed on any further Concealment Skill Checks".
 */
export async function postScan(scanner, scanned, item) {
  const { stillHidden } = await import("./gear.mjs");
  const hidden = stillHidden(scanned, item.system.gearId);
  const difficulty = DBUCharacterData.DIFFICULTIES[item.system.scan.difficulty];
  const skill = DBUCharacterData.SKILLS[item.system.scan.skill]?.label ?? item.system.scan.skill;

  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: scanner }),
    content: `<p>${Handlebars.escapeExpression(scanner.name)} scans `
      + `${Handlebars.escapeExpression(scanned.name)} with the `
      + `${Handlebars.escapeExpression(item.name)}.${hidden
        ? ` <em>${Handlebars.escapeExpression(scanned.name)} stays hidden.</em>` : ""}</p>`,
    flags: {
      [SCOPE]: {
        [RESPONDABLE_FLAG]: false,
        [SCAN_FLAG]: {
          scannerUuid: scanner.uuid,
          scannedUuid: scanned.uuid,
          itemName: item.name,
          gearId: item.system.gearId,
          check: difficulty ? `${skill} (${difficulty.label} ${difficulty.tn})` : skill,
          settled: hidden
        }
      }
    }
  });
}

/**
 * The scan card's two answers, for whoever plays the one scanned - and the GM.
 *
 * The Check is rolled from their own sheet, at the Difficulty named, the way the Treatment
 * Maneuver's is; this is where they say how it went. Whether they were aware of the scan -
 * and so whether they could make it - is the table's.
 */
function renderGearScan(message, html) {
  const scan = message.getFlag(SCOPE, SCAN_FLAG);
  if (!scan || scan.settled) return;

  const scanned = fromUuidSync(scan.scannedUuid);
  if (!game.user.isGM && !scanned?.isOwner) return;

  const content = html.querySelector(".message-content") ?? html;
  const hidden = document.createElement("button");
  hidden.type = "button";
  hidden.className = "dbu-clash-button";
  hidden.textContent = "Hidden";
  hidden.dataset.tooltip = `${scan.check} was met. Hidden from it for the rest of the Encounter, `
    + "while the Holding Back stacks do not drop.";
  hidden.addEventListener("click", () => settleScan(message, scan, true));

  const read = document.createElement("button");
  read.type = "button";
  read.className = "dbu-clash-button";
  read.textContent = "Read";
  read.dataset.tooltip = `${scan.check} was not met, or could not be made.`;
  read.addEventListener("click", () => settleScan(message, scan, false));

  content.append(hidden, read);
}

/**
 * Answer a scan: hidden, remembered for the Encounter with the Holding Back stacks held now;
 * or read, told to the scanner alone.
 */
async function settleScan(message, scan, hid) {
  if (scan.settled) return;
  const scanned = fromUuidSync(scan.scannedUuid);
  const scanner = fromUuidSync(scan.scannerUuid);
  if (!scanned || !scanner) return;

  await requestEdit(message, { type: "scan", scan: { ...scan, settled: true } });

  const { hiddenKey, holdingBackStacks, scanReading } = await import("./gear.mjs");
  if (hid) {
    // One entry for this kind of Item, the latest - with the stacks they have now.
    const prefix = `encounter:gear.${scan.gearId}.hidden.`;
    const kept = (scanned.system.usedManeuvers ?? []).filter(used => !used.startsWith(prefix));
    await requestActorUpdate(scanned, {
      "system.usedManeuvers": [...kept, hiddenKey(scan.gearId, holdingBackStacks(scanned))]
    });
    return settledNote(message, `${scanned.name} stays hidden.`);
  }

  // "You become aware" - the scanner, so it is whispered to whoever plays them.
  const { tier, powerLevel } = scanReading(scanned);
  const whisper = game.users.filter(user => user.isGM
    || scanner.testUserPermission(user, "OWNER")).map(user => user.id);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: scanner }),
    whisper,
    content: `<p>${Handlebars.escapeExpression(scan.itemName)}: `
      + `${Handlebars.escapeExpression(scanned.name)} is at Tier of Power <strong>${tier}</strong>`
      + `${(powerLevel !== null) ? `, Power Level <strong>${powerLevel}</strong>` : ""}.</p>`
  });
  return settledNote(message, `${scanned.name} is read.`);
}

/**
 * An Item bursting over an area: its mark on everyone in it, on the thrower's clock, and a
 * line at the table saying so.
 */
export async function burstGear(thrower, item, caught) {
  const mark = item.system.areaMark;
  const edge = (mark.until === "start") ? "start" : "end";
  for (const actor of caught) {
    await markUntilNextTurn(thrower, actor, mark.condition, 1, edge, item.name);
  }

  const escape = Handlebars.escapeExpression;
  const names = caught.map(actor => actor.name);
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: thrower }),
    content: `<p>${escape(thrower.name)} throws the ${escape(item.name)}.${names.length
      ? ` ${escape(listed(names))} ${names.length === 1 ? "is" : "are"} caught in it until the `
        + `${edge} of ${escape(thrower.name)}'s next turn.`
      : ""}</p>`
  });
}

/**
 * A full restore - a Senzu Bean - on whoever eats it.
 *
 * "Removes all Combat Conditions (except Pinned or Suffocating) and you fully regain your
 * Life and Ki Points, up to their maximum." Only Combat Conditions: the marks this system
 * keeps beside them are not, and stay. Full Life is what stands a Defeated character up.
 */
export async function restoreFully(giver, who, item) {
  const { allConditions, setCondition } = await import("./conditions.mjs");
  const { conditionsRestored } = await import("./gear.mjs");
  const cleared = conditionsRestored(who.system.conditions, allConditions(),
    item.system.restore.keeps ?? []);
  for (const key of cleared) await setCondition(who, key, 0);

  await requestActorUpdate(who, {
    "system.life.value": who.system.life.max,
    "system.ki.value": who.system.ki.max
  });

  const escape = Handlebars.escapeExpression;
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: giver }),
    content: `<p>${(giver.uuid === who.uuid)
      ? `${escape(who.name)} eats a Senzu Bean`
      : `${escape(giver.name)} feeds ${escape(who.name)} a Senzu Bean`} from the `
      + `${escape(item.name)}: Life and Ki full${cleared.length
        ? `, and no longer ${escape(listed(cleared.map(key => getTrait(key)?.name ?? key)))}`
        : ""}.</p>`
  });
}

/** Post the card an Item scattered across the ground leaves behind. */
export async function postGearHazard(actor, item) {
  const hazard = item.system.hazard;
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p>${Handlebars.escapeExpression(actor.name)} scatters `
      + `${Handlebars.escapeExpression(item.name)}.</p>`,
    flags: {
      [SCOPE]: {
        [RESPONDABLE_FLAG]: false,
        [HAZARD_FLAG]: {
          itemName: item.name,
          dice: hazard.dice,
          scale: hazard.scale,
          sparesAirborne: Boolean(hazard.sparesAirborne)
        }
      }
    }
  });
}

/**
 * The button on a scattered Item's card: pressed by whoever moves through it.
 *
 * For the character the reader has selected, or their own if nothing is selected - the one
 * who moved is the reader's to say, since nothing here knows where anybody walked. Drawn for
 * everyone, because anyone can walk into them.
 */
function renderGearHazard(message, html) {
  const hazard = message.getFlag(SCOPE, HAZARD_FLAG);
  if (!hazard?.dice) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "dbu-clash-button";
  button.textContent = `Moved through the ${hazard.itemName}`;
  button.dataset.tooltip = "For your selected token, or your character. Once for one "
    + "movement, however many of its Squares it crossed.";
  button.addEventListener("click", () => {
    const victim = canvas?.tokens?.controlled?.[0]?.actor ?? game.user.character;
    if (!victim?.isOwner) {
      ui.notifications.warn("Select the token of the one who moved through them.");
      return;
    }
    return sufferGearHazard(victim, hazard);
  });

  const content = html.querySelector(".message-content") ?? html;
  content.append(button);
}

/**
 * Whoever moved through it loses the Life Points.
 *
 * Caltrops: "Any Character (except those in a High Environment) who moves through any Square
 * in that AoE has their Life Points reduced by 1d4(bT)." Their base Tier, rolled; a Life
 * Point reduction and not Damage, so past Soak and Damage Reduction.
 */
export async function sufferGearHazard(victim, hazard) {
  if (hazard.sparesAirborne && isAirborne(victim.system)) {
    ui.notifications.info(`${victim.name} is in a High Environment, above the `
      + `${hazard.itemName}.`);
    return 0;
  }

  const { hazardFormula } = await import("./gear.mjs");
  const formula = hazardFormula(hazard, victim);
  if (!formula) return 0;

  const roll = await new Roll(formula).evaluate();
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor: victim }),
    flavor: `${hazard.itemName} - ${hazard.dice}(${hazard.scale})`
  });
  await reduceLifePoints(victim, roll.total, { reason: hazard.itemName });
  return roll.total;
}

/**
 * The button that takes a poison off once the Medicine Check has been made.
 *
 * Drawn for whoever used the Maneuver, and for the GM. Not for whoever is Poisoned: the
 * Check is the treater's and so is the call about whether they made it.
 *
 * Gone once it has been pressed, like every other button here that is drawn from a flag.
 */
function renderCurePoison(message, html) {
  const cure = message.getFlag(SCOPE, CURE_FLAG);
  if (!cure || cure.applied) return;

  // Named on the card rather than worked out from the speaker: `speaker.actor` is an id
  // and not a uuid, and an unlinked token's actor has none at all.
  const treater = fromUuidSync(cure.treaterUuid);
  if (!game.user.isGM && !treater?.isOwner) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "dbu-clash-button";
  button.textContent = "The Check was made - remove the poison";
  const apprentice = DBUCharacterData.DIFFICULTIES.apprentice;
  button.dataset.tooltip = "Roll Medicine from the sheet, picking the "
    + `${apprentice.label} Difficulty in the roll window - Target Number ${apprentice.tn}, `
    + "matched or exceeded. That card says whether it was met; this one takes the poison "
    + "off.";
  button.addEventListener("click", () => curePoison(message, cure));

  (html.querySelector(".message-content") ?? html).append(button);
}

/**
 * Take the poison off, and say so.
 *
 * Marked on the card first, so a second press cannot take a second Condition off somebody
 * who only had the one.
 */
async function curePoison(message, cure) {
  const ally = fromUuidSync(cure.allyUuid);
  if (!ally) return;

  await requestEdit(message, { type: "cure", cure: { ...cure, applied: true } });

  const { setCondition } = await import("./conditions.mjs");
  await setCondition(ally, "poisoned", 0);

  await settledNote(message, `${ally.name} is no longer Poisoned.`);
}

/**
 * Keep a roll's workings to whoever made it.
 *
 * Two things carry it: our own breakdown line, and the dice tooltip Foundry puts on a
 * roll message. Both are held to Observer permission on the character that rolled.
 *
 * This hides them in the rendered card. The text is still in the message document, so
 * this is a courtesy between players rather than a guarantee against someone who goes
 * looking - making it a guarantee would mean whispering every roll, which would take the
 * results away from the table too.
 */
function hidePrivateBreakdowns(message, html) {
  let hidden = false;

  // Our own breakdown line, on the cards we draw ourselves.
  for (const parts of html.querySelectorAll(".dbu-check-parts[data-owner]")) {
    if (maySeeRolls(fromUuidSync(parts.dataset.owner))) continue;
    // Removed rather than replaced with a note. The card keeps its total and its
    // flavour, which is all a reader who cannot see the workings needs from it, and a
    // line explaining what is missing is itself just something else to read past.
    parts.remove();
    hidden = true;
  }

  // Foundry's own expandable dice breakdown, on a plain roll message. Those carry no
  // card of ours, so the flag is what says whose roll it was.
  const check = message.getFlag(SCOPE, CHECK_FLAG);
  if (check?.actorUuid && !maySeeRolls(fromUuidSync(check.actorUuid))) hidden = true;

  if (!hidden) return;
  for (const el of html.querySelectorAll(".dice-tooltip, .dice-formula")) el.remove();
}

/**
 * Karmic Chance on a roll that was not part of a Clash.
 *
 * The rule is "after seeing the result of any die", and the example the table uses is a
 * Steadfast Check: you need a 6, you rolled a 5, you spend a Karma Point. It does not
 * ask whether you passed - you may reroll one that already succeeded, which is strange
 * but is what it says.
 */
function renderCheckKarma(message, html) {
  const check = message.getFlag(SCOPE, CHECK_FLAG);
  if (!check) return;

  const actor = fromUuidSync(check.actorUuid);
  if (!actor?.isOwner) return;

  // Only the ones that ask nothing of a Clash, since there was none. Karmic Boost and
  // Karmic Save both name one, so they rule themselves out.
  const options = karmicOptionsFor(actor, message)
    .filter(answersAfterTheFact)
    .filter(effect => !(effect.script ?? "").includes("clash."));
  if (!options.some(effect => effect.available)) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "dbu-clash-button dbu-karma-button";
  button.textContent = "Apply effects";
  button.dataset.tooltip = "Karmic Effects that can still change this roll";
  button.addEventListener("click", () =>
    prepareRoll(actor, [], "After the roll", "",
      { karmic: { message, check, options }, rolling: false }));

  (html.querySelector(".message-content") ?? html).append(button);
}

/**
 * Karmic Effects taken once the result is already known.
 *
 * Three of the seven are written that way on purpose - Karmic Boost adds to a Combat
 * Roll "when you know the result of the Clash it was involved in", Karmic Chance is
 * taken "after seeing the result of any die", and Karmic Save turns a Clash you have
 * already lost. None of them can be offered in the Respond dialog, because that closes
 * before the dice are read. So they are offered on the settled card instead.
 */
function renderAfterTheFact(message, html) {
  // An attack draws its own "Apply effects", and a Karmic Effect belongs in it rather
  // than beside it - it is an effect, and being asked twice at the same moment is worse
  // than being asked once. Only a Skill Clash needs its own button here.
  if (!message.getFlag(SCOPE, CLASH_FLAG)) return;

  const situations = clashSides(message);
  if (!situations.length) return;

  const container = html.querySelector(".dbu-clash") ?? html.querySelector(".message-content");
  if (!container) return;

  for (const situation of situations) {
    const options = offerableTo(situation, message);
    if (!options.some(effect => effect.available)) continue;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "dbu-clash-button dbu-karma-button";
    button.textContent = `${situation.actor.name}: apply effects`;
    button.dataset.tooltip = "Change this result with a Karmic Effect";
    button.addEventListener("click", () =>
      prepareRoll(situation.actor, [], `${situation.actor.name}: after the roll`, "",
        { karmic: { message, situation, options }, rolling: false }));
    container.append(button);
  }
}

/**
 * Every side of a settled roll on this message, among the characters you own.
 *
 * Whether each *lost* travels with them rather than filtering them out, because the
 * three effects do not all want the same thing. Karmic Boost and Karmic Save rescue a
 * result that went against you, so they need the loss. Karmic Chance is about "any
 * die" - you may reroll one that already passed, which is odd but is what it says - so
 * it needs only that a die was rolled.
 *
 * "Currently" is the operative word for the two that need a loss: if one of them flips
 * the Clash, the other side is now the one that lost, and it is their turn.
 */
function clashSides(message) {
  const clash = message.getFlag(SCOPE, CLASH_FLAG);
  if (clash?.result) {
    const { challenger, defender } = clash.result;
    // The defender takes a tie, so a tie is a loss for the challenger and not for them.
    return [
      { uuid: clash.challengerUuid, side: challenger,
        lost: beaten(challenger, defender, false) },
      { uuid: clash.defenderUuid, side: defender,
        lost: beaten(defender, challenger, true) }
    ]
      // Which of the four this Clash was settled on, so an effect that names one can be
      // offered on it. Hard-coded to "skill" before, which is why an effect written
      // `clash.might` could never fire on a Might Clash.
      .map(entry => ({ ...entry, kind: "clash", category: clashFamily(clash),
                       answering: entry.uuid === clash.defenderUuid }))
      .flatMap(entry => mine(entry));
  }

  const attack = message.getFlag(SCOPE, ATTACK_FLAG);
  const result = attack?.result;
  if (!result) return [];

  // Nothing is left to change for somebody whose Damage has already been dealt - but
  // one of them having taken theirs says nothing about the rest.
  return result.wound
    ? woundSides(attack, result)
    : strikeSides(attack, result);
}

/**
 * The Strike against whatever answered it, before the Wound Roll.
 *
 * One Strike Roll, several answers. The attacker's own side appears once, since there
 * is one roll to rescue and rescuing it changes the hit for everyone - they count as
 * having lost the Clash if any of the people they reached beat them, which is what
 * Karmic Boost asks for. Each defender's side is their own.
 */
function strikeSides(attack, result) {
  const answered = targetResults(attack)
    .filter(entry => entry.own?.answer && !entry.own.applied);
  if (!answered.length) return [];

  const sides = [{
    uuid: attack.attackerUuid,
    side: result.strike,
    lost: answered.some(entry => beaten(result.strike, entry.own.answer, false)),
    answering: false
  }];

  for (const entry of answered) {
    sides.push({
      uuid: entry.uuid,
      side: entry.own.answer,
      lost: beaten(entry.own.answer, result.strike, true),
      answering: true
    });
  }

  // A Strike answered by a Dodge or a Parry: Combat Rolls on both sides.
  return sides
    .map(entry => ({ ...entry, kind: "attack", stage: "strike", category: "combat" }))
    .flatMap(entry => mine(entry));
}

/**
 * The Wound Roll, and whether anything met it.
 *
 * A Wound Roll on its own is not a Clash - nobody is rolling against it - so nobody
 * lost one, and Karmic Boost rules itself out by asking for a loss. Karmic Chance asks
 * for nothing and is offered, because it is about any die.
 *
 * Power Flare changes that: it answers the Wound Roll with a Wound Roll of your own,
 * and then the two are a Clash like any other. Both sides are Combat Rolls, so Karmic
 * Boost reaches the loser - and Karmic Save, which wants a Saving Throw, a Skill or
 * Might, reaches neither.
 */
function woundSides(attack, result) {
  const live = targetResults(attack).filter(entry => entry.own && !entry.own.applied);
  if (!live.length) return [];

  const flares = live.filter(entry => entry.own.counterWound);

  // The attacker takes ties here: Power Flare negates the Wound only by beating it.
  // One Wound Roll, so one side for it - lost if any flare beat it, since that is the
  // one Karmic Boost would be spent to undo.
  const sides = [{
    uuid: attack.attackerUuid,
    side: result.wound,
    lost: flares.some(entry => beaten(result.wound, entry.own.counterWound, true)),
    answering: false
  }];

  // A flare answers the Wound Roll for whoever flared and for nobody else, so each is
  // its own side and each is lost or won on its own.
  for (const entry of flares) {
    sides.push({
      uuid: entry.uuid,
      side: entry.own.counterWound,
      lost: beaten(entry.own.counterWound, result.wound, false),
      answering: true
    });
  }

  // Wound against Wound: Combat Rolls on both sides, the same as the Strike stage.
  return sides
    .map(entry => ({ ...entry, kind: "attack", stage: "wound", category: "combat" }))
    .flatMap(entry => mine(entry));
}

/** Whether this side lost, with ties going to whoever was answering. */
function beaten(side, other, takesTies) {
  return takesTies ? (side.total < other.total) : (side.total <= other.total);
}

/** Narrow to the characters you own. */
function mine(entry) {
  const actor = fromUuidSync(entry.uuid);
  if (!actor?.isOwner) return [];
  return [{ ...entry, actor }];
}

/**
 * What to call the dialog, said in terms of what actually happened.
 *
 * "On being hit" was wrong for the commonest case: a Karmic Effect used to defend is
 * taken because the Dodge or Parry lost the Clash, not because the blow landed.
 */
function momentTitle(karmic, which) {
  const stage = karmic?.situation?.stage;
  if (!karmic?.situation?.lost) {
    return (stage === "wound") ? "After the Wound Roll" : "After the roll";
  }
  if (stage === "wound") return "On losing the Wound Roll";
  return (which === "strike") ? "On losing the Strike" : "On losing the clash";
}

/**
 * What this side may take, given what kind of Clash it was.
 *
 * Refused by name rather than hidden, so it is clear the effect exists and why it does
 * not apply. Whatever reason came first is kept: "you already spent one" is more use to
 * the reader than a second reason layered over it.
 */
function offerableTo(situation, message) {
  return karmicOptionsFor(situation.actor, message)
    .filter(answersAfterTheFact)
    .map(effect => {
      if (effect.blocked) return effect;
      const reason = whyNot(effect, situation);
      return reason ? { ...effect, blocked: reason, available: false } : effect;
    });
}

/** How each category reads in a refusal. */
const LABELS = Object.freeze({
  combatRoll: "a Combat Roll - a Strike, a Dodge or a Wound",
  skill: "a Skill Clash",
  save: "a Saving Throw",
  might: "a Might Clash"
});

/**
 * Why this effect cannot be taken here, or null.
 *
 * Read off what the effect itself requires, so an effect that names a condition of the
 * Clash is greyed out for the same reason its own `requires` would refuse it - rather
 * than being offered, paid for, and then quietly doing nothing.
 */
function whyNot(effect, situation) {
  // Plain text rather than a pattern: a template literal treats a backslash as an
  // escape, so a word boundary written here would become a backspace character and
  // the test would never match. None of these names is a prefix of another.
  const wants = key => (effect.script ?? "").includes(`clash.${key}`);

  if (wants("lost") && !situation.lost) {
    // An unopposed Wound Roll has no loser because it has no Clash, which is a
    // different thing from having lost one, and worth saying differently.
    return (situation.stage === "wound")
      ? "nothing answered this Wound Roll, so there is no Clash to have lost"
      : "only when you lost the Clash";
  }
  // An effect that names any of the four categories must have named this one. Written
  // as one rule rather than a case each, so a fifth category would need nothing here.
  const named = Object.values(CLASH_CATEGORIES).filter(wants);
  if (named.length && !named.includes(CLASH_CATEGORIES[situation.category])) {
    return `only on ${LABELS[named[0]] ?? named[0]}`;
  }
  if (wants("answering") && !situation.answering) {
    return "only when an opponent started the Clash";
  }
  return null;
}

/**
 * Spend only what the player actually chose.
 *
 * A collection at a Moment sweeps up every effect that answers it, Automatic ones
 * included - and an Automatic effect is not consumed by applying, it simply applies.
 * Only the armed ones were a decision, so only those are marked used.
 */
function spendChosen(actor, answered) {
  const armed = new Set(actor.system.armedTalents ?? []);
  for (const use of answered.spent) {
    const id = `${use.sourceId}#${use.block}`;
    if (armed.has(id)) spendTriggeredEffect(actor, id);
  }
}

/** Whether this effect is one of the ones taken once the result is known. */
function answersAfterTheFact(effect) {
  return effect.when === "after";
}

/**
 * Take one, and pay for it only if it actually changed the result.
 *
 * Armed first, tried, and charged last. The other order charges for an effect whose own
 * `requires` refused - the player would have bought silence.
 */
export async function takeAfterTheFact(message, situation, key) {
  const { actor } = situation;
  const effect = allKarmicEffects().find(e => e.key === key);
  if (!effect) return;

  await armKarmic(actor, key);

  const changed = (situation.kind === "clash")
    ? await resettleClash(message, situation)
    : await resettleAttack(message, situation);

  if (!changed) {
    await disarmKarmic(actor, key);
    ui.notifications.warn(`${effect.name} does not apply to this roll.`);
    return;
  }

  await payKarmic(message, actor, effect);
}

/**
 * Take a Karmic Effect on a lone check, and republish the card.
 *
 * The original is replaced rather than added to, the same way the critical die does it -
 * one result in the log instead of a number the reader has to work out for themselves.
 */
async function takeOnCheck(message, actor, check, key) {
  const effect = allKarmicEffects().find(e => e.key === key);
  if (!effect) return;

  await armKarmic(actor, key);

  const scope = { data: actor.system, errors: [], context: { roll: 1 }, queue: [] };
  const answered = collectReactive(reactiveFor(actor), "clash-resolved", scope);
  const rerolls = (scope.queue ?? []).some(call => call.verb === "reroll");

  if (!answered.spent.length || !rerolls) {
    await disarmKarmic(actor, key);
    ui.notifications.warn(`${effect.name} does not apply to this roll.`);
    return;
  }

  const again = await rerollBaseDie(actor, check);
  spendChosen(actor, answered);
  await payKarmic(message, actor, effect);

  await ChatMessage.create({
    speaker: message.speaker,
    flavor: check.flavor,
    content: checkCard({
      parts: `${Handlebars.escapeExpression(effect.name)} &middot; ${
        breakdownText(again.lines, again.total)}`,
      total: again.total,
      outcome: again.outcome || "karma",
      owner: actor.uuid
    }),
    flags: {
      [SCOPE]: {
        // Rerolled once and no more: the effect is spent, and the new card carries no
        // Base Die of its own to offer again.
        [CHECK_FLAG]: null
      }
    }
  });

  if (message.isAuthor || game.user.isGM) await message.delete();
}

/**
 * What this character may spend a Karma Point on right now, if anything.
 *
 * Returns null when they are not currently losing anything on this message, which is
 * the only time these three are worth offering.
 */
export function afterTheFactFor(message, actor) {
  const situation = clashSides(message).find(entry => entry.actor.uuid === actor.uuid);
  if (!situation) return null;

  const options = offerableTo(situation, message);
  if (!options.some(effect => effect.available)) return null;

  return { message, situation, options };
}

/**
 * Collect what the effect just armed, for the side that is changing.
 *
 * Read fresh from the message rather than from what the card was drawn with: the effect
 * has been armed on the Actor since, and the side being changed has to be the stored one.
 */
function collectAfterTheFact(situation, mineNow, theirs) {
  return atMoment(situation.actor, "clash-resolved", {
    clash: {
      lost: situation.lost ? 1 : 0,
      answering: situation.answering ? 1 : 0,
      margin: theirs.total - mineNow.total,
      // All four, with the one this Clash was settled on set. An effect names what it
      // wants rather than what it is not.
      ...categoryContext(situation.category)
    },
    roll: 1
  });
}

/** Work a Skill Clash out again. */
async function resettleClash(message, situation) {
  const clash = message.getFlag(SCOPE, CLASH_FLAG);
  if (!clash?.result) return;

  const isChallenger = clash.challengerUuid === situation.actor.uuid;
  const mineNow = isChallenger ? clash.result.challenger : clash.result.defender;
  const theirs = isChallenger ? clash.result.defender : clash.result.challenger;

  const answered = collectAfterTheFact(situation, mineNow, theirs);
  if (!answered.spent.length) return false;

  const settled = await applyAfterTheFact(situation.actor, mineNow, answered);
  spendChosen(situation.actor, answered);

  requestEdit(message, {
    type: "clash",
    clash: {
      ...clash,
      result: isChallenger
        ? { ...clash.result, challenger: settled }
        : { ...clash.result, defender: settled }
    }
  });

  return true;
}

/**
 * Work an attack's Clash out again, and with it whether it lands.
 *
 * Changing a Strike or a defence changes the hit, which is the whole reason to spend a
 * Karma Point here - so the outcome is recomputed rather than left saying what it said
 * before the number moved.
 */
async function resettleAttack(message, situation) {
  const attack = message.getFlag(SCOPE, ATTACK_FLAG);
  const result = attack?.result;
  if (!result) return false;
  if (situation.stage === "wound") return resettleWound(message, situation, attack, result);
  if (result.wound) return false;

  const isAttacker = attack.attackerUuid === situation.actor.uuid;

  // Whose branch this is. The attacker's Strike is one roll answered by everyone, so
  // rescuing it settles the hit again for all of them; a defender's answer is theirs
  // alone and touches nobody else's line.
  const branches = isAttacker
    ? targetResults(attack).filter(entry => entry.own && !entry.own.applied)
    : targetResults(attack).filter(entry => entry.uuid === situation.actor.uuid);
  if (!branches.length) return false;

  const mineNow = isAttacker ? result.strike : branches[0].own.answer;
  const theirs = isAttacker ? branches[0].own.answer : result.strike;

  const answered = collectAfterTheFact(situation, mineNow, theirs);
  if (!answered.spent.length) return false;

  const settled = await applyAfterTheFact(situation.actor, mineNow, answered);
  spendChosen(situation.actor, answered);

  const strike = isAttacker ? settled : result.strike;
  let settledTargets = result.targets ?? [];

  for (const entry of branches) {
    const own = entry.own;
    const answer = isAttacker ? own.answer : settled;

    // The distance is still between them: a Karmic Effect changed a roll, not where
    // anybody is standing. Worked out when the Clash first settled and kept on the line,
    // so this does not have to find the tokens again - and cannot come to a different
    // answer than the first settling did.
    const against = Math.max(0, strike.total - (own.longRange ?? 0));
    const hit = own.automatic || (answer ? (against > answer.total) : true);

    // The defender's own answer to being hit was collected when the Clash first
    // settled, and only if it landed. An attack that only now connects has never asked.
    let incomingDamage = own.incomingDamage;
    if (hit && !own.hit) {
      const target = fromUuidSync(entry.uuid);
      if (target) {
        const incoming = atMoment(target, "being-hit", { attack: 1, attacker: 1 });
        spendChosen(target, incoming);
        incomingDamage = incoming.slots?.["incoming.damage"] ?? null;
      }
    }

    settledTargets = settledTargets.map(line =>
      (line.uuid === entry.uuid) ? { ...own, answer, hit, against, incomingDamage } : line);
  }

  requestEdit(message, {
    type: "attack",
    attack: { ...attack, result: { ...result, strike, targets: settledTargets } }
  });

  return true;
}

/**
 * Work the Wound Roll out again, and with it the Damage.
 *
 * Everything the Damage was built from is already on the message - the Soak that counted,
 * the Damage Category, what the defender's own effects did to it - so only the roll that
 * changed is redone rather than the whole exchange.
 */
async function resettleWound(message, situation, attack, result) {
  const isAttacker = attack.attackerUuid === situation.actor.uuid;

  // One Wound Roll, and one line of consequences per person it reached. The attacker
  // rescuing their own roll redoes the Damage for all of them; a defender's Power Flare
  // answers it for that defender and leaves the rest exactly as they were.
  const branches = isAttacker
    ? targetResults(attack).filter(entry => entry.own?.hit && !entry.own.applied)
    : targetResults(attack).filter(entry => entry.uuid === situation.actor.uuid);
  if (!branches.length) return false;

  const mineNow = isAttacker ? result.wound : branches[0].own.counterWound;
  // A lone Wound Roll has nothing on the other side of it. Its own total stands in, so
  // the margin an effect might read comes to nothing rather than to nonsense.
  const theirs = (isAttacker ? branches[0].own.counterWound : result.wound) ?? mineNow;

  const answered = collectAfterTheFact(situation, mineNow, theirs);
  if (!answered.spent.length) return false;

  const settled = await applyAfterTheFact(situation.actor, mineNow, answered);
  spendChosen(situation.actor, answered);

  const wound = isAttacker ? settled : result.wound;
  let settledTargets = result.targets ?? [];
  const attacker = fromUuidSync(attack.attackerUuid);

  for (const entry of branches) {
    const own = entry.own;
    const counterWound = isAttacker ? own.counterWound : settled;

    // The same arithmetic the Wound step does, on the numbers it already worked out.
    const defence = DEFENCES[own.defense] ?? DEFENCES.dodge;
    const effectiveWound = defence.wound(wound.total);
    const negated = counterWound && (counterWound.total > wound.total);
    const raw = negated
      ? 0
      : Math.max(0, effectiveWound - (own.soak ?? 0) - (own.reduction ?? 0));
    const damage = damageTaken(raw, { "incoming.damage": own.incomingDamage });

    // A Karmic Effect that takes the Damage down to nothing rattles the attacker
    // exactly as a Direct Hit that did so on its own would.
    if (attacker) await maybeShakeAttacker(attacker, attack, defence, damage);

    settledTargets = settledTargets.map(line =>
      (line.uuid === entry.uuid) ? { ...own, counterWound, effectiveWound, damage } : line);
  }

  requestEdit(message, {
    type: "attack",
    attack: { ...attack, result: { ...result, wound, targets: settledTargets } }
  });

  return true;
}

/**
 * Roll the Base Die again, and read the whole result from scratch.
 *
 * The roll is rebuilt from what it came to *before* the first die's Botch or Critical
 * was applied, so the new die brings its own consequences and the old ones are gone
 * rather than layered underneath. That is what makes it a different die rather than an
 * adjustment to the one already rolled.
 *
 * Shared by every kind of roll: a Clash, an attack, and a lone check off the sheet all
 * reroll the same way, and Karmic Chance applies to "any die".
 *
 * @param {Actor} actor
 * @param {object} side  natural, beforeOutcome, total, criticalDice, and optionally
 *                       botchPenalty when the roll uses one of its own
 * @returns {Promise<{total: number, outcome: string, notes: string[]}>}
 */
async function rerollBaseDie(actor, side) {
  const again = new Roll(DBUCharacterData.BASE_DIE);
  await again.evaluate();

  // The same rules the first roll was made under. What moved the first die's Natural
  // Result - a Skill's own, the Eyeglasses' - moves this one too: it is still a Natural
  // Result of the same Check. The roll's `beforeOutcome` carries the first one's move.
  const rules = side.rules ?? {};
  const fresh = Math.max(0, again.total + (rules.naturalAdd ?? 0));

  const before = side.natural ?? 0;
  // "You must accept this second roll, unless it is lower than the first. In which
  // case, you may take the first roll." Only asked when it is actually lower, so the
  // ordinary case costs nobody a click.
  if ((fresh < before) && await keepTheFirstRoll(actor, before, fresh)) {
    // Nothing was replaced, so nothing the first Base Die decided comes off the card.
    // Said out loud because the caller strips those rows by default - which left a total
    // that still carried a Botch beside a column with no Botch in it.
    return {
      kept: true,
      total: side.total,
      outcome: side.outcome ?? "",
      lines: [noteLine(`Karmic Chance rolled ${fresh}, keeping ${before}`)]
    };
  }

  // A floor under the Natural Result is one of those rules, and it applies to the new
  // die exactly as it did to the old.
  const natural = Math.max(fresh, rules.minimumNatural ?? 0);

  let total = (side.beforeOutcome ?? side.total) - before + natural;
  let outcome = "";
  // The Base Die was replaced, so what is shown is the swap and not a second die: the
  // first one is no longer part of the roll and a row implying it still counts would be
  // a row that lies.
  const lines = [partLine({
    label: "Karmic Chance",
    written: `${before} → ${natural}`,
    value: natural - before
  })];

  // The Critical Target the roll was made against, which a Profile can state outright -
  // Cutting's Wound Roll does - rather than the character's own.
  const critical = natural >= (rules.criticalTarget ?? actor.system.criticalTarget ?? 10);

  // And whether falling short of it is a Botch by itself, which is Cutting's whole
  // Strike: "if you do not score a Critical Result, then you score a Botch Result
  // regardless of the Natural Result". Regardless of it, so the Botch Range is not asked.
  const botch = rules.botchUnlessCritical
    ? !critical
    : (natural <= (rules.botchRange ?? actor.system.botchRange ?? 1));

  if (rules.botchUnlessCritical && botch) {
    lines.push(noteLine("Anything short of a Critical Result is a Botch"));
  }

  if (botch) {
    // A Skill roll loses a flat 2 where everything else loses 2(bT), so the caller may
    // say which this roll was rather than being assumed into the wrong one.
    const penalty = side.botchPenalty
      ?? actor.system.botch?.penalty ?? DBUCharacterData.BOTCH_PENALTY;
    total -= penalty;
    outcome = "botch";
    lines.push(fromOutcome(partLine({
      label: "Botch",
      written: side.botchPenalty ? "-2" : "-2(bT)",
      value: -penalty,
      rank: "botch"
    })));
  }
  else if (critical) {
    const formula = side.criticalDice ?? actor.system.dice.critical.formula;
    const extra = new Roll(formula);
    await extra.evaluate();
    total += extra.total;
    outcome = "critical";
    lines.push(fromOutcome(diceLine(extra, "Karmic Chance - Critical")));
  }

  // Floored like every finished roll: a Botch takes what it takes, never past zero.
  return { total: Math.max(0, total), outcome, lines };
}

/**
 * Offer the first roll back when the second came out worse.
 *
 * Karmic Chance is not a straight replacement: the second result stands unless it is
 * lower, and then it is the player's choice. The Karma is spent either way - they used
 * the effect and the dice simply did not help.
 */
async function keepTheFirstRoll(actor, before, after) {
  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: "Karmic Chance" },
    content: `<p>${Handlebars.escapeExpression(actor.name)} rerolled the Base Die and
      got <strong>${after}</strong>, lower than the original <strong>${before}</strong>.</p>
      <p>You may keep the first roll.</p>`,
    buttons: [
      { action: "keep", label: `Keep ${before}` },
      { action: "take", label: `Take ${after}` }
    ],
    rejectClose: false
  });
  // Closing the dialog keeps what they had, which is the outcome that takes nothing away.
  return chosen !== "take";
}

/**
 * Put the collected changes onto a side that has already been rolled.
 *
 * Three shapes: the Base Die replaced outright, dice added and rolled now, and a flat
 * change to the total. A Clash simply declared won is a fourth and is not arithmetic at
 * all - Karmic Save says you succeed whatever the numbers said - so it is carried as an
 * outcome rather than by inventing a total large enough to win.
 */

async function applyAfterTheFact(actor, side, { slots, queue }) {
  // Appended to the rows the roll already had. The total is not one of them - it is
  // drawn from them - so there is no stale total in the middle to trim away, which is
  // what the old one-line form needed and occasionally got wrong.
  const lines = [...(side.lines ?? [])];
  let total = side.total;
  let outcome = side.outcome;

  // Karmic Chance: a different Base Die entirely. The new total is worked out from what
  // the roll came to *before* the old die's consequences, so those consequences come off
  // the card with it - a Botch row left standing beside a total reached without it is a
  // column that will not add up.
  if ((queue ?? []).some(call => call.verb === "reroll")) {
    const again = await rerollBaseDie(actor, side);
    total = again.total;
    outcome = again.outcome;
    // The rows the old Base Die decided come off with it - unless it was kept, in which
    // case it decided them still and they stay.
    const before = again.kept ? lines : withoutOutcome(lines);
    lines.splice(0, lines.length, ...before, ...again.lines);
  }

  for (const granted of slots["roll.dice"] ?? []) {
    if (!granted?.formula) continue;
    const roll = new Roll(granted.formula);
    await roll.evaluate();
    total += roll.total;
    // Named by whatever granted it rather than lumped under "Karma": the Karmic Effect
    // that did it is the only thing worth knowing about a die that arrived late.
    lines.push(diceLine(roll, granted.source || "Karma"));
  }

  const settled = Math.max(0, applySlot(slots, "roll.total", total));
  if (settled !== total) {
    lines.push(partLine({ label: "Karma", value: settled - total }));
  }

  if (slots["clash.succeed"] === true) {
    outcome = "karmic-save";
    lines.push(noteLine("Karmic Save - this Clash succeeds whatever the dice said"));
  }

  return {
    ...side,
    total: settled,
    outcome,
    succeeded: (slots["clash.succeed"] === true) || side.succeeded,
    lines,
    breakdown: breakdownText(lines, settled)
  };
}

/**
 * Announce a Maneuver. A Standard Maneuver is flagged as respondable, which is what
 * gives every other player the chance to answer it with an Instant Maneuver.
 *
 * `asOutOfSequence` covers a Maneuver played through an effect that lets it resolve
 * out of sequence: it ignores its usual Action Cost, and nothing may answer it.
 */
/**
 * What a Movement card says about itself, or null when this is not one.
 *
 * Read off the card rather than worked out again: by the time anybody blocks it, the
 * Actions and the Ki have been spent and there is nothing left on the character saying
 * what this particular Movement took.
 */
function movementOnCard(message) {
  return message?.getFlag?.(SCOPE, MOVEMENT_FLAG) ?? null;
}

/**
 * Whether this card is moving that character right now.
 *
 * "If you are moved by the effect of another Character." Every effect in these rules
 * that moves somebody opens a Clash carrying a collision - the Launch Maneuver, the
 * Thrust Maneuver's Push Back, the Knockback Advantage - and the one being moved is its
 * Defender. So this is one question rather than a list of Maneuvers to keep up with.
 *
 * Only while the movement is still ahead of them: once the collision has been settled
 * they have already hit whatever they hit, and a Sudden Stop then would be stopping
 * something that has finished happening.
 */
function beingMovedOn(message, actor) {
  const clash = message?.getFlag?.(SCOPE, CLASH_FLAG);
  if (!clash?.collision || !clash.result || clash.collisionApplied) return null;
  if (clash.defenderUuid !== actor.uuid) return null;
  // A tie goes to the Defender, so the movement only happens when the challenger took it
  // outright - which is the same rule that decides whether the collision is offered.
  if (whoWonClash(clash.result) !== "challenger") return null;
  return clash;
}

export async function postManeuver(actor, maneuver,
                                   { asOutOfSequence = false, foundation = null,
                                     rapidMovement = false, spent = null, note = "",
                                     curePoison = null } = {}) {
  const type = MANEUVER_TYPES[maneuver.type];
  const label = asOutOfSequence ? MANEUVER_TYPES.outOfSequence.label : type.label;
  const cost = (type.action && !asOutOfSequence)
    ? `${maneuver.actionCost} ${type.action} action(s)`
    : "no action";

  // Handed back, because the card an Instant was played on is part of the Instant rule:
  // an Out-of-Sequence Maneuver this one goes on to offer does not count as getting out
  // from under it.
  const card = await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="dbu-maneuver">
        <div class="dbu-maneuver-name">${Handlebars.escapeExpression(maneuver.name)}</div>
        <div class="dbu-maneuver-meta">${label} &middot; ${cost} &middot; ${maneuver.kiCost} KP</div>
        ${note ? `<div class="dbu-maneuver-note">${Handlebars.escapeExpression(note)}</div>` : ""}
        ${attackLine(actor, maneuver, foundation)}
        ${exploitLine(maneuver)}
      </div>`,
    flags: {
      [SCOPE]: {
        [RESPONDABLE_FLAG]: isRespondable(maneuver, asOutOfSequence),
        // Set before the offers are written, so an Exploit provoked by this Movement can
        // be answered by a card that already knows what was paid for.
        ...(rapidMovement ? { [RAPID_FLAG]: { actorUuid: actor.uuid } } : {}),
        // A poison this Maneuver went after without a Clash, waiting on a roll made off
        // the sheet. The card carries who it is on, because by the time the Check is made
        // the only thing that still knows is the card.
        ...(curePoison ? { [CURE_FLAG]: curePoison } : {}),
        // A Movement is the one Maneuver somebody else can answer without being aimed at,
        // so its card says who moved and what it took.
        //
        // Out of sequence too. "If a Character within range of your Normal Speed uses the
        // Movement Maneuver" is the whole of the Blockade's condition, and it says nothing
        // about whose turn it is - an Out-of-Sequence Movement is somebody using the
        // Movement Maneuver, and standing in the way of one is the same act.
        ...((maneuver.movement)
          ? {
              [MOVEMENT_FLAG]: {
                actorUuid: actor.uuid,
                actorName: actor.name,
                maneuverId: maneuver.id,
                maneuverName: maneuver.name,
                // What a Blockade hands back if it wins. Read from what was actually
                // paid rather than from the Maneuver's listed price, since a Movement's
                // price is what was chosen: Normal Speed for nothing, Boosted for 3(T),
                // Rapid Movement another 2(T) on top.
                spent: {
                  actions: spent?.actions ?? maneuver.actionCost ?? 0,
                  kind: spent?.kind ?? "standard",
                  ki: spent?.ki ?? 0
                },
                stopped: false
              }
            }
          : {})
      }
    }
  });

  offerExploits(card, actor, maneuver);
  return card;
}

/**
 * Offer a held Maneuver back to whoever is holding it.
 *
 * "If that trigger occurs before the start of your next turn, you may use that Maneuver
 * without paying the Action Cost or KP Cost as an Out-of-Sequence Maneuver." The offer
 * machinery is already all of that bar the Ki: one chance, taken once, out of sequence.
 * `free` is what waives the Ki, and this is the only thing that sets it - an offer nobody
 * paid for in advance must not be free.
 *
 * Nothing watches for the trigger. It is written on the offer in the player's own words,
 * where the table can read it and say when it happened.
 */
export function offerDelayed(card, actor, maneuver, trigger) {
  if (!card || !maneuver) return;

  requestEdit(card, {
    type: "offer",
    offer: {
      actorUuid: actor.uuid,
      actorName: actor.name,
      maneuverId: maneuver.id,
      maneuverName: maneuver.name,
      itemId: maneuver.itemId ?? "",
      free: true,
      reason: `Triggered - ${trigger || "no trigger stated"}`
    }
  });
}

/**
 * Who this Maneuver just gave an opening to, in the rulebook's own words.
 *
 * Said on the card even before anybody takes it, because the range is a thing the table
 * rules on and a ruling is easier to make when the wording is in front of everybody.
 */
function exploitLine(maneuver) {
  if (!maneuver?.exploitable) return "";
  return `<div class="dbu-maneuver-exploit">Exploitable &middot; ${
    Handlebars.escapeExpression(maneuver.exploitable)}</div>`;
}

/**
 * The Profile and Foundation an attack was declared with, and the Wound roll that
 * follows from them - the Foundation is what picks the Damage Attribute.
 */
function attackLine(actor, maneuver, foundation) {
  if (!maneuver.profile || !foundation) return "";

  const profile = PROFILES[maneuver.profile];
  const foundationLabel = DBUCharacterData.FOUNDATIONS[foundation]?.label ?? foundation;
  const wound = actor.system.combat.wound[foundation];

  return `<div class="dbu-maneuver-attack">${Handlebars.escapeExpression(profile.label)} Profile
    &middot; ${Handlebars.escapeExpression(foundationLabel)} &middot; Wound ${wound}</div>`;
}

/**
 * Offer the Exploit Maneuver to everyone the Maneuver just used gave an opening to.
 *
 * "Various Standard Maneuvers (even if they are used as another type of Maneuver) and
 * their effects trigger the Exploit Maneuver" - so it is offered off the card whatever
 * type the Maneuver was played as, which is why this hangs off posting a card rather
 * than off the Standard path.
 *
 * Who is in range is the table's to say. The range is written on the offer in the
 * rulebook's own words - "All adjacent Opponents" - and everyone else on the scene
 * holding the Maneuver is offered it, the same answer this system gives every other
 * question about where people are standing. Offered, never played: a Counter Action is
 * the player's to spend.
 *
 * Opponents rather than everyone is the table's call too: there is no notion here of who
 * is on whose side, and inventing one to decide who may punish an opening would be
 * deciding more than the rules asked.
 */
function offerExploits(card, actor, maneuver) {
  if (!card || !maneuver?.exploitable) return;

  // "Your Movement Maneuver does not provoke the Exploit Maneuver." The card is the only
  // place an Exploit is ever offered from, so this is the only place it has to be asked -
  // and it is asked of the Movement alone, which is what the rule names.
  if (maneuver.movement && !permits(actor.system.effects?.slots, "movement.provokes")) return;

  // And a line that fires on a lost Clash rather than on the Maneuver being used is not
  // this door's to open. The Magic Trick's reads "if you fail the initial Clash, this
  // triggers the Exploit Maneuver from the target" - one person, and only on a loss.
  if (maneuver.exploitOnLoss) return;

  const seen = new Map();
  for (const token of (canvas?.tokens?.placeables ?? [])) {
    const other = token.actor;
    if (!other || (other.type !== "character")) continue;
    if (other.uuid === actor.uuid) continue;
    if (!other.items.some(item => (item.type === "maneuver") && item.system.exploit)) continue;
    seen.set(other.uuid, other);
  }

  for (const other of seen.values()) {
    requestEdit(card, {
      type: "offer",
      offer: {
        actorUuid: other.uuid,
        actorName: other.name,
        maneuverId: "exploit",
        maneuverName: "Exploit",
        targetUuid: actor.uuid,
        reason: `${maneuver.name} - ${maneuver.exploitable}`,
        // What opened the door, carried so the attack this becomes can still answer for
        // it. Two rules ask - Rapid Movement's Dodge bonus and Combat Recovery's
        // reprisal - and both ask about a particular use rather than a kind of Maneuver,
        // which is why the message is here and not only the id.
        provokedBy: {
          maneuverId: maneuver.id,
          maneuverName: maneuver.name,
          messageId: card.id
        }
      }
    });
  }
}

/**
 * Whether an Instant Maneuver may be played in response. Instants answer Standard
 * Maneuvers and nothing else, so this follows from the type alone - regardless of
 * what the Maneuver does.
 *
 * Playing a Maneuver out of sequence overrides that: an Out-of-Sequence Maneuver can
 * never be answered by an Instant, whatever the Maneuver would otherwise have been.
 */
function isRespondable(maneuver, asOutOfSequence = false) {
  if (asOutOfSequence) return false;
  return maneuver.type === "standard";
}

/**
 * The characters the reader could respond with: the ones they own that have a token
 * on the current scene.
 *
 * Scoping to the scene is what keeps this usable for a GM, who owns every Actor in
 * the world and would otherwise get a button for each. Reading the tokens rather
 * than the Actors directory also picks up unlinked tokens, whose Actor is synthetic
 * and never appears in that directory.
 *
 * Only tokens: an unlinked token's Actor has a different uuid from the Actor it was
 * made from, so including a character from anywhere else would offer the same
 * character twice and let it answer twice.
 */
function ownedCharacters() {
  const byUuid = new Map();

  for (const token of canvas.tokens?.placeables ?? []) {
    const actor = token.actor;
    if (actor?.isOwner && (actor.type === "character")) byUuid.set(actor.uuid, actor);
  }

  return [...byUuid.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Show what has been played in answer to a Maneuver, and offer one way in to playing
 * something yourself.
 *
 * One button rather than several: a message can invite a Counter Maneuver, an Instant
 * Maneuver and a triggered effect at once, and from any of several characters. Laying
 * every combination out as its own button turned the card into a wall of them, so the
 * choices live behind a single Respond and are grouped there by character.
 *
 * What has already been played is listed here rather than in the dialog, since it is
 * of interest to the whole table. A response belongs to the Actor that played it, so
 * whoever has access to that Actor may take it back - which lets a GM undo any of them.
 */
function renderInstantResponses(message, html) {
  const respondable = Boolean(message.getFlag(SCOPE, RESPONDABLE_FLAG));

  // An attack played out of sequence cannot be answered with an Instant, but it still
  // has to be answered: its target has to dodge or Defend. So the way in is offered
  // whenever there is something to answer, not only when Instants are allowed.
  const attack = message.getFlag(SCOPE, ATTACK_FLAG);
  // Any of the people it reached, not the first one: an area attack waits on all of them.
  const awaiting = Boolean(attack && !attack.result
    && attackTargets(attack).some(target => fromUuidSync(target.uuid)?.isOwner));

  // Being thrown across the field is a third reason to want the dialog, and the card
  // doing the throwing has neither of the other two: a Knockback's Might Clash is not a
  // Maneuver an Instant can answer, and it is not an attack waiting on a roll.
  const thrown = ownedCharacters().some(actor => beingMovedOn(message, actor));

  // Once every target has answered, there is nothing left to answer with: what follows
  // belongs to the Wound Roll and to being hit, which have their own stages.
  if (attack?.result) return;
  if (!respondable && !awaiting && !thrown) return;

  const container = html.querySelector(".message-content") ?? html;
  const responses = message.getFlag(SCOPE, RESPONSES_FLAG) ?? [];

  if (responses.length) {
    const list = document.createElement("ul");
    list.className = "dbu-response-list";

    for (const response of responses) {
      const item = document.createElement("li");
      item.innerHTML = `
        <span class="dbu-response-actor">${Handlebars.escapeExpression(response.actorName)}</span>
        <span class="dbu-response-maneuver">${Handlebars.escapeExpression(response.maneuverName)}</span>`;

      const actor = fromUuidSync(response.actorUuid);
      if (actor?.isOwner) {
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "dbu-cancel-response";
        cancel.textContent = "×";
        cancel.dataset.tooltip = `Cancel ${response.maneuverName}`;
        cancel.addEventListener("click", () => cancelInstant(message, actor, response));
        item.append(cancel);
      }

      list.append(item);
    }
    container.append(list);
  }

  if (!ownedCharacters().length) return;

  const respond = document.createElement("button");
  respond.type = "button";
  respond.className = "dbu-respond-button";
  respond.textContent = "Respond";
  respond.dataset.tooltip = "Play a Counter or Instant Maneuver, or trigger an effect";
  respond.addEventListener("click", () => respondDialog(message, respondable));
  container.append(respond);
}

function instantManeuvers() {
  return allManeuvers().filter(maneuver => maneuver.type === "instant");
}

function counterManeuvers() {
  return allManeuvers().filter(maneuver => maneuver.type === "counter");
}

/**
 * Which triggered effects belong to which point of an exchange.
 *
 * An attack passes through stages, and an effect is only worth offering at the one it
 * can act on: setting a Base Die is of use before a roll is made, not after. Keyed by
 * stage so a new effect joins the list it belongs to rather than appearing everywhere.
 */
/**
 * Which Moments each side may bring something to, at each point in the exchange.
 *
 * Two sides and two points, and the four are not the same list: what answers *making*
 * an attack is not what answers *being* one. The old data rows had a single key that
 * served for everything, so this used to be one Moment shared by all four - which
 * quietly meant the target was offered the attacker's effects and, once the Moments
 * were told apart, nothing at all.
 */
const TRIGGER_STAGES = {
  // Answering the attack: the Strike, and whatever meets it.
  response: {
    attacker: ["combat-roll"],
    target: ["combat-roll", "defending"]
  },
  // The attack has landed, and the Wound Roll has not been made yet - which is exactly
  // what these are there to change.
  hit: {
    attacker: ["hit", "before-wound"],
    target: ["being-hit", "before-wound"]
  }
};

/**
 * The triggered effects worth offering to this character at this point.
 *
 * Only what could actually bear on it: an effect that sets a Combat Roll is of no use
 * on a Maneuver that rolls nothing, or to a character standing outside the exchange.
 * Showing everything a character owns would bury the one that matters.
 */
/** The rulebook's own wording for one triggered effect, for the dialogs to show. */
function triggerText(entry) {
  return entry.program?.blocks?.[0]?.text ?? "";
}

/**
 * What this character holds that answers any of these Moments, and could still be used.
 *
 * Only the triggered ones. An Automatic effect fires by itself, so listing it would be
 * asking the player to choose something that was never theirs to choose.
 *
 * A Karmic Effect answers Moments like anything else, but it is bought rather than
 * merely armed - it has a list of its own, and offering it here as a free checkbox would
 * hand it over without the Karma Point.
 *
 * A Moment is written `threshold(bruised)` or `state/raging`, and what is matched is the
 * name in front of the parameter - an effect answering one Threshold still answers the
 * Moment of being knocked through one.
 */
function triggersFor(actor, moments) {
  if (!actor || !moments.length) return [];

  return reactiveFor(actor).filter(entry =>
    !entry.sourceId.startsWith("karma:")
    && entry.available && (entry.program.blocks ?? []).some(b =>
      (b.mode === "triggered")
      && moments.includes(String(b.moment ?? "").split(/[(/]/)[0]))
  );
}

function relevantTriggers(actor, message, stage) {
  const attack = message.getFlag(SCOPE, ATTACK_FLAG);
  if (!attack) return [];

  // Both sides take part in both stages; what differs is which effects each holds.
  if (!attackParticipants(attack).includes(actor.uuid)) return [];

  const side = (actor.uuid === attack.attackerUuid) ? "attacker" : "target";
  return triggersFor(actor, TRIGGER_STAGES[stage]?.[side] ?? []);
}

/**
 * Ask what this character is bringing to a roll they are about to make, and set it up.
 *
 * Willing failure is offered here rather than only from the Respond dialog: it applies
 * to any roll at all, so every point where a character is asked to confirm one has to
 * be able to declare it. The triggered effects vary with the moment; the willing
 * failure does not.
 *
 * @returns {Promise<boolean>} False if the reader backed out entirely.
 */
/** Said the same way wherever a roll turns out not to be failable on purpose. */
const URGENT = "This roll is Urgent, so it cannot be failed on purpose.";

/**
 * Whether this roll may be failed on purpose.
 *
 * Three things can refuse it. Some rolls are Urgent by their nature - an Initiative
 * Check is one. Some effects forbid it outright from the sheet. And Compelled makes
 * every Combat Roll Urgent through a *reactive* block, which is the one that had been
 * getting through: a reactive forbid does not exist on the sheet at all, it exists only
 * at the moment the roll is made, so asking the sheet found nothing and the option was
 * offered, taken, and then quietly ignored when the dice were picked up.
 *
 * So when the caller says this is a Combat Roll, the moment is asked rather than the
 * sheet. `slots` short-circuits that: at the roll itself they have already been
 * collected, and collecting them twice would offer the same one-shot effects again.
 *
 * @param {Actor} actor
 * @param {object} [options]
 * @param {boolean} [options.urgent]      this particular roll is Urgent by its nature
 * @param {boolean} [options.combatRoll]  the roll in question is a Combat Roll
 * @param {boolean} [options.attackingManeuver]  and part of this actor's own attack
 * @param {object} [options.slots]        slots already collected at the roll
 * @returns {null|string}  null if it may be, otherwise why it may not
 */
export function whyNotWilling(actor, { urgent = false, slots = null, combatRoll = false,
                                       attackingManeuver = false } = {}) {
  if (urgent) return URGENT;

  // Asked the same question the roll itself will ask, or the dialog and the roll
  // disagree: Compelled makes your own attacks Urgent and leaves your defence alone,
  // so a dialog that did not say which of the two this is would close the option on a
  // Dodge the roll would have allowed.
  const reactive = slots
    ?? (combatRoll
      ? atMoment(actor, "combat-roll", { roll: true, attackingManeuver }).slots
      : null);
  if (reactive?.willingFailure === false) return URGENT;

  if (!permits(actor.system.effects?.slots, "willingFailure")) {
    return "Something is forcing this roll.";
  }
  return null;
}

export async function prepareRoll(actor, effects, title, hint = "",
                                  { karmic = null, rolling = true, urgent = false,
                                    combatRoll = false, attackingManeuver = false,
                                    difficulties = false, sight = false } = {}) {
  const rows = effects.map(entry => `
    <label class="dbu-respond-option">
      <input type="checkbox" name="trigger" value="${entry.blockId}"/>
      <span class="dbu-respond-name">${Handlebars.escapeExpression(entry.sourceName)}</span>
      <span class="dbu-respond-source">${Handlebars.escapeExpression(triggerText(entry))}</span>
    </label>`).join("");

  // A Karmic Effect is an effect like any other, so it belongs in the same dialog - it
  // simply costs a Karma Point where the rest are free. Kept in its own group with the
  // price on show, and as radios, because only one may be applied at a time.
  // The rules text goes on the name, not into the row. Spelt out inline it is a
  // paragraph per effect, and the window grows to fit the longest one - which made the
  // dialog wider than the screen. The row keeps what you need to choose between them,
  // the price and the reason it is closed; the wording is a hover away.
  const karmicRows = (karmic?.options ?? []).map(effect => `
    <label class="dbu-respond-option${effect.blocked ? " dbu-respond-blocked" : ""}">
      <input type="radio" name="karmic" value="${effect.key}" ${effect.blocked ? "disabled" : ""}/>
      <span class="dbu-respond-name" data-tooltip="${Handlebars.escapeExpression(effect.text)}"
            >${Handlebars.escapeExpression(effect.name)}</span>
      <span class="dbu-respond-source">${Handlebars.escapeExpression(
        effect.blocked ?? effect.costLabel)}</span>
    </label>`).join("");

  const karmicGroup = karmicRows
    ? `<details class="dbu-respond-group" open>
         <summary>Karmic Effects &middot; ${actor.system.karma ?? 0} left</summary>
         ${karmicRows}
       </details>`
    : "";

  // Said rather than simply absent when it is refused: "you cannot throw this one" is
  // worth knowing, and a missing checkbox tells nobody anything.
  const refused = rolling
    ? whyNotWilling(actor, { urgent, combatRoll, attackingManeuver })
    : null;
  const willing = !rolling
    ? ""
    : refused
    ? `<label class="dbu-respond-option dbu-respond-willing dbu-respond-blocked"
              data-tooltip="${Handlebars.escapeExpression(refused)}">
         <span class="dbu-respond-name">Willing failure</span>
         <span class="dbu-respond-source">${Handlebars.escapeExpression(refused)}</span>
       </label>`
    : `<label class="dbu-respond-option dbu-respond-willing">
         <input type="checkbox" name="willing" ${actor.system.willingFailure ? "checked" : ""}/>
         <span class="dbu-respond-name">Willing failure</span>
         <span class="dbu-respond-source">Fail on purpose: this roll totals 0, however the dice land.</span>
       </label>`;

  // "Against an Opponent in the form of a Clash or against a set Difficulty Category."
  // Asked in the window that confirms the roll rather than in one of its own: that window
  // exists so a roll takes one click, and a second dialog to pick a number would undo it.
  //
  // Offered only where the caller says a Difficulty can apply, which is the Skill Check and
  // nothing else. A Combat Roll is not measured against a Target Number.
  const difficultyRows = difficulties
    ? `<label class="dbu-respond-option dbu-respond-difficulty">
         <span class="dbu-respond-name">Difficulty</span>
         <select name="difficulty">
           <option value="">None - just the roll</option>
           ${Object.entries(DBUCharacterData.DIFFICULTIES).map(([key, entry]) =>
             `<option value="${key}">${Handlebars.escapeExpression(entry.label)} - ${entry.tn}</option>`).join("")}
         </select>
         <span class="dbu-respond-source">Match or exceed the Target Number. The ARC picks
           the Category; the card says whether it was met.</span>
       </label>`
    : "";

  // "Any Perception Skill check made relying on sight" - which only the player knows.
  // Offered only where something moves such a Check, and ticked, since most do.
  const sightRow = sight
    ? `<label class="dbu-respond-option">
         <input type="checkbox" name="sight" checked/>
         <span class="dbu-respond-name">Relying on sight</span>
       </label>`
    : "";

  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title },
    content: `<div class="dbu-respond-dialog">
      ${hint ? `<p class="dbu-respond-hint">${hint}</p>` : ""}${rows}${difficultyRows}${sightRow}${willing}${karmicGroup}
    </div>`,
    buttons: [
      {
        action: "confirm",
        label: "Confirm",
        callback: (event, button, dialog) => ({
          triggers: [...dialog.element.querySelectorAll('input[name="trigger"]:checked')].map(input => input.value),
          willing: dialog.element.querySelector('input[name="willing"]')?.checked ?? null,
          karmic: dialog.element.querySelector('input[name="karmic"]:checked')?.value ?? null,
          difficulty: dialog.element.querySelector('select[name="difficulty"]')?.value ?? "",
          sight: dialog.element.querySelector('input[name="sight"]')?.checked ?? false
        })
      },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });

  if (!chosen || (typeof chosen !== "object")) return false;

  const changes = {};
  if (chosen.triggers.length) {
    changes["system.armedTalents"] = [...new Set([...actor.system.armedTalents, ...chosen.triggers])];
  }
  // Written even when it is being turned back off: the reader may have armed it from
  // the sheet and changed their mind here, and leaving it set would spend it silently.
  // Null means the dialog never asked, and then it is left exactly as it was.
  if ((chosen.willing !== null) && (chosen.willing !== actor.system.willingFailure)) {
    changes["system.willingFailure"] = chosen.willing;
  }

  if (!foundry.utils.isEmpty(changes)) await actor.update(changes);

  // Last, so that anything armed above is already in place when the Clash is worked
  // out again - a Karmic Effect changes a result the other choices may also touch.
  if (chosen.karmic) {
    if (karmic?.situation) await takeAfterTheFact(karmic.message, karmic.situation, chosen.karmic);
    else if (karmic?.check) await takeOnCheck(karmic.message, actor, karmic.check, chosen.karmic);
  }

  // An object rather than `true` where a Difficulty was offered, so the caller can read
  // what was picked. Truthy either way, which is what every other caller tests - and the
  // one that tests `=== false` still gets what it was looking for from a cancel.
  return (difficulties || sight)
    ? { difficulty: chosen.difficulty || "", sight: Boolean(chosen.sight) }
    : true;
}

/**
 * One dialog holding everything a reader could play in answer to this Maneuver,
 * grouped by the character playing it.
 *
 * A Counter and an Instant can both be played against the same Maneuver, so the two
 * lists are independent - picking from one leaves the other free. Within each list
 * only one Maneuver may be chosen, which is what the radios enforce.
 */
/**
 * Whether this character will roll anything on this message.
 *
 * An attack is rolled by the attacker and answered by its targets; a Skill Clash by
 * its two sides. Anyone else responding here takes part without rolling - playing an
 * Instant records a Maneuver, it does not pick up dice - so there is nothing for a
 * willing failure to apply to, and offering it would only invite a choice that does
 * nothing in this exchange.
 */
/**
 * Whether what this message asks for is a Combat Roll.
 *
 * An attack is Strike against Dodge or Parry, so it always is. A Clash is whichever
 * of the four categories it was opened as - the categories exist because they scale
 * differently, and Compelled makes Combat Rolls Urgent and nothing else.
 */
function rollsCombat(message) {
  if (message.getFlag(SCOPE, ATTACK_FLAG)) return true;

  // Asked of the roll pair rather than of the field, which holds the pair's name and not
  // one of the four. It used to compare the field to "combat" directly, which no card has
  // ever been posted with - so a Grapple Check, which is Strike against Strike or Dodge,
  // said it was not a Combat Roll and Compelled could not reach it.
  const clash = message.getFlag(SCOPE, CLASH_FLAG);
  return Boolean(clash) && (clashFamily(clash) === "combat");
}

/** Which of the four kinds of Clash this card is. */
function clashFamily(clash) {
  return CLASH_ROLLS[clash?.category ?? "skill"]?.family ?? "skill";
}

function rollsOnMessage(message, actor) {
  const attack = message.getFlag(SCOPE, ATTACK_FLAG);
  if (attack) return attackParticipants(attack).includes(actor.uuid);

  const clash = message.getFlag(SCOPE, CLASH_FLAG);
  if (clash) return clashParticipants(clash).includes(actor.uuid);

  return false;
}

async function respondDialog(message, respondable) {
  const characters = ownedCharacters();
  const attack = message.getFlag(SCOPE, ATTACK_FLAG);
  // The other thing a Counter Maneuver can answer. Until the Blockade Maneuver, every
  // one of them met an attack aimed at the person playing it.
  const movement = movementOnCard(message);
  const answered = new Set((message.getFlag(SCOPE, RESPONSES_FLAG) ?? []).map(entry => entry.actorUuid));

  const sections = characters.map(actor => {
    // Any of the people this attack reaches, not the one it was first aimed at. An
    // area attack adds to that list, and somebody added to it is being attacked as
    // much as the first one was - they were the ones who could neither Dodge nor
    // Defend, which also left the exchange waiting on an answer they could not give.
    const isTarget = Boolean(attack)
      && attackTargets(attack).some(target => target.uuid === actor.uuid);
    const unresolved = isTarget && !attack.result;

    // Nothing is picked to begin with, so confirming the dialog without touching a
    // group answers nothing. The Instants carry an explicit "nothing" of their own,
    // since a radio cannot be unpicked once it has been.
    const nothing = (group) => `
      <label class="dbu-respond-option">
        <input type="radio" name="${group}-${actor.id}" value="none" checked/>
        <span class="dbu-respond-name">Nothing</span>
      </label>`;

    // Not a Maneuver and not an alternative to one: a willing failure sits alongside
    // whatever is played, since you can dodge or Defend and still choose to fail.
    // Only for the characters this exchange actually asks to roll, though - a
    // bystander playing an Instant has no roll here to fail.
    // And not when something forbids it either - Compelled forces every Combat Roll.
    // Shown greyed with the reason rather than left out, so it is clear the option
    // exists and why it is closed.
    const forced = whyNotWilling(actor, {
      combatRoll: rollsCombat(message),
      attackingManeuver: attack?.attackerUuid === actor.uuid
    });
    const willing = !rollsOnMessage(message, actor)
      ? ""
      : forced
      ? `<label class="dbu-respond-option dbu-respond-aside dbu-respond-blocked"
                data-tooltip="${Handlebars.escapeExpression(forced)}">
           <span class="dbu-respond-name">Willing failure</span>
           <span class="dbu-respond-source">${Handlebars.escapeExpression(forced)}</span>
         </label>`
      : `<label class="dbu-respond-option dbu-respond-aside">
           <input type="checkbox" name="willing-${actor.id}"
                  ${actor.system.willingFailure ? "checked" : ""}/>
           <span class="dbu-respond-name">Willing failure</span>
           <span class="dbu-respond-source">your next roll totals 0</span>
         </label>`

    // Dodging is not a Maneuver and costs no Counter Action, but it is the other way to
    // answer an attack - so it shares the Counters' group and picking one unpicks the
    // other. Energy Cancel is the exception that proves the shape: it spends the Counter
    // Action without answering the attack, so taking it leaves you dodging anyway.
    // Picked to begin with: dodging is what answering an attack means when nothing
    // else is chosen, so confirming without touching this is a real answer rather
    // than a dialog that quietly did nothing.
    const dodge = unresolved
      ? `<label class="dbu-respond-option dbu-respond-dodge">
           <input type="radio" name="counter-${actor.id}" value="dodge" checked/>
           <span class="dbu-respond-name">Dodge</span>
           <span class="dbu-respond-source">no maneuver, no action</span>
         </label>`
      : "";

    // One Counter Action answers one Maneuver, so these are one choice between them -
    // Dodge included, since answering an attack is what the group is for.
    // "If a Character within range of your Normal Speed uses the Movement Maneuver."
    // Whether they are in range is the table's call, like every range in these rules, so
    // what is checked here is everything else: that somebody moved, that the Movement is
    // still going, and that it was not this character who moved.
    const canBlock = Boolean(movement) && !movement.stopped
      && (movement.actorUuid !== actor.uuid);

    // "If you are moved by the effect of another Character." Judged off the card that is
    // moving them, and only once: a movement is stopped suddenly once however hard you
    // dig in.
    const moved = beingMovedOn(message, actor);
    const canStop = Boolean(moved) && !moved.suddenStop;

    const counters = counterManeuvers().map(maneuver => {
      // A Counter Maneuver answers an Attacking Maneuver aimed at you, so a character
      // who is not the target is shown it but cannot take it.
      let blocked = !unresolved;
      let reason = blocked
        ? "only the target of an attack may answer it, and only before it resolves" : "";

      // The Sudden Stop answers being moved, which is a third thing again.
      if (maneuver.suddenStop) {
        blocked = !canStop;
        reason = moved
          ? "you have already dug in against this one"
          : "only while somebody else's effect is moving you";
      }

      // The Blockade answers a Movement instead, so it is judged against that and not
      // against being attacked.
      if (maneuver.blockade) {
        blocked = !canBlock;
        reason = !movement
          ? "only when somebody uses the Movement Maneuver"
          : movement.stopped
          ? "this Movement has already been stopped"
          : (movement.actorUuid === actor.uuid)
          ? "you cannot stand in your own way"
          : "";
      }

      // Energy Cancel needs a charge to let go of, whoever is looking at it.
      if (!blocked && maneuver.cancelCharge && !actor.system.charging?.maneuverId) {
        blocked = true;
        reason = "you are not charging anything";
      }

      const note = maneuver.cancelCharge
        ? `${maneuver.source} - you still Dodge`
        : maneuver.blockade
        ? `${maneuver.source} - ${maneuverKiCost(maneuver, null, actor)} KP`
        : maneuver.source;

      return option(`counter-${actor.id}`, maneuver.id, maneuver.name, note, blocked, reason);
    }).join("");

    // Both Dodge and the Defend Maneuver are called for by being attacked, and a
    // Maneuver that is not an attack does not call for either - a Skill Clash such as
    // Thumb War is answered on its own card, not defended against. With no attack here
    // the whole group is left off rather than shown with everything in it disabled:
    // greying out an option says "not now", and the truth is "not for this".
    const counterGroup = (attack || canBlock || canStop)
      ? `<details class="dbu-respond-group">
           <summary>Counter Maneuvers</summary>
           ${counters || `<p class="dbu-respond-note">None.</p>`}
         </details>`
      : "";

    // An Instant played here is taken as having come before the Maneuver it answers,
    // so there is no timing to choose.
    const instants = !respondable
      ? `<p class="dbu-respond-note">This maneuver cannot be answered with an Instant.</p>`
      : answered.has(actor.uuid)
      ? `<p class="dbu-respond-note">Already answered - cancel it on the card to play another.</p>`
      : nothing("instant") + instantManeuvers().map(maneuver =>
          option(`instant-${actor.id}`, maneuver.id, maneuver.name, maneuver.source, false, "")
        ).join("");

    const triggers = relevantTriggers(actor, message, "response");
    const triggerRows = triggers.length
      ? triggers.map(effect => `
          <label class="dbu-respond-option">
            <input type="checkbox" name="trigger-${actor.id}" value="${effect.blockId}"/>
            <span class="dbu-respond-name">${Handlebars.escapeExpression(effect.sourceName)}</span>
            <span class="dbu-respond-source">${Handlebars.escapeExpression(triggerText(effect))}</span>
          </label>`).join("")
      : `<p class="dbu-respond-note">Nothing applies here.</p>`;

    // Karmic Effects sit beside the Counters and Instants rather than inside the
    // Triggered Effects, because taking one costs a Karma Point and the other three
    // lists cost nothing - they are not the same kind of decision.
    //
    // Only for the characters actually taking part, and only the ones that are chosen
    // before the dice. A bystander at the same table has no roll to spend a Karma Point
    // on, and Boost, Save and Chance are all taken once the result is known - they are
    // offered on the settled card instead.
    const karmicOptions = rollsOnMessage(message, actor)
      ? karmicOptionsFor(actor, message).filter(effect => !answersAfterTheFact(effect))
      : [];

    const karmic = karmicOptions.map(effect => `
      <label class="dbu-respond-option${effect.blocked ? " dbu-respond-blocked" : ""}"
             ${effect.blocked ? `data-tooltip="${Handlebars.escapeExpression(effect.blocked)}"` : ""}>
        <input type="radio" name="karma-${actor.id}" value="${effect.key}"
               ${effect.blocked ? "disabled" : ""}/>
        <span class="dbu-respond-name">${Handlebars.escapeExpression(effect.name)}</span>
        <span class="dbu-respond-source">${
          effect.blocked
            ? Handlebars.escapeExpression(effect.blocked)
            : Handlebars.escapeExpression(effect.costLabel)}</span>
      </label>`).join("");

    // Left off entirely rather than shown empty: "no Karmic Effects here" and "you are
    // not part of this roll" are different things, and an empty list says neither.
    const karmaGroup = karmicOptions.length
      ? `<details class="dbu-respond-group">
           <summary>Karmic Effects &middot; ${actor.system.karma ?? 0} left</summary>
           ${karmic}
         </details>`
      : "";

    return `
      <details class="dbu-respond-actor" open>
        <summary>${Handlebars.escapeExpression(actor.name)}</summary>

        ${dodge}
        ${willing}

        ${counterGroup}

        <details class="dbu-respond-group">
          <summary>Instant Maneuvers</summary>
          ${instants || `<p class="dbu-respond-note">None.</p>`}
        </details>

        <details class="dbu-respond-group">
          <summary>Triggered Effects</summary>
          ${triggerRows}
        </details>

        ${karmaGroup}
      </details>`;
  }).join("");

  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: "Respond" },
    content: `<div class="dbu-respond-dialog">${sections}</div>`,
    buttons: [
      {
        action: "confirm",
        label: "Confirm",
        callback: (event, button, dialog) => characters.map(actor => ({
          actor,
          counter: dialog.element.querySelector(`input[name="counter-${actor.id}"]:checked`)?.value ?? null,
          instant: dialog.element.querySelector(`input[name="instant-${actor.id}"]:checked`)?.value ?? null,
          willing: dialog.element.querySelector(`input[name="willing-${actor.id}"]`)?.checked ?? null,
          karma: dialog.element.querySelector(`input[name="karma-${actor.id}"]:checked`)?.value ?? null,
          triggers: [...dialog.element.querySelectorAll(`input[name="trigger-${actor.id}"]:checked`)]
            .map(input => input.value)
        }))
      },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });

  if (!Array.isArray(chosen)) return;

  try {
    await applyResponses(message, chosen, attack);
  }
  catch (error) {
    console.error("DBU TTRPG | Could not play a response", chosen, error);
    ui.notifications.error("DBU TTRPG | A response failed. See the console.");
  }
}

/** Carry out everything the reader chose, for every character they chose it for. */
async function applyResponses(message, chosen, attack) {
  for (const choice of chosen) {
    // Arming comes first: a Counter resolves the exchange, and anything meant to shape
    // that roll has to be in place before it is made.
    // Null means the dialog never asked - this character rolls nothing here - so
    // whatever they had armed elsewhere is left exactly as it was.
    if ((choice.willing !== null) && (choice.willing !== choice.actor.system.willingFailure)) {
      await choice.actor.update({ "system.willingFailure": choice.willing });
    }

    if (choice.triggers.length) {
      const armed = choice.actor.system.armedTalents;
      await choice.actor.update({
        "system.armedTalents": [...new Set([...armed, ...choice.triggers])]
      });
    }

    // A Karmic Effect pays for itself: the cost is the effect rather than a separate
    // step, so choosing one here is what spends the Karma Point.
    if (choice.karma) await applyKarmic(message, choice.actor, choice.karma);

    if (choice.instant && (choice.instant !== "none")) {
      await playInstant(message, choice.actor, choice.instant);
    }
    if (choice.counter && (choice.counter !== "none")) {
      await playCounter(message, choice.actor, choice.counter, attack);
    }
  }
}

/**
 * Take a Karmic Effect for this exchange.
 *
 * Paid for first: if the cost cannot be met - or Dynamic is cancelled at its prompt -
 * nothing is armed and nothing is recorded, so the option is still there to take.
 */
async function applyKarmic(message, actor, key) {
  const effect = allKarmicEffects().find(e => e.key === key);
  if (!effect) return null;

  await armKarmic(actor, key);
  const paid = await payKarmic(message, actor, effect);
  if (!paid) await disarmKarmic(actor, key);
  return paid;
}

/** Which blocks of a Karmic Effect answer a Moment. */
function karmicBlocks(actor, key) {
  return reactiveFor(actor)
    .filter(entry => entry.sourceId === `karma:${key}`)
    .map(entry => entry.blockId);
}

/**
 * Arm a Karmic Effect so the next Moment picks it up.
 *
 * Every block of it, not only the first: paying for a Karmic Effect buys the whole
 * thing. Arming is free - what it costs is settled separately, so that an effect which
 * turns out not to apply can be disarmed again without anyone having paid for silence.
 */
async function armKarmic(actor, key) {
  const blocks = karmicBlocks(actor, key);
  if (!blocks.length) return;
  await actor.update({
    "system.armedTalents": [...new Set([...actor.system.armedTalents, ...blocks])]
  });
}

/** Put it back, for an effect that was armed and then did nothing. */
async function disarmKarmic(actor, key) {
  const blocks = new Set(karmicBlocks(actor, key));
  if (!blocks.size) return;
  await actor.update({
    "system.armedTalents": actor.system.armedTalents.filter(id => !blocks.has(id))
  });
}

/** Spend the Karma Points, record it against the message, and say so. */
async function payKarmic(message, actor, effect) {
  const spent = await spendKarma(actor, effect);
  if (spent === null) return null;

  requestEdit(message, { type: "karmic", actorId: actor.id, key: effect.key });

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: checkCard({
      parts: `${Handlebars.escapeExpression(effect.name)}`,
      total: `-${spent} Karma`,
      outcome: "karma"
    })
  });

  return { effect, spent };
}

/**
 * Play a Counter Maneuver that answers something other than the attack.
 *
 * Only Energy Cancel so far. It goes through the ordinary path, so its Action Cost, its
 * once-per-round limit and everything else about it are enforced in one place.
 */
async function playAside(actor, maneuverId) {
  const owned = actor.items.find(item =>
    (item.type === "maneuver") && (item.system.maneuverId === maneuverId));

  if (!owned) {
    ui.notifications.warn(`${actor.name} does not have that Maneuver.`);
    return false;
  }

  const { useOwnedManeuver } = await import("./use-maneuver.mjs");
  return useOwnedManeuver(actor, owned.id);
}

/** One selectable row in the Respond dialog. */
function option(name, value, label, note, disabled, reason) {
  return `
    <label class="dbu-respond-option ${disabled ? "dbu-respond-blocked" : ""}"
           ${reason ? `data-tooltip="${Handlebars.escapeExpression(reason)}"` : ""}>
      <input type="radio" name="${name}" value="${value}" ${disabled ? "disabled" : ""}/>
      <span class="dbu-respond-name">${Handlebars.escapeExpression(label)}</span>
      <span class="dbu-respond-source">${Handlebars.escapeExpression(note ?? "")}</span>
    </label>`;
}

/**
 * Pay for an Instant Maneuver and record it on the Maneuver it answers.
 *
 * The sheet's "last maneuver was an Instant" flag is deliberately left alone. An
 * Instant played here comes before the Maneuver it answers, which then takes its place
 * as the last one played - so by the time the dust settles it was not an Instant.
 *
 * What does stop a second Instant is the response itself: having answered the most
 * recent Standard Maneuver, the sheet will not offer another until a Standard Maneuver
 * goes by unanswered. That is read straight off the messages, so nothing needs
 * clearing afterwards.
 */
async function playInstant(message, actor, maneuverId) {
  const maneuver = getManeuver(maneuverId);
  if (!maneuver) return;
  if (!await spendManeuverCost(actor, maneuver)) return;

  // An Instant played into a card is an Instant played, and it was not recorded as one -
  // which is why the rule had to be inferred from the message log instead, and why
  // somebody else playing a Standard Maneuver was letting you play a second.
  await recordManeuverType(actor, "instant", { messageId: message.id });

  requestEdit(message, {
    type: "respond",
    response: {
      actorUuid: actor.uuid,
      actorName: actor.name,
      maneuverId: maneuver.id,
      maneuverName: maneuver.name
    }
  });
}

/**
 * Answer the attack: either plainly, by dodging, or with a Counter Maneuver. Both
 * resolve the exchange, which is why they share one group of choices.
 */
async function playCounter(message, actor, answer, attack) {
  // The Blockade is the one Counter Maneuver that does not answer an attack, so it is
  // reached before the guard that says there has to be one.
  const blockade = getManeuver(answer);
  if (blockade?.blockade) return playBlockade(message, actor, blockade);
  if (blockade?.suddenStop) return playSuddenStop(message, actor, blockade);

  if (!attack || attack.result) return;
  // Dodging is not a Maneuver, so it neither costs a Counter Action nor gets you out
  // from under an Instant.
  if (answer === "dodge") return chooseDefence(message, actor, "dodge");

  const maneuver = getManeuver(answer);
  if (!maneuver) return;

  // A Counter Maneuver is a Maneuver of another kind, so it releases the Instant rule.
  await recordManeuverType(actor, "counter");

  // Energy Cancel spends the Counter Action on letting go of a charge rather than on
  // meeting the attack - so having spent it, the attack is answered the way it is
  // answered when you spend nothing: you Dodge. That is what makes it exclusive with
  // Defend and compatible with dodging at the same time.
  if (maneuver.cancelCharge) {
    if (!await playAside(actor, maneuver.id)) return;
    return chooseDefence(message, actor, "dodge");
  }

  if (!maneuver.defend) return;
  return defendAgainst(message, actor, attack);
}

/**
 * Stand in somebody's way.
 *
 * "If a Character within range of your Normal Speed uses the Movement Maneuver, you may
 * use this Maneuver to make a Clash (Impulsive) against that Character."
 *
 * Paid for here rather than through useManeuver, the way a Defend is: this path starts
 * from a card that has to be carried into the Clash, and useManeuver has no way to be
 * told which one. What that costs is saying the Action and the Ki out loud - both below,
 * both before anything is opened.
 */
async function playBlockade(message, actor, maneuver) {
  const movement = movementOnCard(message);
  const mover = movement && fromUuidSync(movement.actorUuid);

  if (!movement || movement.stopped || !mover || (movement.actorUuid === actor.uuid)) return;

  // Ki first, then the Counter Action, so a character who cannot pay for it has spent
  // neither. "KP Cost: 2(T)", which is what the Maneuver's own price comes to.
  if (!await spendManeuverCost(actor, maneuver, maneuverKiCost(maneuver, null, actor))) return;
  if (!await spendActions(actor, maneuver.actionCost ?? 1, "counter")) {
    await refundManeuverCost(actor, maneuver);
    return;
  }

  // A Counter Maneuver is a Maneuver of another kind, so it releases the Instant rule.
  await recordManeuverType(actor, "counter");

  // "A Clash (Impulsive)" - one Saving Throw named, so there is nothing to choose
  // between and neither side is asked anything. The `blockade` below is what settling it
  // leaves behind, and it reaches the card with the rest of what is passed.
  return postSaveClash(actor, mover, {
    maneuverName: maneuver.name,
    clashLabel: "Blockade",
    reason: `${actor.name} steps into ${mover.name}'s path. Win and the Movement stops; `
      + `lose and ${mover.name} moves on and has an opening.`,
    saves: ["impulsive"],
    blockade: { messageId: message.id, applied: false }
  });
}

/**
 * Dig in against being thrown.
 *
 * "Reduce the number of Squares you move by a number of Squares up to 1/2 of your Might."
 * How many is theirs to say, because the rule says "up to" - somebody may want to keep
 * most of the distance and only take the edge off the landing.
 *
 * What it leaves on the card is the halving, which is read when the collision is finally
 * entered - by whoever threw them, minutes later. The card is the only thing that will
 * still know this was answered.
 */
async function playSuddenStop(message, actor, maneuver) {
  const clash = beingMovedOn(message, actor);
  if (!clash || clash.suddenStop) return;

  // "Up to 1/2 of your Might", rounded down, as every half in these rules is.
  const most = Math.floor(Math.max(0, actor.system.might ?? 0) / 2);

  const typed = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: maneuver.name },
    content: `
      <label class="dbu-wager">
        <span>Squares cut</span>
        <input type="number" name="squares" value="${most}" min="0" max="${most}"/>
        <em>Up to ${most} - half your Might, rounded down. Any Collision Damage from this
          movement is halved either way, and you ignore any Feature or Environment
          Qualities that would have applied to it.</em>
      </label>`,
    buttons: [
      {
        action: "confirm",
        label: "Dig in",
        callback: (event, button, dialog) => {
          const value = Math.floor(Number(dialog.element.querySelector('input[name="squares"]').value));
          return Number.isFinite(value) ? Math.min(Math.max(0, value), most) : 0;
        }
      },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });

  if (typeof typed !== "number") return;

  // Paid once the number is in, so backing out of the question costs nothing. No Ki -
  // "KP Cost: N/A" - so the Counter Action is the whole price.
  if (!await spendActions(actor, maneuver.actionCost ?? 1, "counter")) return;

  // A Counter Maneuver is a Maneuver of another kind, so it releases the Instant rule.
  await recordManeuverType(actor, "counter");

  await requestEdit(message, {
    type: "clash",
    clash: {
      ...clash,
      suddenStop: { actorUuid: actor.uuid, squares: typed },
      collision: { ...clash.collision, halves: true, halvedBy: maneuver.name }
    }
  });

  await settledNote(message,
    `${actor.name} digs in${typed ? `, and moves ${typed} Square${typed === 1 ? "" : "s"} `
      + "fewer" : ""}. Any Collision Damage from this movement is halved, and they ignore `
    + "any Feature or Environment Qualities that would have applied to it.");

  // "If you end this movement without Collision, you may use the Movement Maneuver as an
  // Out-of-Sequence Maneuver." Whether anything was hit is the table's, so the offer goes
  // up with its condition written on it rather than being withheld until a machine can
  // tell - an offer nobody may take is worse than one that says when it may be taken.
  if (actor.items.some(item => (item.type === "maneuver") && item.system.movement)) {
    requestEdit(message, {
      type: "offer",
      offer: {
        actorUuid: actor.uuid,
        actorName: actor.name,
        maneuverId: "movement",
        maneuverName: "Movement",
        reason: "Sudden Stop - only if that movement ended without a Collision"
      }
    });
  }
}

/** Take back a response, refunding what it cost to the Actor that played it. */
async function cancelInstant(message, actor, response) {
  const maneuver = getManeuver(response.maneuverId);
  if (maneuver) await refundManeuverCost(actor, maneuver);
  requestEdit(message, { type: "cancel", actorUuid: response.actorUuid });
}

/** Flag holding a Skill Clash's two sides. */
const CLASH_FLAG = "clash";

/** Flag holding a declared attack and, once resolved, how it went. */
const ATTACK_FLAG = "attack";

/**
 * Whoever has already taken what a card offered them.
 *
 * Written as a bare uuid once, so a card from before that reads as a list of one.
 */
function takenOffers(message) {
  const held = message.getFlag(SCOPE, OOS_TAKEN_FLAG);
  if (!held) return [];
  return Array.isArray(held) ? held : [held];
}

/** Flag holding a Moment the table has been called to answer. */
const MOMENT_FLAG = "moment";

/**
 * Rapid Movement, on the Movement card that was paid for with it.
 *
 * On the card rather than on the character because the rule is about a particular use:
 * "an Exploit Maneuver provoked by this instance of Movement". Two Movements in a round
 * with Rapid Movement on one of them is exactly the case that tells the two apart.
 */
const RAPID_FLAG = "rapidMovement";

/**
 * A Movement Maneuver, on its own card: who moved, and what it cost them.
 *
 * The cost is carried because of the Blockade Maneuver - "they regain any Actions or Ki
 * Points spent" - and a refund made from a card has no other way to know what to give
 * back. `stopped` is whether a Blockade has already cut this Movement off: one Movement
 * is stopped once, however many people were standing in the way.
 */
const MOVEMENT_FLAG = "movement";

/**
 * A poison waiting on a Medicine Skill Check that this system cannot judge.
 *
 * The Treatment Maneuver's second route: "if they gained the Poisoned Combat Condition
 * other than through the effects of another Character, simply make an Medicine Skill Check
 * with the Apprentice Difficulty to remove the poison." There are no Difficulty Categories
 * here, so the Check is rolled from the sheet - where the Base Die, the critical, the Botch
 * and the Karmic Effects already live - and this is the button that takes the poison off
 * once the table says it was made.
 */
const CURE_FLAG = "curePoison";

/**
 * An Item left on the ground for whoever moves through it - Caltrops. The card is posted
 * when it is scattered and stays for as long as the table says it lies there.
 */
const HAZARD_FLAG = "gearHazard";

/** A scan by an Item - the Scout Scope - waiting for the one scanned to answer it. */
const SCAN_FLAG = "gearScan";

/**
 * Whatever the character's effects contribute at one Moment.
 *
 * The engine is asked rather than any particular Trait, so a Talent, a Racial Trait and
 * a Combat Condition all reach a roll through the same door.
 */
function atMoment(actor, moment, context = {}) {
  const scope = { data: actor.system, errors: [], context, queue: [] };
  const collected = collectReactive(reactiveFor(actor), moment, scope);
  // The queue travels with the result: a verb is an act the caller has to carry out,
  // and one collected into a scope nobody reads is an effect that does nothing.
  return { ...collected, queue: scope.queue, errors: scope.errors };
}

/**
 * Extra Dice as named groups, however the caller chose to say it.
 *
 * A bare formula is the Tier of Power Extra Dice every Combat Roll carries, which is
 * what every caller used to pass and what most of them still mean.
 */
function asDiceGroups(extraDice) {
  if (!extraDice) return [];
  if (Array.isArray(extraDice)) return extraDice;
  return [{ label: "Extra dice", formula: String(extraDice) }];
}

/**
 * How many dice a formula of ours rolls.
 *
 * Ours are always "NdM" joined by plus signs - written by this system, never typed by a
 * player - so counting the dice in one is counting the "d"s. It is only ever used to
 * share the rolled terms back out among the groups that asked for them, in the order
 * they were joined.
 */
function diceTermCount(formula) {
  return (String(formula).match(/\d*d\d+/gi) ?? []).length;
}

/**
 * A roll's dice, as the rows they make.
 *
 * The Base Die first and on its own, because the Natural Result is read off it and
 * nothing else - a Botch and a Critical both turn on that one number. Then one row per
 * source: the Extra Dice the Tier of Power grants, a State's Greater Dice, what the
 * Energy Charges are worth, the Critical Extra Dice. They were rolled together, but
 * "where did this die come from" is the question a player actually asks of them.
 *
 * The Base Die is `roll.dice[0]`: the formula is built with it first for exactly this
 * reason, and the groups follow it in the order they were joined.
 */
function rolledDice(roll, { rolled, natural, forcedNatural }, groups = [], criticalTerms = []) {
  const [base, ...extras] = roll.dice ?? [];
  const rows = [baseDieLine(base?.expression ?? DBUCharacterData.BASE_DIE,
    { rolled, natural, forcedNatural })];

  let at = 0;
  for (const group of groups) {
    const count = diceTermCount(group.formula);
    const line = extraDiceLine(extras.slice(at, at + count), group.label);
    at += count;
    if (line) rows.push(line);
  }

  // Anything the groups did not account for still belongs to somebody, so it is shown
  // rather than dropped - a die that vanishes off the card is worse than one labelled
  // vaguely, and this is the only place a miscount could hide.
  const leftover = extraDiceLine(extras.slice(at), "Extra dice");
  if (leftover) rows.push(leftover);

  // Read off the Base Die, so a Karmic Chance that replaces that die replaces these too.
  const crit = fromOutcome(extraDiceLine(criticalTerms, "Critical"));
  if (crit) rows.push(crit);

  return rows;
}

/**
 * Settle one side of an opposed roll into a single number.
 *
 * Unlike a standalone check, an opposed roll cannot leave the critical die to a
 * button: the two sides are compared against each other, so a total that might still
 * grow is not yet a result. Both outcomes are therefore applied here and now.
 */
async function rollSide(actor, modifiers, { extraDice = "", criticalDice, combatRoll = false,
                                           slot = null, collect = true,
                                           attackingManeuver = false,
                                           minimumNatural = 0, criticalTarget = null,
                                           botchUnlessCritical = false,
                                           naturalAdd = 0 } = {}) {
  // A single netted number cannot be taken apart again, so what went into it is kept
  // as labelled parts and only summed for the roll itself.
  const parts = (typeof modifiers === "number") ? [{ label: "Bonus", value: modifiers }] : modifiers;

  // Penalties cancel bonuses; they never drag a roll below the dice. A Strike with more
  // taken off it than it had adds nothing rather than subtracting - so a roll always
  // comes to at least what the dice said, which is why an opponent who forgoes their
  // own roll can still be hit.
  const netted = parts.reduce((sum, part) => sum + part.value, 0);
  const bonus = Math.max(0, netted);

  // Asked before the dice are picked up, because an effect that sets the Base Die
  // replaces the roll rather than adjusting it: rolling a d10 and then throwing the
  // result away puts a number on the card that means nothing.
  // Not collected when the same roll is being made again as a measurement rather than
  // as an exchange - Combination's three follow-up Strikes. A one-shot effect answers
  // the roll it was armed for, and offering it once per repetition would spend it three
  // more times over.
  const answered = (combatRoll && collect)
    ? atMoment(actor, "combat-roll", { roll: true, attackingManeuver })
    : null;
  const baseDie = answered?.slots?.baseDie ?? null;
  const forcedNatural = baseDie?.set ?? null;

  // What a triggered effect adds to this roll. "1/Round: increase your Strike Rolls by
  // 2(T)" is the commonest shape in the rulebook, and it is written against the same
  // Slot the sheet shows - `strike`, `dodge`, `wound`, or `combatRolls`, which fans out
  // to all three. Applied here rather than folded into the sheet, because a triggered
  // effect is not true until it is used.
  if (answered && slot) {
    const before = parts.reduce((sum, part) => sum + part.value, 0);
    const after = applySlot(answered.slots, slot, before);
    if (after !== before) parts.push({ label: "Effects", value: after - before });
  }

  // Dice an effect adds to every Combat Roll - the Superior State's Greater Dice are
  // the one thing in the rules that does this. Folded when the character was prepared,
  // so they are read off the sheet rather than collected again here. The Slot was
  // declared and read by nobody, which made that half of Superior do nothing at all.
  const standing = combatRoll
    ? (actor.system.effects?.slots?.["combatRolls.dice"] ?? [])
    : [];

  // Every Extra Die with the name of whatever granted it, kept apart all the way to
  // the card. They are rolled together - one formula, one Roll - but a player looking
  // at a fistful of dice wants to know which rule handed them each one, so the groups
  // are carried alongside and the results shared back out afterwards.
  const groups = [
    ...asDiceGroups(extraDice),
    ...standing.map(die => ({ label: die.source || "Greater dice", formula: die.formula }))
  ].filter(group => group.formula);

  const evaluated = await evaluateCheck(actor, bonus,
    groups.map(group => group.formula).join(" + "), baseDie,
    { minimumNatural, criticalTarget, combatRoll: true, naturalAdd });
  const { roll, naturalShift } = evaluated;
  let { natural, botch, critical } = evaluated;

  // Cutting: "if you do not score a Critical Result, then you score a Botch Result
  // regardless of the Natural Result." Every roll that is not the best is the worst, and
  // the Natural Result stops being consulted at all - which is why it is written here
  // rather than as a Botch Range, a Range being a thing the Natural Result is read
  // against.
  const botchedByRule = botchUnlessCritical && !critical;
  if (botchUnlessCritical) botch = botchedByRule;
  // What the die actually showed, before an effect moved it. The shift is the whole of
  // the difference, so this is the one subtraction that recovers it.
  const rolled = natural - naturalShift;

  // Anything the player armed for this roll has now been used, whether it set the Base
  // Die or added to the total. Only the armed ones: an automatic effect swept up by the
  // same collection is not consumed by applying.
  if (answered) spendChosen(actor, answered);

  // The die was rolled at its face value and then adjusted, so the sum it was rolled
  // into carries the same adjustment. Shown beside the die rather than among the
  // penalties: a penalty line reads as "Natural Result 3" and the amount subtracted is
  // then indistinguishable from the result itself.
  let total = roll.total + naturalShift;
  let outcome = "";
  let criticalTerms = [];

  // A willing failure is decided before the dice are read: the total is 0 whatever
  // they said, so nothing that would raise or lower it is worked out at all - unless
  // something forbids it, which Compelled does to every Combat Roll a character makes.
  // Left armed rather than spent, so it still answers the next roll that allows it.
  const forced = whyNotWilling(actor, { slots: answered?.slots });

  // Declared, and refused by the roll itself. It used to be dropped in silence, which
  // left the player believing they had failed on purpose and looking at a total that
  // said otherwise. Kept armed, as below, so it still answers the next roll that allows
  // it - but the card says why this one did not take it.
  const refusedWilling = actor.system.willingFailure && Boolean(forced);

  if (actor.system.willingFailure && !forced) {
    requestActorUpdate(actor, { "system.willingFailure": false });
    // The dice are shown even though they did not count: a player who threw a roll
    // wants to see what they threw away, and a card that hides it looks like a bug.
    const thrown = [
      ...rolledDice(roll, { rolled, natural, forcedNatural }, groups),
      noteLine("Willing failure - the total is 0")
    ];
    return {
      actorUuid: actor.uuid,
      actorName: actor.name,
      natural,
      total: 0,
      outcome: "willing",
      lines: thrown,
      breakdown: breakdownText(thrown, 0)
    };
  }

  // One line per thing that moved the number, gathered in whatever order the maths
  // happens and put in reading order when it is drawn. The Critical Extra Dice join
  // the rest below, once it is known whether there are any.
  const lines = [];

  for (const part of parts) {
    // A part worth nothing is left out rather than shown as zero: a row saying a
    // Threshold took nothing off is a row to read past.
    if (part.value) lines.push(partLine(part));
  }

  // The floor the penalties met, shown rather than left for the reader to discover by
  // failing to add the column up.
  // `bonus` is where the penalties came to rest, which is what the row says. The
  // difference is only how far they overran, and saying that as "+3" read as a bonus.
  const held = floorLine(bonus - netted, bonus,
    "Penalties took the bonuses to nothing, and stop there");
  if (held) lines.push(held);

  // Said out loud, because it is why the roll happened at all: the player asked to fail
  // and the roll would not let them.
  if (refusedWilling) {
    outcome = "urgent";
    lines.push(noteLine("Urgent - a willing failure was refused"));
  }

  // Marked as the Base Die's doing, like the Botch row it explains: replace the die and
  // this has to go with it, or a roll rerolled into a Critical keeps a line saying it
  // was not one.
  if (botchedByRule) {
    lines.push(fromOutcome(noteLine("Anything short of a Critical Result is a Botch")));
  }

  if (botch) {
    // A Skill roll loses 2 flat; every other roll loses 2(bT). One flat constant was
    // right only while the Base Tier was 1, so from Power Level 5 a botched Combat Roll
    // was costing half of what it should.
    const penalty = combatRoll
      ? (actor.system.botch?.penalty ?? DBUCharacterData.BOTCH_PENALTY)
      : (actor.system.botch?.skill ?? DBUCharacterData.BOTCH_PENALTY);
    total -= penalty;
    outcome = "botch";
    lines.push(fromOutcome(partLine({
      label: "Botch",
      // The notation the rulebook states it in, which is not the same question as what
      // it came to - 2(bT) is 6 at Base Tier 3, and both are worth seeing.
      written: combatRoll ? "-2(bT)" : "-2",
      value: -penalty,
      rank: "botch"
    })));
  }
  else if (critical) {
    const extra = new Roll(criticalDice);
    await extra.evaluate();
    total += extra.total;
    outcome = "critical";
    // Extra Dice like any other, and shown with them: a player counting what they threw
    // does not care which rule put each die in their hand.
    criticalTerms = extra.dice;
  }

  // Drawn now rather than first, so the Critical Extra Dice are among them.
  lines.unshift(...rolledDice(roll, { rolled, natural, forcedNatural }, groups, criticalTerms));

  // The finished total is a system value like any other: a Botch takes what it takes,
  // but never past zero. Otherwise a bad roll turns into a negative that an opponent
  // has to beat from below, which is not a thing the rules ask anyone to do.
  // Marked as the Base Die's doing, because only a Botch can drive a total under zero -
  // the bonuses are already floored at nothing and the dice never come to less. So when
  // Karmic Chance replaces the die the Botch goes, and this has to go with it. Left
  // standing, a roll rerolled out of its Botch kept a row saying it had been rescued
  // from a negative it no longer had.
  const floored = fromOutcome(floorLine(Math.max(0, total) - total, 0,
    "A Botch takes what it takes, and stops at nothing"));
  if (floored) lines.push(floored);
  total = Math.max(0, total);

  return {
    actorUuid: actor.uuid,
    actorName: actor.name,
    natural,
    // What the dice and the bonuses came to before a Botch or a Critical touched it.
    // Karmic Chance replaces the Base Die and re-reads the result from scratch, so it
    // needs the total without the old die's consequences already baked in.
    //
    // With the Skill's own move to the Natural Result in it, where there was one, because
    // Karmic Chance moves the new die the same way and takes the old one out whole.
    beforeOutcome: roll.total + (naturalAdd ? naturalShift : 0),
    // What this particular roll does that the character's own sheet does not say, kept
    // with it because Karmic Chance replaces the Base Die and settles the outcome again
    // from scratch. Read off the sheet alone, that second reading loses whatever the
    // Profile brought - a Cutting attack rerolled into a 9 stopped being a Botch, which
    // is the one thing Cutting says it always is.
    rules: { minimumNatural, criticalTarget, botchUnlessCritical, naturalAdd,
             // The range this roll was measured against, so Karmic Chance rolls the
             // replacement under it rather than under whichever one it guesses at.
             botchRange: botchRangeFor(actor, true) },
    // What went into it besides the dice, so the same roll can be made again without
    // rebuilding it from the sheet - which would quietly drop whatever an effect added.
    bonus,
    criticalDice,
    total,
    outcome,
    // The workings as rows. The one-line form is derived from them rather than built
    // beside them: two descriptions of one roll drift, and the one that drifts is
    // always the one nobody is looking at.
    lines,
    breakdown: breakdownText(lines, total)
  };
}

/**
 * Open a Skill Clash. Nothing is rolled yet: both sides are rolled together the
 * moment the defender accepts.
 *
 * Rolling the challenger's die up front would hand whoever saw it an advantage, and
 * hiding it in the message would not help - a stored number can be read out of the
 * flag. The only way for neither side to know the other's result in advance is for
 * neither result to exist yet.
 */
/**
 * What each side of a Clash rolls, by category.
 *
 * A Clash is always the same category on both sides - that is the whole reason the
 * categories exist, since a Skill and a Might scale differently and comparing them
 * would be comparing nothing. So the category is a property of the Clash and each side
 * reads its own number the same way.
 */
const CLASH_ROLLS = ({
  skill: {
    label: "Skill Clash",
    family: "skill",
    /**
     * "A Clash (Bluff vs Intuition)", and "(Bluff vs Intuition/Perception)" where the
     * defender has a choice. Every Skill Clash written before those names one Skill and
     * both sides roll it, which is what an empty list means and what every Clash opened
     * before this carries.
     */
    of: (actor, clash, uuid) => {
      const key = skillPicked(clash, uuid);
      return {
        label: actor.system.skills[key]?.label ?? clash.skillLabel,
        value: actor.system.skills[key].roll
      };
    },

    // "Increase the Dice Score of your Skill Checks ... in Clashes against a Seen Opponent
    // by 2." Here rather than on the Skill itself, because "in Clashes" is the whole of the
    // scope and "against a Seen Opponent" has no meaning off one.
    parts: (actor, clash, uuid) => [
      ...seenBonus(actor, clashOpponent(clash, uuid), "skill"),
      ...terrifyPenalty(actor, clash, uuid)
    ],

    criticalDice: () => DBUCharacterData.SKILL_CRITICAL_DIE,

    // What the Skill does to its own Natural Result - and, where the side said the Check
    // relies on sight, that part too.
    options: (actor, clash, uuid) => ({
      naturalAdd: skillNatural(actor, skillPicked(clash, uuid),
        (clash.sightBy ?? []).includes(uuid))
    }),

    prompt: (actor, clash, uuid) => ((uuid === clash.defenderUuid)
      && ((clash.defenderSkills ?? []).length > 1))
      ? (clash.defenderSkills ?? []).map(key => skillLabel(actor, key)).join(" or ")
      : skillLabel(actor, skillPicked(clash, uuid)),

    // The defender's question alone: the challenger's Skill is named outright by the rule,
    // and there is nothing for them to choose between.
    choose: async (clash, actor) => {
      const offered = clash.defenderSkills ?? [];
      if ((actor.uuid !== clash.defenderUuid) || (offered.length < 2)) return {};

      const chosen = await pick(
        `${clash.maneuverName} - ${actor.name}`,
        "Answer the Clash with which Skill?",
        offered.map(key => ({
          action: key,
          label: `${skillLabel(actor, key)} ${actor.system.skills[key]?.roll ?? 0}`
        }))
      );
      if (!chosen) return null;
      return { defenderSkill: chosen };
    }
  },
  might: {
    label: "Might Clash",
    family: "might",
    // Or what stands in for it, where the card names one - the Net's recorded Scholarship
    // Modifier: "substitute your Might with this recorded Scholarship Modifier for any Might
    // Clashes made through the effects of this Basic Item".
    of: (actor, clash, uuid) => {
      const own = clash?.mightFor?.[uuid];
      return Number.isFinite(own)
        ? { label: clash.mightLabel || "Might", value: own }
        : { label: "Might", value: actor.system.might };
    },
    // Might is not a Skill, so it does not take a Skill's flat critical die - it takes
    // the character's own, which grows with the Tier of Power.
    criticalDice: (actor) => actor.system.dice.critical.formula,

    // The first thing to put a row on a Might Clash: "if that Opponent's Tier of Power is
    // higher than yours, reduce your Dice Score for this Clash by 1(T)."
    //
    // And the second: what Local Space and Deep Space add to a Knockback that brought its
    // own Advantage. The challenger's alone - it is their Might the rule raises, and the
    // Clash is one they initiated.
    parts: (actor, clash, uuid) => [
      ...transfigurationPenalty(actor, clash, uuid),
      ...(((uuid === clash.challengerUuid) && clash.mightBonus)
        ? [{ label: "Knockback in space", value: clash.mightBonus }]
        : [])
    ]
  },

  /**
   * "A Clash (Strike vs Strike/Dodge)" - the Grapple Check, and the Thrust Maneuver's
   * first Clash, which is the same pair of rolls under another name.
   *
   * The first Clash here with two different rolls in it. The Initiator rolls their
   * Strike; the Defender answers with their Strike or their Dodge, and which is theirs
   * to pick - so this is also the first that asks a side a question before rolling.
   *
   * What a card calls itself is the card's own business - `clashLabel` - because the
   * rules name this pair twice: a Grapple Check when a Grapple asks for it, and nothing
   * in particular when a Thrust does.
   *
   * Initiator and Defender are the Grapple's, not the card's, and they do not swap: "the
   * Grappler is still considered the Initiator and the Grappled is still considered the
   * Defender for any further Grapple Checks made within the Grapple, regardless of who
   * initiated the Grapple Check." So an escape attempt is opened by the Grappled and is
   * still rolled with the Grappler as challenger - which is also what decides the tie,
   * since a tie goes to the Defender here as everywhere else.
   */
  strike: {
    label: "Strike Clash",
    // Strike and Dodge are Combat Rolls, so this is a Combat Roll Clash - which is what
    // makes Compelled's "your Combat Rolls are Urgent" reach a Grapple Check.
    family: "combat",
    of: (actor, clash, uuid) => ((uuid === clash.defenderUuid) && (clash.defenderRoll === "dodge"))
      ? { label: "Dodge", value: actor.system.combat.dodge }
      : { label: "Strike", value: actor.system.combat.strike },

    criticalDice: (actor) => actor.system.dice.critical.formula,

    // What else a Combat Roll carries. Diminishing Offense is deliberately absent: it
    // blunts "the Strike Roll of every Attacking Maneuver", and this is not one.
    parts: (actor, clash, uuid) => [
      ...musclePenalty(actor),
      ...thresholdPenalty(actor),
      // "For each Action spent after the first, increase the Dice Score of their Grapple
      // Check by 1(T) until the end of their turn." What the attempts already made this
      // turn are worth to this one - so the first is at nothing and every one after it
      // is better than the last.
      ...(((uuid === clash.defenderUuid) && clash.defenderBonus)
        ? [{ label: "Earlier attempts", written: `+${clash.earlierAttempts}(T)`,
             value: clash.defenderBonus }]
        : []),
      // "Increase all of your Grapple Checks made as the Grappled by 1(T)." The Grappled is
      // always the Defender of a Grapple Check, whoever opened it - so this is the one
      // place a bonus that names that side can land.
      ...(((uuid === clash.defenderUuid) && clash.grapple)
        ? grappleDefenceParts(actor)
        : []),
      // "Make a Grapple Check against the Grappled with your Dice Score reduced by
      // 1(bT)." The Grappler's alone, and the only Grapple Check made at a penalty.
      ...(((uuid === clash.challengerUuid) && (clash.grapple?.kind === "pin"))
        ? [{ label: "Pinning", written: "-1(bT)",
             value: -Math.max(1, actor.system.baseTierOfPower ?? 1) }]
        : [])
    ],

    options: (actor, clash, uuid) => ({
      extraDice: actor.system.dice.extra.formula,
      combatRoll: true,
      // Which Slot an effect that raises this roll writes to, so "increase your Strike
      // Rolls by 2(T)" reaches a Grapple Check made with Strike and leaves alone one
      // answered with a Dodge.
      slot: ((uuid === clash.defenderUuid) && (clash.defenderRoll === "dodge")) ? "dodge" : "strike"
    }),

    prompt: (actor, clash, uuid) => (uuid === clash.defenderUuid)
      ? (clash.dodgeOnly ? "Dodge" : "Strike or Dodge")
      : "Strike",

    // The Defender's question, asked before they are marked ready and before either side
    // has seen a number.
    choose: async (clash, actor) => {
      if (actor.uuid !== clash.defenderUuid) return {};
      // "Strike vs Dodge": nothing to choose.
      if (clash.dodgeOnly) return { defenderRoll: "dodge" };

      const chosen = await pick(
        `${clash.maneuverName} - ${actor.name}`,
        `Answer the ${clash.clashLabel ?? "Clash"} with which roll?`,
        [
          { action: "strike", label: `Strike ${actor.system.combat.strike}` },
          { action: "dodge", label: `Dodge ${actor.system.combat.dodge}` }
        ]
      );
      return chosen ? { defenderRoll: chosen } : null;
    }
  },

  /**
   * A Clash of Saving Throws. The Thrust Maneuver's second one is the first there has
   * ever been, though "save" has been one of the four categories since they were told
   * apart - and until now nothing could open one.
   *
   * Which Saving Throw is the card's, in `clash.saves`, because the rule that asks for
   * one names them: "a second Clash (Impulsive/Corporeal)". Where it names more than
   * one, each side picks from that list.
   *
   * Not a Combat Roll and not a Skill, so it takes the character's own Critical Extra
   * Dice, and its Critical Target is its own: a racial Saving Throw "crits one point
   * more easily", which the sheet works out and nothing had ever read.
   */
  save: {
    label: "Saving Throw Clash",
    family: "save",

    of: (actor, clash, uuid) => {
      const key = savePicked(clash, uuid);
      const save = actor.system.savingThrows[key];
      return { label: save?.label ?? key, value: save?.value ?? 0 };
    },

    criticalDice: (actor) => actor.system.dice.critical.formula,

    // "...and Saving Throws in Clashes against a Seen Opponent by ... 1(T)." The other
    // half of the same sentence, and a different number - which is why they are two rows.
    parts: (actor, clash, uuid) => seenBonus(actor, clashOpponent(clash, uuid), "save"),

    options: (actor, clash, uuid) => ({
      criticalTarget: actor.system.savingThrows[savePicked(clash, uuid)]?.criticalTarget ?? null,
      // Which Slot an effect that raises this roll writes to, so "increase your Corporeal
      // Saving Throws by 1(T)" reaches the side that answered with Corporeal.
      slot: `save.${savePicked(clash, uuid)}`
    }),

    prompt: (actor, clash, uuid) => (savesOffered(clash, uuid).length > 1)
      ? savesOffered(clash, uuid).map(key => saveLabel(actor, key)).join(" or ")
      : saveLabel(actor, savePicked(clash, uuid)),

    // Whoever was offered a choice is asked, which where the rule names one list is both
    // sides and where it names two is whichever side got the longer one.
    choose: async (clash, actor) => {
      const offered = savesOffered(clash, actor.uuid);
      if (offered.length < 2) return {};

      const chosen = await pick(
        `${clash.maneuverName} - ${actor.name}`,
        "Answer the Clash with which Saving Throw?",
        offered.map(key => ({
          action: key,
          label: `${saveLabel(actor, key)} ${actor.system.savingThrows[key]?.value ?? 0}`
        }))
      );
      if (!chosen) return null;
      return (actor.uuid === clash.defenderUuid)
        ? { defenderSave: chosen }
        : { challengerSave: chosen };
    }
  }
});

/**
 * The alias the cards already in people's chat logs are keyed by.
 *
 * The pair used to be called "grapple", which named one of its two users rather than
 * what it rolls. A card posted before the rename still says so, and rendering it as a
 * Skill Clash - which is what an unrecognised key falls back to - would be worse than
 * the name being old.
 */
CLASH_ROLLS.grapple = CLASH_ROLLS.strike;
Object.freeze(CLASH_ROLLS);

/**
 * What an effect adds to a Grapple Check you make as the Grappled.
 *
 * Its own Slot rather than `strike`, because the rule names the side: a Grapple Check made
 * as the Grappler is a Strike Roll like any other and gets nothing from this.
 *
 * Returned as a list so it drops out of the breakdown entirely rather than showing as a
 * row worth nothing.
 */
function grappleDefenceParts(actor) {
  const value = Math.round(applySlot(actor.system.effects?.slots, "grapple.defending", 0));
  return value ? [{ label: "Grappled", value }] : [];
}

/**
 * Which Skill this side of a Clash is rolling.
 *
 * The challenger rolls the one the rule names. The defender rolls whichever of theirs they
 * picked, or the first they were offered if they have not been asked - and the
 * challenger's own Skill where the rule named none for them, which is every Skill Clash
 * written before a rule named two.
 */
function skillPicked(clash, uuid) {
  if (uuid !== clash.defenderUuid) return clash.skill;
  const offered = clash.defenderSkills ?? [];
  return clash.defenderSkill || offered[0] || clash.skill;
}

/** A Skill's name, as the character's own sheet gives it. */
function skillLabel(actor, key) {
  return actor.system.skills?.[key]?.label
    ?? `${key.charAt(0).toUpperCase()}${key.slice(1)}`;
}

/**
 * Which Saving Throw this side of a Clash is answering with.
 *
 * `saves` is what the rule named, and `defenderSaves` is what it named for the other side
 * where it named something different: "(Impulsive vs Impulsive/Corporeal)" is one for the
 * challenger and two for the defender, where "(Impulsive/Corporeal)" with no `vs` in it is
 * one list offered to both.
 */
function savesOffered(clash, uuid) {
  const theirs = clash.defenderSaves ?? [];
  return ((uuid === clash.defenderUuid) && theirs.length) ? theirs : (clash.saves ?? []);
}

function savePicked(clash, uuid) {
  const offered = savesOffered(clash, uuid);
  const chosen = (uuid === clash.defenderUuid) ? clash.defenderSave : clash.challengerSave;
  return chosen || offered[0] || "impulsive";
}

/** A Saving Throw's name, as the character's own sheet gives it. */
function saveLabel(actor, key) {
  return actor.system.savingThrows[key]?.label
    ?? `${key.charAt(0).toUpperCase()}${key.slice(1)}`;
}

/**
 * Two buttons and a question, the way the Maneuver module asks one.
 *
 * Written out here rather than imported: maneuvers.mjs imports from this module, and a
 * second edge between the two would close a cycle.
 */
async function pick(title, question, buttons) {
  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title },
    content: `<p>${Handlebars.escapeExpression(question)}</p>`,
    buttons: [...buttons, { action: "cancel", label: "Cancel" }],
    rejectClose: false
  });
  return (chosen && (chosen !== "cancel")) ? chosen : null;
}

export async function postSkillClash(actor, target, maneuver, leaves = {}) {
  const skillKey = maneuver.clash.skill;

  // The Skills the other side may answer with, where the rule names something other than
  // the challenger's. Empty on every Clash that names one Skill, and read there as "the
  // same one again"; more than one is a question the defender is asked before they roll.
  const offered = [...(maneuver.clash.defenderSkills ?? [])];

  // Handed back for the reason postManeuver hands its card back: which card a Maneuver
  // was played on is part of the Instant rule.
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: "",
    flags: {
      [SCOPE]: {
        // A Skill Clash is still a Maneuver: if it is Standard, it can be answered.
        [RESPONDABLE_FLAG]: isRespondable(maneuver),
        [CLASH_FLAG]: {
          category: "skill",
          skill: skillKey,
          skillLabel: actor.system.skills[skillKey].label,
          defenderSkills: offered,
          // Which of them they took. Unset until they say, and they are asked before
          // either side has seen a number - as a Saving Throw Clash asks.
          defenderSkill: "",
          maneuverName: maneuver.name,
          challengerUuid: actor.uuid,
          challengerName: actor.name,
          defenderUuid: target.uuid,
          defenderName: target.name,
          // Winning buys a choice of three, offered on the card once the dice are in -
          // "if you win, apply one of the following effects" is a choice made after them.
          dirtyTrick: maneuver.dirtyTrick ? { chosen: "", applied: false } : null,
          // And what settling this one leaves behind, whatever it is called - the same
          // arrangement a Saving Throw Clash has, and for the same reason: naming the keys
          // one at a time is how the Blockade's payload went missing.
          ...leaves,
          // Winning hands over a Basic Attack with conditions attached, which travel with
          // the offer rather than being remembered anywhere.
          feint: maneuver.feint ? { applied: false } : null,
          // Who has finished preparing. Neither side's dice are picked up until both
          // appear here: each may have a willing failure or an effect to declare, and
          // a roll made while the other was still deciding cannot be taken back.
          ready: [],
          // Both sides land here at once, or not at all.
          result: null
        }
      }
    }
  });
}

/**
 * Open a Grapple Check between the two halves of a Grapple.
 *
 * The challenger is always the Grappler and the defender always the Grappled, whichever
 * of them opened it: "the Grappler is still considered the Initiator and the Grappled is
 * still considered the Defender for any further Grapple Checks made within the Grapple,
 * regardless of who initiated the Grapple Check." For the first Check that is simply
 * whoever used the Maneuver and whoever they aimed it at.
 *
 * `kind` is what winning buys - "start" for the Maneuver's own Check, "escape" for the
 * one the Grappled pays Actions for - and it is settled here rather than worked out
 * later, because the card is the only thing that will still know.
 *
 * @param {number} earlierAttempts  How many Actions the Grappled has already spent trying
 *                                  to break free this turn, not counting this one. Each
 *                                  is worth 1(T) on the Dice Score of this Check.
 */
export async function postGrappleCheck(grappler, grappled, {
  maneuverName = "Grapple", reason = "", kind = "start", earlierAttempts = 0, speaker = null,
  maneuver = null
} = {}) {
  const tier = Math.max(1, grappled.system.tierOfPower ?? 1);

  return ChatMessage.create({
    speaker: speaker ?? ChatMessage.getSpeaker({ actor: grappler }),
    content: "",
    flags: {
      [SCOPE]: {
        // The Grapple Maneuver is a Standard Maneuver, so an Instant can be played in
        // answer to it - the same as a Skill Clash, which is also a Maneuver wearing a
        // Clash. An escape Check is not one: it is Actions spent, and there is nothing
        // there to answer.
        [RESPONDABLE_FLAG]: Boolean(maneuver) && isRespondable(maneuver),
        [CLASH_FLAG]: {
          category: "strike",
          // "This Clash is known as a Grapple Check", which is the card's name for it
          // and not the name of the pair of rolls underneath.
          clashLabel: "Grapple Check",
          maneuverName,
          reason,
          challengerUuid: grappler.uuid,
          challengerName: grappler.name,
          defenderUuid: grappled.uuid,
          defenderName: grappled.name,
          // Which roll the Defender answers with. Unset until they say, and they are
          // asked before either side has seen a number.
          defenderRoll: "",
          earlierAttempts,
          defenderBonus: earlierAttempts * tier,
          // Winning a Launch throws somebody several Squares in a direction of your
          // choosing, and a Character sent that far can end up hitting something. That
          // is the question Knockback already asks, so the card asks it the same way:
          // this is what draws the collision button once the Check is won. Nothing
          // doubles it - the Launching Profile doubles a Knockback's collision, and this
          // is the Launch Maneuver, which is a different thing with a similar name.
          collision: (kind === "launch") ? { doubles: false, doubledBy: "" } : null,
          collisionApplied: false,
          grapple: { kind, applied: false },
          ready: [],
          result: null
        }
      }
    }
  });
}

/**
 * Open the Thrust Maneuver's first Clash.
 *
 * "Target an Opponent within your Melee Range and make a Clash (Strike vs Strike/Dodge)
 * against them." The same pair of rolls a Grapple Check is made of, under another name -
 * so it is opened as the same category with a label of its own, rather than as a second
 * copy of the same thing.
 *
 * Nothing is decided here beyond who is rolling. "If you win, choose one of the effects
 * below" is a choice made after the roll, and the card is what offers it.
 */
export async function postThrust(actor, target, maneuver) {
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: "",
    flags: {
      [SCOPE]: {
        // A Standard Maneuver, so an Instant can be played in answer to it.
        [RESPONDABLE_FLAG]: isRespondable(maneuver),
        [CLASH_FLAG]: {
          category: "strike",
          clashLabel: "Thrust",
          maneuverName: maneuver.name,
          reason: `${actor.name} shoves ${target.name}. Win and they are pushed back or `
            + "put on the ground.",
          challengerUuid: actor.uuid,
          challengerName: actor.name,
          defenderUuid: target.uuid,
          defenderName: target.name,
          defenderRoll: "",
          // Push Back doubles the Collision Damage, and that is armed when Push Back is
          // chosen rather than now: choosing the other effect must not leave a collision
          // button on a card where nobody was moved.
          collision: null,
          collisionApplied: false,
          thrust: { stage: "strike", applied: false, chosen: "" },
          ready: [],
          result: null
        }
      }
    }
  });
}

/**
 * Open a Might Clash between two characters.
 *
 * Might on both sides - it is one of the four categories a Clash can be, and the only
 * one that is a single value rather than a family of them. Nothing is rolled yet, for
 * the reason nothing is ever rolled yet: both sides may have something to declare, and
 * whoever saw the other's number first would be deciding with an advantage.
 *
 * `reason` is what the card says this Clash is for, since a Might Clash arrives out of
 * something else - winning one is never the point by itself.
 */
export async function postMightClash(actor, target,
                                     { maneuverName, clashLabel = "", reason = "",
                                       collision = null, grapple = null, ...leaves } = {}) {
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: "",
    flags: {
      [SCOPE]: {
        // Not a Maneuver of its own, so there is nothing here for an Instant to answer.
        [RESPONDABLE_FLAG]: false,
        [CLASH_FLAG]: {
          category: "might",
          clashLabel,
          maneuverName,
          reason,
          // What settling this one leaves behind, whatever it is called - the same
          // arrangement a Skill Clash and a Saving Throw Clash have, and for the same
          // reason: naming the keys one at a time is how the Blockade's payload went
          // missing. The Grapple's is still named below because it was here first and is
          // read by more than the settlement.
          ...leaves,
          // What winning this one lets the challenger do. Knockback sets it: win and
          // the movement can cost the loser Life Points. Carried here rather than
          // looked up from the attack, because this card is the one that knows who
          // won - and what a collision costs is asked of the character who had it,
          // not of the Maneuver that caused it.
          collision,
          collisionApplied: false,
          // A Might Clash between the two halves of a Grapple settles like any other
          // Clash within one, and `applyClash` routes it there by this being here. The
          // Pin Maneuver's second Clash is the first of them.
          ...(grapple ? { grapple } : {}),
          challengerUuid: actor.uuid,
          challengerName: actor.name,
          defenderUuid: target.uuid,
          defenderName: target.name,
          ready: [],
          result: null
        }
      }
    }
  });
}

/**
 * One side of the Clash card: who has finished preparing while it is still open, and
 * what they rolled once it is settled.
 */
function clashSide(clash, uuid, name, side) {
  if (!side) {
    const ready = (clash.ready ?? []).includes(uuid);
    const state = ready ? "dbu-ready" : "dbu-pending";
    return `
      <div class="dbu-clash-side">
        <span class="dbu-clash-name ${state}">${Handlebars.escapeExpression(name)}</span>
        <span class="dbu-clash-waiting ${state}">${ready ? "ready" : "waiting"}</span>
      </div>`;
  }

  const outcome = (side.outcome && !side.succeeded)
    ? `<span class="dbu-clash-outcome dbu-${side.outcome}">${side.outcome}</span>` : "";
  return `
    <div class="dbu-clash-side">
      <span class="dbu-clash-name">${Handlebars.escapeExpression(name)}</span>
      ${rolledTotal(side)}${outcome}
    </div>`;
}

/** Everyone whose confirmation the Clash is waiting on. */
function clashParticipants(clash) {
  return [clash.challengerUuid, clash.defenderUuid];
}

/** Whether both sides have confirmed and the dice can be picked up. */
function clashIsReady(clash) {
  return clashParticipants(clash).every(uuid => (clash.ready ?? []).includes(uuid));
}

/** Who the Clash is still waiting on, named so nobody has to guess. */
function awaitingClash(clash) {
  const waiting = clashParticipants(clash)
    .filter(uuid => !(clash.ready ?? []).includes(uuid))
    .map(uuid => (uuid === clash.challengerUuid) ? clash.challengerName : clash.defenderName);
  return waiting.length
    ? `Waiting on ${waiting.map(name => Handlebars.escapeExpression(name)).join(", ")}`
    : "Rolling";
}

/**
 * Draw the Clash, and offer the defender their roll while it is still open. Like the
 * Instant responses, the card is rebuilt from flags on every render so every client
 * shows the same thing.
 */
function renderSkillClash(message, html) {
  const clash = message.getFlag(SCOPE, CLASH_FLAG);
  if (!clash) return;

  const container = html.querySelector(".message-content") ?? html;
  const result = clash.result;

  const card = document.createElement("div");
  card.className = "dbu-clash";
  card.innerHTML = `
    <div class="dbu-clash-title">${Handlebars.escapeExpression(clash.maneuverName)}
      <span class="dbu-clash-skill">${
        Handlebars.escapeExpression(clash.clashLabel
          ?? CLASH_ROLLS[clash.category ?? "skill"].label)}${
        clash.skillLabel ? ` &middot; ${Handlebars.escapeExpression(clash.skillLabel)}` : ""}</span>
    </div>
    ${clash.reason ? `<div class="dbu-clash-reason">${Handlebars.escapeExpression(clash.reason)}</div>` : ""}
    ${clashSide(clash, clash.challengerUuid, clash.challengerName, result?.challenger)}
    ${clashSide(clash, clash.defenderUuid, clash.defenderName, result?.defender)}
    <div class="dbu-clash-result">${result ? clashResult(result) : awaitingClash(clash)}</div>`;
  container.append(card);

  if (result) {
    // Winning a Knockback Clash is what lets the movement happen, and the movement is
    // what causes the collision. Offered to the winner alone, once, and only when this
    // Clash was opened with something for winning it to buy.
    //
    // A tie goes to the defender, as everywhere else: the challenger has to beat them.
    const wonIt = whoWonClash(result) === "challenger";

    const challenger = fromUuidSync(clash.challengerUuid);

    // "If you win, choose one of the effects below to apply." Offered to whoever won it,
    // once, and only on the Maneuver's own Clash - the second one applies itself.
    if ((clash.thrust?.stage === "strike") && wonIt && !clash.thrust.chosen
      && challenger?.isOwner) {
      for (const [choice, label, tip] of [
        ["push", "Push Back", "They are moved half your Might in Squares, in a straight "
          + "line away from you. Any Collision Damage is doubled."],
        ["prone", "Knock Prone", "A second Clash of Impulsive or Corporeal. Win and they "
          + "are Prone; lose and they are Guard Down until the end of your turn."]
      ]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "dbu-clash-button";
        button.textContent = label;
        button.dataset.tooltip = tip;
        button.addEventListener("click", () => chooseThrust(message, clash, choice));
        container.append(button);
      }
    }

    // "If you win, apply one of the following effects." The same shape the Thrust's two
    // options have, with a third and with one of them able to run out.
    if (clash.dirtyTrick && wonIt && !clash.dirtyTrick.chosen && challenger?.isOwner) {
      const maneuver = getManeuver("dirty-trick");

      for (const [choice, trick] of Object.entries(TRICKS)) {
        const spent = trick.once && maneuver
          && !effectUsesLeft(challenger, maneuver, choice, { per: trick.once });

        const button = document.createElement("button");
        button.type = "button";
        button.className = "dbu-clash-button";
        button.textContent = trick.label;
        // Shown and refused rather than hidden: an option that is gone for the Encounter
        // is worth seeing, and an option that silently vanishes looks like a bug.
        button.disabled = Boolean(spent);
        button.dataset.tooltip = spent
          ? `${trick.label} has already been used this Combat Encounter.`
          : trick.tip;
        if (!spent) {
          button.addEventListener("click", () => chooseDirtyTrick(message, clash, choice));
        }
        container.append(button);
      }
    }

    // "As an Instant Maneuver... you can appear on a Square adjacent to the target."
    // Offered for as long as they are in there, on the card that put them there, and to
    // them alone - it is their Instant, not a step in settling the Clash.
    if (clash.internalAttack?.inside && challenger?.isOwner) {
      const out = document.createElement("button");
      out.type = "button";
      out.className = "dbu-clash-button";
      out.textContent = "Burst out";
      out.dataset.tooltip = "An Instant Maneuver. Appear on a Square adjacent to them, "
        + "re-enter the Order at your recorded Initiative, and take twice your Might "
        + "straight off their Life Points - past their Soak Value and Damage Reduction.";
      out.addEventListener("click", () => burstOut(message, clash));
      container.append(out);
    }

    // "If you win, choose an Item." Whoever won the first Clash names it, and naming it
    // is what applies the Condition and opens the Might Clash - the entry puts them in
    // that order.
    if (clash.transfiguration && (clash.transfiguration.stage === "strike") && wonIt
      && !clash.transfiguration.item && challenger?.isOwner) {
      const name = document.createElement("button");
      name.type = "button";
      name.className = "dbu-clash-button";
      name.textContent = "Choose the Item";
      name.dataset.tooltip = "What they become until the end of the Combat Encounter. "
        + "Their Size Category changes to suit it, which is the ARC's to say. A Might "
        + "Clash follows.";
      name.addEventListener("click", () => chooseTransfiguredItem(message, clash));
      container.append(name);
    }

    // "If that Item would be destroyed or used up, that Character dies." Nothing here can
    // know that a teacup broke, so it is pressed by whoever is running the fight - which
    // is also who may spend the Karma Point, since the one being spent is the teacup's.
    if (clash.transfiguration && (clash.transfiguration.stage === "might") && wonIt
      && (defender?.isOwner || game.user.isGM)) {
      const broken = document.createElement("button");
      broken.type = "button";
      broken.className = "dbu-clash-button";
      broken.textContent = `${clash.transfiguration.item || "The Item"} is destroyed`;
      broken.dataset.tooltip = "They die, unless they spend a Karma Point - and are "
        + "Defeated either way. Their body appears in the closest unoccupied Square.";
      broken.addEventListener("click", () => transfigurationDestroyed(message, clash));
      container.append(broken);
    }

    if (clash.collision && wonIt && !clash.collisionApplied && challenger?.isOwner) {
      const collision = document.createElement("button");
      collision.type = "button";
      collision.className = "dbu-clash-button";
      collision.textContent = "Apply collision damage";
      collision.dataset.tooltip = "Move them first, then say what the collision cost. "
        + "A Life Point reduction: straight off their Life, past their Soak Value and "
        + "Damage Reduction."
        + (clash.collision.doubles ? ` ${clash.collision.doubledBy} doubles it.` : "");
      collision.addEventListener("click", () => applyCollisionDamage(message, clash));
      container.append(collision);
    }
    return;
  }

  // "A Character targeted by this Maneuver may spend 1 Counter Action." Offered while the
  // Clash is open, because it is what decides what beating it does - and only to the side
  // it was aimed at.
  if (clash.transfiguration?.counterOffered && !clash.transfiguration.counter) {
    const defender = fromUuidSync(clash.defenderUuid);
    if (defender?.isOwner) {
      const turn = document.createElement("button");
      turn.type = "button";
      turn.className = "dbu-clash-button";
      turn.textContent = "Spend a Counter Action";
      turn.dataset.tooltip = "Beat this Clash and the Transfiguration turns back on "
        + "whoever threw it - they become its target and roll both sides, Urgently. The "
        + "Counter Action is spent whether you beat it or not.";
      turn.addEventListener("click", () => counterTransfiguration(message, clash));
      container.append(turn);
    }
  }

  // Both sides confirm the same way, and each only for themselves. The challenger has
  // as much to declare as the defender does - a willing failure, an effect - so the
  // card asks them both rather than rolling the challenger's dice unasked.
  for (const uuid of new Set(clashParticipants(clash))) {
    if ((clash.ready ?? []).includes(uuid)) continue;

    const actor = fromUuidSync(uuid);
    if (!actor?.isOwner) continue;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "dbu-clash-button";
    // What this side actually rolls, which is the Skill on a Skill Clash and Might on a
    // Might Clash - the label used to be the Skill's alone, so a Might Clash offered
    // "Roll undefined".
    const kind = CLASH_ROLLS[clash.category ?? "skill"];
    button.textContent = `Roll ${kind.prompt
      ? kind.prompt(actor, clash, uuid)
      : kind.of(actor, clash, uuid).label}`;
    button.dataset.tooltip = "Declare what you bring, then wait for the other side";
    button.addEventListener("click", () => clashStage(message, actor));
    container.append(button);
  }
}

/**
 * The defender wins a tie: whoever did not start the Maneuver takes it, so the
 * challenger has to beat them outright rather than merely match them.
 */
function clashResult({ challenger, defender }) {
  // Karmic Save says you succeed, whatever the numbers said, so it settles the Clash
  // before the totals are compared at all. Both sides having it is not a thing the
  // rules allow - it can only be used by whoever lost - so one check each is enough.
  if (challenger.succeeded) return `${Handlebars.escapeExpression(challenger.actorName)} wins (Karmic Save)`;
  if (defender.succeeded) return `${Handlebars.escapeExpression(defender.actorName)} wins (Karmic Save)`;

  const tied = challenger.total === defender.total;
  const winner = (challenger.total > defender.total) ? challenger : defender;
  return `${Handlebars.escapeExpression(winner.actorName)} wins${tied ? " (tie)" : ""}`;
}

/**
 * Which side took the Clash.
 *
 * The defender wins a tie: whoever did not start it has to be beaten outright rather
 * than merely matched. Asked here rather than written out again wherever it matters -
 * saying it, offering the Knockback collision to the winner, and settling a Grapple were
 * three copies of one rule.
 */
function whoWonClash({ challenger, defender }) {
  if (challenger.succeeded) return "challenger";
  if (defender.succeeded) return "defender";
  return (challenger.total > defender.total) ? "challenger" : "defender";
}

/**
 * Let this side declare what they are bringing, then mark them ready.
 */
async function clashStage(message, actor) {
  const opened = message.getFlag(SCOPE, CLASH_FLAG);
  if (!opened || opened.result) return;

  // What this side has to decide before anything is rolled. A Grapple Check's Defender
  // answers with their Strike or their Dodge, and that is asked here for the reason
  // everything else is asked here: neither side has seen a number yet.
  const kind = CLASH_ROLLS[opened.category ?? "skill"];
  const answer = kind.choose ? await kind.choose(opened, actor) : {};
  if (!answer) return;

  // Whether this side's Check relies on sight, asked only where that changes something -
  // a Skill whose Natural Result moves when it does.
  const picked = ((opened.category ?? "skill") === "skill")
    ? skillPicked({ ...opened, ...answer }, actor.uuid) : "";
  const sight = Boolean(actor.system.skills?.[picked]?.naturalSight);

  // "All rolls involved become Urgent." A re-aimed Transfiguration says so on the card,
  // and Urgent here means what it means everywhere: it cannot be failed on purpose.
  const ready = await prepareRoll(actor, [], `${actor.name}: before the roll`, "",
    { urgent: Boolean(opened.urgent), sight });
  if (!ready) return;

  // Read fresh rather than trusting what the card was drawn with: the other side may
  // have confirmed while this dialog was open, and writing a stale copy back would
  // erase it.
  const clash = message.getFlag(SCOPE, CLASH_FLAG);
  if (!clash || clash.result) return;

  return settleClash(message, {
    ...clash,
    ...answer,
    // A list of who said so, not an object keyed by them: a uuid has dots in it, and a
    // write would turn it into nested keys.
    sightBy: (clash.sightBy ?? []).filter(uuid => uuid !== actor.uuid)
      .concat((sight && ready.sight) ? [actor.uuid] : []),
    ready: [...new Set([...(clash.ready ?? []), actor.uuid])]
  });
}

/** Write the Clash back, and roll it if that was the last confirmation needed. */
async function settleClash(message, clash) {
  if (!clashIsReady(clash)) return requestEdit(message, { type: "clash", clash });
  return resolveSkillClash(message, clash);
}

/**
 * Settle the Clash: roll both sides at once and publish them together, so neither
 * result is known before the other is decided.
 */
async function resolveSkillClash(message, clash) {
  const challenger = fromUuidSync(clash.challengerUuid);
  const defender = fromUuidSync(clash.defenderUuid);
  if (!challenger || !defender) {
    ui.notifications.warn("One of the actors in this Skill Clash no longer exists.");
    return;
  }

  // A Clash opened before the categories were told apart carries no category at all,
  // and every one of those was a Skill Clash - there was nothing else to open.
  const kind = CLASH_ROLLS[clash.category ?? "skill"];

  // One side, with whatever its category asks for. A Skill and a Might Clash want a
  // single value and a critical die; a Grapple Check is a Combat Roll and wants the Tier
  // of Power Extra Dice, the penalties one carries, and a Slot for effects to reach.
  const side = (actor, uuid) => rollSide(
    actor,
    [kind.of(actor, clash, uuid), ...(kind.parts ? kind.parts(actor, clash, uuid) : [])],
    {
      criticalDice: kind.criticalDice(actor),
      ...(kind.options ? kind.options(actor, clash, uuid) : {})
    }
  );

  const [challengerSide, defenderSide] = await Promise.all([
    side(challenger, clash.challengerUuid),
    side(defender, clash.defenderUuid)
  ]);

  requestEdit(message, {
    type: "clash",
    clash: { ...clash, result: { challenger: challengerSide, defender: defenderSide } }
  });
}

/**
 * Out-of-Sequence Maneuvers never sit in a list waiting to be used: they exist only
 * as a chance handed out by something that just happened. This draws those chances
 * on the message that caused them.
 *
 * Nothing hands these out by hand: they come from the effects that grant them, such
 * as Cross Counter striking back at the opponent that was just answered.
 */
function renderOutOfSequence(message, html) {
  const container = html.querySelector(".message-content") ?? html;
  const offers = message.getFlag(SCOPE, OOS_OFFERS_FLAG) ?? [];
  const taken = takenOffers(message);

  if (offers.length) {
    const list = document.createElement("ul");
    list.className = "dbu-oos-list";

    for (const offer of offers) {
      const item = document.createElement("li");
      item.innerHTML = `
        <span class="dbu-oos-actor">${Handlebars.escapeExpression(offer.actorName)}</span>
        <span class="dbu-oos-maneuver">${Handlebars.escapeExpression(offer.maneuverName)}</span>
        <span class="dbu-oos-reason">${Handlebars.escapeExpression(offer.reason ?? "")}</span>`;

      const actor = fromUuidSync(offer.actorUuid);
      // One Out-of-Sequence Maneuver per trigger, and each of these is somebody's own
      // trigger: four defenders who each chose Cross Counter each struck back, and an
      // Exploit provoked for every adjacent Opponent is an opening each of them saw.
      if (!taken.includes(offer.actorUuid) && actor?.isOwner) {
        const use = document.createElement("button");
        use.type = "button";
        use.className = "dbu-oos-button";
        use.textContent = "Use";
        use.addEventListener("click", () => takeOutOfSequence(message, actor, offer));
        item.append(use);
      }
      list.append(item);
    }
    container.append(list);
  }

  if (taken.length) {
    const names = taken
      .map(uuid => fromUuidSync(uuid)?.name)
      .filter(Boolean);
    const note = document.createElement("div");
    note.className = "dbu-settled-note";
    note.textContent = names.length
      ? `Out-of-Sequence Maneuver used by ${names.join(", ")}`
      : "Out-of-Sequence Maneuver used";
    container.append(note);
  }

}

/**
 * Play the offered Maneuver out of sequence, and close the trigger.
 *
 * This never touches `lastManeuverWasInstant`: an Out-of-Sequence Maneuver played off
 * the back of an Instant does not count as a Maneuver in its place.
 */
async function takeOutOfSequence(message, actor, offer) {
  const maneuver = getManeuver(offer.maneuverId);
  if (!maneuver) return;

  // "You cannot use any Special Maneuvers until you have gained access to them." Asked
  // here as well as at the sheet's door, because being handed a chance to use one is not
  // being given it - access can also have been taken away between the offer and the click.
  const closed = whyNotSpecial(actor, maneuver);
  if (closed) {
    ui.notifications.warn(closed);
    return;
  }

  // Exploit is a Counter Maneuver whose whole effect is an Out-of-Sequence Basic Attack:
  // "if you do, use the Basic Attack Maneuver as an Out-of-Sequence Maneuver". So it
  // costs its own Counter Action - an Out-of-Sequence Maneuver waives an Action Cost, and
  // this one is not the Out-of-Sequence Maneuver, it is what hands one over.
  if (maneuver.exploit) {
    if (!await spendActions(actor, maneuver.actionCost ?? 1, "counter")) return;
    // A Counter Maneuver is a Maneuver of another kind, so it releases the Instant rule.
    await recordManeuverType(actor, "counter");

    return takeOutOfSequence(message, actor, {
      ...offer,
      maneuverId: "basic-attack",
      maneuverName: "Basic Attack"
    });
  }

  // Played out of sequence or not, an attack still has to be aimed and declared, and
  // still has to be rolled. Only its Action Cost is waived.
  let target = null;
  if (maneuver.requiresTarget) {
    // The effect that granted this may already name the opponent - Cross Counter
    // strikes back at the same one - and otherwise the player aims it themselves.
    target = (offer.targetUuid ? fromUuidSync(offer.targetUuid) : null)
      ?? game.user.targets.first()?.actor
      ?? null;

    if (!target) {
      ui.notifications.warn(`${maneuver.name} needs a target. Target a token first.`);
      return;
    }
  }

  let declared = null;

  // A Reflect is declared already: "using the Profile of the initial Attacking Maneuver",
  // and with that attack's own Ki Wager rather than one of yours. So there is nothing to
  // ask - the Profile, the Foundation and the wager all came with the offer.
  const reflecting = (maneuver.reflect && offer.reflect) ? offer.reflect : null;
  if (reflecting) {
    declared = {
      profile: reflecting.profile,
      foundation: reflecting.foundation,
      kiWager: reflecting.kiWager ?? 0,
      advantages: reflecting.advantages ?? [],
      squaresCharged: reflecting.squaresCharged ?? 0
    };
  }

  // Opened for an Attacking Maneuver even when it names no Profile: the Ki Wager
  // belongs to the attack rather than to the Profile, and Compelled sets a floor under
  // it that has to be asked for somewhere.
  // What the thing that handed this over attached to it. A Feint's Basic Attack cannot
  // have an Area of Effect and cannot be wagered past a quarter of the Capacity, and both
  // are said at the picker rather than checked after it is built.
  const granted = offer.grants ?? null;

  if (!declared && (maneuver.profile || maneuver.attacking)) {
    declared = await declareAttack(maneuver, DBUCharacterData.FOUNDATIONS, actor, {
      noArea: Boolean(granted?.noArea),
      wagerCap: granted?.wagerCap
    });
    if (!declared) return;

    // The same rule on the way in out of sequence: a Physical Attack only reaches your
    // Melee Range, and an Out-of-Sequence Maneuver is no exception to it.
    const outOfReach = target && whyNotInReach(actor, target, declared);
    if (outOfReach) {
      ui.notifications.warn(outOfReach);
      return;
    }

    // Two a Combat Round, whichever way the attack is reached - out of sequence is no
    // exception, exactly as it is none to the Melee Range above.
    const noMoreAbsolute = whyNotAnotherAbsolute(actor, maneuver);
    if (noMoreAbsolute) {
      ui.notifications.warn(noMoreAbsolute);
      return;
    }

    // The Foundation's own demand of the attacker. No exception out of sequence, as
    // with the Melee Range above.
    const wrongFoundation = whyNotThisFoundation(actor, declared.foundation,
      DBUCharacterData.FOUNDATIONS[declared.foundation]?.label);
    if (wrongFoundation) {
      ui.notifications.warn(wrongFoundation);
      return;
    }
  }

  // A Movement's price is a choice rather than a number - Normal Speed for nothing,
  // Boosted for 3(T), Rapid Movement another 2(T) on top - so it is asked here too.
  // Without this an Out-of-Sequence Movement was Normal Speed and free, whatever the
  // player would have paid for.
  let crossing = null;
  if (maneuver.movement) {
    const { askMovement } = await import("./use-maneuver.mjs");
    crossing = await askMovement(actor);
    if (!crossing) return;
  }

  // An Out-of-Sequence Maneuver ignores its Action Cost, but not its Ki cost.
  //
  // A Reflect pays its own price and not the Profile's: "KP Cost: 5(T)" is the whole of
  // what the entry asks, and the Profile was paid for by whoever threw it the first time.
  // A held Maneuver was paid for when it was held: "you may use that Maneuver without
  // paying the Action Cost or KP Cost as an Out-of-Sequence Maneuver". Out of sequence
  // waives the Action Cost for everything; `free` is what waives the Ki as well, and only
  // an offer that was already paid for carries it.
  const price = offer.free
    ? 0
    : crossing
    ? movementKiCost(actor, crossing)
    : maneuverKiCost(maneuver, reflecting ? null : declared, actor);
  // The Energy-Suction Device's stored Ki may pay for it instead - asked below, before the Ki
  // is spent.

  // A wager paid in Life, where there is a wager to pay: not on a free offer, and not on
  // a Reflect, which pays its own price and nothing of the attack it throws back.
  const paysLife = !offer.free && !crossing && !reflecting;
  const lifeProblem = paysLife ? lifeWagerProblem(actor, declared, price) : null;
  if (lifeProblem) {
    ui.notifications.warn(lifeProblem);
    return;
  }

  const { payFromStore } = await import("./use-maneuver.mjs");
  const fromStore = (paysLife && price) ? await payFromStore(actor, maneuver, declared, price) : false;
  if (fromStore === null) return;
  if (price && !fromStore && !await spendManeuverCost(actor, maneuver, price)) return;
  if (paysLife) await spendLifeWager(actor, declared);

  // An Out-of-Sequence Maneuver counts as having used another kind - unless the thing
  // that offered it was the Instant still holding you, which is what the message id is
  // compared against.
  await recordManeuverType(actor, "outOfSequence", { messageId: message.id });

  requestEdit(message, { type: "offerTaken", actorUuid: actor.uuid });

  // What a held Maneuver was paid for, read before the holding is let go of because
  // letting go is what clears it. A script asking `actionsSpent` is asking what the player
  // paid, and for a held Maneuver that was paid when it was held: Combat Recovery's whole
  // effect is one stack per Action spent, and zero here would be a Recovery that recovers
  // nothing.
  const heldActions = offer.free ? (actor.system.delayed?.actions ?? 0) : 0;

  // A held Maneuver is held no longer once it is used. Cleared here rather than by the
  // card, because the holding is on the character and the character is what has to stop
  // saying they are holding something.
  if (offer.free && actor.system.delayed?.itemId) {
    const { dropDelayed } = await import("./use-maneuver.mjs");
    await dropDelayed(actor);
  }

  // And what the Maneuver itself does, which is the same question out of sequence as in
  // sequence. The door in use-maneuver.mjs fires this for everything used through it;
  // this is the other door, and it fired nothing - so a Power Up handed over by an effect
  // posted its card and gained no stack of Power, and a Maneuver held by Triggered and
  // released later did nothing at all.
  //
  // Scoped to the character's own copy, the way the main door scopes it. A Maneuver
  // granted by name that they do not hold - Cross Counter's Basic Attack - has no script
  // of theirs to run, and firing this unscoped would run every `on used` they own.
  const own = actor.items?.find(item =>
    (item.type === "maneuver") && ((item.system.maneuverId || item.id) === maneuver.id));
  if (own) {
    const { fireMoment } = await import("./effects/moments-runtime.mjs");
    await fireMoment(actor, "on-used", {
      maneuver: { ...maneuver, itemId: own.id },
      // What the player paid, which out of sequence is nothing - unless this is a Maneuver
      // they held, where it is what they paid to hold it.
      actionsSpent: heldActions,
      targets: target ? [target] : []
    }, { only: own.id });
  }

  // The tally, for a Maneuver with a limit written on it. Not for a held one: "delay its
  // use but pay the Action Cost and KP Cost immediately" was the use, and it was counted
  // then - `free` is what marks an offer that has already been paid for.
  if (!offer.free) await recordManeuverUse(actor, maneuver);

  // The Exploit's recursion spreads the offer, so what provoked it has come all this way
  // untouched and goes onto the attack itself.
  // "Increase your Strike Rolls by 1(T) until the end of your turn." The same grant the
  // Maneuver makes in sequence: what is paid for is what is had, whichever door it came
  // through.
  if (crossing?.rapid) {
    const { takeRapidMovement } = await import("./use-maneuver.mjs");
    await takeRapidMovement(actor);
  }

  // Attack Absorption is not an attack, and posts no Maneuver card of its own: what it
  // does is written onto the attack it swallowed, and that card is what asks for the
  // Wound Roll paying for it.
  if (maneuver.absorb) return absorbAttack(message, actor, maneuver);

  return declared
    ? postAttack(actor, target, maneuver, declared, {
        asOutOfSequence: true,
        provokedBy: offer.provokedBy ?? null,
        reflecting,
        // Shaped like the Modifier Maneuvers applied at the door, because they are the
        // same thing to this attack: a named change with a row of its own.
        modifiers: granted?.modifiers ?? [],
        defencesAllowed: granted?.defencesAllowed ?? []
      })
    : postManeuver(actor, maneuver, {
        asOutOfSequence: true,
        rapidMovement: Boolean(crossing?.rapid),
        // No Action was spent, which is what out of sequence means. The Ki was, and a
        // Blockade that wins hands it back.
        spent: { actions: 0, kind: "standard", ki: price }
      });
}

/**
 * Declare an attack. As with a Skill Clash, nothing is rolled yet: Strike and Dodge
 * are rolled together the moment the target accepts, so neither side learns the
 * other's result in advance.
 */
export async function postAttack(actor, target, maneuver,
                                 { profile, foundation, kiWager = 0, wagerFromLife = false,
                                   charges = 0, damageAttribute = null, autoHit = false,
                                   advantages = [], squaresCharged = 0 },
                                 { asOutOfSequence = false, provokedBy = null,
                                   reflecting = null, modifiers = [],
                                   defencesAllowed = [] } = {}) {
  // Counted as the Maneuver is made, so the stack it earns already weighs on its own
  // Strike Roll - the attack after your third is itself the one that suffers.
  //
  // The Actions it took are counted separately, for Compelled's end-of-turn check. An
  // Out-of-Sequence Maneuver ignores its Action Cost, so it spends none and none are
  // counted: the rule asks what you spent, and that spent nothing.
  //
  // Counted once however far the attack reaches: an area that catches four people is
  // one Attacking Maneuver, and they all answer the same card.
  // An Absolute Attack is counted as it is made, not as it misses: doing one is making
  // one. In the same write as the rest, off one reading of the character.
  const absolute = Boolean(maneuver.absolute && maneuver.attacking);

  // "Do not count towards the penalty from Diminishing Offense." The count is what the
  // penalty is worked out from, so an attack outside it does not raise the count - and the
  // attack after this one is no worse off for this one having happened. The other half of
  // the same sentence is on the Strike Roll, further down.
  const counts = maneuver.outsideDiminishing ? 0 : 1;

  await actor.update({
    "system.attacksThisRound": actor.system.attacksThisRound + counts,
    "system.attackActionsThisTurn": actor.system.attackActionsThisTurn
      + (asOutOfSequence ? 0 : (maneuver.actionCost ?? 1)),
    ...(absolute
      ? { "system.absoluteAttacksThisRound": actor.system.absoluteAttacksThisRound + 1 }
      : {})
  });

  // Handed back for the reason postManeuver hands its card back: which card a Maneuver
  // was played on is part of the Instant rule.
  const card = await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: "",
    flags: {
      [SCOPE]: {
        // A Basic Attack is a Standard Maneuver, so Instants may answer it - unless
        // it was played out of sequence, which nothing may answer.
        [RESPONDABLE_FLAG]: isRespondable(maneuver, asOutOfSequence),
        [ATTACK_FLAG]: {
          maneuverName: asOutOfSequence
            ? `${maneuver.name} (Out-of-Sequence)`
            : maneuver.name,
          // The opening this attack came through, where it came through one. Null for
          // every attack anybody simply chose to make.
          provokedBy,
          actionCost: maneuver.actionCost ?? 1,
          tags: maneuver.tags ?? [],
          // "Do not suffer from... the penalty from Diminishing Offense." Carried on the
          // attack rather than looked up at the Strike Roll: whether this attack was
          // outside it was settled when it was declared, and the Maneuver it came from may
          // be edited in between - the same reason `absolute` is carried.
          outsideDiminishing: Boolean(maneuver.outsideDiminishing),
          // Carried on the attack rather than looked up at the Wound Roll: whether this
          // was an Absolute Attack was settled when it was declared, and the Maneuver it
          // came from may be edited in between.
          absolute,
          // Everyone this attack reaches, answering one Strike Roll. An area adds to
          // this list; it does not start a second attack.
          targets: [{ uuid: target.uuid, name: target.name }],
          // What the Signature Technique side brought, and whatever it asked for at
          // declaration. Carried on the attack rather than looked up later: an
          // Advantage applies to the attack it was declared on, and the Technique it
          // came from may be edited between the declaration and the Wound Roll.
          advantages,
          // How many ranks of Power Shot came with it. Carried as a number of its own
          // rather than counted again wherever it is wanted: two rolls that are not this
          // attack's read it - the Parry option of the Defend Maneuver and the Intervene
          // Maneuver's two Deflects - and a reflected attack hands it across whole.
          powerShotRanks: reflecting
            ? (reflecting.powerShotRanks ?? 0)
            : Math.min(featureRanks(advantages, "power-shot"), POWER_SHOT_MAX_RANKS),
          squaresCharged,
          profile,
          profileLabel: PROFILES[profile].label,
          // Carried on the attack rather than looked up later: a Profile's Damage
          // Category is part of what was declared.
          damageCategory: PROFILES[profile].damageCategory,
          // Steps applied by the attacker's own effects, summed with the defender's
          // before anything is clamped. Mega Flare is the first thing to write here:
          // "if the number of Energy Charges applied is 7+, increase the Damage
          // Category by 1 Category."
          // The Modifier Maneuvers applied to this attack, with what each of them did to
          // it. On the card because the attack is settled later and often elsewhere, and
          // the Item they came from may have been edited in between.
          modifiers,
          // Which options of the Defend Maneuver may answer this, where something has
          // narrowed them. Empty means all of them, which is every attack but one.
          defencesAllowed,
          // A reflected attack keeps the steps the original had rather than working them
          // out again: Mega Flare's is a fact about that attack's Charges, and those are
          // carried across rather than re-derived.
          //
          // A Modifier's step is added on top: "increase the Damage Category of that
          // Attacking Maneuver by 1" is a step this attack has, whatever gave it.
          damageCategoryShift: (reflecting
            ? (reflecting.damageCategoryShift ?? 0)
            : profileCategoryShift(profile, charges))
            + modifierCategoryShift(modifiers),
          kiWager,
          // Paid in Life Points rather than Ki. Added to the Wound Roll all the same - it
          // is a Ki Wager either way - and only the card's note says the difference.
          wagerFromLife: Boolean(wagerFromLife && kiWager),
          // What stands in for the Damage Attribute, where something other than the
          // attacker's own does - a Bomb's recorded Scholarship Modifier. Null for every
          // attack a character makes with their own.
          damageAttribute,
          // "A Bomb's Strike Roll for this Attacking Maneuver will automatically succeed."
          // Carried on the attack, since it is the attack's and not the character's.
          autoHit: Boolean(autoHit),
          // Energy Charges live on the Maneuver, not the character: they were fed into
          // this attack and are spent with it. Each adds a die to the Wound Roll.
          // Powered "gains an Energy Charge", on top of anything the Energy Charge
          // Maneuver fed into it - and still held to the seven the rules allow.
          // Beam's is added after the ceiling rather than under it: "an Energy Charge
          // that does not count towards your maximum number of Energy Charges". Powered's
          // is an ordinary one and is held to the maximum with the rest.
          // "Including any Ki Wagers and Energy Charges included on that Attacking
          // Maneuver." Taken across whole, because they are already settled: the Profile's
          // own grants are inside that number, and deriving them again would hand them
          // out a second time.
          energyCharges: reflecting
            ? (reflecting.energyCharges ?? 0)
            : Math.min(
                charges + (PROFILES[profile].grantsEnergyCharge ?? 0),
                maxEnergyCharges(profile, DBUCharacterData.MAX_ENERGY_CHARGES)
              ) + (PROFILES[profile].grantsUncappedEnergyCharge ?? 0),
          // Whose Technique it was, which is what decides the size of an Energy Charge's
          // die - and it is their attack being thrown back, not the reflector's.
          signature: reflecting
            ? Boolean(reflecting.signature)
            : (maneuver.tags ?? []).includes("signature"),
          // Who owes the Wound Roll, where that is not the one who made the Strike. Blank
          // on every attack anybody simply threw.
          woundBy: reflecting?.attackerUuid ?? "",
          woundByName: reflecting?.attackerName ?? "",
          // "As an Urgent Roll" - which here means one that cannot be failed on purpose.
          urgentWound: Boolean(reflecting),
          reflectedFrom: reflecting?.maneuverName ?? "",
          foundation,
          foundationLabel: DBUCharacterData.FOUNDATIONS[foundation].label,
          attackerUuid: actor.uuid,
          attackerName: actor.name,
          targetUuid: target.uuid,
          targetName: target.name,
          // Who has confirmed what they are bringing, and what each target answered
          // with. Nothing is rolled until every participant appears here: both sides
          // may have effects to apply first, and a roll made before they do cannot be
          // taken back.
          ready: [],
          // A list, not an object keyed by uuid: a uuid is full of dots and Foundry
          // expands dotted keys when a document is written, so a key like
          // "Actor.4Nx8qLmP2Zk" comes back as a nested Actor object and the lookup
          // finds nothing. It cost every defence chosen by somebody who was not the
          // last to confirm - those were written to the flag, mangled on the way, and
          // read back as no defence at all, which is a Dodge.
          // The range at which this one gives an opening, carried so the card can say it
          // and so the offers can name it. Blank on most.
          exploitable: maneuver.exploitable ?? "",
          defences: [],
          // Everyone who stepped in front of somebody else. A list rather than an object
          // keyed by uuid, for the reason every other list here is one: a uuid is full of
          // dots and Foundry expands dotted keys when a document is written.
          interventions: [],
          result: null
        }
      }
    }
  });

  offerExploits(card, actor, maneuver);
  return card;
}

/**
 * What the Wound Roll comes to for somebody who took it in another character's place.
 *
 * Their own Soak Value and Damage Reduction, against the attack's own Damage Category -
 * they did not defend against this, they walked into it, so nothing a Defend option does
 * to Soak applies here.
 *
 * Defense Wall adds half their Soak Value, rounded *up*: "increase your Soak Value by
 * 1/2 (rounded up)", which is the one place in the rules that rounds the other way and
 * so is worth saying out loud.
 *
 * A lost Deflect is a Category harder: "you increase the Damage Category of that
 * Attacking Maneuver by 1 Category for the sake of calculating your Damage" - for
 * calculating theirs, and nobody else's.
 */
async function interventionOutcome(attack, entry, wound) {
  const actor = fromUuidSync(entry.uuid);
  const ally = fromUuidSync(entry.allyUuid);
  if (!actor) return null;

  const option = INTERVENE_OPTIONS[entry.effect];
  const lost = Boolean(entry.clash && !entry.clash.won);

  const category = resolveDamageCategory(attack.damageCategory,
    (attack.damageCategoryShift ?? 0) + (lost ? (option.damageCategoryShiftOnLoss ?? 0) : 0));

  const base = actor.system.soakValue ?? 0;
  // Rounded up, unlike every other halving in the system. Written as a ceiling rather
  // than a floor on purpose: the rule says so, and a floor here would be a quiet nerf.
  const bulwark = option.soakBonusFraction
    ? Math.ceil(base / option.soakBonusFraction)
    : 0;

  const soak = Math.max(0,
    Math.floor((base + bulwark) * DAMAGE_CATEGORIES[category].soakMultiplier));
  const reduction = Math.max(0, actor.system.damageReduction ?? 0);

  // Their own Soak and Damage Reduction against the whole Wound Roll, and then their own
  // effects on what got through - the same two passes anybody hit takes, because taking a
  // Wound Roll is taking a Wound Roll whether or not it was aimed at you.
  const raw = Math.max(0, wound.total - soak - reduction);

  const beforeWound = (raw > 0)
    ? atMoment(actor, "before-wound", { attack: 1, damageCategory: 1 })
    : null;
  if (beforeWound) spendChosen(actor, beforeWound);

  const damage = damageTaken(raw,
    { "incoming.damage": entry.incomingDamage },
    beforeWound?.slots);

  // "If you are Defeated by this Attacking Maneuver, any excess Damage is inflicted to
  // that Ally - but is reduced by their Soak Value and Damage Reduction as usual for
  // that Attacking Maneuver and its Damage Category."
  //
  // Only what is left after their Life runs out, and only for Defense Wall - a lost
  // Deflect says nothing about spilling. Worked out off the Life they hold now, which
  // is what the table is looking at when it decides.
  const life = actor.system.life?.value ?? 0;
  const excess = (option.takesWound && (damage > life)) ? (damage - life) : 0;

  const spill = (excess && ally)
    ? await spilloverTo(ally, excess, attack)
    : null;

  return {
    category,
    bulwark,
    soak,
    reduction,
    damage,
    defeated: excess > 0,
    excess,
    spill,
    applied: false
  };
}

/**
 * What is left over reaches the Ally through their own Soak and Damage Reduction.
 *
 * "Any excess Damage is inflicted to that Ally - but is reduced by their Soak Value and
 * Damage Reduction as usual for that Attacking Maneuver and its Damage Category."
 *
 * And if anything is still standing after those two, it is Damage they are receiving, so
 * whatever raises the Damage they take raises it. The rule names only the reductions, but
 * it names them to say the excess is not a special kind of Damage - it arrives the
 * ordinary way and is treated the ordinary way, which is also what stops it when the two
 * swallow it whole.
 */
async function spilloverTo(ally, excess, attack) {
  const own = targetResult(attack, ally.uuid);
  const category = own?.damageCategory ?? attack.damageCategory;

  const soak = Math.max(0, Math.floor(
    (ally.system.soakValue ?? 0) * DAMAGE_CATEGORIES[category].soakMultiplier));
  const reduction = Math.max(0, ally.system.damageReduction ?? 0);

  const raw = Math.max(0, excess - soak - reduction);

  const beforeWound = (raw > 0)
    ? atMoment(ally, "before-wound", { attack: 1, damageCategory: 1 })
    : null;
  if (beforeWound) spendChosen(ally, beforeWound);

  return {
    uuid: ally.uuid,
    name: ally.name,
    soak,
    reduction,
    // Their own, gathered when the attack first landed on them - they were a target of
    // it, whatever was standing in the way afterwards.
    damage: damageTaken(raw,
      { "incoming.damage": own?.incomingDamage },
      beforeWound?.slots),
    applied: false
  };
}

/** Everybody who stepped in front of somebody else on this attack. */
function interventions(attack) {
  return attack.interventions ?? [];
}

/** The one standing between this target and the Wound Roll, if anybody is. */
function interventionFor(attack, allyUuid) {
  return interventions(attack).find(entry => entry.allyUuid === allyUuid) ?? null;
}

/**
 * The Deflect that turned the whole attack aside, if one did.
 *
 * "If you win, the Attacking Maneuver is successfully deflected away from all targets" -
 * so one won Clash ends it for everybody, not only for the Ally who was stepped in for.
 */
function deflection(attack) {
  return interventions(attack).find(entry => entry.deflected) ?? null;
}

/**
 * Whether this character is taking a Wound Roll in somebody else's place.
 *
 * Defense Wall always does. Deflect does it only having lost the Clash - winning it
 * means there is no Wound Roll for anyone to take.
 */
function takesWoundFor(entry) {
  const option = INTERVENE_OPTIONS[entry.effect];
  if (option?.takesWound) return true;
  return Boolean(option?.takesWoundOnLoss && entry.clash && !entry.clash.won);
}

/**
 * The Might Clash penalty on a Deflect: "reduce your Dice Score by 1(T) for each Energy
 * Charge or Rank of Power Shot the Attacking Maneuver possesses".
 *
 * (T) rather than the Parry's (bT), and Power Shot is not in the system yet - the ranks
 * are read off the attack and are always none, so the Charges half is what bites today.
 * Written as one line because the rule counts them as one number.
 */
function deflectPenalty(actor, attack) {
  const charges = attack?.energyCharges ?? 0;
  const powerShot = attack?.powerShotRanks ?? 0;
  const counted = charges + powerShot;
  if (counted <= 0) return [];

  const perStep = actor.system.tierOfPower ?? 1;
  return [{
    label: powerShot ? "Charges and Power Shot" : "Energy Charges",
    written: `-${counted}(T)`,
    value: -(counted * perStep)
  }];
}

/**
 * Everyone the reader could step in with.
 *
 * Characters they own, holding the Intervene Maneuver, who are neither the attacker nor
 * among the people the attack was aimed at: "when an Ally ... is hit by an Attacking
 * Maneuver (that did not also target you)". Stepping in front of something already
 * coming for you is not stepping in front of anything.
 */
function possibleInterveners(attack) {
  const aimedAt = new Set(attackTargets(attack).map(entry => entry.uuid));
  const seen = new Map();

  for (const token of (canvas?.tokens?.placeables ?? [])) {
    const actor = token.actor;
    if (!actor || (actor.type !== "character") || !actor.isOwner) continue;
    if (actor.uuid === attack.attackerUuid) continue;
    if (aimedAt.has(actor.uuid)) continue;
    if (!actor.items.some(item => (item.type === "maneuver") && item.system.intervene)) continue;
    seen.set(actor.uuid, actor);
  }

  return [...seen.values()];
}

/** Who on this attack could still be stepped in for: hit, and not already covered. */
function shieldableTargets(attack, intervener) {
  return targetResults(attack).filter(entry =>
    entry.own?.hit
    && (entry.uuid !== intervener?.uuid)
    && !interventionFor(attack, entry.uuid));
}

/**
 * Step in for somebody: the Intervene Maneuver, played from the attack that threatens
 * them rather than from the sheet.
 *
 * Everything about who stands where is left to the table. The rule asks for a move "to
 * an unoccupied Square within range of your Boosted Speed, between your Ally and the
 * Character who used the Attacking Maneuver", and the system has no pathing, no notion
 * of which Squares are occupied and no range bands to tell Long Range from anything
 * else. So the requirement is put on the card with the Boosted Speed beside it, and
 * whether it was met is something the players say out loud.
 */
async function openIntervene(message, attack) {
  if (attack.result?.wound || deflection(attack)) return;

  const candidates = possibleInterveners(attack);
  const usable = candidates.filter(actor => shieldableTargets(attack, actor).length);

  if (!usable.length) {
    ui.notifications.info("Nobody you own can step in for anyone here.");
    return;
  }

  const whoRows = usable.map((actor, index) => `
    <label class="dbu-respond-option">
      <input type="radio" name="who" value="${actor.uuid}" ${index ? "" : "checked"}/>
      <span class="dbu-respond-name">${Handlebars.escapeExpression(actor.name)}</span>
      <span class="dbu-respond-source">Boosted Speed ${actor.system.speed.boosted} Squares</span>
    </label>`).join("");

  // Priced against the first of them, since the cost is per character and the dialog
  // has to show a number before one is picked. Re-read once the choice is made.
  const first = usable[0];
  const effectRows = Object.entries(INTERVENE_OPTIONS).map(([key, option], index) => `
    <label class="dbu-respond-option" data-tooltip="${
      Handlebars.escapeExpression(`${option.summary}${option.movement ? ` ${option.movement}` : ""}`)}">
      <input type="radio" name="effect" value="${key}" ${index ? "" : "checked"}/>
      <span class="dbu-respond-name">${Handlebars.escapeExpression(option.label)}</span>
      <span class="dbu-respond-source">${interveneOptionCost(key, first)} KP</span>
    </label>`).join("");

  const allyRows = shieldableTargets(attack, first).map((entry, index) => `
    <label class="dbu-respond-option">
      <input type="radio" name="ally" value="${entry.uuid}" ${index ? "" : "checked"}/>
      <span class="dbu-respond-name">${Handlebars.escapeExpression(entry.name)}</span>
    </label>`).join("");

  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: `${attack.maneuverName} - Intervene` },
    content: `<p class="dbu-respond-hint">Step in front of an Ally the attack hit. The
        Squares you have to cross to do it, and whether they are yours to cross, are
        yours and the Gamemaster's to settle - this only asks what you are doing.</p>
      <div class="dbu-respond-group"><em>Who steps in</em>${whoRows}</div>
      <div class="dbu-respond-group"><em>For whom</em>${allyRows}</div>
      <div class="dbu-respond-group"><em>How</em>${effectRows}</div>`,
    buttons: [
      {
        action: "confirm",
        label: "Intervene",
        callback: (event, button, dialog) => ({
          who: dialog.element.querySelector('input[name="who"]:checked')?.value,
          ally: dialog.element.querySelector('input[name="ally"]:checked')?.value,
          effect: dialog.element.querySelector('input[name="effect"]:checked')?.value
        })
      },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });

  if (!chosen?.who || !chosen?.ally || !chosen?.effect) return;
  return playIntervene(message, attack, chosen);
}

/** Pay for an Intervene and write it onto the attack. */
async function playIntervene(message, attack, { who, ally, effect }) {
  const actor = fromUuidSync(who);
  const allyActor = fromUuidSync(ally);
  const option = INTERVENE_OPTIONS[effect];
  if (!actor || !allyActor || !option) return;

  // Not a target of it, and one per Ally. Asked here as well as in the dialog: the list
  // was drawn when the card was rendered, and an area attack can pick up new targets in
  // between.
  const refused = whyNotIntervene(actor, ally, {
    interventions: interventions(attack),
    targetUuids: attackTargets(attack).map(entry => entry.uuid)
  });
  if (refused) {
    ui.notifications.warn(refused);
    return;
  }

  const maneuver = getManeuver("intervene");
  if (!maneuver) return;

  // A Counter Action and the chosen effect's Ki, in that order: the Action is the one
  // that can be short, and a refused Maneuver must cost nothing.
  if (!await spendActions(actor, maneuver.actionCost ?? 1, "counter")) return;
  if (!await spendManeuverCost(actor, maneuver, interveneOptionCost(effect, actor))) return;

  // A Counter Maneuver is a Maneuver of another kind, so it releases the Instant rule.
  await recordManeuverType(actor, "counter");

  // What their own effects do to Damage they receive - the Superior State taking 2(T)
  // more of it. Collected here because nothing else would: it is gathered at `being-hit`
  // for each target of the attack, and somebody stepping in front of one is not a target.
  // Nobody had ever received a Wound Roll without being aimed at before.
  //
  // On their own client, like a defender's, and carried on the entry: the Wound Roll is
  // settled by whichever client gets there first, and that is as often the attacker's.
  const incoming = atMoment(actor, "being-hit", { attack: 1, attacker: 1 });
  spendChosen(actor, incoming);

  const entry = {
    uuid: actor.uuid,
    name: actor.name,
    allyUuid: ally,
    allyName: allyActor.name,
    effect,
    clash: null,
    deflected: false,
    incomingDamage: incoming?.slots?.["incoming.damage"] ?? null,
    outcome: null
  };

  // Deflect and Distant Deflect are settled by a Might Clash, and it has to be settled
  // before the Wound Roll - winning it means there is no Wound Roll to make. Rolled here
  // rather than posted as a card of its own: what it decides is this card's next step,
  // and a second card to wait on is a second way for the exchange to stall.
  if (option.clashes) {
    const attacker = fromUuidSync(attack.attackerUuid);
    if (!attacker) return;

    const [mine, theirs] = await Promise.all([
      rollSide(actor, [
        { label: "Might", value: actor.system.might },
        ...deflectPenalty(actor, attack)
      ], { criticalDice: actor.system.dice.critical.formula, slot: "might" }),
      rollSide(attacker, [{ label: "Might", value: attacker.system.might }],
        { criticalDice: attacker.system.dice.critical.formula, slot: "might" })
    ]);

    // The attacker wins ties: whoever stepped in is the one asking for something, so
    // they have to beat the roll rather than merely match it.
    entry.clash = { mine, theirs, won: mine.total > theirs.total };
    entry.deflected = entry.clash.won;
  }

  requestEdit(message, {
    type: "attack",
    attack: { ...attack, interventions: [...interventions(attack), entry] }
  });

  // "Or succeed at the Might Clash for the Deflect or Distant Deflect options of the
  // Intervene Maneuver." Those two are the ones the Intervene table marks as clashing, so
  // this asks that rather than naming them - a third option that clashes would want this
  // too, and would get it.
  if (entry.deflected) {
    offerReflect(message, attack, actor,
      `Reflect - your ${option.label} won the Might Clash`);
  }
}

/**
 * The Damage a hit finally deals, once the defender's own effects have had their say.
 *
 * The Wound Roll less the Soak Value and the Damage Reduction is the Damage. **If that
 * comes to nothing, there is no Damage** - not a Damage of zero sitting there waiting to
 * be raised, but none at all, so an effect that increases the Damage you take has
 * nothing to increase. The Superior State is the first to meet it: "increase the Damage
 * you take by 2(T)" takes 2(T) more of something, and does not conjure it.
 *
 * Which is a different question from whether it was a hit. A hit that deals no Damage is
 * still a hit - the rules say so where they define missing - it simply deals nothing.
 *
 * The bags are applied in the order they are given, each to what the last left.
 */
function damageTaken(raw, ...changes) {
  if (raw <= 0) return 0;

  let damage = raw;
  for (const bag of changes) {
    if (bag) damage = applySlot(bag, "incoming.damage", damage);
  }
  return Math.max(0, damage);
}

/**
 * What an Absolute Attack does to somebody it failed to hit.
 *
 * "If you fail to hit a target with an Attacking Maneuver, you still roll the Wound Roll
 * for that Attacking Maneuver and apply 1/2 of the Dice Score of that roll to the
 * target's Soak Value and Damage Reduction. The amount you exceed the cumulative of the
 * target's Soak Value and Damage Reduction is dealt as Damage."
 *
 * Half the Dice Score - the whole Wound Roll, dice and bonuses together - against the
 * two of them added up. Deliberately plain: no Damage Category, since the rule names
 * the Dice Score rather than the Damage the attack would have done, and none of what a
 * defence does to Soak, since nothing was defended against. Soak ignored by the Profile
 * and Damage Reduction the attack pierces are left out for the same reason - the rule
 * names the target's Soak Value and Damage Reduction, and an attack that did not land
 * is not getting past anything.
 *
 * The line is marked `absolute` because what follows from it differs: this is not a hit,
 * and what it deals is not Damage dealt with an Attacking Maneuver for anything that
 * would trigger on either.
 */
function absoluteOutcome(target, wound) {
  const half = Math.floor((wound.total ?? 0) / 2);
  const soak = Math.max(0, target.system.soakValue ?? 0);
  const reduction = Math.max(0, target.system.damageReduction ?? 0);

  return {
    absolute: true,
    counterWound: null,
    effectiveWound: half,
    soak,
    reduction,
    damage: Math.max(0, half - soak - reduction)
  };
}

/**
 * What a Profile does to its own Damage Category.
 *
 * Counted off the Charges the attack ends up with, granted ones included, since the
 * rule asks how many are "applied to this Attacking Maneuver" and does not care where
 * they came from.
 */
function profileCategoryShift(profileId, charges) {
  const profile = PROFILES[profileId];
  if (!profile?.categoryUpAtCharges) return 0;

  const total = Math.min(
    charges + (profile.grantsEnergyCharge ?? 0),
    maxEnergyCharges(profileId, DBUCharacterData.MAX_ENERGY_CHARGES)
  );
  return (total >= profile.categoryUpAtCharges) ? 1 : 0;
}

/**
 * Direct Hit rattling an attacker who threw everything into a blow that did nothing.
 *
 * Both halves of the condition are the attacker's own investment - the Charges they fed
 * it, or the Ki they wagered - so what is read is theirs, not the defender's.
 *
 * Not automated: "until the end of their next turn". Combat Conditions have no notion
 * of a duration yet, so this applies Shaken and the table takes it off.
 */
async function maybeShakeAttacker(attacker, attack, defence, damage) {
  const rule = defence.shakesOnNoDamage;
  if (!rule || (damage > 0)) return;

  // Once. The Wound step settles this, and so does a Karmic Effect that later takes the
  // Damage to nothing - both are the same blow amounting to the same thing.
  if (attacker.system.conditions?.shaken) return;

  const wagered = attack.kiWager ?? 0;
  const threshold = Math.ceil((attacker.system.capacity.max ?? 0) / rule.wagerFraction);
  const invested = ((attack.energyCharges ?? 0) >= rule.charges)
    || (wagered > 0 && (wagered >= threshold));
  if (!invested) return;

  const { setCondition } = await import("./conditions.mjs");
  await setCondition(attacker, "shaken", 1);

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: attacker }),
    content: checkCard({
      parts: `Direct Hit &middot; all of that for nothing`,
      total: "Shaken",
      outcome: "botch"
    })
  });
}

/**
 * The dice an attack's Energy Charges add to its Wound Roll.
 *
 * One die per charge, scaled by the Tier of Power the way every other scaled die is:
 * three charges at Tier 4 is 12 of them. An empty string when there are none, so the
 * formula it joins does not end up with a stray plus.
 */
function energyChargeDice(attacker, attack) {
  const charges = attack.energyCharges ?? 0;
  if (charges <= 0) return "";

  const die = DBUCharacterData.energyChargeDie(attack.signature);
  const [, faces] = die.split("d");
  const count = charges * Math.max(1, attacker.system.tierOfPower ?? 1);
  return `${count}d${faces}`;
}

/** The steps the Modifier Maneuvers on an attack put on its Damage Category. */
function modifierCategoryShift(modifiers) {
  return (modifiers ?? []).reduce((sum, entry) => sum + (entry.damageCategoryShift ?? 0), 0);
}

/**
 * What the Modifier Maneuvers on an attack do to its Strike Roll.
 *
 * A row each rather than one summed row, because each is a Maneuver the player chose and
 * paid for, and the breakdown is where they see what it bought them. Written in (T), which
 * is how the entries write it - "decrease the Strike Roll for that Attacking Maneuver by
 * 2(T)".
 */
function modifierStrikeParts(attacker, attack) {
  const tier = attacker.system.tierOfPower ?? 1;

  return (attack.modifiers ?? [])
    .filter(entry => entry.strikePerTier)
    .map(entry => ({
      label: entry.name,
      written: `${entry.strikePerTier > 0 ? "+" : ""}${entry.strikePerTier}(T)`,
      value: entry.strikePerTier * tier
    }));
}

/**
 * What was applied to an attack does to its Wound Roll.
 *
 * The other half of `modifierStrikeParts`, and empty until the Feint Maneuver: "increase
 * the Strike AND Wound Rolls for this Attacking Maneuver by 1(T)" is the first rule that
 * reaches both. A row each, for the same reason the Strike gets one - the breakdown is
 * where a player sees what a thing bought them.
 */
function modifierWoundParts(attacker, attack) {
  const tier = attacker.system.tierOfPower ?? 1;

  return (attack.modifiers ?? [])
    .filter(entry => entry.woundPerTier)
    .map(entry => ({
      label: entry.name,
      written: `${entry.woundPerTier > 0 ? "+" : ""}${entry.woundPerTier}(T)`,
      value: entry.woundPerTier * tier
    }));
}

/**
 * What an attack's Energy Charges and Power Shot take off a Parry.
 *
 * "Reduce your Dice Score by 1(bT) for each Energy Charge or rank of Power Shot on the
 * Attacking Maneuver." Both halves count now: Power Shot is a Signature Technique
 * Advantage with ranks, and until it existed this had only the Charges to count.
 *
 * One row rather than two, because the rule is one rule - "for each Energy Charge or
 * rank" is a single count of both - and the row says which it is made of when it is made
 * of both. The Intervene Maneuver's Deflect options are the same sentence in (T) rather
 * than (bT), and are counted by `deflectPenalty` the same way.
 *
 * An empty list when there is nothing to take off, so the breakdown does not carry a
 * line saying zero.
 */
function chargePenalty(actor, attack) {
  const charges = attack?.energyCharges ?? 0;
  const powerShot = attack?.powerShotRanks ?? 0;
  const counted = charges + powerShot;
  if (counted <= 0) return [];

  const perStep = actor.system.baseTierOfPower ?? 1;
  return [{
    label: powerShot ? "Charges and Power Shot" : "Energy Charges",
    written: `-${counted}(bT)`,
    value: -(counted * perStep)
  }];
}

/**
 * Combination's follow-up Strikes, as rows of their own on the card.
 *
 * Each is a Strike Roll like any other and each is read the same way - the number, and
 * the workings on hover. What they were measured against is said once, at the head of
 * them, rather than repeated on every line.
 */
function followUpRows(attack) {
  const settled = attack.result?.followUps;
  if (!settled?.rolls?.length) return "";

  const profile = PROFILES[attack.profile];
  const against = (settled.beatable === null)
    ? "no roll to beat"
    : `against their ${settled.beatable}`;

  // Written here rather than through attackSide, because these answer a different
  // question: not "what was this roll's outcome" but "did it beat the number". The
  // roll's own outcome still shows beside it - a Botch among them is worth seeing -
  // and the ones that fell short are dimmed rather than labelled, since three rows
  // each saying "missed" is three rows of the same word.
  const rows = settled.rolls.map((roll, index) => {
    const landed = (settled.beatable !== null) && (roll.total > settled.beatable);
    const outcome = (roll.outcome && !roll.succeeded)
      ? `<span class="dbu-clash-outcome dbu-${roll.outcome}">${roll.outcome}</span>`
      : "";
    return `
      <div class="dbu-clash-side${landed ? "" : " dbu-fell-short"}">
        <span class="dbu-clash-name">${Handlebars.escapeExpression(attack.attackerName)}<em>
          ${Handlebars.escapeExpression(profile.label)} ${index + 1}</em></span>
        ${rolledTotal(roll)}${outcome}
      </div>`;
  }).join("");

  return `
    <div class="dbu-clash-reason">${Handlebars.escapeExpression(profile.label)} &middot;
      ${settled.rolls.length} more Strikes ${Handlebars.escapeExpression(against)} &middot;
      ${settled.beat} landed, +${settled.perTier}(T) to the Wound Roll</div>
    ${rows}`;
}

/** Everyone whose confirmation the attack is waiting on. */
function attackParticipants(attack) {
  return [attack.attackerUuid, ...attackTargets(attack).map(target => target.uuid)];
}

/** Whether everyone has confirmed and the dice can be picked up. */
function attackIsReady(attack) {
  return attackParticipants(attack).every(uuid => (attack.ready ?? []).includes(uuid));
}

/**
 * Record what a target is answering with, and that they are done preparing.
 *
 * The defence is only written down here - it is rolled once the attacker has confirmed
 * too, so that neither side is committed to dice while the other is still deciding.
 */
function chooseDefence(message, target, defence, wager = 0, foundation = "energy") {
  // Read fresh rather than trusting what the dialog was opened with: the other side
  // may have confirmed since, and writing a stale copy back would erase it.
  const attack = message.getFlag(SCOPE, ATTACK_FLAG);
  if (!attack || attack.result) return;

  // Replaced rather than merged in, so choosing again overwrites rather than piling up.
  const others = (attack.defences ?? []).filter(entry => entry.uuid !== target.uuid);

  return settleAttack(message, {
    ...attack,
    defences: [...others, { uuid: target.uuid, defence, wager, foundation }],
    ready: [...new Set([...(attack.ready ?? []), target.uuid])]
  });
}

/** Record that the attacker has finished applying whatever they are bringing. */
function readyAttacker(message) {
  const attack = message.getFlag(SCOPE, ATTACK_FLAG);
  if (!attack || attack.result) return;

  return settleAttack(message, {
    ...attack,
    ready: [...new Set([...(attack.ready ?? []), attack.attackerUuid])]
  });
}

/** Write the attack back, and roll it if that was the last confirmation needed. */
async function settleAttack(message, attack) {
  if (!attackIsReady(attack)) return requestEdit(message, { type: "attack", attack });
  return resolveAttack(message, attack);
}

/**
 * What a Profile takes off the Strike Roll.
 *
 * Crushing: "only apply half of your Haste to the Strike Roll." Strike is Haste plus
 * Awareness, so this is a line taking half the Haste back off rather than a Strike
 * rebuilt from scratch - which would throw away everything else that changed it, the
 * sheet's own modifiers and any effect written against `strike` included.
 *
 * Empty when nothing applies, so the breakdown does not carry a zero.
 */
function profileStrikeParts(attacker, attack) {
  const profile = PROFILES[attack.profile];
  if (!profile?.halfHasteOnStrike) return [];

  const haste = attacker.system.haste ?? 0;
  const lost = haste - Math.floor(haste / 2);
  return lost ? [{ label: "Crushing", value: -lost }] : [];
}

/**
 * Roll the exchange: the Strike, and whatever each target chose to meet it with.
 */
async function resolveAttack(message, attack) {
  const attacker = fromUuidSync(attack.attackerUuid);
  const targets = attackTargets(attack)
    .map(entry => ({ ...entry, actor: fromUuidSync(entry.uuid) }))
    .filter(entry => entry.actor);

  if (!attacker || !targets.length) {
    ui.notifications.warn("One of the actors in this attack no longer exists.");
    return;
  }

  // Tier of Power Extra Dice ride on every combat roll, each side using its own.
  const attackerOptions = {
    extraDice: attacker.system.dice.extra.formula,
    criticalDice: attacker.system.dice.critical.formula,
    combatRoll: true
  };

  // One Strike Roll for the whole Maneuver. An area attack is one attack reaching
  // several people, not several attacks - so everybody it reaches answers the same
  // number, and each of them answers it their own way.
  //
  // Diminishing Offense blunts the Strike Roll of every Attacking Maneuver made once
  // the round's free attacks are spent.
  const strike = await rollSide(attacker, [
    { label: "Strike", value: attacker.system.combat.strike },
    ...profileStrikeParts(attacker, attack),
    ...modifierStrikeParts(attacker, attack),
    ...musclePenalty(attacker),
    // Left off entirely rather than shown at nothing: a row saying Diminishing Offense
    // took nothing off is a row a reader has to work out the meaning of, and the rule is
    // that it does not apply rather than that it applies and comes to zero.
    ...(attack.outsideDiminishing
      ? []
      : [{ label: "Dim. Offense", value: -attacker.system.diminishing.offense.penalty }]),
    ...thresholdPenalty(attacker)
  ], {
    ...attackerOptions, slot: "strike", attackingManeuver: true,
    // Clearing puts a floor under the Natural Result; Cutting makes anything short of a
    // Critical a Botch. Both belong to the Profile rather than to the character, so they
    // travel with the roll instead of being written to a Slot.
    minimumNatural: PROFILES[attack.profile]?.minimumNatural ?? 0,
    botchUnlessCritical: Boolean(PROFILES[attack.profile]?.botchUnlessCritical)
  });

  // From here it branches. What each of them did about that Strike is theirs alone, and
  // one of them being missed says nothing about the next.
  const branches = [];

  for (const { uuid, actor: target } of targets) {
    const {
      defence: defense = "dodge",
      wager: defenceWager = 0,
      foundation: defenceFoundation = "energy"
    } = defenceFor(attack, uuid) ?? {};

    const options = {
      extraDice: target.system.dice.extra.formula,
      criticalDice: target.system.dice.critical.formula,
      combatRoll: true
    };

    // Some things land whatever the Clash would have said: the Determined State on the
    // attacker's side, being Sleeping on the defender's. Settled before the defence is
    // rolled, because a roll whose result cannot matter should not be made - a Sleeping
    // character winning a Dodge and being hit anyway reads as the rule not working.
    const forced = attack.autoHit
      ? `${attack.maneuverName} hits automatically`
      : attacker.system.effects?.slots?.["attack.autoHit"] === true
      ? `${attacker.name} hits automatically`
      : target.system.effects?.slots?.["incoming.autoHit"] === true
      ? `${target.name} is hit automatically`
      : null;

    // What this defender answers the Strike with, and whether they answer at all.
    const defence = DEFENCES[defense];

    // A forced hit settles the first Strike and nothing else. Where more Strikes follow
    // it - Combination's do - the defence still has work to do: those are measured
    // against it, so it is rolled even though it cannot stop the blow that is coming.
    // Without this the defender met three more Strikes with nothing at all, and every
    // one of them landed for free.
    const stillCounts = Boolean(PROFILES[attack.profile]?.followUps);
    const answer = (forced && !stillCounts)
      ? null
      : await defence.answer(target, options, attack);

    const automatic = Boolean(forced);

    // "Reduce your Strike Rolls against any Character at Long Range by 2(bT)." Against a
    // Character - so it is taken off here, where the Strike meets this defence, and not
    // off the roll itself. One Strike Roll can reach several people standing at several
    // distances, and what it is worth against each of them is not the same number.
    //
    // Floored at nothing like every other roll: a Strike reduced past zero is a Strike
    // of zero, not one an opponent has to beat from below.
    const longRange = longRangePenalty(attacker, target);

    // "Increase your Combat Rolls against Analyzed Opponents." Added here for the same
    // reason the Long Range penalty is taken here: one Strike Roll reaches several people
    // and what it is worth against each of them is not the same number.
    const analysis = analysisBonus(attacker, target).reduce((sum, p) => sum + p.value, 0);
    const against = Math.max(0, (strike.total + analysis) - longRange);

    // The defender wins ties, as everywhere else: the attacker has to beat them.
    const hit = automatic || (answer ? (against > answer.total) : true);

    // What this defender's own effects do about being hit - Superior taking more
    // Damage, Prone taking it a category harder. Collected once, used at the Wound Roll.
    const incoming = hit ? atMoment(target, "being-hit", { attack: 1, attacker: 1 }) : null;

    // "Or until they are hit by an Attacking Maneuver (whichever comes first)." The other
    // half of a whichever: the turn edge goes on counting and this ends it early.
    //
    // The GM's client alone, as the turn edges are swept by the GM's client alone - the
    // clock can be kept by somebody this client does not own. With no GM connected the
    // Guard Down comes off at the end of the turn instead, which is the other half of the
    // same sentence: it outlasts its welcome rather than sticking for ever.
    if (hit && (game.users.activeGM === game.user)) {
      const ran = await endedBy(target, "being-hit");
      if (ran.length) {
        await settledNote(message,
          `${target.name} is hit, and that ends ${ran.join(", ")}.`);
      }
    }

    if (incoming) spendChosen(target, incoming);

    // Every step for and against the Damage Category is summed before anything is
    // clamped, so an attack pushed well past Lethal is still above one merely at it.
    // Per target, because the defence is part of it: a Guard drops the Category for
    // whoever guarded and for nobody else.
    // Cutting: "on a Critical Result for the Strike Roll, increase the Damage Category
    // by 1 Category." Summed with the rest rather than applied on its own, so a Guard
    // pulling the Category down still meets it in the middle.
    const criticalStep = (strike.outcome === "critical")
      ? (PROFILES[attack.profile]?.categoryUpOnCriticalStrike ?? 0)
      : 0;

    const shift = (attack.damageCategoryShift ?? 0)
      + criticalStep
      + (defence.damageCategoryShift ?? 0)
      + (incoming?.slots?.["incoming.damage.category.shift"]?.add ?? 0);

    // Gained after the Attacking Maneuver, so it never touches the roll just made. The
    // Defend Maneuver spares you these entirely, whichever option it was used for.
    // Relayed rather than written directly: the exchange is settled by whichever client
    // confirmed last, which is as often the attacker's as the defender's, and that one
    // does not own the target. Writing straight to it there throws and takes the rest
    // of the resolution - the result itself included - down with it.
    // Keyed to the roll having been made, which is the reasoning this always had: what
    // accrues the stacks is having dodged, and a Dodge that was never rolled is not one.
    // A forced hit that still called for the roll - a Combination - therefore does
    // accrue them, because the Dodge happened. Flagged for the table: the rule says the
    // stacks come from defending against attack after attack, and whether being hit
    // automatically still counts as defending is a reading, not something the text
    // settles.
    if (defence.gainsDiminishingDefense && answer) {
      // Sweeping doubles what a target takes, but only "if you deal Damage with this
      // Attacking Maneuver" - which is not known yet. So the multiplier travels with
      // the attack and the stacks are settled once the Damage is.
      await requestActorUpdate(target, {
        "system.diminishingDefense":
          target.system.diminishingDefense + target.system.diminishing.defense.perAttack
      });
    }

    branches.push({
      uuid,
      defense,
      defenseLabel: defence.label,
      // Carried through to the Wound Roll step, which is where Power Flare's own roll
      // happens - the Ki was already paid when the defence was declared.
      defenceWager,
      defenceFoundation,
      answer,
      hit,
      automatic,
      // What the Strike was worth against this one, and what the distance cost it. Both
      // said on the card: a Strike of 20 losing to a Dodge of 15 reads as a bug unless
      // the five that went missing are named.
      longRange,
      // Said on the card beside the distance, and for the same reason: a Strike of 15
      // beating a Dodge of 17 reads as a bug unless the two that came from somewhere are
      // named.
      analysis,
      against,
      // Said on the card, since a defence that was never rolled needs a reason beside
      // it or it looks like it was simply forgotten.
      forced,
      damageCategory: resolveDamageCategory(attack.damageCategory, shift),
      // Carried on the attack so the Wound Roll can apply it: the defender's client
      // worked it out, and the attacker's is as likely to be the one settling this.
      incomingDamage: incoming?.slots?.["incoming.damage"] ?? null,
      counterWound: null,
      applied: false
    });
  }

  requestEdit(message, {
    type: "attack",
    attack: { ...attack, result: { strike, targets: branches, wound: null } }
  });

  // Cross Counter strikes back the moment the clash is settled. It is offered rather
  // than fired so the defender still chooses when to take it, like any other
  // Out-of-Sequence Maneuver - and offered to each of them who answered that way, since
  // one attack reaching four people can be struck back at by all four.
  for (const { uuid, name } of targets) {
    const own = branches.find(entry => entry.uuid === uuid);
    if (!DEFENCES[own?.defense]?.counterAttacks) continue;
    requestEdit(message, {
      type: "offer",
      offer: {
        actorUuid: uuid,
        actorName: name,
        maneuverId: "basic-attack",
        maneuverName: "Basic Attack",
        targetUuid: attack.attackerUuid,
        reason: "Cross Counter"
      }
    });
  }

  // "If you avoid an Attacking Maneuver due to using the Parry option of the Defend
  // Maneuver." Avoided, not merely answered: a Parry that lost is a Parry that was hit,
  // and there is nothing in your hands to throw.
  for (const { uuid, actor: target } of targets) {
    const own = branches.find(entry => entry.uuid === uuid);
    if ((own?.defense !== "parry") || own.hit) continue;
    offerReflect(message, attack, target, "Reflect - your Parry turned it aside");
    // The other thing that can be done with a caught attack, from the same moment. Both
    // are offered and one may be taken, which is the whole of the exclusion between them.
    offerAbsorb(message, attack, target, "Attack Absorption - your Parry turned it aside");
  }
}

/**
 * What happened to one target of an attack, or nothing before anything did.
 *
 * A list rather than an object keyed by uuid, and that is not a style choice. A uuid is
 * "Actor.4Nx8qLmP2Zk" - dots and all - and Foundry expands dotted keys when a document
 * is written, so `{"Actor.4Nx8qLmP2Zk": ...}` comes back as `{Actor: {4Nx8qLmP2Zk:
 * ...}}` and the lookup finds nothing. A list of entries carrying their own uuid
 * survives whatever the write does to it.
 */
function targetResult(attack, uuid) {
  return (attack.result?.targets ?? []).find(entry => entry.uuid === uuid) ?? null;
}

/**
 * Why this attack cannot be thrown back, or null.
 *
 * "You may use this Maneuver if the Attacking Maneuver was of the Energy or Magic
 * Foundation", and "that did not possess an AoE". The rest of the condition is about
 * *how* it was avoided and is asked where each of those is settled - a Parry that won,
 * or a Deflect that took its Might Clash.
 */
function whyNotReflect(attack) {
  if (!["energy", "magic"].includes(attack.foundation)) {
    return "only an Energy or Magic Attack can be thrown back";
  }
  if (PROFILES[attack.profile]?.area) {
    return "an Attacking Maneuver with an Area of Effect cannot be thrown back";
  }
  return null;
}

/**
 * Offer the Reflect Maneuver to somebody who just turned an attack aside.
 *
 * The attack travels with the offer rather than being looked up when it is taken: what
 * is thrown back is that attack as it stood - its Profile, its Ki Wager, its Energy
 * Charges - and the card it came from goes on being edited after this.
 */
function offerReflect(message, attack, actor, reason) {
  if (!actor || whyNotReflect(attack)) return;
  if (!actor.items?.some(item => (item.type === "maneuver") && item.system.reflect)) return;

  requestEdit(message, {
    type: "offer",
    offer: {
      actorUuid: actor.uuid,
      actorName: actor.name,
      maneuverId: "reflect",
      maneuverName: "Reflect",
      reason,
      reflect: {
        maneuverName: attack.maneuverName,
        attackerUuid: attack.attackerUuid,
        attackerName: attack.attackerName,
        profile: attack.profile,
        foundation: attack.foundation,
        kiWager: attack.kiWager ?? 0,
        energyCharges: attack.energyCharges ?? 0,
        damageCategoryShift: attack.damageCategoryShift ?? 0,
        signature: Boolean(attack.signature),
        advantages: attack.advantages ?? [],
        powerShotRanks: attack.powerShotRanks ?? 0,
        squaresCharged: attack.squaresCharged ?? 0
      }
    }
  });
}

/**
 * Why this attack cannot be absorbed, or null.
 *
 * "An Attacking Maneuver of the Energy or Magic Foundation", and that is the whole of the
 * condition on the attack itself. No Area of Effect clause: the Reflect entry has one -
 * "that did not possess an AoE" - and this one does not, so an Area attack a Parry turned
 * aside can be swallowed although it could not be thrown back. Read off the two entries
 * side by side rather than assumed to match, because they are a paragraph apart and
 * differ.
 *
 * Where it is offered from is narrower than Reflect's, and that is asked at the door
 * rather than here: Reflect comes from a won Parry and from a won Might Clash on a
 * Deflect, and this entry names only "the Parry option of the Defend Maneuver".
 */
function whyNotAbsorb(attack) {
  if (!["energy", "magic"].includes(attack.foundation)) {
    return "only an Energy or Magic Attack can be absorbed";
  }
  return null;
}

/**
 * Offer Attack Absorption to somebody whose Parry turned an Energy or Magic attack aside.
 *
 * Offered beside the Reflect rather than instead of it: they are the two things that can
 * be done with an attack you caught, and which one is the player's to say. Taking either
 * closes the other, because one Out-of-Sequence Maneuver per character per card is a rule
 * this machinery already keeps - and that is exactly what "you cannot use the Reflect
 * Maneuver in response to the successful Parry" asks for, so nothing here repeats it.
 *
 * A Special Maneuver, so holding the Item is not access. It has to have been opened, by
 * an effect or by the Skill Ranks that open one, and an offer nobody may take is worse
 * than no offer at all.
 */
function offerAbsorb(message, attack, actor, reason) {
  if (!actor || whyNotAbsorb(attack)) return;

  const item = actor.items?.find(entry => (entry.type === "maneuver") && entry.system.absorb);
  if (!item) return;

  const maneuver = getManeuver(item.system.maneuverId || item.id);
  if (!maneuver || whyNotSpecial(actor, maneuver)) return;

  requestEdit(message, {
    type: "offer",
    offer: {
      actorUuid: actor.uuid,
      actorName: actor.name,
      maneuverId: maneuver.id,
      maneuverName: maneuver.name,
      reason
    }
  });
}

/**
 * Swallow the attack a Parry turned aside.
 *
 * Nothing is rolled here. What the entry asks for is a roll of the Opponent's - "an Urgent
 * Wound Roll for their Attacking Maneuver as if you were hit" - and that is the Wound Roll
 * the card already knows how to ask for, with that attack's own Ki Wager, Energy Charges
 * and Profile behind it. So this writes the absorption onto the attack and the button
 * grows on their client: an attack that hit nobody does not ordinarily owe a Wound Roll,
 * and an absorbed one does.
 *
 * It deals the absorber no Damage. They avoided it - the Parry won - and "as if you were
 * hit" is there to say there is a roll at all. What the roll is for is the Ki.
 */
async function absorbAttack(message, actor, maneuver) {
  const attack = message.getFlag(SCOPE, ATTACK_FLAG);
  if (!attack || attack.absorbed) return;

  requestEdit(message, {
    type: "attack",
    attack: {
      ...attack,
      absorbed: {
        uuid: actor.uuid,
        name: actor.name,
        maneuverName: maneuver.name,
        // Filled in when the roll is made. Null rather than zero, so a card drawn between
        // the two says the roll is owed rather than saying it came to nothing.
        regained: null,
        fifth: false
      },
      // "An Urgent Wound Roll." The same flag a reflected attack sets and the same thing
      // it means: this one cannot be failed on purpose.
      urgentWound: true
    }
  });

  return settledNote(message,
    `${actor.name} absorbs ${attack.maneuverName}. ${attack.attackerName} rolls its Wound `
    + `Roll as if it had hit, and half the Dice Score comes back to ${actor.name} as Ki.`);
}

/**
 * Pay out an absorption, once the Wound Roll it asked for has been made.
 *
 * "You regain Ki Points equal to 1/2 of the Dice Score." The Dice Score is the whole of
 * the roll - the Base Die, every other die, and every bonus - as it is everywhere else in
 * these rules, and the half is rounded down as every half here is.
 *
 * What is regained is what there was room for: three Ki short of full, you regain three,
 * whatever the roll came to. That is also what the second paragraph measures, since "if
 * you regain Ki Points that equal or exceed 1/5 of your Maximum" is about the Ki that
 * actually came back - so a character at full Ki absorbs an attack and gets no Power Up
 * out of it.
 *
 * @returns {Promise<object>} the absorption with what it came to written on it
 */
async function settleAbsorption(message, attack, wound) {
  const absorbed = attack.absorbed;
  const absorber = fromUuidSync(absorbed.uuid);
  if (!absorber) return absorbed;

  const half = Math.floor((wound.total ?? 0) / 2);
  const { value, max } = absorber.system.ki;
  const regained = Math.min(max, value + half) - value;

  // Relayed, because whoever is settling this is whoever rolled the Wound - which is the
  // Opponent, and they do not own the character being paid.
  await requestActorUpdate(absorber, { "system.ki.value": value + regained });

  // "Equal or exceed 1/5 of your Maximum Ki Points", asked by multiplying rather than by
  // dividing so that no rounding has to be invented: a fifth of 23 is 4.6, and 5 clears
  // it where 4 does not.
  const fifth = (regained * 5) >= max;

  const card = await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: absorber }),
    content: checkCard({
      parts: `${Handlebars.escapeExpression(absorbed.maneuverName)} &middot; `
        + `half of ${wound.total}`,
      total: `+${regained} KP`,
      outcome: "surge"
    })
  });

  // "You may use the Power Up Maneuver as an Out-of-Sequence Maneuver." Offered on this
  // card rather than on the attack, because the attack's one Out-of-Sequence Maneuver has
  // just been taken - by this. That limit is right and this is not an exception to it: the
  // Power Up is a fresh chance the absorption handed over, not a second use of the opening
  // the absorption itself came through.
  //
  // Named rather than swept for, as Cross Counter names the Basic Attack it gives away.
  if (fifth && card) {
    requestEdit(card, {
      type: "offer",
      offer: {
        actorUuid: absorber.uuid,
        actorName: absorber.name,
        maneuverId: "power-up",
        maneuverName: "Power Up",
        reason: `Attack Absorption - ${regained} KP is a fifth of ${max}`
      }
    });
  }

  return { ...absorbed, regained, fifth };
}

/** What one target chose to answer with, before any of it was rolled. */
function defenceFor(attack, uuid) {
  return (attack.defences ?? []).find(entry => entry.uuid === uuid) ?? null;
}

/** The target lines with one of them changed, leaving the rest exactly as they were. */
function replaceTarget(attack, uuid, changes) {
  return (attack.result?.targets ?? [])
    .map(line => (line.uuid === uuid) ? { ...line, ...changes } : line);
}

/** Every target of an attack, paired with what happened to them. */
function targetResults(attack) {
  return attackTargets(attack).map(target => ({ ...target, own: targetResult(attack, target.uuid) }));
}

/**
 * The row saying an attack was swallowed, and what it was worth.
 *
 * Its own row rather than a note in the title, because it is two facts arriving at
 * different times: the absorption is written the moment the Maneuver is taken, and what it
 * paid is only known once the Opponent has rolled. A null `regained` is a roll still owed
 * and says so, where a zero would read as an absorption that came to nothing.
 */
function absorbRow(attack) {
  const absorbed = attack.absorbed;
  if (!absorbed) return "";

  const gain = (absorbed.regained === null) || (absorbed.regained === undefined)
    ? "awaiting the Wound Roll"
    : `+${absorbed.regained} KP`;

  // The same two classes every other row on this card is built from, rather than a pair
  // of its own that the stylesheet has never heard of.
  return `
    <div class="dbu-clash-side">
      <span class="dbu-clash-name">${Handlebars.escapeExpression(absorbed.name)}<em> absorbs
        ${Handlebars.escapeExpression(absorbed.maneuverName)}${
          absorbed.fifth ? " - a fifth of their maximum Ki" : ""}</em></span>
      <span class="dbu-clash-total">${Handlebars.escapeExpression(gain)}</span>
    </div>`;
}

/**
 * Power Flare answers the Wound Roll, and answers it for one person.
 *
 * So there is a row per flare rather than one for the attack: two people can both flare
 * against the same Wound Roll, and one of them beating it says nothing about the other.
 */
function flareRows(attack) {
  return targetResults(attack)
    .filter(entry => entry.own?.counterWound)
    .map(entry => attackSide(
      entry.own.defenceWager ? `Power Flare +${entry.own.defenceWager} KP` : "Power Flare",
      entry.name, entry.own.counterWound))
    .join("");
}

/** Who the exchange is still waiting on, named so nobody has to guess. */
function awaitingWhom(attack) {
  const waiting = [
    ...((attack.ready ?? []).includes(attack.attackerUuid) ? [] : [attack.attackerName]),
    ...attackTargets(attack).filter(target => !(attack.ready ?? []).includes(target.uuid)).map(target => target.name)
  ];
  return waiting.length ? `Waiting on ${waiting.map(name => Handlebars.escapeExpression(name)).join(", ")}` : "Rolling";
}

/**
 * Let the attacker bring what they have to the Strike, then mark them ready.
 */
/**
 * Hand the same attack to somebody else the area caught.
 *
 * No geometry. The Profile says it has a Line or a Sphere; who that actually covers is
 * a question about where everyone is standing, and the player and the GM can answer it
 * faster than any measurement of mine would. So this lists the characters on the scene
 * and takes whoever is named.
 *
 * Each one gets a card of their own, carrying the same declaration - Profile,
 * Foundation, wager, Charges - so the exchange that follows is the one that already
 * works: they answer it, clash with it, and take their own Wound Roll. What is *not*
 * repeated is the price: the Ki was paid once when the Maneuver was declared, and the
 * Action and the attack itself are counted once for the same reason.
 */
async function addAreaTargets(message, attack, attacker) {
  const already = new Set([attack.attackerUuid, ...attackTargets(attack).map(t => t.uuid)]);

  // Everyone on the scene with a character sheet, minus the attacker and whoever is
  // already in this exchange. Tokens rather than the Actors directory, since an
  // unlinked token is its own character and two of them may share a name.
  const candidates = (canvas?.tokens?.placeables ?? [])
    .map(token => token.actor)
    .filter(actor => actor && (actor.type === "character") && !already.has(actor.uuid));

  // Named once each: two tokens of one linked Actor are one character standing in two
  // places as far as the sheet is concerned, and hitting them twice is not a rule.
  const unique = [...new Map(candidates.map(actor => [actor.uuid, actor])).values()];

  if (!unique.length) {
    ui.notifications.info("There is nobody else on this scene to catch.");
    return;
  }

  const rows = unique.map(actor => `
    <label class="dbu-respond-option">
      <input type="checkbox" name="caught" value="${actor.uuid}"/>
      <span class="dbu-respond-name">${Handlebars.escapeExpression(actor.name)}</span>
      <span class="dbu-respond-source">${actor.system.life.value}/${actor.system.life.max} LP</span>
    </label>`).join("");

  const area = PROFILES[attack.profile]?.area;
  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: `${attack.maneuverName} - Add targets` },
    content: `<p class="dbu-respond-hint">Who else does the
      ${Handlebars.escapeExpression(areaLabel(area))} catch? They join this attack and
      answer the same Strike Roll, each defending it their own way.</p>${rows}`,
    buttons: [
      {
        action: "confirm",
        label: "Add",
        callback: (event, button, dialog) =>
          [...dialog.element.querySelectorAll('input[name="caught"]:checked')]
            .map(input => input.value)
      },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });

  if (!Array.isArray(chosen) || !chosen.length) return;

  // Added to this attack rather than posted as attacks of their own. One Attacking
  // Maneuver reaching four people is one Strike Roll and one Wound Roll that all four
  // answer - and it is counted once, paid for once, and charged once, which separate
  // cards could only imitate.
  const added = chosen
    .map(uuid => fromUuidSync(uuid))
    .filter(Boolean)
    .map(actor => ({ uuid: actor.uuid, name: actor.name }));

  if (!added.length) return;

  return requestEdit(message, {
    type: "attack",
    attack: { ...attack, targets: [...attackTargets(attack), ...added] }
  });
}

async function attackerStage(message, attack, attacker) {
  const triggers = relevantTriggers(attacker, message, "response");
  // Their own Attacking Maneuver, so Compelled's Urgency reaches this one.
  const ready = await prepareRoll(attacker, triggers, "Before the Strike Roll",
    "", { combatRoll: true, attackingManeuver: true });
  if (!ready) return;
  return readyAttacker(message);
}

async function woundStage(message, attack) {
  const attacker = woundRoller(attack);
  if (!attacker) return;

  const triggers = relevantTriggers(attacker, message, "hit");
  const ready = await prepareRoll(attacker, triggers, "On hitting",
    "", {
      combatRoll: true,
      attackingManeuver: true,
      // "As an Urgent Roll." A reflected attack's Wound Roll cannot be failed on purpose
      // - the option is closed with its reason beside it, the way Compelled closes it.
      urgent: Boolean(attack.urgentWound)
    });
  if (!ready) return;
  return rollAttackWound(message, attack);
}

/**
 * Who owes this attack's Wound Roll.
 *
 * The one who made it, on every attack but a reflected one: "the original attacking
 * Opponent rolls the Wound Roll for their initial Attacking Maneuver instead". That is
 * the only rule in these rules that splits one attack between two characters, and it is
 * asked here so that nothing has to remember it twice.
 */
function woundRoller(attack) {
  return fromUuidSync(attack.woundBy || attack.attackerUuid);
}

/**
 * What a Profile adds to the Wound Roll.
 *
 * Powered: "apply your Damage Attribute an additional time." The Damage Attribute is
 * whichever the Foundation names - it is already inside the Wound value once, so this
 * is that Modifier added again rather than the Wound doubled, which would take Might
 * and everything else along with it.
 */
/**
 * The Wound Roll's own line: the Damage Attribute and what the attacker's effects add to it.
 *
 * Where the attack brings a Damage Attribute of its own - a Bomb's recorded Scholarship
 * Modifier - that Modifier stands where the Foundation's Attribute would, and everything
 * the attacker's effects add stays. "Using the recorded Scholarship Modifier as its Damage
 * Attribute": the Attribute is swapped, not the character.
 */
function woundBase(attacker, attack) {
  const wound = attacker.system.combat.wound[attack.foundation] ?? 0;
  const own = attack.damageAttribute;
  if (!own) return { label: "Wound", value: wound };

  const attribute = DBUCharacterData.FOUNDATIONS[attack.foundation]?.attribute;
  const theirs = attacker.system.attributes?.[attribute]?.mod ?? 0;
  return { label: `Wound (${own.label})`, value: wound - theirs + (Number(own.value) || 0) };
}

function profileWoundParts(attacker, attack) {
  const profile = PROFILES[attack.profile];
  const parts = [];

  if (profile?.extraDamageAttribute) {
    const foundation = DBUCharacterData.FOUNDATIONS[attack.foundation];
    const modifier = attacker.system.attributes?.[foundation?.attribute]?.mod ?? 0;
    if (modifier) parts.push({ label: `${profile.label} (${foundation.label})`, value: modifier });
  }

  // Mega Flare: "for every Energy Charge applied to this Attacking Maneuver, increase
  // the Wound Roll by 1(T)." On top of the die each Charge already adds - that die is
  // the Energy Charge Maneuver's doing, and this is the Profile's.
  if (profile?.woundPerChargePerTier) {
    const per = (attack.energyCharges ?? 0) * profile.woundPerChargePerTier;
    const bonus = per * (attacker.system.tierOfPower ?? 1);
    if (bonus) parts.push({ label: `${profile.label} (charges)`, written: `+${per}(T)`, value: bonus });
  }

  // Blitz: "if you move a number of Squares that exceeds your Normal Speed due to the
  // effects of Charging Assault, increase the Wound Roll by 1/2 of your Agility
  // Modifier." A rule this Profile has about an Advantage it granted, so it is keyed
  // off the same number the Advantage was given and not off the Advantage itself.
  if (profile?.woundPerCharge === "halfAgilityBeyondNormalSpeed") {
    const squares = Math.max(0, attack.squaresCharged ?? 0);
    const bonus = Math.floor((attacker.system.attributes?.agility?.mod ?? 0) / 2);
    if ((squares > (attacker.system.speed?.normal ?? 0)) && (bonus > 0)) {
      parts.push({ label: `${profile.label} (charge)`, value: bonus });
    }
  }

  return parts;
}

/**
 * How much of the target's Soak Value an attack simply passes through.
 *
 * Pinpoint: "ignores an amount of the target's Soak Value equal to your Insight
 * Modifier", and "if you score a Critical Result on the Strike Roll, double your
 * Insight Modifier for the duration of this Attacking Maneuver" - which is the Strike
 * that was already rolled and settled, so it is read rather than asked for again.
 *
 * Taken off the Soak that the Damage Category left, not off the Soak Value on the
 * sheet: the Category has already had its say, and ignoring more than is there ignores
 * what is there.
 */
function profileSoakIgnored(attacker, attack) {
  const profile = PROFILES[attack.profile];
  if (!profile?.ignoresSoakByInsight) return 0;

  const insight = attacker.system.attributes?.insight?.mod ?? 0;
  const doubled = attack.result?.strike?.outcome === "critical";
  return Math.max(0, insight * (doubled ? 2 : 1));
}

/**
 * Combination's follow-up Strikes.
 *
 * "After you hit an Opponent with this Attacking Maneuver but before you roll your
 * Wound Roll, roll your Strike Roll for this Attacking Maneuver against the Dice Score
 * of their Dodge Roll or Strike Roll (if they used the Parry option of the Defend
 * Maneuver) an additional 3 times. For every additional time your Strike Roll exceeds
 * their Dice Score, increase the Wound Roll by an additional 2(T)."
 *
 * The Dice Score is the whole of a roll - the Base Die, every other die, and every
 * bonus, all together. It is not the Natural Result, which is the Base Die alone.
 *
 * Rolled at the same bonus the first Strike was, rather than rebuilt from the sheet: a
 * triggered effect that raised that Strike raised *this* attack's Strike Roll, and
 * rebuilding would silently drop it. Collected effects are not offered again, though -
 * these are three repetitions of one roll, not three more exchanges.
 *
 * Only against a defence that was rolled. Direct Hit, Guard and Power Flare answer with
 * no roll at all, so there is no Dice Score to measure against and nothing to beat.
 */
/**
 * Whether this attack still owes its follow-up Strikes.
 *
 * Combination puts three more Strike Rolls between the hit and the Wound Roll, and the
 * rule puts them there for a reason: they decide how much the Wound Roll is worth. So
 * they are a step of their own on the card - the Wound button does not appear until
 * they have been made - rather than three rolls that happened inside the Wound Roll
 * where nobody saw them.
 */
function awaitsFollowUps(attack) {
  return Boolean(PROFILES[attack.profile]?.followUps)
    && anyoneHit(attack)
    && !attack.result?.wound
    && !attack.result?.followUps;
}

/** Whether the Strike landed on anybody at all. */
function anyoneHit(attack) {
  return (attack.result?.targets ?? []).some(line => line.hit);
}

/**
 * Whether this attack owes a Wound Roll.
 *
 * Landing on somebody is the usual reason. An Absolute Attack owes one whatever
 * happened - "you still roll the Wound Roll for that Attacking Maneuver" - so a
 * Maneuver that missed everybody it reached still has this step to make.
 */
function owesWound(attack) {
  // A won Deflect turns the whole thing aside - "deflected away from all targets" - so
  // there is nothing left to roll, for anybody, Absolute or not.
  if (deflection(attack)) return false;
  // An absorption asks for one where nothing was hit: "your Opponent makes an Urgent Wound
  // Roll for their Attacking Maneuver as if you were hit". Half its Dice Score is the
  // whole point of the Maneuver, so the roll is owed even when the attack landed on
  // nobody at all.
  return anyoneHit(attack) || Boolean(attack.absolute) || Boolean(attack.absorbed);
}

/** Whether this line is an Absolute Attack's answer to having missed. */
function isAbsoluteMiss(own) {
  return Boolean(own?.absolute) && !own?.hit;
}

/**
 * Roll Combination's three follow-up Strikes and write down what they came to.
 *
 * "Roll your Strike Roll for this Attacking Maneuver against the Dice Score of their
 * Dodge Roll or Strike Roll an additional 3 times. For every additional time your
 * Strike Roll exceeds their Dice Score, increase the Wound Roll by an additional 2(T)."
 *
 * The Dice Score is the whole of a roll - the Base Die, every other die, and every
 * bonus, all together. It is not the Natural Result, which is the Base Die alone.
 *
 * Rolled at the same bonus the first Strike was, rather than rebuilt from the sheet: a
 * triggered effect that raised that Strike raised *this* attack's Strike Roll, and
 * rebuilding would silently drop it. Collected effects are not offered again, though -
 * these are three repetitions of one roll, not three more exchanges.
 */
async function rollFollowUpStrikes(message, attack, attacker) {
  const profile = PROFILES[attack.profile];
  const plan = profile?.followUps;
  if (!plan) return;

  // Only against a defence that was rolled. Direct Hit, Guard and Power Flare answer
  // with no roll at all, so there is nothing to measure against and nothing to beat -
  // the follow-ups are made and none of them can land.
  //
  // Measured against whoever was hit and rolled something. Combination has no area, so
  // in practice that is the one person it was aimed at; taking the first rather than
  // assuming there is only one keeps it honest if that ever changes.
  //
  // Against the whole Dodge they made, not the dice inside it. They are still defending
  // with the roll they defended the first Strike with - the same number that lost - and
  // measuring against the dice alone left them answering three more Strikes with a bare
  // die while every bonus on the roll went missing.
  // The line these are measured against, and what the Strike was worth against that
  // person - the Long Range penalty among it. These are three more Strike Rolls against
  // the same Character, so the distance costs them what it cost the first one.
  const line = (attack.result?.targets ?? []).find(entry => entry.hit && entry.answer) ?? null;
  const answer = line?.answer ?? null;
  const beatable = answer ? (answer.total ?? 0) : null;
  const longRange = line?.longRange ?? 0;

  const rolls = [];
  for (let i = 0; i < plan.rolls; i++) {
    rolls.push(await rollSide(attacker, [{ label: "Strike", value: attack.result.strike.bonus ?? 0 }], {
      extraDice: attacker.system.dice.extra.formula,
      criticalDice: attacker.system.dice.critical.formula,
      combatRoll: true,
      slot: null,
      collect: false,
      attackingManeuver: true
    }));
  }

  const beat = (beatable === null)
    ? 0
    : rolls.filter(roll => Math.max(0, roll.total - longRange) > beatable).length;

  requestEdit(message, {
    type: "attack",
    attack: {
      ...attack,
      result: {
        ...attack.result,
        followUps: {
          rolls,
          beat,
          beatable,
          // Worked out now and carried, so the Wound Roll adds a number that was
          // settled in front of everyone rather than one it worked out for itself.
          perTier: beat * plan.woundPerHitPerTier,
          bonus: beat * plan.woundPerHitPerTier * (attacker.system.tierOfPower ?? 1)
        }
      }
    }
  });
}

/** What Combination's follow-up Strikes added, once they have been made. */
function combinationFollowUps(attacker, attack) {
  const profile = PROFILES[attack.profile];
  const settled = attack.result?.followUps;
  if (!profile?.followUps || !settled?.bonus) return [];

  // The label carries what happened, since the Wound Roll's own line is where anyone
  // will look for it: how many of the three landed, and what they had to beat.
  return [{
    label: `${profile.label} (${settled.beat} of ${profile.followUps.rolls}`
      + `${settled.beatable === null ? "" : ` beat ${settled.beatable}`})`,
    written: `+${settled.perTier}(T)`,
    value: settled.bonus
  }];
}

/**
 * Roll the Wound and work out what gets through. Kept apart from the Strike so the
 * table sees whether the attack landed before any damage is rolled - and so a hit can
 * be argued over before it becomes a number.
 */
async function rollAttackWound(message, attack) {
  // Whoever owes the Wound Roll, which is the one who made the Strike on every attack
  // but a reflected one. Everything below reads off them - their Wound, their Extra
  // Dice, their effects - because the roll is theirs.
  const attacker = woundRoller(attack);
  const targets = attackTargets(attack)
    .map(entry => ({ ...entry, actor: fromUuidSync(entry.uuid), own: targetResult(attack, entry.uuid) }))
    .filter(entry => entry.actor && entry.own);

  if (!attacker || !targets.length) {
    ui.notifications.warn("One of the actors in this attack no longer exists.");
    return;
  }

  // Wagered Ki is added to the Wound Roll - already paid for when the attack was
  // declared, which is what took it out of Capacity.
  // Each Energy Charge adds a die to this roll - a larger one for a Signature
  // Technique. They were declared through the Energy Charge Maneuver and came here with
  // the attack, and this is where they are finally worth something.
  const chargeDice = energyChargeDice(attacker, attack);

  // Rolled in their own step before this one, which is where the rule puts them.
  const followUps = combinationFollowUps(attacker, attack);

  // One Wound Roll for the whole Maneuver, like the Strike. What differs between the
  // people it reached is what each of them did about it - their Soak, their Damage
  // Reduction, and a Power Flare that answers it for them alone.
  const wound = await rollSide(attacker, [
    ...followUps,
    woundBase(attacker, attack),
    ...profileWoundParts(attacker, attack),
    ...advantageWoundParts(attacker, attack),
    ...superStackWoundParts(attacker, attack),
    ...modifierWoundParts(attacker, attack),
    { label: "Ki Wager", value: attack.kiWager ?? 0 },
    ...thresholdPenalty(attacker)
  ], {
    // Kept apart rather than joined: the dice an Energy Charge is worth and the ones
    // the Tier of Power grants are two different rules, and the card says which is
    // which. Seven Charges at Tier 3 is twenty-one dice, and "where did those come
    // from" is not a question anybody should have to work out.
    extraDice: [
      { label: "Extra dice", formula: attacker.system.dice.extra.formula },
      { label: "Energy charges", formula: chargeDice }
    ],
    criticalDice: attacker.system.dice.critical.formula,
    combatRoll: true,
    slot: "wound",
    attackingManeuver: true,
    // Cutting: "on the Wound Roll, the Critical Target is 5 (ignoring the usual limit)."
    // The usual limit is the floor a character's own Critical Target is held to when it
    // is derived, so a stated one goes in as written rather than through it.
    criticalTarget: PROFILES[attack.profile]?.woundCriticalTarget ?? null
  });

  // What an attack can get past of somebody's Damage Reduction, for this attack only.
  // Collected from the attacker once, since it is their effect and their client that
  // knows about it - the same piercing reaches everyone the attack reached.
  const pierce = atMoment(attacker, "before-wound", { attack: 1, damageCategory: 1 });
  spendChosen(attacker, pierce);
  const pierced = pierce.slots?.["damageReduction.pierced"]?.add ?? 0;

  // Ignored after the Category and the defence have both had their say, and never more
  // than is left: ignoring Soak that is not there would be worth more than ignoring
  // Soak that is.
  const ignored = profileSoakIgnored(attacker, attack);

  const settledTargets = [];

  // Whoever stepped in front of somebody takes the Wound Roll in their place. Settled
  // before the loop, because it changes two lines at once: the Ally takes nothing and
  // the one who stepped in takes what the Ally would have.
  const shields = interventions(attack).filter(takesWoundFor);
  const shielded = new Set(shields.map(entry => entry.allyUuid));
  for (const { uuid, actor: target, own } of targets) {
    // Somebody stood in front of them. They take nothing from this attack - what
    // becomes of what was aimed at them is worked out on the intervention below.
    if (shielded.has(uuid)) {
      settledTargets.push({
        ...own, counterWound: null, soak: 0, reduction: 0, damage: 0,
        shieldedBy: interventionFor(attack, uuid)?.name ?? ""
      });
      continue;
    }

    if (!own.hit) {
      // An ordinary miss takes nothing, and there is nothing here to work out for it.
      if (!attack.absolute) {
        settledTargets.push({ ...own, counterWound: null, soak: 0, reduction: 0, damage: 0 });
        continue;
      }

      settledTargets.push({ ...own, ...absoluteOutcome(target, wound) });
      continue;
    }

    const defence = DEFENCES[own.defense];

    // Power Flare answers the Wound Roll rather than the Strike Roll, immediately after
    // it - so it is rolled here, not left for another round trip.
    //
    // It is your own Wound Roll, "as if you made an Energy or Magic Attack", and which
    // of the two was chosen when the defence was declared. It is a Wound Roll like any
    // other, which is why it takes a Ki Wager and why `slot: "wound"` lets an effect
    // change it.
    //
    // It defends the one who flared and nobody else: beating the Wound Roll takes the
    // Damage off them, and everyone else it reached still takes theirs.
    const flareFoundation = own.defenceFoundation ?? "energy";
    const counterWound = defence.answersWound
      ? await rollSide(target, [
          { label: "Wound", value: target.system.combat.wound[flareFoundation] ?? 0 },
          { label: "Ki Wager", value: own.defenceWager ?? 0 }
        ], {
          extraDice: target.system.dice.extra.formula,
          criticalDice: target.system.dice.critical.formula,
          combatRoll: true,
          // Not marked as an Attacking Maneuver: this is a defence option, answering
          // somebody else's attack with a Wound Roll rather than making one of your own.
          slot: "wound"
        })
      : null;

    // A Talent that raises the Soak Value for defending does so "before any
    // calculations", so it lands on the base value - ahead of the Damage Category and
    // ahead of whatever the defence itself does to it.
    const defended = own.defense !== "dodge";
    const soakBonus = defended
      ? (atMoment(target, "defending", { defending: true, attack, attacker })
          .slots["soakValue.base"]?.add ?? 0)
      : 0;

    // Only what the Damage Category leaves of the Soak Value counts, and the defence
    // adjusts what survives that.
    const base = target.system.soakValue + soakBonus;
    const counted = Math.floor(base * DAMAGE_CATEGORIES[own.damageCategory].soakMultiplier);
    const soak = Math.max(0, defence.soak(counted) - ignored);

    // One Wound Roll serves everyone the attack reached, and this bonus is against one of
    // them - so it is added where what the roll comes to is already worked out per person,
    // which is the same place a Guard halves it.
    const analysis = analysisBonus(attacker, target).reduce((sum, p) => sum + p.value, 0);
    const effectiveWound = defence.wound(wound.total + analysis);

    // Damage Reduction comes off the same Wound Roll, and off it whole. The Damage
    // Category has already had its say on the Soak above and gets no say here, and the
    // defence's own multiplier is applied to `counted` rather than to this - which is
    // what makes a point of it worth more than a point of Soak.
    // Concentrated: "ignore 1/2 of your target's Damage Reduction." A fraction of
    // theirs, so it is taken here rather than through `damageReduction.pierced`, which
    // is an amount the attacker brings. Taken off what the piercing left, and rounded
    // down like every other halving - ignoring half of what is already gone would be
    // worth more than ignoring half of what is there.
    const afterPierce = Math.max(0, (target.system.damageReduction ?? 0) - pierced);
    const halved = PROFILES[attack.profile]?.ignoresHalfDamageReduction
      ? Math.floor(afterPierce / 2)
      : 0;
    const reduction = Math.max(0, afterPierce - halved);

    const negated = counterWound && (counterWound.total > wound.total);
    const raw = negated ? 0 : Math.max(0, effectiveWound - soak - reduction);

    // What this defender's own effects do to the Damage they take, in two passes
    // because they answer two different moments. Being hit is settled when the Clash is
    // - the Superior State takes 2(T) more - and that was worked out on the defender's
    // client and carried here on the attack. Before the Wound Roll is settled now,
    // since Broken needs the Soak Value it could not use, which is only known here.
    //
    // Neither is asked when the Soak and the Damage Reduction already swallowed the
    // whole Wound Roll: there is no Damage then, so there is nothing to answer about.
    // Asked anyway, a one-shot effect armed for this would be spent raising nothing.
    const beforeWound = (raw > 0)
      ? atMoment(target, "before-wound", { attack: 1, damageCategory: 1 })
      : null;
    if (beforeWound) spendChosen(target, beforeWound);

    const damage = damageTaken(raw,
      { "incoming.damage": own.incomingDamage },
      beforeWound?.slots);

    await maybeShakeAttacker(attacker, attack, defence, damage);

    settledTargets.push({ ...own, counterWound, effectiveWound, soak, reduction, damage });
  }

  // What the Wound Roll came to for each person who took one in somebody else's place.
  // A loop rather than a map, because working one out fires Moments and has to be waited
  // for - a map would hand on a list of promises and every number on the card would read
  // as undefined.
  const settledInterventions = [];
  for (const entry of interventions(attack)) {
    settledInterventions.push(takesWoundFor(entry)
      ? { ...entry, outcome: await interventionOutcome(attack, entry, wound) }
      : entry);
  }

  // "You regain Ki Points equal to 1/2 of the Dice Score." Settled here because this is
  // the Dice Score: one Wound Roll serves everyone an attack reached, and what the
  // absorber takes is half of what that one roll came to.
  const absorbed = attack.absorbed
    ? await settleAbsorption(message, attack, wound)
    : null;

  requestEdit(message, {
    type: "attack",
    // Damage is worked out here but not dealt: applying it is a separate, deliberate
    // step, so the table can rule on it before anyone loses Life.
    attack: {
      ...attack,
      ...(absorbed ? { absorbed } : {}),
      interventions: settledInterventions,
      result: { ...attack.result, wound, targets: settledTargets }
    }
  });
}

/**
 * A Dodge Roll's parts.
 *
 * Cross Counter halves the Defense Value, not the roll: any other bonus to the Dodge
 * Roll is untouched by it, and Diminishing Defense reduces the result afterwards. So
 * each part is kept separate rather than folded into one number that would be halved
 * wholesale.
 */
function dodgeBonus(actor, { halved = false, attack = null } = {}) {
  const defenseValue = actor.system.defenseValue;
  const parts = [{
    label: halved ? "Defense Value (halved)" : "Defense Value",
    value: halved ? Math.floor(defenseValue / 2) : defenseValue
  }];

  const other = actor.system.rollModifiers.dodge;
  if (other) parts.push({ label: "Dodge bonus", value: other });

  parts.push(...musclePenalty(actor));
  parts.push({ label: "Dim. Defense", value: -actor.system.diminishing.defense.penalty });
  parts.push(...thresholdPenalty(actor));
  parts.push(...rapidMovementDodge(actor, attack));
  // Your Dodge against somebody you Analyzed. The attacker is named on the attack, which
  // is what makes this answerable from the defender's side.
  parts.push(...analysisBonus(actor, fromUuidSync(attack?.attackerUuid ?? "")));
  return parts;
}

/**
 * Rapid Movement's Dodge bonus: "increase your Dodge Roll against an Exploit Maneuver
 * provoked by this instance of Movement by 1(T)".
 *
 * Three things have to be true, and each is a different half of "this instance": the
 * attack came through an Exploit, the Exploit was provoked by a Movement card, and Rapid
 * Movement was paid for on that card by the character now dodging. A character who moved
 * twice and paid once gets it on the one they paid for and not on the other.
 *
 * Returned as a list so it drops out of the breakdown entirely rather than showing as a
 * row worth nothing.
 */
function rapidMovementDodge(actor, attack) {
  const provoked = attack?.provokedBy;
  if (!provoked?.messageId) return [];

  const card = game.messages?.get(provoked.messageId);
  const rapid = card?.getFlag(SCOPE, RAPID_FLAG);
  if (!rapid || (rapid.actorUuid !== actor.uuid)) return [];

  const tier = Math.max(1, actor.system.tierOfPower ?? 1);
  return [{ label: "Rapid Movement", written: "+1(T)", value: tier }];
}

/**
 * Who this side of a Clash is rolling against.
 *
 * A Clash has exactly two sides, so the other one is whichever this is not - and it is
 * looked up rather than passed in because the only thing on the card is a uuid.
 */
function clashOpponent(clash, uuid) {
  const other = (uuid === clash.defenderUuid) ? clash.challengerUuid : clash.defenderUuid;
  return other ? fromUuidSync(other) : null;
}

/**
 * What Intuit is worth to one character against one other, on one kind of roll.
 *
 * "Increase the Dice Score of your Skill Checks and Saving Throws in Clashes against a
 * Seen Opponent by 2 and 1(T) respectively." Two numbers for two rolls, so this is asked
 * per family and answers for one of them: flat 2 on a Skill Check, 1(T) on a Saving Throw,
 * and nothing on anything else - a Might Clash is neither, and a Grapple Check is a Combat
 * Roll, which is Analysis's half of the pair.
 *
 * Yours against the Opponent you read, which the clock is what answers: the mark is on them
 * and the entry timing it is on you, naming them. A character who read somebody else gets
 * nothing here, and neither does one whose mark has run out.
 *
 * Returned as a list so it drops out of a breakdown entirely rather than showing as a row
 * worth nothing.
 */
function terrifyPenalty(actor, clash, uuid) {
  if (!clash.terrify) return [];

  // The challenger's row alone. "Reduce the Dice Score of YOUR Skill Clash by 2 if YOUR
  // TARGET is of a higher Tier of Power than you" is addressed to whoever used the
  // Maneuver, so a defender answering with Intimidation against somebody above their own
  // Tier gets nothing for it.
  if (uuid !== clash.challengerUuid) return [];

  const target = fromUuidSync(clash.defenderUuid);
  if (!target) return [];

  // The current Tier of Power on both sides, which is what "Tier of Power" means
  // everywhere here - so a Transformation or a Holding Back Stack changes who is above
  // whom. Strictly higher: equal Tiers are not higher.
  const theirs = Math.max(1, target.system.tierOfPower ?? 1);
  const mine = Math.max(1, actor.system.tierOfPower ?? 1);
  if (theirs <= mine) return [];

  return [{ label: "Terrify - higher Tier", written: "-2", value: -2 }];
}

function seenBonus(actor, target, family) {
  if (!actor || !target) return [];

  const theirs = (actor.system.timed ?? []).some(entry =>
    (entry?.kind === "condition") && (entry.key === "seen") && (entry.on === target.uuid));
  if (!theirs) return [];

  if (family === "skill") return [{ label: "Intuit", written: "+2", value: 2 }];
  if (family !== "save") return [];

  const tier = Math.max(1, actor.system.tierOfPower ?? 1);
  return [{ label: "Intuit", written: "+1(T)", value: tier }];
}

/**
 * What Analysis is worth to one character against one other.
 *
 * "Increase your Combat Rolls against Analyzed Opponents by 1(T)+1/4 (rounded up) of your
 * Scholarship Modifier."
 *
 * Yours against the Opponent you Analyzed, which is the narrower of the two readings the
 * sentence will carry - the file says why that one. The clock is what answers it: the mark
 * is on them and the entry timing it is on you, naming them, so a character who Analyzed
 * somebody else gets nothing here and neither does one whose mark has run out.
 *
 * Rounded up, which the entry says outright and almost nothing else in these rules does.
 *
 * Returned as a list so it drops out of a breakdown entirely rather than showing as a row
 * worth nothing.
 */
function analysisBonus(actor, target) {
  if (!actor || !target) return [];

  const theirs = (actor.system.timed ?? []).some(entry =>
    (entry?.kind === "condition") && (entry.key === "analyzed") && (entry.on === target.uuid));
  if (!theirs) return [];

  const tier = Math.max(1, actor.system.tierOfPower ?? 1);
  const scholarship = actor.system.attributes?.scholarship?.mod ?? 0;
  const quarter = Math.ceil(scholarship / 4);
  const total = tier + quarter;
  if (total <= 0) return [];

  return [{ label: "Analysis", written: `+1(T)+${quarter}`, value: total }];
}

/**
 * What failed Steadfast Checks cost on a Combat Roll: 1(bT) for each. Returned as a
 * list so it drops out of the breakdown entirely when there is nothing to report.
 */
function thresholdPenalty(actor) {
  const { penalty } = actor.system.threshold;
  // "Each failure costs 1(bT) on every Combat Roll", so what is written is the rule and
  // what is shown beside it is what that came to for this character.
  const failures = actor.system.threshold.failures ?? 0;
  return penalty
    ? [{ label: "Thresholds", written: `-${failures}(bT)`, value: -penalty }]
    : [];
}

/**
 * The Muscle Penalty: what Super Stacks cost a Strike or a Dodge Roll.
 *
 * A part rather than something folded into the Strike and Dodge values, for the same
 * reason Diminishing Offense is: four points going missing out of a roll with nothing
 * on the card to say where reads as the roll being wrong.
 *
 * A Parry takes it too. The rule names Strike Rolls, and a Parry is a Strike Roll made
 * defensively - unlike Diminishing Offense, which is spared a Parry because it is worn
 * by *attacking* and a Parry is not an Attacking Maneuver. Nothing says the same of
 * muscle: the weight slows the arm whichever direction it swings.
 */
function musclePenalty(actor) {
  const { musclePenalty: penalty = 0, muscleMultiplier = 0 } = actor.system.superStack ?? {};
  return penalty
    ? [{ label: "Muscle Penalty", written: `-${muscleMultiplier}(bT)`, value: -penalty }]
    : [];
}

/**
 * Massive Power: what Super Stacks add to a Wound Roll.
 *
 * Only Physical and Energy Attacks, which is what the rule names - so a Magic Attack
 * made by the same character gets the Muscle Penalty and none of this.
 */
function superStackWoundParts(attacker, attack) {
  const { stacks = 0, massivePower = 0 } = attacker.system.superStack ?? {};
  const reaches = DBUCharacterData.MASSIVE_POWER_FOUNDATIONS.includes(attack.foundation);
  if (!massivePower || !reaches) return [];

  return [{
    label: "Super Stacks",
    written: (stacks === 1) ? "+1/4 Force" : `+${stacks} × 1/4 Force`,
    value: massivePower
  }];
}

/**
 * How each way of defending changes the exchange: what the Strike is clashed against,
 * what the Soak Value is worth, and what becomes of the Wound Roll.
 *
 * `answer` returning null means there is no clash at all - the attack simply lands.
 */
const DEFENCES = {
  dodge: {
    label: "Dodge",
    // Diminishing Defense reduces Dodge Rolls, and only Dodge Rolls.
    answer: (actor, options, attack) =>
      rollSide(actor, dodgeBonus(actor, { attack }), { ...options, slot: "dodge" }),
    // Named here so the two halves stay visible in the breakdown.
    // Dodging is not the Defend Maneuver, so it does not spare you the stacks.
    gainsDiminishingDefense: true,
    soak: (soak) => soak,
    wound: (total) => total
  },

  parry: {
    label: "Parry",
    // Clashed with the Strike Roll, as though throwing a Physical Attack back.
    // A Parry is not an Attacking Maneuver, so Diminishing Offense does not touch it -
    // but it is still a Combat Roll, so Thresholds do.
    // A Parry rolls Strike, so that is the Slot an effect names to change it - plus
    // `parry`, which is the one that applies only when Strike is rolled defensively.
    // A charged attack is harder to turn aside: 1(bT) off for each Energy Charge on it.
    answer: (actor, options, attack) => rollSide(actor, [
      { label: "Strike", value: actor.system.combat.strike },
      { label: "Parry", value: actor.system.combat.parry ?? 0 },
      ...musclePenalty(actor),
      ...chargePenalty(actor, attack),
      ...thresholdPenalty(actor)
    ], { ...options, slot: "strike" }),
    soak: (soak) => soak,
    wound: (total) => total
  },

  directHit: {
    label: "Direct Hit",
    answer: () => null,
    // "If this Attacking Maneuver inflicts no Damage and has 2+ Energy Charges or a Ki
    // Wager equal to or higher than 1/4 of their Max Capacity, the attacker suffers
    // from the Shaken Combat Condition." Taking the blow head on and shrugging it off
    // is what rattles them, so it is settled once the Damage is known.
    shakesOnNoDamage: { charges: 2, wagerFraction: 4 },
    // Soak Value increased by half for this attack - applied to whatever the
    // Damage Category left of it, so half of nothing is still nothing.
    soak: (soak) => Math.floor(soak * 1.5),
    wound: (total) => total
  },

  powerFlare: {
    label: "Power Flare",
    answer: () => null,
    answersWound: true,
    soak: (soak) => soak,
    wound: (total) => total
  },

  crossCounter: {
    label: "Cross Counter",
    counterAttacks: true,
    // The clash happens as usual, but with the Defense Value halved. It is still a
    // Dodge Roll, so Diminishing Defense applies - to the roll, after the halving,
    // since what is halved is the Defense Value and not the result.
    answer: (actor, options, attack) =>
      rollSide(actor, dodgeBonus(actor, { halved: true, attack }),
        { ...options, slot: "dodge" }),
    soak: (soak) => soak,
    wound: (total) => total
  },

  guard: {
    label: "Guard",
    answer: () => null,
    soak: (soak) => soak,
    // The Wound Roll against you is halved, and the attack's Damage Category drops a
    // step - so more of your Soak Value counts than the Profile intended.
    damageCategoryShift: -1,
    wound: (total) => Math.floor(total / 2)
  }
};

/**
 * Take Life Points off a character directly.
 *
 * A Life Point reduction is not Damage. Damage is what a Wound Roll gets past a Soak
 * Value and Damage Reduction; this goes straight to Life and neither of those is
 * consulted, which is the whole distinction and the only reason it needs a function of
 * its own rather than being folded into the Damage path.
 *
 * Collision Damage is the first of these. It will not be the last, which is why it is
 * written as the general thing and not as "collision".
 *
 * The floor is the one exception the rules grant anywhere: Undying lets Life go
 * negative, and nothing else does.
 */
/**
 * Take Ki Points off somebody, and say how many actually came off.
 *
 * `reduceLifePoints`'s companion, and the reason it returns a number where that one does
 * not: a rule that hands the loss to somebody else has to know what the loss was. "Regain
 * Ki Points equal to the total amount of Ki Points lost by the target" - a target with
 * three left against a drain of ten loses three, and three is what is handed over.
 *
 * Floored at nothing. There is no Undying for Ki Points: nothing in these rules lets them
 * go below zero, so the floor is not opted out of the way Life's is.
 *
 * @returns {Promise<number>} how many Ki Points were actually taken
 */
export async function reduceKiPoints(target, amount, { reason = "Ki Point reduction" } = {}) {
  const wanted = Math.max(0, Math.floor(amount));
  if (!wanted) return 0;

  const { value } = target.system.ki;
  const taken = Math.min(wanted, Math.max(0, value));
  if (!taken) return 0;

  await requestActorUpdate(target, { "system.ki.value": value - taken });

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: target }),
    content: checkCard({
      parts: `${Handlebars.escapeExpression(reason)}`,
      total: `-${taken} KP`,
      outcome: "botch"
    })
  });

  return taken;
}

export async function reduceLifePoints(target, amount, { reason = "Life Point reduction" } = {}) {
  const taken = Math.max(0, Math.floor(amount));
  if (!taken) return;

  const settled = target.system.life.value - taken;
  const floor = target.system.effects?.slots?.["life.allowNegative"]
    ? settled
    : Math.max(0, settled);

  await requestActorUpdate(target, { "system.life.value": floor });

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: target }),
    content: `<div class="dbu-settled-note">${Handlebars.escapeExpression(target.name)}
      loses <strong>${taken}</strong> Life Points &middot;
      ${Handlebars.escapeExpression(reason)}
      <em>past Soak and Damage Reduction</em></div>`
  });
}

/**
 * Knockback, once the Damage has actually been taken off.
 *
 * "If you successfully Damage an Opponent with this Signature Technique, after the
 * Wound Roll, you may make a Might Clash." It arrives as its own card the moment the
 * Damage is applied, rather than behind a button on the attack: the attack's card is
 * about the attack, and this is a Clash between two characters with two sides to roll
 * and a consequence of its own.
 *
 * "You may" is still a choice - nothing is rolled until both sides say so, and a card
 * nobody answers is a card nobody answers.
 */
async function openKnockback(attack, attacker, target, { extra = 0, from = "" } = {}) {
  // "For the Might Clash initiated by the Knockback Advantage and for calculating the
  // number of Squares the target(s) are moved" - both, and they are the same number
  // twice: the Clash rolls Might and the distance is Might in Squares. Carried on the
  // card so both read it rather than each working it out.
  const might = attacker.system.might + extra;

  return postMightClash(attacker, target, {
    // Named for the Advantage, not for the Maneuver: this card is about the Knockback,
    // and which attack caused it belongs in the line below rather than in the title.
    maneuverName: "Knockback",
    mightBonus: extra,
    reason: `${attack.maneuverName} · win and move ${target.name} up to `
      + `${might} Squares in a straight line away from you.${
        extra ? ` ${from} adds ${extra} to your Might for this.`
        : from ? ` ${from} gave this attack its Knockback.` : ""}`,
    collision: {
      // Launching doubles what the movement costs, and says so itself - an Advantage
      // does not know which Profile handed it out.
      doubles: Boolean(PROFILES[attack.profile]?.doublesCollisionDamage),
      doubledBy: PROFILES[attack.profile]?.label ?? ""
    }
  });
}

/**
 * Open Staggering Attack's Might Clash, off one Opponent it Damaged.
 *
 * Named for the Advantage, as Knockback's is: this card is about the stagger, and which
 * attack caused it belongs in the line below the title.
 */
async function openStagger(attack, attacker, target) {
  return postMightClash(attacker, target, {
    maneuverName: "Staggering Attack",
    reason: `${attack.maneuverName} · win and ${target.name} is Staggered until the end of `
      + "their turn.",
    stagger: { applied: false }
  });
}

/**
 * "A, B and C", or "A and B", or "A".
 */
function listed(names) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * What a Feature's Qualities do to whoever just took Collision Damage from it.
 *
 * The halving is not here - it is part of the number, and is settled with the doubling
 * and the Sudden Stop in one multiply. What is here is everything a Quality leaves on the
 * character afterwards, and the clock each of them runs on.
 *
 * All three durations read "for 1 Combat Round (ending on the end of this turn, next
 * Combat Round)". "This turn" is the turn being played, which in a Knockback is the
 * thrower's and not the thrown - so the edges are counted by whoever is taking it, with
 * the Condition sitting on the character. Outside a Combat the character keeps their own
 * clock, which is the nearest thing to a turn there is.
 *
 * @returns {Promise<string[]>} a sentence for each, so the card can say what landed.
 */
async function applyFeatureQualities(target, qualities, source) {
  const said = [];
  if (!qualities.length) return said;

  const { setCondition } = await import("./conditions.mjs");

  // Whoever's turn it is keeps the clock. Not the winner of the Clash: a Knockback can be
  // thrown on somebody else's turn - by an Instant, or by a Reaction - and the rule names
  // the turn being played rather than the character who caused it.
  const keeper = game.combat?.started ? (game.combat.combatant?.actor ?? target) : target;
  const whose = (keeper.uuid === target.uuid) ? "their own" : `${keeper.name}'s`;

  for (const quality of qualities) {
    const { condition, stacks = 1, dot = 0, manual = "" } = quality.collision;

    if (condition) {
      // "Gain a stack", so on top of what they are already carrying rather than set to
      // one - setCondition caps it at the Condition's own maximum on the way in.
      const held = Number(target.system.conditions?.[condition]) || 0;
      const got = await setCondition(target, condition, held + stacks);

      if (got) {
        for (let n = 0; n < stacks; n += 1) {
          await lasting(keeper, {
            kind: KINDS.CONDITION,
            key: condition,
            edge: EDGES.END,
            next: true,
            on: target.uuid,
            source: `${source} - ${quality.name}`
          });
        }
        said.push(`${quality.name} leaves them with ${stacks} more stack`
          + `${(stacks === 1) ? "" : "s"} until the end of ${whose} next turn.`);
      }
    }

    if (dot > 0) {
      await target.update({ "system.dotStacks": (target.system.dotStacks ?? 0) + dot });
      for (let n = 0; n < dot; n += 1) {
        await lasting(keeper, {
          kind: KINDS.DOT,
          key: "dot",
          edge: EDGES.END,
          next: true,
          on: target.uuid,
          source: `${source} - ${quality.name}`
        });
      }
      said.push(`${quality.name} leaves ${dot} stacks of Damage Over Time on them until `
        + `the end of ${whose} next turn.`);
    }

    // The half this system does not do. Said on the card rather than left out, because
    // nothing here moves anybody and a Feature is not something it holds.
    if (manual) said.push(`${quality.name}: ${manual}`);
  }

  return said;
}

/**
 * The Collision Damage window: how hard what they hit was, and what it was made of.
 *
 * One window, two ways in - off the Clash that threw them, and off the Battlefields tab
 * for everything that throws nobody. Walking into a wall, a Feature falling on you, a
 * Splintering one going off beside you: the rules have plenty of collisions that no card
 * here opens, and every one of them lands the same way.
 *
 * The Rank is picked rather than the number typed. "The Hardness Value is twice the
 * Hardness Rank multiplied by the base Tier of Power of the Character who is suffering the
 * Collision Damage" - so it is the one number in a collision this system can work out on
 * its own, and it is a different number for each character, which is exactly why asking
 * for it by hand went wrong. What it cannot know is what the wall was made of, and that is
 * the question.
 *
 * @returns {Promise<object|null>} what was taken, or null if the window was closed.
 */
async function askCollisionDamage(target, { title = "Collision Damage", doubled = false,
                                            doubledBy = "", halved = false,
                                            halvedBy = "" } = {}) {
  const baseTier = Math.max(1, target.system.baseTierOfPower ?? 1);

  // Each Rank with its Value already worked out for this character. "6(bT)" is not an
  // answer to "what does this cost me", and the point of a dropdown is that nobody should
  // be doing that multiplication at the table. The material comes with it, because that
  // is the question actually being asked - what did they hit.
  // The ground is an answer of its own rather than a Rank that happens to match one.
  //
  // These are two different collisions and the rules have always told them apart - Sudden
  // Stop names "Feature Collision or Ground Collision respectively" - and it stopped being
  // a distinction only a reader cares about the moment an Environment hung a rule on it.
  // The Soft Environment knocks you Prone for hitting the ground, and not for hitting a
  // rock standing on it.
  //
  // Offered only where there is ground to hit: an Environment whose file states no
  // Hardness Rank has none, and an option that resolves to nothing is worse than no
  // option.
  const standing = environmentOf(target);

  // "You cannot suffer from Collision Damage with the Squares in a High Environment (you
  // may still Collide with Features), due to there being nothing to collide with."
  //
  // So the ground stops being an answer while they are up there, and the Features stay.
  // Sinking a rank instead of taking the Damage is a movement, which is the table's - and
  // a rank is a thing the player picks anyway.
  const aloft = isAirborne(target.system);
  // The Rank as the Square's Qualities leave it - Glass one harder, Metallic never below
  // three - rather than the one the ARC picked. Derived on the character, so this window
  // and the tab are reading the same number.
  const groundRank = Number(target.system.battlefield?.groundRank);
  const hasGround = !aloft
    && Number.isFinite(Number(standing?.hardnessMin))
    && Number.isFinite(groundRank);

  // What the Qualities of this Square do to a collision with it. Bouncy halves and
  // Dangerous doubles, both "with this Square" - so a Feature standing on a Bouncy Square
  // is not bouncy, and neither of these is asked about anywhere but the Ground Collision.
  const groundQualities = qualitiesOf(target.system, standing, getTrait)
    .map(id => getTrait(id))
    .filter(quality => quality?.groundCollision);

  const groundRow = hasGround
    ? `<option value="ground">The ground &middot; ${
        hardnessValue(groundRank, baseTier)} Damage &middot; ${
        Handlebars.escapeExpression(standing.name)}${
        standing.collisionCondition ? ", which knocks you down" : ""}</option>`
    : "";

  // Not first. Most collisions are with a Feature, and a window that opens on the rarer
  // answer is a window that is wrong by default.
  const ranks = HARDNESS_RANKS.map(hardness =>
    `<option value="${hardness.rank}">Rank ${hardness.rank} &middot; ${
      hardnessValue(hardness.rank, baseTier)} Damage &middot; ${
      Handlebars.escapeExpression(hardness.material)}</option>`).join("") + groundRow;

  // The rule, and the arithmetic behind the numbers in that list, for whoever wants it.
  // Built here rather than inline so the character's name goes through the escape like
  // everything else does.
  const howItWorks = `${COLLISION_DAMAGE} The Value is twice the Rank a base Tier of `
    + `Power - Rank 0 is 1(bT) - worked out here against ${target.name}'s base Tier of `
    + `Power of ${baseTier}, and taken past their Soak Value and Damage Reduction.`;

  // What the Feature they hit was made of. A name to tick, and the rule on hover.
  //
  // The rules were printed under each name to begin with, on the reasoning that whoever is
  // ticking the box did not decide what that wall was made of and has probably never read
  // it. Five paragraphs of small print is not how somebody reads them, though - it is how
  // somebody closes the window. The words are still there for the one time they are wanted,
  // and the list is short enough to see at a glance the rest of the time.
  const qualities = COLLISION_QUALITIES.map(quality => `
    <label class="dbu-respond-option dbu-quality"
           data-tooltip="${Handlebars.escapeExpression(quality.text)}">
      <input type="checkbox" name="quality" value="${quality.key}"/>
      <span class="dbu-respond-name">${Handlebars.escapeExpression(quality.name)}</span>
    </label>`).join("");

  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title },
    content: `
      <label class="dbu-wager dbu-hardness"
             data-tooltip="${Handlebars.escapeExpression(howItWorks)}">
        <span>Hardness Rank</span>
        <select name="hardness">${ranks}</select>${(doubled || halved) ? `
        <em>${[
          doubled ? `${Handlebars.escapeExpression(doubledBy)} doubles it.` : "",
          halved ? `${Handlebars.escapeExpression(halvedBy)} halves it.` : ""
        ].filter(Boolean).join(" ")}</em>` : ""}
      </label>
      ${aloft
        ? `<p class="dbu-respond-hint">Nothing to hit but Features up here - a Square in a
            High Environment is air. You would sink a rank instead.</p>`
        : ""}
      <p class="dbu-respond-hint dbu-list-label">Feature Qualities</p>
      ${qualities}`,
    buttons: [
      {
        action: "confirm",
        label: "Apply",
        callback: (event, button, dialog) => ({
          // "ground" rather than a number when they hit the floor. Kept as it came back
          // and resolved below, so the two answers stay told apart all the way through -
          // a Rank that happens to equal the ground's is still a Feature.
          picked: dialog.element.querySelector('select[name="hardness"]').value,
          keys: [...dialog.element.querySelectorAll('input[name="quality"]:checked')]
            .map(box => box.value)
        })
      },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });

  // Cancelled. Rank 0 is a real answer and still costs 1(bT), and a Quality ticked against
  // a halved nothing still burns whoever it caught - so only a window that was closed
  // stops here.
  if (!chosen) return null;

  const applied = COLLISION_QUALITIES.filter(quality => chosen.keys.includes(quality.key));

  const hitGround = chosen.picked === "ground";
  const rank = hitGround ? groundRank : Number(chosen.picked);
  const value = hardnessValue(rank, baseTier);

  // Only on a Ground Collision. Both of these say "this Square", and a Feature is not one.
  const fromGround = hitGround ? groundQualities : [];

  // All of the halvings at once rather than one after the other. Launching doubles this,
  // a Sudden Stop halves it and a Rubbery or Fragile Feature halves it again - and
  // rounding between any two of them would take a point off a number the rules leave
  // exactly where it started.
  const halvings = (halved ? 1 : 0)
    + applied.filter(quality => quality.collision.halves).length
    + fromGround.filter(quality => quality.groundCollision === "halves").length;
  // Dangerous doubles the way Launching does, so the two multiply rather than stacking:
  // a Dangerous Square under a Launching attack is four times what the Rank is worth.
  const doublings = (doubled ? 1 : 0)
    + fromGround.filter(quality => quality.groundCollision === "doubles").length;
  const amount = Math.floor(value * (2 ** doublings) * (0.5 ** halvings));
  const changed = [
    doubled ? `doubled by ${doubledBy}` : "",
    halved ? `halved by ${halvedBy}` : "",
    ...applied.filter(quality => quality.collision.halves)
      .map(quality => `halved by ${quality.name}`),
    ...fromGround.map(quality =>
      `${quality.groundCollision === "doubles" ? "doubled" : "halved"} by ${quality.name}`)
  ].filter(Boolean).join(", ");
  const reason = `Collision Damage, ${
    hitGround ? `the ground - Hardness Rank ${rank}` : `Hardness Rank ${rank}`}`
    + (changed ? `, ${changed}` : "");

  await reduceLifePoints(target, amount, { reason });

  // What this Environment does to whoever lands on it. "If a Character collides with a
  // Square of this Battle Environment, they are knocked Prone" - a Square of it, which is
  // the ground and not a Feature standing on it.
  //
  // A Condition named on the file rather than a script, because a collision is an event
  // and there is no value here for a passive to write. No duration: the entry gives none,
  // so it comes off the way that Condition always comes off.
  if (hitGround && standing?.collisionCondition) {
    const { setCondition } = await import("./conditions.mjs");
    if (await setCondition(target, standing.collisionCondition, 1)) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: target }),
        content: `<div class="dbu-settled-note">${Handlebars.escapeExpression(
          `${target.name} hits the ground in a ${standing.name}.`)}</div>`
      });
    }
  }

  const said = await applyFeatureQualities(target, applied, "the collision");
  if (said.length) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: target }),
      content: `<div class="dbu-settled-note">${Handlebars.escapeExpression(
        `What ${target.name} hit was ${listed(applied.map(quality => quality.name))}. `
        + said.join(" "))}</div>`
    });
  }

  return { rank, value, amount, applied, hitGround };
}

/**
 * Collision Damage taken because the character says so.
 *
 * The button on the Battlefields tab. Most collisions in these rules are not a card this
 * system opened - pushed into a wall by something that never rolled, a fall, a Splintering
 * Feature going off beside you - and the tab is where everything about a Battlefield that
 * the player sets for themselves already lives.
 *
 * Nothing doubles it and nothing halves it on this door: a Launching Profile and a Sudden
 * Stop are both things a card knows about, and this is the way in for the collisions no
 * card saw.
 */
export async function takeCollisionDamage(actor) {
  if (!actor) return null;
  return askCollisionDamage(actor, { title: `${actor.name} - Collision Damage` });
}

/**
 * Collision Damage off the Clash that caused it.
 *
 * Offered off the Might Clash that Knockback opened, and only to the winner of it: the
 * movement is what causes the collision, and there is no movement without the win.
 *
 * What they hit is asked for rather than derived - which Feature it was is the ARC's - and
 * asked once per Clash. Two characters thrown by one Maneuver each have a Clash of their
 * own and are each asked their own question, because they did not hit the same wall, and
 * the same wall would not have cost them the same anyway.
 */
async function applyCollisionDamage(message, clash) {
  const target = fromUuidSync(clash.defenderUuid);
  if (!target || clash.collisionApplied) return;

  const settled = await askCollisionDamage(target, {
    title: `${clash.maneuverName} - Collision Damage`,
    doubled: Boolean(clash.collision?.doubles),
    doubledBy: clash.collision?.doubledBy ?? "",
    halved: Boolean(clash.collision?.halves),
    halvedBy: clash.collision?.halvedBy ?? ""
  });
  if (!settled) return;

  // Marked on the Clash that allowed it, so one win buys one collision. Another character
  // thrown by the same Maneuver has a Clash of their own, and is asked their own question.
  return requestEdit(message, { type: "clash", clash: { ...clash, collisionApplied: true } });
}

/**
 * Put stacks of something on the one who took the Damage, for as long as the attacker's
 * clock says.
 *
 * The shape every Elemental Profile's rider has so far: "they gain a stack of Broken until
 * the end of your next turn", "their Light Level is reduced by 1 Level until the start of
 * your next turn", "their Square becomes Aflame until the start of your next turn". The
 * mark is theirs and the turn the entry names is the attacker's, so the clock is too.
 *
 * One clock per stack actually gained, and no more. Broken caps at three, and a fourth
 * clock set on a character already at three would take one of the three they had off
 * early - a stack this attack never gave them.
 *
 * @param {?string} edge "start" or "end" of the attacker's next turn, or null for none
 */
async function markUntilNextTurn(attacker, target, key, stacks, edge, source) {
  const { gainCondition } = await import("./effects/moments-runtime.mjs");
  const { lasting, EDGES, KINDS } = await import("./durations.mjs");
  const { allConditions } = await import("./conditions.mjs");

  const before = Number(target.system.conditions?.[key]) || 0;
  if (await gainCondition(target, key, stacks) === false) return;

  // No edge is no clock: Elemental (Water)'s Prone is gained and not given back.
  if (!edge) return;

  const cap = allConditions().find(condition => condition.key === key)?.maxStacks ?? stacks;
  const gained = Math.max(0, Math.min(cap, before + stacks) - before);

  for (let i = 0; i < gained; i++) {
    await lasting(attacker, {
      kind: KINDS.CONDITION,
      key,
      edge: (edge === "end") ? EDGES.END : EDGES.START,
      next: true,
      on: target.uuid,
      source
    });
  }
}

/**
 * Put an Environmental Quality on a character's Square, for good.
 *
 * Elemental (Metal): "Any Squares occupied by Character(s) who take Damage from this
 * Attacking Maneuver become Metallic." No duration, so it goes on the list the player
 * ticks rather than on a mark with a clock - that list is where a Square's lasting
 * Qualities live, and the player takes it off when they move on.
 *
 * And this is "applied through an effect", which is when Metallic's and Glass's own clause
 * fires: "If this Environmental Quality is applied through an effect, remove all other
 * Environmental Qualities on this Feature." Which Qualities carry that is in their files
 * (`appliedAlone: true`), so none is named here. What goes is every other Quality ticked,
 * and every mark putting one on the Square for a while.
 */
async function applySquareQuality(target, id) {
  const quality = getTrait(id);
  if (!quality?.envQuality) return;

  const held = (target.system.battlefield?.qualities ?? []).map(String);
  const alone = quality.appliedAlone === true;
  const next = alone ? [id] : [...new Set([...held, id])];
  await requestActorUpdate(target, { "system.battlefield.qualities": next });

  if (!alone) return;
  const { setCondition } = await import("./conditions.mjs");
  for (const [key, stacks] of Object.entries(target.system.conditions ?? {})) {
    if ((Number(stacks) > 0) && getTrait(key)?.quality) await setCondition(target, key, 0);
  }
}

/**
 * What a Profile lets the attacker build, said on the card.
 *
 * Elemental (Plantlife): "you may create a Feature ... This Feature has a Hardness Rank of
 * 1 and the Splintering Feature Quality." Where it goes, and whether it is made at all, is
 * the table's; what it is made of is the entry's, and saying it here saves going back to
 * the entry to find out.
 */
function featureNote(profile) {
  const made = profile?.createsFeature;
  if (!made) return "";
  const quality = FEATURE_QUALITIES.find(entry => entry.key === made.quality);
  return ` &middot; Feature: Hardness Rank ${made.hardnessRank}${
    quality ? `, ${Handlebars.escapeExpression(quality.name)}` : ""}`;
}

/** Take the damage off one target, once and once only. */
async function applyAttackDamage(message, target, attack) {
  const own = targetResult(attack, target.uuid);
  if (!own || own.applied) return;
  const { damage } = own;

  // Sweeping: "if you deal Damage with this Attacking Maneuver, double the amount of
  // Diminishing Defense stacks a target would receive from it." Settled here because
  // this is the first point at which "if you deal Damage" has an answer - the stacks
  // were handed out when the Clash was, before the Wound Roll existed. So the second
  // helping is added now, and only when Damage was actually dealt.
  // Not for an Absolute Attack: "this does not count as hitting a Character with an
  // Attacking Maneuver, or dealing damage to that Character with an Attacking Maneuver,
  // for any effects that would trigger as a result" - and Sweeping's second helping is
  // written "if you deal Damage with this Attacking Maneuver", so it is one of them.
  const doubled = (damage > 0)
    && !isAbsoluteMiss(own)
    && PROFILES[attack.profile]?.doublesDiminishingDefense
    && DEFENCES[own.defense]?.gainsDiminishingDefense
    && !own.forced;

  // Floored at zero for everyone except whoever has been granted otherwise - the Undying
  // State being the one thing in the rules that grants it.
  const settled = target.system.life.value - damage;
  const floor = target.system.effects?.slots?.["life.allowNegative"] ? settled : Math.max(0, settled);

  // Which Health Threshold this leaves them in, against the one they were in. Read off
  // the Life Points on both sides of the one write, because the Threshold is derived and
  // leaves no record of having been crossed.
  const thresholds = Object.keys(DBUCharacterData.THRESHOLDS);
  const knockedThrough = thresholds.indexOf(
    DBUCharacterData.thresholdKey(floor, target.system.life.max))
    > thresholds.indexOf(DBUCharacterData.thresholdKey(target.system.life.value,
      target.system.life.max));

  // One write, off one reading of the character. Two updates each doing their own
  // read-and-add is how a number that was raised twice ends up raised once: whichever
  // read second may not have seen the first yet.
  await target.update({
    "system.life.value": floor,
    ...(doubled
      ? {
        "system.diminishingDefense":
          target.system.diminishingDefense + target.system.diminishing.defense.perAttack
      }
      : {})
  });

  // "If you successfully Damage an Opponent" - which is answered here and nowhere
  // earlier. The Clash arrives as its own card, because it is a Clash: two characters,
  // two rolls, and a consequence that belongs to whoever wins it.
  // Per person thrown, because each of them is a Clash of their own: one Maneuver can
  // send four people into four different walls.
  // Knockback asks "if you successfully Damage an Opponent", which is the other half of
  // the same sentence: Damage an Absolute Attack deals is not Damage dealt with an
  // Attacking Maneuver for anything triggering off it.
  if ((damage > 0) && !isAbsoluteMiss(own)) {
    const attacker = fromUuidSync(attack.attackerUuid);

    // "All Attacking Maneuvers possess the Knockback Advantage in this Environment."
    // Which is what nothing to push against means: hit somebody in orbit and they go.
    const sky = attacker ? highTraitOf(attacker.system, { all: () => traitsOfKind("high") })
      : null;
    const here = sky?.grantsKnockback === true;

    // "If an Attacking Maneuver ALREADY possesses the Knockback Advantage, increase your
    // Might by 1(bT)." Already - so this is not a bonus for being in space, it is a bonus
    // for having brought your own Knockback to a place that hands it out for free. An
    // attack that only has one because of the Environment does not get it, and this is
    // the one place that knows which of the two it was.
    const broughtItsOwn = pushes(attack);
    const extra = (here && broughtItsOwn)
      ? (Number(sky.knockbackMight) || 0) * Math.max(1, attacker.system.baseTierOfPower ?? 1)
      : 0;

    if (attacker && (broughtItsOwn || here)) {
      await openKnockback(attack, attacker, target, { extra, from: here ? sky.name : "" });
    }

    // Staggering Attack: "If you inflict Damage to an Opponent with this Attacking
    // Maneuver, make a Might Clash against your Opponent." The same moment Knockback's is
    // opened, for the same reason, and one each.
    if (attacker && staggers(attack)) await openStagger(attack, attacker, target);
  }

  // Elemental (Dark): "Any Squares occupied by Character(s) who take Damage from this
  // Attacking Maneuver have their Light Level reduced by 1 Level until the start of your
  // next turn." Theirs is the Square, and the clock is the attacker's. Not off an Absolute
  // Attack's miss, which is not Damage dealt with an Attacking Maneuver for anything that
  // triggers off it.
  //
  // Elemental (Fire) and (Ice), the same shape: their Square "become[s] Aflame" - or
  // Frozen - "until the start of your next turn", and "if you knock an Opponent through a
  // Health Threshold, they gain a stack of the Broken" - or Slowed - "Combat Condition until
  // the end of your next turn". Which mark and which Condition is the Profile's to say.
  const riders = PROFILES[attack.profile] ?? {};
  const attacker = fromUuidSync(attack.attackerUuid);
  if (attacker && (damage > 0) && !isAbsoluteMiss(own)) {
    if (riders.squareMark) {
      await markUntilNextTurn(attacker, target, riders.squareMark.condition,
        riders.squareMark.stacks, "start", riders.label);
    }
    if (riders.squareQuality) await applySquareQuality(target, riders.squareQuality);
    if (riders.onThreshold && knockedThrough) {
      await markUntilNextTurn(attacker, target, riders.onThreshold.condition,
        riders.onThreshold.stacks, riders.onThreshold.untimed ? null : "end", riders.label);
    }
  }

  // "If you take Damage from an Attacking Maneuver used through the Exploit Maneuver in
  // response to this Maneuver." Answered here, which is the first moment the Damage is
  // known - and only here, since an attack that hits for nothing is not Damage taken.
  if (damage > 0) await interruptDelayed(target, attack);

  requestEdit(message, {
    type: "attack",
    attack: {
      ...attack,
      result: { ...attack.result, targets: replaceTarget(attack, target.uuid, { applied: true }) }
    }
  });
}

/**
 * An Exploit provoked by a holding, landing on whoever was holding.
 *
 * "You do not gain the effects of the Triggered Maneuver and do not use the selected
 * Maneuver but you gain a number of Counter Actions equal to the Action Cost spent."
 *
 * Three things have to be true, and each is a different half of "in response to this
 * Maneuver": the attack came through an Exploit, that Exploit was provoked by a card,
 * and that card is the one this character's holding was announced on. A character who
 * held something and is hit by an unrelated Exploit keeps their holding.
 *
 * Counter Actions rather than the ones that were spent. The entry says which, and it is
 * the one place in these rules that hands back a different currency than it took -
 * "equal to the Action Cost spent" is the amount, not the kind.
 */
async function interruptDelayed(target, attack) {
  const held = target.system.delayed;
  if (!held?.messageId) return;
  if (attack?.provokedBy?.messageId !== held.messageId) return;

  const { dropDelayed } = await import("./use-maneuver.mjs");
  const given = Math.max(0, held.actions ?? 0);
  const name = held.name;

  await dropDelayed(target);

  if (given) {
    // Given as Actions not yet spent, which is how this system holds what is left: the
    // pool is what the round grants and the count is what has gone out of it.
    await requestActorUpdate(target, {
      "system.actionsSpent.counter":
        Math.max(0, (target.system.actionsSpent?.counter ?? 0) - given)
    });
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: target }),
    content: `<div class="dbu-settled-note">${target.name} is hit out of the hold - `
      + `${name} is not used${given
        ? `, and they gain ${given} Counter Action${given === 1 ? "" : "s"}`
        : ""}.</div>`
  });
}

/**
 * Deal the Damage somebody took in another character's place, and whatever it left over.
 *
 * Two characters can lose Life here, so both writes go through the relay: the one who
 * stepped in is the reader's, but the Ally the excess reaches is very often not.
 */
async function applyInterventionDamage(message, attack, entry) {
  const who = fromUuidSync(entry.uuid);
  const outcome = entry.outcome;
  if (!who || !outcome || outcome.applied) return;

  const settled = who.system.life.value - outcome.damage;
  const floor = who.system.effects?.slots?.["life.allowNegative"] ? settled : Math.max(0, settled);
  await who.update({ "system.life.value": floor });

  // What is left over after they are Defeated, through the Ally's own Soak and Damage
  // Reduction. Their client is as likely as not to be somebody else's, hence the relay.
  const spill = outcome.spill;
  if (spill?.damage > 0) {
    const ally = fromUuidSync(spill.uuid);
    if (ally) {
      const left = ally.system.life.value - spill.damage;
      await requestActorUpdate(ally, {
        "system.life.value": ally.system.effects?.slots?.["life.allowNegative"]
          ? left
          : Math.max(0, left)
      });
    }
  }

  requestEdit(message, {
    type: "attack",
    attack: {
      ...attack,
      interventions: interventions(attack).map(line =>
        (line.uuid === entry.uuid) && (line.allyUuid === entry.allyUuid)
          ? { ...line, outcome: { ...outcome, applied: true, spill: spill ? { ...spill, applied: true } : null } }
          : line)
    }
  });
}

// --- Moments the table has to answer ------------------------------------------
//
// A handful of Moments are not part of anybody's exchange: the Encounter begins, the
// round turns over, somebody's turn starts, somebody is knocked through a Health
// Threshold, somebody falls. Automatic effects answered these already and nobody saw it
// happen; triggered ones had nowhere at all to be offered, because every place this
// system offers an effect hangs off a card and these had no card.
//
// So each of them posts one. It says what happened and carries an Apply effects button
// for every character that holds something answering it - which is also what makes the
// moment visible at the table, rather than a thing somebody has to remember.

/**
 * Post the card for a Moment.
 *
 * `subjects` is who may answer it, recorded when the card is made rather than worked out
 * when it is read: who was in the Encounter when the round turned over is a fact about
 * that moment, and a player joining afterwards did not live through it.
 *
 * Posted by one client - the GM's, the same one that fires the Moment - so the card
 * appears once rather than once per connected player.
 */
export async function postMoment(moment, {
  title, subjectUuid = "", subjectName = "", subjects = [], pending = false, detail = ""
} = {}) {
  return ChatMessage.create({
    speaker: subjectUuid
      ? ChatMessage.getSpeaker({ actor: fromUuidSync(subjectUuid) })
      : ChatMessage.getSpeaker(),
    content: "",
    flags: {
      [SCOPE]: {
        // Nothing here is a Maneuver, so there is nothing for an Instant to answer.
        [RESPONDABLE_FLAG]: false,
        [MOMENT_FLAG]: {
          moment, title, subjectUuid, subjectName, subjects, pending, detail,
          // Who has answered it. The card keeps offering until they have, so a player
          // who was away when it was posted still finds it waiting.
          applied: [],
          // And who has rolled their Battle Weather. A separate list: answering the
          // Moment and rolling for the weather are two different things to have done.
          weathered: []
        }
      }
    }
  });
}

/** Everyone on this card the reader plays who still holds something to answer it with. */
function momentAnswerers(card) {
  return (card.subjects ?? [])
    .map(uuid => fromUuidSync(uuid))
    .filter(actor => actor?.isOwner
      && !(card.applied ?? []).includes(actor.uuid)
      && triggersFor(actor, [card.moment]).length);
}

/** Whether anybody at all could still answer this Moment, whoever they belong to. */
export function anyoneAnswers(moment, uuids) {
  return uuids.some(uuid => triggersFor(fromUuidSync(uuid), [moment]).length);
}

function renderMoment(message, html) {
  const card = message.getFlag(SCOPE, MOMENT_FLAG);
  if (!card) return;

  const content = html.querySelector(".message-content");
  if (!content) return;

  const box = document.createElement("div");
  box.className = `dbu-moment dbu-moment-${card.moment}`;
  box.innerHTML = `
    <div class="dbu-moment-title">${Handlebars.escapeExpression(card.title)}</div>
    ${card.detail
      ? `<div class="dbu-moment-detail">${Handlebars.escapeExpression(card.detail)}</div>`
      : ""}`;
  content.append(box);

  const buttons = document.createElement("div");
  buttons.className = "dbu-clash-buttons";

  // The Steadfast Check belongs to whoever was knocked through, and comes first: it is
  // the thing the rule asks for, and the effects answering the Moment are beside it.
  const subject = card.subjectUuid ? fromUuidSync(card.subjectUuid) : null;
  if ((card.moment === "threshold") && subject?.isOwner && subject.system.threshold.pending.length) {
    const roll = document.createElement("button");
    roll.type = "button";
    roll.className = "dbu-clash-button";
    roll.textContent = "Steadfast Check";
    roll.dataset.tooltip = "Crossing several Thresholds at once fails all but the lowest "
      + "automatically; that one is rolled for.";
    roll.addEventListener("click", () => rollSteadfastCheck(subject));
    buttons.append(roll);
  }

  // The Battle Weather, for anybody standing in one that has something to roll. Offered
  // rather than rolled: the Round used to roll it on its own, and a number that arrives
  // without anybody touching it is one nobody feels they had any part in.
  //
  // Its own list rather than `applied`, because answering the Moment with a Talent and
  // rolling for the weather are two different things to have done - and a character with
  // no Talent to answer with must still get their roll.
  for (const actor of weatherRollers(card)) {
    const weather = document.createElement("button");
    weather.type = "button";
    weather.className = "dbu-clash-button";
    weather.textContent = (card.subjects.length > 1)
      ? `Apply Battle Weather - ${actor.name}`
      : "Apply Battle Weather";
    weather.dataset.tooltip = `${weatherToRoll(actor).name}, at Weather Tier ${
      actor.system.battlefield.weather.tier}. Once a Round, and yours to roll.`;
    weather.addEventListener("click", () => rollWeatherFor(message, card, actor));
    buttons.append(weather);
  }

  // A Timed Item whose Rounds have passed. Offered rather than set off, the way the storm
  // is: the attack needs somebody targeted, and that is the player's to do.
  for (const { actor, item } of gearDue(card)) {
    const blast = document.createElement("button");
    blast.type = "button";
    blast.className = "dbu-clash-button";
    blast.textContent = `Detonate ${item.name} - ${actor.name}`;
    blast.dataset.tooltip = "Its Rounds have passed. Target the first one it catches.";
    blast.addEventListener("click", () => detonateGear(actor, item));
    buttons.append(blast);
  }

  for (const actor of momentAnswerers(card)) {
    const apply = document.createElement("button");
    apply.type = "button";
    apply.className = "dbu-clash-button";
    apply.textContent = (card.subjects.length > 1)
      ? `Apply effects - ${actor.name}`
      : "Apply effects";
    apply.dataset.tooltip = "Trigger effects that answer this";
    apply.addEventListener("click", () => answerMoment(message, card, actor));
    buttons.append(apply);
  }

  // A defeat that something might still answer is not settled yet, and saying so is the
  // whole point of announcing it before it stands. Somebody has to say when it does.
  if (card.pending && (subject?.isOwner || game.user.isGM)) {
    const settle = document.createElement("button");
    settle.type = "button";
    settle.className = "dbu-clash-button";
    settle.textContent = "Settle the defeat";
    settle.dataset.tooltip = "Nothing else is coming. This is when Transformations and "
      + "States are left behind.";
    settle.addEventListener("click", () => settleDefeat(message, card));
    buttons.append(settle);
  }

  if (buttons.childElementCount) content.append(buttons);
}

/**
 * Set off an Item that goes off: the Basic Attack it makes, in the name of whoever has it.
 *
 * The Bomb: "It uses the Basic Attack Maneuver of the Clearing (Energy) Profile as an
 * Out-of-Sequence Maneuver, using the recorded Scholarship Modifier as its Damage
 * Attribute ... A Bomb's Strike Roll for this Attacking Maneuver will automatically
 * succeed." The attack is the placer's, by the table's ruling - their Tier of Power, their
 * bonuses, one of their attacks this Round - with the Bomb's Damage Attribute. No Ki is
 * paid: the Bomb makes it.
 *
 * The first one it catches is the one targeted; the rest of the Sphere are added from the
 * card, as for any Clearing attack. The Item stays, taken out of play, for the player to
 * remove.
 */
export async function detonateGear(actor, item) {
  const detonation = item?.system?.detonation;
  if (!actor || !detonation?.profile || !item.system.placed) return;

  const target = game.user.targets.first()?.actor;
  if (!target) {
    ui.notifications.warn(`Target the first one the ${item.name} catches. The rest are added `
      + "from the card.");
    return;
  }

  const basic = getManeuver("basic-attack");
  if (!basic) return;

  // Out of play before the attack is made, so a second click finds nothing to set off.
  await item.update({ "system.placed": false, "system.countdown": 0 });

  return postAttack(actor, target, { ...basic, name: item.name }, {
    profile: detonation.profile,
    foundation: detonation.foundation || "energy",
    kiWager: 0,
    advantages: [],
    damageAttribute: item.system.records
      ? { label: `${item.name}, ${item.system.records}`, value: item.system.recorded ?? 0 }
      : null,
    autoHit: detonation.autoHit
  }, { asOutOfSequence: true });
}

/**
 * The Timed Items on this card the reader plays whose Rounds have passed.
 *
 * Only on the Round's own card, where the countdown is taken.
 */
function gearDue(card) {
  if (card.moment !== "start-of-round") return [];

  const due = [];
  for (const uuid of card.subjects ?? []) {
    const actor = fromUuidSync(uuid);
    if (!actor?.isOwner) continue;
    for (const item of actor.items.filter(owned => owned.type === "gear")) {
      if (item.system.placed && (item.system.trigger === "timed")
        && (item.system.countdown === 0)) {
        due.push({ actor, item });
      }
    }
  }
  return due;
}

/**
 * Everyone on this card the reader plays who still has a Battle Weather to roll for.
 *
 * Only on the Round's own card: a Battle Weather that rolls does it once a Round, and
 * every other Moment card would be a second chance at the same roll.
 */
function weatherRollers(card) {
  if (card.moment !== "start-of-round") return [];

  return (card.subjects ?? [])
    .map(uuid => fromUuidSync(uuid))
    .filter(actor => actor?.isOwner
      && !(card.weathered ?? []).includes(actor.uuid)
      && weatherToRoll(actor));
}

/** Roll this character's Battle Weather, once. */
async function rollWeatherFor(message, card, actor) {
  // Marked before it is rolled. A second click while the first is still resolving is one
  // character struck twice by the same storm.
  await requestEdit(message, {
    type: "moment",
    moment: { ...card, weathered: [...new Set([...(card.weathered ?? []), actor.uuid])] }
  });

  return strikeLightning(actor);
}

/** Apply what this character brings to a Moment, and note that they have. */
async function answerMoment(message, card, actor) {
  const triggers = triggersFor(actor, [card.moment]);
  if (!triggers.length) return;

  const applied = await prepareRoll(actor, triggers, card.title, "", { rolling: false });
  if (applied === false) return;

  requestEdit(message, {
    type: "moment",
    moment: { ...card, applied: [...new Set([...(card.applied ?? []), actor.uuid])] }
  });
}

/**
 * Let a defeat stand.
 *
 * `defeat-resolved` is deliberately not the same Moment as `defeated`: the first fires
 * while something can still reach through and stop it, and this one once nothing can.
 * Firing both in one breath would pull a character out of a Transformation on the way to
 * a defeat that never happened.
 */
async function settleDefeat(message, card) {
  const actor = fromUuidSync(card.subjectUuid);
  if (!actor) return;

  // They may have been picked back up in the meantime, by the very effects this card was
  // posted to offer. Nothing to settle then.
  if (!actor.system.defeated) {
    requestEdit(message, {
      type: "moment",
      moment: { ...card, pending: false, title: `${actor.name} is back on their feet` }
    });
    return;
  }

  const { fireMoment } = await import("./effects/moments-runtime.mjs");
  await fireMoment(actor, "defeat-resolved");

  requestEdit(message, {
    type: "moment",
    moment: { ...card, pending: false, title: `${actor.name} is Defeated` }
  });
}

/**
 * Take the start of the Combat Encounter: the automatic half and then the chosen half.
 *
 * The same thing the Encounter's card offers, reached from the sheet instead - because
 * the card is posted to the people who were standing there when the Encounter began, and
 * somebody who walks in afterwards is not one of them. For them the Encounter begins
 * when they arrive, which is a moment Foundry has no hook for and only they can say.
 *
 * Recorded as taken whether or not anything answered it. What the flag means is that
 * this character has had their start of the Encounter, not that it was worth something.
 */
export async function enterEncounter(actor) {
  if (!actor || actor.system.enteredEncounter) return false;

  const { fireMoment } = await import("./effects/moments-runtime.mjs");
  await fireMoment(actor, "start-of-encounter");

  const triggers = triggersFor(actor, ["start-of-encounter"]);
  if (triggers.length) {
    await prepareRoll(actor, triggers, "Start of the Combat Encounter", "", { rolling: false });
  }

  await actor.update({ "system.enteredEncounter": true });
  return true;
}

/**
 * Roll a Steadfast Check for every Threshold reached and not yet answered.
 *
 * "Crossing several at once fails all but the lowest automatically", so only the lowest
 * is rolled for and the rest are recorded as failed.
 *
 * Lives here rather than on the sheet because two places ask for it now - the sheet's
 * own button and the card posted when somebody is knocked through - and a rule written
 * twice is a rule that will drift.
 */
export async function rollSteadfastCheck(actor) {
  const pending = actor.system.threshold.pending;
  if (!pending.length) return null;

  const { THRESHOLDS } = DBUCharacterData;
  const updates = {};

  // Off the character rather than off the constants. The die and the target were both
  // written into this function, so `steadfast.target` sat in the Slot table with nothing
  // reading it - and Hot Weather's "reduce the Dice Score of your Steadfast Checks by
  // 1(WT)" had nowhere at all to land.
  const { die, bonus, target } = actor.system.steadfast;

  const automatic = pending.slice(0, -1);
  const rolled = pending[pending.length - 1];
  for (const key of automatic) updates[`system.thresholdChecks.${key}`] = "fail";

  // The bonus is part of the formula rather than added afterwards, so that the card shows
  // the whole sum - a Check that failed by one is a thing somebody will want to see.
  const roll = new Roll(bonus ? `${die} + ${bonus}` : die);
  await roll.evaluate();
  const passed = roll.total >= target;
  updates[`system.thresholdChecks.${rolled}`] = passed ? "pass" : "fail";

  await actor.update(updates);

  const carried = automatic.length
    ? ` (${automatic.map(key => THRESHOLDS[key].label).join(", ")} failed automatically)`
    : "";

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `Steadfast Check - ${THRESHOLDS[rolled].label} - needing ${target} - ${
      passed ? "passed" : "failed"}${carried}`
  });

  return passed;
}

/**
 * Take a Surge: either a Healing Surge or a Ki Surge.
 *
 * A Surge is not the Surge Maneuver - the Maneuver is one way to reach one, and other
 * effects will reach the same two Surges by other routes, so this is kept apart from
 * whatever triggered it.
 */
export async function takeSurge(actor, { source = "Surge", kind: forced = null } = {}) {
  // An effect that names a Surge is not offering a choice between the two: "use a Ki
  // Surge as an Instant Maneuver" is one Surge, and asking which would be wrong.
  const kind = forced ?? await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: "Surge" },
    content: `<ul class="dbu-surge-options">
      <li><strong>Healing Surge</strong>: regain ${DBUCharacterData.HEALING_SURGE_DICE_PER_TIER}d10 per Tier of Power in Life Points.</li>
      <li><strong>Ki Surge</strong>: regain a quarter of your maximum Ki Points and Capacity.</li>
    </ul>`,
    buttons: [
      { action: "healing", label: "Healing Surge" },
      { action: "ki", label: "Ki Surge" },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });
  if (!kind || (kind === "cancel")) return false;

  // Surgency adds the Force Modifier to the Life and Ki regained - but not to the
  // Capacity, which the rule does not mention.
  const surgency = actor.system.surgency;

  if (kind === "healing") {
    const dice = DBUCharacterData.HEALING_SURGE_DICE_PER_TIER * actor.system.tierOfPower;

    // Dice an effect adds, already resolved against the Tier of Power when the
    // character's data was prepared - "1d10(T)" is three d10s at Tier 3.
    const extra = actor.system.effects?.slots?.["surge.life.dice"] ?? [];

    const formula = [`${dice}d10`, ...extra.map(d => d.formula), "@surgency"].join(" + ");
    const roll = new Roll(formula, { surgency });
    await roll.evaluate();

    const { value, max } = actor.system.life;
    const restored = Math.min(max, value + roll.total) - value;
    await actor.update({ "system.life.value": value + restored });

    // The Surge announces itself: a separate message for the Maneuver would say the
    // same thing twice.
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `${source} - Healing Surge - ${restored} Life Points restored`
    });
    return true;
  }

  const { ki, capacity } = actor.system;
  const kiGain = Math.floor(ki.max / DBUCharacterData.KI_SURGE_FRACTION) + surgency;
  const capacityGain = Math.floor(capacity.max / DBUCharacterData.KI_SURGE_FRACTION);

  const kiRestored = Math.min(ki.max, ki.value + kiGain) - ki.value;
  // Capacity comes back by giving back what has been spent this round.
  const capacityRestored = Math.min(capacity.spent, capacityGain);

  await actor.update({
    "system.ki.value": ki.value + kiRestored,
    "system.capacity.spent": capacity.spent - capacityRestored
  });

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: checkCard({
      parts: `${Handlebars.escapeExpression(source)} &middot; Ki Surge &middot; ${capacityRestored} Capacity regained`,
      total: `+${kiRestored} KP`,
      outcome: "surge"
    })
  });
  return true;
}

/**
 * Choose how to defend, pay for it, and resolve the attack that way.
 *
 * A list rather than a row of buttons: each option needs its own explanation, and one
 * of them needs a field of its own.
 */
async function defendAgainst(message, target, attack) {
  // Reached from Respond, where the Defend Maneuver is chosen; this asks which of its
  // effects is being used and what it costs.

  const wagerMax = maxKiWager(target);

  // "Your Opponent cannot use any option of the Defend Maneuver in response to this
  // Attacking Maneuver except Cross Counter." Narrowed rather than refused outright: the
  // Defend Maneuver is still usable, and what is left of it is one option.
  //
  // An empty list is every attack that nobody narrowed, which is all of them but one.
  const allowed = attack.defencesAllowed ?? [];
  const offered = allowed.length
    ? Object.entries(DEFEND_OPTIONS).filter(([key]) => allowed.includes(key))
    : Object.entries(DEFEND_OPTIONS);

  if (!offered.length) {
    ui.notifications.warn("No option of the Defend Maneuver can answer this attack.");
    return;
  }

  const options = offered.map(([key, option], index) => {
    const cost = defendOptionCost(key, target, attack);
    // Power Flare makes a Wound Roll of its own, so it is the one option that can
    // carry a wager. The field sits with it rather than under the whole dialog.
    // Power Flare answers with a Wound Roll of your own, "as if you made an Energy or
    // Magic Attack" - so which of the two is yours to pick, and it can carry a wager
    // like any other Wound Roll. Both fields sit with the option rather than under the
    // whole dialog.
    const wager = option.allowsKiWager
      ? `<span class="dbu-defend-wager">
           <span>Wound as</span>
           <select name="defenceFoundation" disabled>
             <option value="energy">Energy</option>
             <option value="magic">Magic</option>
           </select>
           <span>Ki Wager</span>
           <input type="number" name="defenceWager" value="0" min="0" max="${wagerMax}" disabled/>
           <em>max ${wagerMax}</em>
         </span>`
      : "";

    return `<label class="dbu-defend-option">
      <input type="radio" name="defence" value="${key}" ${index === 0 ? "checked" : ""}/>
      <span class="dbu-defend-body">
        <span class="dbu-defend-head">
          <strong>${Handlebars.escapeExpression(option.label)}</strong>
          <span class="dbu-profile-cost">${cost} KP</span>
        </span>
        <span class="dbu-defend-summary">${Handlebars.escapeExpression(option.summary)}</span>
        ${wager}
      </span>
    </label>`;
  }).join("");

  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: "Defend" },
    content: `<div class="dbu-defend-list">${options}</div>`,
    // The wager only means anything for the option it belongs to, so it follows the
    // selection rather than sitting there inviting a value that would be ignored.
    render: (event, dialog) => {
      const wagerField = dialog.element.querySelector('input[name="defenceWager"]');
      const foundationField = dialog.element.querySelector('select[name="defenceFoundation"]');
      if (!wagerField) return;
      for (const radio of dialog.element.querySelectorAll('input[name="defence"]')) {
        radio.addEventListener("change", () => {
          const option = DEFEND_OPTIONS[dialog.element.querySelector('input[name="defence"]:checked')?.value];
          wagerField.disabled = !option?.allowsKiWager;
          if (foundationField) foundationField.disabled = wagerField.disabled;
          if (wagerField.disabled) wagerField.value = "0";
        });
      }
    },
    buttons: [
      {
        action: "confirm",
        label: "Confirm",
        callback: (event, button, dialog) => {
          const defence = dialog.element.querySelector('input[name="defence"]:checked')?.value;
          if (!defence) return null;

          const field = dialog.element.querySelector('input[name="defenceWager"]');
          const typed = Math.floor(Number(field?.value));
          const kiWager = (!field?.disabled && Number.isFinite(typed))
            ? Math.min(Math.max(typed, 0), wagerMax)
            : 0;
          const foundation = dialog.element.querySelector('select[name="defenceFoundation"]');
          return {
            defence,
            kiWager,
            foundation: (!foundation?.disabled && foundation?.value) || "energy"
          };
        }
      },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });

  if (!chosen || (typeof chosen !== "object")) return;

  const defend = getManeuver("defend");
  const cost = defendOptionCost(chosen.defence, target, attack) + chosen.kiWager;
  if (defend && !await spendManeuverCost(target, defend, cost)) return;

  // Defending is a Counter Maneuver and costs a Counter Action - which was never being
  // spent here, because this path does not go through useManeuver. Karmic Desperation
  // is the one thing that waives it, and it would have had nothing to waive.
  const answered = atMoment(target, "defending", { attack: true, attacker: true });
  const free = answered.slots?.["defend.free"] === true;

  if (!free && !await spendActions(target, 1, "counter")) return;
  if (free) spendChosen(target, answered);

  return chooseDefence(message, target, chosen.defence, chosen.kiWager, chosen.foundation);
}

/**
 * Everyone the attack is aimed at.
 *
 * Read as a list even though an attack currently names one target, so an area attack
 * has somewhere to put the rest without the card being rebuilt around it.
 */
function attackTargets(attack) {
  // An attack posted before the list existed names one target and no list, and every
  // one of those had exactly one.
  return attack.targets ?? [{ uuid: attack.targetUuid, name: attack.targetName }];
}

/** The attacker's line while the exchange is still being prepared. */
function attackerRow(attack) {
  const ready = (attack.ready ?? []).includes(attack.attackerUuid);
  const state = ready ? "dbu-ready" : "dbu-pending";
  return `
    <div class="dbu-clash-side">
      <span class="dbu-clash-name ${state}">${Handlebars.escapeExpression(attack.attackerName)}<em> strike</em></span>
      <span class="dbu-clash-waiting ${state}">${ready ? "ready" : "waiting"}</span>
    </div>`;
}

/**
 * A target's line on the card. Named from the moment the attack is declared: who has
 * to answer is worth knowing before they do, and until now the card said nothing.
 */
function targetRow(attack, target) {
  const name = Handlebars.escapeExpression(target.name);
  const own = targetResult(attack, target.uuid);

  if (!own) {
    // What they chose is not shown while the exchange is still open: the attacker
    // should not learn how they are being answered before the dice are picked up.
    const ready = (attack.ready ?? []).includes(target.uuid);
    const state = ready ? "dbu-ready" : "dbu-pending";
    return `
      <div class="dbu-clash-side">
        <span class="dbu-clash-name ${state}">${name}<em> target</em></span>
        <span class="dbu-clash-waiting ${state}">${ready ? "ready" : "waiting"}</span>
      </div>`;
  }

  // Some defences answer the Strike with a roll and some forgo it, so the line reports
  // the defence either way, with a total only where there was one.
  const label = own.defenseLabel ?? "Dodge";
  // Rolled and beaten anyway keeps its number: the roll is not wasted, since the Strikes
  // that follow are measured against it, and the reason it did not stop the first one
  // is said beside it - a defence that plainly won otherwise reads as a bug.
  if (own.answer) {
    const note = own.forced
      || (own.longRange ? `Long Range - Strike ${own.against} against them` : "");
    return attackSide(label, target.name, own.answer, note);
  }

  // Direct Hit, Guard and Power Flare forgo the roll by choice; being Sleeping or
  // facing something Determined forgoes it for you. Both end with no roll, and only
  // the second needs explaining.
  const why = own.forced ? Handlebars.escapeExpression(own.forced) : "no roll";

  return `
    <div class="dbu-clash-side">
      <span class="dbu-clash-name">${name}<em> ${Handlebars.escapeExpression(label)}</em></span>
      <span class="dbu-clash-outcome">${why}</span>
    </div>`;
}

/**
 * A settled total, with the dice and bonuses behind it on hover.
 *
 * Shown only to someone with Observer permission on the character that rolled it, and
 * that goes for the total as well as the workings. What the roll *decided* stays public
 * - who won, whether it landed - because the table needs that to play on.
 *
 * Observer rather than Owner so a party can watch each other's rolls by being given it
 * on each other's sheets, while an enemy the GM keeps to themselves stays opaque.
 */
function rolledTotal(side) {
  const mine = ownsSide(side);
  // No tooltip at all when it is not yours to see. There is nothing to put in one: the
  // dash already says the number is not on offer, and explaining that on hover only
  // makes the reader ask twice.
  // The workings as a table, so the hover is read down a column rather than along a
  // sentence. `data-tooltip-html` is the attribute Foundry injects as HTML; the plain
  // `data-tooltip` would show the markup as its own source text.
  const tip = mine
    ? ` data-tooltip-html="${Handlebars.escapeExpression(
        side.lines ? breakdownTable(side.lines, side.total) : (side.breakdown ?? ""))}"`
    : "";

  // A Karmic Save is not a number: it says you succeed whatever the dice came to. So
  // it is shown in place of the total rather than beside it, with the roll it overrode
  // still on hover. It is an outcome, not a value, so everyone may see it.
  if (side.succeeded) {
    return `<span class="dbu-clash-total dbu-karmic-save"${tip}>Karmic Save</span>`;
  }

  // The number itself is withheld too, not only the workings behind it. What the roll
  // decided - who won, whether it landed - is said elsewhere and stays public; what it
  // came to is between the character and whoever plays them.
  if (!mine) return `<span class="dbu-clash-total dbu-clash-private">&mdash;</span>`;

  return `<span class="dbu-clash-total"${tip}>${side.total}</span>`;
}

/**
 * Whether you are allowed to see what a character rolled.
 *
 * Observer, not Owner. A party can be given Observer on each other's sheets and then
 * follow each other's rolls, while an enemy the GM keeps to themselves stays opaque -
 * which is the distinction the permission already exists to draw, so there is no reason
 * to invent a second one here. A GM tests as Owner on everything and so sees all of it.
 */
function maySeeRolls(actor) {
  return actor?.testUserPermission(game.user, "OBSERVER") ?? false;
}

/** Whether anybody in this attack is one you may watch. */
function ownsEitherSide(attack) {
  return attackParticipants(attack)
    .some(uuid => uuid && maySeeRolls(fromUuidSync(uuid)));
}

/** Whether the character that made this roll is one you may watch. */
function ownsSide(side) {
  if (!side?.actorUuid) return false;
  return maySeeRolls(fromUuidSync(side.actorUuid));
}

/** One rolled side of the attack. */
function attackSide(label, name, side, note = "") {
  const total = side ? rolledTotal(side) : `<span class="dbu-clash-waiting">waiting</span>`;
  const outcome = (side?.outcome && !side.succeeded)
    ? `<span class="dbu-clash-outcome dbu-${side.outcome}">${side.outcome}</span>` : "";
  // Something about the row that the roll itself does not say - a defence that was
  // rolled and beaten anyway by a rule rather than by the dice.
  const aside = note
    ? `<span class="dbu-clash-outcome">${Handlebars.escapeExpression(note)}</span>` : "";
  return `
    <div class="dbu-clash-side">
      <span class="dbu-clash-name">${Handlebars.escapeExpression(name)}<em> ${label}</em></span>
      ${total}${outcome}${aside}
    </div>`;
}

/** What the attack did, once both sides are in. */
function attackOutcome(attack) {
  // A won Deflect ends it for everybody, so there is nothing else to report.
  const turned = deflection(attack);
  if (turned) {
    return `Deflected by ${Handlebars.escapeExpression(turned.name)}`;
  }

  if (awaitsFollowUps(attack)) {
    const plan = PROFILES[attack.profile].followUps;
    return `Hit - awaiting ${plan.rolls} more Strikes`;
  }
  if (!attack.result.wound && attackTargets(attack).some(t => targetResult(attack, t.uuid)?.hit)) {
    return "Hit - awaiting the Wound Roll";
  }

  // A line each, because the exchange branched: the Strike and the Wound Roll were one
  // roll, and what they came to for each person was not. One of them flaring the Damage
  // away says nothing about the next.
  const lines = targetResults(attack)
    .map(entry => `<div>${Handlebars.escapeExpression(entry.name)}: ${outcomeFor(attack, entry)}</div>`);

  // Said after the targets, because that is the order it happened in: the attack reached
  // them, and then somebody stepped in front of it.
  const stepped = interventions(attack)
    .map(entry => `<div class="dbu-intervene-line">${interveneText(attack, entry)}</div>`);

  return [...lines, ...stepped].join("");
}

/** What one Intervene came to, in a line. */
function interveneText(attack, entry) {
  const option = INTERVENE_OPTIONS[entry.effect];
  const who = Handlebars.escapeExpression(entry.name);
  const ally = Handlebars.escapeExpression(entry.allyName);
  const label = Handlebars.escapeExpression(option?.label ?? entry.effect);

  if (entry.deflected) {
    return `${who} Intervenes for ${ally} - ${label} wins the Might Clash: `
      + "the attack is deflected away from everyone it reached";
  }

  // A Distant Deflect that lost does nothing at all, which the rule leaves at that.
  if (entry.clash && !entry.clash.won && !takesWoundFor(entry)) {
    return `${who} Intervenes for ${ally} - ${label} loses the Might Clash, `
      + "and the attack goes on as it was";
  }

  const opening = entry.clash
    ? `${who} Intervenes for ${ally} - ${label} loses the Might Clash and takes the Wound Roll`
    : `${who} Intervenes for ${ally} - ${label}, taking the Wound Roll in their place`;

  const outcome = entry.outcome;
  if (!outcome) return `${opening}${option?.movement ? "" : ""}`;

  const harder = (outcome.category !== attack.damageCategory)
    ? ` (${DAMAGE_CATEGORIES[outcome.category].label})`
    : "";

  if (!outcome.defeated) {
    return (outcome.damage <= 0)
      ? `${opening}${harder}: ${outcome.soak} soak stops it`
      : `${opening}${harder}: ${outcome.damage} damage`;
  }

  const spill = outcome.spill;
  const reaches = (spill?.damage > 0)
    ? `${spill.damage} of it reaches ${ally}`
    : `${ally}'s own defences stop what is left`;

  return `${opening}${harder}: ${outcome.damage} damage, which Defeats them - ${reaches}`;
}

/**
 * What an Absolute Attack came to for somebody it missed.
 *
 * Said as a miss first and a number second, because that is what it is: no hit, and
 * Damage all the same. The arithmetic is spelt out only to the two sides, as everywhere
 * else - it quotes the Wound Roll and the Soak Value, which are theirs.
 */
function absoluteOutcomeText(attack, own) {
  const { soak, reduction, damage, effectiveWound } = own;

  if (!ownsEitherSide(attack)) {
    return (damage <= 0)
      ? "missed - Absolute Attack, no damage"
      : `missed - Absolute Attack, ${damage} damage`;
  }

  const defences = reduction
    ? `${soak} soak + ${reduction} reduction`
    : `${soak} soak`;

  return (damage <= 0)
    ? `missed - Absolute Attack: half the Wound Roll is ${effectiveWound}, `
      + `stopped by ${defences}`
    : `missed - Absolute Attack: half the Wound Roll is ${effectiveWound}, `
      + `less ${defences} = ${damage} damage`;
}

/** What the attack came to for one of the people it reached. */
function outcomeFor(attack, { own }) {
  if (!own) return "waiting";

  // Turned aside before the Wound Roll was ever made, for everyone it reached.
  if (deflection(attack)) return "deflected";

  // Somebody stepped in front of them, so nothing of this reaches them - bar whatever
  // is left over if the one who did is Defeated, which is said on that line instead.
  if (own.shieldedBy) return `shielded by ${own.shieldedBy}`;

  if (!own.hit) {
    // An Absolute Attack that missed still has a Wound Roll owed and Damage to come, so
    // "missed" on its own would read as the end of it.
    if (!attack.absolute) return "missed";
    if (!attack.result.wound) return "missed - Absolute Attack, Wound Roll still owed";
    return absoluteOutcomeText(attack, own);
  }

  if (!attack.result.wound) return "hit";

  const { wound } = attack.result;
  const { counterWound, soak, reduction, damage, effectiveWound, damageCategory } = own;

  if (counterWound && (counterWound.total > wound.total)) {
    return "Power Flare beats the Wound Roll: no damage";
  }

  // The arithmetic quotes the Wound Roll and the Soak, which are the very numbers the
  // sides withhold - so it is only spelt out to someone playing one of the two. Anyone
  // else is told what happened, which is what a bystander would see at the table.
  if (!ownsEitherSide(attack)) {
    return (damage <= 0) ? "hit, and no damage" : `hit for ${damage} damage`;
  }

  // Say when Guard pulled the Category down, since that is why the Soak counts here.
  const stepped = (damageCategory !== attack.damageCategory)
    ? ` (${DAMAGE_CATEGORIES[damageCategory].label})`
    : "";
  // Say so when the defence changed the Wound, rather than quoting a number that no
  // longer matches the arithmetic.
  const reduced = (effectiveWound !== wound.total) ? " halved" : "";
  // Named separately from Soak, because it is subtracted separately: the Category note
  // sits with the Soak it applied to, and Damage Reduction stands outside it.
  const dr = reduction ? ` - DR ${reduction}` : "";
  const detail = `Wound ${effectiveWound}${reduced} - Soak ${soak}${stepped}${dr}`;
  return (damage <= 0) ? `${detail}: no damage` : `${detail} = ${damage} damage`;
}

/** Draw the attack, and offer the target their Dodge while it is still open. */
function renderAttack(message, html) {
  const attack = message.getFlag(SCOPE, ATTACK_FLAG);
  if (!attack) return;

  const container = html.querySelector(".message-content") ?? html;
  const result = attack.result;

  const card = document.createElement("div");
  card.className = "dbu-clash";
  card.innerHTML = `
    <div class="dbu-clash-title">${Handlebars.escapeExpression(attack.maneuverName)}
      <span class="dbu-clash-skill">${Handlebars.escapeExpression(attack.profileLabel)} &middot;
        ${Handlebars.escapeExpression(attack.foundationLabel)} &middot;
        ${Handlebars.escapeExpression(DAMAGE_CATEGORIES[attack.damageCategory]?.label ?? "")}${
          attack.reflectedFrom
            ? ` &middot; ${Handlebars.escapeExpression(attack.reflectedFrom)} thrown back at `
              + `${Handlebars.escapeExpression(attack.woundByName ?? "")}`
            : ""}${
          attack.kiWager ? ` &middot; ${attack.kiWager} ${attack.wagerFromLife ? "LP" : "KP"} wagered` : ""}${attack.energyCharges
          ? ` &middot; ${attack.energyCharges} Energy Charge${attack.energyCharges === 1 ? "" : "s"}`
          : ""}${PROFILES[attack.profile]?.area
          ? ` &middot; ${Handlebars.escapeExpression(areaLabel(PROFILES[attack.profile].area))}`
          : ""}${featureNote(PROFILES[attack.profile])}</span>
    </div>
    ${result
      ? attackSide("Strike", attack.attackerName, result.strike)
      : attackerRow(attack)}
    ${attackTargets(attack).map(target => targetRow(attack, target)).join("")}
    ${followUpRows(attack)}
    ${result?.wound
      ? attackSide("Wound", attack.woundByName || attack.attackerName, result.wound)
      : ""}
    ${flareRows(attack)}
    ${absorbRow(attack)}
    <div class="dbu-clash-result">${result ? attackOutcome(attack) : awaitingWhom(attack)}</div>`;
  container.append(card);

  // An attack with an area reaches more than the one it was aimed at, and who it
  // reaches is the table's to agree. Offered for as long as the attacker owns the
  // card - the others are often worked out after the first exchange has settled, not
  // before it - and only to them, since it is their Maneuver that is reaching.
  const thrower = fromUuidSync(attack.attackerUuid);

  // Only until the attacker confirms. Everyone this reaches answers the same Strike
  // Roll, so they all have to be on the card before it is made - somebody added
  // afterwards would be answering a number rolled without them, or would need a Strike
  // of their own, which is the thing an area attack is not.
  //
  // The attacker's own confirmation is the line rather than the Strike Roll itself,
  // because the exchange waits on everyone and the attacker is one of them: until they
  // have confirmed, nothing can resolve, so the window is genuinely open. Waiting for
  // the roll instead meant the first target to answer could settle the whole thing
  // while the attacker was still working out who else was caught.
  const committed = (attack.ready ?? []).includes(attack.attackerUuid);
  if (PROFILES[attack.profile]?.area && thrower?.isOwner && !result && !committed) {
    const add = document.createElement("button");
    add.type = "button";
    add.className = "dbu-clash-button";
    add.textContent = "Add targets";
    add.dataset.tooltip = `Whoever else the `
      + `${areaLabel(PROFILES[attack.profile].area)} caught. They answer the same `
      + `Strike Roll, so add them before you apply your effects.`;
    add.addEventListener("click", () => addAreaTargets(message, attack, thrower));
    container.append(add);
  }

  // The attacker prepares their Strike before anything is rolled. The button doubles
  // as their confirmation, since the exchange waits on everyone having finished.
  if (!result) {
    const attacker = fromUuidSync(attack.attackerUuid);
    if (attacker?.isOwner && !(attack.ready ?? []).includes(attack.attackerUuid)) {
      const ready = document.createElement("button");
      ready.type = "button";
      ready.className = "dbu-clash-button";
      ready.textContent = "Apply effects";
      ready.dataset.tooltip = "Apply what you bring to the Strike Roll, then wait for the targets";
      ready.addEventListener("click", () => attackerStage(message, attack, attacker));
      container.append(ready);
    }
    return;
  }

  // Each defender's half of the same moment, for whichever of them this reader plays.
  // It has to come before the Wound Roll, since that is what these effects are there to
  // change - and a Karmic Effect is one of them, which is the whole point of losing the
  // Clash. Only drawn when they have something: an empty dialog is worse than no button.
  for (const entry of targetResults(attack)) {
    const target = fromUuidSync(entry.uuid);
    if (result.wound || !target?.isOwner) continue;

    const onHit = entry.own?.hit ? relevantTriggers(target, message, "hit") : [];
    const karmic = afterTheFactFor(message, target);

    if (onHit.length || karmic) {
      const apply = document.createElement("button");
      apply.type = "button";
      apply.className = `dbu-clash-button${karmic ? " dbu-karma-button" : ""}`;
      apply.textContent = "Apply effects";
      apply.dataset.tooltip = karmic
        ? "Effects that answer this, and Karmic Effects that can still change it"
        : "Trigger effects that answer being hit";
      apply.addEventListener("click", () =>
        prepareRoll(target, onHit, momentTitle(karmic, "defence"), "",
          { karmic, rolling: false }));
      container.append(apply);
    }
  }

  // The attacker gets the same. Usually it matters when the Strike is the roll that
  // lost - that is the side a Karmic Effect rescues - but Karmic Chance is about any
  // die, so it is offered on a Strike that landed too.
  if (!result.wound) {
    const attacker = fromUuidSync(attack.attackerUuid);
    const karmic = attacker?.isOwner ? afterTheFactFor(message, attacker) : null;

    if (karmic) {
      const apply = document.createElement("button");
      apply.type = "button";
      apply.className = "dbu-clash-button dbu-karma-button";
      apply.textContent = "Apply effects";
      apply.dataset.tooltip = "Karmic Effects that can still change this Strike";
      apply.addEventListener("click", () =>
        prepareRoll(attacker, [], momentTitle(karmic, "strike"), "",
          { karmic, rolling: false }));
      container.append(apply);
    }
  }

  // Once the Wound Roll is made and before the Damage is dealt, both sides get one
  // last window - Karmic Chance is about any die, and the Wound Roll is a die. Power
  // Flare makes it a Clash as well - Wound against Wound - which is when Karmic Boost
  // becomes worth offering too.
  if (result.wound) {
    for (const uuid of attackParticipants(attack)) {
      const who = fromUuidSync(uuid);
      const karmic = who?.isOwner ? afterTheFactFor(message, who) : null;
      if (!karmic) continue;

      const apply = document.createElement("button");
      apply.type = "button";
      apply.className = "dbu-clash-button dbu-karma-button";
      apply.textContent = `${who.name}: apply effects`;
      apply.dataset.tooltip = "Karmic Effects that can still change the Wound Roll";
      apply.addEventListener("click", () =>
        prepareRoll(who, [], momentTitle(karmic, "wound"), "", { karmic, rolling: false }));
      container.append(apply);
    }
  }

  // Combination's three more Strikes come between the hit and the Wound Roll, and they
  // decide what the Wound Roll is worth - so they are their own step and the Wound
  // button waits for them. Rolling them inside the Wound Roll settled the same number
  // without anybody seeing it happen.
  // Stepping in for somebody: the one Counter Maneuver that can be played without being
  // the target, so it is drawn before anything that belongs to the two people in the
  // exchange. It used to sit after Combination's extra Strikes, and that block returns
  // early for anyone who is not the attacker - so against a Combination, the one attack
  // that puts a step between the hit and the Wound Roll, nobody could step in at all.
  //
  // The window the rule opens is exactly this: the Ally has been hit, and the Wound Roll
  // has not been made. Combination's extra Strikes happen inside it, not before it.
  if (!result.wound && !deflection(attack)) {
    const usable = possibleInterveners(attack)
      .filter(who => shieldableTargets(attack, who).length);

    if (usable.length) {
      const step = document.createElement("button");
      step.type = "button";
      step.className = "dbu-clash-button";
      step.textContent = "Intervene";
      step.dataset.tooltip = "Step in front of an Ally this attack hit. Costs a Counter "
        + "Action, and the effect you choose sets the Ki cost. Needs the Intervene "
        + "Maneuver - a character made before it existed gets it from Add core maneuvers.";
      step.addEventListener("click", () => openIntervene(message, attack));
      container.append(step);
    }
  }

  if (awaitsFollowUps(attack)) {
    const attacker = fromUuidSync(attack.attackerUuid);
    if (!attacker?.isOwner) return;

    const plan = PROFILES[attack.profile].followUps;
    const more = document.createElement("button");
    more.type = "button";
    more.className = "dbu-clash-button";
    more.textContent = `Roll ${plan.rolls} additional Strikes`;
    more.dataset.tooltip = "Each one that beats the defence they already made adds "
      + `${plan.woundPerHitPerTier}(T) to the Wound Roll.`;
    more.addEventListener("click", () => rollFollowUpStrikes(message, attack, attacker));
    container.append(more);
    return;
  }

  // Whoever owes the Wound Roll, which is the attacker on everything but a reflected
  // attack - there it is the Character whose attack was thrown back, and the button
  // belongs on their client rather than on the reflector's.
  // Landed on anybody. One Wound Roll serves everyone it hit, and one of them having
  // dodged is no reason for the rest to go unwounded.
  if (!result.wound && owesWound(attack)) {
    const roller = woundRoller(attack);
    if (!roller?.isOwner) return;

    const roll = document.createElement("button");
    roll.type = "button";
    roll.className = "dbu-clash-button";
    roll.textContent = "Roll Wound";
    if (attack.woundBy) {
      roll.dataset.tooltip = `${attack.maneuverName} was thrown back at you. You roll its `
        + "Wound Roll, and it is Urgent - it cannot be failed on purpose.";
    } else if (attack.absorbed) {
      roll.dataset.tooltip = `${attack.absorbed.name} absorbed this. Roll its Wound Roll as `
        + "if it had hit them - half the Dice Score comes back to them as Ki. It is Urgent, "
        + "so it cannot be failed on purpose.";
    }
    roll.addEventListener("click", () => woundStage(message, attack));
    container.append(roll);
    return;
  }

  // A Wound not yet rolled has nothing to apply anywhere.
  if (!result.wound) return;

  // Damage taken in somebody else's place, which belongs to no target line - the one
  // who stepped in is not a target of the attack, and may not be on the card at all.
  for (const entry of interventions(attack)) {
    if (!entry.outcome || entry.outcome.applied) continue;

    const who = fromUuidSync(entry.uuid);
    if (!who?.isOwner) continue;
    if ((entry.outcome.damage <= 0) && !entry.outcome.spill?.damage) continue;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "dbu-clash-button";
    button.textContent = `Apply ${entry.outcome.damage} to ${who.name}`;
    button.dataset.tooltip = entry.outcome.defeated
      ? `Taken in ${entry.allyName}'s place. It Defeats them, and ${
        entry.outcome.spill?.damage ?? 0} reaches ${entry.allyName} through their own defences.`
      : `Taken in ${entry.allyName}'s place.`;
    button.addEventListener("click", () => applyInterventionDamage(message, attack, entry));
    container.append(button);
  }

  // One line per person this reader plays: an attack that reached four people is four
  // separate amounts of Damage, taken by four different characters, and one of them
  // having been dealt says nothing about the rest.
  for (const entry of targetResults(attack)) {
    const target = fromUuidSync(entry.uuid);
    if (!target?.isOwner) continue;
    // A hit, or an Absolute Attack's answer to having missed - which owes Damage
    // without having hit anybody.
    if (!entry.own?.hit && !isAbsoluteMiss(entry.own)) continue;

    if (entry.own.applied) {
      const note = document.createElement("div");
      note.className = "dbu-settled-note";
      note.textContent = `${target.name}: ${entry.own.damage} damage applied`;
      container.append(note);
      continue;
    }

    // A Wound the Soak Value absorbed entirely, or a Power Flare that beat it:
    // nothing to apply.
    if (entry.own.damage <= 0) continue;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "dbu-clash-button";
    button.textContent = `Apply ${entry.own.damage} damage to ${target.name}`;
    button.addEventListener("click", () => applyAttackDamage(message, target, attack));
    container.append(button);
  }
}

function renderCriticalButton(message, html) {
  if (!message.getFlag(SCOPE, PENDING_FLAG)) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "dbu-crit-button";
  const criticalDice = message.getFlag(SCOPE, CRITICAL_DICE_FLAG) ?? DBUCharacterData.SKILL_CRITICAL_DIE;
  button.textContent = `Roll Critical Die (+${criticalDice})`;
  button.addEventListener("click", () => rollCriticalDie(message, button, criticalDice));

  (html.querySelector(".message-content") ?? html).append(button);
}

/**
 * Whether this row is a Difficulty verdict, so a card being rebuilt can drop the old one.
 *
 * Matched on the sentence it is built from rather than on a kind of its own: a verdict is
 * a note like any other note, and giving it a kind would mean teaching the breakdown table
 * a row type that is drawn exactly like the one it already has.
 */
function isVerdict(line) {
  return (line?.kind === "note") && / \d+ - (met|not met)$/.test(line.source ?? "");
}

/**
 * Roll the extra die, then replace the original check with a single card showing the
 * combined total. Replacing rather than appending keeps one result in the log instead
 * of a small number the reader has to add up themselves.
 */
async function rollCriticalDie(message, button, criticalDice) {
  button.disabled = true;

  const baseRoll = message.rolls[0];
  const critRoll = new Roll(criticalDice);
  await critRoll.evaluate();

  const baseTotal = baseRoll?.total ?? 0;
  const check = message.getFlag(SCOPE, CHECK_FLAG);

  // The rows the check was posted with, plus the die just rolled. Kept rather than
  // rebuilt: the original said which Skill, which Saving Throw, what an effect added,
  // and a card that threw all that away to say "check = 14" told the reader less after
  // the Critical than before it.
  const total = baseTotal + critRoll.total;

  // The verdict is worked out again rather than carried over: the Critical Die is exactly
  // the thing that can take a Check over a Target Number it had missed, and a card that
  // repeated the old answer under a new number would be the worst of both.
  //
  // Which means the old row has to go before the new one is added - `check.lines` has the
  // verdict as it stood, and two of them on one card is a card that says both.
  const lines = [
    ...(check?.lines ?? []).filter(line => !isVerdict(line)),
    fromOutcome(diceLine(critRoll, "Critical", { rank: "extra" })),
    difficultyLine(total, check?.against ?? null)
  ].filter(Boolean);

  await ChatMessage.create({
    speaker: message.speaker,
    flavor: message.flavor,
    // Only the new die is attached, so the original dice are not re-animated.
    rolls: [critRoll],
    content: checkCard({
      lines,
      total,
      outcome: "critical",
      owner: check?.actorUuid ?? null
    })
  });

  // Author or GM only; for anyone else the button just stays disabled locally.
  if (message.isAuthor || game.user.isGM) await message.delete();
}
