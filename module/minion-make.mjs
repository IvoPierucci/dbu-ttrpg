/**
 * Making a Minion (the rulebook's Minion Rules): an effect that says "create a Duplicate Minion", a Goop, a Glass Knight, a Yaki
 * makes the Actor - of the Minion type, its Master set, its token on a free Square beside its Master's and in the Combat
 * Encounter they are in. A Duplicate is a copy of its Master: "Duplicates possess the same Attribute Scores, Apparel, Accessories,
 * Weapons, Talents, Racial Traits, Signature Techniques, Unique Abilities, and Transformations as their Master (they must also
 * select all the same Option effects and anything chosen through a Passive effect)" - their Items with what was chosen on them,
 * kept by their ids so whatever names one still does (an Integrated Item's Apparel, the Triggered effects made Automatic, copied
 * too), and what the Progression tab chose. Any other Minion is made with its name alone, its sheet the GM's to fill: the Minion
 * Creation Rules, and the Custom Species Race, are the table's.
 *
 * Made on the GM's client - a player may not create an Actor - so a player's effect asks for it (chat.mjs requestMakeMinion).
 */

import DBUCharacterData from "./data/actor-character.mjs";
import { masterOf } from "./allies.mjs";

const SCOPE = "dbu-ttrpg";

/** What makes a character who they are, copied onto a Duplicate - nothing of how this Encounter has gone for them. */
export const DUPLICATED_FIELDS = Object.freeze([
  "attributes", "transformationBonuses", "racialSkillRanks", "racialAttributeChoices", "racialSavingThrow", "basicAttackProfiles", "trainingBonuses",
  "rollModifiers", "diceModifiers", "capacityModifiers", "actionModifiers", "tierOfPowerModifier", "criticalTarget",
  "skillSpecializations", "externalModifiers", "powerLevel", "race", "size", "subrace", "alignment", "progression",
  "characterPerks", "combatPins", "combatUnpins", "debug"
]);

/** The Apparel, Accessories and Weapons a Duplicate has of its Master's - "Duplicated Items". */
export function isDuplicatedGear(item) {
  if (item?.type !== "gear") return false;
  const system = item.system ?? {};
  return ["apparel", "weapon"].includes(system.crafted?.kind) || ["accessory", "weapon"].includes(system.itemType);
}

/** Whether a Master's Item is copied onto a Duplicate: every Trait, Talent and Maneuver, and their gear but where it has none. */
export function isDuplicatedItem(item, gear = true) {
  if (["talent", "racial", "maneuver"].includes(item?.type)) return true;
  return gear && isDuplicatedGear(item);
}

/** A base Size Category so many smaller - no smaller than the smallest. */
export function smallerSize(size, steps = 1) {
  const sizes = Object.keys(DBUCharacterData.SIZES);
  const at = sizes.indexOf(size);
  return sizes[Math.max(0, ((at < 0) ? sizes.indexOf(DBUCharacterData.DEFAULT_SIZE) : at) - Math.max(0, Number(steps) || 0))];
}

/**
 * The Actor data of a Minion of a Master. A Duplicate: their defining fields and Items (`gear` false for a Goop: "does not possess
 * the Apparel, Accessories, or Weapons of their creator"), its gear marked as Duplicated Items; its base Size Category `sizeSteps`
 * smaller. `kind` names what made it, for the effects about those Minions ("your Goops", "created through the first effect of
 * Brood Parent"); `made` the Round it was made in; `extra` more flags; `system` what else a Minion not a Duplicate starts with (Poko
 * Priest's Namekian Race).
 */
export function minionData(master, { name = "", duplicate = false, gear = true, sizeSteps = 0, kind = "", made = "", extra = {},
                                     system: own = {}, copy = null } = {}) {
  // Copy Clone's: "instead of a Duplicate Minion of yourself, it is a Duplicate Minion of that Character (you are still their Master)".
  const source = (copy ?? master).toObject();
  const ownership = foundry.utils.deepClone((copy ? master.toObject() : source).ownership ?? {});
  const system = { ...own, master: master.id, duplicate: Boolean(duplicate), specialMinion: false };
  if (duplicate) {
    for (const key of DUPLICATED_FIELDS) {
      if (key in (source.system ?? {})) system[key] = foundry.utils.deepClone(source.system[key]);
    }
    if (sizeSteps) system.size = smallerSize(system.size, sizeSteps);
  }
  // Minion Creation: "Minions created through Minion Creation have the same Power Level as their Master."
  else system.powerLevel = Number(source.system?.powerLevel) || 1;
  const items = duplicate ? (source.items ?? []).filter(item => isDuplicatedItem(item, gear)).map(item => {
    const copy = foundry.utils.deepClone(item);
    if (isDuplicatedGear(copy)) foundry.utils.setProperty(copy, `flags.${SCOPE}.duplicated`, true);
    return copy;
  }) : [];
  const called = name || (duplicate ? master.name : `${master.name}'s Minion`);
  return {
    name: called,
    type: "minion",
    ...(duplicate ? { img: source.img } : {}),
    ownership,
    prototypeToken: { ...(duplicate ? foundry.utils.deepClone(source.prototypeToken ?? {}) : {}), name: called, actorLink: true },
    system,
    items,
    flags: { [SCOPE]: { ...(duplicate ? chosenFlags(source) : {}), minionKind: kind, madeAt: made,
      // Copy Clone's: a Duplicate of another, at their Power Level - not grown with its Master's (dbu-ttrpg.mjs).
      ...(copy ? { copied: true } : {}), ...extra } }
  };
}

