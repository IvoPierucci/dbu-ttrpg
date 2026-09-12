import DBUCharacterData from "./data/actor-character.mjs";
import { reactiveFor, usesLeft } from "./effects/registry.mjs";
import { permits } from "./effects/interpreter.mjs";
import { spendActions } from "./combat.mjs";
import { allKarmicEffects, karmicOptionsFor, spendKarma } from "./karma.mjs";
import { advantageWoundParts, pushes } from "./signature.mjs";
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
  maneuverKiCost,
  recordManeuverType,
  whyNotAnotherAbsolute,
  whyNotIntervene,
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
  await message.setFlag(SCOPE, OOS_TAKEN_FLAG, actorUuid);
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
 * Roll the Base Die plus a bonus and classify the result, without deciding what to
 * do about it. Callers apply their own policy: a lone check offers the critical die
 * as a button, while a Skill Clash has to settle both sides at once.
 */
export async function evaluateCheck(actor, bonus, extraDice = "", baseDie = null) {
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
  const natural = (typeof baseDie === "object" && baseDie)
    ? Math.max(0, applySlot({ baseDie }, "baseDie", rolled))
    : rolled;

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
    botch: natural <= (actor.system.botchRange ?? 1),
    critical: natural >= actor.system.criticalTarget
  };
}

