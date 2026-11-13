/**
 * Custom Buffs: what a player writes in by hand to change a value the system did not work out for them - the game's spreadsheet
 * has the same list ("Custom Buffs and Debuffs"), and this is its list of what a row may change, in its order (the user's).
 *
 * A row that is Active is one more source of effects: its line of script is compiled and gathered with every Trait's
 * (effects/registry.mjs customBuffPrograms), so it lands on the value itself and is named in every hover the value has.
 *
 * Everything that is Custom Buffs' own is here. Nothing else in the system knows the list: adding an option is one entry below,
 * written against a Slot that exists (effects/slots.mjs).
 */

import { getSlot, PHASES } from "./effects/slots.mjs";

const ATTRIBUTES = [["agility", "AG", "Agility"], ["force", "FO", "Force"], ["tenacity", "TE", "Tenacity"],
  ["scholarship", "SC", "Scholarship"], ["insight", "IN", "Insight"], ["magic", "MA", "Magic"], ["personality", "PE", "Personality"]];
const FOUNDATIONS = [["physical", "Physical"], ["energy", "Energy"], ["magic", "Magic"]];
const DICE = [4, 6, 8, 10];

// --- The kinds of option -------------------------------------------------------------------------------
// A number: Flat, (bT) and (T), added to a Slot. `split`: where the spreadsheet keeps bonuses and penalties apart - a negative
// one is a penalty (the user's).
const number = (id, label, section, slot, { split = false } = {}) => ({ id, label, section, kind: "number", slot, split });
// A toggle: no number, a line of its own while Active.
const toggle = (id, label, section, line) => ({ id, label, section, kind: "toggle", line });
// Dice: the number is how many of them.
const dice = (id, label, section, slot, die) => ({ id, label, section, kind: "dice", slot, die });
// The spreadsheet's "+-1/4" ones: the number is how many quarters of the value - 1 a quarter more of it, -2 half of it (the
// user's). Flat alone: a quarter for each Tier is nothing the rules say. `write`: its lines, given the factor the value is
// multiplied by and the quarters themselves.
const quarter = (id, label, section, write, { split = false } = {}) => ({ id, label, section, kind: "quarter", write, split });
const multiplied = (...slots) => factor => slots.map(slot => `${slot} *= ${factor};`).join("\n");

