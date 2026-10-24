/**
 * A Racial or Other Trait held but not applying right now - its effects not gathered, what it gave not in use. No imports: the
 * effects' own gathering asks it (registry.mjs).
 *
 * - The Bestial Limit's (racial.mjs bestialLimit): set aside while the Bestial Trait it gave way to is held.
 * - Were-Beast's (Beast-Man): the Were-Traits apply only in a Combat Round they were chosen for (4); the Normal Trait not in one.
 * - Wild Child's: a Pseudo-Bestial Trait applies only while you have access to it - (4), (5) - till the start of your next turn.
 *
 * The reason, or "".
 */
export function traitAside(item, items, actor = item?.parent) {
  const flags = item?.flags?.["dbu-ttrpg"] ?? {};
  const list = Array.from(items ?? []);
  if (flags.bestialOff && list.some(other => other.id === flags.bestialOff)) return "bestial";
  if (flags.wereTrait || flags.normalTrait) {
    const chosen = actor?.getFlag?.("dbu-ttrpg", "wereChoice");
    const round = `${globalThis.game?.combat?.id ?? "none"}:${globalThis.game?.combat?.round ?? 0}`;
    const were = (chosen?.round === round) && (chosen.kind === "were");
    if (flags.wereTrait && !were) return "were";
    if (flags.normalTrait && were) return "normal";
  }
  if (item?.system?.other === "pseudo-bestial") {
    const access = actor?.getFlag?.("dbu-ttrpg", "pseudoAccess");
    if (!access?.all && !(access?.ids ?? []).includes(item.id)) return "pseudo";
  }
  return "";
}
