/**
 * Adversaries (the user's, after the rulebook's Adversaries page): the opponents the ARC plays - an Actor type of its own
 * (actor-types.mjs), the same model and sheet as a Character's, with what this page gives them. Everything that is an
 * Adversary's own is here; the rest of the system asks this module, and knows no Category by name.
 *
 * "Step 1) Choose an Adversary Category ... and the intended PCC of the Adversary." The PCC - Player Character Count - is "how
 * many Player Characters that the Adversary is intended to fight"; the Adversary Table's benefits are counted from it.
 *
 * No imports: read by the data model as it prepares.
 */

/**
 * The Adversary Table. Each benefit as the table writes it, from the PCC:
 *
 *   Category   Max LP per PL   Max KP per PL   AP per base ToP   Narrative Stamina   Villainous Traits
 *   Standard   1               1               N/A               N/A                 N/A
 *   Elite      PCC             2(PCC)          PCC               PCC*6(bT)           1
 *   Villain    2(PCC)          4(PCC)          2(PCC)            PCC*12(bT)          2
 *
 * `stamina` is what a base Tier of Power is multiplied by. `narrative`: "Adversaries of the Villain or Elite Adversary
 * Categories ... also benefit from the following rules" - Narrative Stamina, One-Man Army, Without Capacity, Villainous Karma.
 */
export const ADVERSARY_CATEGORIES = Object.freeze({
  standard: { label: "Standard", life: () => 1, ki: () => 1, points: () => 0, stamina: () => 0, traits: 0, narrative: false },
  elite: { label: "Elite", life: pcc => pcc, ki: pcc => 2 * pcc, points: pcc => pcc, stamina: pcc => 6 * pcc, traits: 1, narrative: true },
  villain: { label: "Villain", life: pcc => 2 * pcc, ki: pcc => 4 * pcc, points: pcc => 2 * pcc, stamina: pcc => 12 * pcc, traits: 2,
    narrative: true }
});

/** An Adversary's Category as written on its sheet - Standard where none is, or one this system has not. */
export function adversaryCategory(system) {
  const key = String(system?.adversary?.category ?? "");
  return (key in ADVERSARY_CATEGORIES) ? key : "standard";
}

/** Its PCC: a whole number, 1 at least - an Adversary is meant for somebody. */
export function adversaryPcc(system) {
  return Math.max(1, Math.floor(Number(system?.adversary?.pcc) || 1));
}

/**
 * What the Adversary Table gives this one. `made` false - a Character, a Minion - gives nothing, whatever is written.
 *
 * @returns {{category: string, label: string, pcc: number, lifePerLevel: number, kiPerLevel: number, pointsPerTier: number,
 *            staminaPerTier: number, traits: number, narrative: boolean}}
 */
export function adversaryGains(system, { made = true } = {}) {
  if (!made) {
    return { category: "", label: "", pcc: 0, lifePerLevel: 0, kiPerLevel: 0, pointsPerTier: 0, staminaPerTier: 0, traits: 0, narrative: false };
  }
  const category = adversaryCategory(system);
  const row = ADVERSARY_CATEGORIES[category];
  const pcc = adversaryPcc(system);
  return { category, label: row.label, pcc, lifePerLevel: row.life(pcc), kiPerLevel: row.ki(pcc), pointsPerTier: row.points(pcc),
    staminaPerTier: row.stamina(pcc), traits: row.traits, narrative: row.narrative };
}

/**
 * The Attribute Points written onto one Attribute, over what the Progression gives (the user's: a box an Attribute on the
 * Adversary tab) - "AP per base ToP. Increase the amount of Attribute Points your Adversary has at Character Creation", and
 * "Adversaries are not limited by the Attribute Score Limit": as many as are written, the table's count said beside them.
 */
export function adversaryExtra(system, key) {
  return Math.max(0, Math.floor(Number(system?.adversary?.extra?.[key]) || 0));
}

/** How many of those are written, over every Attribute. */
export function adversaryExtraUsed(system) {
  return Object.keys(system?.adversary?.extra ?? {}).reduce((total, key) => total + adversaryExtra(system, key), 0);
}

/**
 * The Skill Ranks written on the Adversary tab, as the Progression counts a Rank - its Skill's key, once a Rank: "Adversaries
 * do not gain Skill Improvements, but ... can have any number of Skill Ranks that you deem fit, even ignoring the usual limit
 * applied by their base Tier of Power."
 */
export function adversaryRanks(system) {
  return Object.entries(system?.adversary?.ranks ?? {})
    .flatMap(([key, ranks]) => Array(Math.max(0, Math.floor(Number(ranks) || 0))).fill(key));
}
