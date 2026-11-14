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

/**
 * Narrative Stamina "can be used in the place of Ki Points": what of it is there to pay Ki with now - an Elite's or a
 * Villain's, not in a 1-on-1 Duel ("ignore the rules of Narrative Stamina"). 0 for anyone else.
 */
export function staminaForKi(actor) {
  return actor?.system?.adversaryNarrative ? staminaLeft(actor) : 0;
}

/**
 * Whether the window an attack is declared in asks if the Narrative Stamina pays (the user's: "Ask", as Divine Ki is asked) -
 * the sheet set to Ask, and Stamina there to pay with. Set to Auto, it pays without asking.
 */
export function asksStamina(actor) {
  return (actor?.system?.adversary?.staminaMode === "ask") && (staminaForKi(actor) > 0);
}

/**
 * Narrative Stamina paying Ki in its place (the user's: every Ki Point spent - "todo gasto de Ki"), as the write that pays is
 * made. A payment is told by what every payment in this system writes at once: Ki Points down, and the Capacity spent up by
 * it. That is not a Ki Point drained by an Opponent, nor one set by hand on the sheet - neither touches the Capacity - and
 * neither is paid in its place. What it pays is taken off the Ki Points lost and off the Capacity spent (Stamina is not Ki,
 * and the Capacity counts Ki); the rest is paid in Ki. Not where the write says so (`dbuNoStamina`: Ask, answered no), nor where
 * it sets the Stamina itself.
 *
 * Read off a preUpdateActor hook (dbu-ttrpg.mjs): `changes` is changed in place, flat keys or nested alike.
 */
export function payKiWithStamina(actor, changes, options = {}) {
  if (options?.dbuNoStamina) return 0;
  const has = key => (key in changes) || (foundry.utils.getProperty(changes, key) !== undefined);
  const get = key => ((key in changes) ? changes[key] : foundry.utils.getProperty(changes, key));
  const set = (key, value) => { if (key in changes) changes[key] = value; else foundry.utils.setProperty(changes, key, value); };
  if (!has("system.ki.value") || !has("system.capacity.spent") || has("system.narrativeStamina.value")) return 0;
  const kiNow = Number(actor.system?.ki?.value) || 0;
  const spentNow = Number(actor.system?.capacity?.spent) || 0;
  const paid = kiNow - (Number(get("system.ki.value")) || 0);
  const counted = (Number(get("system.capacity.spent")) || 0) - spentNow;
  if ((paid <= 0) || (counted <= 0)) return 0;
  const taken = Math.min(paid, staminaForKi(actor));
  if (taken <= 0) return 0;
  set("system.ki.value", kiNow - paid + taken);
  set("system.capacity.spent", spentNow + Math.max(0, counted - taken));
  set("system.narrativeStamina.value", staminaLeft(actor) - taken);
  return taken;
}

/**
 * A Weakpoint hit (the user's: a window of what may follow, each chosen there) - "Once a Weakpoint's condition has been hit, you
 * can use it to: Remove Adversary Transformations. Prevent an Adversary from entering/staying in a very powerful Transformation.
 * Remove a Villainous Trait. Apply Combat Conditions. Weaken their Attributes or other values." Those this system has: a
 * Villainous Trait switched off, a Combat Condition applied, and a group of Custom Buffs switched on - written beforehand, to
 * weaken what the ARC wants weakened. The Transformations wait for them.
 *
 * What it makes of the choices: the Custom Buffs as they stand once that group's rows are on, and the lines said in the chat.
 */
export function weakpointOutcome(system, { traitName = "", conditionName = "", group = "" } = {}) {
  const letter = String(group ?? "").trim().toUpperCase();
  const buffs = (system?.customBuffs ?? []).map(buff => ({ ...buff }));
  const switched = letter ? buffs.filter(buff => String(buff.group ?? "").toUpperCase() === letter) : [];
  for (const buff of switched) buff.active = true;
  const lines = [
    traitName ? `${traitName} switched off.` : "",
    conditionName ? `${conditionName} applied.` : "",
    switched.length ? `Custom Buffs of group ${letter} switched on: ${switched.map(buff => buff.name || "unnamed").join(", ")}.` : ""
  ].filter(Boolean);
  return { buffs: switched.length ? buffs : null, lines };
}

/**
 * Quickplay Adversaries: "Create an Adversary as you normally would, but you do not use Character Perks to define your
 * Adversary's Talents and Attribute Scores. Instead ... Set 1 Attribute's Attribute Score to the Score Limit. Set 2 Attribute's
 * Attribute Scores to 3/4 of the Score Limit. Set 1 Attribute's Attribute Score to 1/2 of the Score Limit. Gain 3(bT) Talents.
 * If you want the Adversary to take the Balanced Warrior Talent, set the lower of their Force and Magic to the Attribute Score of
 * the higher." Switched on on its Progression tab, in place of the table of Power Levels (the user's); the three not chosen at 1
 * (the user's); the Attribute Points written on the Adversary tab still on top (the user's). Fractions rounded down.
 *
 * `tier`: its base Tier of Power - the Score Limit's, 8 and 3 more a Tier. Null where it is not on, or it is no Adversary.
 */
export function quickplayScores(system, tier, { balanced = false } = {}) {
  const quick = system?.adversary?.quickplay;
  if ((system?.parent?.type && (system.parent.type !== "adversary")) || !quick?.on) return null;
  const limit = 8 + (3 * (Math.max(1, Number(tier) || 1) - 1));
  const keys = Object.keys(system.adversary.extra ?? {});
  const scores = Object.fromEntries(keys.map(key => [key, 1]));
  const set = (key, value) => { if (key in scores) scores[key] = Math.max(scores[key], value); };
  set(quick.half, Math.floor(limit / 2));
  set(quick.threeA, Math.floor((limit * 3) / 4));
  set(quick.threeB, Math.floor((limit * 3) / 4));
  set(quick.limit, limit);
  if (balanced && ("force" in scores) && ("magic" in scores)) scores.force = scores.magic = Math.max(scores.force, scores.magic);
  return { limit, scores };
}

/** How many Talents Quickplay gives: 3(bT). */
export function quickplayTalentCount(tier) {
  return 3 * Math.max(1, Number(tier) || 1);
}
