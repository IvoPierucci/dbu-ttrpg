/**
 * Genetic Catalogue (Bio-Android): "create a Character for each of your Factor Traits from Genetic Splicing. These Characters are
 * known as your 'Genetic Donors' ... If you were using existing Characters for the sources of your DNA, then you may use those
 * instead." (2): "You may use a Unique Ability possessed by your Genetic Donors if you meet the Prerequisites." (3): "If you use
 * the Signature Technique Maneuver, you may use a Signature Technique possessed by one of your Genetic Donors."
 *
 * The Donors are picked on the Talent's row - the world's characters, the ARC's to have made - and what they hold of both is
 * copied onto the character, named for whose it is: given by the Talent (no TP of theirs, gone with it), each kind once a Round
 * (use-maneuver.mjs useManeuver). The Prerequisites of a Unique Ability are the table's, as everywhere.
 */

import { isCharacter } from "./actor-types.mjs";

const SCOPE = "dbu-ttrpg";

/** Whose a copy is, and which kind: `{ from, fromUuid, kind: "unique" | "technique" }` - or null. */
export function geneticOf(item) {
  return item?.flags?.[SCOPE]?.genetic ?? null;
}

/** The Donors picked, as Actors still in the world. */
export function donorsOf(talent) {
  return (talent?.flags?.[SCOPE]?.donors ?? []).map(id => game.actors?.get(id)).filter(Boolean);
}

/**
 * The race each Genetic Splicing Factor Trait is of - "create a Character for each of your Factor Traits from Genetic Splicing", each
 * Donor of its Gene's race (the user's). Other Genes' (`*`): a race none of the others names - a Custom Species'.
 */
export const GENE_RACES = Object.freeze({
  "android-cybernetics": "android", "angel-genes": "angel", "arcosian-genes": "arcosian", "cerealian-genes": "cerealian",
  "demon-genes": "demon", "earthling-genes": "earthling", "glass-genes": "glass-tribe", "heran-genes": "heran",
  "konatsian-genes": "konatsian", "majin-genes": "majin", "namekian-genes": "namekian", "neko-majin-genes": "neko-majin",
  "neo-tuffle-genes": "neo-tuffle", "other-genes": "*", "saiyan-genes": "saiyan", "shadow-dragon-genes": "shadow-dragon",
  "shinjin-genes": "shinjin", "yardrat-genes": "yardrat"
});

/** The races of the Genes held - one entry for each Genetic Splicing Factor Trait. */
export function geneRaces(actor) {
  return Array.from(actor?.items ?? []).map(item => GENE_RACES[item.flags?.[SCOPE]?.sourceId ?? ""]).filter(Boolean);
}

/** Whether a character may be the Donor for a Gene of that race. */
export function fitsGene(other, race) {
  const theirs = String(other?.system?.race ?? "");
  return (race === "*") ? !Object.values(GENE_RACES).includes(theirs) : (theirs === race);
}

/** Whether the Donors can each be given a Gene of their own, of their race - no more Donors than Genes. */
export function donorsFit(donors, races) {
  if (donors.length > races.length) return false;
  const used = races.map(() => false);
  const place = index => {
    if (index >= donors.length) return true;
    for (let gene = 0; gene < races.length; gene++) {
      if (used[gene] || !fitsGene(donors[index], races[gene])) continue;
      used[gene] = true;
      if (place(index + 1)) return true;
      used[gene] = false;
    }
    return false;
  };
  return place(0);
}

/**
 * Which characters are the Donors: a list of the world's of your Genes' races, those already picked ticked - one for each Gene, each of its
 * Gene's race (the user's); then their copies made again.
 */
