/**
 * What the Fusion Methods' Method Traits do that a script cannot say by itself (traits/other/fusion-method/): Metamoran Style (4)'s
 * Maneuver out of sequence, Bio-Fusion (1)'s growth, Merged Tuffle (1)'s Apparel forgone. Each asked as its Moment comes - the
 * Encounter's start, the turn's card - and backed out of, unspent.
 */

import DBUCharacterData from "./data/actor-character.mjs";

/** What a Moment's effect returns when it was backed out of: its use not spent. */
async function unspent() {
  return (await import("./effects/moments-runtime.mjs")).UNSPENT;
}

/**
 * Metamoran Style (4): "You may use a Maneuver with an Action Cost of 1 Action as an Out-of-Sequence Maneuver." Any of its Maneuvers
 * of 1 Action, picked.
 */
export async function oneActionOutOfSequence(actor) {
  if (!actor) return unspent();
  const { definitionOf, useManeuver } = await import("./use-maneuver.mjs");
  const offered = Array.from(actor.items ?? []).filter(item => item.type === "maneuver").map(definitionOf)
    .filter(entry => entry && ((Number(entry.actionCost) || 0) === 1) && !entry.actionCostOpen)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!offered.length) {
    ui.notifications.warn(`${actor.name} has no Maneuver of 1 Action.`);
    return unspent();
  }
  const escape = foundry.utils.escapeHTML;
  const picked = await foundry.applications.api.DialogV2.wait({ classes: ["dbu-dialog"],
    window: { title: `${actor.name} - Metamoran Style` },
    content: `<label class="dbu-respond-option" data-tooltip="Used as an Out-of-Sequence Maneuver"><span class="dbu-respond-name">Maneuver</span>
      <select name="maneuver">${offered.map(entry => `<option value="${escape(entry.itemId)}">${escape(entry.name)}</option>`).join("")}</select></label>`,
    buttons: [{ action: "use", label: "Use it", default: true, callback: (ev, button, dialog) => dialog.element.querySelector('[name="maneuver"]').value },
      { action: "cancel", label: "Cancel" }], rejectClose: false }).catch(() => null);
  const chosen = offered.find(entry => entry.itemId === picked);
  if (!chosen) return unspent();
  const used = await useManeuver(actor, chosen, { outOfSequence: true });
  return (used === false) ? unspent() : used;
}

/** Size Categories, smallest first. */
const SIZE_KEYS = Object.keys(DBUCharacterData.SIZES);

/** A Fusion's own base Size Category, as built. */
function baseSizeOf(actor) {
  return String(actor?._source?.system?.size ?? actor?.system?.size?.chosen ?? "medium");
}

/**
 * Bio-Fusion (1)'s growth: "1 Size Category larger than the largest base Size Category among your Fused Characters. If this Fusion has
 * 3+ Fused Characters ... may be 2 Size Categories larger instead" - how many it grows by from its own base, or 0. Never larger than
 * Colossal.
 */
export function bioFusionSteps(actor, extra = 1) {
  const fused = actor?.system?.fusion?.fused ?? [];
  if (!fused.length) return 0;
  const largest = Math.max(...fused.map(each => SIZE_KEYS.indexOf(each.size || "medium")));
  const target = Math.min(SIZE_KEYS.length - 1, largest + Math.max(1, Math.min(2, extra)));
  return Math.max(0, target - SIZE_KEYS.indexOf(baseSizeOf(actor)));
}

/** Bio-Fusion (1), as the Encounter begins: "You may increase your base Size Category" - asked, and by how much with 3+. */
export async function bioFusionGrow(actor) {
  if (!actor) return unspent();
  const three = (actor.system.fusion?.fused ?? []).length >= 3;
  const one = bioFusionSteps(actor, 1);
  const two = three ? bioFusionSteps(actor, 2) : one;
  if (!two) {
    ui.notifications.info(`${actor.name}: Bio-Fusion - already that large.`);
    return unspent();
  }
  const label = steps => `${SIZE_KEYS[Math.min(SIZE_KEYS.length - 1, SIZE_KEYS.indexOf(baseSizeOf(actor)) + steps)]} (+${steps})`;
  const options = [...new Set([one, two].filter(Boolean))].map(steps => ({ value: String(steps), label: `Grow to ${label(steps)}` }));
  const { askPlayerChoice } = await import("./chat.mjs");
  const picked = Number(await askPlayerChoice(actor, `${actor.name}: Bio-Fusion`, [...options, { value: "0", label: "Stay as it is" }])) || 0;
  if (!picked) return unspent();
  await actor.update({ "system.resources.biofusion.stacks": picked });
}

/**
 * Merged Tuffle (1), as the Encounter begins: "Instead of gaining the Fused Character's Apparel, you may choose to forgo it to increase
 * your Combat Rolls and Damage Reduction by 2(bT)." Asked; the Apparel taken from them taken off.
 */
export async function mergedTuffleForgo(actor) {
  if (!actor) return unspent();
  const { askPlayerChoice } = await import("./chat.mjs");
  if ((await askPlayerChoice(actor, `${actor.name}: Merged Tuffle`, [
    { value: "forgo", label: "Forgo the Fused Characters' Apparel: Combat Rolls and Damage Reduction +2(bT)" },
    { value: "keep", label: "Keep their Apparel" }])) !== "forgo") return unspent();
  const worn = Array.from(actor.items ?? []).filter(item => (item.type === "gear") && (item.system?.itemType === "apparel")
    && item.system?.equipped && item.flags?.["dbu-ttrpg"]?.fusedCopy);
  if (worn.length) await actor.updateEmbeddedDocuments("Item", worn.map(item => ({ _id: item.id, "system.equipped": false, "system.layer": "" })));
  const { setCondition } = await import("./conditions.mjs");
  await setCondition(actor, "merged-tuffle-mark", 1);
}
