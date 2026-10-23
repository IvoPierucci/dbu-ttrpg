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

const SCOPE = "dbu-ttrpg";

/** Whose a copy is, and which kind: `{ from, fromUuid, kind: "unique" | "technique" }` - or null. */
export function geneticOf(item) {
  return item?.flags?.[SCOPE]?.genetic ?? null;
}

/** The Donors picked, as Actors still in the world. */
export function donorsOf(talent) {
  return (talent?.flags?.[SCOPE]?.donors ?? []).map(id => game.actors?.get(id)).filter(Boolean);
}

/** Which characters are the Donors: a list of the world's, those already picked ticked - then their copies made again. */
export async function chooseDonors(actor, talent) {
  const picked = new Set(talent.flags?.[SCOPE]?.donors ?? []);
  const others = Array.from(game.actors ?? []).filter(other => (other.type === "character") && (other.id !== actor.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!others.length) return ui.notifications.warn("There is no other character in the world to be a Genetic Donor.");
  const escape = Handlebars.escapeExpression;
  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"], window: { title: `${actor.name} - Genetic Donors` },
    content: `<p class="dbu-respond-hint">A Character for each Factor Trait from Genetic Splicing.</p>${others.map(other =>
      `<label class="dbu-respond-option"><input type="checkbox" name="donor" value="${other.id}" ${picked.has(other.id) ? "checked" : ""}/>
        <span class="dbu-respond-name">${escape(other.name)}</span></label>`).join("")}`,
    buttons: [{ action: "confirm", label: "Confirm", default: true, callback: (event, button, dialog) =>
      [...dialog.element.querySelectorAll('input[name="donor"]:checked')].map(input => input.value) },
      { action: "cancel", label: "Cancel" }],
    rejectClose: false
  });
  if (!Array.isArray(chosen)) return;
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
  for (const donor of donorsOf(talent)) {
    for (const item of Array.from(donor.items ?? [])) {
      const kind = isUniqueAbility(item) ? "unique" : ((item.type === "maneuver") && isBuilt(item)) ? "technique" : "";
      if (!kind) continue;
      const data = item.toObject();
      delete data._id;
      data.name = `${item.name} (${donor.name})`;
      const own = { ...(data.flags?.[SCOPE] ?? {}) };
      delete own.fromTrait;
      delete own.copied;
      data.flags = { ...(data.flags ?? {}), [SCOPE]: { ...own, grantedBy: talent.id,
        genetic: { from: donor.name, fromUuid: donor.uuid, kind } } };
      made.push(data);
    }
  }
  if (made.length) await actor.createEmbeddedDocuments("Item", made);
  ui.notifications.info(`${actor.name}: ${made.length} Unique Abilit${(made.length === 1) ? "y" : "ies"} and Signature Techniques from `
    + `${donorsOf(talent).map(donor => donor.name).join(", ") || "no Donor"}.`);
}
