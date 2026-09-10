/**
 * Karmic Effects.
 *
 * Karma is not a Resource, despite looking like one: a Resource is lost when a Combat
 * Encounter ends, and Karma is carried through a campaign. It moves by roleplay, which
 * is why the counter on the sheet is a pair of buttons and not something derived.
 *
 * What the system *can* enforce is the spending. Choosing a Karmic Effect pays for it -
 * the cost is part of the effect rather than a step someone has to remember - and only
 * one may be applied at a time, so once one is taken the rest are offered greyed out
 * with the reason rather than silently missing.
 */

import { traitsOfKind } from "./effects/traits.mjs";
import DBUCharacterData from "./data/actor-character.mjs";

/**
 * Where a Karmic Effect applied this exchange is recorded, matching the flag chat.mjs
 * writes through the GM relay. Read here, written there: the person spending the Karma
 * usually does not own the message they are spending it on.
 */
const APPLIED = "karmicApplied";

/** Every Karmic Effect the system knows, cheapest first. */
export function allKarmicEffects() {
  return traitsOfKind("karma")
    .map(trait => ({
      key: trait.id,
      name: trait.name,
      description: trait.description ?? "",
      text: trait.text ?? "",
      // Dynamic has no fixed price: the ARC sets it when it is taken.
      cost: (trait.cost === "dynamic") ? null : (Number(trait.cost) || 1),
      script: trait.script ?? "",
      // Some of these have no mechanical body by nature rather than by omission:
      // Dynamic is whatever the ARC agrees to, and Karmic Technique buys the right to
      // do something on the sheet. Those are marked in the file, and spending the
      // Karma Points and saying so is the whole of what the system should do.
      manual: trait.manual === true,
      // Otherwise, an effect starts with a bracketed header - so that is what says
      // whether one has actually been written.
      written: (trait.manual === true) || /^\s*\[/m.test(trait.script ?? ""),
      // "after" means it answers clash-resolved: it is taken once the roll is known,
      // and belongs on the settled card rather than in the Respond dialog.
      when: /\bclash-resolved\b/.test(trait.script ?? "") ? "after" : "before"
    }))
    .sort((a, b) => (a.cost ?? 99) - (b.cost ?? 99) || a.name.localeCompare(b.name));
}

/**
 * What this character could take right now, and why they could not.
 *
 * Everything is listed either way. An option that is simply absent reads as a bug,
 * where a greyed one with a reason reads as a rule.
 */
export function karmicOptionsFor(actor, message = null) {
  const karma = actor.system.karma ?? 0;
  const already = message?.getFlag("dbu-ttrpg", APPLIED)?.[actor.id] ?? null;

  return allKarmicEffects().map(effect => {
    const cost = effect.cost;
    let blocked = null;

    if (already && (already !== effect.key)) blocked = "one Karmic Effect at a time";
    else if (already === effect.key) blocked = "already applied";
    else if (!effect.written) blocked = "not written yet";
    else if ((cost !== null) && (karma < cost)) blocked = `needs ${cost} Karma`;
    else if ((cost === null) && (karma < 1)) blocked = "needs at least 1 Karma";

    // A manual effect says so, because "1 Karma - settled at the table" is a different
    // promise from "1 Karma" and the player should know which they are buying.
    const price = (cost === null) ? "variable" : `${cost} Karma`;

    return {
      ...effect,
      costLabel: effect.manual ? `${price} · settled at the table` : price,
      blocked,
      available: !blocked
    };
  });
}

/**
 * Take a Karmic Effect: settle what it costs, and pay it.
 *
 * Dynamic asks how much, since its price is set at the table when it is taken. Asking
 * first and paying after means the seven all behave the same way - choosing one spends.
 *
 * @returns {Promise<number|null>} What was spent, or null if nothing was.
 */
export async function spendKarma(actor, effect) {
  let cost = effect.cost;

  if (cost === null) {
    const answer = await foundry.applications.api.DialogV2.wait({
      classes: ["dbu-dialog"],
      window: { title: effect.name },
      content: `<p>How many Karma Points does this cost?</p>
        <input type="number" name="cost" value="1" min="1"
               max="${actor.system.karma ?? 0}" step="1" autofocus/>`,
      buttons: [
        {
          action: "confirm",
          label: "Spend",
          callback: (event, button, dialog) =>
            Number(dialog.element.querySelector('input[name="cost"]')?.value) || 0
        },
        { action: "cancel", label: "Cancel" }
      ],
      rejectClose: false
    });
    if (!answer || (answer <= 0)) return null;
    cost = answer;
  }

  const karma = actor.system.karma ?? 0;
  if (karma < cost) {
    ui.notifications.warn(`${actor.name} does not have ${cost} Karma Points.`);
    return null;
  }

  await actor.update({ "system.karma": Math.max(0, karma - cost) });
  return cost;
}

/** The greatest a character can hold, so the sheet and the schema agree. */
export const KARMA_MAX = DBUCharacterData.KARMA_MAX;
