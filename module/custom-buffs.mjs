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
// The three Combat Rolls, in the spreadsheet's order.
const ROLLS = [["dodge", "Dodge"], ["strike", "Strike"], ["wound", "Wound"]];

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
// Read straight off the rows, with no script: what a worn piece's own numbers are made of is worked out before any effect has
// run, so its readers ask the rows themselves (customBuffAmounts, customBuffOn - gear.mjs).
const direct = (id, label, section) => ({ id, label, section, kind: "number", direct: true, split: false });
const directToggle = (id, label, section) => ({ id, label, section, kind: "toggle", direct: true, line: "" });
// A count read straight off the rows: Flat alone - so many Health Thresholds is not a thing a Tier multiplies.
const count = (id, label, section) => ({ id, label, section, kind: "number", direct: true, flatOnly: true, split: false });
// A mark held on by hand, without the Maneuver that gives it (the user's): had for every effect that asks - its own rule
// gathered, `hasCondition` answering yes - and never written to the character, so switching the row off is all it takes.
const mark = (key, label) => ({ id: `mark.${key}`, label, section: "Toggles", kind: "toggle", direct: true, line: "", mark: key });

/** Every option, in the spreadsheet's order within its section. */
export const CUSTOM_BUFFS = Object.freeze([
  ...ATTRIBUTES.map(([key, short]) => number(`${key}.score`, `${short} Score`, "Attributes", `${key}.score`)),
  ...ATTRIBUTES.map(([key, short]) => number(`${key}.mod`, `${short} Modifier`, "Attributes", `${key}.mod`)),
  toggle("insight.mod.double", "Double IN Modifier", "Attributes", "insight.mod *= 2;"),
  number("techniquePoints.perSkillImprovement", "TP per Skill Improvement", "Attributes", "techniquePoints.perSkillImprovement"),

  number("tierOfPower", "ToP (Breakthrough)", "Tier of Power and dice", "tierOfPower"),
  number("dice.extra.category", "ToP Extra Dice Cat.", "Tier of Power and dice", "dice.extra.category"),
  ...ROLLS.map(([roll, name]) => number(`dice.extra.${roll}.category`, `ToP Extra Dice Cat. (${name})`, "Tier of Power and dice",
    `dice.extra.${roll}.category`)),
  number("dice.greater.category", "Greater Dice Category", "Tier of Power and dice", "dice.greater.category"),
  // How many more times they are applied: to every Combat Roll, or to one of the three alone.
  number("dice.greater.times", "Greater Dice (All)", "Tier of Power and dice", "dice.greater.times"),
  ...ROLLS.map(([roll, name]) => number(`dice.greater.times.${roll}`, `Greater Dice (${name})`, "Tier of Power and dice",
    `dice.greater.times.${roll}`)),
  number("dice.extra.times", "ToP Extra Dice (All)", "Tier of Power and dice", "dice.extra.times"),
  ...ROLLS.map(([roll, name]) => number(`dice.extra.times.${roll}`, `ToP Extra Dice (${name})`, "Tier of Power and dice",
    `dice.extra.times.${roll}`)),
  ...DICE.map(die => dice(`combatRolls.d${die}`, `Extra d${die} (Combat Rolls)`, "Tier of Power and dice", "combatRolls.dice", die)),
  ...ROLLS.flatMap(([roll, name]) => DICE.map(die => dice(`${roll}.d${die}`, `Extra d${die} (${name})`, "Tier of Power and dice",
    `${roll}.extraDice`, die))),
  number("charges.category", "Energy Charge Dice Category", "Tier of Power and dice", "charges.category"),
  number("charges.signatureCategory", "Signature Energy Charge Dice Category", "Signature Techniques", "charges.signatureCategory"),

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
  direct("naturalArmor.apparelBonus", "Natural Armor Apparel Bonus", "Defence"),
  directToggle("naturalArmor.double", "Double Natural Armor AB", "Defence"),
  number("superStacks", "Super Stacks", "Defence", "superStacks"),
  number("superStack.musclePenalty", "Muscle Penalty", "Defence", "superStack.musclePenalty"),
  number("steadfast.dice", "Steadfast Checks", "Defence", "steadfast.dice"),
  // For effects alone - a Trait's, a Talent's "below the Injured Health Threshold" - never the Threshold's own penalties,
  // which are a rule and not an effect (the user's): the Threshold they are in, counted so many steps up or down.
  count("threshold.higher", "Also count as X Thresholds Higher", "Defence"),
  count("threshold.lower", "Also count as X Thresholds Lower", "Defence"),
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
  number("longRange.squares", "Long Range Distance", "Initiative and movement", "longRange.squares"),
  quarter("speed.normal.quarter", "Normal Speed \u00b11/4", "Initiative and movement", multiplied("speed.normal"), { split: true }),
  quarter("speed.boosted.quarter", "Boosted Speed \u00b11/4", "Initiative and movement", multiplied("speed.boosted"), { split: true }),
  quarter("speed.all.quarter", "Both Speeds \u00b11/4", "Initiative and movement", multiplied("speed.normal", "speed.boosted"), { split: true }),
  toggle("speed.normal.halve", "Halve Normal Speed", "Initiative and movement", "speed.normal *= 0.5;"),
  toggle("speed.boosted.halve", "Halve Boosted Speed", "Initiative and movement", "speed.boosted *= 0.5;"),
  toggle("speed.all.halve", "Halve Both Speeds", "Initiative and movement", "speed.normal *= 0.5;\nspeed.boosted *= 0.5;"),

  number("combatRolls", "Combat Rolls", "Combat Rolls", "combatRolls", { split: true }),
  number("might", "Might", "Combat Rolls", "might"),
  // A roll of Might against another's - never a Might Check against a Difficulty (the user's).
  number("clash.might", "Might for Clashes", "Combat Rolls", "clash.might"),
  number("clash.duel", "Duel Clash Bonus", "Combat Rolls", "clash.duel"),

  number("strike", "Strike (All)", "Strike", "strike", { split: true }),
  number("criticalTarget.strike", "Strike CT (All)", "Strike", "criticalTarget.strike"),
  number("strike.natural", "Strike Natural Result", "Strike", "strike.natural"),
  ...FOUNDATIONS.flatMap(([key, name]) => [
    number(`strike.${key}`, `Strike (${name})`, "Strike", `strike.${key}`, { split: true }),
    number(`criticalTarget.${key}`, `Strike CT (${name})`, "Strike", `criticalTarget.${key}`)
  ]),
  number("strike.armed", "Armed Strike", "Strike", "strike.armed", { split: true }),
  number("strike.unarmed", "Unarmed Strike", "Strike", "strike.unarmed", { split: true }),

  number("dodge", "Dodge", "Dodge", "dodge", { split: true }),
  number("criticalTarget.dodge", "Dodge CT", "Dodge", "criticalTarget.dodge"),
  number("dodge.natural", "Dodge Natural Result", "Dodge", "dodge.natural"),

  number("wound", "Wound (All)", "Wound", "wound", { split: true }),
  number("criticalTarget.wound", "Wound CT (All)", "Wound", "criticalTarget.wound"),
  number("wound.natural", "Wound Natural Result (All)", "Wound", "wound.natural"),
  ...FOUNDATIONS.flatMap(([key, name]) => [
    number(`wound.${key}`, `Wound (${name})`, "Wound", `wound.${key}`, { split: true }),
    number(`criticalTarget.wound.${key}`, `Wound CT (${name})`, "Wound", `criticalTarget.wound.${key}`),
    number(`wound.natural.${key}`, `Wound Natural Result (${name})`, "Wound", `wound.natural.${key}`)
  ]),
  number("wound.armed", "Armed Wound", "Wound", "wound.armed", { split: true }),
  number("wound.unarmed", "Unarmed Wound", "Wound", "wound.unarmed", { split: true }),
  // The Damage Attribute: Force for a Physical or an Energy Attack, Magic for a Magic one - one of each written, so it lands
  // on whichever the attack is; how many more times it is applied to the Wound Roll; and which Attribute it is.
  { id: "damageAttribute", label: "Damage Attribute", section: "Wound", kind: "number", slot: "damageAttribute.physical",
    also: ["damageAttribute.energy", "damageAttribute.magic"], split: false },
  number("damageAttribute.times", "Damage Attribute Times Applied", "Wound", "damageAttribute.times"),
  number("attack.damageCategory", "Attacking Damage Category", "Wound", "attack.damageCategory"),
  ...[...ATTRIBUTES.map(([key, , name]) => [key, name]), ["surgency", "Surgency"]].map(([key, name]) =>
    toggle(`damageAttribute.use.${key}`, `Use Damage Attribute (${name})`, "Wound", `allow damageAttribute.use.${key};`)),

  number("criticalTarget.signature.strike", "Signature CT (Strike)", "Signature Techniques", "criticalTarget.signature.strike"),
  number("strike.signature", "Signature Strike", "Signature Techniques", "strike.signature", { split: true }),
  number("criticalTarget.signature.wound", "Signature CT (Wound)", "Signature Techniques", "criticalTarget.signature.wound"),
  number("wound.signature", "Signature Wound", "Signature Techniques", "wound.signature", { split: true }),
  number("dice.extra.times.signature", "Signature Extra ToP Dice (All)", "Signature Techniques", "dice.extra.times.signature"),
  number("dice.extra.times.signature.strike", "Signature Extra ToP Dice (Strike)", "Signature Techniques", "dice.extra.times.signature.strike"),
  number("dice.extra.times.signature.wound", "Signature Extra ToP Dice (Wound)", "Signature Techniques", "dice.extra.times.signature.wound"),
  ...[["", "All"], ["strike.", "Strike"], ["wound.", "Wound"]].flatMap(([roll, name]) => DICE.map(die =>
    dice(`signature.${roll}d${die}`, `Signature d${die} (${name})`, "Signature Techniques", `signature.${roll}extraDice`, die))),

  number("attack.kiCost", "Ki Point Cost Attacks", "Ki Point Cost", "attack.kiCost"),
  number("attack.kiCost.uncapped", "Ki Point Cost Attacks (no cap)", "Ki Point Cost", "attack.kiCost.uncapped"),
  // Every Maneuver's cost once more for each: 1 the double, 2 the triple (the user's).
  number("maneuvers.kiCost.times", "Ki Point Cost Multiplier", "Ki Point Cost", "maneuvers.kiCost.times"),
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
  ].map(([key, name]) => number(`skill.${key}`, name, "Skills", `skill.${key}`)),

  // Every penalty to that roll left off (the user's: all of them, a toggle and no number) - the flags Masterful Strike and
  // Masterful Dodge already answer to, and a Wound Roll's beside them (chat.mjs strikePenaltiesIgnored).
  toggle("strike.noPenalties", "No Strike Penalties", "Toggles", "allow strike.ignorePenalties;"),
  toggle("dodge.noPenalties", "No Dodge Penalties", "Toggles", "allow dodge.ignorePenalties;"),
  toggle("wound.noPenalties", "No Wound Penalties", "Toggles", "allow wound.ignorePenalties;"),
  // Hyped by the Hype Maneuver or not; Rooted, the Arboreal's, without its own effects.
  mark("hyped", "Hyped"),
  mark("rooted", "Rooted"),
  // The Analysis Maneuver's bonus whoever the attack is aimed at (chat.mjs analysisBonus).
  directToggle("analysis.any", "Analyzed", "Toggles"),
  // The Intuit Maneuver's whoever the Clash is against (seenBonus).
  directToggle("intuit.any", "Seen", "Toggles"),
  // The Basic Attack Maneuver counted as the Signature Technique Maneuver - for a Trait's or a Talent's effects alone, never
  // for a Signature Technique's own rules (the user's): what such an effect adds, takes off or asks, where it is read.
  directToggle("basicAsSignature", "Count Basic Attack as Signature", "Toggles"),
  // The Were-Beast's Were-Traits in place of the Normal Trait, whatever the Combat Round's choice - out of an Encounter too
  // (aside.mjs).
  directToggle("wereTraits", "Get Were-Traits", "Toggles")
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
  // No option at all - one this system no longer has - takes nothing; nor a toggle, nor a quarter.
  if (!["number", "dice"].includes(option?.kind)) return false;
  // One read straight off its rows is read with the Tier known - unless it is a count, Flat alone.
  if (option.direct) return !option.flatOnly;
  return getSlot(option.slot)?.phase !== PHASES.TIER;
}

