/**
 * The Main tab's Skills (the user's design, 2026-11-15): a block per Attribute, in the Attributes' order - Agility and Scholarship
 * on the left, Insight, Magic and Personality on the right, Personality under Scholarship wherever the room there holds it. Each
 * Skill's Ranks as pips up to the Rank cap. Craft's four and Knowledge's three one row - "Craft (Any)" - while they are all the
 * same: a sign, not a choice (the user's) - all at 0 it is a Required Skill without a Rank, and alike, any of them is the roll.
 */

/** The Skills shown as one while alike, under the name they are shown by. */
export const FOLDED_SKILLS = Object.freeze([
  { label: "Craft (Any)", keys: Object.freeze(["craft", "craftApparel", "craftWeapons", "craftVehicles"]) },
  { label: "Knowledge (Any)", keys: Object.freeze(["knowledge", "knowledgeProfession", "knowledgeHistory"]) }
]);

/** Whether a fold's Skills are alike: the same Ranks, roll and Critical Target, and nothing of their own written or ticked. */
function alike(kin) {
  return (kin.length > 1) && kin.every(skill => (skill.ranks === kin[0].ranks) && (skill.roll === kin[0].roll)
    && (skill.critical === kin[0].critical) && !skill.specialization && !(skill.specialties ?? []).some(entry => entry.held));
}

/** A group's Skills with Craft's and Knowledge's folded into one row each where they are alike - the first of them, renamed. */
export function foldSkills(skills = []) {
  const out = [];
  for (const skill of skills) {
    const fold = FOLDED_SKILLS.find(entry => entry.keys.includes(skill.key));
    const kin = fold ? skills.filter(each => fold.keys.includes(each.key)) : [];
    if (!fold || !alike(kin)) { out.push(skill); continue; }
    if (kin[0] === skill) out.push({ ...skill, label: fold.label, folded: true });
  }
  return out;
}

/** The Ranks as pips: as many as the Rank cap, more where there are more Ranks than it - those marked over. */
export function rankPips(ranks, cap) {
  const held = Math.max(0, Number(ranks) || 0);
  const most = Math.max(0, Number(cap) || 0);
  return Array.from({ length: Math.max(held, most) }, (unused, at) => ({ on: at < held, over: at >= most }));
}

/**
 * The two columns of blocks. Personality under Scholarship where Agility and Scholarship are no taller than Insight and Magic -
 * counted in rows, a block's heading one, all of one height - else under Magic. A group of any other Attribute goes under the
 * shorter column.
 */
export function skillColumns(groups = [], rankCap = 0, mods = {}) {
  const blocks = groups.map(group => {
    const skills = foldSkills(group.skills).map(skill => ({ ...skill, pips: rankPips(skill.ranks, rankCap) }));
    return { ...group, mod: mods[group.attribute] ?? 0, skills };
  });
  const of = key => blocks.find(block => block.attribute === key);
  const tall = keys => keys.reduce((sum, key) => sum + (of(key) ? 1 + of(key).skills.length : 0), 0);
  const left = ["agility", "scholarship"];
  const right = ["insight", "magic"];
  (tall(left) <= tall(right) ? left : right).push("personality");
  const columns = [left.map(of).filter(Boolean), right.map(of).filter(Boolean)];
  for (const block of blocks) {
    if (columns.flat().includes(block)) continue;
    const height = column => column.reduce((sum, each) => sum + 1 + each.skills.length, 0);
    (height(columns[0]) <= height(columns[1]) ? columns[0] : columns[1]).push(block);
  }
  return columns;
}
