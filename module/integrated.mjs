/**
 * Integrated Items.
 *
 * "Items that are Integrated become part of a Character, and as such, ignore any initial Penalties they would normally
 * incur" - the Apparel Penalty and the Weapon Penalty (gear.mjs) - "When an Item of the Weapon, Accessory, or Apparel
 * Item Type is Integrated, it becomes either an Active or Inactive Integrated Item. You ignore the presence of Inactive
 * Integrated Items, treating them as if they were not equipped and ignoring all of their effects."
 *
 * Active is `system.equipped`: everything that reads a worn or wielded Item reads an Active one, and nothing reads an
 * Inactive one. What is the Integrated Item's own:
 *
 *   - "A Character cannot have more than 1 Accessory or Apparel Item Active at once" - one of each (the user's) - "nor
 *     more than 2 Weapons Active at once"; and "Integrated Items do not count towards the normal limit of equipped Items
 *     of their Item Type" (gear.mjs wieldProblem, equipProblem: theirs left out, these held to their own).
 *   - Switched by the No Effort Maneuver's "Activate/Deactivate Integrated Items" in a Combat Encounter - from the sheet
 *     or from the Maneuver - and freely out of one.
 *   - "Active Integrated Weapons are considered 'Unsheathed', and Inactive Integrated Weapons are considered 'Sheathed'" -
 *     Active is wielded.
 *   - An attack made with one, Armed or Unarmed, asked at declaration (use-maneuver.mjs askWeapon).
 *
 * Integrated by an effect - Weapon Ports' Installed Weapons, the Armed Apparel Quality's Weapon - or by the table, on the
 * Item's sheet (the user's). Made Active where it fits (the user's).
 */

/** "No more than 1 Accessory or Apparel Item Active" - each - "no more than 2 Weapons Active". */
export const INTEGRATED_ACTIVE = Object.freeze({ weapon: 2, apparel: 1, accessory: 1 });

/** Whether an Item is Integrated. */
export function isIntegrated(item) {
  return (item?.type === "gear") && (item.system?.integrated === true);
}

/** Which of the three it is - weapon, apparel or accessory - or "". */
export function integratedKind(item) {
  if ((item?.type === "gear") && (item.system?.itemType === "accessory")) return "accessory";
  const kind = item?.system?.crafted?.kind ?? "";
  return ["weapon", "apparel"].includes(kind) ? kind : "";
}

/** The character's Active Integrated Items of one kind. */
export function activeIntegrated(items, kind) {
  return (items ?? []).filter(item => isIntegrated(item) && (integratedKind(item) === kind) && item.system?.equipped);
}

/**
 * The Apparel an Integrated Weapon is part of - the Armed Quality's: "While you wear this piece of Apparel, you possess an
 * Integrated Weapon" - or null.
 */
export function integratedWith(items, item) {
  const id = item?.system?.integratedWith ?? "";
  return id ? (items ?? []).find(other => other.id === id) ?? null : null;
}

/** Why an Integrated Item cannot be made Active, or "". The full kind is not one: one of them is swapped out for it. */
export function integratedProblem(items, item) {
  if (!isIntegrated(item)) return "";
  if (item.system?.crafted?.destroyed) return "Broken: repair it first.";
  const apparel = integratedWith(items, item);
  if (item.system?.integratedWith && !apparel?.system?.equipped) {
    return `Only while ${apparel?.name ?? "its Apparel"} is worn.`;
  }
  return "";
}

/** Whether there is room for one more Active of its kind. */
export function integratedRoom(items, item) {
  const kind = integratedKind(item);
  return activeIntegrated(items, kind).filter(other => other.id !== item.id).length < (INTEGRATED_ACTIVE[kind] ?? 0);
}

/** What making it Active writes: worn on no Layer - it is part of them - or wielded. */
function activeChanges(item, active) {
  return { _id: item.id, "system.equipped": active,
    ...((integratedKind(item) === "apparel") ? { "system.layer": "" } : {}) };
}

