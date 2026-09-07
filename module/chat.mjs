import DBUCharacterData from "./data/actor-character.mjs";

/** Flag scope for everything this system stores on a ChatMessage. */
const SCOPE = "dbu-ttrpg";

/** Present while a critical's extra die is still unclaimed. */
const PENDING_FLAG = "criticalPending";

export function registerChatHooks() {
  Hooks.on("renderChatMessageHTML", onRenderChatMessage);
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
  if (!message.getFlag(SCOPE, PENDING_FLAG)) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "dbu-crit-button";
  button.textContent = `Roll Critical Die (+1d${DBUCharacterData.CRITICAL_DIE_FACES})`;
  button.addEventListener("click", () => rollCriticalDie(message, button));

  (html.querySelector(".message-content") ?? html).append(button);
}

/**
 * Roll the extra die, then replace the original check with a single card showing the
 * combined total. Replacing rather than appending keeps one result in the log instead
 * of a small number the reader has to add up themselves.
 */
async function rollCriticalDie(message, button) {
  button.disabled = true;

  const baseRoll = message.rolls[0];
  const critRoll = new Roll(`1d${DBUCharacterData.CRITICAL_DIE_FACES}`);
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
