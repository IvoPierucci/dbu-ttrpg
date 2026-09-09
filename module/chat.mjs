import DBUCharacterData from "./data/actor-character.mjs";
import { armedEffect, talentEffects, usesLeft } from "./talents.mjs";
import {
  DAMAGE_CATEGORIES,
  DEFEND_OPTIONS,
  MANEUVER_TYPES,
  PROFILES,
  resolveDamageCategory,
  allManeuvers,
  declareAttack,
  defendOptionCost,
  getManeuver,
  maneuverKiCost,
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
    case "actor": return applyActorUpdate(request.actorUuid, request.changes);
    case "offer": return applyOffer(request.messageId, request.offer);
    case "offerTaken": return applyOfferTaken(request.messageId, request.actorUuid);
    default:
      console.warn("DBU TTRPG | Unknown relayed edit", request);
      return undefined;
  }
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
function requestActorUpdate(actor, changes) {
  if (actor.isOwner) return actor.update(changes);
  if (!game.users.activeGM) return;
  game.socket.emit(CHANNEL, { type: "actor", actorUuid: actor.uuid, changes });
}

/** Record one use of a triggered effect, and disarm it. */
function spendTriggeredEffect(actor, effect) {
  return requestActorUpdate(actor, {
    "system.talentUses.round": [...actor.system.talentUses.round, effect.talentId],
    "system.talentUses.encounter": [...actor.system.talentUses.encounter, effect.talentId],
    "system.armedTalents": actor.system.armedTalents.filter(id => id !== effect.talentId)
  });
}