export async function chooseDonors(actor, talent) {
  const picked = new Set(talent.flags?.[SCOPE]?.donors ?? []);
  const races = geneRaces(actor);
  if (!races.length) return ui.notifications.warn(`${actor.name} has no Factor Trait from Genetic Splicing - no Genetic Donor for it.`);
  const others = Array.from(game.actors ?? []).filter(other => (isCharacter(other)) && (other.id !== actor.id)
    && races.some(race => fitsGene(other, race)))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!others.length) return ui.notifications.warn("There is no character in the world of your Genes' races to be a Genetic Donor.");
  const escape = Handlebars.escapeExpression;
  const { getRace } = await import("./races.mjs");
  const named = races.map(race => (race === "*") ? "a Custom Species" : (getRace(race)?.name ?? race)).join(", ");
  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"], window: { title: `${actor.name} - Genetic Donors` },
    content: `<p class="dbu-respond-hint">One Character for each Factor Trait from Genetic Splicing, of its race: ${escape(named)}.</p>${others.map(other =>
      `<label class="dbu-respond-option"><input type="checkbox" name="donor" value="${other.id}" ${picked.has(other.id) ? "checked" : ""}/>
        <span class="dbu-respond-name">${escape(other.name)}</span></label>`).join("")}`,
    buttons: [{ action: "confirm", label: "Confirm", default: true, callback: (event, button, dialog) =>
      [...dialog.element.querySelectorAll('input[name="donor"]:checked')].map(input => input.value) },
      { action: "cancel", label: "Cancel" }],
    rejectClose: false
  });
  if (!Array.isArray(chosen)) return;
  if (!donorsFit(chosen.map(id => game.actors?.get(id)).filter(Boolean), races)) {
    return ui.notifications.warn(`${actor.name}: one Genetic Donor for each Gene, of its race (${named}) - not those.`);
  }
  await talent.setFlag(SCOPE, "donors", chosen);
  return copyFromDonors(actor, talent);
}

/** What the Donors hold, copied anew: their Unique Abilities and their built Signature Techniques. */
export async function copyFromDonors(actor, talent) {
  const { isUniqueAbility } = await import("./unique.mjs");
  const { isBuilt } = await import("./technique.mjs");
  const old = Array.from(actor.items ?? []).filter(item => geneticOf(item) && (item.flags?.[SCOPE]?.grantedBy === talent.id))
    .map(item => item.id);
  if (old.length) await actor.deleteEmbeddedDocuments("Item", old);
  const made = [];
  // A Unique Ability the character has of their own, or one already copied from another Donor: not given again (the user's).
  const uaKey = item => String(item.system?.unique?.libraryId || item.name || "").trim().toLowerCase();
  const had = new Set(Array.from(actor.items ?? []).filter(item => isUniqueAbility(item) && !old.includes(item.id)).map(uaKey));
  for (const donor of donorsOf(talent)) {
    for (const item of Array.from(donor.items ?? [])) {
      const kind = isUniqueAbility(item) ? "unique" : ((item.type === "maneuver") && isBuilt(item)) ? "technique" : "";
      if (!kind) continue;
      if (kind === "unique") {
        if (had.has(uaKey(item))) continue;
        had.add(uaKey(item));
      }
      const data = item.toObject();
      delete data._id;
      data.name = `${item.name} (${donor.name})`;
      const own = { ...(data.flags?.[SCOPE] ?? {}) };
      delete own.fromTrait;
      delete own.copied;
      data.flags = { ...(data.flags ?? {}), [SCOPE]: { ...own, grantedBy: talent.id,
        genetic: { from: donor.name, fromUuid: donor.uuid, kind } } };
      // "You may use a Unique Ability possessed by your Genetic Donors" - used, not owned (the user's): no Passive Bonus, no TP.
      if (kind === "unique") foundry.utils.setProperty(data, "system.unique.notOwned", true);
      made.push(data);
    }
  }
  if (made.length) await actor.createEmbeddedDocuments("Item", made);
  ui.notifications.info(`${actor.name}: ${made.length} Unique Abilit${(made.length === 1) ? "y" : "ies"} and Signature Techniques from `
    + `${donorsOf(talent).map(donor => donor.name).join(", ") || "no Donor"}.`);
}
