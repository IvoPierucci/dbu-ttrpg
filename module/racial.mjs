/**
 * Racial Traits on a character.
 *
 * A Racial Trait is written as a file under `traits/races/<race>/`, and taken by hand from the Traits tab - this
 * character's race's or any other's (the user's ruling). Taken, it becomes an Item of the character's own (type
 * `racial`), its script copied from the file: edited on its Effect tab, it changes how it acts on that character, and
 * the file is never touched.
 *
 * What a file may say besides its script:
 *
 *   category: body | mind           "split between the Body and Mind Categories"
 *   importance: primary | secondary "separated into Primary or Secondary Traits"
 *   subrace: <subrace id>           a Subrace Trait (Primary)
 *   order: 1                        where it stands among its race's, as the race's page prints them (the user's)
 *   options: 1                      an Option effect: choose that many of its Options when it is added
 *   optionEffect: 3                 which of its printed effects that Option effect is - "3rd effect" on the Item
 *   choose: knowledge               a choice its script reads as `$choice` - Knowledge (any) or an Elemental Profile
 *   grantsUnique: <ids>             Unique Abilities it gives - "You do not need to meet the Requirements to use these
 *                                   Unique Abilities and you do not need to spend any Technique Points to gain them"
 *   uniqueRestrictions: <ids>       Restrictions those come with - God of Time's Straining and Difficult Time Freeze
 *   grantsUniqueInstead: 20         one already had, another of that TP Cost or less chosen instead - Psychic's
 *   grantsTalent: <ids>             Talents it gives - kept if the Trait is lost ("you do not lose that Talent")
 *   grantsOther: bestial            an Other Trait of that group chosen as it is added - `grantsOtherCount` of them, of
 *                                   `grantsOtherFrom` alone where it names some (Feline Build's two of four)
 *   dragonBall: true                Personified Dragon Ball's set - its name, Size Category (Nano to Small) and stars - asked
 *                                   as it is added, kept on the Item (`dragonBall` flag)
 *   grantsGear: majin-dama          a Special Item it makes as it is added - Neko Majin-Dama's Integrated Majin-Dama - gone
 *                                   with it while still on the sheet
 *   addendum: >                     its Addendum effect's text box, shown as written in the Item's Options tab
 *   tail: true                      a tail it may lose - the Options tab's Tail lost box (the `tailed` question)
 *
 * An Option is a file of its own beside it, `traits/races/<race>/<trait>/<option>.dbu`, marked `optionOf: <trait>`; its
 * script is added to the Trait's between `#@ option` markers, and it may say `choose`, `grantsUnique`, `grantsTalent`.
 *
 * A Racial Factor's Factor Traits are Racial Traits ("Factor Traits are considered Racial Traits"), written the same way
 * under `traits/factors/<factor>/`, and taken from the same list after every race's. The Factor itself is
 * `traits/factors/<factor>.dbu`: its `requirement:`, `maximumFactor:` and `prerequisites:`, shown beside its Factor
 * Traits and never enforced - nor which Trait one replaces (the user's: the system does not control which Racial Traits a
 * character has).
 */

import { getTrait, printedLines, traitsOfKind } from "./effects/traits.mjs";
import { getRace, subraceName } from "./races.mjs";

/** The Item type a Racial Trait is. */
export const RACIAL_TYPE = "racial";

/** A link written in a Trait's text as `[label](url)`. */
const LINK = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

/** A Trait's text with its links as their labels - for a tooltip, which shows no link. */
export function plainText(text) {
  return String(text ?? "").replace(LINK, "$1");
}

/** An Option effect's line: "(2)-[Option]:" - choose one - or "(3)-[Multi-Option/2]:" - choose two. */
const OPTION_LINE = /^(\(\d+\)-\[(?:Option|Multi-Option\/\d+)\]):/;

/** Which Option effect an Option is of: its own `optionEffect:`, or its Trait's. */
function optionEffectOf(option, trait = null) {
  return Number(option?.optionEffect) || Number((trait ?? getTrait(option?.optionOf ?? ""))?.optionEffect) || 0;
}

/** Whether an Option chosen on an Item is one of that Option effect's - any, where its Trait says none. */
function optionBelongs(option, item, effect) {
  const mine = optionEffectOf(option, getTrait(item?.flags?.["dbu-ttrpg"]?.sourceId ?? ""));
  return !mine || (mine === effect);
}

/**
 * A Racial Trait's Option effects, as its text prints them, each with how many are chosen and its Options: "(2)-[Option]"
 * one, "(3)-[Multi-Option/2]" two. One with no such line - an older file - is its `optionEffect:` and `options:`.
 */
export function optionGroupsOf(trait) {
  const options = racialOptionsOf(trait?.id);
  if (!options.length) return [];
  const groups = printedLines(trait.text || "").map(line => /^\((\d+)\)-\[(Option|Multi-Option\/(\d+))\]:/.exec(line))
    .filter(Boolean).map(match => ({ effect: Number(match[1]), count: Number(match[3]) || 1 }));
  if (!groups.length) groups.push({ effect: Number(trait.optionEffect) || 0, count: Math.max(1, Number(trait.options) || 1) });
  return groups.map(group => ({ ...group, options: options.filter(option => (groups.length === 1)
    || (optionEffectOf(option, trait) === group.effect)) })).filter(group => group.options.length);
}

/** One printed line as HTML: escaped, its links made links. */
function lineHtml(text) {
  return Handlebars.escapeExpression(text).replace(LINK, (whole, label, url) =>
    `<a href="${url}" target="_blank" rel="noopener">${label}</a>`);
}

/**
 * The Options a Choice effect is read by: the Item's own - Warrior of Two Worlds' - or, where its Trait says `choiceOf:`,
 * those chosen on that other Trait of the character's (Eye of the Dragon's, by Quick to Master's Way).
 */
function choicePicked(item) {
  const of = getTrait(item?.flags?.["dbu-ttrpg"]?.sourceId ?? "")?.choiceOf;
  const source = of ? Array.from(item?.parent?.items ?? []).find(each => each.flags?.["dbu-ttrpg"]?.sourceId === of) : item;
  return (source?.system?.chosen ?? []).filter(entry => entry.key === "option").map(entry => getTrait(entry.value))
    .filter(Boolean);
}

/**
 * A Racial Trait Item's text as shown on the Traits tab: its printed lines, and where it has an Option effect, that line
 * with only what was chosen under it - "(3)-[Option]:" and the Option's own line - not the whole list (the user's).
 */
export function racialTraitLines(item) {
  const picked = (item?.system?.chosen ?? []).filter(entry => entry.key === "option")
    .map(entry => getTrait(entry.value)).filter(Boolean);
  const choices = choicePicked(item);
  const lines = printedLines(item?.system?.text || "");
  const out = [];
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at];
    const option = picked.length && OPTION_LINE.exec(line);
    // A Choice effect - "Depending on your choice for the Option effect of this Trait, gain the following effect" - shows
    // the one that goes with the Option chosen (Warrior of Two Worlds'), or with another Trait's (Eye of the Dragon's).
    const choice = choices.length && /^(\(\d+\)-\[Choice\]):/.exec(line);
    if (!option && !choice) {
      out.push({ html: lineHtml(line), bullet: /^[*\u2022]/.test(line), gap: !line });
      continue;
    }
    out.push({ html: lineHtml(`${(option || choice)[1]}:`), bullet: false, gap: false });
    // The list after it - blank lines around it, and what follows it up to the next effect (Construct's "You are
    // Unnatural") - read off, and left out but what was chosen.
    const list = [];
    while ((at + 1 < lines.length) && !/^\(\d+\)-/.test(lines[at + 1])) list.push(lines[++at]);
    if (option) {
      // Only this Option effect's own - Technological Being has two (the user's).
      for (const chosen of picked.filter(each => optionBelongs(each, item, Number(/\d+/.exec(option[1])[0])))) {
        out.push({ html: lineHtml(`*${printedLines(chosen.text).join(" ")}`), bullet: true, gap: false });
      }
    }
    else {
      for (const entry of list.filter(each => choices.some(chosen =>
        each.replace(/^[*\u2022]\s*/, "").startsWith(`${chosen.name} [`)))) {
        out.push({ html: lineHtml(entry), bullet: true, gap: false });
      }
    }
    if (list.length && !list[list.length - 1]) out.push({ html: "", bullet: false, gap: true });
  }
  return out;
}