/** Whether an option takes a (bT) amount: a number or dice. A quarter is Flat alone; a toggle has no amount at all. */
export function customBuffTakesBase(option) {
  return ["number", "dice"].includes(option?.kind) && !option.flatOnly;
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
  // Read off the row itself, where it is needed: no script to it.
  if (option.direct) return "";
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
    else for (const slot of [option.slot, ...(option.also ?? [])]) lines.push(`${slot} ${value < 0 ? "-=" : "+="} ${Math.abs(value)}${suffix};`);
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

/**
 * What the Active rows of one option come to between them, read straight off the rows - for what is worked out before any
 * effect has run (a worn piece's own numbers, gear.mjs). Their three amounts, each summed.
 */
export function customBuffAmounts(actor, id) {
  const sum = { flat: 0, perBase: 0, perTier: 0 };
  for (const buff of actor?.system?.customBuffs ?? []) {
    if (!buff?.active || (buff.effect !== id)) continue;
    sum.flat += whole(buff.flat);
    sum.perBase += whole(buff.perBase);
    sum.perTier += whole(buff.perTier);
  }
  return sum;
}

/**
 * The Health Threshold an effect finds a character in, given the one they are in: so many steps down the line - "Also count
 * as X Thresholds Lower" - or up it. For effects alone: the Threshold's own penalties are a rule, and read the real one (the
 * user's). `system`: the character's own data, which is what an effect's condition is asked of.
 */
export function customBuffThresholdFor(system, key) {
  const keys = ["healthy", "bruised", "injured", "critical"];
  const at = keys.indexOf(String(key ?? "healthy"));
  if (at < 0) return key;
  const rows = id => (system?.customBuffs ?? []).filter(buff => buff?.active && (buff.effect === id))
    .reduce((sum, buff) => sum + whole(buff.flat), 0);
  const shift = rows("threshold.lower") - rows("threshold.higher");
  return shift ? keys[Math.min(keys.length - 1, Math.max(0, at + shift))] : key;
}

/**
 * Whether that Maneuver counts as the Signature Technique Maneuver for a Trait's or a Talent's effects: the Basic Attack,
 * while "Count Basic Attack as Signature" is switched on. Never for a Signature Technique's own rules - its Energy Charges'
 * dice, its features, its uses.
 */
export function customBuffBasicIsSignature(system, maneuverId) {
  return (maneuverId === "basic-attack")
    && (system?.customBuffs ?? []).some(buff => buff?.active && (buff.effect === "basicAsSignature"));
}

/** Whether a row of one option is Active - a toggle read straight off the rows. */
export function customBuffOn(actor, id) {
  return (actor?.system?.customBuffs ?? []).some(buff => buff?.active && (buff.effect === id));
}

/**
 * The marks a row holds on by hand - "hyped", "rooted" - read off the character's own data, which is what an effect's condition
 * is asked of.
 */
export function customBuffMarks(system) {
  return (system?.customBuffs ?? []).filter(buff => buff?.active).map(buff => customBuffOption(buff.effect)?.mark).filter(Boolean);
}

/** Whether a row holds that mark on. */
export function customBuffMarked(system, key) {
  return customBuffMarks(system).includes(String(key ?? "").toLowerCase());
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