/** Write a resolved attack back onto its message. */
async function applyAttack(messageId, attack) {
  const message = game.messages.get(messageId);
  if (!message) return;
  await message.setFlag(SCOPE, ATTACK_FLAG, attack);
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
export async function evaluateCheck(actor, bonus, extraDice = "") {
  // The Base Die stays first, since the critical and botch rules read its natural
  // result - Extra Dice never decide either.
  const formula = [DBUCharacterData.BASE_DIE, extraDice, "@bonus"].filter(Boolean).join(" + ");
  const roll = new Roll(formula, { bonus });
  await roll.evaluate();

  const natural = roll.dice[0]?.total;
  return {
    roll,
    natural,
    botch: natural === 1,
    // The Critical Target never drops below 7, so the two can never both be true.
    critical: natural >= actor.system.criticalTarget
  };
}

/**
 * Card for a check whose result needs to stand out. The parts line keeps the working
 * visible; the total is what the player actually reads, so it carries the emphasis.
 */
export function checkCard({ parts, total, outcome }) {
  return `
    <div class="dbu-check">
      <div class="dbu-check-parts">${parts}</div>
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
  renderInstantResponses(message, html);
  renderOutOfSequence(message, html);
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

  await ChatMessage.create({
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
 * Whether a character has answered the most recent Standard Maneuver with an Instant.
 *
 * This is what keeps two Instants from being played back to back: having answered the
 * last one, you may not reach for another until a Standard Maneuver passes that you
 * did not answer. Read from the messages themselves, so there is no flag to set or
 * clear and no way for it to fall out of step.
 */
export function answeredLatestManeuver(actor) {
  const respondable = game.messages.contents.filter(message => message.getFlag(SCOPE, RESPONDABLE_FLAG));
  const latest = respondable[respondable.length - 1];
  if (!latest) return false;

  return (latest.getFlag(SCOPE, RESPONSES_FLAG) ?? []).some(entry => entry.actorUuid === actor.uuid);
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
  const awaiting = Boolean(attack && !attack.result && fromUuidSync(attack.targetUuid)?.isOwner);

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
const TRIGGER_STAGES = {
  // Answering the attack: the Strike and whatever meets it.
  response: ["forceNaturalResult"],
  // The attack has landed. One moment, shared by both sides: the attacker brings what
  // happens on hitting, the target what happens on being hit, and both come before the
  // Wound Roll - which is exactly what they are there to change.
  hit: ["forceNaturalResult"]
};

/**
 * The triggered effects worth offering to this character at this point.
 *
 * Only what could actually bear on it: an effect that sets a Combat Roll is of no use
 * on a Maneuver that rolls nothing, or to a character standing outside the exchange.
 * Showing everything a character owns would bury the one that matters.
 */
function relevantTriggers(actor, message, stage) {
  const attack = message.getFlag(SCOPE, ATTACK_FLAG);
  if (!attack) return [];

  // Both sides take part in both stages; what differs is which effects each holds.
  if (![attack.attackerUuid, attack.targetUuid].includes(actor.uuid)) return [];

  return TRIGGER_STAGES[stage]
    .flatMap(key => talentEffects(actor, key))
    .filter(effect => usesLeft(actor, effect).available);
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
export async function prepareRoll(actor, effects, title, hint = "") {
  const rows = effects.map(effect => `
    <label class="dbu-respond-option">
      <input type="checkbox" name="trigger" value="${effect.talentId}"/>
      <span class="dbu-respond-name">${Handlebars.escapeExpression(effect.talentName)}</span>
      <span class="dbu-respond-source">${Handlebars.escapeExpression(effect.text)}</span>
    </label>`).join("");

  const willing = `
    <label class="dbu-respond-option dbu-respond-willing">
      <input type="checkbox" name="willing" ${actor.system.willingFailure ? "checked" : ""}/>
      <span class="dbu-respond-name">Willing failure</span>
      <span class="dbu-respond-source">Fail on purpose: this roll totals 0, however the dice land.</span>
    </label>`;

  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title },
    content: `<div class="dbu-respond-dialog">
      ${hint ? `<p class="dbu-respond-hint">${hint}</p>` : ""}${rows}${willing}
    </div>`,
    buttons: [
      {
        action: "confirm",
        label: "Confirm",
        callback: (event, button, dialog) => ({
          triggers: [...dialog.element.querySelectorAll('input[name="trigger"]:checked')].map(input => input.value),
          willing: dialog.element.querySelector('input[name="willing"]')?.checked ?? false
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
  if (chosen.willing !== actor.system.willingFailure) changes["system.willingFailure"] = chosen.willing;

  if (!foundry.utils.isEmpty(changes)) await actor.update(changes);
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
    const isTarget = attack?.targetUuid === actor.uuid;
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
    const willing = rollsOnMessage(message, actor)
      ? `<label class="dbu-respond-option dbu-respond-aside">
           <input type="checkbox" name="willing-${actor.id}"
                  ${actor.system.willingFailure ? "checked" : ""}/>
           <span class="dbu-respond-name">Willing failure</span>
           <span class="dbu-respond-source">your next roll totals 0</span>
         </label>`
      : "";

    // Dodging is not a Maneuver, but it is the other way to answer an attack - so it
    // shares the Counters' group and picking one unpicks the other.
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

    const counters = counterManeuvers().map(maneuver => {
      // A Counter Maneuver answers an Attacking Maneuver aimed at you, so a character
      // who is not the target is shown it but cannot take it.
      const blocked = !unresolved;
      return option(`counter-${actor.id}`, maneuver.id, maneuver.name, maneuver.source, blocked,
        blocked ? "only the target of an attack may Defend, and only before it resolves" : "");
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
            <input type="checkbox" name="trigger-${actor.id}" value="${effect.talentId}"/>
            <span class="dbu-respond-name">${Handlebars.escapeExpression(effect.talentName)}</span>
            <span class="dbu-respond-source">${Handlebars.escapeExpression(effect.text)}</span>
          </label>`).join("")
      : `<p class="dbu-respond-note">Nothing applies here.</p>`;

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

    if (choice.instant && (choice.instant !== "none")) {
      await playInstant(message, choice.actor, choice.instant);
    }
    if (choice.counter && (choice.counter !== "none")) {
      await playCounter(message, choice.actor, choice.counter, attack);
    }
  }
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
  if (answer === "dodge") return chooseDefence(message, actor, "dodge");

  const maneuver = getManeuver(answer);
  if (!maneuver?.defend) return;
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

/**
 * Settle one side of an opposed roll into a single number.
 *
 * Unlike a standalone check, an opposed roll cannot leave the critical die to a
 * button: the two sides are compared against each other, so a total that might still
 * grow is not yet a result. Both outcomes are therefore applied here and now.
 */