/**
 * One printed effect of a Trait's (or Talent's) Item, as its text has it - "(4)-[Triggered, 1/Encounter]: When you target
 * ..." - for the hover wherever that effect is chosen (the user's). An Option or Choice effect with what was chosen for
 * it. "" where the text has no such line.
 */
export function effectLineOf(item, n) {
  const number = Number(n);
  if (!item || !number) return "";
  const lines = printedLines(item.system?.text || "");
  const at = lines.findIndex(line => line.startsWith(`(${number})-`));
  if (at < 0) return "";
  const line = lines[at];
  const kind = /^(\(\d+\)-\[(Option|Multi-Option\/\d+|Choice)\]):/.exec(line);
  const picked = (kind?.[2] === "Choice") ? choicePicked(item)
    : (item.system?.chosen ?? []).filter(entry => entry.key === "option").map(entry => getTrait(entry.value)).filter(Boolean);
  if (!kind || !picked.length) return plainText(line);
  if (kind[2] !== "Choice") {
    return plainText(`${kind[1]}: ${picked.filter(option => optionBelongs(option, item, number))
      .map(option => printedLines(option.text).join(" ")).join(" ")}`);
  }
  const bullets = lines.slice(at + 1).filter(each => /^[*\u2022]/.test(each))
    .map(each => each.replace(/^[*\u2022]\s*/, ""))
    .filter(each => picked.some(option => each.startsWith(`${option.name} [`)));
  return plainText(`${kind[1]}: ${bullets.join(" ")}`);
}

/** A triggered effect's printed line, from the registry entry offering it - its Item and its `effect N`. */
export function entryEffectLine(entry) {
  const item = entry?.sourceUuid ? fromUuidSync(entry.sourceUuid) : null;
  const n = entry?.program?.blocks?.[0]?.modifiers?.effect;
  if (n) return effectLineOf(item, n);
  // A text not written as numbered effects - an older Talent's, Power of the Z-Warrior's - is shown whole.
  const lines = printedLines(item?.system?.text || "");
  return lines.some(line => /^\(\d+\)-/.test(line)) ? "" : plainText(lines.join(" "));
}

/** A character's Trait's printed effect, by the Trait's id - its own Item's text, or the file's. */
export function traitEffectLine(actor, traitId, n) {
  const item = Array.from(actor?.items ?? []).find(each => each.flags?.["dbu-ttrpg"]?.sourceId === traitId);
  return effectLineOf(item ?? { system: { text: getTrait(traitId)?.text ?? "" } }, n);
}

/** A list header - `a, b` or a single value - as a list. */
const listOf = raw => [].concat(raw ?? []).flatMap(entry => String(entry).split(",")).map(id => id.trim()).filter(Boolean);

/** Every Racial Trait there is to take, a Racial Factor's Factor Traits with them - their Options are not. */
export function racialTraitFiles() {
  return [...traitsOfKind("races"), ...traitsOfKind("factors").filter(trait => trait.owner)]
    .filter(trait => !trait.optionOf);
}

/** A Racial Trait's Options - or a Talent's - in the order its text lists them (their `order:`), not by name (the user's). */
export function racialOptionsOf(id) {
  return [...traitsOfKind("races"), ...traitsOfKind("factors"), ...traitsOfKind("talents")].filter(trait => trait.optionOf === id)
    .sort((a, b) => (orderOf(a) - orderOf(b)) || a.name.localeCompare(b.name));
}

/** A Racial Factor, by its id - its own file, traits/factors/<factor>.dbu. */
export function racialFactor(id) {
  const factor = id ? getTrait(id) : null;
  return ((factor?.kind === "factors") && !factor.owner) ? factor : null;
}

/** A Racial Factor's name, from its id. */
export function factorName(id) {
  return racialFactor(id)?.name ?? id ?? "";
}

/** What a Racial Factor asks for, as its page lists it - shown, never enforced. */
export function factorSummary(id) {
  const factor = racialFactor(id);
  if (!factor) return "";
  const said = value => [].concat(value ?? []).join(", ").trim();
  return [plainText(factor.description ?? "").trim(),
    said(factor.requirement) ? `Racial Requirement: ${said(factor.requirement)}` : "",
    said(factor.maximumFactor) ? `Maximum Factor: ${said(factor.maximumFactor)}` : "",
    said(factor.prerequisites) ? `Prerequisite(s): ${said(factor.prerequisites)}` : "",
    plainText(said(factor.note))].filter(Boolean).join(" \u00b7 ");
}

/** The Factor a Trait's file or Item is a Factor Trait of, or "". */
function factorOf(trait) {
  if (trait?.system) return String(trait.system.factor ?? "");
  return (trait?.kind === "factors") ? String(trait.owner ?? "") : "";
}

/** A race, as the words a Factor's text names it by: its id and its name, lower case. */
function raceWords(race) {
  return [String(race ?? ""), raceName(race)].map(word => word.trim().toLowerCase()).filter(Boolean);
}

/**
 * A Racial Factor's Racial Requirement, read: "Any", with what it excepts - "Any (Except Android, Robot, or
 * Bio-Android)" - or the races it names ("Saiyan").
 */
function requirementOf(factor) {
  const text = [].concat(factor?.requirement ?? []).join(", ").trim();
  const names = list => list.split(/,|\bor\b|\band\b/i).map(each => each.trim().toLowerCase()).filter(Boolean);
  const any = /^any\b/i.exec(text);
  if (any) return { any: true, races: [], except: names((/\(except([^)]*)\)/i.exec(text) ?? [])[1] ?? "") };
  return { any: false, races: names(text), except: [] };
}

/**
 * Whether a Factor Trait is one this race may take, by its Factor's Racial Requirement, a race it is for alone ("Saiyan
 * Factor Trait") and its Factor's `nameExcludesRace` - Alternate Upbringing's "if your Race is in the name of that Factor
 * Trait". Only to order the list: nothing is refused (the user's).
 */
function factorTraitFits(factorId, onlyRace, name, race, slots = null) {
  const factor = racialFactor(factorId);
  const words = raceWords(race);
  if (!factor || !words.length) return false;
  if (onlyRace && !words.includes(String(onlyRace).toLowerCase())) return false;
  const { any, races, except } = requirementOf(factor);
  // "Gain the Alternate Upbringing Factor, ignoring its Racial Requirements" (Enhanced Organism's).
  const ignored = slots?.[`factor.ignoreRequirement.${factorId}`] === true;
  if (!ignored && (any ? except.some(each => words.includes(each)) : !races.some(each => words.includes(each)))) return false;
  if (factor.nameExcludesRace && words.includes(String(name ?? "").replace(/-Raised$/i, "").trim().toLowerCase())) return false;
  return true;
}

/**
 * Where a Trait's group stands (the user's order): this character's race's; then the Racial Factors for their race alone,
 * and those for any race they may take; then every other race's; then every other Racial Factor's.
 */
function groupRank(trait, race, slots = null) {
  const factor = factorOf(trait);
  if (!factor) return (((trait?.system ? trait.system.race : trait?.owner) ?? "") === race) ? 0 : 3;
  const onlyRace = trait?.system ? trait.system.race : trait?.race;
  if (!factorTraitFits(factor, onlyRace, trait?.name, race, slots)) return 4;
  return requirementOf(racialFactor(factor)).any ? 2 : 1;
}

/** Its group's name, to order by: the race's, or the Racial Factor's. */
function groupName(trait) {
  const factor = factorOf(trait);
  return factor ? factorName(factor) : raceName(trait?.system ? trait.system.race : trait?.owner);
}

/** A race's display name, from its id. */
export function raceName(id) {
  return getRace(id)?.name ?? id ?? "";
}

/** 1st, 2nd, 3rd, 4th ... */
export function ordinal(n) {
  const tens = n % 100;
  const suffix = ((tens >= 11) && (tens <= 13)) ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th");
  return `${n}${suffix}`;
}

/** Where a Racial Trait stands among its race's - its `order:`, as the race's page prints them; unnumbered ones last. */
function orderOf(trait) {
  const order = Number(trait?.order);
  return Number.isFinite(order) ? order : Number.MAX_SAFE_INTEGER;
}

/**
 * Every Racial Trait there is, in the order the picker and the list show them (the user's): this character's race's; the
 * Racial Factors for their race alone, then those for any race they may take; every other race's; every other Racial
 * Factor's - races and Factors each by their own name (not the Trait's), each one's Traits in the order its page prints
 * them.
 */
/**
 * Why a Racial Trait is not one this character would take, or "" - another race's, a Racial Factor whose Racial
 * Requirement they do not meet, another Subrace's. Only said, and shown dimmed on the Add Racial Trait list: it may be
 * taken all the same (the user's).
 */
