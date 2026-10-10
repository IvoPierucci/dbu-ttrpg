/**
 * Natural Armor.
 *
 * "Some effects may grant a Character Natural Armor. Natural Armor is a special form of Integrated Armor that has the
 * following effects:
 *   - The Craftsmanship Grade is equal to the base Tier of Power of that Character (max. 5).
 *   - At the end of each Combat Encounter, your Natural Armor is fully repaired.
 *   - While you possess Natural Armor, you can only wear a single layer of Apparel. If you were wearing more than a single
 *     layer of Apparel upon gaining Natural Armor, all of your worn Apparel except for the lowest layer is destroyed.
 *   - Natural Armor naturally possesses no Qualities, but can gain them through effects.
 *   - Natural Armor does not count as equipped Apparel for any of your effects.
 *   - Effects that refer to Natural Armor will apply only while that Natural Armor is Active."
 *
 * An Integrated piece of Armor (integrated.mjs), marked `flags.dbu-ttrpg.naturalArmor`. Its Category's Damage Reduction
 * applies whatever is worn over it - and that piece's own Category besides (the user's) (gear.mjs categoryApplies); the
 * single layer is kept by putting Apparel on (gear.mjs equipPlan); what its owner's effects read of it is
 * `naturalArmor.apparelBonus`, nothing while it is Inactive (actor-character.mjs). Survivor's Plating is one.
 */

import { getTrait } from "./effects/traits.mjs";
import { isNaturalArmor } from "./gear.mjs";

/** Its entry, as the rulebook prints it - under its Category's on the piece's sheet. */
export const NATURAL_ARMOR_TEXT = `Natural Armor: Some effects may grant a Character Natural Armor. Natural Armor is a special form of Integrated Armor that has the following effects:

* The Craftsmanship Grade is equal to the base Tier of Power of that Character (max. 5).
* At the end of each Combat Encounter, your Natural Armor is fully repaired.
* While you possess Natural Armor, you can only wear a single layer of Apparel. If you were wearing more than a single layer of Apparel upon gaining Natural Armor, all of your worn Apparel except for the lowest layer is destroyed.
* Natural Armor naturally possesses no Qualities, but can gain them through effects.
* Natural Armor does not count as equipped Apparel for any of your effects.
* Effects that refer to Natural Armor will apply only while that Natural Armor is Active.`;

/** "The Craftsmanship Grade is equal to the base Tier of Power of that Character (max. 5)." */
export function naturalArmorGrade(actor) {
  return Math.max(1, Math.min(5, Number(actor?.system?.baseTierOfPower) || 1));
}

/**
 * Natural Armor gained - named, and given by `granter` (an Item, so it goes with it): the worn Apparel past the lowest
 * layer destroyed, and the piece made, Active where there is room for an Integrated Apparel.
 */
export async function grantNaturalArmor(actor, granter, name) {
  if (!actor) return null;
  const { APPAREL_LAYERS, composeEffects, craftedItemFrom } = await import("./gear.mjs");
  const { activeIntegrated, INTEGRATED_ACTIVE } = await import("./integrated.mjs");
  const items = actor.items.contents;
  // "All of your worn Apparel except for the lowest layer is destroyed."
  const order = Object.keys(APPAREL_LAYERS);
  const rank = item => { const at = order.indexOf(item.system?.layer ?? ""); return (at < 0) ? order.length : at; };
  const worn = items.filter(item => (item.type === "gear") && (item.system?.crafted?.kind === "apparel")
    && item.system?.equipped && !item.system?.integrated).sort((a, b) => rank(b) - rank(a));
  if (worn.length > 1) {
    await actor.updateEmbeddedDocuments("Item", worn.slice(1).map(item => ({ _id: item.id,
      "system.crafted.destroyed": true, "system.equipped": false, "system.layer": "" })));
    ui.notifications.info(`${name}: ${worn.slice(1).map(item => item.name).join(", ")} destroyed - a single layer of Apparel.`);
  }
  const data = craftedItemFrom("apparel", actor, getTrait);
  if (!data) return null;
  data.name = name;
  Object.assign(data.system.crafted, { category: "armor", grade: naturalArmorGrade(actor), qualities: [] });
  data.system.crafted.effects = composeEffects(data.system.crafted, "", { getTrait });
  data.system.integrated = true;
  data.system.equipped = activeIntegrated(items, "apparel").length < INTEGRATED_ACTIVE.apparel;
  data.flags = { "dbu-ttrpg": { grantedBy: granter?.id ?? "", naturalArmor: true } };
  const [made] = await actor.createEmbeddedDocuments("Item", [data]);
  return made ?? null;
}

/**
 * Natural Armor repaired - `amount` Break Value back, or all of it - and broken no more: Active again where there is
 * room. Survivor's 1 at a Healing Surge; the whole of it as a Combat Encounter ends.
 */
export async function repairNaturalArmor(actor, amount = Infinity) {
  const { activeIntegrated, INTEGRATED_ACTIVE } = await import("./integrated.mjs");
  const { craftedReading } = await import("./gear.mjs");
  for (const item of Array.from(actor?.items ?? []).filter(isNaturalArmor)) {
    const lost = Number(item.system.crafted?.breakLost) || 0;
    if (!lost && !item.system.crafted?.destroyed) continue;
    // Broken - "an item only breaks when its Break Value reaches 0" - it was taken off; whole again, put back on.
    const broken = craftedReading(item.system.crafted, { getTrait, difficulties: {} })?.breakLeft === 0;
    const changes = { "system.crafted.breakLost": Number.isFinite(amount) ? Math.max(0, lost - amount) : 0,
      "system.crafted.destroyed": false };
    if (broken && !item.system.equipped
      && (activeIntegrated(actor.items.contents, "apparel").length < INTEGRATED_ACTIVE.apparel)) changes["system.equipped"] = true;
    await item.update(changes);
  }
}

/** Natural Armor its owner can mend: some Break Value lost, or broken. */
export function naturalArmorMendable(actor) {
  return Array.from(actor?.items ?? []).some(item => isNaturalArmor(item)
    && (((Number(item.system.crafted?.breakLost) || 0) > 0) || item.system.crafted?.destroyed));
}

/** Its Grade kept at the base Tier of Power (max. 5) as that changes - by whoever changed it. */
export function registerNaturalArmorHooks() {
  Hooks.on("updateActor", async (actor, changes, options, userId) => {
    if ((actor.type !== "character") || (userId !== game.user.id)) return;
    const grade = naturalArmorGrade(actor);
    const off = Array.from(actor.items ?? []).filter(item => isNaturalArmor(item)
      && ((Number(item.system.crafted?.grade) || 1) !== grade));
    if (off.length) await actor.updateEmbeddedDocuments("Item", off.map(item => ({ _id: item.id, "system.crafted.grade": grade })));
  });
}