async function rollSide(actor, modifiers, { extraDice = "", criticalDice, combatRoll = false } = {}) {
  // A single netted number cannot be taken apart again, so what went into it is kept
  // as labelled parts and only summed for the roll itself.
  const parts = (typeof modifiers === "number") ? [{ label: "Bonus", value: modifiers }] : modifiers;
  const bonus = parts.reduce((sum, part) => sum + part.value, 0);

  const evaluated = await evaluateCheck(actor, bonus, extraDice);
  const { roll } = evaluated;
  let { natural, botch, critical } = evaluated;

  let total = roll.total;
  let outcome = "";

  // A willing failure is decided before the dice are read: the total is 0 whatever
  // they said, so nothing that would raise or lower it is worked out at all.
  if (actor.system.willingFailure) {
    requestActorUpdate(actor, { "system.willingFailure": false });
    return {
      actorUuid: actor.uuid,
      actorName: actor.name,
      total: 0,
      outcome: "willing",
      breakdown: `${roll.formula} = ${roll.result}  ·  willing failure  →  0`
    };
  }

  // A Talent can set the Base Die's Natural Result instead of rolling it. The die is
  // still rolled - Foundry cannot make one land on a chosen face - so what it came up
  // with is taken back out of the total and the forced result put in its place.
  const forced = combatRoll ? armedEffect(actor, "forceNaturalResult") : null;
  if (forced) {
    total += forced.value - natural;
    natural = forced.value;

    // The Talent states the result outright: setting the Base Die this way scores a
    // Critical. Not left to the comparison against the Critical Target, which happens
    // to agree today only because that target can never exceed 10 - if something ever
    // raised it, the guarantee would quietly stop holding.
    botch = false;
    critical = true;

    spendTriggeredEffect(actor, forced);
  }

  // How it was reached is written down here, while the dice are still in hand.
  const dice = roll.dice.map(die => `${die.expression} ${die.total}`).join(" + ");
  const segments = [forced ? `${dice}  |  Base Die set to ${forced.value}` : dice];

  const describe = (entries) => entries
    .map(entry => `${entry.label} ${Math.abs(entry.value)}`)
    .join(", ");

  const positives = parts.filter(part => part.value > 0);
  const negatives = parts.filter(part => part.value < 0);

  if (positives.length) {
    const sum = positives.reduce((total, part) => total + part.value, 0);
    segments.push(`bonuses +${sum} (${describe(positives)})`);
  }
  if (negatives.length) {
    const sum = negatives.reduce((total, part) => total + part.value, 0);
    segments.push(`penalties ${sum} (${describe(negatives)})`);
  }

  if (botch) {
    total -= DBUCharacterData.BOTCH_PENALTY;
    outcome = "botch";
    segments.push(`botch -${DBUCharacterData.BOTCH_PENALTY}`);
  }
  else if (critical) {
    const extra = new Roll(criticalDice);
    await extra.evaluate();
    total += extra.total;
    outcome = "critical";
    segments.push(`critical ${criticalDice} ${extra.result}`);
  }

  return {
    actorUuid: actor.uuid,
    actorName: actor.name,
    total,
    outcome,
    breakdown: `${segments.join("  ·  ")}  →  ${total}`
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
export async function postSkillClash(actor, target, maneuver) {
  const skillKey = maneuver.clash.skill;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: "",
    flags: {
      [SCOPE]: {
        // A Skill Clash is still a Maneuver: if it is Standard, it can be answered.
        [RESPONDABLE_FLAG]: isRespondable(maneuver),
        [CLASH_FLAG]: {
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

  const outcome = side.outcome ? `<span class="dbu-clash-outcome dbu-${side.outcome}">${side.outcome}</span>` : "";
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
      <span class="dbu-clash-skill">Skill Clash &middot; ${Handlebars.escapeExpression(clash.skillLabel)}</span>
    </div>
    ${clashSide(clash, clash.challengerUuid, clash.challengerName, result?.challenger)}
    ${clashSide(clash, clash.defenderUuid, clash.defenderName, result?.defender)}
    <div class="dbu-clash-result">${result ? clashResult(result) : awaitingClash(clash)}</div>`;
  container.append(card);

  if (result) return;

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
    button.textContent = `Roll ${clash.skillLabel}`;
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

  const [challengerSide, defenderSide] = await Promise.all([
    rollSide(challenger, [
      { label: clash.skillLabel, value: challenger.system.skills[clash.skill].bonus }
    ], { criticalDice: DBUCharacterData.SKILL_CRITICAL_DIE }),
    rollSide(defender, [
      { label: clash.skillLabel, value: defender.system.skills[clash.skill].bonus }
    ], { criticalDice: DBUCharacterData.SKILL_CRITICAL_DIE })
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
  if (maneuver.profile) {
    declared = await declareAttack(maneuver, DBUCharacterData.FOUNDATIONS, actor);
    if (!declared) return;
  }

  // An Out-of-Sequence Maneuver ignores its Action Cost, but not its Ki cost.
  if (!await spendManeuverCost(actor, maneuver, maneuverKiCost(maneuver, declared, actor))) return;

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
export async function postAttack(actor, target, maneuver, { profile, foundation, kiWager = 0 }, { asOutOfSequence = false } = {}) {
  // Counted as the Maneuver is made, so the stack it earns already weighs on its own
  // Strike Roll - the attack after your third is itself the one that suffers.
  await actor.update({ "system.attacksThisRound": actor.system.attacksThisRound + 1 });

  await ChatMessage.create({
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
          profile,
          profileLabel: PROFILES[profile].label,
          // Carried on the attack rather than looked up later: a Profile's Damage
          // Category is part of what was declared.
          damageCategory: PROFILES[profile].damageCategory,
          // Steps applied by the attacker's own effects. None write here yet, but they
          // must be summed with the defender's before anything is clamped.
          damageCategoryShift: 0,
          kiWager,
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
          defences: {},
          result: null
        }
      }
    }
  });
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
function chooseDefence(message, target, defence, wager = 0) {
  // Read fresh rather than trusting what the dialog was opened with: the other side
  // may have confirmed since, and writing a stale copy back would erase it.
  const attack = message.getFlag(SCOPE, ATTACK_FLAG);
  if (!attack || attack.result) return;

  return settleAttack(message, {
    ...attack,
    defences: { ...attack.defences, [target.uuid]: { defence, wager } },
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
 * Roll the exchange: the Strike, and whatever each target chose to meet it with.
 */
async function resolveAttack(message, attack) {
  const target = fromUuidSync(attack.targetUuid);
  const { defence: defense = "dodge", wager: defenceWager = 0 } = attack.defences[attack.targetUuid] ?? {};
  const attacker = fromUuidSync(attack.attackerUuid);
  if (!attacker || !target) {
    ui.notifications.warn("One of the actors in this attack no longer exists.");
    return;
  }

  // Tier of Power Extra Dice ride on every combat roll, each side using its own.
  const options = {
    attacker: {
      extraDice: attacker.system.dice.extra.formula,
      criticalDice: attacker.system.dice.critical.formula,
      combatRoll: true
    },
    target: {
      extraDice: target.system.dice.extra.formula,
      criticalDice: target.system.dice.critical.formula,
      combatRoll: true
    }
  };

  // Diminishing Offense blunts the Strike Roll of every Attacking Maneuver made once
  // the round's free attacks are spent.
  const strike = await rollSide(attacker, [
    { label: "Strike", value: attacker.system.combat.strike },
    { label: "Dim. Offense", value: -attacker.system.diminishing.offense.penalty },
    ...thresholdPenalty(attacker)
  ], { ...options.attacker, combatRoll: true });

  // What the defender answers the Strike with, and whether they answer at all.
  const defence = DEFENCES[defense];
  const answer = await defence.answer(target, options.target);

  // The defender wins ties, as everywhere else: the attacker has to beat them.
  const hit = answer ? (strike.total > answer.total) : true;

  // Every step for and against the Damage Category is summed before anything is
  // clamped, so an attack pushed well past Lethal is still above one merely at it.
  const shift = (attack.damageCategoryShift ?? 0) + (defence.damageCategoryShift ?? 0);
  const damageCategory = resolveDamageCategory(attack.damageCategory, shift);

  // Gained after the Attacking Maneuver, so it never touches the roll just made. The
  // Defend Maneuver spares you these entirely, whichever option it was used for.
  // Relayed rather than written directly: the exchange is settled by whichever client
  // confirmed last, which is as often the attacker's as the defender's, and that one
  // does not own the target. Writing straight to it there throws and takes the rest of
  // the resolution - the result itself included - down with it.
  if (defence.gainsDiminishingDefense) {
    await requestActorUpdate(target, {
      "system.diminishingDefense": target.system.diminishingDefense + target.system.diminishing.defense.perAttack
    });
  }

  requestEdit(message, {
    type: "attack",
    attack: {
      ...attack,
      defense,
      defenseLabel: defence.label,
      // Carried through to the Wound Roll step, which is where Power Flare's own roll
      // happens - the Ki was already paid when the defence was declared.
      defenceWager,
      result: { strike, answer, hit, damageCategory, wound: null, applied: false }
    }
  });

  // Cross Counter strikes back the moment the clash is settled. It is offered rather
  // than fired so the defender still chooses when to take it, like any other
  // Out-of-Sequence Maneuver.
  if (defence.counterAttacks) {
    requestEdit(message, {
      type: "offer",
      offer: {
        actorUuid: target.uuid,
        actorName: target.name,
        maneuverId: "basic-attack",
        maneuverName: "Basic Attack",
        targetUuid: attack.attackerUuid,
        reason: "Cross Counter"
      }
    });
  }
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
async function attackerStage(message, attack, attacker) {
  const triggers = relevantTriggers(attacker, message, "response");
  if (!await prepareRoll(attacker, triggers, "Before the Strike Roll")) return;
  return readyAttacker(message);
}

async function woundStage(message, attack, attacker) {
  const triggers = relevantTriggers(attacker, message, "hit");
  if (!await prepareRoll(attacker, triggers, "On hitting")) return;
  return rollAttackWound(message, attack);
}

/**
 * Roll the Wound and work out what gets through. Kept apart from the Strike so the
 * table sees whether the attack landed before any damage is rolled - and so a hit can
 * be argued over before it becomes a number.
 */
async function rollAttackWound(message, attack) {
  const attacker = fromUuidSync(attack.attackerUuid);
  const target = fromUuidSync(attack.targetUuid);
  if (!attacker || !target) {
    ui.notifications.warn("One of the actors in this attack no longer exists.");
    return;
  }

  const defence = DEFENCES[attack.defense];
  const { damageCategory } = attack.result;

  // Wagered Ki is added to the Wound Roll - already paid for when the attack was
  // declared, which is what took it out of Capacity.
  const wound = await rollSide(attacker, [
    { label: "Wound", value: attacker.system.combat.wound[attack.foundation] },
    { label: "Ki Wager", value: attack.kiWager ?? 0 },
    ...thresholdPenalty(attacker)
  ], {
    extraDice: attacker.system.dice.extra.formula,
    criticalDice: attacker.system.dice.critical.formula,
    combatRoll: true
  });

  // Power Flare answers the Wound Roll rather than the Strike Roll, immediately after
  // it - so it is rolled here, not left for another round trip.
  const counterWound = defence.answersWound
    ? await rollSide(target, [
        { label: "Might", value: target.system.might },
        { label: "Ki Wager", value: attack.defenceWager ?? 0 }
      ], {
        extraDice: target.system.dice.extra.formula,
        criticalDice: target.system.dice.critical.formula,
        combatRoll: true
      })
    : null;

  // A Talent that raises the Soak Value for defending does so "before any
  // calculations", so it lands on the base value - ahead of the Damage Category and
  // ahead of whatever the defence itself does to it.
  const defended = attack.defense !== "dodge";
  const soakBonus = defended
    ? talentEffects(target, "soakWhenDefending")
        .reduce((total, effect) => total + (effect.perTier * target.system.tierOfPower), 0)
    : 0;

  // Only what the Damage Category leaves of the Soak Value counts, and the defence
  // adjusts what survives that.
  const base = target.system.soakValue + soakBonus;
  const counted = Math.floor(base * DAMAGE_CATEGORIES[damageCategory].soakMultiplier);
  const soak = defence.soak(counted);
  const effectiveWound = defence.wound(wound.total);

  const negated = counterWound && (counterWound.total > wound.total);
  const damage = negated ? 0 : Math.max(0, effectiveWound - soak);

  requestEdit(message, {
    type: "attack",
    // Damage is worked out here but not dealt: applying it is a separate, deliberate
    // step, so the table can rule on it before anyone loses Life.
    attack: {
      ...attack,
      result: { ...attack.result, wound, counterWound, effectiveWound, soak, damage }
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
  return penalty ? [{ label: "Thresholds", value: -penalty }] : [];
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
    answer: (actor, options) => rollSide(actor, dodgeBonus(actor), options),
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
    answer: (actor, options) => rollSide(actor, [
      { label: "Strike", value: actor.system.combat.strike },
      ...thresholdPenalty(actor)
    ], options),
    soak: (soak) => soak,
    wound: (total) => total
  },

  directHit: {
    label: "Direct Hit",
    answer: () => null,
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
    answer: (actor, options) => rollSide(actor, dodgeBonus(actor, { halved: true }), options),
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

/** Take the damage off the target, once and once only. */
async function applyAttackDamage(message, target, attack) {
  const { damage } = attack.result;
  await target.update({ "system.life.value": Math.max(0, target.system.life.value - damage) });
  requestEdit(message, {
    type: "attack",
    attack: { ...attack, result: { ...attack.result, applied: true } }
  });
}

/**
 * Take a Surge: either a Healing Surge or a Ki Surge.
 *
 * A Surge is not the Surge Maneuver - the Maneuver is one way to reach one, and other
 * effects will reach the same two Surges by other routes, so this is kept apart from
 * whatever triggered it.
 */
export async function takeSurge(actor, { source = "Surge" } = {}) {
  const kind = await foundry.applications.api.DialogV2.wait({
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

    // A Talent can add dice of its own, written as "1d10(T)" - that many of that die
    // per Tier of Power, alongside the Surge's own.
    const extra = talentEffects(actor, "healingSurgeDice")
      .map(effect => {
        const [count, faces] = effect.dicePerTier.split("d");
        return `${Number(count) * actor.system.tierOfPower}d${faces}`;
      });

    const formula = [`${dice}d10`, ...extra, "@surgency"].join(" + ");
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
    const cost = defendOptionCost(key, target);
    // Power Flare makes a Wound Roll of its own, so it is the one option that can
    // carry a wager. The field sits with it rather than under the whole dialog.
    const wager = option.allowsKiWager
      ? `<span class="dbu-defend-wager">
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
      if (!wagerField) return;
      for (const radio of dialog.element.querySelectorAll('input[name="defence"]')) {
        radio.addEventListener("change", () => {
          const option = DEFEND_OPTIONS[dialog.element.querySelector('input[name="defence"]:checked')?.value];
          wagerField.disabled = !option?.allowsKiWager;
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
          return { defence, kiWager };
        }
      },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });

  if (!chosen || (typeof chosen !== "object")) return;

  const defend = getManeuver("defend");
  const cost = defendOptionCost(chosen.defence, target) + chosen.kiWager;
  if (defend && !await spendManeuverCost(target, defend, cost)) return;

  return chooseDefence(message, target, chosen.defence, chosen.kiWager);
}

/**
 * Everyone the attack is aimed at.
 *
 * Read as a list even though an attack currently names one target, so an area attack
 * has somewhere to put the rest without the card being rebuilt around it.
 */
function attackTargets(attack) {
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
function targetRow(attack, target, result) {
  const name = Handlebars.escapeExpression(target.name);

  if (!result) {
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
  const label = attack.defenseLabel ?? "Dodge";
  if (result.answer) return attackSide(label, target.name, result.answer);

  return `
    <div class="dbu-clash-side">
      <span class="dbu-clash-name">${name}<em> ${Handlebars.escapeExpression(label)}</em></span>
      <span class="dbu-clash-outcome">no roll</span>
    </div>`;
}

/** A settled total, with the dice and bonuses behind it on hover. */
function rolledTotal(side) {
  return `<span class="dbu-clash-total" data-tooltip="${Handlebars.escapeExpression(side.breakdown ?? "")}">${side.total}</span>`;
}

/** One rolled side of the attack. */
function attackSide(label, name, side) {
  const total = side ? rolledTotal(side) : `<span class="dbu-clash-waiting">waiting</span>`;
  const outcome = side?.outcome ? `<span class="dbu-clash-outcome dbu-${side.outcome}">${side.outcome}</span>` : "";
  return `
    <div class="dbu-clash-side">
      <span class="dbu-clash-name">${Handlebars.escapeExpression(name)}<em> ${label}</em></span>
      ${total}${outcome}
    </div>`;
}

/** What the attack did, once both sides are in. */
function attackOutcome(attack) {
  const { hit, wound, counterWound, soak, damage } = attack.result;
  if (!hit) return "Missed";
  if (!wound) return "Hit - awaiting the Wound Roll";

  if (counterWound && (counterWound.total > wound.total)) {
    return "Power Flare beats the Wound Roll: no damage";
  }

  const { effectiveWound, damageCategory } = attack.result;
  // Say when Guard pulled the Category down, since that is why the Soak counts here.
  const stepped = (damageCategory !== attack.damageCategory)
    ? ` (${DAMAGE_CATEGORIES[damageCategory].label})`
    : "";
  // Say so when the defence changed the Wound, rather than quoting a number that no
  // longer matches the arithmetic.
  const reduced = (effectiveWound !== wound.total) ? " halved" : "";
  const detail = `Wound ${effectiveWound}${reduced} - Soak ${soak}${stepped}`;
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
          attack.kiWager ? ` &middot; ${attack.kiWager} KP wagered` : ""}</span>
    </div>
    ${result
      ? attackSide("Strike", attack.attackerName, result.strike)
      : attackerRow(attack)}
    ${attackTargets(attack).map(target => targetRow(attack, target, result)).join("")}
    ${result?.wound ? attackSide("Wound", attack.attackerName, result.wound) : ""}
    ${result?.counterWound
      ? attackSide(attack.defenceWager ? `Power Flare +${attack.defenceWager} KP` : "Power Flare",
                   attack.targetName, result.counterWound)
      : ""}
    <div class="dbu-clash-result">${result ? attackOutcome(attack) : awaitingWhom(attack)}</div>`;
  container.append(card);

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

  const target = fromUuidSync(attack.targetUuid);

  // The target's half of the same moment. It has to come before the Wound Roll, since
  // that is what these effects are there to change. Only drawn when they have some -
  // an empty dialog is worse than no button.
  if (result?.hit && !result.wound && target?.isOwner) {
    const onHit = relevantTriggers(target, message, "hit");
    if (onHit.length) {
      const apply = document.createElement("button");
      apply.type = "button";
      apply.className = "dbu-clash-button";
      apply.textContent = "Apply effects";
      apply.dataset.tooltip = "Trigger effects that answer being hit";
      apply.addEventListener("click", () => prepareRoll(target, onHit, "On being hit"));
      container.append(apply);
    }
  }

  // The attacker rolls their own Wound, so that step belongs to them.
  if (result?.hit && !result.wound) {
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

  if (!target?.isOwner) return;

  // Answering an attack - by dodging or with a Counter Maneuver - is done from
  // Respond, along with everything else that answers a Maneuver.
  if (!result) return;

  // A miss ends it, and a Wound not yet rolled has nothing to apply.
  if (!result.hit || !result.wound) return;

  if (result.applied) {
    const note = document.createElement("div");
    note.className = "dbu-settled-note";
    note.textContent = `${result.damage} damage applied`;
    container.append(note);
    return;
  }

  // A miss, or a Wound the Soak Value absorbed entirely: nothing to apply.
  if (result.damage <= 0) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "dbu-clash-button";
  button.textContent = `Apply ${result.damage} damage`;
  button.addEventListener("click", () => applyAttackDamage(message, target, attack));
  container.append(button);
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
  const parts = `${baseRoll?.formula ?? "check"} = <strong>${baseTotal}</strong>`
    + ` &nbsp;+&nbsp; crit ${critRoll.formula} = <strong>${critRoll.total}</strong>`;

  await ChatMessage.create({
    speaker: message.speaker,
    flavor: message.flavor,
    // Only the new die is attached, so the original dice are not re-animated.
    rolls: [critRoll],
    content: checkCard({ parts, total: baseTotal + critRoll.total, outcome: "critical" })
  });

  // Author or GM only; for anyone else the button just stays disabled locally.
  if (message.isAuthor || game.user.isGM) await message.delete();
}
