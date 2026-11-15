/**
 * Turning a sheet into another kind - a Character into an Adversary, an Adversary into a Minion, and back (the user's: a button
 * on the Settings tab "manteniendo los traits, talentos, decisiones en la tabla de progression y básicamente todo lo que
 * comparta").
 *
 * The three kinds share one data model (DBUCharacterData), so everything carries over as it is: the same Actor, its id, its
 * Items, its Progression table, its tokens, its owners. Foundry changes a Document's type only with its system data written
 * whole - a ForcedReplacement - which here is the system data it already has. What one kind has and another has not stays in
 * it, unread (an Adversary's Category, a Minion's Master), so turning it back finds it where it was.
 *
 * Two things follow the kind, as they would for a sheet made that way: the Villainous Maneuvers, which "all Adversaries have
 * access to" and are given to one on its creation (dbu-ttrpg.mjs preCreateActor) - given on becoming one, taken off on
 * ceasing to be one; and the token's link - a Minion's token is a copy of its own, every other kind's is the sheet.
 */

import { CHARACTER_TYPES } from "./actor-types.mjs";

/** The kinds a sheet can be turned into, by name. */
export const SHEET_TYPES = Object.freeze({ character: "Character", adversary: "Adversary", minion: "Minion" });

const VILLAINOUS_SOURCE = "Villainous Maneuver";

/** A kind's name with its article: "a Character", "an Adversary". */
export function sheetTypeLabel(type) {
  const label = SHEET_TYPES[type] ?? String(type ?? "");
  return `${/^[AEIOU]/i.test(label) ? "an" : "a"} ${label}`;
}

/**
 * What turning `actor` into `type` writes: the update, the Items given and the Items taken off - or `{ refused }` saying why
 * not. `villainous` is the Villainous Maneuvers as Item data (use-maneuver.mjs coreManeuverItems' own). No Foundry call here.
 */
export function typeChangePlan(actor, type, villainous = []) {
  if (!CHARACTER_TYPES.includes(actor?.type) || !SHEET_TYPES[type]) return { refused: "That sheet cannot be turned into that." };
  if (actor.type === type) return { refused: `${actor.name} is already ${sheetTypeLabel(type)}.` };
  // A token not linked to its sheet is a copy of an Actor, not one: its kind is its Actor's.
  if (actor.isToken) return { refused: "This is a token's copy of an Actor. Open the Actor from the Actors list to change its type." };

  const system = foundry.utils.deepClone(actor.toObject().system);
  const update = { type, system: foundry.data.operators.ForcedReplacement.create(system) };
  // Into a Minion or out of one: the token's link as a sheet of that kind is made (preCreateActor). Between the other two, as it was.
  if ((type === "minion") !== (actor.type === "minion")) update.prototypeToken = { actorLink: type !== "minion" };

  const items = Array.from(actor.items ?? []).filter(item => item.type === "maneuver");
  const held = new Set(items.map(item => item.system?.maneuverId || item.name));
  const add = (type === "adversary")
    ? villainous.filter(entry => !held.has(entry.system?.maneuverId) && !held.has(entry.name))
    : [];
  const remove = (type === "adversary") ? [] : items.filter(item => item.system?.source === VILLAINOUS_SOURCE).map(item => item.id);
  return { update, add, remove };
}

/** Turn `actor` into `type`, as typeChangePlan says. Returns the refusal, or null once done. */
export async function changeActorType(actor, type) {
  const { coreManeuverItems } = await import("./use-maneuver.mjs");
  const villainous = coreManeuverItems({ adversary: true }).filter(entry => entry.system?.source === VILLAINOUS_SOURCE);
  const plan = typeChangePlan(actor, type, villainous);
  if (plan.refused) return plan.refused;
  await actor.update(plan.update);
  if (plan.remove.length) await actor.deleteEmbeddedDocuments("Item", plan.remove);
  if (plan.add.length) await actor.createEmbeddedDocuments("Item", plan.add);
  return null;
}
