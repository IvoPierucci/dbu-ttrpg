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
 *   talentsGoWithIt: true           ...unless its text keeps them only "while you possess" it (From Goop (2)): gone with the Trait
 *   grantsOther: bestial            an Other Trait of that group chosen as it is added - `grantsOtherCount` of them, of
 *                                   `grantsOtherFrom` alone where it names some (Feline Build's two of four)
 *   dragonBall: true                Personified Dragon Ball's set - its name, Size Category (Nano to Small) and stars - asked
 *                                   as it is added, kept on the Item (`dragonBall` flag)
 *   pastLife: true                  Lingering Power's Past Life, asked as it is added - its Skill, Attribute, Talent and base Tier
 *                                   (`$pastSkill`, `$pastAttribute` in its script; the Talent given; the Tier on its flag)
 *   grantsWeapon: chosen            the Weapon Category its `choose: weaponCategory` names (Integrated Weapon's); with
 *   grantsWeaponQualities: <ids>    Qualities on it in no Slot
 *   grantsTalentIfManeuver: a=b     the Talent b, where the Maneuver a is open to them already (Ghost's Frequent Flyer)
 *   grantsOtherOptions: a=b         the Other Trait a granted with its Option b, not asked (Troll's Thick Hide); and
 *   grantsOtherChoices: a=b         with its `choose:` answered b (Plant Monster's Elemental (Plantlife))
 *   grantsTalentChoiceFrom: <ids>   a Talent of those Talent Categories, chosen as it is added - or none (Protector of the Dragon Ball's);
 *                                   `any` for a Talent of any of them (From the Stars')
 *   grantsPerk: Skill Improvement   (a Trait's or an Option's) a Character Perk of each Choice named at Power Level 1 on the Progression
 *                                   tab, named for it and gone with it - More than a Minion's three; Clever's "Gain an additional Skill Improvement at Character Creation"
 *   optionsByRace: true             its Options chosen by the character's race: the one whose `forRace:` names it, not asked (More than a
 *                                   Minion's) - asked where none does
 *   optionsFollow: <trait id>       its Options chosen by another Trait's: the one whose `follows:` names the Option that Trait had
 *                                   chosen, not asked (Difference in Shell's Choice, by Pieces of the Hive's) - asked where it has none
 *   platingBonusPerBaseTier: 1      (an Option's) its Natural Armor's Apparel Bonus that many (bT) higher - `platingBonusWhile:
 *                                   allyBeside` with an Ally adjacent alone (Difference in Shell's King and Queen)
 *   grantsFactorTraitOf: <factor>   a Factor Trait of that Factor chosen as it is added - gone with it (Robot Ripoff's of Alternate
 *                                   Upbringing)
 *   grantsRacialOf: <race>          a Racial Trait of that Race chosen as it is added - `grantsRacialImportance: secondary` of those
 *                                   alone - changeable on its Options tab, gone with it (Majin Genes' Majin Secondary Trait)
 *   grantedLifeCost: 1              the Racial Life Modifier that much lower for each Trait it gave still had (Bestial Presence's)
 *   holdsState / zeroScore          (a Trait's or an Option's) a State it keeps you in; an Attribute Score it holds at 0 (Savage's)
 *   grantsTechniques: full-power    Nameless Horde (4)'s 'Full Power' Signature Techniques, made as it is added (full-power.mjs) -
 *                                   gone with it
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
import { isCharacter, isMinion } from "./actor-types.mjs";
import { getRace, isMinionRace, subraceName } from "./races.mjs";
import { racesOf } from "./fusion.mjs";
import { grantedTechniqueItems, isTechniqueData, techniqueItemsFrom, whyNoNewTechnique } from "./full-power.mjs";
import { traitAside } from "./aside.mjs";

/** The Item type a Racial Trait is. */
export const RACIAL_TYPE = "racial";

/** A link written in a Trait's text as `[label](url)`. */
const LINK = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

/** A Trait's text with its links as their labels - for a tooltip, which shows no link. */
export function plainText(text) {
  return String(text ?? "").replace(LINK, "$1");
}

/**
 * An Option effect's line: "(2)-[Option]:" - choose one - or "(3)-[Multi-Option/2]:" - choose two; with other Keywords beside it too,
 * S-Cells' "(3)-[Permanent, Option]:".
 */
const OPTION_LINE = /^(\(\d+\)-\[(?:[^\]]*?,\s*)?(?:Option|Multi-Option\/\d+)(?:\s*,[^\]]*)?\]):/;

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
  const groups = printedLines(trait.text || "").map(line => /^\((\d+)\)-\[(?:[^\]]*?,\s*)?(Option|Multi-Option\/(\d+))(?:\s*,[^\]]*)?\]:/.exec(line))
    .filter(Boolean).map(match => ({ effect: Number(match[1]), count: Number(match[3]) || 1 }));
  if (!groups.length) groups.push({ effect: Number(trait.optionEffect) || 0, count: Math.max(1, Number(trait.options) || 1) });
  return groups.map(group => ({ ...group, options: options.filter(option => (groups.length === 1)
    || (optionEffectOf(option, trait) === group.effect)) })).filter(group => group.options.length);
}

/**
 * An Option's own printed lines, shown under its Option effect: its file's, but for those its Trait prints under a Choice
 * effect - Artificial Warrior's Options each carry their (5) too, which is shown under the (5) alone (the user's).
 */
function optionOwnLines(option, lines) {
  const squash = text => String(text).replace(/^[*\u2022]\s*/, "").replace(/\s+/g, " ").trim();
  const underChoice = new Set();
  for (let at = 0, inChoice = false; at < lines.length; at++) {
    if (/^\(\d+\)-/.test(lines[at])) inChoice = /^\(\d+\)-\[Choice\]/.test(lines[at]);
    else if (inChoice && /^[*\u2022]/.test(lines[at])) underChoice.add(squash(lines[at]));
  }
  // Its file's lines are one paragraph, read as one printed line: what the Choice prints is taken out of it.
  const own = printedLines(option?.text ?? "");
  const kept = own.map(line => {
    let text = squash(line);
    for (const each of underChoice) if (each && (text !== each) && text.includes(each)) text = text.replace(each, " ").replace(/\s+/g, " ").trim();
    return underChoice.has(text) ? "" : text;
  }).filter(Boolean);
  return kept.length ? kept : own;
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
 * With `live` (the character's sheet): as the site prints it, and what stands now (liveLines). Without, as printed - what
 * reads it for "(N)-" (the sheet's [Constant] lines, the harnesses) keeps it.
 */
export function racialTraitLines(item, live = null) {
  const out = exchangedNamed(item, printedTraitLines(item));
  return live ? liveLines(out, live) : out;
}

/**
 * A Factor Trait exchanged for a Racial Trait (race-traits.mjs `exchangedFor`): what it replaced named in brackets after its name, as a
 * Factor Trait that replaces a Primary prints it - "Dormant Saiya Power (Body) [Blood of the Warrior]:" (the user's, 2026-11-27). Not where
 * its text names one already (Alternative Warrior Race's "[Powerful Physique]").
 */
function exchangedNamed(item, lines) {
  const replaced = getTrait(String(item?.flags?.["dbu-ttrpg"]?.exchangedFor ?? ""));
  if (!replaced || !item?.system?.factor) return lines;
  const at = lines.findIndex(line => line.html && !line.gap && !line.addendum);
  if (at < 0) return lines;
  const head = /^([^:]*?\))(\s*):/.exec(lines[at].html);
  if (!head || /\[[^\]]*\]\s*$/.test(head[1])) return lines;
  const named = `${head[1]} [${lineHtml(replaced.name)}]:`;
  return lines.map((line, index) => (index === at) ? { ...line, html: named + line.html.slice(head[0].length) } : line);
}

function printedTraitLines(item) {
  const picked = (item?.system?.chosen ?? []).filter(entry => entry.key === "option")
    .map(entry => getTrait(entry.value)).filter(Boolean);
  const choices = choicePicked(item);
  const file = getTrait(item?.flags?.["dbu-ttrpg"]?.sourceId ?? "");
  const addendum = String(file?.addendum ?? "").trim();
  // The box's own text, where an Item made before it had a place of its own still carries it after its Addendum effect - left out,
  // shown folded below instead.
  const printed = printedLines(item?.system?.text || "");
  const lines = [];
  for (let at = 0, inBox = false; at < printed.length; at++) {
    if (/^\(\d+\)-/.test(printed[at])) inBox = false;
    const own = (addendum && /^\(\d+\)-\[Addendum\]/.test(printed[at])) ? printed[at].replace(/(box below\.).*$/, "$1") : printed[at];
    if (!inBox) lines.push(own);
    if (addendum && /^\(\d+\)-\[Addendum\]/.test(printed[at])) inBox = true;
  }
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
        out.push({ html: lineHtml(`*${optionOwnLines(chosen, lines).join(" ")}`), bullet: true, gap: false });
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
  // Its Addendum effect's text box - Roomy Biology's "Inner Room" - after its effects, folded: opened by its title (the user's). One that
  // is an Option's alone (`addendumOption` - Artificial Warrior's Pursuit of Perfection) only where that Option is the one chosen.
  const boxOption = String(file?.addendumOption ?? "").trim().toLowerCase();
  if (addendum && (!boxOption || picked.some(chosen => String(chosen.name ?? "").trim().toLowerCase() === boxOption))) {
    out.push({ addendum: { title: String(file.addendumTitle ?? "Addendum"),
      lines: printedLines(addendum).map(line => ({ html: lineHtml(line), bullet: /^[*\u2022]/.test(line), gap: !line })) } });
  }
  return out;
}

/**
 * The Maneuvers a Trait's own effects open - `allow maneuver.<id>` in its file or in its chosen Options' (Class Up's Choice
 * Maneuvers, the user's 2026-11-27) - listed under it on the Traits tab as a `fromTrait` Maneuver is.
 */
export function maneuversOpenedBy(item) {
  const files = [getTrait(item?.flags?.["dbu-ttrpg"]?.sourceId ?? ""),
    ...(item?.system?.chosen ?? []).filter(entry => entry.key === "option").map(entry => getTrait(entry.value))].filter(Boolean);
  return new Set(files.flatMap(file => [...String(file.script ?? "").matchAll(/\ballow\s+maneuver\.([\w-]+)\s*;/g)].map(match => match[1])));
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
  const kind = /^(\(\d+\)-\[(?:[^\]]*?,\s*)?(Option|Multi-Option\/\d+|Choice)(?:\s*,[^\]]*)?\]):/.exec(line);
  const picked = (kind?.[2] === "Choice") ? choicePicked(item)
    : (item.system?.chosen ?? []).filter(entry => entry.key === "option").map(entry => getTrait(entry.value)).filter(Boolean);
  if (!kind || !picked.length) return plainText(line);
  if (kind[2] !== "Choice") {
    return plainText(`${kind[1]}: ${picked.filter(option => optionBelongs(option, item, number))
      .map(option => optionOwnLines(option, lines).join(" ")).join(" ")}`);
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
  return [...traitsOfKind("races"), ...traitsOfKind("factors"), ...traitsOfKind("talents"), ...traitsOfKind("other"),
    ...traitsOfKind("transformations")]
    .filter(trait => trait.optionOf === id)
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
export function factorOf(trait) {
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
  // "Any Minion Race" (Minion No More's): a Minion Race, whichever - not any race.
  if (/^any minion races?$/i.test(text)) return { any: false, races: [], except: [], minionRaces: true };
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
  const { any, races, except, minionRaces } = requirementOf(factor);
  // "Gain the Alternate Upbringing Factor, ignoring its Racial Requirements" (Enhanced Organism's).
  const ignored = slots?.[`factor.ignoreRequirement.${factorId}`] === true;
  if (minionRaces) return ignored || isMinionRace(race);
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
  // Another race's: the common races first, then the Minion Races - each by name (the user's).
  if (!factor) {
    const owner = (trait?.system ? trait.system.race : trait?.owner) ?? "";
    return (owner === race) ? 0 : isMinionRace(owner) ? 3.5 : 3;
  }
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

/**
 * Minion Creation, Step 2: "they only possess the Primary Racial Traits (ignoring Subrace Traits) for that Race and either two
 * Secondary Racial Traits or one Secondary Racial Trait and one Subrace Trait." A Minion's own race's (not a Duplicate's - a copy of
 * its Master's): why one more Secondary or Subrace Trait is past that, or "". `held` the Trait files it has. Said, and dimmed on the
 * Add Racial Trait list; taken all the same if picked. None for a Minion Race (Minion Races): it "maintains all of their Race's Racial
 * Traits, instead of having to choose between them".
 */
export function minionRacialUnfit(trait, actor, held = []) {
  // A Racial Factor for no Minion - Minion No More's "Prerequisite(s): You are not a Minion." (its `notMinion`): dimmed on a Minion's list.
  // A Fusion of Minions too ("the resultant Fusion is also a Minion").
  if (isMinion(actor) && (racialFactor(factorOf(trait))?.notMinion === true)) return "Its Racial Factor's Prerequisite is not met: you are a Minion";
  if ((actor?.type !== "minion") || actor.system?.duplicate || factorOf(trait) || isMinionRace(actor.system?.race)) return "";
  const race = actor.system?.race ?? "";
  const kindOf = each => (each?.subrace ? "subrace" : ((each?.importance === "secondary") ? "secondary" : "primary"));
  const kind = kindOf(trait);
  if ((kind === "primary") || ((trait?.owner ?? "") !== race)) return "";
  const others = held.filter(each => each && (each.id !== trait.id) && !factorOf(each) && ((each.owner ?? "") === race)).map(kindOf);
  if (others.filter(each => each !== "primary").length >= 2) {
    return "A Minion has two Secondary Racial Traits, or one and a Subrace Trait, at most";
  }
  if ((kind === "subrace") && others.includes("subrace")) return "A Minion has one Subrace Trait at most";
  return "";
}

/** The same for an Other Trait: Evolution Traits are the Arcosians' alone (the user's). */
export function otherTraitUnfit(trait, race) {
  // A race, or a Fusion's Races (fusion.mjs racesOf) - fit where any is.
  return ((trait?.owner === "evolution") && ![race].flat().includes("arcosian")) ? "Arcosians' alone" : "";
}

/** Ordered for the picker: the character's own race's first - a Fusion's, any of its Races' (an array) - then by race name. */
export function racialTraitsInOrder(race, traits = racialTraitFiles(), slots = null) {
  const races = [race].flat().length ? [race].flat() : [""];
  const rank = trait => Math.min(...races.map(each => groupRank(trait, each, slots)));
  return traits.slice().sort((a, b) =>
    (rank(a) - rank(b))
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
  // A Fusion's: every one of its Races' first (fusion.mjs racesOf).
  const races = racesOf(actor).length ? racesOf(actor) : [actor?.system?.race];
  const slots = actor?.system?.effects?.slots;
  const fileOf = item => getTrait(item.flags?.["dbu-ttrpg"]?.sourceId ?? "");
  // A Factor Trait that replaces a Racial Trait of theirs by name - From Goop's "[Majin Regeneration]" - stands where that one would (the
  // user's): its race's group, its order. One exchanged from a race Trait's row stands where that one did, whichever it was (the
  // user's, 2026-11-27: `exchangedFor`).
  const place = item => {
    const replaced = getTrait(item.flags?.["dbu-ttrpg"]?.exchangedFor ?? "") || races.map(race => replacedTraitOf(fileOf(item), race)).find(Boolean);
    return replaced ? { rank: 0, group: groupName(replaced), order: orderOf(replaced) + 0.5 }
      : { rank: Math.min(...races.map(race => groupRank(item, race, slots))), group: groupName(item), order: orderOf(fileOf(item)) };
  };
  return Array.from(actor?.items ?? []).filter(item => (item.type === RACIAL_TYPE) && !isOtherTrait(item) && !item.system?.transformation)
    .sort((a, b) => {
      const [one, two] = [place(a), place(b)];
      return (one.rank - two.rank) || one.group.localeCompare(two.group) || (one.order - two.order) || a.name.localeCompare(b.name);
    });
}

/** The Racial Trait of this race a Factor Trait names in brackets to replace - "From Goop (Body) [Majin Regeneration]:" - or null. */
/**
 * Biological Weapon (1): "Upon gaining this Factor Trait, create and gain a Signature Technique with a TP Cost up to the maximum TP Cost
 * for a Signature Technique at your current base Tier of Power" - on the Techniques list, that many of its TP free (none of yours spent
 * up to it), opened to be built. Kept as gained: nothing takes it away with the Trait.
 */
async function grantSignature(actor, item, name) {
  const { tierTpCap } = await import("./technique.mjs");
  const cap = tierTpCap(actor.system?.baseTierOfPower);
  const [made] = await actor.createEmbeddedDocuments("Item", [{ name, type: "maneuver", img: "icons/magic/lightning/bolt-strike-blue.webp",
    flags: { "dbu-ttrpg": { grantedSignature: item.id } },
    system: { type: "standard", attacking: true, requiresTarget: true, tags: ["signature"], signature: { level: "super", freeTP: cap } } }]);
  if (made) await (await import("./chat.mjs")).openForPlayer(actor, made, `${item.name}: build its Signature Technique - up to ${cap} TP, none of yours spent.`);
}

export function replacedTraitOf(file, race) {
  if (!file || !factorOf(file) || !race) return null;
  // Up to its first "(Category) [Trait]:" - its name may have a colon of its own (Genetic Focus: Android).
  const named = /^[^\n]*?\)\s*\[([^\]]+)\]\s*:/.exec(String(file.text ?? "").trim())?.[1]?.trim().toLowerCase();
  if (!named) return null;
  return racialTraitFiles().find(each => !factorOf(each) && (each.owner === race) && (String(each.name).toLowerCase() === named)) ?? null;
}

/**
 * The Other Traits' groups, as their lists name them: Evolution Traits are the Arcosians' own; Vocations are any race's -
 * Vocation Training gives one, and so does Konatsian-Raised (the user's).
 */
export const OTHER_GROUPS = Object.freeze({
  evolution: "Evolution · Arcosian",
  villainous: "Villainous",
  vocation: "Vocation",
  bestial: "Bestial",
  monstrous: "Monstrous",
  "pseudo-bestial": "Pseudo-Bestial · Wild Child",
  // A Fusion's: given as it is fused (fusion-make.mjs), never picked.
  "fusion-method": "Fusion Method",
  "fusion-modifier": "Fusion Modifier",
  // A Fusion of the Metamoran Fusion Dance gone wrong: Plump or Frail (fusion-dance.mjs).
  "fusion-dance": "Fusion Dance"
});

/** The Other Traits' groups given by fusing - its Method Trait, its Fusion Modifiers, Plump or Frail - never offered in the picker. */
export const FUSION_TRAIT_GROUPS = Object.freeze(["fusion-method", "fusion-modifier", "fusion-dance"]);

/**
 * Bestial Limit: "You cannot benefit from more than 4 Bestial Traits at any one time. If an effect would give you access to an
 * additional Bestial Trait(s), you must choose a Bestial Trait(s) to stop applying the effects of while you possess that Bestial
 * Trait(s)."
 */
export const BESTIAL_LIMIT = 4;

/** A Bestial Trait's Item. */
export function isBestial(item) {
  if (item?.type !== RACIAL_TYPE) return false;
  return (item.system?.other || getTrait(item.flags?.["dbu-ttrpg"]?.sourceId ?? "")?.owner || "") === "bestial";
}

/**
 * Set aside by the Bestial Limit - its flag names the Bestial Trait it gave way to, "while you possess" that one: off while that
 * one is still held (registry.mjs, which skips it), applied again once it is gone.
 */
export function bestialOff(item, items) {
  const by = item?.flags?.["dbu-ttrpg"]?.bestialOff;
  return Boolean(by) && Array.from(items ?? []).some(other => other.id === by);
}

/**
 * A Bestial Trait gained past the 4: which stops applying, asked of whoever made the change - any of them, the new one too; backed
 * out of, the new one. Again while more than 4 apply.
 */
export async function bestialLimit(actor, added) {
  if (!actor || !isBestial(added)) return;
  const { askPlayerChoice } = await import("./chat.mjs");
  for (;;) {
    const applying = Array.from(actor.items ?? []).filter(item => isBestial(item) && !traitAside(item, actor.items, actor));
    if (applying.length <= BESTIAL_LIMIT) return;
    const picked = await askPlayerChoice(actor, `${actor.name}: Bestial Limit - ${BESTIAL_LIMIT} at most; which stops applying?`,
      applying.map(item => ({ value: item.id, label: (item.id === added.id) ? `${item.name} (just gained)` : item.name })));
    const off = applying.find(item => item.id === picked) ?? applying.find(item => item.id === added.id);
    if (!off) return;
    await off.setFlag("dbu-ttrpg", "bestialOff", added.id);
  }
}

/** An Other Trait's group, as named - or the folder's name where it is a new one. */
export function otherGroupName(group) {
  const key = String(group ?? "");
  return OTHER_GROUPS[key] ?? (key.charAt(0).toUpperCase() + key.slice(1));
}

/**
 * Villainous Traits (the Adversaries page): an Adversary's, by its Category - the page's examples, files in
 * traits/other/villainous/, and those of the ARC's own making, a name and a text (the user's). Kept apart from the Other
 * Traits' list and picker: theirs is a list of its own, above the Racial Traits and on the Adversary tab.
 */
export const VILLAINOUS = "villainous";

/** Whether a racial Item is a Villainous Trait. */
export function isVillainous(item) {
  return (item?.system?.other === VILLAINOUS) || (getTrait(item?.flags?.["dbu-ttrpg"]?.sourceId ?? "")?.owner === VILLAINOUS);
}

/** The Villainous Traits an Adversary has, in the order they were gained. */
export function ownedVillainousTraits(actor) {
  return Array.from(actor?.items ?? []).filter(item => (item.type === RACIAL_TYPE) && isVillainous(item))
    .sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0));
}

/** The page's example Villainous Traits, for the picker, by name. */
export function villainousTraitFiles() {
  return traitsOfKind("other").filter(trait => trait.owner === VILLAINOUS).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * A Villainous Trait of the ARC's own (the user's): "make dynamic Villainous Traits that fit your specific Adversary" - its name
 * and its text, nothing it does by itself: its numbers are written as Custom Buffs.
 */
export async function addCustomVillainousTrait(actor, name, text) {
  const title = String(name ?? "").trim();
  if (!title) return null;
  const body = String(text ?? "").trim();
  const [made] = await actor.createEmbeddedDocuments("Item", [{ name: title, type: RACIAL_TYPE,
    img: "icons/sundries/books/book-red-exclamation.webp",
    flags: { "dbu-ttrpg": { villainousCustom: true } },
    system: { description: body, text: body ? `${title}: ${body}` : title, script: "", other: VILLAINOUS } }]);
  return made ?? null;
}

/** Whether a racial Item is an Other Trait - Evolution, Bestial, Monstrous - by its group or its file's folder. */
export function isOtherTrait(item) {
  return Boolean(item?.system?.other) || (getTrait(item?.flags?.["dbu-ttrpg"]?.sourceId ?? "")?.kind === "other");
}

/** The Other Traits a character has: by group, as named above, then by name. */
export function ownedOtherTraits(actor) {
  const group = item => item.system?.other || getTrait(item.flags?.["dbu-ttrpg"]?.sourceId ?? "")?.owner || "";
  const rank = item => { const at = Object.keys(OTHER_GROUPS).indexOf(group(item)); return (at < 0) ? 99 : at; };
  return Array.from(actor?.items ?? []).filter(item => (item.type === RACIAL_TYPE) && isOtherTrait(item) && !isVillainous(item)
    && !item.system?.transformation)
    .sort((a, b) => (rank(a) - rank(b)) || a.name.localeCompare(b.name));
}

/** Every Other Trait there is, for its picker: by group, then by name. */
export function otherTraitsInOrder() {
  const rank = trait => { const at = Object.keys(OTHER_GROUPS).indexOf(trait.owner ?? ""); return (at < 0) ? 99 : at; };
  // Not an Option of one - Bestial Build's Thick Hide - which is chosen as that one is gained.
  // Nor a Villainous Trait: an Adversary's, offered on its own (villainousTraitFiles).
  // Nor a Fusion's Method Trait or Fusion Modifier: given as it is fused (fusion-make.mjs).
  return traitsOfKind("other").filter(trait => !trait.optionOf && (trait.owner !== VILLAINOUS) && !FUSION_TRAIT_GROUPS.includes(trait.owner))
    .sort((a, b) => (rank(a) - rank(b)) || a.name.localeCompare(b.name));
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
    // Or only those of one Attribute - Intelligent Fighter's "a Skill that uses Insight as its Attribute" - or of either of two (Skills
    // of a Genius's "Skills that use Scholarship or Insight").
    const attributes = listOf(source?.chooseAttribute).map(each => each.toLowerCase());
    const ranks = key => (Number(actor?.system?.skills?.[key]?.ranks) || 0) + earlier.filter(each => each === key).length;
    return Object.entries(actor?.system?.skillTable ?? DBUCharacterData.SKILLS).filter(([key]) => !except.has(key.toLowerCase()))
      .filter(([, skill]) => !attributes.length || attributes.includes(skill.attribute))
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
    return Object.entries(actor?.system?.skillTable ?? DBUCharacterData.SKILLS).filter(([key]) => key.startsWith("knowledge"))
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
  // Divine Candidate's "select and gain access to a God Maneuver of your choice".
  if (kind === "godManeuver") {
    const { traitsOfKind } = await import("./effects/traits.mjs");
    return traitsOfKind("maneuvers").filter(each => each.godManeuver).sort((a, b) => a.name.localeCompare(b.name)).map(each => [each.id, each.name]);
  }
  // A Foundation - Super Specialist's "select a Foundation".
  if (kind === "foundation") return [["physical", "Physical"], ["energy", "Energy"], ["magic", "Magic"]];
  // Narrative Transformation (1)'s "Select a Form or Transformation Line you possess": the Forms had, and their Lines.
  if (kind === "formOrLine") {
    const T = await import("./transformations.mjs");
    const forms = T.transformationItems(actor).map(item => T.fileOf(item)).filter(file => T.kindOf(file) === "form");
    const lines = [...new Set(forms.map(file => T.lineOf(file, actor?.items)).filter(Boolean))];
    return [...forms.map(file => [file.id, file.name]),
      ...lines.map(line => [`line:${line}`, `${line.replace(/(^|-)\w/g, c => c.toUpperCase()).replace(/-/g, " ")} Line`])];
  }
  // Category Specialist's "Select a Weapon Category" - not the Shield, which is no attack's.
  if (kind === "weaponCategory") {
    const { traitsOfKind } = await import("./effects/traits.mjs");
    return traitsOfKind("crafting", "weapon-categories").filter(each => each.weaponType && (each.id !== "shield"))
      .sort((a, b) => a.name.localeCompare(b.name)).map(each => [each.id, each.name]);
  }
  // Unique Technique's "a Profile of the same Foundation as your Favored Technique" - any Profile where none is chosen yet.
  if (kind === "uniqueProfile") {
    const { PROFILES } = await import("./maneuvers.mjs");
    const favored = Array.from(actor?.items ?? []).find(item => (item.type === "talent")
      && (item.flags?.["dbu-ttrpg"]?.sourceId === "favored-technique"));
    const techniqueId = (favored?.system?.chosen ?? []).find(entry => entry.key === "favored-technique")?.value ?? "";
    const foundation = actor?.items?.get?.(techniqueId)?.system?.signature?.foundation ?? "";
    return Object.entries(PROFILES).filter(([, profile]) => profile.label && Array.isArray(profile.foundations)
      && (!foundation || profile.foundations.includes(foundation))).map(([key, profile]) => [key, profile.label]);
  }
  // Favored Technique's "select one of your Signature Techniques".
  if (kind === "ownTechnique") {
    return Array.from(actor?.items ?? []).filter(item => (item.type === "maneuver") && (item.system.tags ?? []).includes("signature")
      && !item.system.signatureTechnique).sort((a, b) => a.name.localeCompare(b.name)).map(item => [item.id, item.name]);
  }
  // And its "an Advantage with a Technique Point Cost of 10 or less" - its first rank's.
  if (kind === "advantageUpTo10") {
    const { traitsOfKind } = await import("./effects/traits.mjs");
    return traitsOfKind("signature", "advantages").filter(each => (Number(each.tpCost) || 0) && (Number(each.tpCost) <= 10))
      .sort((a, b) => a.name.localeCompare(b.name)).map(each => [each.id, each.name]);
  }
  // Synchronized Combatants' "Choose a Character": any in the world but yourself.
  // Chosen Rival's "(except a Minion)".
  if ((kind === "character") || (kind === "characterNotMinion")) {
    return Array.from(globalThis.game?.actors ?? []).filter(other => (isCharacter(other)) && (other.id !== actor?.id))
      .filter(other => (kind === "character") || !other.system?.minion)
      .sort((a, b) => a.name.localeCompare(b.name)).map(other => [other.id, other.name]);
  }
  // A Battle Weather - Weather Resilient's.
  if (kind === "weather") {
    return traitsOfKind("battlefields").filter(trait => trait.weather === true).map(trait => [trait.id, trait.name]);
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
 * What a Trait's or a Talent's own `choose:` (and `choose2:`, `choose3:`) was answered with, as rows its sheet can change: which,
 * what is chosen, and what may be. The Option's own choices are its Option's, not these.
 */
export async function choiceRowsOf(item) {
  const file = getTrait(item?.flags?.["dbu-ttrpg"]?.sourceId ?? "");
  // And the Racial Trait a `grantsRacialOf` gave (Majin Genes').
  const talentRow = await talentChoiceRow(item, file) ?? racialGrantRow(item, file);
  if (!file?.choose) return talentRow ? [talentRow] : [];
  const actor = item.actor ?? null;
  const chosen = item.system.chosen ?? [];
  const first = chosen.find(entry => entry.key === file.id)?.value ?? "";
  const second = chosen.find(entry => entry.key === `${file.id}#2`)?.value ?? "";
  const third = file.choose3 ? (chosen.find(entry => entry.key === `${file.id}#3`)?.value ?? "") : "";
  const row = async (which, kind, current, earlier) => ({ which, current,
    label: (which === 3) ? "3rd choice" : (which === 2) ? "2nd choice" : (file.choose2 ? "1st choice" : "Choice"),
    options: (await choicesFor(kind, file, { actor, earlier }))
      // What it has now stays offered, whatever the list says of it today.
      .concat((current && !(await choicesFor(kind, file, { actor, earlier })).some(([value]) => value === current))
        ? [[current, chosen.find(entry => entry.value === current)?.label?.split(": ").pop() ?? current]] : [])
      .map(([value, label]) => ({ value, label, selected: value === current })) });
  return [await row(1, file.choose, first, [second, third].filter(Boolean)),
    ...(file.choose2 ? [await row(2, file.choose2, second, [first, third].filter(Boolean))] : []),
    ...(file.choose3 ? [await row(3, file.choose3, third, [first, second].filter(Boolean))] : []),
    ...(talentRow ? [talentRow] : [])];
}

/** The Talents a `grantsTalentChoiceFrom` offers this character - those not had, but the one it gave - by name. */
async function talentChoices(file, actor, keep = "") {
  const fromCategories = listOf(file?.grantsTalentChoiceFrom);
  if (!fromCategories.length) return [];
  const { talentCategoryOf } = await import("./talent-categories.mjs");
  const had = new Set(Array.from(actor?.items ?? []).filter(each => each.type === "talent").map(each => each.flags?.["dbu-ttrpg"]?.sourceId));
  return traitsOfKind("talents").filter(talent => (fromCategories.includes("any") || fromCategories.includes(talentCategoryOf(talent)?.id))
    && ((talent.id === keep) || !had.has(talent.id))).sort((a, b) => a.name.localeCompare(b.name));
}

/** From Goop (2)'s and every `grantsTalentChoiceFrom`'s: the Talent it gave, as a row of its Options tab - changeable. */
async function talentChoiceRow(item, file) {
  if (!listOf(file?.grantsTalentChoiceFrom).length) return null;
  const current = (item.system.chosen ?? []).find(entry => entry.key === `${file.id}#talent`)?.value ?? "";
  const offered = await talentChoices(file, item.actor ?? null, current);
  return { which: "talent", current, label: "Talent",
    options: offered.map(talent => ({ value: talent.id, label: talent.name, selected: talent.id === current })) };
}

/**
 * A choice changed on the sheet: the Item's own script written again from its file with the new answer, the Options' blocks
 * after it kept as they were, and what was chosen recorded. False where nothing changed.
 */
export async function changeChoice(item, which, value) {
  const file = getTrait(item?.flags?.["dbu-ttrpg"]?.sourceId ?? "");
  // The Talent a `grantsTalentChoiceFrom` gave: the old one off, the new one on, as it was given (marked the Trait's).
  if (which === "talent") return changeTalentChoice(item, file, value);
  // The Racial Trait a `grantsRacialOf` gave: the old one off, the new one on.
  if (which === "racial") return changeRacialGrant(item, file, value);
  if (!file?.choose || !value) return false;
  const key = (which === 3) ? `${file.id}#3` : (which === 2) ? `${file.id}#2` : file.id;
  const kind = (which === 3) ? file.choose3 : (which === 2) ? file.choose2 : file.choose;
  if (!kind) return false;
  const offered = await choicesFor(kind, file, { actor: item.actor ?? null });
  const label = offered.find(([each]) => each === value)?.[1] ?? value;
  let chosen = [...(item.system.chosen ?? []).filter(entry => entry.key !== key), { key, value, label: `${file.name}: ${label}` }];
  const first = chosen.find(entry => entry.key === file.id)?.value ?? "";
  const second = chosen.find(entry => entry.key === `${file.id}#2`)?.value ?? "";
  const third = file.choose3 ? (chosen.find(entry => entry.key === `${file.id}#3`)?.value ?? "") : "";
  // Favored Technique's Advantage's own choice, asked again - of the Advantage, or of the Technique a `feature` choice reads.
  if (file.choose2 === "advantageUpTo10") {
    const third = await favoredFeatureChoice(file, item.actor ?? null, first, second);
    if (third === null) return false;
    chosen = [...chosen.filter(entry => entry.key !== `${file.id}#3`), ...(third ? [third] : [])];
  }
  // Its own part: the file's script with both answers written in - a list's flags too.
  let own = String(file.script ?? "").trim();
  if (third) own = own.replaceAll("$choice3", third);
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

async function changeTalentChoice(item, file, value) {
  const actor = item.actor;
  if (!actor || !value) return false;
  const key = `${file.id}#talent`;
  const old = (item.system.chosen ?? []).find(entry => entry.key === key)?.value ?? "";
  if (old === value) return false;
  const talent = (await talentChoices(file, actor, old)).find(each => each.id === value);
  if (!talent) return false;
  const gone = Array.from(actor.items).filter(each => (each.type === "talent") && old && (each.flags?.["dbu-ttrpg"]?.sourceId === old)
    && (each.flags?.["dbu-ttrpg"]?.fromTrait === file.id)).map(each => each.id);
  if (gone.length) await actor.deleteEmbeddedDocuments("Item", gone);
  const { talentItemFrom } = await import("./talents.mjs");
  const data = await answeredTalent(talentItemFrom(talent), talent, actor);
  if (!data) return false;
  data.flags["dbu-ttrpg"].fromTrait = file.id;
  const [made] = (await actor.createEmbeddedDocuments("Item", [data])) ?? [];
  if (made) await automateAll(actor, made);
  await item.update({ "system.chosen": [...(item.system.chosen ?? []).filter(entry => entry.key !== key),
    { key, value, label: `${file.name}: ${talent.name}` }] });
  return true;
}

/**
 * Favored Technique (2): the Advantage chosen, where it asks a choice of its own - Trick Attack's Skill, Condition's Condition -
 * that choice, of the Technique chosen: its row (`<id>#3`), "" where it asks none, or null when backed out of.
 */
async function favoredFeatureChoice(source, actor, techniqueId, advantageId) {
  if ((source?.choose2 !== "advantageUpTo10") || !advantageId) return "";
  const { featureDef, featureChoiceOptions } = await import("./technique.mjs");
  const def = featureDef(advantageId);
  if (!def?.choose) return "";
  const sig = actor?.items?.get?.(techniqueId)?.system?.signature ?? null;
  const offered = featureChoiceOptions(def, { ranks: 1, sig, actor });
  if (!offered.length) return "";
  const escape = Handlebars.escapeExpression;
  const picked = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: `${source.name}: ${def.name}` },
    content: `<select name="choice">${offered.map(([value, label]) =>
      `<option value="${escape(value)}">${escape(label)}</option>`).join("")}</select>`,
    buttons: [
      { action: "confirm", label: "Choose", default: true,
        callback: (event, button, dialog) => dialog.element.querySelector('select[name="choice"]')?.value ?? "" },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });
  const pair = offered.find(([value]) => value === picked);
  return pair ? { key: `${source.id}#3`, value: pair[0], label: `${source.name}: ${def.name} - ${pair[1]}` } : null;
}

/** A part's script with its `choose:` answered - `$choice` replaced - and the choice recorded. */
async function answered(source, chosen, actor = null, preset = "") {
  let script = String(source.script ?? "").trim();
  if (!source.choose) return script;
  // Named by what gives it - Plant Monster's Elemental (Plantlife) - not asked, where it is among those offered.
  const named = preset ? (await choicesFor(source.choose, source, { actor })).find(([value]) => value === preset) : null;
  const choice = named ? { value: named[0], label: named[1] } : await askChoice(source, source.choose, { actor });
  if (!choice) return null;
  chosen.push({ key: source.id, value: choice.value, label: `${source.name}: ${choice.label}` });
  // A second choice after it - `choose2:`, `$choice2` - asked with the first known (Functional Purpose's).
  if (source.choose2) {
    const second = await askChoice(source, source.choose2, { actor, earlier: [choice.value] });
    if (!second) return null;
    chosen.push({ key: `${source.id}#2`, value: second.value, label: `${source.name}: ${second.label}` });
    script = script.replaceAll("$choice2", second.value);
    // Favored Technique's Advantage, where it asks a choice of its own.
    const third = await favoredFeatureChoice(source, actor, choice.value, second.value);
    if (third === null) return null;
    if (third) chosen.push(third);
    // A third after both - `choose3:`, `$choice3` - Skills of a Genius's "select 3 Skills".
    if (source.choose3) {
      const last = await askChoice(source, source.choose3, { actor, earlier: [choice.value, second.value] });
      if (!last) return null;
      chosen.push({ key: `${source.id}#3`, value: last.value, label: `${source.name}: ${last.label}` });
      script = script.replaceAll("$choice3", last.value);
    }
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
export async function racialItemFrom(trait, actor = null, { presetOption = "", presetChoice = "" } = {}) {
  const chosen = [];
  const own = await answered(trait, chosen, actor, presetChoice);
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
  // Difference in Shell's Choice: "Depending on your choice for the Option effect of Pieces of the Hive" - that one's, not asked.
  // More than a Minion (3): "Depending on your Race" - the race's, not asked.
  if (!presetOption && trait.optionsByRace) {
    // A Fusion's any of its Races (fusion.mjs racesOf): the one Option that fits, or asked where more than one does.
    const races = racesOf(actor);
    const fitting = racialOptionsOf(trait.id).filter(option => races.includes(String(option.forRace ?? "")));
    presetOption = (fitting.length === 1) ? fitting[0].id : "";
  }
  if (!presetOption && trait.optionsFollow) {
    const followed = Array.from(actor?.items ?? []).find(each => each.flags?.["dbu-ttrpg"]?.sourceId === String(trait.optionsFollow));
    const held = (followed?.system?.chosen ?? []).find(entry => entry?.key === "option")?.value ?? "";
    presetOption = racialOptionsOf(trait.id).find(option => held && (String(option.follows ?? "") === held))?.id ?? "";
  }
  for (const group of optionGroupsOf(trait)) {
    const options = group.options;
    // Named by what gives it - Troll's "you must select Thick Hide for its Option effect" - not asked.
    const picked = (presetOption && (group.count === 1) && options.some(entry => entry.id === presetOption))
      ? [presetOption] : await askOptions(trait, options, group.count, group.effect);
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
export async function addRacialTrait(actor, trait, { grantedBy = "", presetOption = "", presetChoice = "", transformation = "", made: given = null } = {}) {
  // `made`: its Item's data already asked (race-traits.mjs, all of a race's asked in one window before any is made).
  const made = given ?? await racialItemFrom(trait, actor, { presetOption, presetChoice });
  if (!made) return null;
  // Personified Dragon Ball: "select a set of Dragon Balls (including a Size Category from Nano to Small) and a number of
  // stars from among them".
  if (trait.dragonBall) {
    const ball = await askDragonBall(trait);
    if (!ball) return null;
    made.data.flags["dbu-ttrpg"].dragonBall = ball;
  }
  // Lingering Power (1): the Past Life - and from it the Skill, the Attribute, the Talent and the base Tier its effects read.
  if (trait.pastLife) {
    const past = await askPastLife(actor, trait);
    if (!past) return null;
    made.data.flags["dbu-ttrpg"].pastLife = past;
    made.data.system.script = String(made.data.system.script ?? "").replaceAll("$pastSkill", past.skill)
      .replaceAll("$pastAttribute", past.attribute);
    if (past.talent) made.grants.talents = [...(made.grants.talents ?? []), past.talent];
  }
  // Protector of the Dragon Ball (8): "you may gain a Talent from the Weapon, Magic, Physical, or Energy Talent Categories" - which, asked.
  const fromCategories = listOf(trait.grantsTalentChoiceFrom);
  if (fromCategories.length) {
    const { talentCategoryOf } = await import("./talent-categories.mjs");
    const had = new Set(Array.from(actor.items ?? []).filter(each => each.type === "talent").map(each => each.flags?.["dbu-ttrpg"]?.sourceId));
    const anyCategory = fromCategories.includes("any");
    const offered = traitsOfKind("talents").filter(talent => (anyCategory || fromCategories.includes(talentCategoryOf(talent)?.id))
      && !had.has(talent.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (offered.length) {
      const escape = Handlebars.escapeExpression;
      const picked = await foundry.applications.api.DialogV2.wait({
        classes: ["dbu-dialog"], window: { title: `${trait.name} - a Talent` },
        content: `<label class="dbu-respond-option" data-tooltip="Its Prerequisites the table's"><span class="dbu-respond-name">Talent</span>
          <select name="talent">${offered.map(talent => `<option value="${escape(talent.id)}">${escape(talent.name)} (${escape(talentCategoryOf(talent)?.label ?? "")})</option>`).join("")}</select></label>`,
        buttons: [{ action: "take", label: "Gain", default: true, callback: (event, button, dialog) => dialog.element.querySelector('[name="talent"]')?.value ?? "" },
          { action: "none", label: "None" }],
        rejectClose: false
      });
      if (offered.some(talent => talent.id === picked)) {
        made.grants.talents = [...(made.grants.talents ?? []), picked];
        // Kept as one of its choices, so its Options tab shows it and may change it (choiceRowsOf, changeChoice).
        made.data.system.chosen = [...(made.data.system.chosen ?? []),
          { key: `${trait.id}#talent`, value: picked, label: `${trait.name}: ${offered.find(talent => talent.id === picked)?.name ?? picked}` }];
      }
    }
  }
  // Ghost (2): "If you already have access to the Soar Maneuver, gain access to the Frequent Flyer Talent" - read before it is gained.
  const [ifManeuver, insteadTalent] = String(trait.grantsTalentIfManeuver ?? "").split("=").map(each => each.trim());
  if (ifManeuver && insteadTalent && (actor.system?.effects?.slots?.[`maneuver.${ifManeuver}`] === true)) {
    made.grants.talents = [...(made.grants.talents ?? []), insteadTalent];
  }
  // Given by another - Bestial Evolution's Bestial Trait - it goes with that one.
  if (grantedBy) made.data.flags["dbu-ttrpg"].grantedBy = grantedBy;
  // A Transformation Trait: belongs to its Transformation Item (transformations.mjs), made and taken away with it.
  if (transformation) made.data.system.transformation = transformation;
  const [item] = await actor.createEmbeddedDocuments("Item", [made.data]);
  if (!item) return null;
  await giveGrants(actor, item, made.grants, trait.name);
  await automateAll(actor, item);
  // A Special Item it makes - Neko Majin-Dama's: "At Character Creation, create a Majin-Dama Special Accessory, which is
  // Integrated into your Character".
  // Any other Basic Item, as a Talent's are - at `grantsGearDC`, Integrated with `grantsGearIntegrated` (Onboard Computer's Scouter).
  const otherGear = listOf(trait.grantsGear).filter(id => id !== "majin-dama");
  if (otherGear.length) await (await import("./talents.mjs")).grantTalentGear(actor, item, { ...trait, grantsGear: otherGear.join(",") });
  for (const gearId of listOf(trait.grantsGear)) {
    const { MAJIN_DAMA, damaItemData } = await import("./majin-dama.mjs");
    if (gearId !== MAJIN_DAMA) continue;
    const data = await damaItemData(actor, { grantedBy: item.id });
    if (data) await actor.createEmbeddedDocuments("Item", [data]);
  }
  // A Weapon it makes - Claws': "Create a Physical Weapon of the Slashing Category with a Craftsmanship Grade of 2 ... This Weapon
  // becomes Integrated while you possess this Bestial Trait" - on the Gear tab, gone with it.
  if (trait.grantsWeapon) await grantWeapon(actor, item, trait);
  // Nameless Horde (4): "You have access to the 'Full Power' Signature Techniques" - on the Techniques list, gone with it.
  // Seedling Biology (1): the Saibamen's Signature Techniques, the same way.
  // A Transformation Trait's own, written in its header (Golden Oozaru's Fire Breath, Evil Aura's Evil Techniques).
  const techniques = [...grantedTechniqueItems(String(trait.grantsTechniques ?? ""), item.id), ...techniqueItemsFrom(trait, item.id)];
  if (techniques.length) await actor.createEmbeddedDocuments("Item", techniques);
  // Biological Weapon (1): a Signature Technique made as it is gained.
  if (trait.grantsSignature) await grantSignature(actor, item, String(trait.grantsSignature));
  // Character Perks it gives - More than a Minion (2)'s "an Attribute Addition, a Skill Improvement, and a Talent".
  if (trait.grantsPerk) await grantPerks(actor, item.name, listOf(trait.grantsPerk));
  // Natural Armor it gives - Survivor's Plating - made before its Options, which may put a Quality on it.
  if (trait.naturalArmor) await (await import("./natural-armor.mjs")).grantNaturalArmor(actor, item, String(trait.naturalArmor));
  // And a Quality on it in no Slot - Sturdy Shell's Dense Armor, Treacherous Spikes' Spiked; Reinforced Suit's two.
  if (trait.naturalArmor) for (const quality of listOf(trait.naturalArmorQuality)) await platingQuality(actor, item, quality, true);
  for (const option of chosenOptions(item)) await madeByOption(actor, item, option);
  if (trait.defaultCostume) await askDefaultCostume(actor);
  // An Other Trait it gives, chosen now - Bestial Evolution's "Select and gain a Bestial Trait of your choice".
  // Fallen Idol's two: one of each group it names.
  // Feline Build's: two, of the four it names.
  const from = listOf(trait.grantsOtherFrom);
  for (const group of listOf(trait.grantsOther)) {
    for (let n = 0; n < Math.max(1, Number(trait.grantsOtherCount) || 1); n++) {
      const given = await grantOtherTrait(actor, item, group, from, otherPresetsOf(trait));
      // Were-Beast (1): "These are known as your 'Were-Traits'" - applying only in a Round chosen for them (aside.mjs).
      if (given && trait.wereTraits) await given.setFlag("dbu-ttrpg", "wereTrait", true);
    }
  }
  // Robot Ripoff (2): "Gain a Factor Trait from Alternate Upbringing" - which, asked; gone with it.
  if (trait.grantsFactorTraitOf) await grantFactorTrait(actor, item, String(trait.grantsFactorTraitOf));
  // Majin Genes (2), Genetic Focus: Majins (2): "Gain access to a Majin Secondary Trait of your choice" - which, asked; changeable on
  // its Options tab; gone with it.
  if (trait.grantsRacialOf) await grantRacialOf(actor, item, trait);
  // Were-Beast (2): "the Secondary Racial Trait you exchanged for this Factor Trait becomes known as your 'Normal Trait'" - which, asked.
  if (trait.asksNormalTrait) await askNormalTrait(actor, item);
  // "Gain access to the Evil Saiyan Enhancement" (`grantsTransformation:` - Heart of Evil's, Emperor's every Stage of Metamorphosis): each
  // added where it is not had, gone with the Trait (`grantedBy`).
  // An Option's too - Saiyan Heritage's Tailed: "you have access to the Oozaru Alternate Form".
  const transformationsGiven = [...listOf(trait.grantsTransformation), ...chosenOptions(item).flatMap(option => listOf(option.grantsTransformation))];
  if (transformationsGiven.length) {
    const T = await import("./transformations.mjs");
    for (const id of transformationsGiven) {
      if (T.transformationItems(actor).some(each => each.system?.transformationId === id)) continue;
      const given = await T.addTransformation(actor, id);
      if (given) await given.setFlag("dbu-ttrpg", "grantedBy", item.id);
    }
  }
  return item;
}

/** A Trait's `grantsWeapon`: that Category's Weapon at `grantsWeaponGrade`, named `grantsWeaponName` - Integrated, Active if room. */
async function grantWeapon(actor, item, trait) {
  // `grantsWeapon: chosen` - the Weapon Category its `choose: weaponCategory` was answered with (Integrated Weapon's).
  const categoryId = (String(trait.grantsWeapon) === "chosen")
    ? ((item.system?.chosen ?? []).find(entry => entry.key === trait.id)?.value ?? "") : String(trait.grantsWeapon);
  const category = getTrait(categoryId);
  if (!category) return;
  const { craftedItemFrom, composeEffects } = await import("./gear.mjs");
  const data = craftedItemFrom("weapon", actor, getTrait);
  if (!data) return;
  data.name = String(trait.grantsWeaponName ?? category.name);
  Object.assign(data.system.crafted, { category: category.id, weaponType: category.weaponType,
    grade: Number(trait.grantsWeaponGrade) || 1,
    // And the Qualities it has "in addition", in no Slot - Integrated Weapon's Regenerating.
    qualities: listOf(trait.grantsWeaponQualities).map(id => ({ id, slots: 0, choice: "", on: false, name: "", free: true, granted: true })) });
  data.system.crafted.effects = composeEffects(data.system.crafted, "", { getTrait });
  const { activeIntegrated, INTEGRATED_ACTIVE } = await import("./integrated.mjs");
  data.system.integrated = true;
  data.system.equipped = activeIntegrated(actor.items.contents, "weapon").length < INTEGRATED_ACTIVE.weapon;
  data.flags = { "dbu-ttrpg": { grantedBy: item.id } };
  await actor.createEmbeddedDocuments("Item", [data]);
}

/** The Attributes, as the sheet names them. */
const PAST_ATTRIBUTES = ["agility", "force", "tenacity", "scholarship", "insight", "magic", "personality"];

/**
 * Lingering Power (1)-(4): "select a Character that is deceased ... to be your 'Past Life'" - one of this world, or one only named. From
 * one of this world, what (2), (3) and (4) read is offered from it - its Skills with the most Ranks, its Attributes with the highest
 * Score ("if it's a tie, you decide"), its Talents, its base Tier; from one only named, any. Null where backed out of.
 */
export async function askPastLife(actor, trait) {
  const escape = Handlebars.escapeExpression;
  const others = Array.from(globalThis.game?.actors ?? []).filter(other => (isCharacter(other)) && (other.id !== actor?.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const who = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"], window: { title: `${trait.name} - your Past Life` },
    content: `<label class="dbu-respond-option"><span class="dbu-respond-name">Past Life</span>
      <select name="past"><option value="">Not in this world - named</option>${others.map(other =>
        `<option value="${escape(other.id)}">${escape(other.name)}</option>`).join("")}</select></label>
      <label class="dbu-respond-option"><span class="dbu-respond-name">Name</span><input type="text" name="name"/></label>`,
    buttons: [{ action: "next", label: "Next", default: true, callback: (event, button, dialog) => ({
        id: dialog.element.querySelector('[name="past"]')?.value ?? "",
        name: String(dialog.element.querySelector('[name="name"]')?.value ?? "").trim() }) },
      { action: "cancel", label: "Cancel" }],
    rejectClose: false
  });
  if (!who || (typeof who !== "object")) return null;
  const past = others.find(other => other.id === who.id) ?? null;
  const { default: DBUCharacterData } = await import("./data/actor-character.mjs");
  const skills = Object.entries(DBUCharacterData.SKILLS);
  const most = (entries, value) => {
    const top = Math.max(...entries.map(value));
    return entries.filter(each => value(each) === top);
  };
  // Theirs where they are of this world; any otherwise.
  const skillOffer = past ? most(skills, ([key]) => Number(past.system?.skills?.[key]?.ranks) || 0) : skills;
  const attributeOffer = past ? most(PAST_ATTRIBUTES, key => Number(past.system?.attributes?.[key]?.score) || 0) : PAST_ATTRIBUTES;
  const theirTalents = past ? new Set(Array.from(past.items ?? []).filter(item => item.type === "talent")
    .map(item => item.flags?.["dbu-ttrpg"]?.sourceId).filter(Boolean)) : null;
  const talents = traitsOfKind("talents").filter(talent => !theirTalents || theirTalents.has(talent.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const tier = past ? (Number(past.system?.baseTierOfPower) || 1) : 1;
  const label = key => key.charAt(0).toUpperCase() + key.slice(1);
  const answer = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"], window: { title: `${trait.name} - ${past?.name ?? (who.name || "your Past Life")}` },
    content: `<label class="dbu-respond-option" data-tooltip="Their Skill with the most Skill Ranks - a tie, yours to decide">
        <span class="dbu-respond-name">Skill Rank</span>
        <select name="skill">${skillOffer.map(([key, skill]) => `<option value="${escape(key)}">${escape(skill.label)}</option>`).join("")}</select></label>
      <label class="dbu-respond-option" data-tooltip="Their highest Attribute Score - a tie, yours to decide">
        <span class="dbu-respond-name">Attribute +2</span>
        <select name="attribute">${attributeOffer.map(key => `<option value="${key}">${label(key)}</option>`).join("")}</select></label>
      <label class="dbu-respond-option" data-tooltip="One they possessed - its Prerequisites the table's">
        <span class="dbu-respond-name">Talent</span>
        <select name="talent"><option value="">None</option>${talents.map(talent =>
          `<option value="${escape(talent.id)}">${escape(talent.name)}</option>`).join("")}</select></label>
      <label class="dbu-respond-option" data-tooltip="Their base Tier of Power - Lingering Power's 5th effect">
        <span class="dbu-respond-name">Base Tier</span><input type="number" name="tier" min="1" step="1" value="${tier}"/></label>`,
    buttons: [{ action: "take", label: "Take", default: true, callback: (event, button, dialog) => ({
        skill: dialog.element.querySelector('[name="skill"]')?.value ?? "",
        attribute: dialog.element.querySelector('[name="attribute"]')?.value ?? "",
        talent: dialog.element.querySelector('[name="talent"]')?.value ?? "",
        tier: Math.max(1, Math.floor(Number(dialog.element.querySelector('[name="tier"]')?.value) || 1)) }) },
      { action: "cancel", label: "Cancel" }],
    rejectClose: false
  });
  if (!answer || (typeof answer !== "object") || !answer.skill || !answer.attribute) return null;
  return { uuid: past?.uuid ?? "", name: past?.name ?? who.name, ...answer };
}

/** Were-Beast (2): which of the character's own Racial Traits is the Normal Trait - or none, the table's. */
async function askNormalTrait(actor, item) {
  const own = ownedRacialTraits(actor).filter(each => (each.id !== item.id) && !each.system?.factor);
  if (!own.length) return;
  const escape = Handlebars.escapeExpression;
  const picked = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"], window: { title: `${item.name} - your Normal Trait` },
    content: `<p class="dbu-respond-hint">The Secondary Racial Trait exchanged for it: kept, applying in every Combat Round your Were-Traits are not chosen for.</p>
      <label class="dbu-respond-option"><span class="dbu-respond-name">Normal Trait</span>
      <select name="normal">${own.map(each => `<option value="${escape(each.id)}">${escape(each.name)}</option>`).join("")}</select></label>`,
    buttons: [{ action: "take", label: "Mark it", default: true, callback: (event, button, dialog) => dialog.element.querySelector('[name="normal"]')?.value ?? "" },
      { action: "later", label: "None" }],
    rejectClose: false
  });
  const normal = own.find(each => each.id === picked);
  if (normal) await normal.setFlag("dbu-ttrpg", "normalTrait", true);
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
async function grantOtherTrait(actor, item, group, from = [], presets = {}) {
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
  return trait ? addRacialTrait(actor, trait, { grantedBy: item.id, presetOption: presets.options?.[trait.id] ?? "",
    presetChoice: presets.choices?.[trait.id] ?? "" }) : null;
}

/** A Factor Trait of that Factor, chosen - one not had already - given by `item`, gone with it; "Later, by hand" for none. */
async function grantFactorTrait(actor, item, factor) {
  const had = new Set(Array.from(actor.items ?? []).map(each => each.flags?.["dbu-ttrpg"]?.sourceId));
  const offered = traitsOfKind("factors").filter(each => (each.owner === factor) && !each.optionOf && !had.has(each.id))
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || a.name.localeCompare(b.name));
  if (!offered.length) return null;
  const escape = Handlebars.escapeExpression;
  const picked = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"], window: { title: `${item.name} - a ${factorName(factor)} Factor Trait` },
    content: `<label class="dbu-respond-option"><span class="dbu-respond-name">Factor Trait</span>
      <select name="factor">${offered.map(each => `<option value="${escape(each.id)}">${escape(each.name)}</option>`).join("")}</select></label>`,
    buttons: [{ action: "take", label: "Gain", default: true,
      callback: (event, button, dialog) => dialog.element.querySelector('[name="factor"]')?.value ?? "" },
      { action: "later", label: "Later, by hand" }],
    rejectClose: false
  });
  const chosen = offered.find(each => each.id === picked);
  return chosen ? addRacialTrait(actor, chosen, { grantedBy: item.id }) : null;
}

/**
 * The Racial Traits a `grantsRacialOf` offers this character: that Race's (`grantsRacialImportance`'s alone where it names one - Majin
 * Genes' Secondary), not a Subrace's nor an Option, not had - but the one it gave.
 */
export function racialGrantChoices(file, actor, keep = "") {
  const race = String(file?.grantsRacialOf ?? "");
  if (!race) return [];
  const importance = String(file.grantsRacialImportance ?? "");
  const had = new Set(Array.from(actor?.items ?? []).map(each => each.flags?.["dbu-ttrpg"]?.sourceId));
  return traitsOfKind("races").filter(trait => (trait.owner === race) && !trait.optionOf && !trait.subrace
    && (!importance || (String(trait.importance ?? "") === importance)) && ((trait.id === keep) || !had.has(trait.id)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** What a `grantsRacialOf` gives, said: "Majin Secondary Trait". */
function racialGrantLabel(file) {
  const race = getRace(String(file?.grantsRacialOf ?? ""))?.name ?? String(file?.grantsRacialOf ?? "");
  const importance = String(file?.grantsRacialImportance ?? "");
  return `${race} ${importance ? `${importance.charAt(0).toUpperCase()}${importance.slice(1)} ` : "Racial "}Trait`;
}

/** As it is gained: which, asked - "Later, by hand" leaves it to its Options tab. */
async function grantRacialOf(actor, item, file) {
  const offered = racialGrantChoices(file, actor);
  if (!offered.length) return null;
  const escape = Handlebars.escapeExpression;
  const picked = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"], window: { title: `${item.name} - a ${racialGrantLabel(file)}` },
    content: `<label class="dbu-respond-option"><span class="dbu-respond-name">${escape(racialGrantLabel(file))}</span>
      <select name="racial">${offered.map(each => `<option value="${escape(each.id)}">${escape(each.name)}</option>`).join("")}</select></label>`,
    buttons: [{ action: "take", label: "Gain", default: true,
      callback: (event, button, dialog) => dialog.element.querySelector('[name="racial"]')?.value ?? "" },
      { action: "later", label: "Later, by hand" }],
    rejectClose: false
  });
  return (typeof picked === "string") && picked ? changeRacialGrant(item, file, picked) : null;
}

/** The one a `grantsRacialOf` gave, as a row of its Options tab - changeable. */
function racialGrantRow(item, file) {
  if (!file?.grantsRacialOf) return null;
  const current = (item.system.chosen ?? []).find(entry => entry.key === `${file.id}#racial`)?.value ?? "";
  const offered = racialGrantChoices(file, item.actor ?? null, current);
  return { which: "racial", current, label: racialGrantLabel(file),
    options: offered.map(trait => ({ value: trait.id, label: trait.name, selected: trait.id === current })) };
}

/** Chosen or changed: the one it gave before taken off, the new one given by it (`grantedRacial`), what is chosen recorded. */
async function changeRacialGrant(item, file, value) {
  const actor = item?.actor;
  if (!actor || !file) return false;
  const key = `${file.id}#racial`;
  const old = (item.system.chosen ?? []).find(entry => entry.key === key)?.value ?? "";
  if (old === value) return false;
  const trait = value ? racialGrantChoices(file, actor, old).find(each => each.id === value) : null;
  if (value && !trait) return false;
  const gone = Array.from(actor.items).filter(each => (each.flags?.["dbu-ttrpg"]?.grantedBy === item.id)
    && each.flags?.["dbu-ttrpg"]?.grantedRacial).map(each => each.id);
  if (gone.length) await actor.deleteEmbeddedDocuments("Item", gone);
  if (trait) {
    const given = await addRacialTrait(actor, trait, { grantedBy: item.id });
    if (given) await given.setFlag("dbu-ttrpg", "grantedRacial", true);
  }
  await item.update({ "system.chosen": [...(item.system.chosen ?? []).filter(entry => entry.key !== key),
    ...(trait ? [{ key, value, label: `${file.name}: ${trait.name}` }] : [])] });
  return true;
}

/** `grantsOtherOptions: a=b` and `grantsOtherChoices: a=b` - the Option and the choice each granted Other Trait is given with. */
function otherPresetsOf(trait) {
  const pairs = value => Object.fromEntries(listOf(value).map(entry => entry.split("=").map(each => each.trim())).filter(([a, b]) => a && b));
  return { options: pairs(trait.grantsOtherOptions), choices: pairs(trait.grantsOtherChoices) };
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
    // Devil (3): "For the Unique Monstrosity Monstrous Trait, you may select any Unique Ability regardless of the TP Cost".
    const cap = ((item.flags?.["dbu-ttrpg"]?.sourceId === "unique-monstrosity") && (actor.system?.effects?.slots?.["devil.anyUnique"] === true))
      ? Infinity : grants.uniqueChoice;
    const picked = await askUniqueChoice(actor, name, cap, held, grants.uniqueChoiceType);
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

/** The script a Racial Trait Item acts by: its own - a Transformation Trait's, its file's (transformations.mjs). */
async function traitItemScript(item) {
  if (!item?.system?.transformation) return item?.system?.script ?? "";
  const { transformationTraitScript } = await import("./transformations.mjs");
  return transformationTraitScript(item);
}

/**
 * The Triggered effects of a Racial Trait Item that the Traits tab toggles between Triggered and Automatic - not those a
 * window offers as they happen, nor those that cost Actions (a moment's card takes and pays for them) - as block ids.
 */
export async function toggledBlocks(item) {
  const { compile } = await import("./effects/parser.mjs");
  const { chosenAsItHappens } = await import("./effects/registry.mjs");
  return (compile(await traitItemScript(item)).program?.blocks ?? [])
    .filter(block => (block.mode === "triggered") && !block.budget?.actions && !chosenAsItHappens(block))
    .map(block => `${item.id}#${block.index}`);
}

/** Gained - or its Option changed - its toggles start Automatic (the user's). A Talent's too. */
export async function automateAll(actor, item) {
  // But one marked to start Triggered (`startsTriggered`).
  const { compile } = await import("./effects/parser.mjs");
  const later = new Set((compile(await traitItemScript(item)).program?.blocks ?? [])
    .filter(block => block.modifiers?.startsTriggered).map(block => `${item.id}#${block.index}`));
  const ids = (await toggledBlocks(item)).filter(id => !later.has(id));
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
  // Clever's: "Gain an additional Skill Improvement at Character Creation" - a Character Perk at Power Level 1, its Technique Points
  // a Skill Improvement's, written on it as every Perk's are.
  if (option?.grantsPerk) await grantPerks(actor, perkSource(option, item), listOf(option.grantsPerk));
  if (option?.platingQuality) await platingQuality(actor, item, String(option.platingQuality), true);
  // An Other Trait it gives - Extension Feature's "You possess the Extension Attack Monstrous Trait".
  // `grantsOtherCount` of them (Uncanny Monster's two Bestial Traits) - each marked its Option's, so another Option chosen takes it away.
  for (const group of listOf(option?.grantsOther)) {
    for (let n = 0; n < Math.max(1, Number(option.grantsOtherCount) || 1); n++) {
      const given = await grantOtherTrait(actor, item, group, listOf(option.grantsOtherFrom));
      if (given) await given.setFlag("dbu-ttrpg", "grantedByOption", option.id);
    }
  }
  const count = Number(option?.installsWeapons) || 0;
  if (!count) return;
  const { craftedItemFrom, WEAPON_TYPES } = await import("./gear.mjs");
  // Of one Weapon Type where the Option names one - Extending Weapon's "a Physical Weapon".
  const ofType = String(option.installsWeaponType ?? "");
  const categories = traitsOfKind("crafting", "weapon-categories").filter(each => each.weaponType && (each.id !== "shield")
    && (!ofType || (each.weaponType === ofType)));
  const grade = Number(option.installsWeaponGrade) || 2;
  const qualityIds = listOf(option.installsWeaponQualities).length ? listOf(option.installsWeaponQualities) : ["artisan"];
  const indestructible = String(option.installsIndestructible ?? "") !== "false";
  const escape = Handlebars.escapeExpression;
  const select = n => `<label class="dbu-respond-option"><span class="dbu-respond-name">Weapon ${n}</span>
    <select name="weapon${n}">${categories.map(each => `<option value="${escape(each.id)}">${escape(`${each.name} (${
      WEAPON_TYPES[each.weaponType]?.label ?? each.weaponType})`)}</option>`).join("")}</select></label>`;
  let picked = null;
  while (!picked) {
    const answer = await foundry.applications.api.DialogV2.wait({
      classes: ["dbu-dialog"], window: { title: `${option.name} - Installed Weapons` },
      content: `<p class="dbu-respond-hint">Grade ${grade}, ${qualityIds.map(id => getTrait(id)?.name ?? id).join(", ")}${(count > 1) ? " - two different Weapon Types" : ""}.</p>
        ${Array.from({ length: count }, (each, index) => select(index + 1)).join("")}`,
      buttons: [{ action: "make", label: "Make them", default: true, callback: (event, button, dialog) =>
        Array.from({ length: count }, (each, index) => dialog.element.querySelector(`[name="weapon${index + 1}"]`)?.value) },
        { action: "cancel", label: "Later, by hand" }],
      rejectClose: false
    });
    if (!Array.isArray(answer)) return;
    const types = answer.map(id => categories.find(each => each.id === id)?.weaponType);
    if ((count === 1) || (new Set(types).size === types.length)) picked = answer;
    else ui.notifications.warn(`${option.name}: two different Weapon Types.`);
  }
  const made = picked.map(id => {
    const category = categories.find(each => each.id === id);
    const data = craftedItemFrom("weapon", actor, getTrait);
    data.name = option.installsWeaponName ? String(option.installsWeaponName) : `${category.name} (Integrated)`;
    Object.assign(data.system.crafted, { category: category.id, weaponType: category.weaponType, grade,
      qualities: qualityIds.map(id => ({ id, slots: 1, choice: "", on: false, name: "" })) });
    // Weapon Ports' "cannot be destroyed through any means" - not Extending Weapon's Prehensile Weapon.
    data.flags = { "dbu-ttrpg": { grantedBy: item.id, grantedByOption: option.id, ...(indestructible ? { installedWeapon: true } : {}) } };
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
  // Its own Natural Armor - or, where it gave none, theirs: Difference in Shell's Qualities on the Insect Shell.
  const plating = Array.from(actor?.items ?? []).find(each => (each.flags?.["dbu-ttrpg"]?.grantedBy === item.id)
    && (each.flags?.["dbu-ttrpg"]?.naturalArmor === true))
    ?? Array.from(actor?.items ?? []).find(each => (each.id !== item.id) && (each.flags?.["dbu-ttrpg"]?.naturalArmor === true));
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

/** Character Perks at Power Level 1, one of each Choice named, under that name - its Technique Points a Skill Improvement's. */
async function grantPerks(actor, source, choices) {
  if (!actor || !choices.length) return;
  const { default: DBUCharacterData } = await import("./data/actor-character.mjs");
  const perks = foundry.utils.deepClone(actor._source?.system?.characterPerks ?? []);
  for (const named of choices) {
    // `any`: a Character Perk of the player's kind, chosen on its row (Genetic Focus: Custom's).
    const choice = (named === "any") ? "" : named;
    perks.push({ source, lvl: 1, choice, talent: "",
      attributes: Object.fromEntries(Object.keys(DBUCharacterData.ATTRIBUTE_ABBREVIATIONS).map(key => [key, 0])),
      technique: (choice === "Skill Improvement") ? DBUCharacterData.SKILL_IMPROVEMENT_TP : 0,
      skillRanks: Array(DBUCharacterData.SKILL_RANK_SLOTS).fill("") });
  }
  await actor.update({ "system.characterPerks": perks });
}

/** What a Character Perk an Option gives is named on the Progression tab: "Clever (Beast of a Kind)". */
function perkSource(option, item) {
  return `${option.name} (${item.name})`;
}

/** The Character Perks a Trait's Options gave, gone with it - by the name each was given. */
async function dropGrantedPerks(actor, item) {
  const named = new Set(chosenOptions(item).filter(option => option.grantsPerk).map(option => perkSource(option, item)));
  // And the Trait's own, under its name - More than a Minion's.
  if (getTrait(item?.flags?.["dbu-ttrpg"]?.sourceId ?? "")?.grantsPerk) named.add(item.name);
  if (!named.size || !actor) return;
  const perks = Array.from(actor._source?.system?.characterPerks ?? []);
  const kept = perks.filter(perk => !named.has(perk.source));
  if (kept.length !== perks.length) await actor.update({ "system.characterPerks": kept });
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
  // Nameless Horde (2): no Signature Technique gained any other way - Copied, given, dropped on the sheet.
  Hooks.on("preCreateItem", (item, data) => {
    const actor = item.parent;
    if (!actor || (actor.documentName !== "Actor") || !isTechniqueData(data)) return;
    const why = whyNoNewTechnique(actor, data);
    if (!why) return;
    ui.notifications.warn(why);
    return false;
  });
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
    // A Talent's too - 3D Scan Mode's Scouter.
    if (((item.type !== RACIAL_TYPE) && (item.type !== "talent")) || !item.parent || (userId !== game.user.id)) return;
    const given = Array.from(item.parent.items).filter(each => each.flags?.["dbu-ttrpg"]?.grantedBy === item.id)
      .map(each => each.id);
    // A Talent kept only "while you possess this Factor Trait" (From Goop (2)'s, its `talentsGoWithIt`) - not the Racial Traits' usual
    // "you do not lose that Talent": gone with it, unless another Item of that Trait is still had.
    const sourceId = item.flags?.["dbu-ttrpg"]?.sourceId ?? "";
    if ((item.type === RACIAL_TYPE) && (getTrait(sourceId)?.talentsGoWithIt === true)
      && !Array.from(item.parent.items).some(each => (each.id !== item.id) && (each.flags?.["dbu-ttrpg"]?.sourceId === sourceId))) {
      given.push(...Array.from(item.parent.items).filter(each => (each.type === "talent") && (each.flags?.["dbu-ttrpg"]?.fromTrait === sourceId))
        .map(each => each.id));
    }
    if (given.length) await item.parent.deleteEmbeddedDocuments("Item", given);
    await dropGrantedPerks(item.parent, item);
    // And the Qualities its Options put on another's Natural Armor - Difference in Shell's on the Insect Shell.
    if (item.type === RACIAL_TYPE) {
      for (const option of chosenOptions(item).filter(each => each.platingQuality)) {
        await platingQuality(item.parent, item, String(option.platingQuality), false);
      }
    }
  });
}


// --- The text as the site prints it, and what stands now (the user's, 2026-11-27) -------------------------------------------------

/** One part bold in the site's accent, as dbu-rpg.com bolds a Trait's name and each effect's number and keywords. */
const strong = html => `<strong class="dbu-site-strong">${html}</strong>`;

/** A tooltip's text, for an attribute. */
const tip = text => Handlebars.escapeExpression(text);

/**
 * The sheet's lines (`live`): the Trait's name at its start and each effect's "(N)-[keywords]:" bold, as the site has them; in the
 * keywords, the uses left of a limit counted (`live.uses`: effect -> {round, encounter, roundMax, encounterMax}) - all yellow, some
 * spent orange, none red - and "Triggered" said "Automatic" where its button is so (`live.automatic`, effect numbers); and, unless
 * hidden in Settings (`live.realValues`), each amount's value for this character in brackets after it - "1(T) [3]" (realValues).
 */
export function liveLines(lines, live) {
  const first = lines.findIndex(line => line.html && !line.gap && !line.addendum);
  // The effect a line belongs to: an Option's or a Choice's own lines - "Elite [1/Encounter]:" - count that effect's uses.
  let current = 0;
  return lines.map((line, at) => {
    if (!line.html || line.gap || line.addendum) return line;
    let html = line.html;
    let head = "";
    const effect = /^\((\d+)\)-\[([^\]]*)\]:/.exec(html);
    // "*Elite [Passive]:", "• Elite [1/Encounter]:", "Tall Yardrat [Passive]:" - an Option or Choice's line, bold as an effect's (the
    // user's, 2026-11-27); its "*" drawn as the Choice's bullet.
    const option = !effect && (at !== first) && /^(?:[*•]\s*)?([^[<:*•][^[<:]{0,60}?) \[([^\]]*)\]:/.exec(html);
    if (effect) {
      current = Number(effect[1]);
      head = `(${strong(effect[1])})-[${strong(keywordsLive(current, effect[2], live))}]:`;
      html = html.slice(effect[0].length);
    }
    else if (option) {
      head = `${/^[*•]/.test(html) ? "• " : ""}${strong(option[1])} [${strong(keywordsLive(current, option[2], live))}]:`;
      html = html.slice(option[0].length);
    }
    else if ((at === first) && !line.bullet) {
      // Up to its Category's "(Body) [Replaced]:" where it has one - a name with a colon of its own, "Genetic Focus: Majins (Body)", whole.
      const name = /^([^:<(][^<]{0,80}?\s\([A-Za-z]+\)(?:\s\[[^\]]*\])?):(\s|$)/.exec(html) || /^([^:<(][^:<]{0,80}?):(\s|$)/.exec(html);
      if (name) {
        head = `${strong(name[1])}:`;
        html = html.slice(name[1].length + 1);
      }
    }
    if (live.realValues !== false) html = realValues(html, live);
    return { ...line, html: head + html };
  });
}

/** An effect's keywords: its limits as what is left, "Triggered" as "Automatic" where set so. */
function keywordsLive(n, keywords, live) {
  const uses = live.uses?.get?.(n);
  let html = keywords.replace(/(^|[\s,])([0-9A-Z]+)\/(Round|Encounter)\b/g, (whole, before, count, period) => {
    const key = period.toLowerCase();
    const left = uses?.[key];
    const most = uses?.[`${key}Max`];
    if (!Number.isFinite(left) || !Number.isFinite(most)) return whole;
    const kind = (left >= most) ? "full" : (left > 0) ? "part" : "none";
    return `${before}<span class="dbu-uses-${kind}" data-tooltip="${tip(`${left} of ${most} left this ${period}`)}">${left}</span>/${period}`;
  });
  if (live.automatic?.has?.(n)) {
    html = html.replace(/\bTriggered\b/g, '<span class="dbu-keyword-auto" data-tooltip="Set to Automatic on its button - it answers by itself">Automatic</span>');
  }
  return html;
}

/** The character's values a Trait's text names - "1/2 of your Max Capacity" - by their printed names. */
const STAT_NAMES = {
  "Surgency": data => data.surgency,
  "Maximum Life Points": data => data.life?.max,
  "Maximum Ki Points": data => data.ki?.max,
  "Max Capacity": data => data.capacity?.max,
  "Maximum Capacity": data => data.capacity?.max,
  "Might": data => data.might,
  "Soak Value": data => data.soakValue,
  "Damage Reduction": data => data.damageReduction,
  "Racial Life Modifier": data => data.racialLifeModifier,
  "Boosted Speed": data => data.speed?.boosted,
  "Speed": data => data.speed?.normal,
  "Stress Bonus": data => data.stressBonus,
  "Power Level": data => data.powerLevel,
  ...Object.fromEntries(["Agility", "Force", "Tenacity", "Scholarship", "Insight", "Magic", "Personality"]
    .map(name => [`${name} Modifier`, data => data.attributes?.[name.toLowerCase()]?.mod]))
};
const STAT_PATTERN = Object.keys(STAT_NAMES).sort((a, b) => b.length - a.length).join("|");

/** "1/2 (rounded up) of", "1/10th of", "double": what it does to a value, and its words for the tooltip. Nothing in front, the value. */
function fractionOf(written, rounding) {
  if (!written) return { apply: value => value, said: "", after: "" };
  if (/^(double|twice)$/i.test(written)) return { apply: value => value * 2, said: "twice ", after: "" };
  const up = /up/.test(rounding ?? "");
  const by = Number(/^1\/(\d+)/.exec(written)?.[1]) || 1;
  return { apply: value => (up ? Math.ceil(value / by) : Math.floor(value / by)), said: `1/${by} of `, after: up ? ", rounded up" : "" };
}

/** "1/2 (rounded up) of " in front of an amount: its fraction and rounding captured. */
const FRACTION = "(?:(1\\/\\d+(?:th)?|double|twice)(?: \\((rounded (?:up|down))\\))? of )";

/**
 * Each amount's value for this character, in brackets after it (the user's spreadsheet's way): "N(T)", "N(bT)", a Transformation's
 * "G(T)", "Z(bT)" (`live.letters`), dice "1d10(bT)" as "[3d10]", "by 2 for every Power Level", and "of your X" / "equal to your X" /
 * "by your X" for the character's values (STAT_NAMES) - each with "1/2 (rounded up) of", "1/10th of", "double" in front. Rounded down
 * unless it says up. What the sentence defines ("x(bT)") or the moment gives ("the Ki Point Cost of that Attacking Maneuver") has none.
 */
export function realValues(html, live) {
  const data = live.actor?.system ?? {};
  const T = Math.max(1, Number(data.tierOfPower) || 1);
  const bT = Math.max(1, Number(data.baseTierOfPower) || 1);
  const letters = live.letters ?? {};
  const bracket = (value, said) => ` <span class="dbu-real-value" data-tooltip="${tip(said)}">[${value}]</span>`;
  // Tier amounts: "1/2 (rounded up) of G(T)", "3(bT)", "1d10(T)" - not "x(T)", "2x(bT)".
  html = html.replace(new RegExp(`(?<![A-Za-z0-9/])${FRACTION}?(\\d+|[GZSM])(?:d(\\d+))?\\((b?)T\\)(?![\\w\\]])`, "g"),
    (whole, fraction, rounding, count, die, base) => {
      const tier = base ? bT : T;
      const tierSaid = `${base ? "base Tier of Power" : "Tier of Power"} ${tier}`;
      const letter = /^[GZSM]$/.test(count);
      if (letter && !Number.isFinite(Number(letters[count]))) return whole;
      const n = letter ? Number(letters[count]) : Number(count);
      const nSaid = letter ? `${count} ${n}` : String(n);
      if (die) return whole + bracket(`${n * tier}d${die}`, `${nSaid}d${die} × ${tierSaid}`);
      const { apply, said, after } = fractionOf(fraction, rounding);
      return whole + bracket(apply(n * tier), `${said}${nSaid} × ${tierSaid}${fraction ? ` = ${n * tier}` : ""}${after}`);
    });
  // "by 2 for every Power Level you possess".
  html = html.replace(/\bby (\d+) for (?:every|each) Power Level(?: you possess| you have reached| reached)?(?![\w\]])/g, (whole, per) =>
    whole + bracket(Number(per) * (Number(data.powerLevel) || 0), `${per} × Power Level ${Number(data.powerLevel) || 0}`));
  // The character's values: "1/2 of your Max Capacity", "equal to your Surgency", "by your Might".
  html = html.replace(new RegExp(`(?:${FRACTION}|\\bequal to |\\bby )your (${STAT_PATTERN})\\b`, "g"),
    (whole, fraction, rounding, name) => {
      const value = Number(STAT_NAMES[name]?.(data));
      if (!Number.isFinite(value)) return whole;
      const { apply, said, after } = fractionOf(fraction, rounding);
      return whole + bracket(apply(value), `${said}${name} ${value}${after}`);
    });
  return html;
}
