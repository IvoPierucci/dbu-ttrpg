/**
 * Assimilation (4): "Upon gaining a stack of the Absorption Awakening, you may replace your Top Layer of Apparel with the Top Layer of
 * Apparel equipped by the Absorbed Character for that stack of Absorption while you possess that stack of Absorption (if lost, you regain
 * the piece of Apparel replaced by this effect). If you do, that piece of Apparel may gain any Special Apparel Qualities possessed by the
 * piece of Apparel it replaced."
 *
 * The Absorbed's piece copied onto you, worn on the Layer yours was (the Top, with none), flagged with the stack it came with
 * (`assimilated`); yours taken off. Each Special Apparel Quality of yours it has not got, asked onto it - free, as a gift. The stacks
 * counted down below it: the copy gone and yours worn again.
 */

import { composeEffects, topLayerPiece } from "./gear.mjs";
import { getTrait } from "./effects/traits.mjs";

const SCOPE = "dbu-ttrpg";

/** The Special Apparel Qualities of a piece the other has not got - what the copy may gain. */
export function specialsToGain(own, copy, lookup = getTrait) {
  const has = new Set((copy?.system?.crafted?.qualities ?? []).map(entry => entry.id));
  return (own?.system?.crafted?.qualities ?? []).filter(entry => (lookup(entry.id)?.special === true) && !has.has(entry.id));
}

/** The copies a count of stacks no longer holds - the ones that came with a higher stack. */
export function copiesLost(items, stacks) {
  return Array.from(items ?? []).filter(item => (Number(item.flags?.[SCOPE]?.assimilated?.stack) || 0) > (Number(stacks) || 0));
}

export async function assimilateApparel(actor, target) {
  if ((actor?.system?.effects?.slots?.["assimilation.apparel"] !== true) || !target) return;
  const theirs = topLayerPiece(Array.from(target.items ?? []));
  if (!theirs) return;
  if (!actor.isOwner && !game.user.isGM) return;
  const { askPlayerChoice } = await import("./chat.mjs");
  const own = topLayerPiece(Array.from(actor.items ?? []));
  if ((await askPlayerChoice(actor, `${actor.name}: Assimilation - ${target.name}'s ${theirs.name}`,
    [{ value: "yes", label: own ? `Wear it in place of your ${own.name}` : "Wear it as your Top Layer" },
     { value: "no", label: "No" }])) !== "yes") return;
  const stack = Number(actor.system.conditions?.["absorption-awakening"]) || 0;
  const data = theirs.toObject();
  delete data._id;
  data.system.equipped = true;
  data.system.layer = own?.system?.layer || "top";
  data.flags = { ...(data.flags ?? {}), [SCOPE]: { ...(data.flags?.[SCOPE] ?? {}),
    assimilated: { stack, replaced: own?.id ?? "", from: target.name } } };
  // "May gain any Special Apparel Qualities possessed by the piece of Apparel it replaced" - each asked.
  for (const entry of specialsToGain(own, theirs)) {
    const quality = getTrait(entry.id);
    if ((await askPlayerChoice(actor, `${actor.name}: Assimilation - ${quality?.name ?? entry.id} onto ${theirs.name}`,
      [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }])) !== "yes") continue;
    data.system.crafted.qualities = [...(data.system.crafted.qualities ?? []), { ...entry, free: true, granted: true }];
  }
  data.system.crafted.effects = composeEffects(data.system.crafted, data.system.crafted.effects ?? "", { getTrait });
  if (own) await actor.updateEmbeddedDocuments("Item", [{ _id: own.id, "system.equipped": false }]);
  await actor.createEmbeddedDocuments("Item", [data]);
  ui.notifications.info(`${actor.name}: Assimilation - ${theirs.name} worn while that stack of Absorption lasts.`);
}

/** That stack lost: the copy gone, and the piece it replaced worn again. Done by the active GM. */
export function registerAssimilationHooks() {
  Hooks.on("updateActor", async actor => {
    if (!game.users.activeGM?.isSelf) return;
    const lost = copiesLost(actor.items, actor.system?.conditions?.["absorption-awakening"]);
    if (!lost.length) return;
    const back = lost.map(item => item.flags[SCOPE].assimilated.replaced).filter(id => actor.items.get(id));
    await actor.deleteEmbeddedDocuments("Item", lost.map(item => item.id));
    if (back.length) await actor.updateEmbeddedDocuments("Item", back.map(id => ({ _id: id, "system.equipped": true })));
  });
}