/**
 * Switch one Integrated Item: Inactive to Active - one of its kind made Inactive for it where they are all taken, asked -
 * or Active to Inactive. In a Combat Encounter, the No Effort Maneuver - during their turn, once a Round; `paid` where
 * the Maneuver itself is being used. What was done, said; or "" if nothing was.
 */
export async function switchIntegrated(actor, item, { paid = false } = {}) {
  if (!actor || !isIntegrated(item)) return "";
  const items = actor.items.contents;
  const activating = !item.system.equipped;
  let out = null;
  if (activating) {
    const problem = integratedProblem(items, item);
    if (problem) {
      ui.notifications.warn(`${item.name}: ${problem}`);
      return "";
    }
    if (!integratedRoom(items, item)) {
      const full = activeIntegrated(items, integratedKind(item)).filter(other => other.id !== item.id);
      const chosen = await foundry.applications.api.DialogV2.wait({
        classes: ["dbu-dialog"], window: { title: `${item.name} - Activate` },
        content: "<p>Which becomes Inactive for it?</p>",
        buttons: [...full.map(other => ({ action: other.id, label: other.name })), { action: "cancel", label: "Cancel" }],
        rejectClose: false
      });
      out = full.find(other => other.id === chosen) ?? null;
      if (!out) return "";
    }
  }
  if (!paid && !await noEffortFor(actor)) return "";
  await actor.updateEmbeddedDocuments("Item", [
    ...(out ? [activeChanges(out, false)] : []),
    activeChanges(item, activating)
  ]);
  return activating
    ? `${out ? `${out.name} Inactive, ` : ""}${item.name} Active`
    : `${item.name} Inactive`;
}

/**
 * The No Effort Maneuver's "Activate/Deactivate Integrated Items. You may make an Active Integrated Item you possess
 * become Inactive, and then choose one of your Inactive Integrated Items to become Active." Both asked; what was done,
 * said - or "" where nothing was, so nothing is paid.
 */
export async function swapIntegrated(actor) {
  const items = actor.items.contents.filter(isIntegrated);
  if (!items.length) {
    ui.notifications.warn(`${actor.name} has no Integrated Items.`);
    return "";
  }
  const escape = Handlebars.escapeExpression;
  const list = (name, entries, none) => `<label class="dbu-respond-option"><span class="dbu-respond-name">${none}</span>
    <select name="${name}"><option value="">-</option>${entries.map(item =>
      `<option value="${escape(item.id)}">${escape(item.name)}</option>`).join("")}</select></label>`;
  const all = actor.items.contents;
  const picked = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"], window: { title: `${actor.name} - Integrated Items` },
    content: list("off", items.filter(item => item.system.equipped), "Make Inactive")
      + list("on", items.filter(item => !item.system.equipped && !integratedProblem(all, item)), "Make Active"),
    buttons: [{ action: "swap", label: "Switch", default: true, callback: (event, button, dialog) => ({
      off: dialog.element.querySelector('[name="off"]')?.value ?? "", on: dialog.element.querySelector('[name="on"]')?.value ?? "" }) },
      { action: "cancel", label: "Cancel" }],
    rejectClose: false
  });
  if (!picked || (typeof picked !== "object") || (!picked.off && !picked.on)) return "";
  const off = actor.items.get(picked.off) ?? null;
  const on = actor.items.get(picked.on) ?? null;
  // Room for it once the one made Inactive is.
  if (on && !integratedRoom(all.filter(item => item.id !== off?.id), on)) {
    ui.notifications.warn(`${on.name}: no room - make one of its kind Inactive with it.`);
    return "";
  }
  await actor.updateEmbeddedDocuments("Item", [...(off ? [activeChanges(off, false)] : []), ...(on ? [activeChanges(on, true)] : [])]);
  return [off ? `${off.name} Inactive` : "", on ? `${on.name} Active` : ""].filter(Boolean).join(", ");
}

