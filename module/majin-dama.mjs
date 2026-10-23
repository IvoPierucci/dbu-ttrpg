/**
 * Neko Majin-Dama's Majin-Dama: "a wondrous ball stored in your body that grants you special abilities".
 *
 * A Special Accessory (traits/gear/basic/majin-dama.dbu), Integrated - its effects while Active, as any Integrated
 * Accessory's (integrated.mjs). What the Trait does with it:
 *
 *   (2) made Integrated as the Trait is added (racial.mjs `grantsGear`); taken from a Defeated or Sleeping owner with the
 *       Snatch Maneuver (use-maneuver.mjs askSnatch, chat.mjs settlePickpocket) - "A stolen Majin-Dama stops being
 *       Integrated";
 *   (3) Integrated again for 1 Action, (4) expelled as an Instant for 1 Action - their own Maneuvers;
 *   (5) none Integrated: a new one for 2 Karma Points, with the ARC's permission (the Gear tab's button);
 *   (6), (7) "x ... is equal to your number of Integrated Majin-Dama (even if they are Inactive)" - `majinDama.integrated`
 *       on the character, read by the Trait's script and by its reroll (chat.mjs).
 */

import { getTrait } from "./effects/traits.mjs";

/** The file it is made from. */
export const MAJIN_DAMA = "majin-dama";

/** The Trait's two Maneuvers, by id. */
export const INTEGRATE_DAMA = "neko-majin-dama-third-effect";
export const EXPEL_DAMA = "neko-majin-dama-fourth-effect";

/** The Karma Points a new one costs - (5). */
export const RENEW_KARMA = 2;

/** Whether an Item is a Majin-Dama. */
export function isMajinDama(item) {
  return (item?.type === "gear") && (item.system?.gearId === MAJIN_DAMA);
}

/** A character's Integrated Majin-Dama, Active or not. */
export function integratedDama(items) {
  return Array.from(items ?? []).filter(item => isMajinDama(item) && (item.system?.integrated === true));
}

/** A character's Majin-Dama not Integrated - one stolen, one expelled. */
function looseDama(items) {
  return Array.from(items ?? []).filter(item => isMajinDama(item) && (item.system?.integrated !== true));
}

/** Whether there is room for one more Active Integrated Accessory. */
async function activeRoom(actor, except = null) {
  const { activeIntegrated, INTEGRATED_ACTIVE } = await import("./integrated.mjs");
  return activeIntegrated(actor.items.contents.filter(item => item.id !== except), "accessory").length
    < INTEGRATED_ACTIVE.accessory;
}

/** A new Majin-Dama's Item: Integrated, Active where it fits (the user's, for Integrated Items). */
export async function damaItemData(actor, extraFlags = {}) {
  const definition = getTrait(MAJIN_DAMA);
  if (!definition) return null;
  const { gearItemFrom } = await import("./gear.mjs");
  const data = gearItemFrom(definition, actor);
  data.system.integrated = true;
  data.system.equipped = await activeRoom(actor);
  data.flags = { ...(data.flags ?? {}), "dbu-ttrpg": { ...(data.flags?.["dbu-ttrpg"] ?? {}), ...extraFlags } };
  return data;
}

/**
 * Why the Trait's (3) or (4) cannot be used now, or null: nothing to Integrate or to expel; (4)'s Action not left.
 */
export function whyNotMajinDama(actor, maneuver) {
  if (maneuver?.id === INTEGRATE_DAMA) {
    return looseDama(actor?.items).length ? null : `${actor.name} has no Majin-Dama to Integrate.`;
  }
  if (maneuver?.id !== EXPEL_DAMA) return null;
  if (!integratedDama(actor?.items).length) return `${actor.name} has no Integrated Majin-Dama.`;
  if (!game.combat?.started) return null;
  const left = expelKind(actor);
  return (left.left > 0) ? null : `${actor.name} has no ${left.kind} Action left to expel it with.`;
}

/** The Action (4) is paid with: a Standard one on their turn, a Counter one off it. */
function expelKind(actor) {
  const combat = game.combat;
  const theirs = Boolean(combat?.started) && (combat.combatant?.actor?.uuid === actor.uuid);
  const kind = theirs ? "standard" : "counter";
  const available = Number(actor.system.actions?.[kind]) || 0;
  const spent = Number(actor.system.actionsSpent?.[kind]) || 0;
  return { kind, left: Math.max(0, available - spent) };
}

/** One of several asked, or the only one; null if none is chosen. */
async function pickDama(actor, title, items) {
  if (items.length <= 1) return items[0] ?? null;
  const { askPlayerChoice } = await import("./chat.mjs");
  const id = await askPlayerChoice(actor, title, items.map(item => ({ value: item.id, label: item.name })));
  return items.find(item => item.id === id) ?? null;
}