export function racialTraitUnfit(trait, race, subrace = "", slots = null) {
  const rank = groupRank(trait, race, slots);
  if (rank === 3) return "Another race's";
  if (rank === 4) return "Its Racial Factor's Racial Requirement is not met";
  if (trait?.subrace && subrace && (trait.subrace !== subrace)) return "Another Subrace's";
  return "";
}

/** The same for an Other Trait: Evolution Traits are the Arcosians' alone (the user's). */
export function otherTraitUnfit(trait, race) {
  return ((trait?.owner === "evolution") && (race !== "arcosian")) ? "Arcosians' alone" : "";
}

export function racialTraitsInOrder(race, traits = racialTraitFiles(), slots = null) {
  return traits.slice().sort((a, b) =>
    (groupRank(a, race, slots) - groupRank(b, race, slots))
    || groupName(a).localeCompare(groupName(b))
    || (orderOf(a) - orderOf(b))
    || a.name.localeCompare(b.name));
}

/** What the rules call a Racial Trait: its Category (Body/Mind), and Primary or Secondary - a Subrace's is Primary. */
export function racialTraitKind(trait) {
  const importance = trait?.subrace ? "primary" : String(trait?.importance ?? "");
  return [String(trait?.category ?? ""), importance].filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" · ");
}

/**
 * The race (and Subrace) a Racial Trait belongs to, as read - a Factor Trait's Racial Factor, "Ancient Saiyan (Factor)",
 * and the race it is for alone where it is: "Mutation (Factor) - Saiyan".
 */
export function racialTraitRace(race, subrace = "", factor = "") {
  if (factor) return [`${factorName(factor)} (Factor)`, race ? raceName(race) : ""].filter(Boolean).join(" - ");
  return [raceName(race), subrace ? (subraceName(race, subrace) || subrace) : ""].filter(Boolean).join(" - ");
}

/** The Racial Trait Items a character has, in the picker's order: own race's first, then by race name, then as printed. */
export function ownedRacialTraits(actor) {
  const race = actor?.system?.race;
  const fileOf = item => getTrait(item.flags?.["dbu-ttrpg"]?.sourceId ?? "");
  return Array.from(actor?.items ?? []).filter(item => (item.type === RACIAL_TYPE) && !isOtherTrait(item)).sort((a, b) =>
    (groupRank(a, race, actor?.system?.effects?.slots) - groupRank(b, race, actor?.system?.effects?.slots))
    || groupName(a).localeCompare(groupName(b))
    || (orderOf(fileOf(a)) - orderOf(fileOf(b)))
    || a.name.localeCompare(b.name));
}

/**
 * The Other Traits' groups, as their lists name them: Evolution Traits are the Arcosians' own; Vocations are any race's -
 * Vocation Training gives one, and so does Konatsian-Raised (the user's).
 */
export const OTHER_GROUPS = Object.freeze({
  evolution: "Evolution · Arcosian",
  vocation: "Vocation",
  bestial: "Bestial",
  monstrous: "Monstrous"
});

/** An Other Trait's group, as named - or the folder's name where it is a new one. */
export function otherGroupName(group) {
  const key = String(group ?? "");
  return OTHER_GROUPS[key] ?? (key.charAt(0).toUpperCase() + key.slice(1));
}

/** Whether a racial Item is an Other Trait - Evolution, Bestial, Monstrous - by its group or its file's folder. */
export function isOtherTrait(item) {
  return Boolean(item?.system?.other) || (getTrait(item?.flags?.["dbu-ttrpg"]?.sourceId ?? "")?.kind === "other");
}

/** The Other Traits a character has: by group, as named above, then by name. */
export function ownedOtherTraits(actor) {
  const group = item => item.system?.other || getTrait(item.flags?.["dbu-ttrpg"]?.sourceId ?? "")?.owner || "";
  const rank = item => { const at = Object.keys(OTHER_GROUPS).indexOf(group(item)); return (at < 0) ? 99 : at; };
  return Array.from(actor?.items ?? []).filter(item => (item.type === RACIAL_TYPE) && isOtherTrait(item))
    .sort((a, b) => (rank(a) - rank(b)) || a.name.localeCompare(b.name));
}

/** Every Other Trait there is, for its picker: by group, then by name. */
export function otherTraitsInOrder() {
  const rank = trait => { const at = Object.keys(OTHER_GROUPS).indexOf(trait.owner ?? ""); return (at < 0) ? 99 : at; };
  return traitsOfKind("other").slice().sort((a, b) => (rank(a) - rank(b)) || a.name.localeCompare(b.name));
}

/** A label as a choice's value: "Enormous" -> "enormous". */
const slug = label => String(label ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** What a `choose:` header offers, as [value, label] pairs. */
async function choicesFor(kind, source = null, { actor = null, earlier = [] } = {}) {
  // A Skill, any - or one the character has 2+ Skill Ranks in, the Rank just chosen counted (Functional Purpose's) - less
  // what `chooseExcept:` names ("You cannot choose Perception for either choice").
  if ((kind === "skill") || (kind === "skillRanked")) {
    const { default: DBUCharacterData } = await import("./data/actor-character.mjs");
    const except = new Set(listOf(source?.chooseExcept).map(each => each.toLowerCase()));
    // Or only those of one Attribute - Intelligent Fighter's "a Skill that uses Insight as its Attribute".
    const attribute = String(source?.chooseAttribute ?? "").trim().toLowerCase();
    const ranks = key => (Number(actor?.system?.skills?.[key]?.ranks) || 0) + earlier.filter(each => each === key).length;
    return Object.entries(DBUCharacterData.SKILLS).filter(([key]) => !except.has(key.toLowerCase()))
      .filter(([, skill]) => !attribute || (skill.attribute === attribute))
      .filter(([key]) => (kind === "skill") || (ranks(key) >= 2))
      // A second Skill chosen after a first is another one - Practiced's "2 different Skills".
      .filter(([key]) => (kind !== "skill") || !earlier.includes(key))
      .map(([key, skill]) => [key, skill.label]);
  }
  // Its own list, written beside it - `choices: Tiny, Enormous` (Alternate Scale Structure's).
  if (kind === "list") return listOf(source?.choices).map(label => [slug(label), label]);
  // "Select an additional Saving Throw to apply your Racial Saving Throw Bonus to" (Enhanced Organism's).
  if (kind === "savingThrow") {
    const { default: DBUCharacterData } = await import("./data/actor-character.mjs");
    return Object.keys(DBUCharacterData.SAVING_THROWS).map(key => [key, key.charAt(0).toUpperCase() + key.slice(1)]);
  }
  if (kind === "knowledge") {
    const { default: DBUCharacterData } = await import("./data/actor-character.mjs");
    return Object.entries(DBUCharacterData.SKILLS).filter(([key]) => key.startsWith("knowledge"))
      .map(([key, skill]) => [key, skill.label]);
  }
  // Profile Focus: "a Profile from your Focused Foundation" - Archetype Focus's, where it is had; any Profile where it is not.
  if (kind === "focusedProfile") {
    const { PROFILES } = await import("./maneuvers.mjs");
    const focus = Array.from(actor?.items ?? []).find(item => (item.type === "talent")
      && (item.flags?.["dbu-ttrpg"]?.sourceId === "archetype-focus"));
    const foundation = (focus?.system?.chosen ?? []).find(entry => entry.key === "archetype-focus")?.value ?? "";
    return Object.entries(PROFILES).filter(([, profile]) => profile.label && Array.isArray(profile.foundations)
      && (!foundation || profile.foundations.includes(foundation))).map(([key, profile]) => [key, profile.label]);
  }
  if (kind === "elementalProfile") {
    const { PROFILES } = await import("./maneuvers.mjs");
    return Object.entries(PROFILES).filter(([, profile]) => /elemental/i.test(profile.label ?? ""))
      .map(([key, profile]) => [key, profile.label]);
  }
  return [];
}

/** Ask a `choose:` - one of its values, or null when backed out of. */
async function askChoice(source, kind = source.choose, context = {}) {
  const offered = await choicesFor(kind, source, context);
  if (!offered.length) {
    ui.notifications.warn(`${source.name}: nothing to choose for "${kind}".`);
    return null;
  }
  const escape = Handlebars.escapeExpression;
  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: source.name },
    content: `<select name="choice">${offered.map(([value, label]) =>
      `<option value="${escape(value)}">${escape(label)}</option>`).join("")}</select>`,
    buttons: [
      { action: "confirm", label: "Choose", default: true,
        callback: (event, button, dialog) => dialog.element.querySelector('select[name="choice"]')?.value ?? "" },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });
  const pair = offered.find(([value]) => value === chosen);
  return pair ? { value: pair[0], label: pair[1] } : null;
}

