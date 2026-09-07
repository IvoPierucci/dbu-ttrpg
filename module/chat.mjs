import DBUCharacterData from "./data/actor-character.mjs";
import {
  DAMAGE_CATEGORIES,
  DEFEND_OPTIONS,
  MANEUVER_TYPES,
  PROFILES,
  reduceDamageCategory,
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
 * How far the GM has closed a Maneuver to responses: unset while both windows are
 * open, "before" once the Maneuver itself has resolved, and "after" once it is done
 * with entirely.
 *
 * The two are separate because an Instant may be played once the Maneuver has
 * finished - but only ever as an "after".
 */
const SETTLE_STAGE_FLAG = "settleStage";

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

/** Whether a response at this timing can still be played or taken back. */
function timingLocked(stage, timing) {
  if (!stage) return false;
  return (stage === "after") || (timing === "before");
}

/** Socket channel used to ask the GM to edit a message the responder cannot. */
const CHANNEL = `system.${SCOPE}`;

/**
 * Responses are recorded on the Standard Maneuver's own message, but a player does
 * not own another player's message and so cannot edit it. Those edits are relayed to
 * the GM's client, which applies them for everyone.
 */
export function registerManeuverSocket() {
  game.socket.on(CHANNEL, request => {
    // Exactly one client must act, or the same edit is applied several times.
    if (game.users.activeGM !== game.user) return;
    if (request?.type === "respond") applyResponse(request.messageId, request.response);
    else if (request?.type === "cancel") applyCancel(request.messageId, request.actorUuid);
    else if (request?.type === "clash") applyClash(request.messageId, request.clash);
    else if (request?.type === "attack") applyAttack(request.messageId, request.attack);
    else if (request?.type === "settle") applySettle(request.messageId, request.stage);
    else if (request?.type === "offer") applyOffer(request.messageId, request.offer);
    else if (request?.type === "offerTaken") applyOfferTaken(request.messageId, request.actorUuid);
  });
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

/** Close one of the two windows for responding to a Maneuver. */
async function applySettle(messageId, stage) {
  const message = game.messages.get(messageId);
  if (!message) return;
  await message.setFlag(SCOPE, SETTLE_STAGE_FLAG, stage);
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

/** Apply an edit directly when we may, and ask the GM to when we may not. */
function requestEdit(message, request) {
  if (message.isAuthor || game.user.isGM) {
    if (request.type === "respond") return applyResponse(message.id, request.response);
    if (request.type === "clash") return applyClash(message.id, request.clash);
    if (request.type === "attack") return applyAttack(message.id, request.attack);
    if (request.type === "settle") return applySettle(message.id, request.stage);
    if (request.type === "offer") return applyOffer(message.id, request.offer);
    if (request.type === "offerTaken") return applyOfferTaken(message.id, request.actorUuid);
    return applyCancel(message.id, request.actorUuid);
  }

  if (!game.users.activeGM) {
    ui.notifications.warn("A GM must be connected to respond to another player's maneuver.");
    return;
  }
  game.socket.emit(CHANNEL, { ...request, messageId: message.id });
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
 * Show which Actors have answered a Standard Maneuver, and offer the reader their
 * own turn to.
 *
 * A response belongs to the Actor that played it, not to the user who clicked, so
 * whoever has access to that Actor may take it back - which lets a GM undo any of
 * them. Anyone without access sees the entry, but no way to touch it.
 *
 * The list is rebuilt from the message's flags on every render rather than written
 * into its content, so a response played on one client appears on all of them and a
 * cancelled one disappears just as cleanly.
 */
function renderInstantResponses(message, html) {
  if (!message.getFlag(SCOPE, RESPONDABLE_FLAG)) return;

  const container = html.querySelector(".message-content") ?? html;
  const responses = message.getFlag(SCOPE, RESPONSES_FLAG) ?? [];

  const stage = message.getFlag(SCOPE, SETTLE_STAGE_FLAG) ?? null;

  if (responses.length) {
    const list = document.createElement("ul");
    list.className = "dbu-response-list";

    for (const response of responses) {
      const item = document.createElement("li");
      item.innerHTML = `
        <span class="dbu-response-actor">${Handlebars.escapeExpression(response.actorName)}</span>
        <span class="dbu-response-maneuver">${Handlebars.escapeExpression(response.maneuverName)}</span>
        <span class="dbu-response-timing">${response.timing}</span>`;

      // A response can only be taken back while its own timing is still open.
      const actor = fromUuidSync(response.actorUuid);
      if (actor?.isOwner && !timingLocked(stage, response.timing)) {
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

  if (stage === "after") {
    const note = document.createElement("div");
    note.className = "dbu-settled-note";
    note.textContent = "Responses settled";
    container.append(note);
    return;
  }

  // The GM decides when each window closes, so that a Maneuver does not sit open
  // waiting on a player who has nothing to play.
  if (game.user.isGM) {
    const settle = document.createElement("button");
    settle.type = "button";
    settle.className = "dbu-settle-button";

    if (stage === "before") {
      settle.textContent = "Settle After";
      settle.dataset.tooltip = "Close this maneuver to any further Instant Maneuvers";
      settle.addEventListener("click", () => requestEdit(message, { type: "settle", stage: "after" }));
    }
    else {
      settle.textContent = "Settle Before";
      settle.dataset.tooltip = "The maneuver resolves: from here, Instants can only be played after it";
      settle.addEventListener("click", () => requestEdit(message, { type: "settle", stage: "before" }));
    }
    container.append(settle);
  }

  if (!instantManeuvers().length) return;

  // One Instant per Actor per Maneuver, so a character that has already answered
  // gets no button - the way back is the cancel control on its own row.
  const answered = new Set(responses.map(response => response.actorUuid));
  const available = ownedCharacters().filter(actor => !answered.has(actor.uuid));
  if (!available.length) return;

  const row = document.createElement("div");
  row.className = "dbu-respond-row";

  const label = document.createElement("span");
  label.className = "dbu-respond-label";
  label.textContent = (stage === "before")
    ? "Respond with an Instant (after):"
    : "Respond with an Instant:";
  row.append(label);

  // One button per character the reader controls, rather than guessing which one
  // they meant: a GM answering for several NPCs should not have to select tokens
  // between responses.
  for (const actor of available) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dbu-respond-button";
    button.textContent = actor.name;
    button.addEventListener("click", () => respondWithInstant(message, actor, stage));
    row.append(button);
  }

  container.append(row);
}

function instantManeuvers() {
  return allManeuvers().filter(maneuver => maneuver.type === "instant");
}

/**
 * Ask which Instant Maneuver to use and when it resolves, then pay for it and record
 * it on the Standard Maneuver's message. Both questions are asked in one dialog: the
 * timing is not a separate decision from the choice.
 */
async function respondWithInstant(message, actor, stage) {
  const instants = instantManeuvers();

  const options = instants.map((maneuver, index) => `
    <label class="dbu-instant-option">
      <input type="radio" name="maneuver" value="${maneuver.id}" ${index === 0 ? "checked" : ""}/>
      <span class="dbu-instant-name">${Handlebars.escapeExpression(maneuver.name)}</span>
      <span class="dbu-instant-source">${Handlebars.escapeExpression(maneuver.source ?? "")}</span>
    </label>`).join("");

  /** Read the picked Maneuver out of the dialog, pairing it with the button's timing. */
  const pick = (timing) => (event, button, dialog) => {
    const chosen = dialog.element.querySelector('input[name="maneuver"]:checked');
    return chosen ? { maneuverId: chosen.value, timing } : null;
  };

  // Two things can rule out playing this before the Maneuver resolves: the GM having
  // already settled that window, and the character's own last Maneuver having been an
  // Instant. Playing after is always open, because by then the last Maneuver is the
  // Standard one this responds to - which is exactly why the same character may answer
  // after a Maneuver when it could not have answered before it.
  const justPlayedInstant = actor.system.lastManeuverWasInstant;
  const beforeAvailable = (stage !== "before") && !justPlayedInstant;

  const timings = [
    ...(beforeAvailable ? [{ action: "before", label: "Use Before", callback: pick("before") }] : []),
    { action: "after", label: "Use After", callback: pick("after") }
  ];

  const note = (!beforeAvailable && justPlayedInstant)
    ? `<p class="dbu-instant-note">${Handlebars.escapeExpression(actor.name)} just played an Instant Maneuver, so this one can only come after.</p>`
    : "";

  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: "Respond with an Instant Maneuver" },
    content: `<div class="dbu-instant-picker">${options}</div>${note}`,
    buttons: [...timings, { action: "cancel", label: "Cancel" }],
    rejectClose: false
  });

  // The Cancel button resolves to its own action string rather than a choice.
  if (!choice || (typeof choice !== "object")) return;

  const maneuver = getManeuver(choice.maneuverId);
  if (!maneuver) return;
  if (!await spendManeuverCost(actor, maneuver)) return;

  // Playing after the Maneuver leaves this Instant as the last one played. Playing
  // before it does not: the Standard Maneuver resolves afterwards and takes that
  // place, and it already cleared the flag when it was declared.
  if (choice.timing === "after") {
    await actor.update({ "system.lastManeuverWasInstant": true });
  }

  requestEdit(message, {
    type: "respond",
    response: {
      // A uuid rather than an id, so an unlinked token's Actor resolves too.
      actorUuid: actor.uuid,
      actorName: actor.name,
      maneuverId: maneuver.id,
      maneuverName: maneuver.name,
      timing: choice.timing
    }
  });
}

/** Take back a response, refunding what it cost to the Actor that played it. */
async function cancelInstant(message, actor, response) {
  const maneuver = getManeuver(response.maneuverId);
  if (maneuver) await refundManeuverCost(actor, maneuver);

  // Un-playing an Instant that was played after the Maneuver undoes what it left
  // behind. The checkbox on the sheet is there for whatever this cannot infer.
  if (response.timing === "after") {
    await actor.update({ "system.lastManeuverWasInstant": false });
  }
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
async function rollSide(actor, modifiers, { extraDice = "", criticalDice } = {}) {
  // A single netted number cannot be taken apart again, so what went into it is kept
  // as labelled parts and only summed for the roll itself.
  const parts = (typeof modifiers === "number") ? [{ label: "Bonus", value: modifiers }] : modifiers;
  const bonus = parts.reduce((sum, part) => sum + part.value, 0);

  const { roll, botch, critical } = await evaluateCheck(actor, bonus, extraDice);

  let total = roll.total;
  let outcome = "";

  // How it was reached is written down here, while the dice are still in hand.
  const dice = roll.dice.map(die => `${die.expression} ${die.total}`).join(" + ");
  const segments = [dice];

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
          // Both sides land here at once, or not at all.
          result: null
        }
      }
    }
  });
}

