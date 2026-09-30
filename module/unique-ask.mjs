/**
 * The questions a Unique Ability asks through a window - kept apart from module/unique.mjs, whose rules are
 * read by harnesses with no Foundry to open a window in.
 */

const LABELS = { basic: "Basic Item", apparel: "Apparel", weapon: "Weapon" };

/**
 * What a Restriction asks for when it is applied, where it asks - Limited Creation's "Select either Basic Item,
 * Apparel, or Weapon". "" when it asks nothing; null when the question was put away.
 */
export async function askRestrictionChoice(definition, name) {
  const choices = (Array.isArray(definition?.choices) ? definition.choices : String(definition?.choices ?? "").split(","))
    .map(each => String(each).trim()).filter(Boolean);
  if (!choices.length) return "";
  const picked = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: name ?? definition?.name ?? "Restriction" },
    content: "",
    buttons: [...choices.map(choice => ({ action: choice, label: LABELS[choice] ?? choice })),
      { action: "cancel", label: "Cancel" }],
    rejectClose: false
  });
  return choices.includes(picked) ? picked : null;
}