/** Ask an Option effect: "choose one of the following effects" - or two, a Multi-Option's. The ids chosen, or null. */
async function askOptions(trait, options, count = Math.max(1, Number(trait.options) || 1), effect = 0) {
  const escape = Handlebars.escapeExpression;
  const type = (count === 1) ? "radio" : "checkbox";
  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: `${trait.name} - ${effect ? `${ordinal(effect)} effect` : "Option"}` },
    position: { width: 460 },
    content: `<p class="dbu-respond-hint">Choose ${count}.</p>${options.map((option, index) => `
      <label class="dbu-respond-option" data-tooltip="${escape(plainText(option.text ?? option.description ?? ""))}">
        <input type="${type}" name="option" value="${escape(option.id)}" ${(index === 0) && (count === 1) ? "checked" : ""}/>
        <span class="dbu-respond-name">${escape(option.name)}</span>
        <span class="dbu-respond-source">${escape(plainText(option.description ?? ""))}</span></label>`).join("")}`,
    buttons: [
      { action: "confirm", label: "Choose", default: true, callback: (event, button, dialog) =>
        [...dialog.element.querySelectorAll('input[name="option"]:checked')].map(input => input.value) },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });
  if (!Array.isArray(chosen)) return null;
  if (chosen.length !== count) {
    ui.notifications.warn(`${trait.name}: choose ${count}.`);
    return null;
  }
  return chosen;
}

/**
 * A Talent's `choose:` answered as it is gained (Elementalist's), and its Option effects as a Racial Trait's are (Show Stopping
 * Performance's "Upon gaining this Talent, select an effect"): its Item's data with the scripts written in and the choices
 * kept - or null when backed out of. One with nothing to choose, as it was.
 */
export async function answeredTalent(data, trait, actor) {
  const groups = optionGroupsOf(trait);
  if (!trait?.choose && !groups.length) return data;
  const chosen = [];
  const script = await answered({ ...trait, script: data.system.script }, chosen, actor);
  if (script === null) return null;
  const scripts = [script];
  for (const group of groups) {
    const picked = await askOptions(trait, group.options, group.count, group.effect);
    if (!picked) return null;
    for (const id of picked) {
      const option = group.options.find(entry => entry.id === id);
      chosen.push({ key: "option", value: option.id, label: option.name });
      const own = await answered(option, chosen, actor);
      if (own === null) return null;
      scripts.push(`#@ option ${option.id} | ${option.name}\n${own}\n#@ end`);
    }
  }
  return { ...data, system: { ...data.system, script: scripts.filter(Boolean).join("\n\n"), chosen } };
}

/**
 * What a Trait's or a Talent's own `choose:` (and `choose2:`) was answered with, as rows its sheet can change: which, what
 * is chosen, and what may be. The Option's own choices are its Option's, not these.
 */
export async function choiceRowsOf(item) {
  const file = getTrait(item?.flags?.["dbu-ttrpg"]?.sourceId ?? "");
  if (!file?.choose) return [];
  const actor = item.actor ?? null;
  const chosen = item.system.chosen ?? [];
  const first = chosen.find(entry => entry.key === file.id)?.value ?? "";
  const second = chosen.find(entry => entry.key === `${file.id}#2`)?.value ?? "";
  const row = async (which, kind, current, earlier) => ({ which, current,
    label: (which === 2) ? "2nd choice" : (file.choose2 ? "1st choice" : "Choice"),
    options: (await choicesFor(kind, file, { actor, earlier }))
      // What it has now stays offered, whatever the list says of it today.
      .concat((current && !(await choicesFor(kind, file, { actor, earlier })).some(([value]) => value === current))
        ? [[current, chosen.find(entry => entry.value === current)?.label?.split(": ").pop() ?? current]] : [])
      .map(([value, label]) => ({ value, label, selected: value === current })) });
  return [await row(1, file.choose, first, second ? [second] : []),
    ...(file.choose2 ? [await row(2, file.choose2, second, first ? [first] : [])] : [])];
}

/**
 * A choice changed on the sheet: the Item's own script written again from its file with the new answer, the Options' blocks
 * after it kept as they were, and what was chosen recorded. False where nothing changed.
 */
export async function changeChoice(item, which, value) {
  const file = getTrait(item?.flags?.["dbu-ttrpg"]?.sourceId ?? "");
  if (!file?.choose || !value) return false;
  const key = (which === 2) ? `${file.id}#2` : file.id;
  const kind = (which === 2) ? file.choose2 : file.choose;
  const offered = await choicesFor(kind, file, { actor: item.actor ?? null });
  const label = offered.find(([each]) => each === value)?.[1] ?? value;
  const chosen = [...(item.system.chosen ?? []).filter(entry => entry.key !== key), { key, value, label: `${file.name}: ${label}` }];
  const first = chosen.find(entry => entry.key === file.id)?.value ?? "";
  const second = chosen.find(entry => entry.key === `${file.id}#2`)?.value ?? "";
  // Its own part: the file's script with both answers written in - a list's flags too.
  let own = String(file.script ?? "").trim();
  if (second) own = own.replaceAll("$choice2", second);
  const flags = (file.choose === "list") ? (await choicesFor("list", file)).map(([each]) => each).sort((a, b) => b.length - a.length) : [];
  own = flags.reduce((text, each) => text.replaceAll(`$${each}`, (each === first) ? "1" : "0"), own.replaceAll("$choice", first));
  // And what an Option put after it, as it is.
  const script = String(item.system.script ?? "");
  const at = script.indexOf("#@ option");
  const tail = (at >= 0) ? `

${script.slice(at).trim()}` : "";
  await item.update({ "system.script": `${own}${tail}`, "system.chosen": chosen });
  return true;
}

/** A part's script with its `choose:` answered - `$choice` replaced - and the choice recorded. */
async function answered(source, chosen, actor = null) {
  let script = String(source.script ?? "").trim();
  if (!source.choose) return script;
  const choice = await askChoice(source, source.choose, { actor });
  if (!choice) return null;
  chosen.push({ key: source.id, value: choice.value, label: `${source.name}: ${choice.label}` });
  // A second choice after it - `choose2:`, `$choice2` - asked with the first known (Functional Purpose's).
  if (source.choose2) {
    const second = await askChoice(source, source.choose2, { actor, earlier: [choice.value] });
    if (!second) return null;
    chosen.push({ key: `${source.id}#2`, value: second.value, label: `${source.name}: ${second.label}` });
    script = script.replaceAll("$choice2", second.value);
  }
  // A list's: each of its values a number too - `$tiny` 1 where Tiny was chosen, 0 where it was not.
  const flags = (source.choose === "list") ? (await choicesFor("list", source)).map(([value]) => value)
    .sort((a, b) => b.length - a.length) : [];
  return flags.reduce((text, value) => text.replaceAll(`$${value}`, (value === choice.value) ? "1" : "0"),
    script.replaceAll("$choice", choice.value));
}

/**
 * A Racial Trait's file, as the Item a character takes - its Option and choices asked now ("At Character Creation,
 * choose ..."), their scripts written into its own. Null if backed out of anywhere.
 *
 * @returns {Promise<?{data: object, grants: {unique: {id: string, restrictions: string[]}[], talents: string[]}}>}
 */