/**
 * Card for a check whose result needs to stand out. The parts line keeps the working
 * visible; the total is what the player actually reads, so it carries the emphasis.
 */
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
  renderCheckKarma(message, html);
  hidePrivateBreakdowns(message, html);
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
      // Both sides roll the same Skill, which is what makes it a Skill Clash.
      .map(entry => ({ ...entry, kind: "clash", category: "skill",
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
    const hit = own.automatic || (answer ? (strike.total > answer.total) : true);

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
      (line.uuid === entry.uuid) ? { ...own, answer, hit, incomingDamage } : line);
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
    const damage = Math.max(0, applySlot(
      { "incoming.damage": own.incomingDamage }, "incoming.damage", raw));

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

  const before = side.natural ?? 0;
  // "You must accept this second roll, unless it is lower than the first. In which
  // case, you may take the first roll." Only asked when it is actually lower, so the
  // ordinary case costs nobody a click.
  if ((again.total < before) && await keepTheFirstRoll(actor, before, again.total)) {
    return {
      total: side.total,
      outcome: side.outcome ?? "",
      lines: [noteLine(`Karmic Chance rolled ${again.total}, keeping ${before}`)]
    };
  }

  let total = (side.beforeOutcome ?? side.total) - before + again.total;
  let outcome = "";
  // The Base Die was replaced, so what is shown is the swap and not a second die: the
  // first one is no longer part of the roll and a row implying it still counts would be
  // a row that lies.
  const lines = [partLine({
    label: "Karmic Chance",
    written: `${before} → ${again.total}`,
    value: again.total - before
  })];

  const botch = again.total <= (actor.system.botchRange ?? 1);
  const critical = again.total >= (actor.system.criticalTarget ?? 10);

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
    lines.splice(0, lines.length, ...withoutOutcome(lines), ...again.lines);
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
export async function postManeuver(actor, maneuver, { asOutOfSequence = false, foundation = null } = {}) {
  const type = MANEUVER_TYPES[maneuver.type];
  const label = asOutOfSequence ? MANEUVER_TYPES.outOfSequence.label : type.label;
  const cost = (type.action && !asOutOfSequence)
    ? `${maneuver.actionCost} ${type.action} action(s)`
    : "no action";

  // Handed back, because the card an Instant was played on is part of the Instant rule:
  // an Out-of-Sequence Maneuver this one goes on to offer does not count as getting out
  // from under it.
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="dbu-maneuver">
        <div class="dbu-maneuver-name">${Handlebars.escapeExpression(maneuver.name)}</div>
        <div class="dbu-maneuver-meta">${label} &middot; ${cost} &middot; ${maneuver.kiCost} KP</div>
        ${attackLine(actor, maneuver, foundation)}
      </div>`,
    flags: { [SCOPE]: { [RESPONDABLE_FLAG]: isRespondable(maneuver, asOutOfSequence) } }
  });
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

  // Once every target has answered, there is nothing left to answer with: what follows
  // belongs to the Wound Roll and to being hit, which have their own stages.
  if (attack?.result) return;
  if (!respondable && !awaiting) return;

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
                                    combatRoll = false, attackingManeuver = false } = {}) {
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

  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title },
    content: `<div class="dbu-respond-dialog">
      ${hint ? `<p class="dbu-respond-hint">${hint}</p>` : ""}${rows}${willing}${karmicGroup}
    </div>`,
    buttons: [
      {
        action: "confirm",
        label: "Confirm",
        callback: (event, button, dialog) => ({
          triggers: [...dialog.element.querySelectorAll('input[name="trigger"]:checked')].map(input => input.value),
          willing: dialog.element.querySelector('input[name="willing"]')?.checked ?? null,
          karmic: dialog.element.querySelector('input[name="karmic"]:checked')?.value ?? null
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

  return true;
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
  return message.getFlag(SCOPE, CLASH_FLAG)?.category === "combat";
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
    const counters = counterManeuvers().map(maneuver => {
      // A Counter Maneuver answers an Attacking Maneuver aimed at you, so a character
      // who is not the target is shown it but cannot take it.
      let blocked = !unresolved;
      let reason = blocked
        ? "only the target of an attack may answer it, and only before it resolves" : "";

      // Energy Cancel needs a charge to let go of, whoever is looking at it.
      if (!blocked && maneuver.cancelCharge && !actor.system.charging?.maneuverId) {
        blocked = true;
        reason = "you are not charging anything";
      }

      const note = maneuver.cancelCharge
        ? `${maneuver.source} - you still Dodge`
        : maneuver.source;

      return option(`counter-${actor.id}`, maneuver.id, maneuver.name, note, blocked, reason);
    }).join("");

    // Both Dodge and the Defend Maneuver are called for by being attacked, and a
    // Maneuver that is not an attack does not call for either - a Skill Clash such as
    // Thumb War is answered on its own card, not defended against. With no attack here
    // the whole group is left off rather than shown with everything in it disabled:
    // greying out an option says "not now", and the truth is "not for this".
    const counterGroup = attack
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

/** Flag holding a Moment the table has been called to answer. */
const MOMENT_FLAG = "moment";

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
                                           attackingManeuver = false } = {}) {
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
    groups.map(group => group.formula).join(" + "), baseDie);
  const { roll, naturalShift } = evaluated;
  let { natural, botch, critical } = evaluated;
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
  const held = floorLine(bonus - netted, "Penalties stop at the dice");
  if (held) lines.push(held);

  // Said out loud, because it is why the roll happened at all: the player asked to fail
  // and the roll would not let them.
  if (refusedWilling) {
    outcome = "urgent";
    lines.push(noteLine("Urgent - a willing failure was refused"));
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
  const floored = floorLine(Math.max(0, total) - total, "Nothing below zero");
  if (floored) lines.push(floored);
  total = Math.max(0, total);

  return {
    actorUuid: actor.uuid,
    actorName: actor.name,
    natural,
    // What the dice and the bonuses came to before a Botch or a Critical touched it.
    // Karmic Chance replaces the Base Die and re-reads the result from scratch, so it
    // needs the total without the old die's consequences already baked in.
    beforeOutcome: roll.total,
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
const CLASH_ROLLS = Object.freeze({
  skill: {
    label: "Skill Clash",
    of: (actor, clash) => ({
      label: clash.skillLabel,
      value: actor.system.skills[clash.skill].roll
    }),
    criticalDice: () => DBUCharacterData.SKILL_CRITICAL_DIE
  },
  might: {
    label: "Might Clash",
    of: (actor) => ({ label: "Might", value: actor.system.might }),
    // Might is not a Skill, so it does not take a Skill's flat critical die - it takes
    // the character's own, which grows with the Tier of Power.
    criticalDice: (actor) => actor.system.dice.critical.formula
  }
});

export async function postSkillClash(actor, target, maneuver) {
  const skillKey = maneuver.clash.skill;

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
          maneuverName: maneuver.name,
          challengerUuid: actor.uuid,
          challengerName: actor.name,
          defenderUuid: target.uuid,
          defenderName: target.name,
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
                                     { maneuverName, reason = "", collision = null } = {}) {
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: "",
    flags: {
      [SCOPE]: {
        // Not a Maneuver of its own, so there is nothing here for an Instant to answer.
        [RESPONDABLE_FLAG]: false,
        [CLASH_FLAG]: {
          category: "might",
          maneuverName,
          reason,
          // What winning this one lets the challenger do. Knockback sets it: win and
          // the movement can cost the loser Life Points. Carried here rather than
          // looked up from the attack, because this card is the one that knows who
          // won - and what a collision costs is asked of the character who had it,
          // not of the Maneuver that caused it.
          collision,
          collisionApplied: false,
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
        Handlebars.escapeExpression(CLASH_ROLLS[clash.category ?? "skill"].label)}${
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
    const wonIt = result.challenger.succeeded
      || (!result.defender.succeeded && (result.challenger.total > result.defender.total));

    const challenger = fromUuidSync(clash.challengerUuid);
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

  // Both sides confirm the same way, and each only for themselves. The challenger has
  // as much to declare as the defender does - a willing failure, an effect - so the
  // card asks them both rather than rolling the challenger's dice unasked.
  for (const uuid of clashParticipants(clash)) {
    if ((clash.ready ?? []).includes(uuid)) continue;

    const actor = fromUuidSync(uuid);
    if (!actor?.isOwner) continue;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "dbu-clash-button";
    // What this side actually rolls, which is the Skill on a Skill Clash and Might on a
    // Might Clash - the label used to be the Skill's alone, so a Might Clash offered
    // "Roll undefined".
    button.textContent = `Roll ${CLASH_ROLLS[clash.category ?? "skill"].of(actor, clash).label}`;
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
 * Let this side declare what they are bringing, then mark them ready.
 */
async function clashStage(message, actor) {
  if (!await prepareRoll(actor, [], `${actor.name}: before the roll`)) return;

  // Read fresh rather than trusting what the card was drawn with: the other side may
  // have confirmed while this dialog was open, and writing a stale copy back would
  // erase it.
  const clash = message.getFlag(SCOPE, CLASH_FLAG);
  if (!clash || clash.result) return;

  return settleClash(message, {
    ...clash,
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

  const [challengerSide, defenderSide] = await Promise.all([
    rollSide(challenger, [kind.of(challenger, clash)],
      { criticalDice: kind.criticalDice(challenger) }),
    rollSide(defender, [kind.of(defender, clash)],
      { criticalDice: kind.criticalDice(defender) })
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
  const takenBy = message.getFlag(SCOPE, OOS_TAKEN_FLAG) ?? null;

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
      // Only one Out-of-Sequence Maneuver may come from a single trigger, so once
      // any of these is taken the others are no longer on offer.
      if (!takenBy && actor?.isOwner) {
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

  if (takenBy) {
    const note = document.createElement("div");
    note.className = "dbu-settled-note";
    note.textContent = "Out-of-Sequence Maneuver used";
    container.append(note);
    return;
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
  // Opened for an Attacking Maneuver even when it names no Profile: the Ki Wager
  // belongs to the attack rather than to the Profile, and Compelled sets a floor under
  // it that has to be asked for somewhere.
  if (maneuver.profile || maneuver.attacking) {
    declared = await declareAttack(maneuver, DBUCharacterData.FOUNDATIONS, actor);
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
  }

  // An Out-of-Sequence Maneuver ignores its Action Cost, but not its Ki cost.
  if (!await spendManeuverCost(actor, maneuver, maneuverKiCost(maneuver, declared, actor))) return;

  // An Out-of-Sequence Maneuver counts as having used another kind - unless the thing
  // that offered it was the Instant still holding you, which is what the message id is
  // compared against.
  await recordManeuverType(actor, "outOfSequence", { messageId: message.id });

  requestEdit(message, { type: "offerTaken", actorUuid: actor.uuid });

  return declared
    ? postAttack(actor, target, maneuver, declared, { asOutOfSequence: true })
    : postManeuver(actor, maneuver, { asOutOfSequence: true });
}

/**
 * Declare an attack. As with a Skill Clash, nothing is rolled yet: Strike and Dodge
 * are rolled together the moment the target accepts, so neither side learns the
 * other's result in advance.
 */
export async function postAttack(actor, target, maneuver,
                                 { profile, foundation, kiWager = 0, charges = 0,
                                   advantages = [], squaresCharged = 0 },
                                 { asOutOfSequence = false } = {}) {
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

  await actor.update({
    "system.attacksThisRound": actor.system.attacksThisRound + 1,
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
          actionCost: maneuver.actionCost ?? 1,
          tags: maneuver.tags ?? [],
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
          damageCategoryShift: profileCategoryShift(profile, charges),
          kiWager,
          // Energy Charges live on the Maneuver, not the character: they were fed into
          // this attack and are spent with it. Each adds a die to the Wound Roll.
          // Powered "gains an Energy Charge", on top of anything the Energy Charge
          // Maneuver fed into it - and still held to the seven the rules allow.
          energyCharges: Math.min(
            charges + (PROFILES[profile].grantsEnergyCharge ?? 0),
            maxEnergyCharges(profile, DBUCharacterData.MAX_ENERGY_CHARGES)
          ),
          signature: (maneuver.tags ?? []).includes("signature"),
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
function interventionOutcome(attack, entry, wound) {
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
  const damage = Math.max(0, wound.total - soak - reduction);

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
    ? spilloverTo(ally, excess, attack)
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

/** What is left over reaches the Ally through their own Soak and Damage Reduction. */
function spilloverTo(ally, excess, attack) {
  const own = targetResult(attack, ally.uuid);
  const category = own?.damageCategory ?? attack.damageCategory;

  const soak = Math.max(0, Math.floor(
    (ally.system.soakValue ?? 0) * DAMAGE_CATEGORIES[category].soakMultiplier));
  const reduction = Math.max(0, ally.system.damageReduction ?? 0);

  return {
    uuid: ally.uuid,
    name: ally.name,
    soak,
    reduction,
    damage: Math.max(0, excess - soak - reduction),
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

  const entry = {
    uuid: actor.uuid,
    name: actor.name,
    allyUuid: ally,
    allyName: allyActor.name,
    effect,
    clash: null,
    deflected: false,
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

/**
 * What the Energy Charges on an attack take off a Parry.
 *
 * "Reduce your Dice Score by 1(bT) for each Energy Charge or rank of Power Shot on the
 * Attacking Maneuver." Power Shot is not in the system yet - there is one Profile, and
 * it has no ranks - so only the Charges are counted, and the day a ranked Profile
 * arrives this is where its ranks are added.
 *
 * An empty list when there is nothing to take off, so the breakdown does not carry a
 * line saying zero.
 */
function chargePenalty(actor, attack) {
  const charges = attack?.energyCharges ?? 0;
  if (charges <= 0) return [];

  const perCharge = actor.system.baseTierOfPower ?? 1;
  return [{ label: "Energy Charges", written: `-${charges}(bT)`, value: -(charges * perCharge) }];
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
    ...musclePenalty(attacker),
    { label: "Dim. Offense", value: -attacker.system.diminishing.offense.penalty },
    ...thresholdPenalty(attacker)
  ], { ...attackerOptions, slot: "strike", attackingManeuver: true });

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
    const forced = attacker.system.effects?.slots?.["attack.autoHit"] === true
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

    // The defender wins ties, as everywhere else: the attacker has to beat them.
    const hit = automatic || (answer ? (strike.total > answer.total) : true);

    // What this defender's own effects do about being hit - Superior taking more
    // Damage, Prone taking it a category harder. Collected once, used at the Wound Roll.
    const incoming = hit ? atMoment(target, "being-hit", { attack: 1, attacker: 1 }) : null;
    if (incoming) spendChosen(target, incoming);

    // Every step for and against the Damage Category is summed before anything is
    // clamped, so an attack pushed well past Lethal is still above one merely at it.
    // Per target, because the defence is part of it: a Guard drops the Category for
    // whoever guarded and for nobody else.
    const shift = (attack.damageCategoryShift ?? 0)
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

async function woundStage(message, attack, attacker) {
  const triggers = relevantTriggers(attacker, message, "hit");
  const ready = await prepareRoll(attacker, triggers, "On hitting",
    "", { combatRoll: true, attackingManeuver: true });
  if (!ready) return;
  return rollAttackWound(message, attack);
}

/**
 * What a Profile adds to the Wound Roll.
 *
 * Powered: "apply your Damage Attribute an additional time." The Damage Attribute is
 * whichever the Foundation names - it is already inside the Wound value once, so this
 * is that Modifier added again rather than the Wound doubled, which would take Might
 * and everything else along with it.
 */
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
  return anyoneHit(attack) || Boolean(attack.absolute);
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
  const answer = (attack.result?.targets ?? [])
    .find(line => line.hit && line.answer)?.answer ?? null;
  const beatable = answer ? (answer.total ?? 0) : null;

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
    : rolls.filter(roll => roll.total > beatable).length;

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
  const attacker = fromUuidSync(attack.attackerUuid);
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
    { label: "Wound", value: attacker.system.combat.wound[attack.foundation] },
    ...profileWoundParts(attacker, attack),
    ...advantageWoundParts(attacker, attack),
    ...superStackWoundParts(attacker, attack),
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
    attackingManeuver: true
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
    const effectiveWound = defence.wound(wound.total);

    // Damage Reduction comes off the same Wound Roll, and off it whole. The Damage
    // Category has already had its say on the Soak above and gets no say here, and the
    // defence's own multiplier is applied to `counted` rather than to this - which is
    // what makes a point of it worth more than a point of Soak.
    const reduction = Math.max(0, (target.system.damageReduction ?? 0) - pierced);

    const negated = counterWound && (counterWound.total > wound.total);
    const raw = negated ? 0 : Math.max(0, effectiveWound - soak - reduction);

    // What this defender's own effects do to the Damage they take, in two passes
    // because they answer two different moments. Being hit is settled when the Clash is
    // - the Superior State takes 2(T) more - and that was worked out on the defender's
    // client and carried here on the attack. Before the Wound Roll is settled now,
    // since Broken needs the Soak Value it could not use, which is only known here.
    const onHit = applySlot(
      { "incoming.damage": own.incomingDamage }, "incoming.damage", raw);

    const beforeWound = atMoment(target, "before-wound", { attack: 1, damageCategory: 1 });
    spendChosen(target, beforeWound);

    const damage = Math.max(0, applySlot(beforeWound.slots, "incoming.damage", onHit));

    await maybeShakeAttacker(attacker, attack, defence, damage);

    settledTargets.push({ ...own, counterWound, effectiveWound, soak, reduction, damage });
  }

  // What the Wound Roll came to for each person who took one in somebody else's place.
  const settledInterventions = interventions(attack).map(entry =>
    takesWoundFor(entry) ? { ...entry, outcome: interventionOutcome(attack, entry, wound) } : entry);

  requestEdit(message, {
    type: "attack",
    // Damage is worked out here but not dealt: applying it is a separate, deliberate
    // step, so the table can rule on it before anyone loses Life.
    attack: {
      ...attack,
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
function dodgeBonus(actor, { halved = false } = {}) {
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
  return parts;
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
    answer: (actor, options) => rollSide(actor, dodgeBonus(actor), { ...options, slot: "dodge" }),
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
    answer: (actor, options) =>
      rollSide(actor, dodgeBonus(actor, { halved: true }), { ...options, slot: "dodge" }),
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
async function openKnockback(attack, attacker, target) {
  return postMightClash(attacker, target, {
    // Named for the Advantage, not for the Maneuver: this card is about the Knockback,
    // and which attack caused it belongs in the line below rather than in the title.
    maneuverName: "Knockback",
    reason: `${attack.maneuverName} · win and move ${target.name} up to `
      + `${attacker.system.might} Squares in a straight line away from you.`,
    collision: {
      // Launching doubles what the movement costs, and says so itself - an Advantage
      // does not know which Profile handed it out.
      doubles: Boolean(PROFILES[attack.profile]?.doublesCollisionDamage),
      doubledBy: PROFILES[attack.profile]?.label ?? ""
    }
  });
}

/**
 * Collision Damage, as a Life Point reduction.
 *
 * Offered off the Might Clash that Knockback opened, and only to the winner of it: the
 * movement is what causes the collision, and there is no movement without the win.
 *
 * How much it is depends on what they hit and how far they went, which is the table's
 * to work out - so the amount is asked for rather than derived, and asked once per
 * Clash. Two characters thrown by one Maneuver each have a Clash of their own and are
 * each asked their own number, because they did not hit the same wall.
 *
 * What the system does is take it off the right way: straight off Life, past the Soak
 * Value and past Damage Reduction, and doubled when Launching threw them.
 */
async function applyCollisionDamage(message, clash) {
  const target = fromUuidSync(clash.defenderUuid);
  if (!target || clash.collisionApplied) return;

  const doubled = Boolean(clash.collision?.doubles);

  const typed = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: `${clash.maneuverName} - Collision Damage` },
    content: `
      <label class="dbu-wager">
        <span>Collision Damage</span>
        <input type="number" name="collision" value="0" min="0"/>
        <em>Taken straight off ${Handlebars.escapeExpression(target.name)}'s Life Points,
          past their Soak Value and Damage Reduction.${doubled
            ? ` ${Handlebars.escapeExpression(clash.collision.doubledBy)} doubles it.`
            : ""}</em>
      </label>`,
    buttons: [
      {
        action: "confirm",
        label: "Apply",
        callback: (event, button, dialog) => {
          const value = Math.floor(Number(dialog.element.querySelector('input[name="collision"]').value));
          return Number.isFinite(value) ? Math.max(0, value) : 0;
        }
      },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });

  if (!typed) return;

  const amount = doubled ? typed * 2 : typed;
  const reason = doubled
    ? `Collision Damage, doubled by ${clash.collision.doubledBy}`
    : "Collision Damage";

  await reduceLifePoints(target, amount, { reason });

  // Marked on the Clash that allowed it, so one win buys one collision. Another
  // character thrown by the same Maneuver has a Clash of their own, and is asked for
  // their own number - what a collision costs depends on what they hit.
  return requestEdit(message, { type: "clash", clash: { ...clash, collisionApplied: true } });
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
  if ((damage > 0) && !isAbsoluteMiss(own) && pushes(attack)) {
    const attacker = fromUuidSync(attack.attackerUuid);
    if (attacker) await openKnockback(attack, attacker, target);
  }

  requestEdit(message, {
    type: "attack",
    attack: {
      ...attack,
      result: { ...attack.result, targets: replaceTarget(attack, target.uuid, { applied: true }) }
    }
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
          applied: []
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

  const { STEADFAST_DIE, STEADFAST_TARGET, THRESHOLDS } = DBUCharacterData;
  const updates = {};

  const automatic = pending.slice(0, -1);
  const rolled = pending[pending.length - 1];
  for (const key of automatic) updates[`system.thresholdChecks.${key}`] = "fail";

  const roll = new Roll(STEADFAST_DIE);
  await roll.evaluate();
  const passed = roll.total >= STEADFAST_TARGET;
  updates[`system.thresholdChecks.${rolled}`] = passed ? "pass" : "fail";

  await actor.update(updates);

  const carried = automatic.length
    ? ` (${automatic.map(key => THRESHOLDS[key].label).join(", ")} failed automatically)`
    : "";

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `Steadfast Check - ${THRESHOLDS[rolled].label} - ${passed ? "passed" : "failed"}${carried}`
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

  const options = Object.entries(DEFEND_OPTIONS).map(([key, option], index) => {
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
  if (own.answer) return attackSide(label, target.name, own.answer, own.forced ?? "");

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
          attack.kiWager ? ` &middot; ${attack.kiWager} KP wagered` : ""}${attack.energyCharges
          ? ` &middot; ${attack.energyCharges} Energy Charge${attack.energyCharges === 1 ? "" : "s"}`
          : ""}${PROFILES[attack.profile]?.area
          ? ` &middot; ${Handlebars.escapeExpression(areaLabel(PROFILES[attack.profile].area))}`
          : ""}</span>
    </div>
    ${result
      ? attackSide("Strike", attack.attackerName, result.strike)
      : attackerRow(attack)}
    ${attackTargets(attack).map(target => targetRow(attack, target)).join("")}
    ${followUpRows(attack)}
    ${result?.wound ? attackSide("Wound", attack.attackerName, result.wound) : ""}
    ${flareRows(attack)}
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

  // Stepping in for somebody, which is the one Counter Maneuver that can be played
  // without being the target. Offered in the window the rule opens - the Ally has been
  // hit, and the Wound Roll has not been made - to anyone the reader owns who holds the
  // Maneuver, whether or not the attack was aimed at them too.
  if (!result.wound && !deflection(attack)) {
    const usable = possibleInterveners(attack)
      .filter(who => shieldableTargets(attack, who).length);

    if (usable.length) {
      const step = document.createElement("button");
      step.type = "button";
      step.className = "dbu-clash-button";
      step.textContent = "Intervene";
      step.dataset.tooltip = "Step in front of an Ally this attack hit. Costs a Counter "
        + "Action, and the effect you choose sets the Ki cost.";
      step.addEventListener("click", () => openIntervene(message, attack));
      container.append(step);
    }
  }

  // The attacker rolls their own Wound, so that step belongs to them.
  // Landed on anybody. One Wound Roll serves everyone it hit, and one of them having
  // dodged is no reason for the rest to go unwounded.
  if (!result.wound && owesWound(attack)) {
    const attacker = fromUuidSync(attack.attackerUuid);
    if (!attacker?.isOwner) return;

    const roll = document.createElement("button");
    roll.type = "button";
    roll.className = "dbu-clash-button";
    roll.textContent = "Roll Wound";
    roll.addEventListener("click", () => woundStage(message, attack, attacker));
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
  const lines = [
    ...(check?.lines ?? []),
    fromOutcome(diceLine(critRoll, "Critical", { rank: "extra" }))
  ];

  await ChatMessage.create({
    speaker: message.speaker,
    flavor: message.flavor,
    // Only the new die is attached, so the original dice are not re-animated.
    rolls: [critRoll],
    content: checkCard({
      lines,
      total: baseTotal + critRoll.total,
      outcome: "critical",
      owner: check?.actorUuid ?? null
    })
  });

  // Author or GM only; for anyone else the button just stays disabled locally.
  if (message.isAuthor || game.user.isGM) await message.delete();
}
