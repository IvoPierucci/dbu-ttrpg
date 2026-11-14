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

/**
 * Villainous Karma: "Adversaries do not gain Karma Points at Character Creation, but instead, they have no limit on Karma
 * Points and at the start of each Combat Encounter, a Villain-Category Adversary gains PCC Karma Points, and an
 * Elite-Category Adversary gains 1/2 of PCC Karma Points (min. 1)" - rounded down. A Standard one has none (the user's).
 */
export function adversaryKarma(system) {
  const gains = adversaryGains(system);
  if (gains.category === "villain") return gains.pcc;
  if (gains.category === "elite") return Math.max(1, Math.floor(gains.pcc / 2));
  return 0;
}

/**
 * What a Combat Encounter beginning gives an Adversary, and what its ending takes: its Villainous Karma, and - "Adversaries
 * lose all remaining Karma Points at the end of each Combat Encounter" - none of it left, its Narrative Stamina gone with the
 * Round it was for, and a 1-on-1 Duel over. The fields a document update takes.
 */
export function adversaryEncounterStart(system) {
  return { "system.karma": adversaryKarma(system), "system.adversary.karmaRegained": false };
}

export function adversaryEncounterEnd() {
  return { "system.karma": 0, "system.adversary.karmaRegained": false, "system.adversary.duel": false, "system.narrativeStamina.value": 0 };
}

/**
 * The Narrative Stamina an Adversary has to spend now: "a resource that can be used in the place of Ki Points, and when you
 * take Damage, you can reduce your Narrative Stamina by any amount to reduce how many Life Points you lose by an equal
 * amount." What is left of this Round's - none on an Actor that is no Adversary.
 */
export function staminaLeft(actor) {
  if (actor?.type !== "adversary") return 0;
  return Math.max(0, Math.floor(Number(actor.system?.narrativeStamina?.value) || 0));
}

/**
 * The Health Thresholds a hit may knock them through, as lines on their Life Points (the user's: marked in the Damage window,
 * "para evitar pasar por ellos"): each one's name and the most Life Points that are already in it - a quarter of 400 is 100,
 * and at 100 they are Injured. `thresholds`: the model's own table, each with the fraction it is above.
 */
export function thresholdLines(max, thresholds) {
  return Object.values(thresholds).filter(each => Number.isFinite(each.above) && (each.above > 0))
    .map(each => ({ label: lineLabel(each, thresholds), at: Math.floor((Number(max) || 0) * each.above), fraction: each.above }));
}

/** The Threshold under a line: the one whose own line is the next one down - Healthy's line, at a half, is Bruised's top. */
function lineLabel(line, thresholds) {
  const below = Object.values(thresholds).filter(each => each.above < line.above).sort((a, b) => b.above - a.above)[0];
  return below?.label ?? "";
}

/**
 * The Narrative Stamina that keeps a hit from knocking them through the next Health Threshold down: the least that leaves them
 * above its line - never more than the Damage or than they have. 0 where the hit crosses none, or where nothing they have
 * would stop it (then `enough` is false).
 */
export function staminaToStay(life, max, damage, stamina, thresholds) {
  const line = thresholdLines(max, thresholds).map(each => each.at).filter(at => life > at).sort((a, b) => b - a)[0];
  if (line === undefined) return { needed: 0, enough: true };
  const needed = Math.max(0, damage - (life - line - 1));
  const most = Math.min(stamina, damage);
  return { needed: Math.min(needed, most), enough: needed <= most };
}