export async function racialItemFrom(trait, actor = null) {
  const chosen = [];
  const own = await answered(trait, chosen, actor);
  if (own === null) return null;
  const scripts = [own];
  const texts = [];
  const unique = listOf(trait.grantsUnique).map(id => ({ id, restrictions: listOf(trait.uniqueRestrictions),
    insteadTp: Number(trait.grantsUniqueInstead) || 0 }));
  const talents = listOf(trait.grantsTalent);
  // One chosen of a TP Cost or less - the Trait's own (Denizen of the Demon Realm's) or an Option's (Riches of Mysticism's).
  let uniqueChoice = Number(trait.grantsUniqueChoice) || 0;
  let uniqueChoiceType = String(trait.grantsUniqueChoiceType ?? "");

  // Each Option effect in turn - Technological Being's (2) one, then (3) two.
  for (const group of optionGroupsOf(trait)) {
    const options = group.options;
    const picked = await askOptions(trait, options, group.count, group.effect);
    if (!picked) return null;
    for (const id of picked) {
      const option = options.find(entry => entry.id === id);
      chosen.push({ key: "option", value: option.id, label: option.name });
      const script = await answered(option, chosen);
      if (script === null) return null;
      scripts.push(`#@ option ${option.id} | ${option.name}\n${script}\n#@ end`);
      texts.push(`${option.name}: ${String(option.text ?? "").trim()}`);
      unique.push(...listOf(option.grantsUnique).map(each => ({ id: each, restrictions: listOf(option.uniqueRestrictions),
        option: option.id, advancements: listOf(option.uniqueAdvancements) })));
      talents.push(...listOf(option.grantsTalent));
      if (Number(option.grantsUniqueChoice) > 0) {
        uniqueChoice = Number(option.grantsUniqueChoice);
        uniqueChoiceType = String(option.grantsUniqueChoiceType ?? "");
      }
    }
  }

  return {
    data: {
      name: trait.name,
      type: RACIAL_TYPE,
      img: trait.img || "icons/sundries/books/book-red-exclamation.webp",
      flags: { "dbu-ttrpg": { sourceId: trait.id } },
      system: {
        description: trait.description ?? "",
        text: trait.text ?? "",
        // Its Addendum effect's text box, as written - shown in the Item's Options tab (the user's).
        addendum: String(trait.addendum ?? "").trim(),
        script: scripts.filter(Boolean).join("\n\n"),
        // A Factor Trait's: the race it is for alone ("Saiyan Factor Trait"), where it is for one.
        race: factorOf(trait) ? String(trait.race ?? "") : ((trait.kind === "other") ? "" : (trait.owner ?? "")),
        category: String(trait.category ?? ""),
        importance: trait.subrace ? "primary" : String(trait.importance ?? ""),
        subrace: String(trait.subrace ?? ""),
        factor: factorOf(trait),
        // An Other Trait's group - its folder: Evolution, Bestial, Monstrous.
        other: (trait.kind === "other") ? String(trait.owner ?? "") : "",
        chosen
      }
    },
    grants: { unique, talents,
      // Denizen of the Demon Realm's: one of that type and TP Cost or less, chosen.
      uniqueChoice, uniqueChoiceType }
  };
}

/**
 * Add a Racial Trait to a character: its Item, and what it gives - each Unique Ability free and without its
 * Requirements, marked as given by it so it goes with it; each Talent, kept if it is ever lost. One already held is not
 * given twice; a Talent or Unique Ability not written yet is named.
 */
export async function addRacialTrait(actor, trait, { grantedBy = "" } = {}) {
  const made = await racialItemFrom(trait, actor);
  if (!made) return null;
  // Personified Dragon Ball: "select a set of Dragon Balls (including a Size Category from Nano to Small) and a number of
  // stars from among them".
  if (trait.dragonBall) {
    const ball = await askDragonBall(trait);
    if (!ball) return null;
    made.data.flags["dbu-ttrpg"].dragonBall = ball;
  }
  // Given by another - Bestial Evolution's Bestial Trait - it goes with that one.
  if (grantedBy) made.data.flags["dbu-ttrpg"].grantedBy = grantedBy;
  const [item] = await actor.createEmbeddedDocuments("Item", [made.data]);
  if (!item) return null;
  await giveGrants(actor, item, made.grants, trait.name);
  await automateAll(actor, item);
  // A Special Item it makes - Neko Majin-Dama's: "At Character Creation, create a Majin-Dama Special Accessory, which is
  // Integrated into your Character".
  for (const gearId of listOf(trait.grantsGear)) {
    const { MAJIN_DAMA, damaItemData } = await import("./majin-dama.mjs");
    if (gearId !== MAJIN_DAMA) continue;
    const data = await damaItemData(actor, { grantedBy: item.id });
    if (data) await actor.createEmbeddedDocuments("Item", [data]);
  }
  // Natural Armor it gives - Survivor's Plating - made before its Options, which may put a Quality on it.
  if (trait.naturalArmor) await (await import("./natural-armor.mjs")).grantNaturalArmor(actor, item, String(trait.naturalArmor));
  for (const option of chosenOptions(item)) await madeByOption(actor, item, option);
  if (trait.defaultCostume) await askDefaultCostume(actor);
  // An Other Trait it gives, chosen now - Bestial Evolution's "Select and gain a Bestial Trait of your choice".
  // Fallen Idol's two: one of each group it names.
  // Feline Build's: two, of the four it names.
  const from = listOf(trait.grantsOtherFrom);
  for (const group of listOf(trait.grantsOther)) {
    for (let n = 0; n < Math.max(1, Number(trait.grantsOtherCount) || 1); n++) await grantOtherTrait(actor, item, group, from);
  }
  return item;
}

/** The Dragon Ball set asked for - its name, Size Category and stars - or null if backed out of. */
async function askDragonBall(trait) {
  const sizes = [["nano", "Nano"], ["tiny", "Tiny"], ["small", "Small"]];
  const answer = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"], window: { title: `${trait.name} - your Dragon Ball` },
    content: `<label class="dbu-respond-option"><span class="dbu-respond-name">Set</span>
        <input type="text" name="set" value="" placeholder="Which set of Dragon Balls"/></label>
      <label class="dbu-respond-option"><span class="dbu-respond-name">Size Category</span>
        <select name="size">${sizes.map(([key, label]) => `<option value="${key}">${label}</option>`).join("")}</select></label>
      <label class="dbu-respond-option"><span class="dbu-respond-name">Stars</span>
        <input type="number" name="stars" value="1" min="1" max="7"/></label>`,
    buttons: [{ action: "take", label: "Confirm", default: true, callback: (event, button, dialog) => ({
      set: String(dialog.element.querySelector('[name="set"]')?.value ?? "").trim(),
      size: dialog.element.querySelector('[name="size"]')?.value ?? "small",
      stars: Math.min(7, Math.max(1, Math.floor(Number(dialog.element.querySelector('[name="stars"]')?.value) || 1))) }) },
      { action: "cancel", label: "Cancel" }],
    rejectClose: false
  });
  return (answer && (typeof answer === "object")) ? answer : null;
}

/**
 * An Other Trait of one group given by a Trait - "Select and gain a Bestial Trait of your choice while you have this
 * Evolution Trait": the ones not had, offered; the one chosen made, given by it, so it is taken off with it. None written
 * yet, or none chosen, it is said - and one can be added by hand from the Other Traits list.
 */
async function grantOtherTrait(actor, item, group, from = []) {
  const had = new Set(actor.system?.racialTraits ?? []);
  const offered = traitsOfKind("other", group).filter(trait => !had.has(trait.id) && (!from.length || from.includes(trait.id)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const name = otherGroupName(group);
  if (!offered.length) {
    ui.notifications.info(`${item.name}: there are no ${name} Traits to choose from yet.`);
    return null;
  }
  const escape = Handlebars.escapeExpression;
  const picked = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"], window: { title: `${item.name} - a ${name} Trait` },
    content: `<label class="dbu-respond-option"><span class="dbu-respond-name">${escape(name)} Trait</span>
      <select name="other">${offered.map(trait => `<option value="${escape(trait.id)}">${escape(trait.name)}</option>`)
        .join("")}</select></label>`,
    buttons: [
      { action: "take", label: "Gain", default: true,
        callback: (event, button, dialog) => dialog.element.querySelector('[name="other"]')?.value ?? "" },
      { action: "later", label: "Later, by hand" }],
    rejectClose: false
  });
  const trait = offered.find(entry => entry.id === picked);
  return trait ? addRacialTrait(actor, trait, { grantedBy: item.id }) : null;
}

/**
 * Majin Style's Default Costume: "create a piece of Apparel with a Craftsmanship Grade of 2 and no Apparel Qualities" - or,
 * the user's, one of the Apparel already had picked to be it. Marked, and nothing else: what is spent on it is the
 * player's, by hand.
 */