/** What a Duplicate's original chose of how their Triggered effects go - Automatic, or asked - by the Items' ids. */
function chosenFlags(source) {
  const own = source.flags?.[SCOPE] ?? {};
  return Object.fromEntries(["automatic", "triggered"].filter(key => Array.isArray(own[key]))
    .map(key => [key, foundry.utils.deepClone(own[key])]));
}

/** The Squares around a token, nearest first - ring by ring, up to `rings` away. */
function squaresAround(token, rings = 6) {
  const size = token.parent?.grid?.size ?? globalThis.canvas?.grid?.size ?? 100;
  const out = [];
  for (let ring = 1; ring <= rings; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) === ring) out.push({ x: token.x + (dx * size), y: token.y + (dy * size) });
      }
    }
  }
  return out;
}

/** A free Square beside a token: none with a token on it - its own Square if all are taken. */
export function freeSquareBeside(token) {
  const taken = new Set((token.parent?.tokens?.contents ?? []).map(each => `${each.x}:${each.y}`));
  return squaresAround(token).find(square => !taken.has(`${square.x}:${square.y}`)) ?? { x: token.x, y: token.y };
}

/**
 * Make `count` Minions of a Master (GM only): each Actor created, its Life and Ki full, its token beside its Master's on that
 * Scene, and in the Combat Encounter its Master is in. The Actors made.
 */
export async function makeMinion(master, options = {}) {
  // "Minions cannot create or be the Master of a Minion."
  if (!master || !game.user.isGM || (master.type === "minion")) return [];
  const made = [];
  const token = master.getActiveTokens?.(false, true)?.[0] ?? null;
  const combat = game.combats?.contents?.find(each => each.combatants.some(combatant => combatant.actorId === master.id)) ?? null;
  const roundKey = `${game.combat?.id ?? "none"}:${game.combat?.round ?? 0}`;
  const copy = options.copyOf ? (globalThis.fromUuidSync?.(options.copyOf) ?? null) : null;
  for (let n = 0; n < Math.max(1, Number(options.count) || 1); n++) {
    const actor = await Actor.create(minionData(master, { ...options, copy, made: roundKey }));
    if (!actor) continue;
    await actor.update({ "system.life.value": Number(actor.system.life?.max) || 0, "system.ki.value": Number(actor.system.ki?.max) || 0 });
    made.push(actor);
    if (!token?.parent) continue;
    const at = freeSquareBeside(token);
    const placed = await actor.getTokenDocument(at);
    const [created] = await token.parent.createEmbeddedDocuments("Token", [placed.toObject()]);
    if (created && combat && (combat.scene?.id ?? token.parent.id) === token.parent.id) {
      await combat.createEmbeddedDocuments("Combatant", [{ actorId: actor.id, tokenId: created.id, sceneId: token.parent.id }]);
    }
  }
  // Mirrored Attack's: put in its user's place on the attack it was made for (chat.mjs mirrorTakesAttack).
  if (options.mirror && made[0]) await (await import("./chat.mjs")).mirrorTakesAttack(options.mirror, made[0]);
  return made;
}

/**
 * A Minion counted on its Master's Unique Ability - Multi-Form Technique's Duplicate Minions, Super Ghost Kamikaze Attack's Kamikaze
 * Ghosts (flag `countedOn`: the Item and its count) - one fewer there as it is Defeated or ceases to be. Counted down once.
 */
export async function countDown(actor) {
  const counted = actor?.getFlag?.(SCOPE, "countedOn");
  if (!counted?.itemId || !counted.field) return;
  try { await actor.unsetFlag(SCOPE, "countedOn"); }
  catch { /* Not theirs to change: counted down all the same. */ }
  const master = game.actors?.get(masterOf(actor));
  const item = master?.items?.get(counted.itemId);
  const left = Number(item?.system?.unique?.[counted.field]) || 0;
  if (!item || (left <= 0)) return;
  // Multi-Form Technique's row Applied while any stands.
  const changes = { [`system.unique.${counted.field}`]: left - 1,
    ...(((counted.field === "duplicates") && (left <= 1)) ? { "system.unique.applied": false } : {}) };
  if (master.isOwner) return item.update(changes);
  const { requestActorUpdate } = await import("./chat.mjs");
  return requestActorUpdate(master, { items: [{ _id: item.id, ...changes }] });
}

/**
 * Duplicated Items: "Any Apparel, Accessories or Weapons created along with a Duplicate are destroyed when that Duplicate is
 * Defeated or otherwise ceases to be." Its own copies of its Master's - taken off it as its Defeat settles.
 */
export async function destroyDuplicatedItems(actor) {
  await countDown(actor);
  if (!actor?.system?.duplicate) return;
  const ids = Array.from(actor.items ?? []).filter(item => item.getFlag?.(SCOPE, "duplicated")).map(item => item.id);
  if (ids.length) await actor.deleteEmbeddedDocuments("Item", ids);
}