/** Every option, in the spreadsheet's order within its section. */
export const CUSTOM_BUFFS = Object.freeze([
  ...ATTRIBUTES.map(([key, short]) => number(`${key}.score`, `${short} Score`, "Attributes", `${key}.score`)),
  ...ATTRIBUTES.map(([key, short]) => number(`${key}.mod`, `${short} Modifier`, "Attributes", `${key}.mod`)),
  toggle("insight.mod.double", "Double IN Modifier", "Attributes", "insight.mod *= 2;"),
  number("techniquePoints.perSkillImprovement", "TP per Skill Improvement", "Attributes", "techniquePoints.perSkillImprovement"),

  number("tierOfPower", "ToP (Breakthrough)", "Tier of Power and dice", "tierOfPower"),
  number("dice.extra.category", "ToP Extra Dice Cat.", "Tier of Power and dice", "dice.extra.category"),
  number("dice.greater.category", "Greater Dice Category", "Tier of Power and dice", "dice.greater.category"),
  ...DICE.map(die => dice(`combatRolls.d${die}`, `Extra d${die} (Combat Rolls)`, "Tier of Power and dice", "combatRolls.dice", die)),
  number("charges.category", "Energy Charge Dice Category", "Tier of Power and dice", "charges.category"),

  number("life.max", "Max Life Points", "Life, Ki and Capacity", "life.max"),
  quarter("life.max.quarter", "Max Life Points \u00b11/4", "Life, Ki and Capacity", multiplied("life.max")),
  number("ki.max", "Max Ki Pool", "Life, Ki and Capacity", "ki.max"),
  quarter("ki.max.quarter", "Max Ki Pool \u00b11/4", "Life, Ki and Capacity", multiplied("ki.max")),
  number("capacity.flat", "Max Capacity", "Life, Ki and Capacity", "capacity.flat", { split: true }),
  // "Added rather than multiplied, so two of them are a half and not a quarter twice over" (slots.mjs): the Slot the rules'
  // own "increase your Max Capacity by 1/4" is written to.
  quarter("capacity.quarter", "Max Capacity \u00b11/4", "Life, Ki and Capacity",
    (factor, quarters) => `capacity.maxFraction ${quarters < 0 ? "-=" : "+="} ${Math.abs(quarters) / 4};`, { split: true }),
  number("racialLifeModifier", "Racial Life Modifier", "Life, Ki and Capacity", "racialLifeModifier"),
  number("surgency", "Surgency", "Life, Ki and Capacity", "surgency"),
  toggle("surgency.halve", "Halve Surgency", "Life, Ki and Capacity", "surgency *= 0.5;"),

  number("damageReduction", "Damage Reduction", "Defence", "damageReduction"),
  number("soakValue", "Soak", "Defence", "soakValue", { split: true }),
  number("defenseValue", "Defense Value", "Defence", "defenseValue", { split: true }),
  toggle("defenseValue.halve", "Halve Defense Value", "Defence", "defenseValue *= 0.5;"),
  number("superStacks", "Super Stacks", "Defence", "superStacks"),
  number("superStack.musclePenalty", "Muscle Penalty", "Defence", "superStack.musclePenalty"),
  number("steadfast.dice", "Steadfast Checks", "Defence", "steadfast.dice"),
  number("stressBonus", "Stress Bonus", "Defence", "stressBonus"),
  number("size.steps", "Size Category", "Defence", "size.steps"),

  number("save.all", "All Saves", "Saving Throws", "save.all"),
  number("save.impulsive", "Impulsive Saves", "Saving Throws", "save.impulsive"),
  number("save.cognitive", "Cognitive Saves", "Saving Throws", "save.cognitive"),
  number("save.corporeal", "Corporeal Saves", "Saving Throws", "save.corporeal"),
  number("save.morale", "Morale Saves", "Saving Throws", "save.morale"),

  number("haste", "Haste", "Initiative and movement", "haste"),
  number("awareness", "Awareness", "Initiative and movement", "awareness"),
  number("initiative", "Initiative", "Initiative and movement", "initiative"),
  number("speed.normal", "Normal Speed", "Initiative and movement", "speed.normal", { split: true }),
  number("speed.boosted", "Boosted Speed", "Initiative and movement", "speed.boosted", { split: true }),
  number("speed.all", "Both Speeds", "Initiative and movement", "speed.all", { split: true }),
  quarter("speed.normal.quarter", "Normal Speed \u00b11/4", "Initiative and movement", multiplied("speed.normal"), { split: true }),
  quarter("speed.boosted.quarter", "Boosted Speed \u00b11/4", "Initiative and movement", multiplied("speed.boosted"), { split: true }),
  quarter("speed.all.quarter", "Both Speeds \u00b11/4", "Initiative and movement", multiplied("speed.normal", "speed.boosted"), { split: true }),
  toggle("speed.normal.halve", "Halve Normal Speed", "Initiative and movement", "speed.normal *= 0.5;"),
  toggle("speed.boosted.halve", "Halve Boosted Speed", "Initiative and movement", "speed.boosted *= 0.5;"),
  toggle("speed.all.halve", "Halve Both Speeds", "Initiative and movement", "speed.normal *= 0.5;\nspeed.boosted *= 0.5;"),

  number("combatRolls", "Combat Rolls", "Combat Rolls", "combatRolls", { split: true }),
  number("might", "Might", "Combat Rolls", "might"),

  number("strike", "Strike (All)", "Strike", "strike", { split: true }),
  number("criticalTarget.strike", "Strike CT (All)", "Strike", "criticalTarget.strike"),
  number("strike.natural", "Strike Natural Result", "Strike", "strike.natural"),
  ...FOUNDATIONS.flatMap(([key, name]) => [
    number(`strike.${key}`, `Strike (${name})`, "Strike", `strike.${key}`, { split: true }),
    number(`criticalTarget.${key}`, `Strike CT (${name})`, "Strike", `criticalTarget.${key}`)
  ]),
  number("strike.signature", "Signature Strike", "Strike", "strike.signature", { split: true }),
  number("strike.armed", "Armed Strike", "Strike", "strike.armed", { split: true }),

  number("dodge", "Dodge", "Dodge", "dodge", { split: true }),
  number("criticalTarget.dodge", "Dodge CT", "Dodge", "criticalTarget.dodge"),
  number("dodge.natural", "Dodge Natural Result", "Dodge", "dodge.natural"),

  number("wound", "Wound (All)", "Wound", "wound", { split: true }),
  number("criticalTarget.wound", "Wound CT (All)", "Wound", "criticalTarget.wound"),
  number("wound.natural", "Wound Natural Result (All)", "Wound", "wound.natural"),
  ...FOUNDATIONS.map(([key, name]) => number(`wound.${key}`, `Wound (${name})`, "Wound", `wound.${key}`, { split: true })),
  number("wound.signature", "Signature Wound", "Wound", "wound.signature", { split: true }),
  number("wound.armed", "Armed Wound", "Wound", "wound.armed", { split: true }),

  number("attack.kiCost", "Ki Point Cost Attacks", "Ki Point Cost", "attack.kiCost"),
  number("unique.kiCost", "Ki Point Cost Unique Abilities", "Ki Point Cost", "unique.kiCost"),
  number("unique.magical.kiCost", "Ki Point Cost Unique Abilities (Magical)", "Ki Point Cost", "unique.magical.kiCost"),
  number("unique.technical.kiCost", "Ki Point Cost Unique Abilities (Technical)", "Ki Point Cost", "unique.technical.kiCost"),

  ...[["agility", "Agility"], ["force", "Force"], ["scholarship", "Scholarship"], ["insight", "Insight"], ["magic", "Magic"],
    ["personality", "Personality"]].map(([key, name]) => number(`skills.of.${key}`, `${name} Skills`, "Skills", `skills.of.${key}`)),
  ...[["acrobatics", "Acrobatics"], ["bluff", "Bluff"], ["clairvoyance", "Clairvoyance"], ["concealment", "Concealment"],
    ["cooking", "Cooking"], ["craft", "Craft (Basic Items)"], ["craftApparel", "Craft (Apparel)"], ["craftWeapons", "Craft (Weapons)"],
    ["craftVehicles", "Craft (Vehicles)"], ["creatureHandling", "Creature Handling"], ["flight", "Flight"],
    ["intimidation", "Intimidation"], ["intuition", "Intuition"], ["investigation", "Investigation"],
    ["knowledge", "Knowledge (Science)"], ["knowledgeProfession", "Knowledge (Profession)"], ["knowledgeHistory", "Knowledge (History)"]
  ].map(([key, name]) => number(`skill.${key}`, name, "Skills", `skill.${key}`)),
  number("skills.family.knowledge", "Knowledge", "Skills", "skills.family.knowledge"),
  ...[["medicine", "Medicine"], ["perception", "Perception"], ["performance", "Performance"], ["persuasion", "Persuasion"],
    ["pilot", "Pilot"], ["stealth", "Stealth"], ["survival", "Survival"], ["thievery", "Thievery"], ["useMagic", "Use Magic"]
  ].map(([key, name]) => number(`skill.${key}`, name, "Skills", `skill.${key}`))
]);