async function askDefaultCostume(actor) {
  const apparel = Array.from(actor.items ?? []).filter(item => (item.type === "gear") && (item.system?.crafted?.kind === "apparel"));
  const marked = apparel.find(item => item.getFlag?.("dbu-ttrpg", "defaultCostume"));
  if (marked) return marked;
  const choice = apparel.length ? await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"], window: { title: "Majin Style - Default Costume" }, content: "",
    buttons: [...apparel.map(item => ({ action: item.id, label: item.name })), { action: "new", label: "A new one (Grade 2)" }],
    rejectClose: false
  }) : "new";
  if (!choice) return null;
  if (choice !== "new") {
    const picked = actor.items.get(choice);
    await picked?.setFlag("dbu-ttrpg", "defaultCostume", true);
    return picked;
  }
  const { craftedItemFrom } = await import("./gear.mjs");
  const data = craftedItemFrom("apparel", actor, getTrait);
  if (!data) return null;
  data.name = "Default Costume";
  data.system.crafted.grade = 2;
  data.flags = { ...(data.flags ?? {}), "dbu-ttrpg": { ...(data.flags?.["dbu-ttrpg"] ?? {}), defaultCostume: true } };
  const [costume] = await actor.createEmbeddedDocuments("Item", [data]);
  return costume;
}

/** A Unique Ability given by a Racial Trait: free, marked as given by it. */
function freeUnique(uniqueItemFrom, definition, item, { applied = [], chosenType = "" } = {}) {
  const data = uniqueItemFrom(definition, traitsOfKind("unique", definition.id), { chosenType, applied, choices: {} });
  data.system.unique.free = true;
  data.flags = { ...(data.flags ?? {}), "dbu-ttrpg": { ...(data.flags?.["dbu-ttrpg"] ?? {}), grantedBy: item.id } };
  return data;
}

/** A Unique Ability of that type and TP Cost or less, not had, chosen - or null (Denizen of the Demon Realm's). */
async function askUniqueChoice(actor, name, most, held, type = "") {
  const offered = traitsOfKind("unique").filter(each => !each.owner && !held.has(each.id)
    && ((Number(each.tpCost) || 0) <= most) && (!type || [type, "both"].includes(each.uaType)))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!offered.length) return null;
  const escape = Handlebars.escapeExpression;
  const said = value => [].concat(value ?? []).join(", ");
  const id = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"], window: { title: `${actor.name} - ${name}` },
    content: `<p class="dbu-respond-hint">A ${type ? `${type.charAt(0).toUpperCase()}${type.slice(1)} ` : ""}Unique Ability of ${most} TP or less.</p>
      <select name="unique">${offered.map(each => `<option value="${escape(each.id)}">${escape(`${each.name} - ${
        Number(each.tpCost) || 0} TP${said(each.prerequisite) ? ` - ${said(each.prerequisite)}` : ""}`)}</option>`).join("")}</select>`,
    buttons: [{ action: "take", label: "Take it", default: true,
      callback: (event, button, dialog) => dialog.element.querySelector('select[name="unique"]')?.value ?? null },
      { action: "cancel", label: "Later, by hand" }],
    rejectClose: false
  });
  return offered.find(each => each.id === id) ?? null;
}

/** One Unique Ability of that TP Cost or less, not had, chosen in place of one already had - or null. */
async function askUniqueInstead(actor, had, most, held) {
  const offered = traitsOfKind("unique").filter(each => !each.owner && !held.has(each.id)
    && ((Number(each.tpCost) || 0) <= most)).sort((a, b) => a.name.localeCompare(b.name));
  if (!offered.length) return null;
  const escape = Handlebars.escapeExpression;
  const said = value => [].concat(value ?? []).join(", ");
  const id = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"], window: { title: `${actor.name} already has ${had.name}` },
    content: `<p class="dbu-respond-hint">A Unique Ability of ${most} TP or less instead.</p>
      <select name="unique">${offered.map(each => `<option value="${escape(each.id)}">${escape(`${each.name} - ${
        Number(each.tpCost) || 0} TP${said(each.prerequisite) ? ` - ${said(each.prerequisite)}` : ""}`)}</option>`).join("")}</select>`,
    buttons: [{ action: "take", label: "Take it", default: true,
      callback: (event, button, dialog) => dialog.element.querySelector('select[name="unique"]')?.value ?? null },
      { action: "cancel", label: "None" }],
    rejectClose: false
  });
  return offered.find(each => each.id === id) ?? null;
}

/**
 * What a Racial Trait gives, made on the character: each Unique Ability free and without its Requirements, marked as given
 * by it (and by which Option, where one gave it); each Talent, kept if the Trait is ever lost.
 */
async function giveGrants(actor, item, grants, name) {
  const { uniqueItemFrom, isUniqueAbility } = await import("./unique.mjs");
  const held = new Set(Array.from(actor.items).filter(isUniqueAbility).map(each => each.system.unique?.libraryId));
  const created = [];
  for (const grant of grants.unique) {
    const definition = getTrait(grant.id);
    if (!definition || (definition.kind !== "unique") || definition.owner) {
      ui.notifications.warn(`${name}: the ${grant.id} Unique Ability is not written yet.`);
      continue;
    }
    if (held.has(definition.id)) {
      // Psychic's: "If you already had access to that Unique Ability, you may instead gain access to a Unique Ability with a
      // TP Cost of 20 or less that you meet the Prerequisites for" - which, asked; its Prerequisites shown, the table's.
      const instead = grant.insteadTp ? await askUniqueInstead(actor, definition, grant.insteadTp, held) : null;
      if (!instead) {
        ui.notifications.info(`${actor.name} already has ${definition.name}.`);
        continue;
      }
      created.push(freeUnique(uniqueItemFrom, instead, item, { applied: [] }));
      held.add(instead.id);
      continue;
    }
    let chosenType = "";
    if (definition.uaType === "both") {
      chosenType = await foundry.applications.api.DialogV2.wait({
        classes: ["dbu-dialog"],
        window: { title: `${definition.name} - Type` },
        content: "",
        buttons: [{ action: "technical", label: "Technical" }, { action: "magical", label: "Magical" }],
        rejectClose: false
      });
      if (!["technical", "magical"].includes(chosenType)) chosenType = "magical";
    }
    const data = uniqueItemFrom(definition, traitsOfKind("unique", definition.id),
      { chosenType, applied: grant.restrictions, choices: {} });
    data.system.unique.free = true;
    // And an Advancement on it, bought and free - Bestower's Unleash Dormant Power (`uniqueAdvancements`).
    if (grant.advancements?.length) {
      data.system.unique.advancements = (data.system.unique.advancements ?? []).map(entry => grant.advancements.includes(entry.key)
        ? { ...entry, bought: true, free: true } : entry);
    }
    data.flags = { ...(data.flags ?? {}), "dbu-ttrpg": { ...(data.flags?.["dbu-ttrpg"] ?? {}), grantedBy: item.id,
      ...(grant.option ? { grantedByOption: grant.option } : {}) } };
    created.push(data);
    held.add(definition.id);
  }

  // "Select any Magical Unique Ability with a TP Cost of 30 or less ... You gain access to that Unique Ability while you
  // possess this Trait" (Denizen of the Demon Realm's) - which, asked; its Prerequisites shown, the table's.
  if (grants.uniqueChoice) {
    const picked = await askUniqueChoice(actor, name, grants.uniqueChoice, held, grants.uniqueChoiceType);
    if (picked) {
      created.push(freeUnique(uniqueItemFrom, picked, item,
        { chosenType: (picked.uaType === "both") ? (grants.uniqueChoiceType || "") : "" }));
      held.add(picked.id);
    }
  }

  const { talentItemFrom } = await import("./talents.mjs");
  const talentsHeld = new Set(Array.from(actor.items).filter(each => each.type === "talent")
    .map(each => each.flags?.["dbu-ttrpg"]?.sourceId));
  for (const id of grants.talents) {
    const talent = getTrait(id);
    if (!talent || (talent.kind !== "talents")) {
      ui.notifications.warn(`${name}: the ${id} Talent is not written yet.`);
      continue;
    }
    if (talentsHeld.has(id)) continue;
    // Marked as a Racial Trait's: the Progression tab neither offers it nor takes it away.
    const data = await answeredTalent(talentItemFrom(talent), talent, actor);
    if (!data) continue;
    data.flags["dbu-ttrpg"].fromTrait = item.flags?.["dbu-ttrpg"]?.sourceId ?? item.id;
    created.push(data);
  }
  if (!created.length) return;
  // Its Triggered effects start Automatic, each in turn - the list is one flag.
  for (const made of (await actor.createEmbeddedDocuments("Item", created)) ?? []) {
    if (made.type === "talent") await automateAll(actor, made);
  }
}

/**
 * The Triggered effects of a Racial Trait Item that the Traits tab toggles between Triggered and Automatic - not those a
 * window offers as they happen, nor those that cost Actions (a moment's card takes and pays for them) - as block ids.
 */