/**
 * (3): "You can spend 1 Action to Integrate a Majin-Dama you possess." Which, where several; Active where it fits. The
 * Maneuver's card says the rest.
 */
export async function integrateMajinDama(actor) {
  const { UNSPENT } = await import("./effects/moments-runtime.mjs");
  const item = await pickDama(actor, `${actor.name}: Integrate a Majin-Dama`, looseDama(actor.items));
  if (!item) return UNSPENT;
  await item.update({ "system.integrated": true, "system.equipped": await activeRoom(actor, item.id) });
  return true;
}

/**
 * (4): "As an Instant Maneuver, you can spend 1 Action to expel an Integrated Majin-Dama from your body. When you do, it
 * stops being Integrated and is dropped or Equipped (your choice)." Equipped only where an Accessory can be put on;
 * dropped, it stays on the sheet unworn - where it lies, the map's.
 */
export async function expelMajinDama(actor) {
  const { UNSPENT } = await import("./effects/moments-runtime.mjs");
  const item = await pickDama(actor, `${actor.name}: expel a Majin-Dama`, integratedDama(actor.items));
  if (!item) return UNSPENT;
  // As any Accessory put on: two at most, besides the Integrated, and never two of the same.
  const { wornAccessories, ACCESSORIES_WORN } = await import("./gear.mjs");
  const worn = wornAccessories(actor.items.contents.filter(other => other.id !== item.id));
  const wearable = !worn.some(isMajinDama) && (worn.filter(other => other.system?.integrated !== true).length < ACCESSORIES_WORN);
  const { askPlayerChoice } = await import("./chat.mjs");
  const { spendActions } = await import("./combat.mjs");
  const choice = wearable
    ? await askPlayerChoice(actor, `${actor.name}: ${item.name}`, [{ value: "equip", label: "Equipped" },
      { value: "drop", label: "Dropped" }])
    : "drop";
  if (!choice) return UNSPENT;
  if (!await spendActions(actor, 1, expelKind(actor).kind)) return UNSPENT;
  await item.update({ "system.integrated": false, "system.equipped": choice === "equip" });
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p>${Handlebars.escapeExpression(`${actor.name} expels ${item.name}: ${
      (choice === "equip") ? "Equipped" : "dropped"}.`)}</p>` });
  return true;
}

/**
 * (5): "While you are suffering from these effects, you may, with ARC permission, spend 2 Karma Points to create a new
 * Majin-Dama and Integrate it." The ARC's permission is the table's; the button is there only while none is Integrated.
 */
export function renewOpen(actor) {
  return (actor?.system?.effects?.slots?.["nekoDama.renew"] === true) && !integratedDama(actor.items).length;
}

export async function renewMajinDama(actor) {
  if (!renewOpen(actor)) return null;
  const karma = Number(actor.system.karma) || 0;
  if (karma < RENEW_KARMA) {
    ui.notifications.warn(`${actor.name} needs ${RENEW_KARMA} Karma Points.`);
    return null;
  }
  const ok = await foundry.applications.api.DialogV2.confirm({
    classes: ["dbu-dialog"], window: { title: `${actor.name} - a new Majin-Dama` },
    content: `<p>With the ARC's permission: spend ${RENEW_KARMA} Karma Points to create a new Majin-Dama and Integrate it?</p>`,
    rejectClose: false
  });
  if (!ok) return null;
  const data = await damaItemData(actor);
  if (!data) return null;
  await actor.update({ "system.karma": karma - RENEW_KARMA });
  const [made] = await actor.createEmbeddedDocuments("Item", [data]);
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p>${Handlebars.escapeExpression(`${actor.name} spends ${RENEW_KARMA} Karma Points: a new Majin-Dama, Integrated.`)}</p>` });
  return made;
}

/**
 * (2): "Another Character may take an Integrated Majin-Dama from you using the Snatch Special Maneuver if you are Defeated
 * or Sleeping." The ones Snatch may name on them, or none.
 */
export function snatchableDama(target) {
  const defeated = Boolean(target?.system?.defeated);
  const sleeping = (Number(target?.system?.conditions?.sleeping) || 0) > 0;
  if (!defeated && !sleeping) return [];
  // Cat Burglar (2): "Your Majin-Dama cannot be stolen unless you are Defeated."
  if (!defeated && (target?.system?.effects?.slots?.["catBurglar.dama"] === true)) return [];
  return integratedDama(target.items).map(item => ({ item, defeated, sleeping }));
}

/** "A stolen Majin-Dama stops being Integrated": the copy the taker gets, unworn and no longer anybody's grant. */
export function stolenDamaData(item) {
  const data = item.toObject();
  delete data._id;
  data.system.integrated = false;
  data.system.equipped = false;
  if (data.flags?.["dbu-ttrpg"]) delete data.flags["dbu-ttrpg"].grantedBy;
  return data;
}