const BY_ID = new Map(CUSTOM_BUFFS.map(option => [option.id, option]));

/** One option, by its id - or null for one this system no longer has. */
export function customBuffOption(id) {
  return BY_ID.get(String(id ?? "")) ?? null;
}

/** The options under their sections, in order - what the row's Effect list is drawn from. */
export function customBuffSections() {
  const sections = [];
  for (const option of CUSTOM_BUFFS) {
    let section = sections.find(each => each.label === option.section);
    if (!section) sections.push(section = { label: option.section, options: [] });
    section.options.push(option);
  }
  return sections;
}

/**
 * Whether an option takes a (T) amount. A Slot settled before the Tiers are - the Tier of Power itself, the Size Category - can
 * be written with (bT) but never (T): the Tier is not known yet where it is read.
 */
export function customBuffTakesTier(option) {
  // No option at all - one this system no longer has - takes nothing.
  if (!option?.slot || (option.kind === "toggle")) return false;
  return getSlot(option.slot)?.phase !== PHASES.TIER;
}

/** Whether an option takes a (bT) amount: a number or dice. A quarter is Flat alone; a toggle has no amount at all. */
export function customBuffTakesBase(option) {
  return ["number", "dice"].includes(option?.kind);
}

const whole = value => Math.trunc(Number(value) || 0);