/** One side of the Clash card. */
function clashSide(name, side) {
  const total = side ? rolledTotal(side) : `<span class="dbu-clash-waiting">-</span>`;
  const outcome = side?.outcome ? `<span class="dbu-clash-outcome dbu-${side.outcome}">${side.outcome}</span>` : "";
  return `
    <div class="dbu-clash-side">
      <span class="dbu-clash-name">${Handlebars.escapeExpression(name)}</span>
      ${total}${outcome}
    </div>`;
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
    ${clashSide(clash.challengerName, result?.challenger)}
    ${clashSide(clash.defenderName, result?.defender)}
    <div class="dbu-clash-result">${result ? clashResult(result) : "Awaiting the defender"}</div>`;
  container.append(card);

  if (result) return;

  const defender = fromUuidSync(clash.defenderUuid);
  if (!defender?.isOwner) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "dbu-clash-button";
  button.textContent = `Roll ${clash.skillLabel}`;
  button.addEventListener("click", () => answerSkillClash(message, defender, clash));
  container.append(button);
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
 * Accept the Clash: roll both sides at once and publish them together, so neither
 * result is known before the other is decided.
 */
async function answerSkillClash(message, defender, clash) {
  const challenger = fromUuidSync(clash.challengerUuid);
  if (!challenger) {
    ui.notifications.warn("The challenging actor no longer exists.");
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
 * Until traits exist, the GM hands them out by hand - which is what a trait will do
 * automatically once there are traits to read.
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

  if (!game.user.isGM) return;

  const grant = document.createElement("button");
  grant.type = "button";
  grant.className = "dbu-grant-button";
  grant.textContent = "Grant Out-of-Sequence";
  grant.dataset.tooltip = "Let a character play a maneuver out of sequence in response to this";
  grant.addEventListener("click", () => grantOutOfSequence(message));
  container.append(grant);
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
  if (!await spendManeuverCost(actor, maneuver, maneuverKiCost(maneuver, declared))) return;

  requestEdit(message, { type: "offerTaken", actorUuid: actor.uuid });

  return declared
    ? postAttack(actor, target, maneuver, declared, { asOutOfSequence: true })
    : postManeuver(actor, maneuver, { asOutOfSequence: true });
}

/** GM control: choose who may play what, and say what allowed it. */
async function grantOutOfSequence(message) {
  const candidates = sceneCharacters();
  if (!candidates.length) {
    ui.notifications.warn("No characters on this scene to grant an Out-of-Sequence Maneuver to.");
    return;
  }

  // A Maneuver that spends no Action of its own has nothing to gain from being
  // played out of sequence, so only the Standard ones are offered.
  const usable = allManeuvers().filter(maneuver => maneuver.type === "standard");
  if (!usable.length) {
    ui.notifications.warn("No maneuvers can be played out of sequence.");
    return;
  }

  const actorOptions = candidates
    .map(actor => `<option value="${actor.uuid}">${Handlebars.escapeExpression(actor.name)}</option>`)
    .join("");
  const maneuverOptions = usable
    .map(maneuver => `<option value="${maneuver.id}">${Handlebars.escapeExpression(maneuver.name)}</option>`)
    .join("");

  const granted = await foundry.applications.api.DialogV2.wait({
    window: { title: "Grant an Out-of-Sequence Maneuver" },
    content: `
      <div class="dbu-grant-form">
        <label>Character<select name="actor">${actorOptions}</select></label>
        <label>Maneuver<select name="maneuver">${maneuverOptions}</select></label>
        <label>Reason<input type="text" name="reason" placeholder="e.g. won the Bluff clash"/></label>
      </div>`,
    buttons: [
      {
        action: "grant",
        label: "Grant",
        callback: (event, button, dialog) => {
          const read = (name) => dialog.element.querySelector(`[name="${name}"]`)?.value ?? "";
          return { actorUuid: read("actor"), maneuverId: read("maneuver"), reason: read("reason") };
        }
      },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });

  if (!granted || (typeof granted !== "object")) return;

  const actor = fromUuidSync(granted.actorUuid);
  const maneuver = getManeuver(granted.maneuverId);
  if (!actor || !maneuver) return;

  requestEdit(message, {
    type: "offer",
    offer: {
      actorUuid: actor.uuid,
      actorName: actor.name,
      maneuverId: maneuver.id,
      maneuverName: maneuver.name,
      reason: granted.reason
    }
  });
}

/** Every character with a token on the current scene. */
function sceneCharacters() {
  const byUuid = new Map();
  for (const token of canvas.tokens?.placeables ?? []) {
    const actor = token.actor;
    if (actor?.type === "character") byUuid.set(actor.uuid, actor);
  }
  return [...byUuid.values()].sort((a, b) => a.name.localeCompare(b.name));
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
          kiWager,
          foundation,
          foundationLabel: DBUCharacterData.FOUNDATIONS[foundation].label,
          attackerUuid: actor.uuid,
          attackerName: actor.name,
          targetUuid: target.uuid,
          targetName: target.name,
          result: null
        }
      }
    }
  });
}

/**
 * Resolve the attack: Strike against Dodge, and on a hit a Wound roll reduced by the
 * target's Soak Value. Soak can absorb a Wound entirely, so a hit does not guarantee
 * damage.
 */
async function resolveAttack(message, target, attack, defense = "dodge", defenceWager = 0) {
  const attacker = fromUuidSync(attack.attackerUuid);
  if (!attacker) {
    ui.notifications.warn("The attacking actor no longer exists.");
    return;
  }

  // Tier of Power Extra Dice ride on every combat roll, each side using its own.
  const options = {
    attacker: {
      extraDice: attacker.system.dice.extra.formula,
      criticalDice: attacker.system.dice.critical.formula
    },
    target: {
      extraDice: target.system.dice.extra.formula,
      criticalDice: target.system.dice.critical.formula
    }
  };

  // Diminishing Offense blunts the Strike Roll of every Attacking Maneuver made once
  // the round's free attacks are spent.
  const strike = await rollSide(attacker, [
    { label: "Strike", value: attacker.system.combat.strike },
    { label: "Dim. Offense", value: -attacker.system.diminishing.offense.penalty }
  ], options.attacker);

  // What the defender answers the Strike with, and whether they answer at all.
  const defence = DEFENCES[defense];
  const answer = await defence.answer(target, options.target);

  // The defender wins ties, as everywhere else: the attacker has to beat them.
  const hit = answer ? (strike.total > answer.total) : true;

  // The Damage Category is settled here, since it is the defence that can change it,
  // but nothing is wounded yet: the Wound Roll is a step of its own.
  const damageCategory = defence.reducesDamageCategory
    ? reduceDamageCategory(attack.damageCategory)
    : attack.damageCategory;

  // Gained after the Attacking Maneuver, so it never touches the roll just made. The
  // Defend Maneuver spares you these entirely, whichever option it was used for.
  if (defence.gainsDiminishingDefense) {
    await target.update({
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
    { label: "Ki Wager", value: attack.kiWager ?? 0 }
  ], {
    extraDice: attacker.system.dice.extra.formula,
    criticalDice: attacker.system.dice.critical.formula
  });

  // Power Flare answers the Wound Roll rather than the Strike Roll, immediately after
  // it - so it is rolled here, not left for another round trip.
  const counterWound = defence.answersWound
    ? await rollSide(target, [
        { label: "Might", value: target.system.might },
        { label: "Ki Wager", value: attack.defenceWager ?? 0 }
      ], {
        extraDice: target.system.dice.extra.formula,
        criticalDice: target.system.dice.critical.formula
      })
    : null;

  // Only what the Damage Category leaves of the Soak Value counts, and the defence
  // adjusts what survives that.
  const counted = Math.floor(target.system.soakValue * DAMAGE_CATEGORIES[damageCategory].soakMultiplier);
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
  return parts;
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
    // A Parry is not an Attacking Maneuver, so Diminishing Offense does not touch it.
    answer: (actor, options) => rollSide(actor, [
      { label: "Strike", value: actor.system.combat.strike }
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
    reducesDamageCategory: true,
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
 * Choose how to defend, pay for it, and resolve the attack that way.
 *
 * A list rather than a row of buttons: each option needs its own explanation, and one
 * of them needs a field of its own.
 */
async function defendAgainst(message, target, attack) {
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

  return resolveAttack(message, target, attack, chosen.defence, chosen.kiWager);
}

/** A settled total, with the dice and bonuses behind it on hover. */
function rolledTotal(side) {
  return `<span class="dbu-clash-total" data-tooltip="${Handlebars.escapeExpression(side.breakdown ?? "")}">${side.total}</span>`;
}

/** One rolled side of the attack. */
function attackSide(label, name, side) {
  const total = side ? rolledTotal(side) : `<span class="dbu-clash-waiting">-</span>`;
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
    ${attackSide("Strike", attack.attackerName, result?.strike)}
    ${result?.answer ? attackSide(attack.defenseLabel, attack.targetName, result.answer) : ""}
    ${result?.wound ? attackSide("Wound", attack.attackerName, result.wound) : ""}
    ${result?.counterWound
      ? attackSide(attack.defenceWager ? `Power Flare +${attack.defenceWager} KP` : "Power Flare",
                   attack.targetName, result.counterWound)
      : ""}
    <div class="dbu-clash-result">${result ? attackOutcome(attack) : "Awaiting the target"}</div>`;
  container.append(card);

  // The attacker rolls their own Wound, so that step belongs to them.
  if (result?.hit && !result.wound) {
    const attacker = fromUuidSync(attack.attackerUuid);
    if (!attacker?.isOwner) return;

    const roll = document.createElement("button");
    roll.type = "button";
    roll.className = "dbu-clash-button";
    roll.textContent = "Roll Wound";
    roll.addEventListener("click", () => rollAttackWound(message, attack));
    container.append(roll);
    return;
  }

  const target = fromUuidSync(attack.targetUuid);
  if (!target?.isOwner) return;

  if (!result) {
    // Dodging is free and needs no choosing, so it stays a single click; the Defend
    // Maneuver is the deliberate alternative, and costs a Counter Action to use.
    const row = document.createElement("div");
    row.className = "dbu-respond-row";

    const dodge = document.createElement("button");
    dodge.type = "button";
    dodge.textContent = "Roll Dodge";
    dodge.addEventListener("click", () => resolveAttack(message, target, attack));
    row.append(dodge);

    const defend = document.createElement("button");
    defend.type = "button";
    defend.textContent = "Defend";
    defend.dataset.tooltip = "Counter Maneuver: defend in some way other than dodging";
    defend.addEventListener("click", () => defendAgainst(message, target, attack));
    row.append(defend);

    container.append(row);
    return;
  }

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