export async function toggledBlocks(item) {
  const { compile } = await import("./effects/parser.mjs");
  const { chosenAsItHappens } = await import("./effects/registry.mjs");
  return (compile(item?.system?.script ?? "").program?.blocks ?? [])
    .filter(block => (block.mode === "triggered") && !block.budget?.actions && !chosenAsItHappens(block))
    .map(block => `${item.id}#${block.index}`);
}

/** Gained - or its Option changed - its toggles start Automatic (the user's). A Talent's too. */
export async function automateAll(actor, item) {
  const ids = await toggledBlocks(item);
  if (!actor || !ids.length) return;
  await actor.setFlag("dbu-ttrpg", "automatic", [...new Set([...(actor.getFlag("dbu-ttrpg", "automatic") ?? []), ...ids])]);
}

/**
 * The Option a block of a Racial Trait Item's script came from - the name its `#@ option` marker gives - or "" where it is
 * the Trait's own. Blocks are counted by their headers, a line opening "[" - as the parser numbers them, from 1.
 */
export function optionNameOfBlock(item, index) {
  const script = String(item?.system?.script ?? "");
  const parts = script.split(/(#@ option [^\n]*\n[\s\S]*?\n#@ end)/);
  let counted = 0;
  for (const part of parts) {
    const blocks = (part.match(/^\[[a-z]/gim) ?? []).length;
    if (index <= counted + blocks) return /^#@ option [^|\n]*\|\s*([^\n]*)/.exec(part)?.[1]?.trim() ?? "";
    counted += blocks;
  }
  return "";
}

/**
 * Whether more than one Option is chosen under this Item's effect `n` - a Multi-Option's - so that one of their buttons is
 * named by its Option rather than by the shared line (the user's: Calculating Style beside Surging Power).
 */
export function sharedOptionEffect(item, n) {
  return Boolean(n) && (chosenOptions(item).filter(option => optionBelongs(option, item, Number(n))).length > 1);
}

/** Every Option chosen on a Racial Trait Item, as their files. */
export function chosenOptions(item) {
  return (item?.system?.chosen ?? []).filter(entry => entry.key === "option").map(entry => getTrait(entry.value)).filter(Boolean);
}

/**
 * What an Option makes as it is chosen: Weapon Ports' "At Character Creation, create 2 Weapons with a Craftsmanship Grade
 * of 2 that have different Weapon Types (and are not of the Shield Weapon Category). These Weapons possess the Artisan
 * Weapon Quality" - their Categories asked, made on the Gear tab, marked as that Option's and never damaged or destroyed.
 */
async function madeByOption(actor, item, option) {
  if (option?.platingQuality) await platingQuality(actor, item, String(option.platingQuality), true);
  const count = Number(option?.installsWeapons) || 0;
  if (!count) return;
  const { craftedItemFrom, WEAPON_TYPES } = await import("./gear.mjs");
  const categories = traitsOfKind("crafting", "weapon-categories").filter(each => each.weaponType && (each.id !== "shield"));
  const escape = Handlebars.escapeExpression;
  const select = n => `<label class="dbu-respond-option"><span class="dbu-respond-name">Weapon ${n}</span>
    <select name="weapon${n}">${categories.map(each => `<option value="${escape(each.id)}">${escape(`${each.name} (${
      WEAPON_TYPES[each.weaponType]?.label ?? each.weaponType})`)}</option>`).join("")}</select></label>`;
  let picked = null;
  while (!picked) {
    const answer = await foundry.applications.api.DialogV2.wait({
      classes: ["dbu-dialog"], window: { title: `${option.name} - Installed Weapons` },
      content: `<p class="dbu-respond-hint">Grade 2, Artisan - two different Weapon Types.</p>
        ${Array.from({ length: count }, (each, index) => select(index + 1)).join("")}`,
      buttons: [{ action: "make", label: "Make them", default: true, callback: (event, button, dialog) =>
        Array.from({ length: count }, (each, index) => dialog.element.querySelector(`[name="weapon${index + 1}"]`)?.value) },
        { action: "cancel", label: "Later, by hand" }],
      rejectClose: false
    });
    if (!Array.isArray(answer)) return;
    const types = answer.map(id => categories.find(each => each.id === id)?.weaponType);
    if (new Set(types).size === types.length) picked = answer;
    else ui.notifications.warn(`${option.name}: two different Weapon Types.`);
  }
  const made = picked.map(id => {
    const category = categories.find(each => each.id === id);
    const data = craftedItemFrom("weapon", actor, getTrait);
    data.name = `${category.name} (Integrated)`;
    Object.assign(data.system.crafted, { category: category.id, weaponType: category.weaponType, grade: 2,
      qualities: [{ id: "artisan", slots: 1, choice: "", on: false, name: "" }] });
    data.flags = { "dbu-ttrpg": { grantedBy: item.id, grantedByOption: option.id, installedWeapon: true } };
    // "Integrated into your Character" - Active, as two may be (the user's: Active where it fits).
    data.system.integrated = true;
    return data;
  });
  const { composeEffects } = await import("./gear.mjs");
  for (const data of made) data.system.crafted.effects = composeEffects(data.system.crafted, "", { getTrait });
  // Active as far as there is room - two Integrated Weapons at once.
  const { activeIntegrated, INTEGRATED_ACTIVE } = await import("./integrated.mjs");
  const room = Math.max(0, INTEGRATED_ACTIVE.weapon - activeIntegrated(actor.items.contents, "weapon").length);
  made.forEach((data, index) => { data.system.equipped = index < room; });
  await actor.createEmbeddedDocuments("Item", made);
}

/**
 * A Quality an Option gives the Natural Armor its Trait made - Combat Plating's Armed, "without occupying a Quality Slot":
 * put on with its Free ticked, the player's to change - or takes back as another Option is chosen (`granted`).
 */
async function platingQuality(actor, item, id, on) {
  const plating = Array.from(actor?.items ?? []).find(each => (each.flags?.["dbu-ttrpg"]?.grantedBy === item.id)
    && (each.flags?.["dbu-ttrpg"]?.naturalArmor === true));
  if (!plating) return;
  const had = (plating.system.crafted?.qualities ?? []).map(entry => ((typeof entry === "string") ? { id: entry } : entry));
  const without = had.filter(entry => !((entry.id === id) && entry.granted));
  if (on && (without.length !== had.length)) return;
  const qualities = on ? [...without, { id, slots: 0, choice: "", on: false, name: "", free: true, granted: true }] : without;
  if (qualities.length === had.length && !on) return;
  const { composeEffects } = await import("./gear.mjs");
  const crafted = { ...plating.system.crafted, qualities };
  await plating.update({ "system.crafted.qualities": qualities,
    "system.crafted.effects": composeEffects(crafted, plating.system.crafted.effects ?? "", { getTrait }) });
}

/** The Option chosen on a Racial Trait Item, where it has an Option effect of one - its id, or "". */
export function racialOptionOf(item) {
  return (item?.system?.chosen ?? []).find(entry => entry.key === "option")?.value ?? "";
}

/** A Saiyan with a Tail: Saiyan Heritage's Tailed Option, the tail not lost (the Options tab's Tail lost box). */
export function hasTail(actor) {
  if (actor?.getFlag?.("dbu-ttrpg", "tailLost")) return false;
  return Array.from(actor?.items ?? []).some(item => (item.type === "racial")
    && (item.flags?.["dbu-ttrpg"]?.sourceId === "saiyan-heritage") && (racialOptionOf(item) === "tailed"));
}

/** Grapple's Tail Restraint is open against them: access to the Tail Attack Maneuver, or a Saiyan with a Tail. */
export function tailToGrab(actor) {
  // Access, not the Item: every character carries the Core Maneuvers, the Tail Attack among them, closed until something
  // opens it - an effect (Elastic Tentacle's) or a Skill.
  return hasTail(actor) || (actor?.system?.effects?.slots?.["maneuver.tail-attack"] === true)
    || Boolean((actor?.system?.specialManeuvers ?? []).find(entry => entry.maneuver === "tail-attack")?.open);
}

/**
 * Another Option for a Racial Trait already had (the user's: "que igual te permita cambiarlo"): its script in place of the
 * old one's between the `#@ option` markers, its choice asked, what was recorded and its wording changed with it; the
 * Unique Abilities the old Option gave go, the new one's are given - Talents given are kept, as on losing the Trait.
 */
export async function changeRacialOption(item, optionId, replacing = "") {
  const actor = item?.actor;
  const sourceId = item?.flags?.["dbu-ttrpg"]?.sourceId ?? "";
  const options = racialOptionsOf(sourceId);
  const option = options.find(entry => entry.id === optionId);
  const had = chosenOptions(item).map(each => each.id);
  if (!option || had.includes(optionId)) return false;
  // The one it takes the place of: the dropdown's own, or the one chosen for the same Option effect.
  const trait = getTrait(sourceId);
  const old = replacing || had.find(id => optionEffectOf(getTrait(id), trait) === optionEffectOf(option, trait)) || "";

  const extra = [];
  const script = await answered(option, extra);
  if (script === null) return false;
  const chosen = [...(item.system.chosen ?? []).filter(entry => !((entry.key === "option") && (entry.value === old))
    && (entry.key !== old)), { key: "option", value: option.id, label: option.name }, ...extra];
  const marker = new RegExp(`\\n*#@ option ${old} \\|[^\\n]*\\n[\\s\\S]*?\\n#@ end`, "g");
  const kept = (old ? String(item.system.script ?? "").replace(marker, "") : String(item.system.script ?? "")).trimEnd();
  const flags = item.flags?.["dbu-ttrpg"] ?? {};
  await item.update({
    "system.script": `${kept}\n\n#@ option ${option.id} | ${option.name}\n${script}\n#@ end`,
    "system.chosen": chosen,
    // The one in use replaced - Dynamic Hype's: the new one in use.
    ...((old && (flags.primaryOption === old)) ? { "flags.dbu-ttrpg.primaryOption": option.id } : {}),
    ...((old && (flags.secondOption === old)) ? { "flags.dbu-ttrpg.secondOption": "" } : {}),
    ...((old && (flags.askedOption === old)) ? { "flags.dbu-ttrpg.askedOption": "" } : {})
  });

  if (!actor) return true;
  await automateAll(actor, item);
  const gone = Array.from(actor.items).filter(each => (each.flags?.["dbu-ttrpg"]?.grantedBy === item.id)
    && each.flags?.["dbu-ttrpg"]?.grantedByOption && (each.flags["dbu-ttrpg"].grantedByOption === old)).map(each => each.id);
  if (gone.length) await actor.deleteEmbeddedDocuments("Item", gone);
  // And what the old one put on Natural Armor - Combat Plating's Armed.
  const was = old ? getTrait(old) : null;
  if (was?.platingQuality) await platingQuality(actor, item, String(was.platingQuality), false);
  await madeByOption(actor, item, option);
  await giveGrants(actor, item, {
    unique: listOf(option.grantsUnique).map(id => ({ id, restrictions: listOf(option.uniqueRestrictions), option: option.id,
      advancements: listOf(option.uniqueAdvancements) })),
    talents: listOf(option.grantsTalent)
  }, option.name);
  return true;
}

/** The Talent Item a Talent's `grantsOptions:` names - Dynamic Hype's Show Stopping Performance. */
function grantedOptionsTarget(actor, trait) {
  return Array.from(actor?.items ?? []).find(item => (item.type === "talent")
    && (item.flags?.["dbu-ttrpg"]?.sourceId === trait?.grantsOptions)) ?? null;
}

/**
 * A Talent adding Options to another's Option effect - Dynamic Hype (1): "Upon gaining this Talent, select 2 additional effects
 * through the Option effect of Show Stopping Performance. You can only use and benefit from one of these effects at any one
 * time." Asked as it is gained, written into that Talent's Item; the one it had is the one in use (`primaryOption`), the
 * others' blocks left out (registry.mjs activeOptionsOnly) - which one, changed on its Options tab.
 */
export async function addGrantedOptions(actor, trait) {
  const target = grantedOptionsTarget(actor, trait);
  const group = optionGroupsOf(getTrait(trait?.grantsOptions ?? ""))[0];
  if (!target || !group) {
    if (!target) ui.notifications.warn(`${trait?.name}: ${getTrait(trait?.grantsOptions ?? "")?.name ?? trait?.grantsOptions} is not had.`);
    return false;
  }
  const had = chosenOptions(target).map(each => each.id);
  const left = group.options.filter(option => !had.includes(option.id));
  const count = Math.min(left.length, Math.max(1, Number(trait.grantsOptionsCount) || 1));
  if (!count) return false;
  const picked = await askOptions(trait, left, count);
  if (!picked) return false;
  const chosen = [...(target.system.chosen ?? [])];
  const scripts = [String(target.system.script ?? "").trimEnd()];
  for (const id of picked) {
    const option = left.find(entry => entry.id === id);
    chosen.push({ key: "option", value: option.id, label: option.name });
    const own = await answered(option, chosen, actor);
    if (own === null) return false;
    scripts.push(`#@ option ${option.id} | ${option.name}\n${own}\n#@ end`);
  }
  await target.update({ "system.script": scripts.filter(Boolean).join("\n\n"), "system.chosen": chosen,
    "flags.dbu-ttrpg.oneAtATime": true,
    "flags.dbu-ttrpg.primaryOption": target.flags?.["dbu-ttrpg"]?.primaryOption || had[0] || picked[0] });
  await automateAll(actor, target);
  return true;
}

/** That Talent lost: the Option in use kept, the others gone with what they asked, and one at a time no longer. */
export async function dropGrantedOptions(actor, trait) {
  const target = grantedOptionsTarget(actor, trait);
  const flags = target?.flags?.["dbu-ttrpg"] ?? {};
  if (!flags.oneAtATime && !flags.primaryOption) return false;
  // The one in use - on the selector, or else asked at this Hype, or else the first had.
  const primary = flags.primaryOption || flags.askedOption || chosenOptions(target)[0]?.id || "";
  const gone = chosenOptions(target).map(each => each.id).filter(id => id !== primary);
  const script = gone.reduce((text, id) => text.replace(new RegExp(`\\n*#@ option ${id} \\|[^\\n]*\\n[\\s\\S]*?\\n#@ end`, "g"), ""),
    String(target.system.script ?? ""));
  await target.update({ "system.script": script.trim(),
    "system.chosen": (target.system.chosen ?? []).filter(entry => !((entry.key === "option") && gone.includes(entry.value))
      && !gone.includes(entry.key)),
    "flags.dbu-ttrpg.oneAtATime": false, "flags.dbu-ttrpg.primaryOption": "", "flags.dbu-ttrpg.askedOption": "",
    "flags.dbu-ttrpg.secondOption": "" });
  return true;
}

/**
 * A Racial Trait taken off: "If you lose a Racial Trait, through any means, you no longer benefit from its effects" -
 * the Unique Abilities it gave go with it; "if those effects grant you a Talent ... you do not lose that Talent".
 */
export async function removeRacialTrait(actor, itemId) {
  const given = Array.from(actor.items).filter(each => each.flags?.["dbu-ttrpg"]?.grantedBy === itemId).map(each => each.id);
  // Its toggles forgotten with it.
  const automatic = actor.getFlag("dbu-ttrpg", "automatic") ?? [];
  if (automatic.some(id => id.startsWith(`${itemId}#`))) {
    await actor.setFlag("dbu-ttrpg", "automatic", automatic.filter(id => !id.startsWith(`${itemId}#`)));
  }
  const ids = [itemId, ...given].filter(id => actor.items.get(id));
  if (ids.length) await actor.deleteEmbeddedDocuments("Item", ids);
}

/** Deleted any other way - from the sidebar, by a macro - what it gave goes too. */
export function registerRacialHooks() {
  // Weapon Ports' Installed Weapons "cannot be destroyed through any means": no Life Points lost, no Break Value, never
  // destroyed - whatever writes it.
  Hooks.on("preUpdateItem", (item, changes) => {
    if (!item.flags?.["dbu-ttrpg"]?.installedWeapon) return;
    for (const [key, whole] of [["lifeLost", 0], ["breakLost", 0], ["destroyed", false]]) {
      if (foundry.utils.hasProperty(changes, `system.crafted.${key}`)) foundry.utils.setProperty(changes, `system.crafted.${key}`, whole);
      if (`system.crafted.${key}` in changes) changes[`system.crafted.${key}`] = whole;
    }
  });
  Hooks.on("deleteItem", async (item, options, userId) => {
    if ((item.type !== RACIAL_TYPE) || !item.parent || (userId !== game.user.id)) return;
    const given = Array.from(item.parent.items).filter(each => each.flags?.["dbu-ttrpg"]?.grantedBy === item.id)
      .map(each => each.id);
    if (given.length) await item.parent.deleteEmbeddedDocuments("Item", given);
  });
}