/** A row's three amounts as whole numbers - the (T) left out where the option does not take it. */
function amounts(buff, option) {
  return { flat: whole(buff?.flat), perBase: customBuffTakesBase(option) ? whole(buff?.perBase) : 0,
    perTier: customBuffTakesTier(option) ? whole(buff?.perTier) : 0 };
}

/** What a value is multiplied by for so many quarters of it: 1 is 1.25, -2 is 0.5 - never less than nothing. */
const quarterFactor = quarters => Math.max(0, 1 + (quarters / 4));

/** So many quarters, as they are said: "+1/4", "+1/2", "-3/4", "+1 1/4". */
function quartersWritten(quarters) {
  if (!quarters) return "0";
  const size = Math.abs(quarters);
  const wholes = Math.floor(size / 4);
  const rest = size % 4;
  const fraction = (rest === 2) ? "1/2" : rest ? `${rest}/4` : "";
  return `${quarters > 0 ? "+" : "\u2212"}${[wholes || "", fraction].filter(Boolean).join(" ")}`;
}

/**
 * The script of one row, or "" where it says nothing - not Active, no option, every amount 0.
 *
 * Written the way a Trait's is: `strike += 3;`, `strike -= 2(bT);`, `combatRolls.dice += 1d4(T);`.
 */
export function customBuffScript(buff) {
  const option = customBuffOption(buff?.effect);
  if (!buff?.active || !option) return "";
  if (option.kind === "toggle") return `[passive]\n${option.line}`;

  const { flat, perBase, perTier } = amounts(buff, option);
  if (option.kind === "quarter") return flat ? `[passive]\n${option.write(quarterFactor(flat), flat)}` : "";
  const lines = [];
  for (const [value, suffix] of [[flat, ""], [perBase, "(bT)"], [perTier, "(T)"]]) {
    if (!value) continue;
    if (option.kind === "dice") {
      // Dice are only ever added: fewer than none of them is none.
      if (value > 0) lines.push(`${option.slot} += ${value}d${option.die}${suffix};`);
    }
    else lines.push(`${option.slot} ${value < 0 ? "-=" : "+="} ${Math.abs(value)}${suffix};`);
  }
  return lines.length ? `[passive]\n${lines.join("\n")}` : "";
}

/**
 * What a row comes to on this character, as the sheet shows it: Flat + (bT) x base Tier of Power + (T) x Tier of Power.
 * "On" for a toggle; how many dice for dice.
 */
export function customBuffTotal(buff, { baseTier = 1, tier = 1 } = {}) {
  const option = customBuffOption(buff?.effect);
  if (!option) return "";
  if (option.kind === "toggle") return "On";
  const { flat, perBase, perTier } = amounts(buff, option);
  if (option.kind === "quarter") return quartersWritten(flat);
  const total = flat + (perBase * (Number(baseTier) || 1)) + (perTier * (Number(tier) || 1));
  if (option.kind === "dice") return total > 0 ? `${total}d${option.die}` : "0";
  return total > 0 ? `+${total}` : total < 0 ? `\u2212${Math.abs(total)}` : "0";
}

/** How a row is named where its effect shows - a hover, the list of what is active. */
export function customBuffName(buff) {
  const option = customBuffOption(buff?.effect);
  const name = String(buff?.name ?? "").trim() || option?.label || "";
  return name ? `Custom Buff: ${name}` : "Custom Buff";
}

/** A new row, empty and off. */
export function newCustomBuff() {
  return { id: foundry.utils.randomID(), name: "", group: "", active: false, effect: CUSTOM_BUFFS[0].id, flat: 0, perBase: 0, perTier: 0 };
}

/**
 * The rows as they stand once one is switched on or off: every row sharing its Group letter goes with it (the user's:
 * "se prenden juntas"). A row with no letter is its own.
 */
export function customBuffsToggled(buffs, id, active) {
  const list = Array.from(buffs ?? []);
  const group = String(list.find(buff => buff.id === id)?.group ?? "").trim().toUpperCase();
  return list.map(buff => ((buff.id === id) || (group && (String(buff.group ?? "").trim().toUpperCase() === group)))
    ? { ...buff, active: Boolean(active) } : { ...buff });
}