/** In a Combat Encounter, the No Effort Maneuver: their turn, a use left - taken, and said. Out of one, free. */
async function noEffortFor(actor) {
  if (!game.combat?.started) return true;
  const { getManeuver, maneuverUsesLeft, recordManeuverUse } = await import("./maneuvers.mjs");
  const { isTheirTurn } = await import("./combat.mjs");
  const noEffort = getManeuver("no-effort");
  if (!noEffort) return false;
  if (!isTheirTurn(actor)) {
    ui.notifications.warn(`${actor.name} can only switch Integrated Items during their turn.`);
    return false;
  }
  if (maneuverUsesLeft(actor, noEffort) <= 0) {
    ui.notifications.warn(`${actor.name} has used the ${noEffort.name} Maneuver this Round.`);
    return false;
  }
  await recordManeuverUse(actor, noEffort);
  return true;
}

/**
 * The Armed Apparel Quality's Weapon: "When this piece of Apparel is created, create a Weapon with a Craftsmanship Grade
 * equal to that of this piece of Apparel - that Weapon is the Integrated Weapon." Made when Armed is on a piece the
 * character has, gone with the Quality or the piece; possessed only while the piece is worn - taken off, Inactive; put
 * on, Active again where it fits. Its Category and Type the player's, on its sheet.
 */
export function registerIntegratedHooks() {
  const armed = item => (item?.type === "gear") && (item.system?.crafted?.kind === "apparel")
    && (item.system.crafted.qualities ?? []).some(entry => ((typeof entry === "string") ? entry : entry?.id) === "armed");
  const weaponOf = (actor, item) => actor.items.find(other => other.system?.integratedWith === item.id) ?? null;

  const settle = async (item, userId) => {
    const actor = item?.parent;
    if (!actor || (actor.type !== "character") || (userId !== game.user.id)) return;
    const weapon = weaponOf(actor, item);
    if (armed(item) && !weapon) {
      const { craftedItemFrom } = await import("./gear.mjs");
      const { getTrait } = await import("./effects/traits.mjs");
      const data = craftedItemFrom("weapon", actor, getTrait);
      data.name = `${item.name} (Armed)`;
      data.system.crafted.grade = Number(item.system.crafted.grade) || 1;
      data.system.integrated = true;
      data.system.integratedWith = item.id;
      data.system.equipped = Boolean(item.system.equipped)
        && (activeIntegrated(actor.items.contents, "weapon").length < INTEGRATED_ACTIVE.weapon);
      return actor.createEmbeddedDocuments("Item", [data]);
    }
    if (!armed(item) && weapon) return actor.deleteEmbeddedDocuments("Item", [weapon.id]);
    if (!weapon) return;
    // Its Grade with the piece's; possessed only while the piece is worn.
    const grade = Number(item.system.crafted.grade) || 1;
    const changes = {};
    if ((Number(weapon.system.crafted?.grade) || 1) !== grade) changes["system.crafted.grade"] = grade;
    if (!item.system.equipped && weapon.system.equipped) changes["system.equipped"] = false;
    if (item.system.equipped && !weapon.system.equipped
      && (activeIntegrated(actor.items.contents, "weapon").length < INTEGRATED_ACTIVE.weapon)) changes["system.equipped"] = true;
    if (Object.keys(changes).length) await weapon.update(changes);
  };
  Hooks.on("createItem", (item, options, userId) => settle(item, userId));
  Hooks.on("updateItem", (item, changes, options, userId) => settle(item, userId));
  Hooks.on("deleteItem", async (item, options, userId) => {
    const actor = item?.parent;
    if (!actor || (userId !== game.user.id) || (item.system?.crafted?.kind !== "apparel")) return;
    const weapon = weaponOf(actor, item);
    if (weapon) await actor.deleteEmbeddedDocuments("Item", [weapon.id]);
  });
}
